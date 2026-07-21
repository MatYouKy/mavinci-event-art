import Foundation

// MARK: - Sync State

/// Tracks the synchronization state between the CRM backend and local Reminders.
struct SyncState: Codable {
    /// The last time a successful sync was performed.
    var lastSyncDate: Date?

    /// Tracks the last known modification date per CRM task ID.
    var lastCRMModification: [String: Date]

    /// Tracks the last known modification date per local Reminder identifier.
    var lastReminderModification: [String: Date]

    /// Records whether the last change for a given task originated from "crm" or "local".
    var lastChangeSource: [String: ChangeSource]

    /// Completion updates that haven't been pushed to the CRM yet.
    var pendingCompletionUpdates: [PendingCompletionUpdate]

    init(
        lastSyncDate: Date? = nil,
        lastCRMModification: [String: Date] = [:],
        lastReminderModification: [String: Date] = [:],
        lastChangeSource: [String: ChangeSource] = [:],
        pendingCompletionUpdates: [PendingCompletionUpdate] = []
    ) {
        self.lastSyncDate = lastSyncDate
        self.lastCRMModification = lastCRMModification
        self.lastReminderModification = lastReminderModification
        self.lastChangeSource = lastChangeSource
        self.pendingCompletionUpdates = pendingCompletionUpdates
    }
}

// MARK: - Change Source

enum ChangeSource: String, Codable {
    case crm
    case local
}

// MARK: - Pending Completion Update

struct PendingCompletionUpdate: Codable, Equatable {
    let taskId: String
    let completed: Bool
    let timestamp: Date
}

// MARK: - Persistence Helpers

extension SyncState {
    private static let stateFileURL: URL = {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appDirectory = appSupport.appendingPathComponent("MavinciReminders", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDirectory, withIntermediateDirectories: true)
        return appDirectory.appendingPathComponent("sync_state.json")
    }()

    /// Load the persisted sync state from disk, or return a fresh default state.
    static func load() -> SyncState {
        guard FileManager.default.fileExists(atPath: stateFileURL.path) else {
            return SyncState()
        }
        do {
            let data = try Data(contentsOf: stateFileURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(SyncState.self, from: data)
        } catch {
            print("[SyncState] Failed to load state: \(error.localizedDescription)")
            return SyncState()
        }
    }

    /// Persist the current sync state to disk.
    func save() {
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(self)
            try data.write(to: Self.stateFileURL, options: .atomic)
        } catch {
            print("[SyncState] Failed to save state: \(error.localizedDescription)")
        }
    }
}
