import Foundation
import CryptoKit

/// Błąd natywnego API CRM: komunikat dla pracownika i błędy przy polach formularza (klucze jak ścieżki pól, np. `lines.0.quantity`).
struct NativeFailure: Error, LocalizedError {
    let status: Int
    let message: String
    let fieldErrors: [String: String]
    var errorDescription: String? { message }
}

/// Natywne API serwera CRM (`/bridge/native/v1`, `src/lib/native/*`) — token zalogowanego pracownika, więc uprawnienia jak w CRM (RLS).
struct NativeAPI {
    let base: String
    let backend: HTTPBackend
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 180; c.httpShouldSetCookies = false
        return URLSession(configuration: c)
    }()
    func post(_ path: String, _ body: [String: JSONValue]) async throws -> Data {
        try await send(path, method: "POST", body: body)
    }
    func get(_ path: String) async throws -> Data {
        try await send(path, method: "GET", body: nil)
    }
    private func send(_ path: String, method: String, body: [String: JSONValue]?) async throws -> Data {
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1" + path) else { throw AppError.configuration }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        req.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = try JSONEncoder().encode(body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await Self.session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if (200..<300).contains(http.statusCode) { return data }
        if http.statusCode == 401 { throw AppError.unauthorized }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let fields = ((object?["fieldErrors"] as? [String: Any]) ?? [:]).compactMapValues { $0 as? String }
        throw NativeFailure(status: http.statusCode, message: object?["error"] as? String ?? "Serwer CRM nie wykonał operacji (\(http.statusCode)).", fieldErrors: fields)
    }
    /// Czynność z karty: {action, id, revision, key, data} → odpowiedź serwera ({ok, id?, message?, record?}).
    func action(_ action: DocAction, record: DocRecord?, data: [String: JSONValue], key: String) async throws -> [String: JSONValue] {
        var merged = action.data
        for (k, v) in data { merged[k] = v }
        let body: [String: JSONValue] = [
            "action": .string(action.key), "id": .string(record?.id ?? ""), "revision": .number(Double(record?.revision ?? 0)),
            "key": .string(key), "data": .object(merged),
        ]
        let reply = try await post("/docs/action", body)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: reply)) ?? [:]
    }
}

/// Zaszyfrowany plik w Application Support (klucz w pęku kluczy) — jak `LocalCache`, dla dowolnej wartości.
struct SealedFile<Value: Codable> {
    let namespace: String
    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/Desktop/v1/\(namespace).sealed")
    }
    private func key() throws -> SymmetricKey {
        let account = "cache-key-\(namespace)"
        if let data = try Vault.read(account) { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        try Vault.write(account, key.withUnsafeBytes { Data($0) })
        return key
    }
    func load() throws -> Value? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let clear = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: file)), using: key())
        return try JSONDecoder().decode(Value.self, from: clear)
    }
    func save(_ value: Value) throws {
        let sealed = try AES.GCM.seal(JSONEncoder().encode(value), using: key())
        guard let data = sealed.combined else { throw AppError.server }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    func clear() throws {
        try Vault.delete("cache-key-\(namespace)")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}

/// Lokalna kopia kart z serwera CRM (serwer jest jedynym źródłem prawdy). Widoki czytają z pamięci — natychmiast, także bez internetu;
/// synchronizacja pobiera tylko koszyki zbiorów, których skrót się zmienił (`src/lib/native/sync.ts`). Bez połączenia dane są tylko do odczytu.
@MainActor final class NativeStore: ObservableObject {
    @Published private(set) var sections: [DocSectionMeta] = []
    @Published private(set) var records: [String: [DocRecord]] = [:]
    @Published private(set) var syncing = false
    @Published private(set) var error: String?
    @Published private(set) var lastSync: Date?

    private struct BucketState: Codable { var hash: String; var items: [JSONValue] }
    private struct SetState: Codable { var hash: String; var width: Int; var buckets: [String: BucketState] }
    private struct Saved: Codable { var sets: [String: SetState]; var lastSync: Date? }
    private struct RemoteSet: Decodable { let hash: String; let count: Int?; let width: Int; let buckets: [String: String]? }
    private struct RemoteState: Decodable { let complete: Bool?; let sets: [String: RemoteSet] }
    private struct RemoteBucket: Decodable { let hash: String; let items: [JSONValue] }
    private struct RemoteItems: Decodable { let buckets: [String: RemoteBucket]; let more: [String]? }

    private var sets: [String: SetState] = [:]
    private var file: SealedFile<Saved>?

    /// Kopia danych konta (przestrzeń nazw jak kopia obszaru roboczego: połączenie + konto).
    func open(namespace: String) {
        let next = SealedFile<Saved>(namespace: "native-\(namespace)")
        if file?.namespace == next.namespace { return }
        reset(); file = next
        if let saved = try? next.load() { sets = saved.sets; lastSync = saved.lastSync; for name in sets.keys { decode(name) } }
    }
    func clear() { try? file?.clear(); file = nil; reset() }
    private func reset() { sets = [:]; sections = []; records = [:]; error = nil; lastSync = nil; syncing = false }

    func meta(_ set: String) -> DocSectionMeta? { sections.first { $0.id == set } }
    func record(_ set: String, id: String) -> DocRecord? { records[set]?.first { $0.id == id } }

    /// Synchronizacja: skróty zbiorów → skróty koszyków (gdy różne) → treść tylko zmienionych koszyków.
    func sync(_ api: NativeAPI) async {
        guard file != nil, !syncing else { return }
        syncing = true
        defer { syncing = false }
        do {
            let local = sets.mapValues { JSONValue.object(["hash": .string($0.hash)]) }
            let state = try JSONDecoder().decode(RemoteState.self, from: await api.post("/sync", ["sets": .object(local)]))
            if state.complete != false { for name in sets.keys where state.sets[name] == nil { sets[name] = nil; records[name] = nil; if name == "sections" { sections = [] } } }
            for (name, remote) in state.sets where remote.hash != sets[name]?.hash {
                var current = sets[name] ?? SetState(hash: "", width: remote.width, buckets: [:])
                if current.width != remote.width { current = SetState(hash: "", width: remote.width, buckets: [:]) }
                let serverBuckets = remote.buckets ?? [:]
                for key in current.buckets.keys where serverBuckets[key] == nil { current.buckets[key] = nil }
                var pending = serverBuckets.filter { current.buckets[$0.key]?.hash != $0.value }.map(\.key).sorted()
                while !pending.isEmpty {
                    let batch = Array(pending.prefix(64))
                    let reply = try JSONDecoder().decode(RemoteItems.self, from: await api.post("/sync/items", ["set": .string(name), "buckets": .array(batch.map(JSONValue.string))]))
                    for (key, bucket) in reply.buckets {
                        if bucket.hash.isEmpty && bucket.items.isEmpty { current.buckets[key] = nil } else { current.buckets[key] = BucketState(hash: bucket.hash, items: bucket.items) }
                    }
                    let done = Set(batch).subtracting(reply.more ?? [])
                    if done.isEmpty { break }
                    pending.removeAll { done.contains($0) }
                }
                current.hash = remote.hash
                sets[name] = current
                decode(name)
            }
            lastSync = Date(); error = nil
            try? file?.save(Saved(sets: sets, lastSync: lastSync))
        } catch let failure as NativeFailure { error = failure.message }
        catch AppError.unauthorized { error = AppError.unauthorized.localizedDescription }
        catch is URLError { error = "Brak połączenia z serwerem CRM. Dostępna jest zapisana kopia do odczytu." }
        catch { self.error = "Nie udało się pobrać danych z serwera CRM." }
    }

    private func decode(_ name: String) {
        guard let state = sets[name] else { return }
        let items = state.buckets.keys.sorted().flatMap { state.buckets[$0]?.items ?? [] }
        guard let data = try? JSONEncoder().encode(items) else { return }
        if name == "sections" {
            sections = ((try? JSONDecoder().decode(LossyList<DocSectionMeta>.self, from: data))?.items ?? []).sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        } else {
            let rows = (try? JSONDecoder().decode(LossyList<DocRecord>.self, from: data))?.items ?? []
            records[name] = rows.sorted { $0.createdAt == $1.createdAt ? $0.id > $1.id : $0.createdAt > $1.createdAt }
        }
    }
}
