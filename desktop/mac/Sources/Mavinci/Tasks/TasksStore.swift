import Foundation
import SwiftUI

/// Kopia tablicy zadań na dysku: karty, uprawnienia, licznik czasu i skróty koszyków (`src/lib/native/sync.ts`).
struct TaskBoardIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [BoardTask] = []
    var access: TaskBoardAccess?
    var timer: ActiveTaskTimer?
    var syncedAt: Date?
}

/// Tablica zadań („Zadania firmowe” albo „Moje zadania”) z kopii na dysku; zapisy przez `/bridge/native/v1/tasks`.
@MainActor final class TasksStore: ObservableObject {
    let board: TaskBoardKind
    weak var workspace: Workspace?
    @Published private(set) var tasks: [BoardTask] = []
    @Published private(set) var access: TaskBoardAccess?
    @Published var timer: ActiveTaskTimer?
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    @Published var busy: Set<String> = []
    @Published var details: [String: TaskDetailInfo] = [:]
    @Published var employees: [MeetingPerson] = []
    /// Zadanie do pokazania po otwarciu tablicy (pulpit, powiadomienie).
    @Published var focusID: String?

    private var namespace: String?
    private var file: SealedFile<TaskBoardIndex>?
    private var index = TaskBoardIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    /// Tablica zadań wydarzenia (`board == .event`) — zadania z `event_id` tego wydarzenia.
    let eventID: String?

    init(board: TaskBoardKind, eventID: String? = nil) { self.board = board; self.eventID = eventID }

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    func task(_ id: String?) -> BoardTask? { id.flatMap { id in tasks.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let scope = eventID.map { "event-" + $0 } ?? board.rawValue
        let sealed = SealedFile<TaskBoardIndex>(namespace: "tasks-\(scope)-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved {
                index = saved; access = saved.access; timer = saved.timer; lastSync = saved.syncedAt
                publish()
            }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = TaskBoardIndex(); recentLocal = [:]
        tasks = []; access = nil; timer = nil; syncing = false; lastSync = nil; loadError = nil; busy = []; details = [:]; employees = []; focusID = nil
    }
    private func publish() { tasks = sortBoardTasks(index.items) }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, let file = self.file else { return }
            let snapshot = self.index
            await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
        }
    }
    private func mutate(_ id: String, _ change: (inout BoardTask) -> Void) {
        guard let i = index.items.firstIndex(where: { $0.id == id }) else { return }
        change(&index.items[i])
        recentLocal[id] = Date()
        publish(); scheduleSave()
    }
    private func setTimer(_ next: ActiveTaskTimer?) {
        timer = next; index.timer = next; scheduleSave()
        // Licznik jest jeden dla pracownika — pozostałe tablice widzą go od razu.
        if let workspace {
            for other in [workspace.myTasks, workspace.companyTasks] where other !== self && other.timer != next { other.timer = next }
        }
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
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let access: TaskBoardAccess?; let timer: ActiveTaskTimer? }
        struct Bucket: Decodable { let hash: String; let items: [BoardTask] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            var query = ["op": "state", "board": board.rawValue, "hash": index.hash]
            if let eventID { query["eventId"] = eventID }
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/tasks", query: query))
            if let next = state.access { index.access = next; access = next }
            setTimer(state.timer)
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [BoardTask] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    var request: [String: JSONValue] = ["op": .string("items"), "board": .string(board.rawValue), "buckets": .array(pending.map { .string($0) })]
                    if let eventID { request["eventId"] = .string(eventID) }
                    let data = try await api.post("/tasks", request)
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                let local = Dictionary(index.items.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
                var byID: [String: BoardTask] = [:]
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
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się wczytać zadań.") }
        }
    }
    /// Po zmianie na jednej tablicy druga też się odświeża (to samo zadanie bywa na obu).
    private func refreshBoth() {
        Task { await sync(force: true) }
        guard let workspace else { return }
        let other = board == .mine ? workspace.companyTasks : workspace.myTasks
        if other !== self { Task { await other.sync(force: true) } }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    private func report(_ error: Error, _ fallback: String) { workspace?.error = failureText(error, fallback) }
    @discardableResult private func post(_ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["board"] = .string(board.rawValue)
        if let eventID { payload["eventId"] = .string(eventID) }
        let data = try await api.post("/tasks", payload)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }
    private func timerFrom(_ reply: [String: JSONValue]) -> ActiveTaskTimer? {
        guard case .object(let t) = reply["timer"] ?? .null, let id = t["id"]?.text.nonEmpty else { return nil }
        return ActiveTaskTimer(id: id, taskId: t["taskId"]?.text.nonEmpty, title: t["title"]?.text ?? "", startTime: t["startTime"]?.text ?? "")
    }

    /// Przeniesienie karty (bez pytań — te zadaje widok): kolumna, osoba pracująca i ewentualny start licznika.
    func move(_ task: BoardTask, to column: BoardColumnKind, working: Bool, startTimer: Bool) async {
        let previous = task
        mutate(task.id) { t in
            t.boardColumn = column.rawValue
            if column != .in_progress { t.workingBy = nil; t.workingName = "" }
            else if working, let me = access?.employeeId { t.workingBy = me; t.workingName = workspace?.employee?.displayName ?? t.workingName }
        }
        busy.insert(task.id)
        defer { busy.remove(task.id) }
        do {
            let reply = try await post(["op": .string("move"), "id": .string(task.id), "column": .string(column.rawValue),
                                        "working": .bool(working), "startTimer": .bool(startTimer)])
            setTimer(timerFrom(reply))
            workspace?.succeed(startTimer ? "Zadanie rozpoczęte" : "Zadanie przeniesione")
            refreshBoth()
        } catch {
            mutate(task.id) { $0 = previous }
            report(error, "Błąd podczas przenoszenia zadania")
        }
    }

    /// Licznik czasu: start, stop albo zmiana zadania („Zatrzymaj poprzedni i rozpocznij nowy”).
    func timer(_ action: String, task: BoardTask? = nil) async {
        await workspace?.withPending(action == "stop" ? "Zatrzymywanie licznika…" : "Uruchamianie licznika…") {
            do {
                var body: [String: JSONValue] = ["op": .string("timer"), "action": .string(action)]
                if let task { body["id"] = .string(task.id) }
                let reply = try await post(body)
                setTimer(timerFrom(reply))
                workspace?.succeed(action == "stop" ? "Licznik czasu zatrzymany" : "Timer rozpoczęty dla: \(task?.titleLabel ?? "")")
            } catch { report(error, "Błąd podczas uruchamiania timera") }
        }
    }

    func delete(_ task: BoardTask) async -> Bool {
        var ok = false
        await workspace?.withPending("Usuwanie zadania…") {
            do {
                try await post(["op": .string("delete"), "id": .string(task.id)])
                index.items.removeAll { $0.id == task.id }
                publish(); scheduleSave()
                workspace?.succeed("Zadanie zostało usunięte")
                ok = true
                refreshBoth()
            } catch { report(error, "Błąd podczas usuwania zadania") }
        }
        return ok
    }

    /// Zapis z formularza. Zwraca id zadania (także nowego — potrzebne do załączników i ponowień).
    func save(id: String?, existing: Bool, data: [String: JSONValue], assignees: [String]?) async throws -> String {
        var body: [String: JSONValue] = ["op": .string("save"), "data": .object(data), "existing": .bool(existing)]
        if let id { body["id"] = .string(id) }
        if let assignees { body["assignees"] = .array(assignees.map { .string($0) }) }
        let reply = try await post(body)
        return reply["id"]?.text.nonEmpty ?? id ?? ""
    }
    func finishSave() { refreshBoth() }

    /// Załącznik zadania (multipart — plik idzie przez serwer CRM do magazynu `event-files`, jak w przeglądarce).
    func upload(_ file: URL, to taskID: String) async throws {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/tasks?op=attach&id=\(taskID)") else { throw AppError.configuration }
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        let content = try Data(contentsOf: file)
        let boundary = "mavinci-\(UUID().uuidString)"
        let type = AttachmentFile(url: file, size: content.count).contentType
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(file.lastPathComponent.replacingOccurrences(of: "\"", with: ""))\"\r\nContent-Type: \(type)\r\n\r\n".data(using: .utf8)!)
        body.append(content)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się przesłać pliku „\(file.lastPathComponent)”.", fieldErrors: [:])
        }
    }

    // MARK: Szczegóły, komentarze, pracownicy
    func loadDetail(_ id: String) async {
        guard let api else { return }
        if let data = try? await api.get("/tasks", query: ["op": "detail", "id": id]), let detail = try? JSONDecoder().decode(TaskDetailInfo.self, from: data) {
            details[id] = detail
        }
    }
    func comment(_ task: BoardTask, _ content: String) async -> Bool {
        do {
            try await post(["op": .string("comment"), "id": .string(task.id), "content": .string(content)])
            await loadDetail(task.id)
            mutate(task.id) { $0.comments += 1 }
            return true
        } catch { report(error, "Nie udało się dodać komentarza."); return false }
    }
    func deleteComment(_ comment: TaskComment, task: BoardTask) async {
        do {
            try await post(["op": .string("deleteComment"), "commentId": .string(comment.id)])
            await loadDetail(task.id)
            mutate(task.id) { $0.comments = max(0, $0.comments - 1) }
            workspace?.succeed("Komentarz usunięty")
        } catch { report(error, "Nie udało się usunąć komentarza.") }
    }
    func loadEmployees() async {
        guard employees.isEmpty, let api else { return }
        struct Reply: Decodable { let employees: [MeetingPerson] }
        if let data = try? await api.get("/tasks", query: ["op": "employees"]), let reply = try? JSONDecoder().decode(Reply.self, from: data) {
            employees = reply.employees
        }
    }
}

extension Workspace {
    /// Zadanie na jego tablicy: „Moje zadania”, a gdy go tam nie ma — „Zadania firmowe”.
    func showTask(_ id: String) {
        let hrefs = Set(navigation.flatMap(\.flattened).map(\.href))
        if myTasks.task(id) == nil, companyTasks.task(id) != nil, hrefs.contains("/crm/tasks") {
            openHref("/crm/tasks")
            companyTasks.focusID = id
        } else {
            if hrefs.contains("/crm/tasks/mine") { openHref("/crm/tasks/mine") }
            else { eventRoute = nil; webItem = nil; nativeSet = nil; selection = nil; screen = .myTasks }
            myTasks.focusID = id
        }
    }
}
