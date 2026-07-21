import Foundation
import EventKit
import Network
import Combine
import os.log

// MARK: - Connection Status

/// Represents the current connection/sync status of the SyncManager.
enum ConnectionStatus: String, CaseIterable {
    case connected
    case disconnected
    case syncing
    case error
    case paused
}

// MARK: - SyncManager

/// Central orchestrator that coordinates CRM API calls with EventKit operations.
/// Manages bidirectional sync between the Mavinci CRM backend and Apple Reminders.
@available(macOS 13.0, *)
final class SyncManager: ObservableObject {

    // MARK: - Singleton

    static let shared = SyncManager()

    // MARK: - Published Properties

    @Published var isSyncing: Bool = false
    @Published var isPaused: Bool = false
    @Published var lastSyncDate: Date?
    @Published var activeRemindersCount: Int = 0
    @Published var errorCount: Int = 0
    @Published var lastError: String?
    @Published var connectionStatus: ConnectionStatus = .disconnected

    // MARK: - Private Properties

    private var syncTimer: Timer?
    private var syncState: SyncState
    private var taskReminderMap: [String: String] // crmTaskId -> reminderIdentifier
    private var isSyncInProgress: Bool = false

    private let remindersService: RemindersService
    private let apiClient: CRMAPIClient
    private let networkMonitor: NWPathMonitor
    private let networkQueue = DispatchQueue(label: "com.mavinci.reminders.networkMonitor")
    private let syncQueue = DispatchQueue(label: "com.mavinci.reminders.syncQueue")

    private let logger = Logger(subsystem: "com.mavinci.reminders", category: "SyncManager")

    private var isNetworkAvailable: Bool = false
    private var retryCount: Int = 0
    private static let maxRetries: Int = 3
    private static let staleEntryTimeout: TimeInterval = 3600 // 1 hour

    // MARK: - Persistence Paths

    private static let mapFileURL: URL = {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appDirectory = appSupport.appendingPathComponent("MavinciReminders", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDirectory, withIntermediateDirectories: true)
        return appDirectory.appendingPathComponent("task_reminder_map.json")
    }()

    // MARK: - Initialization

    private init(
        remindersService: RemindersService = RemindersService(),
        apiClient: CRMAPIClient = CRMAPIClient.shared
    ) {
        self.remindersService = remindersService
        self.apiClient = apiClient
        self.syncState = SyncState.load()
        self.taskReminderMap = Self.loadTaskReminderMap()
        self.networkMonitor = NWPathMonitor()
        self.lastSyncDate = syncState.lastSyncDate

        setupNetworkMonitoring()
    }

    deinit {
        syncTimer?.invalidate()
        networkMonitor.cancel()
    }

    // MARK: - Network Monitoring

    private func setupNetworkMonitoring() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let connected = path.status == .satisfied
            Task { @MainActor in
                self.handleNetworkChange(isConnected: connected)
            }
        }
        networkMonitor.start(queue: networkQueue)
    }

    // MARK: - Periodic Sync

    /// Starts periodic sync at the given interval (default 5 minutes).
    /// - Parameter interval: The time interval between sync cycles, in seconds.
    func startPeriodicSync(interval: TimeInterval = 300) {
        stopPeriodicSync()

        logger.info("Starting periodic sync with interval: \(interval)s")

        // Run an initial sync immediately
        Task {
            await syncNow()
        }

        // Schedule periodic syncs on the main run loop
        DispatchQueue.main.async { [weak self] in
            self?.syncTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
                Task {
                    await self?.syncNow()
                }
            }
        }
    }

    /// Stops the periodic sync timer.
    func stopPeriodicSync() {
        syncTimer?.invalidate()
        syncTimer = nil
        logger.info("Periodic sync stopped")
    }

    // MARK: - Computed Properties

    /// Whether the manager currently has a working connection to CRM.
    var isConnected: Bool {
        connectionStatus == .connected || connectionStatus == .syncing
    }

    // MARK: - Pause / Resume

    /// Toggles between paused and active state.
    func togglePause() {
        if isPaused {
            resumeSync()
        } else {
            pauseSync()
        }
    }

    /// Pauses sync operations. The timer continues but sync cycles are skipped.
    func pauseSync() {
        isPaused = true
        connectionStatus = .paused
        logger.info("Sync paused")
    }

    /// Resumes sync operations and triggers an immediate sync.
    func resumeSync() {
        isPaused = false
        if isNetworkAvailable {
            connectionStatus = .connected
        }
        logger.info("Sync resumed")

        Task {
            await syncNow()
        }
    }

    // MARK: - Reset

    /// Clears the local task-to-reminder mapping and triggers a full re-sync.
    func resetMapping() {
        syncQueue.sync {
            taskReminderMap.removeAll()
            syncState = SyncState()
        }
        saveTaskReminderMap()
        syncState.save()
        logger.info("Mapping reset — next sync will be a full re-sync")

        Task {
            await syncNow()
        }
    }

    // MARK: - Network Change Handler

    /// Handles network connectivity changes.
    /// - Parameter isConnected: Whether the network is currently reachable.
    @MainActor
    func handleNetworkChange(isConnected: Bool) {
        let wasDisconnected = !isNetworkAvailable
        isNetworkAvailable = isConnected

        if isConnected {
            if !isPaused {
                connectionStatus = .connected
            }
            // If coming back from disconnected state, trigger sync
            if wasDisconnected && !isPaused {
                logger.info("Network restored — triggering sync")
                Task {
                    await syncNow()
                }
            }
        } else {
            if !isPaused {
                connectionStatus = .disconnected
            }
            logger.info("Network lost")
        }
    }

    // MARK: - Main Sync Method

    /// Performs a full bidirectional sync between the CRM and local Reminders.
    /// Guarded against concurrent execution. Skips if paused or network unavailable.
    func syncNow() async {
        // Guard: prevent concurrent syncs
        let shouldProceed: Bool = syncQueue.sync {
            if isSyncInProgress { return false }
            isSyncInProgress = true
            return true
        }

        guard shouldProceed else {
            logger.debug("Sync skipped — already in progress")
            return
        }

        defer {
            syncQueue.sync {
                isSyncInProgress = false
            }
        }

        // Guard: paused
        guard !isPaused else {
            logger.debug("Sync skipped — paused")
            return
        }

        // Guard: network
        guard isNetworkAvailable else {
            logger.debug("Sync skipped — no network")
            return
        }

        await MainActor.run {
            isSyncing = true
            connectionStatus = .syncing
        }

        defer {
            Task { @MainActor in
                self.isSyncing = false
                if self.isPaused {
                    self.connectionStatus = .paused
                } else if !self.isNetworkAvailable {
                    self.connectionStatus = .disconnected
                } else if self.lastError != nil {
                    self.connectionStatus = .error
                } else {
                    self.connectionStatus = .connected
                }
            }
        }

        do {
            try await performSync()
            retryCount = 0
            await MainActor.run {
                self.lastError = nil
            }
        } catch {
            await handleSyncError(error)
        }
    }

    // MARK: - Core Sync Logic

    private func performSync() async throws {
        // Step 1: Fetch tasks from CRM API (with retry)
        let tasksResponse = try await fetchTasksWithRetry()

        // Step 2: Validate response — if not success, do NOT mark reminders as completed
        guard tasksResponse.success else {
            let errorMessage = tasksResponse.error ?? "CRM API returned success=false"
            logger.error("CRM API error: \(errorMessage)")
            throw SyncError.apiError(errorMessage)
        }

        let crmTasks = tasksResponse.tasks ?? []

        // Step 3: Get all local reminders from the list
        let reminders = await remindersService.getAllRemindersInList()

        // Step 4: Build lookup maps
        var reminderByTaskId: [String: EKReminder] = [:]

        // First pass: use taskReminderMap (persisted mapping)
        var currentMap = syncQueue.sync { taskReminderMap }
        for (taskId, reminderId) in currentMap {
            if let reminder = reminders.first(where: { $0.calendarItemIdentifier == reminderId }) {
                reminderByTaskId[taskId] = reminder
            }
        }

        // Second pass: fallback to MAVINCI_CRM_TASK_ID marker in notes
        for reminder in reminders {
            if let taskId = remindersService.extractCRMTaskId(from: reminder),
               reminderByTaskId[taskId] == nil {
                reminderByTaskId[taskId] = reminder
                // Persist this discovered mapping
                syncQueue.sync {
                    taskReminderMap[taskId] = reminder.calendarItemIdentifier
                }
            }
        }

        // Step 5: Build a set of CRM task IDs for quick lookup
        let crmTaskIds = Set(crmTasks.map { $0.id })

        // Step 6: Process each CRM task (CRM -> Apple)
        let crmBaseURL = apiClient.baseURL
        var syncedActiveCount = 0
        var syncErrors: [String] = []

        for task in crmTasks {
            do {
                if let existingReminder = reminderByTaskId[task.id] {
                    // Reminder exists — check if update needed
                    try updateReminderIfNeeded(existingReminder, from: task, crmBaseURL: crmBaseURL)
                } else {
                    // No matching reminder — create new
                    try createNewReminder(from: task, crmBaseURL: crmBaseURL)
                }

                if !task.isCompleted {
                    syncedActiveCount += 1
                }
            } catch {
                syncErrors.append("Task \(task.id): \(error.localizedDescription)")
                logger.error("Error syncing task \(task.id): \(error.localizedDescription)")
            }
        }

        // Step 7: Handle reminders with no matching CRM task (orphaned reminders)
        for reminder in reminders {
            let taskId = remindersService.extractCRMTaskId(from: reminder)
                ?? syncQueue.sync { taskReminderMap.first(where: { $0.value == reminder.calendarItemIdentifier })?.key }

            guard let taskId = taskId else { continue }

            if !crmTaskIds.contains(taskId) && !reminder.isCompleted {
                // Task was unassigned or deleted from CRM — mark as completed
                remindersService.markCompleted(reminder, completed: true)
                do {
                    try remindersService.saveReminder(reminder)
                    syncQueue.sync {
                        syncState.lastChangeSource[taskId] = .crm
                        syncState.lastReminderModification[reminder.calendarItemIdentifier] = Date()
                    }
                    logger.info("Marked orphaned reminder as completed: \(reminder.title ?? "untitled")")
                } catch {
                    logger.error("Failed to mark orphaned reminder as completed: \(error.localizedDescription)")
                }
            }
        }

        // Step 8: Check Apple -> CRM completion changes
        var pendingUpdates: [PendingCompletionUpdate] = []

        // Reload reminders to capture our changes
        let updatedReminders = await remindersService.getAllRemindersInList()

        for reminder in updatedReminders {
            let taskId = remindersService.extractCRMTaskId(from: reminder)
                ?? syncQueue.sync { taskReminderMap.first(where: { $0.value == reminder.calendarItemIdentifier })?.key }

            guard let taskId = taskId else { continue }
            guard crmTaskIds.contains(taskId) else { continue }

            let changeSource = syncQueue.sync { syncState.lastChangeSource[taskId] }
            let lastRecordedModification = syncQueue.sync { syncState.lastReminderModification[reminder.calendarItemIdentifier] }

            // Determine if this is a user-initiated change
            let isUserChange: Bool = {
                guard changeSource == .crm else { return true }
                // If modification date on the reminder is newer than our last recorded update,
                // the user made a change after we synced from CRM.
                if let lastMod = lastRecordedModification,
                   let reminderMod = reminder.lastModifiedDate,
                   reminderMod > lastMod.addingTimeInterval(2) { // 2s tolerance
                    return true
                }
                return false
            }()

            guard isUserChange else { continue }

            // Find matching CRM task
            guard let crmTask = crmTasks.first(where: { $0.id == taskId }) else { continue }

            if reminder.isCompleted && !crmTask.isCompleted {
                // User completed in Reminders -> push completion to CRM
                pendingUpdates.append(PendingCompletionUpdate(
                    taskId: taskId,
                    completed: true,
                    timestamp: Date()
                ))
            } else if !reminder.isCompleted && crmTask.isCompleted {
                // User unchecked in Reminders -> push reopening to CRM
                pendingUpdates.append(PendingCompletionUpdate(
                    taskId: taskId,
                    completed: false,
                    timestamp: Date()
                ))
            }
        }

        // Add any previously pending updates that weren't pushed
        let existingPending = syncQueue.sync { syncState.pendingCompletionUpdates }
        for pending in existingPending {
            if !pendingUpdates.contains(where: { $0.taskId == pending.taskId }) {
                pendingUpdates.append(pending)
            }
        }

        // Step 9: Push pending completion updates to CRM
        if !pendingUpdates.isEmpty {
            await pushCompletionUpdates(pendingUpdates)
        }

        // Step 10: Clean stale entries from lastChangeSource
        cleanStaleChangeSourceEntries()

        // Step 11: Save sync state and mapping
        syncQueue.sync {
            syncState.lastSyncDate = Date()
        }
        syncState.save()
        saveTaskReminderMap()

        // Step 12: Update published properties
        await MainActor.run {
            self.lastSyncDate = Date()
            self.activeRemindersCount = syncedActiveCount
            if !syncErrors.isEmpty {
                self.errorCount += syncErrors.count
            }
        }

        logger.info("Sync completed: \(syncedActiveCount) active tasks, \(pendingUpdates.count) completion updates pushed")
    }

    // MARK: - CRM -> Reminders Helpers

    /// Creates a new reminder from a CRM task and saves the mapping.
    private func createNewReminder(from task: CRMTask, crmBaseURL: String) throws {
        guard let reminder = remindersService.createReminder(from: task, crmBaseURL: crmBaseURL) else {
            throw SyncError.reminderCreationFailed(task.id)
        }

        try remindersService.saveReminder(reminder)

        let reminderId = reminder.calendarItemIdentifier
        syncQueue.sync {
            taskReminderMap[task.id] = reminderId
            syncState.lastChangeSource[task.id] = .crm
            syncState.lastReminderModification[reminderId] = Date()
            if let updatedAt = parseISO8601(task.updated_at) {
                syncState.lastCRMModification[task.id] = updatedAt
            }
        }

        logger.debug("Created reminder for task: \(task.title)")
    }

    /// Updates an existing reminder if the CRM data has changed since last sync.
    private func updateReminderIfNeeded(_ reminder: EKReminder, from task: CRMTask, crmBaseURL: String) throws {
        let lastKnownModification = syncQueue.sync { syncState.lastCRMModification[task.id] }
        let taskUpdatedAt = parseISO8601(task.updated_at)

        // Check if CRM data actually changed
        var needsUpdate = false
        if let taskDate = taskUpdatedAt {
            if let lastKnown = lastKnownModification {
                needsUpdate = taskDate > lastKnown
            } else {
                // First time seeing this mapping — update to be safe
                needsUpdate = true
            }
        } else {
            // Can't determine — update anyway
            needsUpdate = true
        }

        guard needsUpdate else { return }

        remindersService.updateReminder(reminder, from: task, crmBaseURL: crmBaseURL)
        try remindersService.saveReminder(reminder)

        let reminderId = reminder.calendarItemIdentifier
        syncQueue.sync {
            syncState.lastChangeSource[task.id] = .crm
            syncState.lastReminderModification[reminderId] = Date()
            if let updatedAt = taskUpdatedAt {
                syncState.lastCRMModification[task.id] = updatedAt
            }
        }

        logger.debug("Updated reminder for task: \(task.title)")
    }

    // MARK: - Push Completion Updates

    /// Pushes completion status changes to the CRM backend.
    private func pushCompletionUpdates(_ updates: [PendingCompletionUpdate]) async {
        let completionUpdates = updates.map { CompletionUpdate(task_id: $0.taskId, completed: $0.completed) }

        do {
            let response = try await apiClient.pushCompletionUpdates(completionUpdates)

            if response.success {
                // Mark source as local for pushed updates
                syncQueue.sync {
                    for update in updates {
                        syncState.lastChangeSource[update.taskId] = .local
                    }
                    syncState.pendingCompletionUpdates.removeAll()
                }
                logger.info("Pushed \(updates.count) completion update(s) to CRM")
            } else {
                // Keep as pending for next sync
                syncQueue.sync {
                    syncState.pendingCompletionUpdates = updates
                }
                let errorMsg = response.error ?? "Unknown error pushing completions"
                logger.error("Failed to push completions: \(errorMsg)")
            }
        } catch {
            // Network/server error — keep as pending
            syncQueue.sync {
                syncState.pendingCompletionUpdates = updates
            }
            logger.error("Error pushing completions: \(error.localizedDescription)")
        }
    }

    // MARK: - Retry Logic

    /// Fetches tasks from the CRM with exponential backoff retry.
    private func fetchTasksWithRetry() async throws -> CRMTasksResponse {
        var lastError: Error?

        for attempt in 0..<Self.maxRetries {
            do {
                let response = try await apiClient.fetchTasks()
                return response
            } catch let error as CRMAPIError {
                lastError = error

                // Only retry on transient failures
                switch error {
                case .networkError, .serverError(let code) where code >= 500:
                    let delay = pow(2.0, Double(attempt)) // 1s, 2s, 4s
                    logger.warning("Fetch attempt \(attempt + 1) failed, retrying in \(delay)s: \(error.localizedDescription)")
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                default:
                    // Non-transient errors: don't retry
                    throw error
                }
            } catch {
                lastError = error
                let delay = pow(2.0, Double(attempt))
                logger.warning("Fetch attempt \(attempt + 1) failed, retrying in \(delay)s: \(error.localizedDescription)")
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                continue
            }
        }

        throw lastError ?? SyncError.unknownError
    }

    // MARK: - Error Handling

    private func handleSyncError(_ error: Error) async {
        let errorMessage: String

        if let syncError = error as? SyncError {
            errorMessage = syncError.localizedDescription
        } else if let apiError = error as? CRMAPIError {
            errorMessage = apiError.localizedDescription
        } else {
            errorMessage = error.localizedDescription
        }

        logger.error("Sync error: \(errorMessage)")

        await MainActor.run {
            self.lastError = errorMessage
            self.errorCount += 1
            self.connectionStatus = .error
        }
    }

    // MARK: - Stale Entry Cleanup

    /// Removes entries from lastChangeSource that are older than 1 hour.
    private func cleanStaleChangeSourceEntries() {
        let cutoff = Date().addingTimeInterval(-Self.staleEntryTimeout)

        syncQueue.sync {
            // Remove stale lastChangeSource entries by checking lastReminderModification dates
            var keysToRemove: [String] = []
            for (taskId, _) in syncState.lastChangeSource {
                // Check associated modification date
                if let reminderId = taskReminderMap[taskId],
                   let lastMod = syncState.lastReminderModification[reminderId],
                   lastMod < cutoff {
                    keysToRemove.append(taskId)
                } else if taskReminderMap[taskId] == nil {
                    // No mapping exists — safe to remove
                    keysToRemove.append(taskId)
                }
            }

            for key in keysToRemove {
                syncState.lastChangeSource.removeValue(forKey: key)
            }

            if !keysToRemove.isEmpty {
                logger.debug("Cleaned \(keysToRemove.count) stale change source entries")
            }
        }
    }

    // MARK: - Persistence

    /// Saves the task-to-reminder mapping to disk.
    private func saveTaskReminderMap() {
        let mapToSave = syncQueue.sync { taskReminderMap }

        do {
            let data = try JSONEncoder().encode(mapToSave)
            try data.write(to: Self.mapFileURL, options: .atomic)
            logger.debug("Saved task reminder map (\(mapToSave.count) entries)")
        } catch {
            logger.error("Failed to save task reminder map: \(error.localizedDescription)")
        }
    }

    /// Loads the task-to-reminder mapping from disk.
    private static func loadTaskReminderMap() -> [String: String] {
        guard FileManager.default.fileExists(atPath: mapFileURL.path) else {
            return [:]
        }

        do {
            let data = try Data(contentsOf: mapFileURL)
            let map = try JSONDecoder().decode([String: String].self, from: data)
            return map
        } catch {
            print("[SyncManager] Failed to load task reminder map: \(error.localizedDescription)")
            return [:]
        }
    }

    // MARK: - Date Parsing

    private func parseISO8601(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }
}

// MARK: - Sync Errors

enum SyncError: LocalizedError {
    case apiError(String)
    case reminderCreationFailed(String)
    case unknownError

    var errorDescription: String? {
        switch self {
        case .apiError(let message):
            return "CRM API error: \(message)"
        case .reminderCreationFailed(let taskId):
            return "Failed to create reminder for task: \(taskId)"
        case .unknownError:
            return "An unknown sync error occurred."
        }
    }
}
