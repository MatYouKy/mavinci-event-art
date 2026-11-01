import Foundation

// Preserve JSON nulls and numeric values without brittle models for optional CRM fields.
indirect enum JSONValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    var text: String { if case .string(let v) = self { return v }; return "" }
    var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    var flag: Bool { if case .bool(let v) = self { return v }; return false }
    var number: Double { if case .number(let v) = self { return v }; return 0 }
}

struct Row: Codable, Identifiable, Equatable {
    var fields: [String: JSONValue]
    init(_ fields: [String: JSONValue]) { self.fields = fields }
    init(from decoder: Decoder) throws { fields = try [String: JSONValue](from: decoder) }
    func encode(to encoder: Encoder) throws { try fields.encode(to: encoder) }
    subscript(_ key: String) -> String { fields[key]?.text ?? "" }
    var id: String { self["id"] }
    var title: String {
        if !self["title"].isEmpty { return self["title"] }
        if !self["name"].isEmpty { return self["name"] }
        return [self["first_name"], self["last_name"]].filter { !$0.isEmpty }.joined(separator: " ")
    }
    var status: String {
        let codes = fields["is_inquiry"]?.flag == true ? [self["inquiry_stage"], self["board_column"], self["status"]] : [self["board_column"], self["status"]]
        return codes.first { !$0.isEmpty } ?? ""
    }
    var date: String { [self["next_action_at"], self["due_date"], self["event_date"], self["submission_deadline"], self["valid_until"], self["created_at"]].first { !$0.isEmpty } ?? "" }
    var details: [String: JSONValue] { fields["inquiry_details"]?.object ?? [:] }
    var phone: String { [self["mobile"], self["phone"], details["client_phone"]?.text ?? ""].first { !$0.isEmpty } ?? "" }
    var email: String { [self["email"], details["client_email"]?.text ?? ""].first { !$0.isEmpty } ?? "" }
}

struct Employee: Codable, Equatable {
    let id: String
    let auth_user_id: String
    let name: String
    let surname: String
    let role: String?
    let access_level: String?
    let permissions: [String]?
    let finance_access_scope: String?
    let company_access_mode: String?
    let my_company_ids: [String]?
    let invoice_company_permissions: JSONValue?
    let finance_company_access: JSONValue?
    let sales_team_id: String?
    let is_active: Bool
    let event_tabs: [String]?
    let access_levels: JSONValue?
    var isAdmin: Bool { role == "admin" || access_level == "admin" || permissions?.contains("admin") == true }
    func has(_ scope: String) -> Bool { isAdmin || permissions?.contains(scope) == true }
    func canView(_ module: Module) -> Bool {
        if module == .events && (has("events_view_planning") || has("events_view_operational") || has("equipment_manage")) { return true }
        return module == .day || module == .notifications || has("\(module.rawValue)_view") || has("\(module.rawValue)_manage")
    }
    var displayName: String { "\(name) \(surname)".trimmingCharacters(in: .whitespaces) }
}

enum Module: String, CaseIterable, Identifiable, Codable {
    case day, calendar, inquiries, tasks, contacts, events, offers, tenders, notifications
    var id: String { rawValue }
    var title: String {
        switch self {
        case .day: return "Mój dzień"
        case .calendar: return "Kalendarz"
        case .inquiries: return "Zapytania"
        case .tasks: return "Moje zadania"
        case .contacts: return "Kontakty"
        case .events: return "Wydarzenia"
        case .offers: return "Oferty"
        case .tenders: return "Przetargi"
        case .notifications: return "Powiadomienia"
        }
    }
    var symbol: String {
        switch self {
        case .day: return "sun.max"
        case .calendar: return "calendar"
        case .inquiries: return "tray"
        case .tasks: return "checklist"
        case .contacts: return "person.crop.rectangle.stack"
        case .events: return "calendar"
        case .offers: return "doc.text"
        case .tenders: return "briefcase"
        case .notifications: return "bell"
        }
    }
}

struct Session: Codable {
    let access_token: String
    let refresh_token: String
    let expires_in: Double?
    let expires_at: Double?
    let user: AuthUser
    var expiresAt: Double { expires_at ?? (issuedAt + (expires_in ?? 3600)) }
    var issuedAt: Double = Date().timeIntervalSince1970
    struct AuthUser: Codable { let id: String }
    enum CodingKeys: String, CodingKey { case access_token, refresh_token, expires_in, expires_at, user, issuedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        access_token = try c.decode(String.self, forKey: .access_token)
        refresh_token = try c.decode(String.self, forKey: .refresh_token)
        expires_in = try c.decodeIfPresent(Double.self, forKey: .expires_in)
        expires_at = try c.decodeIfPresent(Double.self, forKey: .expires_at)
        user = try c.decode(AuthUser.self, forKey: .user)
        issuedAt = try c.decodeIfPresent(Double.self, forKey: .issuedAt) ?? Date().timeIntervalSince1970
    }
}

struct SyncReply: Codable {
    var hashes: [String: String]
    var changed: [String: [Row]]
}
struct CollectionState: Codable {
    var hashes: [String: String] = [:]
    var buckets: [String: [Row]] = [:]
    var lastSync: Date?
    var rows: [Row] { buckets.keys.sorted().flatMap { buckets[$0] ?? [] } }
    mutating func apply(_ reply: SyncReply) throws {
        guard reply.hashes.count == 16, reply.hashes.keys.allSatisfy({ Int($0, radix: 16) != nil && $0.count == 1 }),
              reply.changed.keys.allSatisfy({ reply.hashes[$0] != nil }),
              reply.hashes.allSatisfy({ hashes[$0.key] == $0.value || reply.changed[$0.key] != nil }) else { throw AppError.invalidResponse }
        for (key, rows) in reply.changed { buckets[key] = rows }
        hashes = reply.hashes
        lastSync = Date()
    }
}
struct Snapshot: Codable {
    var employee: Employee
    var collections: [String: CollectionState] = [:]
    var eventPages: [String: EventPageCache]?
    var salesDay: JSONValue = .null
    var savedAt = Date()
}

enum AppError: Error, LocalizedError, Equatable {
    case configuration, unauthorized, forbidden, conflict, invalidResponse, server, missingSync, noEmployee, unsupported
    var errorDescription: String? {
        switch self {
        case .configuration: return "Uzupełnij poprawny adres HTTPS i publiczny klucz połączenia."
        case .unauthorized: return "Sesja wygasła. Zaloguj się ponownie."
        case .forbidden: return "Nie masz uprawnień do tej czynności."
        case .conflict: return "Dane zmieniły się lub nie są już dostępne. Odśwież listę i spróbuj ponownie."
        case .invalidResponse: return "Odpowiedź serwera nie pasuje do tej wersji aplikacji."
        case .missingSync: return "Synchronizacja przyrostowa wymaga aktualizacji bazy danych."
        case .noEmployee: return "Konto nie ma jednego aktywnego profilu pracownika. Skontaktuj się z administratorem."
        case .unsupported: return "Ta funkcja wymaga obsługi przez skonfigurowany serwer."
        case .server: return "Serwer nie wykonał operacji. Odśwież dane i spróbuj ponownie."
        }
    }
}
func friendlyError(_ error: Error) -> String {
    if let error = error as? AppError { return error.localizedDescription }
    if error is URLError { return "Nie udało się połączyć z serwerem. Dostępna jest zapisana kopia do odczytu." }
    return "Nie udało się wykonać operacji. Spróbuj ponownie."
}

enum Labels {
    static let taskStages = ["todo", "in_progress", "review", "completed"]
    static let priorities = ["low", "medium", "high", "urgent"]
    static let values = [
        "todo":"Do zrobienia", "in_progress":"W trakcie", "review":"Do sprawdzenia", "completed":"Zakończone", "done":"Zakończone", "cancelled":"Anulowane",
        "new":"Nowe", "contacted":"Po kontakcie", "qualified":"Zakwalifikowane", "proposal":"Oferta", "negotiation":"Negocjacje", "won":"Wygrane", "lost":"Przegrane",
        "low":"Niski", "medium":"Średni", "high":"Wysoki", "urgent":"Pilny", "active":"Aktywny", "inactive":"Nieaktywny",
        "draft":"Szkic", "sent":"Wysłana", "accepted":"Zaakceptowana", "rejected":"Odrzucona", "expired":"Wygasła", "viewed":"Otwarta",
        "inquiry":"Zapytanie", "offer_to_send":"Oferta do wysłania", "offer_sent":"Oferta wysłana", "offer_accepted":"Oferta zaakceptowana", "in_preparation":"W przygotowaniu",
        "ready_for_live":"Gotowe do realizacji", "invoiced":"Zafakturowane", "settled":"Rozliczone", "confirmed":"Potwierdzone", "planning":"Planowanie",
        "approved":"Zatwierdzono","paid":"Opłacono","partially_paid":"Częściowo opłacono","unpaid":"Nieopłacone","overdue":"Po terminie","planned":"Zaplanowano","transfer":"Przelew","cash":"Gotówka","direct":"Bezpośrednio","hotel":"Hotel","agency":"Agencja","other":"Inne","individual":"Osoba prywatna","company":"Firma","percentage":"Procentowo","fixed":"Kwotowo","payroll":"Wynagrodzenie pracownicze","cash_dividend":"Rozliczenie gotówkowe","manager":"Kierownik","warehouse":"Magazyn","driver":"Kierowca","employee":"Pracownik","view":"Podgląd","edit":"Edycja","run":"Uruchamianie","admin":"Administrator","reviewing":"W analizie", "interested":"Zainteresowanie", "preparing":"W przygotowaniu", "submitted":"Złożone", "pending":"Oczekujące", "archived":"Archiwalne"
    ]
    static func text(_ code: String) -> String { code.isEmpty ? "—" : (values[code] ?? "Inny stan") }
    static func date(_ raw: String) -> String {
        guard !raw.isEmpty else { return "—" }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: raw)
        if date == nil { iso.formatOptions = [.withInternetDateTime]; date = iso.date(from: raw) }
        if date == nil {
            let input = DateFormatter(); input.locale = Locale(identifier: "en_US_POSIX"); input.timeZone = TimeZone(identifier: "Europe/Warsaw"); input.dateFormat = "yyyy-MM-dd"
            date = input.date(from: String(raw.prefix(10)))
        }
        guard let date else { return "—" }
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = TimeZone(identifier: "Europe/Warsaw"); f.dateFormat = raw.count > 10 ? "dd.MM.yyyy HH:mm" : "dd.MM.yyyy"
        return f.string(from: date)
    }
}
