import SwiftUI

// MARK: Kreator „Nowy sprzedawca” na Macu — osoba, hotel i sale, warunki marek, opiekun i zaproszenie do portalu.
// Braki i wskazówki widać od pierwszego kroku; zapis jest możliwy dopiero przy komplecie. Warunki zapisu są wspólne z CRM
// (`src/lib/seller/sellerProfileForm.ts`), zapis robi serwer CRM (`/bridge/native/v1/sellers`, `src/lib/native/sellerCreate.ts`):
// profil i warunki marek, opiekun (administrator) i zaproszenie — jak „Zapisz ustawienia” w CRM.
// Osoba: jedno pole wyszukiwania (`op=lookup`) — imię, nazwisko, e-mail, telefon, stanowisko albo nazwa organizacji; wynik to osoby
// z obecnymi organizacjami i organizacje (kliknięcie pokazuje ich osoby). Brakującą osobę albo organizację dodaje się w kreatorze
// (formularze Kontaktów) i jest od razu wybierana. „Pracownik Mavinci” — administrator. „Mianuj sprzedawcą” (karta i lista
// kontaktów, osoby organizacji) otwiera kreator z wybraną osobą i organizacją (`NewSellerPreset`, arkusz okna —
// `WindowNavigation.sellerAppointment`). Zaproszenie to e-mail z linkiem do hasła, adresem logowania, instrukcją, opiekunem
// i osobistą wiadomością (`SellerInviteView.swift`).

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
    /// Obecne organizacje osoby — w wynikach wyszukiwania (`lookup`) i przy wczytaniu jednej osoby (`people&id=…`).
    let organizations: [Organization]?
    let phone: String?
    /// Rodzaj kontaktu (`contact` | `individual`) — formularz „Uzupełnij e-mail”.
    let kind: String?
    /// Powód, dla którego tej osoby nie można wybrać (np. kontakt innego opiekuna — pracownik bez roli administratora).
    let blocked: String?
}
struct NewSellerOrganization: Decodable, Hashable, Identifiable {
    let id: String; let name: String; let fullName: String?; let businessType: String?; let isHotel: Bool
    let locationId: String?; let locationName: String?; let rooms: [String]
    let city: String?
    /// Obecne osoby organizacji (wyniki wyszukiwania).
    let peopleCount: Int?
}
struct NewSellerCheck: Decodable {
    struct Problem: Decodable, Hashable { let step: String; let section: String; let text: String }
    struct Hint: Decodable, Hashable { let step: String; let text: String }
    let problems: [Problem]
    let hints: [Hint]
    let existingSellerId: String?
}
/// Formularz Kontaktów otwarty z kreatora (nowa osoba, „Uzupełnij e-mail”, nowa organizacja) z wypełnionymi polami.
struct NewSellerContactRequest: Identifiable {
    let id = UUID()
    let mode: ContactEditorMode
    let organizationID: String?
    let values: [String: String]
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
    /// Kim jest sprzedawca: kontakt z kartoteki (osoba z organizacji albo bez niej) albo pracownik MAVINCI (administrator).
    enum PersonMode: String, Identifiable {
        case contact, employee
        var id: String { rawValue }
    }
    weak var store: SellersStore?
    @Published var setup: NewSellerSetup?
    @Published var setupError: String?
    @Published var personMode: PersonMode = .contact {
        didSet {
            guard oldValue != personMode else { return }
            clearPerson()
            people = []
            browsing = nil
            orgPeople = []
            switch personMode {
            case .employee:
                partnerType = "internal_employee"
                portalEnabled = false
            case .contact:
                partnerType = "hotel_employee"
                portalEnabled = true
            }
        }
    }
    /// Źródło osoby w formularzu serwera: kontakt albo pracownik.
    var personSource: String { personMode == .employee ? "employee" : "contact" }
    /// Organizacja wybranej osoby (jedyna obecna, wskazana albo wybrana z kilku) — od razu także organizacja ofert w kroku „Hotel i sale”.
    @Published private(set) var personOrganization: NewSellerOrganization?
    /// Wyniki wyszukiwania osoby (`lookup`): osoby i organizacje; bez frazy — ostatnio dodane kontakty (`recent`).
    @Published private(set) var found: [NewSellerPerson] = []
    @Published private(set) var foundOrganizations: [NewSellerOrganization] = []
    @Published private(set) var recent = false
    @Published private(set) var lookedUp = false
    /// Organizacja otwarta z wyników — lista jej obecnych osób.
    @Published private(set) var browsing: NewSellerOrganization?
    @Published private(set) var orgPeople: [NewSellerPerson] = []
    @Published private(set) var loadingOrgPeople = false
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

    /// Wartość parametru adresu — także `&`, `+`, `=` i `#` zakodowane (np. „B&B Hotel”, „+48 600…”).
    private func encoded(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    /// Jedno pole wyszukiwania osoby: osoby (z obecnymi organizacjami) i organizacje; bez frazy — ostatnio dodane kontakty.
    func lookup(_ query: String) async {
        guard let api, personMode == .contact else { return }
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson]; let organizations: [NewSellerOrganization]; let recent: Bool? }
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=lookup&q=\(encoded(query))"))
            // Nowsze wyszukiwanie (dalsze pisanie) albo inny tryb — ten wynik jest nieaktualny.
            guard !Task.isCancelled, personMode == .contact else { return }
            found = reply.people
            foundOrganizations = reply.organizations
            recent = reply.recent ?? false
            lookedUp = true
        } catch {
            guard !Task.isCancelled, personMode == .contact else { return }
            found = []
            foundOrganizations = []
            lookedUp = true
            checkError = text(error, "Nie udało się wyszukać osób.")
        }
    }

    /// Pracownicy MAVINCI (administrator) — wyszukiwanie po stronie serwera; kilka słów w dowolnej kolejności.
    func searchEmployees(_ query: String) async {
        guard let api, personMode == .employee else { return }
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            let list = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=employee&q=\(encoded(query))")).people
            guard !Task.isCancelled, personMode == .employee else { return }
            people = list
        } catch {
            guard !Task.isCancelled, personMode == .employee else { return }
            people = []
            checkError = text(error, "Nie udało się wyszukać pracowników.")
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

    /// Organizacja z wyników: lista jej obecnych osób (`nil` — powrót do wyników wyszukiwania).
    func browse(_ org: NewSellerOrganization?) async {
        browsing = org
        orgPeople = []
        guard org != nil else { return }
        await loadOrganizationPeople()
    }

    /// Organizacja dodana w kreatorze: od razu jej osoby i „Dodaj osobę do …”.
    func openOrganization(_ id: String) async {
        do {
            guard let org = try await loadOrganization(id) else { return }
            await browse(org)
        } catch {
            checkError = text(error, "Nie udało się wczytać organizacji.")
        }
    }

    /// Osoby obecnie zatrudnione w otwartej organizacji (`contact_organizations.is_current`).
    func loadOrganizationPeople() async {
        guard let api, let org = browsing else { return }
        loadingOrgPeople = true
        defer { loadingOrgPeople = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            let list = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=contact&organization=\(org.id)")).people
            guard browsing?.id == org.id else { return }
            orgPeople = list
        } catch {
            guard browsing?.id == org.id else { return }
            orgPeople = []
            checkError = text(error, "Nie udało się wczytać osób organizacji.")
        }
    }

    /// Wybór osoby. Organizacja sprzedawcy: wskazana (osoba z listy organizacji), jedyna obecna, przy kilku — wybór na karcie osoby.
    func choose(_ candidate: NewSellerPerson, organization preferred: NewSellerOrganization? = nil) async {
        clearPerson()
        person = candidate
        if let preferred { applyOrganization(preferred); return }
        guard let current = candidate.organizations else { return }
        if current.count == 1, let only = current.first {
            do {
                if let org = try await loadOrganization(only.id), person?.id == candidate.id { applyOrganization(org) }
            } catch {
                checkError = text(error, "Nie udało się wczytać organizacji.")
            }
        } else if current.isEmpty {
            // Bez organizacji — jak dawny tryb „Bez organizacji”: polecający niezależny.
            partnerType = "independent_referrer"
        }
    }

    /// Jedna z kilku obecnych organizacji wybranej osoby.
    func choosePersonOrganization(_ id: String) async {
        guard let current = person else { return }
        do {
            guard let org = try await loadOrganization(id), person?.id == current.id else { return }
            applyOrganization(org)
        } catch {
            checkError = text(error, "Nie udało się wczytać organizacji.")
        }
    }

    private func applyOrganization(_ org: NewSellerOrganization) {
        if let previous = personOrganization, organization?.id == previous.id { organization = nil }
        personOrganization = org
        organization = org
        partnerType = NewSellerModel.partnerType(for: org)
    }

    /// „Zmień osobę” — powrót do wyszukiwania; organizacja ofert przejęta od tej osoby też jest zwalniana.
    func clearPerson() {
        if let previous = personOrganization, organization?.id == previous.id { organization = nil }
        person = nil
        personOrganization = nil
    }

    /// Osoba z kartoteki po identyfikatorze — „Mianuj sprzedawcą”, kontakt dodany w kreatorze, odświeżenie po „Uzupełnij e-mail”.
    func selectContact(_ id: String, organizationID: String? = nil) async {
        guard let api else { return }
        presetLoading = true
        defer { presetLoading = false }
        do {
            struct Reply: Decodable { let people: [NewSellerPerson] }
            guard let match = try JSONDecoder().decode(Reply.self, from: try await api.get("/sellers?op=people&source=contact&id=\(id)")).people.first else {
                presetError = "Nie znaleziono tej osoby w kartotece kontaktów albo nie masz do niej dostępu. Wyszukaj ją poniżej."
                return
            }
            if personMode != .contact { personMode = .contact }
            presetError = nil
            var preferred: NewSellerOrganization?
            if let organizationID { preferred = try await loadOrganization(organizationID) }
            await choose(match, organization: preferred)
        } catch {
            presetError = text(error, "Nie udało się wczytać osoby. Wyszukaj ją poniżej.")
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

    /// „Mianuj sprzedawcą”: osoba z kartoteki i jej organizacja (wskazana albo jedyna obecna; kilka — wybór na karcie osoby).
    func applyPreset(_ preset: NewSellerPreset) async {
        guard !presetApplied else { return }
        presetApplied = true
        await selectContact(preset.contactID, organizationID: preset.organizationID)
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
    /// Wyszukiwanie wśród osób organizacji otwartej z wyników (krok „Hotel i sale” ma własne).
    @State private var personOrgQuery = ""
    @State private var organizationQuery = ""
    /// Formularze Kontaktów otwarte z kreatora: nowy kontakt / „Uzupełnij e-mail” i nowa organizacja.
    @State private var personEditor: NewSellerContactRequest?
    @State private var organizationEditor: NewSellerContactRequest?

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
            Text("Sprzedawca to osoba z kartoteki kontaktów (np. pracownik hotelu) z adresem e-mail — na ten adres wyślemy zaproszenie do portalu. Wpisz imię, nazwisko, e-mail, telefon albo nazwę hotelu. Jeśli osoby lub organizacji nie ma jeszcze w kartotece, dodasz je tutaj.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error = model.presetError {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            if setup.isAdmin && model.person == nil && !model.presetLoading {
                Picker("Kto będzie sprzedawcą", selection: $model.personMode) {
                    Text("Kontakt z kartoteki").tag(NewSellerModel.PersonMode.contact)
                    Text("Pracownik Mavinci").tag(NewSellerModel.PersonMode.employee)
                }
                .pickerStyle(.segmented).frame(maxWidth: 420)
            }
            if model.presetLoading {
                ProgressView("Wczytywanie osoby z kartoteki…").controlSize(.small)
            } else if let person = model.person {
                selectedPerson(person)
            } else if model.personMode == .employee {
                employeeSearch
            } else if let org = model.browsing {
                organizationPeople(org)
            } else {
                contactSearch
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
        .sheet(item: $personEditor) { request in
            PersonEditorSheet(store: state.contacts, mode: request.mode, initialValues: request.values, initialOrganizationID: request.organizationID) { id in
                Task { await model.selectContact(id, organizationID: request.organizationID) }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $organizationEditor) { request in
            OrganizationEditorSheet(store: state.contacts, mode: .create(.organization), onCreated: { id in
                personQuery = ""
                Task { await model.openOrganization(id) }
            }, initialValues: request.values)
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    /// Jedno pole: osoby (z obecnymi organizacjami) i organizacje; bez frazy — ostatnio dodane kontakty.
    @ViewBuilder private var contactSearch: some View {
        NewSellerSearchField(prompt: "Szukaj osoby lub organizacji — imię, nazwisko, e-mail, telefon, nazwa hotelu", text: $personQuery, busy: model.searching)
            .task(id: personQuery) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.lookup(personQuery)
            }
        if !model.found.isEmpty {
            sectionTitle(model.recent ? "Ostatnio dodane kontakty" : "Osoby")
            VStack(spacing: 0) {
                ForEach(model.found) { person in
                    personRow(person, organization: nil)
                    Divider()
                }
            }
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
        if !model.foundOrganizations.isEmpty {
            sectionTitle("Organizacje")
            VStack(spacing: 0) {
                ForEach(model.foundOrganizations) { org in
                    Button { Task { await model.browse(org) } } label: {
                        HStack {
                            Image(systemName: "building.2").foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(org.name)
                                Text(locationText(org)).font(.caption).foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
                            }
                            Spacer()
                            if org.isHotel { Text("hotel").font(.caption2).foregroundStyle(.secondary) }
                            Text(Self.peopleLabel(org.peopleCount ?? 0)).font(.caption).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 6).padding(.horizontal, 8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Pokaż osoby z \(org.name)")
                    Divider()
                }
            }
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
        if model.lookedUp && !model.searching && model.found.isEmpty && model.foundOrganizations.isEmpty {
            Text(personQuery.trimmingCharacters(in: .whitespaces).isEmpty
                 ? "Brak kontaktów do wyboru — dodaj osobę albo organizację poniżej."
                 : "Nie znaleziono „\(personQuery)” w kartotece — dodaj osobę albo organizację poniżej. Kreator od razu ją wybierze.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(.vertical, 4)
        }
        addButtons(organization: nil, query: personQuery)
    }

    /// Osoby organizacji otwartej z wyników — wybór osoby od razu z tą organizacją.
    @ViewBuilder private func organizationPeople(_ org: NewSellerOrganization) -> some View {
        Button { personOrgQuery = ""; Task { await model.browse(nil) } } label: {
            Label("Wyniki wyszukiwania", systemImage: "chevron.left")
        }
        .buttonStyle(.link)
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "building.2").font(.title3).foregroundStyle(theme.accent).frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(org.name).font(.headline)
                Text(locationText(org)).font(.caption).foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
            }
            Spacer()
        }
        .padding(10).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        NewSellerSearchField(prompt: "Szukaj osoby w \(org.name) — imię, nazwisko, e-mail, stanowisko", text: $personOrgQuery, busy: model.loadingOrgPeople)
        let people = model.filteredOrgPeople(personOrgQuery)
        VStack(spacing: 0) {
            ForEach(people) { person in
                personRow(person, organization: org)
                Divider()
            }
            if people.isEmpty && !model.loadingOrgPeople {
                Text(model.orgPeople.isEmpty ? "W tej organizacji nie ma jeszcze osób kontaktowych — dodaj osobę poniżej." : "Brak osób pasujących do wyszukiwania.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(8)
            }
        }
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        addButtons(organization: org, query: personOrgQuery)
    }

    /// „Pracownik Mavinci” — wyszukiwanie po stronie serwera (administrator).
    @ViewBuilder private var employeeSearch: some View {
        NewSellerSearchField(prompt: "Szukaj pracownika — imię, nazwisko, e-mail", text: $personQuery, busy: model.searching)
            .task(id: personQuery) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.searchEmployees(personQuery)
            }
        VStack(spacing: 0) {
            ForEach(model.people) { person in
                personRow(person, organization: nil)
                Divider()
            }
            if model.people.isEmpty && !model.searching {
                Text(personQuery.isEmpty ? "Brak pracowników do wyboru." : "Nic nie znaleziono.").font(.callout).foregroundStyle(.secondary).padding(8)
            }
        }
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 2)
    }

    /// Wiersz osoby: dane, obecne organizacje, „już sprzedawca” (z kartą) albo powód blokady.
    private func personRow(_ person: NewSellerPerson, organization org: NewSellerOrganization?) -> some View {
        let unavailable = person.sellerId != nil || person.blocked != nil
        return HStack(alignment: .top, spacing: 8) {
            Button { Task { await model.choose(person, organization: org) } } label: {
                HStack(alignment: .top) {
                    Image(systemName: "person.crop.circle").foregroundStyle(unavailable ? Color.secondary : theme.accent).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(person.name).foregroundStyle(unavailable ? Color.secondary : Color.primary)
                        Text(person.detail).font(.caption).foregroundStyle(person.email == nil ? Color.orange : Color.secondary)
                        if org == nil, let organizations = person.organizations, !organizations.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(organizations.prefix(3)) { item in
                                    Label(item.name, systemImage: "building.2").font(.caption2).lineLimit(1)
                                        .padding(.horizontal, 6).padding(.vertical, 2).background(Color.primary.opacity(0.06), in: Capsule())
                                }
                                if organizations.count > 3 { Text("+\(organizations.count - 3)").font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                        if let blocked = person.blocked {
                            Text(blocked).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 6).padding(.leading, 8).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(unavailable)
            if person.sellerId != nil {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("już sprzedawca").font(.caption).foregroundStyle(.secondary)
                    if model.personMode == .contact {
                        Button("Karta sprzedawcy") { dismiss(); state.showSeller(contactID: person.id) }.buttonStyle(.link).font(.caption)
                    }
                }
                .padding(.vertical, 6).padding(.trailing, 8)
            }
        }
    }

    /// „Nowy kontakt” / „Dodaj osobę do …” i „Nowa organizacja” — formularze Kontaktów; nowa osoba jest od razu wybierana.
    @ViewBuilder private func addButtons(organization org: NewSellerOrganization?, query: String) -> some View {
        if state.employee?.canView(.contacts) == true {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    Button { Task { await openPersonEditor(organization: org, query: query) } } label: {
                        Label(org.map { "Dodaj osobę do \($0.name)" } ?? "Nowy kontakt", systemImage: "person.badge.plus")
                    }
                    if org == nil {
                        Button { Task { await openOrganizationEditor(query: query) } } label: {
                            Label("Nowa organizacja", systemImage: "building.2.crop.circle")
                        }
                    }
                    Spacer()
                }
                Text(org == nil
                     ? "Nie ma osoby w kartotece? Dodaj ją — kreator od razu ją wybierze. Nową organizację (np. hotel) dodasz razem z jej pracownikami."
                     : "Nowa osoba zostanie powiązana z tą organizacją i od razu wybrana w kreatorze.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 4)
        }
    }

    /// Formularze Kontaktów potrzebują kopii listy kontaktów (wybór organizacji, sprawdzenie duplikatu).
    private func prepareContacts() async {
        if state.contacts.contacts.isEmpty { await state.contacts.backgroundSync() }
    }
    private func openPersonEditor(organization org: NewSellerOrganization?, query: String) async {
        await prepareContacts()
        personEditor = NewSellerContactRequest(mode: .create(.contact), organizationID: org?.id, values: Self.prefill(query))
    }
    private func openOrganizationEditor(query: String) async {
        await prepareContacts()
        let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
        organizationEditor = NewSellerContactRequest(mode: .create(.organization), organizationID: nil,
                                                     values: name.isEmpty || name.contains("@") ? [:] : ["name": name])
    }

    /// Pola nowego kontaktu z wyszukiwanej frazy: e-mail, telefon albo imię i nazwisko.
    static func prefill(_ query: String) -> [String: String] {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [:] }
        if text.contains("@") { return ["email": text] }
        let digits = text.filter(\.isNumber).count
        let visible = text.filter({ !$0.isWhitespace }).count
        if digits >= 6 && digits * 2 >= visible { return ["mobile": text] }
        let words = text.split(separator: " ").map { word -> String in word.prefix(1).uppercased() + word.dropFirst() }
        var values: [String: String] = ["first_name": words.first ?? ""]
        if words.count > 1 { values["last_name"] = words.dropFirst().joined(separator: " ") }
        return values
    }

    /// „1 osoba”, „3 osoby”, „5 osób”.
    static func peopleLabel(_ count: Int) -> String {
        if count == 0 { return "brak osób" }
        if count == 1 { return "1 osoba" }
        let tens = count % 100, units = count % 10
        return "\(count) " + ((2...4).contains(units) && !(12...14).contains(tens) ? "osoby" : "osób")
    }

    /// Wybrana osoba: dane, organizacja (przy kilku — wybór), „Uzupełnij e-mail” i „Zmień osobę”.
    private func selectedPerson(_ person: NewSellerPerson) -> some View {
        let organizations = person.organizations ?? []
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "person.crop.circle.badge.checkmark").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(person.name).font(.headline)
                    if let email = person.email {
                        Text(email).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    } else {
                        HStack(spacing: 8) {
                            Text("Brak adresu e-mail — bez niego nie wyślemy zaproszenia do portalu.").font(.callout).foregroundStyle(.orange)
                            if model.personMode == .contact && state.employee?.canView(.contacts) == true {
                                Button("Uzupełnij e-mail") { Task { await editPerson(person) } }.controlSize(.small)
                            }
                        }
                    }
                    if let phone = person.phone { Text(phone).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    if let org = model.personOrganization {
                        Text("Organizacja: \(org.name) · \(locationText(org))").font(.caption).foregroundStyle(.secondary)
                    } else if model.personMode == .contact && organizations.isEmpty {
                        Text("Bez organizacji — organizację, w imieniu której sprzedawca przygotuje oferty, wskażesz w kroku „Hotel i sale”.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
                Button("Zmień osobę") { model.presetError = nil; model.clearPerson() }.controlSize(.small)
            }
            if organizations.count > 1 {
                Picker("Organizacja sprzedawcy", selection: Binding(get: { model.personOrganization?.id ?? "" }, set: { id in
                    if !id.isEmpty { Task { await model.choosePersonOrganization(id) } }
                })) {
                    Text("Wybierz organizację…").tag("")
                    ForEach(organizations) { org in Text(org.name).tag(org.id) }
                }
                .frame(maxWidth: 440)
            }
            if person.sellerId != nil {
                Label("Ta osoba jest już sprzedawcą — otwórz jej kartę na liście sprzedawców.", systemImage: "info.circle").foregroundStyle(.orange)
            }
            if let blocked = person.blocked {
                Label(blocked, systemImage: "lock").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    /// „Uzupełnij e-mail” — formularz kontaktu; po zapisie dane osoby wczytują się ponownie (z tą samą organizacją).
    private func editPerson(_ person: NewSellerPerson) async {
        await prepareContacts()
        let kind = ContactKind(rawValue: person.kind ?? "contact") ?? .contact
        personEditor = NewSellerContactRequest(mode: .edit(ContactRef(id: person.id, kind: kind == .organization ? .contact : kind)),
                                               organizationID: model.personOrganization?.id, values: [:])
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
