import Foundation
import SwiftUI

// MARK: Zakupy → „Moje wydatki” i „Rozliczenia pracowników” — modele odpowiedzi `/bridge/native/v1/purchases`
// (`src/lib/purchases/purchaseRoute.server.ts`, funkcje bazy `purchase_*`, `docs/purchases.md`). Klucze JSON w snake_case
// (dekoder `PurchaseJSON.decoder`); pola, których baza może nie mieć, są opcjonalne. Etykiety, kolory, formularz i jego
// sprawdzanie — jak `src/lib/purchases/purchaseShared.ts` (CRM i telefon).

enum PurchaseJSON {
    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

/// Limity pliku dokumentu (jak serwer CRM): do 10 stron (zdjęć), PDF / zdjęcie do 10 MB, zdjęcie strony do 15 MB.
enum PurchaseLimits {
    static let maxPages = 10
    static let maxFileBytes = 10 * 1024 * 1024
    static let maxPageBytes = 15 * 1024 * 1024
}

extension String {
    /// Tekst bez białych znaków na brzegach (jak `trim()` w CRM).
    var purchaseTrimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

enum PurchaseSettlementStatus: String, CaseIterable {
    case open, submitted, approved, returned
    init(code: String?) { self = PurchaseSettlementStatus(rawValue: code ?? "") ?? .open }
    var label: String {
        switch self {
        case .open: return "Otwarte"
        case .submitted: return "Wysłane do zatwierdzenia"
        case .approved: return "Zatwierdzone"
        case .returned: return "Do poprawy"
        }
    }
    var color: Color {
        switch self {
        case .open: return CrmTheme.rgb(0x9ca3af)
        case .submitted: return CrmTheme.rgb(0x7dd3fc)
        case .approved: return CrmTheme.rgb(0x34d399)
        case .returned: return CrmTheme.rgb(0xf59e0b)
        }
    }
    /// Dokumenty miesiąca można zmieniać (rozliczenie otwarte albo zwrócone).
    var editable: Bool { self == .open || self == .returned }
}

enum PurchaseKind: String, CaseIterable, Identifiable {
    case receipt, invoice, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .receipt: return "Paragon"
        case .invoice: return "Faktura"
        case .other: return "Inny dowód zakupu"
        }
    }
    /// Rodzaj dokumentu z bazy (także korekty dopisane w Finansach).
    static func title(_ code: String?) -> String {
        if let kind = PurchaseKind(rawValue: code ?? "") { return kind.label }
        return code == "credit_note" ? "Korekta" : "Dokument"
    }
}

enum PurchaseMethod: String, CaseIterable, Identifiable {
    case card = "Karta"
    case cash = "Gotówka"
    case blik = "BLIK"
    case transfer = "Przelew"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .card: return "Karta firmowa"
        case .cash: return "Gotówka"
        case .blik: return "BLIK"
        case .transfer: return "Przelew — faktura do zapłaty przez firmę"
        }
    }
    static func title(_ code: String?) -> String {
        if let method = PurchaseMethod(rawValue: code ?? "") { return method.label }
        return code?.nonEmpty ?? "—"
    }
}

/// Stan kosztu eventu (`event_costs.status`).
enum PurchaseCostStatus {
    static func label(_ code: String?) -> String? {
        switch code ?? "" {
        case "": return nil
        case "pending": return "czeka na rozliczenie"
        case "approved": return "zatwierdzony"
        case "paid": return "opłacony"
        case "rejected": return "odrzucony"
        default: return code
        }
    }
}

struct PurchaseCompanyRef: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
}

struct PurchaseAccess: Decodable, Equatable {
    var employeeId: String?
    var record = false
    var approve = false
    var recordCompanies: [PurchaseCompanyRef] = []
    var approveCompanies: [PurchaseCompanyRef] = []
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        employeeId = try? c.decode(String.self, forKey: .employeeId)
        record = (try? c.decode(Bool.self, forKey: .record)) ?? false
        approve = (try? c.decode(Bool.self, forKey: .approve)) ?? false
        recordCompanies = (try? c.decode([PurchaseCompanyRef].self, forKey: .recordCompanies)) ?? []
        approveCompanies = (try? c.decode([PurchaseCompanyRef].self, forKey: .approveCompanies)) ?? []
    }
    private enum Keys: String, CodingKey { case employeeId, record, approve, recordCompanies, approveCompanies }
}

/// Koszt eventu z tego zakupu (`event_costs` z `from_purchase`).
struct PurchaseEventLink: Decodable, Equatable {
    var id: String
    var name: String?
    var date: String?
    var costId: String?
    var amount: Double?
    var categoryId: String?
    var categoryName: String?
    var status: String?
}

struct PurchaseDocument: Decodable, Identifiable, Equatable {
    var id: String
    var companyId: String
    var companyName: String?
    var kind: String?
    var sellerName: String?
    var sellerNip: String?
    var number: String?
    var date: String?
    var label: String?
    var net: Double?
    var gross: Double?
    var currency: String?
    var paymentMethod: String?
    var paymentStatus: String?
    var categoryId: String?
    var categoryName: String?
    var notes: String?
    var hasFile: Bool
    var bankMatched: Bool
    var createdAt: String?
    var updatedAt: String?
    var event: PurchaseEventLink?

    var currencyCode: String { currency?.nonEmpty ?? "PLN" }
}

struct PurchaseSettlement: Decodable, Equatable {
    var id: String
    var status: String
    var employeeNote: String?
    var decisionNote: String?
    var documentCount: Int?
    var totals: [String: Double]?
    var submittedAt: String?
    var decidedAt: String?
    var decidedByName: String?
}

struct PurchaseMonthCompany: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var canRecord: Bool
    var canApprove: Bool
    var settlement: PurchaseSettlement?
    /// Stan rozliczenia miesiąca tej działalności (brak wiersza — „Otwarte”).
    var status: PurchaseSettlementStatus { PurchaseSettlementStatus(code: settlement?.status) }
}

struct PurchasePendingMonth: Decodable, Identifiable, Equatable {
    var year: Int
    var month: Int
    var companyId: String
    var count: Int
    var status: String?
    var id: String { "\(year)-\(month)-\(companyId)" }
}

/// Miesiąc zakupów pracownika (`purchase_month`): działalności z rozliczeniem, dokumenty i inne nierozliczone miesiące.
struct PurchaseMonth: Decodable, Identifiable, Equatable {
    struct Person: Decodable, Equatable {
        var id: String
        var name: String?
    }
    var employee: Person
    /// Własne zakupy zalogowanego (w JSON `self`).
    var own: Bool
    var year: Int
    var month: Int
    var companies: [PurchaseMonthCompany]
    var documents: [PurchaseDocument]
    var pendingMonths: [PurchasePendingMonth]
    var id: String { "\(employee.id)-\(year)-\(month)" }
    var employeeName: String { employee.name?.nonEmpty ?? "Pracownik" }

    private enum CodingKeys: String, CodingKey {
        case employee, own = "self", year, month, companies, documents, pendingMonths
    }
}

struct PurchaseCategory: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var code: String?
}

struct PurchaseCategories: Decodable, Equatable {
    var finance: [PurchaseCategory] = []
    var event: [PurchaseCategory] = []
    static let empty = PurchaseCategories()
}

/// Stan ekranu (`op=state`): prawa, miesiąc (własny albo pracownika — dla zatwierdzającego) i kategorie.
struct PurchaseState: Decodable, Equatable {
    var access: PurchaseAccess
    var month: PurchaseMonth?
    var categories: PurchaseCategories
}

struct PurchaseEventOption: Decodable, Identifiable, Equatable {
    var id: String
    var name: String?
    var date: String?
    var endDate: String?
    var status: String?
    var location: String?
}

struct PurchaseEventCost: Decodable, Identifiable, Equatable {
    var id: String
    var name: String?
    var categoryName: String?
    var amount: Double?
    var currency: String?
    var date: String?
    var status: String?
    var fromPurchase: Bool?
    var createdByName: String?
    var mine: Bool?
    var document: String?
}

/// Wszystkie koszty eventu (bez budżetu i przychodów) — przy przypisywaniu zakupu (`purchase_event_costs`).
struct PurchaseEventCosts: Decodable, Equatable {
    struct Info: Decodable, Equatable {
        var id: String
        var name: String?
        var date: String?
        var status: String?
    }
    var event: Info
    var settlementOpen: Bool
    var costs: [PurchaseEventCost]
    var total: Double
}

/// Wiersz „Rozliczeń pracowników” (`purchase_review`): miesiąc pracownika w działalności.
struct PurchaseReviewRow: Decodable, Identifiable, Equatable {
    var employeeId: String
    var employeeName: String?
    var companyId: String
    var companyName: String?
    var year: Int
    var month: Int
    var status: String
    var settlementId: String?
    var documents: Int
    var documentCount: Int?
    var totals: [String: Double]?
    var submittedAt: String?
    var decidedAt: String?
    var decisionNote: String?
    var employeeNote: String?
    var lastChange: String?
    var id: String { "\(employeeId)-\(companyId)-\(year)-\(month)" }
    var state: PurchaseSettlementStatus { PurchaseSettlementStatus(code: status) }
}

/// Odczyt dokumentu przez AI na serwerze CRM (pola do sprawdzenia przed zapisem).
struct PurchaseReading: Decodable, Equatable {
    struct Fields: Decodable, Equatable {
        var sellerName: String?
        var sellerNip: String?
        var invoiceNumber: String?
        var invoiceDate: String?
        var label: String?
        var paymentMethod: String?
        var amountNet: Double?
        var amountGross: Double?
        var currency: String?
    }
    var kind: String?
    var fields: Fields
    var buyerName: String?
    var buyerNip: String?
    var amountVat: Double?
    var warnings: [String]?
}

/// Plik zapisany na serwerze (czeka na zapis dokumentu) i jego odczyt.
struct PurchaseUpload: Decodable, Equatable {
    struct File: Decodable, Equatable {
        var path: String
        var mime: String?
        var size: Int?
        var pages: Int?
    }
    var file: File
    var reading: PurchaseReading?
    var readingError: String?
}

// MARK: Formularz zakupu (to samo wysyła CRM i telefon — `purchasePayload`, `purchaseDraftErrors`)

struct PurchaseDraft: Equatable {
    var companyID = ""
    var kind: PurchaseKind = .receipt
    var sellerName = ""
    var sellerNip = ""
    var number = ""
    var date = PurchaseFormat.today()
    var label = ""
    var net = ""
    var gross = ""
    var currency = "PLN"
    var method: PurchaseMethod = .card
    var categoryID = ""
    var notes = ""
    var eventID = ""
    var eventAmount = ""
    var eventCategoryID = ""

    init() {}

    /// Pusty formularz: działalność domyślna, dziś, karta firmowa.
    init(company: String) { companyID = company }

    /// Formularz z zapisanego dokumentu.
    init(document: PurchaseDocument) {
        companyID = document.companyId
        kind = PurchaseKind(rawValue: document.kind ?? "") ?? .other
        sellerName = document.sellerName ?? ""
        sellerNip = document.sellerNip ?? ""
        number = document.number ?? ""
        let day = String((document.date ?? "").prefix(10))
        date = day.isEmpty ? PurchaseFormat.today() : day
        label = document.label ?? ""
        net = PurchaseFormat.amountText(document.net)
        gross = PurchaseFormat.amountText(document.gross)
        currency = document.currency?.nonEmpty ?? "PLN"
        method = PurchaseMethod(rawValue: document.paymentMethod ?? "") ?? .card
        categoryID = document.categoryId ?? ""
        notes = document.notes ?? ""
        eventID = document.event?.id ?? ""
        eventAmount = PurchaseFormat.amountText(document.event?.amount)
        eventCategoryID = document.event?.categoryId ?? ""
    }

    /// Formularz uzupełniony odczytem AI (tylko odczytane pola; reszta bez zmian).
    func with(_ reading: PurchaseReading?) -> PurchaseDraft {
        guard let reading else { return self }
        var next = self
        let fields = reading.fields
        if let code = reading.kind?.nonEmpty { next.kind = code == "invoice" ? .invoice : code == "receipt" ? .receipt : .other }
        if let method = PurchaseMethod(rawValue: fields.paymentMethod ?? "") { next.method = method }
        if let day = fields.invoiceDate?.nonEmpty, PurchaseFormat.date(day) != nil, day <= PurchaseFormat.today() { next.date = day }
        if let value = fields.sellerName?.nonEmpty { next.sellerName = value }
        if let value = fields.sellerNip?.nonEmpty { next.sellerNip = value }
        if let value = fields.invoiceNumber?.nonEmpty { next.number = value }
        if let value = fields.label?.nonEmpty { next.label = value }
        if let value = fields.amountNet, value > 0 { next.net = PurchaseFormat.amountText(value) }
        if let value = fields.amountGross, value > 0 { next.gross = PurchaseFormat.amountText(value) }
        if let value = fields.currency?.nonEmpty { next.currency = value }
        return next
    }

    /// Błędy formularza przed wysłaniem (to samo sprawdza baza).
    func errors(today: String) -> [String] {
        var errors: [String] = []
        let grossValue = PurchaseFormat.number(gross)
        let netValue = PurchaseFormat.number(net)
        let code = currency.purchaseTrimmed
        if companyID.isEmpty { errors.append("Wybierz działalność.") }
        if sellerName.purchaseTrimmed.isEmpty { errors.append("Podaj sprzedawcę.") }
        if number.purchaseTrimmed.isEmpty { errors.append("Podaj numer dokumentu (faktury albo paragonu).") }
        if PurchaseFormat.date(date) == nil || date > today { errors.append("Data zakupu nie może być pusta ani z przyszłości.") }
        if (grossValue ?? 0) <= 0 { errors.append("Podaj kwotę brutto większą od zera.") }
        if let netValue, netValue <= 0 || netValue > (grossValue ?? .infinity) {
            errors.append("Kwota netto musi być dodatnia i nie większa niż brutto.")
        }
        if code.count != 3 || !code.allSatisfy({ $0.isASCII && $0.isLetter }) { errors.append("Waluta to trzyliterowy kod, np. PLN.") }
        if !eventID.isEmpty {
            if code.uppercased() != "PLN" { errors.append("Do eventu można przypisać zakup w PLN.") }
            if let part = PurchaseFormat.number(eventAmount), part <= 0 || part > (grossValue ?? .infinity) {
                errors.append("Kwota dla eventu musi być większa od zera i nie większa niż brutto.")
            }
        }
        return errors
    }

    /// Dane do zapisu (`purchase_save`); `filePath` — nowy plik z serwera (bez — plik bez zmian).
    func payload(filePath: String?) -> [String: JSONValue] {
        func text(_ value: String, _ limit: Int) -> JSONValue { .string(String(value.purchaseTrimmed.prefix(limit))) }
        func amount(_ value: String) -> JSONValue {
            if let number = PurchaseFormat.number(value) { return .number(number) }
            return .null
        }
        let event = eventID.purchaseTrimmed
        let code = currency.purchaseTrimmed.uppercased()
        var data: [String: JSONValue] = [
            "company_id": .string(companyID),
            "kind": .string(kind.rawValue),
            "seller_name": text(sellerName, 200),
            "seller_nip": text(sellerNip, 30),
            "number": text(number, 120),
            "date": .string(date),
            "label": text(label, 200),
            "net": amount(net),
            "gross": amount(gross),
            "currency": .string(code.isEmpty ? "PLN" : code),
            "payment_method": .string(method.rawValue),
            "category_id": categoryID.isEmpty ? .null : .string(categoryID),
            "notes": text(notes, 2000),
            "event_id": event.isEmpty ? .null : .string(event),
            "event_amount": event.isEmpty ? .null : amount(eventAmount),
            "event_category_id": event.isEmpty || eventCategoryID.isEmpty ? .null : .string(eventCategoryID),
        ]
        if let filePath, !filePath.isEmpty { data["file_path"] = .string(filePath) }
        return data
    }

    /// Kategoria kosztu eventu podpowiadana z kategorii kosztów firmy (ta sama nazwa; transport, noclegi; reszta — Materiały / Inne).
    static func eventCategory(for financeName: String?, in categories: [PurchaseCategory]) -> String {
        func fold(_ text: String) -> String { text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased() }
        func byName(_ name: String) -> String { categories.first(where: { fold($0.name) == fold(name) })?.id ?? "" }
        let name = fold(financeName ?? "")
        if !name.isEmpty {
            if let same = categories.first(where: { fold($0.name) == name || name.hasPrefix(fold($0.name)) }) { return same.id }
            if name.contains("transport") { return byName("Transport") }
            if name.contains("noclegi") { return byName("Noclegi") }
        }
        let materials = byName("Materiały")
        return materials.isEmpty ? byName("Inne") : materials
    }
}

// MARK: Formatowanie (jak `purchaseDay`, `purchaseMoney`, `purchaseTotalsText` w CRM)

enum PurchaseFormat {
    static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    static let months = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"]
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let isoPlain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()

    static func monthName(_ month: Int) -> String { (1...12).contains(month) ? months[month - 1] : "" }
    /// „listopad 2026”.
    static func monthLabel(_ year: Int, _ month: Int) -> String { "\(monthName(month)) \(String(year))" }

    /// Dzień w Polsce (rrrr-mm-dd).
    static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }
    static func today() -> String { dayString(Date()) }
    /// Data z „rrrr-mm-dd” (północ w Polsce); błędny zapis — `nil`.
    static func date(_ day: String) -> Date? {
        guard day.count == 10, let date = dayFormatter.date(from: day), dayFormatter.string(from: date) == day else { return nil }
        return date
    }
    /// Bieżący miesiąc w Polsce.
    static func currentMonth() -> (year: Int, month: Int) {
        let parts = today().split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return (2026, 1) }
        return (parts[0], parts[1])
    }
    static func shift(_ year: Int, _ month: Int, _ delta: Int) -> (year: Int, month: Int) {
        let index = year * 12 + (month - 1) + delta
        return (Int((Double(index) / 12).rounded(.down)), ((index % 12) + 12) % 12 + 1)
    }

    /// „12.11.2026” z „2026-11-12”; znacznik czasu (wysłanie, decyzja, termin eventu) — dzień w Polsce.
    static func day(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        var text = String(value.prefix(10))
        if value.count > 10, value.contains("T"), let moment = instant(value) { text = dayString(moment) }
        let parts = text.split(separator: "-")
        guard parts.count == 3 else { return value }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    /// Znacznik czasu z bazy („2026-11-25T18:20:00.123456+00:00”).
    static func instant(_ value: String) -> Date? {
        if let date = iso.date(from: value) ?? isoPlain.date(from: value) { return date }
        // Ułamek sekundy dłuższy niż 3 cyfry — bez ułamka.
        guard let dot = value.firstIndex(of: ".") else { return nil }
        let rest = value[value.index(after: dot)...]
        guard let end = rest.firstIndex(where: { !$0.isNumber }) else { return nil }
        return isoPlain.date(from: String(value[..<dot]) + String(value[end...]))
    }

    /// „1 234,50 zł” / „12,00 EUR”.
    static func money(_ value: Double?, _ currency: String? = "PLN") -> String {
        let amount = value ?? 0
        let fixed = String(format: "%.2f", abs(amount))
        let parts = fixed.split(separator: ".")
        let whole = parts.first.map { String($0) } ?? "0"
        let cents = parts.count > 1 ? String(parts[1]) : "00"
        var grouped = ""
        for (index, character) in whole.enumerated() {
            if index > 0 && (whole.count - index) % 3 == 0 { grouped.append("\u{00A0}") }
            grouped.append(character)
        }
        let code = currency.flatMap { value -> String? in value.isEmpty || value == "PLN" ? nil : value } ?? "zł"
        return (amount < 0 ? "−" : "") + grouped + "," + cents + " " + code
    }
    /// Sumy brutto według waluty: „123,45 zł · 10,00 EUR”.
    static func totalsText(_ totals: [String: Double]?) -> String {
        let entries = (totals ?? [:]).filter { $0.value != 0 }
        guard !entries.isEmpty else { return money(0) }
        return entries.sorted { a, b in a.key == "PLN" ? b.key != "PLN" : b.key == "PLN" ? false : a.key < b.key }
            .map { money($0.value, $0.key) }.joined(separator: " · ")
    }
    /// Sumy dokumentów według waluty.
    static func totals(_ documents: [PurchaseDocument]) -> [String: Double] {
        var totals: [String: Double] = [:]
        for document in documents {
            let code = document.currencyCode
            totals[code] = (((totals[code] ?? 0) + (document.gross ?? 0)) * 100).rounded() / 100
        }
        return totals
    }
    /// Liczba z pola („1 234,56” → 1234.56); puste albo błędne — `nil`.
    static func number(_ text: String) -> Double? {
        var clean = text.filter { !$0.isWhitespace }
        if let comma = clean.range(of: ",") { clean.replaceSubrange(comma, with: ".") }
        guard !clean.isEmpty, let value = Double(clean), value.isFinite else { return nil }
        return value
    }
    /// Kwota do pola edycji („1234,50”).
    static func amountText(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
}

/// Stan rozliczenia miesiąca (kolor i etykieta jak w CRM i w telefonie).
struct PurchaseStatusBadge: View {
    let status: PurchaseSettlementStatus
    var body: some View {
        Text(status.label).font(.caption.weight(.medium)).lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(status.color).background(status.color.opacity(0.15), in: Capsule())
            .fixedSize()
    }
}
