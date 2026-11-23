import Foundation
import WidgetKit

// MARK: Widżety Mavinci („Moje zadania”, „Zadania prywatne”, „Kalendarz”, „Spotkania”) — po stronie aplikacji
//
// Widżety to rozszerzenie `MavinciWidgets.appex` w pakiecie (budowane razem z rozszerzeniem Findera — podpis zespołu Mavinci).
// Dane pobierają same, ze wspólną sesją z kontenera grupy (`FinderShared`), więc działają też przy zamkniętej aplikacji.
// Aplikacja po zalogowaniu zgłasza rozszerzenie systemowi (`pluginkit -a` — galeria widżetów widzi je także wtedy, gdy aplikacja
// nie jest w folderze Aplikacje) i prosi o odświeżenie widżetów po zmianach: zadań i licznika czasu (`TasksStore`), spotkań
// (`MeetingsStore` — także zmiany z CRM po synchronizacji), planu dnia (`Workspace.loadSchedule`) i po wylogowaniu.
// Kliknięcie widżetu: `mavinci://tasks`, `mavinci://calendar`, `mavinci://meetings`, pozycji — `mavinci://<rodzaj>/<id>`
// (`MavinciApp.onOpenURL`).
//
// Galeria widżetów: macOS pokazuje widżety jednej zarejestrowanej kopii rozszerzenia i pamięta ich listę (usługa `chronod`).
// Gdy na Macu jest kilka kopii aplikacji (folder Aplikacje, folder budowania, instalator), galeria mogła pokazywać starszą —
// bez nowych widżetów („Kalendarz”, „Spotkania”). Dlatego działająca kopia przy pierwszym uruchomieniu nowej wersji: zgłasza
// swoje rozszerzenie, wyrejestrowuje inne kopie i uruchamia ponownie `chronod` (galeria wczytuje widżety od nowa; widżety
// na pulpicie zostają). Ręcznie: pasek menu → „Odśwież widżety na pulpicie” (także odświeżenie Centrum powiadomień).

@MainActor
enum WidgetBridge {
    static let extensionName = WidgetRegistration.extensionName
    private static let registrationKey = "widgets.registration"
    private static var registered = false

    /// Aplikacja zbudowana z widżetami (podpis zespołem).
    static var bundled: Bool {
        guard let plugins = Bundle.main.builtInPlugInsURL else { return false }
        return FileManager.default.fileExists(atPath: plugins.appendingPathComponent(extensionName).path)
    }

    /// Rozszerzenie widżetów w tej kopii aplikacji.
    private static var extensionURL: URL? {
        guard let plugins = Bundle.main.builtInPlugInsURL else { return nil }
        let url = plugins.appendingPathComponent(extensionName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Ścieżka i numer kompilacji rozszerzenia — zmiana oznacza nową wersję (albo inną kopię aplikacji) do zgłoszenia galerii.
    private static func stamp(_ appex: URL) -> String {
        let info = NSDictionary(contentsOf: appex.appendingPathComponent("Contents/Info.plist"))
        return "\(appex.path)|\(info?["CFBundleVersion"] as? String ?? "")"
    }

    /// Po zalogowaniu (sesja jest już w kontenerze grupy): zgłoszenie rozszerzenia raz na uruchomienie i odświeżenie widżetów;
    /// pierwsze uruchomienie nowej wersji (albo innej kopii) — także porządek w galerii (inne kopie, `chronod`).
    static func activate() {
        guard bundled else { return }
        if !registered, let appex = extensionURL {
            registered = true
            let current = stamp(appex)
            let changed = UserDefaults.standard.string(forKey: registrationKey) != current
            Task.detached(priority: .utility) {
                let removed = WidgetRegistration.register(appex, resetGallery: changed, resetNotificationCenter: false)
                await MainActor.run {
                    UserDefaults.standard.set(current, forKey: registrationKey)
                    if changed || removed > 0 { reload() }
                }
            }
        }
        reload()
    }

    /// Pasek menu → „Odśwież widżety na pulpicie”: zgłoszenie tej kopii, bez innych kopii, galeria i Centrum powiadomień od nowa.
    static func refreshGallery() async -> String {
        guard let appex = extensionURL else {
            return "Ta kopia Mavinci nie ma widżetów — buduje je tylko kompilacja z podpisem zespołu Mavinci (yarn build:mac, yarn dmg)."
        }
        let current = stamp(appex)
        let removed = await Task.detached(priority: .userInitiated) {
            WidgetRegistration.register(appex, resetGallery: true, resetNotificationCenter: true)
        }.value
        UserDefaults.standard.set(current, forKey: registrationKey)
        reload()
        let others = removed > 0 ? " Usunięto z galerii starsze kopie Mavinci (\(removed))." : ""
        return "Widżety Mavinci zgłoszone od nowa.\(others) Otwórz galerię: prawy przycisk na pulpicie → „Edytuj widżety…” → „Mavinci”."
    }

    /// Dane zmienione w aplikacji (albo wylogowanie) — widżety pobierają je od razu, bez czekania na swój harmonogram.
    static func reload() {
        guard bundled else { return }
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Rejestracja rozszerzenia widżetów (`pluginkit`) i odświeżenie galerii — poza wątkiem głównym (czeka na narzędzia systemu).
enum WidgetRegistration {
    static let extensionName = "MavinciWidgets.appex"
    static let extensionID = "pl.mavinci.desktop.Widgets"

    /// Zgłasza `appex`, wyrejestrowuje inne kopie tego rozszerzenia; `resetGallery` — `chronod` od nowa (lista widżetów w galerii),
    /// `resetNotificationCenter` — także Centrum powiadomień (galeria). Zwraca liczbę usuniętych kopii.
    @discardableResult
    static func register(_ appex: URL, resetGallery: Bool, resetNotificationCenter: Bool) -> Int {
        run("/usr/bin/pluginkit", ["-a", appex.path])
        let mine = appex.resolvingSymlinksInPath().standardizedFileURL.path
        var removed = 0
        for path in registeredPaths() where URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path != mine {
            run("/usr/bin/pluginkit", ["-r", path])
            removed += 1
        }
        if resetGallery || removed > 0 { run("/usr/bin/killall", ["chronod"]) }
        if resetNotificationCenter { run("/usr/bin/killall", ["NotificationCenter"]) }
        return removed
    }

    /// Ścieżki wszystkich zarejestrowanych kopii rozszerzenia (`pluginkit -mAv -i …` — ścieżka `.appex` na końcu wiersza).
    static func registeredPaths() -> [String] {
        let listing = output("/usr/bin/pluginkit", ["-m", "-A", "-v", "-i", extensionID])
        var paths: [String] = []
        for line in listing.split(whereSeparator: \.isNewline) {
            guard let start = line.firstIndex(of: "/"), line.hasSuffix(".appex") else { continue }
            let path = String(line[start...]).trimmingCharacters(in: .whitespaces)
            if path.hasSuffix("/" + extensionName), !paths.contains(path) { paths.append(path) }
        }
        return paths
    }

    private static func run(_ tool: String, _ arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            NSLog("[Mavinci Widget] %@: %@", tool, error.localizedDescription)
        }
    }

    private static func output(_ tool: String, _ arguments: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }
}

extension Workspace {
    /// Widżet „Kalendarz” (`mavinci://calendar`): kalendarz, a bez dostępu do niego — Dashboard z planem dnia.
    func showCalendarFromWidget() {
        if employee?.canView(.calendar) == true { switchSection(.calendar) } else { switchSection(.day) }
    }

    /// Widżet „Spotkania” (`mavinci://meetings`): ekran Spotkań (pozycja menu CRM), a bez niego — kalendarz.
    func showMeetingsFromWidget() {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/meetings" }) { openHref("/crm/meetings") }
        else { showCalendarFromWidget() }
    }
}
