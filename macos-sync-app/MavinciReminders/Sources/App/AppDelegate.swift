import AppKit
import SwiftUI
import Darwin

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    private var lockDescriptor: Int32 = -1
    private var onboardingWindow: NSWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Lock shared Application Support, not a binary path (copies of the app must also contend).
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciReminders", isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        catch { NSApp.terminate(nil); return }
        lockDescriptor = open(directory.appendingPathComponent("sync.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard lockDescriptor >= 0, flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else {
            NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.accessory)
        SyncManager.shared.startupAllowed = true
        LoginItemManager.shared.configureDefault()
        // Only SwiftUI owns the menu item. No second NSStatusItem and no 5-second UI polling.
        Task {
            _ = await SyncManager.shared.requestRemindersAccess()
            if UserDefaults.standard.bool(forKey: "onboardingCompleted") {
                startSync()
            } else { showOnboarding() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(didWake),
                                                          name: NSWorkspace.didWakeNotification, object: nil)
    }

    private func startSync() {
        let minutes = max(1, UserDefaults.standard.integer(forKey: "syncIntervalMinutes"))
        SyncManager.shared.startPeriodicSync(interval: TimeInterval(minutes * 60))
    }
    @objc private func didWake() {
        Task { await SyncManager.shared.syncNow() }
    }
    private func showOnboarding() {
        let controller = NSHostingController(rootView: OnboardingView { [weak self] in
            self?.onboardingWindow?.close()
            self?.onboardingWindow = nil
            self?.startSync()
        })
        let window = NSWindow(contentViewController: controller)
        window.title = "Konfiguracja Mavinci Sync"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        onboardingWindow = NSWindowController(window: window)
        NSApp.activate(ignoringOtherApps: true)
        onboardingWindow?.showWindow(nil)
    }
    func applicationWillTerminate(_ notification: Notification) {
        SyncManager.shared.stopPeriodicSync()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        if lockDescriptor >= 0 { close(lockDescriptor) }
    }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}
