import AppKit
import FileProvider
import Foundation

// MARK: „Mavinci” w pasku bocznym Findera — po stronie aplikacji
//
// Po zalogowaniu aplikacja zapisuje w kontenerze grupy adresy serwera i sesję (`FinderShared`) i rejestruje domenę
// File Provider; dalej pliki (Eventy, Materiały i Dysk: Oferty, Kalkulacje, Umowy, Magazyn) obsługuje rozszerzenie `MavinciFileProvider` (osobny proces, działa też
// przy zamkniętej aplikacji). Gdy aplikacja jest otwarta, co minutę prosi Findera o sprawdzenie zmian na serwerze. Wylogowanie usuwa
// domenę razem z pobranymi kopiami plików. Bez rozszerzenia w pakiecie (budowanie bez podpisu zespołem) nic nie robi.

@MainActor
enum FinderDomain {
    private static var signals: Task<Void, Never>?
    private static var domain: NSFileProviderDomain {
        NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: FinderShared.domainIdentifier), displayName: FinderShared.domainName)
    }

    static var available: Bool { FinderShared.bundledWithExtension }

    /// Po zalogowaniu lub odtworzeniu sesji: połączenie i sesja dla rozszerzenia, rejestracja domeny, sygnały zmian.
    static func activate(connection: Connection, session: Data, fresh: Bool) {
        guard available, let crm = connection.crm else { return }
        FinderShared.store(.init(url: connection.url, publicKey: connection.publicKey, native: connection.provider == .server, crm: crm))
        if fresh { FinderShared.storeSession(session) } else { FinderShared.offerSession(session) }
        let target = Self.domain
        Task {
            do {
                try await NSFileProviderManager.add(target)
            } catch {
                NSLog("[Mavinci Finder] rejestracja domeny: %@", error.localizedDescription)
            }
            signal()
        }
        signals?.cancel()
        signals = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if Task.isCancelled { break }
                signal()
            }
        }
    }

    /// Wylogowanie: koniec sygnałów, usunięcie sesji rozszerzenia i domeny (z lokalnymi kopiami plików).
    static func deactivate() {
        signals?.cancel()
        signals = nil
        guard available else { return }
        FinderShared.signOut()
        let target = Self.domain
        Task {
            do { try await NSFileProviderManager.remove(target) } catch {
                NSLog("[Mavinci Finder] usuwanie domeny: %@", error.localizedDescription)
            }
        }
    }

    /// Stan „Mavinci” w Finderze dla paska menu.
    enum Status: Equatable {
        /// Aplikacja zbudowana bez rozszerzenia (bez podpisu zespołem).
        case unavailable
        /// Domena nie jest zarejestrowana (np. przed zalogowaniem).
        case missing
        /// Zarejestrowana, ale wyłączona — macOS pokazuje w Finderze „Włącz”.
        case disabled
        case enabled
    }

    static func status() async -> Status {
        guard available else { return .unavailable }
        guard let domains = try? await NSFileProviderManager.domains(),
              let match = domains.first(where: { $0.identifier.rawValue == FinderShared.domainIdentifier }) else { return .missing }
        return match.userEnabled ? .enabled : .disabled
    }

    /// Folder wydarzenia (albo cały „Mavinci”) w nowym oknie Findera.
    static func reveal(event id: String? = nil) async {
        await reveal(identifier: id.map { "event:" + $0 })
    }

    /// Materiały w Finderze: folder (`folder`), główny folder marki (`company`) albo cały folder „Materiały”.
    static func reveal(materialsFolder folder: String?, company: String?) async {
        await reveal(identifier: folder.map { "mfolder:" + $0 } ?? company.map { "mbrand:" + $0 } ?? "materials")
    }

    /// Dysk w Finderze: folder działu (`offers`, `offers:2026-11`, `warehouse:item:<id>`…).
    static func reveal(driveNode node: String) async {
        await reveal(identifier: "drive:" + node)
    }

    /// Plik Dysku w Finderze (`offer:<id>`, `equipment-file:<id>`…).
    static func reveal(driveFile id: String) async {
        await reveal(identifier: "dfile:" + id)
    }

    /// Plik dodany w aplikacji do Dysku (np. do sprzętu) — rozszerzenie wczyta Dysk od nowa przy najbliższym sprawdzeniu zmian.
    static func driveChanged() {
        guard available else { return }
        FinderShared.markDriveChanged()
        signal()
    }

    /// Element rozszerzenia (identyfikator jak w `FinderID`) — gdy jeszcze go nie ma w Finderze, otwiera się „Mavinci”.
    private static func reveal(identifier raw: String?) async {
        guard available, let manager = NSFileProviderManager(for: Self.domain) else { return }
        let target = raw.map { NSFileProviderItemIdentifier(rawValue: $0) } ?? .rootContainer
        if let url = try? await manager.getUserVisibleURL(for: target) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else if let root = try? await manager.getUserVisibleURL(for: .rootContainer) {
            NSWorkspace.shared.open(root)
        }
    }

    /// Prośba do Findera o sprawdzenie zmian (np. po wysłaniu pliku z karty wydarzenia).
    static func signal() {
        guard available, let manager = NSFileProviderManager(for: Self.domain) else { return }
        manager.signalEnumerator(for: .workingSet) { error in
            if let error { NSLog("[Mavinci Finder] sygnał zmian: %@", error.localizedDescription) }
        }
    }
}
