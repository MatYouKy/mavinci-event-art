import Foundation
import SwiftUI

/// Kopia listy wydarzeń na dysku: pozycje ze skrótami koszyków, kategorie, uprawnienia i tryb etapów operacyjnych.
struct EventsIndex: Codable {
    var list = SyncedSet<EventListItem>()
    var access: EventsAccess?
    var categories: [EventCategoryOption] = []
    var operational = false
    var syncedAt: Date?
}

/// Wydarzenia z kopii na dysku (`events-…`, AES-GCM): lista od razu, synchronizacja pobiera tylko zmienione koszyki.
/// Zapisy (status, usuwanie) przez `/bridge/native/v1/events` — RLS jak w CRM.
@MainActor final class EventsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var events: [EventListItem] = []
    @Published private(set) var access: EventsAccess?
    @Published private(set) var categories: [EventCategoryOption] = []
    @Published private(set) var operational = false
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?

    private var namespace: String?
    private var file: SealedFile<EventsIndex>?
    private var index = EventsIndex()
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.list.items.isEmpty) }
    var canManage: Bool { access?.canManage ?? false }
    func event(_ id: String?) -> EventListItem? { id.flatMap { id in events.first { $0.id == id } } }

    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<EventsIndex>(namespace: "events-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved { index = saved; publish(); lastSync = saved.syncedAt }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = EventsIndex()
        events = []; access = nil; categories = []; operational = false; syncing = false; lastSync = nil; loadError = nil
    }
    private func publish() {
        events = index.list.items
        access = index.access; categories = index.categories; operational = index.operational
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, let file = self.file else { return }
            let snapshot = self.index
            await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
        }
    }

    func sync(force: Bool = false) async {
        if let syncTask { await syncTask.value; if !force { return } }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }
    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        guard file != nil else { return }
        await sync()
    }
    private func fetchItems(_ buckets: [String]) async throws -> [EventListItem] {
        guard let api else { throw AppError.configuration }
        var fetched: [EventListItem] = []
        var pending = buckets
        while !pending.isEmpty {
            let data = try await api.post("/events", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
            let reply = try JSONDecoder().decode(WarehouseItemsReply<EventListItem>.self, from: data)
            for bucket in reply.buckets.values { fetched += bucket.items }
            pending = reply.more
        }
        return fetched
    }
    private func performSync() async {
        guard let api, file != nil else { return }
        syncing = true
        defer { syncing = false }
        struct State: Decodable {
            let hash: String; let width: Int; let buckets: [String: String]?
            let access: EventsAccess?; let categories: [EventCategoryOption]?; let operational: Bool?
        }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/events", query: ["op": "state", "hash": index.list.hash]))
            if let next = state.access { index.access = next }
            if let next = state.categories { index.categories = next }
            if let next = state.operational { index.operational = next }
            let current = index.list
            if let next = try await current.merged(with: SyncedSetState(hash: state.hash, width: state.width, buckets: state.buckets),
                                                   fetch: { try await self.fetchItems($0) }) { index.list = next }
            publish()
            index.syncedAt = Date(); lastSync = index.syncedAt; loadError = nil
            scheduleSave()
        } catch {
            if index.list.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać wydarzeń.") }
        }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    /// Czynność z paskiem postępu i komunikatem; po sukcesie odświeża listę.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String) async -> Bool {
        guard let api else { return false }
        var ok = false
        await workspace?.withPending(pending) {
            do {
                var payload = body
                payload["op"] = .string(op)
                _ = try await api.post("/events", payload)
                workspace?.succeed(success)
                ok = true
            } catch { workspace?.error = failureText(error, "Nie udało się wykonać czynności.") }
        }
        if ok { await sync(force: true) }
        return ok
    }
    func changeStatus(_ item: EventListItem, to status: String) async -> Bool {
        await run("Zapisywanie…", "status", ["id": .string(item.id), "status": .string(status)], success: "Status wydarzenia został zmieniony")
    }
    func delete(_ item: EventListItem) async -> Bool {
        let ok = await run("Usuwanie…", "delete", ["id": .string(item.id)], success: "Event został usunięty")
        if ok { index.list.remove(item.id); publish(); scheduleSave() }
        return ok
    }
}
