import Foundation
import SwiftUI

/// Kopia lejka zapytań na dysku: zapytania, uprawnienia i skróty koszyków synchronizacji (`src/lib/native/sync.ts`).
struct InquiryIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [Inquiry] = []
    var access: InquiryAccess?
    var syncedAt: Date?
}

/// Lejek zapytań z kopii na dysku: widok czyta lokalne dane od razu, synchronizacja pobiera tylko zmienione koszyki.
/// Czynności (etap, przejęcie, kontakt, odłożenie, edycja, usunięcie) idą przez `/bridge/native/v1/inquiries` — RLS jak w CRM.
@MainActor final class InquiriesStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var inquiries: [Inquiry] = []
    @Published private(set) var access: InquiryAccess?
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    @Published var busy: Set<String> = []
    @Published var employees: [MeetingPerson] = []

    private var namespace: String?
    private var file: SealedFile<InquiryIndex>?
    private var index = InquiryIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    func inquiry(_ id: String?) -> Inquiry? { id.flatMap { id in inquiries.first { $0.id == id } } }
    func canManage(_ inquiry: Inquiry) -> Bool { access?.canManage(inquiry) ?? false }
    func canClaim(_ inquiry: Inquiry) -> Bool { (access?.canClaim ?? false) && inquiry.ownerId == nil }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<InquiryIndex>(namespace: "inquiries-\(next)")
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
        file = nil; namespace = nil; index = InquiryIndex(); recentLocal = [:]
        inquiries = []; access = nil; syncing = false; lastSync = nil; loadError = nil; busy = []; employees = []
    }
    private func publish() { inquiries = index.items.sorted { $0.createdAt > $1.createdAt } }
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
    private func mutate(_ id: String, _ change: (inout Inquiry) -> Void) {
        guard let i = index.items.firstIndex(where: { $0.id == id }) else { return }
        change(&index.items[i])
        recentLocal[id] = Date()
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
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let access: InquiryAccess? }
        struct Bucket: Decodable { let hash: String; let items: [Inquiry] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/inquiries", query: ["op": "state", "hash": index.hash]))
            if let next = state.access { index.access = next; access = next }
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [Inquiry] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/inquiries", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                let local = Dictionary(index.items.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
                var byID: [String: Inquiry] = [:]
                if !replaceAll {
                    for item in index.items {
                        let bucket = mailBucket(item.id, width: state.width)
                        if !changed.contains(bucket) && !vanished.contains(bucket) { byID[item.id] = item }
                    }
                }
                var dirty = Set<String>()
                for item in fetched {
                    if recentLocal[item.id] != nil, let mine = local[item.id] {
                        byID[item.id] = mine; dirty.insert(mailBucket(item.id, width: state.width)); continue
                    }
                    byID[item.id] = item
                }
                index.items = Array(byID.values)
                index.buckets = server
                for bucket in dirty { index.buckets[bucket] = "" }
                index.width = state.width
                index.hash = dirty.isEmpty ? state.hash : ""
                publish()
            }
            index.syncedAt = Date(); lastSync = index.syncedAt; loadError = nil
            scheduleSave()
        } catch {
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać zapytań.") }
        }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    private func report(_ error: Error, _ fallback: String) { workspace?.error = failureText(error, fallback) }
    private func post(_ op: String, _ inquiry: Inquiry, _ extra: [String: JSONValue] = [:]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var body = extra
        body["op"] = .string(op); body["id"] = .string(inquiry.id)
        let data = try await api.post("/inquiries", body)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }

    /// Przeciągnięcie do innego etapu (bez „Przegrane” — to wymaga powodu w formularzu).
    func move(_ inquiry: Inquiry, to stage: InquiryStage) async {
        guard inquiry.inquiryStage != stage, stage != .lost else { return }
        guard canManage(inquiry) else { workspace?.error = "Najpierw przejmij zapytanie lub poproś menedżera o przypisanie"; return }
        let previous = inquiry
        mutate(inquiry.id) { $0.stage = stage.rawValue; $0.probability = stage.defaultProbability; $0.lostReason = ""; $0.lostReasonCategory = "" }
        busy.insert(inquiry.id)
        defer { busy.remove(inquiry.id) }
        do {
            _ = try await post("move", inquiry, ["stage": .string(stage.rawValue)])
            workspace?.succeed("Przeniesiono do etapu „\(stage.label)”")
        } catch {
            mutate(inquiry.id) { $0 = previous }
            report(error, "Nie udało się przenieść zapytania.")
        }
    }

    func claim(_ inquiry: Inquiry) async -> Bool {
        var ok = false
        await workspace?.withPending("Przejmowanie zapytania…") {
            do {
                _ = try await post("claim", inquiry)
                await sync(force: true)
                workspace?.succeed("Zapytanie zostało przypisane do Ciebie")
                ok = true
            } catch {
                report(error, "Nie udało się przejąć zapytania.")
                await sync(force: true)
            }
        }
        return ok
    }

    func completeContact(_ inquiry: Inquiry, next: Date?) async -> Bool {
        var ok = false
        await workspace?.withPending("Zapisywanie kontaktu…") {
            do {
                _ = try await post("contact", inquiry, ["nextActionAt": next.map { JSONValue.string(MeetingDates.iso($0)) } ?? JSONValue.null])
                await sync(force: true)
                workspace?.succeed(next == nil ? "Kontakt został zapisany. Ustaw termin kolejnego działania, jeśli jest potrzebny."
                                   : "Kontakt zapisany, kolejne działanie: \(InquiryFormat.short(next!))")
                ok = true
            } catch { report(error, "Nie udało się potwierdzić kontaktu.") }
        }
        return ok
    }

    func snooze(_ inquiry: Inquiry) async {
        await workspace?.withPending("Odkładanie przypomnienia…") {
            do {
                _ = try await post("snooze", inquiry, ["minutes": .number(60)])
                await sync(force: true)
                workspace?.succeed("Następne działanie ustawiono za godzinę")
            } catch { report(error, "Nie udało się odłożyć przypomnienia.") }
        }
    }

    /// Edycja z formularza „Obsługa zapytania” (jak w CRM).
    func update(_ inquiry: Inquiry, data: [String: JSONValue]) async throws {
        _ = try await post("update", inquiry, ["data": .object(data)])
        await sync(force: true)
    }

    /// Baza sprawdza powiązania: „deleted” (trwałe usunięcie) albo „archived” (z powodem).
    func removalMode(_ inquiry: Inquiry) async -> String? {
        var mode: String?
        await workspace?.withPending("Sprawdzanie powiązań zapytania…") {
            do { mode = try await post("remove", inquiry)["mode"]?.text.nonEmpty }
            catch { report(error, "Nie udało się sprawdzić powiązań zapytania.") }
        }
        return mode
    }
    func remove(_ inquiry: Inquiry, mode: String, reason: String) async -> Bool {
        var ok = false
        await workspace?.withPending(mode == "deleted" ? "Usuwanie zapytania…" : "Archiwizowanie zapytania…") {
            do {
                _ = try await post("remove", inquiry, ["mode": .string(mode), "reason": .string(reason)])
                index.items.removeAll { $0.id == inquiry.id }
                publish(); scheduleSave()
                workspace?.succeed(mode == "deleted" ? "Zapytanie usunięte trwale" : "Zapytanie zarchiwizowane")
                ok = true
                Task { await sync(force: true) }
            } catch { report(error, "Nie udało się usunąć zapytania.") }
        }
        return ok
    }

    func loadEmployees() async {
        guard employees.isEmpty, let api else { return }
        struct Reply: Decodable { let employees: [MeetingPerson] }
        if let data = try? await api.get("/inquiries", query: ["op": "employees"]), let reply = try? JSONDecoder().decode(Reply.self, from: data) {
            employees = reply.employees
        }
    }
}
