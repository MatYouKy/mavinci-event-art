import SwiftUI

// MARK: Faktura końcowa — 1:1 z `FinalInvoiceWizardModal`: kontekst (zaliczka z karty, wydarzenie albo podmiot; bez
// kontekstu — wyszukiwanie wydarzenia / podmiotu), firma wystawiająca, nierozliczone zaliczki do wyboru, pełna wartość
// zamówienia (zaakceptowana oferta / kalkulacja wydarzenia, także wspólne rozliczenie, albo zamówienie zapisane przy
// zaliczkach), pozycje odziedziczone z zaliczki albo pełnego zamówienia (do edycji), podsumowanie i rozliczenie
// (`calculateFinalInvoice`), numer, daty i termin płatności, nabywca z zaliczek i odbiorca KSeF, podgląd treści faktury.
// Serwer: `/bridge/native/v1/finance` (`finalSetup`, `finalSearch`, `finalCandidates`, `finalItems`, `finalNumber`,
// `finalCreate` — funkcja bazy `create_paid_final_invoice_atomic`).

/// Otwarcie okna faktury końcowej: z karty zaliczki, z finansów wydarzenia albo bez kontekstu (lista faktur).
struct FinalInvoiceRequest: Identifiable {
    let id = UUID()
    var advanceID: String? = nil
    var eventID: String? = nil
    var organizationID: String? = nil
}

struct FinalInvoiceItem: Codable, Equatable {
    var name: String
    var unit: String
    var quantity: Double
    var priceNet: Double
    var vatRate: Double
    /// Kod stawki z zamówienia (nowa pozycja — brak, jak w CRM: wtedy kodem jest sama stawka).
    var vatCode: String?
    var exemption: String?

    enum CodingKeys: String, CodingKey { case name, unit, quantity, priceNet, vatRate, vatCode, exemption }

    static var blank: FinalInvoiceItem { FinalInvoiceItem(name: "", unit: "szt.", quantity: 1, priceNet: 0, vatRate: 23, vatCode: nil, exemption: nil) }

    var json: JSONValue {
        .object([
            "name": .string(name), "unit": .string(unit), "quantity": .number(quantity), "priceNet": .number(priceNet),
            "vatRate": .number(vatRate), "vatCode": .string(vatCode ?? ""), "exemption": .string(exemption ?? ""),
        ])
    }
}

extension FinalInvoiceItem {
    /// Odczyt pozycji z serwera; brak liczby (np. niepoprawna wartość w źródle) — 0, bez przerywania odczytu całej listy.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? ""
        quantity = (try? c.decodeIfPresent(Double.self, forKey: .quantity)) ?? 0
        priceNet = (try? c.decodeIfPresent(Double.self, forKey: .priceNet)) ?? 0
        vatRate = (try? c.decodeIfPresent(Double.self, forKey: .vatRate)) ?? 0
        vatCode = try c.decodeIfPresent(String.self, forKey: .vatCode)
        exemption = try c.decodeIfPresent(String.self, forKey: .exemption)
    }
}

struct FinalInvoiceCandidate: Decodable, Identifiable, Equatable {
    var id: String
    var number: String
    var status: String
    var issueDate: String?
    var net: Double
    var vat: Double
    var gross: Double
    var paidAmount: Double
    var currency: String
    var eventId: String
    var eventName: String
    var companyId: String
    var buyerName: String
    var buyerNip: String
    var buyerStreet: String
    var buyerPostalCode: String
    var buyerCity: String
    var sellerName: String
    var sellerNip: String
    var recipient: InvoiceRecipientDraft?
    var recipientError: String?
}

struct FinalInvoiceCandidatesReply: Decodable {
    var source: FinalInvoiceCandidate?
    var sourceEventId: String?
    var sourceEventName: String?
    var organizationName: String?
    var candidates: [FinalInvoiceCandidate]
}

struct FinalInvoiceItemsReply: Decodable {
    struct EventOrder: Decodable {
        var eventName: String
        var eventIds: [String]
        var currencyCode: String
        var myCompanyId: String?
        var sourceLabel: String
        var notice: String
    }
    var eventOrder: EventOrder?
    var eventOrderError: String?
    var snapshotNumber: String?
    var fullValueItems: [FinalInvoiceItem]?
    var inheritedItems: [FinalInvoiceItem]?
    var presentationError: String?

    static let empty = FinalInvoiceItemsReply(eventOrder: nil, eventOrderError: nil, snapshotNumber: nil, fullValueItems: nil, inheritedItems: nil, presentationError: nil)
}

struct FinalInvoiceCompany: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var nip: String
    var isDefault: Bool
}

struct FinalInvoiceOption: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var date: String?
}

/// `calculateFinalInvoice` — jedno wyliczenie dla podglądu i zapisu (serwer liczy ponownie przy wystawieniu).
enum FinalInvoiceMath {
    struct Sum: Equatable { var net: Double; var vat: Double; var gross: Double }
    struct Line {
        var position: Int
        var name: String
        var unit: String
        var quantity: Double
        var priceNet: Double
        var vatRate: Double
        var vatCode: String
        var exemption: String?
        var net: Double
        var vat: Double
        var gross: Double
    }
    struct Calculation { var items: [Line]; var totals: Sum; var settled: Sum; var remaining: Sum }

    /// `Math.round(n * 100) / 100`.
    static func round2(_ value: Double) -> Double { InvoiceMath.jsRound(value * 100) / 100 }

    static func calculate(_ items: [FinalInvoiceItem], _ settled: [FinalInvoiceCandidate]) -> Calculation {
        let lines = items.enumerated().map { index, item -> Line in
            let net = round2(item.quantity * item.priceNet)
            let vat = round2(net * item.vatRate / 100)
            let exemption = item.exemption?.trimmingCharacters(in: .whitespacesAndNewlines)
            return Line(position: index + 1, name: item.name, unit: item.unit, quantity: item.quantity, priceNet: item.priceNet,
                        vatRate: item.vatRate, vatCode: item.vatCode ?? FinalFormat.rateText(item.vatRate),
                        exemption: exemption?.isEmpty == false ? exemption : nil, net: net, vat: vat, gross: round2(net + vat))
        }
        let totals = Sum(net: round2(lines.reduce(0) { $0 + $1.net }), vat: round2(lines.reduce(0) { $0 + $1.vat }),
                         gross: round2(lines.reduce(0) { $0 + $1.gross }))
        let paid = Sum(net: round2(settled.reduce(0) { $0 + $1.net }), vat: round2(settled.reduce(0) { $0 + $1.vat }),
                       gross: round2(settled.reduce(0) { $0 + $1.gross }))
        let remaining = Sum(net: round2(totals.net - paid.net), vat: round2(totals.vat - paid.vat), gross: round2(totals.gross - paid.gross))
        return Calculation(items: lines, totals: totals, settled: paid, remaining: remaining)
    }
}

/// Formaty okna faktury końcowej (`toLocaleString('pl-PL')`, kwoty z kodem waluty jak w CRM).
enum FinalFormat {
    private static func formatter(min: Int, max: Int, grouping: Bool = true) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = grouping
        formatter.minimumFractionDigits = min
        formatter.maximumFractionDigits = max
        return formatter
    }
    private static let money2 = formatter(min: 2, max: 2)
    private static let money4 = formatter(min: 2, max: 4)
    private static let quantity4 = formatter(min: 0, max: 4)
    private static let rate = formatter(min: 0, max: 3)

    /// `number(value, max)` z podglądu CRM: co najmniej 2 miejsca po przecinku, „—” dla wartości nieliczbowych.
    static func number(_ value: Double, max: Int = 2) -> String {
        guard value.isFinite else { return "—" }
        let shown = value == 0 ? 0 : value
        return (max == 4 ? money4 : money2).string(from: NSNumber(value: shown)) ?? String(format: "%.2f", shown)
    }
    static func amount(_ value: Double, _ currency: String) -> String { "\(number(value)) \(currency)" }
    static func quantity(_ value: Double) -> String {
        value.isFinite ? quantity4.string(from: NSNumber(value: value)) ?? String(value) : "—"
    }
    static func rateText(_ value: Double) -> String {
        value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
    }
    /// `vatLabel` z podglądu CRM.
    static func vatLabel(_ rate: Double, _ code: String) -> String {
        switch code {
        case "zw": return "Zwolnione"
        case "np", "np I", "np II": return "Nie podlega"
        case "oo": return "Odwrotne obciążenie"
        default: return (rate.isFinite ? (Self.rate.string(from: NSNumber(value: rate)) ?? String(rate)) : "—") + "%"
        }
    }
    /// „RRRR-MM-DD” → „DD.MM.RRRR” (`dateLabel`).
    static func day(_ value: String?) -> String {
        guard let value, value.range(of: "^\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) != nil else { return "—" }
        let parts = value.prefix(10).split(separator: "-")
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    /// `normalizeDecimalInput`: tylko cyfry, przecinek, kropka i minus; pierwsza kropka → przecinek; jeden przecinek.
    static func normalizeDecimal(_ value: String) -> String {
        var text = String(value.filter { $0.isASCII && ($0.isNumber || $0 == "," || $0 == "." || $0 == "-") })
        if let dot = text.firstIndex(of: ".") { text.replaceSubrange(dot...dot, with: ",") }
        while let first = text.firstIndex(of: ","), let last = text.lastIndex(of: ","), first != last { text.remove(at: last) }
        return text
    }
    /// `parseDecimalInput`: wartość nieliczbowa → 0.
    static func parseDecimal(_ value: String) -> Double {
        var text = value
        if let comma = text.firstIndex(of: ",") { text.replaceSubrange(comma...comma, with: ".") }
        if text.isEmpty { return 0 }
        guard let parsed = Double(text), parsed.isFinite else { return 0 }
        return parsed
    }
    /// `formatDecimalInput`: dwa miejsca, przecinek.
    static func input(_ value: Double) -> String {
        String(format: "%.2f", InvoiceMath.fixed2(value.isFinite ? value : 0)).replacingOccurrences(of: ".", with: ",")
    }
    /// NIP do porównań jak `normalizedNip` w oknie CRM (tylko litery i cyfry, wielkie litery).
    static func alnumNip(_ value: String) -> String {
        String(value.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
    }
    static func statusLabel(_ value: String) -> String {
        switch value {
        case "issued": return "Wystawione"
        case "sent": return "Wysłane"
        case "paid": return "Opłacone"
        case "overdue": return "Po terminie"
        case "draft": return "Szkic"
        case "cancelled": return "Anulowane"
        default: return value.isEmpty ? "Nie określono" : value
        }
    }
}

@MainActor final class FinalInvoiceModel: ObservableObject, InvoiceRecipientHost {
    enum Confirm: Identifiable {
        case restoreItems, presentation(String)
        var id: String {
            switch self {
            case .restoreItems: return "restore"
            case .presentation(let mode): return "presentation-\(mode)"
            }
        }
    }

    let advanceID: String?
    let initialEventID: String?
    let initialOrganizationID: String?
    let locked: Bool
    weak var workspace: Workspace?

    // Kontekst
    @Published var mode: String
    @Published var eventID: String?
    @Published var organizationID: String?
    @Published var lockedOrganizationName: String?
    @Published var eventQuery = ""
    @Published var orgQuery = ""
    @Published var eventOptions: [FinalInvoiceOption] = []
    @Published var orgOptions: [FinalInvoiceOption] = []
    @Published var optionsLoading = false

    // Firma
    @Published var companies: [FinalInvoiceCompany] = []
    @Published var manualCompanyID: String?
    private var companyTouched = false

    // Zaliczki
    @Published var source: FinalInvoiceCandidate?
    @Published var sourceEventID: String?
    @Published var sourceEventName: String?
    @Published var candidates: [FinalInvoiceCandidate] = []
    @Published var selectedIDs: Set<String> = []
    @Published var loadingCandidates = false
    @Published var candidatesError: String?
    private var candidatesLoaded = false

    // Pełne zamówienie i pozycje
    @Published private(set) var itemsReply: FinalInvoiceItemsReply?
    @Published private(set) var itemsReplyKey: String?
    @Published var presentationMode = "inherited"
    @Published var items: [FinalInvoiceItem] = [.blank]
    @Published var showOrderItems = false
    @Published var confirm: Confirm?
    private var itemDraft = (context: "", mode: "inherited", edited: false)
    private var itemsRequestKey: String?

    // Numer i daty
    @Published var useCustomNumber = false
    @Published var customNumber = ""
    @Published var autoPreview = ""
    private var numberCompany: String?? = .none
    @Published var issueDate = FinalInvoiceModel.today
    @Published var saleDate = FinalInvoiceModel.today
    @Published var paymentTermDays = "7"

    // Odbiorca KSeF (z zaliczki wzorcowej)
    @Published var recipient = InvoiceRecipientDraft.same
    @Published var recipientAvailable = false
    @Published var recipientReadError: String?
    @Published var recipientLoading = false
    @Published var recipientLoadError: String?
    @Published var recipientOrganizations: [InvoiceRecipientOrganization] = []
    private var recipientSourceID: String?
    private var recipientRequest = 0

    @Published var creating = false
    @Published var problem: String?

    private var candidatesRequest = 0
    private var optionsRequest = 0
    private var numberRequest = 0

    init(advanceID: String?, eventID: String?, organizationID: String?) {
        self.advanceID = advanceID
        initialEventID = eventID
        initialOrganizationID = organizationID
        locked = advanceID != nil || eventID != nil || organizationID != nil
        mode = eventID != nil ? "event" : "organization"
        self.eventID = eventID
        self.organizationID = organizationID
    }

    private var api: NativeAPI? { workspace?.nativeAPI() }
    private func get<T: Decodable>(_ query: [String: String], as kind: T.Type = T.self) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/finance", query: query))
    }
    private func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    /// Dzisiejsza data jak w oknie CRM (`toISOString` — data UTC).
    nonisolated static var today: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    // MARK: Pochodne (jak w oknie CRM)
    var selectedInvoices: [FinalInvoiceCandidate] { candidates.filter { selectedIDs.contains($0.id) } }
    var referenceInvoice: FinalInvoiceCandidate? { source ?? selectedInvoices.first }
    var linkedEventID: String? {
        if advanceID != nil { return sourceEventID?.nonEmpty }
        if mode == "event" { return eventID }
        var seen: [String] = []
        for invoice in selectedInvoices where !invoice.eventId.isEmpty && !seen.contains(invoice.eventId) { seen.append(invoice.eventId) }
        return seen.count == 1 ? seen[0] : nil
    }
    var myCompanyID: String? { manualCompanyID ?? selectedInvoices.first?.companyId.nonEmpty }
    private var draftContext: String { "\(advanceID ?? ""):\(mode):\(eventID ?? ""):\(organizationID ?? "")" }
    private var snapshotID: String? { advanceID != nil ? advanceID : selectedInvoices.first?.id }
    private var itemsKey: String { "\(advanceID ?? "")|\(snapshotID ?? "")|\(linkedEventID ?? "")" }
    private var itemsNeedFetch: Bool { snapshotID != nil || linkedEventID != nil }
    var itemsPending: Bool { !candidatesLoaded || loadingCandidates || itemsReplyKey != itemsKey }
    private var currentReply: FinalInvoiceItemsReply? { itemsReplyKey == itemsKey ? itemsReply : nil }

    var eventOrder: FinalInvoiceItemsReply.EventOrder? { currentReply?.eventOrder }
    var eventOrderError: String? { currentReply?.eventOrderError }
    var loadingEventOrder: Bool { linkedEventID != nil && itemsPending }
    var currencyCode: String { referenceInvoice?.currency.nonEmpty ?? eventOrder?.currencyCode ?? "PLN" }
    var fullValueItems: [FinalInvoiceItem]? { currentReply?.fullValueItems }
    var orderItems: [FinalInvoiceItem]? { presentationMode == "order" ? fullValueItems : currentReply?.inheritedItems }
    var presentationError: String? { presentationMode == "inherited" ? currentReply?.presentationError : nil }
    var orderUnavailable: Bool { loadingCandidates || itemsPending || eventOrderError != nil || presentationError != nil }
    var calculation: FinalInvoiceMath.Calculation { FinalInvoiceMath.calculate(items, selectedInvoices) }
    var paymentDueDate: String? { InvoiceMath.dueDate(issue: issueDate, days: paymentTermDays) }
    var eventOrderEdited: Bool {
        guard let orderItems else { return false }
        if items.count != orderItems.count { return true }
        return zip(items, orderItems).contains { item, source in
            item.name != source.name || item.unit != source.unit || item.quantity != source.quantity
                || item.priceNet != source.priceNet || item.vatRate != source.vatRate
        }
    }
    var snapshotNumber: String? { referenceInvoice?.number ?? currentReply?.snapshotNumber }
    var options: [FinalInvoiceOption] { mode == "event" ? eventOptions : orgOptions }
    /// Klucz wyszukiwania (tryb + wpisany tekst) — zmiana wczytuje listę ponownie.
    var searchKey: String { "\(mode)|\(mode == "event" ? eventQuery : orgQuery)" }
    /// „Wydarzenie: …” w kontekście okna.
    var contextEventName: String {
        if let name = eventOrder?.eventName.nonEmpty { return name }
        if let name = sourceEventName?.nonEmpty { return name }
        if let linked = linkedEventID, let name = candidates.first(where: { $0.eventId == linked })?.eventName.nonEmpty { return name }
        return "Ładowanie…"
    }

    // MARK: Wczytanie
    func start() async {
        let setup = Task { await loadCompanies() }
        await fetchCandidates()
        await setup.value
        refreshNumber()
    }

    private func loadCompanies() async {
        struct Reply: Decodable { var companies: [FinalInvoiceCompany] }
        do {
            let reply: Reply = try await get(["op": "finalSetup"])
            companies = reply.companies
            applyCompanyDefault()
        } catch {
            workspace?.error = failureText(error, "Nie udało się wczytać działalności.")
        }
    }

    /// Wyszukiwanie wydarzeń / podmiotów (okno bez kontekstu): 50 wyników, jak w oknie CRM.
    func loadOptions() async {
        guard !locked else { return }
        optionsRequest += 1
        let request = optionsRequest
        let kind = mode
        let text = (kind == "event" ? eventQuery : orgQuery).trimmingCharacters(in: .whitespaces)
        optionsLoading = true
        defer { if request == optionsRequest { optionsLoading = false } }
        struct Reply: Decodable { var options: [FinalInvoiceOption] }
        var found: [FinalInvoiceOption] = []
        do {
            let reply: Reply = try await get(["op": "finalSearch", "kind": kind, "q": text])
            found = reply.options
        } catch {
            found = []
        }
        guard request == optionsRequest else { return }
        if kind == "event" { eventOptions = found } else { orgOptions = found }
    }

    func chooseMode(_ next: String) async {
        guard next != mode || (next == "event" ? organizationID != nil : eventID != nil) else { return }
        mode = next
        if next == "event" { organizationID = nil } else { eventID = nil }
        await fetchCandidates()
    }

    func chooseEvent(_ id: String) async {
        guard eventID != id else { return }
        eventID = id
        await fetchCandidates()
    }

    func chooseOrganization(_ id: String) async {
        guard organizationID != id else { return }
        organizationID = id
        await fetchCandidates()
    }

    /// `fetchCandidates`: nierozliczone zaliczki kontekstu; przy kontekście z góry — wszystkie zaznaczone.
    func fetchCandidates() async {
        candidatesRequest += 1
        let request = candidatesRequest
        loadingCandidates = true
        candidatesError = nil
        candidates = []
        selectedIDs = []
        refreshDerived()
        var query = ["op": "finalCandidates", "mode": mode]
        if let advanceID { query["advance"] = advanceID }
        if let eventID { query["event"] = eventID }
        if let organizationID { query["org"] = organizationID }
        do {
            let reply: FinalInvoiceCandidatesReply = try await get(query)
            guard request == candidatesRequest else { return }
            if advanceID != nil {
                source = reply.source
                sourceEventID = reply.sourceEventId
                sourceEventName = reply.sourceEventName
                if let company = reply.source?.companyId.nonEmpty { manualCompanyID = company }
            }
            lockedOrganizationName = reply.organizationName
            candidates = reply.candidates
            selectedIDs = locked && !reply.candidates.isEmpty ? Set(reply.candidates.map(\.id)) : []
        } catch {
            guard request == candidatesRequest else { return }
            candidates = []
            selectedIDs = []
            candidatesError = failureText(error, "Nie udało się pobrać zaliczek do rozliczenia.")
        }
        loadingCandidates = false
        candidatesLoaded = true
        applyCompanyDefault()
        refreshDerived()
    }

    /// Firma domyślna: firma zaliczek kontekstu albo domyślna działalność (jak efekt w oknie CRM).
    private func applyCompanyDefault() {
        guard !companyTouched, manualCompanyID == nil else { return }
        var ids: [String] = []
        for candidate in candidates where !candidate.companyId.isEmpty && !ids.contains(candidate.companyId) { ids.append(candidate.companyId) }
        if ids.count == 1 { manualCompanyID = ids[0]; refreshNumber(); return }
        if ids.count > 1 {
            workspace?.error = "Wybrane faktury zaliczkowe pochodzą z różnych firm. Nie można ich rozliczyć jedną fakturą końcową."
            return
        }
        if let company = companies.first(where: \.isDefault) ?? companies.first {
            manualCompanyID = company.id
            refreshNumber()
        }
    }

    func chooseCompany(_ id: String?) {
        companyTouched = true
        manualCompanyID = id
        refreshNumber()
    }

    func toggle(_ id: String) {
        if selectedIDs.contains(id) { selectedIDs.remove(id) } else { selectedIDs.insert(id) }
        refreshDerived()
    }

    /// Odbiorca, numer i pozycje po zmianie wyboru zaliczek lub kontekstu.
    private func refreshDerived() {
        if let reference = referenceInvoice {
            if recipientSourceID != reference.id {
                recipientSourceID = reference.id
                recipientRequest += 1
                recipientLoading = false
                recipientLoadError = nil
                recipient = reference.recipient ?? .same
                recipientAvailable = reference.recipient != nil
                recipientReadError = reference.recipient == nil ? (reference.recipientError ?? "Nie udało się odczytać zapisanego odbiorcy zaliczki.") : nil
            }
        } else {
            recipientSourceID = nil
            recipientAvailable = false
            recipientReadError = nil
            recipient = .same
        }
        refreshNumber()
        if candidatesLoaded && !loadingCandidates {
            let key = itemsKey
            if itemsReplyKey != key && itemsRequestKey != key {
                if itemsNeedFetch {
                    itemsRequestKey = key
                    var query = ["op": "finalItems"]
                    if let advanceID { query["advance"] = advanceID } else if let snapshotID { query["snapshot"] = snapshotID }
                    if let linkedEventID { query["event"] = linkedEventID }
                    Task { await fetchItems(key, query) }
                } else {
                    itemsRequestKey = nil
                    itemsReply = .empty
                    itemsReplyKey = key
                }
            }
        }
        syncItems()
    }

    private func fetchItems(_ key: String, _ query: [String: String]) async {
        var reply: FinalInvoiceItemsReply
        do {
            reply = try await get(query)
        } catch {
            reply = .empty
            reply.eventOrderError = failureText(error, "Nie udało się pobrać pełnego zamówienia eventu.")
        }
        guard itemsRequestKey == key else { return }
        itemsRequestKey = nil
        itemsReply = reply
        itemsReplyKey = key
        syncItems()
    }

    private func refreshNumber() {
        let company = myCompanyID
        if case .some(let current) = numberCompany, current == company { return }
        numberCompany = .some(company)
        Task { await fetchNumber(company) }
    }

    /// „Auto: …” — numer przewidywany (`preview_invoice_number`, „(zajęte)” gdy numer jest już użyty).
    private func fetchNumber(_ company: String?) async {
        numberRequest += 1
        let request = numberRequest
        struct Reply: Decodable { var number: String }
        var query = ["op": "finalNumber"]
        if let company { query["company"] = company }
        do {
            let reply: Reply = try await get(query)
            guard request == numberRequest else { return }
            autoPreview = reply.number
        } catch {
            guard request == numberRequest else { return }
            autoPreview = ""
        }
    }

    // MARK: Pozycje
    /// Pozycje źródłowe trafiają do formularza, dopóki nie zostały zmienione w tym samym kontekście i podstawie.
    private func syncItems() {
        let context = draftContext
        if itemDraft.context != context && presentationMode != "inherited" {
            presentationMode = "inherited"
            itemDraft = (context, "inherited", false)
        }
        guard !itemsPending else { return }
        if itemDraft.context == context && itemDraft.mode == presentationMode && itemDraft.edited { return }
        itemDraft = (context, presentationMode, false)
        items = orderItems ?? [.blank]
        showOrderItems = orderItems == nil && linkedEventID == nil
    }

    func addItem() {
        itemDraft.edited = true
        items.append(.blank)
    }

    func removeItem(_ index: Int) {
        guard items.count > 1, items.indices.contains(index) else { return }
        itemDraft.edited = true
        items.remove(at: index)
    }

    func updateItem(_ index: Int, _ change: (inout FinalInvoiceItem) -> Void) {
        guard items.indices.contains(index) else { return }
        itemDraft.edited = true
        change(&items[index])
    }

    /// Brutto pozycji → cena netto (`updateGross`).
    func updateGross(_ index: Int, _ gross: Double) {
        updateItem(index) { item in
            let quantity = item.quantity == 0 ? 1 : item.quantity
            let rate = item.vatRate
            item.priceNet = quantity > 0 ? FinalInvoiceMath.round2(gross / quantity / (1 + rate / 100)) : 0
        }
    }

    func itemGross(_ item: FinalInvoiceItem) -> Double {
        let net = FinalInvoiceMath.round2(item.quantity * item.priceNet)
        return FinalInvoiceMath.round2(net + FinalInvoiceMath.round2(net * item.vatRate / 100))
    }

    func requestRestore() {
        guard orderItems != nil else { return }
        if itemDraft.edited { confirm = .restoreItems } else { restoreItems() }
    }

    func restoreItems() {
        guard let orderItems else { return }
        itemDraft.edited = false
        items = orderItems
    }

    func requestPresentation(_ next: String) {
        if itemDraft.edited { confirm = .presentation(next) } else { changePresentation(next) }
    }

    func changePresentation(_ next: String) {
        itemDraft.edited = false
        presentationMode = next
        syncItems()
    }

    // MARK: Odbiorca
    func editRecipient(_ draft: InvoiceRecipientDraft) {
        recipientRequest += 1
        recipientLoading = false
        recipientLoadError = nil
        recipientReadError = nil
        recipientAvailable = true
        recipient = draft
    }

    func loadRecipientOrganizations() async {
        guard recipientOrganizations.isEmpty else { return }
        struct Reply: Decodable { var organizations: [InvoiceRecipientOrganization] }
        do {
            let reply: Reply = try await get(["op": "invoiceRecipientOrgs"])
            recipientOrganizations = reply.organizations
        } catch {
            recipientLoadError = "Nie udało się wczytać organizacji. Możesz wprowadzić dane odbiorcy ręcznie."
        }
    }

    func selectRecipientOrganization(_ id: String, role: Int?) async {
        var draft = InvoiceRecipientDraft.organization(id, role: role ?? 2)
        editRecipient(draft)
        guard !id.isEmpty else { return }
        recipientRequest += 1
        let request = recipientRequest
        recipientLoading = true
        do {
            draft = try await get(["op": "invoiceRecipientOrg", "id": id])
            guard request == recipientRequest, recipient.mode == "organization", recipient.organizationId == id else { return }
            recipient = draft
            recipientLoadError = nil
        } catch {
            guard request == recipientRequest else { return }
            recipientLoadError = failureText(error, "Nie udało się odczytać odbiorcy.")
        }
        recipientLoading = false
    }

    // MARK: Wystawienie
    var createDisabled: Bool {
        let calculation = self.calculation
        return creating || orderUnavailable || paymentDueDate == nil || selectedInvoices.isEmpty || !recipientAvailable
            || recipientReadError != nil || calculation.totals.gross <= 0 || calculation.remaining.gross < -0.01
    }

    /// Sprawdzenia `handleCreate` (serwer sprawdza ponownie, także zgodność zaliczek).
    private func validationProblem() -> String? {
        let calculation = self.calculation
        if paymentDueDate == nil { return "Podaj poprawną datę wystawienia i termin płatności w pełnych dniach (0 lub więcej)." }
        if orderUnavailable { return eventOrderError ?? presentationError ?? "Poczekaj na pobranie pełnego zamówienia i zaliczek." }
        if !calculation.totals.gross.isFinite || calculation.totals.gross <= 0 { return "Uzupełnij pozycje pełnego zamówienia przed rozliczeniem zaliczek." }
        guard let first = selectedInvoices.first else { return "Wybierz co najmniej jedną fakturę do rozliczenia" }
        guard recipientAvailable, recipientReadError == nil else { return recipientReadError ?? "Poczekaj na odczyt odbiorcy z zaliczki." }
        let errors = recipient.errors
        if !errors.isEmpty { return errors.joined(separator: " ") }
        let internalID = recipient.data.internalId
        if recipient.mode != "same_as_buyer" && !internalID.isEmpty {
            var buyerNip = FinalFormat.alnumNip(first.buyerNip)
            if buyerNip.hasPrefix("PL") { buyerNip = String(buyerNip.dropFirst(2)) }
            if internalID.split(separator: "-", omittingEmptySubsequences: false).first.map(String.init) != buyerNip {
                return "Numer wewnętrzny odbiorcy musi wskazywać NIP nabywcy faktury."
            }
        }
        if items.contains(where: { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { return "Wszystkie pozycje muszą mieć nazwę" }
        if useCustomNumber && customNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Podaj numer faktury" }
        if calculation.remaining.gross < -0.01 { return "Suma zaliczek przekracza wartość faktury końcowej." }
        return nil
    }

    /// „Wystaw fakturę końcową” — identyfikator nowej faktury albo `nil` (komunikat w oknie).
    func create() async -> String? {
        guard let workspace, let api else { return nil }
        if let message = validationProblem() { problem = message; return nil }
        guard workspace.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        problem = nil
        creating = true
        defer { creating = false }
        var body: [String: JSONValue] = [
            "op": .string("finalCreate"), "mode": .string(mode),
            "selected": .array(selectedInvoices.map { .string($0.id) }),
            "companyId": .string(myCompanyID ?? ""),
            "items": .array(items.map(\.json)),
            "recipient": recipient.json,
            "useCustomNumber": .bool(useCustomNumber), "customNumber": .string(customNumber),
            "issueDate": .string(issueDate), "saleDate": .string(saleDate), "paymentTermDays": .string(paymentTermDays),
        ]
        if let advanceID { body["advance"] = .string(advanceID) }
        if let eventID { body["event"] = .string(eventID) }
        if let organizationID { body["org"] = .string(organizationID) }
        do {
            let data = try await api.post("/finance", body, timeout: 120)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            guard let id = reply["id"]?.text.nonEmpty else {
                problem = "Błąd tworzenia faktury końcowej"
                return nil
            }
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Faktura końcowa utworzona")
            if let warning = reply["warning"]?.text.nonEmpty { workspace.notice = warning }
            return id
        } catch {
            problem = failureText(error, "Błąd tworzenia faktury końcowej")
            return nil
        }
    }
}

// MARK: Okno

@MainActor struct FinalInvoiceSheet: View {
    /// Po wystawieniu: nowa faktura (jak w CRM — przejście do jej karty).
    let onCreated: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: FinalInvoiceModel

    /// `advanceID` — z karty zaliczki; `eventID` — z finansów wydarzenia; bez kontekstu — wybór wydarzenia lub podmiotu.
    init(advanceID: String? = nil, eventID: String? = nil, organizationID: String? = nil, onCreated: @escaping (String) -> Void) {
        self.onCreated = onCreated
        _model = StateObject(wrappedValue: FinalInvoiceModel(advanceID: advanceID, eventID: eventID, organizationID: organizationID))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Wystaw fakturę końcową (rozliczenie zaliczek)", systemImage: "doc.text").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            Form {
                contextSection
                companySection
                summarySection
                candidatesSection
                itemsSection
                numberAndDatesSection
                buyerSection
                FinalInvoicePreviewSection(model: model)
            }
            .formStyle(.grouped)
            footer
        }
        // W osobnym oknie (`formWindow`) — okno można powiększać; treść wypełnia całe okno.
        .frame(minWidth: 860, idealWidth: 980, maxWidth: .infinity, minHeight: 680, idealHeight: 900, maxHeight: .infinity)
        .background(theme.page)
        .navigationTitle("Faktura końcowa")
        .overlay { if model.creating { PendingOverlay(text: "Tworzenie...") } }
        .interactiveDismissDisabled(model.creating)
        .task {
            model.workspace = state
            await model.start()
        }
        .task(id: model.searchKey) {
            // Lista wydarzeń / podmiotów: od razu po otwarciu i zmianie trybu, przy wpisywaniu — z krótką zwłoką.
            guard !model.locked else { return }
            model.workspace = state
            let typed = !(model.mode == "event" ? model.eventQuery : model.orgQuery).isEmpty
            if typed { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled else { return }
            await model.loadOptions()
        }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { model.confirm != nil }, set: { if !$0 { model.confirm = nil } }), titleVisibility: .visible) {
            if let confirm = model.confirm {
                Button("Zastąp zmiany", role: .destructive) {
                    switch confirm {
                    case .restoreItems: model.restoreItems()
                    case .presentation(let next): model.changePresentation(next)
                    }
                    model.confirm = nil
                }
            }
            Button("Anuluj", role: .cancel) { model.confirm = nil }
        }
    }

    private var confirmTitle: String {
        switch model.confirm {
        case .presentation?: return "Zmienić podstawę pozycji faktury? Zastąpi to zmiany wpisane w tym formularzu."
        default: return "Przywrócić pozycje źródłowe? Zastąpi to zmiany wpisane w tym formularzu."
        }
    }

    // MARK: Kontekst
    @ViewBuilder private var contextSection: some View {
        if model.locked {
            Section("Kontekst faktury końcowej") {
                if model.advanceID != nil {
                    LabeledContent("Do zaliczki:") { Text(model.source?.number ?? "Ładowanie…").fontWeight(.semibold) }
                }
                if model.linkedEventID != nil {
                    LabeledContent("Event:") { Text(model.contextEventName).fontWeight(.semibold) }
                }
                if model.initialOrganizationID != nil {
                    LabeledContent("Podmiot:") { Text(model.lockedOrganizationName ?? "...").fontWeight(.semibold) }
                }
                if model.advanceID != nil {
                    Text("Wybrano nierozliczone zaliczki powiązane z tym zamówieniem. Możesz zmienić ich wybór poniżej.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        } else {
            Section("Kontekst wyszukiwania faktur") {
                HStack(spacing: 10) {
                    contextTile("Według eventu", "Pobierz wszystkie faktury wystawione dla wybranego eventu", "calendar", selected: model.mode == "event") {
                        Task { await model.chooseMode("event") }
                    }
                    contextTile("Według podmiotu", "Fallback gdy nie ma powiązania z eventem", "building.2", selected: model.mode == "organization") {
                        Task { await model.chooseMode("organization") }
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.mode == "event" ? "Wybierz event" : "Wybierz podmiot").font(.callout).foregroundStyle(.secondary)
                    if model.mode == "event" {
                        TextField("", text: $model.eventQuery, prompt: Text("Szukaj eventu...")).textFieldStyle(.roundedBorder)
                    } else {
                        TextField("", text: $model.orgQuery, prompt: Text("Szukaj podmiotu...")).textFieldStyle(.roundedBorder)
                    }
                    optionsList
                }
            }
        }
    }

    private func contextTile(_ title: String, _ detail: String, _ symbol: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).fontWeight(.medium).foregroundStyle(selected ? theme.accent : .primary)
                    Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.secondary.opacity(0.3)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.creating)
    }

    private var optionsList: some View {
        let selectedID = model.mode == "event" ? model.eventID : model.organizationID
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(model.options) { option in
                    Button {
                        Task {
                            if model.mode == "event" { await model.chooseEvent(option.id) } else { await model.chooseOrganization(option.id) }
                        }
                    } label: {
                        HStack {
                            Text(option.name.nonEmpty ?? "(bez nazwy)").lineLimit(1)
                            Spacer()
                            if let date = option.date { Text(FinalFormat.day(date)).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .foregroundStyle(selectedID == option.id ? theme.accent : .primary)
                        .background(selectedID == option.id ? theme.accent.opacity(0.15) : Color.clear)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if model.options.isEmpty {
                    Text(model.optionsLoading ? "Ładowanie..." : "Brak wyników").foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                }
            }
        }
        .frame(height: 180)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: Firma
    @ViewBuilder private var companySection: some View {
        if model.companies.count > 1 {
            Section {
                Picker(selection: Binding(get: { model.manualCompanyID ?? "" }, set: { model.chooseCompany($0.isEmpty ? nil : $0) })) {
                    if model.manualCompanyID == nil { Text("—").tag("") }
                    ForEach(model.companies) { company in
                        Text("\(company.name) (NIP: \(company.nip))\(company.isDefault ? " *" : "")").tag(company.id)
                    }
                } label: { Label("Firma wystawiająca fakturę", systemImage: "building.2") }
                .disabled(model.advanceID != nil || model.creating)
            }
        }
    }

    // MARK: Podsumowanie
    private var summarySection: some View {
        let calculation = model.calculation
        let unavailable = model.orderUnavailable
        let currency = model.currencyCode
        return Section("Podsumowanie rozliczenia") {
            if model.loadingEventOrder {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Pobieranie pełnego zamówienia z eventu…") }
                    .foregroundStyle(.secondary)
            } else if let error = model.eventOrderError {
                Text(error).foregroundStyle(.red).textSelection(.enabled)
            } else if !model.itemsPending {
                Text(sourceText).font(.callout).foregroundStyle(.secondary)
            }
            if model.referenceInvoice != nil && model.fullValueItems != nil && model.eventOrderError == nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.presentationMode == "inherited"
                         ? "Pozycje faktury: nazwy, jednostki i układ z zaliczki \(model.snapshotNumber ?? ""). Kwoty obejmują pełne zamówienie, nie tylko wpłaconą zaliczkę."
                         : "Pozycje faktury: wybrane jawnie z pełnego zamówienia. Zastępują układ zapisany na zaliczce.")
                        .font(.callout).foregroundStyle(.secondary)
                    if let error = model.presentationError { Text(error).font(.callout).foregroundStyle(.red) }
                    Button(model.presentationMode == "inherited"
                           ? (model.eventOrder != nil ? "Zamiast tego użyj pozycji z eventu" : "Zamiast tego użyj pozycji pełnego zamówienia")
                           : "Przywróć nazwy i układ z zaliczki") {
                        model.requestPresentation(model.presentationMode == "inherited" ? "order" : "inherited")
                    }
                    .controlSize(.small)
                    .disabled(model.creating || model.loadingCandidates || model.loadingEventOrder)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 10) {
                tile("Pełna wartość zamówienia", unavailable ? "—" : FinalFormat.amount(calculation.totals.gross, currency),
                     unavailable ? "Oczekiwanie na dane zamówienia" : "Netto \(FinalFormat.amount(calculation.totals.net, currency)) · VAT \(FinalFormat.amount(calculation.totals.vat, currency))")
                tile("Wybrane zaliczki (\(model.selectedInvoices.count))", model.loadingCandidates ? "—" : FinalFormat.amount(calculation.settled.gross, currency),
                     "Netto \(FinalFormat.amount(calculation.settled.net, currency)) · VAT \(FinalFormat.amount(calculation.settled.vat, currency))")
                tile("Pozostało do zapłaty", unavailable ? "—" : FinalFormat.amount(calculation.remaining.gross, currency),
                     unavailable ? "Wartość zamówienia minus zaliczki" : "Netto \(FinalFormat.amount(calculation.remaining.net, currency)) · VAT \(FinalFormat.amount(calculation.remaining.vat, currency))",
                     accent: true)
            }
            if !unavailable && !model.selectedInvoices.isEmpty {
                let remaining = calculation.remaining.gross
                Text(remaining < -0.01
                     ? "Wybrane zaliczki przekraczają wartość zamówienia. Sprawdź wybór dokumentów i uzgodnioną kwotę."
                     : abs(remaining) < 0.01
                        ? "Zaliczki pokrywają całość zamówienia. Faktura końcowa nie będzie wymagać dopłaty."
                        : "Faktura końcowa obejmie całe zamówienie. Klient dopłaci tylko pozostałą kwotę.")
                    .font(.callout).foregroundStyle(remaining < -0.01 ? Color.red : Color.secondary)
            }
            if model.eventOrderEdited && !unavailable {
                Text("Zmieniono pozycje na fakturze. Podsumowanie uwzględnia te zmiany; wartość zapisana w evencie pozostaje bez zmian.")
                    .font(.callout).foregroundStyle(theme.accent)
            }
        }
    }

    private var sourceText: String {
        if let order = model.eventOrder {
            return "Źródło kwot: \(order.sourceLabel). Pełna wartość została pobrana z \(order.eventIds.count > 1 ? "eventów we wspólnym rozliczeniu" : "powiązanego eventu") z uwzględnieniem uzgodnionych rabatów."
        }
        return model.orderItems != nil
            ? "Źródło kwot: pełne zamówienie zapisane przy dokumentach. Zaliczki pomniejszają wyłącznie kwotę do zapłaty."
            : "Brak powiązanego zamówienia. Uzupełnij jego pełne pozycje poniżej — kwota zaliczki nie określa wartości całej usługi."
    }

    private func tile(_ title: String, _ value: String, _ detail: String, accent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(accent ? theme.accent : .secondary)
            Text(value).font(.title3.weight(.semibold)).foregroundStyle(accent ? theme.accent : .primary).monospacedDigit()
            Text(detail).font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent ? theme.accent.opacity(0.1) : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Zaliczki
    private var candidatesSection: some View {
        Section("Wybierz zaliczki do rozliczenia (\(model.candidates.count))") {
            if let error = model.candidatesError {
                Text(error).foregroundStyle(.red).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if model.loadingCandidates {
                Text("Ładowanie...").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if model.candidates.isEmpty {
                Text("Brak nierozliczonych faktur zaliczkowych w tym kontekście").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    GridRow {
                        Text("")
                        Text("Numer"); Text("Typ"); Text("Status"); Text("Data")
                        Text("Brutto").gridColumnAlignment(.trailing)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    ForEach(model.candidates) { candidate in
                        candidateRow(candidate)
                    }
                }
            }
        }
    }

    private func candidateRow(_ candidate: FinalInvoiceCandidate) -> some View {
        let checked = model.selectedIDs.contains(candidate.id)
        return GridRow {
            Toggle("", isOn: Binding(get: { checked }, set: { _ in model.toggle(candidate.id) })).toggleStyle(.checkbox).labelsHidden()
                .disabled(model.creating)
            VStack(alignment: .leading, spacing: 1) {
                Text(candidate.number).fontWeight(.medium)
                if candidate.paidAmount < candidate.gross - 0.01 {
                    Text("Wpłata zostanie zweryfikowana przy wystawieniu").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("Zaliczkowa").foregroundStyle(.secondary)
            Text(FinalFormat.statusLabel(candidate.status)).foregroundStyle(.secondary)
            Text(FinalFormat.day(candidate.issueDate)).foregroundStyle(.secondary).monospacedDigit()
            Text("\(FinalFormat.number(candidate.gross)) \(candidate.currency.nonEmpty ?? "PLN")").fontWeight(.medium).monospacedDigit()
        }
    }

    // MARK: Pozycje
    private var itemsSection: some View {
        Section {
            Button {
                model.showOrderItems.toggle()
            } label: {
                HStack {
                    Text("Edycja pozycji faktury — całe zamówienie (\(model.items.count))").foregroundStyle(.primary)
                    Spacer()
                    Text(model.showOrderItems ? "Zwiń edycję" : "Edytuj pozycje").foregroundStyle(theme.accent)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if model.showOrderItems {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.referenceInvoice != nil && model.presentationMode == "inherited"
                         ? "Zachowano pozycje z zaliczki \(model.snapshotNumber ?? "") i przeliczono je do pełnej wartości zamówienia. Nie pomniejszaj ich o zaliczki — są odliczane automatycznie."
                         : "Pozycje obejmują całą usługę, także część pokrytą zaliczkami. Zaliczki są odliczane automatycznie.")
                        .font(.callout).foregroundStyle(.secondary)
                    if let notice = model.eventOrder?.notice.nonEmpty { Text(notice).font(.caption).foregroundStyle(.secondary) }
                    HStack {
                        Spacer()
                        if model.orderItems != nil {
                            Button(model.presentationMode == "inherited" && model.referenceInvoice != nil
                                   ? "Przywróć pozycje odziedziczone z zaliczki" : "Przywróć pozycje pełnego zamówienia") { model.requestRestore() }
                        }
                        Button { model.addItem() } label: { Label("Dodaj pozycję", systemImage: "plus") }
                    }
                    .controlSize(.small)
                    FinalInvoiceItemsEditor(model: model)
                }
                .disabled(model.creating || model.orderUnavailable)
                .opacity(model.creating || model.orderUnavailable ? 0.6 : 1)
            }
        }
    }

    // MARK: Numer i daty
    private func dayBinding(_ value: Binding<String>) -> Binding<Date> {
        Binding(get: { FinanceText.dayDate(value.wrappedValue) ?? Date() }, set: { value.wrappedValue = FinanceText.dayString($0) })
    }

    private var numberAndDatesSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Numer faktury").font(.callout).foregroundStyle(.secondary)
                Picker("Numer faktury", selection: $model.useCustomNumber) {
                    Text("Auto: \(model.autoPreview.nonEmpty ?? "—")").tag(false)
                    Text("Własny").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden()
                if model.useCustomNumber {
                    TextField("", text: $model.customNumber, prompt: Text("np. FV/123/2026")).textFieldStyle(.roundedBorder)
                }
            }
            DatePicker("Wystawienia", selection: dayBinding($model.issueDate), displayedComponents: .date)
            DatePicker("Sprzedaży", selection: dayBinding($model.saleDate), displayedComponents: .date)
            VStack(alignment: .leading, spacing: 4) {
                TextField("Termin płatności (dni)", text: $model.paymentTermDays)
                if let due = model.paymentDueDate {
                    Text("Od daty wystawienia · do \(FinalFormat.day(due))").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Podaj pełną liczbę dni od 0 oraz poprawną datę wystawienia.").font(.caption).foregroundStyle(.red)
                }
            }
        }
        .disabled(model.creating)
    }

    // MARK: Nabywca i odbiorca
    @ViewBuilder private var buyerSection: some View {
        if let reference = model.referenceInvoice {
            Section("Nabywca faktury końcowej") {
                VStack(alignment: .leading, spacing: 3) {
                    Text(reference.buyerName).fontWeight(.medium)
                    Text("NIP: \(reference.buyerNip.nonEmpty ?? "Nie podano")").foregroundStyle(.secondary)
                    Text("\(reference.buyerStreet), \(reference.buyerPostalCode) \(reference.buyerCity)").foregroundStyle(.secondary)
                    Text("Dane nabywcy pochodzą z rozliczanych zaliczek, nie z bieżącej karty kontaktu.").font(.caption).foregroundStyle(.secondary)
                }
                .textSelection(.enabled)
                if let error = model.recipientReadError { Text(error).foregroundStyle(.red) }
                if model.recipientAvailable {
                    InvoiceRecipientEditorView(model: model, disabled: model.creating)
                }
            }
        }
    }

    // MARK: Przyciski
    private var footer: some View {
        HStack(spacing: 10) {
            if let problem = model.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(3).textSelection(.enabled)
            }
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.creating)
            Button {
                Task {
                    if let id = await model.create() {
                        dismiss()
                        onCreated(id)
                    }
                }
            } label: { Label(model.creating ? "Tworzenie..." : "Wystaw fakturę końcową", systemImage: "doc.text") }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            .disabled(model.createDisabled)
        }
        .padding(16)
    }
}

// MARK: Edycja pozycji

@MainActor private struct FinalInvoiceItemsEditor: View {
    @ObservedObject var model: FinalInvoiceModel

    private func number(_ index: Int, _ key: WritableKeyPath<FinalInvoiceItem, Double>) -> Binding<Double> {
        Binding(get: { model.items.indices.contains(index) ? model.items[index][keyPath: key] : 0 },
                set: { value in model.updateItem(index) { $0[keyPath: key] = value } })
    }
    private func text(_ index: Int, _ key: WritableKeyPath<FinalInvoiceItem, String>) -> Binding<String> {
        Binding(get: { model.items.indices.contains(index) ? model.items[index][keyPath: key] : "" },
                set: { value in model.updateItem(index) { $0[keyPath: key] = value } })
    }

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 6) {
            GridRow {
                Text("Nazwa"); Text("Jm.")
                Text("Ilość").gridColumnAlignment(.trailing)
                Text("Cena netto").gridColumnAlignment(.trailing)
                Text(verbatim: "VAT %").gridColumnAlignment(.trailing)
                Text("Brutto").gridColumnAlignment(.trailing)
                Text("")
            }
            .font(.caption).foregroundStyle(.secondary)
            ForEach(Array(model.items.indices), id: \.self) { index in
                GridRow {
                    // Tekst od lewej, ze spacjami (w formularzu macOS pole bez etykiety wyrównuje się do prawej).
                    TextField("", text: text(index, \.name), prompt: Text("Nazwa pozycji")).labelsHidden().multilineTextAlignment(.leading).frame(minWidth: 220)
                    TextField("", text: text(index, \.unit)).labelsHidden().multilineTextAlignment(.leading).frame(width: 60)
                    InvoiceNumberField(title: "", value: number(index, \.quantity), width: 70)
                    InvoiceNumberField(title: "", value: number(index, \.priceNet), width: 100)
                    InvoiceNumberField(title: "", value: number(index, \.vatRate), width: 56)
                    FinalGrossField(value: model.items.indices.contains(index) ? model.itemGross(model.items[index]) : 0) { gross in
                        model.updateGross(index, gross)
                    }
                    .frame(width: 100)
                    Button(role: .destructive) { model.removeItem(index) } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red)
                        .disabled(model.items.count == 1)
                        .help("Usuń pozycję")
                }
                .textFieldStyle(.roundedBorder)
            }
        }
    }
}

/// Pole „Brutto” pozycji (jak w oknie CRM): wpisywana kwota przelicza cenę netto, a pole pokazuje wyliczone brutto
/// dopiero po wyjściu z pola — wpisywany tekst nie jest nadpisywany w trakcie pisania.
private struct FinalGrossField: View {
    let value: Double
    let commit: (Double) -> Void
    @State private var text = ""
    @State private var typed = false
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $text)
            .multilineTextAlignment(.trailing)
            .focused($focused)
            .onAppear { text = FinalFormat.input(value) }
            .onChange(of: text) { _, next in
                guard focused else { return }
                let normalized = FinalFormat.normalizeDecimal(next)
                if normalized != next { text = normalized; return }
                typed = true
                if normalized.isEmpty || normalized == "-" || normalized.hasSuffix(",") { return }
                commit(FinalFormat.parseDecimal(normalized))
            }
            .onChange(of: value) { _, next in
                if !focused { text = FinalFormat.input(next) }
            }
            .onChange(of: focused) { _, isFocused in
                guard !isFocused else { return }
                if typed { commit(FinalFormat.parseDecimal(text)) }
                typed = false
                text = FinalFormat.input(value)
            }
    }
}

// MARK: Podgląd

@MainActor private struct FinalInvoicePreviewSection: View {
    @ObservedObject var model: FinalInvoiceModel
    @Environment(\.crmTheme) private var theme

    private var unavailableMessage: String? {
        if let error = model.eventOrderError { return error }
        if let error = model.presentationError { return error }
        if let error = model.candidatesError { return error }
        if model.orderUnavailable { return "Podgląd pojawi się po pobraniu pełnego zamówienia i zaliczek." }
        if model.selectedInvoices.isEmpty { return "Wybierz zaliczki do rozliczenia, aby zobaczyć treść faktury końcowej." }
        return nil
    }

    var body: some View {
        Section {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Podgląd faktury końcowej", systemImage: "doc.text").font(.headline)
                    Text("Treść i kwoty przed wystawieniem — dokument nie został jeszcze zapisany.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { model.showOrderItems = true } label: { Label("Edytuj nazwy i pozycje", systemImage: "pencil") }
                    .controlSize(.small).disabled(unavailableMessage != nil)
            }
            if let message = unavailableMessage {
                Text(message).font(.callout).foregroundStyle(.secondary)
            } else {
                content
            }
        }
    }

    @ViewBuilder private var content: some View {
        let calculation = model.calculation
        let currency = model.currencyCode
        let first = model.selectedInvoices.first
        let number = model.useCustomNumber ? model.customNumber : model.autoPreview
        let due = model.paymentDueDate ?? ""
        VStack(alignment: .leading, spacing: 4) {
            Text("FAKTURA KOŃCOWA \(number.trimmingCharacters(in: .whitespaces).nonEmpty ?? "—")").font(.title3.weight(.medium))
            if !model.useCustomNumber {
                Text("Numer przewidywany. Ostateczny numer zostanie nadany przy wystawieniu.").font(.caption).foregroundStyle(.secondary)
            }
        }
        HStack(alignment: .top, spacing: 16) {
            party("Sprzedawca", first?.sellerName, first?.sellerNip)
            party("Nabywca", first?.buyerName, first?.buyerNip)
        }
        HStack(spacing: 16) {
            Text("Wystawienie: \(FinalFormat.day(model.issueDate))")
            Text("Sprzedaż: \(FinalFormat.day(model.saleDate))")
            Text("Termin płatności: \(FinalFormat.day(due))\(calculation.remaining.gross == 0 ? " · bez dopłaty" : "")")
        }
        .font(.caption).foregroundStyle(.secondary)

        VStack(alignment: .leading, spacing: 6) {
            Text("Pozycje na fakturze końcowej").fontWeight(.medium)
            Text("Te nazwy i wartości zostaną zapisane na fakturze. Pozycje obejmują całe zamówienie; zaliczki odliczamy w rozliczeniu poniżej.")
                .font(.caption).foregroundStyle(.secondary)
            itemsTable(calculation, currency)
        }
        VStack(alignment: .leading, spacing: 6) {
            Text("Rozliczenie zaliczek i dopłata").fontWeight(.medium)
            settlementTable(calculation, currency)
            HStack {
                Spacer()
                Text(remainingText(calculation.remaining.gross, currency, due)).fontWeight(.medium).foregroundStyle(theme.accent)
            }
            if invalidItems(calculation) {
                Text("Uzupełnij nazwy i popraw wartości pozycji przed wystawieniem.").font(.callout).foregroundStyle(.red)
            }
            Text("Kwoty są wyliczane z tych samych pozycji i zaliczek co przy zapisie faktury, z zaokrągleniem do groszy. To podgląd treści i rozliczenia; układ graficzny PDF może się różnić.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func party(_ title: String, _ name: String?, _ nip: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(name?.nonEmpty ?? "—")
            if let nip = nip?.nonEmpty { Text("NIP: \(nip)").font(.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    private func invalidItems(_ calculation: FinalInvoiceMath.Calculation) -> Bool {
        calculation.items.contains { item in
            item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !item.quantity.isFinite || item.quantity <= 0
                || !item.priceNet.isFinite || item.priceNet < 0 || !item.vatRate.isFinite || item.vatRate < 0
        }
    }

    private func remainingText(_ remaining: Double, _ currency: String, _ due: String) -> String {
        if remaining < -0.01 { return "Zaliczki przekraczają wartość zamówienia — popraw rozliczenie." }
        if remaining == 0 { return "Do zapłaty: \(FinalFormat.amount(0, currency)) — całość rozliczona zaliczkami." }
        return "Do zapłaty: \(FinalFormat.amount(remaining, currency)) do \(FinalFormat.day(due))."
    }

    private func itemsTable(_ calculation: FinalInvoiceMath.Calculation, _ currency: String) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 5) {
            GridRow {
                Text("Lp.").gridColumnAlignment(.leading)
                Text("Nazwa usługi / towaru").gridColumnAlignment(.leading)
                Text("Jm.").gridColumnAlignment(.leading)
                Text("Ilość"); Text("Cena netto"); Text("Wartość netto"); Text("Stawka VAT"); Text("Kwota VAT"); Text("Brutto")
            }
            .font(.caption).foregroundStyle(.secondary)
            Divider()
            ForEach(calculation.items, id: \.position) { item in
                GridRow(alignment: .top) {
                    Text("\(item.position)").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        if item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("Uzupełnij nazwę pozycji").foregroundStyle(.red)
                        } else {
                            Text(item.name).fixedSize(horizontal: false, vertical: true)
                        }
                        if let exemption = item.exemption { Text(exemption).font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(minWidth: 200, maxWidth: .infinity, alignment: .leading)
                    Text(item.unit)
                    Text(FinalFormat.quantity(item.quantity))
                    Text(FinalFormat.number(item.priceNet, max: 4))
                    Text(FinalFormat.number(item.net))
                    Text(verbatim: FinalFormat.vatLabel(item.vatRate, item.vatCode)).font(.caption)
                    Text(FinalFormat.number(item.vat))
                    Text(FinalFormat.number(item.gross)).fontWeight(.medium)
                }
            }
            Divider()
            GridRow {
                Text("Razem (\(currency))").fontWeight(.medium).gridCellColumns(5).gridCellAnchor(.leading)
                Text(FinalFormat.number(calculation.totals.net)).fontWeight(.medium)
                Text("")
                Text(FinalFormat.number(calculation.totals.vat)).fontWeight(.medium)
                Text(FinalFormat.number(calculation.totals.gross)).fontWeight(.medium)
            }
        }
        .monospacedDigit()
    }

    private func settlementTable(_ calculation: FinalInvoiceMath.Calculation, _ currency: String) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 5) {
            GridRow {
                Text("Rozliczenie (\(currency))").gridColumnAlignment(.leading)
                Text("Netto"); Text("VAT"); Text("Brutto")
            }
            .font(.caption).foregroundStyle(.secondary)
            Divider()
            GridRow {
                Text("Pełna wartość zamówienia").frame(maxWidth: .infinity, alignment: .leading)
                Text(FinalFormat.number(calculation.totals.net))
                Text(FinalFormat.number(calculation.totals.vat))
                Text(FinalFormat.number(calculation.totals.gross))
            }
            ForEach(model.selectedInvoices) { advance in
                GridRow(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Odliczenie zaliczki \(advance.number)")
                        if let date = advance.issueDate?.nonEmpty { Text("z dnia \(FinalFormat.day(date))").font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(FinalFormat.number(-advance.net))
                    Text(FinalFormat.number(-advance.vat))
                    Text(FinalFormat.number(-advance.gross))
                }
                .foregroundStyle(.secondary)
            }
            GridRow {
                Text("Razem odliczone zaliczki (\(model.selectedInvoices.count))").frame(maxWidth: .infinity, alignment: .leading)
                Text(FinalFormat.number(-calculation.settled.net))
                Text(FinalFormat.number(-calculation.settled.vat))
                Text(FinalFormat.number(-calculation.settled.gross))
            }
            .font(.caption).foregroundStyle(.secondary)
            Divider()
            GridRow {
                Text("Pozostało do zapłaty").frame(maxWidth: .infinity, alignment: .leading)
                Text(FinalFormat.number(calculation.remaining.net))
                Text(FinalFormat.number(calculation.remaining.vat))
                Text(FinalFormat.number(calculation.remaining.gross)).font(.headline)
            }
            .fontWeight(.semibold).foregroundStyle(theme.accent)
        }
        .monospacedDigit()
    }
}
