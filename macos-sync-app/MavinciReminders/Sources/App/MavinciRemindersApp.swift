import SwiftUI
import EventKit
import ServiceManagement

// MARK: - Main App Entry Point

@main
@MainActor
struct MavinciRemindersApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var syncManager = SyncManager.shared
    @StateObject private var settingsViewModel = SettingsViewModel()

    var body: some Scene {
        // Menu Bar Extra
        MenuBarExtra {
            MenuBarView(syncManager: syncManager, openSettings: {
                SettingsWindowController.shared.show(viewModel: settingsViewModel)
            })
        } label: {
            Label {
                Text("Mavinci Reminders")
            } icon: {
                Image(nsImage: MenuBarSignet.image)
                    .renderingMode(.template)
            }
            .accessibilityLabel("Mavinci Reminders — \(menuBarStatus)")
            .help("Mavinci Reminders — \(menuBarStatus)")
        }
        .menuBarExtraStyle(.menu)

        // SettingsWindowController owns one reusable window, including on macOS 13.
    }

    // MARK: - Menu Bar Icon State

    private var menuBarStatus: String {
        if syncManager.isSyncing {
            return "Synchronizacja w toku"
        }

        if syncManager.errorCount > 0 {
            return "Błędy synchronizacji"
        }

        if syncManager.isPaused {
            return "Synchronizacja wstrzymana"
        }

        return syncManager.isConnected ? "Połączono" : "Brak połączenia"
    }
}

// MARK: - Menu Bar View (SwiftUI Menu Content)

@MainActor
struct MenuBarView: View {
    @ObservedObject var syncManager: SyncManager
    let openSettings: () -> Void

    var body: some View {
        // Connection Status
        HStack {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusText)
        }

        Divider()

        // Sync Info
        if let lastSync = syncManager.lastSyncDate {
            Text("Ostatnia udana synchronizacja: \(lastSync, formatter: Self.relativeDateFormatter)")
                .font(.caption)
        } else {
            Text("Brak udanej synchronizacji")
                .font(.caption)
        }

        if !syncManager.syncedEmployeeName.isEmpty {
            Text("Konto: \(syncManager.syncedEmployeeName)")
        }
        Text(syncManager.hasLoadedPersonalTasks ? "Moje aktywne zadania: \(syncManager.activeRemindersCount)" : "Moje zadania: nie odczytano listy")
            .font(.caption)

        if syncManager.errorCount > 0 {
            Text("Błędy: \(syncManager.errorCount)")
                .font(.caption)
                .foregroundColor(.red)
        }
        if syncManager.lastError != nil || syncManager.errorCount > 0 {
            Button("Pokaż błąd synchronizacji…") {
                showSyncError()
            }
        }

        Divider()

        // Actions
        Button("Synchronizuj teraz") {
            Task {
                await syncManager.syncNow()
            }
        }
        .disabled(syncManager.isSyncing || syncManager.isPaused)
        .keyboardShortcut("s", modifiers: [.command, .shift])

        Button("Otwórz CRM Mavinci") {
            openMavinciCRM()
        }
        .keyboardShortcut("o", modifiers: [.command])

        Button("Otwórz Przypomnienia") {
            openRemindersApp()
        }

        Divider()

        // Toggle Pause
        Button(syncManager.isPaused ? "Wznów synchronizację" : "Wstrzymaj synchronizację") {
            syncManager.togglePause()
        }
        .keyboardShortcut("p", modifiers: [.command])

        Button("Ustawienia…") {
            openSettings()
        }
        .keyboardShortcut(",", modifiers: [.command])

        Divider()

        Text("Wersja \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")")
        Button("Zakończ Mavinci Reminders") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q", modifiers: [.command])
    }

    // MARK: - Status Helpers

    private var statusColor: Color {
        if syncManager.isPaused {
            return .yellow
        }
        if syncManager.errorCount > 0 {
            return .red
        }
        if syncManager.isConnected {
            return .green
        }
        return .gray
    }

    private var statusText: String {
        if syncManager.isSyncing {
            return "Synchronizacja…"
        }
        if syncManager.isPaused {
            return "Wstrzymano"
        }
        if syncManager.errorCount > 0 {
            return "Wystąpił błąd synchronizacji"
        }
        if syncManager.isConnected {
            return "Połączono"
        }
        return "Brak połączenia"
    }

    // MARK: - Actions

    private func showSyncError() {
        let message = syncManager.lastError ?? "Brak szczegółów ostatniego błędu. Sprawdź połączenie w Ustawieniach → Połączenie."
        let alert = NSAlert()
        alert.messageText = "Błąd synchronizacji"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Zamknij")
        alert.addButton(withTitle: "Kopiuj komunikat")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(message, forType: .string)
        }
    }

    private func openMavinciCRM() {
        let crmURL = CRMAPIClient.shared.baseURL
        if let url = URL(string: crmURL) {
            NSWorkspace.shared.open(url)
        }
    }

    private func openRemindersApp() {
        NSWorkspace.shared.open(URL(string: "x-apple-reminderkit://")!)
    }

    // MARK: - Date Formatter

    private static let relativeDateFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()
}

// MARK: - Settings View Model

@MainActor
class SettingsViewModel: ObservableObject {
    @Published var crmBaseURL: String {
        didSet { UserDefaults.standard.set(crmBaseURL, forKey: "crm_base_url") }
    }

    @Published var syncIntervalMinutes: Int {
        didSet { UserDefaults.standard.set(syncIntervalMinutes, forKey: "syncIntervalMinutes") }
    }

    @Published var launchAtLogin: Bool {
        didSet {
            UserDefaults.standard.set(launchAtLogin, forKey: "launchAtLogin")
            updateLoginItem()
        }
    }

    @Published var notificationsEnabled: Bool {
        didSet { UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled") }
    }

    init() {
        self.crmBaseURL = UserDefaults.standard.string(forKey: "crm_base_url") ?? "https://app.mavinci.com"
        self.syncIntervalMinutes = UserDefaults.standard.integer(forKey: "syncIntervalMinutes").clamped(to: 1...1440, default: 15)
        self.launchAtLogin = UserDefaults.standard.bool(forKey: "launchAtLogin")
        self.notificationsEnabled = UserDefaults.standard.bool(forKey: "notificationsEnabled")
    }

    private func updateLoginItem() {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            do {
                if launchAtLogin {
                    try service.register()
                } else {
                    try service.unregister()
                }
            } catch {
                print("[Settings] Login item update failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Settings View

// Full implementation in Sources/Views/SettingsView.swift

// MARK: - Int Extension

private extension Int {
    func clamped(to range: ClosedRange<Int>, default defaultValue: Int) -> Int {
        if self == 0 { return defaultValue }
        return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
