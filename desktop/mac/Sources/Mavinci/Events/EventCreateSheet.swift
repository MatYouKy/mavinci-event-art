import SwiftUI

// MARK: „Nowy event” (`EventWizard`): krok „Szczegóły” jak w CRM (firma realizująca, nazwa, typ klienta, organizacja i osoba
// kontaktowa z dodaniem nowej, kategoria, termin z informacją o nietypowych dniach, lokalizacja z salami, budżet, status,
// opis; walidacja `eventWizardSchema` na serwerze), potem „Oferta” (kreator oferty na Macu, budżet z oferty) i „Sprzęt”
// (sprzęt z oferty dodaje baza, pozostały — „Zarządzaj sprzętem” w karcie). Serwer: `src/lib/native/eventCreate.ts`
// (`/bridge/native/v1/events`: `createSetup`, `rooms`, `specialDays`, `create`, `createContact`, `createLocation`,
// `budgetFromOffer`). Autor zostaje koordynatorem wydarzenia, jak w CRM.

struct EventCreateSetup: Decodable {
    struct Organization: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var alias: String?
    }
    struct Contact: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var type: String
        var organizationIds: [String]
    }
    struct Category: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct Company: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var nip: String?
        var isDefault: Bool
    }
    var canCreate: Bool
    var organizations: [Organization]
    var contacts: [Contact]
    var categories: [Category]
    var companies: [Company]
    var locations: [EventLocationOption]
}

/// Sale obiektu (`EventRoomSelector`).
struct EventLocationRooms: Decodable {
    struct Room: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var notes: String?
    }
    var error: Bool
    var rooms: [Room]
}

/// Nietypowe dni w terminie (`SpecialDayNotice`).
struct EventSpecialDays: Decodable {
    struct Day: Decodable, Identifiable, Hashable {
        var date: String
        var tone: String
        var message: String
        var id: String { date }
    }
    var days: [Day]
    var more: Int
}

/// Data w formacie dnia (do nietypowych dni).
enum EventFormDates {
    static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    /// Domyślny początek nowego terminu: jutro 18:00 (pole w CRM jest puste — na Macu ustawiamy po kliknięciu).
    static var suggestedStart: Date {
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return Calendar.current.date(bySettingHour: 18, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }
}

extension EventsStore {
    private func eventsGet<T: Decodable>(_ query: [String: String], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/events", query: query))
    }

    private func eventsPost(_ op: String, _ body: [String: JSONValue], pending: String?) async throws -> Data {
        guard let api, let workspace else { throw AppError.configuration }
        guard workspace.canWrite else { throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:]) }
        var payload = body
        payload["op"] = .string(op)
        let request = payload
        if let pending { return try await workspace.withPending(pending) { try await api.post("/events", request) } }
        return try await api.post("/events", request)
    }

    func createSetup() async throws -> EventCreateSetup { try await eventsGet(["op": "createSetup"], as: EventCreateSetup.self) }

    func locationRooms(_ locationID: String) async throws -> EventLocationRooms {
        try await eventsGet(["op": "rooms", "locationId": locationID], as: EventLocationRooms.self)
    }

    func specialDays(from: Date, to: Date?) async throws -> EventSpecialDays {
        try await eventsGet(["op": "specialDays", "from": EventFormDates.day(from), "to": EventFormDates.day(to ?? from)], as: EventSpecialDays.self)
    }

    /// „Dodaj osobę kontaktową” (`handleCreateContact`).
    func createEventContact(_ body: [String: JSONValue]) async throws -> EventCreateSetup.Contact {
        struct Reply: Decodable { var contact: EventCreateSetup.Contact }
        return try JSONDecoder().decode(Reply.self, from: try await eventsPost("createContact", body, pending: "Zapisywanie osoby…")).contact
    }

    /// „Utwórz event” / „Zapisz zmiany” w kreatorze — identyfikator wydarzenia i uwaga (np. brak przypisania do zespołu).
    func createEvent(_ body: [String: JSONValue]) async throws -> (id: String, notice: String?) {
        struct Reply: Decodable { var id: String; var notice: String? }
        let reply = try JSONDecoder().decode(Reply.self, from: try await eventsPost("create", body, pending: "Zapisywanie wydarzenia…"))
        return (reply.id, reply.notice)
    }

    /// Budżet wydarzenia z oferty utworzonej w kreatorze (`loadEquipmentFromOffer`).
    func budgetFromOffer(_ eventID: String) async -> Bool {
        struct Reply: Decodable { var updated: Bool }
        guard let data = try? await eventsPost("budgetFromOffer", ["id": .string(eventID)], pending: nil) else { return false }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.updated == true
    }
}

// MARK: Wspólne elementy formularzy wydarzenia

/// Sale realizacji (`EventRoomSelector`): używane sale i miejsce sceny / DJ-a.
struct EventRoomPicker: View {
    let rooms: EventLocationRooms?
    @Binding var selected: [String]
    @Binding var stage: String?

    var body: some View {
        if let rooms {
            if rooms.error {
                Text("Nie udało się pobrać sal wybranego obiektu. Wybierz obiekt ponownie lub odśwież formularz.")
                    .font(.callout).foregroundStyle(.red)
            } else if !rooms.rooms.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Sale realizacji").font(.callout.weight(.semibold))
                    Text("Wybierz używane sale, także połączone, i wskaż miejsce sceny lub DJ-a.").font(.caption).foregroundStyle(.secondary)
                    ForEach(rooms.rooms) { room in
                        Toggle(isOn: Binding(get: { selected.contains(room.id) }, set: { on in
                            if on { selected.append(room.id) } else { selected.removeAll { $0 == room.id } }
                            if let current = stage, !selected.contains(current) { stage = nil }
                        })) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(room.name)
                                if let notes = room.notes, !notes.isEmpty { Text(notes).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        .toggleStyle(.checkbox)
                    }
                    if !selected.isEmpty {
                        Picker("Scena / DJ", selection: Binding(get: { stage ?? "" }, set: { stage = $0.isEmpty ? nil : $0 })) {
                            Text("Do ustalenia").tag("")
                            ForEach(rooms.rooms.filter { selected.contains($0.id) }) { Text($0.name).tag($0.id) }
                        }
                        .frame(maxWidth: 360)
                    }
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

/// Informacja o nietypowych dniach terminu (`SpecialDayNotice`).
struct EventSpecialDaysNotice: View {
    let days: EventSpecialDays?

    var body: some View {
        if let days, !days.days.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(days.days) { day in
                    let color: Color = day.tone == "danger" ? .red : day.tone == "warning" ? .orange : .blue
                    let symbol: String = day.tone == "danger" ? "calendar.badge.exclamationmark" : day.tone == "warning" ? "exclamationmark.triangle" : "info.circle"
                    Label(day.message, systemImage: symbol)
                        .font(.caption).foregroundStyle(color)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                if days.more > 0 {
                    Text("…i jeszcze \(days.more) nietypowych dni w tym zakresie.").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Wybór zapisanej lokalizacji z wyszukiwaniem (jak `LocationSelector`) i „Dodaj nową”.
struct EventLocationPicker: View {
    let locations: [EventLocationOption]
    let selectedID: String?
    let pick: (EventLocationOption) -> Void
    let add: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var query = ""

    var body: some View {
        let filtered = locations.filter { $0.matches(query) }
        VStack(alignment: .leading, spacing: 6) {
            TextField("Wybierz z listy lub wyszukaj nową lokalizację...", text: $query).textFieldStyle(.roundedBorder)
            HStack {
                Text("Twoje lokalizacje (\(filtered.count))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Dodaj nową", systemImage: "plus", action: add).buttonStyle(.link).font(.caption)
                    .help("Nowa lokalizacja (wyszukiwanie w Mapach Google)")
            }
            ScrollView {
                LazyVStack(spacing: 2) {
                    if filtered.isEmpty {
                        Text(query.isEmpty ? "Brak zapisanych lokalizacji" : "Nie znaleziono lokalizacji „\(query)” w Twojej liście")
                            .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    ForEach(filtered) { location in
                        Button { pick(location) } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "mappin").foregroundStyle(theme.accent)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(location.name).font(.callout.weight(.medium))
                                    let line = [location.address ?? "", [location.city ?? "", location.postal_code ?? ""].filter { !$0.isEmpty }.joined(separator: " ")]
                                        .filter { !$0.isEmpty }.joined(separator: ", ")
                                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if selectedID == location.id { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
                            }
                            .padding(6)
                            .background(selectedID == location.id ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 170)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

/// Pole formularza z etykietą i błędem walidacji.
struct EventFormField<Content: View>: View {
    let title: String
    let error: String?
    @ViewBuilder let content: Content

    init(_ title: String, error: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.error = error
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout.weight(.medium))
            content
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Kreator

@MainActor struct EventCreateSheet: View {
    @ObservedObject var store: EventsStore
    /// Dzień kliknięty w kalendarzu (jak `initialDate` w `EventWizard`): termin od razu ustawiony na ten dzień, 18:00.
    var initialDate: Date? = nil
    /// Rodzaj klienta z „Co chcesz dodać?” w kalendarzu: `business` albo `individual`.
    var initialClientType: String? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var setup: EventCreateSetup?
    @State private var loadError: String?
    @State private var step = 1
    @State private var createdID: String?
    // Krok 1: Szczegóły
    @State private var companyID = ""
    @State private var name = ""
    @State private var clientType = ""
    @State private var organizationID = ""
    @State private var organizationQuery = ""
    @State private var contactID = ""
    @State private var contactQuery = ""
    @State private var categoryID = ""
    @State private var hasStart = false
    @State private var start = EventFormDates.suggestedStart
    @State private var hasEnd = false
    @State private var end = EventFormDates.suggestedStart.addingTimeInterval(6 * 3600)
    @State private var locationText = ""
    @State private var locationID: String?
    @State private var roomIDs: [String] = []
    @State private var stageRoomID: String?
    @State private var rooms: EventLocationRooms?
    @State private var budget = ""
    @State private var status = "inquiry"
    @State private var description = ""
    @State private var specialDays: EventSpecialDays?
    // Nowa osoba kontaktowa
    @State private var showNewContact = false
    @State private var newFirst = ""
    @State private var newLast = ""
    @State private var newEmail = ""
    @State private var newPhone = ""
    @State private var contactErrors: [String: String] = [:]
    @State private var addingLocation = false
    // Walidacja i zapis
    @State private var errors: [String: String] = [:]
    @State private var saveError: String?
    @State private var saveDetails: String?
    @State private var working = false
    // Krok 2: Oferta
    @State private var offerWizard: OfferWizardRoute?
    @State private var offerCreated = false
    @State private var initialApplied = false

    private static let steps = ["Szczegóły", "Oferta", "Sprzęt"]

    private var filteredContacts: [EventCreateSetup.Contact] {
        guard let setup else { return [] }
        if clientType == "business" && !organizationID.isEmpty { return setup.contacts.filter { $0.organizationIds.contains(organizationID) } }
        if clientType == "individual" { return setup.contacts.filter { $0.organizationIds.isEmpty || $0.type == "individual" } }
        return setup.contacts
    }

    private var pendingContact: Bool {
        showNewContact && [newFirst, newLast, newEmail, newPhone].contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if let setup {
                    switch step {
                    case 1: detailsStep(setup)
                    case 2: offerStep
                    default: equipmentStep
                    }
                } else if let loadError {
                    ContentUnavailableView {
                        Label("Nie można otworzyć kreatora", systemImage: "calendar.badge.exclamationmark")
                    } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
                } else {
                    ProgressView("Ładowanie…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            footer
        }
        .frame(minWidth: 760, idealWidth: 820, minHeight: 760, idealHeight: 860)
        .task {
            applyInitialValues()
            await load()
        }
        .interactiveDismissDisabled(working)
        .sheet(isPresented: $addingLocation) {
            AddEventLocationSheet(service: .events(store)) { id in
                Task { await reloadLocations(select: id) }
            }
            .warehouseSheetStyle(state)
        }
        .sheet(item: $offerWizard) { route in
            OfferWizardSheet(store: state.offers, eventID: route.eventID) { _ in
                Task { await offerDone() }
            }
        }
        .task(id: dateKey) { await loadSpecialDays() }
    }

    private var dateKey: String {
        hasStart ? EventFormDates.day(start) + "|" + (hasEnd ? EventFormDates.day(end) : "") : ""
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: step == 1 ? "calendar" : step == 2 ? "doc.text" : "shippingbox").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nowy event").font(.title2.bold())
                    Text("Krok \(step) z \(Self.steps.count): \(Self.steps[step - 1])").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
            }
            HStack(spacing: 6) {
                ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, title in
                    let number = index + 1
                    HStack(spacing: 6) {
                        Image(systemName: number < step ? "checkmark.circle.fill" : number == step ? "\(number).circle.fill" : "\(number).circle")
                            .foregroundStyle(number <= step ? theme.accent : Color.secondary)
                        Text(title).font(.callout).foregroundStyle(number == step ? Color.primary : Color.secondary)
                    }
                    if number < Self.steps.count { Rectangle().fill(Color.secondary.opacity(0.3)).frame(height: 1).frame(maxWidth: .infinity) }
                }
            }
        }
        .padding(18)
    }

    // MARK: Krok 1

    private func detailsStep(_ setup: EventCreateSetup) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !errors.filter({ $0.key != "save-error" }).isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Popraw poniższe pola przed zapisem wydarzenia:").font(.callout.weight(.medium))
                        ForEach(errors.filter { $0.key != "save-error" }.sorted(by: { $0.key < $1.key }), id: \.key) { item in
                            Text("• " + item.value).font(.callout)
                        }
                    }
                    .foregroundStyle(.red)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                if let saveError {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(saveError).font(.callout)
                        if let saveDetails, !saveDetails.isEmpty {
                            DisclosureGroup("Szczegóły dla administratora") {
                                Text(saveDetails).font(.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .font(.caption)
                        }
                    }
                    .foregroundStyle(.red)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Podstawowe informacje o evencie").font(.callout.weight(.medium))
                        Text("Wypełnij wymagane pola. Po utworzeniu eventu będziesz mógł dodać szczegóły takie jak oferta, sprzęt, zespół i logistyka.")
                            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))

                EventFormField("Firma realizująca", error: errors["my_company_id"]) {
                    Picker("Firma realizująca", selection: $companyID) {
                        if setup.companies.isEmpty { Text("Brak dostępnych firm").tag("") }
                        ForEach(setup.companies) { Text($0.name + ($0.nip.map { " · NIP \($0)" } ?? "")).tag($0.id) }
                    }
                    .labelsHidden()
                }
                EventFormField("Nazwa eventu *", error: errors["name"]) {
                    TextField("np. Konferencja Tech Summit 2025", text: $name).textFieldStyle(.roundedBorder)
                }
                clientSection(setup)
                EventFormField("Kategoria", error: errors["category_id"]) {
                    Picker("Kategoria", selection: $categoryID) {
                        Text("Wybierz kategorię").tag("")
                        ForEach(setup.categories) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                }
                datesSection
                EventFormField("Lokalizacja *", error: errors["location"] ?? errors["location_id"]) {
                    if !locationText.isEmpty {
                        Label(locationText, systemImage: "mappin.circle.fill").font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                    }
                    EventLocationPicker(locations: setup.locations, selectedID: locationID, pick: { pickLocation($0) }, add: { addingLocation = true })
                    EventRoomPicker(rooms: rooms, selected: $roomIDs, stage: $stageRoomID)
                    if let error = errors["location_room_ids"] ?? errors["stage_room_id"] { Text(error).font(.caption).foregroundStyle(.red) }
                    Text("Wybierz z zapisanych lokalizacji lub wyszukaj nową w Google Maps").font(.caption).foregroundStyle(.secondary)
                }
                HStack(alignment: .top, spacing: 14) {
                    EventFormField("Budżet (PLN)", error: errors["budget"]) {
                        TextField("0", text: $budget).textFieldStyle(.roundedBorder)
                    }
                    EventFormField("Status", error: errors["status"]) {
                        Picker("Status", selection: $status) {
                            ForEach(EventLabels.statuses, id: \.value) { Text($0.label).tag($0.value) }
                        }
                        .labelsHidden()
                    }
                }
                EventFormField("Opis") {
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $description).font(.body).frame(minHeight: 90)
                        if description.isEmpty {
                            Text("Dodatkowe informacje o evencie...").foregroundStyle(.tertiary).padding(.horizontal, 5).padding(.vertical, 1).allowsHitTesting(false)
                        }
                    }
                    .padding(4).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                }
            }
            .padding(20)
            .disabled(working)
        }
    }

    private func clientTypeCard(_ value: String, title: String, subtitle: String, symbol: String) -> some View {
        let selected = clientType == value
        return Button {
            clientType = value
            organizationID = ""
            contactID = ""
            organizationQuery = ""
            contactQuery = ""
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3).foregroundStyle(selected ? theme.accent : Color.secondary)
                Text(title).font(.callout.weight(.medium))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity).padding(12)
            .background(selected ? theme.accent.opacity(0.12) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(selected ? theme.accent : Color.primary.opacity(0.15)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func clientSection(_ setup: EventCreateSetup) -> some View {
        EventFormField("Typ klienta *", error: errors["clientType"]) {
            HStack(spacing: 10) {
                clientTypeCard("business", title: "Businessowy", subtitle: "Firmy, agencje, organizacje", symbol: "building.2")
                clientTypeCard("individual", title: "Indywidualny", subtitle: "Prywatny, wesela", symbol: "person")
            }
        }
        if clientType == "business" {
            EventFormField("Organizacja", error: errors["organization_id"]) {
                let selected = setup.organizations.first { $0.id == organizationID }
                if let selected {
                    HStack {
                        Label(selected.name + (selected.alias.map { $0.isEmpty ? "" : " (\($0))" } ?? ""), systemImage: "building.2.fill")
                            .foregroundStyle(theme.accent)
                        Spacer()
                        Button("Zmień") { organizationID = ""; contactID = "" }.buttonStyle(.link)
                    }
                } else {
                    TextField("Wyszukaj organizację…", text: $organizationQuery).textFieldStyle(.roundedBorder)
                    let query = organizationQuery.trimmingCharacters(in: .whitespaces).lowercased()
                    let matches = setup.organizations.filter {
                        query.isEmpty || $0.name.lowercased().contains(query) || ($0.alias ?? "").lowercased().contains(query)
                    }
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            ForEach(matches.prefix(60)) { organization in
                                Button { pickOrganization(organization.id) } label: {
                                    Text(organization.name + (organization.alias.map { $0.isEmpty ? "" : " (\($0))" } ?? ""))
                                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(.vertical, 4).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                            if matches.isEmpty { Text("Brak pasujących organizacji").font(.callout).foregroundStyle(.secondary).padding(8) }
                        }
                    }
                    .frame(height: 130)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            if !organizationID.isEmpty {
                EventFormField("Osoba kontaktowa", error: errors["contact_person_id"]) {
                    HStack {
                        Picker("Osoba kontaktowa", selection: $contactID) {
                            Text("Wybierz kontakt").tag("")
                            ForEach(filteredContacts) { Text($0.name).tag($0.id) }
                        }
                        .labelsHidden()
                        Button("Dodaj nową", systemImage: "plus") { contactErrors = [:]; showNewContact = true }.buttonStyle(.link)
                    }
                    if filteredContacts.count == 1 && !contactID.isEmpty {
                        Text("✓ Automatycznie wybrano jedyną osobę kontaktową").font(.caption).foregroundStyle(.green)
                    }
                }
            }
        } else if clientType == "individual" {
            EventFormField("Osoba kontaktowa", error: errors["contact_person_id"]) {
                let selected = setup.contacts.first { $0.id == contactID }
                HStack {
                    if let selected {
                        Label(selected.name, systemImage: "person.fill").foregroundStyle(theme.accent)
                        Spacer()
                        Button("Zmień") { contactID = "" }.buttonStyle(.link)
                    } else {
                        TextField("Wybierz lub dodaj nową osobę", text: $contactQuery).textFieldStyle(.roundedBorder)
                    }
                    Button("Dodaj nową", systemImage: "plus") { contactErrors = [:]; showNewContact = true }.buttonStyle(.link)
                }
                if selected == nil {
                    let query = contactQuery.trimmingCharacters(in: .whitespaces).lowercased()
                    let matches = filteredContacts.filter { query.isEmpty || $0.name.lowercased().contains(query) }
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            ForEach(matches.prefix(60)) { contact in
                                Button { contactID = contact.id } label: {
                                    Text(contact.name).frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 8).padding(.vertical, 4).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                            if matches.isEmpty { Text("Brak pasujących kontaktów").font(.callout).foregroundStyle(.secondary).padding(8) }
                        }
                    }
                    .frame(height: 130)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        if showNewContact { newContactForm }
    }

    private var newContactForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Nowa osoba kontaktowa").font(.callout.weight(.medium))
                Spacer()
                Button { showNewContact = false } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            }
            HStack(alignment: .top, spacing: 8) {
                EventFormField("Imię *", error: contactErrors["first_name"]) { TextField("Imię *", text: $newFirst).textFieldStyle(.roundedBorder) }
                EventFormField("Nazwisko *", error: contactErrors["last_name"]) { TextField("Nazwisko *", text: $newLast).textFieldStyle(.roundedBorder) }
            }
            EventFormField("E-mail", error: contactErrors["email"]) { TextField("Email", text: $newEmail).textFieldStyle(.roundedBorder) }
            EventFormField("Telefon", error: contactErrors["phone"]) { TextField("Telefon", text: $newPhone).textFieldStyle(.roundedBorder) }
            Button(working ? "Zapisywanie osoby…" : "Dodaj osobę kontaktową") { Task { await createContact() } }
                .buttonStyle(.borderedProminent).disabled(working)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private var datesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 14) {
                EventFormField("Data rozpoczęcia *", error: errors["event_date"]) {
                    if hasStart {
                        DatePicker("Data rozpoczęcia", selection: $start).labelsHidden()
                    } else {
                        Button("Wybierz datę i godzinę") {
                            hasStart = true
                            if hasEnd && end <= start { end = start.addingTimeInterval(6 * 3600) }
                        }
                    }
                }
                EventFormField("Data zakończenia", error: errors["event_end_date"]) {
                    if hasEnd {
                        HStack {
                            DatePicker("Data zakończenia", selection: $end, in: (hasStart ? start : Date.distantPast)...).labelsHidden()
                            Button { hasEnd = false } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Bez daty zakończenia")
                        }
                    } else {
                        Button("Dodaj datę zakończenia") {
                            hasEnd = true
                            end = (hasStart ? start : EventFormDates.suggestedStart).addingTimeInterval(6 * 3600)
                        }
                    }
                }
            }
            EventSpecialDaysNotice(days: specialDays)
        }
    }

    // MARK: Kroki 2 i 3

    private var offerStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                if let createdID { offerWizard = OfferWizardRoute(eventID: createdID) }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: offerCreated ? "checkmark.square.fill" : "square").foregroundStyle(.blue)
                    Text(offerCreated ? "Oferta utworzona — możesz utworzyć kolejną" : "Utwórz ofertę dla tego eventu (otwiera kreator oferty)")
                        .foregroundStyle(.blue)
                    Spacer()
                }
                .padding(12)
                .background(Color.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(state.employee?.canView(.offers) != true)
            if state.employee?.canView(.offers) != true {
                Text("Kreator oferty wymaga dostępu do ofert. Ofertę dodasz później ze strony eventu.").font(.callout).foregroundStyle(.secondary)
            } else {
                Text("Te szczegóły możesz dodać później ze strony eventu.").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(20)
    }

    private var equipmentStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "shippingbox").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Sprzęt wydarzenia").font(.headline)
                    Text(offerCreated
                         ? "Sprzęt z produktów oferty został dodany do wydarzenia automatycznie. Pozostały sprzęt dodasz w karcie wydarzenia — „Zarządzaj sprzętem”."
                         : "Sprzęt dodasz w karcie wydarzenia — „Zarządzaj sprzętem” (z rezerwacją i kontrolą dostępności). Sprzęt z produktów oferty dodaje się automatycznie.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Otwórz sprzęt wydarzenia", systemImage: "shippingbox") {
                        if let createdID {
                            dismiss()
                            state.showEvent(createdID, cardTab: "equipment")
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            Spacer()
        }
        .padding(20)
    }

    private var footer: some View {
        HStack {
            Button("Wstecz", systemImage: "chevron.left") { if step > 1 { step -= 1 } }
                .disabled(step == 1 || working)
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working)
            if step > 1 {
                Button("Pomiń") { if step < Self.steps.count { step += 1 } else { finish() } }.disabled(working)
            }
            Button {
                Task { await next() }
            } label: {
                if working { Text("Przetwarzanie...") }
                else if step == 1 { Label(createdID == nil ? "Utwórz event" : "Zapisz zmiany", systemImage: "chevron.right") }
                else if step == Self.steps.count { Label("Zakończ", systemImage: "checkmark") }
                else { Label("Dalej", systemImage: "chevron.right") }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            .disabled(working || setup == nil)
        }
        .padding(16).crmBar()
    }

    // MARK: Czynności

    /// Wartości z kalendarza — raz, przy otwarciu kreatora (ponowne wczytanie danych ich nie nadpisuje).
    private func applyInitialValues() {
        guard !initialApplied else { return }
        initialApplied = true
        if let initialDate {
            let calendar = MeetingDates.calendar
            let day = calendar.startOfDay(for: initialDate)
            start = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: day) ?? day
            hasStart = true
            end = start.addingTimeInterval(6 * 3600)
        }
        if let initialClientType, ["business", "individual"].contains(initialClientType) { clientType = initialClientType }
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.createSetup()
            guard next.canCreate else { throw NativeFailure(status: 403, message: "Nie masz uprawnień do tworzenia wydarzeń.", fieldErrors: [:]) }
            setup = next
            // `CompanySelector` bez opcji „wszystkie”: domyślna działalność albo pierwsza z listy.
            if companyID.isEmpty { companyID = next.companies.first(where: \.isDefault)?.id ?? next.companies.first?.id ?? "" }
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać danych kreatora.")
        }
    }

    private func reloadLocations(select id: String) async {
        guard let next = try? await store.createSetup() else { return }
        setup?.locations = next.locations
        if let location = next.locations.first(where: { $0.id == id }) { pickLocation(location) }
    }

    private func pickOrganization(_ id: String) {
        organizationID = id
        contactID = ""
        // Jedyna osoba kontaktowa organizacji — wybrana automatycznie.
        let contacts = setup?.contacts.filter { $0.organizationIds.contains(id) } ?? []
        if contacts.count == 1 { contactID = contacts[0].id }
    }

    private func pickLocation(_ location: EventLocationOption) {
        let changed = locationID != location.id
        locationText = location.label
        locationID = location.id
        if changed {
            roomIDs = []
            stageRoomID = nil
            rooms = nil
            Task {
                let loaded = (try? await store.locationRooms(location.id)) ?? EventLocationRooms(error: true, rooms: [])
                if locationID == location.id { rooms = loaded }
            }
        }
    }

    private func loadSpecialDays() async {
        guard hasStart else { specialDays = nil; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        specialDays = try? await store.specialDays(from: start, to: hasEnd ? end : nil)
    }

    private func createContact() async {
        var local: [String: String] = [:]
        if newFirst.trimmingCharacters(in: .whitespaces).isEmpty { local["first_name"] = "Wpisz imię osoby kontaktowej." }
        if newLast.trimmingCharacters(in: .whitespaces).isEmpty { local["last_name"] = "Wpisz nazwisko osoby kontaktowej." }
        contactErrors = local
        guard local.isEmpty else { return }
        working = true
        defer { working = false }
        do {
            let contact = try await store.createEventContact([
                "first_name": .string(newFirst), "last_name": .string(newLast), "email": .string(newEmail), "phone": .string(newPhone),
                "clientType": .string(clientType), "organization_id": .string(organizationID),
            ])
            setup?.contacts.append(contact)
            setup?.contacts.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
            contactID = contact.id
            showNewContact = false
            newFirst = ""; newLast = ""; newEmail = ""; newPhone = ""
            contactErrors = [:]
            errors["contact_person_id"] = nil
            state.succeed("Osoba kontaktowa dodana!")
        } catch let failure as NativeFailure {
            contactErrors = failure.fieldErrors
            if failure.fieldErrors.isEmpty { contactErrors["first_name"] = failure.message }
        } catch {
            contactErrors["first_name"] = store.failureText(error, "Nie udało się zapisać osoby kontaktowej. Dane pozostają w formularzu.")
        }
    }

    private func next() async {
        switch step {
        case 1: await saveDetails()
        case Self.steps.count: finish()
        default: step += 1
        }
    }

    /// „Utwórz event” / „Zapisz zmiany” (`handleNext` w kroku 1).
    private func saveDetails() async {
        saveError = nil
        saveDetails = nil
        var local: [String: String] = [:]
        if pendingContact { local["contact_person_id"] = "Zapisz nową osobę przyciskiem „Dodaj osobę kontaktową” albo zamknij jej formularz." }
        if !hasStart { local["event_date"] = "Podaj datę i godzinę rozpoczęcia wydarzenia." }
        if hasStart && hasEnd && end <= start { local["event_end_date"] = "Zakończenie musi być późniejsze niż rozpoczęcie wydarzenia." }
        var body: [String: JSONValue] = [
            "name": .string(name), "clientType": .string(clientType), "my_company_id": .string(companyID),
            "organization_id": .string(clientType == "business" ? organizationID : ""), "contact_person_id": .string(contactID),
            "category_id": .string(categoryID),
            "event_date": hasStart ? JSONValue.string(MeetingDates.iso(start)) : JSONValue.string(""),
            "event_end_date": hasStart && hasEnd ? JSONValue.string(MeetingDates.iso(end)) : JSONValue.string(""),
            "location": .string(locationText), "location_id": .string(locationID ?? ""),
            "location_room_ids": .array(roomIDs.map { JSONValue.string($0) }), "stage_room_id": stageRoomID.map { JSONValue.string($0) } ?? JSONValue.null,
            "budget": .string(budget), "status": .string(status), "description": .string(description),
        ]
        if let createdID { body["id"] = .string(createdID) }
        guard local.isEmpty else {
            errors = local
            return
        }
        working = true
        defer { working = false }
        do {
            let result = try await store.createEvent(body)
            errors = [:]
            if createdID == nil {
                createdID = result.id
                if let notice = result.notice { state.error = notice } else { state.succeed("Event utworzony pomyślnie!") }
            } else {
                state.succeed("Event zaktualizowany!")
            }
            Task { await store.sync(force: true) }
            step = 2
        } catch let failure as NativeFailure {
            var fields = failure.fieldErrors
            saveDetails = fields.removeValue(forKey: "save-error")
            errors = fields
            if fields.isEmpty { saveError = failure.message }
        } catch {
            saveError = store.failureText(error, "Serwer nie zapisał wydarzenia. Dane formularza zostały zachowane.")
        }
    }

    /// Po utworzeniu oferty w kreatorze: budżet wydarzenia z oferty, przejście do kroku „Sprzęt” (jak w CRM).
    private func offerDone() async {
        offerWizard = nil
        offerCreated = true
        state.succeed("Oferta utworzona pomyślnie!")
        if let createdID, await store.budgetFromOffer(createdID) { state.succeed("Budżet zaktualizowany z oferty") }
        step = 3
    }

    /// „Zakończ”: karta nowego wydarzenia.
    private func finish() {
        guard let createdID else { dismiss(); return }
        state.succeed("Event utworzony pomyślnie ze wszystkimi szczegółami!")
        Task { await store.sync(force: true) }
        dismiss()
        state.showEvent(createdID)
    }
}
