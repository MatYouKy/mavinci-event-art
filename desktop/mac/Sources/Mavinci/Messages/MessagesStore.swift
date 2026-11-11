import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension NativeAPI {
    private static let longSession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 90; c.timeoutIntervalForResource = 300; c.httpShouldSetCookies = false
        return URLSession(configuration: c)
    }()
    /// GET z parametrami (`/messages?op=list&…`).
    func get(_ path: String, query: [String: String]) async throws -> Data {
        var components = URLComponents()
        components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return try await get(path + (components.percentEncodedQuery.map { "?" + $0 } ?? ""))
    }
    /// Trasy CRM poza `/bridge/native/v1` (np. `/bridge/messages/trash`) — ten sam token pracownika.
    func bridge(_ path: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw AppError.configuration }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        req.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(body)
        return try await Self.decode(Self.longSession.data(for: req), fallback: "Serwer CRM nie wykonał operacji")
    }
    /// Funkcja poczty Supabase (`send-email`, `schedule-email`) — jak `dispatchCrmEmail` w przeglądarce; załączniki nie przechodzą przez serwer CRM.
    func edgeFunction(_ name: String, connection: Connection, body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let url = URL(string: connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/functions/v1/" + name) else { throw AppError.configuration }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(connection.publicKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(body)
        let reply = try await Self.decode(Self.longSession.data(for: req), fallback: "Nie udało się wysłać wiadomości")
        if case .bool(false) = reply["success"] ?? .null {
            throw NativeFailure(status: 200, message: reply["error"]?.text.nonEmpty ?? reply["message"]?.text.nonEmpty ?? "Nie udało się wysłać wiadomości", fieldErrors: [:])
        }
        return reply
    }
    private static func decode(_ result: (Data, URLResponse), fallback: String) throws -> [String: JSONValue] {
        let (data, response) = result
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        if (200..<300).contains(http.statusCode) { return object }
        if http.statusCode == 401 { throw AppError.unauthorized }
        throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? object["message"]?.text.nonEmpty ?? "\(fallback) (\(http.statusCode)).", fieldErrors: [:])
    }
}

extension String { var nonEmpty: String? { isEmpty ? nil : self } }

/// Szkic wysyłki (nowa wiadomość, odpowiedź, przekazanie) — jak `ComposeEmailModal`.
struct ComposeDraft: Identifiable {
    enum Mode { case new, reply, forward }
    let id = UUID()
    var mode: Mode = .new
    var accountId: String
    var to = ""
    var cc = ""
    var bcc = ""
    var subject = ""
    var text = ""
    var reply: MessageDetail?
    var title: String { mode == .reply ? "Odpowiedź" : mode == .forward ? "Przekaż wiadomość" : "Nowa wiadomość" }
}

struct AttachmentFile: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    let size: Int
    var name: String { url.lastPathComponent }
    var contentType: String { UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream" }
    var sizeLabel: String {
        size < 1024 ? "\(size) B" : size < 1024 * 1024 ? String(format: "%.1f KB", Double(size) / 1024) : String(format: "%.1f MB", Double(size) / 1024 / 1024)
    }
}

/// Postęp synchronizacji kopii (osobno od listy, żeby pobieranie treści w tle nie odświeżało widoku listy).
@MainActor final class MailSyncStatus: ObservableObject {
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var offline = false
    @Published var bodiesStored = 0
    @Published var bodiesTotal = 0
}

/// Wiadomości z kopii na dysku: widoki czytają lokalne dane natychmiast, a synchronizacja w tle pobiera z serwera tylko zmiany
/// (koszyki o innym skrócie) i treść nowych wiadomości. Zapisy idą na serwer, a lokalna kopia zmienia się od razu.
@MainActor final class MessagesStore: ObservableObject {
    struct Scope: Hashable { var account: String; var folder: MessageFolder }

    weak var workspace: Workspace?
    let status = MailSyncStatus()
    @Published var info: MailboxInfo?
    @Published var infoError: String?
    /// Suma nieprzeczytanych do paska bocznego (bez skrzynek wyciszonych) — liczona z lokalnej kopii.
    @Published var unreadTotal = 0
    @Published var scope = Scope(account: "", folder: .all)
    /// Wszystkie wiadomości z kopii, od najnowszych (z lejkiem i zajawkami).
    @Published private(set) var items: [MessageItem] = []
    @Published var searchResults: [MessageItem]?
    @Published var loading = false
    @Published var listError: String?
    @Published var searchText = ""
    @Published var dateFrom: Date?
    @Published var dateTo: Date?
    @Published var selectedKey: String?
    @Published var details: [String: MessageDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    @Published var markingAccount: String?
    @Published var markedCount = 0
    @Published var busy = false

    private var namespace: String?
    private var mirror: MailMirror?
    private var index = MailIndex()
    private var byKey: [String: MessageItem] = [:]
    private var storedBodies: Set<String> = []
    private var unavailableBodies: Set<String> = []
    /// Zmiany zrobione na Macu w ostatnich sekundach — synchronizacja nie cofa ich, zanim serwer je potwierdzi.
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var prefetchTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var infoAt: Date?
    private var previewsDirty = false
    private var searchTicket = UUID()
    private var trashBusy = false

    var api: NativeAPI? { workspace?.nativeAPI() }
    var searchMode: Bool { searchResults != nil }
    var selected: MessageItem? { item(selectedKey) }
    func item(_ key: String?) -> MessageItem? {
        guard let key else { return nil }
        return searchResults?.first { $0.key == key } ?? items.first { $0.key == key }
    }
    var canSend: Bool { (info?.canView ?? false) && !(info?.sendingAccounts.isEmpty ?? true) }
    func canTrash(_ message: MessageItem) -> Bool {
        message.type == "contact_form" ? (info?.canManage ?? false) : (message.email_account_id.map { info?.trashMailboxIds.contains($0) ?? false } ?? false)
    }
    func canReply(_ message: MessageItem) -> Bool {
        canSend && (message.type == "contact_form" || info?.sendingAccounts.contains { $0.id == message.email_account_id } == true)
    }
    var visibleItems: [MessageItem] {
        let filtered = (searchResults ?? items).filter(matchesScope)
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return filtered }
        return filtered.filter { [$0.from, $0.to, $0.subject, $0.preview].contains { $0.lowercased().contains(query) } }
    }
    private func matchesScope(_ m: MessageItem) -> Bool {
        let account = scope.account
        if account == "contact_form" && m.type != "contact_form" { return false }
        if account != "all" && account != "contact_form" && m.email_account_id != account { return false }
        if scope.folder == .trash { return m.isDeleted && m.type != "draft" }
        if m.isDeleted { return false }
        if scope.folder == .all { return m.type != "draft" }
        return m.type == (scope.folder == .drafts ? "draft" : scope.folder.rawValue)
    }

    // MARK: Kopia na dysku
    /// Otwiera kopię zalogowanego pracownika i pokazuje ją od razu; potem synchronizuje zmiany.
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let ns = "mail-\(next)"
        Task {
            let loaded = await Task.detached(priority: .userInitiated) { () -> (MailMirror?, MailIndex?, Set<String>) in
                guard let mirror = try? MailMirror(namespace: ns) else { return (nil, nil, []) }
                return (mirror, mirror.loadIndex(), mirror.storedBodies())
            }.value
            guard namespace == next else { return }
            mirror = loaded.0
            storedBodies = loaded.2
            if let saved = loaded.1 {
                index = saved
                if let savedInfo = saved.info { info = savedInfo; chooseInitialScope() }
                rebuild()
                status.lastSync = saved.syncedAt
            }
            await sync()
        }
    }
    /// Wylogowanie lub zmiana konta: czyści pamięć, a przy `clearDisk` — także kopię na dysku i jej klucz.
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); prefetchTask?.cancel(); saveTask?.cancel()
        syncTask = nil; prefetchTask = nil; saveTask = nil
        if clearDisk, let mirror { Task.detached { mirror.clear() } }
        mirror = nil; namespace = nil; index = MailIndex(); byKey = [:]; storedBodies = []; unavailableBodies = []; recentLocal = [:]
        info = nil; infoError = nil; infoAt = nil; unreadTotal = 0; scope = Scope(account: "", folder: .all); items = []; searchResults = nil
        selectedKey = nil; details = [:]; detailErrors = [:]; searchText = ""; listError = nil; loading = false
        status.syncing = false; status.lastSync = nil; status.offline = false; status.bodiesStored = 0; status.bodiesTotal = 0
    }
    private func chooseInitialScope() {
        guard let info else { return }
        if scope.account.isEmpty || !info.accounts.contains(where: { $0.id == scope.account }), let first = info.accounts.first {
            scope = Scope(account: first.id, folder: first.id == "contact_form" ? .contact_form : .all)
        }
    }
    private func rebuild() {
        byKey = Dictionary(index.items.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
        items = index.items.map { item in
            var item = item
            item.sales = index.sales[item.key]
            if item.preview.isEmpty, let preview = index.previews[item.key] { item.preview = preview }
            return item
        }.sorted { $0.date > $1.date }
        previewsDirty = false
        recount()
        let total = index.items.filter { $0.type != "draft" }
        status.bodiesTotal = total.count
        status.bodiesStored = total.filter { storedBodies.contains(MailMirror.fileName($0.key)) }.count
    }
    /// Liczniki jak w CRM: odebrane nieprzeczytane poza koszem (per skrzynka) i nowe formularze; suma bez skrzynek wyciszonych.
    private func recount() {
        var byAccount: [String: Int] = [:]
        var contact = 0
        for m in index.items where !m.isDeleted && !m.isRead {
            if m.type == "received", let account = m.email_account_id { byAccount[account, default: 0] += 1 }
            else if m.type == "contact_form" { contact += 1 }
        }
        let muted = Set(info?.mutedMailboxIds ?? [])
        let total = contact + byAccount.filter { !muted.contains($0.key) }.values.reduce(0, +)
        info?.unread = UnreadCounts(total: total, contactForm: contact, byAccount: byAccount)
        unreadTotal = total
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self, let mirror = self.mirror else { return }
            var draft = self.index
            draft.info = self.info
            let snapshot = draft
            await Task.detached(priority: .utility) { try? mirror.saveIndex(snapshot) }.value
        }
    }
    /// Zmiana lokalna (od razu w widoku i na dysku), potwierdzana przez serwer.
    private func mutate(_ key: String, _ change: (inout MessageItem) -> Void) {
        if let i = index.items.firstIndex(where: { $0.key == key }) { change(&index.items[i]); byKey[key] = index.items[i] }
        if let i = items.firstIndex(where: { $0.key == key }) { change(&items[i]) }
        if let i = searchResults?.firstIndex(where: { $0.key == key }) { change(&searchResults![i]) }
        recentLocal[key] = Date()
        recount(); scheduleSave()
    }

    // MARK: Synchronizacja
    /// Pobiera z serwera tylko zmienione koszyki; skrzynki co 5 minut, lejek nowych i ostatnich wiadomości.
    func sync(force: Bool = false) async {
        if let syncTask { await syncTask.value; if !force { return } }
        let task = Task { await performSync(force: force) }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }
    private func performSync(force: Bool) async {
        guard let api, mirror != nil else { return }
        status.syncing = true
        loading = index.items.isEmpty
        defer { status.syncing = false; loading = false }
        if force || info == nil || infoAt.map({ Date().timeIntervalSince($0) > 300 }) ?? true { await loadInfo() }
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]? }
        struct Bucket: Decodable { let hash: String; let items: [MessageItem] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/messages", query: ["op": "mirror", "hash": index.hash]))
            var changedKeys: [String] = []
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [MessageItem] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/messages", ["op": .string("mirrorItems"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                var next = replaceAll ? [:] : byKey
                if !replaceAll {
                    for key in byKey.keys where changed.contains(mailBucket(key, width: state.width)) || vanished.contains(mailBucket(key, width: state.width)) { next[key] = nil }
                }
                var dirty = Set<String>()
                for var item in fetched {
                    if recentLocal[item.key] != nil, let local = byKey[item.key] {
                        next[item.key] = local; dirty.insert(mailBucket(item.key, width: state.width)); continue
                    }
                    if item.preview.isEmpty, let old = byKey[item.key], !old.preview.isEmpty { item.preview = old.preview }
                    if byKey[item.key] != item { changedKeys.append(item.key) }
                    next[item.key] = item
                }
                let removed = Set(byKey.keys).subtracting(next.keys)
                index.items = Array(next.values)
                index.buckets = server
                for bucket in dirty { index.buckets[bucket] = "" }
                index.width = state.width
                index.hash = dirty.isEmpty ? state.hash : ""
                for key in removed { index.sales[key] = nil; index.previews[key] = nil; details[key] = nil }
                if !removed.isEmpty, let mirror {
                    let gone = Array(removed)
                    storedBodies.subtract(gone.map(MailMirror.fileName))
                    Task.detached(priority: .utility) { mirror.removeBodies(gone) }
                }
                if let selectedKey, removed.contains(selectedKey) { self.selectedKey = nil }
                rebuild()
            }
            index.syncedAt = Date()
            status.lastSync = index.syncedAt; status.offline = false; listError = nil
            scheduleSave()
            await refreshSales(changedKeys, periodic: true)
            startPrefetch()
        } catch {
            status.offline = error is URLError
            if index.items.isEmpty { listError = failureText(error, "Nie udało się pobrać wiadomości.") }
        }
    }
    /// Synchronizacja w tle (pasek boczny co 30 s, powrót do aplikacji).
    func backgroundSync() async {
        guard mirror != nil else { return }
        await sync()
    }
    func loadInfo() async {
        guard let api else { return }
        do {
            var next = try JSONDecoder().decode(MailboxInfo.self, from: try await api.get("/messages", query: ["op": "accounts"]))
            next.unread = info?.unread ?? next.unread
            info = next; infoError = nil; infoAt = Date(); index.info = next
            chooseInitialScope(); recount(); scheduleSave()
        } catch {
            if info == nil { infoError = failureText(error, "Nie udało się pobrać skrzynek pocztowych.") }
        }
    }
    /// Lejek sprzedaży: zmienione wiadomości od razu, najnowsze 200 co 5 minut, otwierana — przy wyborze.
    private func refreshSales(_ keys: [String], periodic: Bool = false) async {
        var wanted = keys
        if periodic, index.salesAt.map({ Date().timeIntervalSince($0) > 300 }) ?? true {
            wanted += items.prefix(200).map(\.key)
            index.salesAt = Date()
        }
        let refs = Array(Set(wanted)).filter { !$0.hasPrefix("draft:") }.compactMap(Self.ref)
        guard let api, !refs.isEmpty else { return }
        struct Reply: Decodable { let sales: [String: SalesContext] }
        var updated: [String: SalesContext] = [:]
        for start in stride(from: 0, to: refs.count, by: 100) {
            let chunk = Array(refs[start..<min(start + 100, refs.count)])
            guard let data = try? await api.post("/messages", ["op": .string("sales"), "refs": .array(chunk)]),
                  let reply = try? JSONDecoder().decode(Reply.self, from: data) else { continue }
            updated.merge(reply.sales) { _, new in new }
        }
        guard !updated.isEmpty else { return }
        for (key, value) in updated { index.sales[key] = value }
        var next = items
        var touched = false
        for i in next.indices { if let value = updated[next[i].key], next[i].sales != value { next[i].sales = value; touched = true } }
        if touched { items = next }
        if let results = searchResults { searchResults = results.map { var m = $0; if let value = updated[m.key] { m.sales = value }; return m } }
        scheduleSave()
    }
    private static func ref(_ key: String) -> JSONValue? {
        let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        return .object(["type": .string(parts[0]), "id": .string(parts[1])])
    }
    /// Treść wiadomości pobierana w tle na dysk — od najnowszych, partiami; nowe wiadomości od razu po synchronizacji.
    private func startPrefetch() {
        guard prefetchTask == nil, mirror != nil else { return }
        prefetchTask = Task { [weak self] in
            await self?.prefetchLoop()
            self?.prefetchTask = nil
            if self?.previewsDirty == true { self?.rebuild() }
        }
    }
    private func prefetchLoop() async {
        var lastRebuild = Date()
        while !Task.isCancelled, let api, let mirror {
            let missing = items.filter { $0.type != "draft" && !storedBodies.contains(MailMirror.fileName($0.key)) && !unavailableBodies.contains($0.key) }
            guard !missing.isEmpty else { return }
            let batch = Array(missing.prefix(12))
            guard let data = try? await api.post("/messages", ["op": .string("bodies"), "refs": .array(batch.compactMap { Self.ref($0.key) })]) else { return }
            let saved = await store(bodies: data, in: mirror)
            let progress = saved + (((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["missing"] as? [String] ?? []).count
            if progress == 0 { return }
            if Date().timeIntervalSince(lastRebuild) > 15 && previewsDirty { rebuild(); lastRebuild = Date() }
            await Task.yield()
        }
    }
    /// Zapisuje treść z odpowiedzi `op=bodies` na dysk; zwraca liczbę zapisanych. Wiadomości bez dostępu nie są ponawiane.
    @discardableResult private func store(bodies data: Data, in mirror: MailMirror) async -> Int {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return 0 }
        let messages = object["messages"] as? [[String: Any]] ?? []
        unavailableBodies.formUnion(object["missing"] as? [String] ?? [])
        var entries: [(String, Data)] = []
        for message in messages {
            guard let id = message["id"] as? String, let type = message["type"] as? String,
                  let encoded = try? JSONSerialization.data(withJSONObject: message) else { continue }
            let key = "\(type):\(id)"
            entries.append((key, encoded))
            if let preview = message["preview"] as? String, !preview.isEmpty, index.previews[key] == nil, byKey[key]?.preview.isEmpty != false {
                index.previews[key] = preview; previewsDirty = true
            }
        }
        let toSave = entries
        await Task.detached(priority: .utility) { for (key, data) in toSave { try? mirror.saveBody(key, data) } }.value
        storedBodies.formUnion(entries.map { MailMirror.fileName($0.0) })
        status.bodiesStored = min(status.bodiesTotal, status.bodiesStored + entries.count)
        if !entries.isEmpty { scheduleSave() }
        return entries.count
    }

    // MARK: Lista
    func unread(account: String) -> Int { info?.unread.byAccount[account] ?? 0 }
    func moveMailboxes(from source: IndexSet, to destination: Int) {
        guard var order = info?.orderedMailboxes.map(\.id) else { return }
        order.move(fromOffsets: source, toOffset: destination)
        info?.mailboxOrder = order
        index.info = info; scheduleSave()
        Task {
            do {
                _ = try await api?.post("/messages", ["op": .string("order"), "ids": .array(order.map { .string($0) })])
                workspace?.succeed("Zapisano kolejność skrzynek")
            } catch { workspace?.error = "Nie udało się zapisać kolejności skrzynek" }
        }
    }
    func open(account: String, folder: MessageFolder) {
        let next = Scope(account: account, folder: folder)
        guard next != scope else { return }
        if searchMode { clearSearch() }
        scope = next; selectedKey = nil
    }
    func refresh() async {
        if searchMode { clearSearch() }
        await sync(force: true)
    }
    /// Wyszukiwanie w treści na serwerze (Enter); filtr nadawcy, odbiorcy i tematu działa od razu na kopii lokalnej.
    func search() async {
        guard let api else { return }
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { workspace?.notice = "Wprowadź frazę do wyszukania"; return }
        let ticket = UUID(); searchTicket = ticket
        let current = scope
        loading = true; selectedKey = nil
        defer { if searchTicket == ticket { loading = false } }
        var params = ["op": "search", "account": current.account, "folder": current.folder.rawValue, "query": query]
        let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"; day.timeZone = MailDates.zone
        if let dateFrom { params["dateFrom"] = day.string(from: dateFrom) }
        if let dateTo { params["dateTo"] = day.string(from: dateTo) }
        struct Reply: Decodable { let messages: [MessageItem]; let total: Int }
        do {
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/messages", query: params))
            guard searchTicket == ticket, scope == current else { return }
            // Stan z kopii lokalnej (odczytanie, gwiazdki), gdy wiadomość już w niej jest.
            searchResults = reply.messages.map { found in
                guard var local = items.first(where: { $0.key == found.key }) else { return found }
                if local.sales == nil { local.sales = found.sales }
                return local
            }
            workspace?.notice = "Znaleziono \(reply.total) wiadomości"
        } catch {
            guard searchTicket == ticket else { return }
            workspace?.error = "Błąd podczas wyszukiwania"
        }
    }
    func clearSearch() {
        searchTicket = UUID(); searchResults = nil; searchText = ""; dateFrom = nil; dateTo = nil; selectedKey = nil
    }

    // MARK: Podgląd
    func select(_ key: String?) {
        selectedKey = key
        guard let key, let message = item(key) else { return }
        if !message.isRead && message.inbound {
            mutate(key) { $0.isRead = true }
            Task {
                do { _ = try await api?.post("/messages", ["op": .string("read"), "id": .string(message.id), "type": .string(message.type)]) }
                catch { workspace?.notice = "Wiadomość odczytana w CRM; synchronizacja poczty zostanie ponowiona" }
            }
        }
        if message.type != "draft" && details[key] == nil { Task { _ = await loadDetail(message) } }
        Task { await refreshSales([key]) }
    }
    @discardableResult func loadDetail(_ message: MessageItem, force: Bool = false) async -> MessageDetail? {
        await loadDetail(id: message.id, type: message.type, force: force)
    }
    /// Treść z dysku (natychmiast); z serwera tylko, gdy jeszcze jej nie pobrano albo przy ponowieniu.
    @discardableResult func loadDetail(id: String, type: String, force: Bool = false) async -> MessageDetail? {
        let key = "\(type):\(id)"
        guard type != "draft" else { return nil }
        if !force, let cached = details[key] { return cached }
        if !force, let mirror, let data = mirror.body(key), let detail = try? JSONDecoder().decode(MessageDetail.self, from: data) {
            details[key] = detail; detailErrors[key] = nil
            return detail
        }
        guard let api else { return nil }
        do {
            let data = try await api.post("/messages", ["op": .string("bodies"), "refs": .array([.object(["id": .string(id), "type": .string(type)])])])
            struct Reply: Decodable { let messages: [MessageDetail] }
            guard let detail = try JSONDecoder().decode(Reply.self, from: data).messages.first else { throw AppError.forbidden }
            details[key] = detail; detailErrors[key] = nil
            if let mirror { await store(bodies: data, in: mirror) }
            return detail
        } catch {
            detailErrors[key] = "Nie udało się pobrać treści wiadomości."
            return nil
        }
    }
    func markUnread(_ message: MessageItem) async {
        guard message.inbound else { return }
        mutate(message.key) { $0.isRead = false }
        do {
            _ = try await api?.post("/messages", ["op": .string("read"), "id": .string(message.id), "type": .string(message.type), "isRead": .bool(false)])
            workspace?.succeed("Oznaczono jako nieprzeczytaną")
        } catch { mutate(message.key) { $0.isRead = true }; workspace?.error = "Nie udało się oznaczyć wiadomości jako nieprzeczytanej" }
    }
    func toggleStar(_ message: MessageItem) async {
        mutate(message.key) { $0.isStarred = !message.isStarred }
        do {
            _ = try await api?.post("/messages", ["op": .string("star"), "id": .string(message.id), "isStarred": .bool(message.isStarred)])
            workspace?.succeed(message.isStarred ? "Usunięto gwiazdkę" : "Oznaczono gwiazdką")
        } catch {
            mutate(message.key) { $0.isStarred = message.isStarred }
            workspace?.error = "Błąd podczas oznaczania wiadomości"
        }
    }
    /// Kosz: poczta przez serwer pocztowy (`/bridge/messages/trash`), formularz i wersje robocze — kosz CRM. Zmiana lokalna po potwierdzeniu.
    func trash(_ message: MessageItem, restore: Bool) async {
        guard !trashBusy, let api else { return }
        trashBusy = true; busy = true
        workspace?.pending = restore ? "Przywracanie wiadomości…" : (message.type == "received" || message.type == "sent" ? "Przenoszenie do kosza na serwerze pocztowym…" : "Przenoszenie do kosza…")
        defer { trashBusy = false; busy = false; workspace?.pending = nil }
        do {
            if message.type == "received" || message.type == "sent" {
                _ = try await api.bridge("/bridge/messages/trash", ["id": .string(message.id), "type": .string(message.type), "action": .string(restore ? "restore" : "trash")])
                _ = try? await api.post("/messages", ["op": .string("touch")])
            } else {
                _ = try await api.post("/messages", ["op": .string(restore ? "restore" : "trash"), "id": .string(message.id), "type": .string(message.type)])
            }
            mutate(message.key) { $0.isDeleted = !restore }
            if message.type == "draft" && !restore { index.items.removeAll { $0.key == message.key }; rebuild() }
            if selectedKey == message.key { selectedKey = nil }
            workspace?.succeed(restore ? "Wiadomość została przywrócona" : "Wiadomość została przeniesiona do kosza")
        } catch {
            workspace?.error = failureText(error, "Nie udało się potwierdzić zmiany wiadomości.")
        }
    }
    func markAllRead(_ accountID: String) async {
        guard markingAccount == nil, let api else { return }
        markingAccount = accountID; markedCount = 0
        workspace?.pending = "Oznaczanie wszystkich jako odczytane…"
        var marked = 0, missing = 0
        var cursor: JSONValue = .null, cutoff: JSONValue = .null
        do {
            repeat {
                var body: [String: JSONValue] = ["accountId": .string(accountID), "cursor": cursor]
                if cutoff != .null { body["cutoff"] = cutoff }
                let reply = try await api.bridge("/bridge/messages/mark-all-read", body)
                guard case .array(let ids) = reply["ids"] ?? .null else { throw NativeFailure(status: 0, message: "Nie udało się oznaczyć wiadomości. Spróbuj ponownie.", fieldErrors: [:]) }
                marked += ids.count; missing += Int(reply["missingOnServer"]?.number ?? 0); markedCount = marked
                workspace?.pending = "Oznaczanie wszystkich jako odczytane… \(marked)"
                for id in ids.map(\.text) { mutate("received:\(id)") { $0.isRead = true } }
                let next = reply["cursor"] ?? .null
                if next != .null && next == cursor { throw NativeFailure(status: 0, message: "Synchronizacja została przerwana. Spróbuj ponownie.", fieldErrors: [:]) }
                cursor = next; cutoff = reply["cutoff"] ?? .null
            } while cursor != .null && !cursor.text.isEmpty
            if missing > 0 {
                workspace?.notice = "Oznaczono jako odczytane: \(marked). Dla \(missing) wiadomości zapisano zmianę tylko w CRM — nie odnaleziono ich jednoznacznie na serwerze pocztowym."
            } else {
                workspace?.succeed(marked == 0 ? "Wszystkie wiadomości w tej skrzynce są już odczytane." : "Oznaczono wszystkie wiadomości jako odczytane (\(marked)).")
            }
        } catch {
            workspace?.error = (marked > 0 ? "Oznaczono już \(marked) wiadomości. " : "") + failureText(error, "Nie udało się zakończyć operacji.")
        }
        markingAccount = nil
        workspace?.pending = nil
        _ = try? await api.post("/messages", ["op": .string("touch")])
        await sync()
    }
    func fetchFromServer() async {
        guard let api else { return }
        guard scope.account != "all", scope.account != "contact_form" else { workspace?.notice = "Wybierz konkretne konto email"; return }
        busy = true; workspace?.pending = "Pobieranie wiadomości z serwera pocztowego…"
        defer { busy = false; workspace?.pending = nil }
        do {
            let reply = try await api.post("/messages", ["op": .string("fetch"), "accountId": .string(scope.account)])
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: reply)) ?? [:]
            workspace?.succeed(object["message"]?.text.nonEmpty ?? "Pobrano nowe wiadomości")
            await sync()
        } catch { workspace?.error = failureText(error, "Nie udało się pobrać wiadomości") }
    }

    // MARK: Wysyłka
    func newDraft() -> ComposeDraft {
        let account = info?.sendingAccounts.first { $0.id == scope.account }?.id ?? info?.sendingAccounts.first?.id ?? ""
        return ComposeDraft(accountId: account)
    }
    func replyDraft(_ message: MessageItem) async -> ComposeDraft? {
        guard let detail = await loadDetail(message) else { workspace?.error = "Nie udało się pobrać pełnej treści wiadomości"; return nil }
        let subject = message.subject.range(of: #"^re\s*:"#, options: [.regularExpression, .caseInsensitive]) != nil ? message.subject : "Re: \(message.subject.isEmpty ? "(bez tematu)" : message.subject)"
        return ComposeDraft(mode: .reply, accountId: sendingAccount(for: message), to: detail.replyAddress, subject: subject, reply: detail)
    }
    func forwardDraft(_ message: MessageItem) async -> ComposeDraft? {
        guard let detail = await loadDetail(message) else { workspace?.error = "Nie udało się pobrać pełnej treści wiadomości"; return nil }
        let text = "\n\n--- Przekazana wiadomość ---\nOd: \(message.from)\nData: \(MailDates.list(message.date))\nTemat: \(message.subject)\n\n\(detail.body)"
        return ComposeDraft(mode: .forward, accountId: sendingAccount(for: message), subject: "Fwd: \(message.subject)", text: text)
    }
    private func sendingAccount(for message: MessageItem) -> String {
        let accounts = info?.sendingAccounts ?? []
        if let id = message.email_account_id, accounts.contains(where: { $0.id == id }) { return id }
        return accounts.first { $0.id == scope.account }?.id ?? accounts.first?.id ?? ""
    }
    private func composeBody(_ draft: ComposeDraft) -> [String: JSONValue] {
        var body: [String: JSONValue] = ["accountId": .string(draft.accountId), "subject": .string(draft.subject), "text": .string(draft.text)]
        if let reply = draft.reply { body["reply"] = .object(["id": .string(reply.item.id), "type": .string(reply.item.type)]) }
        return body
    }
    func preview(_ draft: ComposeDraft) async throws -> String {
        guard let api else { throw AppError.configuration }
        var body = composeBody(draft); body["op"] = .string("preview")
        let reply = try JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/messages", body))
        return reply["html"]?.text ?? ""
    }
    /// Treść i stopka z serwera CRM, wysyłka (lub zaplanowanie) w funkcji poczty — jak w przeglądarce.
    func send(_ draft: ComposeDraft, attachments: [AttachmentFile], scheduledAt: Date?) async throws -> String {
        guard let api, let workspace else { throw AppError.configuration }
        let files: [JSONValue] = try attachments.map { file in
            .object(["filename": .string(file.name), "content": .string(try Data(contentsOf: file.url).base64EncodedString()), "contentType": .string(file.contentType)])
        }
        let iso = ISO8601DateFormatter()
        var compose = composeBody(draft); compose["op"] = .string("compose")
        if workspace.connection.provider == .server {
            compose["op"] = .string("send"); compose["to"] = .string(draft.to); compose["cc"] = .string(draft.cc); compose["bcc"] = .string(draft.bcc)
            compose["attachments"] = .array(files)
            if let scheduledAt { compose["scheduledAt"] = .string(iso.string(from: scheduledAt)) }
            _ = try await api.post("/messages", compose)
        } else {
            let prepared = try JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/messages", compose))
            var payload: [String: JSONValue] = [
                "emailAccountId": .string(draft.accountId), "to": .string(draft.to.trimmingCharacters(in: .whitespacesAndNewlines)),
                "cc": .string(draft.cc.trimmingCharacters(in: .whitespacesAndNewlines)), "bcc": .string(draft.bcc.trimmingCharacters(in: .whitespacesAndNewlines)),
                "subject": .string(draft.subject), "body": prepared["html"] ?? .string(""), "attachments": .array(files),
            ]
            for key in ["messageId", "inReplyTo", "references"] { if let value = prepared[key], value != .null { payload[key] = value } }
            if let scheduledAt {
                _ = try await api.edgeFunction("schedule-email", connection: workspace.connection, body: [
                    "functionName": .string("send-email"), "scheduledAt": .string(iso.string(from: scheduledAt)), "timezone": .string("Europe/Warsaw"),
                    "payload": .object(payload), "metadata": .object(["entityType": .string("message"), "actionUrl": .string("/crm/messages")]),
                ])
            } else {
                _ = try await api.edgeFunction("send-email", connection: workspace.connection, body: payload)
            }
            _ = try? await api.post("/messages", ["op": .string("touch")])
        }
        Task { await sync() }
        if let scheduledAt {
            let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = MailDates.zone; f.dateStyle = .medium; f.timeStyle = .short
            return "Wiadomość zostanie wysłana \(f.string(from: scheduledAt))"
        }
        return "Wiadomość wysłana!"
    }

    // MARK: Pozostałe czynności
    func employees(assignable: Bool) async -> [MailEmployee] {
        struct Reply: Decodable { let employees: [MailEmployee] }
        guard let api, let data = try? await api.get("/messages", query: ["op": "employees", "purpose": assignable ? "assign" : "all"]),
              let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return [] }
        return reply.employees
    }
    func inquiries(matching query: String) async -> [(id: String, title: String)]? {
        struct Row: Decodable { let id: String; let title: String }
        struct Reply: Decodable { let inquiries: [Row] }
        guard let api, let data = try? await api.get("/messages", query: ["op": "inquiries", "query": query]),
              let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return nil }
        return reply.inquiries.map { ($0.id, $0.title) }
    }
    /// Czynność zapisująca (przypisanie, zapytanie, zadanie); zwraca komunikat serwera.
    func perform(_ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/messages", body))
    }
    func reloadAfterChange(_ message: MessageItem) async {
        await sync()
        await refreshSales([message.key])
    }
    /// Zapytanie powiązane z wiadomością — natywny ekran Zapytań.
    func openInquiry(_ id: String) { workspace?.open(.inquiries, id: id) }
    func openInBrowser(_ message: MessageItem) { workspace?.openCRM("/crm/messages/\(message.id)?type=\(message.type)") }

    // MARK: Załączniki
    func attachments(for detail: MessageDetail) async -> (files: [MailAttachment], error: String?) {
        guard let api, detail.item.type == "received" || detail.item.type == "sent" else { return (detail.attachments, detail.attachmentsError) }
        struct Reply: Decodable { let attachments: [MailAttachment]?; let syncError: String? }
        do {
            let raw = try await api.bridge(detail.item.type == "sent" ? "/bridge/messages/sent-attachments" : "/bridge/messages/attachments", ["messageId": .string(detail.item.id)])
            let reply = try JSONDecoder().decode(Reply.self, from: try JSONEncoder().encode(raw))
            return (reply.attachments ?? detail.attachments, reply.syncError)
        } catch {
            return (detail.attachments, failureText(error, "Nie udało się pobrać załączników. Spróbuj ponownie."))
        }
    }
    /// Załącznik: pobrany raz i zapisany w zaszyfrowanej kopii; do podglądu Quick Look lub zapisu odszyfrowany do katalogu tymczasowego.
    func download(_ attachment: MailAttachment) async throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-zalaczniki/\(attachment.id)", isDirectory: true)
        let target = folder.appendingPathComponent(attachment.filename.replacingOccurrences(of: "/", with: "-"))
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let mirror = self.mirror
        var content: Data? = nil
        if let mirror { content = await Task.detached(priority: .userInitiated) { mirror.attachment(attachment.id) }.value }
        if content == nil {
            guard let api else { throw AppError.configuration }
            struct Reply: Decodable { let url: String }
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/messages", query: ["op": "attachment", "path": attachment.storage_path]))
            guard let url = URL(string: reply.url) else { throw AppError.invalidResponse }
            let (downloaded, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
            content = downloaded
            if let mirror { Task.detached(priority: .utility) { try? mirror.saveAttachment(attachment.id, downloaded) } }
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try content?.write(to: target, options: .atomic)
        return target
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure, !failure.message.isEmpty { return failure.message }
        if let error = error as? AppError { return error.localizedDescription }
        if error is URLError { return "Brak połączenia z serwerem CRM." }
        return fallback
    }
}
