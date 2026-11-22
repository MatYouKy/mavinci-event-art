import SwiftUI

// MARK: „Wystaw fakturę” — natywny odpowiednik `/crm/invoices/new` w arkuszu: faktura VAT, proforma, zaliczkowa, kolejna
// zaliczka, korekta kwot i korekta danych nabywcy / odbiorcy. Kolejność pól, teksty i reguły jak w CRM; serwer sprawdza
// formularz i zapisuje fakturę tą samą funkcją bazy. Po wystawieniu otwiera się karta faktury w Finansach.

@MainActor struct InvoiceFormSheet: View {
    let request: InvoiceFormRequest
    var onCreated: ((String) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: InvoiceFormModel
    @State private var addingBuyer = false
    @State private var itemsExpanded = true
    /// Tytuł ze znakiem procentu — jako zwykły tekst (bez interpretacji jako klucz lokalizacji).
    private static let proformaLabel: String = "Wysokość proformy (%)"

    init(request: InvoiceFormRequest, onCreated: ((String) -> Void)? = nil) {
        self.request = request
        self.onCreated = onCreated
        _model = StateObject(wrappedValue: InvoiceFormModel(request: request, workspace: nil))
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(InvoiceFormText.title(model.type, nextAdvance: model.isNextAdvance)).font(.title2.bold())
                if let company = model.company { Text(company.legalName.isEmpty ? company.name : company.legalName).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            content
            footer
        }
        .frame(minWidth: 860, idealWidth: 1000, minHeight: 720, idealHeight: 920)
        .background(theme.page)
        .overlay { if model.saving { PendingOverlay(text: "Wystawianie faktury…") } }
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
        if model.setup == nil {
            if let error = model.loadError {
                ContentUnavailableView {
                    Label("Nie można wystawić faktury", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await model.load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Sprawdzanie uprawnień do wystawienia faktury…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            Form {
                if model.isNextAdvance { advanceSection }
                if !model.isCorrective { privateSection }
                companySection
                typeSection
                if model.isCorrective { correctionSection }
                partiesSections
                datesSection
                if !model.isCorrective { noteSection }
                if model.type == "proforma" { proformaSection }
                if model.type == "advance" { advancePercentSection }
                if !model.isPartyData { itemsSection }
                if model.isPartyData, let original = model.original { partyAmountsSection(original) }
                if !model.isPartyData { summarySection }
            }
            .formStyle(.grouped)
            .disabled(model.saving)
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let problem = model.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(4).textSelection(.enabled)
            }
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
            Button {
                Task {
                    if let id = await model.submit() {
                        dismiss()
                        if let onCreated { onCreated(id) } else { state.showInvoice(id) }
                    }
                }
            } label: {
                Label(model.saving ? "Zapisywanie..." : model.isPartyData ? "Zapisz korektę danych" : "Wystaw fakturę", systemImage: "square.and.arrow.down")
            }
            .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            .disabled(!model.canSubmit || model.setup == nil)
        }
        .padding(16)
    }

    // MARK: Kolejna zaliczka
    private var advanceSection: some View {
        Section {
            if let error = model.advanceError {
                Text(error).foregroundStyle(.orange)
            } else if let advance = model.advance {
                Text("Kolejna zaliczka do zamówienia z faktury \(advance.sourceNumber ?? "").")
                Text("Wcześniejsze zaliczki i szkice: \(InvoiceMath.money(advance.reservedGross ?? 0, model.currency)) · Pozostało: \(InvoiceMath.money(advance.remainingGross ?? 0, model.currency))")
                    .foregroundStyle(Color.accentColor)
                Text("Wpisz procent tej zaliczki. Dane zamówienia i nabywcy są zachowane; potwierdzenie płatności dotyczy wyłącznie nowej zaliczki.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView("Wczytywanie zamówienia i wcześniejszych zaliczek…")
            }
        }
    }

    // MARK: Osoba prywatna, firma, typ i numer
    private var privateSection: some View {
        Section {
            Toggle(isOn: Binding(get: { model.privatePerson }, set: { on in Task { await model.setPrivate(on) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Faktura dla osoby prywatnej")
                    Text("Użyj, gdy nabywca jest osobą indywidualną bez NIP.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(model.isNextAdvance || (!model.eventID.isEmpty && model.billingArrangement != "direct"))
        }
    }

    private var companySection: some View {
        Section {
            Picker("Firma wystawiająca fakturę *", selection: Binding(get: { model.companyID }, set: { id in
                Task { await model.selectCompany(id) }
                model.companyMessage = nil
            })) {
                Text("Wybierz firmę...").tag("")
                ForEach(model.companies) { company in
                    Text("\(company.name) - NIP: \(company.nip)\(company.isDefault ? " (domyślna)" : "")").tag(company.id)
                }
            }
            .disabled(model.companyLoading || model.isNextAdvance || (model.isCorrective && !model.relatedID.isEmpty))
            if model.companyLoading {
                Text("Wczytywanie działalności przypisanej do eventu…").font(.caption).foregroundStyle(.secondary)
            } else if let message = model.companyMessage {
                Text(message).font(.caption).foregroundStyle(.orange)
            } else if !model.isNextAdvance && !model.isCorrective, let event = model.linkedEvent, !event.companyId.isEmpty, model.companyID == event.companyId {
                Text("Działalność przypisana do eventu: \(event.name).").font(.caption).foregroundStyle(.secondary)
            }
            if !model.companyLoading, let event = model.linkedEvent, !model.companyID.isEmpty, !model.isCorrective, model.companyID != event.companyId {
                Text(model.type == "proforma" ? "Pro forma nie zmieni firmy eventu. Zdecyduje wystawiona na jej podstawie faktura."
                     : "Po wystawieniu faktury firma eventu zostanie zmieniona na \(model.company?.name ?? ""). Sam zapis szkicu nie zmienia przypisania.")
                    .font(.caption).foregroundStyle(Color.accentColor)
            }
            if model.isCorrective && !model.relatedID.isEmpty {
                Text("Firma wystawiająca została pobrana z faktury korygowanej").font(.caption).foregroundStyle(.orange)
            }
            if let company = model.company, !company.missing.isEmpty {
                Text("Brakuje danych firmy wystawiającej: \(company.missing.joined(separator: ", ")). Uzupełnij je w Ustawieniach > Moje firmy.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
    }

    private var typeSection: some View {
        Section {
            Picker("Typ faktury *", selection: Binding(get: { model.type }, set: { next in Task { await model.changeType(next) } })) {
                ForEach(InvoiceFormText.types, id: \.0) { Text($0.1).tag($0.0) }
            }
            .disabled(model.isNextAdvance || model.urlRelated)
            HStack(spacing: 8) {
                TextField("Numer faktury *", text: Binding(get: { model.number }, set: { model.editNumber($0) }), prompt: Text("FV/001/2026"))
                    .disabled(model.companyID.isEmpty)
                Button { Task { await model.peekNumber() } } label: {
                    if model.numberLoading { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
                }
                .disabled(model.numberLoading || model.companyID.isEmpty)
                .help("Wygeneruj następny numer")
            }
            .task(id: "\(model.companyID)|\(model.number)") { await model.checkNumber() }
            VStack(alignment: .leading, spacing: 2) {
                if model.numberExists {
                    Text("Numer już istnieje — ten numer faktury jest już użyty dla wybranej działalności.").foregroundStyle(.red)
                } else if model.numberGenerated {
                    Text("Automatycznie wygenerowany").foregroundStyle(.green)
                }
                Text("Typ: \(InvoiceFormText.numberType(model.type))")
                if model.companyID.isEmpty { Text("Najpierw wybierz firmę wystawiającą fakturę.").foregroundStyle(.orange) }
                if model.numberChecking { Text("Sprawdzam dostępność numeru...") }
                if !model.numberExists { Text("Numer jest sprawdzany osobno dla wybranej działalności.") }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Korekta
    private var correctionSection: some View {
        Section("Dane faktury korygowanej") {
            Picker("Wybierz fakturę do korekty *", selection: Binding(get: { model.relatedID }, set: { id in Task { await model.selectOriginal(id) } })) {
                Text("Wybierz fakturę...").tag("")
                if !model.relatedID.isEmpty && !(model.setup?.correctable ?? []).contains(where: { $0.id == model.relatedID }) {
                    Text(model.original?.number ?? "Wybrana faktura").tag(model.relatedID)
                }
                ForEach(model.setup?.correctable ?? []) { invoice in
                    Text("\(invoice.number) - \(invoice.buyerName) (\(InvoiceMath.money(invoice.gross, "PLN"))) - \(InvoiceFormText.correctableType(invoice.type))").tag(invoice.id)
                }
            }
            .disabled(model.urlRelated && model.original != nil)
            if model.originalLoading { ProgressView("Odczyt faktury pierwotnej…").controlSize(.small) }
            if let original = model.original {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                    GridRow {
                        LabeledContent("Nr faktury korygowanej:", value: original.number)
                        LabeledContent("Data wystawienia:", value: InvoiceFormText.plDate(original.issueDate))
                    }
                    GridRow {
                        LabeledContent("Nr KSeF:", value: original.ksefNumber ?? "Nie wysłano do KSeF")
                        LabeledContent("W KSeF:") { Text(original.wasInKsef ? "Tak" : "Nie").foregroundStyle(original.wasInKsef ? Color.green : Color.secondary) }
                    }
                }
                .font(.callout)
            }
            Picker("Co chcesz skorygować?", selection: Binding(get: { model.correctionKind }, set: { model.changeCorrectionKind($0) })) {
                Text("Pozycje lub kwoty faktury").tag("amount")
                Text("Dane nabywcy / odbiorcy — bez zmiany kwot").tag("party_data")
            }
            if model.isPartyData {
                Text("Popraw nazwę i adres tego samego podatnika lub dane odbiorcy. Nie zerujemy faktury pierwotnej i nie tworzymy nowej należności.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Picker("Zakres korekty *", selection: $model.correctionScope) {
                    Text("Całość faktury").tag("full")
                    Text("Część faktury").tag("partial")
                }
                .pickerStyle(.radioGroup).horizontalRadioGroupLayout()
                Picker("Skutek korekty w ewidencji VAT *", selection: $model.correctionType) {
                    ForEach(InvoiceFormText.correctionTypes, id: \.0) { Text($0.1).tag($0.0) }
                }
            }
            TextField("Przyczyna korekty *", text: $model.correctionReason, prompt: Text("np. Zmiana ceny usługi, Błąd w ilości, Rabat potransakcyjny..."), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    // MARK: Strony
    @ViewBuilder private var partiesSections: some View {
        if !model.eventID.isEmpty, let event = model.linkedEvent, !model.isNextAdvance, !model.isCorrective { billingSection(event) }
        if !model.eventID.isEmpty, let group = model.settlementGroup, group.events.count > 1 { groupSection(group) }
        Section("Nabywca") {
            buyerContent
            if let link = model.buyerLink, link.unitOrganizationId == model.organizationID, !model.privatePerson {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Faktury za \(model.selectedOrganization?.name ?? "tę organizację") wystawiamy na \(link.buyer.name)\(link.role == 8 ? " (JST) — ta jednostka będzie odbiorcą." : " — ta organizacja będzie odbiorcą.")")
                    Button("Ustaw \(link.buyer.alias.isEmpty ? link.buyer.name : link.buyer.alias) jako nabywcę") { Task { await model.applyBuyerLink() } }
                        .controlSize(.small)
                }
                .padding(8)
                .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        Section("Odbiorca na fakturze i w KSeF") {
            InvoiceRecipientEditorView(model: model, disabled: model.saving || (model.isCorrective && !model.isPartyData && !model.relatedID.isEmpty))
            if let error = model.recipientPrefillError { Text(error).font(.caption).foregroundStyle(Color.accentColor) }
        }
        if !model.buyerPreviewName.isEmpty { previewSection }
        if model.isPartyData, let original = model.original {
            Section {
                InvoicePartyComparison(beforeBuyer: original.correctedBuyer, afterBuyer: model.correctedBuyer,
                                       beforeRecipient: model.originalRecipient.flatMap { $0.mode == "same_as_buyer" ? nil : $0.data },
                                       afterRecipient: model.recipient.mode == "same_as_buyer" ? nil : model.recipient.data)
                Toggle("Sprawdziłem dane przed i po korekcie. Nabywca pozostaje tym samym podatnikiem, a kwoty faktury pierwotnej nie ulegają zmianie.", isOn: $model.partyConfirmed)
                    .toggleStyle(.checkbox)
            }
        }
        if model.buyerDiffersFromEvent {
            Section {
                Text("Nabywca zapisany w rozliczeniu eventu: \(model.organizations.first(where: { $0.id == model.expectedEventBuyerID })?.name ?? "inna organizacja niż wybrana powyżej").")
                Toggle("Potwierdzam, że na tej fakturze nabywcą ma być wybrana powyżej osoba lub organizacja. Odbiorca nie zastępuje nabywcy.", isOn: $model.buyerOverrideConfirmed)
                    .toggleStyle(.checkbox)
            }
        }
        if !model.privatePerson && !model.organizationID.isEmpty && model.urlEventID == nil && !model.isNextAdvance && !model.isCorrective { relatedEventSection }
    }

    @ViewBuilder private var buyerContent: some View {
        if let advance = model.advance, let buyer = advance.buyer {
            VStack(alignment: .leading, spacing: 2) {
                Text(buyer.name).fontWeight(.medium)
                Text("\(buyer.nip.isEmpty ? "" : "NIP: \(buyer.nip) · ")\(buyer.street), \(buyer.postalCode) \(buyer.city)").font(.caption).foregroundStyle(.secondary)
                if let event = model.linkedEvent { Text("Event: \(event.name)").font(.caption).foregroundStyle(.secondary) }
            }
        } else if model.isPartyData, let original = model.original {
            InvoiceBuyerCorrectionView(model: model, originalNip: original.buyer.nip)
        } else if model.isCorrective && !model.relatedID.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text("Nabywca *").font(.caption).foregroundStyle(.secondary)
                Text(model.selectedOrganization?.name.nonEmpty ?? "Nabywca z faktury korygowanej").fontWeight(.medium)
                if !model.buyerPreviewAddress.isEmpty { Text(model.buyerPreviewAddress).font(.caption).foregroundStyle(.secondary) }
                if let nip = model.selectedOrganization?.nip, !nip.isEmpty { Text("NIP: \(nip)").font(.caption).foregroundStyle(.secondary) }
                Text("W korekcie kwot dane stron pozostają takie jak na fakturze pierwotnej. Aby poprawić nazwę lub adres, wybierz powyżej korektę danych.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else if model.privatePerson {
            InvoicePrivateBuyerFields(model: model)
        } else {
            InvoiceBuyerPicker(model: model) { addingBuyer = true }
        }
    }

    private func billingSection(_ event: InvoiceFormEvent) -> some View {
        let indirect = model.billingArrangement != "direct"
        let jst = model.eventJstLink.map(\.buyer.name)
        let recipientName = model.organizations.first { $0.id == model.serviceRecipientOrganizationID }?.name
        let payer = model.organizations.first { $0.id == model.organizationID }?.name
        return Section {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ROZLICZENIE EVENTU").font(.caption2).foregroundStyle(.secondary)
                    Text(event.name).fontWeight(.medium)
                    Text([recipientName, event.date.map { InvoiceFormText.plDate($0) }].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if !indirect, let jst { Label("Nabywca: \(jst)", systemImage: "building.2").font(.caption).foregroundStyle(.blue) }
                if indirect, let payer { Label("Płatnik: \(payer)", systemImage: "building.2").font(.caption).foregroundStyle(.blue) }
            }
            Picker("Kto opłaca event?", selection: Binding(get: { model.billingArrangement }, set: { value in Task { await model.changeBilling(value) } })) {
                ForEach(InvoiceFormText.arrangements, id: \.0) { Text($0.1).tag($0.0) }
            }
            Text(!indirect && jst != nil
                 ? "Klient eventu jest rozliczany na \(jst ?? "") (karta klienta → Dane do faktury): nabywcą będzie \(jst ?? ""), a klient odbiorcą faktury."
                 : InvoiceFormText.arrangementDescription(model.billingArrangement))
                .font(.caption).foregroundStyle(.secondary)
            if indirect { Text("Poniżej wybierz organizację, której dane mają znaleźć się na fakturze.").font(.caption.weight(.medium)).foregroundStyle(.blue) }
        }
    }

    private func groupSection(_ group: InvoiceSettlementGroup) -> some View {
        Section {
            Label("Faktura wspólna: \(group.name)", systemImage: "link").fontWeight(.medium)
            Text("Dokument zostanie automatycznie pokazany i rozliczony w poniższych eventach. Operacyjnie pozostają one osobnymi realizacjami.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(group.events) { member in
                VStack(alignment: .leading, spacing: 1) {
                    Text(member.name).font(.callout)
                    Text("\(member.date.map { InvoiceFormText.plDate($0) } ?? "Termin nieustalony")\(member.id == group.primaryEventId ? " · event główny" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var previewSection: some View {
        let recipient = model.recipient
        let recipientAddress = [recipient.data.street, [recipient.data.postalCode, recipient.data.city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }.joined(separator: ", ")
        return Section {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("NABYWCA NA FAKTURZE I W KSEF").font(.caption2.weight(.semibold)).foregroundStyle(Color.accentColor)
                    Text(model.buyerPreviewName).fontWeight(.medium)
                    Text(model.buyerPreviewAddress.isEmpty ? "Brak adresu" : model.buyerPreviewAddress).font(.caption).foregroundStyle(.secondary)
                    if !model.privatePerson { Text("NIP: \(model.selectedOrganization?.nip.nonEmpty ?? "nie podano")").font(.caption).foregroundStyle(.secondary) }
                    if recipient.mode != "same_as_buyer" && recipient.data.role == 8 {
                        Text("JST — w KSeF z oznaczeniem jednostki samorządu").font(.caption).foregroundStyle(Color.accentColor)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ODBIORCA NA FAKTURZE I W KSEF").font(.caption2.weight(.semibold)).foregroundStyle(Color.accentColor)
                    if recipient.mode == "same_as_buyer" {
                        Text(model.buyerPreviewName).fontWeight(.medium)
                        Text(model.buyerPreviewAddress.isEmpty ? "Brak adresu" : model.buyerPreviewAddress).font(.caption).foregroundStyle(.secondary)
                        Text("Ten sam podmiot — bez osobnego odbiorcy w XML.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(recipient.data.name.isEmpty ? "Uzupełnij odbiorcę" : recipient.data.name).fontWeight(.medium)
                        Text(recipientAddress.isEmpty ? "Brak adresu" : recipientAddress).font(.caption).foregroundStyle(.secondary)
                        if !recipient.data.nip.isEmpty { Text("NIP: \(recipient.data.nip)").font(.caption).foregroundStyle(.secondary) }
                        if recipient.data.role == 8 { Text("Jednostka podrzędna JST (rola 8)").font(.caption).foregroundStyle(Color.accentColor) }
                        if !recipient.data.internalId.isEmpty { Text("IDWew KSeF: \(recipient.data.internalId)").font(.caption).foregroundStyle(Color.accentColor) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var relatedEventSection: some View {
        Section {
            Picker("Powiązany event", selection: Binding(get: { model.eventID }, set: { id in Task { await model.loadEvent(id, initial: false) } })) {
                Text("Brak powiązanego eventu").tag("")
                ForEach(model.organizationEvents) { event in
                    Text(Self.eventLabel(event)).tag(event.id)
                }
                if !model.eventID.isEmpty && !model.organizationEvents.contains(where: { $0.id == model.eventID }) {
                    Text(model.linkedEvent?.name ?? "Wybrany event").tag(model.eventID)
                }
            }
            Text("Jeśli wybierzesz event, PDF faktury zapisze się również w plikach tego eventu.").font(.caption).foregroundStyle(.secondary)
        }
    }

    /// „{nazwa} - {data}” jak lista wydarzeń w CRM.
    private static func eventLabel(_ event: InvoiceFormEvent) -> String {
        guard let date = event.date else { return event.name }
        return event.name + " - " + InvoiceFormText.plDate(date)
    }

    // MARK: Daty i płatność
    private func day(_ value: Binding<String>) -> Binding<Date> {
        Binding(get: { FinanceText.dayDate(value.wrappedValue) ?? Date() }, set: { value.wrappedValue = FinanceText.dayString($0) })
    }

    private var datesSection: some View {
        Section {
            DatePicker("Data wystawienia *", selection: day($model.issueDate), displayedComponents: .date)
            DatePicker("Data sprzedaży *", selection: day($model.saleDate), displayedComponents: .date).disabled(model.isPartyData)
            if !model.isPartyData {
                Picker("Sposób płatności *", selection: $model.paymentMethod) {
                    ForEach(InvoiceFormText.paymentMethods, id: \.self) { Text($0).tag($0) }
                }
                Toggle(isOn: Binding(get: { model.isPaid }, set: { on in
                    model.isPaid = on
                    if on && model.paidDate.isEmpty { model.paidDate = model.issueDate }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Faktura opłacona")
                        Text("Po zaznaczeniu status faktury zostanie ustawiony jako opłacona, a do zapłaty będzie 0 \(model.currencyLabel).").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                if model.isPaid { DatePicker("Data opłacenia *", selection: day($model.paidDate), displayedComponents: .date) }
                if !model.isCashPayment {
                    TextField("Termin płatności (dni od wystawienia) *", text: $model.paymentDays)
                    LabeledContent("Data płatności", value: model.dueDate.map { FinanceText.day($0) } ?? "Podaj poprawną liczbę dni i datę wystawienia")
                } else {
                    LabeledContent("Status płatności") { Text("Zapłacono w dniu wystawienia (\(model.paymentMethod))").foregroundStyle(.green) }
                }
            }
        }
    }

    private var noteSection: some View {
        Section {
            Toggle(isOn: Binding(get: { model.includeNote }, set: { model.setIncludeNote($0) })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dodaj adnotacje do faktury")
                    Text("Treść zostanie zapisana na fakturze, pokazana w PDF i może zostać przekazana do KSeF.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox)
            if model.includeNote {
                TextField("Adnotacje / nota płatnicza", text: $model.note, prompt: Text("Np. Niniejsza faktura jest wezwaniem do zapłaty..."), axis: .vertical)
                    .lineLimit(3...8)
            }
        }
    }

    private var proformaSection: some View {
        Section {
            LabeledContent(Self.proformaLabel) { InvoiceNumberField(title: "", value: $model.proformaPercent, width: 120).textFieldStyle(.roundedBorder) }
            Text(verbatim: "Procent pełnej wartości pozycji poniżej, pobranych z eventu lub dodanych ręcznie. Np. 50% automatycznie przelicza kwoty netto, VAT i brutto proformy.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var advancePercentSection: some View {
        Section {
            LabeledContent(model.isNextAdvance ? "Procent tej zaliczki *" : "Wysokość zaliczki *") {
                HStack(spacing: 4) { InvoiceNumberField(title: "", value: $model.advancePercent, width: 120).textFieldStyle(.roundedBorder); Text(verbatim: "%") }
            }
            Text("Pozycje poniżej opisują pełne zamówienie. Na fakturze zaliczkowej kwoty zostaną proporcjonalnie ograniczone do wskazanego procentu, a pełna wartość zamówienia pozostanie zapisana osobno dla KSeF i faktury końcowej.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Pozycje
    private var itemsSection: some View {
        Section {
            if !model.isCorrective && !model.isNextAdvance { sourcePicker }
            if !model.isCorrective && model.isNextAdvance {
                Text("Pozycje i ich nazwy są dziedziczone z zapisanego zamówienia poprzedniej zaliczki. Własna pozycja zbiorcza pozostaje jedną pozycją — nie zastępujemy jej listą z kalkulacji. Ustaw tylko kwotę nowej zaliczki.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if !model.isCorrective, let pricing = model.acceptedPricing {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Źródło cen: \(pricing.label) — po rabatach.").fontWeight(.medium)
                    Text(Self.agreedAmount(pricing))
                    if !pricing.notice.isEmpty { Text(pricing.notice) }
                    Text("Rabat jest już uwzględniony w cenach pozycji — nie odejmuj go ponownie. Ręczne zmiany pozycji zmienią kwotę faktury.").foregroundStyle(.secondary)
                }
                .font(.caption).foregroundStyle(.green)
            }
            if !model.isCorrective, let error = model.pricingError { Text(error).font(.caption).foregroundStyle(.orange) }
            if model.isCorrective && !model.correctionLines.isEmpty {
                Text("Edytuj kolumnę „Po korekcie”, aby zmienić wartości. Kolumna „Przed” jest tylko do odczytu. Różnica zostanie obliczona automatycznie.")
                    .font(.caption).foregroundStyle(.orange)
            }
            if !model.isCorrective && !model.isNextAdvance { presentationPicker }
            if model.isCorrective {
                ForEach(model.correctionLines) { line in InvoiceCorrectionRow(model: model, line: line) }
            } else {
                DisclosureGroup(isExpanded: $itemsExpanded) {
                    ForEach(model.items) { item in InvoiceItemRow(model: model, item: item, disabled: model.isNextAdvance) }
                } label: {
                    Text(model.simplified ? "Podstawa kwoty — pozycje źródłowe, niewidoczne osobno na fakturze" : "Pozycje i kwoty do sprawdzenia")
                }
            }
        } header: {
            HStack {
                Text(model.isCorrective ? "Pozycje korekty" : model.isNextAdvance ? "Pełne zamówienie" : "Pozycje faktury")
                Spacer()
                if !model.isCorrective && !model.isNextAdvance {
                    Button { model.addItem() } label: { Label("Dodaj pozycję", systemImage: "plus") }.buttonStyle(.borderless)
                }
            }
        }
    }

    /// „Uzgodniona kwota: … netto · … brutto · rabat całej oferty: … netto.”
    private static func agreedAmount(_ pricing: InvoiceItemSource) -> String {
        var text = "Uzgodniona kwota: " + InvoiceMath.money(pricing.net, "PLN") + " netto · " + InvoiceMath.money(pricing.gross, "PLN") + " brutto"
        if pricing.discount > 0 { text += " · rabat całej oferty: " + InvoiceMath.money(pricing.discount, "PLN") + " netto" }
        return text + "."
    }

    @ViewBuilder private var sourcePicker: some View {
        Picker("Podstawa pozycji i kwot zamówienia", selection: Binding(get: { model.itemSource }, set: { model.selectSource($0) })) {
            ForEach(["calculation", "offer"], id: \.self) { id in
                if let source = model.itemSources.first(where: { $0.id == id }) {
                    Text("\(source.label) — \(InvoiceMath.plain(source.net)) netto / \(InvoiceMath.plain(source.gross)) \(model.currency) brutto\(model.preferredSource == id ? " · źródło eventu" : "")").tag(id)
                }
            }
            Text("Pozycje i kwoty wprowadzone ręcznie").tag("manual")
        }
        .disabled(model.itemSourcesLoading)
        if model.itemSourcesLoading {
            Text("Kalkulacja i oferta — wczytywanie…").font(.caption).foregroundStyle(.secondary)
        } else {
            ForEach(["calculation", "offer"].filter { id in !model.itemSources.contains { $0.id == id } }, id: \.self) { id in
                Text("\(id == "calculation" ? "Kalkulacja" : "Oferta") — \(model.eventID.isEmpty ? "najpierw wybierz event" : "brak dostępnego zaakceptowanego źródła")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        Text("Domyślnie korzystamy ze źródła finansowego eventu po rabatach. Wybór innego źródła zastępuje bieżące pozycje i kwoty — ich podsumowanie widzisz przy każdej opcji. Nie zmienia to ustawień eventu.")
            .font(.caption).foregroundStyle(.secondary)
        if model.itemSource != "manual", let preferred = model.preferredSource, model.itemSource != preferred {
            Text("Wybrano inne źródło niż finansowe źródło eventu. Sprawdź kwotę zamówienia przed wystawieniem.").font(.caption).foregroundStyle(.orange)
        }
        if model.itemSource == "manual" {
            Text("Zachowano bieżące pozycje do edycji. Ich kwoty nie są automatycznie zastępowane danymi z katalogu.").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var presentationPicker: some View {
        Picker("Pozycje widoczne na fakturze", selection: $model.simplified) {
            Text("Pozycje szczegółowe").tag(false)
            Text("Własna pozycja zbiorcza").tag(true)
        }
        .pickerStyle(.radioGroup).horizontalRadioGroupLayout()
        Text("Wybrany układ i wpisane przez Ciebie nazwy zostaną zapisane z zamówieniem. Faktura końcowa odziedziczy je z zaliczki.")
            .font(.caption).foregroundStyle(.secondary)
        if model.simplified {
            TextField("Własna nazwa pozycji na fakturze *", text: $model.simplifiedName, prompt: Text("Np. Obsługa techniczna konferencji zgodnie z zamówieniem"))
            Text("Ta nazwa zastąpi nazwy źródłowe, także gdy źródło zawiera tylko jedną pozycję. Kwoty pochodzą z pozycji poniżej.").font(.caption).foregroundStyle(.secondary)
            if let error = InvoiceMath.combinedError(model.items) { Text(error).font(.caption).foregroundStyle(.orange) }
        }
    }

    // MARK: Kwoty
    private func partyAmountsSection(_ original: InvoiceOriginal) -> some View {
        Section("Kwoty pozostają bez zmian") {
            Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 4) {
                GridRow {
                    Text("Rozliczenie").gridColumnAlignment(.leading)
                    Text("Netto"); Text("VAT"); Text("Brutto")
                }
                .font(.caption).foregroundStyle(.secondary)
                GridRow {
                    Text("Faktura pierwotna \(original.number)").gridColumnAlignment(.leading)
                    Text(InvoiceMath.money(original.totals.net, original.currency))
                    Text(InvoiceMath.money(original.totals.vat, original.currency))
                    Text(InvoiceMath.money(original.totals.gross, original.currency))
                }
                GridRow {
                    Text("Zmiana kwot wskutek tej korekty").gridColumnAlignment(.leading)
                    Text(InvoiceMath.money(0, original.currency)); Text(InvoiceMath.money(0, original.currency)); Text(InvoiceMath.money(0, original.currency))
                }
                .foregroundStyle(Color.accentColor)
            }
            .monospacedDigit()
            Text("Kwoty powyżej służą wyłącznie kontroli. Korekta danych nie stanowi nowego żądania zapłaty, zwrotu ani potwierdzenia opłacenia faktury pierwotnej.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var summarySection: some View {
        Section(model.isCorrective ? "Kwota korekty" : "Podsumowanie") {
            if model.isCorrective {
                let sums = model.correctionTotals
                let afterNet: Double = sums.before.0 + sums.delta.0
                let afterVat: Double = sums.before.1 + sums.delta.1
                totalsRow([("Przed korektą - netto", sums.before.0), ("Przed korektą - VAT", sums.before.1), ("Przed korektą - brutto", sums.before.2)], color: .secondary)
                totalsRow([("Korekta netto", sums.delta.0), ("Korekta VAT", sums.delta.1), ("Korekta brutto", sums.delta.2)], signed: true)
                totalsRow([("Po korekcie - netto", afterNet), ("Po korekcie - VAT", afterVat), ("Po korekcie - brutto", afterNet + afterVat)], color: .orange)
            } else {
                let totals = model.totals
                let shown = model.percentTotals ?? totals
                if let percent = model.percentTotals {
                    let label: String = (model.type == "proforma" ? "Kwota proformy brutto" : "Kwota tej zaliczki brutto")
                        + " (" + InvoiceMath.plain(model.type == "proforma" ? model.proformaPercent : model.advancePercent) + "%)"
                    HStack {
                        LabeledContent("Pełna wartość zamówienia brutto", value: InvoiceMath.money(totals.gross, model.currency))
                        LabeledContent(label, value: InvoiceMath.money(percent.gross, model.currency))
                    }
                }
                if model.simplified && InvoiceMath.combinedError(model.items) == nil {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Pozycja, która zostanie zapisana na fakturze:").font(.caption.weight(.medium)).foregroundStyle(Color.accentColor)
                        Text("1. \(model.simplifiedName.nonEmpty ?? "Wpisz nazwę pozycji") — \(InvoiceMath.money(shown.net, model.currency)) netto")
                        Text(model.type == "advance" ? "Faktura końcowa odziedziczy tę nazwę i pełną wartość zamówienia; odliczy zaliczki w rozliczeniu."
                             : "Nazwy źródłowe nie zostaną dodane jako osobne pozycje faktury.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                totalsRow([("Suma netto", shown.net), ("Suma VAT", shown.vat), ("Suma brutto", shown.gross)])
            }
            if model.isPaid {
                Text("Faktura opłacona. Do zapłaty: \(InvoiceMath.money(0, model.currency))").foregroundStyle(.green)
            }
        }
    }

    private func totalsRow(_ values: [(String, Double)], color: Color = .primary, signed: Bool = false) -> some View {
        HStack(alignment: .top) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                VStack(alignment: .leading, spacing: 2) {
                    Text(value.0).font(.caption).foregroundStyle(.secondary)
                    Text(InvoiceMath.money(value.1, model.currency)).font(.title3).monospacedDigit()
                        .foregroundStyle(signed ? (value.1 < 0 ? Color.red : value.1 > 0 ? Color.green : color) : color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
