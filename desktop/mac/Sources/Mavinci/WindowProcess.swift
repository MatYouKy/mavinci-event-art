import SwiftUI
import AppKit

// MARK: Okna w osobnych procesach
//
// „Otwórz w nowym oknie” (pasek boczny, lista eventów), Plik → Nowe okno (⇧⌘N), „W nowym oknie” przy przeciąganiu pozycji
// paska bocznego i karta wyciągnięta z paska kart do osobnego okna (przeciągnięcie, Okno → Przenieś kartę do nowego okna)
// uruchamiają drugą kopię aplikacji — osobny proces macOS z tym widokiem. Takie okno ma własne dane w pamięci, własny stan
// sekcji (np. podsekcja Finansów, otwarta karta pracownika) i własny wątek główny: praca w jednym oknie nie zmienia ani nie
// spowalnia drugiego. Karty (⇧⌘T, „Otwórz w nowej karcie”) zostają w procesie okna, do którego należą — karty macOS nie łączą
// okien różnych procesów — więc ta sama sekcja w dwóch kartach jednego okna pokazuje ten sam stan.
//
// Proces główny (uruchomiony z Docka, Findera, Launchpada) prowadzi usługi w tle: sygnet na pasku menu, Mavinci w Finderze
// i widżety, Kalendarz Apple, powiadomienia macOS komunikatora, sprawdzanie aktualizacji i tryb testowy. Okno w osobnym
// procesie ich nie dubluje. Sesję dzieli z procesem głównym przez pęk kluczy i kontener grupy aplikacji (`FinderShared`):
// token odświeża zawsze jeden proces naraz, pod wspólną blokadą, a pozostałe przejmują nową sesję. Zapis w jednym oknie
// widać w drugim po jego odświeżeniu (co minutę, po przejściu do okna, ⌘R).
//
// Zamknięcie okna kończy jego proces. Zakończenie procesu głównego (⌘Q w jego oknie, „Zakończ Mavinci” na pasku menu,
// instalacja aktualizacji) i wylogowanie w dowolnym oknie zamykają okna w osobnych procesach. Bez podpisu zespołu Mavinci
// (brak kontenera grupy — wspólnej sesji), przed zalogowaniem i w trybie testowym nowe okno otwiera się w tym samym procesie —
// jako osobne okno, nie karta. Opis: `desktop/mac/README.md` („Okna w osobnych procesach”).

/// Widok okna uruchamianego w osobnym procesie (argument `--mavinci-window`, JSON w Base64). Same identyfikatory i adresy
/// sekcji — bez danych logowania (sesja jest w pęku kluczy).
struct WindowLaunch: Codable {
    /// Identyfikator uruchomienia — nowy proces ogłasza nim, że jego okno jest na ekranie (`AppInstance.Signal.shown`).
    var token = UUID().uuidString
    /// Pozycja paska bocznego CRM (np. `/crm/invoices`).
    var href: String?
    /// Karta wydarzenia i jej zakładka.
    var eventID: String?
    var eventTab: String?
    /// Karta pracownika w Zespole.
    var employeeID: String?
    /// Stan Finansów okna źródłowego (podsekcja z listy po lewej i lista terminów) — przy ⇧⌘N i wyciągnięciu karty.
    var financePart: String?
    var financeList: String?
    /// Położenie i rozmiar okna (x, y, szerokość, wysokość); `nil` — domyślne.
    var frame: [Double]?
    /// Okno źródłowe było na pełnym ekranie — nowe też (osobne biurko macOS).
    var fullScreen = false
}

/// Kopia aplikacji: proces główny albo okno w osobnym procesie. Bez izolacji aktora — czytane także przez pęk kluczy i delegata aplikacji.
enum AppInstance {
    static let argument = "--mavinci-window"
    /// Widok, z którym uruchomiono ten proces; `nil` — proces główny.
    static let launch: WindowLaunch? = {
        let arguments = CommandLine.arguments
        guard let index = arguments.firstIndex(of: argument), index + 1 < arguments.count,
              let data = Data(base64Encoded: arguments[index + 1]) else { return nil }
        return try? JSONDecoder().decode(WindowLaunch.self, from: data)
    }()
    /// Okno w osobnym procesie (bez usług w tle procesu głównego).
    static var isSecondary: Bool { launch != nil }

    /// Sygnały między kopiami aplikacji (powiadomienia rozproszone macOS w obrębie konta użytkownika; nazwa z identyfikatorem
    /// pakietu — Mavinci i Mavinci-Dev się nie mieszają). Treść: numer procesu nadawcy albo identyfikator uruchomienia okna.
    enum Signal: String {
        /// Okno nowego procesu jest na ekranie (treść: `WindowLaunch.token`).
        case shown = "window-shown"
        /// Proces główny kończy pracę — okna w osobnych procesach też.
        case quit = "quit-windows"
        /// Instalacja aktualizacji — kończą pracę wszystkie kopie (także proces główny), żeby uruchomić nową wersję.
        case update = "update-install"
        /// Wylogowanie — okna w osobnych procesach zamykają się, proces główny pokazuje logowanie.
        case signedOut = "signed-out"
        var name: Notification.Name { Notification.Name((Bundle.main.bundleIdentifier ?? "pl.mavinci.desktop") + ".instances." + rawValue) }
    }

    static func post(_ signal: Signal, _ object: String? = nil) {
        DistributedNotificationCenter.default().postNotificationName(
            signal.name, object: object ?? String(ProcessInfo.processInfo.processIdentifier), userInfo: nil, deliverImmediately: true)
    }

    /// Sygnał od innej kopii tej aplikacji (nie od tego procesu). Proces główny wysyła „quit” tuż przed zakończeniem — może go
    /// już nie być, gdy sygnał dotrze; wtedy wystarcza numer procesu inny niż własny.
    @MainActor static func fromSibling(_ notification: Notification) -> Bool {
        guard let text = notification.object as? String, let pid = pid_t(text), pid != ProcessInfo.processInfo.processIdentifier else { return false }
        guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else { return true }
        return app.bundleIdentifier == Bundle.main.bundleIdentifier
    }
}

@MainActor enum WindowProcess {
    /// Czy nowe okno może być osobnym procesem: zbudowana aplikacja (.app) podpisana zespołem Mavinci (wspólna sesja i blokada
    /// odświeżania w kontenerze grupy), zalogowany pracownik, poza trybem testowym (sesja oglądanej osoby jest tylko w pamięci).
    static func available(_ workspace: Workspace) -> Bool {
        Bundle.main.bundleURL.pathExtension == "app" && FinderShared.bundledWithExtension && FinderShared.container != nil
            && workspace.employee != nil && workspace.testMode == nil
    }

    /// Uruchamia kopię aplikacji z widokiem `launch`; wynik — numer procesu.
    static func spawn(_ launch: WindowLaunch) async -> Result<pid_t, Error> {
        let data: Data
        do { data = try JSONEncoder().encode(launch) } catch { return .failure(error) }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.activates = true
        configuration.addsToRecentItems = false
        // Bez odtwarzania okien procesu głównego — zapisany stan okien macOS jest wspólny dla kopii aplikacji.
        configuration.arguments = [AppInstance.argument, data.base64EncodedString(), "-ApplePersistenceIgnoreState", "YES"]
        // Od teraz pęk kluczy zmieniają dwa procesy — zapis zaczyna się od świeżego odczytu pozycji (`Vault`).
        Vault.shareAcrossProcesses()
        let url = Bundle.main.bundleURL
        return await withCheckedContinuation { (continuation: CheckedContinuation<Result<pid_t, Error>, Never>) in
            NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
                if let app { continuation.resume(returning: .success(app.processIdentifier)) }
                else { continuation.resume(returning: .failure(error ?? AppError.server)) }
            }
        }
    }

    /// Identyfikatory uruchomień, których okna są już na ekranie (`AppInstance.Signal.shown`).
    private static var shown: Set<String> = []
    static func markShown(_ token: String) { shown.insert(token) }

    /// Czeka, aż nowy proces pokaże okno. `false` — proces zakończył się bez okna; po czasie — `true`, jeśli proces działa
    /// (okno pojawi się za chwilę).
    static func waitUntilShown(_ token: String, pid: pid_t, timeout: TimeInterval = 20) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if shown.remove(token) != nil { return true }
            guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else { return false }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
        return NSRunningApplication(processIdentifier: pid).map { !$0.isTerminated } ?? false
    }
}

extension Workspace {
    /// Widok okna `source` do uruchomienia w osobnym procesie (miejsce docelowe nowego okna).
    func windowLaunch(_ destination: WindowDestination, source: WindowNavigation) -> WindowLaunch {
        var launch = WindowLaunch()
        switch destination {
        case .current:
            launch.href = source.sidebarHref ?? "/crm"
            if source.screen == .finance { launch.financePart = finance.part.rawValue; launch.financeList = finance.list.rawValue }
        case .href(let href):
            launch.href = href
        case .event(let id, let tab):
            launch.eventID = id; launch.eventTab = tab
        case .employee(let id):
            launch.employeeID = id
        }
        // Na pełnym ekranie — nowe okno też (własne biurko); w zwykłym oknie — obok, przesunięte jak kolejne okna macOS.
        if let window = source.window {
            if window.styleMask.contains(.fullScreen) { launch.fullScreen = true }
            else { launch.frame = Self.frameValues(window.frame.offsetBy(dx: 28, dy: -28)) }
        }
        return launch
    }

    /// Widok okna przenoszonego do osobnego procesu (wyciągnięta karta): karta wydarzenia albo sekcja z jej stanem, to samo
    /// położenie i rozmiar.
    func windowLaunch(moving nav: WindowNavigation, window: NSWindow) -> WindowLaunch {
        var launch = WindowLaunch()
        if let route = nav.eventRoute {
            launch.eventID = route.id; launch.eventTab = route.tab
        } else {
            launch.href = nav.sidebarHref ?? "/crm"
            if nav.screen == .finance { launch.financePart = finance.part.rawValue; launch.financeList = finance.list.rawValue }
        }
        if window.styleMask.contains(.fullScreen) { launch.fullScreen = true } else { launch.frame = Self.frameValues(window.frame) }
        return launch
    }

    static func frameValues(_ frame: NSRect) -> [Double] {
        [Double(frame.minX), Double(frame.minY), Double(frame.width), Double(frame.height)]
    }

    /// „Otwórz w nowym oknie”: osobny proces z widokiem `destination`. Okno źródłowe pokazuje postęp do pojawienia się nowego
    /// okna; nieudane uruchomienie — okno w tym procesie (`fallback`).
    func openInProcess(_ destination: WindowDestination, from source: WindowNavigation, fallback: @escaping () -> Void) {
        let launch = windowLaunch(destination, source: source)
        let text = "Otwieranie nowego okna…"
        inWindow(source) { pending = text }
        Task { [weak self] in
            let result = await WindowProcess.spawn(launch)
            var started = false
            if case .success(let pid) = result {
                _ = await WindowProcess.waitUntilShown(launch.token, pid: pid)
                started = true
            }
            guard let self else { return }
            if self.pending == text { self.pending = nil }
            guard !started else { return }
            fallback()
            self.notice = "Nie udało się uruchomić osobnego procesu — nowe okno działa w tym samym procesie."
        }
    }

    /// Karta wyciągnięta do osobnego okna: ten sam widok w osobnym procesie, potem to okno się zamyka. Nieudane uruchomienie —
    /// okno zostaje w tym procesie.
    func moveToOwnProcess(_ nav: WindowNavigation) {
        guard !nav.movingToProcess, let window = nav.window, WindowProcess.available(self) else { return }
        nav.movingToProcess = true
        let launch = windowLaunch(moving: nav, window: window)
        let text = "Przenoszenie okna do osobnego procesu…"
        inWindow(nav) { pending = text }
        Task { [weak self, weak nav, weak window] in
            let result = await WindowProcess.spawn(launch)
            var moved = false
            if case .success(let pid) = result { moved = await WindowProcess.waitUntilShown(launch.token, pid: pid) }
            guard let self else { return }
            if self.pending == text { self.pending = nil }
            if moved { window?.close(); return }
            nav?.movingToProcess = false
            self.notice = "Nie udało się uruchomić osobnego procesu — okno działa dalej w tym procesie."
        }
    }

    /// Okno w osobnym procesie: widok z argumentu uruchomienia — gdy jest pracownik i menu (pozycje paska bocznego); `final` —
    /// po odświeżeniu, także bez menu (wtedy zostaje Dashboard).
    func applyWindowLaunch(final: Bool) {
        guard let launch = AppInstance.launch, !windowLaunchApplied, employee != nil else { return }
        if launch.href != nil && navigation.isEmpty && !final { return }
        windowLaunchApplied = true
        let nav = windowNavigations.first ?? activeNavigation
        inWindow(nav) {
            if let id = launch.eventID {
                if employee?.canView(.events) == true { switchSection(.events) }
                showEvent(id, cardTab: launch.eventTab)
            } else if let id = launch.employeeID {
                showEmployee(id)
            } else if let href = launch.href {
                openHref(href)
            }
        }
        if let raw = launch.financePart, let part = FinancePart(rawValue: raw) { finance.part = part }
        if let raw = launch.financeList, let list = FinDeadlinesList(rawValue: raw) { finance.list = list }
    }

    /// Pierwsze okno procesu okna: położenie, pełny ekran, ogłoszenie gotowości (proces źródłowy zdejmuje postęp i — przy
    /// wyciągniętej karcie — zamyka swoje okno).
    func prepareProcessWindow(_ window: NSWindow, _ launch: WindowLaunch) {
        if let values = launch.frame, values.count == 4, values[2] > 200, values[3] > 200 {
            let wanted = NSRect(x: values[0], y: values[1], width: values[2], height: values[3])
            let screen = NSScreen.screens.first { $0.visibleFrame.intersects(wanted) } ?? window.screen ?? NSScreen.main
            window.setFrame(window.constrainFrameRect(wanted, to: screen), display: true)
        }
        if launch.fullScreen {
            window.collectionBehavior.insert(.fullScreenPrimary)
            Task { @MainActor [weak window] in
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard let window, window.isVisible, !window.styleMask.contains(.fullScreen) else { return }
                window.toggleFullScreen(nil)
            }
        }
        let token = launch.token
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            AppInstance.post(.shown, token)
        }
    }
}
