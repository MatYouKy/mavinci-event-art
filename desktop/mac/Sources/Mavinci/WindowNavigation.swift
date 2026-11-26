import SwiftUI
import AppKit
import Combine

// MARK: Okna i karty obszaru roboczego
//
// Każde okno Mavinci i każda karta okna ma własny obszar roboczy (`Workspace`, `WindowWorkspaces.swift`) z nawigacją okna:
// sekcją z paska bocznego, kartą wydarzenia, panelem powiadomień i wyróżnionym rekordem — w jednym oknie mogą być otwarte
// Wiadomości, w drugim wydarzenie, i oba działają jednocześnie. Stan wewnątrz sekcji (magazyny: podsekcja Finansów, otwarta
// karta pracownika, pojazdu, oferty, filtry) też jest osobny dla każdego okna i karty. Czynności nawigacji wywoływane przez
// `Workspace` (pasek boczny, menu, powiadomienia, odnośniki z kart) trafiają do okna jego obszaru.

/// Nawigacja jednego okna obszaru roboczego.
@MainActor final class WindowNavigation: ObservableObject, Identifiable {
    let id = UUID()
    @Published var selection: Module? = .day
    @Published var eventRoute: EventRoute?
    /// Oferta, rozmowa i krok przygotowań wskazane w powiadomieniu (zakładka „Ustalenia”) — odczytywane przez kartę wydarzenia.
    @Published var sellerFocus: SellerArrangementsFocus?
    @Published var focusedID: String?
    @Published var focusToken = UUID()
    @Published var notificationsVisible = false
    /// Sekcje CRM opisywane przez serwer (`/bridge/native/v1`): wybrany zbiór i rekord do pokazania po przejściu.
    @Published var nativeSet: String?
    @Published var nativeFocus: String?
    /// Ekran natywny spoza `Module` (np. Wiadomości) wybrany z paska bocznego CRM.
    @Published var screen: CrmScreen?
    /// Wybrana pozycja paska bocznego.
    @Published var sidebarHref: String? = "/crm"
    /// Widoczność paska bocznego (np. arkusz bazy danych chowa go i zajmuje całe okno; po wyjściu wraca poprzedni stan).
    @Published var sidebarVisibility: NavigationSplitViewVisibility = .all
    /// Strona CRM bez ekranu natywnego (tymczasowo otwierana w przeglądarce).
    @Published var webItem: NavItem?
    /// „Mianuj sprzedawcą” — kreator „Nowy sprzedawca” z wybraną osobą jako arkusz tego okna (`NewSellerWizard.swift`).
    @Published var sellerAppointment: NewSellerPreset?
    /// „Stan systemu i jakość danych” (administrator) — arkusz tego okna (`SystemHealthView.swift`).
    @Published var systemHealthShown = false
    /// Mavinci → „Skanuj dokument do PDF…” — skaner jako arkusz tego okna (`Scanner/DocumentScanner.swift`).
    @Published var documentScanShown = false
    /// Komunikator w tym oknie (`Chat/ChatViews.swift`): panel otwarty, zwinięty i widok (lista, rozmowa, nowa rozmowa).
    @Published var chatOpen = false
    @Published var chatMinimized = false
    @Published var chatRoute: ChatRoute = .list
    /// Okno AppKit (od pojawienia się na ekranie) i okno, do którego nowe okno dołącza jako karta.
    weak var window: NSWindow?
    weak var tabHost: NSWindow?
    /// „Nowe okno” — osobne okno, nie karta, także gdy macOS dołącza nowe okna jako karty (pełny ekran, Ustawienia systemowe →
    /// „Preferuj karty”): obok okna źródłowego (`launchFrame`) albo na pełnym ekranie, jak okno źródłowe.
    var separateWindow = false
    var launchFrame: NSRect?
    var launchFullScreen = false
    /// Przejęta przez okno; po zamknięciu ostatniego okna nawigacja czeka na następne (ten sam widok po ponownym otwarciu).
    var claimed = false
    var observers: Set<AnyCancellable> = []
    /// Stan nowego okna (po wylogowaniu).
    func reset() {
        selection = .day; eventRoute = nil; sellerFocus = nil; focusedID = nil; notificationsVisible = false
        nativeSet = nil; nativeFocus = nil; screen = nil; sidebarHref = "/crm"; sidebarVisibility = .all; webItem = nil
        sellerAppointment = nil; systemHealthShown = false; documentScanShown = false
        chatOpen = false; chatMinimized = false; chatRoute = .list
    }
}

/// Co pokazać w nowym oknie lub karcie.
enum WindowDestination {
    /// Ta sama sekcja co w aktywnym oknie (bez otwartej karty wydarzenia i panelu powiadomień).
    case current
    /// Pozycja paska bocznego CRM (np. `/crm/messages`).
    case href(String)
    /// Karta wydarzenia; „Wróć” pokazuje listę Wydarzeń.
    case event(String, tab: String?)
    /// Karta pracownika w Zespole (`Workspace.showEmployee`; bez ekranu Zespołu — CRM w przeglądarce).
    case employee(String)
}

extension Workspace {
    /// Nawigacja okna tego obszaru: przygotowana przez `openInWindow`, nawigacja zamkniętego okna (ten sam widok po ponownym
    /// otwarciu) albo stan sprzed pojawienia się pierwszego okna; drugie okno tego samego obszaru (nie powinno się zdarzyć —
    /// `claimWindowWorkspace`) — nowa nawigacja.
    func claimNavigation() -> WindowNavigation {
        let nav = activeNavigation.claimed ? WindowNavigation() : activeNavigation
        nav.claimed = true
        if !windowNavigations.contains(where: { $0 === nav }) { windowNavigations.append(nav) }
        return nav
    }

    /// Okno AppKit nawigacji: aktywność (kliknięcie, klawiatura), zamknięcie i dołączenie jako karta.
    func attach(_ nav: WindowNavigation, to window: NSWindow) {
        guard nav.window !== window else { return }
        // Inna nawigacja tego samego okna (widok okna utworzony ponownie) — już nieaktualna.
        for other in windowNavigations where other !== nav && other.window === window { detach(other) }
        nav.observers.removeAll()
        nav.window = window
        if !windowNavigations.contains(where: { $0 === nav }) { nav.claimed = true; windowNavigations.append(nav) }
        NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification, object: window)
            .sink { [weak self, weak nav] _ in
                guard let self, let nav else { return }
                self.activate(nav)
                self.becameKey()
            }
            .store(in: &nav.observers)
        NotificationCenter.default.publisher(for: NSWindow.willCloseNotification, object: window)
            .sink { [weak self, weak nav] _ in
                guard let self, let nav else { return }
                self.detach(nav)
                // Okno kolejnego obszaru: zamknięcie kończy jego pracę (pierwszy obszar czeka na następne okno).
                self.shutdown()
            }
            .store(in: &nav.observers)
        // Okna kolejnych obszarów nie wracają po ponownym uruchomieniu — macOS odtwarza okno pierwszego obszaru.
        if isSecondary { window.isRestorable = false }
        // Kolejny obszar bez sesji do przejęcia (`startWindow`) — okno zamyka się od razu.
        if closeWhenAttached {
            Task { @MainActor [weak window] in window?.close() }
            return
        }
        // „Nowa karta”: okno dołącza do grupy kart okna, z którego je otwarto (karty macOS — pasek kart, scalanie, przeciąganie).
        // Karta przeciągnięta z paska kart do osobnego okna ma już własny obszar — nic się nie przenosi.
        if let host = nav.tabHost, host !== window, host.isVisible {
            host.addTabbedWindow(window, ordered: .above)
            window.makeKeyAndOrderFront(nil)
        } else if nav.separateWindow {
            WindowNavigation.resumeAutomaticTabbing()
            prepareSeparateWindow(nav, window)
        } else {
            // Pierwsze okno po uruchomieniu aplikacji — od razu na pełnym ekranie (Ustawienia → Wygląd).
            LaunchFullScreen.apply(to: window)
        }
        nav.tabHost = nil
        nav.separateWindow = false
        if window.isKeyWindow { activate(nav); becameKey() }
    }

    /// Okno tego obszaru na pierwszym planie: okna pomocnicze (wiadomość, formularz) otwierane teraz działają w tym obszarze,
    /// komunikator (wspólny) otwiera rozmowy i odnośniki w tym oknie.
    func becameKey() {
        (primary ?? self).keyWorkspace = self
        if chat.workspace !== self, employee != nil { chat.workspace = self }
    }

    /// „Nowe okno”: obok okna źródłowego albo na pełnym ekranie (własne biurko), jak okno źródłowe. Okno dołączone mimo to przez
    /// macOS jako karta (pełny ekran, „Preferuj karty”) — wydzielone od razu i po pojawieniu się na ekranie.
    private func prepareSeparateWindow(_ nav: WindowNavigation, _ window: NSWindow) {
        keepSeparate(window)
        if let wanted = nav.launchFrame, wanted.width > 200, wanted.height > 200 {
            let screen = NSScreen.screens.first { $0.visibleFrame.intersects(wanted) } ?? window.screen ?? NSScreen.main
            window.setFrame(window.constrainFrameRect(wanted, to: screen), display: true)
        }
        if nav.launchFullScreen {
            window.collectionBehavior.insert(.fullScreenPrimary)
            Task { @MainActor [weak window] in
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard let window, window.isVisible, !window.styleMask.contains(.fullScreen) else { return }
                window.toggleFullScreen(nil)
            }
        }
        nav.launchFrame = nil
        nav.launchFullScreen = false
        Task { @MainActor [weak self, weak window] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if let self, let window { self.keepSeparate(window) }
        }
    }

    private func keepSeparate(_ window: NSWindow) {
        guard (window.tabbedWindows?.count ?? 1) > 1 else { return }
        window.moveTabToNewWindow(nil)
        window.makeKeyAndOrderFront(nil)
    }

    /// Okno, w którym pracuje użytkownik — tam trafiają czynności nawigacji, komunikaty i wskaźnik zapisu.
    func activate(_ nav: WindowNavigation) {
        guard activeNavigation !== nav, windowNavigations.contains(where: { $0 === nav }) else { return }
        activeNavigation = nav
    }

    /// Zamknięte okno: nawigacja przestaje odbierać czynności. Ostatnie okno zostawia ją dla następnego.
    func detach(_ nav: WindowNavigation) {
        nav.observers.removeAll()
        nav.window = nil
        nav.tabHost = nil
        nav.claimed = false
        windowNavigations.removeAll { $0 === nav }
        if activeNavigation === nav, let next = windowNavigations.first(where: { $0.window?.isKeyWindow == true }) ?? windowNavigations.last {
            activeNavigation = next
        }
    }

    /// Nawigacja wykonana w podanym oknie zamiast w aktywnym (przygotowanie nowego okna lub karty).
    func inWindow(_ nav: WindowNavigation, _ body: () -> Void) {
        let previous = activeNavigation
        activeNavigation = nav
        defer { activeNavigation = previous }
        body()
    }

    /// Nowe okno albo nowa karta okna `from` (domyślnie okna tego obszaru) z własnym obszarem roboczym (`WindowWorkspaces.swift`):
    /// wspólna sesja, dane tego okna w chwili otwarcia, własny stan sekcji. Przed zalogowaniem — bez nowych okien; tryb testowy
    /// działa w jednym oknie.
    func openInWindow(_ destination: WindowDestination, asTab: Bool = false, from origin: WindowNavigation? = nil, using openWindow: OpenWindowAction) {
        let source = origin ?? activeNavigation
        guard employee != nil else { return }
        guard testMode == nil else { notice = "W trybie testowym pracujesz w jednym oknie — wyjdź z trybu, aby otworzyć kolejne."; return }
        let next = makeWindowWorkspace()
        guard next.adopt(from: self) else { next.shutdown(); return }
        next.show(destination, from: self, nav: source)
        let nav = next.activeNavigation
        if asTab, let host = source.window {
            nav.tabHost = host
        } else {
            nav.separateWindow = true
            // Na pełnym ekranie — nowe okno też (własne biurko); w zwykłym oknie — obok, przesunięte jak kolejne okna macOS.
            if let window = source.window {
                if window.styleMask.contains(.fullScreen) { nav.launchFullScreen = true }
                else { nav.launchFrame = window.frame.offsetBy(dx: 28, dy: -28) }
            }
            // macOS dołączyłby nowe okno jako kartę (pełny ekran, „Preferuj karty”) — automatyczne karty wyłączone do chwili
            // pojawienia się okna (`attach`).
            WindowNavigation.suspendAutomaticTabbing()
        }
        (primary ?? self).pendingWorkspaces.append(next)
        openWindow(id: "main")
    }

    /// Widok nowego okna tego obszaru: `destination` względem okna `source` obszaru `origin`.
    func show(_ destination: WindowDestination, from origin: Workspace, nav source: WindowNavigation) {
        let nav = activeNavigation
        switch destination {
        case .current:
            nav.selection = source.selection; nav.screen = source.screen; nav.sidebarHref = source.sidebarHref
            nav.webItem = source.webItem; nav.nativeSet = source.nativeSet
            // Finanse: ta sama podsekcja i lista terminów co w oknie źródłowym — dalej niezależne.
            if source.screen == .finance { finance.part = origin.finance.part; finance.list = origin.finance.list }
        case .href(let href):
            openHref(href)
        case .event(let id, let tab):
            if employee?.canView(.events) == true { switchSection(.events) }
            showEvent(id, cardTab: tab)
        case .employee(let id):
            showEmployee(id)
        }
    }

    /// Czy sekcja jest otwarta w innej karcie tego obszaru — wtedy wejście do niej nie zamyka otwartego tam rekordu. Obszar ma
    /// jedno okno (`WindowWorkspaces.swift`), więc zwykle nie.
    func shownElsewhere(screen: CrmScreen) -> Bool {
        windowNavigations.contains { $0 !== activeNavigation && $0.screen == screen }
    }
    func shownElsewhere(module: Module) -> Bool {
        windowNavigations.contains { $0 !== activeNavigation && $0.selection == module }
    }

    /// Wszystkie nawigacje obszaru (okno i nawigacja czekająca na okno) — zmiana konta, wylogowanie.
    var allNavigations: [WindowNavigation] {
        var all = windowNavigations
        if !all.contains(where: { $0 === activeNavigation }) { all.append(activeNavigation) }
        return all
    }

    /// Wskaźnik zapisu i komunikat są pokazywane w oknie, w którym zaczęła się czynność (po zamknięciu tego okna — w każdym).
    func showsBusy(in nav: WindowNavigation) -> Bool { shows(busyWindow, in: nav) }
    func showsSnack(in nav: WindowNavigation) -> Bool { shows(snackWindow, in: nav) }
    private func shows(_ owner: UUID?, in nav: WindowNavigation) -> Bool {
        guard let owner, owner != nav.id else { return true }
        return !windowNavigations.contains { $0.id == owner }
    }

    /// Odświeżenie, jeśli poprzednie zaczęło się dawniej niż `seconds` temu — powrót do okna tuż po odświeżeniu go nie powtarza.
    func refreshIfIdle(after seconds: TimeInterval) async {
        if let at = lastRefreshStarted, Date().timeIntervalSince(at) < seconds { return }
        await refresh()
    }
}

/// Okno AppKit widoku — rejestracja okna obszaru roboczego (aktywność, zamknięcie, karty).
struct WorkspaceWindowReader: NSViewRepresentable {
    let attach: @MainActor (NSWindow) -> Void
    func makeNSView(context: Context) -> ReaderView {
        let view = ReaderView()
        view.attach = attach
        return view
    }
    func updateNSView(_ view: ReaderView, context: Context) { view.attach = attach }
    final class ReaderView: NSView {
        var attach: (@MainActor (NSWindow) -> Void)?
        /// Tylko odczyt okna — kliknięcia trafiają do treści.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard window != nil else { return }
            // Po bieżącej aktualizacji widoków — okno jest już na ekranie.
            Task { @MainActor [weak self] in
                guard let self, let window = self.window else { return }
                self.attach?(window)
            }
        }
    }
}

/// Plik → Nowe okno / Nowa karta: ta sama sekcja co w oknie na pierwszym planie — z własnym obszarem roboczym.
struct WindowMenuItems: View {
    let workspace: Workspace
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Nowe okno") { workspace.openInWindow(.current, using: openWindow) }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        Button("Nowa karta") { workspace.openInWindow(.current, asTab: true, using: openWindow) }
            .keyboardShortcut("t", modifiers: [.command, .shift])
    }
}

/// „Otwórz w nowym oknie” i „Otwórz w nowej karcie” (menu kontekstowe pozycji paska bocznego i wydarzeń) — z własnym obszarem
/// roboczym; `nav` — okno, z którego otwierane (nowa karta dołącza do niego).
struct OpenInWindowButtons: View {
    let destination: WindowDestination
    let workspace: Workspace
    let nav: WindowNavigation
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Otwórz w nowym oknie", systemImage: "macwindow.badge.plus") { workspace.openInWindow(destination, from: nav, using: openWindow) }
        Button("Otwórz w nowej karcie", systemImage: "plus.square.on.square") { workspace.openInWindow(destination, asTab: true, from: nav, using: openWindow) }
    }
}

extension WindowNavigation {
    private static var tabbingSuspended = false

    /// Automatyczne karty macOS wyłączone na czas otwierania osobnego okna — wracają po podpięciu okna (`attach`), najpóźniej po 3 s.
    static func suspendAutomaticTabbing() {
        NSWindow.allowsAutomaticWindowTabbing = false
        tabbingSuspended = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            resumeAutomaticTabbing()
        }
    }

    static func resumeAutomaticTabbing() {
        guard tabbingSuspended else { return }
        tabbingSuspended = false
        NSWindow.allowsAutomaticWindowTabbing = true
    }
}
