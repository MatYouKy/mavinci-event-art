import AppKit
import FileProvider
import Foundation
import Security

// MARK: „Mavinci” w pasku bocznym Findera — po stronie aplikacji
//
// Po zalogowaniu aplikacja zapisuje w kontenerze grupy adresy serwera i sesję (`FinderShared`) i rejestruje domenę
// File Provider; dalej pliki (Eventy, Materiały i Dysk: Oferty, Kalkulacje, Umowy, Magazyn) obsługuje rozszerzenie `MavinciFileProvider` (osobny proces, działa też
// przy zamkniętej aplikacji). Gdy aplikacja jest otwarta, co minutę prosi Findera o sprawdzenie zmian na serwerze. Wylogowanie usuwa
// domenę razem z pobranymi kopiami plików. Bez rozszerzenia w pakiecie (budowanie bez podpisu zespołem) nic nie robi.
// Gdy macOS nie zna jeszcze rozszerzenia (pierwsze uruchomienie na innym Macu), aplikacja zgłasza je sama (`pluginkit -a`)
// i próbuje drugi raz; nieudana rejestracja ma opis przyczyny na pasku menu („szczegóły…”, „Spróbuj ponownie”).

@MainActor
enum FinderDomain {
    private static var signals: Task<Void, Never>?
    private static var domain: NSFileProviderDomain {
        NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: FinderShared.domainIdentifier), displayName: FinderShared.domainName)
    }

    static var available: Bool { FinderShared.bundledWithExtension }

    /// Ostatni problem z rejestracją „Mavinci” w Finderze (pasek menu); `nil` — rejestracja się udała albo jeszcze jej nie było.
    private(set) static var problem: String?

    /// Nazwa certyfikatu podpisu pakietu („Developer ID Application: …”, „Apple Development: …”) albo `nil` (podpis ad hoc).
    static let signingName: String? = {
        var code: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let dictionary = info as? [String: Any],
              let certificates = dictionary[kSecCodeInfoCertificates as String] as? [SecCertificate],
              let leaf = certificates.first else { return nil }
        var name: CFString?
        guard SecCertificateCopyCommonName(leaf, &name) == errSecSuccess, let name else { return nil }
        return name as String
    }()

    /// Wydanie do rozdania (podpis „Developer ID Application”) — tylko takie macOS uruchamia bez zastrzeżeń na każdym Macu.
    static var developerIDSigned: Bool { signingName?.hasPrefix("Developer ID Application") == true }

    /// Po zalogowaniu lub odtworzeniu sesji: połączenie i sesja dla rozszerzenia, rejestracja domeny, sygnały zmian.
    static func activate(connection: Connection, session: Data, fresh: Bool) {
        guard available, let crm = connection.crm else { return }
        FinderShared.store(.init(url: connection.url, publicKey: connection.publicKey, native: connection.provider == .server, crm: crm))
        if fresh { FinderShared.storeSession(session) } else { FinderShared.offerSession(session) }
        // Widżety zadań korzystają z tej samej sesji — zgłoszenie rozszerzenia i odświeżenie po zalogowaniu.
        WidgetBridge.activate()
        let target = Self.domain
        Task {
            await register(target)
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

    /// „Spróbuj ponownie” z paska menu: rejestracja domeny jeszcze raz (połączenie i sesja rozszerzenia są już w kontenerze grupy).
    static func retry() async {
        guard available else { return }
        await register(Self.domain)
        signal()
    }

    /// Rejestracja domeny. Gdy się nie uda (np. macOS nie zarejestrował jeszcze rozszerzenia z pakietu na tym Macu), aplikacja
    /// zgłasza rozszerzenie systemowi (`pluginkit -a`) i próbuje drugi raz; przyczyna niepowodzenia trafia do `problem`.
    private static func register(_ target: NSFileProviderDomain) async {
        do {
            try await NSFileProviderManager.add(target)
            problem = nil
            return
        } catch {
            NSLog("[Mavinci Finder] rejestracja domeny: %@", error.localizedDescription)
        }
        await registerExtension()
        do {
            try await NSFileProviderManager.add(target)
            problem = nil
        } catch {
            NSLog("[Mavinci Finder] rejestracja domeny (druga próba): %@", error.localizedDescription)
            problem = describe(error)
        }
    }

    /// `pluginkit -a <rozszerzenie z pakietu>` — rejestracja rozszerzenia Findera w systemie (aplikacja nie jest w piaskownicy).
    private static func registerExtension() async {
        guard let plugins = Bundle.main.builtInPlugInsURL else { return }
        let path = plugins.appendingPathComponent(FinderShared.extensionName).path
        await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/pluginkit")
            process.arguments = ["-a", path]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                process.waitUntilExit()
            } catch {
                NSLog("[Mavinci Finder] pluginkit: %@", error.localizedDescription)
            }
        }.value
        // System potrzebuje chwili na wczytanie zgłoszonego rozszerzenia.
        try? await Task.sleep(nanoseconds: 1_500_000_000)
    }

    /// Przyczyna po polsku: aplikacja uruchomiona z instalatora, kompilacja deweloperska albo błąd zgłoszony przez macOS.
    private static func describe(_ error: Error) -> String {
        let path = Bundle.main.bundlePath
        if path.contains("/AppTranslocation/") || path.hasPrefix("/Volumes/") {
            return "Mavinci działa prosto z instalatora albo z folderu Pobrane. Przeciągnij aplikację do folderu Aplikacje, zamknij ją, otwórz z Aplikacji i wybierz „Spróbuj ponownie”."
        }
        if !developerIDSigned {
            let name = signingName.map { "„\($0)”" } ?? "ad hoc"
            return "Ta kompilacja jest podpisana certyfikatem deweloperskim (\(name)). Na Macu, na którym jej nie zbudowano, macOS może nie uruchomić z niej rozszerzenia Findera. Potrzebne jest wydanie z certyfikatem Developer ID (`yarn dmg` z certyfikatem „Developer ID Application” w pęku kluczy). Komunikat systemu: \(error.localizedDescription)"
        }
        return "macOS nie zarejestrował „Mavinci” w Finderze: \(error.localizedDescription). Sprawdź Ustawienia systemowe → Ogólne → Rzeczy otwierane podczas logowania i rozszerzenia → Dostawcy plików i wybierz „Spróbuj ponownie”."
    }

    /// Wylogowanie: koniec sygnałów, usunięcie sesji rozszerzenia i domeny (z lokalnymi kopiami plików).
    static func deactivate() {
        signals?.cancel()
        signals = nil
        problem = nil
        guard available else { return }
        FinderShared.signOut()
        WidgetBridge.reload()
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
        /// Rejestracja się nie udała — opis przyczyny (`problem`).
        case failed(String)
    }

    static func status() async -> Status {
        guard available else { return .unavailable }
        guard let domains = try? await NSFileProviderManager.domains(),
              let match = domains.first(where: { $0.identifier.rawValue == FinderShared.domainIdentifier }) else {
            if let problem { return .failed(problem) }
            return .missing
        }
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
