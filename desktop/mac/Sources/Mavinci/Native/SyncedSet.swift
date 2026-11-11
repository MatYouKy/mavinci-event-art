import Foundation

/// Pozycja zbioru synchronizowanego z serwerem — klucz to `id` pozycji na serwerze (`src/lib/native/sync.ts`).
protocol SyncKeyed: Codable {
    var syncKey: String { get }
}

/// Stan zbioru na serwerze: skrót całości, szerokość koszyków i (gdy skrót u nas jest inny) skróty koszyków.
struct SyncedSetState: Decodable {
    let hash: String
    let width: Int
    let buckets: [String: String]?
}

/// Kopia jednego zbioru na dysku: pozycje i skróty koszyków. Synchronizacja pobiera tylko koszyki o innym skrócie
/// (także usunięcia) — ten sam model co Wiadomości i katalog Magazynu.
struct SyncedSet<Item: SyncKeyed>: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [Item] = []

    /// Nowa kopia po porównaniu ze stanem serwera albo `nil`, gdy nic się nie zmieniło. `fetch` dostaje listę koszyków
    /// i zwraca ich pozycje (sam obsługuje dzielenie odpowiedzi — `more`).
    func merged(with state: SyncedSetState, fetch: ([String]) async throws -> [Item]) async throws -> SyncedSet<Item>? {
        guard state.hash != hash, let server = state.buckets else { return nil }
        let replaceAll = state.width != width
        let changed = Set(replaceAll ? Array(server.keys) : server.filter { buckets[$0.key] != $0.value }.map(\.key))
        let vanished = Set(buckets.keys).subtracting(server.keys)
        let fetched = changed.isEmpty ? [] : try await fetch(changed.sorted())
        var byKey: [String: Item] = [:]
        if !replaceAll {
            for item in items {
                let bucket = mailBucket(item.syncKey, width: state.width)
                if !changed.contains(bucket) && !vanished.contains(bucket) { byKey[item.syncKey] = item }
            }
        }
        for item in fetched { byKey[item.syncKey] = item }
        var next = self
        next.items = Array(byKey.values)
        next.buckets = server
        next.width = state.width
        next.hash = state.hash
        return next
    }

    /// Podmiana jednej pozycji (np. świeżo pobrana karta po zapisie) — kolejna synchronizacja i tak porówna koszyk.
    mutating func upsert(_ item: Item) {
        if let index = items.firstIndex(where: { $0.syncKey == item.syncKey }) { items[index] = item } else { items.append(item) }
    }
    mutating func remove(_ key: String) { items.removeAll { $0.syncKey == key } }
}
