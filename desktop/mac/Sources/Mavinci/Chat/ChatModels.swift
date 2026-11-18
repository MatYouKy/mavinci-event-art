import Foundation
import UniformTypeIdentifiers

// MARK: Komunikator — modele i reguły odczytu 1:1 z CRM (`src/components/crm/chat/*`, `src/lib/CRM/chat/chatReadState.ts`).
// Dane: `employee_conversations`, `employee_conversation_participants`, `employee_messages` (RLS jak w przeglądarce),
// liczniki i znaczniki w czasie serwera (`get_chat_unread_counts`, `mark_chat_read`, `mark_chat_delivered`), reakcje
// (`set_chat_message_reaction`), załączniki w koszyku `chat-attachments`.

/// Pracownik w rozmowie (`employees`: id, imię, nazwisko, pseudonim, zdjęcie).
struct ChatEmployee: Decodable, Hashable, Identifiable {
    let id: String
    let name: String?
    let surname: String?
    let nickname: String?
    let avatar_url: String?
    let role: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        surname = try? c.decodeIfPresent(String.self, forKey: .surname)
        nickname = try? c.decodeIfPresent(String.self, forKey: .nickname)
        avatar_url = try? c.decodeIfPresent(String.self, forKey: .avatar_url)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
    }
    enum CodingKeys: String, CodingKey { case id, name, surname, nickname, avatar_url, role }

    /// Pseudonim albo imię i nazwisko (jak `getDisplayName` w CRM).
    var displayName: String {
        if let nickname, !nickname.isEmpty { return nickname }
        let full = "\(name ?? "") \(surname ?? "")".trimmingCharacters(in: .whitespaces)
        return full.isEmpty ? "Pracownik" : full
    }
    /// Krótko: pseudonim albo imię.
    var shortName: String {
        if let nickname, !nickname.isEmpty { return nickname }
        if let name, !name.isEmpty { return name }
        return "Ktoś"
    }
    var fullName: String { "\(name ?? "") \(surname ?? "")".trimmingCharacters(in: .whitespaces) }
    var initials: String {
        let first = (nickname?.isEmpty == false ? nickname : name)?.first.map { String($0) } ?? ""
        let last = surname?.first.map { String($0) } ?? ""
        let value = (first + last).uppercased()
        return value.isEmpty ? "?" : value
    }
}

/// Znaczniki uczestnika: przeczytane i dostarczone (czas serwera).
struct ChatMarker: Equatable {
    var readAt: Date?
    var deliveredAt: Date?
}

struct ChatParticipant: Identifiable, Equatable {
    let id: String
    let conversationID: String
    let employeeID: String
    var marker: ChatMarker
    var employee: ChatEmployee?
}

struct ChatConversation: Identifiable, Equatable {
    let id: String
    var title: String?
    var isGroup: Bool
    var createdBy: String
    var lastMessageAt: Date?
    var lastMessagePreview: String?
    var lastMessageSenderID: String?
    var participants: [ChatParticipant]
    var unread: Int

    func others(_ me: String) -> [ChatParticipant] { participants.filter { $0.employeeID != me } }
    func other(_ me: String) -> ChatParticipant? { participants.first { $0.employeeID != me } }

    /// Nazwa rozmowy: tytuł grupy albo pozostali uczestnicy (jak `getConversationName`).
    func name(_ me: String) -> String {
        if let title, !title.isEmpty { return title }
        let names = others(me).map { $0.employee?.displayName ?? "Pracownik" }
        return names.isEmpty ? "Ty" : names.joined(separator: ", ")
    }
    func participantName(_ employeeID: String) -> String {
        participants.first { $0.employeeID == employeeID }?.employee?.shortName ?? "Ktoś"
    }
    var markers: [String: ChatMarker] {
        Dictionary(participants.map { ($0.employeeID, $0.marker) }, uniquingKeysWith: { first, _ in first })
    }
}

/// Reakcja na wiadomość (jedna na wiadomość, jak w CRM): emoji i autor.
struct ChatReaction: Equatable {
    let emoji: String
    let userID: String
}

struct ChatMessage: Decodable, Identifiable, Equatable {
    let id: String
    let conversationID: String
    let senderID: String
    var content: String
    var messageType: String
    var attachmentURL: String?
    var attachmentFilename: String?
    var attachmentSize: Int?
    var isEdited: Bool
    let createdRaw: String
    var reaction: ChatReaction?
    var created: Date { ChatDates.parse(createdRaw) ?? .distantPast }

    enum CodingKeys: String, CodingKey {
        case id, conversation_id, sender_id, content, message_type, attachment_url, attachment_filename, attachment_size, is_edited, created_at, reactions
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        conversationID = try c.decode(String.self, forKey: .conversation_id)
        senderID = try c.decode(String.self, forKey: .sender_id)
        content = (try? c.decodeIfPresent(String.self, forKey: .content)) ?? ""
        messageType = (try? c.decodeIfPresent(String.self, forKey: .message_type)) ?? "text"
        attachmentURL = try? c.decodeIfPresent(String.self, forKey: .attachment_url)
        attachmentFilename = try? c.decodeIfPresent(String.self, forKey: .attachment_filename)
        if let size = try? c.decodeIfPresent(Double.self, forKey: .attachment_size) { attachmentSize = Int(size) }
        else if let text = try? c.decodeIfPresent(String.self, forKey: .attachment_size) { attachmentSize = Int(text) }
        else { attachmentSize = nil }
        isEdited = (try? c.decodeIfPresent(Bool.self, forKey: .is_edited)) ?? false
        createdRaw = (try? c.decodeIfPresent(String.self, forKey: .created_at)) ?? ""
        reaction = ChatMessage.reaction(try? c.decodeIfPresent(JSONValue.self, forKey: .reactions))
    }

    /// `reactions` w bazie: `{}` (brak) albo `{emoji, user_id}`.
    static func reaction(_ value: JSONValue?) -> ChatReaction? {
        let object = value?.object ?? [:]
        let emoji = object["emoji"]?.text ?? ""
        let user = object["user_id"]?.text ?? ""
        return emoji.isEmpty ? nil : ChatReaction(emoji: emoji, userID: user)
    }

    /// Rekord z Realtime (`postgres_changes`) albo odpowiedzi serwera.
    static func from(_ json: JSONValue) -> ChatMessage? {
        guard let data = try? JSONEncoder().encode(json) else { return nil }
        return try? JSONDecoder().decode(ChatMessage.self, from: data)
    }

    var isImage: Bool {
        let name = (attachmentFilename ?? attachmentURL ?? "").lowercased()
        let url = (attachmentURL ?? "").lowercased()
        let pattern = #"\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)"#
        return messageType == "image" || name.range(of: pattern, options: .regularExpression) != nil || url.range(of: pattern, options: .regularExpression) != nil
    }
    var isVideo: Bool { messageType == "video" }
    var isPDF: Bool {
        let pattern = #"\.pdf(\?|$)"#
        return (attachmentFilename ?? "").lowercased().range(of: pattern, options: .regularExpression) != nil
            || (attachmentURL ?? "").lowercased().range(of: pattern, options: .regularExpression) != nil
    }
    /// Podpis pod załącznikiem (inny niż nazwa pliku) albo treść wiadomości tekstowej.
    var caption: String? {
        if messageType == "text" { return content.isEmpty ? nil : content }
        return !content.isEmpty && content != (attachmentFilename ?? "") ? content : nil
    }
}

// MARK: Reguły odczytu (`chatReadState.ts`)

enum ChatReceipt { case sent, delivered, read }

enum ChatRules {
    /// Wpisywanie tekstu: kanał Realtime (broadcast) wspólny dla CRM i aplikacji.
    static func typingTopic(_ conversationID: String) -> String { "chat_typing:\(conversationID)" }
    static let typingEvent = "typing"
    /// Jak często wysyłać sygnał „pisze…” i jak długo go pokazywać.
    static let typingSendInterval: TimeInterval = 2
    static let typingVisible: TimeInterval = 4.5
    static let pageSize = 20
    static let maxFileSize = 20 * 1024 * 1024
    static let reactions = ["❤️", "😂", "😮", "😢", "😡", "👍"]

    /// Status własnej wiadomości: wysłana, dostarczona albo wyświetlona.
    static func receipt(_ created: Date, markers: [String: ChatMarker], me: String) -> ChatReceipt {
        var delivered = false
        for (employeeID, marker) in markers where employeeID != me {
            if let read = marker.readAt, read >= created { return .read }
            if let at = marker.deliveredAt, at >= created { delivered = true }
        }
        return delivered ? .delivered : .sent
    }

    /// Pozostali uczestnicy, którzy przeczytali wiadomość wysłaną o `created`.
    static func readers(_ created: Date, markers: [String: ChatMarker], me: String) -> [String] {
        markers.filter { $0.key != me && ($0.value.readAt.map { $0 >= created } ?? false) }.map(\.key).sorted()
    }

    /// Jak w Messengerze: miniatura osoby pod ostatnią wiadomością, którą przeczytała (nie pod jej własną wiadomością).
    static func seenHeads(_ messages: [ChatMessage], markers: [String: ChatMarker], me: String) -> [String: [String]] {
        var heads: [String: [String]] = [:]
        for (employeeID, marker) in markers.sorted(by: { $0.key < $1.key }) where employeeID != me {
            guard let readAt = marker.readAt else { continue }
            for message in messages.reversed() {
                if message.created > readAt { continue }
                if message.senderID != employeeID { heads[message.id, default: []].append(employeeID) }
                break
            }
        }
        return heads
    }

    /// Przedrostek podglądu: „Ty: …”, a w grupie „Anna: …”.
    static func previewPrefix(_ conversation: ChatConversation, me: String) -> String {
        guard let sender = conversation.lastMessageSenderID else { return "" }
        if sender == me { return "Ty: " }
        guard conversation.isGroup else { return "" }
        let name = conversation.participants.first { $0.employeeID == sender }?.employee?.shortName
        return name.map { "\($0): " } ?? ""
    }

    /// Opis „pisze…” dla nagłówka rozmowy.
    static func typingLabel(_ names: [String], group: Bool) -> String {
        if names.isEmpty { return "" }
        if !group { return "pisze…" }
        if names.count == 1 { return "\(names[0]) pisze…" }
        return names.prefix(2).joined(separator: ", ") + (names.count > 2 ? " i inni" : "") + " piszą…"
    }

    /// Rodzaj wiadomości z typu pliku (jak `getMessageType`).
    static func messageType(_ mime: String) -> String {
        if ["image/jpeg", "image/png", "image/gif", "image/webp"].contains(mime) { return "image" }
        if ["video/mp4", "video/quicktime", "video/webm"].contains(mime) { return "video" }
        return "file"
    }

    static func mime(_ url: URL) -> String {
        UTType(filenameExtension: url.pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
    }

    static func fileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / 1024 / 1024)
    }
}

// MARK: Daty

enum ChatDates {
    private static let fractional: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain = ISO8601DateFormatter()
    private static let utc: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; f.timeZone = TimeZone(identifier: "UTC"); return f
    }()

    /// Znaczniki czasu z PostgREST i Realtime (`2026-11-18T20:30:00.123456+00:00`, `2026-11-18 20:30:00.123456+00`).
    static func parse(_ raw: String?) -> Date? {
        guard var value = raw?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
        value = value.replacingOccurrences(of: " ", with: "T")
        guard value.contains("T") else { return nil }
        if value.range(of: #"[+-]\d{2}$"#, options: .regularExpression) != nil { value += ":00" }
        // Ułamek sekundy dokładnie do milisekund (formatter czyta 3 cyfry; Postgres podaje do 6).
        if let dot = value.firstIndex(of: "."),
           let zone = value[value.index(after: dot)...].firstIndex(where: { $0 == "Z" || $0 == "+" || $0 == "-" }) {
            let fraction = String((String(value[value.index(after: dot)..<zone]) + "000").prefix(3))
            value = String(value[..<dot]) + "." + fraction + String(value[zone...])
        }
        return fractional.date(from: value) ?? plain.date(from: value)
    }

    /// Do filtrów PostgREST (`created_at=lt.…`) — UTC z „Z”, bez znaku „+” w adresie.
    static func query(_ date: Date) -> String { utc.string(from: date) }

    static func time(_ date: Date) -> String { MeetingDates.format(date, "HH:mm") }

    /// Lista rozmów: godzina dziś, „Wczoraj”, dzień tygodnia do 7 dni, potem „12 lis”.
    static func listLabel(_ date: Date?) -> String {
        guard let date else { return "" }
        let days = Int(Date().timeIntervalSince(date) / 86_400)
        if days <= 0 { return time(date) }
        if days == 1 { return "Wczoraj" }
        if days < 7 { return MeetingDates.format(date, "EEE") }
        return MeetingDates.format(date, "d MMM")
    }

    /// Separator dni w rozmowie: „Dzisiaj”, „Wczoraj”, „18 listopada 2026”.
    static func separator(_ date: Date) -> String {
        let calendar = MeetingDates.calendar
        if calendar.isDateInToday(date) { return "Dzisiaj" }
        if calendar.isDateInYesterday(date) { return "Wczoraj" }
        return MeetingDates.format(date, "d MMMM yyyy")
    }

    static func sameDay(_ a: Date, _ b: Date) -> Bool { MeetingDates.calendar.isDate(a, inSameDayAs: b) }
}
