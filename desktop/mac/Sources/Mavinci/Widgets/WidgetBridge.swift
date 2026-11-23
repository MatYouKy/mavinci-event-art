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

@MainActor
enum WidgetBridge {
    static let extensionName = "MavinciWidgets.appex"
    private static var registered = false

    /// Aplikacja zbudowana z widżetami (podpis zespołem).
    static var bundled: Bool {
        guard let plugins = Bundle.main.builtInPlugInsURL else { return false }
        return FileManager.default.fileExists(atPath: plugins.appendingPathComponent(extensionName).path)
    }

    /// Po zalogowaniu (sesja jest już w kontenerze grupy): zgłoszenie rozszerzenia raz na uruchomienie i odświeżenie widżetów.
    static func activate() {
        guard bundled else { return }
        if !registered, let plugins = Bundle.main.builtInPlugInsURL {
            registered = true
            let path = plugins.appendingPathComponent(extensionName).path
            Task.detached(priority: .utility) {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/pluginkit")
                process.arguments = ["-a", path]
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                do {
                    try process.run()
                    process.waitUntilExit()
                } catch {
                    NSLog("[Mavinci Widget] pluginkit: %@", error.localizedDescription)
                }
            }
        }
        reload()
    }

    /// Dane zmienione w aplikacji (albo wylogowanie) — widżety pobierają je od razu, bez czekania na swój harmonogram.
    static func reload() {
        guard bundled else { return }
        WidgetCenter.shared.reloadAllTimelines()
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
