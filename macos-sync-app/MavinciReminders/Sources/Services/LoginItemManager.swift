import Foundation
import Combine
import ServiceManagement

@MainActor
final class LoginItemManager: ObservableObject {
    static let shared = LoginItemManager()
    @Published var enabled = SMAppService.mainApp.status == .enabled
    @Published var message = ""
    func refresh() {
        enabled = SMAppService.mainApp.status == .enabled
        if SMAppService.mainApp.status == .requiresApproval {
            message = "Zatwierdź Mavinci Sync w Ustawieniach systemowych → Ogólne → Elementy logowania."
        } else if enabled { message = "Aplikacja uruchamia się przy logowaniu do macOS." }
    }
    func configureDefault() {
        UserDefaults.standard.register(defaults: ["syncIntervalMinutes": 5])
        if !UserDefaults.standard.bool(forKey: "loginItemConfiguredV2") {
            setEnabled(true)
            if SMAppService.mainApp.status == .enabled || SMAppService.mainApp.status == .requiresApproval {
                UserDefaults.standard.set(true, forKey: "loginItemConfiguredV2")
            }
        }
        refresh()
    }
    func setEnabled(_ value: Bool) {
        do {
            if value {
                if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
            } else { try SMAppService.mainApp.unregister() }
            UserDefaults.standard.set(value, forKey: "launchAtLogin")
            refresh()
        } catch {
            enabled = SMAppService.mainApp.status == .enabled
            message = "Nie udało się zmienić autostartu. Zainstaluj podpisaną aplikację .app w folderze Aplikacje. \(error.localizedDescription)"
        }
    }
    func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
