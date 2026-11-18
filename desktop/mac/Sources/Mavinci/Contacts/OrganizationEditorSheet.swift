import SwiftUI

// MARK: Formularz organizacji — dodawanie jak `/crm/contacts/new` i edycja jak „Szczegóły” karty (`OrganizationFormFields`,
// `OrganizationInvoiceBuyerSection`, `OrganizationLocationPicker`, `OrganizationRepresentatives`): dane rejestrowe z GUS / KRS /
// CEIDG / białej listy, adres i kontakt, ocena i status, dane do faktury (nabywca, rola na fakturze), lokalizacja (wymagana dla
// hotelu, także nowa), reprezentacja (osoba kontaktowa, reprezentant, sposób i podstawa, data sprawdzenia), przy dodawaniu —
// osoby kontaktowe, osoby z rejestru i dodatkowi reprezentanci. Walidacja na serwerze ta sama co w przeglądarce.

/// Osoba do wyboru jako osoba kontaktowa lub reprezentant.
struct RepresentativeOption: Identifiable, Hashable {
    let id: String
    let name: String
    let position: String
}

@MainActor struct OrganizationEditorSheet: View {
    @ObservedObject var store: ContactsStore
    let mode: ContactEditorMode
    /// Po dodaniu organizacji: zamiast karty — przekazanie nowej organizacji (np. nabywca w formularzu faktury).
    var onCreated: ((String) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var original: [String: String] = [:]
    @State private var rating = 0
    @State private var originalRating = 0
    @State private var representsSelf = false
    @State private var originalRepresentsSelf = false
    @State private var separateBuyer = false
    @State private var buyerID = ""
    @State private var role = 8
    @State private var originalBuyer = ""
    @State private var originalRole: Int?
    @State private var location: ContactCardLocation?
    @State private var locationQuery = ""
    @State private var locationResults: [ContactCardLocation] = []
    @State private var locationProblem: String?
    @State private var addingLocation = false
    @State private var buyers: [ContactInvoiceBuyerOption] = []
    @State private var buyerQuery = ""
    @State private var buyersProblem: String?
    @State private var registry: RegistryCompany?
    @State private var lookingUp = false
    @State private var contactIDs: [String] = []
    @State private var signerIDs: [String] = []
    @State private var createdNames: [String: String] = [:]
    @State private var newPerson: [String: String] = [:]
    @State private var newPersonShown = false
    @State private var creatingPerson = false
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false
    @FocusState private var focused: String?

    private var creating: Bool { mode.ref == nil }
    private var card: ContactCard? { mode.ref.flatMap { store.card($0.id) } }
    private var organizationID: String { mode.ref?.id ?? "" }
    /// Pola tekstowe formularza (porównanie przy edycji — zapisujemy tylko zmienione).
    private static let textKeys = ["name", "alias", "business_type", "legal_form", "nip", "krs", "regon", "ksef_internal_id", "address", "postal_code",
                                   "city", "country", "email", "phone", "website", "status", "notes", "location_id", "primary_contact_id",
                                   "legal_representative_id", "legal_representative_title", "representation_type", "representation_rule",
                                   "representation_basis", "representation_verified_at"]
    private static let fieldOrder = ["name", "alias", "nip", "business_type", "legal_form", "krs", "regon", "ksef_internal_id", "address", "postal_code",
                                     "city", "country", "email", "phone", "website", "rating", "status", "invoice_buyer_organization_id",
                                     "invoice_recipient_role", "location_id", "primary_contact_id", "legal_representative_id", "legal_representative_title",
                                     "representation_type", "representation_rule", "representation_basis", "representation_verified_at", "notes"]
    private var legalForm: String { values["legal_form"] ?? "" }
    private var isHotel: Bool { values["business_type"] == "hotel" }
    private var isBuyerForOthers: Bool { !(card?.units ?? []).isEmpty }
    private var canAddLocation: Bool {
        card?.access.canManageLocations ?? (state.employee?.isAdmin == true || state.employee?.has("locations_manage") == true)
    }
    /// Osoby do wyboru reprezentantów: przy edycji — osoby kontaktowe organizacji; przy dodawaniu — kontakty z listy.
    private var representativeOptions: [RepresentativeOption] {
        if creating {
            return store.contacts.filter { $0.contactKind == .contact }.map { RepresentativeOption(id: $0.id, name: $0.name, position: $0.position) }
        }
        var seen = Set<String>()
        return (card?.persons ?? []).compactMap { person in
            guard seen.insert(person.id).inserted else { return nil }
            return RepresentativeOption(id: person.id, name: person.name, position: person.position)
        }
    }
    private var otherErrors: [String] {
        errors.filter { !Self.fieldOrder.contains($0.key) }.sorted { $0.key < $1.key }.map(\.value)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(creating ? "Nowa organizacja" : "Edytuj organizację").font(.title2.bold())
                    Text(creating ? "Firma, hotel, restauracja, sala eventowa" : (card?.organization?.displayName ?? "")).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 6)

            if !creating && card?.organization == nil {
                if let ref = mode.ref, let error = store.cardErrors[ref.id] {
                    ContentUnavailableView("Nie można wczytać danych", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Wczytywanie danych…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                form
            }

            HStack {
                if !errors.isEmpty {
                    Label("Popraw pola oznaczone na czerwono.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.red)
                } else if let problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(2)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(creating ? "Dodaj organizację" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(saving || lookingUp || (!creating && card?.organization == nil))
            }
            .padding(16)
        }
        .frame(minWidth: 680, idealWidth: 760, minHeight: 680, idealHeight: 860)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: creating ? "Dodawanie organizacji…" : "Zapisywanie…") } }
        .interactiveDismissDisabled(saving)
        .sheet(isPresented: $addingLocation) {
            NewLocationSheet(locations: state.locations) { created in
                location = created
                values["location_id"] = created.id
                errors.removeValue(forKey: "location_id")
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .task {
            if let ref = mode.ref, store.card(ref.id) == nil { await store.loadCard(ref) }
            prepare()
            do { buyers = try await store.invoiceBuyers() } catch { buyersProblem = store.failureText(error, "Nie udało się wczytać organizacji. Spróbuj ponownie.") }
        }
    }

    private var form: some View {
        Form {
            registrySection
            addressSection
            Section("Ocena i status") {
                Picker("Ocena", selection: $rating) {
                    Text("Brak oceny").tag(0)
                    ForEach(1...5, id: \.self) { Text("\(String(repeating: "★", count: $0)) (\($0)/5)").tag($0) }
                }
                choice("status", "Status", ContactDictionaries.organizationStatuses, empty: nil)
            }
            invoiceSection
            locationSection
            if creating { createRepresentationSection } else { representationSection }
            if creating { personsSection }
            Section("Notatki") {
                text("notes", "Notatki", prompt: "Dodatkowe informacje…", vertical: true)
            }
            if problem != nil || !otherErrors.isEmpty {
                Section {
                    if let problem { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                    ForEach(otherErrors, id: \.self) { Text($0).font(.caption).foregroundStyle(.red) }
                }
            }
        }
        .formStyle(.grouped)
        .disabled(saving)
    }

    // MARK: Dane rejestrowe
    private var registrySection: some View {
        Section("Dane rejestrowe") {
            text("name", "Nazwa pełna *", prompt: "np. Szkoła Podstawowa nr 1 im. Mikołaja Kopernika w Olsztynie")
            text("alias", "Alias (krótka nazwa)", prompt: "np. SP 1 Olsztyn", hint: "Wyświetlany w CRM zamiast pełnej nazwy.")
            HStack(alignment: .top) {
                text("nip", "NIP *", prompt: "0000000000")
                Button { Task { await lookup() } } label: {
                    if lookingUp { ProgressView().controlSize(.small) } else { Label("GUS / rejestry", systemImage: "magnifyingglass") }
                }
                .disabled(lookingUp)
                .help("Pobierz dane z GUS, KRS, CEIDG i białej listy VAT")
            }
            if let registry { registryCard(registry) }
            businessTypePicker
            legalFormPicker
            if ContactCardText.requiresKrs(legalForm) { text("krs", "KRS *", prompt: "0000000000") }
            text("regon", "REGON", prompt: "9 albo 14 cyfr")
            text("ksef_internal_id", "Numer identyfikacji wewnętrznej KSeF", prompt: "np. 5252228219-00145",
                 hint: "Tylko dla oddziału / jednostki wewnętrznej nabywcy. Szkoła rozliczana na gminę go nie potrzebuje.")
        }
    }

    private var businessTypePicker: some View {
        let current = values["business_type"] ?? "company"
        return VStack(alignment: .leading, spacing: 3) {
            Picker("Profil działalności *", selection: binding("business_type")) {
                ForEach(ContactCardText.businessTypes) { Text($0.label).tag($0.value) }
                if !ContactCardText.businessTypes.contains(where: { $0.value == current }) {
                    Text(ContactDictionaries.label(current, in: ContactDictionaries.businessTypes)).tag(current)
                }
            }
            if let issue = errors["business_type"] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private var legalFormPicker: some View {
        VStack(alignment: .leading, spacing: 3) {
            Picker("Forma prawna / typ podmiotu *", selection: Binding(get: { values["legal_form"] ?? "" }, set: { next in
                values["legal_form"] = next
                errors.removeValue(forKey: "legal_form")
                if !ContactCardText.requiresKrs(next) { values["krs"] = ""; errors.removeValue(forKey: "krs") }
            })) {
                Text("— wybierz formę prawną lub typ podmiotu —").tag("")
                ForEach(ContactDictionaries.legalForms) { Text($0.label).tag($0.value) }
            }
            if let issue = errors["legal_form"] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private func registryCard(_ data: RegistryCompany) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Dane z rejestru: \(data.sourceLabel)", systemImage: "checkmark.seal").font(.callout.weight(.semibold)).foregroundStyle(theme.accent)
            if !data.name.isEmpty { Text(data.name).font(.caption) }
            if !data.legalFormName.isEmpty { Text("Forma prawna: \(data.legalFormName)").font(.caption).foregroundStyle(.secondary) }
            if !data.registryName.isEmpty { Text("Rejestr: \(data.registryName)").font(.caption).foregroundStyle(.secondary) }
            if !data.vatStatus.isEmpty { Text("Status VAT: \(data.vatStatus)").font(.caption).foregroundStyle(.secondary) }
            if !data.representationRule.isEmpty { Text("Sposób reprezentacji: \(data.representationRule)").font(.caption).foregroundStyle(.secondary) }
            ForEach(data.representatives, id: \.self) { person in
                Text("\(person.fullName)\(person.title.isEmpty ? "" : " — \(person.title)")").font(.caption)
            }
            if !data.missingRoles.isEmpty {
                Text("Nie pobrano pełnych nazwisk dla części pozycji w KRS: \(data.missingRoles.joined(separator: ", ")). Wybierz właściwy kontakt ręcznie.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private var addressSection: some View {
        Section("Adres i kontakt") {
            text("address", "Adres (ulica i numer) *", prompt: "np. ul. Chmielna 85/87")
            text("postal_code", "Kod pocztowy *", prompt: "00-000")
            text("city", "Miasto *", prompt: "np. Olsztyn")
            text("country", "Kraj", prompt: "Polska")
            text("email", "E-mail", prompt: "biuro@firma.pl")
            text("phone", "Telefon", prompt: "+48 600 000 000")
            text("website", "Strona www", prompt: "firma.pl")
        }
    }

    // MARK: Dane do faktury
    private var buyerOptions: [ContactInvoiceBuyerOption] {
        buyers.filter { $0.id != organizationID && ($0.buyerId.isEmpty || $0.id == buyerID) }
    }

    private var invoiceSection: some View {
        Section {
            if isBuyerForOthers {
                Text("Ta organizacja jest nabywcą faktur dla innych jednostek, więc faktury wystawiamy na nią samą.").foregroundStyle(.secondary)
            } else {
                Picker("Na kogo wystawiamy faktury", selection: $separateBuyer) {
                    Text("Na tę organizację — ona jest nabywcą na fakturze").tag(false)
                    Text("Na inną organizację — np. szkoła lub przedszkole → gmina").tag(true)
                }
                .pickerStyle(.radioGroup)
                if separateBuyer { buyerFields }
            }
        } header: {
            Text("Dane do faktury")
        } footer: {
            Text("Na kogo wystawiamy faktury za tę organizację. Umowę i wydarzenia nadal prowadzisz z nią samą.").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var buyerFields: some View {
        let selected = buyers.first { $0.id == buyerID }
        VStack(alignment: .leading, spacing: 6) {
            Text("Nabywca na fakturach *").font(.callout)
            if let selected {
                HStack {
                    Label(selected.label, systemImage: "building.columns")
                    Text(selected.detail).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Zmień") { buyerID = "" }.controlSize(.small)
                }
                if selected.nip.isEmpty {
                    Text("Wybrana organizacja nie ma NIP — uzupełnij go w jej karcie, inaczej nie zapiszesz powiązania.").font(.caption).foregroundStyle(.orange)
                }
            } else {
                TextField("Wyszukaj gminę lub inną organizację…", text: $buyerQuery).textFieldStyle(.roundedBorder)
                let terms = buyerQuery.trimmingCharacters(in: .whitespaces).lowercased()
                let found = Array(buyerOptions.filter { terms.isEmpty || $0.label.lowercased().contains(terms) || $0.nip.contains(terms) || $0.city.lowercased().contains(terms) }.prefix(8))
                if found.isEmpty { Text("Brak organizacji — dodaj najpierw nabywcę (np. gminę) jako organizację").font(.caption).foregroundStyle(.secondary) }
                ForEach(found) { option in
                    Button { buyerID = option.id; buyerQuery = ""; errors.removeValue(forKey: "invoice_buyer_organization_id") } label: {
                        HStack {
                            Text(option.label).lineLimit(1)
                            Text(option.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Spacer()
                        }
                        .padding(.vertical, 3).padding(.horizontal, 6)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let issue = errors["invoice_buyer_organization_id"] { Text(issue).font(.caption).foregroundStyle(.red) }
            if let buyersProblem { Text(buyersProblem).font(.caption).foregroundStyle(.orange) }
        }
        Picker("Ta organizacja na fakturze", selection: $role) {
            Text("Jednostka podrzędna JST (szkoła, przedszkole…)").tag(8)
            Text("Oddział / jednostka wewnętrzna nabywcy").tag(2)
        }
        Text(role == 8
             ? "Na fakturze: nabywca — wybrana organizacja (w KSeF z oznaczeniem JST), odbiorca — ta jednostka (rola 8, po jej własnym NIP-ie). Jednostka musi mieć własny NIP."
             : "Na fakturze: nabywca — wybrana organizacja, odbiorca — ta jednostka (rola 2). Wpisz wyżej jej numer identyfikacji wewnętrznej KSeF — zaczyna się od NIP-u nabywcy.")
            .font(.caption).foregroundStyle(.secondary)
        if let issue = errors["invoice_recipient_role"] { Text(issue).font(.caption).foregroundStyle(.red) }
    }

    // MARK: Lokalizacja
    private var locationSection: some View {
        Section {
            if let location {
                HStack(alignment: .top) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(location.name).fontWeight(.medium)
                        if !location.address.isEmpty { Text(location.address).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button("Wyczyść") { self.location = nil; values["location_id"] = "" }.controlSize(.small)
                }
            }
            TextField("Wyszukaj lokalizację (min. 2 znaki)…", text: $locationQuery).textFieldStyle(.roundedBorder)
                .task(id: locationQuery) { await searchLocations() }
            ForEach(locationResults) { result in
                Button {
                    location = result
                    values["location_id"] = result.id
                    errors.removeValue(forKey: "location_id")
                    locationQuery = ""
                    locationResults = []
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(result.name)
                        if !result.address.isEmpty { Text(result.address).font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if locationQuery.trimmingCharacters(in: .whitespaces).count >= 2 && locationResults.isEmpty && locationProblem == nil {
                Text("Brak wyników. Możesz dodać nową lokalizację.").font(.caption).foregroundStyle(.secondary)
            }
            if let locationProblem { Text(locationProblem).font(.caption).foregroundStyle(.orange) }
            if canAddLocation {
                Button { addingLocation = true } label: { Label("Dodaj nową lokalizację…", systemImage: "plus") }
            }
            if let issue = errors["location_id"] { Text(issue).font(.caption).foregroundStyle(.red) }
        } header: {
            Text(isHotel ? "Lokalizacja *" : "Powiązana lokalizacja")
        } footer: {
            Text(isHotel ? "Wymagana dla hotelu. Sale, rzuty, zdjęcia i informacje techniczne są zapisane wyłącznie w tej lokalizacji."
                 : "Wpisz min. 2 znaki i wybierz wynik z listy. Samo wpisanie nazwy nie tworzy powiązania.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func searchLocations() async {
        let query = locationQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { locationResults = []; locationProblem = nil; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        do {
            let found = try await store.searchLocations(query)
            guard !Task.isCancelled else { return }
            locationResults = found
            locationProblem = nil
        } catch {
            locationResults = []
            locationProblem = "Nie udało się pobrać lokalizacji"
        }
    }

    // MARK: Reprezentacja (edycja)
    private var representationSection: some View {
        Section {
            Text(ContactCardText.representationHelp(legalForm)).font(.caption).foregroundStyle(.secondary)
            let options = representativeOptions
            let primary = values["primary_contact_id"] ?? ""
            let representative = values["legal_representative_id"] ?? ""
            Picker("Osoba kontaktowa", selection: binding("primary_contact_id")) {
                Text(options.isEmpty ? "— Brak osób kontaktowych (dodaj w zakładce Osoby kontaktowe) —" : "— Wybierz osobę —").tag("")
                ForEach(options) { person in
                    Text(person.position.isEmpty ? person.name : "\(person.name) (\(person.position))").tag(person.id)
                }
                // Zapisana osoba spoza bieżących osób kontaktowych — zostaje, dopóki nie wybierzesz innej.
                if !primary.isEmpty && !options.contains(where: { $0.id == primary }) {
                    Text(card?.primaryContact?.name ?? "Obecna osoba kontaktowa").tag(primary)
                }
            }
            Toggle("Osoba kontaktowa jest też osobą uprawnioną do zawarcia umowy", isOn: $representsSelf)
            if !representsSelf {
                Picker("Reprezentant / osoba uprawniona", selection: representativeBinding) {
                    Text(options.isEmpty ? "— Brak osób kontaktowych —" : "— Wybierz osobę —").tag("")
                    ForEach(options) { person in Text(person.name).tag(person.id) }
                    if !representative.isEmpty && !options.contains(where: { $0.id == representative }) {
                        Text(card?.legalRepresentative?.name ?? "Obecny reprezentant").tag(representative)
                    }
                }
            }
            text("legal_representative_title", "Stanowisko reprezentanta", prompt: "np. Prezes Zarządu")
            representationFields
        } header: {
            Text("Reprezentacja")
        } footer: {
            Text("Osoby decyzyjne i dodatkowych reprezentantów dodasz w karcie organizacji (Szczegóły → Reprezentanci).").font(.caption).foregroundStyle(.secondary)
        }
    }

    /// Wybór reprezentanta: puste — bez stanowiska; stanowisko osoby, gdy pole jest puste (jak w CRM).
    private var representativeBinding: Binding<String> {
        Binding(get: { values["legal_representative_id"] ?? "" }, set: { next in
            values["legal_representative_id"] = next
            if next.isEmpty { values["legal_representative_title"] = ""; return }
            let title = (values["legal_representative_title"] ?? "").trimmingCharacters(in: .whitespaces)
            if title.isEmpty, let person = representativeOptions.first(where: { $0.id == next }), !person.position.isEmpty {
                values["legal_representative_title"] = person.position
            }
        })
    }

    @ViewBuilder private var representationFields: some View {
        choice("representation_type", "Sposób reprezentacji", ContactCardText.representation, empty: "— Wybierz po sprawdzeniu podstawy umocowania —")
        text("representation_rule", "Dokładna zasada reprezentacji",
             prompt: ContactCardText.requiresKrs(legalForm) ? "np. Do składania oświadczeń wymagane jest współdziałanie dwóch członków zarządu." : "np. Dyrektor działa samodzielnie na podstawie statutu.",
             vertical: true)
        text("representation_basis", "Podstawa weryfikacji", prompt: ContactCardText.requiresKrs(legalForm) ? "KRS, Dział 2" : legalForm == "jdg" ? "CEIDG / pełnomocnictwo" : "Statut / uchwała / pełnomocnictwo")
        Toggle("Data sprawdzenia", isOn: Binding(get: { !(values["representation_verified_at"] ?? "").isEmpty }, set: { on in
            values["representation_verified_at"] = on ? Self.dayString(Date()) : ""
        }))
        if !(values["representation_verified_at"] ?? "").isEmpty {
            DatePicker("Sprawdzono", selection: Binding(get: { Self.day(values["representation_verified_at"] ?? "") ?? Date() }, set: { values["representation_verified_at"] = Self.dayString($0) }),
                       displayedComponents: .date)
        }
        if let issue = errors["representation_verified_at"] { Text(issue).font(.caption).foregroundStyle(.red) }
    }

    // MARK: Reprezentacja i osoby (dodawanie)
    private var createRepresentationSection: some View {
        Section {
            choice("representation_type", "Sposób reprezentacji", ContactCardText.representation, empty: "— Wybierz —")
            VStack(alignment: .leading, spacing: 4) {
                Text("Główny reprezentant / osoba uprawniona").font(.callout)
                let representative = values["legal_representative_id"] ?? ""
                if !representative.isEmpty {
                    HStack {
                        Label(personName(representative), systemImage: "checkmark.shield")
                        Spacer()
                        Button("Usuń wybór") { values["legal_representative_id"] = ""; values["legal_representative_title"] = "" }.controlSize(.small)
                    }
                }
                ContactSearchPicker(prompt: "Wyszukaj kontakt po nazwisku lub adresie e-mail…", candidates: store.contacts.filter { $0.contactKind == .contact }) { entry in
                    chooseRepresentative(entry.id, name: entry.name, position: entry.position)
                }
            }
            if values["representation_type"] == "joint" || values["representation_type"] == "joint_with_proxy" { signersBlock }
            if let registry, !registry.representatives.isEmpty { registryPeople(registry) }
            text("representation_rule", "Dokładna zasada reprezentacji", vertical: true)
            text("legal_representative_title", "Stanowisko reprezentanta", prompt: "np. Prezes Zarządu, Dyrektor, Prokurent")
            text("representation_basis", "Podstawa weryfikacji", prompt: "np. KRS, Dział 2")
            Toggle("Data sprawdzenia", isOn: Binding(get: { !(values["representation_verified_at"] ?? "").isEmpty }, set: { on in
                values["representation_verified_at"] = on ? Self.dayString(Date()) : ""
            }))
            if !(values["representation_verified_at"] ?? "").isEmpty {
                DatePicker("Sprawdzono", selection: Binding(get: { Self.day(values["representation_verified_at"] ?? "") ?? Date() }, set: { values["representation_verified_at"] = Self.dayString($0) }),
                           displayedComponents: .date)
            }
        } header: {
            Text("Reprezentacja podmiotu")
        } footer: {
            Text("Główny reprezentant w CRM nie oznacza prawa do samodzielnej reprezentacji. Obowiązuje dokładna zasada z rejestru.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var signersBlock: some View {
        let representative = values["legal_representative_id"] ?? ""
        let count = Set(([representative] + signerIDs).filter { !$0.isEmpty }).count
        return VStack(alignment: .leading, spacing: 4) {
            Text("Reprezentacja łączna — wskaż co najmniej dwie osoby zgodnie z dokładną zasadą rejestru.").font(.callout).foregroundStyle(.orange)
            Text("Wskazano osób do podpisu: \(count). Główny reprezentant jest uwzględniony.").font(.caption).foregroundStyle(.secondary)
            ForEach(signerIDs.filter { $0 != representative }, id: \.self) { id in
                HStack {
                    Text("\(personName(id)) — uprawniony do podpisu / współreprezentacji").font(.caption)
                    Spacer()
                    Button { signerIDs.removeAll { $0 == id } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless)
                }
            }
            ContactSearchPicker(prompt: "Wyszukaj dodatkową osobę uprawnioną do podpisu…",
                                candidates: store.contacts.filter { $0.contactKind == .contact && $0.id != representative && !signerIDs.contains($0.id) }) { entry in
                signerIDs.append(entry.id)
                if !contactIDs.contains(entry.id) { contactIDs.append(entry.id) }
            }
        }
        .padding(8)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func registryPeople(_ registry: RegistryCompany) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Osoby ujawnione w rejestrze").font(.callout)
            Text("Wybierz istniejący kontakt powyżej albo utwórz go z danych rejestrowych. Utworzenie kontaktu zapisuje go od razu w bazie.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(registry.representatives, id: \.self) { person in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(person.fullName)
                        if !person.title.isEmpty { Text(person.title).font(.caption).foregroundStyle(theme.accent) }
                    }
                    Spacer()
                    Button("Dodaj kontakt i wybierz") { Task { await useRegistryPerson(person) } }
                        .controlSize(.small).disabled(creatingPerson || person.firstName.isEmpty || person.lastName.isEmpty)
                }
            }
        }
        .padding(8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private var personsSection: some View {
        Section {
            ForEach(contactIDs, id: \.self) { id in
                HStack {
                    Label(personName(id), systemImage: "person")
                    if id == values["legal_representative_id"] { Text("reprezentant").font(.caption).foregroundStyle(theme.accent) }
                    Spacer()
                    Button { contactIDs.removeAll { $0 == id }; signerIDs.removeAll { $0 == id } } label: { Image(systemName: "xmark.circle") }
                        .buttonStyle(.borderless).help("Usuń z listy")
                }
            }
            ContactSearchPicker(prompt: "Szukaj kontaktu…", candidates: store.contacts.filter { $0.contactKind == .contact && !contactIDs.contains($0.id) }) { entry in
                contactIDs.append(entry.id)
            }
            DisclosureGroup("Nowa osoba kontaktowa", isExpanded: $newPersonShown) {
                personField("first_name", "Imię *", prompt: "Jan")
                personField("last_name", "Nazwisko *", prompt: "Kowalski")
                personField("email", "E-mail", prompt: "jan.kowalski@example.com")
                personField("phone", "Telefon", prompt: "600 123 456")
                HStack {
                    Spacer()
                    Button("Dodaj kontakt") { Task { await addNewPerson() } }
                        .disabled(creatingPerson || (newPerson["first_name"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty
                                  || (newPerson["last_name"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        } header: {
            Text("Osoby kontaktowe (opcjonalne)")
        } footer: {
            Text("Wybrane osoby, reprezentant i osoby do podpisu zostaną powiązane z organizacją przy zapisie.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func personField(_ key: String, _ label: String, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(label, text: Binding(get: { newPerson[key] ?? "" }, set: { newPerson[key] = $0; errors.removeValue(forKey: "person.\(key)") }), prompt: Text(prompt))
            if let issue = errors["person.\(key)"] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private func personName(_ id: String) -> String {
        createdNames[id] ?? store.entry(id)?.name ?? representativeOptions.first(where: { $0.id == id })?.name ?? "Kontakt"
    }

    private func chooseRepresentative(_ id: String, name: String, position: String) {
        values["legal_representative_id"] = id
        let matches = (registry?.representatives ?? []).filter { Self.normalize($0.fullName) == Self.normalize(name) }
        values["legal_representative_title"] = matches.count == 1 ? matches[0].title : position
        if !contactIDs.contains(id) { contactIDs.append(id) }
    }

    /// Osoba z rejestru: istniejący kontakt o tym imieniu i nazwisku — tylko stanowisko; inaczej nowy kontakt i wybór (jak w CRM).
    private func useRegistryPerson(_ person: RegistryCompany.Person) async {
        let existing = store.contacts.filter { $0.contactKind == .contact && Self.normalize($0.name) == Self.normalize(person.fullName) }
        if !existing.isEmpty {
            values["legal_representative_title"] = person.title
            state.notice = "Kontakt o takim imieniu i nazwisku już istnieje. Wybierz go w wyszukiwarce po sprawdzeniu danych."
            return
        }
        creatingPerson = true
        defer { creatingPerson = false }
        do {
            let reply = try await store.post("quickContact", ["data": .object([
                "first_name": .string(person.firstName), "last_name": .string(person.lastName), "position": .string(person.title),
            ])])
            let id = reply["id"]?.text ?? ""
            guard !id.isEmpty else { return }
            createdNames[id] = reply["name"]?.text.nonEmpty ?? person.fullName
            if !contactIDs.contains(id) { contactIDs.append(id) }
            let joint = values["representation_type"] == "joint" || values["representation_type"] == "joint_with_proxy"
            if joint && !(values["legal_representative_id"] ?? "").isEmpty {
                if !signerIDs.contains(id) { signerIDs.append(id) }
            } else {
                values["legal_representative_id"] = id
                values["legal_representative_title"] = person.title
            }
            state.succeed("Utworzono kontakt i wybrano reprezentanta. Zapisz organizację, aby utrwalić powiązanie.")
            Task { await store.sync(force: true) }
        } catch {
            problem = store.failureText(error, "Nie udało się utworzyć kontaktu reprezentanta.")
        }
    }

    private func addNewPerson() async {
        creatingPerson = true
        defer { creatingPerson = false }
        do {
            let data: [String: JSONValue] = newPerson.mapValues { .string($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            let reply = try await store.post("quickContact", ["data": .object(data)])
            let id = reply["id"]?.text ?? ""
            guard !id.isEmpty else { return }
            createdNames[id] = reply["name"]?.text.nonEmpty ?? "Kontakt"
            contactIDs.append(id)
            newPerson = [:]
            newPersonShown = false
            state.succeed("Kontakt dodany")
            Task { await store.sync(force: true) }
        } catch let failure as NativeFailure {
            for (key, message) in failure.fieldErrors { errors["person.\(key)"] = message }
            if failure.fieldErrors.isEmpty { problem = failure.message }
        } catch {
            problem = store.failureText(error, "Błąd podczas dodawania kontaktu")
        }
    }

    // MARK: GUS / rejestry
    private func lookup() async {
        let nip = (values["nip"] ?? "").filter(\.isNumber)
        guard nip.count == 10 else { errors["nip"] = "Wprowadź NIP (10 cyfr), aby pobrać dane z rejestrów."; focused = "nip"; return }
        lookingUp = true
        defer { lookingUp = false }
        do {
            let data = try await store.registry(nip: nip)
            registry = data
            apply(data)
            let people = data.representatives.count
            state.succeed(people > 0 ? "Pobrano dane (\(data.sourceLabel)) oraz sposób reprezentacji i \(people) osób z KRS" : "Dane firmy pobrane (\(data.sourceLabel))")
        } catch {
            problem = store.failureText(error, "Błąd podczas pobierania danych z GUS")
        }
    }

    /// Dane z rejestru do formularza (jak `handleFetchFromGUS`): niepuste wartości zastępują wpisane, KRS tylko dla form z KRS.
    private func apply(_ data: RegistryCompany) {
        func put(_ key: String, _ value: String) { if !value.isEmpty { values[key] = value } }
        put("business_type", data.businessType)
        put("nip", data.nip.filter(\.isNumber))
        put("name", data.name); put("alias", data.alias); put("regon", data.regon); put("legal_form", data.legalForm)
        if ContactCardText.requiresKrs(values["legal_form"] ?? "") { put("krs", data.krs) } else { values["krs"] = "" }
        put("address", data.address); put("city", data.city); put("postal_code", data.postalCode); put("country", data.country)
        put("email", data.email); put("phone", data.phone); put("website", data.website)
        put("representation_type", data.representationType); put("representation_rule", data.representationRule)
        put("representation_basis", data.representationBasis); put("representation_verified_at", String(data.representationVerifiedAt.prefix(10)))
        for key in ["name", "nip", "legal_form", "krs", "regon", "address", "city", "postal_code"] { errors.removeValue(forKey: key) }
        // Jedna osoba uprawniona w rejestrze i dokładnie jeden kontakt o tym imieniu i nazwisku — reprezentant (`findExactRegistryRepresentativeContact`).
        let eligible = data.representatives.filter { person in
            if data.representationType == "sole" { return person.kind != "proxy" }
            if data.representationType == "proxy" { return person.kind == "proxy" }
            return false
        }
        guard eligible.count == 1 else { return }
        let expected = Self.normalize(eligible[0].fullName)
        let matches = representativeOptions.filter { Self.normalize($0.name) == expected }
        guard matches.count == 1 else { return }
        values["legal_representative_id"] = matches[0].id
        if !eligible[0].title.isEmpty { values["legal_representative_title"] = eligible[0].title }
        if creating {
            if !contactIDs.contains(matches[0].id) { contactIDs.append(matches[0].id) }
        } else {
            representsSelf = matches[0].id == (values["primary_contact_id"] ?? "")
        }
    }

    static func normalize(_ value: String) -> String {
        let folded = value.replacingOccurrences(of: "ł", with: "l").replacingOccurrences(of: "Ł", with: "L")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL")).lowercased()
        let spaced = String(folded.map { $0.isLetter || $0.isNumber ? $0 : " " })
        return spaced.split(separator: " ").joined(separator: " ")
    }
    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    private static func day(_ raw: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(raw.prefix(10)))
    }

    // MARK: Pola
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0; errors.removeValue(forKey: key) })
    }
    @ViewBuilder private func text(_ key: String, _ label: String, prompt: String? = nil, hint: String? = nil, vertical: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if vertical {
                TextField(label, text: binding(key), prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(2...6).focused($focused, equals: key)
            } else {
                TextField(label, text: binding(key), prompt: prompt.map { Text($0) }).focused($focused, equals: key)
            }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
            else if let hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
        }
    }
    @ViewBuilder private func choice(_ key: String, _ label: String, _ options: [InquiryOption], empty: String?) -> some View {
        let current = values[key] ?? ""
        VStack(alignment: .leading, spacing: 3) {
            Picker(label, selection: binding(key)) {
                if let empty { Text(empty).tag("") }
                else if current.isEmpty { Text("—").tag("") }
                ForEach(options) { Text($0.label).tag($0.value) }
                if !current.isEmpty && !options.contains(where: { $0.value == current }) { Text(current).tag(current) }
            }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    // MARK: Dane i zapis
    private func prepare() {
        guard !prepared else { return }
        if creating {
            prepared = true
            values = ["business_type": "company", "country": "Polska", "status": "active"]
            return
        }
        guard let card, let org = card.organization else { return }
        prepared = true
        let loaded: [String: String] = [
            "name": org.name, "alias": org.alias, "business_type": org.businessType, "legal_form": org.legalForm, "nip": org.nip, "krs": org.krs,
            "regon": org.regon, "ksef_internal_id": org.ksefInternalId, "address": org.address, "postal_code": org.postalCode, "city": org.city,
            "country": org.country, "email": org.email, "phone": org.phone, "website": org.website, "status": org.status, "notes": org.notes,
            "location_id": org.locationId, "primary_contact_id": org.primaryContactId, "legal_representative_id": org.legalRepresentativeId,
            "legal_representative_title": org.legalRepresentativeTitle, "representation_type": org.representationType,
            "representation_rule": org.representationRule, "representation_basis": org.representationBasis,
            "representation_verified_at": org.representationVerifiedAt,
        ]
        values = loaded
        original = loaded
        rating = org.rating ?? 0
        originalRating = rating
        representsSelf = org.contactIsRepresentative
        originalRepresentsSelf = representsSelf
        buyerID = org.invoiceBuyerId
        originalBuyer = org.invoiceBuyerId
        role = org.invoiceRecipientRole == 2 ? 2 : 8
        originalRole = org.invoiceRecipientRole
        separateBuyer = !org.invoiceBuyerId.isEmpty || org.invoiceRecipientRole != nil
        location = card.location
    }

    private func trimmed(_ key: String) -> String { (values[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    private func validate() -> [String: String] {
        var found: [String: String] = [:]
        if trimmed("name").count < 2 { found["name"] = trimmed("name").isEmpty ? "Nazwa jest wymagana" : "Nazwa musi mieć co najmniej 2 znaki" }
        if trimmed("nip").isEmpty { found["nip"] = "NIP jest wymagany" }
        if trimmed("legal_form").isEmpty { found["legal_form"] = "Forma prawna lub typ podmiotu jest wymagany" }
        if trimmed("address").isEmpty { found["address"] = "Adres jest wymagany" }
        if trimmed("city").isEmpty { found["city"] = "Miasto jest wymagane" }
        if trimmed("postal_code").isEmpty { found["postal_code"] = "Kod pocztowy jest wymagany" }
        if isHotel && trimmed("location_id").isEmpty { found["location_id"] = "Hotel musi być powiązany z lokalizacją. Wybierz obiekt z listy lub dodaj nowy." }
        if separateBuyer && !isBuyerForOthers && buyerID.isEmpty { found["invoice_buyer_organization_id"] = "Wybierz organizację, na którą wystawiamy faktury (np. gminę)." }
        return found
    }

    private func save() async {
        problem = nil
        errors = validate()
        if let first = Self.fieldOrder.first(where: { errors[$0] != nil }) { focused = first; return }
        guard store.workspace?.canWrite == true else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        let buyer = separateBuyer && !isBuyerForOthers ? buyerID : ""
        let recipientRole: Int? = separateBuyer && !isBuyerForOthers ? role : nil
        saving = true
        defer { saving = false }
        do {
            if creating {
                var data: [String: JSONValue] = [:]
                for key in Self.textKeys { data[key] = .string(trimmed(key)) }
                data["rating"] = rating == 0 ? .null : .number(Double(rating))
                data["invoice_buyer_organization_id"] = buyer.isEmpty ? .null : .string(buyer)
                data["invoice_recipient_role"] = recipientRole.map { JSONValue.number(Double($0)) } ?? .null
                let body: [String: JSONValue] = [
                    "kind": .string("organization"), "data": .object(data),
                    "contacts": .array(contactIDs.map { .string($0) }), "signers": .array(signerIDs.map { .string($0) }),
                ]
                let reply = try await store.post("create", body)
                let id = reply["id"]?.text ?? ""
                state.succeed(reply["message"]?.text.nonEmpty ?? "Organizacja dodana pomyślnie")
                if let warning = (reply["warnings"]?.array ?? []).map(\.text).first(where: { !$0.isEmpty }) { state.notice = warning }
                await store.sync(force: true)
                if !id.isEmpty {
                    if let onCreated { onCreated(id) } else { store.open(id, kind: .organization) }
                }
                dismiss()
            } else if let ref = mode.ref {
                var data: [String: JSONValue] = [:]
                for key in Self.textKeys {
                    let value = trimmed(key)
                    guard value != (original[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
                    data[key] = value.isEmpty ? .null : .string(value)
                }
                if rating != originalRating { data["rating"] = rating == 0 ? .null : .number(Double(rating)) }
                if representsSelf != originalRepresentsSelf { data["contact_is_representative"] = .bool(representsSelf) }
                if buyer != originalBuyer || recipientRole != originalRole {
                    data["invoice_buyer_organization_id"] = buyer.isEmpty ? .null : .string(buyer)
                    data["invoice_recipient_role"] = recipientRole.map { JSONValue.number(Double($0)) } ?? .null
                }
                if data.isEmpty { dismiss(); return }
                try await store.save(ref, data: data)
                state.succeed("Dane zaktualizowane")
                dismiss()
            }
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            problem = failure.message
            if let first = Self.fieldOrder.first(where: { errors[$0] != nil }) { focused = first }
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}
