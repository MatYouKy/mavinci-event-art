import SwiftUI

// MARK: Formularze kontaktu i osoby prywatnej — dodawanie jak `/crm/contacts/new` (walidacja `personContactSchema`, sprawdzenie
// duplikatu po e-mailu, telefonie i NIP-ie) i edycja jak zakładka „Dane kontaktowe” karty (także PESEL i numer dowodu osoby
// prywatnej). Organizacja — `OrganizationEditorSheet`.

/// Dodawanie albo edycja rekordu kontaktów.
enum ContactEditorMode: Identifiable, Equatable {
    case create(ContactKind)
    case edit(ContactRef)
    var id: String {
        switch self {
        case .create(let kind): return "create-\(kind.rawValue)"
        case .edit(let ref): return "edit-\(ref.id)"
        }
    }
    var kind: ContactKind {
        switch self {
        case .create(let kind): return kind
        case .edit(let ref): return ref.kind
        }
    }
    var ref: ContactRef? {
        if case .edit(let ref) = self { return ref }
        return nil
    }
}

/// Formularz właściwy dla rodzaju rekordu.
@MainActor struct ContactEditorHost: View {
    @ObservedObject var store: ContactsStore
    let mode: ContactEditorMode
    var body: some View {
        if mode.kind == .organization {
            OrganizationEditorSheet(store: store, mode: mode)
        } else {
            PersonEditorSheet(store: store, mode: mode)
        }
    }
}

/// Wyszukiwarka rekordu z kopii listy (osoby albo organizacje): po wpisaniu frazy — do 8 wyników.
@MainActor struct ContactSearchPicker: View {
    let prompt: String
    let candidates: [ContactEntry]
    let pick: (ContactEntry) -> Void
    @State private var query = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(prompt, text: $query).textFieldStyle(.roundedBorder)
            let terms = query.trimmingCharacters(in: .whitespaces).lowercased()
            if !terms.isEmpty {
                let found = Array(candidates.filter { $0.name.lowercased().contains(terms) || $0.legalName.lowercased().contains(terms) || $0.email.lowercased().contains(terms) }.prefix(8))
                if found.isEmpty { Text("Brak wyników").font(.caption).foregroundStyle(.secondary) }
                ForEach(found) { entry in
                    Button { pick(entry); query = "" } label: {
                        HStack(spacing: 6) {
                            Image(systemName: entry.contactKind.symbol).foregroundStyle(.secondary)
                            Text(entry.name).lineLimit(1)
                            if !entry.email.isEmpty { Text(entry.email).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            Spacer()
                        }
                        .padding(.vertical, 3).padding(.horizontal, 6)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Kontakt (osoba powiązana z organizacją) albo osoba prywatna — dodawanie i edycja.
@MainActor struct PersonEditorSheet: View {
    @ObservedObject var store: ContactsStore
    let mode: ContactEditorMode
    /// Dodawanie z wypełnionymi polami (np. imię i nazwisko z wyszukiwania w kreatorze sprzedawcy).
    var initialValues: [String: String] = [:]
    /// Dodawanie od razu przy organizacji (np. „Dodaj osobę do …” w kreatorze sprzedawcy).
    var initialOrganizationID: String? = nil
    /// Po zapisie: identyfikator kontaktu zamiast otwierania jego karty (kreator sprzedawcy wybiera tę osobę).
    var onSaved: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var original: [String: String] = [:]
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var duplicateID: String?
    @State private var saving = false
    @State private var prepared = false
    @State private var organizationID = ""
    @FocusState private var focused: String?

    private var kind: ContactKind { mode.kind }
    private var creating: Bool { mode.ref == nil }
    private var card: ContactCard? { mode.ref.flatMap { store.card($0.id) } }
    /// Pola formularza (kolejność jak na stronie — błędy pozostałych pól zbiorczo pod formularzem).
    private var keys: [String] {
        if kind == .individual {
            return ["first_name", "last_name", "pesel", "id_number", "email", "phone", "mobile", "alternative_contact_name", "address", "postal_code",
                    "city", "event_type", "event_details", "notes"]
        }
        return ["first_name", "last_name", "position", "nip", "email", "mobile", "phone", "business_phone", "address", "postal_code", "city", "notes"]
    }
    private var otherErrors: [String] { errors.filter { !keys.contains($0.key) }.sorted { $0.key < $1.key }.map(\.value) }
    private var heading: String {
        switch (creating, kind) {
        case (true, .individual): return "Nowa osoba prywatna"
        case (true, _): return "Nowy kontakt"
        case (false, .individual): return "Edytuj osobę prywatną"
        default: return "Edytuj kontakt"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(heading).font(.title2.bold())
                    Text(creating ? (kind == .individual ? "Klient indywidualny" : "Osoba powiązana z organizacją") : (card?.contact?.name ?? store.entry(mode.ref?.id)?.name ?? ""))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 6)

            if !creating && card?.contact == nil {
                if let ref = mode.ref, let error = store.cardErrors[ref.id] {
                    ContentUnavailableView("Nie można wczytać danych", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Wczytywanie danych…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                form
            }

            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(creating ? "Dodaj" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(saving || (!creating && card?.contact == nil))
            }
            .padding(16)
        }
        .frame(minWidth: 580, idealWidth: 640, minHeight: 620, idealHeight: 760)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: creating ? "Dodawanie…" : "Zapisywanie…") } }
        .interactiveDismissDisabled(saving)
        .task {
            if let ref = mode.ref, store.card(ref.id) == nil { await store.loadCard(ref) }
            prepare()
        }
    }

    private var form: some View {
        Form {
            Section("Osoba") {
                text("first_name", "Imię", required: true)
                text("last_name", "Nazwisko", required: true)
                if kind == .contact {
                    text("position", "Stanowisko", prompt: "np. Kierownik sprzedaży")
                    text("nip", "NIP", prompt: "0000000000")
                } else {
                    text("pesel", "PESEL", prompt: "00000000000")
                    text("id_number", "Numer dowodu", prompt: "ABC123456")
                }
            }
            Section("Kontakt") {
                text("email", "E-mail")
                if kind == .individual {
                    text("phone", "Telefon główny", prompt: "600 123 456")
                    text("mobile", "Numer alternatywny", prompt: "600 123 456")
                    text("alternative_contact_name", "Osoba alternatywna", prompt: "np. Anna Kowalska — mama")
                } else {
                    text("mobile", "Telefon komórkowy", prompt: "600 123 456")
                    text("phone", "Telefon prywatny", prompt: "600 123 456")
                    text("business_phone", "Telefon firmowy", prompt: "22 123 4567")
                }
            }
            Section("Adres") {
                text("address", "Adres", prompt: "np. Kwiatowa 12/3")
                text("postal_code", "Kod pocztowy", prompt: "00-000")
                text("city", "Miasto")
            }
            if kind == .individual {
                Section("Uroczystość") {
                    choice("event_type", "Rodzaj uroczystości", ContactDictionaries.eventTypes)
                    text("event_details", "Szczegóły uroczystości", prompt: "Dodatkowe informacje o uroczystości…", vertical: true)
                }
            }
            if creating && kind == .contact { organizationSection }
            Section("Notatki") {
                text("notes", "Notatki", prompt: "Dodatkowe informacje…", vertical: true)
            }
            if problem != nil || !otherErrors.isEmpty {
                Section {
                    if let problem { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                    ForEach(otherErrors, id: \.self) { Text($0).font(.caption).foregroundStyle(.red) }
                    if let duplicateID, let existing = store.entry(duplicateID) {
                        if let onSaved {
                            Button("Użyj istniejącego kontaktu: \(existing.name)") {
                                onSaved(existing.id)
                                dismiss()
                            }
                        } else {
                            Button("Otwórz istniejący kontakt: \(existing.name)") {
                                store.open(existing.id, kind: existing.contactKind)
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .disabled(saving)
    }

    /// Kontakt od razu przy organizacji (opcjonalnie) — stanowisko z pola „Stanowisko”.
    private var organizationSection: some View {
        Section {
            if let organization = store.entry(organizationID) {
                HStack {
                    Label(organization.name, systemImage: "building.2")
                    Spacer()
                    Button("Usuń wybór") { organizationID = "" }.controlSize(.small)
                }
            }
            ContactSearchPicker(prompt: "Wyszukaj organizację…", candidates: store.contacts.filter(\.isOrganization)) { organizationID = $0.id }
        } header: {
            Text("Organizacja (opcjonalnie)")
        } footer: {
            Text("Powiązanie możesz też dodać później w karcie kontaktu albo organizacji.").font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Pola
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0; errors.removeValue(forKey: key) })
    }
    @ViewBuilder private func text(_ key: String, _ label: String, prompt: String? = nil, vertical: Bool = false, required: Bool = false) -> some View {
        let title = required && creating ? "\(label) *" : label
        VStack(alignment: .leading, spacing: 3) {
            if vertical {
                TextField(title, text: binding(key), prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(3...8).focused($focused, equals: key)
            } else {
                TextField(title, text: binding(key), prompt: prompt.map { Text($0) }).focused($focused, equals: key)
            }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }
    @ViewBuilder private func choice(_ key: String, _ label: String, _ options: [InquiryOption]) -> some View {
        let current = values[key] ?? ""
        VStack(alignment: .leading, spacing: 3) {
            Picker(label, selection: binding(key)) {
                Text("Wybierz").tag("")
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
            values = initialValues
            if kind == .contact, let organization = initialOrganizationID { organizationID = organization }
            return
        }
        guard let person = card?.contact else { return }
        prepared = true
        let loaded: [String: String] = [
            "first_name": person.firstName, "last_name": person.lastName, "email": person.email, "phone": person.phone, "mobile": person.mobile,
            "business_phone": person.businessPhone, "position": person.position, "nip": person.nip, "pesel": person.pesel, "id_number": person.idNumber,
            "alternative_contact_name": person.alternativeContact, "address": person.address, "postal_code": person.postalCode, "city": person.city,
            "event_type": person.eventType, "event_details": person.eventDetails, "notes": person.notes,
        ]
        values = loaded
        original = loaded
    }

    private func trimmed(_ key: String) -> String { (values[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    private func validate() -> [String: String] {
        var found: [String: String] = [:]
        let email = trimmed("email")
        if !email.isEmpty && email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil {
            found["email"] = "Nieprawidłowy adres e-mail"
        }
        if creating {
            if trimmed("first_name").isEmpty { found["first_name"] = "Imię jest wymagane" }
            if trimmed("last_name").isEmpty { found["last_name"] = "Nazwisko jest wymagane" }
            let postal = trimmed("postal_code")
            if !postal.isEmpty && postal.range(of: "^\\d{2}-\\d{3}$", options: .regularExpression) == nil {
                found["postal_code"] = "Kod pocztowy musi mieć format 00-000"
            }
        } else if trimmed("first_name").isEmpty && trimmed("last_name").isEmpty {
            found["first_name"] = "Wpisz imię lub nazwisko."
        }
        return found
    }

    /// Istniejący kontakt z tym samym e-mailem, telefonem lub NIP-em (po odpowiedzi serwera o duplikacie).
    private func localDuplicate() -> String? {
        let email = trimmed("email").lowercased()
        let phones = Set(["phone", "mobile", "business_phone"].map { ContactCardText.phoneKey(trimmed($0)) }.filter { !$0.isEmpty })
        let nip = trimmed("nip").filter(\.isNumber)
        return store.contacts.first { candidate in
            guard !candidate.isOrganization else { return false }
            if !email.isEmpty && candidate.email.lowercased() == email { return true }
            let candidatePhones = Set([candidate.phone, candidate.mobile, candidate.businessPhone].map(ContactCardText.phoneKey).filter { !$0.isEmpty })
            if !phones.isDisjoint(with: candidatePhones) { return true }
            return !nip.isEmpty && candidate.nip.filter(\.isNumber) == nip
        }?.id
    }

    private func save() async {
        problem = nil; duplicateID = nil
        errors = validate()
        if let first = keys.first(where: { errors[$0] != nil }) { focused = first; return }
        guard let workspace = store.workspace else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        // Trwające odświeżanie danych w tle nie blokuje zapisu — czekamy na jego koniec (`Workspace.prepareWrite`).
        if let blocked = await workspace.prepareWrite() { problem = blocked; return }
        do {
            if creating {
                var data: [String: JSONValue] = [:]
                for key in keys { data[key] = .string(trimmed(key)) }
                var body: [String: JSONValue] = ["kind": .string(kind.rawValue), "data": .object(data)]
                if !organizationID.isEmpty { body["organizationId"] = .string(organizationID) }
                let reply = try await store.post("create", body)
                let id = reply["id"]?.text ?? ""
                store.workspace?.succeed(reply["message"]?.text.nonEmpty ?? "Kontakt dodany")
                if let warning = (reply["warnings"]?.array ?? []).map(\.text).first(where: { !$0.isEmpty }) { store.workspace?.notice = warning }
                await store.sync(force: true)
                if !id.isEmpty {
                    if let onSaved { onSaved(id) } else { store.open(id, kind: kind) }
                }
                dismiss()
            } else if let ref = mode.ref {
                var data: [String: JSONValue] = [:]
                for key in keys {
                    let value = trimmed(key)
                    guard value != (original[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
                    data[key] = value.isEmpty ? .null : .string(value)
                }
                if data.isEmpty { dismiss(); return }
                try await store.save(ref, data: data)
                store.workspace?.succeed(kind == .individual ? "Dane osoby prywatnej zaktualizowane" : "Dane kontaktu zaktualizowane")
                onSaved?(ref.id)
                dismiss()
            }
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            problem = failure.message
            if failure.status == 409 { duplicateID = localDuplicate() }
            if let first = keys.first(where: { errors[$0] != nil }) { focused = first }
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}
