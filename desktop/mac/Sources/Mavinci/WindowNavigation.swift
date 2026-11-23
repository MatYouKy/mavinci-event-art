import SwiftUI
import AppKit
import Combine

// MARK: Okna i karty obszaru roboczego
//
// Każde okno Mavinci (także karta okna) ma własną nawigację: sekcję z paska bocznego, kartę wydarzenia, panel powiadomień
// i wyróżniony rekord — w jednym oknie mogą być otwarte Wiadomości, w drugim wydarzenie, i oba działają jednocześnie.
// Dane, sesja, kopia na dysku i synchronizacja są wspólne (`Workspace`). Czynności nawigacji wywoływane przez `Workspace`
// (pasek boczny, menu, powiadomienia, odnośniki z kart) trafiają do okna, w którym pracuje użytkownik (ostatnio aktywnego).
// Stan wewnątrz sekcji przechowywany w jej magazynie (np. otwarta karta pracownika, pojazdu, oferty) jest wspólny —
// ta sama sekcja otwarta w dwóch oknach pokazuje ten sam wybrany rekord.

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
    /// Komunikator w tym oknie (`Chat/ChatViews.swift`): panel otwarty, zwinięty i widok (lista, rozmowa, nowa rozmowa).
    @Published var chatOpen = false
    @Published var chatMinimized = false
    @Published var chatRoute: ChatRoute = .list
    /// Okno AppKit (od pojawienia się na ekranie) i okno, do którego nowe okno dołącza jako karta.
    weak var window: NSWindow?
    weak var tabHost: NSWindow?
    /// Przejęta przez okno; po zamknięciu ostatniego okna nawigacja czeka na następne (ten sam widok po ponownym otwarciu).
    var claimed = false
    var observers: Set<AnyCancellable> = []
    /// Stan nowego okna (po wylogowaniu).
    func reset() {
        selection = .day; eventRoute = nil; sellerFocus = nil; focusedID = nil; notificationsVisible = false
        nativeSet = nil; nativeFocus = nil; screen = nil; sidebarHref = "/crm"; sidebarVisibility = .all; webItem = nil
        sellerAppointment = nil; systemHealthShown = false
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
}

extension Workspace {
    /// Nawigacja dla nowego okna: przygotowana przez `openInWindow`, nawigacja ostatniego zamkniętego okna (albo stan sprzed
    /// pojawienia się pierwszego okna) albo nowa — Dashboard.
    func claimNavigation() -> WindowNavigation {
        let nav: WindowNavigation
        if !pendingNavigations.isEmpty { nav = pendingNavigations.removeFirst() }
        else if !activeNavigation.claimed { nav = activeNavigation }
        else { nav = WindowNavigation() }
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
            }
            .store(in: &nav.observers)
        NotificationCenter.default.publisher(for: NSWindow.willCloseNotification, object: window)
            .sink { [weak self, weak nav] _ in
                guard let self, let nav else { return }
                self.detach(nav)
            }
            .store(in: &nav.observers)
        // „Nowa karta”: okno dołącza do grupy kart okna, z którego je otwarto (karty macOS — pasek kart, scalanie, przeciąganie).
        if let host = nav.tabHost, host !== window, host.isVisible {
            host.addTabbedWindow(window, ordered: .above)
            window.makeKeyAndOrderFront(nil)
        } else {
            // Pierwsze okno po uruchomieniu aplikacji — od razu na pełnym ekranie (Ustawienia → Wygląd).
            LaunchFullScreen.apply(to: window)
        }
        nav.tabHost = nil
        if window.isKeyWindow { activate(nav) }
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

    /// Nowe okno albo nowa karta okna `from` (domyślnie aktywnego) z własną nawigacją; dane i sesja są wspólne.
    func openInWindow(_ destination: WindowDestination, asTab: Bool = false, from origin: WindowNavigation? = nil, using openWindow: OpenWindowAction) {
        let source = origin ?? activeNavigation
        let next = WindowNavigation()
        inWindow(next) {
            switch destination {
            case .current:
                next.selection = source.selection; next.screen = source.screen; next.sidebarHref = source.sidebarHref
                next.webItem = source.webItem; next.nativeSet = source.nativeSet
            case .href(let href):
                openHref(href)
            case .event(let id, let tab):
                if employee?.canView(.events) == true { switchSection(.events) }
                showEvent(id, cardTab: tab)
            }
        }
        if asTab { next.tabHost = source.window }
        pendingNavigations.append(next)
        openWindow(id: "main")
    }

    /// Czy sekcja jest otwarta w innym oknie — wtedy wejście do niej nie zamyka otwartego tam rekordu (stan sekcji jest wspólny).
    func shownElsewhere(screen: CrmScreen) -> Bool {
        windowNavigations.contains { $0 !== activeNavigation && $0.screen == screen }
    }
    func shownElsewhere(module: Module) -> Bool {
        windowNavigations.contains { $0 !== activeNavigation && $0.selection == module }
    }

    /// Wszystkie nawigacje (otwarte okna, okna w przygotowaniu, nawigacja czekająca na okno) — zmiana konta, wylogowanie.
    var allNavigations: [WindowNavigation] {
        var all = windowNavigations
        for nav in pendingNavigations + [activeNavigation] where !all.contains(where: { $0 === nav }) { all.append(nav) }
        return all
    }

    /// Wskaźnik zapisu i komunikat są pokazywane w oknie, w którym zaczęła się czynność (po zamknięciu tego okna — w każdym).
    func showsBusy(in nav: WindowNavigation) -> Bool { shows(busyWindow, in: nav) }
    func showsSnack(in nav: WindowNavigation) -> Bool { shows(snackWindow, in: nav) }
    private func shows(_ owner: UUID?, in nav: WindowNavigation) -> Bool {
        guard let owner, owner != nav.id else { return true }
        return !windowNavigations.contains { $0.id == owner }
    }

    /// Odświeżenie, jeśli poprzednie zaczęło się dawniej niż `seconds` temu — kilka okien nie mnoży odświeżeń.
    func refreshIfIdle(after seconds: TimeInterval) async {
        if let at = lastRefreshStarted, Date().timeIntervalSince(at) < seconds { return }
        await refresh()
    }
}

/// Okno obszaru roboczego: własna nawigacja (`WindowNavigation`), wspólne dane i sesja.
@MainActor struct WorkspaceWindow: View {
    let workspace: Workspace
    @StateObject private var nav: WindowNavigation
    init(workspace: Workspace) {
        self.workspace = workspace
        _nav = StateObject(wrappedValue: workspace.claimNavigation())
    }
    var body: some View {
        RootView()
            .environmentObject(nav)
            .background(WorkspaceWindowReader { [workspace, nav] window in workspace.attach(nav, to: window) })
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

/// Plik → Nowe okno / Nowa karta: ta sama sekcja co w aktywnym oknie, z własną nawigacją.
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

/// „Otwórz w nowym oknie” i „Otwórz w nowej karcie” (menu kontekstowe pozycji paska bocznego i wydarzeń); `nav` — okno, z którego
/// otwierane (nowa karta dołącza do niego).
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
