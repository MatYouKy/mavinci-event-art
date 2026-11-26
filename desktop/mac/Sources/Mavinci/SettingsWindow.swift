import AppKit
import SwiftUI

// MARK: Okno Ustawień (⌘,, zębatka w stopce paska bocznego)
//
// Zakładki: „Wygląd” (`Theme.swift`), „Oprogramowanie” (wersja, nowe wydania z `yarn dmg`, instalacja — `Updates/AppUpdateViews.swift`),
// „Tryb testowy” (tylko administrator i w trakcie trybu — widok pracownika, `TestMode/TestMode.swift`) i — tylko w kompilacji
// deweloperskiej (Mavinci-Dev, `swift build -c debug`) — „Połączenie” do testów z innym serwerem.
// Zainstalowana aplikacja ma połączenie wbudowane w program (`EmbeddedConnection.swift`) i nie pokazuje go nigdzie.
// Wybrana zakładka jest zapamiętana; stopka paska bocznego, menu Mavinci i pasek menu otwierają okno od razu na „Oprogramowaniu”.

enum SettingsTab: String {
    case appearance, software, testMode, connection

    /// Klucz bez kropek — `@AppStorage` widzi wtedy zmianę zapisaną z innego miejsca (KVO), także przy otwartym oknie.
    static let storageKey = "mavinciSettingsTab"

    /// Zakładki tej kompilacji; „Tryb testowy” — dla administratora i w trakcie trybu testowego (wyjście z trybu).
    @MainActor static func visible(for state: Workspace) -> [SettingsTab] {
        var tabs: [SettingsTab] = [.appearance, .software]
        if state.employee?.isAdmin == true || state.testMode != nil { tabs.append(.testMode) }
        #if DEBUG
        tabs.append(.connection)
        #endif
        return tabs
    }

    /// Okno Ustawień na wskazanej zakładce (na wierzchu, także gdy aplikacja była w tle — np. z paska menu).
    @MainActor static func show(_ tab: SettingsTab, _ openSettings: OpenSettingsAction) {
        UserDefaults.standard.set(tab.rawValue, forKey: storageKey)
        NSApp.activate()
        openSettings()
    }
}

struct SettingsTabs: View {
    @EnvironmentObject private var state: Workspace
    @ObservedObject var updater: AppUpdater
    @AppStorage(SettingsTab.storageKey) private var stored = SettingsTab.appearance.rawValue

    /// Zapamiętana zakładka, której teraz nie ma (np. „Połączenie” po kompilacji deweloperskiej, „Tryb testowy” po wylogowaniu
    /// administratora) → „Wygląd”.
    private var selection: Binding<SettingsTab> {
        let tabs = SettingsTab.visible(for: state)
        return Binding(
            get: { SettingsTab(rawValue: stored).flatMap { tabs.contains($0) ? $0 : nil } ?? .appearance },
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
            if SettingsTab.visible(for: state).contains(.testMode) {
                TestModeSettings()
                    .tabItem { Label("Tryb testowy", systemImage: "testtube.2") }
                    .tag(SettingsTab.testMode)
            }
            #if DEBUG
            ConnectionView()
                .tabItem { Label("Połączenie", systemImage: "network") }
                .tag(SettingsTab.connection)
            #endif
        }
    }
}
