import SwiftUI

// MARK: Części formularza faktury — jak komponenty `/crm/invoices/new`: wybór nabywcy (`BuyerSearchInput`), osoba prywatna,
// odbiorca KSeF (`InvoiceRecipientEditor`), nabywca po korekcie danych (`InvoiceBuyerCorrectionEditor`), porównanie przed / po
// (`InvoicePartyCorrectionComparison`), pozycje faktury i pozycje korekty.

/// Pole kwoty / ilości (przecinek lub kropka), puste pole = 0. Wartość trafia do formularza przy każdym znaku — także gdy
/// zaraz potem klikniesz „Wystaw fakturę” bez zatwierdzania pola klawiszem Return.
struct InvoiceNumberField: View {
    let title: String
    @Binding var value: Double
    var width: CGFloat? = nil
    @State private var text = ""
    @FocusState private var focused: Bool

    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 4
        return formatter
    }()
    private static func display(_ value: Double) -> String { formatter.string(from: NSNumber(value: value)) ?? String(value) }

    var body: some View {
        TextField(title, text: $text)
            .multilineTextAlignment(.trailing)
            .frame(width: width)
            .focused($focused)
            .onAppear { text = Self.display(value) }
            .onChange(of: text) { _, next in
                // Tylko wpisywanie przez użytkownika — wyświetlenie wartości nie może jej zaokrąglić.
                guard focused else { return }
                let input = next.trimmingCharacters(in: .whitespaces)
                if input.isEmpty {
                    if value != 0 { value = 0 }
                } else if let parsed = InvoiceMath.number(input), parsed.isFinite, parsed != value {
                    value = parsed
                }
            }
            .onChange(of: value) { _, next in
                if !focused || InvoiceMath.number(text) != next { text = Self.display(next) }
            }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { text = Self.display(value) }
            }
    }
}

// MARK: Nabywca — organizacja

@MainActor struct InvoiceBuyerPicker: View {
    @ObservedObject var model: InvoiceFormModel
    let addNew: () -> Void
    @State private var query = ""

    var body: some View {
        let selected = model.organizations.first { $0.id == model.organizationID }
        VStack(alignment: .leading, spacing: 6) {
            Text("Nabywca *").font(.callout)
            if let selected {
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
                .padding(8)
                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            } else {
                TextField("Wyszukaj nabywcę po nazwie, NIP lub mieście...", text: $query).textFieldStyle(.roundedBorder)
                Button(action: addNew) {
                    Label("Dodaj nowego nabywcę — wprowadź dane ręcznie lub pobierz z GUS", systemImage: "plus.circle")
                }
                .buttonStyle(.link)
                let terms = query.trimmingCharacters(in: .whitespaces).lowercased()
                let found = model.organizations.filter { terms.isEmpty || $0.name.lowercased().contains(terms) || $0.nip.lowercased().contains(terms) || $0.city.lowercased().contains(terms) }
                if found.isEmpty {
                    Text("Nie znaleziono kontaktów. Spróbuj wyszukać inaczej lub dodaj nowego nabywcę").font(.caption).foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            ForEach(found.prefix(80)) { org in
                                Button { query = ""; Task { await model.selectBuyer(org.id) } } label: {
                                    HStack(spacing: 8) {
                                        Text(org.name).lineLimit(1)
                                        if !org.nip.isEmpty { Text("NIP: \(org.nip)").font(.caption).foregroundStyle(.secondary) }
                                        if !org.city.isEmpty { Text(org.city).font(.caption).foregroundStyle(.secondary) }
                                        if org.clientType == "business" { Text("Firma").font(.caption2).foregroundStyle(Color.accentColor) }
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
                Text("Wpisz nazwę firmy, NIP lub miasto aby wyszukać kontakt").font(.caption).foregroundStyle(.secondary)
            }
            if let error = model.setup?.organizationsError { Text(error).font(.caption).foregroundStyle(.orange) }
        }
    }
}

// MARK: Nabywca — osoba prywatna

@MainActor struct InvoicePrivateBuyerFields: View {
    @ObservedObject var model: InvoiceFormModel
    @State private var search = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Osoba prywatna").font(.callout.weight(.medium))
            TextField("Szukaj osoby po imieniu, nazwisku, emailu, telefonie lub mieście...", text: $search).textFieldStyle(.roundedBorder)
            let terms = search.trimmingCharacters(in: .whitespaces).lowercased()
            if !terms.isEmpty {
                let found = (model.setup?.individuals ?? []).filter { contact in
                    [contact.name, contact.email, contact.phone, contact.city].filter { !$0.isEmpty }.joined(separator: " ").lowercased().contains(terms)
                }
                if found.isEmpty { Text("Brak wyników").font(.caption).foregroundStyle(.secondary) }
                ForEach(found.prefix(20)) { contact in
                    Button { model.selectIndividual(contact); search = contact.name } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(contact.name.isEmpty ? "Bez nazwy" : contact.name).fontWeight(.medium)
                            Text([contact.email, contact.phone, contact.city].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? "Brak danych kontaktowych")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 3).padding(.horizontal, 6)
                        .background(model.individualID == contact.id ? Color.accentColor.opacity(0.1) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
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
                    TextField("Ulica i numer *", text: $model.privateBuyer.street).gridCellColumns(2)
                }
                GridRow {
                    TextField("Kod pocztowy *", text: $model.privateBuyer.postalCode)
                    TextField("Miasto *", text: $model.privateBuyer.city)
                }
            }
            .textFieldStyle(.roundedBorder)
        }
    }
}

// MARK: Odbiorca na fakturze i w KSeF

/// Formularz, który ma odbiorcę KSeF (`InvoiceRecipientEditor`): wystawianie faktury i faktura z pro formy.
@MainActor protocol InvoiceRecipientHost: ObservableObject {
    var recipient: InvoiceRecipientDraft { get }
    var recipientLoading: Bool { get }
    var recipientLoadError: String? { get }
    var recipientOrganizations: [InvoiceRecipientOrganization] { get }
    func editRecipient(_ draft: InvoiceRecipientDraft)
    func loadRecipientOrganizations() async
    func selectRecipientOrganization(_ id: String, role: Int?) async
}

extension InvoiceFormModel: InvoiceRecipientHost {}

@MainActor struct InvoiceRecipientEditorView<Host: InvoiceRecipientHost>: View {
    @ObservedObject var model: Host
    let disabled: Bool
    @State private var search = ""

    private var draft: InvoiceRecipientDraft { model.recipient }
    private func field(_ key: WritableKeyPath<InvoiceRecipientDraft.Fields, String>, uppercase: Bool = false) -> Binding<String> {
        Binding(get: { model.recipient.data[keyPath: key] }, set: { value in
            var next = model.recipient
            next.data[keyPath: key] = uppercase ? value.uppercased() : value
            model.editRecipient(next)
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Nabywca i odbiorca są tacy sami", isOn: Binding(get: { draft.mode == "same_as_buyer" }, set: { on in
                model.editRecipient(on ? .same : .organization())
            }))
            .toggleStyle(.checkbox).fontWeight(.medium).disabled(disabled)
            if draft.mode == "same_as_buyer" {
                Text("Na fakturze będą dane nabywcy wybranego powyżej, bez osobnego odbiorcy.").font(.caption).foregroundStyle(.secondary)
            } else {
                details
            }
        }
        .task(id: draft.mode) { if draft.mode == "organization" && !disabled { await model.loadRecipientOrganizations() } }
    }

    @ViewBuilder private var details: some View {
        HStack {
            Text("Odbiorca — osobno od nabywcy").font(.callout.weight(.medium)).foregroundStyle(Color.accentColor)
            Spacer()
            Picker("Źródło danych", selection: Binding(get: { draft.mode }, set: { mode in
                var next = InvoiceRecipientDraft.same
                next.mode = mode
                model.editRecipient(next)
            })) {
                Text("Z organizacji CRM").tag("organization")
                Text("Wpisz ręcznie").tag("manual")
            }
            .fixedSize().disabled(disabled)
        }
        if draft.mode == "organization" && !disabled { organizationPicker }
        Picker("Rodzaj odbiorcy w KSeF", selection: Binding(get: { draft.data.role }, set: { role in
            var next = model.recipient
            next.data.role = role
            if role == 8 { next.data.internalId = "" }
            model.editRecipient(next)
        })) {
            Text("Odbiorca — oddział lub jednostka wewnętrzna nabywcy").tag(2)
            Text("Jednostka podrzędna JST — np. szkoła, przedszkole (nabywcą jest gmina)").tag(8)
        }
        .disabled(disabled || model.recipientLoading)
        if draft.data.role == 8 {
            Text("Nabywcą na fakturze jest JST (np. gmina) — w KSeF dostanie oznaczenie JST, a ta jednostka trafi jako odbiorca (rola 8) i zobaczy fakturę po swoim NIP-ie.")
                .font(.caption).foregroundStyle(.secondary)
        }
        if model.recipientLoading { Label("Wczytywanie danych odbiorcy…", systemImage: "hourglass").font(.caption).foregroundStyle(.secondary) }
        if let error = model.recipientLoadError { Text(error).font(.caption).foregroundStyle(.orange) }
        if draft.mode == "organization" && !draft.organizationId.isEmpty && !disabled && !model.recipientLoading {
            Button("Pobierz aktualne dane z CRM") { Task { await model.selectRecipientOrganization(draft.organizationId, role: nil) } }.controlSize(.small)
        }
        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
            GridRow { TextField("Nazwa odbiorcy *", text: field(\.name)).gridCellColumns(2) }
            GridRow {
                TextField(draft.data.role == 8 ? "NIP jednostki *" : "NIP odbiorcy — opcjonalnie", text: field(\.nip))
                if draft.data.role != 8 { TextField("IDWew KSeF — opcjonalnie", text: field(\.internalId)) } else { Color.clear.frame(height: 1) }
            }
            GridRow { TextField("Ulica i numer *", text: field(\.street)).gridCellColumns(2) }
            GridRow {
                TextField("Kod pocztowy *", text: field(\.postalCode))
                TextField("Miejscowość *", text: field(\.city))
            }
            GridRow { TextField("Kod kraju *", text: field(\.countryCode, uppercase: true)).frame(maxWidth: 120) }
        }
        .textFieldStyle(.roundedBorder)
        .disabled(disabled || model.recipientLoading)
        Text("Te dane odbiorcy zostaną zapisane przy fakturze i użyte w PDF oraz KSeF. Nie zastępują nabywcy. Edycja dotyczy tej faktury, nie karty organizacji.")
            .font(.caption).foregroundStyle(.secondary)
    }

    @ViewBuilder private var organizationPicker: some View {
        TextField("Szukaj organizacji — nazwa, NIP lub miejscowość", text: $search).textFieldStyle(.roundedBorder)
        let terms = search.trimmingCharacters(in: .whitespaces).lowercased()
        let visible = model.recipientOrganizations.filter { org in
            terms.isEmpty || org.id == draft.organizationId || [org.name, org.nip, org.city].contains { $0.lowercased().contains(terms) }
        }
        Picker("Organizacja odbiorcy *", selection: Binding(get: { draft.organizationId }, set: { id in
            Task { await model.selectRecipientOrganization(id, role: nil) }
        })) {
            Text("Wybierz odbiorcę").tag("")
            if !draft.organizationId.isEmpty && !model.recipientOrganizations.contains(where: { $0.id == draft.organizationId }) {
                Text(draft.data.name.isEmpty ? "Odbiorca przypisany do dokumentu" : draft.data.name).tag(draft.organizationId)
            }
            ForEach(visible.prefix(300)) { org in
                Text([org.name, org.city, org.nip].filter { !$0.isEmpty }.joined(separator: " · ")).tag(org.id)
            }
        }
    }
}

// MARK: Nabywca po korekcie danych

@MainActor struct InvoiceBuyerCorrectionView: View {
    @ObservedObject var model: InvoiceFormModel
    let originalNip: String
    @State private var search = ""

    private static func folded(_ value: String) -> String {
        value.lowercased().replacingOccurrences(of: "ł", with: "l").folding(options: .diacriticInsensitive, locale: Locale(identifier: "pl_PL"))
            .trimmingCharacters(in: .whitespaces)
    }
    private var taxpayer: String { InvoiceMath.normalizeNip(originalNip) }
    private var sameTaxpayer: [InvoiceFormSetup.Organization] {
        model.organizations.filter { !taxpayer.isEmpty && InvoiceMath.normalizeNip($0.nip) == taxpayer }
    }
    private func binding(_ key: WritableKeyPath<InvoiceCorrectedBuyer, String>, uppercase: Bool = false) -> Binding<String> {
        Binding(get: { model.correctedBuyer[keyPath: key] }, set: { value in
            var next = model.correctedBuyer
            next[keyPath: key] = uppercase ? value.uppercased() : value
            model.editCorrectedBuyer(next)
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Nabywca po korekcie").font(.callout.weight(.medium)).foregroundStyle(Color.accentColor)
                Spacer()
                Picker("Źródło danych", selection: Binding(get: { model.correctedBuyer.source }, set: { source in
                    var next = model.correctedBuyer
                    next.source = source
                    next.organizationId = ""
                    search = ""
                    model.editCorrectedBuyer(next)
                })) {
                    Text("Z organizacji CRM").tag("organization")
                    Text("Wpisz ręcznie").tag("manual")
                }
                .fixedSize()
            }
            if model.correctedBuyer.source == "organization" { organizationSearch }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                GridRow { TextField("Pełna nazwa nabywcy po korekcie *", text: binding(\.name)).gridCellColumns(2) }
                GridRow { TextField("Ulica i numer *", text: binding(\.street)).gridCellColumns(2) }
                GridRow {
                    TextField("Kod pocztowy *", text: binding(\.postalCode))
                    TextField("Miejscowość *", text: binding(\.city))
                }
                GridRow {
                    TextField("Kod kraju *", text: binding(\.countryCode, uppercase: true))
                    LabeledContent("NIP — bez zmiany podatnika", value: taxpayer)
                }
            }
            .textFieldStyle(.roundedBorder)
            Text("Możesz poprawić nazwę i adres tego samego podatnika. Dane zostaną zapisane na korekcie, bez zmieniania faktury pierwotnej ani karty organizacji.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var organizationSearch: some View {
        TextField("Wyszukaj organizację nabywcy * — nazwa, NIP, miejscowość lub adres…", text: $search).textFieldStyle(.roundedBorder)
        let query = Self.folded(search)
        let words = query.split(separator: " ").map(String.init)
        let nipQuery = search.trimmingCharacters(in: .whitespaces).range(of: "^(PL)?[\\d\\s-]+$", options: [.regularExpression, .caseInsensitive]) != nil
            ? InvoiceMath.normalizeNip(search) : ""
        let visible = sameTaxpayer.filter { org in
            let haystack = Self.folded([org.name, org.street, org.postalCode, org.city, org.nip].filter { !$0.isEmpty }.joined(separator: " "))
            return query.isEmpty || words.allSatisfy { haystack.contains($0) } || (!nipQuery.isEmpty && taxpayer.contains(nipQuery))
        }
        if let error = model.setup?.organizationsError {
            Text(error).font(.caption).foregroundStyle(.red)
        } else if visible.isEmpty {
            Text(sameTaxpayer.isEmpty ? "Brak dostępnych organizacji z NIP \(taxpayer). Możesz wpisać poprawione dane ręcznie."
                 : "Brak wyników dla wpisanej nazwy lub adresu. Spróbuj wpisać mniej słów.")
                .font(.caption).foregroundStyle(.secondary)
        } else {
            ForEach(visible.prefix(20)) { org in
                Button {
                    model.editCorrectedBuyer(InvoiceCorrectedBuyer(source: "organization", organizationId: org.id, name: org.name, nip: taxpayer,
                                                                   street: org.street, postalCode: org.postalCode, city: org.city,
                                                                   countryCode: org.country.uppercased() == "POLSKA" ? "PL" : (org.country.isEmpty ? "PL" : org.country.uppercased())))
                    search = ""
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(org.name).fontWeight(.medium)
                        Text(org.address.isEmpty ? "Brak adresu w CRM" : org.address).font(.caption).foregroundStyle(.secondary)
                        Text("NIP: \(taxpayer)\(org.id == model.correctedBuyer.organizationId ? " · Obecnie wybrana" : "")").font(.caption).foregroundStyle(Color.accentColor)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 3).padding(.horizontal, 6)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        Text("Wyniki obejmują organizacje z NIP \(taxpayer). Kliknij właściwą nazwę, aby uzupełnić dane poniżej.").font(.caption).foregroundStyle(.secondary)
        if !model.correctedBuyer.organizationId.isEmpty {
            VStack(alignment: .leading, spacing: 1) {
                Text("Wybrana organizacja CRM").font(.caption).foregroundStyle(Color.accentColor)
                Text(model.correctedBuyer.name.isEmpty ? "Organizacja z faktury pierwotnej" : model.correctedBuyer.name).font(.caption)
            }
        }
    }
}

// MARK: Korekta danych — przed i po

struct InvoicePartyComparison: View {
    let beforeBuyer: InvoiceCorrectedBuyer
    let afterBuyer: InvoiceCorrectedBuyer
    let beforeRecipient: InvoiceRecipientDraft.Fields?
    let afterRecipient: InvoiceRecipientDraft.Fields?

    private static func address(_ street: String, _ postal: String, _ city: String) -> String {
        [street, [postal, city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }.joined(separator: ", ")
    }
    private static func text(_ value: String?) -> String { value?.trimmingCharacters(in: .whitespaces).nonEmpty ?? "—" }

    var body: some View {
        let buyerRows: [(String, String?, String?)] = [
            ("Nazwa", beforeBuyer.name, afterBuyer.name), ("NIP", beforeBuyer.nip, afterBuyer.nip),
            ("Adres", Self.address(beforeBuyer.street, beforeBuyer.postalCode, beforeBuyer.city), Self.address(afterBuyer.street, afterBuyer.postalCode, afterBuyer.city)),
            ("Kraj", beforeBuyer.countryCode, afterBuyer.countryCode),
        ]
        let recipientRows: [(String, String?, String?)] = [
            ("Nazwa", beforeRecipient?.name ?? "Bez osobnego odbiorcy", afterRecipient?.name ?? "Bez osobnego odbiorcy"),
            ("NIP", beforeRecipient?.nip, afterRecipient?.nip), ("IDWew KSeF", beforeRecipient?.internalId, afterRecipient?.internalId),
            ("Adres", beforeRecipient.map { Self.address($0.street, $0.postalCode, $0.city) }, afterRecipient.map { Self.address($0.street, $0.postalCode, $0.city) }),
            ("Kraj", beforeRecipient?.countryCode, afterRecipient?.countryCode),
        ]
        VStack(alignment: .leading, spacing: 6) {
            Text("Korekta danych — przed i po").font(.callout.weight(.medium)).foregroundStyle(Color.accentColor)
            Text("Korekta dotyczy danych stron. Nie zmienia wartości faktury pierwotnej ani kwoty do zapłaty.").font(.caption).foregroundStyle(.secondary)
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Pole").font(.caption.weight(.semibold))
                    Text("Przed korektą").font(.caption.weight(.semibold))
                    Text("Po korekcie").font(.caption.weight(.semibold))
                }
                group("Nabywca", buyerRows)
                group("Odbiorca", recipientRows)
            }
        }
    }

    @ViewBuilder private func group(_ title: String, _ rows: [(String, String?, String?)]) -> some View {
        GridRow { Text(title).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor).gridCellColumns(3) }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            let before = Self.text(row.1)
            let after = Self.text(row.2)
            GridRow {
                Text(row.0).font(.caption).foregroundStyle(.secondary)
                Text(before).font(.caption).textSelection(.enabled)
                Text(after).font(.caption.weight(before == after ? .regular : .semibold))
                    .foregroundStyle(before == after ? Color.primary : Color.accentColor).textSelection(.enabled)
            }
        }
    }
}

// MARK: Pozycje faktury

@MainActor struct InvoiceItemRow: View {
    @ObservedObject var model: InvoiceFormModel
    let item: InvoiceFormItem
    let disabled: Bool

    private func binding<T>(_ key: WritableKeyPath<InvoiceFormItem, T>) -> Binding<T> {
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
        let values = InvoiceMath.values(item)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                labeled("Nazwa *") { TextField("", text: binding(\.name)).textFieldStyle(.roundedBorder) }
                    .frame(minWidth: 180)
                labeled("J.m.") {
                    Picker("", selection: binding(\.unit)) {
                        ForEach(InvoiceFormText.units, id: \.self) { Text($0).tag($0) }
                        if !InvoiceFormText.units.contains(item.unit) { Text(item.unit).tag(item.unit) }
                    }
                    .labelsHidden()
                }
                .frame(width: 80)
                labeled("Ilość *") { InvoiceNumberField(title: "", value: binding(\.quantity)).textFieldStyle(.roundedBorder) }.frame(width: 80)
                labeled("Cena netto *") { InvoiceNumberField(title: "", value: binding(\.priceNet)).textFieldStyle(.roundedBorder) }.frame(width: 100)
                labeled("Cena brutto *") { InvoiceNumberField(title: "", value: gross).textFieldStyle(.roundedBorder) }.frame(width: 100)
                labeled("Stawka VAT") {
                    Picker("", selection: Binding(get: { item.vatCode }, set: { model.changeVat(item.id, $0) })) {
                        // „0%” i „np.” bez rodzaju tylko jako podpowiedź (gdy przyszły ze źródła) — trzeba wybrać właściwy rodzaj.
                        ForEach(InvoiceFormText.vatCodes.filter { $0.2 || $0.0 == item.vatCode }, id: \.0) { code in
                            Text(code.1).tag(code.0)
                        }
                    }
                    .labelsHidden()
                }
                .frame(width: 170)
                Button { model.removeItem(item.id) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń pozycję")
            }
            if item.vatCode == "zw" {
                labeled("Podstawa prawna zwolnienia z VAT *") {
                    TextField("Np. art. 43 ust. 1 pkt … ustawy o VAT", text: binding(\.exemption)).textFieldStyle(.roundedBorder)
                }
            }
            HStack(spacing: 16) {
                Text("Wartość netto: \(InvoiceMath.money(values.net, model.currency))")
                Text("Kwota VAT: \(InvoiceMath.money(values.vat, model.currency))")
                Text("Wartość brutto: \(InvoiceMath.money(values.gross, model.currency))").fontWeight(.semibold).foregroundStyle(Color.accentColor)
            }
            .font(.caption).monospacedDigit()
        }
        .disabled(disabled)
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

// MARK: Pozycje korekty

@MainActor struct InvoiceCorrectionRow: View {
    @ObservedObject var model: InvoiceFormModel
    let line: InvoiceCorrectionLine

    private var index: Int? { model.correctionLines.firstIndex { $0.id == line.id } }
    private var quantity: Binding<Double> {
        Binding(get: { line.afterQuantity }, set: { value in if let index { model.correctionLines[index].afterQuantity = value } })
    }
    private var price: Binding<Double> {
        Binding(get: { line.afterPriceNet }, set: { value in if let index { model.correctionLines[index].afterPriceNet = value } })
    }
    private var grossPrice: Binding<Double> {
        Binding(get: { InvoiceMath.grossFromNet(line.afterPriceNet, line.before.vatRate) }, set: { value in
            if let index { model.correctionLines[index].afterPriceNet = InvoiceMath.netFromGross(value, line.before.vatRate) }
        })
    }

    var body: some View {
        let before = line.before
        let after = InvoiceMath.values(quantity: line.afterQuantity, priceNet: line.afterPriceNet, rate: before.vatRate)
        let delta = (InvoiceMath.fixed2(after.net - before.beforeNet), InvoiceMath.fixed2(after.vat - before.beforeVat), InvoiceMath.fixed2(after.gross - before.beforeGross))
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(before.position). \(before.name)").fontWeight(.medium)
                Spacer()
                Text(verbatim: "VAT \(InvoiceMath.plain(before.vatRate))%").font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .top, spacing: 10) {
                column("PRZED KOREKTĄ", color: .secondary) {
                    value("Ilość", "\(InvoiceMath.plain(before.beforeQuantity)) \(before.unit)")
                    value("Cena netto", InvoiceMath.money(before.beforePriceNet, model.currency))
                    value("Cena brutto", InvoiceMath.money(InvoiceMath.grossFromNet(before.beforePriceNet, before.vatRate), model.currency))
                    Divider()
                    value("Wartość netto", InvoiceMath.money(before.beforeNet, model.currency))
                    value("Wartość brutto", InvoiceMath.money(before.beforeGross, model.currency))
                }
                column("PO KOREKCIE", color: .orange) {
                    edit("Ilość") { InvoiceNumberField(title: "", value: quantity) }
                    edit("Cena netto") { InvoiceNumberField(title: "", value: price) }
                    edit("Cena brutto") { InvoiceNumberField(title: "", value: grossPrice) }
                    Divider()
                    value("Wartość netto", InvoiceMath.money(after.net, model.currency))
                    value("Wartość brutto", InvoiceMath.money(after.gross, model.currency))
                    Button("Skoryguj pozycję do zera") {
                        if let index {
                            model.correctionLines[index].afterQuantity = before.beforeQuantity
                            model.correctionLines[index].afterPriceNet = 0
                        }
                    }
                    .controlSize(.small).foregroundStyle(.red)
                }
                column("RÓŻNICA / KOREKTA", color: Color.accentColor) {
                    deltaValue("Netto", delta.0)
                    deltaValue("VAT", delta.1)
                    Divider()
                    deltaValue("Brutto", delta.2)
                }
            }
        }
        .padding(10)
        .background(Color.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    private func column<Content: View>(_ title: String, color: Color, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(color)
            content()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
    }
    private func value(_ label: String, _ text: String) -> some View {
        HStack { Text(label).font(.caption).foregroundStyle(.secondary); Spacer(); Text(text).font(.caption).monospacedDigit() }
    }
    private func edit<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack { Text(label).font(.caption).foregroundStyle(.secondary); Spacer(); content().textFieldStyle(.roundedBorder).frame(width: 110) }
    }
    private func deltaValue(_ label: String, _ amount: Double) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(InvoiceMath.money(amount, model.currency)).font(.caption.weight(.semibold)).monospacedDigit()
                .foregroundStyle(amount < 0 ? Color.red : amount > 0 ? Color.green : Color.secondary)
        }
    }
}
