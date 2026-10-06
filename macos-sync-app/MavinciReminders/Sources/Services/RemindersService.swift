import EventKit
import Foundation
import CryptoKit
import os.log

/// Service responsible for interacting with Apple Reminders via EventKit.
/// Manages the "Mavinci CRM" reminders list and provides CRUD operations
/// for syncing CRM tasks to native reminders.
@MainActor
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
            let granted: Bool
            if #available(macOS 14.0, *) {
                granted = try await eventStore.requestFullAccessToReminders()
            } else {
                granted = try await eventStore.requestAccess(to: .reminder)
            }
            // Called only at an operation boundary, never while EKObjects are being saved.
            // The same store requests access AND fetches data. Discard pre-permission caches.
            if granted { eventStore.reset() }
            logger.info("Reminders access: \(granted)")
            return granted
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
    func getOrCreateList(name: String? = nil, allowCreation: Bool = false) throws -> EKCalendar {
        let listName = name ?? UserDefaults.standard.string(forKey: "selectedRemindersListName") ?? targetListName
        let calendars = eventStore.calendars(for: .reminder)
        let choices = calendars.map { ReminderListChoice(id: $0.calendarIdentifier, title: $0.title, account: $0.source.title) }
        let cachedName = UserDefaults.standard.string(forKey: "mavinci.cachedListName")
        let cachedID = (name == nil && (cachedName == nil || cachedName == listName))
            ? UserDefaults.standard.string(forKey: listIdentifierKey) : nil
        do {
            let selected = try ReminderListResolver.resolve(choices, cachedID: cachedID, name: listName)
            return try selectList(identifier: selected.id)
        } catch RemindersError.missingList where allowCreation {
            // Only an explicit user request can create a list, never a failed sync read.
        } catch RemindersError.noLists where allowCreation {
            // First-time setup may have no lists yet, but must have a writable source.
        }
        let newCalendar = EKCalendar(for: .reminder, eventStore: eventStore)
        newCalendar.title = listName
        guard let source = bestSourceForReminders() else {
            throw RemindersError.noLists
        }
        newCalendar.source = source
        try eventStore.saveCalendar(newCalendar, commit: true)
        return try selectList(identifier: newCalendar.calendarIdentifier)
    }

    func availableLists() -> [ReminderListChoice] {
        eventStore.calendars(for: .reminder).map {
            ReminderListChoice(id: $0.calendarIdentifier, title: $0.title, account: $0.source.title)
        }.sorted { ($0.title, $0.account, $0.id) < ($1.title, $1.account, $1.id) }
    }

    @discardableResult
    func selectList(identifier: String) throws -> EKCalendar {
        guard let calendar = eventStore.calendar(withIdentifier: identifier), calendar.allowedEntityTypes.contains(.reminder) else {
            throw RemindersError.missingList(UserDefaults.standard.string(forKey: "selectedRemindersListName") ?? targetListName)
        }
        guard calendar.allowsContentModifications else { throw RemindersError.readOnly }
        UserDefaults.standard.set(calendar.calendarIdentifier, forKey: listIdentifierKey)
        UserDefaults.standard.set(calendar.title, forKey: "mavinci.cachedListName")
        UserDefaults.standard.set(calendar.title, forKey: "selectedRemindersListName")
        return calendar
    }

    // MARK: - Fetching Reminders

    /// Fetches all reminders from the Mavinci CRM list.
    /// - Returns: An array of `EKReminder` objects, or an empty array if the list is not found.
    func getAllRemindersInList() async throws -> [EKReminder] {
        let calendar = try getOrCreateList()

        return try await reminders(in: calendar)
    }

    func reminders(in calendar: EKCalendar) async throws -> [EKReminder] {
        let predicate = eventStore.predicateForReminders(in: [calendar])

        return try await withCheckedThrowingContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                if let reminders { continuation.resume(returning: reminders) }
                else { continuation.resume(throwing: RemindersError.fetchFailed) }
            }
        }
    }

    // MARK: - Recoverable archive (never delete or mark completed to tidy a list)

    static let archiveListName = "Archiwum Mavinci"

    func archiveList(for activeList: EKCalendar, scope: String, create: Bool) throws -> EKCalendar? {
        guard activeList.title != Self.archiveListName else {
            throw archiveError("Archiwum nie może być główną listą synchronizacji. Wybierz listę Mavinci CRM.")
        }
        let sourceID = activeList.source.sourceIdentifier
        let hash = SHA256.hash(data: Data((scope + "|" + sourceID).utf8)).map { String(format: "%02x", $0) }.joined()
        let key = "mavinci.archiveList." + hash
        if let id = UserDefaults.standard.string(forKey: key) {
            guard let calendar = eventStore.calendar(withIdentifier: id),
                  calendar.source.sourceIdentifier == sourceID, calendar.calendarIdentifier != activeList.calendarIdentifier,
                  calendar.allowsContentModifications else {
                throw archiveError("Lista Archiwum Mavinci jest chwilowo niedostępna lub tylko do odczytu. Nie utworzono kolejnego archiwum.")
            }
            return calendar
        }
        let matches = eventStore.calendars(for: .reminder).filter {
            $0.title == Self.archiveListName && $0.source.sourceIdentifier == sourceID
        }
        guard matches.count <= 1 else { throw archiveError("Znaleziono kilka list Archiwum Mavinci. Uporządkuj ich nazwy przed synchronizacją.") }
        if let calendar = matches.first {
            guard calendar.allowsContentModifications else { throw archiveError("Archiwum Mavinci jest tylko do odczytu.") }
            UserDefaults.standard.set(calendar.calendarIdentifier, forKey: key)
            return calendar
        }
        guard create else { return nil }
        let calendar = EKCalendar(for: .reminder, eventStore: eventStore)
        calendar.title = Self.archiveListName
        calendar.source = activeList.source // Keep the reminder within the same iCloud/local account.
        try eventStore.saveCalendar(calendar, commit: true)
        UserDefaults.standard.set(calendar.calendarIdentifier, forKey: key)
        return calendar
    }

    /// A title or stale taskMap entry is not sufficient authority to move a reminder.
    func verifiedCRMTaskID(_ reminder: EKReminder, baseURL: String) -> String? {
        guard let base = URL(string: baseURL), let link = reminder.url,
              link.scheme?.lowercased() == "https", base.scheme?.lowercased() == "https",
              link.host?.lowercased() == base.host?.lowercased(), (link.port ?? 443) == (base.port ?? 443),
              link.user == nil, link.password == nil,
              link.pathComponents.count == 4, link.pathComponents[1] == "crm", link.pathComponents[2] == "tasks",
              let id = UUID(uuidString: link.pathComponents[3]) else { return nil }
        guard let notes = reminder.notes, let range = notes.range(of: "MAVINCI_CRM_TASK_ID=") else { return nil }
        let marked = notes[range.upperBound...].prefix { !$0.isNewline }.trimmingCharacters(in: .whitespaces)
        guard UUID(uuidString: marked) == id else { return nil }
        return id.uuidString.lowercased()
    }

    func movePreservingReminder(_ reminder: EKReminder, to target: EKCalendar, reason: String) throws {
        guard let original = reminder.calendar else { throw archiveError("Przypomnienie nie ma dostępnej listy źródłowej.") }
        guard original.calendarIdentifier != target.calendarIdentifier else { return }
        guard original.source.sourceIdentifier == target.source.sourceIdentifier,
              original.allowsContentModifications, target.allowsContentModifications else {
            throw archiveError("Nie można przenieść przypomnienia między kontami lub listami tylko do odczytu.")
        }
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciReminders/ArchiveMoves", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let record: [String: Any] = [
            "identifier": reminder.calendarItemIdentifier, "title": reminder.title ?? "", "notes": reminder.notes ?? "",
            "url": reminder.url?.absoluteString ?? "", "completed": reminder.isCompleted,
            "sourceCalendar": original.calendarIdentifier, "targetCalendar": target.calendarIdentifier,
            "reason": reason, "preparedAt": ISO8601DateFormatter().string(from: Date())
        ]
        try JSONSerialization.data(withJSONObject: record, options: .prettyPrinted)
            .write(to: directory.appendingPathComponent(UUID().uuidString + ".json"), options: .atomic)
        reminder.calendar = target
        do { try eventStore.save(reminder, commit: true) }
        catch { reminder.calendar = original; throw error }
        // Status, notes, dates and alarms are intentionally left untouched.
    }

    private func archiveError(_ message: String) -> Error {
        NSError(domain: "MavinciArchive", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    // MARK: - Creating Reminders

    /// Creates a new `EKReminder` from a CRM task.
    /// - Parameters:
    ///   - task: The CRM task to convert into a reminder.
    ///   - crmBaseURL: The base URL of the CRM (e.g., "https://app.mavinci.pl").
    /// - Returns: The created `EKReminder`, or `nil` if the list is unavailable.
    func createReminder(from task: CRMTask, crmBaseURL: String) throws -> EKReminder {
        let calendar = try getOrCreateList()

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
    func extractCRMTaskId(from reminder: EKReminder, crmBaseURL: String? = nil) -> String? {
        if let link = reminder.url {
            if let base = crmBaseURL, link.host?.lowercased() != URL(string: base)?.host?.lowercased() { return nil }
            let parts = link.pathComponents
            if parts.count >= 4, parts[1] == "crm", parts[2] == "tasks", UUID(uuidString: parts[3]) != nil { return parts[3].lowercased() }
        }
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
        return UUID(uuidString: trimmed) == nil ? nil : trimmed.lowercased()
    }

    func isExactDuplicate(_ a: EKReminder, of b: EKReminder) -> Bool {
        a.title == b.title && a.notes == b.notes && a.url == b.url &&
        a.isCompleted == b.isCompleted && a.priority == b.priority &&
        a.dueDateComponents == b.dueDateComponents && a.startDateComponents == b.startDateComponents &&
        !(a.hasRecurrenceRules || b.hasRecurrenceRules) &&
        !(a.alarms ?? []).contains(where: { $0.relativeOffset != 0 || $0.structuredLocation != nil }) &&
        !(b.alarms ?? []).contains(where: { $0.relativeOffset != 0 || $0.structuredLocation != nil }) &&
        (a.alarms ?? []).map { $0.absoluteDate } == (b.alarms ?? []).map { $0.absoluteDate }
    }

    func archiveAndDeleteDuplicate(_ reminder: EKReminder) throws {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciReminders/DuplicateBackups", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let backup: [String: Any] = [
            "title": reminder.title ?? "", "notes": reminder.notes ?? "",
            "url": reminder.url?.absoluteString ?? "", "completed": reminder.isCompleted,
            "priority": reminder.priority, "calendar": reminder.calendar.title,
            "due": reminder.dueDateComponents?.description ?? "",
            "identifier": reminder.calendarItemIdentifier, "archivedAt": ISO8601DateFormatter().string(from: Date())
        ]
        try JSONSerialization.data(withJSONObject: backup, options: .prettyPrinted)
            .write(to: directory.appendingPathComponent(UUID().uuidString + ".json"), options: .atomic)
        try deleteReminder(reminder)
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
