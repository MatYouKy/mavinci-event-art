import AppKit
import SwiftUI

// MARK: Aktualizacje aplikacji — pasek w oknie, arkusz „Aktualizacja Mavinci” i pozycje na pasku menu (`AppUpdater.swift`)

private let updateDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "pl_PL")
    formatter.dateStyle = .long
    formatter.timeStyle = .short
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

/// Pasek nad treścią okna: nowa wersja albo aktualizacja gotowa do instalacji.
struct AppUpdateBanner: View {
    @ObservedObject var updater: AppUpdater
    let open: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let release = updater.available, updater.bannerVisible {
            HStack(spacing: 10) {
                Image(systemName: updater.phase == .ready ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                    .foregroundStyle(theme.accent)
                Text(updater.phase == .ready ? "Aktualizacja Mavinci \(release.version) jest gotowa do instalacji" : "Dostępna nowa wersja Mavinci \(release.version)")
                    .fontWeight(.semibold)
                if case .downloading(let value) = updater.phase {
                    ProgressView(value: value).frame(width: 120)
                    Text("\(Int(value * 100))%").monospacedDigit().foregroundStyle(.secondary)
                } else if updater.phase != .ready {
                    Text("Masz \(AppUpdateSupport.currentVersion)").foregroundStyle(.secondary)
                }
                Spacer()
                if updater.phase == .ready {
                    Button("Zainstaluj i uruchom ponownie") { updater.installAndRestart() }.buttonStyle(.borderedProminent)
                } else {
                    Button("Później") { updater.dismiss() }.buttonStyle(.borderless)
                    Button("Zobacz i zainstaluj", action: open).buttonStyle(.borderedProminent)
                }
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(theme.accent.opacity(0.12))
            .overlay(alignment: .bottom) { Divider() }
        }
    }
}

/// „Aktualizacja Mavinci”: wersje, co nowego, pobranie z postępem, instalacja z ponownym uruchomieniem, instalator DMG.
struct AppUpdateSheet: View {
    @ObservedObject var updater: AppUpdater
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    private var release: AppRelease? { updater.available }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage).resizable().interpolation(.high).frame(width: 56, height: 56).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(release == nil ? "Mavinci jest aktualny" : "Dostępna nowa wersja Mavinci").font(.title2.weight(.semibold))
                    Text("Zainstalowana: \(AppUpdateSupport.currentVersion) (\(AppUpdateSupport.currentBuild))").foregroundStyle(.secondary)
                    if let release {
                        Text("Nowa: \(release.version) (\(release.build))" + (publishedText(release.publishedAt).map { " · \($0)" } ?? ""))
                        Text("Pobranie: \(megabytes(release.size))").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let release, !release.notes.isEmpty {
                GroupBox("Co nowego") {
                    ScrollView {
                        Text(release.notes).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                    }
                    .frame(maxHeight: 180)
                }
            }
            status
            if release != nil, let blocker = updater.installBlocker {
                Label(blocker, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if release != nil {
                    Button("Pobierz instalator (DMG)") { Task { await updater.openInstaller() } }.disabled(updater.busy)
                }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(updater.phase == .restarting)
                if updater.phase == .ready {
                    Button("Zainstaluj i uruchom ponownie") { updater.installAndRestart() }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                } else if release != nil {
                    Button("Pobierz aktualizację") { Task { await updater.download() } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                        .disabled(updater.busy || updater.installBlocker != nil)
                } else {
                    Button("Sprawdź ponownie") { Task { await updater.check(manual: true) } }.disabled(updater.busy)
                }
            }
        }
        .padding(24)
        .frame(width: 540)
    }

    @ViewBuilder private var status: some View {
        switch updater.phase {
        case .checking:
            ProgressView { Text("Sprawdzanie wersji…") }.controlSize(.small)
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
        case .idle:
            EmptyView()
        }
    }
}

/// Pozycje aktualizacji na pasku menu (stan w `AppUpdater`).
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
