import SwiftUI

// MARK: Arkusze karty kontaktu i organizacji — jak okna w `/crm/contacts/[id]`: osoba kontaktowa (z listy albo nowa), powiązanie
// kontaktu z organizacją, osoba decyzyjna (`OrganizationRepresentatives`), segmentacja i komunikacja (`CustomerSegmentationPanel`),
// scalanie duplikatu (`Customer360Panel`) i nowa lokalizacja (`AddLocationModal`). Zapis przez `/bridge/native/v1/contacts`.

extension ContactsStore {
    /// Zapis z arkusza karty: komunikat i ostrzeżenia serwera, odświeżenie karty i listy. Błąd — wyjątek (błędy pól pokazuje arkusz).
    func submit(_ op: String, _ body: [String: JSONValue], reload ref: ContactRef?) async throws -> [String: JSONValue] {
        guard workspace?.canWrite == true else { throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:]) }
        let reply = try await post(op, body)
        if let message = reply["message"]?.text.nonEmpty { workspace?.succeed(message) }
        if let warning = (reply["warnings"]?.array ?? []).map(\.text).first(where: { !$0.isEmpty }) { workspace?.notice = warning }
        if let ref { await loadCard(ref) }
        Task { await sync(force: true) }
        return reply
    }
}

/// Wspólna rama arkuszy karty: nagłówek, treść, błąd, Anuluj i przycisk zapisu, wskaźnik zapisu.
@MainActor struct ContactSheetChrome<Content: View>: View {
    let title: String
    let subtitle: String
    let action: String
    let pendingText: String
    let disabled: Bool
    let saving: Bool
    let problem: String?
    let destructive: Bool
    let perform: () -> Void
    let content: Content
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    init(title: String, subtitle: String = "", action: String, pendingText: String, disabled: Bool, saving: Bool, problem: String?,
         destructive: Bool = false, perform: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.action = action; self.pendingText = pendingText
        self.disabled = disabled; self.saving = saving; self.problem = problem; self.destructive = destructive
        self.perform = perform; self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title2.bold())
                if !subtitle.isEmpty { Text(subtitle).foregroundStyle(.secondary).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            content
            HStack(spacing: 10) {
                if let problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(3).textSelection(.enabled)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(action) { perform() }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .tint(destructive ? Color.red : theme.accent)
                    .disabled(disabled || saving)
            }
            .padding(16)
        }
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: pendingText) } }
        .interactiveDismissDisabled(saving)
    }
}

/// Wybrany rekord z „Zmień” (zamiast wyszukiwarki).
@MainActor struct ContactPickedRow: View {
    let symbol: String
    let title: String
    let detail: String
    let change: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).fontWeight(.medium).lineLimit(1)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            Button("Zmień", action: change).controlSize(.small)
        }
    }
}

// MARK: Osoba kontaktowa organizacji

/// „Dodaj osobę”: wybór z listy kontaktów albo nowa osoba (imię, nazwisko, stanowisko, e-mail, telefony, główny kontakt).
@MainActor struct LinkPersonSheet: View {
    @ObservedObject var store: ContactsStore
    let organizationID: String
    let linked: Set<String>
    @Environment(\.dismiss) private var dismiss
    @State private var creating = false
    @State private var selectedID = ""
    @State private var position = ""
    @State private var person: [String: String] = [:]
    @State private var primary = false
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var saving = false

    private var ref: ContactRef { ContactRef(id: organizationID, kind: .organization) }
    private var candidates: [ContactEntry] { store.contacts.filter { $0.contactKind == .contact && !linked.contains($0.id) } }
    private func value(_ key: String) -> String { (person[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var incomplete: Bool { creating ? value("first_name").isEmpty || value("last_name").isEmpty : selectedID.isEmpty }

    var body: some View {
        ContactSheetChrome(title: creating ? "Utwórz nową osobę kontaktową" : "Wybierz osobę kontaktową",
                           subtitle: store.card(organizationID)?.organization?.displayName ?? store.entry(organizationID)?.name ?? "",
                           action: "Dodaj", pendingText: "Dodawanie osoby kontaktowej…", disabled: incomplete, saving: saving, problem: problem,
                           perform: { Task { await save() } }) {
            Form {
                if creating { createFields } else { selectFields }
            }
            .formStyle(.grouped)
            .disabled(saving)
        }
        .frame(minWidth: 480, idealWidth: 540, minHeight: 440, idealHeight: 540)
    }

    @ViewBuilder private var selectFields: some View {
        Section {
            if let entry = store.entry(selectedID) {
                ContactPickedRow(symbol: "person.fill.checkmark", title: entry.name, detail: entry.email) { selectedID = "" }
            } else {
                ContactSearchPicker(prompt: "Kliknij i zacznij pisać…", candidates: candidates) { entry in
                    selectedID = entry.id
                    if position.trimmingCharacters(in: .whitespaces).isEmpty { position = entry.position }
                }
            }
            TextField("Stanowisko w organizacji", text: $position, prompt: Text("np. Menedżer"))
        } header: {
            Text("Wybierz z listy kontaktów")
        } footer: {
            if candidates.isEmpty { Text("Brak kontaktów do wyboru — utwórz nowy.").font(.caption).foregroundStyle(.secondary) }
        }
        Section {
            Button { creating = true; problem = nil } label: { Label("Lub utwórz nowy kontakt", systemImage: "plus") }
        }
    }

    @ViewBuilder private var createFields: some View {
        Section {
            Button { creating = false; problem = nil; errors = [:] } label: { Label("Wróć do wyboru z listy", systemImage: "chevron.left") }
                .buttonStyle(.link)
        }
        Section("Osoba") {
            field("first_name", "Imię *", prompt: "Jan")
            field("last_name", "Nazwisko *", prompt: "Kowalski")
            field("position", "Stanowisko", prompt: "Menedżer")
            field("email", "E-mail", prompt: "jan.kowalski@example.com")
            field("phone", "Telefon", prompt: "22 123 45 67")
            field("mobile", "Telefon komórkowy", prompt: "500 123 456")
            Toggle("Główny kontakt", isOn: $primary)
        }
    }

    private func field(_ key: String, _ label: String, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(label, text: Binding(get: { person[key] ?? "" }, set: { person[key] = $0; errors.removeValue(forKey: key) }), prompt: Text(prompt))
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private func save() async {
        problem = nil
        errors = [:]
        saving = true
        defer { saving = false }
        do {
            if creating {
                var data: [String: JSONValue] = [:]
                for key in ["first_name", "last_name", "position", "email", "phone", "mobile"] { data[key] = .string(value(key)) }
                data["primary"] = .bool(primary)
                _ = try await store.submit("linkNew", ["organizationId": .string(organizationID), "data": .object(data)], reload: ref)
            } else {
                let body: [String: JSONValue] = [
                    "organizationId": .string(organizationID), "contactId": .string(selectedID),
                    "position": .string(position.trimmingCharacters(in: .whitespacesAndNewlines)),
                ]
                _ = try await store.submit("link", body, reload: ref)
            }
            dismiss()
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            problem = failure.message
        } catch {
            problem = store.failureText(error, "Błąd podczas przypisywania")
        }
    }
}

// MARK: Organizacja kontaktu

/// Powiązanie kontaktu z organizacją (z listy organizacji) i stanowisko w niej.
@MainActor struct LinkOrganizationSheet: View {
    @ObservedObject var store: ContactsStore
    let contactID: String
    let linked: Set<String>
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID = ""
    @State private var position: String
    @State private var problem: String?
    @State private var saving = false

    init(store: ContactsStore, contactID: String, linked: Set<String>, position: String) {
        self.store = store
        self.contactID = contactID
        self.linked = linked
        _position = State(initialValue: position)
    }

    private var candidates: [ContactEntry] { store.contacts.filter { $0.isOrganization && !linked.contains($0.id) } }

    var body: some View {
        ContactSheetChrome(title: "Powiąż z organizacją", subtitle: store.card(contactID)?.contact?.name ?? store.entry(contactID)?.name ?? "",
                           action: "Powiąż", pendingText: "Zapisywanie powiązania…", disabled: selectedID.isEmpty, saving: saving, problem: problem,
                           perform: { Task { await save() } }) {
            Form {
                Section {
                    if let entry = store.entry(selectedID) {
                        ContactPickedRow(symbol: "building.2", title: entry.name, detail: [entry.nip.isEmpty ? "" : "NIP \(entry.nip)", entry.city].filter { !$0.isEmpty }.joined(separator: " · ")) {
                            selectedID = ""
                        }
                    } else {
                        ContactSearchPicker(prompt: "Wyszukaj organizację…", candidates: candidates) { selectedID = $0.id }
                    }
                    TextField("Stanowisko w organizacji", text: $position, prompt: Text("np. Kierownik sprzedaży"))
                } header: {
                    Text("Organizacja")
                } footer: {
                    Text("Kontakt pojawi się w zakładce „Osoby kontaktowe” organizacji.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .disabled(saving)
        }
        .frame(minWidth: 460, idealWidth: 520, minHeight: 320, idealHeight: 380)
    }

    private func save() async {
        problem = nil
        saving = true
        defer { saving = false }
        do {
            let body: [String: JSONValue] = [
                "organizationId": .string(selectedID), "contactId": .string(contactID),
                "position": .string(position.trimmingCharacters(in: .whitespacesAndNewlines)),
            ]
            _ = try await store.submit("link", body, reload: ContactRef(id: contactID, kind: store.entry(contactID)?.contactKind ?? .contact))
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas przypisywania")
        }
    }
}

// MARK: Osoba decyzyjna

/// „Dodaj osobę decyzyjną”: osoba (najpierw osoby kontaktowe organizacji), stanowisko lub rola, uprawnienie do podpisu.
@MainActor struct DecisionMakerSheet: View {
    @ObservedObject var store: ContactsStore
    let ref: ContactRef
    let persons: [ContactCardPerson]
    let assigned: Set<String>
    @Environment(\.dismiss) private var dismiss
    @State private var contactID = ""
    @State private var title = ""
    @State private var canSign = false
    @State private var problem: String?
    @State private var saving = false

    /// Osoby kontaktowe organizacji bez przypisania (bez powtórzeń).
    private var available: [ContactCardPerson] {
        var seen = Set<String>()
        return persons.filter { !assigned.contains($0.id) && seen.insert($0.id).inserted }
    }
    private var others: [ContactEntry] {
        let own = Set(persons.map(\.id))
        return store.contacts.filter { $0.contactKind == .contact && !assigned.contains($0.id) && !own.contains($0.id) }
    }
    private var chosenName: String {
        available.first { $0.id == contactID }?.name ?? store.entry(contactID)?.name ?? ""
    }

    var body: some View {
        ContactSheetChrome(title: "Dodaj osobę decyzyjną", subtitle: store.card(ref.id)?.organization?.displayName ?? "", action: "Dodaj",
                           pendingText: "Dodawanie osoby decyzyjnej…", disabled: contactID.isEmpty, saving: saving, problem: problem,
                           perform: { Task { await save() } }) {
            Form {
                Section {
                    if !contactID.isEmpty {
                        ContactPickedRow(symbol: "person.fill.checkmark", title: chosenName, detail: store.entry(contactID)?.email ?? "") { contactID = "" }
                    } else {
                        if available.isEmpty {
                            Text(persons.isEmpty ? "Organizacja nie ma jeszcze osób kontaktowych — wyszukaj osobę na liście kontaktów albo dodaj ją w zakładce „Osoby kontaktowe”."
                                 : "Wszystkie osoby kontaktowe organizacji są już przypisane jako decyzyjne.")
                                .font(.caption).foregroundStyle(.orange)
                        }
                        ForEach(available, id: \.id) { person in
                            Button { pick(person.id, position: person.position) } label: {
                                HStack {
                                    Image(systemName: "person").foregroundStyle(.secondary)
                                    Text(person.name)
                                    Text([person.position, person.email].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer()
                                }
                                .padding(.vertical, 3).padding(.horizontal, 6)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        ContactSearchPicker(prompt: "Wyszukaj inną osobę…", candidates: others) { pick($0.id, position: $0.position) }
                    }
                } header: {
                    Text("Osoba")
                }
                Section {
                    TextField("Stanowisko/Rola (opcjonalne)", text: $title, prompt: Text("np. Prokurent"))
                    Toggle("Uprawniony do podpisu / współreprezentacji", isOn: $canSign)
                }
            }
            .formStyle(.grouped)
            .disabled(saving)
        }
        .frame(minWidth: 480, idealWidth: 540, minHeight: 420, idealHeight: 520)
    }

    private func pick(_ id: String, position: String) {
        contactID = id
        if title.trimmingCharacters(in: .whitespaces).isEmpty { title = position }
    }

    private func save() async {
        problem = nil
        saving = true
        defer { saving = false }
        do {
            let body: [String: JSONValue] = [
                "action": .string("add"), "organizationId": .string(ref.id), "contactId": .string(contactID),
                "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "canSign": .bool(canSign),
            ]
            _ = try await store.submit("decisionMaker", body, reload: ref)
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas dodawania osoby decyzyjnej")
        }
    }
}

// MARK: Segmentacja i komunikacja

/// Segmenty, status komunikacji, podstawa prawna, dostarczalność, częstotliwość, preferencje, budżet i zgoda (`CustomerSegmentationPanel`).
@MainActor struct SegmentationSheet: View {
    @ObservedObject var store: ContactsStore
    let ref: ContactRef
    let email: String
    @Environment(\.dismiss) private var dismiss
    @State private var profile: ContactMarketingProfile
    @State private var segments: [ContactSegment]
    @State private var selected: Set<String>
    @State private var interests: String
    @State private var eventTypes: String
    @State private var regions: String
    @State private var budgetMin: String
    @State private var budgetMax: String
    @State private var consentGranted: Date?
    @State private var newSegment = ""
    @State private var addingSegment = false
    @State private var problem: String?
    @State private var saving = false

    init(store: ContactsStore, ref: ContactRef, marketing: ContactMarketing, email: String) {
        self.store = store
        self.ref = ref
        self.email = email
        let profile = marketing.profile
        _profile = State(initialValue: profile)
        _segments = State(initialValue: marketing.segments)
        _selected = State(initialValue: Set(marketing.selected))
        _interests = State(initialValue: profile.interests.joined(separator: ", "))
        _eventTypes = State(initialValue: profile.eventTypes.joined(separator: ", "))
        _regions = State(initialValue: profile.regions.joined(separator: ", "))
        _budgetMin = State(initialValue: Self.amountText(profile.budgetMin))
        _budgetMax = State(initialValue: Self.amountText(profile.budgetMax))
        _consentGranted = State(initialValue: profile.consentGrantedAt.isEmpty ? nil : MeetingDates.parse(profile.consentGrantedAt))
    }

    private var eligible: Bool {
        !email.isEmpty && profile.marketingStatus == "subscribed" && profile.legalBasis != "none"
            && profile.deliverability != "bounced" && profile.deliverability != "invalid"
    }

    var body: some View {
        ContactSheetChrome(title: "Segmentacja i komunikacja", subtitle: "Zgoda, preferencje i segmenty do kampanii", action: "Zapisz",
                           pendingText: "Zapisywanie segmentacji…", disabled: false, saving: saving, problem: problem,
                           perform: { Task { await save() } }) {
            Form {
                Section {
                    HStack {
                        Label(eligible ? "Mailing dozwolony" : "Mailing niedozwolony", systemImage: eligible ? "checkmark.circle.fill" : "nosign")
                            .foregroundStyle(eligible ? CrmTheme.rgb(0x4ade80) : .secondary)
                        Spacer()
                    }
                    if email.isEmpty { Text("Brak adresu e-mail — klient nie trafi na listę odbiorców.").font(.caption).foregroundStyle(.orange) }
                }
                segmentsSection
                Section("Komunikacja") {
                    picker("Status komunikacji", $profile.marketingStatus, ContactCardText.marketingStatus)
                    picker("Podstawa prawna", $profile.legalBasis, ContactCardText.legalBasis)
                    picker("Dostarczalność e-maila", $profile.deliverability, ContactCardText.deliverability)
                    picker("Częstotliwość", $profile.frequency, ContactCardText.frequency)
                }
                Section("Preferencje") {
                    TextField("Zainteresowania, oddzielone przecinkami", text: $interests, prompt: Text("DJ, ciężki dym, fotobudka"))
                    TextField("Typy eventów", text: $eventTypes, prompt: Text("wesele, event firmowy"))
                    TextField("Regiony", text: $regions, prompt: Text("Olsztyn, warmińsko-mazurskie"))
                    TextField("Budżet od", text: $budgetMin, prompt: Text("zł"))
                    TextField("Budżet do", text: $budgetMax, prompt: Text("zł"))
                }
                if profile.legalBasis == "consent" { consentSection }
            }
            .formStyle(.grouped)
            .disabled(saving)
        }
        .frame(minWidth: 540, idealWidth: 620, minHeight: 620, idealHeight: 760)
    }

    private var segmentsSection: some View {
        Section {
            if segments.isEmpty { Text("Brak aktywnych segmentów.").foregroundStyle(.secondary) }
            ForEach(segments) { segment in
                Toggle(isOn: Binding(get: { selected.contains(segment.id) }, set: { on in
                    if on { selected.insert(segment.id) } else { selected.remove(segment.id) }
                })) {
                    HStack(spacing: 6) {
                        Circle().fill(Self.color(segment.color)).frame(width: 8, height: 8)
                        Text(segment.name)
                        if segment.system { Text("systemowy").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                .toggleStyle(.checkbox)
            }
            HStack {
                TextField("Nowy segment…", text: $newSegment).textFieldStyle(.roundedBorder).onSubmit { Task { await addSegment() } }
                Button { Task { await addSegment() } } label: {
                    if addingSegment { ProgressView().controlSize(.small) } else { Image(systemName: "plus") }
                }
                .disabled(addingSegment || newSegment.trimmingCharacters(in: .whitespaces).isEmpty)
                .help("Utwórz segment i zaznacz go")
            }
        } header: {
            Text("Segmenty")
        }
    }

    private var consentSection: some View {
        Section("Zgoda") {
            Toggle("Data zgody", isOn: Binding(get: { consentGranted != nil }, set: { consentGranted = $0 ? (consentGranted ?? Date()) : nil }))
            if consentGranted != nil {
                DatePicker("Udzielono", selection: Binding(get: { consentGranted ?? Date() }, set: { consentGranted = $0 }),
                           displayedComponents: [.date, .hourAndMinute])
            }
            TextField("Źródło zgody", text: $profile.consentSource, prompt: Text("formularz, umowa, e-mail"))
            TextField("Dowód / notatka", text: $profile.consentEvidence, prompt: Text("Treść zgody, identyfikator formularza lub dokumentu"))
        }
    }

    private func picker(_ label: String, _ selection: Binding<String>, _ options: [InquiryOption]) -> some View {
        Picker(label, selection: selection) {
            ForEach(options) { Text($0.label).tag($0.value) }
            if !options.contains(where: { $0.value == selection.wrappedValue }) { Text(selection.wrappedValue).tag(selection.wrappedValue) }
        }
    }

    private static func amountText(_ value: Double?) -> String {
        guard let value else { return "" }
        return value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : String(value)
    }
    /// Kwota z pola: puste — brak; inaczej liczba nieujemna (przecinek lub kropka); `nil` w `valid` — błąd.
    private static func amount(_ text: String) -> (valid: Bool, value: Double?) {
        let raw = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        if raw.isEmpty { return (true, nil) }
        guard let number = Double(raw), number.isFinite, number >= 0 else { return (false, nil) }
        return (true, number)
    }
    /// Lista z pola „a, b, c” bez pustych i powtórzeń (`splitValues`).
    private static func split(_ text: String) -> [String] {
        var seen = Set<String>()
        return text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
    private static func color(_ hex: String) -> Color {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = Int(digits, radix: 16) else { return CrmTheme.rgb(0xd3bb73) }
        return CrmTheme.rgb(value)
    }
    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func addSegment() async {
        let name = newSegment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        addingSegment = true
        defer { addingSegment = false }
        do {
            let reply = try await store.post("segmentCreate", ["name": .string(name)])
            let row = reply["segment"]?.object ?? [:]
            let segment = ContactSegment(id: row["id"]?.text ?? "", name: row["name"]?.text ?? name, color: row["color"]?.text ?? "", system: row["system"]?.flag ?? false)
            guard !segment.id.isEmpty else { return }
            segments.append(segment)
            segments.sort { $0.name.compare($1.name, locale: Locale(identifier: "pl_PL")) == .orderedAscending }
            selected.insert(segment.id)
            newSegment = ""
            problem = nil
        } catch {
            problem = store.failureText(error, "Nie udało się utworzyć segmentu")
        }
    }

    private func save() async {
        problem = nil
        if profile.marketingStatus == "subscribed" && profile.legalBasis == "none" { problem = "Wskaż podstawę prawną komunikacji marketingowej"; return }
        if profile.marketingStatus == "subscribed" && profile.legalBasis == "consent" && consentGranted == nil { problem = "Dla zgody podaj datę jej udzielenia"; return }
        let minimum = Self.amount(budgetMin), maximum = Self.amount(budgetMax)
        guard minimum.valid && maximum.valid else { problem = "Budżet musi być liczbą nieujemną."; return }
        let payload: [String: JSONValue] = [
            "marketingStatus": .string(profile.marketingStatus), "legalBasis": .string(profile.legalBasis),
            "deliverability": .string(profile.deliverability), "frequency": .string(profile.frequency),
            "interests": .array(Self.split(interests).map { .string($0) }), "eventTypes": .array(Self.split(eventTypes).map { .string($0) }),
            "regions": .array(Self.split(regions).map { .string($0) }),
            "budgetMin": minimum.value.map { JSONValue.number($0) } ?? .null, "budgetMax": maximum.value.map { JSONValue.number($0) } ?? .null,
            "consentSource": .string(profile.consentSource.trimmingCharacters(in: .whitespacesAndNewlines)),
            "consentEvidence": .string(profile.consentEvidence.trimmingCharacters(in: .whitespacesAndNewlines)),
            "consentGrantedAt": .string(consentGranted.map(Self.iso) ?? ""),
            "consentWithdrawnAt": .string(profile.consentWithdrawnAt),
        ]
        let body: [String: JSONValue] = [
            "kind": .string(ref.kind.apiKind), "id": .string(ref.id), "profile": .object(payload),
            "segments": .array(segments.map(\.id).filter { selected.contains($0) }.map { .string($0) }),
        ]
        saving = true
        defer { saving = false }
        do {
            _ = try await store.submit("segmentation", body, reload: ref)
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać profilu marketingowego")
        }
    }
}

// MARK: Scalanie duplikatu

/// Liczba powiązań rekordu źródłowego jednego rodzaju (zapytania, oferty, wydarzenia…).
struct MergeRelation: Identifiable {
    let label: String
    let count: Int
    var id: String { label }
}

/// Podgląd i scalenie duplikatu kontaktu (administrator): relacje rekordu źródłowego przechodzą do bieżącego, źródłowy znika.
@MainActor struct MergeContactSheet: View {
    @ObservedObject var store: ContactsStore
    let ref: ContactRef
    let targetName: String
    let source: ContactEntry
    @Environment(\.dismiss) private var dismiss
    @State private var relations: [MergeRelation]?
    @State private var problem: String?
    @State private var saving = false

    /// Relacje z `preview_customer360_contact_merge` w stałej kolejności.
    private static let labels: [(key: String, label: String)] = [
        ("inquiries", "Zapytania"), ("calls", "Rozmowy"), ("offers", "Oferty"), ("events", "Eventy"), ("meetings", "Spotkania"),
        ("organizations", "Organizacje"), ("contracts", "Umowy"), ("invoices", "Faktury"),
    ]

    var body: some View {
        ContactSheetChrome(title: "Scal duplikat kontaktu", action: "Scal kontakty", pendingText: "Scalanie kontaktów…",
                           disabled: relations == nil, saving: saving, problem: problem, destructive: true,
                           perform: { Task { await merge() } }) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Dane i relacje z rekordu **\(source.name)** zostaną przeniesione do **\(targetName)**. Rekord źródłowy zostanie usunięty.")
                    .fixedSize(horizontal: false, vertical: true)
                if let relations {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                        ForEach(relations) { item in
                            VStack(spacing: 3) {
                                Text("\(item.count)").font(.title3.weight(.semibold)).monospacedDigit()
                                Text(item.label).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(10)
                            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                } else if problem == nil {
                    ProgressView("Przygotowanie podglądu…").frame(maxWidth: .infinity).padding(.vertical, 20)
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(minWidth: 480, idealWidth: 540, minHeight: 320, idealHeight: 380)
        .task { await preview() }
    }

    private func preview() async {
        do {
            let reply = try await store.post("mergePreview", ["targetId": .string(ref.id), "sourceId": .string(source.id)])
            let counts = reply["relations"]?.object ?? [:]
            var list = Self.labels.map { MergeRelation(label: $0.label, count: Int(counts[$0.key]?.number ?? 0)) }
            for key in counts.keys.sorted() where !Self.labels.contains(where: { $0.key == key }) {
                list.append(MergeRelation(label: key, count: Int(counts[key]?.number ?? 0)))
            }
            relations = list
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu scalania")
        }
    }

    private func merge() async {
        problem = nil
        saving = true
        defer { saving = false }
        do {
            _ = try await store.submit("merge", ["targetId": .string(ref.id), "sourceId": .string(source.id)], reload: ref)
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się scalić kontaktów")
        }
    }
}

// MARK: Nowa lokalizacja

/// Nowa lokalizacja z formularza organizacji (`AddLocationModal`): nazwa, adres, dane kontaktowe obiektu i notatki.
/// Współrzędne, mapę, sale i informacje techniczne uzupełnisz w Lokalizacjach.
@MainActor struct NewLocationSheet: View {
    @ObservedObject var locations: LocationsStore
    let created: (ContactCardLocation) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: String] = ["country": "Polska"]
    @State private var problem: String?
    @State private var saving = false

    private func value(_ key: String) -> String { (values[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ContactSheetChrome(title: "Dodaj nową lokalizację", subtitle: "Obiekt, hotel, sala — wspólny dla CRM i portalu sprzedawcy", action: "Dodaj lokalizację",
                           pendingText: "Zapisywanie lokalizacji…", disabled: value("name").isEmpty, saving: saving, problem: problem,
                           perform: { Task { await save() } }) {
            Form {
                Section("Obiekt") {
                    field("name", "Nazwa *", prompt: "np. Hotel Kopernik — sala balowa")
                    field("address", "Adres", prompt: "ul. Przykładowa 1")
                    field("postalCode", "Kod pocztowy", prompt: "00-000")
                    field("city", "Miasto", prompt: "Olsztyn")
                    field("country", "Kraj", prompt: "Polska")
                    field("nip", "NIP", prompt: "0000000000")
                }
                Section("Osoba kontaktowa w obiekcie") {
                    field("contactName", "Imię i nazwisko", prompt: "Jan Kowalski")
                    field("contactPhone", "Telefon", prompt: "600 000 000")
                    field("contactEmail", "E-mail", prompt: "recepcja@hotel.pl")
                }
                Section {
                    TextField("Notatki", text: binding("notes"), prompt: Text("Dojazd, parking, godziny rozładunku…"), axis: .vertical).lineLimit(2...6)
                } footer: {
                    Text("Współrzędne, mapę, sale i informacje techniczne uzupełnisz w Lokalizacjach.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .disabled(saving)
        }
        .frame(minWidth: 480, idealWidth: 540, minHeight: 560, idealHeight: 640)
    }

    private func binding(_ key: String) -> Binding<String> { Binding(get: { values[key] ?? "" }, set: { values[key] = $0 }) }
    private func field(_ key: String, _ label: String, prompt: String) -> some View {
        TextField(label, text: binding(key), prompt: Text(prompt))
    }

    private func save() async {
        problem = nil
        guard !value("name").isEmpty else { problem = "Nazwa lokalizacji jest wymagana"; return }
        guard let workspace = locations.workspace, workspace.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        var body: [String: JSONValue] = [:]
        for key in ["name", "address", "postalCode", "city", "country", "nip", "contactName", "contactPhone", "contactEmail", "notes"] { body[key] = .string(value(key)) }
        saving = true
        defer { saving = false }
        do {
            let reply = try await locations.post("save", body)
            guard let id = reply["id"]?.text.nonEmpty else { problem = "Serwer nie zwrócił nowej lokalizacji."; return }
            let place = [value("postalCode"), value("city")].filter { !$0.isEmpty }.joined(separator: " ")
            let address = [value("address"), place, value("country")].filter { !$0.isEmpty }.joined(separator: ", ")
            created(ContactCardLocation(id: id, name: value("name"), address: address))
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Lokalizacja dodana")
            if locations.list != nil { Task { await locations.load() } }
            dismiss()
        } catch {
            problem = locations.failureText(error, "Błąd podczas zapisywania lokalizacji")
        }
    }
}
