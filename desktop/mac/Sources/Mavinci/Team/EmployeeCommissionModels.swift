import SwiftUI

// MARK: Konto prowizji — zakładka „Prowizje” karty pracownika (`/bridge/native/v1/employees/profile?op=commissions`) i sekcja
// „Prowizje i narzuty” karty sprzedawcy (`/bridge/native/v1/sellers?op=commissions`), `src/lib/native/teamCommissions.ts`:
// całe konto z bazy (`get_commission_settlements`), sumy jak `buildCommissionSettlementStats` w CRM, warunki pracownika.

/// Czyje konto: pracownik (udział w sprzedaży, warunki „Prowizja od sprzedaży”, wypłata z wynagrodzeniem) albo sprzedawca
/// z kartoteki (prowizje z podsumowania, narzuty z ofert, wpisy ręczne).
enum CommissionAccountKind { case employee, partner }

/// Magazyn z kontem prowizji (zespół — pracownik, sprzedawcy — sprzedawca): odczyt, zapis czynności i komunikat błędu.
@MainActor protocol CommissionAccountHost: ObservableObject {
    func commissionAccount(_ id: String) -> EmployeeCommissionAccount?
    func commissionError(_ id: String) -> String?
    func loadCommissions(_ id: String) async
    func commissionPost<T: Decodable>(_ op: String, _ id: String, _ body: [String: JSONValue], as type: T.Type) async throws -> T
    func failureText(_ error: Error, _ fallback: String) -> String
}

struct EmployeeCommissionAccount: Decodable {
    var hidden: Bool
    var message: String?
    var own: Bool
    var canManage: Bool
    var terms: EmployeeCommissionTerms?
    var commissions: [EmployeeCommission]
    var stats: EmployeeCommissionStatsSet?
    /// Dzisiejsza data w Polsce (RRRR-MM-DD) według serwera.
    var today: String?
}

struct EmployeeCommissionTerms: Decodable, Equatable {
    var enabled: Bool
    /// Stawki obowiązujące (własne albo globalne).
    var standardRate: Double
    var ownClientRate: Double
    /// Stawki własne pracownika (`nil` — stawka globalna); znane tylko administratorowi i rozliczającym prowizje.
    var customStandardRate: Double?
    var customOwnClientRate: Double?
    var defaultStandardRate: Double?
    var defaultOwnClientRate: Double?
    var paymentMethod: String
    var employerSocialRate: Double?
    var updatedAt: String?
    var editable: Bool
}

/// Osoba wpisu — do potrąceń (ta sama osoba jak w `settle_commission_deduction`).
struct EmployeeCommissionPerson: Decodable, Hashable {
    var partner: String?
    var contact: String?
    var employee: String?
}

struct EmployeeCommissionPayment: Decodable, Identifiable, Hashable {
    var id: String
    var amount: Double
    var paymentDate: String?
    var recordedAt: String?
    var reference: String?
    var note: String?
    /// `ledger` — zapis wypłaty, `legacy` — dawne oznaczenie „wypłacona”, `offset` — potrącenie bez przelewu.
    var source: String
    var isOffset: Bool
}

struct EmployeeCommission: Decodable, Identifiable, Hashable {
    var id: String
    var eventId: String
    var eventName: String
    var eventDate: String?
    var companyId: String?
    var companyName: String?
    var canManage: Bool
    var beneficiaryName: String
    /// Kwota dla osoby (nominalna), nie koszt firmy.
    var amount: Double
    var companyCost: Double?
    var status: String
    var waiting: Bool
    var createdAt: String?
    var dueDate: String?
    var paymentMethod: String
    /// Wypłaty i potrącenia razem (jak `paid_amount` w bazie).
    var paidAmount: Double
    var remainingAmount: Double
    var baseAmount: Double?
    var rate: Double?
    var baseDescription: String?
    var rateReason: String?
    /// `accrual` — naliczenie, `correction` — dopłata, `deduction` — do potrącenia.
    var entryKind: String
    var correctsId: String?
    var source: String?
    var sharePercent: Double?
    var clientOwned: Bool?
    var revision: Double?
    var toOffset: Double
    var offsetAmount: Double
    var payments: [EmployeeCommissionPayment]
    var person: EmployeeCommissionPerson?

    var isDeduction: Bool { entryKind == "deduction" }
    /// Wpis z podsumowania wydarzenia (także dopłata i potrącenie) — kwotę ustala podsumowanie, nie zatwierdza się go ręcznie.
    var automatic: Bool { entryKind != "accrual" || CommissionText.automaticSources.contains(source ?? "") }
    var remainingCents: Int { CommissionText.cents(remainingAmount) }
    var toOffsetCents: Int { CommissionText.cents(toOffset) }
    /// Widok „Do rozliczenia” jak w CRM.
    var isOpen: Bool { status != "cancelled" && status != "paid" && (waiting || remainingAmount > 0 || toOffset > 0) }
    /// Zatwierdzona prowizja z kwotą do wypłaty, którą użytkownik może rozliczyć.
    var payable: Bool { canManage && status == "approved" && !isDeduction && !waiting && remainingCents > 0 }
    /// Kolejność jak `byDate` na serwerze (najstarsze wydarzenie pierwsze; po kodach znaków).
    var orderKey: (String, String, String) { (eventDate ?? "9999", createdAt ?? "", id) }
    var day: String { CommissionText.day(eventDate) }
}

struct EmployeeCommissionMonth: Decodable, Hashable {
    var month: String
    var earnedCents: Int
    var paidCents: Int
}

struct EmployeeCommissionStats: Decodable {
    var earnedCents: Int
    var paidCents: Int
    var outstandingCents: Int
    var plannedCents: Int
    var undatedEarnedCents: Int
    var undatedPaidCents: Int
    var cancelledPaidCents: Int
    var overpaidCents: Int
    var paymentDetailsMismatchCents: Int
    var waitingCount: Int
    var plannedCount: Int
    var approvedCount: Int
    var partialCount: Int
    var cancelledCount: Int
    var toOffsetCents: Int
    var deductionCount: Int
    var months: [EmployeeCommissionMonth]
}

struct EmployeeCommissionCompanyStats: Decodable, Identifiable {
    var id: String
    var name: String
    var stats: EmployeeCommissionStats
}

struct EmployeeCommissionStatsSet: Decodable {
    var all: EmployeeCommissionStats
    var companies: [EmployeeCommissionCompanyStats]
}

/// Wynik „Rozlicz przy wypłacie” (`commissionPayroll`).
struct CommissionPayrollReply: Decodable {
    struct Line: Decodable, Hashable {
        var commissionId: String
        var eventName: String
        /// `offset` — potrącenie, `paid` — wypłata zapisana, `skipped` — pominięta, `error` — niezapisana.
        var kind: String
        var amount: Double
        var message: String
    }
    var done: Bool
    var stopped: Bool
    var uncertain: Bool
    var lines: [Line]
    var paid: Double
    var offset: Double
    var message: String?
}

// MARK: Etykiety (jak `commissionStatusLabels`, `commissionPaymentLabels`, `COMMISSION_SOURCE_LABELS` w CRM)

enum CommissionText {
    static let automaticSources: Set<String> = ["sales_share", "billing_contact", "event_referral", "partner_arrangement", "seller_portal", "manual_partner", "seller_markup"]
    static let automaticHint = "Do wypłaty po zatwierdzeniu podsumowania wydarzenia"
    static let methods: [InquiryOption] = [
        .init(value: "payroll", label: "Wynagrodzenie pracownicze"), .init(value: "cash_dividend", label: "Gotówka z zysku spółki"),
        .init(value: "invoice", label: "Faktura / rachunek"), .init(value: "other", label: "Inny sposób"),
    ]
    static func method(_ value: String) -> String { methods.first { $0.value == value }?.label ?? value }
    static func status(_ value: String) -> String {
        switch value {
        case "planned": return "Planowana"
        case "approved": return "Zatwierdzona"
        case "paid": return "Wypłacona"
        case "cancelled": return "Anulowana"
        default: return value
        }
    }
    static func source(_ value: String?) -> String? {
        switch value ?? "" {
        case "sales_share": return "Sprzedawca wydarzenia"
        case "seller_portal": return "Oferta z portalu sprzedawcy"
        case "event_referral": return "Polecenie"
        case "billing_contact": return "Kontakt rozliczeniowy (hotel / agencja)"
        case "partner_arrangement": return "Pośrednik (Ustalenia ze sprzedawcą)"
        case "manual_partner": return "Wskazany w podsumowaniu"
        case "seller_markup": return "Narzut sprzedawcy (oferta z narzutem)"
        default: return nil
        }
    }
    static func kind(_ value: String) -> String? {
        switch value {
        case "correction": return "Dopłata"
        case "deduction": return "Do potrącenia"
        default: return nil
        }
    }
    static func cents(_ value: Double) -> Int { value.isFinite ? Int((value * 100).rounded()) : 0 }
    static func money(_ value: Double) -> String { SettlementText.pln(value) }
    static func money(cents: Int) -> String { SettlementText.pln(Double(cents) / 100) }
    static func percent(_ value: Double?) -> String { SettlementText.percent(value) }
    /// Data wydarzenia lub płatności: znacznik czasu w czasie polskim, sama data — bez zmian.
    static func day(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        if value.count > 10, let date = MeetingDates.parse(value) { return MeetingDates.format(date, "dd.MM.yyyy") }
        return DayDates.display(value)
    }
    private static let monthNames = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"]
    /// „2026-11” → „lis 2026”.
    static func month(_ value: String) -> String {
        let parts = value.split(separator: "-")
        guard parts.count == 2, let index = Int(parts[1]), (1...12).contains(index) else { return value }
        return "\(monthNames[index - 1]) \(parts[0])"
    }
    /// Tekst kwoty wpisanej przez użytkownika („1 234,5”) → grosze; `nil` — nieprawidłowa lub niedodatnia.
    static func parseCents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "")
            .replacingOccurrences(of: "\u{202f}", with: "").replacingOccurrences(of: ",", with: ".")
        guard cleaned.range(of: #"^\d{1,12}(\.\d{1,2})?$"#, options: .regularExpression) != nil else { return nil }
        let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
        let whole = Int(parts[0]) ?? 0
        let fraction = parts.count > 1 ? Int(String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
        let value = whole * 100 + fraction
        return value > 0 ? value : nil
    }
    /// Stawka w procentach wpisana przez użytkownika: puste — `nil` (stawka globalna), inaczej 0–100.
    static func parseRate(_ text: String) -> Double?? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "%", with: "").replacingOccurrences(of: ",", with: ".")
        if cleaned.isEmpty { return .some(nil) }
        guard let value = Double(cleaned), value.isFinite, value >= 0, value <= 100 else { return nil }
        return .some(value)
    }
    static func rateText(_ value: Double?) -> String {
        guard let value else { return "" }
        let rounded = (value * 100).rounded() / 100
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return text.replacingOccurrences(of: ".", with: ",")
    }

    /// Status wiersza jak w rejestrze rozliczeń CRM (potrącenie, oczekiwanie na podstawę, częściowa wypłata).
    static func chip(_ row: EmployeeCommission, accent: Color) -> (label: String, color: Color) {
        let red = CrmTheme.rgb(0xfda4af), green = CrmTheme.rgb(0x6ee7b7)
        if row.isDeduction {
            if row.status == "approved" { return ("Do potrącenia", red) }
            if row.status == "paid" { return ("Potrącone", Color.secondary) }
            return (status(row.status), Color.secondary)
        }
        if row.waiting { return ("Oczekuje na podstawę", Color.secondary) }
        if row.paidAmount > 0 && row.status == "approved" { return ("Częściowo wypłacona", accent) }
        switch row.status {
        case "paid": return (status(row.status), green)
        case "approved": return (status(row.status), accent)
        default: return (status(row.status), Color.secondary)
        }
    }
}

// MARK: Plan potrąceń przed wypłatą — ta sama reguła i kolejność co `planOffsets` na serwerze

struct CommissionOffsetStep: Identifiable, Hashable {
    let deduction: EmployeeCommission
    let target: EmployeeCommission
    let amountCents: Int
    var id: String { deduction.id + ":" + target.id }
}

enum CommissionPayrollPlan {
    /// Ta sama osoba: ten sam profil sprzedawcy, ten sam kontakt albo (bez profilu sprzedawcy) ten sam pracownik.
    static func samePerson(_ d: EmployeeCommissionPerson?, _ t: EmployeeCommissionPerson?) -> Bool {
        guard let d, let t else { return false }
        if let partner = d.partner, partner == t.partner { return true }
        if let contact = d.contact, contact == t.contact { return true }
        if d.partner == nil, t.partner == nil, let employee = d.employee, employee == t.employee { return true }
        return false
    }
    static func ordered(_ rows: [EmployeeCommission]) -> [EmployeeCommission] { rows.sorted { $0.orderKey < $1.orderKey } }
    /// Otwarte potrącenia (od najstarszego) zmniejszają zaznaczone prowizje tej samej osoby i marki oraz tego samego sposobu
    /// wypłaty albo z tego samego wydarzenia; kwota — mniejsza z obu sald.
    static func offsets(_ rows: [EmployeeCommission], selected: Set<String>) -> [CommissionOffsetStep] {
        let targets = ordered(rows.filter { selected.contains($0.id) && $0.payable })
        let deductions = ordered(rows.filter { $0.canManage && $0.isDeduction && $0.status == "approved" && $0.toOffsetCents > 0 })
        var left = Dictionary(uniqueKeysWithValues: targets.map { ($0.id, $0.remainingCents) })
        var steps: [CommissionOffsetStep] = []
        for deduction in deductions {
            var deductionLeft = deduction.toOffsetCents
            for target in targets {
                if deductionLeft <= 0 { break }
                let targetLeft = left[target.id] ?? 0
                guard targetLeft > 0, (target.companyId ?? "") == (deduction.companyId ?? ""),
                      samePerson(deduction.person, target.person),
                      target.paymentMethod == deduction.paymentMethod || target.eventId == deduction.eventId else { continue }
                let amount = min(deductionLeft, targetLeft)
                steps.append(CommissionOffsetStep(deduction: deduction, target: target, amountCents: amount))
                deductionLeft -= amount
                left[target.id] = targetLeft - amount
            }
        }
        return steps
    }
    /// Prowizje, z których można potrącić daną nadpłatę (okno „Potrąć z prowizji”).
    static func deductionTargets(_ rows: [EmployeeCommission], for deduction: EmployeeCommission) -> [EmployeeCommission] {
        ordered(rows.filter { row in
            row.id != deduction.id && row.payable && (row.companyId ?? "") == (deduction.companyId ?? "")
                && (row.paymentMethod == deduction.paymentMethod || row.eventId == deduction.eventId)
                && (deduction.person == nil || row.person == nil || samePerson(deduction.person, row.person))
        })
    }
}

// MARK: Wywołania API

extension TeamStore: CommissionAccountHost {
    func commissionAccount(_ id: String) -> EmployeeCommissionAccount? { commissionAccounts[id] }
    func commissionError(_ id: String) -> String? { commissionErrors[id] }
    func loadCommissions(_ id: String) async {
        do {
            let account = try await profile("commissions", id, as: EmployeeCommissionAccount.self)
            commissionAccounts[id] = account
            commissionErrors[id] = nil
        } catch {
            if commissionAccounts[id] == nil { commissionErrors[id] = failureText(error, "Nie udało się wczytać prowizji.") }
        }
    }
    func commissionPost<T: Decodable>(_ op: String, _ employeeID: String, _ body: [String: JSONValue], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op); payload["employeeId"] = .string(employeeID)
        let data = try await api.post("/employees/profile", payload)
        return try JSONDecoder().decode(T.self, from: data)
    }
    /// Czy wynik zapisu jest niepewny (zapis mógł się wykonać) — wtedy ponawiamy z tym samym identyfikatorem operacji.
    nonisolated static func uncertain(_ error: Error) -> Bool {
        if let failure = error as? NativeFailure { return failure.status >= 500 }
        if let app = error as? AppError {
            switch app {
            case .unauthorized, .configuration, .forbidden, .noEmployee, .unsupported, .missingSync: return false
            default: return true
            }
        }
        return true
    }
}

/// Konto prowizji i narzutów sprzedawcy z kartoteki (`/bridge/native/v1/sellers`, konto `partner`).
extension SellersStore: CommissionAccountHost {
    func commissionAccount(_ id: String) -> EmployeeCommissionAccount? { commissionAccounts[id] }
    func commissionError(_ id: String) -> String? { commissionErrors[id] }
    func loadCommissions(_ id: String) async {
        guard let api else { commissionErrors[id] = "Brak połączenia z serwerem CRM."; return }
        do {
            let data = try await api.get("/sellers?op=commissions&id=\(id)")
            commissionAccounts[id] = try JSONDecoder().decode(EmployeeCommissionAccount.self, from: data)
            commissionErrors[id] = nil
        } catch {
            if commissionAccounts[id] == nil { commissionErrors[id] = failureText(error, "Nie udało się wczytać prowizji sprzedawcy.") }
        }
    }
    func commissionPost<T: Decodable>(_ op: String, _ id: String, _ body: [String: JSONValue], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op); payload["id"] = .string(id)
        return try JSONDecoder().decode(T.self, from: try await api.post("/sellers", payload))
    }
}

/// Odpowiedź prostych zapisów prowizji (`{ ok, duplicate, amount? }`).
struct CommissionWriteReply: Decodable {
    var ok: Bool?
    var duplicate: Bool?
    var amount: Double?
}
