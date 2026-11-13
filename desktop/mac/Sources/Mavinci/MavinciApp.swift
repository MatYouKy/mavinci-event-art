import SwiftUI
import AppKit

@main struct MavinciApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var workspace = Workspace()
    var body: some Scene {
        WindowGroup("Mavinci", id: "main") {
            RootView().environmentObject(workspace).environmentObject(workspace.native).frame(minWidth: 1080, minHeight: 680)
                .crmThemed(workspace.theme)
                .task { await workspace.restore() }
        }
        .defaultSize(width: 1280, height: 800)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("Mavinci") {
                Button("Odśwież dane") { Task { await workspace.refresh(); if workspace.screen == .messages { await workspace.messages.refresh() }; if workspace.screen == .meetings { await workspace.meetings.sync(force: true) }; if workspace.selection == .inquiries { await workspace.inquiries.sync(force: true) }; if workspace.selection == .tasks || workspace.screen == .myTasks { await workspace.myTasks.sync(force: true) }; if workspace.screen == .companyTasks { await workspace.companyTasks.sync(force: true) }; if workspace.selection == .contacts { await workspace.contacts.sync(force: true) }; if workspace.selection == .events { await workspace.events.sync(force: true) }; if workspace.screen == .team { await workspace.team.sync(force: true); if let id = workspace.team.openedID { await workspace.team.loadDetail(id) } }; if workspace.screen?.isWarehouse == true { await workspace.warehouse.sync(force: true); if workspace.screen == .warehouse, let id = workspace.warehouse.openedID { await workspace.warehouse.loadDetail(id) } } } }.keyboardShortcut("r").disabled(workspace.syncing || workspace.editing)
                Divider()
                Button("Dashboard") { workspace.switchSection(.day) }.keyboardShortcut("1")
                Button("Zapytania") { if workspace.employee?.canView(.inquiries) == true { workspace.switchSection(.inquiries) } }.keyboardShortcut("2")
                Button("Moje zadania") { if workspace.employee?.canView(.tasks) == true { workspace.switchSection(.tasks) } }.keyboardShortcut("3")
                Button("Wydarzenia") { if workspace.employee?.canView(.events) == true { workspace.switchSection(.events) } }.keyboardShortcut("4")
                Button("Kalendarz") { if workspace.employee?.canView(.calendar) == true { workspace.switchSection(.calendar) } }.keyboardShortcut("5")
                Button("Kontakty") {workspace.switchSection(.contacts)}.keyboardShortcut("6")
                Button("Oferty") {workspace.switchSection(.offers)}.keyboardShortcut("7")
                Button("Przetargi") {workspace.switchSection(.tenders)}.keyboardShortcut("8")
                Button("Powiadomienia") {workspace.notificationsVisible.toggle()}.keyboardShortcut("9")
                Divider()
                Button("Wyloguj") { Task { await workspace.logout() } }.disabled(workspace.loading || workspace.acting)
            }
        }
        WindowGroup("Wiadomość", id: "message", for: String.self) { $key in
            MessageWindow(key: key ?? "").environmentObject(workspace).crmThemed(workspace.theme)
        }
        .defaultSize(width: 900, height: 780)
        // Sygnet na pasku menu (jak dawne „Mavinci Reminders”): stan, wersja, pliki w Finderze, synchronizacja.
        MenuBarExtra {
            MenuBarStatusMenu(workspace: workspace)
        } label: {
            Image(nsImage: MenuBarSignet.image)
                .renderingMode(.template)
                .accessibilityLabel("Mavinci")
        }
        .menuBarExtraStyle(.menu)
        Settings {
            TabView {
                AppearanceSettings().tabItem { Label("Wygląd", systemImage: "paintpalette") }
                ConnectionView().tabItem { Label("Połączenie", systemImage: "network") }
            }.environmentObject(workspace).frame(width: 600, height: 460).crmThemed(workspace.theme)
        }
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular); NSApp.activate(ignoringOtherApps: true)
        // Ikona z brandbooka zapamiętana przy poprzednim uruchomieniu — od razu w Docku, bez czekania na sieć.
        Task { @MainActor in BrandStore.applyCached() }
    }
    /// Zamknięcie okna nie kończy aplikacji — działa dalej na pasku menu (pliki w Finderze, synchronizacja); „Zakończ Mavinci” w menu.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

struct RootView: View {
    @EnvironmentObject var state: Workspace
    @EnvironmentObject var native: NativeStore
    @Environment(\.scenePhase) private var phase
    @State private var help = false
    var body: some View {
        Group {
            if state.employee != nil {
                NavigationSplitView {
                    Group {
                    if !state.navigation.isEmpty { CrmSidebar() }
                    else {
                    List(selection: $state.selection) {
                        Section("Miejsce pracy") {
                            ForEach(state.modules.filter { $0 != .notifications }) { module in
                                HStack {
                                    Label(module.title, systemImage: module.symbol)
                                    Spacer()
                                    if module == .notifications && state.unread > 0 { Text("\(state.unread)").foregroundStyle(.secondary).monospacedDigit() }
                                }.contentShape(Rectangle()).tag(module).onTapGesture{state.switchSection(module)}
                            }
                        }
                    }
                    }
                    }
                    .navigationTitle("Mavinci")
                    .background(state.theme.sidebar)
                    .navigationSplitViewColumnWidth(min: 210, ideal: 235, max: 300)
                    .safeAreaInset(edge: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(state.employee?.displayName ?? "").font(.headline)
                            Label(state.offline ? "Kopia lokalna · tylko odczyt" : (state.syncing ? "Odświeżanie…" : "Połączono"), systemImage: state.offline ? "wifi.slash" : "checkmark.icloud")
                                .font(.caption).foregroundStyle(state.offline ? .orange : .secondary)
                            if state.compatibilityMode { Text("Pełne odświeżanie danych").font(.caption2).foregroundStyle(.secondary) }
                            HStack {
                                SettingsLink { Label("Ustawienia", systemImage: "gearshape") }.labelStyle(.iconOnly)
                                Button { help = true } label: { Label("Instrukcja i zakres", systemImage: "questionmark.circle") }.labelStyle(.iconOnly)
                                Spacer()
                                Button("Wyloguj") { Task { await state.logout() } }.disabled(state.acting)
                            }.buttonStyle(.borderless)
                        }.padding().crmBar()
                    }
                } detail: {
                    VStack(spacing: 0) {
                        if let route = state.eventRoute { EventCardView(eventID: route.id, initialTab: route.tab).id(route.id) }
                        else if let item = state.webItem { CrmWebPlaceholder(item: item).id(item.href) }
                        else if state.selection == .calendar { NativeCalendarView() }
                        else if state.selection == .tasks { TasksBoardView(store: state.myTasks).id("tasks-mine") }
                        else if state.selection == .tenders { TendersView() }
                        else if state.selection == .inquiries, state.employee?.canView(.inquiries) == true { InquiriesFunnelView(store: state.inquiries) }
                        else if state.selection == .contacts, state.employee?.canView(.contacts) == true { ContactsView(store: state.contacts) }
                        else if state.selection == .events, state.employee?.canView(.events) == true { EventsListView(store: state.events) }
                        else if state.selection == .day { DashboardView() }
                        else if let module = state.selection, state.employee?.canView(module) == true { RecordsView(module: module).id(module) }
                        else if state.screen == .messages { MessagesView() }
                        else if state.screen == .meetings { MeetingsView(store: state.meetings) }
                        else if state.screen == .companyTasks { TasksBoardView(store: state.companyTasks).id("tasks-company") }
                        else if state.screen == .myTasks { TasksBoardView(store: state.myTasks).id("tasks-mine") }
                        else if state.screen == .team { TeamView(store: state.team) }
                        else if state.screen == .warehouse { WarehouseView(store: state.warehouse) }
                        else if state.screen == .kits { KitsView(store: state.warehouse) }
                        else if state.screen == .cables { CablesView(store: state.warehouse) }
                        else if state.screen == .rental { RentalView(store: state.warehouse) }
                        else if state.screen == .connectors { ConnectorsView(store: state.warehouse) }
                        else if state.screen == .warehouseCategories { WarehouseCategoriesView(store: state.warehouse) }
                        else if state.screen == .contracts { ContractsView(store: state.contracts) }
                        else if state.screen == .contractTemplates { ContractTemplatesView(store: state.contracts) }
                        else { ContentUnavailableView("Wybierz sekcję", systemImage: "sidebar.left") }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(state.theme.page)
                    .overlay {
                        if state.notificationsVisible {
                            GeometryReader { available in
                                ZStack(alignment:.trailing){
                                    Color.black.opacity(0.12).contentShape(Rectangle()).onTapGesture{state.notificationsVisible=false}
                                    NotificationsDrawer().frame(width:min(480,max(300,available.size.width-28)),height:available.size.height)
                                        .shadow(color:.black.opacity(0.16),radius:18,x:-6,y:0).transition(.move(edge:.trailing))
                                }.frame(width:available.size.width,height:available.size.height)
                            }
                        }
                    }
                    .overlay {
                        if let text = state.pending ?? (state.acting ? "Zapisywanie…" : nil) { PendingOverlay(text: text) }
                    }
                    .overlay { SnackbarHost() }
                    .toolbar {
                        ToolbarItemGroup(placement: .primaryAction) {
                            Button {
                                withAnimation(.easeInOut(duration:0.18)){state.notificationsVisible.toggle()}
                            } label: {
                                ZStack(alignment: .topTrailing) {
                                    Image(systemName: "bell")
                                    if state.unread > 0 {
                                        Text(state.unread > 99 ? "99+" : "\(state.unread)")
                                            .font(.system(size: 8, weight: .bold)).padding(3)
                                            .background(.red, in: Capsule()).foregroundStyle(.white).offset(x: 9, y: -8)
                                    }
                                }.frame(width: 28, height: 26)
                            }.help("Powiadomienia: \(state.unread) nieprzeczytanych").accessibilityLabel("Powiadomienia")
                        }
                        ToolbarItem(placement: .primaryAction) {
                            Button { Task { await state.refresh(); if state.screen == .messages { await state.messages.refresh() }; if state.screen == .meetings { await state.meetings.sync(force: true) }; if state.selection == .inquiries { await state.inquiries.sync(force: true) }; if state.selection == .tasks || state.screen == .myTasks { await state.myTasks.sync(force: true) }; if state.screen == .companyTasks { await state.companyTasks.sync(force: true) }; if state.selection == .contacts { await state.contacts.sync(force: true) }; if state.selection == .events { await state.events.sync(force: true) }; if state.screen == .team { await state.team.sync(force: true); if let id = state.team.openedID { await state.team.loadDetail(id) } }; if state.screen?.isWarehouse == true { await state.warehouse.sync(force: true); if state.screen == .warehouse, let id = state.warehouse.openedID { await state.warehouse.loadDetail(id) } } } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                                .disabled(state.syncing || state.acting || state.editing)
                        }
                        ToolbarItem(placement: .primaryAction) { if state.syncing { ProgressView().controlSize(.small) } }
                    }
                }
            } else { LoginView() }
        }
        .sheet(isPresented: $help) { HelpView() }
        .onChange(of: state.selection) { _, next in
            if next != nil { state.nativeSet = nil; state.webItem = nil; state.screen = nil }
            if let route = state.eventRoute, next != route.origin { state.eventRoute = nil }
        }
        .onOpenURL { url in
            guard url.scheme == "mavinci",let id=url.pathComponents.last,UUID(uuidString:id) != nil else {return}
            if url.host == "event" {state.showEvent(id)}
            else if url.host == "meeting" {state.showMeeting(id)}
        }
        .onChange(of: phase) { _, next in
            if next == .active { Task { await state.refresh() } }
        }
        .task(id: state.employee?.id) {
            while !Task.isCancelled && state.employee != nil {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                if phase == .active { await state.refresh() }
            }
        }
    }
}
struct MessageBar: View {
    let text: String
    let warning: Bool
    let dismiss: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Image(systemName: warning ? "exclamationmark.triangle" : "checkmark.circle")
            Text(text).textSelection(.enabled)
            Spacer()
            Button(action: dismiss) { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Zamknij komunikat")
        }.font(.callout).padding(12).background(warning ? Color.orange.opacity(0.12) : Color.green.opacity(0.1))
    }
}

struct LoginView: View {
    @EnvironmentObject var state: Workspace
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        VStack(spacing: 22) {
            Image(nsImage: NSApp.applicationIconImage).resizable().interpolation(.high).frame(width: 96, height: 96).accessibilityHidden(true)
            Text("Mavinci").font(.largeTitle.bold())
            Text("Twoje miejsce pracy").foregroundStyle(.secondary)
            if !state.connection.valid { ConnectionView() }
            else {
                Form {
                    TextField("Adres e-mail", text: $email).textContentType(.username)
                    SecureField("Hasło", text: $password).textContentType(.password)
                }.formStyle(.grouped).frame(height: 130)
                if let error = state.error { Text(error).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
                Button("Zaloguj się") {
                    Task { await state.login(email: email, password: password); password = "" }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || state.loading)
                if state.loading { ProgressView().controlSize(.small) }
                Text("Użyj konta pracownika z CRM. Zakres danych wynika z jego aktualnych uprawnień.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }.padding(36).frame(maxWidth: 540).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ConnectionView: View {
    @EnvironmentObject var state: Workspace
    @State private var draft = Connection()
    @State private var saving = false
    var body: some View {
        Form {
            Section("Połączenie") {
                Picker("Źródło danych", selection: $draft.provider) {
                    Text("Supabase").tag(Connection.Provider.supabase)
                    Text("Własny serwer").tag(Connection.Provider.server)
                }
                TextField("Adres serwera", text: $draft.url)
                if draft.provider == .supabase { SecureField("Publiczny klucz aplikacji", text: $draft.publicKey) }
                if !draft.valid { Text("Wymagany jest adres HTTPS i klucz publiczny. Dla lokalnego serwera dopuszczalny jest HTTP na localhost.").font(.caption).foregroundStyle(.secondary) }
                if draft.provider == .server { Text("Własny serwer wymaga interfejsu /api/native/v1 opisanego w dokumentacji projektu. Samo wpisanie adresu nie uruchamia migracji danych.").font(.caption).foregroundStyle(.secondary) }
            }.disabled(!state.canConfigure || saving)
            if state.canConfigure {
                Button(saving ? "Zapisywanie…" : "Zapisz połączenie") {
                    saving = true
                    Task { await state.configure(draft); saving = false }
                }.disabled(!draft.valid || saving || state.acting || state.syncing)
                Text("Zmiana połączenia wyloguje konto i usunie jego lokalną kopię.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Zmienne połączenia zmienia administrator po zalogowaniu. Pierwszą konfigurację aplikacji przygotowuje osoba instalująca.").font(.callout).foregroundStyle(.secondary)
            }
            if let error = state.error { Text(error).foregroundStyle(.red).font(.callout) }
        }.formStyle(.grouped).padding().onAppear { draft = state.connection }
    }
}

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Praca w Mavinci na Macu").font(.title2.bold())
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Wybierz sekcję z paska bocznego. Listy zajmują całą wysokość od pierwszego wejścia; szczegóły są po prawej przy odpowiedniej szerokości, a w mniejszym oknie w modalu. Kontakty pochodzą wyłącznie z CRM — aplikacja nie odczytuje prywatnej książki adresowej urządzenia. Edycja kontaktu wymaga contacts_manage i jest sprawdzana również przez bazę.")
                    Text("Moje zadania to Kanban: Do zrobienia, W trakcie, Do sprawdzenia i Zakończone. Kliknięcie otwiera szczegóły. Przeciągnij kartę do innej kolumny lub użyj menu Przenieś do; zapis wymaga internetu i aktualnej wersji rekordu.")
                    Text("Kalendarz i Wydarzenia używają wspólnego zakresu uprawnień i tego samego zbioru wydarzeń. Kolorowe obramowanie wpisu odpowiada kategorii w CRM. Wydarzenia i oferty domyślnie pomijają przeszłe i zamknięte rekordy; zaznacz Pokaż również ukryte lub Szukaj również w ukrytych, aby je odnaleźć. Filtr nie rozszerza uprawnień do danych.")
                    Text("Przetargi domyślnie pokazują aktywne sprawy. Na liście są ocena dopasowania, zamawiający i czas do terminu. Szczegóły zawierają dane jak modal CRM oraz obserwowanie, opiekuna, utworzenie zapytania, notatki, status i ocenę manualną. Starsze i ukryte pozycje włączysz filtrem.")
                    Text("⌘R odświeża dane, ⌘1 otwiera Mój dzień, ⌘2 zapytania, ⌘3 zadania. W Moich zadaniach ⌘N tworzy prywatne zadanie, a ⌘E edytuje zaznaczone.")
                    Text("Zapytania: przejmij nieprzypisaną sprawę, zapisz wykonany kontakt lub odłóż przypomnienie o godzinę. Po wykonaniu kontaktu możesz wybrać termin kolejnego działania. Ostateczne uprawnienia sprawdza baza danych.")
                    Text("Zadania: twórz prywatne zadania, zmieniaj tytuł, opis, priorytet, termin i etap. Zapis wymaga połączenia. Konflikt zmian wymaga odświeżenia; formularz zachowuje wpisany tekst.")
                    Text("Bez internetu ostatnia zapisana kopia jest dostępna tylko do odczytu przez maksymalnie 24 godziny od pełnego udanego odświeżenia. Po powrocie do aplikacji uprawnienia są sprawdzane ponownie. Wylogowanie usuwa kopię i lokalną sesję.")
                    Text("Zakres pierwszej wersji").font(.headline)
                    Text("Wydarzenia mają pełną stronę z zakładkami. Możesz edytować dane i istniejące etapy, prowadzić agendę i zadania, dodawać osoby, odpowiadać na zaproszenia, planować oczekujące koszty, oznaczać załadunek oraz dodawać i otwierać pliki. Dostępne działania realizacji wynikają z uprawnień w bazie. Poszczególne zakładki wskazują pozostałe do wdrożenia czynności; pełna obsługa ofert, umów, kalkulacji, faktur, logistyki i edytora Mavinci LIVE nie jest jeszcze gotowa.")
                    Text("Dzwonek powiadomień jest u góry po prawej, obok odświeżania. Wydarzenie otworzysz zaznaczeniem wiersza listy albo z kalendarza; przycisk Wróć przywraca listę.")
                    Text("Kalendarz pokazuje wydarzenia, własne i zaproszone spotkania oraz terminy otwartych zapytań. Połącz z Kalendarzem Apple pozwala wybrać kalendarz i ręcznie zapisać lub zaktualizować kopię wydarzeń i spotkań. Apple nie przekazuje prywatnych wpisów do CRM. Uprawnienia kalendarza nadajesz dopiero po kliknięciu przycisku. Wylogowanie z CRM nie usuwa kopii zapisanej w Apple.")
                    Text("Dzwonek otwiera panel powiadomień po prawej. Możesz oznaczyć pojedynczy wpis lub wszystkie jako przeczytane. Otwórz sprawę przechodzi do konkretnego zadania, zapytania, wydarzenia i obsługiwanej zakładki, kontaktu, oferty, przetargu lub spotkania, także gdy rekord jest schowany przez domyślne filtry. Sprawy bez gotowej sekcji natywnej są wyraźnie oznaczone.")
                    Text("Synchronizacja przyrostowa wymaga migracji native_workspace_sync w Supabase. Przed jej wdrożeniem aplikacja pobiera pełne listy i pokazuje informację „Pełne odświeżanie danych”.")
                }.textSelection(.enabled)
            }
            HStack { Spacer(); Button("Gotowe") { dismiss() }.keyboardShortcut(.defaultAction) }
        }.padding(28).frame(width: 650, height: 610)
    }
}
