import SwiftUI

// MARK: Kreator „Nowy sprzedawca” na Macu — osoba, hotel i sale, warunki marek, opiekun i zaproszenie do portalu.
// Braki i wskazówki widać od pierwszego kroku; zapis jest możliwy dopiero przy komplecie. Warunki zapisu są wspólne z CRM
// (`src/lib/seller/sellerProfileForm.ts`), zapis robi serwer CRM (`/bridge/native/v1/sellers`, `src/lib/native/sellerCreate.ts`):
// profil i warunki marek, opiekun (administrator) i zaproszenie — jak „Zapisz ustawienia” w CRM.

struct NewSellerSetup: Decodable {
    struct Option: Decodable, Hashable, Identifiable { let value: String; let label: String; var id: String { value } }
    struct Company: Decodable, Hashable, Identifiable { let id: String; let name: String }
    let isAdmin: Bool
    let employeeId: String
    let companies: [Company]
    let partnerTypes: [Option]
    let statuses: [Option]
    let paymentMethods: [Option]
    let defaultTaxRate: Double
    let defaultCommissionRate: Double
}

struct NewSellerPerson: Decodable, Hashable, Identifiable { let id: String; let name: String; let email: String?; let detail: String; let sellerId: String? }
struct NewSellerOrganization: Decodable, Hashable, Identifiable {
    let id: String; let name: String; let fullName: String?; let businessType: String?; let isHotel: Bool
    let locationId: String?; let locationName: String?; let rooms: [String]
}
struct NewSellerCheck: Decodable {
    struct Problem: Decodable, Hashable { let step: String; let section: String; let text: String }
    struct Hint: Decodable, Hashable { let step: String; let text: String }
    let problems: [Problem]
    let hints: [Hint]
    let existingSellerId: String?
}
struct NewSellerResult: Decodable { let ok: Bool; let id: String; let contactId: String?; let invited: Bool?; let warnings: [String]?; let message: String }

struct NewSellerTermDraft: Identifiable, Equatable {
    let companyID: String
    let name: String
    var active = false
    var commission = false
    var rate: Double
    var method = "cash_dividend"
    var tax: Double
    var id: String { companyID }
}

@MainActor final class NewSellerModel: ObservableObject {
    enum Step: Int, CaseIterable, Identifiable {
        case person, hotel, terms, manager, access
        var id: Int { rawValue }
        var key: String { ["person", "hotel", "terms", "manager", "access"][rawValue] }
        var title: String { ["Osoba", "Hotel i sale", "Warunki", "Opiekun", "Zaproszenie"][rawValue] }
        var symbol: String { ["person", "building.2", "percent", "person.2", "envelope"][rawValue] }
    }
    weak var store: SellersStore?
    @Published var setup: NewSellerSetup?
    @Published var setupError: String?
    @Published var personSource = "contact" { didSet { if oldValue != personSource { person = nil; people = []; partnerType = personSource == "employee" ? "internal_employee" : "hotel_employee"; if personSource == "employee" { portalEnabled = false } } } }
    @Published var person: NewSellerPerson?
    @Published var partnerType = "hotel_employee"
    @Published var status = "active"
    @Published var organization: NewSellerOrganization?
    @Published var notes = ""
    @Published var terms: [NewSellerTermDraft] = []
    @Published var defaultCompanyID = ""
    @Published var managerID = ""
    @Published var backupManagerID = ""
    @Published var portalEnabled = true
    @Published private(set) var check: NewSellerCheck?
    @Published var checkError: String?
    @Published private(set) var saving = false
    @Published private(set) var people: [NewSellerPerson] = []
    @Published private(set) var organizations: [NewSellerOrganization] = []
    @Published private(set) var searching = false

    private var api: NativeAPI? { store?.api }

    private func text(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func loadSetup() async {
        guard setup == nil, let api else { return }
        do {
            let value = try JSONDecoder().decode(NewSellerSetup.self, from: try await api.get("/sellers?op=newSeller"))
            setup = value
            terms = value.companies.map { NewSellerTermDraft(companyID: $0.id, name: $0.name, rate: value.defaultCommissionRate, tax: value.defaultTaxRate) }
            setupError = nil
        } catch {
            setupError = text(error, "Nie udało się przygotować kreatora.")
        }
    }

    private func encoded(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "" }

    func searchPeople(_ query: String) async {
        guard let api else { return }
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            people = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=\(personSource)&q=\(encoded(query))")).people
        } catch {
            people = []
            checkError = text(error, "Nie udało się wyszukać osób.")
        }
    }

    func searchOrganizations(_ query: String) async {
        guard let api else { return }
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let organizations: [NewSellerOrganization] }
            organizations = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=organizations&q=\(encoded(query))")).organizations
        } catch {
            organizations = []
            checkError = text(error, "Nie udało się wyszukać organizacji.")
        }
    }

    var activeTerms: [NewSellerTermDraft] { terms.filter(\.active) }

    /// Formularz w kształcie oczekiwanym przez serwer (`src/lib/native/sellerCreate.ts`).
    var form: JSONValue {
        .object([
            "personSource": .string(personSource),
            "personId": .string(person?.id ?? ""),
            "partnerType": .string(partnerType),
            "status": .string(status),
            "organizationId": .string(organization?.id ?? ""),
            "defaultCompanyId": .string(defaultCompanyID),
            "portalEnabled": .bool(portalEnabled),
            "notes": .string(notes),
            "managerId": .string(managerID),
            "backupManagerId": .string(backupManagerID),
            "terms": .array(terms.map { term -> JSONValue in
                .object([
                    "my_company_id": .string(term.companyID), "is_active": .bool(term.active), "commission_enabled": .bool(term.commission),
                    "default_commission_rate": .number(term.rate), "default_payment_method": .string(term.method), "dividend_tax_rate": .number(term.tax),
                ])
            }),
        ])
    }

    /// Klucz zmian formularza — sprawdzenie braków po krótkiej przerwie w pisaniu.
    var formKey: String {
        let parts: [String] = [personSource, person?.id ?? "", partnerType, status, organization?.id ?? "", defaultCompanyID, managerID,
                               backupManagerID, portalEnabled ? "1" : "0"] + terms.map { "\($0.companyID):\($0.active):\($0.commission):\($0.rate):\($0.method):\($0.tax)" }
        return parts.joined(separator: "|")
    }

    func validate() async {
        guard let api, setup != nil else { return }
        do {
            check = try JSONDecoder().decode(NewSellerCheck.self, from: try await api.post("/sellers", ["op": .string("validate"), "form": form]))
            checkError = nil
        } catch {
            checkError = text(error, "Nie udało się sprawdzić danych.")
        }
    }

    func problems(_ step: Step) -> [NewSellerCheck.Problem] { (check?.problems ?? []).filter { $0.step == step.key } }
    func hints(_ step: Step) -> [NewSellerCheck.Hint] { (check?.hints ?? []).filter { $0.step == step.key } }
    var ready: Bool { check != nil && (check?.problems.isEmpty ?? false) && !saving }

    func create(workspace: Workspace) async -> NewSellerResult? {
        guard let api, workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        saving = true
        defer { saving = false }
        do {
            let data = try await workspace.withPending(portalEnabled ? "Zapisywanie sprzedawcy i wysyłanie zaproszenia…" : "Zapisywanie sprzedawcy…") {
                try await api.post("/sellers", ["op": .string("create"), "form": form], timeout: 90)
            }
            return try JSONDecoder().decode(NewSellerResult.self, from: data)
        } catch {
            workspace.error = text(error, "Nie udało się zapisać sprzedawcy.")
            await validate()
            return nil
        }
    }
}

@MainActor struct NewSellerWizard: View {
    @ObservedObject var store: SellersStore
    /// Po zapisie: identyfikator nowego sprzedawcy (lista sprzedawców pokaże jego kartę).
    let onCreated: (NewSellerResult) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = NewSellerModel()
    @State private var step: NewSellerModel.Step = .person
    @State private var personQuery = ""
    @State private var organizationQuery = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nowy sprzedawca").font(.title3.weight(.light))
                    Text("Pięć kroków. Braki widzisz od początku — zapis będzie możliwy przy komplecie.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(16)
            Divider()
            if let error = model.setupError {
                ContentUnavailableView {
                    Label("Nie można dodać sprzedawcy", systemImage: "person.crop.circle.badge.exclamationmark")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await model.loadSetup() } } }
            } else if let setup = model.setup {
                HStack(spacing: 0) {
                    sidebar.frame(width: 260)
                    Divider()
                    VStack(spacing: 0) {
                        ScrollView { content(setup).padding(20).frame(maxWidth: .infinity, alignment: .leading) }
                        Divider()
                        footer.padding(12)
                    }
                }
            } else {
                ProgressView("Przygotowywanie kreatora…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 1000, height: 720)
        .task {
            // Listy osób i organizacji wczytują się w swoich krokach (po przygotowaniu kreatora).
            model.store = store
            await model.loadSetup()
        }
        .task(id: model.formKey) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await model.validate()
        }
    }

    // MARK: Kroki i gotowość

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(NewSellerModel.Step.allCases) { item in
                    let open = model.problems(item).count
                    Button { step = item } label: {
                        HStack(spacing: 10) {
                            ZStack {
                                Circle().fill(open > 0 ? theme.accent.opacity(0.15) : (model.check == nil ? Color.primary.opacity(0.08) : Color.green.opacity(0.15))).frame(width: 26, height: 26)
                                if open == 0 && model.check != nil { Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.green) }
                                else { Text("\(item.rawValue + 1)").font(.caption.weight(.semibold)).foregroundStyle(theme.accent) }
                            }
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title).font(.callout.weight(step == item ? .semibold : .regular))
                                Text(open > 0 ? "Do uzupełnienia: \(open)" : "Gotowe").font(.caption2).foregroundStyle(open > 0 ? Color.orange : Color.secondary)
                            }
                            Spacer()
                        }
                        .padding(8).contentShape(Rectangle())
                        .background(step == item ? theme.accent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                Divider().padding(.vertical, 6)
                Text("Gotowość").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if let error = model.checkError { Text(error).font(.caption).foregroundStyle(.red) }
                if let check = model.check {
                    if check.problems.isEmpty {
                        Label("Wszystko gotowe do zapisu", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.green)
                    }
                    ForEach(check.problems, id: \.self) { problem in
                        Button { step = NewSellerModel.Step.allCases.first(where: { $0.key == problem.step }) ?? step } label: {
                            Text("• \(problem.text)").font(.caption).foregroundStyle(.orange).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.plain)
                    }
                    ForEach(check.hints, id: \.self) { hint in
                        Text("• \(hint.text)").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text("Sprawdzanie…").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .crmBar()
    }

    private var footer: some View {
        HStack {
            if step != .person { Button("Wstecz") { step = NewSellerModel.Step(rawValue: step.rawValue - 1) ?? .person } }
            Spacer()
            if step != .access {
                Button("Dalej") { step = NewSellerModel.Step(rawValue: step.rawValue + 1) ?? .access }.keyboardShortcut(.defaultAction)
            } else {
                Button(model.portalEnabled ? "Zapisz i wyślij zaproszenie" : "Zapisz sprzedawcę") {
                    Task {
                        if let result = await model.create(workspace: state) {
                            let warnings = result.warnings ?? []
                            if warnings.isEmpty { state.succeed(result.message) }
                            else { state.error = ([result.message] + warnings).joined(separator: " ") }
                            dismiss()
                            onCreated(result)
                        }
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(!model.ready || !state.canWrite)
                .help(model.ready ? "Zapisz sprzedawcę" : "Uzupełnij braki z listy „Gotowość”")
            }
        }
    }

    @ViewBuilder private func content(_ setup: NewSellerSetup) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(step.rawValue + 1). \(step.title)").font(.title3)
            switch step {
            case .person: personStep(setup)
            case .hotel: hotelStep
            case .terms: termsStep(setup)
            case .manager: managerStep(setup)
            case .access: accessStep(setup)
            }
            stepNotes(step)
        }
    }

    private func stepNotes(_ step: NewSellerModel.Step) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(model.problems(step), id: \.self) { problem in Label(problem.text, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.orange) }
            ForEach(model.hints(step), id: \.self) { hint in Label(hint.text, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary) }
        }
    }

    // MARK: 1. Osoba

    private func personStep(_ setup: NewSellerSetup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sprzedawca to osoba z kartoteki kontaktów (np. pracownik hotelu) z adresem e-mail — na ten adres wyślemy zaproszenie do portalu.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if setup.isAdmin {
                Picker("Źródło osoby", selection: $model.personSource) {
                    Text("Kontakty CRM").tag("contact")
                    Text("Pracownicy Mavinci").tag("employee")
                }
                .pickerStyle(.segmented).frame(maxWidth: 360)
            }
            HStack {
                TextField(model.personSource == "employee" ? "Szukaj pracownika" : (setup.isAdmin ? "Szukaj kontaktu po imieniu, nazwisku lub e-mailu" : "Szukaj w swoich kontaktach"), text: $personQuery)
                    .textFieldStyle(.roundedBorder)
                if model.searching { ProgressView().controlSize(.small) }
            }
            .task(id: personQuery + "|" + model.personSource) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.searchPeople(personQuery)
            }
            VStack(spacing: 0) {
                ForEach(model.people) { person in
                    Button { if person.sellerId == nil { model.person = person } } label: {
                        HStack {
                            Image(systemName: model.person?.id == person.id ? "checkmark.circle.fill" : "circle").foregroundStyle(model.person?.id == person.id ? theme.accent : Color.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(person.name)
                                Text(person.detail).font(.caption).foregroundStyle(person.email == nil ? Color.orange : Color.secondary)
                            }
                            Spacer()
                            if person.sellerId != nil { Text("już sprzedawca").font(.caption).foregroundStyle(.secondary) }
                        }
                        .padding(.vertical, 6).padding(.horizontal, 8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(person.sellerId != nil)
                    Divider()
                }
                if model.people.isEmpty && !model.searching {
                    Text(personQuery.isEmpty ? "Brak osób do wyboru." : "Nic nie znaleziono. Dodaj kontakt w CRM i wróć do kreatora.").font(.callout).foregroundStyle(.secondary).padding(8)
                }
            }
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            if let person = model.person {
                Label("\(person.name) · \(person.email ?? "brak e-maila")", systemImage: "person.crop.circle.badge.checkmark").foregroundStyle(theme.accent)
            }
            HStack(spacing: 16) {
                Picker("Rodzaj współpracy", selection: $model.partnerType) {
                    ForEach(setup.partnerTypes) { option in Text(option.label).tag(option.value) }
                }
                .frame(maxWidth: 320)
                Picker("Status", selection: $model.status) {
                    ForEach(setup.statuses) { option in Text(option.label).tag(option.value) }
                }
                .frame(maxWidth: 240)
            }
        }
    }

    // MARK: 2. Hotel i sale

    private var hotelStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Organizacja, w imieniu której sprzedawca przygotowuje oferty. Hotel musi być powiązany z lokalizacją — z niej pochodzą sale, które hotel wybiera w kreatorze oferty.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                TextField("Szukaj hotelu lub organizacji", text: $organizationQuery).textFieldStyle(.roundedBorder)
                if model.searching { ProgressView().controlSize(.small) }
            }
            .task(id: organizationQuery) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.searchOrganizations(organizationQuery)
            }
            VStack(spacing: 0) {
                ForEach(model.organizations) { org in
                    Button { model.organization = org } label: {
                        HStack {
                            Image(systemName: model.organization?.id == org.id ? "checkmark.circle.fill" : "circle").foregroundStyle(model.organization?.id == org.id ? theme.accent : Color.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(org.name)
                                Text(locationText(org)).font(.caption).foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
                            }
                            Spacer()
                            if org.isHotel { Text("hotel").font(.caption2).foregroundStyle(.secondary) }
                        }
                        .padding(.vertical, 6).padding(.horizontal, 8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
                if model.organizations.isEmpty && !model.searching {
                    Text("Nic nie znaleziono. Dodaj organizację w CRM i wróć do kreatora.").font(.callout).foregroundStyle(.secondary).padding(8)
                }
            }
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            if let org = model.organization {
                VStack(alignment: .leading, spacing: 6) {
                    Text(org.name).font(.headline)
                    Text(locationText(org)).font(.callout).foregroundStyle(.secondary)
                    if !org.rooms.isEmpty {
                        HStack(spacing: 6) { ForEach(org.rooms.prefix(8), id: \.self) { room in Text(room).font(.caption).padding(.horizontal, 8).padding(.vertical, 3).background(Color.primary.opacity(0.06), in: Capsule()) } }
                    }
                    HStack {
                        Button("Otwórz organizację w CRM") { state.openCRM("/crm/contacts/\(org.id)") }
                        if let location = org.locationId { Button("Otwórz lokalizację w CRM") { state.openCRM("/crm/locations/\(location)") } }
                        Button("Sprawdź ponownie") { Task { await model.searchOrganizations(organizationQuery); if let fresh = model.organizations.first(where: { $0.id == org.id }) { model.organization = fresh } } }
                    }
                    .controlSize(.small)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
            TextField("Notatka — ustalenia dotyczące współpracy (opcjonalnie)", text: $model.notes, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
        }
    }

    private func locationText(_ org: NewSellerOrganization) -> String {
        guard org.locationId != nil else { return "Bez lokalizacji — powiąż organizację z lokalizacją w CRM" }
        let rooms = org.rooms.count
        let label = rooms == 1 ? "1 sala" : rooms >= 2 && rooms <= 4 ? "\(rooms) sale" : "\(rooms) sal"
        return "Lokalizacja: \(org.locationName ?? "—") · \(rooms == 0 ? "brak sal" : label)"
    }

    // MARK: 3. Warunki

    private func termsStep(_ setup: NewSellerSetup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Każda marka może mieć inną stawkę i sposób rozliczenia. Prowizja to % od zysku netto wydarzenia — po kosztach i po koszcie samej prowizji. Hotel zobaczy wynagrodzenie dopiero po jego odsłonięciu w karcie sprzedawcy.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach($model.terms) { $term in
                VStack(alignment: .leading, spacing: 8) {
                    Toggle(isOn: Binding(get: { $term.wrappedValue.active }, set: { value in
                        $term.wrappedValue.active = value
                        // Jak w CRM: nowa aktywna marka startuje z rozliczeniem prowizyjnym.
                        if value { $term.wrappedValue.commission = true }
                    })) { Text(term.name).font(.callout.weight(.medium)) }
                    .toggleStyle(.checkbox)
                    if term.active {
                        HStack(spacing: 14) {
                            Toggle("Rozliczenie prowizyjne", isOn: $term.commission).toggleStyle(.checkbox)
                            HStack(spacing: 4) {
                                Text("Prowizja (% od zysku)").font(.caption).foregroundStyle(.secondary)
                                TextField("", value: $term.rate, format: .number).frame(width: 70).textFieldStyle(.roundedBorder)
                            }
                            .disabled(!term.commission)
                            Picker("Wypłata", selection: $term.method) {
                                ForEach(setup.paymentMethods) { option in Text(option.label).tag(option.value) }
                            }
                            .frame(maxWidth: 260).disabled(!term.commission)
                            HStack(spacing: 4) {
                                Text("Podatek (%)").font(.caption).foregroundStyle(.secondary)
                                TextField("", value: $term.tax, format: .number).frame(width: 60).textFieldStyle(.roundedBorder)
                            }
                            .disabled(!term.commission || term.method != "cash_dividend")
                        }
                        .padding(.leading, 22)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(term.active ? theme.accent.opacity(0.06) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            }
            if model.activeTerms.count > 1 {
                Picker("Domyślny cennik nowych ofert w portalu", selection: $model.defaultCompanyID) {
                    Text("Wybierz aktywną markę").tag("")
                    ForEach(model.activeTerms) { term in Text(term.name).tag(term.companyID) }
                }
                .frame(maxWidth: 480)
            } else if let only = model.activeTerms.first {
                Text("Cennik nowych ofert: \(only.name) (jedyna aktywna marka).").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: 4. Opiekun

    @ViewBuilder private func managerStep(_ setup: NewSellerSetup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Opiekun prowadzi hotel od zaproszenia do rozliczenia: odpowiada na rozmowy, zatwierdza ceny spoza cennika i ocenia oferty. Zastępca widzi te same sprawy, gdy opiekuna nie ma.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if setup.isAdmin {
                let managers = store.cockpit?.managers ?? []
                Picker("Opiekun", selection: $model.managerID) {
                    Text("Bez opiekuna — przypiszę później").tag("")
                    ForEach(managers) { manager in Text(manager.eligible ? manager.name : "\(manager.name) (bez uprawnień)").tag(manager.id) }
                }
                .frame(maxWidth: 420)
                Picker("Zastępca", selection: $model.backupManagerID) {
                    Text("Bez zastępcy").tag("")
                    ForEach(managers.filter { $0.id != model.managerID }) { manager in Text(manager.eligible ? manager.name : "\(manager.name) (bez uprawnień)").tag(manager.id) }
                }
                .frame(maxWidth: 420).disabled(model.managerID.isEmpty)
                if managers.isEmpty { Text("Lista opiekunów pochodzi z kokpitu — odśwież kokpit, jeśli jest pusta.").font(.caption).foregroundStyle(.secondary) }
            } else {
                Label("Opiekuna i zastępcę przypisuje administrator w karcie sprzedawcy. Do tego czasu Ty ustawiasz warunki startowe.", systemImage: "info.circle")
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: 5. Zaproszenie

    private func accessStep(_ setup: NewSellerSetup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $model.portalEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nadaj dostęp do portalu sprzedawcy i wyślij zaproszenie")
                    Text("Zapis utworzy lub połączy konto i wyśle na e-mail kontaktu jednorazowy link do ustawienia hasła. Po pierwszym logowaniu hotel przejdzie przewodnik „Witaj w portalu MAVINCI”.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox).disabled(model.personSource != "contact")
            VStack(alignment: .leading, spacing: 6) {
                Text("Podsumowanie").font(.headline)
                summary("Osoba", personSummary)
                summary("Rodzaj i status", option(setup.partnerTypes, model.partnerType) + " · " + option(setup.statuses, model.status))
                summary("Hotel", hotelSummary)
                summary("Marki", termsSummary)
                if setup.isAdmin { summary("Opiekun", managerSummary) }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            Text("Po zapisie karta sprzedawcy pokaże „Gotowość do pracy”: sale, opiekuna, logowanie, wygląd ofert i pierwszą ofertę.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var personSummary: String {
        guard let person = model.person else { return "—" }
        return person.name + " · " + (person.email ?? "brak e-maila")
    }
    private var hotelSummary: String {
        guard let org = model.organization else { return "—" }
        return org.name + " · " + locationText(org)
    }
    private var termsSummary: String {
        let names = model.activeTerms.map { term -> String in term.commission ? term.name + " (" + formatted(term.rate) + "%)" : term.name }
        return names.isEmpty ? "—" : names.joined(separator: ", ")
    }
    private var managerSummary: String {
        let managers = store.cockpit?.managers ?? []
        return managers.first(where: { $0.id == model.managerID })?.name ?? "bez opiekuna"
    }
    private func option(_ options: [NewSellerSetup.Option], _ value: String) -> String {
        options.first(where: { $0.value == value })?.label ?? value
    }

    private func summary(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
            Text(value).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
    }

    private func formatted(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "pl_PL")))
    }
}
