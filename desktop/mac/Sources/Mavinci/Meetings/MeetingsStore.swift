import Foundation
import SwiftUI

/// Stan kopii Spotkań na dysku: wszystkie widoczne spotkania i skróty koszyków synchronizacji (`src/lib/native/sync.ts`).
struct MeetingIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [Meeting] = []
    var employeeId: String?
    var canManage = false
    var syncedAt: Date?
}

/// Spotkania z kopii na dysku: oś czasu pokazuje dane od razu, synchronizacja w tle pobiera tylko zmienione koszyki.
/// Zmiany (przeniesienie, odpowiedź, status) widać natychmiast, a serwer je potwierdza (`/bridge/native/v1/meetings`).
@MainActor final class MeetingsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var meetings: [Meeting] = []
    @Published private(set) var employeeId: String?
    @Published private(set) var canManage = false
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    @Published var saving: Set<String> = []
    @Published var employees: [MeetingPerson] = []
    /// Dni ustawowo wolne (RRRR-MM-DD → nazwa) do nagłówka osi czasu; pobierane całymi latami.
    @Published private(set) var holidays: [String: String] = [:]
    /// Spotkanie do pokazania po otwarciu ekranu (powiadomienie, „Mój plan”).
    @Published var focusID: String?
    private var holidayYears: Set<Int> = []

    private var namespace: String?
    private var file: SealedFile<MeetingIndex>?
    private var index = MeetingIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    func meeting(_ id: String?) -> Meeting? { id.flatMap { id in meetings.first { $0.id == id } } }

    /// Edycja jak w `save_meeting`: uczestnik spotkania i (autor albo zarządzanie kalendarzem).
    func canEdit(_ meeting: Meeting) -> Bool {
        guard let me = employeeId, meeting.isParticipant(me) else { return false }
        return meeting.createdBy == me || canManage
    }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<MeetingIndex>(namespace: "meetings-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved {
                index = saved
                employeeId = saved.employeeId
                canManage = saved.canManage
                lastSync = saved.syncedAt
                meetings = saved.items.sorted { $0.start < $1.start }
            }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = MeetingIndex(); recentLocal = [:]
        meetings = []; employeeId = nil; canManage = false; syncing = false; lastSync = nil; loadError = nil; saving = []; employees = []
        holidays = [:]; holidayYears = []; focusID = nil
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
    private func publish() { meetings = index.items.sorted { $0.start < $1.start } }
    /// Zmiana lokalna (od razu w widoku i na dysku); synchronizacja nie cofa jej, zanim serwer jej nie potwierdzi.
    private func mutate(_ id: String, _ change: (inout Meeting) -> Void) {
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
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let employeeId: String?; let canManage: Bool? }
        struct Bucket: Decodable { let hash: String; let items: [Meeting] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/meetings", query: ["op": "state", "hash": index.hash]))
            index.employeeId = state.employeeId; employeeId = state.employeeId
            index.canManage = state.canManage ?? false; canManage = index.canManage
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [Meeting] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/meetings", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                var byID: [String: Meeting] = [:]
                if !replaceAll {
                    for item in index.items {
                        let bucket = mailBucket(item.id, width: state.width)
                        if !changed.contains(bucket) && !vanished.contains(bucket) { byID[item.id] = item }
                    }
                }
                var dirty = Set<String>()
                let local = Dictionary(index.items.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
                for item in fetched {
                    if recentLocal[item.id] != nil, let mine = local[item.id] {
                        byID[item.id] = mine; dirty.insert(mailBucket(item.id, width: state.width)); continue
                    }
                    byID[item.id] = item
                }
                for (id, item) in local where recentLocal[id] != nil && byID[id] == nil && !replaceAll {
                    // Zmienione lokalnie, a koszyk jeszcze nie wrócił — zostaw do potwierdzenia.
                    if !vanished.contains(mailBucket(id, width: state.width)) { byID[id] = item }
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
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać spotkań.") }
        }
    }

    // MARK: Czynności
    private func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    private func report(_ error: Error, _ fallback: String) { workspace?.error = failureText(error, fallback) }

    private func save(_ meeting: Meeting, patch: [String: JSONValue]) async throws {
        guard let api else { throw AppError.configuration }
        _ = try await api.post("/meetings", [
            "op": .string("save"), "id": .string(meeting.id), "data": .object(patch),
            "participants": .array(meeting.participantPayload),
            "recurrenceDays": .number(Double(meeting.seriesId == nil ? 0 : meeting.recurrenceDays)), "scope": .string("single"),
        ])
    }

    /// Przeciągnięcie albo zmiana długości na osi czasu — tylko ten termin (także w cyklu).
    func move(_ meeting: Meeting, start: Date, end: Date) async {
        let before = (meeting.start, meeting.end)
        let others = meeting.participants.contains { $0.employeeId != nil && $0.employeeId != meeting.createdBy }
        mutate(meeting.id) { $0.start = MeetingDates.iso(start); $0.end = MeetingDates.iso(end) }
        saving.insert(meeting.id)
        defer { saving.remove(meeting.id) }
        do {
            try await save(meeting, patch: ["datetime_start": .string(MeetingDates.iso(start)), "datetime_end": .string(MeetingDates.iso(end))])
            if others {
                // Nowy termin: uczestnicy odpowiadają ponownie (jak w CRM).
                mutate(meeting.id) { m in
                    for i in m.participants.indices where m.participants[i].employeeId != nil && m.participants[i].employeeId != m.createdBy {
                        m.participants[i].response = MeetingResponse.pending.rawValue
                    }
                }
            }
            workspace?.succeed("Nowy termin: \(MeetingDates.format(start, "EEE d MMM")), \(MeetingDates.time(start))–\(MeetingDates.time(end))"
                + (meeting.seriesId != nil ? " (tylko ten termin cyklu)" : "") + (others ? ". Uczestnicy potwierdzą go ponownie." : ""))
            Task { await sync(force: true) }
        } catch {
            mutate(meeting.id) { $0.start = before.0; $0.end = before.1 }
            report(error, "Nie udało się zmienić terminu spotkania.")
        }
    }

    func respond(_ meeting: Meeting, _ response: MeetingResponse) async {
        guard let api, let me = employeeId else { return }
        await workspace?.withPending("Zapisywanie odpowiedzi…") {
            do {
                _ = try await api.post("/meetings", ["op": .string("respond"), "id": .string(meeting.id), "response": .string(response.rawValue)])
                mutate(meeting.id) { m in
                    for i in m.participants.indices where m.participants[i].employeeId == me {
                        m.participants[i].response = response.rawValue
                        m.participants[i].respondedAt = MeetingDates.iso(Date())
                    }
                }
                workspace?.succeed("Twoja odpowiedź: \(response.action)")
            } catch { report(error, "Nie udało się zapisać odpowiedzi.") }
        }
    }

    func setStatus(_ meeting: Meeting, _ status: MeetingStatus) async {
        await workspace?.withPending(status == .cancelled ? "Odwoływanie spotkania…" : "Zmiana statusu…") {
            do {
                try await save(meeting, patch: ["status": .string(status.rawValue)])
                mutate(meeting.id) { $0.status = status.rawValue }
                workspace?.succeed("Status spotkania: \(status.label)")
            } catch { report(error, "Nie udało się zmienić statusu spotkania.") }
        }
    }

    func delete(_ meeting: Meeting, scope: String = "single") async {
        guard let api else { return }
        await workspace?.withPending("Usuwanie spotkania…") {
            do {
                _ = try await api.post("/meetings", ["op": .string("delete"), "id": .string(meeting.id), "scope": .string(scope)])
                index.items.removeAll { $0.id == meeting.id || (scope == "future" && $0.seriesId != nil && $0.seriesId == meeting.seriesId && $0.start >= meeting.start) }
                publish(); scheduleSave()
                workspace?.succeed(scope == "future" ? "Usunięto to i kolejne spotkania cyklu" : "Spotkanie zostało usunięte")
                Task { await sync(force: true) }
            } catch { report(error, "Nie udało się usunąć spotkania.") }
        }
    }

    /// Nowe spotkanie albo edycja (formularz) — `save_meeting` z pełną listą uczestników.
    func save(id: String?, data: [String: JSONValue], participants: [JSONValue], recurrenceDays: Int, scope: String) async throws -> String? {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = [
            "op": .string("save"), "data": .object(data), "participants": .array(participants),
            "recurrenceDays": .number(Double(recurrenceDays)), "scope": .string(scope),
        ]
        if let id { body["id"] = .string(id) }
        let data = try await api.post("/meetings", body)
        let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        await sync(force: true)
        return reply["id"]?.text.nonEmpty ?? id
    }

    func loadEmployees() async {
        guard employees.isEmpty, let api else { return }
        struct Reply: Decodable { let employees: [MeetingPerson] }
        if let data = try? await api.get("/meetings", query: ["op": "employees"]), let reply = try? JSONDecoder().decode(Reply.self, from: data) {
            employees = reply.employees
        }
    }
    func loadHolidays(for days: [Date]) async {
        guard let api else { return }
        let years = Set(days.map { MeetingDates.calendar.component(.year, from: $0) }).subtracting(holidayYears)
        struct Holiday: Decodable { let date: String; let name: String }
        struct Reply: Decodable { let holidays: [Holiday] }
        for year in years.sorted() {
            guard let data = try? await api.get("/meetings", query: ["op": "holidays", "from": "\(year)-01-01", "to": "\(year)-12-31"]),
                  let reply = try? JSONDecoder().decode(Reply.self, from: data) else { continue }
            holidayYears.insert(year)
            for holiday in reply.holidays { holidays[holiday.date] = holiday.name }
        }
    }
    func searchContacts(_ query: String) async -> [MeetingPerson] {
        guard let api, query.trimmingCharacters(in: .whitespaces).count >= 2 else { return [] }
        struct Reply: Decodable { let contacts: [MeetingPerson] }
        guard let data = try? await api.get("/meetings", query: ["op": "contacts", "query": query]) else { return [] }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.contacts ?? []
    }
    func searchLocations(_ query: String) async -> [MeetingPlace] {
        guard let api, query.trimmingCharacters(in: .whitespaces).count >= 2 else { return [] }
        struct Reply: Decodable { let locations: [MeetingPlace] }
        guard let data = try? await api.get("/meetings", query: ["op": "locations", "query": query]) else { return [] }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.locations ?? []
    }
}

extension Workspace {
    /// Spotkanie na ekranie Spotkań (powiadomienie, „Mój plan”, `mavinci://meeting/…`); bez tej sekcji — w kalendarzu.
    func showMeeting(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/meetings" }) {
            openHref("/crm/meetings")
            meetings.focusID = id
            if meetings.meeting(id) == nil { Task { await meetings.sync(force: true) } }
        } else if employee?.canView(.calendar) == true {
            eventRoute = nil; selection = .calendar; focusedID = "meeting:\(id)"
        } else {
            notice = "Nie masz dostępu do spotkań."
        }
    }
}
