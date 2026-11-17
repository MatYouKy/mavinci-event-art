import SwiftUI

// MARK: Finanse (`/crm/invoices`) — dane z `/bridge/native/v1/finance` (`src/lib/native/finance.ts`): działalności z „Podglądem
// finansów”, Centrum finansów (get_finance_center), terminy i monity (get_finance_deadlines), biała lista VAT
// (get_vat_whitelist_status) i zamknięcia miesięcy (get_finance_periods). Kształt odpowiedzi ustala serwer (camelCase,
// liczby i null). Obliczenia ekranów (wiekowanie, prognoza 13 tygodni) — 1:1 z `FinanceCenterPanel.tsx`.

struct FinCompany: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    /// „Zarządzanie finansami” działalności (ustawienia, terminy, zamknięcia).
    var canManage: Bool
    /// „Wystawianie faktur” działalności (przypomnienia o płatności).
    var canRemind: Bool
}

struct FinCenter: Codable {
    struct Account: Codable, Identifiable, Hashable {
        var key: String
        var label: String
        var accountType: String
        var currency: String
        var balance: Double?
        var asOf: String?
        var id: String { key }
    }
    struct Cash: Codable {
        var accounts: [Account]
        var asOf: String?
        var total: Double
        var daysOld: Double?
    }
    struct Item: Codable, Hashable {
        var kind: String
        var direction: String
        var id: String
        var invoiceId: String?
        var label: String?
        var counterparty: String?
        var issueDate: String?
        var dueDate: String?
        var amount: Double
        var currency: String
        var estimated: Bool
        var note: String?
        var daysOverdue: Double?
        var isPLN: Bool { currency.isEmpty || currency == "PLN" }
        var overdueDays: Int { Int(daysOverdue ?? 0) }
    }
    struct Obligation: Codable, Hashable {
        var kind: String
        var form: String
        var periodKind: String
        var periodStart: String
        var label: String
        var dueDate: String
        var amount: Double?
        var estimated: Bool
        var status: String
        var overdue: Bool
        var key: String { "\(kind):\(form):\(periodKind):\(periodStart)" }
    }
    struct VatMonth: Codable, Hashable {
        var periodStart: String
        var outputVat: Double
        var inputVat: Double
        var carried: Double
        var estimate: Double
        var salesCount: Double
        var costCount: Double
        var foreignCount: Double
        var declared: Double?
        var paid: Double
        var dueDate: String?
    }
    struct Cit: Codable {
        var year: Double
        var rate: Double?
        var revenueNet: Double
        var costsNet: Double
        var result: Double
        var tax: Double?
        var paid: Double
        var reserve: Double?
    }
    struct Forecast: Codable {
        var week0: String
        var until: String
        var weeks: Int
    }
    struct Quality: Codable, Hashable {
        var level: String
        var key: String
        var text: String
        var tab: String
        var section: String?
    }
    struct CheckItem: Codable, Hashable {
        var key: String
        var label: String
        var done: Bool?
        var detail: String?
        var tab: String
        var section: String?
    }
    struct Checklist: Codable {
        var periodYear: Double
        var periodMonth: Double
        var items: [CheckItem]
    }
    var companyId: String
    var companyName: String
    var today: String
    var canManage: Bool
    var cash: Cash
    var items: [Item]
    var obligations: [Obligation]
    var vat: [VatMonth]?
    var cit: Cit
    var forecast: Forecast
    var quality: [Quality]
    var checklist: Checklist
    var citRate: Double?
}

struct FinDeadlines: Codable {
    struct Obligation: Codable, Hashable, Identifiable {
        var kind: String
        var form: String
        var periodKind: String
        var periodStart: String
        var label: String
        var settingLabel: String?
        var dueDate: String
        var amountDue: Double?
        var paid: Double
        var status: String
        var overdue: Bool
        var id: String { "\(kind)|\(form)|\(periodKind)|\(periodStart)" }
        var sortAmount: Double { amountDue ?? -1 }
    }
    struct Receivable: Codable, Hashable, Identifiable {
        var source: String
        var id: String
        var invoiceId: String?
        var invoiceNumber: String
        var buyerName: String?
        var buyerEmail: String?
        var issueDate: String?
        var dueDate: String
        var gross: Double
        var outstanding: Double
        var currency: String
        var inKsef: Bool
        var daysOverdue: Double
        var reminders: Double
        var lastReminderAt: String?
        var sortBuyer: String { buyerName ?? "" }
        var sortLastReminder: String { lastReminderAt ?? "" }
    }
    struct Payable: Codable, Hashable, Identifiable {
        var id: String
        var invoiceNumber: String
        var sellerName: String?
        var sellerNip: String?
        var issueDate: String?
        var dueDate: String?
        var dueSource: String?
        var amount: Double
        var currency: String
        var bankAccount: String?
        var daysLeft: Double?
        var supplierDays: Double?
        var sortSeller: String { sellerName ?? "" }
        /// Bez terminu na początku (jak w CRM: NULLS FIRST).
        var sortDue: String { dueDate ?? "" }
        var sortAccount: String { bankAccount ?? "" }
    }
    struct SupplierTerm: Codable, Hashable, Identifiable {
        var sellerNip: String
        var sellerName: String?
        var days: Double
        var id: String { sellerNip }
    }
    struct Setting: Codable, Hashable {
        var kind: String
        var form: String
        var periodKind: String
        var enabled: Bool
        var dueDay: Int
        var dueMonthOffset: Int
        var label: String?
        var key: String { "\(kind)|\(form)|\(periodKind)" }
    }
    var today: String
    var statementEnd: String?
    var obligations: [Obligation]
    var receivables: [Receivable]
    var payables: [Payable]
    var supplierTerms: [SupplierTerm]
    var settings: [Setting]
}

struct FinWhitelist: Codable {
    struct Payable: Codable, Hashable {
        var ksefInvoiceId: String
        var nip: String?
        var account: String?
        var gross: Double
        var verdict: String?
        var statusVat: String?
        var checkDate: String?
        var requestId: String?
        var fresh: Bool
    }
    struct Payment: Codable, Hashable, Identifiable {
        var bankTransactionId: String
        var documentNumber: String?
        var sellerName: String?
        var nip: String?
        var account: String?
        var transactionDate: String
        var amount: Double
        var documentGross: Double
        var verdict: String?
        var statusVat: String?
        var requestId: String?
        var id: String { "\(bankTransactionId):\(documentNumber ?? "")" }
        var sortSeller: String { sellerName ?? "" }
        var sortDocument: String { documentNumber ?? "" }
        var sortVerdict: String { verdict ?? "" }
    }
    var today: String
    var payables: [Payable]
    var payments: [Payment]
}

struct FinPeriod: Codable, Hashable, Identifiable {
    struct Reopening: Codable, Hashable {
        var unlockedAt: String
        var reason: String?
        var byName: String?
    }
    var month: Int
    var locked: Bool
    var lockedAt: String?
    var lockedByName: String?
    var lockNote: String?
    var handedOverAt: String?
    var reopenings: [Reopening]
    var id: Int { month }
}

/// Stan sekcji jednej działalności — zapisywany na dysku (zaszyfrowany), pokazywany od razu po otwarciu.
struct FinState: Codable {
    var companyId: String
    var loadedAt: String
    var center: FinCenter?
    var centerError: String?
    var deadlines: FinDeadlines?
    var deadlinesError: String?
    var whitelist: FinWhitelist?
    var periodsYear: Int
    var periods: [FinPeriod]
    var periodsError: String?
}

struct FinStateReply: Decodable {
    var companies: [FinCompany]
    var company: String?
    var state: FinState?
}

struct FinPeriodsReply: Decodable {
    var year: Int
    var periods: [FinPeriod]
}

struct FinReminderSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
    }
    struct Recipient: Decodable, Identifiable, Hashable {
        var contactId: String?
        var email: String
        var name: String
        var position: String?
        var preferred: Bool
        var id: String { email.lowercased() }
    }
    var invoiceId: String
    var number: String
    var accounts: [Account]
    var recipients: [Recipient]
    var organizationName: String
    var to: String
    var recipientName: String
    var subject: String
    var text: String
    var dueDate: String?
    var outstanding: Double
    var currency: String
    var pdfStored: Bool
}

struct FinReminderResult: Decodable {
    var scheduled: Bool
    var scheduledAt: String?
    var message: String
    var warnings: [String]
}

// MARK: Formatowanie — jak w panelach CRM (pl-PL)

enum FinFormat {
    static let months = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"]
    static let monthsTitle = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"]

    private static let decimal: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()
    private static let whole: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    /// `toLocaleString('pl-PL', { minimumFractionDigits: 2 })` + „ zł” (albo kod waluty).
    static func money(_ value: Double, _ currency: String = "PLN") -> String {
        let text = decimal.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        return text + " " + (currency.isEmpty || currency == "PLN" ? "zł" : currency)
    }
    /// Kwota zaokrąglona do złotych (opisy przełączników prognozy).
    static func short(_ value: Double) -> String {
        (whole.string(from: NSNumber(value: value.rounded())) ?? String(Int(value.rounded()))) + " zł"
    }
    /// „dd.MM.rrrr” z „rrrr-MM-dd”; brak — „—”.
    static func day(_ value: String?) -> String { FinanceText.day(value) }
    /// „dd.MM”.
    static func dayMonth(_ value: String) -> String {
        let parts = value.prefix(10).split(separator: "-")
        return parts.count == 3 ? "\(parts[2]).\(parts[1])" : value
    }
    /// „listopad 2026”.
    static func monthLabel(_ value: String) -> String {
        let parts = value.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2, (1...12).contains(parts[1]) else { return value }
        return "\(months[parts[1] - 1]) \(parts[0])"
    }
    /// Data i godzina jak `toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })`.
    static func dateTime(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        guard let date = MeetingDates.parse(value) else { return day(value) }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
    static func date(_ value: String) -> Date? { FinanceText.dayDate(String(value.prefix(10))) }
    /// Różnica dni między datami „rrrr-MM-dd” (jak `daysBetween` w CRM).
    static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let start = date(from), let end = date(to) else { return 0 }
        return Int((end.timeIntervalSince(start) / 86_400).rounded())
    }
    static func addDays(_ value: String, _ days: Int) -> String {
        guard let start = date(value), let next = MeetingDates.calendar.date(byAdding: .day, value: days, to: start) else { return value }
        return FinanceText.dayString(next)
    }
    static func dayWord(_ days: Int) -> String { abs(days) == 1 ? "dzień" : "dni" }
}

// MARK: Odnośniki CRM używane przez dane (zakładka i sekcja `/crm/invoices`)

enum FinLink {
    static func section(_ tab: String, _ section: String?) -> String {
        var href = "/crm/invoices?tab=\(tab)"
        if let section, !section.isEmpty { href += "&section=\(section)" }
        return href
    }
    /// Odnośnik pozycji Centrum (`itemHref` w CRM).
    static func item(_ item: FinCenter.Item) -> String? {
        if let id = item.invoiceId { return "/crm/invoices/\(id)" }
        switch item.kind {
        case "payable": return item.note != "dokument spoza KSeF" ? section("external", "deadlines") : section("external", "external")
        case "receivable": return section("ksef", nil)
        case "recurring_cost", "recurring_income": return section("external", "recurring")
        case "payroll": return section("external", "contracts")
        default: return nil
        }
    }
}

// MARK: Wiekowanie i prognoza (1:1 z `FinanceCenterPanel.tsx`)

enum FinBucket: String, CaseIterable, Identifiable {
    case noDue, current, d1to30, d31to60, d61to90, d90
    var id: String { rawValue }
    var label: String {
        switch self {
        case .noDue: return "Bez terminu"
        case .current: return "W terminie"
        case .d1to30: return "1–30 dni po terminie"
        case .d31to60: return "31–60 dni"
        case .d61to90: return "61–90 dni"
        case .d90: return "Ponad 90 dni"
        }
    }
    var late: Bool { self != .noDue && self != .current }
    static func of(_ item: FinCenter.Item, today: String) -> FinBucket {
        guard let due = item.dueDate else { return .noDue }
        let late = FinFormat.daysBetween(due, today)
        if late <= 0 { return .current }
        if late <= 30 { return .d1to30 }
        if late <= 60 { return .d31to60 }
        if late <= 90 { return .d61to90 }
        return .d90
    }
}

struct FinAging {
    struct Sum { var amount: Double = 0; var count: Int = 0 }
    var sums: [FinBucket: Sum] = [:]
    var total: Double = 0
    var overdue: Double = 0
    init(_ items: [FinCenter.Item], today: String) {
        for bucket in FinBucket.allCases { sums[bucket] = Sum() }
        for item in items {
            let bucket = FinBucket.of(item, today: today)
            sums[bucket, default: Sum()].amount += item.amount
            sums[bucket, default: Sum()].count += 1
            total += item.amount
            if bucket.late { overdue += item.amount }
        }
    }
    func sum(_ bucket: FinBucket) -> Sum { sums[bucket] ?? Sum() }
}

struct FinFlow: Identifiable, Hashable {
    var id: String
    var direction: String
    var kindLabel: String
    var label: String
    var counterparty: String?
    var dueDate: String?
    var amount: Double
    var estimated: Bool
    var href: String?
    var unassigned: Bool
    var incoming: Bool { direction == "in" }
}

struct FinWeek: Identifiable {
    var index: Int
    var start: String
    var end: String
    var inflows: Double = 0
    var outflows: Double = 0
    var flows: [FinFlow] = []
    var id: Int { index }
}

/// Widok Centrum: pozycje w PLN, wiekowanie, prognoza 13 tygodni z przełącznikami jak w CRM.
struct FinCenterModel {
    static let kindLabels: [String: String] = [
        "receivable": "Należność", "receivable_ksef_paid": "Do wyjaśnienia", "proforma": "Pro forma",
        "milestone": "Harmonogram wydarzenia", "payable": "Faktura kosztowa", "recurring_income": "Umowa stała",
        "recurring_cost": "Umowa stała", "payroll": "Wynagrodzenie", "obligation": "ZUS i podatki",
    ]

    var today: String
    var receivables: [FinCenter.Item]
    var payables: [FinCenter.Item]
    var conflicts: [FinCenter.Item]
    var foreign: [FinCenter.Item]
    var receivableAging: FinAging
    var payableAging: FinAging
    var weeks: [FinWeek]
    var overdueInflows: Double = 0
    var overdueOutflows: Double = 0
    var overdueUnassigned: Double = 0
    var overdueFlows: [FinFlow] = []
    var undatedInflows: Double = 0
    var undatedOutflows: Double = 0
    var undatedFlows: [FinFlow] = []
    var unknownObligations: [FinCenter.Obligation] = []
    var opening: Double
    var start: Double
    var balances: [Double]
    var lowestValue: Double
    var lowestIndex: Int
    var maxFlow: Double
    var firstNegative: Int?
    var vatCurrent: FinCenter.VatMonth?
    var vatPrevious: FinCenter.VatMonth?
    var upcomingObligations: [FinCenter.Obligation]
    var overdueObligations: [FinCenter.Obligation]

    init(_ data: FinCenter, includeOverdueIn: Bool, includeUnassigned: Bool) {
        let today = data.today
        self.today = today
        receivables = data.items.filter { $0.kind == "receivable" && $0.isPLN }
        payables = data.items.filter { $0.kind == "payable" && $0.isPLN }
        conflicts = data.items.filter { $0.kind == "receivable_ksef_paid" }
        foreign = data.items.filter { !$0.isPLN && $0.kind != "receivable_ksef_paid" }
        receivableAging = FinAging(receivables, today: today)
        payableAging = FinAging(payables, today: today)

        // Prognoza: pozycje w PLN (bez faktur do wyjaśnienia) i ZUS/podatki z kwotą.
        var flows: [FinFlow] = []
        for (index, item) in data.items.enumerated() where item.isPLN && item.kind != "receivable_ksef_paid" {
            flows.append(FinFlow(
                id: "\(index)|\(item.kind):\(item.id):\(item.dueDate ?? ""):\(item.label ?? "")",
                direction: item.direction,
                kindLabel: Self.kindLabels[item.kind] ?? item.kind,
                label: item.label ?? "—",
                counterparty: item.counterparty,
                dueDate: item.dueDate,
                amount: item.amount,
                estimated: item.estimated,
                href: FinLink.item(item),
                unassigned: false
            ))
        }
        var unknown: [FinCenter.Obligation] = []
        for obligation in data.obligations {
            guard let amount = obligation.amount else { unknown.append(obligation); continue }
            if amount <= 0.009 { continue }
            flows.append(FinFlow(
                id: "obligation:\(obligation.key)",
                direction: "out",
                kindLabel: Self.kindLabels["obligation"] ?? "ZUS i podatki",
                label: obligation.label,
                counterparty: obligation.kind == "zus" ? "ZUS" : "Urząd skarbowy",
                dueDate: obligation.dueDate,
                amount: amount,
                estimated: obligation.estimated,
                href: FinLink.section("external", "deadlines"),
                // Brak jakiejkolwiek zapłaty mimo wyciągu za termin — zwykle nieprzypisany przelew; częściowa zapłata = realna reszta.
                unassigned: obligation.status == "unpaid" && obligation.overdue
            ))
        }
        unknownObligations = unknown

        let week0 = data.forecast.week0
        var weeks: [FinWeek] = (0..<max(data.forecast.weeks, 0)).map { index in
            let start = FinFormat.addDays(week0, index * 7)
            return FinWeek(index: index, start: start, end: FinFormat.addDays(start, 6))
        }
        for flow in flows {
            guard let due = flow.dueDate else {
                undatedFlows.append(flow)
                if flow.incoming { undatedInflows += flow.amount } else { undatedOutflows += flow.amount }
                continue
            }
            if due < today {
                overdueFlows.append(flow)
                if flow.incoming { overdueInflows += flow.amount }
                else if flow.unassigned { overdueUnassigned += flow.amount }
                else { overdueOutflows += flow.amount }
                continue
            }
            if due > data.forecast.until { continue }
            let index = Int((Double(FinFormat.daysBetween(week0, due)) / 7).rounded(.down))
            guard weeks.indices.contains(index) else { continue }
            weeks[index].flows.append(flow)
            if flow.incoming { weeks[index].inflows += flow.amount } else { weeks[index].outflows += flow.amount }
        }
        self.weeks = weeks
        opening = data.cash.total
        start = opening + (includeOverdueIn ? overdueInflows : 0) - overdueOutflows - (includeUnassigned ? overdueUnassigned : 0)
        var running = start
        var balances: [Double] = []
        for week in weeks {
            running += week.inflows - week.outflows
            balances.append(running)
        }
        self.balances = balances
        var lowestValue = start
        var lowestIndex = -1
        for (index, value) in balances.enumerated() where value < lowestValue {
            lowestValue = value
            lowestIndex = index
        }
        self.lowestValue = lowestValue
        self.lowestIndex = lowestIndex
        maxFlow = max(1, weeks.map { max($0.inflows, $0.outflows) }.max() ?? 0)
        firstNegative = balances.firstIndex { $0 < 0 }

        let month = String(today.prefix(7))
        vatCurrent = data.vat?.first { String($0.periodStart.prefix(7)) == month }
        vatPrevious = data.vat?.first { String($0.periodStart.prefix(7)) != month }
        upcomingObligations = data.obligations
            .filter { $0.dueDate >= today && FinFormat.daysBetween(today, $0.dueDate) <= 45 }
            .sorted { $0.dueDate < $1.dueDate }
        overdueObligations = data.obligations.filter { $0.dueDate < today }
    }
}

// MARK: Oceny i etykiety (jak `whitelistChip` i `obligationChip` w CRM)

struct FinChip {
    enum Tone { case ok, warn, bad, neutral, muted }
    var text: String
    var tone: Tone
    var color: Color {
        switch tone {
        case .ok: return CrmTheme.rgb(0x4ade80)
        case .warn: return CrmTheme.rgb(0xfbbf24)
        case .bad: return CrmTheme.rgb(0xf87171)
        case .neutral: return Color.secondary
        case .muted: return Color.secondary.opacity(0.7)
        }
    }

    /// Biała lista VAT (próg 15 000 zł — wartość transakcji).
    static func whitelist(verdict: String?, statusVat: String?, nip: String?, fresh: Bool, big: Bool) -> FinChip {
        guard nip != nil else { return FinChip(text: "bez polskiego NIP — nie dotyczy", tone: .muted) }
        guard let verdict else { return FinChip(text: big ? "niesprawdzone — ponad 15 000 zł" : "niesprawdzone", tone: big ? .warn : .neutral) }
        switch verdict {
        case "error": return FinChip(text: "błąd sprawdzenia — powtórz", tone: .neutral)
        case "not_found": return FinChip(text: "NIP poza wykazem VAT", tone: .bad)
        case "not_listed": return FinChip(text: "rachunku nie ma na białej liście", tone: .bad)
        case "no_account": return FinChip(text: "faktura bez rachunku · VAT: \(statusVat ?? "—")", tone: .neutral)
        default:
            if fresh {
                let vat = statusVat.flatMap { $0 != "Czynny" ? " · VAT: \($0)" : nil } ?? ""
                return FinChip(text: "na białej liście" + vat, tone: .ok)
            }
            return FinChip(text: "na liście — sprawdź w dniu przelewu", tone: .warn)
        }
    }

    /// Stan obowiązku ZUS / podatku.
    static func obligation(_ item: FinDeadlines.Obligation, today: String) -> FinChip {
        switch item.status {
        case "paid": return FinChip(text: "Zapłacone", tone: .ok)
        case "paid_no_amount": return FinChip(text: "Zapłacone · brak kwoty z deklaracji", tone: .warn)
        case "unconfirmed": return FinChip(text: "Brak wyciągu — nie da się potwierdzić", tone: .neutral)
        default: break
        }
        if item.overdue { return FinChip(text: item.status == "partial" ? "Częściowo · po terminie" : "Po terminie", tone: .bad) }
        if item.status == "partial" { return FinChip(text: "Zapłacone częściowo", tone: .warn) }
        let left = FinFormat.daysBetween(today, item.dueDate)
        if left <= 3 { return FinChip(text: left <= 0 ? "Termin dziś" : "Termin za \(left) \(FinFormat.dayWord(left))", tone: .warn) }
        return FinChip(text: "Do zapłaty", tone: .neutral)
    }
}

/// Etykieta stanu: kropka i tekst w kolorze (jak statusy w tabelach aplikacji).
struct FinChipView: View {
    let chip: FinChip
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(chip.color).frame(width: 7, height: 7)
            Text(chip.text).foregroundStyle(chip.tone == .muted || chip.tone == .neutral ? Color.secondary : chip.color).lineLimit(1)
        }
    }
}
