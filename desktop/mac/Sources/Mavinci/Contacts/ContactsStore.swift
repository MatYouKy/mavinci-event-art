import Foundation
import SwiftUI

/// Kopia kontaktów na dysku: lista, uprawnienia i skróty koszyków synchronizacji (`src/lib/native/sync.ts`).
struct ContactIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [ContactEntry] = []
    var access: ContactAccess?
    var syncedAt: Date?
}

/// Kontakty z kopii na dysku: widok czyta lokalne dane od razu, synchronizacja pobiera tylko zmienione koszyki.
/// Edycja i usuwanie idą przez `/bridge/native/v1/contacts` — RLS i walidacja jak w CRM.
@MainActor final class ContactsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var contacts: [ContactEntry] = []
    @Published private(set) var access: ContactAccess?
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    /// Kontakt wskazany z innej sekcji (np. spotkanie, zapytanie) — widok zaznacza go i otwiera szczegóły.
    @Published var focusID: String?

    private var namespace: String?
    private var file: SealedFile<ContactIndex>?
    private var index = ContactIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    var canManage: Bool { access?.canManage ?? false }
    func entry(_ id: String?) -> ContactEntry? { id.flatMap { id in contacts.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<ContactIndex>(namespace: "contacts-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved {
                index = saved
                access = saved.access
                lastSync = saved.syncedAt
                publish()
            }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = ContactIndex(); recentLocal = [:]
        contacts = []; access = nil; syncing = false; lastSync = nil; loadError = nil; focusID = nil
    }
    /// Kolejność jak na stronie: organizacje, potem kontakty — w obu grupach od najnowszych.
    private func publish() {
        contacts = index.items.sorted { a, b in
            if a.isOrganization != b.isOrganization { return a.isOrganization }
            return (a.createdAt ?? "") > (b.createdAt ?? "")
        }
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
    /// Zmiana lokalna od razu w widoku; synchronizacja nie cofa jej przez 20 s, zanim serwer jej nie potwierdzi.
    private func mutate(_ key: String, _ change: (inout ContactEntry) -> Void) {
        guard let i = index.items.firstIndex(where: { $0.key == key }) else { return }
        change(&index.items[i])
        recentLocal[key] = Date()
        publish(); scheduleSave()
    }

    // MARK: Synchronizacja
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
    private func performSync() async {
        guard let api, file != nil else { return }
        syncing = true
        defer { syncing = false }
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let access: ContactAccess? }
        struct Bucket: Decodable { let hash: String; let items: [ContactEntry] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/contacts", query: ["op": "state", "hash": index.hash]))
            if let next = state.access { index.access = next; access = next }
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [ContactEntry] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/contacts", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                let local = Dictionary(index.items.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
                var byKey: [String: ContactEntry] = [:]
                if !replaceAll {
                    for item in index.items {
                        let bucket = mailBucket(item.key, width: state.width)
                        if !changed.contains(bucket) && !vanished.contains(bucket) { byKey[item.key] = item }
                    }
                }
                var dirty = Set<String>()
                for item in fetched {
                    if recentLocal[item.key] != nil, let mine = local[item.key] {
                        byKey[item.key] = mine; dirty.insert(mailBucket(item.key, width: state.width)); continue
                    }
                    byKey[item.key] = item
                }
                index.items = Array(byKey.values)
                index.buckets = server
                for bucket in dirty { index.buckets[bucket] = "" }
                index.width = state.width
                index.hash = dirty.isEmpty ? state.hash : ""
                publish()
            }
            index.syncedAt = Date(); lastSync = index.syncedAt; loadError = nil
            scheduleSave()
        } catch {
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać kontaktów.") }
        }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    /// Zapis formularza (kontakt: pola karty „Dane kontaktowe”; organizacja: walidacja jak w CRM).
    /// Błędy pól wracają w `NativeFailure.fieldErrors`.
    func update(_ entry: ContactEntry, data: [String: JSONValue], local: (inout ContactEntry) -> Void) async throws {
        guard let api else { throw AppError.configuration }
        _ = try await api.post("/contacts", ["op": .string("update"), "kind": .string(entry.kind), "id": .string(entry.id), "data": .object(data)])
        mutate(entry.key, local)
        Task { await sync(force: true) }
    }

    func delete(_ entry: ContactEntry) async -> Bool {
        var ok = false
        await workspace?.withPending(entry.isOrganization ? "Usuwanie organizacji…" : "Usuwanie kontaktu…") {
            do {
                guard let api else { throw AppError.configuration }
                _ = try await api.post("/contacts", ["op": .string("delete"), "kind": .string(entry.kind), "id": .string(entry.id)])
                index.items.removeAll { $0.key == entry.key }
                publish(); scheduleSave()
                workspace?.succeed(entry.isOrganization ? "Organizacja usunięta" : "Kontakt usunięty")
                ok = true
                Task { await sync(force: true) }
            } catch {
                workspace?.error = failureText(error, "Błąd podczas usuwania")
            }
        }
        return ok
    }
}

extension Workspace {
    /// Kontakt na ekranie Kontaktów (spotkanie, zapytanie, `/crm/contacts/<id>`); bez dostępu — komunikat.
    func showContact(_ id: String) {
        guard employee?.canView(.contacts) == true else { notice = "Nie masz dostępu do kontaktów."; return }
        switchSection(.contacts)
        contacts.focusID = id
        if contacts.entry(id) == nil { Task { await contacts.sync(force: true) } }
    }
    /// Zapytanie w lejku (z karty kontaktu).
    func showInquiry(_ id: String) {
        guard employee?.canView(.inquiries) == true else { notice = "Nie masz dostępu do zapytań."; return }
        switchSection(.inquiries)
        focusedID = id; focusToken = UUID()
    }
}
