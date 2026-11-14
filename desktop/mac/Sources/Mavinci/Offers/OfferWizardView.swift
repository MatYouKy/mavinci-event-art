import SwiftUI

// MARK: Oferty, część E — „Kreator oferty” (`OfferWizard`): wybór wydarzenia (z listy ofert), klient, dane podstawowe,
// katalog produktów, pozycje i podsumowanie. Kroki 3–4: `OfferWizardCatalog.swift`.

/// Okno kreatora z listy ofert (najpierw „Wybierz event dla oferty”) albo z zakładki ofert wydarzenia (`eventID`).
struct OfferWizardRoute: Identifiable {
    let eventID: String?
    let id = UUID()
}

@MainActor struct OfferWizardSheet: View {
    let store: OffersStore
    @State private var eventID: String?
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    init(store: OffersStore, eventID: String?, onCreated: @escaping (String) -> Void) {
        self.store = store
        self._eventID = State(initialValue: eventID)
        self.onCreated = onCreated
    }

    var body: some View {
        if let eventID {
            OfferWizardContent(eventID: eventID, store: store) { id in
                onCreated(id)
                dismiss()
            }
        } else {
            OfferWizardEventPicker(store: store) { event in eventID = event.id }
        }
    }
}

// MARK: Wybór wydarzenia

@MainActor struct OfferWizardEventPicker: View {
    let store: OffersStore
    let onPick: (OfferWizardEvent) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var events: [OfferWizardEvent]?
    @State private var problem: String?
    @State private var search = ""

    private var rows: [OfferWizardEvent] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return events ?? [] }
        return (events ?? []).filter { $0.name.lowercased().contains(query) || $0.client.lowercased().contains(query) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Wybierz event dla oferty").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            if events != nil && !(events ?? []).isEmpty {
                TextField("", text: $search, prompt: Text("Szukaj wydarzenia lub klienta"))
                    .textFieldStyle(.roundedBorder).padding(.horizontal, 20).padding(.bottom, 10)
            }
            Divider()
            Group {
                if let problem {
                    VStack(spacing: 10) {
                        Text(problem).foregroundStyle(.red)
                        Button("Spróbuj ponownie") { Task { await load() } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if events == nil {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if (events ?? []).isEmpty {
                    Text("Brak dostępnych eventów. Utwórz event aby móc dodać ofertę.").foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(rows) { event in row(event) }
                        }
                        .padding(20)
                    }
                }
            }
        }
        .frame(width: 720, height: 600)
        .task { await load() }
    }

    private func row(_ event: OfferWizardEvent) -> some View {
        Button { onPick(event) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.name).font(.callout.weight(.medium)).foregroundStyle(.primary)
                HStack(spacing: 14) {
                    Label(event.client, systemImage: "building.2")
                    if let date = event.date.flatMap(OfferText.day) { Label(date, systemImage: "calendar") }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.15)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        problem = nil
        do { events = try await store.wizardEvents() } catch { problem = store.failureText(error, "Błąd pobierania eventów") }
    }
}

// MARK: Kreator

@MainActor struct OfferWizardContent: View {
    @StateObject private var model: OfferWizardModel
    let onCreated: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var confirmingShortage = false

    init(eventID: String, store: OffersStore, onCreated: @escaping (String) -> Void) {
        _model = StateObject(wrappedValue: OfferWizardModel(eventID: eventID, store: store))
        self.onCreated = onCreated
    }

    private var stepCount: Int { model.initialStep == 2 ? 3 : 4 }
    private var stepNumber: Int { model.initialStep == 2 ? model.step - 1 : model.step }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if model.setup != nil {
                stepsBar
                Divider()
                content
                Divider()
                footer
            } else {
                loading
            }
        }
        .frame(minWidth: 1000, idealWidth: 1260, maxWidth: 1500, minHeight: 660, idealHeight: 840, maxHeight: 1100)
        .interactiveDismissDisabled(model.creating)
        .task { if model.setup == nil { await model.load() } }
        .confirmationDialog("Wykryto konflikty sprzętowe", isPresented: $confirmingShortage, titleVisibility: .visible) {
            Button("Utwórz mimo to") { Task { await create(acceptShortage: true) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Brakuje \(model.conflictCount) pozycji sprzętu w terminie eventu.\n\nCzy chcesz utworzyć ofertę mimo to?\n\nEvent zostanie oznaczony jako mający braki sprzętowe.")
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Kreator oferty").font(.title2)
                if model.setup != nil {
                    Text("Krok \(stepNumber) z \(stepCount)").font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(model.creating)
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
    }

    private var loading: some View {
        VStack(spacing: 12) {
            if let error = model.loadError {
                Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Spróbuj ponownie") { Task { await model.load() } }.buttonStyle(.borderedProminent)
            } else {
                ProgressView()
                Text("Uzupełniam dane z wydarzenia…").foregroundStyle(.secondary)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var stepsBar: some View {
        let steps: [(Int, String)] = [(1, "Wybór klienta"), (2, "Dane podstawowe"), (3, "Katalog produktów"), (4, "Pozycje i podsumowanie")]
        let visible = steps.filter { model.initialStep == 1 || $0.0 >= 2 }
        return HStack(spacing: 12) {
            ForEach(Array(visible.enumerated()), id: \.offset) { index, step in
                if index > 0 { Image(systemName: "chevron.right").foregroundStyle(.tertiary) }
                HStack(spacing: 8) {
                    Text("\(model.initialStep == 2 ? step.0 - 1 : step.0)")
                        .font(.callout.weight(.semibold))
                        .frame(width: 28, height: 28)
                        .background(model.step >= step.0 ? theme.accent : Color.primary.opacity(0.08), in: Circle())
                        .foregroundStyle(model.step >= step.0 ? Color.white : Color.secondary)
                    Text(step.1).font(.callout).foregroundStyle(model.step >= step.0 ? Color.primary : Color.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case 1:
            ScrollView { OfferWizardClientStep(model: model).padding(24) }
        case 2:
            ScrollView { OfferWizardBasicsStep(model: model).padding(24) }
        case 3:
            VStack(spacing: 10) {
                OfferWizardCatalogStep(model: model)
                OfferWizardConflicts(model: model)
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            ScrollView {
                VStack(spacing: 12) {
                    OfferWizardItemsStep(model: model)
                    OfferWizardConflicts(model: model)
                }
                .padding(20)
            }
        }
    }

    private var footer: some View {
        HStack {
            Button { model.step = max(1, model.step - 1) } label: { Label("Wstecz", systemImage: "chevron.left") }
                .disabled(model.step == 1 || model.creating)
            Spacer()
            if model.previewing { ProgressView().controlSize(.small) }
            if model.step < 4 {
                Button { model.step += 1 } label: { Label("Dalej", systemImage: "chevron.right").labelStyle(.titleAndIcon) }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.step == 1 && !model.canProceedFromClient)
            } else {
                Button(model.creating ? "Tworzenie..." : "Utwórz ofertę") { start() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.creating || model.items.isEmpty || !state.canWrite)
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 14)
    }

    private func start() {
        if model.items.isEmpty {
            state.notice = "Dodaj przynajmniej jedną pozycję do oferty"
            return
        }
        if model.conflictCount > 0 { confirmingShortage = true } else { Task { await create(acceptShortage: false) } }
    }

    private func create(acceptShortage: Bool) async {
        guard let result = await model.create(acceptShortage: acceptShortage) else { return }
        if result.notReady > 0 {
            state.notice = "\(result.message). Produkty niegotowe do oferty: \(result.notReady) — uzupełnij je w katalogu przed wysłaniem."
        } else {
            state.succeed(result.message)
        }
        onCreated(result.id)
    }
}

// MARK: Krok 1 — klient

@MainActor struct OfferWizardClientStep: View {
    @ObservedObject var model: OfferWizardModel
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Wybierz typ klienta").font(.title3)
            HStack(spacing: 14) {
                typeCard("business", title: "Klient biznesowy", subtitle: "Organizacja / Firma", symbol: "shippingbox")
                typeCard("individual", title: "Klient indywidualny", subtitle: "Osoba prywatna", symbol: "person.2")
            }
            if model.clientType == "business" {
                Text("Wybierz organizację").font(.title3)
                TextField("", text: $search, prompt: Text("Szukaj organizacji...")).textFieldStyle(.roundedBorder)
                list(organizations.map { org in
                    ClientRow(id: org.id, title: org.name, lines: [org.nip.isEmpty ? "" : "NIP: \(org.nip)", org.email].filter { !$0.isEmpty })
                }, selected: model.organizationId) { model.organizationId = $0 }
            }
            if model.clientType == "individual" {
                HStack {
                    Text("Wybierz kontakt").font(.title3)
                    Spacer()
                    Button { adding = true } label: { Label("Dodaj nowego klienta", systemImage: "plus") }
                }
                TextField("", text: $search, prompt: Text("Szukaj kontaktu...")).textFieldStyle(.roundedBorder)
                list(contacts.map { contact in
                    ClientRow(id: contact.id, title: contact.name, lines: [contact.email, contact.phone].filter { !$0.isEmpty })
                }, selected: model.contactId) { model.contactId = $0 }
            }
        }
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
        .sheet(isPresented: $adding) {
            OfferWizardContactSheet(store: model.store) { contact in
                model.contacts.append(contact)
                model.contactId = contact.id
            }
        }
    }

    private var query: String { search.trimmingCharacters(in: .whitespaces).lowercased() }
    private var organizations: [OfferWizardSetup.Organization] {
        let all = model.setup?.organizations ?? []
        return query.isEmpty ? all : all.filter { $0.name.lowercased().contains(query) || $0.nip.lowercased().contains(query) }
    }
    private var contacts: [OfferWizardSetup.Contact] {
        query.isEmpty ? model.contacts : model.contacts.filter { $0.name.lowercased().contains(query) || $0.email.lowercased().contains(query) }
    }

    private func typeCard(_ type: String, title: String, subtitle: String, symbol: String) -> some View {
        let active = model.clientType == type
        return Button { model.clientType = type } label: {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol).font(.title).foregroundStyle(theme.accent)
                Text(title).font(.headline).foregroundStyle(.primary)
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            .padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? theme.accent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(active ? theme.accent : theme.accent.opacity(0.2), lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    struct ClientRow: Identifiable {
        let id: String
        let title: String
        let lines: [String]
    }

    private func list(_ rows: [ClientRow], selected: String, pick: @escaping (String) -> Void) -> some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(rows) { row in
                    Button { pick(row.id) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.title).font(.callout.weight(.medium)).foregroundStyle(.primary)
                            ForEach(row.lines, id: \.self) { line in Text(line).font(.caption).foregroundStyle(.secondary) }
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(selected == row.id ? theme.accent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected == row.id ? theme.accent : theme.accent.opacity(0.2)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxHeight: 300)
    }
}

/// „Dodaj nowego klienta” (osoba prywatna).
@MainActor struct OfferWizardContactSheet: View {
    let store: OffersStore
    let onAdded: (OfferWizardSetup.Contact) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var saving = false
    @State private var problem: String?

    private var valid: Bool {
        !first.trimmingCharacters(in: .whitespaces).isEmpty && !last.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj nowego klienta").font(.title3.weight(.semibold))
            ProductField(label: "Imię *") { TextField("", text: $first).textFieldStyle(.roundedBorder) }
            ProductField(label: "Nazwisko *") { TextField("", text: $last).textFieldStyle(.roundedBorder) }
            ProductField(label: "Email") { TextField("", text: $email).textFieldStyle(.roundedBorder) }
            ProductField(label: "Telefon") { TextField("", text: $phone).textFieldStyle(.roundedBorder) }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Dodawanie…" : "Dodaj") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(!valid || saving || !state.canWrite)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let contact = try await store.wizardContact(first: first, last: last, email: email, phone: phone)
            state.succeed("Klient został dodany pomyślnie")
            onAdded(contact)
            dismiss()
        } catch {
            problem = store.failureText(error, "Wystąpił błąd podczas dodawania klienta")
        }
    }
}

// MARK: Krok 2 — dane podstawowe

@MainActor struct OfferWizardBasicsStep: View {
    @ObservedObject var model: OfferWizardModel
    @Environment(\.crmTheme) private var theme

    private func term(_ start: String, _ end: String?) -> String {
        let from = OfferText.dayTime(start)
        guard let end else { return "Termin wydarzenia: \(from)" }
        return "Termin wydarzenia: \(from) – \(OfferText.dayTime(end))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let event = model.setup?.event {
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.name).font(.callout.weight(.medium))
                    if let start = event.startsAt {
                        Text(term(start, event.endsAt)).font(.callout).foregroundStyle(.secondary)
                    }
                    Text("Dostępne dane zostały uzupełnione z wydarzenia. Możesz je dostosować do tej oferty.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            Text("Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np. OF/2025/11/001)")
                .font(.callout).foregroundStyle(.blue)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            ProductField(label: "Numer oferty (opcjonalnie)") {
                TextField("", text: $model.offerNumber, prompt: Text("Zostaw puste dla automatycznego numeru")).textFieldStyle(.roundedBorder)
            }
            OfferWizardAudienceFields(model: model)
            ProductField(label: "Miejsce wydarzenia") {
                TextField("", text: $model.location, prompt: Text("Wpisz miejsce wydarzenia")).textFieldStyle(.roundedBorder)
            }
            ProductField(label: "Ważna do") {
                HStack(spacing: 8) {
                    if let date = model.validUntil {
                        DatePicker("", selection: Binding(get: { date }, set: { model.validUntil = $0 }), displayedComponents: .date)
                            .labelsHidden().fixedSize()
                        Button("Wyczyść") { model.validUntil = nil }
                    } else {
                        Button { model.validUntil = Calendar.current.date(byAdding: .day, value: 14, to: Date()) } label: {
                            Label("Ustaw datę ważności", systemImage: "calendar")
                        }
                    }
                }
            }
            ProductField(label: "Cel wydarzenia") {
                ProductTextArea(text: $model.goal, prompt: "Co klient chce osiągnąć dzięki wydarzeniu?", lines: 3...6)
            }
            ProductField(label: "Notatki") {
                ProductTextArea(text: $model.notes, prompt: "Dodatkowe informacje o ofercie...", lines: 4...8)
            }
            if model.setup?.hasDescription == true {
                Text("Opis wydarzenia trafi do założeń oferty („Przebieg i potrzeby klienta”). Założenia zmienisz na stronie oferty.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }
}

/// Liczba osób i stoły (`OfferAudienceFields`) — w danych podstawowych i nad katalogiem.
@MainActor struct OfferWizardAudienceFields: View {
    @ObservedObject var model: OfferWizardModel

    private var needsTables: Bool { model.preview?.needsTables ?? false }
    private var tables: Double? {
        if let count = model.tableCount { return count }
        guard let guests = model.guestCount, guests > 0 else { return nil }
        let capacity = model.guestsPerTable ?? 10
        return capacity > 0 ? (guests / capacity).rounded(.up) : nil
    }

    private var tablesNote: String {
        let rule = "Liczbę stołów zaokrąglamy w górę. Możesz wpisać rzeczywistą liczbę zamiast wyliczonej."
        guard let tables else { return rule }
        return "Do wyceny: \(OfferText.number(tables)) stołów. " + rule
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Liczba osób — opcjonalnie") {
                    ProductNumberField(value: $model.guestCount, prompt: "Nie ustalono", nullable: true)
                }
                if needsTables {
                    ProductField(label: "Średnio osób przy okrągłym stole") {
                        ProductNumberField(value: $model.guestsPerTable, prompt: "10", nullable: true)
                    }
                    ProductField(label: "Liczba stołów — opcjonalnie") {
                        ProductNumberField(value: $model.tableCount, prompt: "Oblicz automatycznie", nullable: true)
                    }
                }
            }
            Text("Liczba osób jest wymagana przy pozycjach rozliczanych na osobę lub stół i pakietach korzystających z kalkulatora. Zmiana przelicza powiązane pozycje, zachowując rabaty.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if needsTables {
                Text(tablesNote).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
