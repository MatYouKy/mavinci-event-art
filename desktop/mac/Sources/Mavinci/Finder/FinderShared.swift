import Foundation

// MARK: Wspólne dla aplikacji i rozszerzenia Findera (`MavinciFileProvider`)
//
// Rozszerzenie działa jako osobny proces (także gdy aplikacja jest zamknięta), więc dane logowania i adresy serwera dzieli
// z aplikacją przez kontener grupy aplikacji (`~/Library/Group Containers/5DC8P5M489.pl.mavinci`, dostęp tylko dla programów
// podpisanych zespołem Mavinci). Token Supabase odświeżają oba procesy — zawsze pod wspólną blokadą pliku i z ponownym
// odczytem sesji po jej uzyskaniu, bo odświeżenie unieważnia poprzedni token odświeżania.
// Plik kompiluje się do aplikacji (SwiftPM) i do rozszerzenia (`scripts/build-app.sh`) — tylko Foundation.

enum FinderShared {
    static let appGroup = "5DC8P5M489.pl.mavinci"
    static let domainIdentifier = "pl.mavinci.files"
    static let domainName = "Mavinci"
    static let extensionName = "MavinciFileProvider.appex"

    /// Aplikacja zbudowana z rozszerzeniem (podpis zespołem) — bez niego nie dotykamy kontenera grupy.
    static var bundledWithExtension: Bool {
        guard let plugins = Bundle.main.builtInPlugInsURL else { return false }
        return FileManager.default.fileExists(atPath: plugins.appendingPathComponent(extensionName).path)
    }

    static var container: URL? {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    // MARK: Pliki w kontenerze (tylko właściciel może czytać)

    static func read(_ name: String) -> Data? {
        guard let url = container?.appendingPathComponent(name) else { return nil }
        return try? Data(contentsOf: url)
    }
    static func write(_ name: String, _ data: Data) {
        guard let url = container?.appendingPathComponent(name) else { return }
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            NSLog("[Mavinci Finder] zapis %@: %@", name, error.localizedDescription)
        }
    }
    static func remove(_ name: String) {
        guard let url = container?.appendingPathComponent(name) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: Połączenie

    struct Connection: Codable, Equatable {
        /// Adres logowania (Supabase albo serwer CRM) i klucz publiczny — jak `Connection` w aplikacji.
        var url: String
        var publicKey: String
        var native: Bool
        /// Serwer CRM z natywnym API (`/bridge/native/v1/files`).
        var crm: String
    }
    static func connection() -> Connection? { read("connection.json").flatMap { try? JSONDecoder().decode(Connection.self, from: $0) } }
    static func store(_ connection: Connection) {
        if let data = try? JSONEncoder().encode(connection) { write("connection.json", data) }
    }

    // MARK: Sesja

    /// Pola sesji potrzebne obu procesom (cały JSON sesji jest zapisywany bez zmian — aplikacja dekoduje z niego `Session`).
    struct SessionFields: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double?
        let expires_at: Double?
        let issuedAt: Double?
        let user: User
        struct User: Decodable { let id: String }
        var expiry: Double { expires_at ?? ((issuedAt ?? 0) + (expires_in ?? 3600)) }
    }
    static func sessionData() -> Data? { read("session.json") }
    static func session() -> SessionFields? { sessionData().flatMap { try? JSONDecoder().decode(SessionFields.self, from: $0) } }
    /// Zapis sesji (z dopisanym czasem wydania, gdy serwer go nie podał).
    static func storeSession(_ data: Data) {
        guard var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        if object["issuedAt"] == nil { object["issuedAt"] = Date().timeIntervalSince1970 }
        guard let normalized = try? JSONSerialization.data(withJSONObject: object) else { return }
        write("session.json", normalized)
    }
    /// Sesja z pęku kluczy aplikacji po uruchomieniu — zapisujemy ją tylko, gdy wspólna jest starsza albo innego konta
    /// (rozszerzenie mogło w tym czasie odświeżyć token).
    static func offerSession(_ data: Data) {
        guard let mine = try? JSONDecoder().decode(SessionFields.self, from: data) else { return }
        if let shared = session(), shared.user.id == mine.user.id, shared.expiry >= mine.expiry { return }
        storeSession(data)
    }
    static func signOut() {
        remove("session.json")
    }

    /// Identyfikator konta dla lokalnej kopii rozszerzenia (zmiana konta = nowa kopia).
    static func owner() -> String? {
        guard let c = connection(), let s = session() else { return nil }
        return "\(c.crm)|\(c.url)|\(s.user.id)"
    }

    // MARK: Odświeżanie tokenu między procesami

    enum Failure: Error { case signedOut, offline, server }

    /// Blokada pliku w kontenerze grupy (`flock`) — trzymana także przez `await` (dotyczy otwartego pliku, nie wątku).
    final class RefreshLock: @unchecked Sendable {
        private let fd: Int32
        init?() {
            guard let url = FinderShared.container?.appendingPathComponent("session.lock") else { return nil }
            let fd = open(url.path, O_CREAT | O_RDWR, 0o600)
            guard fd >= 0 else { return nil }
            self.fd = fd
        }
        func acquire() async {
            let fd = self.fd
            await Task.detached { _ = flock(fd, LOCK_EX) }.value
        }
        func release() {
            flock(fd, LOCK_UN)
            close(fd)
        }
    }

    /// Ważny token dostępu ze wspólnej sesji; odświeża pod blokadą (drugi proces mógł już to zrobić).
    static func validAccessToken() async throws -> String {
        guard let connection = connection() else { throw Failure.signedOut }
        let now = Date().timeIntervalSince1970
        if let current = session(), current.expiry > now + 90 { return current.access_token }
        guard let lock = RefreshLock() else { throw Failure.signedOut }
        await lock.acquire()
        defer { lock.release() }
        guard let current = session() else { throw Failure.signedOut }
        if current.expiry > Date().timeIntervalSince1970 + 90 { return current.access_token }
        let data = try await refresh(connection, refreshToken: current.refresh_token)
        guard let renewed = try? JSONDecoder().decode(SessionFields.self, from: data), renewed.user.id == current.user.id else { throw Failure.server }
        storeSession(data)
        return renewed.access_token
    }

    /// Odświeżenie sesji tak jak w aplikacji (`HTTPBackend.token()`): serwer CRM albo Supabase Auth.
    static func refresh(_ connection: Connection, refreshToken: String) async throws -> Data {
        let base = connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let path = connection.native ? "/api/native/v1/refresh" : "/auth/v1/token?grant_type=refresh_token"
        guard let url = URL(string: base + path) else { throw Failure.signedOut }
        var request = URLRequest(url: url, timeoutInterval: 25)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("MavinciDesktop/0.1 (Finder)", forHTTPHeaderField: "User-Agent")
        if !connection.native { request.setValue(connection.publicKey, forHTTPHeaderField: "apikey") }
        request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw Failure.offline }
        guard let http = response as? HTTPURLResponse else { throw Failure.server }
        if (200..<300).contains(http.statusCode) { return data }
        if [400, 401, 403].contains(http.statusCode) { throw Failure.signedOut }
        throw Failure.server
    }
}
