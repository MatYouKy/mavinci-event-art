import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: „Informacje podstawowe” — edycja jak `OfferBasicInfo` w CRM: tytuł, liczba osób i stoły, klient (organizacja z osobą
// kontaktową albo klient indywidualny), wydarzenie, termin (z zapytania — tylko podgląd), źródło wyceny i kalkulacja, grafika
// hero, miejsce, ważność, zachowane ustalenia ze starszych ofert i notatki. Zapis `op=basicSave`.

/// Wybór z długiej listy (organizacje, klienci, wydarzenia): pole wyszukiwania pokazuje wybraną pozycję, a lista podpowiedzi
/// rozwija się pod nim dopiero po kliknięciu lub wpisaniu tekstu i zwija po wyborze.
struct OfferPickList<Item: Identifiable & Hashable>: View where Item.ID == String {
    let items: [Item]
    @Binding var selection: String?
    var prompt: String
    /// Maksymalna wysokość rozwiniętej listy.
    var height: CGFloat = 240
    /// Przycisk czyszczenia wyboru.
    var clearable = false
    let title: (Item) -> String
    let detail: (Item) -> String
    @State private var query = ""
    @State private var open = false
    @FocusState private var focused: Bool
    @Environment(\.crmTheme) private var theme

    private var selected: Item? { selection.flatMap { id in items.first { $0.id == id } } }

    private var rows: [Item] {
        let needle = SearchText.fold(query)
        let matching = needle.isEmpty ? items : items.filter { SearchText.fold(title($0) + " " + detail($0)).contains(needle) }
        return Array(matching.prefix(200))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                ZStack(alignment: .leading) {
                    TextField("", text: $query, prompt: Text(focused || selected == nil ? prompt : ""))
                        .textFieldStyle(.plain)
                        .focused($focused)
                        .onSubmit { if let first = rows.first { pick(first) } }
                    if !focused && query.isEmpty, let selected {
                        HStack(spacing: 6) {
                            Text(title(selected)).lineLimit(1)
                            let info = detail(selected)
                            if !info.isEmpty { Text(info).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        .allowsHitTesting(false)
                    }
                }
                if clearable && selection != nil {
                    Button { selection = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.borderless).foregroundStyle(.secondary).help("Wyczyść wybór")
                }
                Button {
                    open.toggle()
                    focused = open
                } label: { Image(systemName: open ? "chevron.up" : "chevron.down") }
                    .buttonStyle(.borderless).foregroundStyle(.secondary).help(open ? "Zwiń listę" : "Rozwiń listę")
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(focused ? theme.accent.opacity(0.6) : Color.primary.opacity(0.15)))
            if open { dropdown }
        }
        .onChange(of: focused) { _, now in
            if now {
                open = true
            } else {
                // Kliknięcie w podpowiedź zabiera fokus z pola — lista zwija się chwilę później, gdy wybór już się zapisał.
                Task {
                    try? await Task.sleep(for: .milliseconds(200))
                    if !focused { close() }
                }
            }
        }
        .onChange(of: query) { _, _ in if focused { open = true } }
    }

    private var dropdown: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { item in
                    Button { pick(item) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark").font(.caption.weight(.semibold))
                                .foregroundStyle(theme.accent).opacity(item.id == selection ? 1 : 0)
                            Text(title(item)).lineLimit(1)
                            Spacer(minLength: 8)
                            Text(detail(item)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .background(item.id == selection ? theme.accent.opacity(0.12) : Color.clear)
                    }
                    .buttonStyle(.plain)
                }
                if rows.isEmpty {
                    Text("Brak pasujących pozycji").font(.caption).foregroundStyle(.secondary).padding(8)
                }
            }
        }
        // Stała wysokość (lista jest w przewijanym formularzu): do ok. 9 wierszy, dalej przewijanie.
        .frame(height: min(height, CGFloat(max(rows.count, 1)) * 27 + 6))
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
    }

    private func pick(_ item: Item) {
        selection = item.id
        close()
        focused = false
    }

    private func close() {
        open = false
        query = ""
    }
}

@MainActor struct OfferBasicInfoSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferEditorData?
    @State private var loadError: String?
    @State private var title = ""
    @State private var clientType = "business"
    @State private var organizationID: String?
    @State private var contactID: String?
    @State private var individualID: String?
    @State private var people: [OfferEditorData.Person] = []
    @State private var loadingPeople = false
    @State private var eventID: String?
    @State private var hasDate = false
    @State private var eventDate = Date()
    @State private var location = ""
    @State private var guests = ""
    @State private var perTable = "10"
    @State private var tables = ""
    @State private var hasValidity = false
    @State private var validUntil = Date()
    @State private var notes = ""
    @State private var pricingSource = "offer"
    @State private var calculationID: String?
    @State private var calculations: [OfferEditorData.Calculation] = []
    @State private var refreshCalculation = false
    @State private var heroData: Data?
    @State private var heroImage: NSImage?
    @State private var removeHero = false
    @State private var heroAlt = ""
    @State private var sections: [OfferEditorData.Section] = []
    @State private var importing = false
    @State private var saving = false
    @State private var problem: String?

    private static let defaultSectionTitles = ["TERMIN I MIEJSCE", "ZAKRES I WYCENA", "KONTAKT I KOORDYNACJA"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Informacje podstawowe").font(.title3.weight(.semibold))
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            if let data {
                ScrollView { form(data).padding(.horizontal, 18).padding(.bottom, 12) }
                    .frame(height: 720)
                    .disabled(saving)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć edycji", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(height: 300)
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity).frame(height: 300)
            }
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || data == nil)
            }
            .padding(18)
        }
        .frame(width: 1120)
        .background(theme.page)
        .task { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { chooseHero(url) }
        }
    }

    // MARK: Formularz
    /// Dwie kolumny: dane klienta i wydarzenia po lewej, wycena, grafika i notatki po prawej.
    @ViewBuilder private func form(_ data: OfferEditorData) -> some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 16) { primaryColumn(data) }.frame(maxWidth: .infinity, alignment: .top)
            VStack(alignment: .leading, spacing: 16) { secondaryColumn(data) }.frame(maxWidth: .infinity, alignment: .top)
        }
    }

    @ViewBuilder private func primaryColumn(_ data: OfferEditorData) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ProductField(label: "Tytuł oferty", help: "Ten tytuł będzie widoczny na stronie oferty i na okładce generowanego PDF.") {
                TextField("", text: Binding(get: { title }, set: { title = String($0.prefix(180)) }),
                          prompt: Text(data.inheritedTitle.isEmpty ? "Np. Obsługa techniczna konferencji" : data.inheritedTitle))
                    .textFieldStyle(.roundedBorder)
            }
            ProductField(label: "Liczba osób") {
                TextField("", text: $guests, prompt: Text("Nie ustalono")).textFieldStyle(.roundedBorder).frame(width: 120)
            }
            .frame(width: 130)
        }
        if data.needsTables {
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Średnio osób przy okrągłym stole") {
                    TextField("", text: $perTable, prompt: Text("10")).textFieldStyle(.roundedBorder).frame(width: 120)
                }
                ProductField(label: "Liczba stołów — opcjonalnie") {
                    TextField("", text: $tables, prompt: Text("Oblicz automatycznie")).textFieldStyle(.roundedBorder).frame(width: 160)
                }
            }
            Text(tablesHint).font(.caption).foregroundStyle(.secondary)
        }

        GroupBox("Klient oferty") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("", selection: $clientType) {
                    Text("Firma / organizacja").tag("business")
                    Text("Klient indywidualny").tag("individual")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                if clientType == "business" {
                    ProductField(label: "Organizacja") {
                        OfferPickList(items: data.organizations, selection: Binding(get: { organizationID }, set: { next in
                            organizationID = next
                            Task { await loadPeople(autoPick: true) }
                        }), prompt: "Szukaj organizacji…", title: { $0.label }, detail: { $0.alias?.isEmpty == false ? $0.name : "" })
                    }
                    ProductField(label: "Osoba kontaktowa") {
                        if organizationID == nil {
                            Text("Najpierw wybierz organizację.").font(.caption).foregroundStyle(.secondary)
                        } else if loadingPeople {
                            ProgressView().controlSize(.small)
                        } else {
                            OfferPickList(items: people, selection: $contactID, prompt: "Szukaj osoby…",
                                          title: { $0.name + ($0.primary == true ? " ★" : "") }, detail: { $0.detail })
                        }
                    }
                } else {
                    OfferPickList(items: data.individuals, selection: $individualID, prompt: "Szukaj klienta po nazwisku, e-mailu lub telefonie…",
                                  title: { $0.name }, detail: { $0.detail })
                }
                Text("Nowego klienta lub osobę kontaktową dodasz w sekcji Kontakty.").font(.caption).foregroundStyle(.secondary)
            }
            .padding(6)
        }

        GroupBox("Event i termin") {
            VStack(alignment: .leading, spacing: 10) {
                ProductField(label: "Powiązany event", help: eventID == nil ? "Bez powiązanego eventu" : nil) {
                    OfferPickList(items: data.events, selection: Binding(get: { eventID }, set: { next in
                        eventID = next
                        Task { await loadCalculations() }
                    }), prompt: "Wyszukaj event po nazwie lub dacie…", clearable: true, title: { $0.name }, detail: { $0.detail })
                }
                if data.fromInquiry {
                    HStack(spacing: 24) {
                        ProductField(label: "Początek eventu") { Text(data.scheduleStart) }
                        ProductField(label: "Koniec eventu") { Text(data.scheduleEnd) }
                    }
                    Text("Termin pobierany z zapytania. Początek i koniec zmienisz w jego sekcji „Miejsce i termin”.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack {
                        Toggle("Początek eventu", isOn: $hasDate)
                        if hasDate {
                            DatePicker("", selection: $eventDate, displayedComponents: [.date, .hourAndMinute]).labelsHidden()
                        }
                    }
                    Text("Termin zapisuje się w tej ofercie i jest używany w jej PDF. Nie zmienia terminu powiązanego eventu.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ProductField(label: "Miejsce eventu", help: "Ta lokalizacja pojawi się na pierwszej stronie oferty. Miejsce wybrane z listy lokalizacji daje też okładce jego „Tło ofert”.") {
                    TextField("", text: $location, prompt: Text("Wyszukaj miejsce lub wpisz własną lokalizację...")).textFieldStyle(.roundedBorder)
                    let matches = placeMatches(data)
                    if !matches.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(matches) { place in
                                Button { location = place.label } label: {
                                    Label(place.label, systemImage: "mappin.and.ellipse").frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain).font(.caption)
                            }
                        }
                        .padding(6)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                HStack {
                    Toggle("Ważna do", isOn: $hasValidity)
                    if hasValidity { DatePicker("", selection: $validUntil, displayedComponents: .date).labelsHidden() }
                }
            }
            .padding(6)
        }

    }

    @ViewBuilder private func secondaryColumn(_ data: OfferEditorData) -> some View {
        GroupBox("Źródło wyceny w ofercie") {
            VStack(alignment: .leading, spacing: 8) {
                Picker("", selection: Binding(get: { pricingSource }, set: { next in
                    pricingSource = next
                    if next == "calculation" && calculationID == nil {
                        calculationID = calculations.first(where: \.accepted)?.id ?? calculations.first?.id
                    }
                    if next == "offer" { calculationID = nil }
                })) {
                    Text("Wycena wynika z pozycji oferty").tag("offer")
                    Text("Wycena wynika z zaakceptowanej kalkulacji").tag("calculation")
                }
                .labelsHidden().fixedSize()
                .disabled(calculations.isEmpty && pricingSource != "calculation")
                if pricingSource == "calculation" {
                    if data.calculationId != nil {
                        Toggle("Zastąp zapisaną wycenę aktualną wersją kalkulacji", isOn: $refreshCalculation)
                    }
                    ProductField(label: "Kalkulacja stanowiąca integralną część oferty",
                                 help: "Przy wyborze kalkulacji oferta zachowa jej własną wersję. Późniejsze zmiany kalkulacji nie zmienią tej oferty.") {
                        Picker("", selection: Binding(get: { calculationID ?? "" }, set: { calculationID = $0.isEmpty ? nil : $0 })) {
                            Text("Wybierz kalkulację").tag("")
                            ForEach(calculations) { item in Text(item.label + (item.accepted ? " · zaakceptowana" : "")).tag(item.id) }
                        }
                        .labelsHidden().fixedSize()
                    }
                }
                if calculations.isEmpty {
                    Text("Brak kalkulacji powiązanych z tym eventem lub zapytaniem.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(6)
        }

        GroupBox("Indywidualna grafika hero oferty") {
            HStack(alignment: .top, spacing: 14) {
                heroPreview
                    .frame(width: 220, height: 130)
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first else { return false }
                        chooseHero(url)
                        return true
                    }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Po wgraniu zastąpi grafikę hero ustawioną w szablonie tylko dla tej oferty. JPG, PNG lub WEBP, maks. 12 MB.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button(hasHero ? "Zmień…" : "Wybierz zdjęcie…") { importing = true }
                        if hasHero { Button("Przywróć grafikę szablonu") { heroData = nil; heroImage = nil; removeHero = true } }
                    }
                    .controlSize(.small)
                    if hasHero {
                        Text(heroData != nil ? "Nowa grafika zostanie zapisana z ofertą" : "Ta oferta ma własną grafikę hero")
                            .font(.caption).foregroundStyle(.secondary)
                        ProductField(label: "Opis zdjęcia") {
                            TextField("", text: $heroAlt, prompt: Text("np. Hotel i centrum konferencyjne klienta")).textFieldStyle(.roundedBorder)
                        }
                    }
                }
            }
            .padding(6)
        }

        if showsSections {
            DisclosureGroup("Zapisane dodatkowe warunki ze starszej wersji") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Wcześniej zapisane warunki pozostają w PDF. Nowe założenia edytuj w trzech kartach założeń. Puste dodatkowe karty nie będą drukowane.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(sections.indices, id: \.self) { index in
                        HStack(alignment: .top, spacing: 8) {
                            Text(String(format: "%02d", index + 3)).font(.callout.weight(.bold)).foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("", text: $sections[index].title).textFieldStyle(.roundedBorder)
                                ProductTextArea(text: $sections[index].content, prompt: "Dodatkowe ustalenie ze starszej oferty. Puste pole nie będzie drukowane.", lines: 2...5)
                            }
                        }
                    }
                }
                .padding(.top, 6)
            }
        }

        ProductField(label: "Notatki") { ProductTextArea(text: $notes, prompt: "Dodaj notatki...", lines: 4...12) }
    }

    private var hasHero: Bool { heroData != nil || (!removeHero && store.details[offerID]?.basic.heroPath != nil) }

    @ViewBuilder private var heroPreview: some View {
        if let heroImage {
            Image(nsImage: heroImage).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 8))
        } else if !removeHero, let basic = store.details[offerID]?.basic, let path = basic.heroPath, let url = basic.heroUrl {
            ProductThumb(path: path, url: url, corner: 8)
        } else {
            RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05))
                .overlay {
                    VStack(spacing: 4) {
                        Image(systemName: "photo").font(.title2)
                        Text("Przeciągnij zdjęcie lub kliknij „Wybierz zdjęcie”").font(.caption)
                    }
                    .foregroundStyle(.secondary)
                }
        }
    }

    private var showsSections: Bool {
        sections.enumerated().contains { index, section in
            !section.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || (index < Self.defaultSectionTitles.count && section.title != Self.defaultSectionTitles[index])
        }
    }

    private var tablesHint: String {
        let count = Int(guests) ?? 0
        let capacity = Int(perTable) ?? 0
        let computed = !tables.isEmpty ? tables : (count > 0 && capacity > 0 ? String(Int((Double(count) / Double(capacity)).rounded(.up))) : "")
        return (computed.isEmpty ? "" : "Do wyceny: \(computed) stołów. ") + "Liczbę stołów zaokrąglamy w górę. Możesz wpisać rzeczywistą liczbę zamiast wyliczonej."
    }

    private func placeMatches(_ data: OfferEditorData) -> [OfferEditorData.Place] {
        let needle = SearchText.fold(location)
        guard needle.count >= 2, !data.locations.contains(where: { $0.label == location }) else { return [] }
        return Array(data.locations.filter { SearchText.fold($0.search + " " + $0.label).contains(needle) }.prefix(6))
    }

    // MARK: Wczytanie i zapis
    private func load() async {
        loadError = nil
        do {
            let next = try await store.editor(offerID)
            title = next.title
            clientType = next.clientType
            organizationID = next.clientType == "business" ? next.organizationId : nil
            contactID = next.clientType == "business" ? next.contactId : nil
            individualID = next.clientType == "individual" ? next.contactId : nil
            eventID = next.eventId
            if let raw = next.eventDate, let date = OfferText.date(raw) { hasDate = true; eventDate = date } else { hasDate = false }
            location = next.location
            guests = next.guestCount.map { String(Int($0)) } ?? ""
            perTable = String(Int(next.guestsPerTable))
            tables = next.tableCount.map { String(Int($0)) } ?? ""
            if let raw = next.validUntil, let date = OfferText.date(raw) { hasValidity = true; validUntil = date } else { hasValidity = false }
            notes = next.notes
            pricingSource = next.pricingSource
            calculationID = next.calculationId
            calculations = next.calculations
            heroAlt = next.heroAlt
            sections = next.infoSections
            data = next
            if organizationID != nil { await loadPeople(autoPick: false) }
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać danych oferty.")
        }
    }

    /// Osoby kontaktowe organizacji; przy zmianie organizacji domyślnie osoba główna (jak `fetchBusinessContacts(true)`).
    private func loadPeople(autoPick: Bool) async {
        guard let organizationID else { people = []; contactID = nil; return }
        loadingPeople = true
        defer { loadingPeople = false }
        do {
            let list = try await store.contacts(organization: organizationID)
            guard self.organizationID == organizationID else { return }
            people = list
            if autoPick, !list.contains(where: { $0.id == contactID }) {
                contactID = list.first(where: { $0.primary == true })?.id ?? list.first?.id
            }
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać osób kontaktowych.")
        }
    }

    private func loadCalculations() async {
        let event = eventID
        do {
            let list = try await store.calculations(offerID, event: event)
            guard eventID == event else { return }
            calculations = list
            if let calculationID, !list.contains(where: { $0.id == calculationID }) { self.calculationID = nil }
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać kalkulacji.")
        }
    }

    private func chooseHero(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let allowed = [UTType.jpeg, .png, .webP].contains { type?.conforms(to: $0) == true }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard allowed, size > 0 else { problem = "Wybierz zdjęcie JPG, PNG lub WEBP"; return }
        guard size <= 12 * 1024 * 1024 else { problem = "Zdjęcie może mieć maksymalnie 12 MB"; return }
        guard let encoded = ProductImageEncoder.encode(url) else { problem = "Nie udało się przygotować zdjęcia."; return }
        heroData = encoded.data
        heroImage = encoded.image
        removeHero = false
        problem = nil
    }

    /// Liczba całkowita z pola; puste pole — brak wartości.
    private func whole(_ text: String) -> Double? { Int(text.trimmingCharacters(in: .whitespaces)).map(Double.init) }
    /// Pole wypełnione czymś, co nie jest liczbą całkowitą.
    private func invalid(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && Int(trimmed) == nil
    }

    private func save() async {
        guard data != nil else { return }
        let contact = clientType == "business" ? contactID : individualID
        if clientType == "individual" && contact == nil { problem = "Wybierz klienta indywidualnego"; return }
        if clientType == "business" && organizationID == nil { problem = "Wybierz organizację"; return }
        if pricingSource == "calculation" && calculationID == nil { problem = "Wybierz kalkulację, która ma stanowić podstawę wyceny"; return }
        let guestCount = whole(guests)
        let tableCount = whole(tables)
        guard !invalid(guests), !invalid(tables), let capacity = Int(perTable.trimmingCharacters(in: .whitespaces)), (1...100).contains(capacity),
              guestCount.map({ (1...100_000).contains($0) }) ?? true, tableCount.map({ (1...100_000).contains($0) }) ?? true else {
            problem = "Podaj poprawną liczbę osób i stołów oraz od 1 do 100 osób przy stole."
            return
        }
        var fields: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "clientType": .string(clientType),
            "organizationId": clientType == "business" ? (organizationID.map { JSONValue.string($0) } ?? .null) : .null,
            "contactId": contact.map { JSONValue.string($0) } ?? .null,
            "eventId": eventID.map { JSONValue.string($0) } ?? .null,
            "eventDate": .string(hasDate ? MeetingDates.iso(eventDate) : ""),
            "location": .string(location),
            "guestCount": guestCount.map { JSONValue.number($0) } ?? .null,
            "guestsPerTable": .number(Double(capacity)),
            "tableCount": tableCount.map { JSONValue.number($0) } ?? .null,
            "validUntil": .string(hasValidity ? MeetingDates.format(validUntil, "yyyy-MM-dd") : ""),
            "notes": .string(notes),
            "pricingSource": .string(pricingSource),
            "calculationId": pricingSource == "calculation" ? (calculationID.map { JSONValue.string($0) } ?? .null) : .null,
            "heroAlt": .string(heroAlt),
            "infoSections": .array(sections.map { .object(["key": .string($0.key), "title": .string($0.title), "content": .string($0.content)]) }),
        ]
        if data?.fromInquiry == true { fields["eventDate"] = .null }
        var body: [String: JSONValue] = ["fields": .object(fields), "refreshCalculation": .bool(refreshCalculation)]
        if let heroData { body["hero"] = .object(["data": .string(heroData.base64EncodedString())]) }
        else if removeHero { body["hero"] = .object(["remove": .bool(true)]) }
        problem = nil
        saving = true
        defer { saving = false }
        if await store.change(offerID, "basicSave", body, success: "Informacje podstawowe zapisane", timeout: 120) {
            if let heroData, let image = heroImage, let path = store.details[offerID]?.basic.heroPath, !heroData.isEmpty {
                ProductImageCache.shared.store(image, path: path)
            }
            dismiss()
        } else if let message = store.workspace?.error {
            problem = message
        }
    }
}
