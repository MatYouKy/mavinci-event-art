import Foundation
import SwiftUI

/// Kopia listy zespołu na dysku: pracownicy, uprawnienia i skróty koszyków synchronizacji (`src/lib/native/sync.ts`).
struct TeamIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [TeamMember] = []
    var access: TeamAccess?
    var syncedAt: Date?
}

/// Zespół z kopii na dysku: lista od razu, synchronizacja pobiera tylko zmienione koszyki. Karta pracownika (wydarzenia,
/// konta e-mail, nieobecności, plan) jest pobierana przy otwarciu. Zapisy przez `/bridge/native/v1/employees` — RLS jak w CRM.
@MainActor final class TeamStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var members: [TeamMember] = []
    @Published private(set) var access: TeamAccess?
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    /// Otwarta karta pracownika (`/crm/employees/<id>`); `nil` — lista.
    @Published var openedID: String?
    @Published var openedTab: EmployeeTab?
    /// Dzień planu otwierany z osi czasu zespołu (jak `?date=` w CRM).
    @Published var openedDate: Date?
    @Published private(set) var details: [String: EmployeeDetail] = [:]
    @Published var detailError: String?

    private var namespace: String?
    private var file: SealedFile<TeamIndex>?
    private var index = TeamIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    var me: String? { access?.employeeId ?? workspace?.employee?.id }
    func member(_ id: String?) -> TeamMember? { id.flatMap { id in members.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<TeamIndex>(namespace: "team-\(next)")
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
        file = nil; namespace = nil; index = TeamIndex(); recentLocal = [:]
        members = []; access = nil; syncing = false; lastSync = nil; loadError = nil; openedID = nil; openedTab = nil; openedDate = nil
        details = [:]; detailError = nil
    }
    /// Kolejność jak `getEmployees`: order_index rosnąco, potem od najnowszych.
    private func publish() {
        members = index.items.sorted { a, b in
            if a.orderIndex != b.orderIndex { return a.orderIndex < b.orderIndex }
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
    private func mutate(_ id: String, _ change: (inout TeamMember) -> Void) {
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
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let access: TeamAccess? }
        struct Bucket: Decodable { let hash: String; let items: [TeamMember] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/employees", query: ["op": "state", "hash": index.hash]))
            if let next = state.access { index.access = next; access = next }
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [TeamMember] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/employees", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                let local = Dictionary(index.items.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
                var byID: [String: TeamMember] = [:]
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
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać pracowników.") }
        }
    }

    // MARK: Karta pracownika
    func loadDetail(_ id: String) async {
        guard let api else { return }
        do {
            let detail = try JSONDecoder().decode(EmployeeDetail.self, from: try await api.get("/employees", query: ["op": "detail", "id": id]))
            details[id] = detail; detailError = nil
        } catch {
            if details[id] == nil { detailError = failureText(error, "Nie udało się pobrać danych pracownika.") }
        }
    }

    /// Plan pracowników (`get_employee_schedule`) w zakresie [from, to).
    func schedule(_ ids: [String], from: Date, to: Date) async throws -> [TeamScheduleEntry] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let items: [TeamScheduleRow]; let legacy: Bool? }
        let iso = ISO8601DateFormatter()
        let data = try await api.get("/employees", query: ["op": "schedule", "ids": ids.joined(separator: ","), "from": iso.string(from: from), "to": iso.string(from: to)])
        return try JSONDecoder().decode(Reply.self, from: data).items.compactMap(\.entry)
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    @discardableResult private func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        let data = try await api.post("/employees", payload)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }

    /// Zapis karty „Przegląd” (błędy pól w `NativeFailure.fieldErrors`).
    func update(_ member: TeamMember, data: [String: JSONValue], local: (inout TeamMember) -> Void) async throws {
        try await post("update", ["id": .string(member.id), "data": .object(data)])
        mutate(member.id, local)
        Task { await sync(force: true) }
    }

    func delete(_ member: TeamMember) async -> Bool {
        var ok = false
        await workspace?.withPending("Usuwanie pracownika… Trwa usuwanie konta i porządkowanie powiązań.") {
            do {
                try await post("delete", ["id": .string(member.id)])
                index.items.removeAll { $0.id == member.id }
                publish(); scheduleSave()
                if openedID == member.id { openedID = nil }
                workspace?.succeed("Pracownik został usunięty.")
                ok = true
                Task { await sync(force: true) }
            } catch {
                workspace?.error = failureText(error, "Nie udało się trwale usunąć pracownika.")
            }
        }
        return ok
    }

    func resetPassword(_ member: TeamMember, password: String) async throws {
        try await post("resetPassword", ["id": .string(member.id), "password": .string(password)])
        workspace?.succeed("Hasło dla \(member.name) zostało zmienione pomyślnie")
    }

    func create(_ data: [String: JSONValue]) async throws {
        try await post("create", ["data": .object(data)])
        await sync(force: true)
    }

    func createOptions() async throws -> (levels: [TeamOption], companies: [TeamOption]) {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let accessLevels: [TeamOption]; let companies: [TeamOption] }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/employees", query: ["op": "createOptions"]))
        return (reply.accessLevels, reply.companies)
    }

    func addAbsence(employeeId: String, type: String, start: Date, end: Date, allDay: Bool, notes: String) async throws {
        try await post("absence", ["employeeId": .string(employeeId), "type": .string(type), "start": .string(MeetingDates.iso(start)),
                                   "end": .string(MeetingDates.iso(end)), "allDay": .bool(allDay), "notes": .string(notes)])
        workspace?.succeed("Wniosek o nieobecność został złożony")
        await loadDetail(employeeId)
    }
    func decideAbsence(_ absence: EmployeeAbsence, employeeId: String, approve: Bool, note: String) async throws {
        try await post("absenceDecision", ["id": .string(absence.id), "decision": .string(approve ? "approve" : "reject"), "note": .string(note)])
        workspace?.succeed(approve ? "Nieobecność zatwierdzona" : "Nieobecność odrzucona")
        await loadDetail(employeeId)
    }
    func deleteAbsence(_ absence: EmployeeAbsence, employeeId: String) async {
        await workspace?.withPending("Usuwanie nieobecności…") {
            do {
                try await post("absenceDelete", ["id": .string(absence.id)])
                workspace?.succeed("Nieobecność usunięta")
                await loadDetail(employeeId)
            } catch { workspace?.error = failureText(error, "Błąd podczas usuwania") }
        }
    }
}

extension Workspace {
    /// Karta pracownika na ekranie Zespołu (`/crm/employees/<id>`, opcjonalnie na wybranej zakładce).
    func showEmployee(_ id: String, tab: EmployeeTab? = nil) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/employees" }) {
            openHref("/crm/employees")
            team.openedTab = tab
            team.openedDate = nil
            team.openedID = id
            if team.member(id) == nil { Task { await team.sync(force: true) } }
        } else {
            openCRM("/crm/employees/\(id)")
        }
    }
}
