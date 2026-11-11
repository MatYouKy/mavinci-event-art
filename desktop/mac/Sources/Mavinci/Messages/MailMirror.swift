import Foundation
import CryptoKit

/// Stan kopii Wiadomości: metadane wszystkich widocznych wiadomości, skróty koszyków synchronizacji, lejek, zajawki i skrzynki.
struct MailIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [MessageItem] = []
    var sales: [String: SalesContext] = [:]
    var previews: [String: String] = [:]
    var info: MailboxInfo?
    var syncedAt: Date?
    var salesAt: Date?
}

/// Koszyk synchronizacji pozycji — pierwsze znaki `sha1(klucz)`, tak samo jak na serwerze (`src/lib/native/sync.ts`).
func mailBucket(_ key: String, width: Int) -> String {
    String(Insecure.SHA1.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined().prefix(width))
}

/// Kopia Wiadomości na dysku Maca (Application Support/Mavinci/Desktop/v1/mail-…): indeks i treść każdej wiadomości
/// w osobnym pliku, wszystko szyfrowane AES-GCM kluczem z pęku kluczy — jak pozostałe dane lokalne aplikacji.
/// Operacje plikowe nie zależą od wątku głównego (zapis treści w tle podczas pobierania).
struct MailMirror: @unchecked Sendable {
    let namespace: String
    private let key: SymmetricKey
    let folder: URL

    init(namespace: String) throws {
        self.namespace = namespace
        folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mavinci/Desktop/v1/\(namespace)", isDirectory: true)
        let account = "cache-key-\(namespace)"
        if let data = try Vault.read(account) { key = SymmetricKey(data: data) }
        else {
            // Bez klucza zapisane pliki (np. z dawnym kluczem) są nieczytelne — kopia buduje się od nowa.
            try? FileManager.default.removeItem(at: folder)
            let created = SymmetricKey(size: .bits256)
            try Vault.write(account, created.withUnsafeBytes { Data($0) })
            key = created
        }
        try FileManager.default.createDirectory(at: bodies, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
    private var bodies: URL { folder.appendingPathComponent("bodies", isDirectory: true) }
    private var indexFile: URL { folder.appendingPathComponent("index.sealed") }
    static func fileName(_ key: String) -> String {
        Insecure.SHA1.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func read(_ url: URL) -> Data? {
        guard let data = try? Data(contentsOf: url), let box = try? AES.GCM.SealedBox(combined: data) else { return nil }
        return try? AES.GCM.open(box, using: key)
    }
    private func write(_ data: Data, to url: URL) throws {
        guard let sealed = try AES.GCM.seal(data, using: key).combined else { throw AppError.server }
        try sealed.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func loadIndex() -> MailIndex? { read(indexFile).flatMap { try? JSONDecoder().decode(MailIndex.self, from: $0) } }
    func saveIndex(_ index: MailIndex) throws { try write(JSONEncoder().encode(index), to: indexFile) }
    func body(_ key: String) -> Data? { read(bodies.appendingPathComponent(Self.fileName(key))) }
    func saveBody(_ key: String, _ data: Data) throws { try write(data, to: bodies.appendingPathComponent(Self.fileName(key))) }
    func removeBodies(_ keys: [String]) {
        for key in keys { try? FileManager.default.removeItem(at: bodies.appendingPathComponent(Self.fileName(key))) }
    }
    private var attachments: URL { folder.appendingPathComponent("attachments", isDirectory: true) }
    /// Załącznik otwarty raz — kolejne otwarcia bez pobierania (zaszyfrowany jak treść).
    func attachment(_ id: String) -> Data? { read(attachments.appendingPathComponent(Self.fileName("attachment:\(id)"))) }
    func saveAttachment(_ id: String, _ data: Data) throws {
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try write(data, to: attachments.appendingPathComponent(Self.fileName("attachment:\(id)")))
    }
    /// Nazwy plików zapisanych treści (skróty kluczy).
    func storedBodies() -> Set<String> { Set((try? FileManager.default.contentsOfDirectory(atPath: bodies.path)) ?? []) }
    /// Wylogowanie: najpierw klucz, potem pliki — kopia staje się nieczytelna nawet przy przerwanym usuwaniu.
    func clear() {
        try? Vault.delete("cache-key-\(namespace)")
        try? FileManager.default.removeItem(at: folder)
    }
}
