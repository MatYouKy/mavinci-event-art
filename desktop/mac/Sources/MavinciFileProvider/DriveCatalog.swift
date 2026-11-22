import CryptoKit
import FileProvider
import Foundation
import UniformTypeIdentifiers

// MARK: Dysk w Finderze — Mavinci → Finanse, Oferty, Kalkulacje, Umowy, Magazyn, Pracownicy i „Z księgi znaku” w Materiałach
//
// Finanse (tylko osoby z dostępem do faktur firmy; Bank oraz Podatki i ZUS — od „Finanse — podgląd”): firma → Księgowość →
// rok → miesiąc → Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF (faktury, wizualizacje KSeF, dokumenty spoza KSeF,
// wyciągi, deklaracje — tylko do odczytu; miesiąc jak w przekazaniu księgowej), Dokumenty spółki → kategoria i Umowy stałe →
// umowa (od „Finanse — podgląd”; pliki dodaje „Finanse — zarządzanie” — serwer oznacza takie foldery polem `upload`).
// Oferty, Kalkulacje i Umowy: rok → miesiąc → PDF z CRM („OF-2026-11-020 — Klient — tytuł.pdf”), Magazyn: kategoria → sprzęt →
// zdjęcia, pliki i instrukcja, Pracownicy: pracownik → Zdjęcia, Dokumenty, Umowy (foldery według uprawnień, jak zakładki
// profilu), a w folderze „Logotypy i księga znaku” każdej marki (Materiały) — folder „Z księgi znaku”
// z logotypami, fontami i plikiem „Kolory marki.txt” (Ustawienia → Moje firmy → Księga znaku). Ten sam układ co Dysk w CRM,
// na Macu i w telefonie (`/bridge/native/v1/drive`, `src/lib/drive/drive.server.ts`).
// Kopia całego drzewa (bez treści plików) w kontenerze rozszerzenia; treść pobiera się przy otwarciu. Drzewo wczytuje się
// od nowa przy sprawdzaniu zmian, gdy kopia ma ponad 10 minut albo aplikacja zgłosiła zmianę (`FinderShared.markDriveChanged`);
// różnicę z tym, co Finder już zna, oddaje zbiór roboczy (nowe, zmienione i usunięte elementy). Finanse, Oferty, Kalkulacje,
// Umowy i księga znaku są tylko do odczytu (PDF-y i księga znaku powstają w CRM); do sprzętu w Magazynie można dodawać pliki
// z prawem „Zarządzanie magazynem” (zdjęcie do 10 MB — galeria sprzętu, inne pliki do 50 MB — pliki sprzętu, jak w CRM),
// a do „Dokumenty” pracownika — pliki do 50 MB (folder jest tylko u osób, które mogą tam dodawać: sam pracownik,
// „Pracownicy — zarządzanie”).

actor DriveCatalog {
    static let shared = DriveCatalog()

    struct State: Codable {
        var owner = ""
        var sections: [DriveSectionDTO] = []
        var folders: [String: DriveFolderDTO] = [:]
        var files: [String: DriveFileDTO] = [:]
        var brands: [String: DriveBrandDTO] = [:]
        var syncedAt: Date?
        /// Elementy, które Finder już zna (identyfikator → wersja) — z nich liczy się różnica przy sprawdzaniu zmian.
        var reported: [String: String] = [:]
        var cursor: String?
        /// Rozmiary plików, których serwer nie podaje (PDF-y z CRM, Finanse) — poznane przy pobraniu, dla tej samej wersji pliku.
        /// Opcjonalne: kopia zapisana przez starszą wersję rozszerzenia nie ma tego pola.
        var sizes: [String: KnownSize]?
    }

    struct KnownSize: Codable {
        var version: String
        var size: Int64
    }

    struct ChangeSet {
        var updated: [NSFileProviderItem] = []
        var deleted: [NSFileProviderItemIdentifier] = []
        var cursor: String?
    }

    /// Treść pliku: adres w magazynie albo dane tworzone na miejscu („Kolory marki.txt”).
    enum Content {
        case remote(URL, NSFileProviderItem)
        case data(Data, NSFileProviderItem)
    }

    private var state = State()
    private var opened = false
    private static let ttl: TimeInterval = 10 * 60
    private static let brandPrefix = "brand:"
    private static let colorsPrefix = "brand-colors:"
    private static let colorsName = "Kolory marki.txt"
    private static let brandFolderName = "Z księgi znaku"
    /// Największy plik sprzętu (jak `DRIVE_UPLOAD_LIMITS.file`).
    private static let maxUpload: Int64 = 50 * 1024 * 1024

    private var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciFinder", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("drive.json")
    }

    private func open() throws {
        guard let owner = FinderShared.owner() else { throw NSFileProviderError(.notAuthenticated) }
        if !opened {
            opened = true
            if let data = try? Data(contentsOf: storeURL), let saved = try? JSONDecoder().decode(State.self, from: data) { state = saved }
        }
        if state.owner != owner { state = State(owner: owner) }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: storeURL, options: .atomic)
    }

    /// Kopia starsza niż 10 minut albo zmiana zgłoszona przez aplikację po ostatnim wczytaniu.
    private var stale: Bool {
        guard let at = state.syncedAt else { return true }
        if Date().timeIntervalSince(at) > Self.ttl { return true }
        if let changed = FinderShared.driveChangedAt(), changed > at { return true }
        return false
    }

    // MARK: Pobieranie z serwera

    private func fullSync() async throws {
        let reply = try await FinderAPI.get(["op": "sync"], as: DriveSyncReply.self, endpoint: .drive)
        state.sections = reply.sections
        state.folders = Dictionary(reply.folders.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        state.files = Dictionary(reply.files.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        // Poznane rozmiary — tylko dla plików nadal bez rozmiaru z serwera i w tej samej wersji.
        state.sizes = state.sizes?.filter { id, known in state.files[id].map { $0.size == nil && $0.version == known.version } ?? false }
        state.brands = Dictionary((reply.brands ?? []).map { ($0.companyId, $0) }, uniquingKeysWith: { _, last in last })
        state.syncedAt = Date()
        save()
    }

    /// Pierwsze wczytanie (błąd przerywa) albo odświeżenie nieaktualnej kopii (bez sieci zostaje kopia z dysku).
    private func ensure() async throws {
        if state.syncedAt == nil {
            try await fullSync()
        } else if stale {
            do { try await fullSync() } catch {
                if FinderSync.isSignedOut(error) { throw error }
                NSLog("[Mavinci Finder] Dysk — odświeżenie: %@", error.localizedDescription)
            }
        }
    }

    // MARK: Odczyt dla Findera

    private var canUpload: Bool { state.sections.first { $0.key == "warehouse" }?.canUpload == true }

    /// Folder „Dokumenty” pracownika (`employees:<id>:documents`) — synchronizacja oddaje go tylko osobom, które mogą tam dodawać.
    private static func isDocuments(_ node: String) -> Bool { node.hasPrefix("employees:") && node.hasSuffix(":documents") }

    /// Czy do folderu można dodać plik z Findera (sprzęt z prawem magazynu, dokumenty pracownika, Dokumenty spółki i umowa stała
    /// z „Finanse — zarządzanie”).
    private func uploadAllowed(_ folder: DriveFolderDTO) -> Bool {
        (folder.kind == "equipment" && canUpload) || Self.isDocuments(folder.id) || Self.isFinanceUpload(folder)
    }

    /// Kategoria Dokumentów spółki albo umowa stała, do której serwer pozwala dodawać pliki.
    private static func isFinanceUpload(_ folder: DriveFolderDTO) -> Bool {
        folder.id.hasPrefix("finance:") && folder.upload == true
    }

    /// Dokąd trafiają pliki (komunikaty jak w aplikacji: `DriveText.uploadPlace`).
    private static func uploadPlace(_ node: String) -> String {
        if isDocuments(node) { return "dokumentów pracownika" }
        if node.hasPrefix("finance:") && node.hasSuffix(":costs") { return "kosztów" }
        if node.hasPrefix("finance:") { return node.contains(":corporate:") ? "dokumentów spółki" : "umowy" }
        return "sprzętu"
    }

    /// Działy Dysku w głównym folderze Mavinci (Oferty, Kalkulacje, Umowy, Magazyn — tylko z dostępem).
    func rootItems() async -> [NSFileProviderItem] {
        do {
            try open()
            try await ensure()
        } catch {
            return []
        }
        let names = self.names(in: nil)
        return state.folders.values.filter { $0.parentId == nil }.map { folderItem($0, names: names) as NSFileProviderItem }
    }

    func children(of container: NSFileProviderItemIdentifier) async throws -> [NSFileProviderItem] {
        try open()
        try await ensure()
        guard case .drive(let node) = FinderID.parse(container) else { throw NSFileProviderError(.noSuchItem) }
        if let company = Self.brandCompany(node) {
            guard state.brands[company] != nil else { throw NSFileProviderError(.noSuchItem) }
        } else {
            guard state.folders[node] != nil else { throw NSFileProviderError(.noSuchItem) }
        }
        return contents(of: node)
    }

    /// „Z księgi znaku” w folderze Materiałów (`mfolder:<id>`), gdy to folder „Logotypy i księga znaku” marki.
    func brandFolders(in container: NSFileProviderItemIdentifier) async -> [NSFileProviderItem] {
        guard case .materialFolder(let id) = FinderID.parse(container) else { return [] }
        do { try open() } catch { return [] }
        if state.syncedAt == nil {
            do { try await fullSync() } catch { return [] }
        }
        return state.brands.values.filter { $0.materialFolderId == id }.map { brandItem($0) as NSFileProviderItem }
    }

    func item(for identifier: NSFileProviderItemIdentifier) async throws -> NSFileProviderItem {
        try open()
        if state.syncedAt == nil { try await fullSync() }
        switch FinderID.parse(identifier) {
        case .drive(let node):
            if let company = Self.brandCompany(node) {
                guard let brand = state.brands[company] else { throw NSFileProviderError(.noSuchItem) }
                return brandItem(brand)
            }
            guard let folder = state.folders[node] else { throw NSFileProviderError(.noSuchItem) }
            return folderItem(folder, names: names(in: folder.parentId))
        case .driveFile(let id):
            if id.hasPrefix(Self.colorsPrefix) {
                guard let colors = colorsItem(company: String(id.dropFirst(Self.colorsPrefix.count))) else { throw NSFileProviderError(.noSuchItem) }
                return colors
            }
            guard let file = state.files[id] else { throw NSFileProviderError(.noSuchItem) }
            return fileItem(file, names: names(in: file.parentId))
        default:
            throw NSFileProviderError(.noSuchItem)
        }
    }

    /// Treść pliku: podpisany (PDF-y) albo publiczny (magazyn, księga znaku) adres; „Kolory marki.txt” — z kopii.
    func content(file id: String) async throws -> Content {
        try open()
        if state.syncedAt == nil { try await fullSync() }
        if id.hasPrefix(Self.colorsPrefix) {
            let company = String(id.dropFirst(Self.colorsPrefix.count))
            guard let brand = state.brands[company], let item = colorsItem(company: company) else { throw NSFileProviderError(.noSuchItem) }
            return .data(Data(Self.colorsText(brand).utf8), item)
        }
        let reply = try await FinderAPI.get(["op": "download", "id": id, "mode": "preview"], as: DriveDownloadReply.self, endpoint: .drive)
        guard let url = URL(string: reply.url) else { throw NSFileProviderError(.serverUnreachable) }
        // Plik spoza kopii (np. dodany przed chwilą w CRM) — kopia od nowa.
        if state.files[id] == nil { try await fullSync() }
        guard let file = state.files[id] else { throw NSFileProviderError(.noSuchItem) }
        return .remote(url, fileItem(file, names: names(in: file.parentId)))
    }

    /// Element dla systemu po pobraniu treści: rozmiar pliku bez rozmiaru z serwera zostaje zapamiętany (wersja treści dostaje
    /// rozmiar — kolejne listy Findera podają już właściwą długość), a element zawsze ma rozmiar faktycznie pobranego pliku.
    func delivered(file id: String, size: Int64) -> NSFileProviderItem? {
        guard let file = state.files[id] else { return nil }
        if file.size == nil, state.sizes?[id]?.version != file.version || state.sizes?[id]?.size != size {
            var sizes = state.sizes ?? [:]
            sizes[id] = KnownSize(version: file.version, size: size)
            state.sizes = sizes
            save()
        }
        let item = fileItem(file, names: names(in: file.parentId))
        return item.documentSize?.int64Value == size ? item : FinderItem(item, documentSize: size)
    }

    // MARK: Zmiany (zbiór roboczy)

    func currentCursor() async -> String? {
        do { try open() } catch { return nil }
        return state.cursor
    }

    /// Różnica między kopią a tym, co Finder zna; kopia wczytuje się od nowa, gdy jest nieaktualna (błąd — kursor bez zmian).
    func changes() async throws -> ChangeSet {
        try open()
        if stale { try await fullSync() }
        let live = liveItems()
        var current: [String: String] = [:]
        for item in live { current[item.itemIdentifier.rawValue] = Self.signature(item) }
        var result = ChangeSet()
        result.updated = live.filter { state.reported[$0.itemIdentifier.rawValue] != current[$0.itemIdentifier.rawValue] }
        result.deleted = state.reported.keys.filter { current[$0] == nil }.map { NSFileProviderItemIdentifier(rawValue: $0) }
        state.reported = current
        state.cursor = Self.stamp()
        save()
        result.cursor = state.cursor
        return result
    }

    /// Zbiór roboczy od nowa (po wygaśnięciu punktu synchronizacji): całe drzewo; bez sieci — kopia z dysku.
    func everything() async throws -> [NSFileProviderItem] {
        try open()
        do { try await fullSync() } catch { if state.syncedAt == nil { throw error } }
        let live = liveItems()
        state.reported = Dictionary(live.map { ($0.itemIdentifier.rawValue, Self.signature($0)) }, uniquingKeysWith: { first, _ in first })
        state.cursor = Self.stamp()
        save()
        return live
    }

    // MARK: Zapis z Findera — pliki do sprzętu w Magazynie i do dokumentów pracownika

    func create(template: NSFileProviderItem, contents: URL?, mayAlreadyExist: Bool) async throws -> NSFileProviderItem {
        try open()
        if FinderName.excluded(template.filename) { throw NSFileProviderError(.excludedFromSync) }
        if state.syncedAt == nil { try await fullSync() }
        guard case .drive(let node) = FinderID.parse(template.parentItemIdentifier), let folder = state.folders[node],
              node.hasPrefix("warehouse:item:") || Self.isDocuments(node) || Self.isFinanceUpload(folder) else {
            throw Self.refused("Ten folder jest tylko do odczytu — pliki dodawaj do sprzętu w Magazynie, do „Dokumenty” pracownika, do Dokumentów spółki albo do umowy stałej w Finansach.")
        }
        let documents = Self.isDocuments(node) || Self.isFinanceUpload(folder)
        let place = Self.uploadPlace(node)
        guard documents || canUpload else {
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError,
                          userInfo: [NSLocalizedDescriptionKey: "Dodawanie plików do sprzętu wymaga prawa „Zarządzanie magazynem”."])
        }
        let type = template.contentType ?? .data
        if type.conforms(to: .folder) || type.conforms(to: .directory) || type.conforms(to: .package) {
            throw Self.refused("Do \(place) dodawaj pliki — bez folderów.")
        }
        let name = FinderName.crm(template.filename)
        if mayAlreadyExist, let existing = state.files.values.first(where: { $0.parentId == node && $0.name.lowercased() == name.lowercased() }) {
            return fileItem(existing, names: names(in: node))
        }
        let source = try contents ?? emptyFile()
        let size = MaterialMedia.size(of: source)
        if size > Self.maxUpload { throw Self.refused("Plik „\(name)” przekracza 50 MB — limit plików \(place).") }
        let mime = MaterialMedia.mime(forName: name)
        let prepared = try await FinderAPI.post(["op": "prepareUpload", "parentId": node, "name": name, "size": size, "mime": mime],
                                                as: DriveUploadReply.self, endpoint: .drive)
        do {
            guard let target = URL(string: prepared.signedUrl) else { throw NSFileProviderError(.serverUnreachable) }
            try await FinderAPI.put(source, to: target, mime: mime)
            let done = try await FinderAPI.post(["op": "completeUpload", "parentId": node, "bucket": prepared.bucket, "path": prepared.path,
                                                 "name": name, "size": size, "mime": mime], as: DriveUploadedReply.self, endpoint: .drive)
            var file = done.file
            if state.folders[file.parentId] == nil {
                // Dokument kosztowy z datą z innego miesiąca trafił do teczki, której Finder jeszcze nie zna — na razie zostaje
                // w folderze upuszczenia, a najbliższe sprawdzenie zmian wczyta drzewo od nowa i pokaże go na miejscu.
                file = DriveFileDTO(id: file.id, parentId: node, name: file.name, size: file.size, updatedAt: file.updatedAt, version: file.version)
                state.syncedAt = .distantPast
            }
            state.files[file.id] = file
            save()
            return fileItem(file, names: names(in: file.parentId))
        } catch {
            _ = try? await FinderAPI.post(["op": "cancelUpload", "parentId": node, "bucket": prepared.bucket, "path": prepared.path],
                                          as: FinderOK.self, endpoint: .drive)
            throw error
        }
    }

    private func emptyFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data().write(to: url)
        return url
    }

    // MARK: Elementy i nazwy

    private static func brandCompany(_ node: String) -> String? {
        node.hasPrefix(brandPrefix) ? String(node.dropFirst(brandPrefix.count)) : nil
    }

    private static func refused(_ message: String) -> Error {
        NSFileProviderError(.cannotSynchronize, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    private static func stamp() -> String { ISO8601DateFormatter().string(from: Date()) }

    private static func signature(_ item: FinderItem) -> String {
        String(decoding: item.itemVersion.metadataVersion, as: UTF8.self) + "#" + String(decoding: item.itemVersion.contentVersion, as: UTF8.self)
    }

    private static let roles: [String: String] = [
        "primary": "główny", "secondary": "dodatkowy", "accent": "akcent", "neutral": "neutralny", "background": "tło", "text": "tekst",
    ]

    /// „Kolory marki.txt”: kod HEX, nazwa i rola każdego koloru z księgi znaku.
    private static func colorsText(_ brand: DriveBrandDTO) -> String {
        var lines = ["Kolory marki \(brand.companyName) — z księgi znaku (CRM → Ustawienia → Moje firmy → Księga znaku)", ""]
        for color in brand.colors {
            let role = roles[color.role] ?? color.role
            let label = [color.label, role.isEmpty ? "" : "(\(role))"].filter { !$0.isEmpty }.joined(separator: " ")
            lines.append(label.isEmpty ? color.hex : "\(color.hex)  \(label)")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private func parentIdentifier(_ parentId: String?) -> NSFileProviderItemIdentifier {
        parentId.map { FinderID.drive($0) } ?? .rootContainer
    }

    private func folderItem(_ folder: DriveFolderDTO, names: [String: String]) -> FinderItem {
        let upload = uploadAllowed(folder)
        return FinderItem(identifier: FinderID.drive(folder.id), parent: parentIdentifier(folder.parentId),
                          filename: names[folder.id] ?? FinderName.safe(folder.name), folder: true,
                          allowed: upload ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems] : [.allowsReading, .allowsContentEnumerating],
                          metaTag: upload ? "u" : "v")
    }

    /// Plik Dysku. Bez rozmiaru z serwera (PDF tworzony przy otwarciu) — rozmiar poznany przy pobraniu, a wersja treści zawiera
    /// rozmiar (`?` — jeszcze nieznany): system zna długość pliku, zanim go pobierze, i nie zostawia na dysku pustego pliku.
    private func fileItem(_ file: DriveFileDTO, names: [String: String]) -> FinderItem {
        let known = state.sizes?[file.id].flatMap { $0.version == file.version ? $0.size : nil }
        let size = file.size.map { Int64($0) } ?? known
        let content = file.size != nil ? file.version : "\(file.version)|\(known.map { String($0) } ?? "?")"
        return FinderItem(identifier: FinderID.driveFile(file.id), parent: FinderID.drive(file.parentId),
                          filename: names[file.id] ?? FinderName.safe(file.name), folder: false, allowed: [.allowsReading], metaTag: "v",
                          size: size, modified: FinderDate.parse(file.updatedAt), contentVersion: Self.digest(content))
    }

    private func brandItem(_ brand: DriveBrandDTO) -> FinderItem {
        FinderItem(identifier: FinderID.drive(Self.brandPrefix + brand.companyId), parent: FinderID.materialFolder(brand.materialFolderId),
                   filename: Self.brandFolderName, folder: true, allowed: [.allowsReading, .allowsContentEnumerating], metaTag: "v")
    }

    private func colorsItem(company: String) -> FinderItem? {
        guard let brand = state.brands[company], !brand.colors.isEmpty else { return nil }
        let id = Self.colorsPrefix + company
        let text = Self.colorsText(brand)
        let names = self.names(in: Self.brandPrefix + company)
        return FinderItem(identifier: FinderID.driveFile(id), parent: FinderID.drive(Self.brandPrefix + company),
                          filename: names[id] ?? Self.colorsName, folder: false, allowed: [.allowsReading], metaTag: "v",
                          size: Int64(Data(text.utf8).count), contentVersion: Self.digest(text))
    }

    /// Unikalne nazwy rodzeństwa w folderze (`nil` — działy w głównym folderze Mavinci).
    private func names(in parent: String?) -> [String: String] {
        var entries: [(id: String, name: String)] = state.folders.values.filter { $0.parentId == parent }.map { (id: $0.id, name: FinderName.safe($0.name)) }
        if let parent {
            entries += state.files.values.filter { $0.parentId == parent }.map { (id: $0.id, name: FinderName.safe($0.name)) }
            if let company = Self.brandCompany(parent), let brand = state.brands[company], !brand.colors.isEmpty {
                entries.append((id: Self.colorsPrefix + company, name: Self.colorsName))
            }
        }
        return FinderName.unique(entries)
    }

    private func contents(of node: String) -> [NSFileProviderItem] {
        let names = self.names(in: node)
        var items: [NSFileProviderItem] = state.folders.values.filter { $0.parentId == node }.map { folderItem($0, names: names) as NSFileProviderItem }
        items += state.files.values.filter { $0.parentId == node }.map { fileItem($0, names: names) as NSFileProviderItem }
        if let company = Self.brandCompany(node), let colors = colorsItem(company: company) { items.append(colors) }
        return items
    }

    /// Wszystkie elementy Dysku (działy, foldery, pliki, „Z księgi znaku”) — nazwy liczone raz na folder nadrzędny.
    private func liveItems() -> [FinderItem] {
        var folders: [String: [DriveFolderDTO]] = [:]
        var files: [String: [DriveFileDTO]] = [:]
        for folder in state.folders.values { folders[folder.parentId ?? "", default: []].append(folder) }
        for file in state.files.values {
            // Plik księgi znaku marki bez folderu w Materiałach — Finder nie ma gdzie go pokazać.
            if let company = Self.brandCompany(file.parentId), state.brands[company] == nil { continue }
            files[file.parentId, default: []].append(file)
        }
        var items: [FinderItem] = []
        for parent in Set(folders.keys).union(files.keys) {
            let groupFolders = folders[parent] ?? []
            let groupFiles = files[parent] ?? []
            var entries = groupFolders.map { (id: $0.id, name: FinderName.safe($0.name)) } + groupFiles.map { (id: $0.id, name: FinderName.safe($0.name)) }
            if let company = Self.brandCompany(parent), let brand = state.brands[company], !brand.colors.isEmpty {
                entries.append((id: Self.colorsPrefix + company, name: Self.colorsName))
            }
            let names = FinderName.unique(entries)
            items += groupFolders.map { folderItem($0, names: names) }
            items += groupFiles.map { fileItem($0, names: names) }
        }
        for brand in state.brands.values {
            items.append(brandItem(brand))
            if let colors = colorsItem(company: brand.companyId) { items.append(colors) }
        }
        return items
    }
}
