import AppKit

// MARK: Pełny ekran przy uruchomieniu
//
// Pierwsze okno obszaru roboczego po starcie aplikacji przechodzi na pełny ekran (osobne biurko macOS, jak zielony przycisk
// okna). Ustawienie „Otwieraj na pełnym ekranie” (Ustawienia → Wygląd) — domyślnie włączone. Kolejne okna i karty otwierają
// się bez zmian; okno, które macOS odtworzył już na pełnym ekranie, zostaje na nim. Okno w osobnym procesie przejmuje pełny
// ekran od okna, z którego je otwarto (`WindowProcess.swift`), a nie z tego ustawienia.

@MainActor
enum LaunchFullScreen {
    /// Klucz ustawienia w `UserDefaults` (także `@AppStorage` w Ustawieniach).
    static let key = "openFullScreenOnLaunch"
    private static var handled = false

    static var enabled: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }

    /// Wywoływane przy pierwszym podpięciu okna obszaru roboczego (`Workspace.attach`).
    static func apply(to window: NSWindow) {
        guard !handled, !AppInstance.isSecondary else { return }
        handled = true
        guard enabled else { return }
        window.collectionBehavior.insert(.fullScreenPrimary)
        // Po ułożeniu okna i ewentualnym odtworzeniu stanu przez macOS — żeby nie wyjść z pełnego ekranu, który już jest.
        Task { @MainActor [weak window] in
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard let window, window.isVisible, !window.styleMask.contains(.fullScreen) else { return }
            window.toggleFullScreen(nil)
        }
    }
}
