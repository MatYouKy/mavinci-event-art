import SwiftUI

// MARK: Nowe zapytanie i Automatyzacja SLA — 1:1 z `NewInquiryModal` (lejek zapytań, kalendarz; z karty kontaktu — dane
// klienta) i `InquirySlaSettingsModal` ze strony `/crm/inquiries`. Serwer: `/bridge/native/v1/inquiries`
// (`newSetup`, `specialDays`, `create`, `slaSettings`, `slaSave` — `src/lib/native/inquiryCreate.ts`), tokenem pracownika.

/// Klient wskazany z góry (z karty kontaktu — jak `initialClient` w CRM).
struct NewInquiryClient {
    var contactID: String? = nil
    var organizationID: String? = nil
    var name: String
    var email: String? = nil
    var phone: String? = nil
}

struct NewInquirySetup: Decodable {
    struct Organization: Decodable, Identifiable { var id: String; var name: String; var alias: String }
    struct Contact: Decodable, Identifiable {
        var id: String; var firstName: String; var lastName: String; var phone: String; var email: String
        var fullName: String { "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces) }
    }
    struct Location: Decodable, Identifiable { var id: String; var name: String; var address: String; var city: String }
    var organizations: [Organization]
    var contacts: [Contact]
    var locations: [Location]
}

@MainActor final class NewInquiryModel: ObservableObject {
    /// Źródła zapytania wpisywanego ręcznie (`SOURCE_LABELS`).
    static let sources: [(String, String)] = [
        ("phone", "Telefon"), ("meeting", "Rozmowa / spotkanie"), ("referral", "Polecenie"), ("social_media", "Social media"), ("other", "Inne źródło"),
    ]

    weak var workspace: Workspace?
    /// Identyfikator nadany przy otwarciu okna — ponowny zapis nie tworzy duplikatu (jak w CRM).
    let inquiryID = UUID().uuidString.lowercased()

    @Published var subject = ""
    @Published var source = "phone"
    @Published var hasTermin = false
    @Published var termin = Date()
    @Published var scope = ""
    @Published var guestCount = ""
    @Published var budget = ""
    @Published var expectations = ""
    @Published var clientText = ""
    @Published var clientOrganizationID: String?
    @Published var clientContactID: String?
    @Published var clientPhone = ""
    @Published var clientEmail = ""
    @Published var locationText = ""
    @Published var locationID: String?

    @Published var organizations: [NewInquirySetup.Organization] = []
    @Published var contacts: [NewInquirySetup.Contact] = []
    @Published var locations: [NewInquirySetup.Location] = []
    @Published var specialDays: EventSpecialDays?
    @Published var saving = false
    @Published var error: String?

    init(initialDate: Date?, initialClient: NewInquiryClient?) {
        if let initialDate {
            hasTermin = true
            termin = initialDate
        }
        if let initialClient {
            clientText = initialClient.name
            clientOrganizationID = initialClient.organizationID
            clientContactID = initialClient.contactID
            clientPhone = initialClient.phone ?? ""
            clientEmail = initialClient.email ?? ""
        }
    }

    private var api: NativeAPI? { workspace?.nativeAPI() }

    /// Termin jak pole `datetime-local` w CRM: „RRRR-MM-DDTGG:MM” w czasie polskim, puste — bez terminu.
    var terminText: String {
        guard hasTermin else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.string(from: termin)
    }

    func load() async {
        guard let api else { return }
        // Jak w oknie CRM: lista, której nie udało się pobrać, zostaje pusta (pole działa jako zwykły tekst).
        if let data = try? await api.get("/inquiries", query: ["op": "newSetup"]),
           let setup = try? JSONDecoder().decode(NewInquirySetup.self, from: data) {
            organizations = setup.organizations
            contacts = setup.contacts
            locations = setup.locations
        }
    }

    /// Nietypowe dni terminu (`SpecialDayNotice`): święto, niedziela, długi weekend, Sylwester.
    func loadSpecialDays() async {
        let from = terminText
        guard !from.isEmpty, let api else { specialDays = nil; return }
        let days = try? JSONDecoder().decode(EventSpecialDays.self, from: try await api.get("/inquiries", query: ["op": "specialDays", "from": from]))
        guard from == terminText else { return }
        specialDays = days
    }

    // MARK: Podpowiedzi (jak `filteredClients` / `filteredLocations`)
    var filteredOrganizations: [NewInquirySetup.Organization] {
        let query = clientText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return Array(organizations.prefix(20)) }
        return Array(organizations.filter { "\($0.alias) \($0.name)".lowercased().contains(query) }.prefix(10))
    }
    var filteredContacts: [NewInquirySetup.Contact] {
        let query = clientText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return Array(contacts.prefix(20)) }
        return Array(contacts.filter { "\($0.firstName) \($0.lastName) \($0.email) \($0.phone)".lowercased().contains(query) }.prefix(10))
    }
    var filteredLocations: [NewInquirySetup.Location] {
        let query = locationText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return Array(locations.prefix(20)) }
        return Array(locations.filter { "\($0.name) \($0.address) \($0.city)".lowercased().contains(query) }.prefix(20))
    }

    /// Wpisywanie w polu klienta odpina wybraną organizację / osobę (jak w CRM).
    func typeClient(_ value: String) {
        guard value != clientText else { return }
        clientText = value
        clientOrganizationID = nil
        clientContactID = nil
    }
    func typeLocation(_ value: String) {
        guard value != locationText else { return }
        locationText = value
        locationID = nil
    }
    func pick(_ organization: NewInquirySetup.Organization) {
        clientOrganizationID = organization.id
        clientContactID = nil
        clientText = organization.alias.isEmpty ? organization.name : organization.alias
    }
    func pick(_ contact: NewInquirySetup.Contact) {
        clientContactID = contact.id
        clientOrganizationID = nil
        clientText = contact.fullName
        if !contact.phone.isEmpty { clientPhone = contact.phone }
        if !contact.email.isEmpty { clientEmail = contact.email }
    }
    func pick(_ location: NewInquirySetup.Location) {
        locationID = location.id
        locationText = [location.name, location.city].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    // MARK: Zapis
    /// „Zapisz zapytanie” — identyfikator albo `nil` (komunikat w oknie).
    func save() async -> String? {
        guard !saving else { return nil }
        error = nil
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "Podaj temat zapytania."; return nil }
        if [clientText, clientPhone, clientEmail].allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            error = "Podaj przynajmniej dane kontaktowe klienta (nazwa, telefon lub e-mail)."
            return nil
        }
        let guests = guestCount.trimmingCharacters(in: .whitespaces)
        if !guests.isEmpty {
            guard let count = Double(guests), count.rounded() == count, count >= 1, count <= 100_000 else {
                error = "Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste."
                return nil
            }
        }
        guard let workspace, let api, workspace.employee != nil else { error = "Brak aktywnej sesji. Zaloguj się ponownie."; return nil }
        guard workspace.canWrite else { error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        saving = true
        defer { saving = false }
        let form: [String: JSONValue] = [
            "subject": .string(subject), "source": .string(source),
            "termin": .string(terminText), "dueDate": .string(hasTermin ? ISO8601DateFormatter().string(from: termin) : ""),
            "scope": .string(scope), "guestCount": .string(guests), "budget": .string(budget), "expectations": .string(expectations),
            "clientText": .string(clientText), "clientOrganizationId": .string(clientOrganizationID ?? ""),
            "clientContactId": .string(clientContactID ?? ""), "clientPhone": .string(clientPhone), "clientEmail": .string(clientEmail),
            "locationText": .string(locationText), "locationId": .string(locationID ?? ""),
        ]
        do {
            let data = try await api.post("/inquiries", ["op": .string("create"), "id": .string(inquiryID), "form": .object(form)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            return reply["id"]?.text.nonEmpty ?? inquiryID
        } catch {
            if let failure = error as? NativeFailure { self.error = failure.message }
            else if error is URLError { self.error = "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
            else { self.error = "Nieznany błąd" }
            return nil
        }
    }
}

@MainActor struct NewInquirySheet: View {
    /// Po zapisie: identyfikator nowego zapytania.
    let onSaved: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: NewInquiryModel
    @FocusState private var focus: Field?
    @State private var clientOpen = false
    @State private var locationOpen = false

    enum Field: Hashable { case subject, client, phone, email, location, guests, scope, budget, expectations }

    /// `initialDate` — dzień z kalendarza; `initialClient` — klient z karty kontaktu.
    init(initialDate: Date? = nil, initialClient: NewInquiryClient? = nil, onSaved: @escaping (String) -> Void) {
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: NewInquiryModel(initialDate: initialDate, initialClient: initialClient))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "phone.arrow.down.left").foregroundStyle(theme.accent)
                    .frame(width: 34, height: 34).background(theme.accent.opacity(0.12), in: Circle())
                Text("Nowe zapytanie").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            form
            footer
        }
        .frame(minWidth: 600, idealWidth: 680, minHeight: 620, idealHeight: 760)
        .background(theme.page)
        .interactiveDismissDisabled(model.saving)
        .task {
            model.workspace = state
            await model.load()
        }
        .task(id: model.terminText) { await model.loadSpecialDays() }
        .onChange(of: focus) { _, next in
            // Lista podpowiedzi otwarta przy polu; przejście do innego pola ją zamyka (kliknięcie podpowiedzi — nie).
            if next == .client { clientOpen = true } else if next != nil { clientOpen = false }
            if next == .location { locationOpen = true } else if next != nil { locationOpen = false }
        }
        .onAppear { focus = .subject }
    }

    private var form: some View {
        Form {
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled)
            }
            Section {
                TextField("Temat zapytania *", text: $model.subject, prompt: Text("Np. oprawa techniczna wesela 12.09.2027"))
                    .focused($focus, equals: .subject)
                Picker("Źródło zapytania", selection: $model.source) {
                    ForEach(NewInquiryModel.sources, id: \.0) { Text($0.1).tag($0.0) }
                }
                terminRow
            }
            Section {
                clientField
                TextField("Telefon", text: $model.clientPhone, prompt: Text("+48...")).focused($focus, equals: .phone)
                TextField("E-mail", text: $model.clientEmail, prompt: Text("klient@example.com")).focused($focus, equals: .email)
                locationField
            }
            Section {
                TextField("Liczba osób — opcjonalnie", text: $model.guestCount, prompt: Text("Nie ustalono")).focused($focus, equals: .guests)
                TextField("Zakres", text: $model.scope, prompt: Text("Np. nagłośnienie, DJ, konferansjer..."), axis: .vertical)
                    .lineLimit(2...5).focused($focus, equals: .scope)
                TextField("Budżet", text: $model.budget, prompt: Text("Np. 10 000 zł netto")).focused($focus, equals: .budget)
                TextField("Oczekiwania", text: $model.expectations, prompt: Text("Co jest najważniejsze dla klienta?"), axis: .vertical)
                    .lineLimit(3...8).focused($focus, equals: .expectations)
            }
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    @ViewBuilder private var terminRow: some View {
        if model.hasTermin {
            HStack {
                DatePicker("Termin", selection: $model.termin, displayedComponents: [.date, .hourAndMinute])
                    .environment(\.timeZone, MeetingDates.zone)
                Button { model.hasTermin = false } label: { Image(systemName: "xmark.circle") }
                    .buttonStyle(.borderless).help("Usuń termin")
            }
            EventSpecialDaysNotice(days: model.specialDays)
        } else {
            LabeledContent("Termin") {
                Button("Ustaw termin") {
                    model.termin = EventFormDates.suggestedStart
                    model.hasTermin = true
                }
            }
        }
    }

    private var clientField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Klient", text: Binding(get: { model.clientText }, set: { value in
                model.typeClient(value)
                clientOpen = true
            }), prompt: Text("Wyszukaj lub wpisz nazwę..."))
            .focused($focus, equals: .client)
            let organizations = model.filteredOrganizations
            let contacts = model.filteredContacts
            if clientOpen && (!organizations.isEmpty || !contacts.isEmpty) {
                suggestions {
                    if !organizations.isEmpty {
                        suggestionHeader("Organizacje")
                        ForEach(organizations) { organization in
                            suggestion(organization.alias.isEmpty ? organization.name : organization.alias, detail: nil) {
                                model.pick(organization)
                                clientOpen = false
                            }
                        }
                    }
                    if !contacts.isEmpty {
                        suggestionHeader("Osoby kontaktowe")
                        ForEach(contacts) { contact in
                            suggestion(contact.fullName, detail: contact.phone.isEmpty ? nil : contact.phone) {
                                model.pick(contact)
                                clientOpen = false
                            }
                        }
                    }
                }
            }
        }
    }

    private var locationField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Lokalizacja", text: Binding(get: { model.locationText }, set: { value in
                model.typeLocation(value)
                locationOpen = true
            }), prompt: Text("Wyszukaj z bazy lub wpisz..."))
            .focused($focus, equals: .location)
            let locations = model.filteredLocations
            if locationOpen && !locations.isEmpty {
                suggestions {
                    ForEach(locations) { location in
                        let detail = [location.address, location.city].filter { !$0.isEmpty }.joined(separator: ", ")
                        suggestion(location.name, detail: detail.isEmpty ? nil : detail) {
                            model.pick(location)
                            locationOpen = false
                        }
                    }
                }
            }
        }
    }

    private func suggestions<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { content() }
        }
        .frame(maxHeight: 240)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.2)))
    }

    private func suggestionHeader(_ title: String) -> some View {
        Text(title).font(.caption).foregroundStyle(theme.accent.opacity(0.8))
            .padding(.horizontal, 10).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
    }

    private func suggestion(_ title: String, detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).lineLimit(1)
                if let detail { Text(detail).foregroundStyle(.secondary).lineLimit(1) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
            Button {
                Task {
                    if let id = await model.save() {
                        dismiss()
                        onSaved(id)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if model.saving { ProgressView().controlSize(.small) }
                    Text("Zapisz zapytanie")
                }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            .disabled(model.saving)
        }
        .padding(16)
    }
}

// MARK: Automatyzacja SLA

struct InquirySlaSettings: Decodable {
    var isEnabled: Bool
    var unassignedMinutes: Double
    var firstContactMinutes: Double
    var repeatMinutes: Double
    var escalationMinutes: Double
    var maxOwnerReminders: Double
    var offerFollowupDays: [Double]
    var assignmentMode: String
    var requireNextActionAfterContact: Bool
    var defaultNextActionHours: Double
    var autoPromoteCustomerLifecycle: Bool
}

@MainActor final class InquirySlaModel: ObservableObject {
    weak var workspace: Workspace?
    @Published var loaded = false
    @Published var saving = false
    @Published var isEnabled = true
    @Published var assignmentMode = "current"
    @Published var requireNextAction = true
    @Published var defaultNextActionHours = ""
    @Published var autoPromote = true
    @Published var unassignedMinutes = ""
    @Published var firstContactMinutes = ""
    @Published var repeatMinutes = ""
    @Published var escalationMinutes = ""
    @Published var maxOwnerReminders = ""
    @Published var offerFollowupDays = ""

    private var api: NativeAPI? { workspace?.nativeAPI() }

    /// `updateNumber`: co najmniej 1, wartość nieliczbowa — 1.
    static func atLeastOne(_ text: String) -> Double {
        let value = Double(text.trimmingCharacters(in: .whitespaces)) ?? 0
        return max(1, value.isFinite && value != 0 ? value : 1)
    }
    static func display(_ value: Double) -> String { InvoiceMath.plain(value) }
    /// „1, 3, 7” → dni całkowite większe od zera (jak pole w CRM).
    static func days(_ text: String) -> [Int] {
        text.split(separator: ",", omittingEmptySubsequences: false).compactMap { part -> Int? in
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            guard let value = trimmed.isEmpty ? 0 : Double(trimmed), value.rounded() == value, value > 0, value < 1_000_000 else { return nil }
            return Int(value)
        }
    }

    /// `nil` — wczytano; tekst — błąd (okno się zamyka, jak w CRM).
    func load() async -> String? {
        guard let api else { return "Nie udało się pobrać ustawień SLA" }
        struct Reply: Decodable { var settings: InquirySlaSettings }
        do {
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/inquiries", query: ["op": "slaSettings"]))
            let s = reply.settings
            isEnabled = s.isEnabled
            assignmentMode = s.assignmentMode
            requireNextAction = s.requireNextActionAfterContact
            defaultNextActionHours = Self.display(s.defaultNextActionHours)
            autoPromote = s.autoPromoteCustomerLifecycle
            unassignedMinutes = Self.display(s.unassignedMinutes)
            firstContactMinutes = Self.display(s.firstContactMinutes)
            repeatMinutes = Self.display(s.repeatMinutes)
            escalationMinutes = Self.display(s.escalationMinutes)
            maxOwnerReminders = Self.display(s.maxOwnerReminders)
            offerFollowupDays = s.offerFollowupDays.map(Self.display).joined(separator: ", ")
            loaded = true
            return nil
        } catch {
            return (error as? NativeFailure)?.message ?? "Nie udało się pobrać ustawień SLA"
        }
    }

    /// „Zapisz” — `true` po zapisie.
    func save() async -> Bool {
        guard let workspace, let api, loaded else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        saving = true
        defer { saving = false }
        let settings: [String: JSONValue] = [
            "isEnabled": .bool(isEnabled), "assignmentMode": .string(assignmentMode),
            "requireNextActionAfterContact": .bool(requireNextAction), "defaultNextActionHours": .number(Self.atLeastOne(defaultNextActionHours)),
            "autoPromoteCustomerLifecycle": .bool(autoPromote),
            "unassignedMinutes": .number(Self.atLeastOne(unassignedMinutes)), "firstContactMinutes": .number(Self.atLeastOne(firstContactMinutes)),
            "repeatMinutes": .number(Self.atLeastOne(repeatMinutes)), "escalationMinutes": .number(Self.atLeastOne(escalationMinutes)),
            "maxOwnerReminders": .number(Self.atLeastOne(maxOwnerReminders)),
            "offerFollowupDays": .array(Self.days(offerFollowupDays).map { .number(Double($0)) }),
        ]
        do {
            let data = try await api.post("/inquiries", ["op": .string("slaSave"), "settings": .object(settings)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Ustawienia SLA zostały zapisane")
            return true
        } catch {
            workspace.error = (error as? NativeFailure)?.message
                ?? (error is URLError ? "Brak połączenia z serwerem CRM. Spróbuj ponownie." : "Nie udało się zapisać ustawień SLA")
            return false
        }
    }
}

@MainActor struct InquirySlaSettingsSheet: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = InquirySlaModel()

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Automatyzacja SLA").font(.title2.bold())
                Text("Czasy obowiązują wszystkie zapytania i są liczone na serwerze.").font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            if model.loaded {
                settings
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 10) {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button {
                    Task { if await model.save() { dismiss() } }
                } label: {
                    HStack(spacing: 6) {
                        if model.saving { ProgressView().controlSize(.small) }
                        Text("Zapisz")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(!model.loaded || model.saving)
            }
            .padding(16)
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 560, idealHeight: 660)
        .background(theme.page)
        .interactiveDismissDisabled(model.saving)
        .task {
            model.workspace = state
            if let error = await model.load() {
                state.error = error
                dismiss()
            }
        }
    }

    private var settings: some View {
        Form {
            Section {
                Toggle(isOn: $model.isEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Automatyczne przypomnienia")
                        Text("Wyłącza nowe wysyłki bez usuwania historii.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                Picker("Przydzielanie nowych zapytań", selection: $model.assignmentMode) {
                    Text("Dotychczasowe — autor lub wspólna pula").tag("current")
                    Text("Rotacyjne — osoba z najmniejszą liczbą otwartych szans").tag("round_robin")
                }
                Text("Tryb rotacyjny uwzględnia tylko aktywnych pracowników z uprawnieniami sprzedażowymi.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Toggle(isOn: $model.requireNextAction) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Wymagaj kolejnego działania po kontakcie")
                        Text("Jeśli pracownik nie poda terminu, CRM zaplanuje go automatycznie.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if model.requireNextAction {
                    numberRow("Domyślny kolejny kontakt po", $model.defaultNextActionHours, unit: "godz.")
                }
            }
            Section {
                Toggle(isOn: $model.autoPromote) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Aktualizuj etap klienta automatycznie")
                        Text("Wygrana oznacza klienta, a kwalifikacja — potencjalnego klienta.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                numberRow("Nieprzypisane po", $model.unassignedMinutes, unit: "min")
                numberRow("Pierwszy kontakt w", $model.firstContactMinutes, unit: "min")
                numberRow("Powtórz przypomnienie po", $model.repeatMinutes, unit: "min")
                numberRow("Eskaluj do managera po", $model.escalationMinutes, unit: "min")
                numberRow("Liczba przypomnień opiekuna", $model.maxOwnerReminders, unit: "razy")
                TextField("Follow-up po ofercie (dni)", text: $model.offerFollowupDays, prompt: Text("1, 3, 7"))
            }
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    private func numberRow(_ title: String, _ value: Binding<String>, unit: String) -> some View {
        SlaNumberField(title: title, unit: unit, text: value)
    }
}

/// Pole liczby w ustawieniach SLA: po wyjściu z pola — co najmniej 1 (jak `updateNumber` w CRM).
private struct SlaNumberField: View {
    let title: String
    let unit: String
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField("", text: $text)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 90)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onChange(of: focused) { _, isFocused in
                        if !isFocused { text = InquirySlaModel.display(InquirySlaModel.atLeastOne(text)) }
                    }
                Text(unit).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
            }
        }
    }
}
