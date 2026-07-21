import EventKit
import Foundation
import os.log

/// Service responsible for interacting with Apple Reminders via EventKit.
/// Manages the "Mavinci CRM" reminders list and provides CRUD operations
/// for syncing CRM tasks to native reminders.
final class RemindersService {

    // MARK: - Properties

    let eventStore: EKEventStore
    let targetListName: String

    private let logger = Logger(subsystem: "com.mavinci.reminders", category: "RemindersService")
    private let listIdentifierKey = "com.mavinci.reminders.listIdentifier"

    // MARK: - Initialization

    init(targetListName: String = "Mavinci CRM") {
        self.eventStore = EKEventStore()
        self.targetListName = targetListName
    }

    // MARK: - Access Request

    /// Requests full access to Reminders.
    /// Uses `requestFullAccessToReminders()` on macOS 14+, falls back to
    /// `requestAccess(to:)` on macOS 13.
    /// - Returns: `true` if access was granted, `false` otherwise.
    func requestAccess() async -> Bool {
        do {
            if #available(macOS 14.0, *) {
                let granted = try await eventStore.requestFullAccessToReminders()
                logger.info("Reminders access (macOS 14+): \(granted)")
                return granted
            } else {
                // macOS 13 fallback
                let granted = try await eventStore.requestAccess(to: .reminder)
                logger.info("Reminders access (macOS 13): \(granted)")
                return granted
            }
        } catch {
            logger.error("Failed to request reminders access: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - List Management

    /// Finds an existing reminders list with the given name, or creates a new one.
    /// Caches the list identifier in UserDefaults for fast lookup on subsequent launches.
    /// - Parameter name: The name of the list to find or create. Defaults to `targetListName`.
    /// - Returns: The `EKCalendar` representing the reminders list, or `nil` on failure.
    func getOrCreateList(name: String? = nil) -> EKCalendar? {
        let listName = name ?? targetListName

        // Try to retrieve cached identifier first
        if let cachedIdentifier = UserDefaults.standard.string(forKey: listIdentifierKey),
           let calendar = eventStore.calendar(withIdentifier: cachedIdentifier),
           calendar.title == listName {
            logger.debug("Found cached reminders list: \(listName)")
            return calendar
        }

        // Search existing calendars
        let calendars = eventStore.calendars(for: .reminder)
        if let existing = calendars.first(where: { $0.title == listName }) {
            UserDefaults.standard.set(existing.calendarIdentifier, forKey: listIdentifierKey)
            logger.info("Found existing reminders list: \(listName)")
            return existing
        }

        // Create new list
        let newCalendar = EKCalendar(for: .reminder, eventStore: eventStore)
        newCalendar.title = listName

        // Use the default source for reminders
        guard let source = bestSourceForReminders() else {
            logger.error("No suitable source found for creating reminders list")
            return nil
        }

        newCalendar.source = source

        do {
            try eventStore.saveCalendar(newCalendar, commit: true)
            UserDefaults.standard.set(newCalendar.calendarIdentifier, forKey: listIdentifierKey)
            logger.info("Created new reminders list: \(listName)")
            return newCalendar
        } catch {
            logger.error("Failed to create reminders list: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Fetching Reminders

    /// Fetches all reminders from the Mavinci CRM list.
    /// - Returns: An array of `EKReminder` objects, or an empty array if the list is not found.
    func getAllRemindersInList() async -> [EKReminder] {
        guard let calendar = getOrCreateList() else {
            logger.warning("Cannot fetch reminders — list not available")
            return []
        }

        let predicate = eventStore.predicateForReminders(in: [calendar])

        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
    }

    // MARK: - Creating Reminders

    /// Creates a new `EKReminder` from a CRM task.
    /// - Parameters:
    ///   - task: The CRM task to convert into a reminder.
    ///   - crmBaseURL: The base URL of the CRM (e.g., "https://app.mavinci.pl").
    /// - Returns: The created `EKReminder`, or `nil` if the list is unavailable.
    func createReminder(from task: CRMTask, crmBaseURL: String) -> EKReminder? {
        guard let calendar = getOrCreateList() else {
            logger.error("Cannot create reminder — list not available")
            return nil
        }

        let reminder = EKReminder(eventStore: eventStore)
        reminder.calendar = calendar

        applyTaskFields(to: reminder, from: task, crmBaseURL: crmBaseURL)

        return reminder
    }

    // MARK: - Updating Reminders

    /// Updates an existing `EKReminder` with data from a CRM task.
    /// - Parameters:
    ///   - reminder: The reminder to update.
    ///   - task: The CRM task data source.
    ///   - crmBaseURL: The base URL of the CRM.
    func updateReminder(_ reminder: EKReminder, from task: CRMTask, crmBaseURL: String) {
        applyTaskFields(to: reminder, from: task, crmBaseURL: crmBaseURL)
    }

    // MARK: - Completion

    /// Marks a reminder as completed or incomplete.
    /// - Parameters:
    ///   - reminder: The reminder to update.
    ///   - completed: Whether the reminder should be marked as completed.
    func markCompleted(_ reminder: EKReminder, completed: Bool) {
        reminder.isCompleted = completed
        reminder.completionDate = completed ? Date() : nil
    }

    // MARK: - Persistence

    /// Saves a reminder to the event store.
    /// - Parameter reminder: The reminder to save.
    /// - Throws: An error if the save fails.
    func saveReminder(_ reminder: EKReminder) throws {
        try eventStore.save(reminder, commit: true)
        logger.debug("Saved reminder: \(reminder.title ?? "untitled")")
    }

    /// Deletes a reminder from the event store.
    /// - Parameter reminder: The reminder to delete.
    /// - Throws: An error if the deletion fails.
    func deleteReminder(_ reminder: EKReminder) throws {
        try eventStore.remove(reminder, commit: true)
        logger.debug("Deleted reminder: \(reminder.title ?? "untitled")")
    }

    // MARK: - CRM Task ID Extraction

    /// Extracts the CRM task ID from a reminder's notes field.
    /// Looks for the pattern `MAVINCI_CRM_TASK_ID=<uuid>` in the notes.
    /// - Parameter reminder: The reminder to extract the ID from.
    /// - Returns: The task ID string, or `nil` if not found.
    func extractCRMTaskId(from reminder: EKReminder) -> String? {
        guard let notes = reminder.notes else { return nil }

        let pattern = "MAVINCI_CRM_TASK_ID="
        guard let range = notes.range(of: pattern) else { return nil }

        let afterMarker = notes[range.upperBound...]
        // Extract until end of line or end of string
        let taskId: String
        if let newlineIndex = afterMarker.firstIndex(where: { $0.isNewline }) {
            taskId = String(afterMarker[..<newlineIndex])
        } else {
            taskId = String(afterMarker)
        }

        let trimmed = taskId.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: - Private Helpers

    /// Applies all CRM task fields to an EKReminder.
    private func applyTaskFields(to reminder: EKReminder, from task: CRMTask, crmBaseURL: String) {
        reminder.title = task.title
        reminder.notes = buildNote(from: task, crmBaseURL: crmBaseURL)
        reminder.priority = mapPriority(task.priority)
        reminder.isCompleted = task.isCompleted

        if task.isCompleted {
            reminder.completionDate = reminder.completionDate ?? Date()
        } else {
            reminder.completionDate = nil
        }

        // Due date
        if let dueDateString = task.due_date, let dueDate = parseDate(dueDateString) {
            let dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: dueDate
            )
            reminder.dueDateComponents = dueDateComponents

            // Set alarm for due date
            reminder.alarms?.forEach { reminder.removeAlarm($0) }
            let alarm = EKAlarm(absoluteDate: dueDate)
            reminder.addAlarm(alarm)
        } else {
            reminder.dueDateComponents = nil
            reminder.alarms?.forEach { reminder.removeAlarm($0) }
        }

        // URL pointing to CRM task
        let taskURL = "\(crmBaseURL)/crm/tasks/\(task.id)"
        reminder.url = URL(string: taskURL)
    }

    /// Builds the note string for a reminder from a CRM task.
    private func buildNote(from task: CRMTask, crmBaseURL: String) -> String {
        var note = ""

        if let eventName = task.event_name, !eventName.isEmpty {
            note += "Wydarzenie: \(eventName)\n\n"
        }

        if let description = task.description, !description.isEmpty {
            note += "\(description)\n"
        }

        let taskLink = "\(crmBaseURL)/crm/tasks/\(task.id)"
        note += "\nOtwórz w CRM:\n\(taskLink)\n"
        note += "\nMAVINCI_CRM_TASK_ID=\(task.id)"

        return note
    }

    /// Maps CRM priority strings to EventKit priority values.
    /// - EventKit priorities: 0 = none, 1 = high, 5 = medium, 9 = low
    private func mapPriority(_ priority: String) -> Int {
        switch priority.lowercased() {
        case "urgent", "high":
            return 1
        case "medium":
            return 5
        case "low":
            return 9
        default:
            return 0
        }
    }

    /// Parses a date string (ISO 8601 or common formats) into a Date.
    private func parseDate(_ dateString: String) -> Date? {
        let iso8601Formatter = ISO8601DateFormatter()
        iso8601Formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        if let date = iso8601Formatter.date(from: dateString) {
            return date
        }

        // Try without fractional seconds
        iso8601Formatter.formatOptions = [.withInternetDateTime]
        if let date = iso8601Formatter.date(from: dateString) {
            return date
        }

        // Try date-only format (yyyy-MM-dd)
        let dateOnlyFormatter = DateFormatter()
        dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
        dateOnlyFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateOnlyFormatter.timeZone = TimeZone.current

        return dateOnlyFormatter.date(from: dateString)
    }

    /// Finds the best source for creating a reminders calendar.
    /// Prefers iCloud, then Local, then any available source.
    private func bestSourceForReminders() -> EKSource? {
        let sources = eventStore.sources

        // Prefer iCloud
        if let iCloud = sources.first(where: { $0.sourceType == .calDAV && $0.title == "iCloud" }) {
            return iCloud
        }

        // Then CalDAV
        if let calDAV = sources.first(where: { $0.sourceType == .calDAV }) {
            return calDAV
        }

        // Then Local
        if let local = sources.first(where: { $0.sourceType == .local }) {
            return local
        }

        // Fallback: default calendar's source, or first available
        if let defaultCalendar = eventStore.defaultCalendarForNewReminders() {
            return defaultCalendar.source
        }

        return sources.first
    }
}
