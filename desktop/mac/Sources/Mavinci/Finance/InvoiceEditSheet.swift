import SwiftUI

// MARK: Edycja faktury — 1:1 z `/crm/invoices/[id]/edit`: szkic albo pro forma (faktura końcowa, dokument wystawiony,
// w toku lub przyjęty w KSeF — chroniony, z przejściem do korekty). Status dokumentu, stan KSeF, firma, typ i numer,
// korekta (dokument źródłowy, zakres, skutek w ewidencji VAT, przyczyna, nota), osoba prywatna albo organizacja,
// rozliczenie wydarzenia i powiązane wydarzenie, daty i termin, nota płatnicza, sposób płatności i miejsce wystawienia,
// status płatności, procent zaliczki, pozycje i podsumowanie. Serwer: `/bridge/native/v1/finance` (`invoiceEdit`,
// `invoiceEditEvents`, `invoiceOriginal`) — zapis funkcją bazy `update_invoice_draft_atomic`.

struct InvoiceEditSetup: Decodable {
    struct Ksef: Decodable { var status: String; var reference: String; var sentAt: String; var error: String }
    struct Item: Decodable {
        var position: Int
        var name: String
        var unit: String
        var quantity: Double
        var priceNet: Double
        var vatRate: Double
        var vatCode: String
        var exemption: String
        var beforeQuantity: Double?
        var beforePriceNet: Double?
        var beforeNet: Double?
        var beforeVat: Double?
    }
    struct Correction: Decodable {
        var relatedId: String; var reason: String; var type: Int; var scope: String
        var number: String; var issueDate: String; var ksefNumber: String; var wasInKsef: Bool
    }
    struct Form: Decodable {
        var number: String
        var type: String
        var status: String
        var companyId: String
        var issueDate: String
        var saleDate: String
        var paymentDays: String
        var paymentMethod: String
        var issuePlace: String
        var includeFooter: Bool
        var footer: String
        var website: String
        var privatePerson: Bool
        var privateBuyer: InvoicePrivateBuyer
        var individualId: String
        var organizationId: String
        var eventId: String
        var billingArrangement: String
        var serviceRecipientOrganizationId: String
        var serviceRecipientContactId: String
        var paymentStatus: String
        var paidAmount: Double
        var paidDate: String
        var advancePercent: Double
        var correction: Correction
        var items: [Item]
    }
    struct Company: Decodable, Identifiable {
        var id: String; var name: String; var legalName: String; var nip: String; var isDefault: Bool; var city: String; var website: String
    }
    var id: String
    var number: String
    var rawType: String
    var status: String
    var currency: String
    var ksef: Ksef
    var locked: String?
    var canCorrect: Bool
    var form: Form?
    var companies: [Company]?
    var organizations: [InvoiceFormSetup.Organization]?
    var organizationsError: String?
    var individuals: [InvoiceFormSetup.Individual]?
    var correctable: [InvoiceFormSetup.Correctable]?
    var linkedEvent: InvoiceFormEvent?
    var organizationEvents: [InvoiceFormEvent]?
}

/// Pozycja edytora (stan „po korekcie” i — w korekcie — wartości „przed” z faktury pierwotnej).
struct InvoiceEditItem: Identifiable, Equatable {
    var id = UUID()
    var name = ""
    var unit = "szt."
    var quantity: Double = 1
    var priceNet: Double = 0
    var vatRate: Double = 23
    var vatCode = "23"
    var exemption = ""
    var beforeQuantity: Double?
    var beforePriceNet: Double?
    var beforeNet: Double?
    var beforeVat: Double?
}

@MainActor final class InvoiceEditModel: ObservableObject {
    let invoiceID: String
    weak var workspace: Workspace?

    @Published var setup: InvoiceEditSetup?
    @Published var loadError: String?
    @Published var loading = true
    @Published var saving = false
    @Published var problem: String?

    @Published var number = ""
    @Published var type = "vat"
    @Published var status = "draft"
    @Published var companyID = ""
    @Published var issueDate = ""
    @Published var saleDate = ""
    @Published var paymentDays = "14"
    @Published var paymentMethod = "Przelew"
    @Published var issuePlace = ""
    @Published var includeFooter = true
    @Published var footer = ""
    @Published var website = ""
    @Published var privatePerson = false
    @Published var privateBuyer = InvoicePrivateBuyer()
    @Published var individualID = ""
    @Published var individualSearch = ""
    @Published var organizationID = ""
    @Published var eventID = ""
    @Published var linkedEvent: InvoiceFormEvent?
    @Published var organizationEvents: [InvoiceFormEvent] = []
    @Published var billingArrangement = "direct"
    @Published var serviceRecipientOrganizationID = ""
    @Published var serviceRecipientContactID = ""
    @Published var paymentStatus = "unpaid"
    @Published var paidAmount: Double = 0
    @Published var paidDate = ""
    @Published var advancePercent: Double = 30
    @Published var items: [InvoiceEditItem] = []

    // Korekta
    @Published var relatedID = ""
    @Published var correctionReason = ""
    @Published var correctionType = 2
    @Published var correctionScope = "full"
    @Published var correctedNumber = ""
    @Published var correctedIssueDate = ""
    @Published var correctedKsefNumber = ""
    @Published var correctedWasInKsef = false
    @Published var originalLoading = false

    private var eventsRequest = 0

    static let statuses: [(String, String)] = [("draft", "Szkic"), ("issued", "Wystawiona"), ("sent", "Wysłana"), ("paid", "Opłacona"), ("overdue", "Przeterminowana")]
    static let proformaStatuses: [(String, String)] = [("draft", "Szkic"), ("proforma", "Proforma")]
    static let paymentMethods = ["Przelew", "Gotówka", "Karta płatnicza", "Kompensata"]
    static let units = ["szt.", "godz.", "usl.", "m", "m2", "kg"]

    init(invoiceID: String) { self.invoiceID = invoiceID }

    private var api: NativeAPI? { workspace?.nativeAPI() }
    private func get<T: Decodable>(_ query: [String: String], as kind: T.Type = T.self) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/finance", query: query))
    }
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Pochodne
    var isCorrective: Bool { type == "corrective" }
    var companies: [InvoiceEditSetup.Company] { setup?.companies ?? [] }
    var organizations: [InvoiceFormSetup.Organization] { setup?.organizations ?? [] }
    var currency: String { setup?.currency ?? "PLN" }
    var dueDate: String? { InvoiceMath.dueDate(issue: issueDate, days: paymentDays) }

    /// Wartości pozycji jak `calculateItemValues` edytora CRM (korekta — różnica „po” minus „przed”).
    func values(_ item: InvoiceEditItem) -> (net: Double, vat: Double, gross: Double) {
        let after = InvoiceMath.values(quantity: item.quantity, priceNet: item.priceNet, rate: item.vatRate)
        guard isCorrective else { return after }
        let beforeNet = item.beforeNet ?? (item.beforeQuantity ?? 0) * (item.beforePriceNet ?? 0)
        let beforeVat = item.beforeVat ?? InvoiceMath.jsRound(beforeNet * item.vatRate) / 100
        return (InvoiceMath.fixed2(after.net - beforeNet), InvoiceMath.fixed2(after.vat - beforeVat), InvoiceMath.fixed2(after.gross - beforeNet - beforeVat))
    }
    func totals(_ list: [InvoiceEditItem]) -> (net: Double, vat: Double, gross: Double) {
        var net = 0.0, vat = 0.0, gross = 0.0
        for item in list {
            let v = values(item)
            net += v.net; vat += v.vat; gross += v.gross
        }
        return (net, vat, gross)
    }
    /// Pozycje dokumentu zaliczkowego: ceny pełnego zamówienia × procent zaliczki.
    var advanceItems: [InvoiceEditItem] {
        let ratio = advancePercent / 100
        return items.map { item in
            var copy = item
            copy.priceNet = InvoiceMath.fixed2(item.priceNet * ratio)
            return copy
        }
    }
    var displayedTotals: (net: Double, vat: Double, gross: Double) { type == "advance" ? totals(advanceItems) : totals(items) }

    /// Nota korekty (`buildInvoiceFooterText`).
    var correctionFooter: String {
        let date = correctedIssueDate.isEmpty ? "-" : InvoiceFormText.plDate(correctedIssueDate)
        return "Faktura korygująca odnosi się do faktury \(correctedNumber.nonEmpty ?? "-") z dnia \(date). Przyczyna korekty: \(correctionReason.nonEmpty ?? "-")."
    }

    // MARK: Wczytanie
    func load() async {
        loading = true
        defer { loading = false }
        do {
            let data: InvoiceEditSetup = try await get(["op": "invoiceEdit", "id": invoiceID])
            setup = data
            loadError = nil
            guard let form = data.form else { return }
            number = form.number
            type = form.type
            status = form.status
            companyID = form.companyId
            issueDate = form.issueDate
            saleDate = form.saleDate
            paymentDays = form.paymentDays
            paymentMethod = form.paymentMethod
            issuePlace = form.issuePlace
            includeFooter = form.includeFooter
            footer = form.footer
            website = form.website
            privatePerson = form.privatePerson
            privateBuyer = form.privateBuyer
            individualID = form.individualId
            individualSearch = form.privatePerson ? "\(form.privateBuyer.firstName) \(form.privateBuyer.lastName)".trimmingCharacters(in: .whitespaces) : ""
            organizationID = form.organizationId
            eventID = form.eventId
            linkedEvent = data.linkedEvent
            organizationEvents = data.organizationEvents ?? []
            billingArrangement = form.billingArrangement
            serviceRecipientOrganizationID = form.serviceRecipientOrganizationId
            serviceRecipientContactID = form.serviceRecipientContactId
            paymentStatus = form.paymentStatus
            paidAmount = form.paidAmount
            paidDate = form.paidDate
            advancePercent = form.advancePercent
            relatedID = form.correction.relatedId
            correctionReason = form.correction.reason
            correctionType = form.correction.type
            correctionScope = form.correction.scope
            correctedNumber = form.correction.number
            correctedIssueDate = form.correction.issueDate
            correctedKsefNumber = form.correction.ksefNumber
            correctedWasInKsef = form.correction.wasInKsef
            items = form.items.map {
                InvoiceEditItem(name: $0.name, unit: $0.unit, quantity: $0.quantity, priceNet: $0.priceNet, vatRate: $0.vatRate, vatCode: $0.vatCode,
                                exemption: $0.exemption, beforeQuantity: $0.beforeQuantity, beforePriceNet: $0.beforePriceNet,
                                beforeNet: $0.beforeNet, beforeVat: $0.beforeVat)
            }
        } catch {
            loadError = failureText(error, "Błąd podczas ładowania danych")
        }
    }

    // MARK: Firma, korekta
    func selectCompany(_ id: String) {
        companyID = id
        if let company = companies.first(where: { $0.id == id }) {
            issuePlace = company.city
            website = company.website.nonEmpty ?? "www.mavinci.pl"
        }
    }

    /// Wybór faktury do korekty (`handleSelectOriginalInvoice`): strony, firma, wydarzenie, numer KSeF i pozycje „przed”.
    func selectOriginal(_ id: String) async {
        relatedID = id
        guard !id.isEmpty else {
            correctedNumber = ""; correctedIssueDate = ""; correctedKsefNumber = ""; correctedWasInKsef = false
            return
        }
        originalLoading = true
        defer { originalLoading = false }
        do {
            let original: InvoiceOriginal = try await get(["op": "invoiceOriginal", "id": id])
            guard relatedID == id else { return }
            correctedNumber = original.number
            correctedIssueDate = original.issueDate ?? ""
            organizationID = original.buyer.organizationId
            companyID = original.companyId
            eventID = original.eventId
            billingArrangement = original.billingArrangement
            serviceRecipientOrganizationID = original.serviceRecipientOrganizationId
            serviceRecipientContactID = original.serviceRecipientContactId
            if let event = original.event, !original.eventId.isEmpty {
                linkedEvent = event
                if original.serviceRecipientOrganizationId.isEmpty && original.serviceRecipientContactId.isEmpty {
                    serviceRecipientOrganizationID = event.organizationId
                    serviceRecipientContactID = event.contactPersonId
                }
            } else {
                linkedEvent = nil
            }
            if !original.buyer.organizationId.isEmpty { await loadOrganizationEvents(original.buyer.organizationId, keep: original.eventId) }
            correctedKsefNumber = original.ksefNumber ?? ""
            correctedWasInKsef = original.wasInKsef
            if !original.items.isEmpty {
                items = original.items.map {
                    InvoiceEditItem(name: $0.name, unit: $0.unit, quantity: $0.beforeQuantity, priceNet: $0.beforePriceNet, vatRate: $0.vatRate,
                                    vatCode: $0.vatCode, exemption: $0.exemption, beforeQuantity: $0.beforeQuantity, beforePriceNet: $0.beforePriceNet,
                                    beforeNet: $0.beforeNet, beforeVat: $0.beforeVat)
                }
            }
        } catch {
            problem = failureText(error, "Nie udało się odczytać faktury korygowanej.")
        }
    }

    // MARK: Nabywca i wydarzenie
    func loadOrganizationEvents(_ organization: String, keep: String) async {
        guard !organization.isEmpty else { organizationEvents = []; return }
        eventsRequest += 1
        let request = eventsRequest
        struct Reply: Decodable { var events: [InvoiceFormEvent] }
        do {
            let reply: Reply = try await get(["op": "invoiceEditEvents", "org": organization, "keep": keep])
            guard request == eventsRequest else { return }
            organizationEvents = reply.events
        } catch {
            guard request == eventsRequest else { return }
            workspace?.error = "Błąd podczas pobierania wydarzeń organizacji"
        }
    }

    /// Wybór nabywcy (`handleBuyerSelect`): wydarzenia nabywcy i sposób rozliczenia.
    func selectBuyer(_ id: String) async {
        organizationID = id
        if !eventID.isEmpty && !serviceRecipientOrganizationID.isEmpty {
            if id == serviceRecipientOrganizationID { billingArrangement = "direct" }
            else if billingArrangement == "direct" { billingArrangement = "other" }
        }
        await loadOrganizationEvents(id, keep: eventID)
    }

    /// Powiązane wydarzenie (`handleEventChange`): rozliczenie bezpośrednie, odbiorca usługi i nabywca z wydarzenia.
    func changeEvent(_ id: String) {
        eventID = id
        billingArrangement = "direct"
        guard !id.isEmpty, let event = organizationEvents.first(where: { $0.id == id }) else {
            linkedEvent = nil
            serviceRecipientOrganizationID = ""
            serviceRecipientContactID = ""
            return
        }
        linkedEvent = event
        serviceRecipientOrganizationID = event.organizationId
        serviceRecipientContactID = event.contactPersonId
        if !event.organizationId.isEmpty { organizationID = event.organizationId }
    }

    func changeBilling(_ arrangement: String) async {
        billingArrangement = arrangement
        privatePerson = false
        if arrangement == "direct" && !serviceRecipientOrganizationID.isEmpty {
            organizationID = serviceRecipientOrganizationID
            await loadOrganizationEvents(serviceRecipientOrganizationID, keep: eventID)
        } else if arrangement != "direct" && organizationID == serviceRecipientOrganizationID {
            organizationID = ""
        }
    }

    func selectIndividual(_ contact: InvoiceFormSetup.Individual) {
        individualID = contact.id
        individualSearch = contact.name.nonEmpty ?? "\(contact.firstName) \(contact.lastName)".trimmingCharacters(in: .whitespaces)
        privateBuyer = InvoicePrivateBuyer(firstName: contact.firstName, lastName: contact.lastName, street: contact.street,
                                           postalCode: contact.postalCode, city: contact.city, email: contact.email, phone: contact.phone)
    }

    /// Nowy nabywca z formularza: świeża lista organizacji i wybór.
    func buyerAdded(_ id: String) async {
        if let fresh: InvoiceEditSetup = try? await get(["op": "invoiceEdit", "id": invoiceID]) {
            setup?.organizations = fresh.organizations
            setup?.organizationsError = fresh.organizationsError
        }
        await selectBuyer(id)
    }

    // MARK: Płatność i pozycje
    func changePaymentStatus(_ next: String) {
        paymentStatus = next
        if next == "unpaid" { paidAmount = 0 }
        if next == "paid" {
            paidAmount = displayedTotals.gross
            if paidDate.isEmpty { paidDate = issueDate.nonEmpty ?? FinanceText.dayString(Date()) }
        }
    }
    func addItem() { items.append(InvoiceEditItem()) }
    func removeItem(_ id: UUID) { items.removeAll { $0.id == id } }
    func updateItem(_ id: UUID, _ change: (inout InvoiceEditItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }
    /// Zmiana stawki zachowuje cenę brutto (jak w CRM).
    func changeVat(_ id: UUID, _ code: String) {
        updateItem(id) { item in
            let gross = InvoiceMath.grossFromNet(item.priceNet, item.vatRate)
            let rate = InvoiceMath.rate(code)
            item.vatCode = code
            item.vatRate = rate
            item.priceNet = InvoiceMath.netFromGross(gross, rate)
        }
    }

    // MARK: Zapis
    /// „Zapisz zmiany” — `true`, gdy zapisano (komunikat w oknie przy błędzie).
    func submit() async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return false }
        problem = nil
        saving = true
        defer { saving = false }
        let form: [String: JSONValue] = [
            "number": .string(number), "type": .string(type), "status": .string(status), "companyId": .string(companyID),
            "issueDate": .string(issueDate), "saleDate": .string(saleDate), "paymentDays": .string(paymentDays),
            "paymentMethod": .string(paymentMethod), "issuePlace": .string(issuePlace), "includeFooter": .bool(includeFooter),
            "footer": .string(footer), "website": .string(website), "privatePerson": .bool(privatePerson), "privateBuyer": privateBuyer.json,
            "individualId": .string(individualID), "organizationId": .string(organizationID), "eventId": .string(eventID),
            "billingArrangement": .string(billingArrangement), "serviceRecipientOrganizationId": .string(serviceRecipientOrganizationID),
            "serviceRecipientContactId": .string(serviceRecipientContactID), "paymentStatus": .string(paymentStatus),
            "paidAmount": .number(paidAmount), "paidDate": .string(paidDate), "advancePercent": .number(advancePercent),
            "correction": .object([
                "relatedId": .string(relatedID), "reason": .string(correctionReason), "type": .number(Double(correctionType)),
                "scope": .string(correctionScope), "number": .string(correctedNumber), "issueDate": .string(correctedIssueDate),
                "ksefNumber": .string(correctedKsefNumber), "wasInKsef": .bool(correctedWasInKsef),
            ]),
            "items": .array(items.map { item in
                var object: [String: JSONValue] = [
                    "name": .string(item.name), "unit": .string(item.unit), "quantity": .number(item.quantity), "priceNet": .number(item.priceNet),
                    "vatCode": .string(item.vatCode), "exemption": .string(item.exemption),
                ]
                if let value = item.beforeQuantity { object["beforeQuantity"] = .number(value) }
                if let value = item.beforePriceNet { object["beforePriceNet"] = .number(value) }
                if let value = item.beforeNet { object["beforeNet"] = .number(value) }
                if let value = item.beforeVat { object["beforeVat"] = .number(value) }
                return .object(object)
            }),
        ]
        do {
            let data = try await api.post("/finance", ["op": .string("invoiceEdit"), "id": .string(invoiceID), "form": .object(form)], timeout: 120)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Faktura została zaktualizowana")
            if let warning = reply["warning"]?.text.nonEmpty { workspace.notice = warning }
            return true
        } catch {
            problem = failureText(error, "Błąd podczas aktualizacji faktury")
            return false
        }
    }
}

@MainActor struct InvoiceEditSheet: View {
    let invoiceID: String
    let onSaved: () -> Void
    /// „Wystaw korektę” przy dokumencie chronionym przed edycją.
    let onCorrect: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: InvoiceEditModel
    @State private var addingBuyer = false
    @State private var buyerSearch = ""

    init(invoiceID: String, onSaved: @escaping () -> Void, onCorrect: @escaping () -> Void) {
        self.invoiceID = invoiceID
        self.onSaved = onSaved
        self.onCorrect = onCorrect
        _model = StateObject(wrappedValue: InvoiceEditModel(invoiceID: invoiceID))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(model.setup.map { "Edytuj fakturę \($0.number)" } ?? "Edytuj fakturę").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            content
            if model.setup?.form != nil { footerBar }
        }
        .frame(minWidth: 860, idealWidth: 980, minHeight: 700, idealHeight: 900)
        .background(theme.page)
        .overlay { if model.saving { PendingOverlay(text: "Zapisywanie...") } }
        .interactiveDismissDisabled(model.saving)
        .task {
            model.workspace = state
            await model.load()
        }
        .sheet(isPresented: $addingBuyer) {
            OrganizationEditorSheet(store: state.contacts, mode: .create(.organization)) { id in
                Task { await model.buyerAdded(id) }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    @ViewBuilder private var content: some View {
        if let setup = model.setup {
            if let locked = setup.locked { lockedView(setup, locked) } else { form(setup) }
        } else if model.loading {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("Faktura nie została znaleziona", systemImage: "exclamationmark.triangle")
            } description: {
                Text(model.loadError ?? "")
            } actions: {
                Button("Spróbuj ponownie") { Task { await model.load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func lockedView(_ setup: InvoiceEditSetup, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Dokument jest chroniony przed edycją").font(.title3.weight(.semibold))
            Text(message).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Wróć do dokumentu") { dismiss() }.keyboardShortcut(.cancelAction)
                if setup.canCorrect {
                    Button("Wystaw korektę") { dismiss(); onCorrect() }.buttonStyle(.borderedProminent)
                }
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Formularz
    private func form(_ setup: InvoiceEditSetup) -> some View {
        Form {
            statusSection
            if !setup.ksef.status.isEmpty { ksefSection(setup.ksef) }
            companySection
            typeSection
            if model.isCorrective { correctionSection(setup) }
            if model.isCorrective && !model.correctedNumber.isEmpty {
                Section("Nota dla faktury korygującej") { Text(model.correctionFooter).font(.callout) }
            }
            buyerSections(setup)
            datesSection
            if !model.isCorrective { noteSection }
            methodSection
            if model.status == "paid" {
                Section {
                    DatePicker("Data opłacenia *", selection: day($model.paidDate), displayedComponents: .date)
                    Text("Faktura opłacona. Do zapłaty: 0.00 zł").foregroundStyle(.green)
                }
            }
            paymentSection
            if model.type == "advance" { advanceSection }
            itemsSection
            summarySection
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    private var statusSection: some View {
        Section {
            Picker("Status faktury", selection: $model.status) {
                ForEach(model.type == "proforma" ? InvoiceEditModel.proformaStatuses : InvoiceEditModel.statuses, id: \.0) { Text($0.1).tag($0.0) }
                if !(model.type == "proforma" ? InvoiceEditModel.proformaStatuses : InvoiceEditModel.statuses).contains(where: { $0.0 == model.status }) {
                    Text(model.status).tag(model.status)
                }
            }
            Text("Anulowanie — przyciskiem „Anuluj fakturę” na karcie faktury (z powodem). Szkic można też usunąć z listy faktur.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func ksefSection(_ ksef: InvoiceEditSetup.Ksef) -> some View {
        Section("Status KSeF") {
            LabeledContent("Status") {
                Text(ksef.status == "accepted" ? "Zaakceptowana" : ksef.status == "rejected" ? "Odrzucona" : ksef.status == "sent" ? "Wysłana" : "Szkic")
                    .foregroundStyle(ksef.status == "accepted" ? Color.green : ksef.status == "rejected" ? Color.red : Color.blue)
            }
            if !ksef.reference.isEmpty { LabeledContent("Nr referencyjny KSeF", value: ksef.reference) }
            if !ksef.sentAt.isEmpty { LabeledContent("Data wysyłki", value: FinFormat.dateTime(ksef.sentAt)) }
            if !ksef.error.isEmpty { Text(ksef.error).font(.callout).foregroundStyle(.red) }
        }
    }

    private var companySection: some View {
        Section {
            Picker("Firma wystawiająca fakturę *", selection: Binding(get: { model.companyID }, set: { model.selectCompany($0) })) {
                Text("Wybierz firmę...").tag("")
                ForEach(model.companies) { company in
                    Text("\(company.name) - NIP: \(company.nip)\(company.isDefault ? " (domyślna)" : "")").tag(company.id)
                }
            }
            .disabled(model.isCorrective && !model.relatedID.isEmpty)
            if model.isCorrective && !model.relatedID.isEmpty {
                Text("Firma wystawiająca została pobrana z faktury korygowanej").font(.caption).foregroundStyle(.orange)
            } else if let company = model.companies.first(where: { $0.id == model.companyID }) {
                Text(company.legalName).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var typeSection: some View {
        Section {
            Picker("Typ faktury *", selection: $model.type) {
                ForEach(InvoiceFormText.types, id: \.0) { Text($0.1).tag($0.0) }
            }
            TextField("Numer faktury *", text: $model.number)
        }
    }

    private func correctionSection(_ setup: InvoiceEditSetup) -> some View {
        Section("Dane faktury korygowanej") {
            Picker("Wybierz fakturę do korekty *", selection: Binding(get: { model.relatedID }, set: { id in Task { await model.selectOriginal(id) } })) {
                Text("Wybierz fakturę...").tag("")
                if !model.relatedID.isEmpty && !(setup.correctable ?? []).contains(where: { $0.id == model.relatedID }) {
                    Text(model.correctedNumber.nonEmpty ?? "Faktura korygowana").tag(model.relatedID)
                }
                ForEach(setup.correctable ?? []) { invoice in
                    Text("\(invoice.number) - \(invoice.buyerName) (\(InvoiceMath.money(invoice.gross, "PLN"))) - \(InvoiceFormText.correctableType(invoice.type))").tag(invoice.id)
                }
            }
            if model.originalLoading { ProgressView().controlSize(.small) }
            if !model.correctedNumber.isEmpty {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                    GridRow {
                        LabeledContent("Nr faktury korygowanej:", value: model.correctedNumber)
                        LabeledContent("Data wystawienia:", value: model.correctedIssueDate.isEmpty ? "-" : InvoiceFormText.plDate(model.correctedIssueDate))
                    }
                    GridRow {
                        LabeledContent("Nr KSeF:", value: model.correctedKsefNumber.nonEmpty ?? "Nie wysłano do KSeF")
                        LabeledContent("W KSeF:") { Text(model.correctedWasInKsef ? "Tak" : "Nie").foregroundStyle(model.correctedWasInKsef ? Color.green : Color.secondary) }
                    }
                }
                .font(.callout)
            }
            Picker("Zakres korekty *", selection: $model.correctionScope) {
                Text("Całość faktury").tag("full")
                Text("Część faktury").tag("partial")
            }
            .pickerStyle(.radioGroup).horizontalRadioGroupLayout()
            Picker("Skutek korekty w ewidencji VAT *", selection: $model.correctionType) {
                Text("W dacie ujęcia faktury pierwotnej").tag(1)
                Text("W dacie wystawienia faktury korygującej").tag(2)
                Text("Inna data lub różne daty dla pozycji korekty").tag(3)
            }
            TextField("Przyczyna korekty *", text: $model.correctionReason, prompt: Text("np. Zmiana ceny usługi, Błąd w ilości, Rabat potransakcyjny..."), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    // MARK: Nabywca
    @ViewBuilder private func buyerSections(_ setup: InvoiceEditSetup) -> some View {
        Section {
            Toggle(isOn: $model.privatePerson) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Faktura dla osoby prywatnej")
                    Text("Użyj, gdy nabywca jest osobą indywidualną bez NIP.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(!model.eventID.isEmpty && model.billingArrangement != "direct")
        }
        if !model.eventID.isEmpty, let event = model.linkedEvent { billingSection(event) }
        Section(model.privatePerson ? "Osoba prywatna" : "Nabywca") {
            if model.privatePerson { privateFields(setup) } else { organizationPicker(setup) }
        }
        if !model.privatePerson && !model.organizationID.isEmpty {
            Section {
                Picker("Powiązane wydarzenie", selection: Binding(get: { model.eventID }, set: { model.changeEvent($0) })) {
                    Text("Brak powiązanego wydarzenia").tag("")
                    ForEach(model.organizationEvents) { event in
                        Text(event.date.map { "\(event.name) — \(InvoiceFormText.plDate($0))" } ?? event.name).tag(event.id)
                    }
                    if !model.eventID.isEmpty && !model.organizationEvents.contains(where: { $0.id == model.eventID }) {
                        Text(model.linkedEvent?.name ?? "Wybrane wydarzenie").tag(model.eventID)
                    }
                }
                if model.organizationEvents.isEmpty {
                    Text("Brak wydarzeń przypisanych do tej organizacji.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func billingSection(_ event: InvoiceFormEvent) -> some View {
        let indirect = model.billingArrangement != "direct"
        let recipientName = model.organizations.first { $0.id == model.serviceRecipientOrganizationID }?.name
        let payer = model.organizations.first { $0.id == model.organizationID }?.name
        return Section {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ROZLICZENIE WYDARZENIA").font(.caption2).foregroundStyle(.secondary)
                    Text(event.name).fontWeight(.medium)
                    Text([recipientName, event.date.map { InvoiceFormText.plDate($0) }].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if indirect, let payer { Label("Płatnik: \(payer)", systemImage: "building.2").font(.caption).foregroundStyle(.blue) }
            }
            Picker("Kto opłaca wydarzenie?", selection: Binding(get: { model.billingArrangement }, set: { value in Task { await model.changeBilling(value) } })) {
                ForEach(InvoiceFormText.arrangements, id: \.0) { Text($0.1).tag($0.0) }
            }
            Text(InvoiceFormText.arrangementDescription(model.billingArrangement)).font(.caption).foregroundStyle(.secondary)
            if indirect { Text("Poniżej wybierz organizację, której dane mają znaleźć się na fakturze.").font(.caption.weight(.medium)).foregroundStyle(.blue) }
        }
    }

    @ViewBuilder private func privateFields(_ setup: InvoiceEditSetup) -> some View {
        TextField("Szukaj osoby", text: $model.individualSearch, prompt: Text("Szukaj osoby po imieniu, nazwisku, emailu, telefonie lub mieście..."))
        let terms = model.individualSearch.trimmingCharacters(in: .whitespaces).lowercased()
        if !terms.isEmpty {
            let found = (setup.individuals ?? []).filter { contact in
                [contact.name, contact.email, contact.phone, contact.city].filter { !$0.isEmpty }.joined(separator: " ").lowercased().contains(terms)
            }
            ForEach(found.prefix(20)) { contact in
                Button { model.selectIndividual(contact) } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(contact.name.isEmpty ? "Bez nazwy" : contact.name).fontWeight(.medium)
                        Text([contact.email, contact.phone, contact.city].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? "Brak danych kontaktowych")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
            GridRow {
                TextField("Imię *", text: $model.privateBuyer.firstName)
                TextField("Nazwisko *", text: $model.privateBuyer.lastName)
            }
            GridRow {
                TextField("Ulica i numer *", text: $model.privateBuyer.street)
                TextField("Kod pocztowy *", text: $model.privateBuyer.postalCode)
            }
            GridRow {
                TextField("Miasto *", text: $model.privateBuyer.city)
                TextField("E-mail", text: $model.privateBuyer.email)
            }
            GridRow {
                TextField("Telefon", text: $model.privateBuyer.phone)
                Color.clear.frame(height: 1)
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder private func organizationPicker(_ setup: InvoiceEditSetup) -> some View {
        if let selected = model.organizations.first(where: { $0.id == model.organizationID }) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(selected.name).fontWeight(.medium)
                    if !selected.nip.isEmpty { Text("NIP: \(selected.nip)").font(.caption).foregroundStyle(.secondary) }
                    Text(selected.address.isEmpty ? "Brak pełnego adresu — uzupełnij przed wystawieniem" : selected.address).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await model.selectBuyer("") } } label: { Image(systemName: "xmark.circle") }
                    .buttonStyle(.borderless).help("Wyczyść wybór nabywcy")
            }
        } else {
            TextField("Wyszukaj nabywcę", text: $buyerSearch, prompt: Text("Wyszukaj nabywcę po nazwie, NIP lub mieście..."))
            Button { addingBuyer = true } label: {
                Label("Dodaj nowego nabywcę — wprowadź dane ręcznie lub pobierz z GUS", systemImage: "plus.circle")
            }
            .buttonStyle(.link)
            let terms = buyerSearch.trimmingCharacters(in: .whitespaces).lowercased()
            let found = model.organizations.filter { terms.isEmpty || $0.name.lowercased().contains(terms) || $0.nip.lowercased().contains(terms) || $0.city.lowercased().contains(terms) }
            if found.isEmpty {
                Text("Nie znaleziono kontaktów. Spróbuj wyszukać inaczej lub dodaj nowego nabywcę").font(.caption).foregroundStyle(.secondary)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(found.prefix(80)) { org in
                            Button { buyerSearch = ""; Task { await model.selectBuyer(org.id) } } label: {
                                HStack(spacing: 8) {
                                    Text(org.name).lineLimit(1)
                                    if !org.nip.isEmpty { Text("NIP: \(org.nip)").font(.caption).foregroundStyle(.secondary) }
                                    if !org.city.isEmpty { Text(org.city).font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                }
                                .padding(.vertical, 4).padding(.horizontal, 6)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 180)
            }
        }
        if let error = setup.organizationsError { Text(error).font(.caption).foregroundStyle(.orange) }
    }

    // MARK: Daty, nota, płatność
    private func day(_ value: Binding<String>) -> Binding<Date> {
        Binding(get: { FinanceText.dayDate(value.wrappedValue) ?? Date() }, set: { value.wrappedValue = FinanceText.dayString($0) })
    }

    private var datesSection: some View {
        Section {
            DatePicker("Data wystawienia *", selection: day($model.issueDate), displayedComponents: .date)
            DatePicker("Data sprzedaży *", selection: day($model.saleDate), displayedComponents: .date)
            TextField("Termin płatności (dni) *", text: $model.paymentDays)
            LabeledContent("Data płatności", value: model.dueDate.map { FinanceText.day($0) } ?? "Podaj poprawną liczbę dni i datę wystawienia")
        }
    }

    private var noteSection: some View {
        Section {
            Toggle(isOn: $model.includeFooter) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dodaj notę płatniczą")
                    Text("Nota zostanie zapisana na fakturze i pokazana w PDF.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox)
            if model.includeFooter {
                TextField("Nota", text: $model.footer, prompt: Text("Treść noty na fakturze"), axis: .vertical).lineLimit(3...8)
            }
        }
    }

    private var methodSection: some View {
        Section {
            Picker("Metoda płatności *", selection: $model.paymentMethod) {
                ForEach(InvoiceEditModel.paymentMethods, id: \.self) { Text($0).tag($0) }
                if !InvoiceEditModel.paymentMethods.contains(model.paymentMethod) { Text(model.paymentMethod).tag(model.paymentMethod) }
            }
            TextField("Miejsce wystawienia", text: $model.issuePlace, prompt: Text("np. Warszawa"))
        }
    }

    private var paymentSection: some View {
        Section("Status płatności") {
            Picker("Status płatności", selection: Binding(get: { model.paymentStatus }, set: { model.changePaymentStatus($0) })) {
                Text("Do zapłaty").tag("unpaid")
                Text("Częściowo zapłacono").tag("partially_paid")
                Text("Zapłacono").tag("paid")
            }
            .labelsHidden()
            if model.paymentStatus != "unpaid" {
                DatePicker("Data płatności", selection: day($model.paidDate), displayedComponents: .date)
                LabeledContent("Kwota zapłacona") {
                    InvoiceNumberField(title: "", value: $model.paidAmount, width: 140).textFieldStyle(.roundedBorder)
                        .disabled(model.paymentStatus == "paid")
                }
            }
            LabeledContent("Do zapłaty:") {
                Text(String(format: "%.2f zł", max(model.displayedTotals.gross - model.paidAmount, 0))).fontWeight(.medium).foregroundStyle(theme.accent)
            }
        }
    }

    private var advanceSection: some View {
        Section {
            LabeledContent("Wysokość zaliczki *") {
                HStack(spacing: 4) { InvoiceNumberField(title: "", value: $model.advancePercent, width: 120).textFieldStyle(.roundedBorder); Text(verbatim: "%") }
            }
            Text("Pozycje opisują pełne zamówienie. Kwota zaliczki jest zapisywana osobno.").font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Pozycje i podsumowanie
    private var itemsSection: some View {
        Section {
            ForEach(model.items) { item in InvoiceEditItemRow(model: model, item: item) }
        } header: {
            HStack {
                Text("Pozycje faktury")
                Spacer()
                Button { model.addItem() } label: { Label("Dodaj pozycję", systemImage: "plus") }.buttonStyle(.borderless)
            }
        }
    }

    private var summarySection: some View {
        let shown = model.displayedTotals
        let totals = model.totals(model.items)
        return Section("Podsumowanie") {
            HStack(alignment: .top) {
                summaryValue("Suma netto", String(format: "%.2f zł", shown.net))
                summaryValue("Suma VAT", String(format: "%.2f zł", shown.vat))
                summaryValue("Suma brutto", model.paymentStatus == "paid" ? "0.00 zł" : String(format: "%.2f zł", shown.gross), accent: true)
            }
            if model.paymentStatus != "unpaid" {
                LabeledContent("Zapłacono:") { Text(String(format: "%.2f zł", model.paidAmount)).foregroundStyle(.green) }
                LabeledContent("Do zapłaty:") { Text(String(format: "%.2f zł", max(totals.gross - model.paidAmount, 0))).fontWeight(.medium).foregroundStyle(theme.accent) }
            }
        }
    }

    private func summaryValue(_ label: String, _ value: String, accent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3).monospacedDigit().foregroundStyle(accent ? theme.accent : Color.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footerBar: some View {
        HStack(spacing: 10) {
            if let problem = model.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(4).textSelection(.enabled)
            }
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
            Button {
                Task {
                    if await model.submit() {
                        dismiss()
                        onSaved()
                    }
                }
            } label: { Label(model.saving ? "Zapisywanie..." : "Zapisz zmiany", systemImage: "square.and.arrow.down") }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            .disabled(model.saving)
        }
        .padding(16)
    }
}

/// Pozycja edytora faktury (jak wiersz pozycji w `/crm/invoices/[id]/edit`).
@MainActor struct InvoiceEditItemRow: View {
    @ObservedObject var model: InvoiceEditModel
    let item: InvoiceEditItem

    private func binding<T>(_ key: WritableKeyPath<InvoiceEditItem, T>) -> Binding<T> {
        Binding(get: { (model.items.first { $0.id == item.id } ?? item)[keyPath: key] }, set: { value in
            model.updateItem(item.id) { $0[keyPath: key] = value }
        })
    }
    private var gross: Binding<Double> {
        Binding(get: { InvoiceMath.grossFromNet(item.priceNet, item.vatRate) }, set: { value in
            model.updateItem(item.id) { $0.priceNet = InvoiceMath.netFromGross(value, $0.vatRate) }
        })
    }

    var body: some View {
        let values = model.values(item)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                labeled("Nazwa *") { TextField("", text: binding(\.name)).textFieldStyle(.roundedBorder) }.frame(minWidth: 180)
                labeled("J.m.") {
                    Picker("", selection: binding(\.unit)) {
                        ForEach(InvoiceEditModel.units, id: \.self) { Text($0).tag($0) }
                        if !InvoiceEditModel.units.contains(item.unit) { Text(item.unit).tag(item.unit) }
                    }
                    .labelsHidden()
                }
                .frame(width: 80)
                labeled("Ilość *") { InvoiceNumberField(title: "", value: binding(\.quantity)).textFieldStyle(.roundedBorder) }.frame(width: 80)
                labeled("Cena netto *") { InvoiceNumberField(title: "", value: binding(\.priceNet)).textFieldStyle(.roundedBorder) }.frame(width: 100)
                labeled("Cena brutto *") { InvoiceNumberField(title: "", value: gross).textFieldStyle(.roundedBorder) }.frame(width: 100)
                labeled("Stawka VAT") {
                    Picker("", selection: Binding(get: { item.vatCode }, set: { model.changeVat(item.id, $0) })) {
                        ForEach(InvoiceFormText.vatCodes.filter { $0.2 || $0.0 == item.vatCode }, id: \.0) { code in Text(code.1).tag(code.0) }
                    }
                    .labelsHidden()
                }
                .frame(width: 170)
                Button { model.removeItem(item.id) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń pozycję")
            }
            if model.isCorrective, let beforeQuantity = item.beforeQuantity {
                Text("Przed korektą: \(String(format: "%.2f", beforeQuantity)) \(item.unit) × \(String(format: "%.2f", item.beforePriceNet ?? 0)) zł netto. Pola powyżej przedstawiają stan po korekcie.")
                    .font(.caption).foregroundStyle(.orange)
            }
            if item.vatCode == "zw" {
                labeled("Podstawa prawna zwolnienia z VAT *") { TextField("", text: binding(\.exemption)).textFieldStyle(.roundedBorder) }
            }
            HStack(spacing: 16) {
                Text("Wartość netto: \(String(format: "%.2f", values.net)) zł")
                Text("Kwota VAT: \(String(format: "%.2f", values.vat)) zł")
                Text("Wartość brutto: \(String(format: "%.2f", values.gross)) zł").fontWeight(.semibold).foregroundStyle(Color.accentColor)
            }
            .font(.caption).monospacedDigit()
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            content()
        }
    }
}
