import SwiftUI

// MARK: Karta sprzedawcy → „Ustawienia” 1:1 z zakładką „Ustawienia” karty sprzedawcy w CRM (`CrmSellerWorkspace`):
// „Opiekun i zastępca” i „Wynagrodzenie w portalu” (`SellerManagementPanel`: `SellerManagerAssignment`,
// `CommissionVisibilityToggle`) oraz profil sprzedawcy (`CrmSellerProfileSettings` w trybie edycji: organizacja i współpraca,
// cennik i zasady prowizji, dostęp do portalu, braki przed zapisem). Serwer: `/bridge/native/v1/sellers` (`management`,
// `settings`, `manager`, `visibility`, `settingsValidate`, `settingsSave` — `src/lib/native/sellerSettings.ts`); warunki
// zapisu wspólne z CRM (`sellerProfileProblems`). Indywidualne ceny — `SellerPricingView.swift`; „Branding i wizytówka — podgląd”
// (`CrmOfferBrandingPanel`) — `OfferBrandingPanel` (`Contacts/OfferBrandingView.swift`).

/// Opiekun, zastępca, marki i widoczność wynagrodzenia (`op=management`).
struct SellerManagementData: Decodable {
    struct Manager: Decodable, Identifiable, Hashable { let id: String; let name: String; let eligible: Bool }
    struct Brand: Decodable, Identifiable, Hashable {
        let companyId: String; let name: String; let active: Bool; let commission: Bool; let rate: Double?; let commissionsVisible: Bool
        var id: String { companyId }
    }
    let isAdmin: Bool
    let managers: [Manager]
    let managerId: String?
    let managerName: String?
    let backupId: String?
    let backupName: String?
    /// false — obecny opiekun nie ma uprawnień do ofert / marek sprzedawcy; nil — nieznane.
    let managerOk: Bool?
    let brands: [Brand]
    let warnings: [String]
}

/// Profil sprzedawcy do edycji (`op=settings`).
struct SellerSettingsData: Decodable {
    struct Person: Decodable { let source: String; let id: String; let name: String; let email: String?; let detail: String }
    struct Term: Decodable { let companyId: String; let name: String; let active: Bool; let commission: Bool; let rate: Double; let method: String; let tax: Double }
    let id: String
    let isAdmin: Bool
    let person: Person
    let partnerType: String
    let status: String
    let organizationId: String?
    let organization: NewSellerOrganization?
    let notes: String
    let defaultCompanyId: String
    let portalEnabled: Bool
    let portalLinked: Bool
    let terms: [Term]
    let partnerTypes: [NewSellerSetup.Option]
    let statuses: [NewSellerSetup.Option]
    let paymentMethods: [NewSellerSetup.Option]
    let pricingHref: String
}

/// Otwarcie ustawień — `focus`: sekcja z „Gotowości do pracy” (organization, pricing, access, manager).
struct SellerSettingsRequest: Identifiable {
    let id = UUID()
    let focus: String?
}

@MainActor final class SellerSettingsModel: ObservableObject {
    struct Banner: Equatable { let id = UUID(); let success: Bool; let text: String }
    struct SaveReply: Decodable { let ok: Bool; let level: String; let message: String }

    weak var store: SellersStore?
    var partnerID = ""
    // Opiekun i widoczność wynagrodzenia
    @Published private(set) var management: SellerManagementData?
    @Published var managementError: String?
    @Published var managerDraft = "" { didSet { if oldValue != managerDraft { managerError = nil } } }
    @Published var backupDraft = "" { didSet { if oldValue != backupDraft { managerError = nil } } }
    @Published var reason = ""
    @Published var managerError: String?
    @Published private(set) var managerSaving = false
    // Profil
    @Published private(set) var data: SellerSettingsData?
    @Published var dataError: String?
    @Published var partnerType = ""
    @Published var status = ""
    @Published var organizationID = ""
    @Published var organization: NewSellerOrganization?
    @Published var notes = ""
    @Published var terms: [NewSellerTermDraft] = []
    @Published var defaultCompanyID = ""
    @Published var portalEnabled = false
    @Published private(set) var problems: [NewSellerCheck.Problem]?
    @Published var checkError: String?
    @Published private(set) var saving = false
    @Published private(set) var organizations: [NewSellerOrganization] = []
    @Published private(set) var searching = false
    /// Wynik ostatniej czynności — pasek na dole arkusza (snackbar okna bywa zasłonięty przez arkusz).
    @Published var banner: Banner?
    private var loadedKey = ""

    private var api: NativeAPI? { store?.api }
    private func text(_ error: Error, _ fallback: String) -> String { store?.failureText(error, fallback) ?? fallback }

    // MARK: Wczytanie

    func loadManagement() async {
        guard let api else { managementError = "Brak połączenia z serwerem CRM."; return }
        do {
            let value = try JSONDecoder().decode(SellerManagementData.self, from: try await api.get("/sellers", query: ["op": "management", "id": partnerID]))
            // Jak w CRM: wybór w polach wraca do zapisanego tylko, gdy zmienił się opiekun lub zastępca.
            if management?.managerId != value.managerId || management?.backupId != value.backupId || management == nil {
                managerDraft = value.managerId ?? ""
                backupDraft = value.backupId ?? ""
            }
            management = value
            managementError = nil
        } catch {
            management = nil
            managementError = text(error, "Nie udało się wczytać opiekuna i warunków sprzedawcy.")
        }
    }

    func loadData() async {
        guard let api else { dataError = "Brak połączenia z serwerem CRM."; return }
        do {
            let value = try JSONDecoder().decode(SellerSettingsData.self, from: try await api.get("/sellers", query: ["op": "settings", "id": partnerID]))
            data = value
            partnerType = value.partnerType
            status = value.status
            organizationID = value.organizationId ?? ""
            organization = value.organization
            notes = value.notes
            defaultCompanyID = value.defaultCompanyId
            portalEnabled = value.portalEnabled
            terms = value.terms.map {
                NewSellerTermDraft(companyID: $0.companyId, name: $0.name, active: $0.active, commission: $0.commission, rate: $0.rate, method: $0.method, tax: $0.tax)
            }
            loadedKey = formKey
            problems = nil
            dataError = nil
        } catch {
            data = nil
            dataError = text(error, "Nie udało się wczytać ustawień sprzedawcy.")
        }
    }

    /// Karta sprzedawcy i kokpit po zmianie (odpowiednik `seller-workspace-changed` w CRM).
    func refreshSeller() async {
        guard let store else { return }
        _ = try? await store.card(partnerID)
        await store.load()
    }

    // MARK: Opiekun i zastępca

    /// Lista jak w CRM: obecny opiekun / zastępca spoza listy (np. bez uprawnień) zostaje, uprawnieni najpierw.
    var managerOptions: [SellerManagementData.Manager] {
        guard let management else { return [] }
        var list = management.managers
        if let id = management.managerId, !list.contains(where: { $0.id == id }) {
            list.append(.init(id: id, name: management.managerName ?? "Obecny opiekun", eligible: false))
        }
        if let id = management.backupId, !list.contains(where: { $0.id == id }) {
            list.append(.init(id: id, name: management.backupName ?? "Obecny zastępca", eligible: false))
        }
        let locale = Locale(identifier: "pl_PL")
        return list.sorted { a, b in a.eligible != b.eligible ? a.eligible : a.name.compare(b.name, locale: locale) == .orderedAscending }
    }
    var backupOptions: [SellerManagementData.Manager] {
        managerOptions.filter { $0.id != managerDraft || $0.id == backupDraft }
    }
    func nameOf(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return managerOptions.first(where: { $0.id == id })?.name ?? "Pracownik"
    }
    var managerChanged: Bool { managerDraft != (management?.managerId ?? "") || backupDraft != (management?.backupId ?? "") }

    func managerValidation() -> String? {
        if managerDraft.isEmpty && !backupDraft.isEmpty { return "Zastępca wymaga opiekuna. Wybierz najpierw opiekuna albo usuń zastępcę." }
        if !managerDraft.isEmpty && managerDraft == backupDraft { return "Zastępca musi być inną osobą niż opiekun." }
        if !managerDraft.isEmpty, let chosen = managerOptions.first(where: { $0.id == managerDraft }), !chosen.eligible {
            return "\(chosen.name) nie ma uprawnień do ofert — nie może zostać opiekunem."
        }
        if !backupDraft.isEmpty, let chosen = managerOptions.first(where: { $0.id == backupDraft }), !chosen.eligible {
            return "\(chosen.name) nie ma uprawnień do ofert — nie może zostać zastępcą."
        }
        return nil
    }

    /// „Zapisz opiekuna” (`set_seller_manager`).
    func saveManager(workspace: Workspace) async {
        guard let api, workspace.canWrite else { managerError = "Zapis wymaga połączenia z serwerem CRM."; return }
        let manager = managerDraft
        let backup = backupDraft
        let names = (nameOf(manager), nameOf(backup))
        managerSaving = true
        managerError = nil
        defer { managerSaving = false }
        do {
            _ = try await api.post("/sellers", [
                "op": .string("manager"), "id": .string(partnerID), "managerId": .string(manager), "backupId": .string(backup),
                "reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines)),
            ])
        } catch {
            let message = text(error, "Nie udało się zmienić opiekuna.")
            managerError = message
            workspace.error = message
            return
        }
        reason = ""
        let message = manager.isEmpty ? "Usunięto opiekuna sprzedawcy."
            : "Opiekun: \(names.0 ?? "Pracownik")" + (backup.isEmpty ? "" : ", zastępca: \(names.1 ?? "Pracownik")") + "."
        workspace.succeed(message)
        banner = Banner(success: true, text: message)
        await loadManagement()
        await refreshSeller()
    }

    // MARK: Widoczność wynagrodzenia

    /// Zmiana jednej marki do okna potwierdzenia (`SellerVisibilityView.swift`) — z informacją, czy dotyczy całej zakładki
    /// „Moje wynagrodzenie” (żadna inna aktywna marka nie ma widocznego wynagrodzenia).
    func visibilityChange(_ brand: SellerManagementData.Brand) -> SellerVisibilityChange {
        let others = (management?.brands ?? []).contains { $0.active && $0.commissionsVisible && $0.companyId != brand.companyId }
        return SellerVisibilityChange(brands: [SellerVisibilityBrand(companyId: brand.companyId, name: brand.name)],
                                      visible: !brand.commissionsVisible, wholeTab: !others)
    }

    /// „Pokaż / Ukryj wynagrodzenie” jednej marki (`set_seller_commission_visibility`); zwraca błąd albo nil.
    func setVisibility(_ brand: SellerManagementData.Brand, reason: String, notify: Bool, workspace: Workspace) async -> String? {
        guard let api, workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        let change = visibilityChange(brand)
        let visible = change.visible
        do {
            _ = try await api.post("/sellers", [
                "op": .string("visibility"), "id": .string(partnerID), "companyId": .string(brand.companyId), "visible": .bool(visible),
                "reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines)), "notify": .bool(visible && notify),
            ])
        } catch {
            let message = text(error, "Nie udało się zmienić widoczności wynagrodzenia.")
            workspace.error = message
            return message
        }
        let message = SellerVisibilityText.done(change)
        workspace.succeed(message)
        banner = Banner(success: true, text: message)
        await loadManagement()
        await refreshSeller()
        return nil
    }

    // MARK: Profil

    var activeTerms: [NewSellerTermDraft] { terms.filter(\.active) }

    /// Klucz pól wpływających na braki (bez notatki).
    var checkKey: String {
        ([partnerType, status, organizationID, defaultCompanyID, portalEnabled ? "1" : "0"]
            + terms.map { "\($0.companyID):\($0.active):\($0.commission):\($0.rate):\($0.method):\($0.tax)" }).joined(separator: "|")
    }
    private var formKey: String { checkKey + "|" + notes }
    var dirty: Bool { data != nil && formKey != loadedKey }

    /// Formularz w kształcie oczekiwanym przez serwer (`normalize` w `src/lib/native/sellerCreate.ts`); osobę serwer bierze z profilu.
    private var form: JSONValue {
        .object([
            "personSource": .string(data?.person.source ?? "contact"),
            "personId": .string(data?.person.id ?? ""),
            "partnerType": .string(partnerType),
            "status": .string(status),
            "organizationId": .string(organizationID),
            "defaultCompanyId": .string(defaultCompanyID),
            "portalEnabled": .bool(portalEnabled),
            "notes": .string(notes),
            "terms": .array(terms.map { term -> JSONValue in
                .object([
                    "my_company_id": .string(term.companyID), "is_active": .bool(term.active), "commission_enabled": .bool(term.commission),
                    "default_commission_rate": .number(term.rate), "default_payment_method": .string(term.method), "dividend_tax_rate": .number(term.tax),
                ])
            }),
        ])
    }

    func validate() async {
        guard let api, data != nil else { return }
        do {
            struct Reply: Decodable { let problems: [NewSellerCheck.Problem] }
            let raw = try await api.post("/sellers", ["op": .string("settingsValidate"), "id": .string(partnerID), "form": form])
            guard !Task.isCancelled else { return }
            problems = try JSONDecoder().decode(Reply.self, from: raw).problems
            checkError = nil
        } catch {
            guard !Task.isCancelled else { return }
            checkError = text(error, "Nie udało się sprawdzić danych.")
        }
    }

    func searchOrganizations(_ query: String) async {
        guard let api else { return }
        searching = true
        defer { searching = false }
        do {
            struct Reply: Decodable { let organizations: [NewSellerOrganization] }
            let raw = try await api.get("/sellers", query: ["op": "organizations", "q": query])
            guard !Task.isCancelled else { return }
            organizations = try JSONDecoder().decode(Reply.self, from: raw).organizations
        } catch {
            guard !Task.isCancelled else { return }
            organizations = []
            banner = Banner(success: false, text: text(error, "Nie udało się wyszukać organizacji."))
        }
    }
    func clearOrganizations() { organizations = [] }

    /// „Zapisz ustawienia” — profil, warunki marek i (przy dostępie do portalu) zaproszenie; komunikat jak w CRM.
    func save(workspace: Workspace) async {
        guard let api, workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        let raw: Data
        do {
            raw = try await workspace.withPending(portalEnabled ? "Zapisywanie ustawień i przygotowanie dostępu do portalu…" : "Zapisywanie ustawień sprzedawcy…") {
                try await api.post("/sellers", ["op": .string("settingsSave"), "id": .string(partnerID), "form": form], timeout: 90)
            }
        } catch {
            let message = text(error, "Nie udało się zapisać ustawień sprzedawcy.")
            banner = Banner(success: false, text: message)
            workspace.error = message
            await validate()
            return
        }
        let reply = (try? JSONDecoder().decode(SaveReply.self, from: raw)) ?? SaveReply(ok: true, level: "success", message: "Profil sprzedawcy został zaktualizowany")
        if reply.level == "success" {
            workspace.succeed(reply.message)
            banner = Banner(success: true, text: reply.message)
            await loadData()
        } else {
            // Profil zapisany, ale warunki marek albo zaproszenie nie — formularz zostaje, można poprawić i zapisać ponownie.
            workspace.error = reply.message
            banner = Banner(success: false, text: reply.message)
        }
        await loadManagement()
        await refreshSeller()
    }
}

@MainActor struct SellerSettingsSheet: View {
    @ObservedObject var store: SellersStore
    let seller: SellerCockpitState.Seller
    let focus: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = SellerSettingsModel()
    @State private var organizationQuery = ""
    @State private var closeAsk = false
    @State private var removeManagerAsk = false
    @State private var visibility: SellerManagementData.Brand?
    @State private var scrollTarget: String?
    @State private var pricingShown = false
    /// „Branding i wizytówka — podgląd” — rozwinięcie wczytuje podgląd (jak `<details>` w CRM).
    @State private var brandingOpen = false

    var body: some View {
        VStack(spacing: 0) {
            header.padding(16)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        warnings
                        managerSection.id("manager")
                        if model.management != nil { visibilitySection.id("visibility") }
                        profileSections
                        problemsBox
                        brandingSection.id("branding")
                    }
                    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: scrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation { proxy.scrollTo(target, anchor: .top) }
                    scrollTarget = nil
                }
            }
            Divider()
            footer.padding(12)
        }
        .frame(width: 920, height: 780)
        .task {
            model.store = store
            model.partnerID = seller.id
            let management = Task { await model.loadManagement() }
            await model.loadData()
            await management.value
            if let focus {
                // „Ustaw wygląd” z „Gotowości do pracy” — podgląd brandingu rozwinięty, jak w CRM.
                if focus == "branding" { brandingOpen = true }
                try? await Task.sleep(nanoseconds: 250_000_000)
                scrollTarget = focus
            }
        }
        .task(id: model.checkKey) {
            guard model.data != nil else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await model.validate()
        }
        .task(id: model.banner) {
            guard let shown = model.banner else { return }
            try? await Task.sleep(nanoseconds: 9_000_000_000)
            guard !Task.isCancelled, model.banner == shown else { return }
            model.banner = nil
        }
        .sheet(isPresented: $pricingShown) {
            SellerPricingSheet(store: store, partnerID: seller.id)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $visibility) { brand in
            SellerVisibilityDialog(change: model.visibilityChange(brand)) { reason, notify in
                await model.setVisibility(brand, reason: reason, notify: notify, workspace: state)
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    // MARK: Nagłówek i stopka

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Ustawienia sprzedawcy").font(.title3.weight(.light))
                Text(seller.name).font(.callout).foregroundStyle(.secondary)
                Text("Opiekun, widoczność wynagrodzenia, organizacja nowych ofert, warunki współpracy i dostęp do portalu. Dane osobowe edytujesz w karcie kontaktu.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button("Zamknij") { if model.dirty { closeAsk = true } else { dismiss() } }.keyboardShortcut(.cancelAction)
        }
        .confirmationDialog("Zamknąć bez zapisu?", isPresented: $closeAsk) {
            Button("Odrzuć zmiany", role: .destructive) { dismiss() }
            Button("Wróć", role: .cancel) {}
        } message: {
            Text("Masz niezapisane zmiany w profilu sprzedawcy.")
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let banner = model.banner {
                Label(banner.text, systemImage: banner.success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(banner.success ? Color.green : Color.orange).lineLimit(2)
            } else if let first = model.problems?.first, model.data != nil {
                Button { scrollTarget = first.section } label: {
                    Label("Do uzupełnienia przed zapisem: \(model.problems?.count ?? 0)", systemImage: "exclamationmark.circle").foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            } else if model.dirty {
                Text("Niezapisane zmiany").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if model.data != nil {
                Button("Odrzuć niezapisane zmiany") { Task { await model.loadData() } }
                    .disabled(model.saving || !model.dirty)
                Button { save() } label: {
                    HStack(spacing: 6) {
                        if model.saving { ProgressView().controlSize(.small) }
                        Text("Zapisz ustawienia")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command)
                .disabled(model.saving || !state.canWrite)
            }
        }
    }

    private func save() {
        // Jak w CRM: przy brakach — pierwszy brak i przejście do sekcji; ostateczne sprawdzenie robi serwer.
        if let first = model.problems?.first {
            model.banner = SellerSettingsModel.Banner(success: false, text: first.text)
            scrollTarget = first.section
            return
        }
        Task { await model.save(workspace: state) }
    }

    // MARK: Ostrzeżenia, opiekun i widoczność wynagrodzenia

    @ViewBuilder private var warnings: some View {
        if let list = model.management?.warnings, !list.isEmpty {
            Label(list.joined(separator: " · "), systemImage: "exclamationmark.triangle")
                .font(.callout).foregroundStyle(.orange)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var managerSection: some View {
        card("Opiekun i zastępca", symbol: "person.2") {
            if let management = model.management {
                if management.isAdmin { managerEditor(management) } else { managerSummary(management) }
            } else if let error = model.managementError {
                failure(error) { Task { await model.loadManagement() } }
            } else {
                ProgressView("Wczytywanie opiekuna i widoczności wynagrodzenia…").frame(maxWidth: .infinity)
            }
        }
        .confirmationDialog("Usunąć opiekuna?", isPresented: $removeManagerAsk) {
            Button("Usuń opiekuna", role: .destructive) { Task { await model.saveManager(workspace: state) } }
            Button("Wróć", role: .cancel) {}
        } message: {
            Text("Rozmowy, oferty do sprawdzenia i zapytania sprzedawcy trafią wtedy wyłącznie do administratorów.")
        }
    }

    private func managerSummary(_ management: SellerManagementData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                personTile("Opiekun", model.nameOf(management.managerId) ?? "Brak opiekuna", warn: management.managerId != nil && management.managerOk == false)
                personTile("Zastępca", model.nameOf(management.backupId) ?? "Brak zastępcy", warn: false)
            }
            Text("Opiekuna i zastępcę przydziela administrator. Opiekun prowadzi rozmowy, decyzje o ofertach i realizacje sprzedawcy; zastępca przejmuje je podczas nieobecności.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func personTile(_ label: String, _ name: String, warn: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "person.crop.circle").font(.title3).foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(label.uppercased()).font(.caption2).foregroundStyle(.secondary)
                Text(name).lineLimit(1)
            }
            if warn {
                Label("Opiekun bez uprawnień", systemImage: "exclamationmark.shield").font(.caption2)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Color.orange.opacity(0.13), in: Capsule()).foregroundStyle(.orange)
                    .help("Opiekun nie ma uprawnienia do ofert albo dostępu do wszystkich aktywnych marek sprzedawcy")
            }
            Spacer(minLength: 0)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func managerEditor(_ management: SellerManagementData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if management.managerId != nil && management.managerOk == false {
                Label("Obecny opiekun nie ma uprawnienia do ofert albo dostępu do wszystkich aktywnych marek sprzedawcy. Wybierz uprawnioną osobę lub nadaj jej dostęp.", systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 16) {
                Picker("Opiekun", selection: $model.managerDraft) {
                    Text("Brak opiekuna").tag("")
                    ForEach(model.managerOptions) { option in Text(verbatim: option.eligible ? option.name : "\(option.name) — bez uprawnień").tag(option.id) }
                }
                .frame(maxWidth: 400)
                Picker("Zastępca (opcjonalnie)", selection: $model.backupDraft) {
                    Text("Brak zastępcy").tag("")
                    ForEach(model.backupOptions) { option in Text(verbatim: option.eligible ? option.name : "\(option.name) — bez uprawnień").tag(option.id) }
                }
                .frame(maxWidth: 400).disabled(model.managerDraft.isEmpty)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Powód zmiany (opcjonalnie, trafi do historii)").font(.caption).foregroundStyle(.secondary)
                TextField("np. Przejęcie hoteli regionu warmińskiego", text: $model.reason).textFieldStyle(.roundedBorder)
                    .onChange(of: model.reason) { _, value in if value.count > 300 { model.reason = String(value.prefix(300)) } }
            }
            Text("Opiekun musi być aktywnym pracownikiem z uprawnieniem do ofert i dostępem do każdej aktywnej marki sprzedawcy. Zmiana ustawia też opiekuna kontaktu w CRM.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error = model.managerError { Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button { saveManager() } label: {
                    HStack(spacing: 6) {
                        if model.managerSaving { ProgressView().controlSize(.small) } else { Image(systemName: "checkmark") }
                        Text("Zapisz opiekuna")
                    }
                }
                .disabled(model.managerSaving || !model.managerChanged || !state.canWrite)
            }
        }
        .disabled(model.managerSaving)
    }

    private func saveManager() {
        guard !model.managerSaving else { return }
        if let problem = model.managerValidation() { model.managerError = problem; return }
        if model.managerDraft.isEmpty && model.management?.managerId != nil { removeManagerAsk = true; return }
        Task { await model.saveManager(workspace: state) }
    }

    private var visibilitySection: some View {
        card("Wynagrodzenie w portalu", symbol: "eye") {
            Text("Decydujesz, kiedy sprzedawca zobaczy swoje prowizje dla danej marki. Prowizje naliczają się niezależnie od widoczności, a narzut jest zawsze widoczny. Gdy wynagrodzenie wszystkich marek jest ukryte, portal nie pokazuje zakładki „Moje wynagrodzenie” ani prognozy wynagrodzenia. Przełącznik całej zakładki (wszystkie marki naraz) jest też na karcie sprzedawcy.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            let brands = (model.management?.brands ?? []).filter(\.active)
            if brands.isEmpty {
                Text("Sprzedawca nie ma aktywnych marek. Włącz markę w sekcji „Cennik i zasady prowizji” poniżej.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            } else {
                ForEach(brands) { brand in visibilityRow(brand) }
            }
        }
    }

    private func visibilityRow(_ brand: SellerManagementData.Brand) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(brand.name).font(.callout)
                Text(verbatim: brand.commission ? "Prowizja \(SellerSettingsFormat.rate(brand.rate))" : "Rozliczenie narzutem — bez prowizji")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if brand.commission {
                Toggle("Pokaż wynagrodzenie w portalu", isOn: Binding(get: { brand.commissionsVisible }, set: { _ in visibility = brand }))
                    .toggleStyle(.switch).controlSize(.small)
                    .disabled(!state.canWrite)
                    .help(brand.commissionsVisible ? "Wynagrodzenie widoczne w portalu — kliknij, aby ukryć" : "Wynagrodzenie ukryte w portalu — kliknij, aby pokazać")
            } else {
                Text("Nie dotyczy").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Profil sprzedawcy

    @ViewBuilder private var profileSections: some View {
        if let data = model.data {
            Group {
                organizationSection(data).id("organization")
                pricingSection(data).id("pricing")
                accessSection(data).id("access")
            }
            .disabled(model.saving)
        } else if let error = model.dataError {
            card("Profil sprzedawcy", symbol: "person.text.rectangle") { failure(error) { Task { await model.loadData() } } }
        } else {
            card("Profil sprzedawcy", symbol: "person.text.rectangle") { ProgressView("Wczytywanie ustawień sprzedawcy…").frame(maxWidth: .infinity) }
        }
    }

    private func organizationSection(_ data: SellerSettingsData) -> some View {
        card("Organizacja i współpraca", symbol: "building.2") {
            Text("To tutaj wybierasz jedną organizację dla nowych ofert. Powiązania firm w nagłówku kontaktu i dotychczasowe oferty pozostają bez zmian.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Osoba").font(.caption).foregroundStyle(.secondary)
                    Text(data.person.name).textSelection(.enabled)
                    Text(verbatim: (data.person.source == "employee" ? "Pracownicy Mavinci" : data.isAdmin ? "Kontakty CRM" : "Moje kontakty zewnętrzne") + " · " + data.person.detail)
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Picker("Rodzaj współpracy", selection: $model.partnerType) {
                    ForEach(data.partnerTypes) { option in Text(option.label).tag(option.value) }
                }
                .frame(maxWidth: 300)
                Picker("Status", selection: $model.status) {
                    ForEach(data.statuses) { option in Text(option.label).tag(option.value) }
                }
                .frame(maxWidth: 220)
            }
            organizationPicker
            VStack(alignment: .leading, spacing: 4) {
                Text("Notatka").font(.caption).foregroundStyle(.secondary)
                TextField("Ustalenia dotyczące współpracy...", text: $model.notes, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
            }
        }
    }

    private var organizationPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text("Hotel / organizacja — dla nowych ofert").font(.caption).foregroundStyle(.secondary)
                if model.partnerType != "hotel_employee" && !model.portalEnabled { Text("(opcjonalnie)").font(.caption).foregroundStyle(.tertiary) }
            }
            if !model.organizationID.isEmpty {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.organization?.name ?? "Wybrana organizacja (brak dostępu do szczegółów)").font(.callout.weight(.medium))
                        if let org = model.organization {
                            Text(SellerSettingsFormat.location(org)).font(.caption)
                                .foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
                        }
                    }
                    Spacer()
                    if let org = model.organization {
                        Button("Organizacja w CRM") { state.openCRM("/crm/contacts/\(org.id)") }
                        if let location = org.locationId { Button("Lokalizacja w CRM") { state.openCRM("/crm/locations/\(location)") } }
                    }
                    Button("Wyczyść") { model.organizationID = ""; model.organization = nil }
                }
                .controlSize(.small)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                TextField("Wyszukaj hotel lub organizację...", text: $organizationQuery).textFieldStyle(.roundedBorder)
                if model.searching { ProgressView().controlSize(.small) }
            }
            .task(id: organizationQuery) {
                let query = organizationQuery.trimmingCharacters(in: .whitespaces)
                guard !query.isEmpty else { model.clearOrganizations(); return }
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.searchOrganizations(query)
            }
            if !organizationQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(model.organizations) { org in
                            Button {
                                model.organizationID = org.id
                                model.organization = org
                                organizationQuery = ""
                            } label: {
                                HStack {
                                    Image(systemName: model.organizationID == org.id ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(model.organizationID == org.id ? theme.accent : Color.secondary)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(org.name)
                                        Text(SellerSettingsFormat.location(org)).font(.caption)
                                            .foregroundStyle(org.locationId == nil || org.rooms.isEmpty ? Color.orange : Color.secondary)
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
                            Text("Brak pasującej organizacji").font(.callout).foregroundStyle(.secondary).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(maxHeight: 220)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            }
            Text("Wybierz jedną organizację, w imieniu której sprzedawca przygotowuje oferty. Pozostałe powiązania kontaktu i dotychczasowe oferty nie zostaną zmienione.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func pricingSection(_ data: SellerSettingsData) -> some View {
        card("Cennik i zasady prowizji", symbol: "percent") {
            Button { pricingShown = true } label: { Label("Indywidualne ceny produktów i rozszerzeń", systemImage: "tag") }
                .help("Ceny produktów, wariantów, konfiguracji i rozszerzeń dla tego sprzedawcy")
            Text(verbatim: "Każda marka może mieć inną stawkę i sposób rozliczenia. Prowizja to % od zysku netto wydarzenia — po kosztach i po koszcie samej prowizji (wypłata gotówką z zysku razem z podatkiem). Inną stawkę dla jednego wydarzenia ustawisz w jego podsumowaniu.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Picker("Domyślny cennik nowych ofert w portalu", selection: defaultCompany) {
                    Text("Wybierz aktywną markę").tag("")
                    ForEach(model.activeTerms) { term in Text(term.name).tag(term.companyID) }
                }
                .frame(maxWidth: 560)
                Text("Sprzedawca nie wybiera marki realizującej. Przy jednej aktywnej marce cennik zostanie wybrany automatycznie. Logo i kolory pochodzą z organizacji przypisanej powyżej; starsze oferty zachowują swoje powiązania.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ForEach($model.terms) { $term in termRow($term, methods: data.paymentMethods) }
        }
    }

    /// Jak w CRM: przy jednej aktywnej marce — ta marka; przy kilku — wybrana (spoza aktywnych — pusto).
    private var defaultCompany: Binding<String> {
        Binding(get: {
            let active = model.activeTerms
            if active.count == 1 { return active[0].companyID }
            return active.contains(where: { $0.companyID == model.defaultCompanyID }) ? model.defaultCompanyID : ""
        }, set: { model.defaultCompanyID = $0 })
    }

    private func termRow(_ term: Binding<NewSellerTermDraft>, methods: [NewSellerSetup.Option]) -> some View {
        let value = term.wrappedValue
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Toggle(isOn: term.active) { Text(value.name).font(.callout.weight(.medium)) }.toggleStyle(.checkbox)
                Toggle("Rozliczenie prowizyjne", isOn: term.commission).toggleStyle(.checkbox).font(.caption).disabled(!value.active)
            }
            .frame(minWidth: 200, maxWidth: .infinity, alignment: .leading)
            field("Prowizja (% od zysku)") {
                TextField("", value: term.rate, format: .number).textFieldStyle(.roundedBorder).frame(width: 110)
            }
            .disabled(!value.active || !value.commission)
            field("Sposób wypłaty") {
                Picker("", selection: term.method) {
                    ForEach(methods) { option in Text(option.label).tag(option.value) }
                }
                .labelsHidden().frame(width: 230)
            }
            .disabled(!value.active || !value.commission)
            field("Podatek (%)") {
                TextField("", value: term.tax, format: .number).textFieldStyle(.roundedBorder).frame(width: 90)
            }
            .disabled(!value.active || !value.commission || value.method != "cash_dividend")
        }
        .padding(10)
        .background(value.active ? theme.accent.opacity(0.06) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: title).font(.caption2).foregroundStyle(.secondary)
            content()
        }
    }

    private func accessSection(_ data: SellerSettingsData) -> some View {
        let contact = data.person.source == "contact"
        return card("Dostęp do portalu", symbol: "key") {
            VStack(alignment: .leading, spacing: 6) {
                Toggle(isOn: $model.portalEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Nadaj dostęp do portalu sprzedawcy")
                        Text("Przy pierwszym nadaniu dostępu zapis utworzy lub połączy konto i wyśle zaproszenie na e-mail kontaktu. Zmiana ustawień istniejącego konta nie wysyła ponownie danych logowania. Portal pokazuje tylko dane tego sprzedawcy.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .toggleStyle(.checkbox).disabled(!contact)
                if model.portalEnabled && contact {
                    Text("Kontakt będzie mógł się zalogować, wylogować, samodzielnie zmienić hasło oraz odzyskać je z ekranu logowania.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(contact ? Color.blue.opacity(0.06) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .opacity(contact ? 1 : 0.5)
            if data.portalLinked {
                Label("Konto logowania jest połączone z kontaktem.", systemImage: "checkmark.seal").font(.caption).foregroundStyle(.green)
                if !model.portalEnabled {
                    Text("Zapis bez dostępu do portalu odłączy konto logowania od sprzedawcy.").font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    /// „Do uzupełnienia przed zapisem” — wszystkie braki naraz, kliknięcie przenosi do sekcji.
    @ViewBuilder private var problemsBox: some View {
        if model.data != nil {
            if let error = model.checkError {
                Text(error).font(.caption).foregroundStyle(.secondary)
            } else if let problems = model.problems, !problems.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Do uzupełnienia przed zapisem (\(problems.count))", systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.orange)
                    ForEach(problems, id: \.self) { problem in
                        Button { scrollTarget = problem.section } label: {
                            Text(verbatim: "• " + problem.text).font(.caption).foregroundStyle(.orange)
                                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var brandingSection: some View {
        DisclosureGroup(isExpanded: $brandingOpen) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Sprzedawca zmienia logo, kolory i wygląd ofert w swoim portalu.").font(.caption).foregroundStyle(.secondary)
                if brandingOpen {
                    OfferBrandingPanel(partnerID: seller.id, organizationID: nil, openOrganization: { id, _ in openOrganization(id) }).id(seller.id)
                }
            }
            .padding(.top, 8)
        } label: {
            Text("Branding i wizytówka — podgląd").font(.headline).foregroundStyle(theme.accent)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    /// Karta organizacji z podglądu brandingu — po zamknięciu ustawień (niezapisanych zmian nie odrzucamy po cichu).
    private func openOrganization(_ id: String) {
        if model.dirty {
            model.banner = SellerSettingsModel.Banner(success: false, text: "Najpierw zapisz lub odrzuć zmiany profilu sprzedawcy, a potem otwórz kartę organizacji.")
            return
        }
        dismiss()
        state.showContact(id)
    }

    // MARK: Pomocnicze

    private func card<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol).font(.headline)
            content()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func failure(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            Button("Spróbuj ponownie", action: retry)
        }
    }
}

/// Formatowanie jak w CRM: stawka `toLocaleString('pl-PL', { maximumFractionDigits: 2 })` + „%”, lokalizacja z salami.
enum SellerSettingsFormat {
    static func rate(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "pl_PL"))) + "%"
    }
    static func location(_ org: NewSellerOrganization) -> String {
        guard org.locationId != nil else { return "Bez lokalizacji — powiąż organizację z lokalizacją w CRM" }
        let rooms = org.rooms.count
        let label = rooms == 1 ? "1 sala" : rooms >= 2 && rooms <= 4 ? "\(rooms) sale" : "\(rooms) sal"
        return "Lokalizacja: \(org.locationName ?? "—") · \(rooms == 0 ? "brak sal" : label)"
    }
}
