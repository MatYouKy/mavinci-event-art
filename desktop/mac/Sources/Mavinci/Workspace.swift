import Foundation
import SwiftUI
import AppKit
import Network

@MainActor final class Workspace: ObservableObject {
    @Published var connection = Connection.load()
    @Published var snapshot: Snapshot?
    @Published var refreshEventToken = UUID()
    @Published var loading = false
    @Published var syncing = false
    @Published var acting = false { didSet { if acting && !oldValue { busyWindow = activeNavigation.id } } }
    @Published var editing = false
    @Published var offline = false
    /// Błąd — pokazywany jako czerwony snackbar.
    @Published var error: String? { didSet { if let error { snack = Snack(kind: .error, text: error) } } }
    @Published var moduleErrors: [String: String] = [:]
    @Published var compatibilityMode = false
    /// Informacja — pokazywana jako snackbar; potwierdzenia udanych czynności przez `succeed(_:)`.
    @Published var notice: String? { didSet { if let notice { snack = Snack(kind: .info, text: notice) } } }
    @Published var snack: Snack? { didSet { if snack != nil { snackWindow = activeNavigation.id } } }
    /// Trwająca czynność (modalny wskaźnik postępu z opisem).
    @Published var pending: String? { didSet { if pending != nil && oldValue == nil { busyWindow = activeNavigation.id } } }
    let native = NativeStore()
    /// Wiadomości (`/crm/messages`) — stan zachowany przy przełączaniu sekcji.
    let messages = MessagesStore()
    /// Spotkania (`/crm/meetings`) — kopia na dysku i oś czasu.
    let meetings = MeetingsStore()
    /// Lejek zapytań (`/crm/inquiries`) — kopia na dysku, kolumny etapów i obsługa zapytań.
    let inquiries = InquiriesStore()
    /// Zadania: „Zadania firmowe” (`/crm/tasks`) i „Moje zadania” (`/crm/tasks/mine`) — kopie na dysku i tablice.
    let companyTasks = TasksStore(board: .company)
    /// Kontakty (`/crm/contacts`) — kopia na dysku, kafelki i lista, edycja kontaktów i organizacji.
    let contacts = ContactsStore()
    /// Zespół (`/crm/employees`) — kopia listy na dysku, karta pracownika z zakładkami.
    let team = TeamStore()
    /// Magazyn (`/crm/equipment`) — kopia katalogu na dysku, karta sprzętu z jednostkami.
    let warehouse = WarehouseStore()
    /// Umowy z klientami i szablony umów (`/crm/contracts`, `/crm/contract-templates`).
    let contracts = ContractsStore()
    /// Katalog produktów oferty i karta produktu (`/crm/offers?tab=catalog`, `/crm/offers/products/[id]`).
    let products = ProductsStore()
    /// Oferty (`/crm/offers`, `/crm/offers/[id]`) — kopia listy na dysku, strona oferty.
    let offers = OffersStore()
    /// Wydarzenia (`/crm/events`) — kopia listy na dysku, synchronizacja przyrostowa.
    let events = EventsStore()
    /// Karty wydarzeń (`/crm/events/[id]`) — ostatnio otwierane i najbliższe na dysku, odświeżane po zmianie skrótu.
    let eventCards = EventCardStore()
    let myTasks = TasksStore(board: .mine)
    /// Sprzedawcy zewnętrzni (`/crm/salespeople`) — kokpit opiekuna, karty sprzedawców, instrukcja opiekuna.
    let sellers = SellersStore()
    /// Komunikator (`Chat/`) — rozmowy pracowników na żywo, jak widżet czatu w CRM i w telefonie.
    let chat = ChatStore()
    /// Kopia wydarzeń i spotkań w Kalendarzu Apple (`AppleCalendarSync.swift`) — aktualizowana po odświeżeniu, jeśli włączono.
    let appleCalendar = AppleCalendarLink()
    let fleet = FleetStore()
    /// Czas pracy (`/crm/time-tracking`) — licznik, wpisy, raport zespołu, rozliczenia.
    let timeTracking = TimeTrackingStore()
    /// Bazy danych (`/crm/databases`) — własne arkusze i udostępnianie.
    let databases = CustomDatabasesStore()
    /// Lokalizacje (`/crm/locations`) — obiekty, sale i informacje techniczne.
    let locations = LocationsStore()
    /// Strona (`/crm/page?tab=website`) — struktura, marketing i ADS, analiza ruchu, Schema.org.
    let website = WebsiteStore()
    /// Kampanie e-mail (`/crm/campaigns`) — Centrum Kampanii: wersje robocze, odbiorcy, test, zatwierdzenie, kolejka wysyłki.
    let mailCampaigns = MailCampaignsStore()
    /// Social media (`/crm/marketing/social`) — kalendarz publikacji, kreator grafik, biblioteka zdjęć; kopia na dysku.
    let social = SocialStore()
    /// Realizacje (`/crm/marketing/portfolio`) — portfolio strony: kopie robocze, zdjęcia, SEO i publikacja; kopia na dysku.
    let portfolio = PortfolioStore()
    /// Prezentacje (`/crm/presentations`, Strefa sprzedawcy) — działy i karty na spotkania z klientami; kopia na dysku.
    let showcase = ShowcaseStore()
    /// Materiały (dział Dysku) — baza plików firmy: foldery marek, wysyłka z Findera, kosz; kopia drzewa i miniatur na dysku.
    let materials = MaterialsStore()
    /// Dysk (`/crm/materials`) — Eventy, Materiały, Oferty, Kalkulacje, Umowy i Magazyn jak w Finderze; kopia folderów na dysku.
    let drive = DriveStore()
    /// Finanse (`/crm/invoices`) — Centrum finansów, terminy i monity, zamknięcia miesięcy; kopia na dysku.
    let finance = FinanceStore()
    /// Aktualizacje aplikacji (`Updates/AppUpdater.swift`) — wersje publikowane przez `yarn dmg` na serwerze CRM.
    let updater = AppUpdater()
    /// Motyw okna (`employees.crm_theme`); do pierwszego odczytu profilu — ostatni motyw zapisany na tym Macu.
    @Published var theme = CrmTheme.saved
    /// Menu jak w CRM (z serwera; ostatnie zapisane na tym Macu do pierwszego odczytu).
    @Published var navigation: [NavItem] = []
    /// Pozycja paska bocznego przeciągana do kart (`NavigationDrag.swift`) — okna pokazują pola „Nowa karta” / „Nowe okno”.
    @Published var navDrag: String?
    // MARK: Okna (`WindowNavigation.swift`) — każde okno ma własną nawigację; dane, sesja i synchronizacja są wspólne
    /// Okno, w którym pracuje użytkownik (ostatnio aktywne okno obszaru roboczego) — do niego trafiają czynności nawigacji.
    /// Przed pojawieniem się pierwszego okna i po zamknięciu ostatniego — nawigacja czekająca na następne okno.
    var activeNavigation = WindowNavigation()
    /// Otwarte okna obszaru roboczego i okna przygotowane przez „Nowe okno”, „Nowa karta”, „Otwórz w nowym oknie”.
    var windowNavigations: [WindowNavigation] = []
    var pendingNavigations: [WindowNavigation] = []
    /// Okno, w którym zaczęła się trwająca czynność, i okno ostatniego komunikatu.
    var busyWindow: UUID?
    var snackWindow: UUID?
    /// Początek ostatniego odświeżenia (`refreshIfIdle` — jedno odświeżanie w tle niezależnie od liczby okien).
    var lastRefreshStarted: Date?
    // Nawigacja aktywnego okna — czynności (`switchSection`, `showEvent`, `openHref`…); widoki okna czytają własną `WindowNavigation`.
    var selection: Module? { get { activeNavigation.selection } set { activeNavigation.selection = newValue } }
    var eventRoute: EventRoute? { get { activeNavigation.eventRoute } set { activeNavigation.eventRoute = newValue } }
    /// Oferta, rozmowa i krok przygotowań wskazane w powiadomieniu (zakładka „Ustalenia”) — odczytywane przez kartę wydarzenia.
    var sellerFocus: SellerArrangementsFocus? { get { activeNavigation.sellerFocus } set { activeNavigation.sellerFocus = newValue } }
    var focusedID: String? { get { activeNavigation.focusedID } set { activeNavigation.focusedID = newValue } }
    var focusToken: UUID { get { activeNavigation.focusToken } set { activeNavigation.focusToken = newValue } }
    var notificationsVisible: Bool { get { activeNavigation.notificationsVisible } set { activeNavigation.notificationsVisible = newValue } }
    /// Sekcje CRM opisywane przez serwer (`/bridge/native/v1`): wybrany zbiór i rekord do pokazania po przejściu.
    var nativeSet: String? { get { activeNavigation.nativeSet } set { activeNavigation.nativeSet = newValue } }
    var nativeFocus: String? { get { activeNavigation.nativeFocus } set { activeNavigation.nativeFocus = newValue } }
    /// Ekran natywny spoza `Module` (np. Wiadomości) wybrany z paska bocznego CRM.
    var screen: CrmScreen? { get { activeNavigation.screen } set { activeNavigation.screen = newValue } }
    var sidebarHref: String? { get { activeNavigation.sidebarHref } set { activeNavigation.sidebarHref = newValue } }
    var sidebarVisibility: NavigationSplitViewVisibility { get { activeNavigation.sidebarVisibility } set { activeNavigation.sidebarVisibility = newValue } }
    /// Strona CRM bez ekranu natywnego (tymczasowo otwierana w przeglądarce).
    var webItem: NavItem? { get { activeNavigation.webItem } set { activeNavigation.webItem = newValue } }
    /// Dashboard jak strona `/crm` (z serwera, te same reguły widoczności); odświeżany co 5 minut i na ⌘R.
    @Published var dashboard: DashboardData?
    @Published var dashboardError: String?
    @Published var dashboardLoading = false
    private var dashboardLoadedAt: Date?
    private var backend: HTTPBackend?
    private var cache: LocalCache?
    /// Zapis i usuwanie kopii zbiorów w tle (`LocalCacheWriter`) oraz zaplanowany zapis (kilka zmian w krótkim czasie — jeden zapis).
    private let cacheWriter = LocalCacheWriter()
    private var persistTask: Task<Void, Never>?
    /// Przestrzeń kopii lokalnej zalogowanego pracownika (dashboard, plan dnia — obok kopii zbiorów i Wiadomości).
    private var cacheNamespace: String?
    /// Plan dnia (`get_employee_schedule`) — z dysku od razu, odświeżany w tle.
    @Published var scheduleRows: [Row]?
    @Published var scheduleFailed = false
    private var scheduleLoading = false
    private var generation = UUID()
    private let monitor = NWPathMonitor()
    private var pathAvailable = true
    /// Połączenie potwierdzone profilem pracownika (publikowane — od niego zależy `canWrite`, czyli dostępność przycisków zapisu).
    @Published private var verifiedConnection = false
    /// Ponowne potwierdzenie połączenia w toku (`reverifyConnection`).
    private var reverifying = false
    /// Odświeżenie zamówione w trakcie trwającego (np. po zapisie) — wykonywane zaraz po nim, żeby dane pokazały zapisane zmiany.
    private var refreshQueued = false
    var employee: Employee? { snapshot?.employee }
    var modules: [Module] { Module.allCases.filter { employee?.canView($0) == true } }
    /// Zapis możliwy: zalogowany pracownik i potwierdzone połączenie z serwerem CRM. Odświeżanie danych w tle (`syncing`, co minutę
    /// i po powrocie do aplikacji) ani inna trwająca czynność nie blokują zapisów — serwer sprawdza sesję i uprawnienia przy każdym
    /// zapisie, a sekcje pobierają zmiany po zapisie (odświeżenie zamówione w trakcie trwającego wykonuje się zaraz po nim).
    var canWrite: Bool { employee != nil && verifiedConnection && !offline }
    #if DEBUG
    var canConfigure: Bool { employee?.isAdmin == true || (!connection.valid && employee == nil) }
    #else
    /// Zainstalowana aplikacja: połączenie wbudowane w program (`EmbeddedConnection.swift`) — bez zmiany z poziomu aplikacji.
    var canConfigure: Bool { false }
    #endif
    var unread: Int { rows(.notifications).filter { $0.fields["is_read"]?.flag != true }.count }
    init() {
        messages.workspace = self
        meetings.workspace = self
        inquiries.workspace = self
        companyTasks.workspace = self
        contacts.workspace = self
        team.workspace = self
        warehouse.workspace = self
        contracts.workspace = self
        products.workspace = self
        offers.workspace = self
        events.workspace = self
        eventCards.workspace = self
        myTasks.workspace = self
        sellers.workspace = self
        chat.workspace = self
        fleet.workspace = self
        timeTracking.workspace = self
        databases.workspace = self
        locations.workspace = self
        website.workspace = self
        mailCampaigns.workspace = self
        social.workspace = self
        portfolio.workspace = self
        showcase.workspace = self
        materials.workspace = self
        drive.workspace = self
        finance.workspace = self
        updater.workspace = self
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                self.pathAvailable = path.status == .satisfied
                if path.status != .satisfied { self.offline = true; self.verifiedConnection = false }
                // Sieć wróciła — połączenie potwierdzamy od razu (zapisy działają bez czekania na odświeżenie co minutę).
                else if self.offline || !self.verifiedConnection { await self.reverifyConnection() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "pl.mavinci.network"))
    }
    func rows(_ module: Module) -> [Row] {
        if module == .events {return snapshot?.collections[Module.calendar.rawValue]?.rows.filter{$0["kind"]=="event"} ?? []}
        return snapshot?.collections[module.rawValue]?.rows ?? []
    }
    func restore() async {
        guard !loading, snapshot == nil, connection.valid else { return }
        loading = true
        defer { loading = false }
        let ticket = generation
        do {
            guard let data = try Vault.read("session-\(connection.identity)") else { return }
            let session = try JSONDecoder().decode(Session.self, from: data)
            let api = HTTPBackend(connection); backend = api
            await api.restore(session)
            FinderDomain.activate(connection: connection, session: data, fresh: false)
            cache = LocalCache(namespace: digest("\(connection.identity)|\(session.user.id)"))
            native.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            messages.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            meetings.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            inquiries.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            companyTasks.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            contacts.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            team.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            warehouse.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            contracts.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            products.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            offers.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            social.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            portfolio.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            showcase.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            materials.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            drive.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            events.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            eventCards.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            myTasks.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            finance.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            openLocalViews(namespace: digest("\(connection.identity)|\(session.user.id)"))
            Task { await BrandStore.refresh(nativeAPI()) }
            // Kopia z dysku od razu (bez czekania na sieć); zapis dopiero po potwierdzeniu profilu na serwerze.
            // Bez połączenia kopia starsza niż 24 h jest ukrywana (`refresh` — ochrona przed odebranymi uprawnieniami).
            // Odczyt i odszyfrowanie kopii (dziesiątki MB) w tle — okno odpowiada od razu po starcie.
            let stored = cache
            let saved = try await Task.detached(priority: .userInitiated) { try stored?.load() }.value
            guard ticket == generation else { return }
            if let saved, Date().timeIntervalSince(saved.savedAt) <= 30 * 86_400 { snapshot = saved; restoreNavigation() }
            await refresh(force: true)
        } catch {
            self.error = friendlyError(error)
        }
    }
    func login(email: String, password: String) async {
        guard !loading else { return }
        loading = true; error = nil
        let ticket = generation
        defer { loading = false }
        let api = HTTPBackend(connection)
        do {
            let session = try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            let employee = try await api.profile()
            guard employee.is_active else { throw AppError.noEmployee }
            guard ticket == generation else { return }
            backend = api
            if let data = try? JSONEncoder().encode(session) { FinderDomain.activate(connection: connection, session: data, fresh: true) }
            cache = LocalCache(namespace: digest("\(connection.identity)|\(session.user.id)"))
            native.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            messages.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            meetings.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            inquiries.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            companyTasks.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            contacts.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            team.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            warehouse.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            contracts.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            products.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            offers.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            social.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            portfolio.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            showcase.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            materials.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            drive.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            events.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            eventCards.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            myTasks.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            finance.open(namespace: digest("\(connection.identity)|\(session.user.id)"))
            openLocalViews(namespace: digest("\(connection.identity)|\(session.user.id)"))
            Task { await BrandStore.refresh(nativeAPI()) }
            let stored = cache
            let saved = await Task.detached(priority: .userInitiated) { try? stored?.load() }.value
            guard ticket == generation else { return }
            snapshot = Snapshot(employee: employee)
            if let saved, saved.employee == employee { snapshot = saved }
            restoreNavigation()
            verifiedConnection = true; offline = false; snack = nil
            await refresh(force: true)
        } catch {
            await api.logout()
            try? Vault.delete("session-\(connection.identity)")
            if FinderShared.bundledWithExtension { FinderShared.signOut() }
            self.error = friendlyError(error)
        }
    }
    func refresh(force: Bool = false) async {
        guard let backend else { return }
        // Wymuszone odświeżenie (np. po zapisie) w trakcie trwającego — zaraz po nim, inaczej lista pokazałaby dane sprzed zapisu.
        if syncing { if force { refreshQueued = true }; return }
        guard !acting, !editing || force else { return }
        let ticket = generation
        syncing = true
        lastRefreshStarted = Date()
        defer {
            if ticket == generation {
                syncing = false
                if refreshQueued {
                    refreshQueued = false
                    Task { await self.refresh(force: true) }
                }
            }
        }
        do {
            let current = try await backend.profile()
            guard ticket == generation else { return }
            guard current.is_active else { throw AppError.noEmployee }
            if let raw = await backend.crmTheme, let next = CrmTheme(rawValue: raw), next != theme { theme = next; next.remember() }
            if snapshot?.employee != current {
                // Dane poprzedniego profilu znikają od razu; kopia na dysku — po zakończeniu trwającego zapisu (w tle).
                snapshot = Snapshot(employee: current)
                for nav in allNavigations {
                    nav.eventRoute = nil
                    nav.focusedID = nil
                    if let selection = nav.selection, !current.canView(selection) { nav.selection = .day }
                }
                try await clearCache()
                guard ticket == generation else { return }
            }
            if snapshot == nil { snapshot = Snapshot(employee: current) }
            verifiedConnection = true; offline = false; error = nil
            compatibilityMode = false
            // Kolejność jak na ekranie: dashboard i menu, plan dnia, potem zbiory (tylko zmiany), na końcu Wiadomości.
            if nativeAPI() != nil {
                await loadDashboard(force: force)
                await loadNavigation()
            }
            guard ticket == generation else { return }
            await loadSchedule()
            for module in modules where module != .day && module != .events {
                guard ticket == generation else { return }
                do {
                    let previous = snapshot?.collections[module.rawValue] ?? CollectionState()
                    var next = previous
                    do {
                        let reply = try await backend.sync(module, hashes: previous.hashes)
                        try next.apply(reply)
                    } catch AppError.missingSync {
                        let rows = try await backend.fullRead(module, employee: current)
                        next = CollectionState(hashes: [:], buckets: ["full": rows], lastSync: Date())
                        compatibilityMode = true
                    }
                    guard ticket == generation else { return }
                    // A full snapshot fallback must not survive switching to bucket sync.
                    next.buckets.removeValue(forKey: next.hashes.isEmpty ? "unused" : "full")
                    snapshot?.collections[module.rawValue] = next
                    moduleErrors.removeValue(forKey: module.rawValue)
                } catch AppError.unauthorized { throw AppError.unauthorized }
                catch {
                    guard ticket == generation else { return }
                    // Fail closed for server/schema/access failures; retain last good data only on transport failure.
                    if !(error is URLError) { snapshot?.collections.removeValue(forKey: module.rawValue) }
                    // Brak sieci wyłącza zapisy; przekroczony czas odpowiedzi jednej sekcji (profil przed chwilą się wczytał) — nie.
                    if Self.isConnectionLoss(error) { offline = true; verifiedConnection = false }
                    moduleErrors[module.rawValue] = friendlyError(error)
                }
            }
            if current.canView(.inquiries) {
                do {
                    let day = try await backend.salesDay()
                    guard ticket == generation else { return }
                    snapshot?.salesDay = day
                    moduleErrors.removeValue(forKey: "day")
                } catch {
                    guard ticket == generation else { return }
                    if !(error is URLError) { snapshot?.salesDay = .null }
                    moduleErrors["day"] = friendlyError(error)
                }
            }
            guard ticket == generation else { return }
            Task { await messages.backgroundSync() }
            if current.canView(.calendar) { Task { await meetings.backgroundSync() } }
            if current.canView(.inquiries) { Task { await inquiries.backgroundSync() } }
            Task { await myTasks.backgroundSync() }
            if current.canView(.tasks) { Task { await companyTasks.backgroundSync() } }
            if current.canView(.contacts) { Task { await contacts.backgroundSync() } }
            if current.has("employees_view") || current.has("employees_manage") || current.isAdmin { Task { await team.backgroundSync() } }
            if current.has("equipment_view") || current.has("equipment_manage") { Task { await warehouse.backgroundSync() } }
            if current.has("contracts_view") || current.has("contracts_manage") || current.isAdmin { Task { await contracts.backgroundSync() } }
            if current.has("offers_view") || current.has("offers_manage") || current.isAdmin { Task { await products.backgroundSync() } }
            if current.canView(.offers) { Task { await offers.backgroundSync() } }
            if current.canView(.events) { Task { await events.backgroundSync() } }
            // Finanse: kopia na dysku od razu, stan z serwera najwyżej co 5 minut (i po wejściu do sekcji).
            if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/invoices" }) { Task { await finance.backgroundSync() } }
            // Do not extend the offline permission lease on a partial/failed synchronization.
            if moduleErrors.isEmpty { snapshot?.savedAt = Date() }
            if !editing { refreshEventToken = UUID() }
            // Kalendarz Apple: automatyczna aktualizacja kopii po pełnym odświeżeniu kalendarza (tylko gdy wpisy się zmieniły).
            if current.canView(.calendar), moduleErrors["calendar"] == nil, snapshot?.collections["calendar"]?.lastSync != nil {
                appleCalendar.refreshed(rows: rows(.calendar), employee: current.id, identity: connection.identity)
            }
            if snapshot != nil { scheduleSnapshotWrite(after: nil, reportFailure: true) }
        } catch {
            guard ticket == generation else { return }
            if error is URLError {
                offline = true; verifiedConnection = false
                if let snapshot, Date().timeIntervalSince(snapshot.savedAt) > 86_400 { self.snapshot = nil; dashboard = nil; scheduleRows = nil }
                self.error = friendlyError(error)
            } else if let issue = error as? AppError, issue == .unauthorized || issue == .noEmployee || issue == .forbidden {
                await logout()
                self.error = friendlyError(error)
            } else {
                verifiedConnection = false
                self.error = friendlyError(error)
            }
        }
    }
    func allowed(_ command: String, row: Row? = nil) -> Bool {
        guard let employee else { return false }
        switch command {
        case "contact_update": return employee.canView(.contacts) && employee.has("contacts_manage")
        case "tender_update", "tender_assign", "tender_inquiry": return employee.canView(.tenders)
        case "task_create": return employee.canView(.tasks) && (employee.has("tasks_create") || employee.has("tasks_manage"))
        case "task_update": return employee.canView(.tasks)
        case "notification_read": return true
        case "claim_inquiry": return employee.canView(.inquiries) && (employee.has("inquiries_assign") || employee.has("inquiries_manage") || employee.has("inquiries_manage_own"))
        case "complete_inquiry_followup", "snooze_inquiry_followup":
            return employee.canView(.inquiries) && (employee.has("inquiries_manage") || employee.has("inquiries_manage_all") || employee.has("inquiries_manage_team") || (employee.has("inquiries_manage_own") && row?["inquiry_owner_id"] == employee.id))
        default: return false
        }
    }
    @discardableResult func perform(_ name: String, row: Row? = nil, payload: [String: JSONValue] = [:]) async -> Bool {
        guard canWrite, !acting, allowed(name, row: row), let backend else { return false }
        acting = true; error = nil; notice = nil
        let ticket = generation
        var succeeded = false
        do {
            // Recheck identity and effective scope before every write. Database RLS/RPC remains authoritative.
            let current = try await backend.profile()
            guard ticket == generation else { return false }
            guard current == employee else { throw AppError.conflict }
            try await backend.command(name, row: row, payload: payload)
            guard ticket == generation else { return false }
            succeeded = true
            succeed("Zapisano zmiany.")
        } catch {
            guard ticket == generation else { return false }
            self.error = error is URLError ? "Nie otrzymano potwierdzenia zapisu. Odśwież dane przed ponowną próbą, aby nie powtórzyć operacji." : friendlyError(error)
            if error is URLError { verifiedConnection = false; offline = true }
        }
        guard ticket == generation else { return false }
        acting = false
        if succeeded { await refresh(force: true) }
        return succeeded
    }
    /// Zapis z okna (np. „Nowe zapytanie”, formularz kontaktu): odświeżanie danych w tle nie blokuje zapisu. Trwające logowanie
    /// (`loading`) — czekamy na jego koniec (do 20 s). Niepotwierdzone połączenie (np. po chwilowej przerwie sieci) sprawdzamy od razu
    /// profilem pracownika. Zwraca komunikat dla użytkownika albo `nil`, gdy można zapisać.
    func prepareWrite() async -> String? {
        guard let employee else { return "Brak aktywnej sesji. Zaloguj się ponownie." }
        let ticket = generation
        let deadline = Date().addingTimeInterval(20)
        while loading && Date() < deadline {
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        guard ticket == generation else { return "Sesja zmieniła się. Zaloguj się ponownie." }
        if loading { return "Trwa łączenie z serwerem CRM. Spróbuj ponownie za chwilę." }
        if !verifiedConnection || offline {
            guard pathAvailable else { return "Brak połączenia z internetem. Zapis będzie możliwy po przywróceniu połączenia." }
            guard let backend else { return "Zapis wymaga połączenia z serwerem CRM." }
            do {
                let current = try await backend.profile()
                guard ticket == generation else { return "Sesja zmieniła się. Zaloguj się ponownie." }
                guard current.is_active, current == employee else { return "Dane konta zmieniły się. Odśwież dane (⌘R) i spróbuj ponownie." }
                verifiedConnection = true; offline = false
            } catch {
                return error is URLError ? "Brak połączenia z serwerem CRM. Sprawdź internet i spróbuj ponownie." : friendlyError(error)
            }
        }
        return canWrite ? nil : "Zapis wymaga połączenia z serwerem CRM."
    }
    /// Brak połączenia z siecią lub serwerem (a nie np. przekroczony czas jednej odpowiedzi przy wolnej sekcji).
    nonisolated static func isConnectionLoss(_ error: Error) -> Bool {
        guard let error = error as? URLError else { return false }
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
             .dataNotAllowed, .internationalRoamingOff, .callIsActive:
            return true
        default:
            return false
        }
    }
    /// Ponowne potwierdzenie połączenia profilem pracownika (po powrocie sieci) — bez pełnego odświeżania danych.
    private func reverifyConnection() async {
        guard let backend, let employee, !reverifying, !loading else { return }
        reverifying = true
        defer { reverifying = false }
        let ticket = generation
        guard let current = try? await backend.profile(), ticket == generation else { return }
        guard current.is_active, current == employee else { return }
        verifiedConnection = true
        offline = false
    }
    func logout() async {
        let old = backend
        generation = UUID()
        // „Mavinci” znika z Findera razem z pobranymi kopiami plików.
        FinderDomain.deactivate()
        AvatarCache.shared.clear()
        // Local sign-out is immediate; server revocation cannot keep data visible.
        backend = nil
        snapshot = nil
        for nav in allNavigations { nav.reset() }
        // Po wylogowaniu zostaje jedno okno (logowanie) — pozostałe okna i karty są zamykane.
        for nav in windowNavigations where nav !== activeNavigation { nav.window?.close() }
        verifiedConnection = false; offline = false; syncing = false; acting = false; editing = false; refreshQueued = false
        moduleErrors = [:]; compatibilityMode = false; notice = nil; snack = nil; pending = nil
        native.clear(); messages.reset(); meetings.reset(); inquiries.reset(); companyTasks.reset(); myTasks.reset(); contacts.reset(); team.reset(); warehouse.reset(); contracts.reset(); products.reset(); offers.reset(); events.reset(); eventCards.reset(); sellers.reset(); chat.reset(); appleCalendar.reset(); fleet.reset(); timeTracking.reset(); databases.reset(); locations.reset(); website.reset(); mailCampaigns.reset(); social.reset(); portfolio.reset(); showcase.reset(); materials.reset(); drive.reset(); finance.reset()
        navigation = []; dashboard = nil; dashboardLoadedAt = nil; dashboardError = nil
        scheduleRows = nil; scheduleFailed = false
        if let cacheNamespace { for name in ["dashboard", "schedule"] { try? SealedFile<Data>(namespace: "\(name)-\(cacheNamespace)").clear() } }
        cacheNamespace = nil
        do { try Vault.delete("session-\(connection.identity)") }
        catch { self.error = "Nie udało się usunąć danych logowania z pęku kluczy. Zamknij aplikację i sprawdź dostęp do pęku kluczy." }
        do { try await clearCache() }
        catch { self.error = "Nie udało się usunąć lokalnej kopii. Sprawdź dostęp aplikacji do plików i pęku kluczy." }
        cache = nil
        await old?.logout()
    }
    func configure(_ next: Connection) async {
        guard canConfigure, next.valid else { error = AppError.configuration.localizedDescription; return }
        do {
            try next.save()
            await logout()
            connection = next
        } catch { self.error = friendlyError(error) }
    }
    func switchSection(_ module:Module) {
        guard employee?.canView(module)==true else{return}
        eventRoute=nil;focusedID=nil;notificationsVisible=false;nativeSet=nil;webItem=nil;screen=nil;selection=module
        // Wejście do Ofert z paska bocznego pokazuje listę (strona oferty otwiera się przez `showOffer`); oferta otwarta w innym
        // oknie zostaje (stan sekcji jest wspólny dla okien).
        if module == .offers && !shownElsewhere(module: .offers) { offers.openedID = nil }
        // Wejście do Kontaktów pokazuje listę (karta otwiera się przez `showContact` albo z listy).
        if module == .contacts && !shownElsewhere(module: .contacts) { contacts.opened = nil }
        sidebarHref = navigation.flatMap(\.flattened).first { $0.module == module }?.href ?? sidebarHref
    }
    func eventAPI() -> HTTPBackend? { backend }
    /// Zapis lokalnej kopii po chwili (zmiany w ciągu 0,4 s — jeden zapis); szyfrowanie i zapis w tle (`LocalCacheWriter`).
    func persistSnapshot() { scheduleSnapshotWrite(after: .milliseconds(400), reportFailure: false) }
    private func scheduleSnapshotWrite(after delay: Duration?, reportFailure: Bool) {
        persistTask?.cancel()
        persistTask = Task { [weak self] in
            if let delay { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled, let self else { return }
            let saved = await self.writeSnapshot()
            if !saved && reportFailure { self.notice = "Nie udało się zapisać lokalnej kopii. Dane są dostępne do zamknięcia aplikacji." }
        }
    }
    /// Zapis bieżącej kopii w tle; `false` — zapis się nie udał.
    private func writeSnapshot() async -> Bool {
        guard let snapshot, let cache else { return true }
        let writer = cacheWriter
        let epoch = writer.current
        return await Task.detached(priority: .utility) { writer.save(snapshot, to: cache, generation: epoch) }.value
    }
    /// Usuwa kopię (wylogowanie, inny pracownik): zaplanowane i trwające zapisy nie odtworzą jej na dysku.
    private func clearCache() async throws {
        persistTask?.cancel()
        persistTask = nil
        cacheWriter.invalidate()
        guard let cache else { return }
        let writer = cacheWriter
        try await Task.detached(priority: .userInitiated) { try writer.clear(cache) }.value
    }
    func saveEventPage(_ page: EventPageCache) {
        guard employee != nil else { return }
        if snapshot?.eventPages == nil { snapshot?.eventPages = [:] }
        snapshot?.eventPages?[page.event.id] = page
        persistSnapshot()
    }
    func showEvent(_ id: String,tab:EventTab? = nil) {
        showEvent(id, cardTab: tab?.cardTabID)
    }
    /// Karta wydarzenia na zakładce `cardTab` (identyfikator z CRM, np. `details`, `summary`; nieznany → Przegląd).
    func showEvent(_ id: String, cardTab: String?) {
        guard UUID(uuidString: id) != nil else { return }
        eventRoute = EventRoute(id: id, origin: selection, tab: EventCardTabID.normalize(cardTab))
    }
    func open(_ module: Module, id: String) {
        Task {await navigate(module,id:id)}
    }
    @discardableResult func navigate(_ module:Module,id:String) async -> Bool {
        let owner=employee
        // Okno, z którego przejście — po pobraniu rekordu wynik trafia do niego, nawet gdy użytkownik przełączył okno.
        let window=activeNavigation
        // Zadanie z tablicy „Moje zadania” (dostępnej dla każdego) — także bez uprawnienia do modułu zadań.
        if module == .tasks, owner != nil, myTasks.task(id) != nil {showTask(id);return true}
        guard let owner,owner.canView(module),UUID(uuidString:id) != nil else {notice="Nie masz dostępu do tej sekcji.";return false}
        if module == .events {showEvent(id);return true}
        if module == .contacts {showContact(id);return true}
        if module == .offers {showOffer(id);return true}
        if module == .tasks, myTasks.task(id) != nil || companyTasks.task(id) != nil {showTask(id);return true}
        var record=rows(module).first{$0.id==id || (module == .calendar && $0["source_id"]==id)}
        if record == nil,let backend,!offline {
            do {record=try await backend.record(module,id:id)}
            catch {self.error=friendlyError(error);return false}
        }
        guard employee==owner,let record else {notice="Powiązana sprawa nie jest dostępna w bieżącym zakresie danych.";return false}
        let target:Module = module == .tasks && record.fields["is_inquiry"]?.flag == true ? .inquiries:module
        guard owner.canView(target) else {return false}
        if snapshot?.collections[target.rawValue] == nil {snapshot?.collections[target.rawValue]=CollectionState()}
        if !rows(target).contains(where:{$0.id==record.id}) {snapshot?.collections[target.rawValue]?.buckets["linked"]=Array((snapshot?.collections[target.rawValue]?.buckets["linked"] ?? []).filter{$0.id != record.id})+[record]}
        let destination=windowNavigations.contains{$0===window} ? window:activeNavigation
        destination.eventRoute=nil;destination.focusedID=record.id;destination.selection=target;destination.focusToken=UUID()
        return true
    }

    // MARK: Sekcje CRM z serwera (natywne karty)
    func nativeAPI() -> NativeAPI? {
        guard let backend, let base = connection.crm else { return nil }
        return NativeAPI(base: base, backend: backend)
    }
    func showNative(_ set: String, focus: String? = nil) {
        guard native.meta(set) != nil || native.records[set] != nil else { notice = "Ta sekcja nie jest dostępna w Twoim zakresie danych."; return }
        eventRoute = nil; focusedID = nil; notificationsVisible = false; selection = nil; nativeSet = set
        nativeFocus = focus; focusToken = UUID()
    }
    /// Adres CRM w przeglądarce systemowej (ścieżka `/crm/…` albo pełny adres); `mavinci://event/<id>` otwiera natywną stronę wydarzenia.
    func openCRM(_ target: String) {
        if target.hasPrefix("mavinci://event/") { let id = String(target.dropFirst("mavinci://event/".count)); if UUID(uuidString: id) != nil { showEvent(id) }; return }
        let absolute = target.hasPrefix("http://") || target.hasPrefix("https://") ? target : (connection.crm ?? "https://mavinci.pl") + (target.hasPrefix("/") ? target : "/" + target)
        guard let url = URL(string: absolute), url.scheme == "https" || url.scheme == "http" else { return }
        NSWorkspace.shared.open(url)
    }
    func openNativeLink(_ link: DocLink) {
        switch link.type {
        case "tel", "mail", "map", "url":
            if let href = link.href, let url = URL(string: href) { NSWorkspace.shared.open(url) }
        case "record":
            guard let tab = link.tab else { return }
            if tab == "event", let id = link.id, UUID(uuidString: id) != nil { showEvent(id, cardTab: link.kind); return }
            if native.meta(tab) != nil || native.records[tab] != nil { showNative(tab, focus: link.id) }
            else if let href = link.href { openCRM(href) }
            else { notice = "Ta sekcja nie jest jeszcze dostępna w aplikacji." }
        default:
            if let href = link.href { openCRM(href) }
        }
    }
    /// Czynność z karty: zapis na serwerze CRM, potem synchronizacja kart (i danych obszaru roboczego); `record` z odpowiedzi otwiera wskazaną kartę.
    func runNative(_ action: DocAction, record: DocRecord?, set: String, data: [String: JSONValue], key: String) async -> Result<Void, NativeFailure> {
        guard canWrite, let api = nativeAPI() else { return .failure(NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem.", fieldErrors: [:])) }
        guard !acting else { return .failure(NativeFailure(status: 0, message: "Trwa poprzedni zapis — spróbuj ponownie za chwilę.", fieldErrors: [:])) }
        acting = true; error = nil; notice = nil
        defer { acting = false }
        do {
            let reply = try await api.action(action, record: record, data: data, key: key)
            notice = reply["message"]?.text.isEmpty == false ? reply["message"]!.text : "Zapisano zmiany."
            await native.sync(api)
            refreshEventToken = UUID()
            let target = reply["record"]?.object ?? [:]
            if let tab = target["tab"]?.text, !tab.isEmpty { openNativeLink(DocLinkBuilder.record(tab: tab, id: target["id"]?.text)) }
            else if let id = reply["id"]?.text, !id.isEmpty { showNative(set, focus: id) }
            return .success(())
        } catch let failure as NativeFailure {
            return .failure(failure)
        } catch AppError.unauthorized {
            return .failure(NativeFailure(status: 401, message: AppError.unauthorized.localizedDescription, fieldErrors: [:]))
        } catch {
            return .failure(NativeFailure(status: 0, message: "Nie otrzymano potwierdzenia zapisu. Odśwież dane przed ponowną próbą.", fieldErrors: [:]))
        }
    }
}

/// Odnośnik do karty zbudowany w aplikacji (np. z odpowiedzi czynności `record:{tab,id}`).
enum DocLinkBuilder {
    static func record(tab: String, id: String?) -> DocLink {
        let json: [String: JSONValue] = ["type": .string("record"), "tab": .string(tab), "id": id.map(JSONValue.string) ?? .null]
        let data = (try? JSONEncoder().encode(json)) ?? Data("{}".utf8)
        return (try? JSONDecoder().decode(DocLink.self, from: data)) ?? (try! JSONDecoder().decode(DocLink.self, from: Data(#"{"type":"record"}"#.utf8)))
    }
}

extension Workspace {
    /// Zmiana motywu: od razu w oknie, potem zapis w profilu pracownika (jak `CrmThemePicker` w CRM). Bez połączenia — tylko na tym Macu.
    func setTheme(_ next: CrmTheme) async {
        let previous = theme
        theme = next; next.remember()
        guard let id = employee?.id, let backend = eventAPI(), !offline else { return }
        do {
            _ = try await backend.request("/rest/v1/employees", method: "PATCH", query: [.init(name: "id", value: "eq.\(id)")], body: ["crm_theme": .string(next.rawValue)])
        } catch {
            theme = previous; previous.remember()
            self.error = "Nie udało się zapisać motywu w profilu. Spróbuj ponownie."
        }
    }
}

extension Workspace {
    var openInquiries: Int { rows(.inquiries).count }
    private var navigationKey: String { "navigation-\(employee?.id ?? "")" }
    /// Moduły wyłączone w aplikacji na Maca (na razie niepotrzebne): Mavinci LIVE. W CRM w przeglądarce bez zmian.
    static let hiddenModules: Set<String> = ["mavinci-live"]
    static func visibleNavigation(_ items: [NavItem]) -> [NavItem] {
        items.filter { !hiddenModules.contains($0.key) }.map { item in
            NavItem(key: item.key, name: item.name, href: item.href, iconKey: item.iconKey, children: item.children.map(visibleNavigation))
        }
    }
    func restoreNavigation() {
        guard let data = UserDefaults.standard.data(forKey: navigationKey), let items = try? JSONDecoder().decode([NavItem].self, from: data) else { return }
        navigation = Self.visibleNavigation(items)
    }
    func loadNavigation() async {
        guard let api = nativeAPI() else { return }
        if navigation.isEmpty { restoreNavigation() }
        struct Reply: Decodable { let navigation: [NavItem] }
        guard let data = try? await api.get("/navigation"), let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return }
        let visible = Self.visibleNavigation(reply.navigation)
        if visible != navigation { navigation = visible }
        if let encoded = try? JSONEncoder().encode(reply.navigation) { UserDefaults.standard.set(encoded, forKey: navigationKey) }
    }
    /// Dashboard i plan dnia z dysku (zaszyfrowane jak pozostałe dane) — widoczne od razu po uruchomieniu.
    func openLocalViews(namespace: String) {
        cacheNamespace = namespace
        if let data = try? SealedFile<Data>(namespace: "dashboard-\(namespace)").load(), let saved = try? JSONDecoder().decode(DashboardData.self, from: data) {
            dashboard = saved
        }
        if let data = try? SealedFile<Data>(namespace: "schedule-\(namespace)").load(), let rows = try? JSONDecoder().decode([Row].self, from: data) {
            scheduleRows = rows
        }
    }
    /// Plan dnia (dziś + 3 dni) — `get_employee_schedule`, zapis na dysku po każdym odświeżeniu.
    func loadSchedule() async {
        guard let employeeID = employee?.id, let backend, !scheduleLoading else { return }
        scheduleLoading = true
        defer { scheduleLoading = false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Europe/Warsaw") ?? .current
        let from = calendar.startOfDay(for: Date())
        let to = calendar.date(byAdding: .day, value: 3, to: from) ?? from
        let iso = ISO8601DateFormatter()
        do {
            let data = try await backend.request("/rest/v1/rpc/get_employee_schedule", body: [
                "p_employee_ids": .array([.string(employeeID)]), "p_from": .string(iso.string(from: from)), "p_to": .string(iso.string(from: to)),
            ])
            let rows = try JSONDecoder().decode([Row].self, from: data)
            // Plan się zmienił (event, spotkanie, termin zadania — także zmiany z CRM) — widżet „Kalendarz” pobiera go od razu.
            if rows != scheduleRows { WidgetBridge.reload() }
            scheduleRows = rows
            scheduleFailed = false
            if let cacheNamespace { try? SealedFile<Data>(namespace: "schedule-\(cacheNamespace)").save(data) }
        } catch {
            scheduleFailed = true
        }
    }
    func loadDashboard(force: Bool = false) async {
        guard let api = nativeAPI(), !dashboardLoading else { return }
        if !force, let at = dashboardLoadedAt, Date().timeIntervalSince(at) < 300 { return }
        dashboardLoading = true
        defer { dashboardLoading = false }
        do {
            let data = try await api.get("/dashboard")
            dashboard = try JSONDecoder().decode(DashboardData.self, from: data)
            dashboardLoadedAt = Date(); dashboardError = nil
            if let cacheNamespace { try? SealedFile<Data>(namespace: "dashboard-\(cacheNamespace)").save(data) }
        } catch is URLError {
            dashboardError = "Brak połączenia z serwerem CRM — pokazuję ostatnio pobrany dashboard."
        } catch {
            dashboardError = "Nie udało się pobrać dashboardu z serwera CRM."
        }
    }
    /// Pozycja paska bocznego: ekran natywny albo (na razie) strona CRM w przeglądarce.
    func openHref(_ href: String) {
        // Pozycja końcowa ma pierwszeństwo przed grupą o tym samym adresie (np. „Zadania” i „Zadania firmowe” → /crm/tasks).
        let items = navigation.flatMap(\.flattened)
        guard let item = items.first(where: { $0.href == href && ($0.children ?? []).isEmpty }) ?? items.first(where: { $0.href == href }) else { return }
        if let module = item.module, employee?.canView(module) == true { switchSection(module); sidebarHref = href; return }
        if let screen = item.screen {
            // Wejście do Zespołu z innej sekcji pokazuje listę (karta pracownika otwiera się przez `showEmployee`). Sekcja otwarta
            // w innym oknie zachowuje tam otwarty rekord (stan sekcji jest wspólny dla okien).
            if screen == .team && self.screen != .team && !shownElsewhere(screen: .team) { team.openedID = nil; team.openedTab = nil; team.openedDate = nil }
            if screen != self.screen && !shownElsewhere(screen: screen) {
                switch screen {
                case .warehouse: warehouse.openedID = nil
                case .kits: warehouse.openedKitID = nil
                case .cables: warehouse.openedCableID = nil; warehouse.cableCategoriesShown = false
                case .rental: warehouse.openedRentalID = nil
                case .products: products.openedID = nil
                case .fleet: fleet.openedID = nil; fleet.creating = false; fleet.editRequested = false
                case .timeTracking: timeTracking.openedEmployeeID = nil
                case .databases: databases.openedID = nil
                case .locations: locations.openedID = nil; locations.creating = false; locations.editingID = nil
                case .website: website.tab = .structure; website.analyticsURL = nil
                case .socialMedia: social.openedPostID = nil
                default: break
                }
            }
            eventRoute = nil; focusedID = nil; notificationsVisible = false; nativeSet = nil; webItem = nil; selection = nil
            self.screen = screen; sidebarHref = href; return
        }
        if let children = item.children, let first = children.first { openHref(first.href); return }
        eventRoute = nil; focusedID = nil; notificationsVisible = false; nativeSet = nil; selection = nil; screen = nil
        webItem = item; sidebarHref = href
    }
}
