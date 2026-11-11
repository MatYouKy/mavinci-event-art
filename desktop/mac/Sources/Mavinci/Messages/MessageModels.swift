import Foundation

/// Wiadomości CRM (`/bridge/native/v1/messages`) — te same dane co strona `/crm/messages`.
enum MessageFolder: String, CaseIterable, Identifiable {
    case all, contact_form, received, sent, drafts, trash
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "Wszystkie wiadomości"
        case .contact_form: return "Formularz kontaktowy"
        case .received: return "Odebrane"
        case .sent: return "Wysłane"
        case .drafts: return "Wersje robocze"
        case .trash: return "Kosz"
        }
    }
    var symbol: String {
        switch self {
        case .all: return "envelope"
        case .contact_form: return "list.bullet.rectangle"
        case .received: return "tray"
        case .sent: return "paperplane"
        case .drafts: return "doc"
        case .trash: return "trash"
        }
    }
    static let mailbox: [MessageFolder] = [.received, .sent, .drafts, .trash]
}

struct MailAccount: Codable, Identifiable, Equatable {
    let id: String
    let email_address: String
    let account_name: String?
    let display_name: String?
    let account_type: String?
    let can_send: Bool?
    var name: String { display_name ?? account_name ?? email_address }
    var plainName: String { account_name ?? email_address }
}

struct UnreadCounts: Codable, Equatable {
    var total: Int
    var contactForm: Int
    var byAccount: [String: Int]
    static let empty = UnreadCounts(total: 0, contactForm: 0, byAccount: [:])
}

struct MailboxInfo: Codable {
    var accounts: [MailAccount]
    let hasContactFormAccess: Bool
    let isAdmin: Bool
    let canManage: Bool
    let canView: Bool
    let canCreateTasks: Bool
    let employeeId: String
    var unread: UnreadCounts
    let trashMailboxIds: [String]
    var mailboxOrder: [String]
    let mutedMailboxIds: [String]?
    var mailboxes: [MailAccount] { accounts.filter { $0.id != "all" && $0.id != "contact_form" } }
    var sendingAccounts: [MailAccount] { mailboxes.filter { $0.can_send == true } }
    var hasContactForm: Bool { accounts.contains { $0.id == "contact_form" } }
    var hasAll: Bool { accounts.contains { $0.id == "all" } }
    /// Kolejność skrzynek zapisana w CRM (`preferences.messages.mailboxOrder`), nowe skrzynki na końcu.
    var orderedMailboxes: [MailAccount] {
        let byID = Dictionary(uniqueKeysWithValues: mailboxes.map { ($0.id, $0) })
        let order = mailboxOrder.filter { byID[$0] != nil } + mailboxes.map(\.id).filter { !mailboxOrder.contains($0) }
        return order.compactMap { byID[$0] }
    }
}

struct SalesInquiry: Codable, Equatable {
    let id: String
    let stage: String?
    let ownerId: String?
    let ownerName: String?
    let archived: Bool?
}

struct SalesContext: Codable, Equatable {
    let inquiries: [SalesInquiry]
    let aiStatus: String?
    let available: Bool
    var hasInquiry: Bool { available && !inquiries.isEmpty }
    /// Potwierdzone zapytanie z puli bez opiekuna — można się do niego przypisać (`canClaimMessageInquiry`).
    var canClaim: Bool {
        guard hasInquiry, inquiries.count == 1, let inquiry = inquiries.first else { return false }
        return inquiry.ownerId == nil && inquiry.archived != true && !["won", "lost"].contains(inquiry.stage ?? "")
    }
    static let stages = ["new": "Nowe", "contacted": "Kontakt", "qualified": "Zakwalifikowane", "offer": "Oferta", "negotiation": "Negocjacje", "won": "Wygrane", "lost": "Przegrane"]
    var aiLabel: String? {
        ["pending": "AI: oczekuje", "processing": "AI: analizuje", "classified": "AI: przeanalizowano",
         "manual_review": "AI: wymaga sprawdzenia", "failed": "AI: analiza nieudana",
         "skipped_continuation": "Kontynuacja / istniejące zapytanie"][aiStatus ?? ""]
    }
}

struct PersonName: Codable, Equatable {
    let name: String?
    let surname: String?
    var full: String { [name, surname].compactMap { $0 }.joined(separator: " ") }
}

struct MailAttachment: Codable, Identifiable, Equatable {
    let id: String
    let filename: String
    let content_type: String?
    let size_bytes: Double?
    let storage_path: String
    var sizeLabel: String { String(format: "%.1f KB", (size_bytes ?? 0) / 1024) }
}

/// Pozycja listy (`MessageListItem`); klucz `typ:id`, bo identyfikatory pochodzą z różnych tabel. Zapisywana w kopii na dysku.
struct MessageItem: Codable, Identifiable, Equatable {
    let id: String
    let type: String
    let from: String
    let to: String
    let subject: String
    let subjectLabel: String
    var preview: String
    let date: String
    var isRead: Bool
    var isStarred: Bool
    let assigned_to: String?
    let assigned_employee: PersonName?
    let email_account_id: String?
    var isDeleted: Bool
    let status: String?
    var sales: SalesContext?
    var key: String { "\(type):\(id)" }
    var inbound: Bool { type == "received" || type == "contact_form" }
    var typeLabel: String {
        switch type {
        case "contact_form": return "Formularz"
        case "sent": return "Wysłane"
        case "received": return "Odebrane"
        case "draft": return "Wersja robocza"
        default: return type
        }
    }
    var counterpart: String { type == "sent" ? "Do: \(to.trimmingCharacters(in: .whitespaces).isEmpty ? "Nie podano odbiorcy" : to)" : from }
    enum CodingKeys: String, CodingKey { case id, type, from, to, subject, subjectLabel, preview, date, isRead, isStarred, status, assigned_to, assigned_employee, email_account_id, isDeleted, sales }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(String.self, forKey: .type)
        from = MessageItem.text(try c.decodeIfPresent(JSONValue.self, forKey: .from))
        to = MessageItem.text(try c.decodeIfPresent(JSONValue.self, forKey: .to))
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) ?? ""
        subjectLabel = (try? c.decodeIfPresent(String.self, forKey: .subjectLabel)) ?? subject
        preview = (try? c.decodeIfPresent(String.self, forKey: .preview)) ?? ""
        date = (try? c.decodeIfPresent(String.self, forKey: .date)) ?? ""
        isRead = (try? c.decodeIfPresent(Bool.self, forKey: .isRead)) ?? true
        isStarred = (try? c.decodeIfPresent(Bool.self, forKey: .isStarred)) ?? false
        assigned_to = try? c.decodeIfPresent(String.self, forKey: .assigned_to)
        assigned_employee = try? c.decodeIfPresent(PersonName.self, forKey: .assigned_employee)
        email_account_id = try? c.decodeIfPresent(String.self, forKey: .email_account_id)
        isDeleted = (try? c.decodeIfPresent(Bool.self, forKey: .isDeleted)) ?? false
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        sales = try? c.decodeIfPresent(SalesContext.self, forKey: .sales)
    }
    /// Zapis w kopii na dysku — bez lejka sprzedaży (przechowywany osobno i odświeżany niezależnie).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(type, forKey: .type)
        try c.encode(from, forKey: .from); try c.encode(to, forKey: .to)
        try c.encode(subject, forKey: .subject); try c.encode(subjectLabel, forKey: .subjectLabel)
        try c.encode(preview, forKey: .preview); try c.encode(date, forKey: .date)
        try c.encode(isRead, forKey: .isRead); try c.encode(isStarred, forKey: .isStarred)
        try c.encodeIfPresent(status, forKey: .status)
        try c.encodeIfPresent(assigned_to, forKey: .assigned_to); try c.encodeIfPresent(assigned_employee, forKey: .assigned_employee)
        try c.encodeIfPresent(email_account_id, forKey: .email_account_id); try c.encode(isDeleted, forKey: .isDeleted)
    }
    static func text(_ value: JSONValue?) -> String {
        switch value {
        case .string(let v): return v
        case .array(let v): return v.map(\.text).filter { !$0.isEmpty }.joined(separator: ", ")
        case .number(let v): return String(v)
        default: return ""
        }
    }
}

/// Szczegóły z podglądem HTML gotowym do `WKWebView` (bez skryptów, z obrazami stopki).
struct MessageDetail: Decodable, Equatable {
    let item: MessageItem
    let body: String
    let html: String?
    /// Treść bez własnych kolorów i tła — w ciemnym motywie pokazywana na ciemnym tle.
    let plain: Bool
    let attachments: [MailAttachment]
    let attachmentsError: String?
    let replyAddress: String
    let cc: String
    let employeeId: String?
    let phone: String?
    let deliveryArchive: JSONValue?
    struct Reply: Decodable { let message: MessageDetail }
    enum CodingKeys: String, CodingKey { case body, html, plain, attachments, attachmentsError, replyAddress, cc, employeeId, phone, deliveryArchive }
    init(from decoder: Decoder) throws {
        item = try MessageItem(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        body = (try? c.decodeIfPresent(String.self, forKey: .body)) ?? ""
        html = try? c.decodeIfPresent(String.self, forKey: .html)
        plain = (try? c.decodeIfPresent(Bool.self, forKey: .plain)) ?? false
        attachments = (try? c.decodeIfPresent([MailAttachment].self, forKey: .attachments)) ?? []
        attachmentsError = try? c.decodeIfPresent(String.self, forKey: .attachmentsError)
        replyAddress = (try? c.decodeIfPresent(String.self, forKey: .replyAddress)) ?? ""
        cc = MessageItem.text(try? c.decodeIfPresent(JSONValue.self, forKey: .cc))
        employeeId = try? c.decodeIfPresent(String.self, forKey: .employeeId)
        phone = try? c.decodeIfPresent(String.self, forKey: .phone)
        deliveryArchive = try? c.decodeIfPresent(JSONValue.self, forKey: .deliveryArchive)
    }
}

struct MailEmployee: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let surname: String?
    let email: String?
    var full: String { [name, surname].compactMap { $0 }.joined(separator: " ") }
}

enum MailDates {
    static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    private static let fractional: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? plain.date(from: value)
            ?? plain.date(from: value.replacingOccurrences(of: " ", with: "T").replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
    }
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateFormat = format; return f
    }
    private static let time = formatter("HH:mm")
    private static let day = formatter("dd.MM.yyyy")
    private static let full: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateStyle = .medium; f.timeStyle = .short; return f }()
    private static let long: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateStyle = .long; f.timeStyle = .short; return f }()
    /// Jak `formatDate` listy w CRM: dziś — godzina, „wczoraj o”, „przedwczoraj o”, „N dni temu”, starsze — data i godzina.
    static func list(_ value: String) -> String {
        guard let date = parse(value) else { return "Brak daty" }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: Date())).day ?? 0
        let hour = time.string(from: date)
        switch days {
        case 0: return hour
        case 1: return "wczoraj o \(hour)"
        case 2: return "przedwczoraj o \(hour)"
        case 3..<7: return "\(days) dni temu"
        default: return "\(day.string(from: date)), \(hour)"
        }
    }
    static func medium(_ value: String) -> String { parse(value).map { full.string(from: $0) } ?? value }
    static func longText(_ value: String) -> String { parse(value).map { long.string(from: $0) } ?? value }
}

/// Adresy e-mail z nagłówka (`Jan <jan@x.pl>, ola@y.pl`) — małymi literami, bez powtórzeń.
func emailAddresses(_ value: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#, options: [.caseInsensitive]) else { return [] }
    var seen: [String] = []
    for match in regex.matches(in: value, range: NSRange(value.startIndex..., in: value)) {
        if let range = Range(match.range, in: value) {
            let address = value[range].lowercased()
            if !seen.contains(address) { seen.append(address) }
        }
    }
    return seen
}
