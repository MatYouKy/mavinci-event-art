import SwiftUI

// MARK: Stan formularza „Wystaw fakturę” — odpowiednik stanu strony `/crm/invoices/new`: firma i numer, nabywca (organizacja,
// osoba prywatna), wydarzenie z rozliczeniem i grupą rozliczeń, odbiorca KSeF, pozycje ze źródła (kalkulacja / oferta) albo
// ręczne, pozycja zbiorcza, pro forma i zaliczka (%), kolejna zaliczka, korekta kwot i korekta danych. Zapis — `invoiceCreate`
// (serwer sprawdza formularz tak jak przeglądarka i zapisuje funkcją `create_invoice_atomic`).

@MainActor final class InvoiceFormModel: ObservableObject {
    let request: InvoiceFormRequest
    weak var workspace: Workspace?

    // Dane formularza
    @Published var setup: InvoiceFormSetup?
    @Published var loadError: String?
    @Published var loading = true
    @Published var problem: String?
    @Published var saving = false

    // Typ, firma, numer
    @Published var type: String
    @Published var companyID = ""
    @Published var companyLoading = false
    @Published var companyMessage: String?
    @Published var number = ""
    @Published var numberAuto = true
    @Published var numberGenerated = false
    @Published var numberLoading = false
    @Published var numberExists = false
    @Published var numberChecking = false

    // Daty i płatność
    @Published var issueDate = FinanceText.dayString(Date())
    @Published var saleDate = FinanceText.dayString(Date())
    @Published var paymentDays = "7"
    @Published var paymentMethod = "Przelew"
    @Published var isPaid = false
    @Published var paidDate = FinanceText.dayString(Date())

    // Nabywca
    @Published var privatePerson = false
    @Published var privateBuyer = InvoicePrivateBuyer()
    @Published var individualID = ""
    @Published var organizationID = ""
    @Published var buyerLink: InvoiceBuyerLink?
    @Published var buyerOverrideConfirmed = false

    // Wydarzenie i rozliczenie
    @Published var eventID = ""
    @Published var linkedEvent: InvoiceFormEvent?
    @Published var eventBuyerLink: (eventID: String, link: InvoiceBuyerLink?)?
    @Published var organizationEvents: [InvoiceFormEvent] = []
    @Published var settlementGroup: InvoiceSettlementGroup?
    @Published var billingArrangement = "direct"
    @Published var serviceRecipientOrganizationID = ""
    @Published var serviceRecipientContactID = ""

    // Odbiorca KSeF
    @Published var recipient = InvoiceRecipientDraft.same
    @Published var recipientPrefillError: String?
    @Published var recipientLoading = false
    @Published var recipientLoadError: String?
    @Published var recipientOrganizations: [InvoiceRecipientOrganization] = []

    // Pozycje
    @Published var items: [InvoiceFormItem] = [InvoiceFormItem()]
    @Published var itemSources: [InvoiceItemSource] = []
    @Published var itemSource = "manual"
    @Published var preferredSource: String?
    @Published var itemSourcesLoading = false
    @Published var acceptedPricing: InvoiceItemSource?
    @Published var pricingError: String?
    @Published var simplified = false
    @Published var simplifiedName = "Obsługa muzyczna"
    @Published var advancePercent: Double = 30
    @Published var proformaPercent: Double = 100
    @Published var includeNote = true
    @Published var note = ""

    // Kolejna zaliczka
    @Published var advance: InvoiceFormSetup.Advance?
    @Published var advanceError: String?

    // Korekta
    @Published var relatedID = ""
    @Published var original: InvoiceOriginal?
    @Published var originalRecipient: InvoiceRecipientDraft?
    @Published var originalLoading = false
    @Published var correctionKind = "amount"
    @Published var correctionType = 2
    @Published var correctionScope = "full"
    @Published var correctionReason = ""
    @Published var correctedBuyer = InvoiceCorrectedBuyer()
    @Published var partyConfirmed = false
    @Published var correctionLines: [InvoiceCorrectionLine] = []

    private var partyRevision = 0
    private var partiesPrefilledFor: String?
    private var itemRevision = 0
    private var companyPrefilledFor: String?
    private var eventRequest = 0
    private var recipientRequest = 0
    private var orgRequest = 0

    init(request: InvoiceFormRequest, workspace: Workspace?) {
        self.request = request
        self.workspace = workspace
        switch request {
        case .new(let type, let eventID):
            self.type = InvoiceFormText.types.contains { $0.0 == type } ? type : "vat"
            self.eventID = eventID ?? ""
            companyLoading = eventID != nil
        case .corrective(let id):
            type = "corrective"
            relatedID = id
        case .nextAdvance:
            type = "advance"
        }
    }

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
    var isPartyData: Bool { isCorrective && correctionKind == "party_data" }
    var nextAdvanceSource: String? { if case .nextAdvance(let id) = request { return id }; return nil }
    var isNextAdvance: Bool { nextAdvanceSource != nil }
    var urlEventID: String? { if case .new(_, let id) = request { return id }; return nil }
    var urlRelated: Bool { if case .corrective = request { return true }; return false }
    var companies: [InvoiceFormSetup.Company] { setup?.companies ?? [] }
    var company: InvoiceFormSetup.Company? { companies.first { $0.id == companyID } }
    var organizations: [InvoiceFormSetup.Organization] { setup?.organizations ?? [] }
    var currency: String { advance?.currency ?? (isCorrective ? original?.currency : nil) ?? "PLN" }
    var currencyLabel: String { currency == "PLN" ? "zł" : currency }
    var sourceBuyer: InvoiceFormBuyer? { isCorrective ? original?.buyer : advance?.buyer }
    var isCashPayment: Bool { ["Gotówka", "Karta", "BLIK"].contains(paymentMethod) }
    var dueDate: String? { InvoiceMath.dueDate(issue: issueDate, days: paymentDays) }

    /// Nabywca organizacja na podglądzie (korekta danych — dane po korekcie; dokument źródłowy — jego dane; zwykła — wybrana).
    var selectedOrganization: (name: String, nip: String, street: String, postalCode: String, city: String)? {
        if isPartyData { return (correctedBuyer.name, correctedBuyer.nip, correctedBuyer.street, correctedBuyer.postalCode, correctedBuyer.city) }
        if let buyer = sourceBuyer { return (buyer.name, buyer.nip, buyer.street, buyer.postalCode, buyer.city) }
        guard let org = organizations.first(where: { $0.id == organizationID }) else { return nil }
        return (org.name, org.nip, org.street, org.postalCode, org.city)
    }
    var eventJstLink: InvoiceBuyerLink? {
        guard let stored = eventBuyerLink, let linkedEvent, stored.eventID == linkedEvent.id else { return nil }
        return stored.link
    }
    var expectedEventBuyerID: String? {
        guard let linkedEvent else { return nil }
        if linkedEvent.billingArrangement != "direct" { return linkedEvent.billingOrganizationId.nonEmpty }
        return eventJstLink?.buyer.id ?? linkedEvent.organizationId.nonEmpty
    }
    var buyerDiffersFromEvent: Bool {
        guard !isCorrective, sourceBuyer == nil, let expected = expectedEventBuyerID else { return false }
        return privatePerson || (!organizationID.isEmpty && organizationID != expected)
    }
    var buyerPreviewName: String {
        privatePerson ? "\(privateBuyer.firstName) \(privateBuyer.lastName)".trimmingCharacters(in: .whitespaces) : selectedOrganization?.name ?? ""
    }
    var buyerPreviewAddress: String {
        if privatePerson {
            return [privateBuyer.street, [privateBuyer.postalCode, privateBuyer.city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }.joined(separator: ", ")
        }
        guard let org = selectedOrganization else { return "" }
        return [org.street, [org.postalCode, org.city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// Pozycje zapisywane na fakturze (pozycja zbiorcza zamiast szczegółowych, gdy wybrana i możliwa).
    var itemsForInvoice: [InvoiceFormItem] {
        guard !isCorrective, simplified, InvoiceMath.combinedError(items) == nil, let first = items.first else { return items }
        let totalNet = items.reduce(0) { $0 + InvoiceMath.values($1).net }
        var item = InvoiceFormItem(name: simplifiedName, unit: "usł.", quantity: 1, priceNet: InvoiceMath.jsRound(totalNet * 100) / 100, vatCode: first.vatCode, exemption: first.exemption)
        item.vatRate = first.vatRate
        return [item]
    }
    var totals: (net: Double, vat: Double, gross: Double) { InvoiceMath.totals(itemsForInvoice) }
    var percentTotals: (net: Double, vat: Double, gross: Double)? {
        if type == "advance" { return InvoiceMath.totals(InvoiceMath.percentItems(itemsForInvoice, advancePercent)) }
        if type == "proforma" { return InvoiceMath.totals(InvoiceMath.percentItems(itemsForInvoice, proformaPercent)) }
        return nil
    }
    /// Korekta: wartości „przed”, „po” i różnica (jak podsumowanie korekty w CRM).
    var correctionTotals: (before: (Double, Double, Double), delta: (Double, Double, Double)) {
        var before = (0.0, 0.0, 0.0), delta = (0.0, 0.0, 0.0)
        for line in correctionLines {
            let after = InvoiceMath.values(quantity: line.afterQuantity, priceNet: line.afterPriceNet, rate: line.before.vatRate)
            before.0 += line.before.beforeNet; before.1 += line.before.beforeVat
            delta.0 += InvoiceMath.fixed2(after.net - line.before.beforeNet)
            delta.1 += InvoiceMath.fixed2(after.vat - line.before.beforeVat)
            delta.2 += InvoiceMath.fixed2(after.gross - line.before.beforeGross)
        }
        before.2 = before.0 + before.1
        return (before, delta)
    }

    // MARK: Wczytanie
    func load() async {
        loading = true
        defer { loading = false }
        var query: [String: String] = ["op": "invoiceForm"]
        if let source = nextAdvanceSource { query["advanceFrom"] = source }
        do {
            let data: InvoiceFormSetup = try await get(query)
            setup = data
            loadError = nil
            paymentMethod = data.paymentMethod
        } catch {
            loadError = failureText(error, "Błąd podczas ładowania danych")
            companyLoading = false
            return
        }
        if isNextAdvance {
            applyAdvance()
        } else if isCorrective {
            if !relatedID.isEmpty { await selectOriginal(relatedID) }
        } else if let eventID = urlEventID {
            await loadEvent(eventID, initial: true)
        } else if companyID.isEmpty {
            await selectCompany(setup?.defaultCompanyId ?? "")
        }
        applyDefaultNote()
    }

    private func applyAdvance() {
        guard let advance = setup?.advance else { return }
        if let error = advance.error {
            advanceError = error
            workspace?.error = error
            return
        }
        self.advance = advance
        items = advance.orderItems ?? []
        organizationID = advance.buyer?.organizationId ?? ""
        eventID = advance.eventId ?? ""
        billingArrangement = advance.billingArrangement ?? "direct"
        serviceRecipientOrganizationID = advance.serviceRecipientOrganizationId ?? ""
        serviceRecipientContactID = advance.serviceRecipientContactId ?? ""
        partiesPrefilledFor = advance.eventId?.nonEmpty
        recipient = advance.recipient ?? .same
        recipientPrefillError = advance.recipientError
        privatePerson = advance.buyer?.privatePerson ?? false
        individualID = advance.individualId ?? ""
        privateBuyer = advance.privateBuyer ?? InvoicePrivateBuyer()
        // Nowa zaliczka ma własną kwotę i własne potwierdzenie wpłaty.
        advancePercent = 0
        isPaid = false
        paidDate = FinanceText.dayString(Date())
        simplified = false
        acceptedPricing = nil
        pricingError = nil
        if let sale = advance.saleDate { saleDate = sale }
        Task {
            await selectCompany(advance.companyId ?? "")
            if let id = advance.eventId?.nonEmpty { await loadKeptEvent(id) }
        }
    }

    // MARK: Firma i numer
    func selectCompany(_ id: String) async {
        let changed = id != companyID
        companyID = id
        if changed { companyMessage = nil }
        applyDefaultNote()
        await peekNumber()
    }

    func changeType(_ next: String) async {
        guard next != type else { return }
        type = next
        await peekNumber()
    }

    func peekNumber() async {
        guard !companyID.isEmpty else { return }
        numberLoading = true
        defer { numberLoading = false }
        struct Reply: Decodable { var number: String }
        do {
            let reply: Reply = try await get(["op": "invoiceNumber", "type": type, "company": companyID])
            if !reply.number.isEmpty {
                number = reply.number
                numberAuto = true
                numberGenerated = true
            }
        } catch {
            // Jak w CRM: bez numeru automatycznego można wpisać własny.
        }
    }

    func editNumber(_ value: String) {
        number = value
        numberAuto = false
        numberGenerated = false
    }

    func checkNumber() async {
        let value = number.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, !companyID.isEmpty else { numberExists = false; return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        numberChecking = true
        defer { numberChecking = false }
        struct Reply: Decodable { var exists: Bool }
        let reply: Reply? = try? await get(["op": "invoiceNumberCheck", "company": companyID, "number": value])
        guard !Task.isCancelled else { return }
        numberExists = reply?.exists ?? false
    }

    /// Domyślna adnotacja działalności, gdy pole jest puste (jak w CRM).
    func applyDefaultNote() {
        guard includeNote, note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let footer = company?.footer, !footer.isEmpty else { return }
        note = footer
    }
    func setIncludeNote(_ on: Bool) {
        includeNote = on
        if on, note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let footer = company?.footer, !footer.isEmpty { note = footer }
        if !on { note = "" }
    }

    // MARK: Wydarzenie
    /// Wybór wydarzenia (`handleEventChange`) albo wydarzenie z adresu (`initial`: także data sprzedaży = data wydarzenia).
    func loadEvent(_ id: String, initial: Bool) async {
        eventRequest += 1
        let request = eventRequest
        if !initial {
            partyRevision += 1
            partiesPrefilledFor = nil
        }
        buyerOverrideConfirmed = false
        let useEventCompany = !isNextAdvance && !isCorrective
        eventID = id
        if !initial { billingArrangement = "direct" }
        if useEventCompany {
            companyPrefilledFor = nil
            companyMessage = nil
            companyLoading = !id.isEmpty
            if !id.isEmpty { companyID = "" }
        }
        // Źródła pozycji wydarzenia (nie dotyczy korekty i kolejnej zaliczki).
        itemSources = []; itemSource = "manual"; preferredSource = nil; acceptedPricing = nil; pricingError = nil
        if id.isEmpty {
            itemSourcesLoading = false
            linkedEvent = nil
            serviceRecipientOrganizationID = ""
            serviceRecipientContactID = ""
            settlementGroup = nil
            companyLoading = false
            return
        }
        itemSourcesLoading = true
        items = [InvoiceFormItem(unit: "usł.")]
        let revision = partyRevision
        let itemsRevision = itemRevision
        do {
            let context: InvoiceEventContext = try await get(["op": "invoiceEvent", "id": id, "mode": "new"])
            guard request == eventRequest else { return }
            settlementGroup = context.settlementGroup
            if revision == partyRevision {
                linkedEvent = context.event
                if let event = context.event { eventBuyerLink = (event.id, context.buyerLink) } else { eventBuyerLink = nil }
                if let event = context.event, let parties = context.parties, partiesPrefilledFor != event.id {
                    partiesPrefilledFor = event.id
                    serviceRecipientOrganizationID = parties.serviceRecipientOrganizationId
                    serviceRecipientContactID = parties.serviceRecipientContactId
                    billingArrangement = parties.billingArrangement
                    buyerOverrideConfirmed = false
                    recipientPrefillError = nil
                    recipient = parties.recipient
                    recipientLoadError = parties.recipientError
                    await setOrganization(parties.buyerId)
                }
            }
            if useEventCompany, let event = context.event, companyPrefilledFor != event.id, let prefill = context.company {
                companyPrefilledFor = event.id
                companyMessage = prefill.message
                await selectCompany(prefill.companyId)
                companyMessage = prefill.message
            } else if useEventCompany && context.event == nil {
                companyMessage = "Nie udało się odczytać działalności wydarzenia. Sprawdź dane wydarzenia przed wyborem firmy wystawiającej."
            }
            if initial, let date = context.event?.date { saleDate = date }
            if itemsRevision == itemRevision {
                applySources(context)
            } else if let sources = context.itemSources {
                itemSources = sources.choices
                preferredSource = sources.preferredId
                pricingError = sources.warning.nonEmpty
            }
        } catch {
            guard request == eventRequest else { return }
            if useEventCompany {
                companyID = ""
                companyMessage = "Nie udało się ustalić firmy wystawiającej na podstawie wydarzenia. Odśwież formularz, aby ponownie wczytać dane."
            }
            pricingError = failureText(error, "Nie udało się odczytać źródła pozycji.")
        }
        companyLoading = false
        itemSourcesLoading = false
    }

    private func applySources(_ context: InvoiceEventContext) {
        if let message = context.itemSourcesError { pricingError = message; return }
        guard let sources = context.itemSources else { return }
        itemSources = sources.choices
        preferredSource = sources.preferredId
        pricingError = sources.warning.nonEmpty
        if let preferred = sources.choices.first(where: { $0.id == sources.preferredId }) {
            items = preferred.items.map { var item = $0; item.id = UUID(); return item }
            itemSource = preferred.id
            acceptedPricing = preferred
        } else {
            items = [InvoiceFormItem(name: "Obsługa techniczna — \(sources.eventName)", unit: "usł.")]
        }
    }

    /// Wydarzenie dokumentu źródłowego (korekta, kolejna zaliczka) — bez zmiany stron i pozycji.
    private func loadKeptEvent(_ id: String) async {
        guard let context: InvoiceEventContext = try? await get(["op": "invoiceEvent", "id": id, "mode": "keep"]) else { return }
        guard eventID == id else { return }
        linkedEvent = context.event
        if let event = context.event { eventBuyerLink = (event.id, context.buyerLink) }
        settlementGroup = context.settlementGroup
    }

    /// Wydarzenia nabywcy do pola „Powiązane wydarzenie” (obecne wydarzenie zostaje na liście).
    private func loadOrganizationEvents() async {
        guard !organizationID.isEmpty else {
            organizationEvents = []
            return
        }
        orgRequest += 1
        let request = orgRequest
        struct Reply: Decodable { var events: [InvoiceFormEvent] }
        let keep = eventID.isEmpty ? (urlEventID ?? "") : eventID
        guard let reply: Reply = try? await get(["op": "invoiceOrgEvents", "org": organizationID, "keep": keep]) else { return }
        guard request == orgRequest else { return }
        organizationEvents = reply.events
    }

    /// Nabywca wybrany ręcznie (lub z wydarzenia): wydarzenia nabywcy i podpowiedź „wystaw na gminę”.
    private func setOrganization(_ id: String) async {
        organizationID = id
        buyerLink = nil
        if id.isEmpty {
            organizationEvents = []
            if eventID.isEmpty { eventID = urlEventID ?? "" }
            return
        }
        if !privatePerson && !isCorrective && sourceBuyer == nil {
            struct Reply: Decodable { var link: InvoiceBuyerLink? }
            let reply: Reply? = try? await get(["op": "invoiceBuyerLink", "org": id])
            if organizationID == id { buyerLink = reply?.link }
        }
        await loadOrganizationEvents()
    }

    // MARK: Nabywca
    /// Wybór nabywcy (`handleBuyerSelect`): rozliczenie bezpośrednie albo przez inną organizację.
    func selectBuyer(_ id: String) async {
        partyRevision += 1
        partiesPrefilledFor = eventID.nonEmpty ?? urlEventID
        buyerOverrideConfirmed = false
        if !eventID.isEmpty && !serviceRecipientOrganizationID.isEmpty {
            if id == serviceRecipientOrganizationID || id == eventJstLink?.buyer.id {
                billingArrangement = "direct"
            } else if billingArrangement == "direct" {
                billingArrangement = "other"
            }
        }
        await setOrganization(id)
    }

    /// „Ustaw … jako nabywcę”: nabywca z karty organizacji, wybrana jednostka jako odbiorca.
    func applyBuyerLink() async {
        guard let link = buyerLink else { return }
        let unit = link.unitOrganizationId
        await selectBuyer(link.buyer.id)
        await selectRecipientOrganization(unit, role: link.role)
    }

    func changeBilling(_ arrangement: String) async {
        partyRevision += 1
        partiesPrefilledFor = eventID.nonEmpty
        buyerOverrideConfirmed = false
        billingArrangement = arrangement
        privatePerson = false
        if arrangement == "direct" && !serviceRecipientOrganizationID.isEmpty {
            await setOrganization(eventJstLink?.buyer.id ?? serviceRecipientOrganizationID)
        } else if arrangement != "direct" && organizationID == serviceRecipientOrganizationID {
            await setOrganization("")
        }
    }

    func setPrivate(_ on: Bool) async {
        partyRevision += 1
        partiesPrefilledFor = eventID.nonEmpty ?? urlEventID
        buyerOverrideConfirmed = false
        privatePerson = on
        individualID = ""
        privateBuyer = InvoicePrivateBuyer()
        await setOrganization("")
    }

    func selectIndividual(_ contact: InvoiceFormSetup.Individual) {
        individualID = contact.id
        privateBuyer = InvoicePrivateBuyer(firstName: contact.firstName, lastName: contact.lastName, street: contact.street,
                                           postalCode: contact.postalCode, city: contact.city, email: contact.email, phone: contact.phone)
    }

    /// Nowy nabywca dodany z formularza: świeża lista organizacji i wybór.
    func buyerAdded(_ id: String) async {
        var query: [String: String] = ["op": "invoiceForm"]
        if let source = nextAdvanceSource { query["advanceFrom"] = source }
        if let fresh: InvoiceFormSetup = try? await get(query) { setup?.organizations = fresh.organizations; setup?.organizationsError = fresh.organizationsError }
        await selectBuyer(id)
    }

    // MARK: Odbiorca
    func editRecipient(_ draft: InvoiceRecipientDraft) {
        recipientRequest += 1
        recipientLoading = false
        recipientLoadError = nil
        partyRevision += 1
        partiesPrefilledFor = eventID.nonEmpty
        recipientPrefillError = nil
        recipient = draft
        partyConfirmed = false
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

    /// Organizacja odbiorcy z CRM — dane karty (jak „Pobierz aktualne dane z CRM”).
    func selectRecipientOrganization(_ id: String, role: Int? = nil) async {
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

    // MARK: Korekta
    func selectOriginal(_ id: String) async {
        originalLoading = true
        defer { originalLoading = false }
        partyRevision += 1
        original = nil
        originalRecipient = nil
        partyConfirmed = false
        recipientPrefillError = nil
        recipient = .same
        relatedID = id
        correctionLines = []
        guard !id.isEmpty else { return }
        do {
            let data: InvoiceOriginal = try await get(["op": "invoiceOriginal", "id": id])
            guard relatedID == id else { return }
            original = data
            correctedBuyer = data.correctedBuyer
            partiesPrefilledFor = data.eventId.nonEmpty
            recipient = data.recipient ?? .same
            originalRecipient = data.recipient
            recipientPrefillError = data.recipientError
            privatePerson = data.buyer.privatePerson
            privateBuyer = data.privateBuyer
            organizationID = data.buyer.organizationId
            eventID = data.eventId
            billingArrangement = data.billingArrangement
            serviceRecipientOrganizationID = data.serviceRecipientOrganizationId
            serviceRecipientContactID = data.serviceRecipientContactId
            linkedEvent = data.event
            if let sale = data.saleDate { saleDate = sale }
            correctionLines = data.items.map { InvoiceCorrectionLine(before: $0, afterQuantity: $0.beforeQuantity, afterPriceNet: $0.beforePriceNet) }
            await selectCompany(data.companyId)
            if !data.eventId.isEmpty { await loadKeptEvent(data.eventId) } else { settlementGroup = nil }
        } catch {
            workspace?.error = failureText(error, "Nie udało się odczytać faktury korygowanej. Nie podstawiono danych z innego źródła.")
        }
    }

    func changeCorrectionKind(_ kind: String) {
        correctionKind = kind
        partyConfirmed = false
        if kind == "party_data" {
            isPaid = false
            organizationID = correctedBuyer.organizationId
        } else if let original {
            organizationID = original.buyer.organizationId
            if let originalRecipient { recipient = originalRecipient }
        }
    }

    func editCorrectedBuyer(_ buyer: InvoiceCorrectedBuyer) {
        correctedBuyer = buyer
        organizationID = buyer.organizationId
        partyConfirmed = false
    }

    // MARK: Pozycje
    func selectSource(_ id: String) {
        itemRevision += 1
        itemSource = id
        guard id != "manual" else { acceptedPricing = nil; return }
        guard let choice = itemSources.first(where: { $0.id == id }) else { return }
        items = choice.items.map { var item = $0; item.id = UUID(); return item }
        acceptedPricing = choice
    }
    func addItem() {
        itemRevision += 1
        items.append(InvoiceFormItem())
    }
    func removeItem(_ id: UUID) {
        itemRevision += 1
        items.removeAll { $0.id == id }
    }
    func updateItem(_ id: UUID, _ change: (inout InvoiceFormItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        itemRevision += 1
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
    var canSubmit: Bool {
        !saving && !companyLoading && !(isCorrective && originalLoading) && !(!isCorrective && itemSourcesLoading)
            && !(isNextAdvance && (advance == nil || advanceError != nil))
    }

    private var formJSON: JSONValue {
        var correction: [String: JSONValue] = [:]
        if isCorrective {
            correction = [
                "relatedId": .string(relatedID), "kind": .string(correctionKind), "reason": .string(correctionReason),
                "type": .number(Double(correctionType)), "scope": .string(correctionScope), "buyer": correctedBuyer.json,
                "confirmed": .bool(partyConfirmed),
                "items": .array(correctionLines.map { .object(["position": .number(Double($0.before.position)), "quantity": .number($0.afterQuantity), "priceNet": .number($0.afterPriceNet)]) }),
            ]
        }
        return .object([
            "type": .string(type), "companyId": .string(companyID), "number": .string(number), "autoNumber": .bool(numberAuto),
            "issueDate": .string(issueDate), "saleDate": .string(saleDate), "paymentDays": .string(paymentDays), "paymentMethod": .string(paymentMethod),
            "isPaid": .bool(isPaid), "paidDate": .string(paidDate), "private": .bool(privatePerson), "privateBuyer": privateBuyer.json,
            "individualId": .string(individualID), "organizationId": .string(organizationID), "eventId": .string(eventID),
            "billingArrangement": .string(billingArrangement), "recipient": recipient.json, "buyerOverrideConfirmed": .bool(buyerOverrideConfirmed),
            "items": .array(items.map(\.json)), "simplified": .bool(simplified), "simplifiedName": .string(simplifiedName),
            "advancePercent": .number(advancePercent), "proformaPercent": .number(proformaPercent), "includeNote": .bool(includeNote),
            "note": .string(note), "advanceFrom": .string(nextAdvanceSource ?? ""), "advanceToken": .string(advance?.orderToken ?? ""),
            "correction": .object(correction),
        ])
    }

    /// Wystawienie; `id` nowej faktury albo `nil` (komunikat w formularzu).
    func submit() async -> String? {
        if isCorrective && originalLoading { problem = "Poczekaj na odczyt faktury pierwotnej, danych stron i numeru KSeF."; return nil }
        if companyLoading { problem = "Poczekaj na wczytanie działalności przypisanej do wydarzenia."; return nil }
        if !isNextAdvance && !isCorrective && itemSourcesLoading { problem = "Poczekaj na wczytanie źródeł pozycji i kwot wydarzenia."; return nil }
        if isNextAdvance && (advance == nil || advanceError != nil) { problem = advanceError ?? "Poczekaj na wczytanie zamówienia i wcześniejszych zaliczek."; return nil }
        guard let workspace, let api else { return nil }
        guard workspace.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        problem = nil
        saving = true
        defer { saving = false }
        do {
            let data = try await api.post("/finance", ["op": .string("invoiceCreate"), "form": formJSON])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Faktura została utworzona")
            if let warning = reply["warning"]?.text.nonEmpty { workspace.notice = warning }
            return reply["id"]?.text.nonEmpty
        } catch {
            problem = failureText(error, "Błąd podczas tworzenia faktury")
            return nil
        }
    }
}

extension Workspace {
    /// Faktura w Finansach → Faktury (rejestr sprzedaży, karta po prawej); bez dostępu do Finansów — karta w CRM.
    func showInvoice(_ id: String) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/invoices" }) else {
            openCRM("/crm/invoices/\(id)")
            return
        }
        showFinance(.invoices)
        finance.bank.selectedInvoice = id
        Task { await finance.bank.loadInvoices(force: true) }
    }
}
