import AppKit
import SwiftUI
import EventKit
import UserNotifications

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {

    // MARK: - Properties

    private var statusItem: NSStatusItem?
    private var syncManager: SyncManager { SyncManager.shared }
    private let eventStore = EKEventStore()

    private var syncObservation: NSKeyValueObservation?
    private var statusUpdateTimer: Timer?

    // MARK: - Application Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide dock icon — menu bar only app
        NSApp.setActivationPolicy(.accessory)

        // Setup status bar item with NSMenu fallback
        setupStatusItem()

        // Request Reminders access then run initial sync
        Task {
            await requestRemindersAccess()
            await performInitialSync()
        }

        // Start periodic status item updates
        startStatusUpdateTimer()

        print("[AppDelegate] Mavinci Reminders launched successfully")
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusUpdateTimer?.invalidate()
        statusUpdateTimer = nil
        print("[AppDelegate] Mavinci Reminders terminating")
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }

    // MARK: - Reminders Access

    private func requestRemindersAccess() async {
        do {
            let granted: Bool

            if #available(macOS 14.0, *) {
                granted = try await eventStore.requestFullAccessToReminders()
            } else {
                granted = try await eventStore.requestAccess(to: .reminder)
            }

            if granted {
                print("[AppDelegate] Reminders access granted")
                syncManager.remindersAccessGranted = true
            } else {
                print("[AppDelegate] Reminders access denied")
                syncManager.remindersAccessGranted = false
                await showAccessDeniedAlert()
            }
        } catch {
            print("[AppDelegate] Reminders access request failed: \(error.localizedDescription)")
            syncManager.remindersAccessGranted = false
        }
    }

    @MainActor
    private func showAccessDeniedAlert() {
        let alert = NSAlert()
        alert.messageText = "Reminders Access Required"
        alert.informativeText = """
            Mavinci Reminders needs access to Apple Reminders to sync your CRM tasks. \
            Please grant access in System Settings → Privacy & Security → Reminders.
            """
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    // MARK: - Initial Sync

    private func performInitialSync() async {
        guard syncManager.remindersAccessGranted else {
            print("[AppDelegate] Skipping initial sync — no Reminders access")
            return
        }

        print("[AppDelegate] Running initial sync…")
        await syncManager.syncNow()
    }

    // MARK: - Status Item Setup

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "checkmark.circle", accessibilityDescription: "Mavinci Reminders")
            button.image?.size = NSSize(width: 18, height: 18)
            button.toolTip = "Mavinci CRM Reminders"
        }

        updateStatusMenu()
    }

    // MARK: - Menu Construction

    private func updateStatusMenu() {
        let menu = NSMenu()
        menu.autoenablesItems = false

        // Connection Status Header
        let statusMenuItem = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        statusMenuItem.image = statusImage
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        // Sync Information
        let lastSyncItem = NSMenuItem(
            title: lastSyncText,
            action: nil,
            keyEquivalent: ""
        )
        lastSyncItem.isEnabled = false
        menu.addItem(lastSyncItem)

        let remindersCountItem = NSMenuItem(
            title: "Active Reminders: \(syncManager.activeRemindersCount)",
            action: nil,
            keyEquivalent: ""
        )
        remindersCountItem.isEnabled = false
        menu.addItem(remindersCountItem)

        if syncManager.errorCount > 0 {
            let errorsItem = NSMenuItem(
                title: "⚠️ Errors: \(syncManager.errorCount)",
                action: nil,
                keyEquivalent: ""
            )
            errorsItem.isEnabled = false
            menu.addItem(errorsItem)
        }

        menu.addItem(NSMenuItem.separator())

        // Sync Now
        let syncNowItem = NSMenuItem(
            title: "Sync Now",
            action: #selector(syncNowAction),
            keyEquivalent: "s"
        )
        syncNowItem.keyEquivalentModifierMask = [.command, .shift]
        syncNowItem.target = self
        syncNowItem.isEnabled = !syncManager.isSyncing && !syncManager.isPaused
        menu.addItem(syncNowItem)

        menu.addItem(NSMenuItem.separator())

        // Open Mavinci CRM
        let openCRMItem = NSMenuItem(
            title: "Open Mavinci CRM",
            action: #selector(openMavinciCRMAction),
            keyEquivalent: "o"
        )
        openCRMItem.keyEquivalentModifierMask = [.command]
        openCRMItem.target = self
        menu.addItem(openCRMItem)

        // Open Reminders
        let openRemindersItem = NSMenuItem(
            title: "Open Reminders",
            action: #selector(openRemindersAction),
            keyEquivalent: "r"
        )
        openRemindersItem.keyEquivalentModifierMask = [.command]
        openRemindersItem.target = self
        menu.addItem(openRemindersItem)

        menu.addItem(NSMenuItem.separator())

        // Pause / Resume Sync
        let pauseTitle = syncManager.isPaused ? "Resume Sync" : "Pause Sync"
        let pauseItem = NSMenuItem(
            title: pauseTitle,
            action: #selector(togglePauseAction),
            keyEquivalent: "p"
        )
        pauseItem.keyEquivalentModifierMask = [.command]
        pauseItem.target = self
        menu.addItem(pauseItem)

        // Settings
        let settingsItem = NSMenuItem(
            title: "Settings…",
            action: #selector(openSettingsAction),
            keyEquivalent: ","
        )
        settingsItem.keyEquivalentModifierMask = [.command]
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(
            title: "Quit Mavinci Reminders",
            action: #selector(quitAction),
            keyEquivalent: "q"
        )
        quitItem.keyEquivalentModifierMask = [.command]
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    // MARK: - Status Helpers

    private var statusTitle: String {
        if syncManager.isSyncing {
            return "Syncing…"
        }
        if syncManager.isPaused {
            return "Sync Paused"
        }
        if syncManager.errorCount > 0 {
            return "Errors Detected"
        }
        if syncManager.isConnected {
            return "Connected to Mavinci CRM"
        }
        return "Disconnected"
    }

    private var statusImage: NSImage? {
        let symbolName: String
        let tintColor: NSColor

        if syncManager.isSyncing {
            symbolName = "arrow.triangle.2.circlepath"
            tintColor = .systemBlue
        } else if syncManager.isPaused {
            symbolName = "pause.circle.fill"
            tintColor = .systemYellow
        } else if syncManager.errorCount > 0 {
            symbolName = "exclamationmark.triangle.fill"
            tintColor = .systemRed
        } else if syncManager.isConnected {
            symbolName = "circle.fill"
            tintColor = .systemGreen
        } else {
            symbolName = "circle"
            tintColor = .systemGray
        }

        let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)
        let config = NSImage.SymbolConfiguration(pointSize: 12, weight: .regular)
        let configured = image?.withSymbolConfiguration(config)

        // Apply tint via a copy
        let tinted = configured?.copy() as? NSImage
        tinted?.lockFocus()
        tintColor.set()
        let rect = NSRect(origin: .zero, size: tinted?.size ?? .zero)
        rect.fill(using: .sourceAtop)
        tinted?.unlockFocus()

        return tinted ?? configured
    }

    private var lastSyncText: String {
        guard let lastSync = syncManager.lastSyncDate else {
            return "Last Sync: Never"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        let relative = formatter.localizedString(for: lastSync, relativeTo: Date())
        return "Last Sync: \(relative)"
    }

    // MARK: - Menu Bar Icon Update

    private func updateMenuBarIcon() {
        guard let button = statusItem?.button else { return }

        let symbolName: String
        if syncManager.isSyncing {
            symbolName = "arrow.triangle.2.circlepath"
        } else if syncManager.errorCount > 0 {
            symbolName = "exclamationmark.circle"
        } else if syncManager.isPaused {
            symbolName = "pause.circle"
        } else {
            symbolName = "checkmark.circle"
        }

        button.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Mavinci Reminders")
        button.image?.size = NSSize(width: 18, height: 18)
    }

    // MARK: - Periodic Updates

    private func startStatusUpdateTimer() {
        statusUpdateTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateStatusMenu()
                self?.updateMenuBarIcon()
            }
        }
    }

    // MARK: - Menu Actions

    @objc private func syncNowAction() {
        Task {
            await syncManager.syncNow()
            DispatchQueue.main.async { [weak self] in
                self?.updateStatusMenu()
                self?.updateMenuBarIcon()
            }
        }
    }

    @objc private func openMavinciCRMAction() {
        let crmURL = UserDefaults.standard.string(forKey: "crmBaseURL") ?? "https://app.mavinci.com"
        if let url = URL(string: crmURL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func openRemindersAction() {
        if let url = URL(string: "x-apple-reminderkit://") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func togglePauseAction() {
        syncManager.togglePause()
        updateStatusMenu()
        updateMenuBarIcon()
    }

    @objc private func openSettingsAction() {
        // Open the SwiftUI Settings scene
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }

        // Use the standard Settings menu item approach
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }

    @objc private func quitAction() {
        NSApplication.shared.terminate(nil)
    }
}

// MARK: - SyncManager (Shared Singleton Stub)

/// Core sync manager — coordinates between CRM API and EventKit.
/// Full implementation lives in Sources/Sync/SyncManager.swift
class SyncManager: ObservableObject {
    static let shared = SyncManager()

    @Published var isSyncing: Bool = false
    @Published var isPaused: Bool = false
    @Published var isConnected: Bool = false
    @Published var lastSyncDate: Date? = nil
    @Published var activeRemindersCount: Int = 0
    @Published var errorCount: Int = 0
    @Published var remindersAccessGranted: Bool = false

    private var syncTimer: Timer?
    private var syncIntervalMinutes: Int {
        let stored = UserDefaults.standard.integer(forKey: "syncIntervalMinutes")
        return stored > 0 ? stored : 15
    }

    private init() {
        startPeriodicSync()
    }

    // MARK: - Sync Operations

    func syncNow() async {
        guard !isSyncing, !isPaused, remindersAccessGranted else { return }

        await MainActor.run {
            isSyncing = true
        }

        defer {
            Task { @MainActor in
                self.isSyncing = false
                self.lastSyncDate = Date()
            }
        }

        do {
            // TODO: Implement full CRM ↔ Reminders sync logic
            // 1. Fetch tasks from Mavinci CRM API
            // 2. Fetch existing reminders from EventKit
            // 3. Diff and reconcile
            // 4. Create/update/complete reminders
            // 5. Push completion status back to CRM

            try await Task.sleep(nanoseconds: 500_000_000) // Placeholder

            await MainActor.run {
                self.isConnected = true
                self.errorCount = 0
            }

            print("[SyncManager] Sync completed successfully")
        } catch {
            await MainActor.run {
                self.errorCount += 1
                self.isConnected = false
            }
            print("[SyncManager] Sync failed: \(error.localizedDescription)")
        }
    }

    func togglePause() {
        isPaused.toggle()

        if isPaused {
            syncTimer?.invalidate()
            syncTimer = nil
            print("[SyncManager] Sync paused")
        } else {
            startPeriodicSync()
            print("[SyncManager] Sync resumed")
        }
    }

    // MARK: - Periodic Sync

    private func startPeriodicSync() {
        syncTimer?.invalidate()
        let interval = TimeInterval(syncIntervalMinutes * 60)

        syncTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task {
                await self.syncNow()
            }
        }
    }
}
