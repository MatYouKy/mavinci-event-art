import Foundation
import EventKit
import Network
import Combine

enum ConnectionStatus: String, CaseIterable {
    case connected, disconnected, syncing, error, paused
}

/// One actor and one process own EventKit, the queue and the persisted state.
@MainActor
final class SyncManager: ObservableObject {
    static let shared = SyncManager()
    @Published var isSyncing = false
    @Published var isPaused = false
    @Published var lastSyncDate: Date?
    @Published var activeRemindersCount = 0
    @Published var hasLoadedPersonalTasks = false
    @Published var syncedEmployeeName = ""
    @Published var archiveSummary = ""
    @Published var errorCount = 0
    @Published var lastError: String?
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var remindersAccessGranted = false
    var startupAllowed = false

    private let remindersService = RemindersService()
    private let apiClient = CRMAPIClient.shared
    private let monitor = NWPathMonitor()
    private var timer: Timer?
    private var online = false
    private var state = SyncState.load()
    private var taskMap: [String: String] = [:]
    private static let mapURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("MavinciReminders/task_reminder_map.json")

    private init() {
        if let data = try? Data(contentsOf: Self.mapURL),
           let map = try? JSONDecoder().decode([String: String].self, from: data) { taskMap = map }
        lastSyncDate = state.lastSyncDate
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.handleNetworkChange(isConnected: path.status == .satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "com.mavinci.sync.network"))
    }

    var isConnected: Bool { connectionStatus == .connected || connectionStatus == .syncing }

    /// All access requests and list operations use the same retained EventKit store.
    func requestRemindersAccess() async -> Bool {
        guard !isSyncing else { return remindersAccessGranted }
        isSyncing = true
        defer { isSyncing = false }
        remindersAccessGranted = await remindersService.requestAccess()
        return remindersAccessGranted
    }

    func loadReminderLists() async throws -> [ReminderListChoice] {
        guard !isSyncing else { throw RemindersError.busy }
        isSyncing = true
        defer { isSyncing = false }
        remindersAccessGranted = await remindersService.requestAccess()
        guard remindersAccessGranted else { throw RemindersError.accessDenied }
        return remindersService.availableLists()
    }

    func chooseReminderList(identifier: String?, newName: String? = nil) async throws {
        guard !isSyncing else { throw RemindersError.busy }
        isSyncing = true
        defer { isSyncing = false }
        remindersAccessGranted = await remindersService.requestAccess()
        guard remindersAccessGranted else { throw RemindersError.accessDenied }
        if let identifier {
            try remindersService.selectList(identifier: identifier)
        } else if let name = newName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            _ = try remindersService.getOrCreateList(name: name, allowCreation: true)
        } else { throw RemindersError.missingList("") }
        // Keep pending completion changes and account scope; they must never be reset here.
    }

    func startPeriodicSync(interval: TimeInterval = 300) {
        stopPeriodicSync()
        timer = Timer.scheduledTimer(withTimeInterval: max(60, interval), repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.syncNow() }
        }
        Task { await syncNow() }
    }
    func stopPeriodicSync() { timer?.invalidate(); timer = nil }
    func togglePause() { isPaused ? resumeSync() : pauseSync() }
    func pauseSync() { isPaused = true; connectionStatus = .paused }
    func resumeSync() { isPaused = false; Task { await syncNow() } }
    func handleNetworkChange(isConnected: Bool) {
        let restored = !online && isConnected
        online = isConnected
        if !isSyncing { connectionStatus = isPaused ? .paused : (!online ? .disconnected : (lastError == nil ? .connected : .error)) }
        if restored && UserDefaults.standard.bool(forKey: "onboardingCompleted") {
            Task { await syncNow() }
        }
    }

    /// Rebuild from durable task markers; never erase pending offline changes.
    func resetMapping() {
        guard !isSyncing else { return }
        taskMap.removeAll()
        state.lastCRMModification.removeAll()
        do { try persist() } catch { lastError = "Nie udało się utrwalić konfiguracji synchronizacji."; return }
        Task { await syncNow() }
    }

    func syncNow() async {
        guard startupAllowed, !isSyncing, !isPaused else { return }
        guard online else {
            hasLoadedPersonalTasks = false
            lastError = "Brak połączenia z internetem. Synchronizacja zostanie ponowiona."
            errorCount = 1; connectionStatus = .disconnected
            return
        }
        isSyncing = true
        connectionStatus = .syncing
        var errors: [String] = []
        defer {
            isSyncing = false
            lastError = errors.isEmpty ? nil : errors.joined(separator: "\n")
            errorCount = errors.count
            connectionStatus = isPaused ? .paused : (!online ? .disconnected : (errors.isEmpty ? .connected : .error))
        }
        remindersAccessGranted = await remindersService.requestAccess()
        if remindersAccessGranted {
            do { try await syncTasks() }
            catch { errors.append("Zadania: " + error.localizedDescription) }
        } else {
            hasLoadedPersonalTasks = false
            errors.append("Brak dostępu do Przypomnień. Zezwól aplikacji na dostęp w ustawieniach prywatności macOS i uruchom ją ponownie. Synchronizacja plików działa niezależnie.")
        }
        // Files remain usable even when Reminders access is not granted.
        do { try await FolderSyncManager.shared.syncAll() }
        catch { errors.append("Pliki: " + error.localizedDescription) }
        if errors.isEmpty {
            do { state.lastSyncDate = Date(); try persist(); lastSyncDate = state.lastSyncDate }
            catch { errors.append("Nie udało się zapisać stanu synchronizacji na dysku.") }
        }
    }

    private func syncTasks() async throws {
        hasLoadedPersonalTasks = false
        let configuration = apiClient.configurationIdentity
        let response = try await apiClient.fetchTasks()
        guard configuration == apiClient.configurationIdentity else { throw CRMAPIError.configurationChanged }
        guard response.success, let employee = response.employee_id, let tasks = response.tasks else {
            throw CRMAPIError.invalidResponse
        }
        let scope = apiClient.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "|" + employee
        if let previous = state.accountScope, previous != scope {
            // Never replay another account's offline queue.
            throw NSError(domain: "MavinciSync", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Zmieniono konto CRM. Przywróć poprzednie konto i dokończ synchronizację przed przeniesieniem konfiguracji."])
        }
        state.accountScope = scope
        syncedEmployeeName = response.employee_name ?? employee
        let base = apiClient.baseURL
        let keepOnlyActive = UserDefaults.standard.object(forKey: "keepOnlyActiveCRMTasks") as? Bool ?? true
        archiveSummary = ""
        let activeList = try remindersService.getOrCreateList()
        let reminders = try await remindersService.reminders(in: activeList)
        var archiveList = try remindersService.archiveList(for: activeList, scope: scope, create: false)
        let archived: [EKReminder]
        if let archiveList { archived = try await remindersService.reminders(in: archiveList) } else { archived = [] }
        guard configuration == apiClient.configurationIdentity else { throw CRMAPIError.configurationChanged }
        let taskIds = Set(tasks.map(\.id))
        let activeIDs = Set(tasks.filter { !$0.isCompleted }.map(\.id))
        var groups: [String: [EKReminder]] = [:]
        for reminder in reminders {
            let id = remindersService.extractCRMTaskId(from: reminder, crmBaseURL: base)
                ?? taskMap.first(where: { $0.value == reminder.calendarItemIdentifier })?.key
            if let id, taskIds.contains(id) { groups[id, default: []].append(reminder) }
        }
        // Prefer a live copy. Reuse an archived copy only when no live copy exists.
        let liveIDs = Set(groups.keys)
        for reminder in archived {
            if let id = remindersService.verifiedCRMTaskID(reminder, baseURL: base), activeIDs.contains(id), !liveIDs.contains(id) {
                groups[id, default: []].append(reminder)
            }
        }
        // Reject duplicate task rows instead of creating multiple reminders in one pass.
        var seen = Set<String>()
        let uniqueTasks = tasks.filter { seen.insert($0.id).inserted }
        var protectedIDs = Set<String>()
        var movedCount = 0
        var restoredCount = 0
        var deferredCount = 0
        var failures: [String] = state.pendingCompletionUpdates.filter { !taskIds.contains($0.taskId) }
            .map { "Oczekująca zmiana zadania \($0.taskId) nie mogła zostać wysłana: zadanie jest poza zakresem „Moje zadania” lub nie jest już przypisane. Zmianę zachowano lokalnie." }
        for task in uniqueTasks {
            guard configuration == apiClient.configurationIdentity else { throw CRMAPIError.configurationChanged }
            do {
                let candidates = (groups[task.id] ?? []).sorted {
                    ($0.creationDate ?? .distantPast, $0.calendarItemIdentifier) <
                    ($1.creationDate ?? .distantPast, $1.calendarItemIdentifier)
                }
                let reminder = candidates.first(where: { $0.calendarItemIdentifier == taskMap[task.id] }) ?? candidates.first
                if let reminder {
                    if reminder.calendar.calendarIdentifier != activeList.calendarIdentifier {
                        // Archived edits are history, not new completion instructions for CRM.
                        guard !state.pendingCompletionUpdates.contains(where: { $0.taskId == task.id }) else {
                            protectedIDs.insert(task.id)
                            failures.append("Zadanie „\(task.title)” w archiwum ma niewysłaną zmianę. Zachowano ją do wyjaśnienia.")
                            continue
                        }
                        try remindersService.movePreservingReminder(reminder, to: activeList, reason: "Ponownie aktywne i przypisane w CRM")
                        state.completionBaseline = (state.completionBaseline ?? [:]).merging([task.id: reminder.isCompleted]) { _, new in new }
                        state.crmRevision?.removeValue(forKey: task.id)
                        restoredCount += 1
                    }
                    taskMap[task.id] = reminder.calendarItemIdentifier
                    // Duplicates are moved, not deleted. Unmarked reminders stay untouched.
                    for duplicate in candidates where duplicate.calendarItemIdentifier != reminder.calendarItemIdentifier && duplicate.calendar.calendarIdentifier == activeList.calendarIdentifier {
                        if remindersService.isExactDuplicate(duplicate, of: reminder),
                           remindersService.verifiedCRMTaskID(duplicate, baseURL: base) == task.id {
                            if archiveList == nil { archiveList = try remindersService.archiveList(for: activeList, scope: scope, create: true) }
                            guard let archiveList else { throw RemindersError.missingList(RemindersService.archiveListName) }
                            try remindersService.movePreservingReminder(duplicate, to: archiveList, reason: "Identyczna kopia zadania")
                            movedCount += 1
                        } else {
                            failures.append("Zadanie „\(task.title)” ma różniące się kopie w Przypomnieniach — zachowano je do sprawdzenia.")
                        }
                    }
                    let baseline = state.completionBaseline?[task.id]
                    if let baseline, reminder.isCompleted != baseline {
                        // Capture local intent BEFORE applying changes from CRM.
                        state.pendingCompletionUpdates.removeAll { $0.taskId == task.id }
                        state.pendingCompletionUpdates.append(PendingCompletionUpdate(
                            taskId: task.id, completed: reminder.isCompleted, timestamp: Date(),
                            expectedUpdatedAt: state.crmRevision?[task.id] ?? task.updated_at))
                        try persist()
                    }
                    if let pending = state.pendingCompletionUpdates.first(where: { $0.taskId == task.id }) {
                        protectedIDs.insert(task.id) // GET may be stale after the POST; do not archive this cycle.
                        // A previous response may have been lost. Matching remote state is an acknowledgement.
                        if task.isCompleted != pending.completed {
                            let result = try await apiClient.pushCompletionUpdates([CompletionUpdate(
                                task_id: task.id, completed: pending.completed,
                                expected_updated_at: pending.expectedUpdatedAt ?? task.updated_at)])
                            guard result.success, let acknowledgement = result.results?.first(where: { $0.task_id == task.id }),
                                  acknowledgement.success else {
                                let message = result.results?.first?.error ?? "Nie potwierdzono zapisu w CRM."
                                failures.append("\(task.title): \(message)")
                                continue // Keep BOTH the local value and the durable pending update.
                            }
                        }
                        state.pendingCompletionUpdates.removeAll { $0.taskId == task.id }
                        state.completionBaseline = (state.completionBaseline ?? [:]).merging([task.id: pending.completed]) { _, new in new }
                        try persist()
                        // Fetch the acknowledged remote revision next cycle; do not overwrite with the old GET.
                        continue
                    }
                    if state.crmRevision?[task.id] != task.updated_at || baseline == nil {
                        remindersService.updateReminder(reminder, from: task, crmBaseURL: base)
                        try remindersService.saveReminder(reminder)
                    }
                } else {
                    // Never import historical closed tasks just to move them into the archive.
                    if keepOnlyActive && task.isCompleted { continue }
                    // Do not create a second local copy while an offline update awaits reconciliation.
                    guard !state.pendingCompletionUpdates.contains(where: { $0.taskId == task.id }) else {
                        failures.append("Brak lokalnego przypomnienia dla oczekującej zmiany: \(task.title)")
                        continue
                    }
                    let newReminder = try remindersService.createReminder(from: task, crmBaseURL: base)
                    try remindersService.saveReminder(newReminder)
                    taskMap[task.id] = newReminder.calendarItemIdentifier
                }
                state.completionBaseline = (state.completionBaseline ?? [:]).merging([task.id: task.isCompleted]) { _, new in new }
                state.crmRevision = (state.crmRevision ?? [:]).merging([task.id: task.updated_at]) { _, new in new }
                try persist() // Save after each commit, not only after the entire batch.
            } catch { protectedIDs.insert(task.id); failures.append("\(task.title): \(error.localizedDescription)") }
        }
        // The user opted for an active-only list. A complete, validated personal response
        // can authorize a reversible move, but never deletion or a completion POST.
        if keepOnlyActive {
            let pendingIDs = Set(state.pendingCompletionUpdates.map(\.taskId))
            for reminder in reminders where reminder.calendar.calendarIdentifier == activeList.calendarIdentifier {
                guard configuration == apiClient.configurationIdentity else { throw CRMAPIError.configurationChanged }
                guard let id = remindersService.verifiedCRMTaskID(reminder, baseURL: base), !activeIDs.contains(id) else { continue }
                let baseline = state.completionBaseline?[id]
                let locallyChanged = baseline.map { $0 != reminder.isCompleted } ?? false
                guard !protectedIDs.contains(id), !pendingIDs.contains(id), !locallyChanged else { deferredCount += 1; continue }
                do {
                    if archiveList == nil { archiveList = try remindersService.archiveList(for: activeList, scope: scope, create: true) }
                    guard let archiveList else { throw RemindersError.missingList(RemindersService.archiveListName) }
                    try remindersService.movePreservingReminder(reminder, to: archiveList, reason: "Zakończone lub poza bieżącym zakresem Moje zadania")
                    taskMap[id] = reminder.calendarItemIdentifier // Reuse this exact copy if the task becomes active again.
                    try persist()
                    movedCount += 1
                } catch { failures.append("Archiwizacja „\(reminder.title ?? "zadanie")”: \(error.localizedDescription)") }
            }
        }
        archiveSummary = "Do archiwum: \(movedCount). Przywrócono: \(restoredCount)."
        if deferredCount > 0 { archiveSummary += " Pozostawiono \(deferredCount) z niewysłanymi zmianami lub błędem." }
        activeRemindersCount = uniqueTasks.filter { !$0.isCompleted }.count
        hasLoadedPersonalTasks = true
        if !failures.isEmpty {
            throw NSError(domain: "MavinciSync", code: 2, userInfo: [NSLocalizedDescriptionKey: failures.prefix(10).joined(separator: "\n")])
        }
    }

    private func persist() throws {
        try state.saveOrThrow()
        try FileManager.default.createDirectory(at: Self.mapURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(taskMap).write(to: Self.mapURL, options: .atomic)
    }
}
