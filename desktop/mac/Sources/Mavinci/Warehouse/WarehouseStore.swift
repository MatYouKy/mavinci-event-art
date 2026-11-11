import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// Kopia magazynu na dysku: katalog, pełne karty sprzętu (z jednostkami, składem, galerią, plikami i historią), zestawy
/// i przewody — każdy zbiór ze skrótami koszyków (`src/lib/native/sync.ts`), do tego słowniki i uprawnienia.
struct WarehouseIndex: Codable {
    var catalog = SyncedSet<WarehouseEntry>()
    var details = SyncedSet<EquipmentDetail>()
    var kits = SyncedSet<WarehouseKit>()
    var cables = SyncedSet<WarehouseCable>()
    var rental = SyncedSet<RentalItem>()
    var cableCategories: [CableCategory] = []
    var access: WarehouseAccess?
    var categories: [WarehouseCategory] = []
    var locations: [WarehouseLocation] = []
    var connectors: [ConnectorOption] = []
    var syncedAt: Date?
}

/// Odpowiedź `op=items` dla dowolnego zbioru magazynu.
struct WarehouseItemsReply<Item: Decodable>: Decodable {
    struct Bucket: Decodable { let items: [Item] }
    let buckets: [String: Bucket]
    let more: [String]
}

/// Magazyn z kopii na dysku: lista, karty sprzętu i zestawy od razu (także bez sieci); synchronizacja pobiera tylko zmienione
/// koszyki każdego zbioru. Zapisy przez `/bridge/native/v1/warehouse` — RLS jak w CRM.
@MainActor final class WarehouseStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var entries: [WarehouseEntry] = []
    @Published private(set) var details: [String: EquipmentDetail] = [:]
    @Published private(set) var kits: [WarehouseKit] = []
    @Published private(set) var cables: [WarehouseCable] = []
    @Published private(set) var rental: [RentalItem] = []
    @Published private(set) var cableCategories: [CableCategory] = []
    @Published private(set) var access: WarehouseAccess?
    @Published private(set) var categories: [WarehouseCategory] = []
    @Published private(set) var locations: [WarehouseLocation] = []
    @Published private(set) var connectors: [ConnectorOption] = []
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    /// Otwarta karta sprzętu (`/crm/equipment/<id>`); `nil` — lista.
    @Published var openedID: String?
    /// Otwarty zestaw (`/crm/equipment/kits?edit=<id>`); `nil` — lista zestawów.
    @Published var openedKitID: String?
    /// Otwarta karta przewodu (`/crm/equipment/cables/<id>`); `nil` — lista przewodów.
    @Published var openedCableID: String?
    /// Kategorie przewodów (`/crm/equipment/cables/categories`) zamiast listy.
    @Published var cableCategoriesShown = false
    /// Otwarta karta sprzętu wynajmu (`/crm/subcontractors/rental/<id>`).
    @Published var openedRentalID: String?
    @Published var detailError: String?

    private var namespace: String?
    private var file: SealedFile<WarehouseIndex>?
    private var index = WarehouseIndex()
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.catalog.items.isEmpty) }
    var canManage: Bool { access?.canManage ?? false }
    func entry(_ id: String?) -> WarehouseEntry? { id.flatMap { id in entries.first { $0.id == id && !$0.isKit } } }
    func kitEntry(_ id: String?) -> WarehouseEntry? { id.flatMap { id in entries.first { $0.id == id && $0.isKit } } }
    func kit(_ id: String?) -> WarehouseKit? { id.flatMap { id in kits.first { $0.id == id } } }
    func cable(_ id: String?) -> WarehouseCable? { id.flatMap { id in cables.first { $0.id == id } } }
    func rentalItem(_ id: String?) -> RentalItem? { id.flatMap { id in rental.first { $0.id == id } } }
    func cableCategory(_ id: String?) -> CableCategory? { id.flatMap { id in cableCategories.first { $0.id == id } } }
    func category(_ id: String?) -> WarehouseCategory? { id.flatMap { id in categories.first { $0.id == id } } }
    func location(_ id: String?) -> WarehouseLocation? { id.flatMap { id in locations.first { $0.id == id } } }
    func connector(_ id: String?) -> ConnectorOption? { id.flatMap { id in connectors.first { $0.id == id } } }
    /// Ścieżka kategorii („Nagłośnienie > Mikrofony”) jak `getCategoryPath`.
    func categoryPath(_ id: String?) -> String {
        var chain: [String] = []
        var current = category(id)
        var guardCount = 0
        while let item = current, guardCount < 10 {
            chain.insert(item.name, at: 0)
            current = category(item.parentId)
            guardCount += 1
        }
        return chain.joined(separator: " > ")
    }
    /// Kategorie w kolejności drzewa (rodzic, potem jego podkategorie) — do wyboru w formularzach.
    var categoryTree: [WarehouseCategory] {
        let roots = categories.filter { $0.parentId == nil }.sorted { $0.order < $1.order }
        var result: [WarehouseCategory] = []
        func add(_ item: WarehouseCategory) {
            result.append(item)
            for child in categories.filter({ $0.parentId == item.id }).sorted(by: { $0.order < $1.order }) { add(child) }
        }
        roots.forEach(add)
        let placed = Set(result.map(\.id))
        return result + categories.filter { !placed.contains($0.id) }
    }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<WarehouseIndex>(namespace: "warehouse-v2-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved { index = saved; publish(); lastSync = saved.syncedAt }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = WarehouseIndex()
        entries = []; details = [:]; kits = []; cables = []; rental = []; cableCategories = []; access = nil; categories = []; locations = []; connectors = []
        syncing = false; lastSync = nil; loadError = nil; openedID = nil; openedKitID = nil; detailError = nil
        openedCableID = nil; cableCategoriesShown = false; openedRentalID = nil
    }
    /// Kolejność jak w CRM: sprzęt i zestawy od najnowszych, przewody alfabetycznie.
    private func publish() {
        entries = index.catalog.items.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        details = Dictionary(index.details.items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        kits = index.kits.items.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        cables = index.cables.items.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        rental = index.rental.items.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        cableCategories = index.cableCategories.sorted { ($0.order, $0.name) < ($1.order, $1.name) }
        access = index.access; categories = index.categories; locations = index.locations; connectors = index.connectors
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, let file = self.file else { return }
            let snapshot = self.index
            await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
        }
    }

    // MARK: Synchronizacja
    func sync(force: Bool = false) async {
        if let syncTask { await syncTask.value; if !force { return } }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }
    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        guard file != nil else { return }
        await sync()
    }
    /// Pozycje wskazanych koszyków zbioru (`set`), z dociąganiem reszty (`more`).
    private func fetchItems<Item: Decodable>(_ set: String, _ buckets: [String], as type: Item.Type) async throws -> [Item] {
        guard let api else { throw AppError.configuration }
        var fetched: [Item] = []
        var pending = buckets
        while !pending.isEmpty {
            let data = try await api.post("/warehouse", ["op": .string("items"), "set": .string(set), "buckets": .array(pending.map { .string($0) })])
            let reply = try JSONDecoder().decode(WarehouseItemsReply<Item>.self, from: data)
            for bucket in reply.buckets.values { fetched += bucket.items }
            pending = reply.more
        }
        return fetched
    }
    private func performSync() async {
        guard let api, file != nil else { return }
        syncing = true
        defer { syncing = false }
        struct State: Decodable {
            let hash: String; let width: Int; let buckets: [String: String]?; let access: WarehouseAccess?
            let categories: [WarehouseCategory]?; let locations: [WarehouseLocation]?; let connectors: [ConnectorOption]?
            let cableCategories: [CableCategory]?
            let sets: [String: SyncedSetState]?
        }
        do {
            let query = ["op": "state", "hash": index.catalog.hash, "h_details": index.details.hash, "h_kits": index.kits.hash,
                         "h_cables": index.cables.hash, "h_rental": index.rental.hash]
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/warehouse", query: query))
            if let next = state.access { index.access = next }
            if let next = state.categories { index.categories = next }
            if let next = state.locations { index.locations = next }
            if let next = state.connectors { index.connectors = next }
            if let next = state.cableCategories { index.cableCategories = next }
            let catalog = index.catalog
            if let next = try await catalog.merged(with: SyncedSetState(hash: state.hash, width: state.width, buckets: state.buckets),
                                                   fetch: { try await self.fetchItems("catalog", $0, as: WarehouseEntry.self) }) { index.catalog = next }
            if let remote = state.sets?["details"] {
                let current = index.details
                // Błąd jednego zbioru nie zatrzymuje pozostałych (kolejna synchronizacja spróbuje ponownie).
                if let next = try? await current.merged(with: remote, fetch: { try await self.fetchItems("details", $0, as: EquipmentDetail.self) }) { index.details = next }
            }
            if let remote = state.sets?["kits"] {
                let current = index.kits
                // Błąd jednego zbioru nie zatrzymuje pozostałych (kolejna synchronizacja spróbuje ponownie).
                if let next = try? await current.merged(with: remote, fetch: { try await self.fetchItems("kits", $0, as: WarehouseKit.self) }) { index.kits = next }
            }
            if let remote = state.sets?["cables"] {
                let current = index.cables
                // Błąd jednego zbioru nie zatrzymuje pozostałych (kolejna synchronizacja spróbuje ponownie).
                if let next = try? await current.merged(with: remote, fetch: { try await self.fetchItems("cables", $0, as: WarehouseCable.self) }) { index.cables = next }
            }
            if let remote = state.sets?["rental"] {
                let current = index.rental
                // Błąd jednego zbioru nie zatrzymuje pozostałych (kolejna synchronizacja spróbuje ponownie).
                if let next = try? await current.merged(with: remote, fetch: { try await self.fetchItems("rental", $0, as: RentalItem.self) }) { index.rental = next }
            }
            publish()
            index.syncedAt = Date(); lastSync = index.syncedAt; loadError = nil; detailError = nil
            scheduleSave()
        } catch {
            if index.catalog.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać magazynu.") }
        }
    }

    // MARK: Karta sprzętu
    /// Świeża karta jednego sprzętu (po zapisie albo gdy nie ma jej jeszcze w kopii) — trafia też do kopii na dysku.
    func loadDetail(_ id: String) async {
        guard let api else { return }
        do {
            let detail = try JSONDecoder().decode(EquipmentDetail.self, from: try await api.get("/warehouse", query: ["op": "detail", "id": id]))
            index.details.upsert(detail)
            details[id] = detail
            detailError = nil
            scheduleSave()
        } catch {
            if details[id] == nil { detailError = failureText(error, "Nie udało się pobrać sprzętu.") }
        }
    }
    /// Otwarcie karty: kopia z dysku od razu, w tle synchronizacja zmienionych koszyków.
    func openDetail(_ id: String) async {
        if details[id] == nil { await loadDetail(id) }
        await sync()
    }
    func unitEvents(_ unitID: String) async throws -> [UnitEvent] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let events: [UnitEvent] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/warehouse", query: ["op": "unitEvents", "id": unitID])).events
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }
    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        let data = try await api.post("/warehouse", payload)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }
    /// Czynność z paskiem postępu i komunikatem; po sukcesie odświeża kartę i katalog.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?, reload equipmentID: String? = nil) async -> [String: JSONValue]? {
        var reply: [String: JSONValue]?
        await workspace?.withPending(pending) {
            do {
                reply = try await post(op, body)
                if let message = reply?["message"]?.text.nonEmpty ?? success { workspace?.succeed(message) }
                if let equipmentID { await loadDetail(equipmentID) }
                Task { await sync(force: true) }
            } catch { workspace?.error = failureText(error, "Nie udało się wykonać czynności.") }
        }
        return reply
    }

    func delete(_ entry: WarehouseEntry) async -> Bool {
        let reply = await run("Usuwanie…", "delete", ["id": .string(entry.id), "kind": .string(entry.kind)], success: entry.isKit ? "Zestaw usunięty" : "Sprzęt został usunięty")
        guard reply != nil else { return false }
        index.catalog.remove(entry.key)
        if entry.isKit { index.kits.remove(entry.id) } else { index.details.remove(entry.id) }
        publish(); scheduleSave()
        if openedID == entry.id { openedID = nil }
        if openedKitID == entry.id { openedKitID = nil }
        return true
    }
    func deleteKit(_ kit: WarehouseKit) async -> Bool {
        let entry = kitEntry(kit.id) ?? WarehouseEntry(key: "kit:\(kit.id)", id: kit.id, kind: "kit", name: kit.name, brand: "", model: "", categoryId: kit.categoryId,
                                                      thumbnailUrl: kit.thumbnailUrl, description: kit.description, createdAt: kit.createdAt, active: kit.active,
                                                      unitsTotal: 0, unitsAvailable: 0, simpleQuantity: nil, usable: 0)
        return await delete(entry)
    }
    /// Zapis zestawu (nowy albo edycja) — zwraca id zestawu.
    func saveKit(id: String?, data: [String: JSONValue], items: [KitDraftItem]) async -> String? {
        let body: [String: JSONValue] = [
            "id": .string(id ?? ""), "data": .object(data),
            "items": .array(items.map { item in
                .object(["equipmentId": .string(item.equipmentId ?? ""), "cableId": .string(item.cableId ?? ""),
                         "quantity": .number(Double(item.quantity)), "notes": .string(item.notes)])
            }),
        ]
        var saved: String?
        await workspace?.withPending("Zapisywanie…") {
            do {
                let reply = try await post("kitSave", body)
                saved = reply["id"]?.text.nonEmpty ?? id
                workspace?.succeed(id == nil ? "Zestaw utworzony" : "Zestaw zaktualizowany")
                await sync(force: true)
            } catch { workspace?.error = failureText(error, "Błąd podczas zapisywania zestawu") }
        }
        return saved
    }

    /// Plik wysłany przez serwer CRM (multipart, pole „file”) — `query` wybiera operację (`image`, `gallery`, `file`).
    @discardableResult func upload(_ query: [String: String], data payload: Data, filename: String, mime: String) async throws -> [String: JSONValue] {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/warehouse") else { throw AppError.configuration }
        components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else { throw AppError.configuration }
        let boundary = "mavinci-\(UUID().uuidString)"
        let safeName = filename.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(payload)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Błąd podczas przesyłania pliku", fieldErrors: [:])
        }
        return object
    }
    /// Zdjęcie (JPEG) przez serwer CRM do magazynu `site-images` — zwraca adres.
    func uploadImage(_ jpeg: Data, folder: String) async throws -> String {
        let reply = try await upload(["op": "image", "folder": folder], data: jpeg, filename: "zdjecie.jpg", mime: "image/jpeg")
        guard let address = reply["url"]?.text.nonEmpty else { throw NativeFailure(status: 500, message: "Błąd podczas przesyłania zdjęcia", fieldErrors: [:]) }
        return address
    }
    /// Zdjęcia do galerii i pliki sprzętu — po kolei, z paskiem postępu; zdjęcia ponad 10 MB zmniejszane do JPEG.
    func uploadEquipmentFiles(_ urls: [URL], equipmentID: String, gallery: Bool) async {
        guard !urls.isEmpty else { return }
        var failures: [String] = []
        var sent = 0
        for (number, url) in urls.enumerated() {
            let label = urls.count > 1 ? "Przesyłanie \(number + 1)/\(urls.count)…" : "Przesyłanie…"
            await workspace?.withPending(label) {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    var data = try Data(contentsOf: url)
                    var name = url.lastPathComponent
                    var mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    if gallery {
                        guard mime.hasPrefix("image/") else { failures.append("\(name) nie jest obrazem"); return }
                        if data.count > 10 * 1024 * 1024 {
                            guard let jpeg = ImageJPEG.from(url, maxSide: 3000) else { failures.append("\(name) przekracza 10MB"); return }
                            data = jpeg; mime = "image/jpeg"; name = url.deletingPathExtension().lastPathComponent + ".jpg"
                        }
                    } else if data.count > 50 * 1024 * 1024 {
                        failures.append("\(name) przekracza 50MB"); return
                    }
                    try await upload(["op": gallery ? "gallery" : "file", "equipmentId": equipmentID], data: data, filename: name, mime: mime)
                    sent += 1
                } catch {
                    failures.append(failureText(error, "Błąd przesyłania \(url.lastPathComponent)"))
                }
            }
        }
        if !failures.isEmpty { workspace?.error = failures.joined(separator: "\n") }
        if sent > 0 {
            workspace?.succeed(gallery ? "Przesyłanie zakończone" : "Pliki przesłane")
            await loadDetail(equipmentID)
            Task { await sync(force: true) }
        }
    }
}

extension Workspace {
    /// Karta przewodu na ekranie Przewody (`/crm/equipment/cables/<id>`).
    func showCable(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/equipment/cables" }) {
            openHref("/crm/equipment/cables")
            warehouse.cableCategoriesShown = false
            warehouse.openedCableID = id
            if warehouse.cable(id) == nil { Task { await warehouse.sync(force: true) } }
        } else {
            openCRM("/crm/equipment/cables/\(id)")
        }
    }
    /// Zestaw na ekranie Zestawy (`/crm/equipment/kits?edit=<id>`).
    func showKit(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/equipment/kits" }) {
            openHref("/crm/equipment/kits")
            warehouse.openedKitID = id
            if warehouse.kit(id) == nil { Task { await warehouse.sync(force: true) } }
        } else {
            openCRM("/crm/equipment/kits?edit=\(id)")
        }
    }
    /// Karta sprzętu na ekranie Magazynu (`/crm/equipment/<id>`).
    func showEquipment(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/equipment" }) {
            openHref("/crm/equipment")
            warehouse.openedID = id
            if warehouse.entry(id) == nil { Task { await warehouse.sync(force: true) } }
        } else {
            openCRM("/crm/equipment/\(id)")
        }
    }
}
