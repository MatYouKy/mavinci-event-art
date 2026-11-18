import SwiftUI

// MARK: Kreator „Nowy sprzedawca” na Macu — osoba, hotel i sale, warunki marek, opiekun i zaproszenie do portalu.
// Braki i wskazówki widać od pierwszego kroku; zapis jest możliwy dopiero przy komplecie. Warunki zapisu są wspólne z CRM
// (`src/lib/seller/sellerProfileForm.ts`), zapis robi serwer CRM (`/bridge/native/v1/sellers`, `src/lib/native/sellerCreate.ts`):
// profil i warunki marek, opiekun (administrator) i zaproszenie — jak „Zapisz ustawienia” w CRM.
// Osoba: najpierw organizacja (wyszukiwanie), potem jej pracownicy; „Bez organizacji” — kontakty bez obecnej organizacji;
// „Pracownicy Mavinci” — administrator. „Mianuj sprzedawcą” (karta i lista kontaktów, osoby organizacji) otwiera kreator
// z wybraną osobą i organizacją (`NewSellerPreset`, arkusz okna — `WindowNavigation.sellerAppointment`). Zaproszenie to e-mail
// z linkiem do hasła, adresem logowania, instrukcją, opiekunem i osobistą wiadomością (`SellerInviteView.swift`).

/// „Mianuj sprzedawcą”: kreator z wybraną osobą (kontakt) i — gdy znana — organizacją.
struct NewSellerPreset: Identifiable, Equatable {
    let id = UUID()
    let contactID: String
    var organizationID: String?
}

extension Workspace {
    /// „Mianuj sprzedawcą” — kreator „Nowy sprzedawca” z tą osobą w oknie, w którym pracuje użytkownik.
    func appointSeller(contactID: String, organizationID: String? = nil) {
        sellers.workspace = self
        activeNavigation.sellerAppointment = NewSellerPreset(contactID: contactID, organizationID: organizationID)
    }

    /// Po zapisie z „Mianuj sprzedawcą”: odświeżenie kontaktów (odznaka „Sprzedawca”) i kokpitu, skrót do karty sprzedawcy.
    func sellerAppointed(_ result: NewSellerResult) {
        Task {
            await contacts.sync(force: true)
            await sellers.load()
        }
        guard (result.warnings ?? []).isEmpty, let contactID = result.contactId else { return }
        snack = Snack(kind: .success, text: result.message, action: Snack.Action(title: "Karta sprzedawcy") { self.showSeller(contactID: contactID) })
    }
}

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

struct NewSellerPerson: Decodable, Hashable, Identifiable {
    struct Organization: Decodable, Hashable, Identifiable { let id: String; let name: String }
    let id: String; let name: String; let email: String?; let detail: String; let sellerId: String?
    /// Obecne organizacje osoby — przy wczytaniu jednej osoby (`people&id=…`, „Mianuj sprzedawcą”).
    let organizations: [Organization]?
}
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
    /// Skąd jest osoba: pracownik wybranej organizacji, kontakt bez organizacji albo pracownik MAVINCI (administrator).
    enum PersonMode: String, Identifiable {
        case organization, unaffiliated, employee
        var id: String { rawValue }
    }
    weak var store: SellersStore?
    @Published var setup: NewSellerSetup?
    @Published var setupError: String?
    @Published var personMode: PersonMode = .organization {
        didSet {
            guard oldValue != personMode else { return }
            person = nil
            people = []
            switch personMode {
            case .employee:
                partnerType = "internal_employee"
                portalEnabled = false
            case .unaffiliated:
                partnerType = "independent_referrer"
                personOrganization = nil
                orgPeople = []
                if oldValue == .employee { portalEnabled = true }
            case .organization:
                if let org = personOrganization { partnerType = NewSellerModel.partnerType(for: org) } else { partnerType = "hotel_employee" }
                if oldValue == .employee { portalEnabled = true }
            }
        }
    }
    /// Źródło osoby w formularzu serwera: kontakt albo pracownik.
    var personSource: String { personMode == .employee ? "employee" : "contact" }
    /// Organizacja wybrana w kroku „Osoba” (lista jej pracowników) — od razu także organizacja ofert w kroku „Hotel i sale”.
    @Published var personOrganization: NewSellerOrganization?
    @Published private(set) var orgPeople: [NewSellerPerson] = []
    @Published private(set) var loadingOrgPeople = false
    /// „Mianuj sprzedawcą”: osoba wybrana przed otwarciem kreatora (bez listy wyboru, z „Wybierz inną osobę”).
    @Published var presetLocked = false
    @Published var presetError: String?
    private(set) var presetApplied = false
    @Published private(set) var presetLoading = false
    /// Osobista wiadomość w e-mailu z zaproszeniem.
    @Published var inviteMessage = ""
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

    /// Osoby bez organizacji albo pracownicy MAVINCI (wyszukiwanie po stronie serwera; kilka słów w dowolnej kolejności).
    func searchPeople(_ query: String) async {
        guard let api, personMode != .organization else { return }
        let mode = personMode
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            let path = mode == .employee
                ? "/sellers?op=people&source=employee&q=\(encoded(query))"
                : "/sellers?op=people&source=contact&unaffiliated=1&q=\(encoded(query))"
            let list = try JSONDecoder().decode(Reply.self, from: try await api.get(path)).people
            // Nowsze wyszukiwanie (dalsze pisanie) albo inny tryb — ten wynik jest nieaktualny.
            guard !Task.isCancelled, mode == personMode else { return }
            people = list
        } catch {
            guard !Task.isCancelled, mode == personMode else { return }
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
            let list = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=organizations&q=\(encoded(query))")).organizations
            guard !Task.isCancelled else { return }
            organizations = list
        } catch {
            guard !Task.isCancelled else { return }
            organizations = []
            checkError = text(error, "Nie udało się wyszukać organizacji.")
        }
    }

    /// Rodzaj współpracy z profilu organizacji: hotel — pracownik hotelu, freelancer — niezależny polecający, inne — agencja.
    static func partnerType(for org: NewSellerOrganization) -> String {
        if org.isHotel { return "hotel_employee" }
        return org.businessType == "freelancer" ? "independent_referrer" : "agency_employee"
    }

    /// Organizacja w kroku „Osoba”: jej pracownicy do wyboru, ta sama organizacja ofert w kroku „Hotel i sale”. `nil` — zmiana organizacji.
    func choosePersonOrganization(_ org: NewSellerOrganization?) async {
        personOrganization = org
        person = nil
        orgPeople = []
        guard let org else { return }
        organization = org
        partnerType = NewSellerModel.partnerType(for: org)
        await loadOrganizationPeople()
    }

    /// Osoby obecnie zatrudnione w wybranej organizacji (`contact_organizations.is_current`).
    func loadOrganizationPeople() async {
        guard let api, let org = personOrganization else { return }
        loadingOrgPeople = true
        defer { loadingOrgPeople = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            let list = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=contact&organization=\(org.id)")).people
            guard personOrganization?.id == org.id else { return }
            orgPeople = list
        } catch {
            guard personOrganization?.id == org.id else { return }
            orgPeople = []
            checkError = text(error, "Nie udało się wczytać osób organizacji.")
        }
    }

    /// Wyszukiwanie wśród pracowników organizacji — każde słowo w imieniu i nazwisku, e-mailu albo stanowisku.
    func filteredOrgPeople(_ query: String) -> [NewSellerPerson] {
        let fold: (String) -> String = { $0.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pl_PL")) }
        let words = fold(query).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !words.isEmpty else { return orgPeople }
        return orgPeople.filter { person in
            let haystack = fold("\(person.name) \(person.email ?? "") \(person.detail)")
            return words.allSatisfy { haystack.contains($0) }
        }
    }

    private func loadOrganization(_ id: String) async throws -> NewSellerOrganization? {
        guard let api else { return nil }
        struct Reply: Decodable { let organizations: [NewSellerOrganization] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=organizations&id=\(id)")).organizations.first
    }

    /// „Mianuj sprzedawcą”: osoba z kartoteki i jej organizacja (wskazana albo jedyna obecna; kilka — wybór w kroku „Osoba”).
    func applyPreset(_ preset: NewSellerPreset) async {
        guard !presetApplied, let api else { return }
        presetApplied = true
        presetLoading = true
        defer { presetLoading = false }
        presetError = nil
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            guard let found = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=contact&id=\(preset.contactID)")).people.first else {
                presetError = "Nie znaleziono tej osoby w kartotece kontaktów albo nie masz do niej dostępu. Wybierz osobę z listy."
                return
            }
            let current = found.organizations ?? []
            let organizationID = preset.organizationID ?? (current.count == 1 ? current.first?.id : nil)
            if let organizationID, let org = try await loadOrganization(organizationID) {
                personMode = .organization
                personOrganization = org
                organization = org
                partnerType = NewSellerModel.partnerType(for: org)
                orgPeople = [found]
            } else if current.isEmpty {
                personMode = .unaffiliated
            }
            person = found
            presetLocked = true
        } catch {
            presetError = text(error, "Nie udało się wczytać osoby. Wybierz ją z listy.")
        }
    }

    /// Jedna z kilku obecnych organizacji osoby wybranej przez „Mianuj sprzedawcą”.
    func choosePresetOrganization(_ id: String) async {
        guard let current = person else { return }
        do {
            guard let org = try await loadOrganization(id), person?.id == current.id else { return }
            personOrganization = org
            organization = org
            partnerType = NewSellerModel.partnerType(for: org)
            orgPeople = [current]
        } catch {
            checkError = text(error, "Nie udało się wczytać organizacji.")
        }
    }

    /// „Wybierz inną osobę” — lista wyboru (pracownicy wybranej organizacji albo wyszukiwanie).
    func unlockPreset() async {
        presetLocked = false
        person = nil
        if personOrganization != nil { await loadOrganizationPeople() }
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
            "inviteMessage": .string(inviteMessage.trimmingCharacters(in: .whitespacesAndNewlines)),
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
    /// „Mianuj sprzedawcą” — osoba (i organizacja) wybrana przed otwarciem kreatora.
    var preset: NewSellerPreset? = nil
    /// Po zapisie: identyfikator nowego sprzedawcy (lista sprzedawców pokaże jego kartę).
    let onCreated: (NewSellerResult) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = NewSellerModel()
    @State private var step: NewSellerModel.Step = .person
    @State private var personQuery = ""
    /// Wyszukiwanie organizacji w kroku „Osoba” (krok „Hotel i sale” ma własne).
    @State private var personOrgQuery = ""
    @State private var organizationQuery = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(preset == nil ? "Nowy sprzedawca" : "Mianuj sprzedawcą").font(.title3.weight(.light))
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
            // Opiekunowie do wyboru pochodzą z kokpitu — z karty kontaktu kokpit mógł nie być jeszcze wczytany.
            if store.cockpit == nil && !store.loading { Task { await store.load() } }
            await model.loadSetup()
            if let preset, model.setup != nil { await model.applyPreset(preset) }
        }
        .onChange(of: model.personMode) { _, _ in personQuery = "" }
        .onChange(of: model.inviteMessage) { _, value in
            // Limit serwera — dłuższa wiadomość zostałaby ucięta w e-mailu.
            if value.count > 2000 { model.inviteMessage = String(value.prefix(2000)) }
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
            Text("Sprzedawca to osoba z kartoteki kontaktów (np. pracownik hotelu) z adresem e-mail — na ten adres wyślemy zaproszenie do portalu. Wybierz organizację, w której pracuje, a potem osobę z jej zespołu.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error = model.presetError {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            if model.presetLoading {
                ProgressView("Wczytywanie osoby z kartoteki…").controlSize(.small)
            } else if model.presetLocked, let person = model.person {
                presetPerson(person)
            } else {
                Picker("Źródło osoby", selection: $model.personMode) {
                    Text("Pracownik organizacji").tag(NewSellerModel.PersonMode.organization)
                    Text("Bez organizacji").tag(NewSellerModel.PersonMode.unaffiliated)
                    if setup.isAdmin { Text("Pracownicy Mavinci").tag(NewSellerModel.PersonMode.employee) }
                }
                .pickerStyle(.segmented).frame(maxWidth: 560)
                switch model.personMode {
                case .organization: organizationPeople
                case .unaffiliated, .employee: searchedPeople(setup)
                }
                if let person = model.person {
                    Label("\(person.name) · \(person.email ?? "brak e-maila")", systemImage: "person.crop.circle.badge.checkmark").foregroundStyle(theme.accent)
                }
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

    /// Pracownik organizacji: najpierw organizacja (wyszukiwanie), potem osoby obecnie w niej zatrudnione.
    @ViewBuilder private var organizationPeople: some View {
        if let org = model.personOrganization {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "building.2").font(.title3).foregroundStyle(theme.accent).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(org.name).font(.headline)
                    Text(locationText(org)).font(.caption).foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
                }
                Spacer()
                Button("Zmień organizację") { personQuery = ""; Task { await model.choosePersonOrganization(nil) } }.controlSize(.small)
            }
            .padding(10).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            NewSellerSearchField(prompt: "Szukaj osoby w \(org.name) — imię, nazwisko, e-mail, stanowisko", text: $personQuery, busy: model.loadingOrgPeople)
            peopleList(model.filteredOrgPeople(personQuery), busy: model.loadingOrgPeople,
                       empty: model.orgPeople.isEmpty
                        ? "W tej organizacji nie ma jeszcze osób kontaktowych. Dodaj osobę na karcie organizacji albo wybierz „Bez organizacji”."
                        : "Brak osób pasujących do wyszukiwania.")
        } else {
            NewSellerSearchField(prompt: "Szukaj hotelu lub organizacji, w której pracuje sprzedawca", text: $personOrgQuery, busy: model.searching)
                .task(id: personOrgQuery) {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    await model.searchOrganizations(personOrgQuery)
                }
            VStack(spacing: 0) {
                ForEach(model.organizations) { org in
                    Button { personQuery = ""; Task { await model.choosePersonOrganization(org) } } label: {
                        HStack {
                            Image(systemName: "building.2").foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(org.name)
                                Text(locationText(org)).font(.caption).foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
                            }
                            Spacer()
                            if org.isHotel { Text("hotel").font(.caption2).foregroundStyle(.secondary) }
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 6).padding(.horizontal, 8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
                if model.organizations.isEmpty && !model.searching {
                    Text(personOrgQuery.isEmpty ? "Brak organizacji do wyboru." : "Nie znaleziono organizacji. Dodaj ją w Kontaktach albo wybierz „Bez organizacji”.")
                        .font(.callout).foregroundStyle(.secondary).padding(8)
                }
            }
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    /// „Bez organizacji” i „Pracownicy Mavinci” — wyszukiwanie po stronie serwera.
    @ViewBuilder private func searchedPeople(_ setup: NewSellerSetup) -> some View {
        let employees = model.personMode == .employee
        NewSellerSearchField(prompt: employees ? "Szukaj pracownika — imię, nazwisko, e-mail"
                                : (setup.isAdmin ? "Szukaj osoby bez organizacji — imię, nazwisko, e-mail" : "Szukaj w swoich kontaktach bez organizacji"),
                             text: $personQuery, busy: model.searching)
            .task(id: personQuery + "|" + model.personMode.rawValue) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.searchPeople(personQuery)
            }
        if !employees {
            Text("Kontakty bez obecnej organizacji w kartotece. Pracownika hotelu znajdziesz w „Pracownik organizacji”.")
                .font(.caption).foregroundStyle(.secondary)
        }
        peopleList(model.people, busy: model.searching,
                   empty: personQuery.isEmpty ? "Brak osób do wyboru." : "Nic nie znaleziono. Dodaj kontakt w CRM i wróć do kreatora.")
    }

    private func peopleList(_ people: [NewSellerPerson], busy: Bool, empty: String) -> some View {
        VStack(spacing: 0) {
            ForEach(people) { person in
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
            if people.isEmpty && !busy {
                Text(empty).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(8)
            }
        }
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    /// Osoba wybrana przez „Mianuj sprzedawcą”: dane, organizacja (przy kilku — wybór) i „Wybierz inną osobę”.
    private func presetPerson(_ person: NewSellerPerson) -> some View {
        let organizations = person.organizations ?? []
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "person.crop.circle.badge.checkmark").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(person.name).font(.headline)
                    Text(person.email ?? "Brak adresu e-mail — uzupełnij go na karcie kontaktu, aby wysłać zaproszenie.")
                        .font(.callout).foregroundStyle(person.email == nil ? Color.orange : Color.secondary)
                    if let org = model.personOrganization {
                        Text("Organizacja: \(org.name) · \(locationText(org))").font(.caption).foregroundStyle(.secondary)
                    } else if organizations.isEmpty {
                        Text("Bez organizacji — organizację, w imieniu której sprzedawca przygotuje oferty, wskażesz w kroku „Hotel i sale”.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
                Button("Wybierz inną osobę") { personQuery = ""; Task { await model.unlockPreset() } }.controlSize(.small)
            }
            if organizations.count > 1 {
                Picker("Organizacja sprzedawcy", selection: Binding(get: { model.personOrganization?.id ?? "" }, set: { id in
                    if !id.isEmpty { Task { await model.choosePresetOrganization(id) } }
                })) {
                    Text("Wybierz organizację…").tag("")
                    ForEach(organizations) { org in Text(org.name).tag(org.id) }
                }
                .frame(maxWidth: 440)
            }
            if person.sellerId != nil {
                Label("Ta osoba jest już sprzedawcą — otwórz jej kartę na liście sprzedawców.", systemImage: "info.circle").foregroundStyle(.orange)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: 2. Hotel i sale

    private var hotelStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Organizacja, w imieniu której sprzedawca przygotowuje oferty. Hotel musi być powiązany z lokalizacją — z niej pochodzą sale, które hotel wybiera w kreatorze oferty.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let org = model.organization, org.id == model.personOrganization?.id {
                Label("Organizacja z kroku „Osoba” — możesz wskazać inną, w imieniu której sprzedawca będzie tworzył oferty.", systemImage: "info.circle")
                    .font(.caption).foregroundStyle(.secondary)
            }
            NewSellerSearchField(prompt: "Szukaj hotelu lub organizacji", text: $organizationQuery, busy: model.searching, focusOnAppear: model.organization == nil)
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
                    Text("Zapis utworzy lub połączy konto i wyśle na e-mail kontaktu jednorazowy link do ustawienia hasła, adres logowania i instrukcję. Po pierwszym logowaniu hotel przejdzie przewodnik „Witaj w portalu MAVINCI”.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox).disabled(model.personSource != "contact")
            if model.portalEnabled && model.personSource == "contact" {
                SellerInviteContents(email: model.person?.email, contactName: inviteContactName(setup), managerAssigned: setup.isAdmin && !model.managerID.isEmpty,
                                     brands: model.activeTerms.map(\.name))
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Wiadomość od Ciebie (opcjonalnie) — np. powitanie i termin pierwszej rozmowy", text: $model.inviteMessage, axis: .vertical)
                        .lineLimit(3...6).textFieldStyle(.roundedBorder)
                    Text("Wiadomość trafi do e-maila nad instrukcją, podpisana Twoim imieniem i nazwiskiem.").font(.caption).foregroundStyle(.secondary)
                }
            }
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

    /// Kontakt w e-mailu: wybrany opiekun (administrator) albo zapraszający pracownik.
    private func inviteContactName(_ setup: NewSellerSetup) -> String? {
        if setup.isAdmin, let manager = store.cockpit?.managers.first(where: { $0.id == model.managerID }) { return manager.name }
        return state.employee?.displayName
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

/// Pole wyszukiwania kreatora: lupa, czyszczenie i kursor w polu po pokazaniu (wyraźne miejsce do wpisania frazy).
struct NewSellerSearchField: View {
    let prompt: String
    @Binding var text: String
    var busy = false
    var focusOnAppear = true
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text).textFieldStyle(.plain).focused($focused)
            if busy { ProgressView().controlSize(.small) }
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.plain).help("Wyczyść wyszukiwanie")
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(focused ? Color.accentColor.opacity(0.8) : Color.primary.opacity(0.15), lineWidth: focused ? 1.5 : 1))
        .task {
            guard focusOnAppear else { return }
            // Po pokazaniu arkusza / kroku — wtedy pole może przyjąć kursor.
            try? await Task.sleep(nanoseconds: 150_000_000)
            focused = true
        }
    }
}
