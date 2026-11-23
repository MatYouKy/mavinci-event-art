import AppKit
import SwiftUI

// MARK: Okno Ustawień (⌘,, zębatka w stopce paska bocznego)
//
// Zakładki: „Wygląd” (`Theme.swift`), „Oprogramowanie” (wersja, nowe wydania z `yarn dmg`, instalacja — `Updates/AppUpdateViews.swift`)
// i — tylko w kompilacji deweloperskiej (Mavinci-Dev, `swift build -c debug`) — „Połączenie” do testów z innym serwerem.
// Zainstalowana aplikacja ma połączenie wbudowane w program (`EmbeddedConnection.swift`) i nie pokazuje go nigdzie.
// Wybrana zakładka jest zapamiętana; stopka paska bocznego, menu Mavinci i pasek menu otwierają okno od razu na „Oprogramowaniu”.

enum SettingsTab: String {
    case appearance, software, connection

    /// Klucz bez kropek — `@AppStorage` widzi wtedy zmianę zapisaną z innego miejsca (KVO), także przy otwartym oknie.
    static let storageKey = "mavinciSettingsTab"

    #if DEBUG
    static let visible: [SettingsTab] = [.appearance, .software, .connection]
    #else
    static let visible: [SettingsTab] = [.appearance, .software]
    #endif

    /// Okno Ustawień na wskazanej zakładce (na wierzchu, także gdy aplikacja była w tle — np. z paska menu).
    @MainActor static func show(_ tab: SettingsTab, _ openSettings: OpenSettingsAction) {
        UserDefaults.standard.set(tab.rawValue, forKey: storageKey)
        NSApp.activate()
        openSettings()
    }
}

struct SettingsTabs: View {
    @ObservedObject var updater: AppUpdater
    @AppStorage(SettingsTab.storageKey) private var stored = SettingsTab.appearance.rawValue

    /// Zapamiętana zakładka, której w tej kompilacji nie ma (np. „Połączenie” po kompilacji deweloperskiej) → „Wygląd”.
    private var selection: Binding<SettingsTab> {
        Binding(
            get: { SettingsTab(rawValue: stored).flatMap { SettingsTab.visible.contains($0) ? $0 : nil } ?? .appearance },
            set: { stored = $0.rawValue }
        )
    }

    var body: some View {
        TabView(selection: selection) {
            AppearanceSettings()
                .tabItem { Label("Wygląd", systemImage: "paintpalette") }
                .tag(SettingsTab.appearance)
            SoftwareSettings(updater: updater)
                .tabItem { Label("Oprogramowanie", systemImage: "arrow.down.app") }
                .tag(SettingsTab.software)
            #if DEBUG
            ConnectionView()
                .tabItem { Label("Połączenie", systemImage: "network") }
                .tag(SettingsTab.connection)
            #endif
        }
    }
}
