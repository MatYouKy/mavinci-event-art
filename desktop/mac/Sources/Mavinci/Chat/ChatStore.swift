import Foundation
import SwiftUI
import AppKit
import Combine
import UserNotifications

// MARK: Komunikator — stan wspólny dla wszystkich okien (jak `ChatWidget` w CRM): rozmowy z licznikami z serwera, zmiany na żywo
// (Realtime), obecność (zielona kropka), „pisze…”, powiadomienia macOS z dźwiękiem i licznik na ikonie w Docku. Zasady jak
// w CRM i telefonie (`chatReadState.ts`): licznik liczy tylko wiadomości innych osób nowsze niż mój znacznik odczytu,
// „przeczytane” zapisujemy tylko, gdy rozmowa jest na ekranie, a aplikacja aktywna; w tle — „dostarczone”.
// Gdy połączenie Realtime nie działa, komunikator odpytuje serwer (rozmowy co 8 s, otwarta rozmowa co 4 s).

enum ChatEvent {
    case inserted(ChatMessage)
    case updated(ChatMessage)
    case marker(conversationID: String, employeeID: String, marker: ChatMarker)
    case typing(conversationID: String, employeeID: String)
    /// Odpytywanie (bez Realtime): w rozmowie pojawiły się nowe wiadomości.
    case refresh(conversationID: String)
}

/// Otwarcie komunikatora z zewnątrz (powiadomienie, „Czat” na karcie pracownika) — w oknie, w którym pracuje użytkownik.
struct ChatOpenRequest: Identifiable, Equatable {
    let id = UUID()
    var conversationID: String?
    var employeeID: String?
}

/// Widok panelu komunikatora w oknie: lista, rozmowa albo nowa rozmowa (z wybraną osobą).
enum ChatRoute: Equatable {
    case list
    case conversation(String)
    case new(String?)
}

struct ChatError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor final class ChatStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var conversations: [ChatConversation] = [] { didSet { updateBadge() } }
    @Published private(set) var loading = false
    @Published private(set) var loaded = false
    @Published var loadError: String?
    /// Zmiany przychodzą na żywo (Realtime); bez tego — odpytywanie.
    @Published private(set) var live = false
    @Published private(set) var online: Set<String> = []
    @Published var openRequest: ChatOpenRequest?
    let events = PassthroughSubject<ChatEvent, Never>()
    private(set) var me: String?

    private let realtime = ChatRealtime()
    private var started = false
    private var employeeCache: [String: ChatEmployee] = [:]
    private var poller: Task<Void, Never>?
    private var presenceTimer: Task<Void, Never>?
    private var recountJob: Task<Void, Never>?
    private var startedAt = Date()
    private var presence: [String: Set<String>] = [:]
    private var lastOnline: [String: Date] = [:]
    private var visible: [UUID: String] = [:]
    private var typingRefs: [String: Int] = [:]
    private var typingSent: [String: Date] = [:]
    private var activeObserver: NSObjectProtocol?

    static let changesTopic = "mavinci_chat_mac"
    static let presenceTopic = "presence:employees"

    var unreadTotal: Int { conversations.reduce(0) { $0 + $1.unread } }
    /// Komunikator działa na bazie Supabase (połączenie „Supabase” w ustawieniach aplikacji).
    var available: Bool { workspace?.connection.provider == .supabase && workspace?.connection.valid == true }

    // MARK: Sesja

    /// Start po zalogowaniu (każde okno wywołuje — działa raz na pracownika).
    func start() async {
        guard let workspace, let employee = workspace.employee else { return }
        guard available else { loadError = "Komunikator wymaga połączenia z bazą Supabase (Ustawienia → Połączenie)."; return }
        if started && me == employee.id {
            if !loaded && !loading { await reload() }
            return
        }
        if started { reset() }
        started = true
        me = employee.id
        startedAt = Date()
        ChatNotifier.shared.install(self)
        await reload()
        connect()
        startPolling()
        observeActivation()
    }

    /// Wylogowanie i zmiana konta.
    func reset() {
        realtime.stop()
        poller?.cancel(); poller = nil
        presenceTimer?.cancel(); presenceTimer = nil
        recountJob?.cancel(); recountJob = nil
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        activeObserver = nil
        started = false; me = nil; live = false
        conversations = []; loading = false; loaded = false; loadError = nil
        online = []; presence = [:]; lastOnline = [:]; visible = [:]; typingRefs = [:]; typingSent = [:]
        employeeCache = [:]; openRequest = nil
        ChatNotifier.shared.clear()
        NSApp.dockTile.badgeLabel = nil
    }

    private func updateBadge() {
        let total = unreadTotal
        NSApp.dockTile.badgeLabel = total > 0 ? (total > 99 ? "99+" : String(total)) : nil
    }

    // MARK: Serwer (PostgREST i funkcje bazy — token pracownika, RLS jak w CRM)

    private var backend: HTTPBackend? { workspace?.nativeAPI()?.backend }
    private static func q(_ name: String, _ value: String) -> URLQueryItem { URLQueryItem(name: name, value: value) }
    private static func list(_ ids: [String]) -> String { "in.(" + ids.joined(separator: ",") + ")" }
    static func int(_ value: JSONValue?) -> Int {
        switch value {
        case .number(let number): return Int(number)
        case .string(let text): return Int(text) ?? 0
        default: return 0
        }
    }

    private func rest(_ path: String, query: [URLQueryItem] = [], method: String? = nil, body: [String: JSONValue]? = nil, raw: Data? = nil) async throws -> Data {
        guard let backend else { throw AppError.configuration }
        return try await backend.request("/rest/v1/" + path, method: method, query: query, body: body, rawBody: raw, contentType: raw == nil ? nil : "application/json")
    }
    private func rpc(_ name: String, _ body: [String: JSONValue] = [:]) async throws -> Data { try await rest("rpc/" + name, body: body) }

    /// Wstawienie bez odczytu wierszy (`return=minimal`, jak `insert()` bez `select()` w CRM) — uczestnicy nowej rozmowy
    /// (pozostałych uczestników nie można odczytać w tym samym zapytaniu, więc odczyt zwrotny zostałby odrzucony).
    private func insertMinimal(_ table: String, _ body: Data) async throws {
        guard let workspace, let backend,
              let url = URL(string: workspace.connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/rest/v1/" + table) else { throw AppError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(workspace.connection.publicKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        request.httpBody = body
        let (_, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(status) else { throw ChatError("Nie udało się dodać uczestników rozmowy (HTTP \(status)).") }
    }

    private struct ConversationRow: Decodable {
        let id: String
        let title: String?
        let isGroup: Bool
        let createdBy: String
        let lastMessageAt: String?
        let lastMessagePreview: String?
        let lastMessageSenderID: String?
        enum CodingKeys: String, CodingKey { case id, title, is_group, created_by, last_message_at, last_message_preview, last_message_sender_id }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            title = try? c.decodeIfPresent(String.self, forKey: .title)
            isGroup = (try? c.decodeIfPresent(Bool.self, forKey: .is_group)) ?? false
            createdBy = (try? c.decodeIfPresent(String.self, forKey: .created_by)) ?? ""
            lastMessageAt = try? c.decodeIfPresent(String.self, forKey: .last_message_at)
            lastMessagePreview = try? c.decodeIfPresent(String.self, forKey: .last_message_preview)
            lastMessageSenderID = try? c.decodeIfPresent(String.self, forKey: .last_message_sender_id)
        }
    }
    private struct ParticipantRow: Decodable {
        let id: String
        let conversation_id: String
        let employee_id: String
        let last_read_at: String?
        let last_delivered_at: String?
        var marker: ChatMarker { ChatMarker(readAt: ChatDates.parse(last_read_at), deliveredAt: ChatDates.parse(last_delivered_at)) }
    }
    private struct Membership: Decodable { let conversation_id: String }

    private func myConversationIDs() async throws -> [String] {
        guard let me else { return [] }
        let rows = try JSONDecoder().decode([Membership].self, from: try await rest("employee_conversation_participants",
            query: [Self.q("select", "conversation_id"), Self.q("employee_id", "eq.\(me)")]))
        return Array(Set(rows.map(\.conversation_id))).sorted()
    }

    private func unreadCounts() async throws -> [String: Int] {
        struct Row: Decodable { let conversation_id: String; let unread_count: JSONValue? }
        let rows = try JSONDecoder().decode([Row].self, from: try await rpc("get_chat_unread_counts"))
        return Dictionary(rows.map { ($0.conversation_id, Self.int($0.unread_count)) }, uniquingKeysWith: { first, _ in first })
    }

    /// Pracownicy rozmów (pamięć sesji) — imię, pseudonim, zdjęcie.
    @discardableResult func loadEmployees(_ ids: [String]) async throws -> [String: ChatEmployee] {
        let missing = Array(Set(ids.filter { employeeCache[$0] == nil && UUID(uuidString: $0) != nil })).sorted()
        if !missing.isEmpty {
            for start in stride(from: 0, to: missing.count, by: 100) {
                let chunk = Array(missing[start..<min(start + 100, missing.count)])
                let rows = try JSONDecoder().decode([ChatEmployee].self, from: try await rest("employees",
                    query: [Self.q("select", "id,name,surname,nickname,avatar_url"), Self.q("id", Self.list(chunk))]))
                for row in rows { employeeCache[row.id] = row }
            }
        }
        return employeeCache
    }
    func employee(_ id: String) -> ChatEmployee? { employeeCache[id] }

    /// Rozmowy z uczestnikami i licznikami (jak `fetchConversations` w CRM); potem „dostarczono” dla wszystkich.
    func reload() async {
        guard let me else { return }
        if !loaded { loading = true }
        defer { loading = false }
        do {
            let ids = try await myConversationIDs()
            guard !ids.isEmpty else {
                guard me == self.me else { return }
                conversations = []; loaded = true; loadError = nil
                return
            }
            async let conversationData = rest("employee_conversations", query: [Self.q("select", "*"), Self.q("id", Self.list(ids)), Self.q("order", "last_message_at.desc")])
            async let participantData = rest("employee_conversation_participants",
                query: [Self.q("select", "id,conversation_id,employee_id,last_read_at,last_delivered_at"), Self.q("conversation_id", Self.list(ids))])
            async let countsTask = unreadCounts()
            let rows = try JSONDecoder().decode([ConversationRow].self, from: try await conversationData)
            let parts = try JSONDecoder().decode([ParticipantRow].self, from: try await participantData)
            let counts = (try? await countsTask) ?? [:]
            let employees = try await loadEmployees(parts.map(\.employee_id))
            guard me == self.me else { return }
            let grouped = Dictionary(grouping: parts, by: \.conversation_id)
            conversations = rows.map { row in
                ChatConversation(
                    id: row.id, title: row.title, isGroup: row.isGroup, createdBy: row.createdBy,
                    lastMessageAt: ChatDates.parse(row.lastMessageAt), lastMessagePreview: row.lastMessagePreview, lastMessageSenderID: row.lastMessageSenderID,
                    participants: (grouped[row.id] ?? []).map { part in
                        ChatParticipant(id: part.id, conversationID: part.conversation_id, employeeID: part.employee_id, marker: part.marker, employee: employees[part.employee_id])
                    },
                    unread: visibleNow(row.id) ? 0 : (counts[row.id] ?? 0))
            }
            .sorted { ($0.lastMessageAt ?? .distantPast) > ($1.lastMessageAt ?? .distantPast) }
            loaded = true
            loadError = nil
            // Aplikacja jest otwarta, więc wiadomości dotarły — nadawca zobaczy „Dostarczono”.
            Task { await self.markDelivered(nil) }
        } catch {
            guard me == self.me else { return }
            loadError = error is URLError ? "Brak połączenia — komunikator wczyta rozmowy po powrocie sieci." : "Nie udało się wczytać rozmów."
        }
    }

    /// Liczniki z serwera (po przeczytaniu w innym oknie, w CRM lub w telefonie) — z krótkim opóźnieniem, bez mnożenia zapytań.
    func recount() {
        recountJob?.cancel()
        recountJob = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
            guard let self, let counts = try? await self.unreadCounts() else { return }
            self.apply(counts)
        }
    }

    private func apply(_ counts: [String: Int]) {
        for index in conversations.indices {
            let id = conversations[index].id
            let value = visibleNow(id) ? 0 : (counts[id] ?? 0)
            if conversations[index].unread != value { conversations[index].unread = value }
        }
    }

    // MARK: Odczyt

    /// Okno rozmowy: rozmowa na ekranie (`nil` — panel zamknięty lub inna rozmowa).
    func setVisible(_ pane: UUID, conversation: String?) { visible[pane] = conversation }
    private func visibleNow(_ conversationID: String) -> Bool { NSApp.isActive && visible.values.contains(conversationID) }
    /// Rozmowa jest na ekranie, a aplikacja aktywna — wiadomość jest „wyświetlona”.
    func isViewing(_ conversationID: String) -> Bool { visibleNow(conversationID) }

    func markRead(_ conversationID: String) async {
        if let index = conversations.firstIndex(where: { $0.id == conversationID }), conversations[index].unread != 0 { conversations[index].unread = 0 }
        ChatNotifier.shared.dismiss(conversationID)
        _ = try? await rpc("mark_chat_read", ["p_conversation_id": .string(conversationID)])
    }

    func markDelivered(_ conversationID: String?) async {
        _ = try? await rpc("mark_chat_delivered", conversationID.map { ["p_conversation_id": .string($0)] } ?? [:])
    }

    // MARK: Wiadomości

    /// Strona wiadomości: najnowsze 20, starsze niż `before` albo nowsze niż `after` (odpytywanie).
    func messages(_ conversationID: String, before: Date? = nil, after: Date? = nil) async throws -> [ChatMessage] {
        var query = [Self.q("select", "*"), Self.q("conversation_id", "eq.\(conversationID)")]
        if let before { query.append(Self.q("created_at", "lt.\(ChatDates.query(before))")) }
        if let after {
            query += [Self.q("created_at", "gt.\(ChatDates.query(after))"), Self.q("order", "created_at.asc"), Self.q("limit", "200")]
        } else {
            query += [Self.q("order", "created_at.desc"), Self.q("limit", String(ChatRules.pageSize))]
        }
        let rows = try JSONDecoder().decode([ChatMessage].self, from: try await rest("employee_messages", query: query))
        _ = try? await loadEmployees(rows.map(\.senderID))
        return after == nil ? Array(rows.reversed()) : rows
    }

    func markers(_ conversationID: String) async throws -> [String: ChatMarker] {
        let rows = try JSONDecoder().decode([ParticipantRow].self, from: try await rest("employee_conversation_participants",
            query: [Self.q("select", "id,conversation_id,employee_id,last_read_at,last_delivered_at"), Self.q("conversation_id", "eq.\(conversationID)")]))
        return Dictionary(rows.map { ($0.employee_id, $0.marker) }, uniquingKeysWith: { first, _ in first })
    }

    /// Wysłanie tekstu i (opcjonalnie) załącznika — jak `sendMessage` w CRM: plik do `chat-attachments`, wiadomość, push do telefonów.
    func send(_ conversation: ChatConversation, text: String, file: URL?) async throws -> ChatMessage {
        guard let me, let workspace, workspace.employee?.id == me else {
            throw ChatError("Konto czatu nie odpowiada zalogowanemu użytkownikowi. Wyloguj się i zaloguj ponownie.")
        }
        var payload: [String: JSONValue] = [
            "conversation_id": .string(conversation.id), "sender_id": .string(me), "content": .string(text), "message_type": .string("text"),
        ]
        if let file {
            let upload = try await self.upload(file, conversationID: conversation.id)
            payload["content"] = .string(text.isEmpty ? upload.name : text)
            payload["message_type"] = .string(upload.type)
            payload["attachment_url"] = .string(upload.url)
            payload["attachment_filename"] = .string(upload.name)
            payload["attachment_size"] = .number(Double(upload.size))
        }
        let rows = try JSONDecoder().decode([ChatMessage].self, from: try await rest("employee_messages", query: [Self.q("select", "*")], body: payload))
        guard let message = rows.first else { throw AppError.invalidResponse }
        applyMessage(message)
        events.send(.inserted(message))
        triggerPush(message)
        return message
    }

    /// Plik do koszyka `chat-attachments` (do 20 MB) — publiczny adres jak w CRM.
    private func upload(_ file: URL, conversationID: String) async throws -> (url: String, name: String, size: Int, type: String) {
        guard let workspace, let backend else { throw AppError.configuration }
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        let data = try await Task.detached(priority: .userInitiated) { try Data(contentsOf: file) }.value
        guard data.count <= ChatRules.maxFileSize else { throw ChatError("Plik jest zbyt duży. Maksymalny rozmiar: 20 MB.") }
        let mime = ChatRules.mime(file)
        let ext = file.pathExtension.isEmpty ? "bin" : file.pathExtension.lowercased()
        let random = String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(6))
        let path = "\(conversationID)/\(Int(Date().timeIntervalSince1970 * 1000))_\(random).\(ext)"
        do {
            _ = try await backend.request("/storage/v1/object/chat-attachments/\(path)", method: "POST", rawBody: data, contentType: mime)
        } catch {
            throw ChatError("Nie udało się przesłać pliku. Spróbuj ponownie.")
        }
        let base = workspace.connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        return ("\(base)/storage/v1/object/public/chat-attachments/\(path)", file.lastPathComponent, data.count, ChatRules.messageType(mime))
    }

    /// Powiadomienie push na telefony uczestników (`send-chat-push`) — jak po wysłaniu z CRM i z telefonu.
    private func triggerPush(_ message: ChatMessage) {
        guard let workspace, let url = URL(string: workspace.connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/functions/v1/send-chat-push") else { return }
        let record: [String: JSONValue] = [
            "id": .string(message.id), "conversation_id": .string(message.conversationID), "sender_id": .string(message.senderID),
            "content": .string(message.content), "message_type": .string(message.messageType), "created_at": .string(message.createdRaw),
        ]
        let body: [String: JSONValue] = ["type": .string("INSERT"), "table": .string("employee_messages"), "schema": .string("public"), "record": .object(record), "old_record": .null]
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(workspace.connection.publicKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONEncoder().encode(body)
        let prepared = request
        Task.detached { _ = try? await URLSession.shared.data(for: prepared) }
    }

    /// Reakcja na własną lub cudzą wiadomość (`set_chat_message_reaction`); `nil` usuwa moją reakcję.
    func react(_ messageID: String, emoji: String?) async throws -> ChatReaction? {
        let data = try await rpc("set_chat_message_reaction", ["p_message_id": .string(messageID), "p_emoji": emoji.map { JSONValue.string($0) } ?? .null])
        return ChatMessage.reaction(try? JSONDecoder().decode(JSONValue.self, from: data))
    }

    // MARK: Nowa rozmowa

    /// Aktywni pracownicy poza mną (jak `ChatNewConversation`).
    func colleagues() async throws -> [ChatEmployee] {
        guard let me else { return [] }
        let rows = try JSONDecoder().decode([ChatEmployee].self, from: try await rest("employees", query: [
            Self.q("select", "id,name,surname,nickname,avatar_url,role"), Self.q("id", "neq.\(me)"), Self.q("is_active", "eq.true"), Self.q("order", "name.asc"),
        ]))
        for row in rows where employeeCache[row.id] == nil { employeeCache[row.id] = row }
        return rows
    }

    /// Istniejąca rozmowa 1:1 z pracownikiem (na liście).
    func direct(with employeeID: String) -> ChatConversation? {
        conversations.first { !$0.isGroup && $0.participants.count == 2 && $0.participants.contains { $0.employeeID == employeeID } }
    }

    /// Nowa rozmowa (1:1 — najpierw istniejąca, także spoza listy) albo grupa z nazwą.
    func createConversation(with employeeIDs: [String], title: String) async throws -> ChatConversation {
        guard let me, !employeeIDs.isEmpty else { throw ChatError("Wybierz co najmniej jedną osobę.") }
        if employeeIDs.count == 1 {
            if let existing = direct(with: employeeIDs[0]) { return existing }
            let mine = try await myConversationIDs()
            if !mine.isEmpty {
                let shared = try JSONDecoder().decode([Membership].self, from: try await rest("employee_conversation_participants",
                    query: [Self.q("select", "conversation_id"), Self.q("employee_id", "eq.\(employeeIDs[0])"), Self.q("conversation_id", Self.list(mine))]))
                if !shared.isEmpty {
                    let rows = try JSONDecoder().decode([ConversationRow].self, from: try await rest("employee_conversations",
                        query: [Self.q("select", "*"), Self.q("id", Self.list(shared.map(\.conversation_id))), Self.q("is_group", "eq.false")]))
                    if let existing = rows.first {
                        await reload()
                        if let found = conversations.first(where: { $0.id == existing.id }) { return found }
                    }
                }
            }
        }
        let group = employeeIDs.count > 1
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let created = try JSONDecoder().decode([ConversationRow].self, from: try await rest("employee_conversations", query: [Self.q("select", "*")], body: [
            "title": group && !name.isEmpty ? .string(name) : .null, "is_group": .bool(group), "created_by": .string(me),
        ]))
        guard let conversation = created.first else { throw AppError.invalidResponse }
        let participants: [[String: String]] = ([me] + employeeIDs).map { ["conversation_id": conversation.id, "employee_id": $0] }
        try await insertMinimal("employee_conversation_participants", try JSONEncoder().encode(participants))
        await reload()
        if let found = conversations.first(where: { $0.id == conversation.id }) { return found }
        let employees = try await loadEmployees([me] + employeeIDs)
        return ChatConversation(id: conversation.id, title: conversation.title, isGroup: group, createdBy: me, lastMessageAt: ChatDates.parse(conversation.lastMessageAt),
                                lastMessagePreview: nil, lastMessageSenderID: nil,
                                participants: ([me] + employeeIDs).map { ChatParticipant(id: UUID().uuidString, conversationID: conversation.id, employeeID: $0, marker: ChatMarker(), employee: employees[$0]) },
                                unread: 0)
    }

    // MARK: Realtime

    private func connect() {
        guard let workspace, let me, let backend,
              let endpoint = ChatRealtime.endpoint(supabaseURL: workspace.connection.url, apiKey: workspace.connection.publicKey) else { return }
        realtime.onEvent = { [weak self] topic, event, payload in self?.handle(topic: topic, event: event, payload: payload) }
        realtime.onChannel = { [weak self] topic, joined in self?.channel(topic, joined: joined) }
        realtime.start(endpoint: endpoint) { try await backend.token() }
        realtime.join(Self.changesTopic, config: [
            "broadcast": .object(["ack": .bool(false), "self": .bool(false)]),
            "presence": .object(["key": .string(""), "enabled": .bool(false)]),
            "postgres_changes": .array([
                .object(["event": .string("INSERT"), "schema": .string("public"), "table": .string("employee_messages")]),
                .object(["event": .string("UPDATE"), "schema": .string("public"), "table": .string("employee_messages")]),
                .object(["event": .string("UPDATE"), "schema": .string("public"), "table": .string("employee_conversation_participants")]),
            ]),
            "private": .bool(false),
        ])
        // Obecność jak `presence:employees` w CRM (klucz — pracownik) — zielona kropka u innych i tutaj.
        realtime.join(Self.presenceTopic, config: [
            "broadcast": .object(["ack": .bool(false), "self": .bool(false)]),
            "presence": .object(["key": .string(me), "enabled": .bool(true)]),
            "postgres_changes": .array([]),
            "private": .bool(false),
        ])
    }

    private func channel(_ topic: String, joined: Bool) {
        if topic == Self.changesTopic {
            live = joined
            // Po (ponownym) połączeniu mogło coś umknąć.
            if joined { recount(); Task { await self.poll() } }
        } else if topic == Self.presenceTopic {
            if joined { trackPresence() } else { presence = [:]; refreshOnline() }
        }
    }

    private func handle(topic: String, event: String, payload: [String: JSONValue]) {
        if topic == Self.changesTopic {
            if event == "system" {
                // Potwierdzenie albo błąd subskrypcji zmian w tabelach.
                if payload["extension"]?.text == "postgres_changes" || payload["status"] != nil {
                    live = payload["status"]?.text != "error"
                }
                return
            }
            guard event == "postgres_changes" else { return }
            let data = payload["data"]?.object ?? [:]
            let table = data["table"]?.text ?? ""
            let type = data["type"]?.text ?? ""
            let record = data["record"] ?? .null
            if table == "employee_messages", let message = ChatMessage.from(record) {
                if type == "INSERT" { received(message) } else if type == "UPDATE" { events.send(.updated(message)) }
            } else if table == "employee_conversation_participants", type == "UPDATE" {
                let row = record.object
                let conversationID = row["conversation_id"]?.text ?? ""
                let employeeID = row["employee_id"]?.text ?? ""
                guard !conversationID.isEmpty, !employeeID.isEmpty else { return }
                updateMarker(conversationID, employeeID, ChatMarker(readAt: ChatDates.parse(row["last_read_at"]?.text), deliveredAt: ChatDates.parse(row["last_delivered_at"]?.text)))
            }
        } else if topic == Self.presenceTopic {
            if event == "presence_state" {
                presence = [:]
                mergePresence(joins: payload, leaves: [:])
            } else if event == "presence_diff" {
                mergePresence(joins: payload["joins"]?.object ?? [:], leaves: payload["leaves"]?.object ?? [:])
            }
        } else if topic.hasPrefix("chat_typing:"), event == "broadcast" {
            let conversationID = String(topic.dropFirst("chat_typing:".count))
            guard payload["event"]?.text == ChatRules.typingEvent,
                  let employeeID = payload["payload"]?.object["employee_id"]?.text, !employeeID.isEmpty, employeeID != me else { return }
            events.send(.typing(conversationID: conversationID, employeeID: employeeID))
        }
    }

    /// Nowa wiadomość (Realtime): lista, licznik, „dostarczono”, dźwięk i powiadomienie (jak `ChatWidget`).
    private func received(_ message: ChatMessage) {
        guard let me else { return }
        events.send(.inserted(message))
        let own = message.senderID == me
        guard conversations.contains(where: { $0.id == message.conversationID }) else {
            // Nowa rozmowa, w której mnie dodano.
            Task {
                await self.reload()
                if !own && !self.isViewing(message.conversationID) && message.created >= self.startedAt { self.notify(message.conversationID, sender: message.senderID, text: Self.preview(message)) }
            }
            return
        }
        applyMessage(message)
        if !own && !isViewing(message.conversationID) {
            Task { await self.markDelivered(message.conversationID) }
            if message.created >= startedAt { notify(message.conversationID, sender: message.senderID, text: Self.preview(message)) }
        }
    }

    /// Ostatnia wiadomość na liście; własna zeruje licznik (jak w Messengerze), cudza w tle go zwiększa.
    private func applyMessage(_ message: ChatMessage) {
        guard let me, let index = conversations.firstIndex(where: { $0.id == message.conversationID }) else { return }
        var conversation = conversations[index]
        // Ta sama wiadomość mogła już przyjść (wysłana tutaj, potem Realtime).
        let isNew = (conversation.lastMessageAt ?? .distantPast) < message.created || conversation.lastMessageSenderID != message.senderID
        conversation.lastMessageAt = max(conversation.lastMessageAt ?? .distantPast, message.created)
        conversation.lastMessagePreview = String(message.content.prefix(100))
        conversation.lastMessageSenderID = message.senderID
        if message.senderID == me { conversation.unread = 0 }
        else if isNew && !isViewing(message.conversationID) { conversation.unread += 1 }
        conversations[index] = conversation
        conversations.sort { ($0.lastMessageAt ?? .distantPast) > ($1.lastMessageAt ?? .distantPast) }
    }

    private static func preview(_ message: ChatMessage) -> String {
        message.content.isEmpty ? (message.attachmentFilename ?? "Nowa wiadomość") : String(message.content.prefix(150))
    }

    private func updateMarker(_ conversationID: String, _ employeeID: String, _ marker: ChatMarker) {
        if let c = conversations.firstIndex(where: { $0.id == conversationID }),
           let p = conversations[c].participants.firstIndex(where: { $0.employeeID == employeeID }),
           conversations[c].participants[p].marker != marker {
            conversations[c].participants[p].marker = marker
        }
        events.send(.marker(conversationID: conversationID, employeeID: employeeID, marker: marker))
        // Mój znacznik zmienił się (to okno, CRM, telefon) — licznik z serwera.
        if employeeID == me { recount() }
    }

    /// Dźwięk (aplikacja na wierzchu) i powiadomienie macOS (z dźwiękiem, gdy aplikacja jest w tle).
    private func notify(_ conversationID: String, sender: String?, text: String) {
        guard let me, sender != me else { return }
        let conversation = conversations.first { $0.id == conversationID }
        let senderName = sender.flatMap { id in conversation?.participants.first { $0.employeeID == id }?.employee ?? employeeCache[id] }?.displayName ?? "Nowa wiadomość"
        let groupTitle = conversation?.isGroup == true ? conversation?.title?.nonEmpty : nil
        let active = NSApp.isActive
        if active { NSSound(named: NSSound.Name("Pop"))?.play() }
        ChatNotifier.shared.post(title: groupTitle ?? senderName, body: groupTitle != nil ? "\(senderName): \(text)" : text, conversationID: conversationID, sound: !active)
    }

    // MARK: Obecność

    private func mergePresence(joins: [String: JSONValue], leaves: [String: JSONValue]) {
        for (key, value) in joins {
            let refs = (value.object["metas"]?.array ?? []).map { $0.object["phx_ref"]?.text.nonEmpty ?? UUID().uuidString }
            presence[key, default: []].formUnion(refs.isEmpty ? [UUID().uuidString] : refs)
        }
        var left = false
        for (key, value) in leaves {
            let refs = (value.object["metas"]?.array ?? []).compactMap { $0.object["phx_ref"]?.text.nonEmpty }
            presence[key]?.subtract(refs)
            if presence[key]?.isEmpty == true { presence[key] = nil; left = true }
        }
        refreshOnline()
        // Po 10 s (jak w CRM) osoba, która wyszła, przestaje być „online”.
        if left {
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 10_500_000_000)
                self?.objectWillChange.send()
            }
        }
    }

    private func refreshOnline() {
        let now = Date()
        for key in presence.keys { lastOnline[key] = now }
        online = Set(presence.keys)
    }

    /// Jak `isOnline` w CRM: obecny albo widziany w ciągu ostatnich 10 s.
    func isOnline(_ employeeID: String) -> Bool {
        if online.contains(employeeID) { return true }
        guard let last = lastOnline[employeeID] else { return false }
        return Date().timeIntervalSince(last) <= 10
    }

    private func trackPresence() {
        sendPresence()
        presenceTimer?.cancel()
        presenceTimer = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
                guard let self else { return }
                if NSApp.isActive { self.sendPresence() }
            }
        }
    }

    private func sendPresence() {
        guard let me else { return }
        realtime.track(Self.presenceTopic, meta: ["employee_id": .string(me), "at": .string(ChatDates.query(Date())), "active": .bool(NSApp.isActive)])
    }

    // MARK: „pisze…”

    func joinTyping(_ conversationID: String) {
        let topic = ChatRules.typingTopic(conversationID)
        typingRefs[conversationID, default: 0] += 1
        guard typingRefs[conversationID] == 1 else { return }
        realtime.join(topic, config: [
            "broadcast": .object(["ack": .bool(false), "self": .bool(false)]),
            "presence": .object(["key": .string(""), "enabled": .bool(false)]),
            "postgres_changes": .array([]),
            "private": .bool(false),
        ])
    }

    func leaveTyping(_ conversationID: String) {
        guard let count = typingRefs[conversationID] else { return }
        if count > 1 { typingRefs[conversationID] = count - 1; return }
        typingRefs[conversationID] = nil
        typingSent[conversationID] = nil
        realtime.leave(ChatRules.typingTopic(conversationID))
    }

    /// Sygnał „pisze…” najwyżej co 2 s (jak w CRM).
    func sendTyping(_ conversationID: String) {
        guard let me else { return }
        let now = Date()
        if let last = typingSent[conversationID], now.timeIntervalSince(last) < ChatRules.typingSendInterval { return }
        typingSent[conversationID] = now
        realtime.broadcast(ChatRules.typingTopic(conversationID), event: ChatRules.typingEvent, payload: ["employee_id": .string(me)])
    }

    func resetTyping(_ conversationID: String) { typingSent[conversationID] = nil }

    // MARK: Odpytywanie (bez Realtime) i powrót do aplikacji

    private func startPolling() {
        poller?.cancel()
        poller = Task { [weak self] in
            while !Task.isCancelled {
                let seconds: UInt64 = (self?.live ?? false) ? 60 : 8
                do { try await Task.sleep(nanoseconds: seconds * 1_000_000_000) } catch { return }
                guard let self else { return }
                await self.poll()
            }
        }
    }

    /// Nowe rozmowy, ostatnie wiadomości, znaczniki i liczniki z serwera.
    private func poll() async {
        guard let me, loaded else { return }
        do {
            let ids = try await myConversationIDs()
            guard me == self.me else { return }
            if Set(ids) != Set(conversations.map(\.id)) {
                let known = Set(conversations.map(\.id))
                await reload()
                if !live {
                    for conversation in conversations where !known.contains(conversation.id) && conversation.lastMessageSenderID != me && conversation.lastMessageSenderID != nil {
                        notify(conversation.id, sender: conversation.lastMessageSenderID, text: conversation.lastMessagePreview ?? "Nowa wiadomość")
                    }
                }
                return
            }
            guard !ids.isEmpty else { return }
            async let rowsData = rest("employee_conversations", query: [Self.q("select", "id,last_message_at,last_message_preview,last_message_sender_id"), Self.q("id", Self.list(ids))])
            async let partsData = rest("employee_conversation_participants",
                query: [Self.q("select", "id,conversation_id,employee_id,last_read_at,last_delivered_at"), Self.q("conversation_id", Self.list(ids))])
            async let countsTask = unreadCounts()
            let rows = try JSONDecoder().decode([ConversationRow].self, from: try await rowsData)
            let parts = try JSONDecoder().decode([ParticipantRow].self, from: try await partsData)
            let counts = try await countsTask
            guard me == self.me else { return }
            for row in rows {
                guard let index = conversations.firstIndex(where: { $0.id == row.id }), let at = ChatDates.parse(row.lastMessageAt),
                      at > (conversations[index].lastMessageAt ?? .distantPast) else { continue }
                conversations[index].lastMessageAt = at
                conversations[index].lastMessagePreview = row.lastMessagePreview
                conversations[index].lastMessageSenderID = row.lastMessageSenderID
                events.send(.refresh(conversationID: row.id))
                if !live && row.lastMessageSenderID != me && !isViewing(row.id) {
                    Task { await self.markDelivered(row.id) }
                    notify(row.id, sender: row.lastMessageSenderID, text: row.lastMessagePreview ?? "Nowa wiadomość")
                }
            }
            for part in parts {
                if let c = conversations.firstIndex(where: { $0.id == part.conversation_id }),
                   let p = conversations[c].participants.firstIndex(where: { $0.employeeID == part.employee_id }),
                   conversations[c].participants[p].marker != part.marker {
                    conversations[c].participants[p].marker = part.marker
                    events.send(.marker(conversationID: part.conversation_id, employeeID: part.employee_id, marker: part.marker))
                }
            }
            apply(counts)
            conversations.sort { ($0.lastMessageAt ?? .distantPast) > ($1.lastMessageAt ?? .distantPast) }
        } catch {
            // Cicho — kolejna próba przy następnym odpytaniu.
        }
    }

    private func observeActivation() {
        guard activeObserver == nil else { return }
        activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.me != nil else { return }
                self.recount()
                await self.markDelivered(nil)
                self.sendPresence()
            }
        }
    }
}

extension Workspace {
    /// Komunikator w oknie, w którym pracuje użytkownik (menu Mavinci → Komunikator).
    func toggleChat() {
        let nav = activeNavigation
        nav.chatOpen.toggle()
        nav.chatMinimized = false
    }

    /// Otwarcie komunikatora z rozmową albo z pracownikiem (istniejąca rozmowa 1:1 albo nowa z tą osobą).
    func openChat(conversationID: String? = nil, employeeID: String? = nil) {
        chat.openRequest = ChatOpenRequest(conversationID: conversationID, employeeID: employeeID)
    }
}

// MARK: Powiadomienia macOS

/// Powiadomienia o wiadomościach (jak powiadomienia przeglądarki w CRM): tytuł — nadawca lub grupa, treść — początek wiadomości;
/// kliknięcie otwiera rozmowę. Jedno powiadomienie na rozmowę (kolejne je zastępuje), przeczytanie rozmowy je usuwa.
@MainActor final class ChatNotifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ChatNotifier()
    private weak var store: ChatStore?
    private var installed = false
    /// Powiadomienia działają tylko w zbudowanej aplikacji (.app), nie przy `swift run`.
    private var bundled: Bool { Bundle.main.bundleURL.pathExtension == "app" && Bundle.main.bundleIdentifier != nil }

    func install(_ store: ChatStore) {
        self.store = store
        guard bundled, !installed else { return }
        installed = true
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func post(title: String, body: String, conversationID: String, sound: Bool) {
        guard bundled else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.threadIdentifier = "chat-\(conversationID)"
        content.userInfo = ["conversation": conversationID]
        if sound { content.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "chat-\(conversationID)", content: content, trigger: nil))
    }

    func dismiss(_ conversationID: String) {
        guard bundled else { return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["chat-\(conversationID)"])
    }

    func clear() {
        guard bundled else { return }
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { notifications in
            let ids = notifications.map(\.request.identifier).filter { $0.hasPrefix("chat-") }
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let conversationID = response.notification.request.content.userInfo["conversation"] as? String
        Task { @MainActor in
            NSApp.activate(ignoringOtherApps: true)
            if let conversationID, let workspace = ChatNotifier.shared.store?.workspace { workspace.openChat(conversationID: conversationID) }
        }
        completionHandler()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
}
