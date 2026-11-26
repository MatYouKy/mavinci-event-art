import SwiftUI
import AppKit

// MARK: Okna z własnym obszarem roboczym
//
// Jak okna VS Code: jedna aplikacja — jedna ikona w Docku (okna są w menu jej ikony, w menu Okno i pod ⌘`), a każde okno
// i każda karta okna ma własny obszar roboczy (`Workspace`): dane w pamięci, stan sekcji (np. podsekcja Finansów, otwarta
// karta pracownika, filtry), zapisy i odświeżanie. Praca w jednym oknie niczego nie zmienia w drugim i go nie przelicza —
// widoki okna obserwują tylko jego obszar, a scena aplikacji nie obserwuje żadnego (`WorkspaceHub`).
//
// Pierwszy obszar (`WorkspaceHub.primary`) prowadzi logowanie i usługi wspólne: sesję (jeden `HTTPBackend` — token odświeża
// jedno miejsce), komunikator (połączenie na żywo, powiadomienia, licznik na ikonie w Docku), sygnet na pasku menu, Mavinci
// w Finderze, Kalendarz Apple, aktualizacje, Ustawienia i tryb testowy. Kolejne okno dostaje własny obszar: wspólną sesję
// i dane okna, z którego je otwarto (pokazuje się od razu), stan sekcji z kopii na dysku, a potem odświeża się samo. Zapis
// w jednym oknie widać w drugim po jego odświeżeniu (co minutę, po przejściu do okna, ⌘R).
//
// Zamknięte okno pierwszego obszaru wraca z tym samym widokiem przy następnym otwarciu okna; zamknięcie okna kolejnego obszaru
// kończy jego pracę (`Workspace.shutdown`). Wylogowanie w dowolnym oknie zamyka okna kolejnych obszarów i pokazuje logowanie;
// tryb testowy działa w jednym oknie (pierwszego obszaru). Opis: `desktop/mac/README.md` („Okna i karty”).

/// Pierwszy obszar roboczy w uchwycie, który niczego nie publikuje — scena aplikacji (`MavinciApp`) nie przelicza okien przy
/// każdej zmianie danych; okna i okna pomocnicze obserwują swój obszar same.
@MainActor final class WorkspaceHub: ObservableObject {
    /// Uchwyt aplikacji — dla delegata aplikacji (menu ikony w Docku) i okien pomocniczych.
    static weak var current: WorkspaceHub?
    let primary: Workspace

    init() {
        primary = Workspace()
        Self.current = self
    }

    /// Obszar okna na pierwszym planie (ostatnio aktywnego okna obszaru roboczego) — okna pomocnicze (wiadomość, formularz)
    /// otwierane z niego działają w nim.
    var keyWorkspace: Workspace { primary.keyWorkspace ?? primary }

    /// Menu ikony w Docku → „Nowe okno”: bieżąca sekcja okna na pierwszym planie w nowym oknie; przed zalogowaniem i w trybie
    /// testowym — okno, które już jest (albo nowe, gdy żadnego nie ma).
    func newWindow() {
        NSApp.activate(ignoringOtherApps: true)
        guard let open = primary.openWindowAction else { return }
        let source = keyWorkspace
        if source.employee != nil, source.testMode == nil {
            source.openInWindow(.current, using: open)
        } else if let window = primary.activeNavigation.window {
            window.makeKeyAndOrderFront(nil)
        } else {
            open(id: "main")
        }
    }
}

extension Workspace {
    /// Pierwszy obszar nie ma okna (przed pierwszym oknem, po zamknięciu) — następne okno obszaru roboczego dostaje go z powrotem.
    var windowFree: Bool { !activeNavigation.claimed && windowNavigations.isEmpty }

    /// Obszar nowego okna obszaru roboczego (`WindowSlot`): przygotowany przez `openInWindow`, pierwszy obszar, gdy nie ma okna,
    /// albo nowy obszar — okno otwarte przez macOS („+” na pasku kart, odtworzenie okien) z bieżącą sekcją okna na pierwszym planie.
    func claimWindowWorkspace() -> Workspace {
        guard !isSecondary else { return self }
        if !pendingWorkspaces.isEmpty { return pendingWorkspaces.removeFirst() }
        if windowFree { return self }
        let source = keyWorkspace ?? self
        let next = makeWindowWorkspace()
        if next.adopt(from: source) { next.show(.current, from: source, nav: source.activeNavigation) }
        return next
    }

    /// Nowy obszar kolejnego okna, zarejestrowany w pierwszym obszarze (zamykanie przy wylogowaniu, motyw).
    func makeWindowWorkspace() -> Workspace {
        let root = primary ?? self
        let next = Workspace(primary: root)
        root.windowWorkspaces.add(next)
        return next
    }

    /// Zamknięcie okna tego obszaru — także zanim okno się podepnie (`attach` zamyka je od razu).
    func closeWindow() {
        if let window = activeNavigation.window { window.close() } else { closeWhenAttached = true }
    }

    /// Pierwszy obszar: zamyka okna kolejnych obszarów (wylogowanie, tryb testowy).
    func closeWindowWorkspaces() {
        guard !isSecondary else { return }
        // Obszary otwieranych okien też są w `windowWorkspaces` (`makeWindowWorkspace`) — ich okna zamkną się po podpięciu.
        pendingWorkspaces.removeAll()
        for workspace in windowWorkspaces.allObjects {
            workspace.closeWindow()
            workspace.shutdown()
        }
    }

    /// Pierwszy obszar bez okna (zamknięte, a czynność przyszła z innego okna albo z Ustawień) — nowe okno z jego widokiem
    /// (logowanie po wylogowaniu, widok trybu testowego).
    func showWindowIfNeeded() {
        guard !isSecondary, windowFree, let open = openWindowAction else { return }
        open(id: "main")
    }
}

/// Okno obszaru roboczego: jego obszar (pierwszy albo kolejny — `Workspace.claimWindowWorkspace`) i nawigacja.
@MainActor final class WindowSlot: ObservableObject {
    let workspace: Workspace
    let nav: WindowNavigation

    init(primary: Workspace) {
        workspace = primary.claimWindowWorkspace()
        nav = workspace.claimNavigation()
    }
}

/// Okno obszaru roboczego (`WindowGroup` „main”): własny obszar, nawigacja, motyw i menu aplikacji dla tego okna.
@MainActor struct WorkspaceWindow: View {
    @StateObject private var slot: WindowSlot

    init(primary: Workspace) {
        _slot = StateObject(wrappedValue: WindowSlot(primary: primary))
    }

    var body: some View {
        WorkspaceWindowContent(workspace: slot.workspace, nav: slot.nav)
    }
}

/// Treść okna — obserwuje tylko obszar tego okna (motyw, ekran logowania, dane).
private struct WorkspaceWindowContent: View {
    @ObservedObject var workspace: Workspace
    let nav: WindowNavigation
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        RootView()
            .environmentObject(workspace)
            .environmentObject(workspace.native)
            .environmentObject(nav)
            .frame(minWidth: 1080, minHeight: 680)
            .crmThemed(workspace.theme)
            // Menu aplikacji (Mavinci, Plik → Nowe okno) działa na obszarze okna na pierwszym planie (`MavinciCommands`).
            .focusedSceneObject(workspace)
            .background(WorkspaceWindowReader { [workspace, nav] window in workspace.attach(nav, to: window) })
            .task {
                let reopened = workspace.snapshot != nil
                (workspace.primary ?? workspace).openWindowAction = openWindow
                await workspace.restore()
                // Ponownie otwarte okno pierwszego obszaru (dane sprzed zamknięcia okna) — odświeżenie, jeśli dawno nie było.
                if reopened { await workspace.refreshIfIdle(after: 30) }
            }
    }
}

/// Okno pomocnicze (wiadomość, formularz, Ustawienia): obszar roboczy, w którym działa, i jego motyw — obserwowany tylko w tym oknie.
@MainActor struct WorkspaceScene<Content: View>: View {
    @ObservedObject var workspace: Workspace
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .environmentObject(workspace)
            .environmentObject(workspace.native)
            .crmThemed(workspace.theme)
    }
}

/// Okno wiadomości — w obszarze okna, z którego je otwarto (ustalonym przy otwarciu); okno odtworzone po uruchomieniu — w pierwszym.
@MainActor struct MessageWindowScene: View {
    let key: String
    @State private var owner: Workspace

    init(key: String, fallback: Workspace) {
        self.key = key
        _owner = State(initialValue: WorkspaceHub.current?.keyWorkspace ?? fallback)
    }

    var body: some View {
        WorkspaceScene(workspace: owner) {
            MessageWindow(key: key)
                .safeAreaInset(edge: .top, spacing: 0) { TestModeBanner() }
        }
    }
}
