import SwiftUI
import EventKit
import ServiceManagement

// MARK: - Main App Entry Point

@main
struct MavinciRemindersApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var syncManager = SyncManager.shared
    @StateObject private var settingsViewModel = SettingsViewModel()

    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        // Menu Bar Extra
        MenuBarExtra {
            MenuBarView(syncManager: syncManager)
        } label: {
            Label("Mavinci Reminders", systemImage: menuBarIcon)
        }
        .menuBarExtraStyle(.menu)

        // Settings Window
        Settings {
            SettingsView(viewModel: settingsViewModel)
        }
    }

    // MARK: - Menu Bar Icon State

    private var menuBarIcon: String {
        if syncManager.isSyncing {
            return "arrow.triangle.2.circlepath"
        }

        if syncManager.errorCount > 0 {
            return "exclamationmark.circle"
        }

        if syncManager.isPaused {
            return "pause.circle"
        }

        return "checkmark.circle"
    }
}

// MARK: - Menu Bar View (SwiftUI Menu Content)

struct MenuBarView: View {
    @ObservedObject var syncManager: SyncManager

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
            Text("Last Sync: \(lastSync, formatter: Self.relativeDateFormatter)")
                .font(.caption)
        } else {
            Text("Never synced")
                .font(.caption)
        }

        Text("Active Reminders: \(syncManager.activeRemindersCount)")
            .font(.caption)

        if syncManager.errorCount > 0 {
            Text("⚠️ Errors: \(syncManager.errorCount)")
                .font(.caption)
                .foregroundColor(.red)
        }

        Divider()

        // Actions
        Button("Sync Now") {
            Task {
                await syncManager.syncNow()
            }
        }
        .disabled(syncManager.isSyncing || syncManager.isPaused)
        .keyboardShortcut("s", modifiers: [.command, .shift])

        Button("Open Mavinci CRM") {
            openMavinciCRM()
        }
        .keyboardShortcut("o", modifiers: [.command])

        Button("Open Reminders") {
            openRemindersApp()
        }

        Divider()

        // Toggle Pause
        Button(syncManager.isPaused ? "Resume Sync" : "Pause Sync") {
            syncManager.togglePause()
        }
        .keyboardShortcut("p", modifiers: [.command])

        Button("Settings…") {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        }
        .keyboardShortcut(",", modifiers: [.command])

        Divider()

        Button("Quit Mavinci Reminders") {
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
            return "Syncing…"
        }
        if syncManager.isPaused {
            return "Paused"
        }
        if syncManager.errorCount > 0 {
            return "Errors Detected"
        }
        if syncManager.isConnected {
            return "Connected"
        }
        return "Disconnected"
    }

    // MARK: - Actions

    private func openMavinciCRM() {
        let crmURL = UserDefaults.standard.string(forKey: "crmBaseURL") ?? "https://app.mavinci.com"
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
