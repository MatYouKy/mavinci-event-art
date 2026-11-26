import SwiftUI

// MARK: Bank i deklaracje — dane z `/bridge/native/v1/finance/bank` (te same funkcje bazy co panele CRM „Uzgodnienie
// wyciągów”, „Wyciągi i płatności”, „ZUS i podatki”). Opisy reguł, metod i rodzajów dokumentów przychodzą z serwera
// (wspólne etykiety CRM), tu tylko etykiety i kolory stanów.

// MARK: Uzgodnienie miesiąca

struct BankPeriod: Codable, Hashable, Identifiable {
    var companyId: String
    var year: Int
    var month: Int
    var id: String { "\(companyId):\(year):\(month)" }
    var label: String { "\(FinFormat.months[max(0, min(11, month - 1))]) \(year)" }
}

struct BankPeriodsReply: Decodable { var periods: [BankPeriod] }

struct BankMonth: Decodable {
    struct LastRun: Decodable { var at: String; var sentence: String }
    struct Source: Decodable, Identifiable {
        var id: String
        var kind: String
        var format: String?
        var fileName: String
        var count: Double
        var opening: Double?
        var closing: Double?
        var confirmed: Double
        var unconfirmed: Double
    }
    struct Declaration: Decodable, Identifiable {
        var id: String
        var label: String
        var amountDue: Double?
        var paid: Double
        var status: String
    }
    struct Contract: Decodable, Identifiable {
        var id: String
        var title: String
        var currency: String
        var periods: [String]
        var due: Double
        var paidForPeriods: Double
        var missing: Double
        var status: String
    }
    struct DocRow: Decodable, Identifiable {
        var source: String
        var sourceLabel: String
        var id: String
        var number: String?
        var party: String?
        var side: String
        var due: Double
        var open: Double
        var manualPaid: Double
        var paymentDate: String?
        var dueDate: String?
        var issueDate: String?
        var currency: String
    }

    var companyId: String
    var year: Int
    var month: Int
    var canManage: Bool
    var loadedAt: String
    var lastRun: LastRun?
    var sources: [Source]
    var transactions: [BankTx]
    var declarations: [Declaration]
    var contracts: [Contract]
    var paidWithoutStatement: [DocRow]
    var unpaidDue: [DocRow]
    var shadowDocuments: [DocRow]
}

struct BankTx: Decodable, Identifiable {
    struct Allocation: Decodable, Identifiable {
        var matchId: String
        var source: String
        var sourceLabel: String
        var documentId: String?
        var number: String?
        var party: String?
        var amount: Double
        var documentAmount: Double?
        var documentCurrency: String?
        var rate: Double?
        var method: String
        var reasons: [String]
        var open: Double
        var facts: String?
        var previewable: Bool
        var id: String { matchId }
    }
    struct Personnel: Decodable, Identifiable {
        var id: String
        var recipient: String
        var amount: Double
        var contractNumber: String?
        var method: String
        var reasons: [String]
    }
    struct DeclarationLink: Decodable, Identifiable {
        var paymentId: String
        var declarationId: String
        var label: String
        var amount: Double
        var method: String
        var reasons: [String]
        var status: String
        var id: String { paymentId }
    }
    struct ContractLink: Decodable, Identifiable {
        var paymentId: String
        var contractId: String
        var title: String
        var periodLabel: String
        var amount: Double
        var method: String
        var reasons: [String]
        var periodAmount: Double
        var periodPaid: Double
        var id: String { paymentId }
    }
    struct Refund: Decodable, Identifiable {
        struct Other: Decodable {
            var id: String
            var statementId: String
            var date: String
            var amount: Double
            var direction: String
            var currency: String
            var counterparty: String?
            var title: String?
        }
        var pairId: String
        var role: String
        var amount: Double
        var method: String
        var reasons: [String]
        var other: Other
        var id: String { pairId }
    }
    struct Explanation: Decodable {
        var category: String
        var label: String
        var note: String?
        var automatic: Bool
    }
    struct ProposalDoc: Decodable {
        var source: String
        var sourceLabel: String
        var id: String?
        var number: String?
        var party: String?
        var amount: Double
        var documentAmount: Double?
        var documentCurrency: String?
        var rate: Double?
        var manual: Bool
        var createsDeclaration: Bool
        var periodLabel: String?
        var contractAmount: Double?
        var confirmNet: Bool
        var suggested: Bool
        var hint: String?
        var facts: String?
        var statementId: String?
        var previewable: Bool
        /// „Co do czego pasuje” — płatność obok dokumentu (`proposalComparison` na serwerze); brak u starszego serwera CRM.
        var comparison: [ComparisonRow]?
        var comparisonSummary: String?
    }
    /// Wiersz porównania: z wyciągu i z dokumentu (zaznaczone fragmenty — to, co się zgadza), ocena i opis.
    struct ComparisonRow: Decodable, Identifiable {
        struct Segment: Decodable {
            var text: String
            var hit: Bool
        }
        var key: String
        var label: String
        var payment: [Segment]
        var document: [Segment]
        /// match — zgadza się, partial — do sprawdzenia, mismatch — nie zgadza się, info — bez porównania.
        var state: String
        var verdict: String
        var id: String { key }
    }
    struct Proposal: Decodable {
        var id: String
        var kind: String
        var rule: String
        var ruleLabel: String
        var reason: String
        var documents: [ProposalDoc]
        var isRefund: Bool { rule == "zwrot_platnosci" }
    }

    var id: String
    var statementId: String
    var date: String
    /// Data księgowania, gdy operacja jest z innego miesiąca niż wyciąg (np. karta 29.09 zaksięgowana 01.10 — wyciąg za październik).
    var bookedDate: String?
    var amount: Double
    var direction: String
    var currency: String
    var counterparty: String?
    var counterpartyAccount: String?
    var title: String?
    var sourceDescription: String?
    var accountKind: String
    var unconfirmed: Bool
    var allocated: Double
    var remaining: Double
    var status: String
    var allocations: [Allocation]
    var personnel: [Personnel]
    var declarations: [DeclarationLink]
    var contracts: [ContractLink]
    var refunds: [Refund]
    var explanation: Explanation?
    var proposal: Proposal?

    var credit: Bool { direction == "credit" }
    var isOpen: Bool { BankStatus.open.contains(status) }
    var signedAmount: String { (credit ? "+" : "−") + FinFormat.money(amount, currency) }
    var displayName: String { counterparty?.nonEmpty ?? "Bez nazwy kontrahenta" }
    var linkCount: Int { allocations.count + personnel.count + declarations.count + contracts.count + refunds.count }
    /// Wpłata gotówki we wpłatomacie / wpłata własna — podpowiedź „Wpłata własna” (jak `isCashDeposit` w CRM).
    var looksLikeCashDeposit: Bool {
        let text = "\(title ?? "") \(sourceDescription ?? "")"
        return text.range(of: "WP[ŁL]ATA\\s+(GOT[ÓO]WKI|W[ŁL]ASNA)|WP[ŁL]ATOMA", options: [.regularExpression, .caseInsensitive]) != nil
    }
    /// Tekst do wyszukiwania (kontrahent, tytuł, opis, kwota, numery dokumentów, odbiorcy wypłat, deklaracje, umowy, zwroty).
    var searchText: String {
        var parts: [String] = [counterparty ?? "", title ?? "", sourceDescription ?? "", BankFormat.plain(amount)]
        parts += allocations.map { $0.number ?? "" }
        parts += personnel.map(\.recipient)
        parts += declarations.map(\.label)
        parts += contracts.map(\.title)
        parts += refunds.flatMap { [$0.other.counterparty ?? "", $0.other.title ?? "", BankFormat.plain($0.other.amount)] }
        return parts.joined(separator: " ").lowercased()
    }
}

// MARK: Stany i etykiety (jak `RECONCILIATION_STATUS_META`, `DECLARATION_STATUS_META` w CRM)

enum BankStatus {
    static let order = ["matched", "explained", "transfer", "proposal", "choice", "partial", "missing"]
    /// Do zrobienia: propozycja, wybór, częściowo, brak dokumentu.
    static let open: Set<String> = ["proposal", "choice", "partial", "missing"]
    static func label(_ status: String) -> String {
        switch status {
        case "matched": return "Rozliczona"
        case "explained": return "Wyjaśniona bez faktury"
        case "transfer": return "Przeniesienie własne"
        case "proposal": return "Propozycja"
        case "choice": return "Do wyboru"
        case "partial": return "Częściowo rozliczona"
        default: return "Brak dokumentu"
        }
    }
    static func color(_ status: String) -> Color {
        switch status {
        case "matched": return CrmTheme.rgb(0x86efac)
        case "explained": return CrmTheme.rgb(0x5eead4)
        case "transfer": return CrmTheme.rgb(0xcbd5e1)
        case "proposal": return CrmTheme.rgb(0xfcd34d)
        case "choice": return CrmTheme.rgb(0xfdba74)
        case "partial": return CrmTheme.rgb(0x93c5fd)
        default: return CrmTheme.rgb(0xfca5a5)
        }
    }
}

enum DeclarationStatus {
    static func label(_ status: String) -> String {
        switch status {
        case "paid": return "Zapłacona"
        case "underpaid": return "Niedopłata"
        case "overpaid": return "Nadpłata"
        case "unpaid": return "Brak płatności"
        case "amount_missing": return "Brak kwoty z deklaracji"
        case "nothing_due": return "Do zapłaty 0 zł"
        default: return "Bez kwoty i płatności"
        }
    }
    static func color(_ status: String) -> Color {
        switch status {
        case "paid": return CrmTheme.rgb(0x86efac)
        case "underpaid", "unpaid": return CrmTheme.rgb(0xfca5a5)
        case "overpaid": return CrmTheme.rgb(0x93c5fd)
        case "amount_missing": return CrmTheme.rgb(0xfcd34d)
        default: return CrmTheme.rgb(0xcbd5e1)
        }
    }
    /// Zdanie o stanie (jak `declarationStatusSentence`).
    static func sentence(status: String, amountDue: Double?, paid: Double) -> String {
        let due = amountDue ?? 0
        switch status {
        case "paid": return "Zapłacono \(FinFormat.money(paid)) — zgodnie z deklaracją."
        case "underpaid": return "Zapłacono \(FinFormat.money(paid)) z \(FinFormat.money(due)) — brakuje \(FinFormat.money(due - paid))."
        case "overpaid": return "Zapłacono \(FinFormat.money(paid)), a deklaracja wykazuje \(FinFormat.money(due)) — nadpłata \(FinFormat.money(paid - due))."
        case "unpaid": return "Do zapłaty \(FinFormat.money(due)) — w wyciągach nie ma przelewu."
        case "amount_missing": return "Zapłacono \(FinFormat.money(paid)). Wpisz kwotę z deklaracji, żeby sprawdzić zgodność."
        case "nothing_due": return "Deklaracja nie wykazuje kwoty do zapłaty."
        default: return "Wpisz kwotę z deklaracji i dodaj plik."
        }
    }
    static let attention: Set<String> = ["underpaid", "unpaid", "amount_missing", "overpaid"]
}

enum ContractStatus {
    static func monthLabel(_ status: String) -> String {
        switch status {
        case "paid": return "Opłacona"
        case "missing": return "Brak płatności"
        case "overdue": return "Po terminie"
        case "invoice": return "Rozliczana fakturami"
        default: return "Bez okresu w tym miesiącu"
        }
    }
    static func monthColor(_ status: String) -> Color {
        switch status {
        case "paid": return CrmTheme.rgb(0x86efac)
        case "missing": return CrmTheme.rgb(0xfcd34d)
        case "overdue": return CrmTheme.rgb(0xfca5a5)
        default: return CrmTheme.rgb(0xcbd5e1)
        }
    }
    static func periodLabel(_ status: String) -> String {
        switch status {
        case "paid": return "Opłacony"
        case "overpaid": return "Nadpłata"
        case "missing": return "Brak płatności"
        case "overdue": return "Po terminie"
        case "upcoming": return "Przyszły"
        default: return "Rozliczana fakturami"
        }
    }
    static func cycle(_ value: String) -> String {
        switch value {
        case "quarterly": return "co kwartał"
        case "yearly": return "co rok"
        default: return "co miesiąc"
        }
    }
    static let kinds: [(String, String)] = [
        ("rent", "Najem"), ("lease", "Leasing"), ("subscription", "Abonament"), ("insurance", "Raty ubezpieczenia"),
        ("loan", "Kredyt / pożyczka"), ("other", "Inna umowa"),
    ]
    static let cycles: [(String, String)] = [("monthly", "co miesiąc"), ("quarterly", "co kwartał"), ("yearly", "co rok")]
}

enum BankFormat {
    private static let plainFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.usesGroupingSeparator = false
        return formatter
    }()
    /// „1234,56” — kwota do wyszukiwania i pól formularza.
    static func plain(_ value: Double) -> String { plainFormatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value) }
    /// Liczba z pola („2 829,86” → 2829.86); puste albo błędne — nil.
    static func parse(_ text: String) -> Double? {
        let cleaned = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty else { return nil }
        return Double(cleaned)
    }
    /// „ = 44,03 USD (kurs 4,1234)” — dokument w walucie.
    static func foreign(_ amount: Double?, _ currency: String?, _ rate: Double?) -> String {
        guard let amount, let currency, !currency.isEmpty else { return "" }
        var text = " = \(FinFormat.money(amount, currency))"
        if let rate, rate != 0 {
            let formatter = NumberFormatter()
            formatter.locale = Locale(identifier: "pl_PL")
            formatter.maximumFractionDigits = 4
            text += " (kurs \(formatter.string(from: NSNumber(value: rate)) ?? String(rate)))"
        }
        return text
    }
    /// „12.08” w roku okresu, inaczej „12.08.2025”.
    static func shortDate(_ value: String, year: Int) -> String {
        let parts = value.prefix(10).split(separator: "-")
        guard parts.count == 3 else { return value }
        return Int(parts[0]) == year ? "\(parts[2]).\(parts[1])" : "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    /// „62 1140 2004 0000 3902 7077 4694” dla polskiego rachunku (26 cyfr).
    static func account(_ value: String?) -> String {
        let digits = (value ?? "").filter(\.isNumber)
        guard digits.count == 26 else { return digits }
        var text = String(digits.prefix(2))
        var rest = Substring(digits.dropFirst(2))
        while !rest.isEmpty {
            text += " " + rest.prefix(4)
            rest = rest.dropFirst(4)
        }
        return text
    }
}

// MARK: Wybór dokumentu do płatności

struct BankPicker: Decodable {
    struct Transaction: Decodable {
        var id: String
        var date: String
        var amount: Double
        var currency: String
        var direction: String
        var counterparty: String?
        var title: String?
        var remaining: Double
    }
    struct Document: Decodable, Identifiable {
        var source: String
        var id: String
        var number: String
        var kindLabel: String
        var sourceLabel: String
        var gross: Double
        var outstanding: Double
        var issueDate: String?
        var dueDate: String?
        var counterparty: String?
        var currency: String
        var paymentStatus: String?
        var paid: Bool
        var partiallyPaid: Bool
        var blocking: String?
        var cashException: Bool
        var plannedAmount: Double
        var plannedPartial: Bool
        var plannedLeft: Double
        var previewable: Bool
        /// Część potwierdzona przelewami z wyciągu, część oznaczona ręcznie i ile może jeszcze rozliczyć przelew
        /// (`nil` — baza bez migracji 20261202180000; docs/bank-reconciliation.md, sekcja 17).
        var bankMatched: Double?
        var manualPaid: Double?
        var bankOpen: Double?
        var key: String { "\(source):\(id)" }
        /// Kwota, do której porównujemy płatność: brakująca część, do zapłaty albo całość.
        var amountToMatch: Double { bankOpen ?? (outstanding != 0 ? outstanding : gross) }
        /// Dokument częściowo potwierdzony wyciągiem — przyjmie kolejny przelew (np. drugą ratę).
        var awaitsNextPayment: Bool { source != "personnel" && (bankMatched ?? 0) > 0.009 && (bankOpen ?? 0) > 0.009 }
    }
    var canManage: Bool
    var transaction: Transaction
    var documents: [Document]
}

// MARK: Wyjaśnienie bez faktury

struct BankExplainSetup: Decodable {
    struct Action: Decodable, Identifiable, Hashable {
        var subtype: String
        var label: String
        var defaultNote: String
        var documentLabel: String?
        var requiresDocument: Bool
        var resolvesWithoutDocument: Bool
        var alwaysPending: Bool
        var id: String { subtype }
    }
    struct Statement: Decodable { var accountType: String; var accountSuffix: String?; var fileName: String? }
    struct Candidate: Decodable, Identifiable {
        var id: String
        var date: String
        var amount: Double
        var currency: String
        var direction: String
        var counterparty: String?
        var accountType: String
        var accountSuffix: String?
        var fileName: String?
        var dayDistance: Int
    }
    var canManage: Bool
    var direction: String
    var note: String?
    var actions: [Action]
    var statement: Statement?
    var vatCandidates: [Candidate]
    var vatCandidatesError: String?
}

// MARK: Szczegóły operacji

struct BankTxDetails: Decodable {
    struct Statement: Decodable { var fileName: String?; var format: String; var accountType: String; var account: String?; var year: Int; var month: Int }
    struct Supporting: Decodable, Identifiable {
        var id: String
        var title: String
        var type: String
        var date: String?
        var amount: Double?
        var currency: String
        var fileName: String?
        var notes: String?
        var hasFile: Bool
    }
    struct Paired: Decodable {
        var id: String
        var date: String
        var amount: Double
        var currency: String
        var direction: String
        var counterparty: String?
        var accountType: String
        var accountSuffix: String?
        var fileName: String?
    }
    var id: String
    var date: String
    var postingDate: String?
    var amount: Double
    var currency: String
    var direction: String
    var counterparty: String?
    var counterpartyAccount: String?
    var title: String?
    var reference: String?
    var rawDescription: String?
    var rawCounterparty: String?
    var accountingNote: String?
    var reviewStatus: String?
    var explanation: String?
    var sourceVerified: Bool
    var statement: Statement
    var supporting: [Supporting]
    var paired: Paired?
}

// MARK: Umowy stałe — przypisanie przelewu

struct BankContractCandidates: Decodable {
    struct Transaction: Decodable {
        var id: String
        var date: String
        var amount: Double
        var remaining: Double
        var currency: String
        var direction: String
        var counterparty: String?
        var counterpartyAccount: String?
        var title: String?
    }
    struct Evidence: Decodable { var account: Bool; var name: Bool; var amount: Bool }
    struct Period: Decodable, Identifiable, Hashable {
        var start: String
        var label: String
        var amount: Double
        var paid: Double
        var missing: Double
        var status: String
        var id: String { start }
    }
    struct Contract: Decodable, Identifiable {
        var id: String
        var title: String
        var counterparty: String
        var amount: Double
        var currency: String
        var cycle: String
        var ended: Bool
        var expectsInvoice: Bool
        var evidence: Evidence
        var suggestedPeriod: String?
        var suggestedAmount: Double
        var periods: [Period]
    }
    var canManage: Bool
    var companyId: String
    var transaction: Transaction
    var bestId: String?
    var contracts: [Contract]
}

// MARK: Para „płatność + zwrot”

struct BankRefundCandidates: Decodable {
    struct Transaction: Decodable {
        var id: String
        var date: String
        var amount: Double
        var remaining: Double
        var direction: String
        var currency: String
        var counterparty: String?
        var title: String?
    }
    struct Candidate: Decodable, Identifiable {
        var id: String
        var statementId: String
        var date: String
        var amount: Double
        var remaining: Double
        var direction: String
        var currency: String
        var counterparty: String?
        var title: String?
        var statementYear: Int
        var statementMonth: Int
        var dayDiff: Int
        var sameAmount: Bool
        var sameAccount: Bool
        var words: [String]
        var evidence: String?
        var blocked: Bool
        var explained: Bool
        var role: String
        var suggestedAmount: Double
        var reasons: [String]
    }
    var canManage: Bool
    var transaction: Transaction
    var total: Int
    var truncated: Bool
    var candidates: [Candidate]
}

// MARK: Deklaracje ZUS i podatkowe

struct FinDeclaration: Decodable, Identifiable {
    struct Payment: Decodable, Identifiable {
        var id: String
        var transactionId: String
        var date: String
        var amount: Double
        var method: String
        var reasons: [String]
        var title: String?
        var statementYear: Int
        var statementMonth: Int
    }
    struct File: Decodable, Identifiable {
        var id: String
        var path: String
        var name: String
        var size: Double?
        var createdAt: String?
    }
    struct Line: Decodable, Identifiable {
        var id: String
        var contractId: String?
        var contractNumber: String?
        var personName: String
        var socialInsured: Double
        var socialPayer: Double
        var health: Double
        var funds: Double
        var pit: Double
        var amount: Double
        var notes: String?
    }
    var id: String
    var companyId: String
    var kind: String
    var form: String
    var label: String
    var periodKind: String
    var periodStart: String
    var periodEnd: String
    var amountDue: Double?
    var dueDate: String?
    var notes: String?
    var createdFrom: String
    var paid: Double
    var status: String
    var payments: [Payment]
    var files: [File]
    var lines: [Line]
    var linesTotal: Double
}

struct FinDeclarationsReply: Decodable {
    var companyId: String
    var years: [Int]
    var canManage: Bool
    var declarations: [FinDeclaration]
}

enum DeclarationKinds {
    static let all: [(String, String)] = [
        ("zus", "ZUS"), ("pit", "PIT (zaliczki od wynagrodzeń, ryczałt)"), ("vat", "VAT"), ("cit", "CIT"), ("other", "Inne"),
    ]
    static func label(_ kind: String) -> String { all.first { $0.0 == kind }?.1 ?? "Inne" }
    /// Typowe formularze (symbol można wpisać dowolny) — jak `DECLARATION_FORMS`.
    static let forms: [(form: String, kind: String, period: String, hint: String)] = [
        ("DRA", "zus", "month", "Deklaracja rozliczeniowa ZUS (z raportami RCA)"),
        ("PIT-4R", "pit", "month", "Zaliczki na PIT od wynagrodzeń i umów"),
        ("PIT-8AR", "pit", "month", "Zryczałtowany podatek (np. umowy do 200 zł)"),
        ("VAT-7", "vat", "month", "JPK_V7M — VAT miesięczny"),
        ("VAT-7K", "vat", "quarter", "JPK_V7K — VAT kwartalny"),
        ("CIT-8", "cit", "month", "Zaliczka CIT za miesiąc albo rozliczenie roczne"),
    ]
}

// MARK: Wyciągi

struct BankStatementFile: Decodable, Identifiable {
    var id: String
    var fileName: String
    var accountType: String
    var account: String?
    var format: String
    var month: Int
    var year: Int
    var hasFile: Bool
    var count: Double
    var processed: Bool
    var validation: String
    var validationMessage: String?
    var opening: Double?
    var closing: Double?
    var currency: String
    var createdAt: String?
}

struct BankStatementsReply: Decodable {
    var companyId: String
    var year: Int
    var canManage: Bool
    var statements: [BankStatementFile]
}

// MARK: Pliki i podgląd dokumentu

struct BankFilePayload: Decodable {
    var kind: String
    var name: String?
    var mime: String?
    var data: String?
    var invoice: KsefPreview?
}

struct KsefPreview: Decodable {
    struct Party: Decodable { var name: String?; var nip: String?; var address: String? }
    struct Item: Decodable, Identifiable {
        var name: String
        var quantity: Double?
        var unit: String?
        var unitPrice: Double?
        var net: Double?
        var gross: Double?
        var vatRate: String?
        let id = UUID()
        private enum CodingKeys: String, CodingKey { case name, quantity, unit, unitPrice, net, gross, vatRate }
    }
    var id: String
    var number: String?
    var ksefNumber: String?
    var side: String
    var issueDate: String?
    var dueDate: String?
    var paymentStatus: String?
    var paymentMethod: String?
    var bankAccount: String?
    var seller: Party
    var buyer: Party
    var net: Double?
    var vat: Double?
    var gross: Double?
    var toPay: Double?
    var currency: String
    var items: [Item]
}

/// Plik pobrany z serwera do podglądu w aplikacji (PDF — PDFKit, obraz — podgląd, inne — zapis w Pobranych).
struct BankFile: Identifiable {
    let id = UUID()
    let name: String
    let mime: String
    let data: Data
}
