import SwiftUI

// MARK: Dane strukturalne Schema.org — 1:1 z `/crm/page/schema-org`: dane globalne organizacji (podgląd i edycja),
// obszary obsługi (`areaServed`: dodawanie z bazy miast, edycja, usuwanie), „Dodaj miasto” do sugestii (wyszukiwanie
// Google uzupełnia nazwę, kod i województwo) oraz „Wyjątki odmiany” nazw miast.

private let globalTextFields: [(key: String, label: String, prompt: String)] = [
    ("organization_name", "Nazwa organizacji", ""), ("organization_url", "URL organizacji", "https://"),
    ("organization_logo", "Logo (URL)", "https://"), ("telephone", "Telefon", ""), ("email", "Email", ""),
]
private let socialFields: [(key: String, label: String)] = [
    ("facebook_url", "Facebook"), ("instagram_url", "Instagram"), ("linkedin_url", "LinkedIn"), ("youtube_url", "YouTube"), ("twitter_url", "Twitter/X"),
]
private let addressFields: [(key: String, label: String)] = [
    ("street_address", "Ulica"), ("locality", "Miasto"), ("postal_code", "Kod pocztowy"), ("region", "Województwo"),
]

@MainActor struct WebsiteSchemaView: View {
    @ObservedObject var store: WebsiteStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editingGlobal = false
    @State private var globalDraft: [String: String] = [:]
    @State private var adding = false
    @State private var citySearch = ""
    @State private var suggestions: [PolishCitySuggestion] = []
    @State private var newPlace: PolishCitySuggestion?
    @State private var editingPlace: String?
    @State private var placeDraft = SchemaPlace(id: "", name: "", locality: "", postalCode: "", region: "", order: 0)
    @State private var removing: SchemaPlace?
    @State private var addingCity = false
    @State private var showingCases = false

    private var canEdit: Bool { store.schema?.access.canEdit ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Dane strukturalne Schema.org").font(.title2.weight(.light))
                    Text("Globalna konfiguracja danych strukturalnych dla wszystkich podstron").foregroundStyle(.secondary)
                }
                if let schema = store.schema {
                    if !canEdit {
                        Label("Edycja danych strukturalnych wymaga uprawnienia do edycji strony WWW.", systemImage: "lock")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        globalCard(schema)
                        placesCard(schema)
                    }
                } else if let error = store.schemaError {
                    ContentUnavailableView("Schema.org", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .task(id: state.employee?.id) { await store.loadSchema() }
        .task(id: citySearch) { await searchCities() }
        .sheet(isPresented: $addingCity) {
            AddPolishCitySheet(store: store).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $showingCases) {
            CityCasesSheet(store: store).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć miejsce?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let place = removing {
                Button("Usuń", role: .destructive) {
                    Task { if await store.run("Usuwanie…", "placeDelete", ["id": .string(place.id)]) != nil { await store.loadSchema() } }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno usunąć to miejsce?") }
    }

    // MARK: Dane globalne

    private func value(_ schema: SchemaState, _ key: String) -> String { schema.global?[key] ?? "" }

    private func globalCard(_ schema: SchemaState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Dane globalne", systemImage: "globe").font(.headline)
                Spacer()
                if canEdit && schema.global != nil {
                    if editingGlobal {
                        Button("Zapisz", systemImage: "square.and.arrow.down") { Task { await saveGlobal(schema) } }.buttonStyle(.borderedProminent)
                        Button("Anuluj", systemImage: "xmark") { editingGlobal = false }
                    } else {
                        Button("Edytuj", systemImage: "pencil") { globalDraft = schema.global ?? [:]; editingGlobal = true }
                    }
                }
            }
            if schema.global == nil {
                Text("Brak konfiguracji danych globalnych.").foregroundStyle(.secondary)
            } else {
                ForEach(globalTextFields, id: \.key) { field in globalField(schema, field.key, field.label, field.prompt) }
                Text("Social Media (sameAs)").font(.callout.weight(.semibold)).padding(.top, 4)
                ForEach(socialFields, id: \.key) { field in globalField(schema, field.key, field.label, "https://\(field.label.lowercased()).com/...") }
                Text("Adres głównej siedziby").font(.callout.weight(.semibold)).padding(.top, 4)
                if editingGlobal {
                    ForEach(addressFields, id: \.key) { field in
                        TextField(field.label, text: Binding(get: { globalDraft[field.key] ?? "" }, set: { globalDraft[field.key] = $0 })).textFieldStyle(.roundedBorder)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(value(schema, "street_address"))
                        Text([value(schema, "locality"), value(schema, "postal_code")].filter { !$0.isEmpty }.joined(separator: " "))
                        Text(value(schema, "region"))
                    }
                    .textSelection(.enabled)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func globalField(_ schema: SchemaState, _ key: String, _ label: String, _ prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            if editingGlobal {
                TextField(label, text: Binding(get: { globalDraft[key] ?? "" }, set: { globalDraft[key] = $0 }), prompt: Text(prompt))
                    .textFieldStyle(.roundedBorder).labelsHidden()
            } else {
                Text(value(schema, key).nonEmpty ?? "-").textSelection(.enabled)
            }
        }
    }

    private func saveGlobal(_ schema: SchemaState) async {
        guard let id = schema.global?["id"] else { return }
        var values: [String: JSONValue] = [:]
        for key in globalTextFields.map(\.key) + socialFields.map(\.key) + addressFields.map(\.key) {
            values[key] = .string(globalDraft[key] ?? "")
        }
        if await store.run("Zapisywanie…", "schemaGlobal", ["id": .string(id), "values": .object(values)]) != nil {
            editingGlobal = false
            await store.loadSchema()
        }
    }

    // MARK: Obszary obsługi

    private func placesCard(_ schema: SchemaState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Obszary obsługi (\(schema.places.count))", systemImage: "mappin.and.ellipse").font(.headline)
                Spacer()
                if canEdit {
                    Button("Dodaj do obszarów", systemImage: "plus") { adding = true }
                    Button("Dodaj miasto", systemImage: "mappin") { addingCity = true }.buttonStyle(.borderedProminent)
                }
                Button("Wyjątki odmiany", systemImage: "book") { showingCases = true }
            }
            Text("Te miejsca będą dostępne jako areaServed na wszystkich podstronach").font(.callout).foregroundStyle(.secondary)
            if adding { addPanel(schema) }
            ForEach(schema.places) { place in placeRow(place) }
            if schema.places.isEmpty { Text("Brak obszarów obsługi.").foregroundStyle(.secondary) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func addPanel(_ schema: SchemaState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Wpisz nazwę miasta (np. Olsztyn)", text: $citySearch).textFieldStyle(.roundedBorder)
            if !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(suggestions) { city in
                        Button {
                            newPlace = city; citySearch = ""; suggestions = []
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(city.name)
                                Text([city.postalCode, city.region].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(6).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Wybrane miasto:").font(.caption).foregroundStyle(.secondary)
                if let place = newPlace {
                    Text(place.name).fontWeight(.semibold)
                    Text([place.slug, place.postalCode, place.region].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Wyszukaj miasto...").foregroundStyle(.secondary)
                }
            }
            HStack {
                Spacer()
                Button("Anuluj") { adding = false; newPlace = nil; citySearch = "" }
                Button("Dodaj") { Task { await addPlace() } }.buttonStyle(.borderedProminent).disabled(newPlace == nil)
            }
        }
        .padding(12)
        .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private func placeRow(_ place: SchemaPlace) -> some View {
        if editingPlace == place.id {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Nazwa", text: $placeDraft.name).textFieldStyle(.roundedBorder)
                HStack {
                    TextField("Miejscowość (slug)", text: $placeDraft.locality).textFieldStyle(.roundedBorder)
                    TextField("Kod pocztowy", text: $placeDraft.postalCode).textFieldStyle(.roundedBorder).frame(width: 120)
                }
                TextField("Województwo", text: $placeDraft.region).textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Anuluj", systemImage: "xmark") { editingPlace = nil }
                    Button("Zapisz", systemImage: "square.and.arrow.down") { Task { await updatePlace() } }.buttonStyle(.borderedProminent)
                }
            }
            .padding(10)
            .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        } else {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name).fontWeight(.semibold)
                    Text(place.locality + (place.postalCode.isEmpty ? "" : " · \(place.postalCode)")).font(.caption).foregroundStyle(.secondary)
                    Text(place.region).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if canEdit {
                    Button { placeDraft = place; editingPlace = place.id } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                    Button { removing = place } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red).help("Usuń")
                }
            }
            .padding(10)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func searchCities() async {
        let query = citySearch.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { suggestions = []; return }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        suggestions = (try? await store.cities(query)) ?? []
    }

    private func addPlace() async {
        guard let place = newPlace else { state.error = "Wypełnij wymagane pola"; return }
        let body: [String: JSONValue] = ["name": .string(place.name), "locality": .string(place.slug), "postalCode": .string(place.postalCode), "region": .string(place.region)]
        if await store.run("Dodawanie…", "placeAdd", body) != nil {
            adding = false; newPlace = nil; citySearch = ""
            await store.loadSchema()
        }
    }

    private func updatePlace() async {
        let body: [String: JSONValue] = ["id": .string(placeDraft.id), "name": .string(placeDraft.name), "locality": .string(placeDraft.locality),
                                         "postalCode": .string(placeDraft.postalCode), "region": .string(placeDraft.region)]
        if await store.run("Zapisywanie…", "placeUpdate", body) != nil {
            editingPlace = nil
            await store.loadSchema()
        }
    }
}

/// „Dodaj miasto do sugestii” (`AddPolishCityModal`): nazwa, slug, województwo, kod, liczba ludności; wyszukiwanie Google uzupełnia pola.
@MainActor struct AddPolishCitySheet: View {
    @ObservedObject var store: WebsiteStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slug = ""
    @State private var region = ""
    @State private var postalCode = ""
    @State private var population = ""
    @State private var formattedAddress = ""
    @State private var search = ""
    @State private var predictions: [CrmPlacePrediction] = []
    @State private var session = UUID().uuidString
    @State private var busy = false
    @State private var problem: String?

    static func slugify(_ value: String) -> String {
        let map: [Character: String] = ["ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z"]
        let lowered = value.lowercased().trimmingCharacters(in: .whitespaces)
        var out = ""
        for ch in lowered {
            if let mapped = map[ch] { out += mapped }
            else if ch == " " || ch == "\t" { out += "-" }
            else if ch.isASCII && (ch.isLetter || ch.isNumber || ch == "-") { out.append(ch) }
        }
        return out.replacingOccurrences(of: #"-{2,}"#, with: "-", options: .regularExpression)
    }

    var body: some View {
        FleetSheetFrame(title: "Dodaj miasto do sugestii", subtitle: "Wyszukaj miasto — formularz uzupełni się automatycznie", symbol: "mappin.and.ellipse",
                        submitTitle: "Dodaj miasto", busy: busy, canSubmit: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                        problem: problem, width: 620, height: 640) { save() } content: {
            Section("Wybór miasta") {
                TextField("Wyszukaj miasto w Mapach Google…", text: $search)
                ForEach(predictions) { prediction in
                    Button { Task { await choose(prediction) } } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(prediction.main)
                            if !prediction.secondary.isEmpty { Text(prediction.secondary).font(.caption).foregroundStyle(.secondary) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if !formattedAddress.isEmpty { LabeledContent("Wybrana lokalizacja", value: formattedAddress) }
            }
            Section {
                TextField("Nazwa miasta *", text: Binding(get: { name }, set: { name = $0; slug = Self.slugify($0) }), prompt: Text("np. Olsztyn"))
                TextField("Slug *", text: Binding(get: { slug }, set: { slug = Self.slugify($0) }), prompt: Text("np. olsztyn"))
                TextField("Region *", text: $region, prompt: Text("np. Województwo Warmińsko-Mazurskie"))
                TextField("Kod pocztowy", text: $postalCode, prompt: Text("opcjonalnie"))
                TextField("Liczba ludności", text: $population, prompt: Text("opcjonalnie"))
            }
        }
        .task(id: search) { await lookup() }
    }

    private func lookup() async {
        let input = search.trimmingCharacters(in: .whitespaces)
        guard input.count >= 2 else { predictions = []; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        predictions = (try? await store.citySearch(input, session: session)) ?? []
    }

    private func choose(_ prediction: CrmPlacePrediction) async {
        do {
            let place = try await store.cityPlace(prediction.placeId, session: session)
            session = UUID().uuidString
            predictions = []
            search = ""
            if !place.name.isEmpty { name = place.name; slug = Self.slugify(place.name) }
            if !place.postalCode.isEmpty { postalCode = place.postalCode }
            if !place.region.isEmpty { region = place.region }
            formattedAddress = place.formattedAddress
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać szczegółów miejsca.")
        }
    }

    private func save() {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Nazwa miasta jest wymagana"; return }
        if slug.isEmpty { problem = "Slug miasta jest wymagany"; return }
        if region.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Region jest wymagany"; return }
        busy = true
        problem = nil
        Task {
            let body: [String: JSONValue] = ["name": .string(name), "slug": .string(slug), "region": .string(region), "postalCode": .string(postalCode), "population": .string(population)]
            let ok = await store.run("Dodawanie miasta…", "cityAdd", body) != nil
            busy = false
            if ok { dismiss() }
        }
    }
}

/// „Wyjątki odmiany miast” (`CityCasesModal`): dopełniacz i miejscownik z przyimkiem dla nazw o nietypowej odmianie.
@MainActor struct CityCasesSheet: View {
    @ObservedObject var store: WebsiteStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var cases: [CityCaseItem] = []
    @State private var loaded = false
    @State private var adding = false
    @State private var draft = CityCaseItem(id: "", cityKey: "", nominative: "", genitive: "", locative: "", preposition: "w")
    @State private var editing: String?
    @State private var editDraft = CityCaseItem(id: "", cityKey: "", nominative: "", genitive: "", locative: "", preposition: "w")
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Wyjątki odmiany miast", systemImage: "book").font(.title3.weight(.semibold))
                Spacer()
                if !adding { Button("Dodaj", systemImage: "plus") { draft = CityCaseItem(id: "", cityKey: "", nominative: "", genitive: "", locative: "", preposition: "w"); adding = true } }
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(18)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let problem { Text(problem).foregroundStyle(.orange).font(.callout) }
                    if adding {
                        caseForm($draft)
                        HStack {
                            Spacer()
                            Button("Anuluj", systemImage: "xmark") { adding = false }
                            Button("Zapisz", systemImage: "square.and.arrow.down") { Task { await add() } }.buttonStyle(.borderedProminent)
                                .disabled(draft.cityKey.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    if !loaded { ProgressView().frame(maxWidth: .infinity) }
                    ForEach(cases) { item in
                        if editing == item.id {
                            VStack(alignment: .leading, spacing: 6) {
                                caseForm($editDraft)
                                HStack {
                                    Spacer()
                                    Button("Anuluj") { editing = nil }
                                    Button("Zapisz", systemImage: "square.and.arrow.down") { Task { await update() } }.buttonStyle(.borderedProminent)
                                }
                            }
                            .padding(10).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                        } else {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.nominative.nonEmpty ?? item.cityKey).fontWeight(.semibold)
                                    Text("\(item.genitive) / \(item.preposition) \(item.locative)").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(item.cityKey).font(.caption.monospaced()).foregroundStyle(.secondary)
                                Button { editDraft = item; editing = item.id } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                                Button { Task { await remove(item) } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red).help("Usuń")
                            }
                            .padding(10).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    if loaded && cases.isEmpty && !adding { Text("Brak wyjątków odmiany.").foregroundStyle(.secondary) }
                }
                .padding(18)
            }
        }
        .frame(width: 640, height: 620)
        .background(theme.page)
        .task { await load() }
    }

    private func caseForm(_ item: Binding<CityCaseItem>) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
            GridRow {
                Text("Klucz miasta")
                TextField("city_key (np. łódź)", text: item.cityKey).textFieldStyle(.roundedBorder)
            }
            GridRow {
                Text("Mianownik")
                TextField("np. Wrocław", text: item.nominative).textFieldStyle(.roundedBorder)
            }
            GridRow {
                Text("Dopełniacz")
                TextField("np. Wrocławia", text: item.genitive).textFieldStyle(.roundedBorder)
            }
            GridRow {
                Text("Miejscownik")
                HStack {
                    Picker("Przyimek", selection: item.preposition) {
                        Text("w").tag("w")
                        Text("we").tag("we")
                    }
                    .labelsHidden().fixedSize()
                    TextField("Wrocławiu", text: item.locative).textFieldStyle(.roundedBorder)
                }
            }
        }
        .font(.callout)
    }

    private func payload(_ item: CityCaseItem) -> [String: JSONValue] {
        ["cityKey": .string(item.cityKey), "nominative": .string(item.nominative), "genitive": .string(item.genitive),
         "locative": .string(item.locative), "preposition": .string(item.preposition)]
    }

    private func load() async {
        do { cases = try await store.cityCases(); problem = nil } catch { problem = store.failureText(error, "Nie udało się pobrać wyjątków odmiany.") }
        loaded = true
    }

    private func add() async {
        if await store.run("Zapisywanie…", "caseAdd", payload(draft)) != nil { adding = false; await load() }
    }

    private func update() async {
        var request = payload(editDraft)
        request["id"] = .string(editDraft.id)
        if await store.run("Zapisywanie…", "caseUpdate", request) != nil { editing = nil; await load() }
    }

    private func remove(_ item: CityCaseItem) async {
        if await store.run("Usuwanie…", "caseDelete", ["id": .string(item.id)]) != nil { await load() }
    }
}
