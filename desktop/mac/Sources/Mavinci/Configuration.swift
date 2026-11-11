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
    static func load() -> Connection {
        if let data = try? Vault.read("connection"), let c = try? JSONDecoder().decode(Connection.self, from: data) { return c }
        if let u = Bundle.main.url(forResource: "Configuration", withExtension: "json"),
           let data = try? Data(contentsOf: u), let c = try? JSONDecoder().decode(Connection.self, from: data) { return c }
        let e = ProcessInfo.processInfo.environment
        if let file = e["MAVINCI_CONFIGURATION_FILE"], let data = try? Data(contentsOf: URL(fileURLWithPath: file)),
           let c = try? JSONDecoder().decode(Connection.self, from: data) { return c }
        return Connection(url: e["SUPABASE_URL"] ?? "", publicKey: e["SUPABASE_ANON_KEY"] ?? "")
    }
    func save() throws { try Vault.write("connection", JSONEncoder().encode(self)) }
}
func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }

enum Vault {
    static let service = "pl.mavinci.desktop"
    static func read(_ key: String) throws -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw AppError.server }
        return result as? Data
    }
    static func write(_ key: String, _ data: Data) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: key]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw AppError.server }
        } else if status != errSecSuccess { throw AppError.server }
    }
    static func delete(_ key: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AppError.server }
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
        let clear = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key())
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
