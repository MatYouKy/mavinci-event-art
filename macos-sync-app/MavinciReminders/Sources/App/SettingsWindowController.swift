import AppKit
import SwiftUI

/// A retained window avoids depending on responder-chain settings selectors
/// in an accessory/menu-bar-only app. Closing it must not stop synchronization.
@MainActor
final class SettingsWindowController {
    static let shared = SettingsWindowController()
    private var controller: NSWindowController?

    private init() {}

    func show(viewModel: SettingsViewModel) {
        if controller == nil {
            let host = NSHostingController(rootView: SettingsView(viewModel: viewModel))
            let window = NSWindow(contentViewController: host)
            window.title = "Ustawienia — Mavinci Reminders"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.isReleasedWhenClosed = false
            window.setContentSize(NSSize(width: 660, height: 580))
            window.center()
            controller = NSWindowController(window: window)
        }
        guard let controller, let window = controller.window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        NSApp.activate(ignoringOtherApps: true)
        controller.showWindow(nil)
        window.makeKeyAndOrderFront(nil)
    }
}
