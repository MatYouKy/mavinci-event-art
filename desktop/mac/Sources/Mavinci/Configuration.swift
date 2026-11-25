import Foundation
import Security
import CryptoKit

struct Connection: Codable, Equatable {
    enum Provider: String, Codable, CaseIterable { case supabase, server }
    var provider: Provider = .supabase
    var url = ""
    var publicKey = ""
    /// Adres serwera CRM (natywne API `/bridge/native/v1` i strony CRM w przeglądarce). Brak w starszej konfiguracji → mavinci.pl.
    var crmURL: String?
    var crm: String? {
        let raw = (crmURL?.isEmpty == false ? crmURL! : "https://mavinci.pl").trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let u = URLComponents(string: raw), let host = u.host, !host.isEmpty,
              u.scheme == "https" || (u.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return nil }
        return raw
    }
    var valid: Bool {
        guard let u = URLComponents(string: url), let host = u.host, !host.isEmpty,
              u.user == nil, u.password == nil, u.query == nil, u.fragment == nil,
              u.scheme == "https" || (u.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return false }
        if provider == .server { return true }
        // Legacy anon JWT and current publishable keys are allowed; secret/service_role keys are rejected.
        if publicKey.hasPrefix("sb_publishable_") { return true }
        let parts = publicKey.split(separator: ".")
        guard parts.count == 3 else { return false }
        var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return json["role"] as? String == "anon"
    }
    var identity: String { digest("\(provider.rawValue)|\(url)|\(publicKey)") }
    /// Połączenie aplikacji. Zainstalowana aplikacja (release): wyłącznie wbudowane w program (`EmbeddedConnection.swift`) —
    /// połączenie zapisane dawniej z zakładki „Połączenie” jest usuwane z pęku kluczy. Kompilacja deweloperska: zapisane
    /// z zakładki „Połączenie” → wbudowane → plik `MAVINCI_CONFIGURATION_FILE` → zmienne SUPABASE_URL / SUPABASE_ANON_KEY.
    static func load() -> Connection {
        #if DEBUG
        if let data = try? Vault.read("connection"), let c = try? JSONDecoder().decode(Connection.self, from: data) { return c }
        if let embedded { return embedded }
        let e = ProcessInfo.processInfo.environment
        if let file = e["MAVINCI_CONFIGURATION_FILE"], let data = try? Data(contentsOf: URL(fileURLWithPath: file)),
           let c = try? JSONDecoder().decode(Connection.self, from: data) { return c }
        return Connection(url: e["SUPABASE_URL"] ?? "", publicKey: e["SUPABASE_ANON_KEY"] ?? "")
        #else
        try? Vault.delete("connection")
        return embedded ?? Connection()
        #endif
    }
    func save() throws { try Vault.write("connection", JSONEncoder().encode(self)) }
}
func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }

/// Sekrety aplikacji w pęku kluczy macOS — **jedna** pozycja („vault-v2”) ze wszystkimi wartościami (połączenie, sesja, klucze
/// szyfrujące kopie na dysku, powiązanie z Kalendarzem Apple), czytana raz na uruchomienie i trzymana w pamięci.
/// Wcześniej każda kopia miała własną pozycję, więc po każdym nowym budowaniu macOS pytał o hasło kilkanaście razy.
/// Przy pierwszym uruchomieniu przenosimy z dawnych pozycji tylko połączenie, sesję i Kalendarz Apple (kopie danych
/// pobiorą się od nowa). Lista dawnych pozycji (same nazwy, bez treści) nie wymaga zgody użytkownika.
enum Vault {
    static let service = "pl.mavinci.desktop"
    private static let account = "vault-v2"
    private static let lock = NSLock()
    private static var cache: [String: Data]?
    /// Użytkownik odmówił dostępu — do końca sesji nie pytamy ponownie.
    private static var denied = false

    static func read(_ key: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        return try values()[key]
    }
    static func write(_ key: String, _ data: Data) throws {
        lock.lock(); defer { lock.unlock() }
        var all = try values()
        guard all[key] != data else { return }
        all[key] = data
        try persist(all)
        cache = all
    }
    static func delete(_ key: String) throws {
        lock.lock(); defer { lock.unlock() }
        var all = try values()
        guard all[key] != nil else { return }
        all.removeValue(forKey: key)
        try persist(all)
        cache = all
    }

    // MARK: Pozycja w pęku kluczy (wywoływane pod blokadą)
    private static func base(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }
    private static func values() throws -> [String: Data] {
        if let cache { return cache }
        if denied { throw AppError.forbidden }
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            let decoded = (result as? Data).flatMap { try? PropertyListDecoder().decode([String: Data].self, from: $0) } ?? [:]
            cache = decoded
            return decoded
        case errSecItemNotFound:
            let migrated = legacy()
            if !migrated.isEmpty { try? persist(migrated) }
            cache = migrated
            return migrated
        case errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed:
            denied = true
            throw AppError.forbidden
        default:
            throw AppError.server
        }
    }
    private static func persist(_ all: [String: Data]) throws {
        let data = try PropertyListEncoder().encode(all)
        let status = SecItemUpdate(base(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = base(account)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw AppError.server }
        } else if status != errSecSuccess { throw AppError.server }
    }
    /// Dawne pozycje (jedna na wartość): przenosimy tylko to, czego nie da się odtworzyć bez użytkownika.
    private static func legacy() -> [String: Data] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let items = result as? [[String: Any]] else { return [:] }
        let names = items.compactMap { $0[kSecAttrAccount as String] as? String }
            .filter { $0 == "connection" || $0.hasPrefix("session-") || $0.hasPrefix("apple-calendar-") }
        var migrated: [String: Data] = [:]
        for name in names {
            query = base(name)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var value: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data { migrated[name] = data }
        }
        return migrated
    }
}

struct LocalCache {
    let namespace: String
    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mavinci/Desktop/v1/\(namespace).sealed")
    }
    private func key() throws -> SymmetricKey {
        let account = "cache-key-\(namespace)"
        if let data = try Vault.read(account) { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        try Vault.write(account, key.withUnsafeBytes { Data($0) })
        return key
    }
    func load() throws -> Snapshot? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let data = try Data(contentsOf: file)
        // Kopia z innym (dawnym) kluczem jest nieczytelna — usuwamy ją, dane pobiorą się z serwera.
        let secret = try key()
        guard let box = try? AES.GCM.SealedBox(combined: data), let clear = try? AES.GCM.open(box, using: secret) else {
            try? FileManager.default.removeItem(at: file); return nil
        }
        return try JSONDecoder().decode(Snapshot.self, from: clear)
    }
    func save(_ snapshot: Snapshot) throws {
        let sealed = try AES.GCM.seal(JSONEncoder().encode(snapshot), using: key())
        guard let data = sealed.combined else { throw AppError.server }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    func clear() throws {
        // Destroy the key before removing the encrypted file.
        try Vault.delete("cache-key-\(namespace)")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}

/// Zapis i usuwanie lokalnej kopii zbiorów poza wątkiem głównym. Kopia z kilkoma tysiącami wierszy (np. przetargi z opisami)
/// to dziesiątki MB JSON-a i szyfrowanie — zapisywana na wątku głównym zatrzymywała okno (wybór przetargu, koniec odświeżania).
/// Zapisy idą po kolei (blokada zapisu). Zapis zlecony przed `invalidate()` (wylogowanie, inny pracownik) jest pomijany, a
/// `clear` czeka na trwający zapis — kopia poprzedniej sesji nie wraca na dysk. Wątek główny bierze tylko krótką blokadę
/// pokolenia (`current`, `invalidate`), nigdy blokady zapisu.
final class LocalCacheWriter: @unchecked Sendable {
    private let state = NSLock()
    private let writing = NSLock()
    private var epoch = 0

    /// Bieżące pokolenie zapisów.
    var current: Int {
        state.lock(); defer { state.unlock() }
        return epoch
    }

    /// Unieważnia zapisy zlecone wcześniej (przed usunięciem kopii).
    func invalidate() {
        state.lock(); defer { state.unlock() }
        epoch += 1
    }

    /// Zapis kopii zleconej w pokoleniu `generation` (w tle). `false` — zapis się nie udał; zapis unieważniony jest pomijany.
    func save(_ snapshot: Snapshot, to cache: LocalCache, generation: Int) -> Bool {
        writing.lock(); defer { writing.unlock() }
        guard generation == current else { return true }
        do {
            try cache.save(snapshot)
            return true
        } catch {
            return false
        }
    }

    /// Usuwa kopię po zakończeniu trwającego zapisu (w tle).
    func clear(_ cache: LocalCache) throws {
        writing.lock(); defer { writing.unlock() }
        try cache.clear()
    }
}
