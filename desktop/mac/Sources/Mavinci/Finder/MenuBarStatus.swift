import AppKit
import ServiceManagement
import SwiftUI

// MARK: Ikona Mavinci na pasku menu
//
// Zastępuje dawną aplikację „Mavinci Reminders” (`macos-sync-app`): sygnet na pasku menu ze stanem połączenia i plików
// w Finderze, wersją aplikacji i skrótami — otwarcie okna, pliki w Finderze, synchronizacja, CRM w przeglądarce,
// uruchamianie przy logowaniu i zamknięcie.

struct MenuBarStatusMenu: View {
    @ObservedObject var workspace: Workspace
    @Environment(\.openWindow) private var openWindow
    @State private var finder: FinderDomain.Status?
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginItemError: String?

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Mavinci \(short) (\(build))"
    }

    private var who: String { workspace.employee?.displayName ?? "" }

    private var connectionText: String {
        guard workspace.employee != nil else { return "Niezalogowano" }
        if workspace.offline { return "Offline — kopia z dysku · \(who)" }
        if workspace.syncing { return "Synchronizacja… · \(who)" }
        return "Połączono · \(who)"
    }

    private var finderText: String {
        guard FinderDomain.available else { return "Pliki w Finderze: niedostępne w tej wersji" }
        switch finder {
        case .enabled: return "Pliki w Finderze: włączone"
        case .disabled: return "Pliki w Finderze: wyłączone — kliknij „Włącz” w Finderze"
        case .missing: return "Pliki w Finderze: po zalogowaniu"
        case .unavailable: return "Pliki w Finderze: niedostępne w tej wersji"
        case nil: return "Pliki w Finderze: „Mavinci” w pasku bocznym Findera"
        }
    }

    var body: some View {
        Group {
            Text(version)
            Text(connectionText)
            Text(finderText)
            Divider()
            Button("Otwórz Mavinci") { showMainWindow() }
            Button(finder == .disabled ? "Włącz pliki w Finderze…" : "Pliki w Finderze") {
                Task { await FinderDomain.reveal() }
            }
            .disabled(!FinderDomain.available || workspace.employee == nil)
            Button("Synchronizuj teraz") {
                Task {
                    await workspace.refresh(force: true)
                    FinderDomain.signal()
                }
            }
            .disabled(workspace.employee == nil || workspace.syncing)
            if let crm = workspace.connection.crm, let url = URL(string: crm + "/crm") {
                Button("Otwórz CRM w przeglądarce") { NSWorkspace.shared.open(url) }
            }
            Divider()
            Toggle("Uruchamiaj przy logowaniu", isOn: Binding(get: { launchAtLogin }, set: { setLaunchAtLogin($0) }))
            if let loginItemError { Text(loginItemError) }
            Divider()
            Button("Zakończ Mavinci") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        .task {
            finder = await FinderDomain.status()
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }

    private func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginItemError = nil
        } catch {
            loginItemError = "Nie udało się zmienić — Ustawienia systemowe → Ogólne → Rzeczy otwierane podczas logowania."
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    /// Okno aplikacji na wierzch — albo nowe, gdy zostało zamknięte (aplikacja działa dalej na pasku menu).
    private func showMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true && $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: "main")
        }
    }
}
