import AppKit
import CryptoKit
import Foundation
import Security

// MARK: Aktualizacje aplikacji — wersje publikowane przez `yarn dmg` na serwerze CRM (`/bridge/native/v1/desktop`)
//
// Sprawdzenie po zalogowaniu i co godzinę, przy otwarciu Ustawienia → Oprogramowanie, a także „Sprawdź aktualizacje…” (menu
// Mavinci i pasek menu — otwierają zakładkę „Oprogramowanie”). Nowsza kompilacja → „Nowa wersja …” w stopce paska bocznego
// (pod nazwiskiem pracownika) i pozycja na pasku menu; kliknięcie otwiera Ustawienia → Oprogramowanie (wersje, co nowego,
// kroki instalacji — `AppUpdateViews.swift`). „Pobierz aktualizację”: paczka ZIP z podpisaną aplikacją (z
// postępem), suma SHA-256 z opisu wydania, rozpakowanie (`ditto`), sprawdzenie podpisu zespołu Mavinci (Team ID 5DC8P5M489,
// ten sam identyfikator pakietu, ta sama kompilacja co w opisie). „Zainstaluj i uruchom ponownie”: po zamknięciu aplikacji
// skrypt podmienia pakiet w miejscu bieżącego i uruchamia nową wersję; poprzednia zostaje w katalogu aktualizacji do
// następnego uruchomienia (wtedy też wynik instalacji). Pliki pobrane przez aplikację nie mają kwarantanny — macOS nie pyta
// ponownie o zgodę na otwarcie. Kopia z folderu budowania (`yarn build:mac`), z obrazu dysku albo bez podpisu zespołu
// pokazuje nową wersję, ale się nie podmienia (instalator DMG nadal można pobrać).

/// Wydanie z serwera (`op=latest`).
struct AppRelease: Decodable, Equatable, Sendable {
    let version: String
    let build: String
    let publishedAt: String?
    let notes: String
    let notarized: Bool?
    /// Paczka aktualizacji (ZIP): rozmiar i suma SHA-256.
    let size: Int64
    let sha256: String
    /// Instalator DMG.
    let installerSize: Int64?
}

private struct AppReleaseReply: Decodable {
    let release: AppRelease?
    let newer: Bool
}

struct AppUpdateError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Podpis, sumy kontrolne, rozpakowanie i podmiana pakietu — bez stanu, poza aktorem głównym.
enum AppUpdateSupport {
    static let teamID = "5DC8P5M489"
    static let bundleID = "pl.mavinci.desktop"
    /// Wymaganie podpisu: pakiet Mavinci podpisany certyfikatem Apple zespołu Mavinci.
    static let requirementText = "identifier \"\(bundleID)\" and anchor apple generic and certificate leaf[subject.OU] = \"\(teamID)\""

    static var currentVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?" }
    static var currentBuild: String { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0" }

    /// Katalog aktualizacji (`~/Library/Caches/pl.mavinci.desktop/Updates`).
    static var folder: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(bundleID, isDirectory: true).appendingPathComponent("Updates", isDirectory: true)
    }
    static var statusFile: URL { folder.appendingPathComponent("install-status.txt") }

    /// Numery kompilacji (RRRRMMDDGGMM): dłuższy jest większy, przy równej długości — kolejność znaków.
    static func isNewer(_ build: String) -> Bool {
        let current = currentBuild
        guard build.allSatisfy(\.isNumber), !build.isEmpty else { return false }
        guard current.allSatisfy(\.isNumber), !current.isEmpty else { return true }
        return build.count != current.count ? build.count > current.count : build > current
    }

    static func requirement() -> SecRequirement? {
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(requirementText as CFString, [], &requirement) == errSecSuccess else { return nil }
        return requirement
    }

    /// Czy działająca kopia ma podpis zespołu Mavinci.
    static var runningSignedByTeam: Bool {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code, let requirement = requirement() else { return false }
        return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
    }

    /// Pobrana aplikacja: ważny podpis zespołu (także rozszerzenie Findera w środku), ten sam pakiet, kompilacja z opisu wydania.
    static func verify(_ app: URL, build: String) throws {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &staticCode) == errSecSuccess, let staticCode, let requirement = requirement() else {
            throw AppUpdateError(message: "Nie udało się odczytać podpisu pobranej aplikacji.")
        }
        let flags = SecCSFlags(rawValue: UInt32(kSecCSCheckAllArchitectures) | UInt32(kSecCSCheckNestedCode) | UInt32(kSecCSStrictValidate))
        guard SecStaticCodeCheckValidity(staticCode, flags, requirement) == errSecSuccess else {
            throw AppUpdateError(message: "Pobrana aplikacja nie ma ważnego podpisu zespołu Mavinci — instalację przerwano.")
        }
        let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        guard info?["CFBundleIdentifier"] as? String == bundleID, info?["CFBundleVersion"] as? String == build else {
            throw AppUpdateError(message: "Pobrana aplikacja ma inną wersję niż opis wydania — instalację przerwano.")
        }
    }

    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Narzędzie systemowe (np. `ditto`) — błąd, gdy kończy się kodem innym niż 0.
    static func run(_ tool: String, _ arguments: [String], failure: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: tool)
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { finished in
                if finished.terminationStatus == 0 { continuation.resume() } else { continuation.resume(throwing: AppUpdateError(message: failure)) }
            }
            do { try process.run() } catch { continuation.resume(throwing: error) }
        }
    }

    /// Skrypt podmiany: czeka na zamknięcie aplikacji, przenosi bieżący pakiet do katalogu aktualizacji, wstawia nowy
    /// (przy błędzie przywraca poprzedni), zapisuje wynik i uruchamia aplikację. Bez usuwania plików — kopie sprząta
    /// aplikacja przy następnym uruchomieniu.
    static let installScript = """
    #!/bin/sh
    # Instalacja aktualizacji Mavinci — uruchamiana przez aplikację tuż przed jej zamknięciem.
    PID="$1"; NEW="$2"; TARGET="$3"; PREVIOUS="$4"; STATUS="$5"
    case "$NEW" in *.app) ;; *) exit 1 ;; esac
    case "$TARGET" in *.app) ;; *) exit 1 ;; esac
    case "$PREVIOUS" in *.app) ;; *) exit 1 ;; esac
    i=0
    while kill -0 "$PID" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -gt 600 ]; then echo "timeout" > "$STATUS"; exit 1; fi
      sleep 0.2
    done
    if [ -e "$PREVIOUS" ]; then echo "failed" > "$STATUS"; open "$TARGET"; exit 1; fi
    if mv "$TARGET" "$PREVIOUS"; then
      if mv "$NEW" "$TARGET"; then echo "ok" > "$STATUS"; else mv "$PREVIOUS" "$TARGET"; echo "failed" > "$STATUS"; fi
    else
      echo "failed" > "$STATUS"
    fi
    open "$TARGET"
    """

    /// Uruchomienie skryptu podmiany (proces działa dalej po zamknięciu aplikacji).
    static func scheduleReplacement(new app: URL, work: URL) throws {
        let target = Bundle.main.bundleURL
        let previous = work.appendingPathComponent("previous", isDirectory: true).appendingPathComponent(target.lastPathComponent)
        try FileManager.default.createDirectory(at: previous.deletingLastPathComponent(), withIntermediateDirectories: true)
        let script = work.appendingPathComponent("install.sh")
        try Data(installScript.utf8).write(to: script, options: .atomic)
        try? FileManager.default.removeItem(at: statusFile)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), app.path, target.path, previous.path, statusFile.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }
}

/// Pobieranie z postępem — plik przenoszony z katalogu systemu, zanim zadanie pobierania go usunie.
private final class UpdateDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let destination: URL
    private let progress: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var failure: Error?
    private var moved = false
    private var reported = -1

    init(destination: URL, progress: @escaping @Sendable (Double) -> Void) {
        self.destination = destination
        self.progress = progress
    }

    func start(_ request: URLRequest) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 3600
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            session.downloadTask(with: request).resume()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let percent = Int(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) * 100)
        guard percent != reported else { return }
        reported = percent
        progress(Double(percent) / 100)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            failure = AppUpdateError(message: status == 401 ? "Sesja wygasła — zaloguj się ponownie." : "Serwer nie wydał pliku (HTTP \(status)).")
            return
        }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            moved = true
        } catch {
            failure = error
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let problem: Error?
        if error != nil {
            problem = AppUpdateError(message: "Pobieranie przerwane — sprawdź połączenie i spróbuj ponownie.")
        } else if let failure {
            problem = failure
        } else if !moved {
            problem = AppUpdateError(message: "Pobieranie przerwane.")
        } else {
            problem = nil
        }
        if let problem { continuation?.resume(throwing: problem) } else { continuation?.resume() }
        continuation = nil
        session.finishTasksAndInvalidate()
    }
}

@MainActor final class AppUpdater: ObservableObject {
    enum Phase: Equatable {
        case idle
        case checking
        case downloading(Double)
        /// Pobrana i sprawdzona — czeka na „Zainstaluj i uruchom ponownie”.
        case ready
        case restarting
        case failed(String)
    }

    weak var workspace: Workspace?
    @Published private(set) var available: AppRelease?
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var lastCheck: Date?
    /// Błąd ostatniego sprawdzenia na żądanie (Ustawienia → Oprogramowanie); `nil` po udanym sprawdzeniu.
    @Published private(set) var checkError: String?
    private var prepared: (release: AppRelease, app: URL, work: URL)?
    private var schedule: Task<Void, Never>?
    /// Co ile sprawdzać wersję w tle — nowe wydanie z `yarn dmg` widać w stopce paska bocznego najpóźniej po godzinie.
    private static let interval: TimeInterval = 60 * 60

    var busy: Bool {
        switch phase {
        case .checking, .downloading, .restarting: return true
        case .idle, .ready, .failed: return false
        }
    }

    /// Dlaczego ta kopia nie zainstaluje aktualizacji sama (`nil` — może).
    var installBlocker: String? {
        let bundle = Bundle.main.bundleURL
        let path = bundle.path
        if path.hasPrefix("/Volumes/") {
            return "Mavinci działa z instalatora (obrazu dysku). Przeciągnij aplikację do folderu Aplikacje i uruchom ją stamtąd — wtedy zainstaluje aktualizację sama."
        }
        if path.contains("/AppTranslocation/") {
            return "macOS uruchomił aplikację z kopii tymczasowej. Przenieś Mavinci do folderu Aplikacje i uruchom ją ponownie."
        }
        if path.contains("/desktop/mac/build/") {
            return "To kopia z folderu budowania projektu — aktualizuje ją yarn build:mac. Aktualizacje z serwera instaluje kopia z folderu Aplikacje."
        }
        if !AppUpdateSupport.runningSignedByTeam {
            return "Ta kopia aplikacji nie ma podpisu zespołu Mavinci — zainstaluj ją z instalatora (przycisk obok)."
        }
        let parent = bundle.deletingLastPathComponent().path
        if !FileManager.default.isWritableFile(atPath: parent) || !FileManager.default.isWritableFile(atPath: path) {
            return "Brak uprawnień do zapisu w folderze \(parent). Pobierz instalator i przeciągnij aplikację do folderu Aplikacje (macOS poprosi o hasło administratora)."
        }
        return nil
    }

    /// Wynik poprzedniej instalacji, sprzątanie katalogu aktualizacji i sprawdzanie wersji (raz na uruchomienie aplikacji).
    func start() {
        guard schedule == nil else { return }
        finishPreviousInstall()
        schedule = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            while !Task.isCancelled {
                guard let self else { return }
                if self.stale(after: Self.interval), self.workspace?.employee != nil, !self.busy, self.phase != .ready { await self.check() }
                try? await Task.sleep(for: .seconds(5 * 60))
            }
        }
    }

    /// Czy sprawdzenie jest potrzebne (Ustawienia → Oprogramowanie sprawdza przy otwarciu, gdy ostatnie było dawniej).
    func stale(after seconds: TimeInterval) -> Bool {
        lastCheck.map { Date().timeIntervalSince($0) >= seconds } ?? true
    }

    /// Najnowsze wydanie z serwera; `manual` — postęp i wynik (także błąd) w Ustawieniach → Oprogramowanie.
    func check(manual: Bool = false) async {
        guard let api = workspace?.nativeAPI() else {
            if manual { checkError = "Zaloguj się, aby sprawdzić aktualizacje." }
            return
        }
        guard !busy else { return }
        // Pobrana aktualizacja czeka na instalację — sprawdzenie jej nie chowa (zmieni ją dopiero inna wersja na serwerze).
        if manual && phase != .ready { phase = .checking }
        defer { if phase == .checking { phase = .idle } }
        do {
            let data = try await api.get("/desktop?op=latest&build=\(AppUpdateSupport.currentBuild)")
            let reply = try JSONDecoder().decode(AppReleaseReply.self, from: data)
            lastCheck = Date()
            let release = reply.release.flatMap { AppUpdateSupport.isNewer($0.build) ? $0 : nil }
            // Inna wersja na serwerze: poprzedni błąd i pobrana wcześniej paczka przestają obowiązywać.
            if release?.build != available?.build, case .failed = phase { phase = .idle }
            if let ready = prepared, ready.release.build != release?.build {
                prepared = nil
                if phase == .ready { phase = .idle }
            }
            available = release
            checkError = nil
        } catch {
            if manual { checkError = "Nie udało się sprawdzić aktualizacji: \(friendlyError(error))" }
        }
    }

    /// Adres pliku wydania z tokenem pracownika.
    private func fileRequest(_ kind: String) async throws -> URLRequest {
        guard let api = workspace?.nativeAPI(),
              let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/desktop?op=download&kind=\(kind)") else {
            throw AppUpdateError(message: "Zaloguj się, aby pobrać aktualizację.")
        }
        var request = URLRequest(url: url)
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        return request
    }

    private func downloadFile(_ kind: String, to destination: URL) async throws {
        let request = try await fileRequest(kind)
        phase = .downloading(0)
        let download = UpdateDownload(destination: destination) { [weak self] value in
            Task { @MainActor in
                guard let self, case .downloading = self.phase else { return }
                self.phase = .downloading(value)
            }
        }
        try await download.start(request)
    }

    /// „Pobierz aktualizację”: paczka, suma kontrolna, rozpakowanie i podpis — potem czeka na instalację.
    func download() async {
        guard let release = available, !busy else { return }
        if let blocker = installBlocker { phase = .failed(blocker); return }
        do {
            let work = AppUpdateSupport.folder.appendingPathComponent(release.build, isDirectory: true)
            try? FileManager.default.removeItem(at: work)
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
            let zip = work.appendingPathComponent("Mavinci.zip")
            try await downloadFile("zip", to: zip)
            phase = .downloading(1)
            let sum = try await Task.detached(priority: .userInitiated) { try AppUpdateSupport.sha256(of: zip) }.value
            guard sum == release.sha256.lowercased() else {
                throw AppUpdateError(message: "Pobrany plik jest niekompletny (suma kontrolna się nie zgadza). Spróbuj ponownie.")
            }
            let unpacked = work.appendingPathComponent("unpacked", isDirectory: true)
            try await AppUpdateSupport.run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path], failure: "Nie udało się rozpakować aktualizacji.")
            let app = unpacked.appendingPathComponent("Mavinci.app", isDirectory: true)
            let build = release.build
            try await Task.detached(priority: .userInitiated) { try AppUpdateSupport.verify(app, build: build) }.value
            try? FileManager.default.removeItem(at: zip)
            prepared = (release, app, work)
            phase = .ready
        } catch {
            phase = .failed(friendlyError(error))
        }
    }

    /// „Zainstaluj i uruchom ponownie”: skrypt podmiany startuje, aplikacja się zamyka.
    func installAndRestart() {
        guard let prepared, phase == .ready else { return }
        if let blocker = installBlocker { phase = .failed(blocker); return }
        do {
            try AppUpdateSupport.scheduleReplacement(new: prepared.app, work: prepared.work)
            UserDefaults.standard.set(prepared.release.version, forKey: "updates.installingVersion")
            phase = .restarting
            // Pozostałe kopie aplikacji (proces główny, okna w osobnych procesach) też kończą pracę — po instalacji uruchamia się
            // nowa wersja, a nie działająca jeszcze stara kopia.
            AppInstance.post(.update)
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(600))
                NSApp.terminate(nil)
            }
        } catch {
            phase = .failed("Nie udało się uruchomić instalacji: \(friendlyError(error))")
        }
    }

    /// „Pobierz instalator (DMG)”: zapis w katalogu aktualizacji i otwarcie w Finderze (okno instalatora).
    func openInstaller() async {
        guard let release = available, !busy else { return }
        do {
            let work = AppUpdateSupport.folder.appendingPathComponent("installer", isDirectory: true)
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
            let dmg = work.appendingPathComponent("Mavinci-\(release.version)-\(release.build).dmg")
            try await downloadFile("dmg", to: dmg)
            phase = prepared == nil ? .idle : .ready
            NSWorkspace.shared.open(dmg)
            workspace?.succeed("Otwarto instalator Mavinci \(release.version) — przeciągnij aplikację do folderu Aplikacje.")
        } catch {
            phase = .failed(friendlyError(error))
        }
    }

    /// Po ponownym uruchomieniu: komunikat o wyniku instalacji i sprzątnięcie katalogu aktualizacji.
    private func finishPreviousInstall() {
        let defaults = UserDefaults.standard
        let installing = defaults.string(forKey: "updates.installingVersion")
        let status = (try? String(contentsOf: AppUpdateSupport.statusFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        if installing != nil || status != nil {
            defaults.removeObject(forKey: "updates.installingVersion")
            if status == "ok" {
                workspace?.succeed("Zainstalowano Mavinci \(AppUpdateSupport.currentVersion).")
            } else if status != nil {
                phase = .failed("Nie udało się zainstalować aktualizacji — działa poprzednia wersja. Spróbuj ponownie albo pobierz instalator.")
            }
        }
        try? FileManager.default.removeItem(at: AppUpdateSupport.folder)
    }
}
