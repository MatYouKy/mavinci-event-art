import SwiftUI

/// Edycja kontaktu lub organizacji — pola jak na karcie w CRM (`/crm/contacts/[id]`, zakładka „Dane kontaktowe” / „Szczegóły”).
/// Organizację serwer sprawdza tą samą walidacją co formularz w przeglądarce (`validateOrganizationForm`).
@MainActor struct ContactEditorSheet: View {
    @ObservedObject var store: ContactsStore
    let entry: ContactEntry
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var rating = 0
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false
    @FocusState private var focused: String?

    private var kind: ContactKind { entry.contactKind }
    /// Pola widoczne w formularzu (błędy pozostałych pól pokazujemy zbiorczo pod formularzem).
    private var shownKeys: [String] {
        switch kind {
        case .organization:
            return ["name", "alias", "business_type", "legal_form", "nip", "krs", "regon", "email", "phone", "website", "address", "postal_code", "city", "country", "status", "rating"]
        case .contact:
            return ["first_name", "last_name", "email", "mobile", "phone", "business_phone", "position", "nip", "address", "postal_code", "city", "notes"]
        case .individual:
            return ["first_name", "last_name", "email", "phone", "mobile", "alternative_contact_name", "address", "postal_code", "city", "event_type", "event_details", "notes"]
        }
    }
    private var original: [String: String] {
        switch kind {
        case .organization:
            return ["name": entry.legalName, "alias": entry.alias, "business_type": entry.businessType, "legal_form": entry.legalForm, "nip": entry.nip,
                    "krs": entry.krs, "regon": entry.regon, "email": entry.email, "phone": entry.phone, "website": entry.website,
                    "address": entry.address, "postal_code": entry.postalCode, "city": entry.city, "country": entry.country, "status": entry.status]
        case .contact, .individual:
            return ["first_name": entry.firstName, "last_name": entry.lastName, "email": entry.email, "phone": entry.phone, "mobile": entry.mobile,
                    "business_phone": entry.businessPhone, "position": entry.position, "nip": entry.nip,
                    "alternative_contact_name": entry.alternativeContact, "address": entry.address, "postal_code": entry.postalCode,
                    "city": entry.city, "event_type": entry.eventType, "event_details": entry.eventDetails, "notes": entry.notes]
        }
    }
    private var otherErrors: [String] {
        errors.filter { !shownKeys.contains($0.key) }.sorted { $0.key < $1.key }.map(\.value)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(kind == .organization ? "Edytuj organizację" : "Edytuj kontakt").font(.title2.bold())
                    Text(entry.name).foregroundStyle(.secondary)
                }
                Spacer()
            }.padding([.horizontal, .top], 20).padding(.bottom, 6)

            Form {
                switch kind {
                case .organization: organizationFields
                case .contact, .individual: personFields
                }
                if problem != nil || !otherErrors.isEmpty {
                    Section {
                        if let problem { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                        ForEach(otherErrors, id: \.self) { Text($0).font(.caption).foregroundStyle(.red) }
                        if !otherErrors.isEmpty {
                            Text("Tych pól nie ma w aplikacji — popraw je na karcie w CRM.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .disabled(saving)

            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button("Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || !store.canManage)
            }.padding(16)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 600, idealHeight: 740)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: "Zapisywanie…") } }
        .interactiveDismissDisabled(saving)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            values = original
            rating = entry.rating ?? 0
        }
    }

    // MARK: Organizacja
    @ViewBuilder private var organizationFields: some View {
        Section("Dane firmy") {
            text("name", "Pełna nazwa")
            text("alias", "Nazwa skrócona (alias)", prompt: "Wyświetlana na liście zamiast pełnej nazwy")
            choice("business_type", "Profil działalności", ContactDictionaries.businessTypes, empty: nil)
            choice("legal_form", "Forma prawna", ContactDictionaries.legalForms, empty: "Wybierz")
            text("nip", "NIP")
            text("krs", "KRS")
            text("regon", "REGON")
        }
        Section("Kontakt") {
            text("email", "E-mail")
            text("phone", "Telefon")
            text("website", "Strona WWW", prompt: "https://")
        }
        Section("Adres") {
            text("address", "Adres")
            text("postal_code", "Kod pocztowy")
            text("city", "Miasto")
            text("country", "Kraj", prompt: "Polska")
        }
        Section("Ocena i status") {
            Picker("Ocena", selection: $rating) {
                Text("Brak oceny").tag(0)
                ForEach(1...5, id: \.self) { Text(String(repeating: "★", count: $0)).tag($0) }
            }
            choice("status", "Status", ContactDictionaries.organizationStatuses, empty: nil)
        }
    }

    // MARK: Kontakt i osoba prywatna
    @ViewBuilder private var personFields: some View {
        Section("Osoba") {
            text("first_name", "Imię")
            text("last_name", "Nazwisko")
            if kind == .contact { text("position", "Stanowisko") }
        }
        Section("Kontakt") {
            text("email", "E-mail")
            if kind == .individual {
                text("phone", "Telefon główny")
                text("mobile", "Numer alternatywny")
                text("alternative_contact_name", "Osoba alternatywna", prompt: "np. Anna Kowalska — mama")
            } else {
                text("mobile", "Telefon komórkowy")
                text("phone", "Telefon prywatny")
                text("business_phone", "Telefon firmowy")
                text("nip", "NIP")
            }
        }
        Section("Adres") {
            text("address", "Adres")
            text("postal_code", "Kod pocztowy")
            text("city", "Miasto")
        }
        if kind == .individual {
            Section("Uroczystość") {
                choice("event_type", "Rodzaj uroczystości", ContactDictionaries.eventTypes, empty: "Wybierz")
                text("event_details", "Szczegóły uroczystości", vertical: true)
            }
        }
        Section("Notatki") {
            text("notes", "Notatki", vertical: true)
        }
    }

    // MARK: Pola
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0; errors.removeValue(forKey: key) })
    }
    @ViewBuilder private func text(_ key: String, _ label: String, prompt: String? = nil, vertical: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if vertical {
                TextField(label, text: binding(key), prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(3...8).focused($focused, equals: key)
            } else {
                TextField(label, text: binding(key), prompt: prompt.map { Text($0) }).focused($focused, equals: key)
            }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
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

    // MARK: Zapis
    private func trimmed(_ key: String) -> String { (values[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    private func validate() -> [String: String] {
        var found: [String: String] = [:]
        let email = trimmed("email")
        if !email.isEmpty && email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil {
            found["email"] = "Wpisz poprawny adres e-mail."
        }
        if kind == .organization {
            if trimmed("name").isEmpty { found["name"] = "Nazwa jest wymagana" }
        } else if trimmed("first_name").isEmpty && trimmed("last_name").isEmpty {
            found["first_name"] = "Wpisz imię lub nazwisko."
        }
        return found
    }

    private func save() async {
        problem = nil
        errors = validate()
        if let first = shownKeys.first(where: { errors[$0] != nil }) { focused = first; return }
        let before = original
        var data: [String: JSONValue] = [:]
        for key in shownKeys where key != "rating" {
            let value = trimmed(key)
            guard value != (before[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
            data[key] = value.isEmpty ? .null : .string(value)
        }
        if kind == .organization && rating != (entry.rating ?? 0) { data["rating"] = rating == 0 ? .null : .number(Double(rating)) }
        if data.isEmpty { dismiss(); return }
        let edited = values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let stars = rating
        let organization = kind == .organization
        let individual = kind == .individual
        saving = true
        defer { saving = false }
        do {
            try await store.update(entry, data: data) { e in
                if organization {
                    e.legalName = edited["name"] ?? e.legalName; e.alias = edited["alias"] ?? ""
                    e.name = e.alias.isEmpty ? e.legalName : e.alias
                    e.businessType = edited["business_type"] ?? ""; e.legalForm = edited["legal_form"] ?? ""
                    e.nip = edited["nip"] ?? ""; e.krs = edited["krs"] ?? ""; e.regon = edited["regon"] ?? ""
                    e.email = edited["email"] ?? ""; e.phone = edited["phone"] ?? ""; e.website = edited["website"] ?? ""
                    e.address = edited["address"] ?? ""; e.postalCode = edited["postal_code"] ?? ""; e.city = edited["city"] ?? ""
                    e.country = edited["country"] ?? ""; e.status = edited["status"] ?? e.status; e.rating = stars == 0 ? nil : stars
                } else {
                    e.firstName = edited["first_name"] ?? ""; e.lastName = edited["last_name"] ?? ""
                    let full = "\(e.firstName) \(e.lastName)".trimmingCharacters(in: .whitespaces)
                    e.name = full.isEmpty ? "—" : full
                    e.email = edited["email"] ?? ""; e.phone = edited["phone"] ?? ""; e.mobile = edited["mobile"] ?? ""
                    e.address = edited["address"] ?? ""; e.postalCode = edited["postal_code"] ?? ""; e.city = edited["city"] ?? ""
                    e.notes = edited["notes"] ?? ""
                    if individual {
                        e.nip = ""; e.position = ""; e.businessPhone = ""
                        e.alternativeContact = edited["alternative_contact_name"] ?? ""
                        e.eventType = edited["event_type"] ?? ""; e.eventDetails = edited["event_details"] ?? ""
                    } else {
                        e.position = edited["position"] ?? ""; e.businessPhone = edited["business_phone"] ?? ""; e.nip = edited["nip"] ?? ""
                    }
                }
            }
            store.workspace?.succeed(organization ? "Dane organizacji zaktualizowane" : "Dane kontaktu zaktualizowane")
            dismiss()
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            problem = failure.message
            if let first = shownKeys.first(where: { errors[$0] != nil }) { focused = first }
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}
