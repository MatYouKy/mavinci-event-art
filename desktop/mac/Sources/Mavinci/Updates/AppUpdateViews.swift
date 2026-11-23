import AppKit
import SwiftUI

// MARK: Aktualizacje aplikacji — Ustawienia → Oprogramowanie, stopka paska bocznego i pozycje menu (`AppUpdater.swift`)
//
// Nowa wersja z `yarn dmg` → „Nowa wersja …” w stopce paska bocznego (pod nazwiskiem pracownika, przy stanie połączenia);
// kliknięcie otwiera okno Ustawień na zakładce „Oprogramowanie”: wersja zainstalowana i dostępna, co nowego, pobranie z postępem,
// instalacja z ponownym uruchomieniem, instalator DMG i kroki instalacji. „Sprawdź aktualizacje…” (menu Mavinci i pasek menu)
// otwiera tę samą zakładkę. Dawny pasek nad treścią okna nachodził na nagłówki sekcji (np. przełącznik widoku Spotkań) — usunięty.

private let updateDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "pl_PL")
    formatter.dateStyle = .long
    formatter.timeStyle = .short
    return formatter
}()

/// „dzisiaj, 10:12”, „wczoraj, 18:40”, „21 lis 2026, 9:05”.
private let checkDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "pl_PL")
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.doesRelativeDateFormatting = true
    return formatter
}()

private func publishedText(_ value: String?) -> String? {
    guard let value else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    return date.map { updateDate.string(from: $0) }
}

private func megabytes(_ bytes: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
}

/// Stopka paska bocznego: nowa wersja (pobieranie, gotowa do instalacji) — kliknięcie otwiera Ustawienia → Oprogramowanie.
struct SidebarUpdateBadge: View {
    @ObservedObject var updater: AppUpdater
    @Environment(\.openSettings) private var openSettings
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let release = updater.available {
            Button { SettingsTab.show(.software, openSettings) } label: {
                HStack(spacing: 8) {
                    Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title(release)).font(.caption.weight(.semibold)).lineLimit(1)
                        Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .help("Mavinci \(release.version) — Ustawienia → Oprogramowanie: co nowego i instalacja")
            .accessibilityLabel("\(title(release)). \(subtitle)")
        }
    }

    private var symbol: String {
        switch updater.phase {
        case .ready: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        default: return "arrow.down.circle.fill"
        }
    }

    private func title(_ release: AppRelease) -> String {
        switch updater.phase {
        case .ready: return "Aktualizacja gotowa"
        case .downloading(let value): return "Pobieranie… \(Int(value * 100))%"
        case .restarting: return "Instalowanie…"
        default: return "Nowa wersja \(release.version)"
        }
    }

    private var subtitle: String {
        switch updater.phase {
        case .ready: return "Zainstaluj i uruchom ponownie"
        case .downloading, .restarting: return "Szczegóły w Ustawieniach"
        case .failed: return "Problem z instalacją — szczegóły"
        default: return "Zobacz i zainstaluj"
        }
    }
}

/// Ustawienia → Oprogramowanie: wersje, co nowego, pobranie i instalacja, instalator DMG i kroki instalacji.
struct SoftwareSettings: View {
    @EnvironmentObject private var state: Workspace
    @ObservedObject var updater: AppUpdater
    @Environment(\.crmTheme) private var theme

    private var release: AppRelease? { updater.available }
    private var signedIn: Bool { state.employee != nil }

    var body: some View {
        Form {
            Section("Mavinci na tym Macu") {
                HStack(alignment: .top, spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage).resizable().interpolation(.high)
                        .frame(width: 52, height: 52).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(headline).font(.title3.weight(.semibold))
                        Text("Zainstalowana: \(AppUpdateSupport.currentVersion) (\(AppUpdateSupport.currentBuild))").foregroundStyle(.secondary)
                        if let release {
                            Text("Nowa: \(release.version) (\(release.build))" + (publishedText(release.publishedAt).map { " · \($0)" } ?? ""))
                            Text("Pobranie: \(megabytes(release.size))").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text(currentStatus).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                if let error = updater.checkError {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    if updater.phase == .checking { ProgressView().controlSize(.small) }
                    Spacer()
                    Button("Sprawdź teraz") { Task { await updater.check(manual: true) } }
                        .disabled(!signedIn || updater.busy)
                }
            }
            if let release {
                if !release.notes.isEmpty {
                    Section("Co nowego w wersji \(release.version)") {
                        Text(release.notes).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                    }
                }
                Section("Instalacja") {
                    if showsProgress { progress }
                    if let blocker = updater.installBlocker {
                        Label(blocker, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack {
                        Button("Pobierz instalator (DMG)") { Task { await updater.openInstaller() } }.disabled(updater.busy)
                        Spacer()
                        if updater.phase == .ready {
                            Button("Zainstaluj i uruchom ponownie") { updater.installAndRestart() }.buttonStyle(.borderedProminent)
                        } else {
                            Button("Pobierz aktualizację") { Task { await updater.download() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(updater.busy || updater.installBlocker != nil)
                        }
                    }
                }
                Section("Jak zainstalować") {
                    if updater.installBlocker == nil {
                        steps("W aplikacji (zalecane)", [
                            "Kliknij „Pobierz aktualizację” — Mavinci pobierze nową wersję i sprawdzi jej podpis (zespół Mavinci).",
                            "Zapisz otwarte zmiany i kliknij „Zainstaluj i uruchom ponownie” — aplikacja zamknie się na kilka sekund i uruchomi już w nowej wersji.",
                        ])
                    }
                    steps(updater.installBlocker == nil ? "Z instalatora (DMG)" : "Z instalatora (DMG) — dla tej kopii aplikacji", [
                        "Kliknij „Pobierz instalator (DMG)” — otworzy się okno instalatora Mavinci.",
                        "Zamknij Mavinci (Mavinci → Zakończ albo ⌘Q).",
                        "W oknie instalatora przeciągnij ikonę Mavinci na folder Aplikacje i wybierz „Zastąp”.",
                        "Uruchom Mavinci z folderu Aplikacje (albo Spotlight: ⌘Spacja, „Mavinci”).",
                        "Wysuń instalator — w Finderze przycisk ⏏ obok „Mavinci” na pasku bocznym.",
                    ])
                }
            } else {
                Section("Aktualizacje") {
                    Text("Mavinci sprawdza nowe wersje co godzinę. Gdy pojawi się nowa, zobaczysz ją w stopce paska bocznego, pod swoim nazwiskiem — kliknięcie otwiera tę zakładkę z opisem zmian i krokami instalacji.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        // Otwarcie zakładki sprawdza wersję, gdy ostatnie sprawdzenie było ponad 10 minut temu.
        .task {
            if signedIn, !updater.busy, updater.stale(after: 10 * 60) { await updater.check(manual: true) }
        }
    }

    private var headline: String {
        if let release { return "Dostępna nowa wersja Mavinci \(release.version)" }
        return "Mavinci \(AppUpdateSupport.currentVersion)"
    }

    private var currentStatus: String {
        if updater.phase == .checking { return "Sprawdzanie wersji…" }
        if !signedIn { return "Zaloguj się, aby sprawdzić aktualizacje." }
        if let last = updater.lastCheck { return "Masz najnowszą wersję · sprawdzono \(checkDate.string(from: last))" }
        return "Wersja nie była jeszcze sprawdzana."
    }

    private var showsProgress: Bool {
        switch updater.phase {
        case .downloading, .ready, .restarting, .failed: return true
        case .idle, .checking: return false
        }
    }

    @ViewBuilder private var progress: some View {
        switch updater.phase {
        case .downloading(let value):
            ProgressView(value: value) {
                Text(value >= 1 ? "Sprawdzanie podpisu i przygotowanie instalacji…" : "Pobieranie… \(Int(value * 100))%")
            }
        case .ready:
            Label("Aktualizacja pobrana i sprawdzona. Mavinci zamknie się na chwilę i uruchomi w nowej wersji — zapisz otwarte zmiany.", systemImage: "checkmark.seal")
                .foregroundStyle(theme.accent).fixedSize(horizontal: false, vertical: true)
        case .restarting:
            Label("Instalowanie — Mavinci uruchomi się ponownie za chwilę…", systemImage: "arrow.clockwise")
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
        case .idle, .checking:
            EmptyView()
        }
    }

    /// Numerowane kroki instalacji.
    private func steps(_ title: String, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout.weight(.semibold))
            ForEach(Array(items.enumerated()), id: \.offset) { index, text in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(index + 1).").monospacedDigit().foregroundStyle(theme.accent).frame(width: 18, alignment: .trailing)
                    Text(text).fixedSize(horizontal: false, vertical: true)
                }
                .font(.callout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Mavinci → „Sprawdź aktualizacje…”: Ustawienia → Oprogramowanie i sprawdzenie wersji.
struct CheckUpdatesCommand: View {
    @ObservedObject var updater: AppUpdater
    let signedIn: Bool
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Button("Sprawdź aktualizacje…") {
            SettingsTab.show(.software, openSettings)
            Task { await updater.check(manual: true) }
        }
        .disabled(!signedIn || updater.busy)
    }
}

/// Pozycje aktualizacji na pasku menu (stan w `AppUpdater`); `show` — Ustawienia → Oprogramowanie.
struct AppUpdateMenuItems: View {
    @ObservedObject var updater: AppUpdater
    let signedIn: Bool
    let show: () -> Void

    var body: some View {
        if let release = updater.available {
            if updater.phase == .ready {
                Button("Zainstaluj Mavinci \(release.version) i uruchom ponownie") { updater.installAndRestart() }
            } else if case .downloading(let value) = updater.phase {
                Text("Pobieranie aktualizacji… \(Int(value * 100))%")
            } else {
                Button("Dostępna wersja \(release.version) — szczegóły…", action: show)
            }
        }
        Button("Sprawdź aktualizacje") {
            show()
            Task { await updater.check(manual: true) }
        }
        .disabled(!signedIn || updater.busy)
    }
}
