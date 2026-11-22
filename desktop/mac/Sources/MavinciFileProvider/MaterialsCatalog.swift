import FileProvider
import Foundation
import UniformTypeIdentifiers

// MARK: Materiały w Finderze — Mavinci → Materiały → marka → foldery i pliki
//
// Kopia całego drzewa Materiałów pracownika (wszystkie marki z dostępem, bez treści plików) w kontenerze rozszerzenia:
// Finder widzi od razu wszystkie foldery i pliki, a treść pobiera się przy pierwszym otwarciu (albo „Pobierz teraz”).
// Zmiany z CRM, aplikacji i telefonu przychodzą przez zbiór roboczy (`changes` od kursora z punktu synchronizacji);
// pełne wczytanie — na start, po wygaśnięciu kursora, po nadaniu dostępu do nowej marki i co 6 godzin (porównanie z kopią).
// Z Findera (tylko marki z „Materiały — zarządzanie”): dodawanie plików i folderów (z miniaturą zdjęcia, wideo i PDF),
// edycja (konflikt → kopia „(konflikt …)”), zmiana nazwy, przenoszenie w obrębie marki, kosz (= kosz Materiałów na 30 dni,
// „Odłóż” przywraca). Foldery domyślne marki (Zdjęcia, Wideo…) — bez przenoszenia i usuwania. Odmowa serwera przywraca
// w Finderze stan z CRM. Plik przeciągnięty z Eventy do Materiałów — kopia w Materiałach, oryginał zostaje w wydarzeniu.

actor MaterialsCatalog {
    static let shared = MaterialsCatalog()

    struct State: Codable {
        var owner = ""
        var cursor: String?
        var companies: [String: MaterialCompanyDTO] = [:]
        var folders: [String: MaterialFolderDTO] = [:]
        var files: [String: MaterialFileDTO] = [:]
        var syncedAt: Date?
        /// Kosz Materiałów (elementy usunięte przez tego pracownika) po identyfikatorze usuniętego elementu.
        var trash: [String: MaterialTrashDTO] = [:]
        var trashAt: Date?
    }

    struct ChangeSet {
        var updated: [NSFileProviderItem] = []
        var deleted: [NSFileProviderItemIdentifier] = []
        var cursor: String?
    }

    private var state = State()
    private var opened = false
    private static let trashTTL: TimeInterval = 15 * 60
    /// Pełne porównanie z serwerem (naprawia ewentualne pominięte zmiany).
    private static let fullTTL: TimeInterval = 6 * 3600

    private var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciFinder", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("materials.json")
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

    /// Kopia starsza niż 15 minut — rozszerzenie prosi Findera o sprawdzenie zmian (gdy aplikacja jest zamknięta).
    var needsRefresh: Bool {
        guard let at = state.syncedAt else { return true }
        return Date().timeIntervalSince(at) > Self.trashTTL
    }

    private var trashStale: Bool {
        guard let at = state.trashAt else { return true }
        return Date().timeIntervalSince(at) > Self.trashTTL
    }

    // MARK: Pobieranie z serwera

    /// Pełne wczytanie drzewa; zwraca wszystkie elementy i te, które zniknęły z kopii (usunięte albo bez dostępu).
    private func fullSync() async throws -> ChangeSet {
        let reply = try await FinderAPI.get(["op": "sync"], as: MaterialSyncReply.self, endpoint: .materials)
        let before = Set(liveItems().map { $0.itemIdentifier })
        state.companies = Dictionary(reply.companies.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        state.folders = Dictionary(reply.folders.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        state.files = Dictionary(reply.files.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        state.cursor = reply.cursor
        state.syncedAt = Date()
        for id in Array(state.trash.keys) where state.files[id] != nil || state.folders[id] != nil { state.trash[id] = nil }
        save()
        var result = ChangeSet(cursor: reply.cursor)
        result.updated = liveItems()
        let now = Set(result.updated.map { $0.itemIdentifier })
        result.deleted = Array(before.subtracting(now).filter { !isTrashed($0) })
        return result
    }

    /// Kosz (elementy usunięte przez tego pracownika w markach, którymi zarządza); zwraca elementy, które z niego zniknęły.
    @discardableResult
    private func refreshTrash() async throws -> [String] {
        var fresh: [String: MaterialTrashDTO] = [:]
        if state.companies.values.contains(where: { $0.manage == true }) {
            let reply = try await FinderAPI.get(["op": "finderTrash"], as: MaterialTrashReply.self, endpoint: .materials)
            for entry in reply.items where fresh[entry.itemId] == nil && state.files[entry.itemId] == nil && state.folders[entry.itemId] == nil {
                fresh[entry.itemId] = entry
            }
        }
        let gone = state.trash.keys.filter { fresh[$0] == nil }
        state.trash = fresh
        state.trashAt = Date()
        save()
        return gone
    }

    private func knownFolder(_ id: String) async throws -> MaterialFolderDTO {
        if let known = state.folders[id] { return known }
        let reply = try await FinderAPI.get(["op": "item", "kind": "folder", "id": id], as: MaterialFolderReply.self, endpoint: .materials)
        guard state.companies[reply.item.companyId] != nil else { throw NSFileProviderError(.noSuchItem) }
        state.folders[id] = reply.item
        save()
        return reply.item
    }

    private func knownFile(_ id: String) async throws -> MaterialFileDTO {
        if let known = state.files[id] { return known }
        let reply = try await FinderAPI.get(["op": "item", "kind": "file", "id": id], as: MaterialFileReply.self, endpoint: .materials)
        guard state.companies[reply.item.companyId] != nil else { throw NSFileProviderError(.noSuchItem) }
        state.files[id] = reply.item
        save()
        return reply.item
    }

    // MARK: Odczyt dla Findera

    /// „Materiały” w głównym folderze Mavinci — tylko z dostępem do Materiałów w którejś marce.
    func rootItem() async -> NSFileProviderItem? {
        do { try open() } catch { return nil }
        if state.syncedAt == nil { _ = try? await fullSync() }
        return state.companies.isEmpty ? nil : FinderItem.materialsRoot
    }

    func children(of container: NSFileProviderItemIdentifier) async throws -> [NSFileProviderItem] {
        try open()
        if state.syncedAt == nil { _ = try await fullSync() }
        switch FinderID.parse(container) {
        case .materials:
            return brandItems()
        case .brand(let id):
            guard state.companies[id] != nil else { throw NSFileProviderError(.noSuchItem) }
            return contents(company: id, parent: nil)
        case .materialFolder(let id):
            if state.folders[id] == nil, state.trash[id] != nil { return trashChildren(of: id) }
            let folder = try await knownFolder(id)
            return contents(company: folder.companyId, parent: id)
        default:
            throw NSFileProviderError(.noSuchItem)
        }
    }

    func item(for identifier: NSFileProviderItemIdentifier) async throws -> NSFileProviderItem {
        try open()
        switch FinderID.parse(identifier) {
        case .materials:
            if state.syncedAt == nil { _ = try await fullSync() }
            guard !state.companies.isEmpty else { throw NSFileProviderError(.noSuchItem) }
            return FinderItem.materialsRoot
        case .brand(let id):
            if state.syncedAt == nil { _ = try await fullSync() }
            guard let company = state.companies[id] else { throw NSFileProviderError(.noSuchItem) }
            return brandItem(company, names: brandNames())
        case .materialFolder(let id):
            if state.folders[id] == nil, let trashed = state.trash[id] { return trashItem(trashed) }
            let folder = try await knownFolder(id)
            return folderItem(folder, names: siblingNames(company: folder.companyId, parent: folder.parentId))
        case .materialFile(let id):
            if state.files[id] == nil, let trashed = state.trash[id] { return trashItem(trashed) }
            let file = try await knownFile(id)
            return fileItem(file, names: siblingNames(company: file.companyId, parent: file.folderId))
        default:
            throw NSFileProviderError(.noSuchItem)
        }
    }

    /// Podpisany adres treści pliku (także z kosza) i jego aktualny element.
    func download(file id: String) async throws -> (URL, NSFileProviderItem) {
        try open()
        let reply = try await FinderAPI.get(["op": "download", "id": id], as: MaterialDownloadReply.self, endpoint: .materials)
        guard let url = URL(string: reply.url) else { throw NSFileProviderError(.serverUnreachable) }
        if state.files[id] == nil, let trashed = state.trash[id] { return (url, trashItem(trashed)) }
        state.files[id] = reply.item
        save()
        return (url, fileItem(reply.item, names: siblingNames(company: reply.item.companyId, parent: reply.item.folderId)))
    }

    // MARK: Zmiany (zbiór roboczy)

    func currentCursor() async -> String? {
        do { try open() } catch { return nil }
        if state.cursor == nil { _ = try? await fullSync() }
        return state.cursor
    }

    /// Zmiany od kursora z punktu synchronizacji Findera. Bez kursora (pierwsza synchronizacja, dawny punkt bez Materiałów),
    /// po jego wygaśnięciu i co 6 godzin — pełne wczytanie i porównanie z kopią.
    func changes(since cursor: String?) async throws -> ChangeSet {
        try open()
        let fullDue = state.syncedAt.map { Date().timeIntervalSince($0) > Self.fullTTL } ?? true
        guard let cursor, !cursor.isEmpty, !fullDue else { return try await fullSyncWithTrash() }
        let reply = try await FinderAPI.get(["op": "changes", "since": cursor], as: MaterialChangesReply.self, endpoint: .materials)
        if reply.reset == true { return try await fullSyncWithTrash() }
        let fresh = Dictionary((reply.companies ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        // Nowa marka (nadany dostęp) — jej foldery i pliki nie są „zmianami”, więc wczytujemy wszystko.
        if fresh.keys.contains(where: { state.companies[$0] == nil }) { return try await fullSyncWithTrash() }

        var result = ChangeSet(cursor: reply.cursor)
        var containers = Set<String>()
        var brandsChanged = false
        let hadRoot = !state.companies.isEmpty
        // Odebrany dostęp do marki — znika razem z zawartością.
        for id in Array(state.companies.keys) where fresh[id] == nil {
            result.deleted.append(FinderID.brand(id))
            for folder in Array(state.folders.values) where folder.companyId == id {
                result.deleted.append(FinderID.materialFolder(folder.id))
                state.folders[folder.id] = nil
            }
            for file in Array(state.files.values) where file.companyId == id {
                result.deleted.append(FinderID.materialFile(file.id))
                state.files[file.id] = nil
            }
            for entry in Array(state.trash.values) where entry.companyId == id {
                result.deleted.append(trashIdentifier(entry))
                state.trash[entry.itemId] = nil
            }
            brandsChanged = true
        }
        // Zmiana zakresu „zarządzanie” albo nazwy marki — uprawnienia i nazwy w Finderze.
        for (id, company) in fresh {
            guard let old = state.companies[id] else { continue }
            if old.name != company.name { brandsChanged = true }
            if (old.manage == true) != (company.manage == true) {
                brandsChanged = true
                containers.insert(Self.key(id, nil))
                for folder in state.folders.values where folder.companyId == id { containers.insert(Self.key(id, folder.id)) }
            }
        }
        state.companies = fresh
        if hadRoot && fresh.isEmpty { result.deleted.append(FinderID.materials) }

        for folder in reply.folders ?? [] where fresh[folder.companyId] != nil {
            if let old = state.folders[folder.id] { containers.insert(Self.key(old.companyId, old.parentId)) }
            state.folders[folder.id] = folder
            state.trash[folder.id] = nil
            containers.insert(Self.key(folder.companyId, folder.parentId))
        }
        for file in reply.files ?? [] where fresh[file.companyId] != nil {
            if let old = state.files[file.id] { containers.insert(Self.key(old.companyId, old.folderId)) }
            state.files[file.id] = file
            state.trash[file.id] = nil
            containers.insert(Self.key(file.companyId, file.folderId))
        }
        let deletions = reply.deleted ?? []
        if !deletions.isEmpty || trashStale {
            // Usunięte przez tego pracownika trafiają do Kosza Findera (kosz Materiałów), pozostałe znikają.
            let left = (try? await refreshTrash()) ?? []
            for id in left where state.files[id] == nil && state.folders[id] == nil {
                result.deleted.append(FinderID.materialFile(id))
                result.deleted.append(FinderID.materialFolder(id))
            }
        }
        for deleted in deletions {
            if deleted.kind == "folder" {
                if let old = state.folders.removeValue(forKey: deleted.id) { containers.insert(Self.key(old.companyId, old.parentId)) }
            } else {
                if let old = state.files.removeValue(forKey: deleted.id) { containers.insert(Self.key(old.companyId, old.folderId)) }
            }
            if let trashed = state.trash[deleted.id] {
                result.updated.append(trashItem(trashed))
            } else {
                result.deleted.append(deleted.kind == "folder" ? FinderID.materialFolder(deleted.id) : FinderID.materialFile(deleted.id))
            }
        }
        if brandsChanged { result.updated += brandItems() }
        for container in containers {
            let parts = container.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 2, state.companies[parts[0]] != nil else { continue }
            result.updated += contents(company: parts[0], parent: parts[1].isEmpty ? nil : parts[1])
        }
        state.cursor = reply.cursor
        save()
        return result
    }

    private func fullSyncWithTrash() async throws -> ChangeSet {
        var result = try await fullSync()
        let left = (try? await refreshTrash()) ?? []
        for id in left where state.files[id] == nil && state.folders[id] == nil {
            result.deleted.append(FinderID.materialFile(id))
            result.deleted.append(FinderID.materialFolder(id))
        }
        result.updated += state.trash.values.map { trashItem($0) }
        return result
    }

    /// Zbiór roboczy od nowa (po wygaśnięciu punktu synchronizacji): całe drzewo i kosz; bez sieci — kopia z dysku.
    func everything() async throws -> [NSFileProviderItem] {
        try open()
        do { _ = try await fullSync() } catch { if state.syncedAt == nil { throw error } }
        _ = try? await refreshTrash()
        return liveItems() + trashRoots()
    }

    // MARK: Zapis z Findera

    /// Miejsce w Materiałach dla elementu w folderze Findera: marka i folder (nil — główny folder marki).
    private func location(of parent: NSFileProviderItemIdentifier) async throws -> (company: String, folder: String?) {
        switch FinderID.parse(parent) {
        case .brand(let id):
            guard state.companies[id] != nil else { throw NSFileProviderError(.noSuchItem) }
            return (id, nil)
        case .materialFolder(let id):
            let folder = try await knownFolder(id)
            return (folder.companyId, id)
        default:
            throw NSFileProviderError(.cannotSynchronize, userInfo: [NSLocalizedDescriptionKey: "Pliki i foldery dodawaj w folderze marki w Materiałach."])
        }
    }

    private func requireManage(_ company: String) throws {
        guard state.companies[company]?.manage == true else {
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError,
                          userInfo: [NSLocalizedDescriptionKey: "Nie masz uprawnień do zmian w Materiałach tej marki."])
        }
    }

    /// Nowy plik lub folder z Findera.
    func create(template: NSFileProviderItem, contents: URL?, mayAlreadyExist: Bool) async throws -> NSFileProviderItem {
        try open()
        if FinderName.excluded(template.filename) { throw NSFileProviderError(.excludedFromSync) }
        let type = template.contentType ?? .data
        if type.conforms(to: .package) { throw NSFileProviderError(.excludedFromSync) }
        let isFolder = type.conforms(to: .folder) || type.conforms(to: .directory)
        let place = try await location(of: template.parentItemIdentifier)
        try requireManage(place.company)
        let name = FinderName.crm(template.filename)
        if mayAlreadyExist, let existing = sibling(named: name, company: place.company, parent: place.folder, folder: isFolder) { return existing }
        if isFolder {
            let reply: MaterialFolderReply
            do {
                reply = try await FinderAPI.post(["op": "createFolder", "companyId": place.company, "parentId": FinderAPI.json(place.folder), "name": name],
                                                 as: MaterialFolderReply.self, endpoint: .materials)
            } catch let error as MaterialServerError where error.code == "exists" {
                if let existing = sibling(named: name, company: place.company, parent: place.folder, folder: true) { return existing }
                throw error
            }
            state.folders[reply.item.id] = reply.item
            save()
            return folderItem(reply.item, names: siblingNames(company: place.company, parent: place.folder))
        }
        // Zajęta nazwa — serwer nada wolną („Plik (2).pdf”), Finder pokaże nazwę z CRM.
        let source = try contents ?? emptyFile()
        let file = try await uploadNew(source, name: name, company: place.company, folder: place.folder)
        return fileItem(file, names: siblingNames(company: place.company, parent: place.folder))
    }

    /// Zmiana z Findera: kosz, przywrócenie, nazwa, położenie i treść. Odmowa serwera → element taki jak na serwerze.
    func modify(_ item: NSFileProviderItem, base: NSFileProviderItemVersion, fields: NSFileProviderItemFields,
                contents: URL?) async throws -> (NSFileProviderItem, Bool) {
        try open()
        let identifier = item.itemIdentifier
        let id: String
        let isFolder: Bool
        switch FinderID.parse(identifier) {
        case .materialFolder(let value): id = value; isFolder = true
        case .materialFile(let value): id = value; isFolder = false
        default:
            // Struktura (Materiały, marki) — tylko zmiany lokalne, np. tagi.
            let current = try await self.item(for: identifier)
            return (current, false)
        }
        let moved = fields.contains(.parentItemIdentifier)
        // Do kosza: usunięcie w Materiałach (kosz na 30 dni).
        if moved, item.parentItemIdentifier == .trashContainer {
            do {
                _ = try await FinderAPI.post(["op": "finderRemove", "kind": isFolder ? "folder" : "file", "id": id], as: FinderOK.self, endpoint: .materials)
            } catch let error as MaterialServerError where [400, 403].contains(error.status) {
                // Brak uprawnień albo folder domyślny marki — element wraca na miejsce.
                let current = try await serverItem(identifier)
                return (current, false)
            }
            dropLocal(id: id, folder: isFolder)
            _ = try? await refreshTrash()
            if let trashed = state.trash[id] { return (trashItem(trashed), false) }
            return (FinderItem(identifier: identifier, parent: .trashContainer, filename: item.filename, folder: isFolder, role: .trashed), false)
        }
        // Z kosza z powrotem: przywrócenie, potem ewentualne przeniesienie tam, gdzie upuszczono.
        if state.folders[id] == nil, state.files[id] == nil, state.trash[id] != nil {
            if fields.contains(.contents) || !moved {
                let current = try await self.item(for: identifier)
                return (current, false)
            }
            _ = try await FinderAPI.post(["op": "restore", "itemIds": [id]], as: FinderRestoreReply.self, endpoint: .materials)
            state.trash[id] = nil
            let restored = try await serverItem(identifier)
            if restored.parentItemIdentifier == item.parentItemIdentifier { return (restored, false) }
        }

        let uploading = fields.contains(.contents) && !isFolder && contents != nil
        var body: [String: Any] = ["op": "update", "kind": isFolder ? "folder" : "file", "id": id]
        if fields.contains(.filename) { body["name"] = FinderName.crm(item.filename) }
        if moved {
            // Poza Materiały (np. do Eventy) albo do innej marki — element wraca na miejsce.
            guard let place = try? await location(of: item.parentItemIdentifier) else {
                let current = try await serverItem(identifier)
                return (current, uploading)
            }
            body["companyId"] = place.company
            body["parentId"] = FinderAPI.json(place.folder)
        }
        if body.count > 3 {
            do {
                if isFolder {
                    let reply = try await FinderAPI.post(body, as: MaterialFolderReply.self, endpoint: .materials)
                    state.folders[id] = reply.item
                } else {
                    let reply = try await FinderAPI.post(body, as: MaterialFileReply.self, endpoint: .materials)
                    state.files[id] = reply.item
                }
                save()
            } catch let error as MaterialServerError where [400, 403, 404, 409].contains(error.status) {
                // Odmowa (uprawnienia, zajęta nazwa, inna marka) — element wraca do stanu z serwera.
                NSLog("[Mavinci Finder] zmiana w Materiałach odrzucona: %@", error.message)
                let current = try await serverItem(identifier)
                return (current, uploading)
            }
        }
        if uploading, let contents {
            let current = try await knownFile(id)
            do {
                let updated = try await replaceContent(contents, file: current, name: FinderName.crm(item.filename), base: Self.contentVersion(base))
                state.files[id] = updated
                save()
            } catch let error as MaterialServerError where error.code == "conflict" {
                // Ktoś zmienił plik w międzyczasie: wersja z serwera zostaje na miejscu, nasza jako kopia „(konflikt …)”.
                if let server = error.file {
                    let copy = freeName(FinderName.conflictCopy(FinderName.crm(item.filename)), company: server.companyId, parent: server.folderId)
                    _ = try? await uploadNew(contents, name: copy, company: server.companyId, folder: server.folderId)
                    state.files[id] = server
                    save()
                    return (fileItem(server, names: siblingNames(company: server.companyId, parent: server.folderId)), true)
                }
                let current = try await serverItem(identifier)
                return (current, true)
            } catch let error as MaterialServerError where [400, 403, 404, 409, 413].contains(error.status) {
                NSLog("[Mavinci Finder] nowa treść odrzucona: %@", error.message)
                let current = try await serverItem(identifier)
                return (current, true)
            }
        }
        let current = try await self.item(for: identifier)
        return (current, false)
    }

    /// Usunięcie z Findera: do kosza Materiałów; z Kosza Findera — na zawsze.
    func delete(_ identifier: NSFileProviderItemIdentifier, recursive: Bool) async throws {
        try open()
        let id: String
        let isFolder: Bool
        switch FinderID.parse(identifier) {
        case .materialFolder(let value): id = value; isFolder = true
        case .materialFile(let value): id = value; isFolder = false
        default: throw NSFileProviderError(.deletionRejected)
        }
        if state.folders[id] == nil, state.files[id] == nil, state.trash[id] != nil {
            _ = try await FinderAPI.post(["op": "deleteForever", "itemIds": [id]], as: FinderRemoveReply.self, endpoint: .materials)
            state.trash[id] = nil
            save()
            return
        }
        if isFolder, !recursive, hasChildren(id) { throw NSFileProviderError(.directoryNotEmpty) }
        do {
            _ = try await FinderAPI.post(["op": "finderRemove", "kind": isFolder ? "folder" : "file", "id": id], as: FinderOK.self, endpoint: .materials)
        } catch let error as MaterialServerError where [400, 403].contains(error.status) {
            throw NSFileProviderError(.deletionRejected)
        }
        dropLocal(id: id, folder: isFolder)
        save()
    }

    /// Plik wydarzenia przeciągnięty do Materiałów — kopia w Materiałach (jak „Zapisz w Materiałach” w CRM).
    func copyEventFile(_ eventFileID: String, into parent: NSFileProviderItemIdentifier) async throws {
        try open()
        let place = try await location(of: parent)
        try requireManage(place.company)
        let reply = try await FinderAPI.post(["op": "copyFromEvent", "eventFileId": eventFileID, "companyId": place.company,
                                              "folderId": FinderAPI.json(place.folder)], as: MaterialUploadedReply.self, endpoint: .materials)
        state.files[reply.file.id] = reply.file
        save()
    }

    // MARK: Wysyłanie

    private static func number(_ value: Int?) -> Any { value.map { $0 as Any } ?? NSNull() }
    private static func number(_ value: Double?) -> Any { value.map { $0 as Any } ?? NSNull() }

    private func sizeChecked(_ source: URL) throws -> Int64 {
        let size = MaterialMedia.size(of: source)
        if size > MaterialMedia.maxBytes {
            throw NSFileProviderError(.cannotSynchronize, userInfo: [NSLocalizedDescriptionKey: "Plik jest większy niż 2 GB — tak duże pliki trzymaj na dysku firmowym."])
        }
        return size
    }

    /// Treść i miniatura na podpisane adresy, potem potwierdzenie; błąd sprząta wpis i wysłane obiekty.
    private func send(_ source: URL, prepared: MaterialPreparedUpload, mime: String, facts: MaterialMedia.Facts, sha: String?,
                      base: Int?) async throws -> MaterialFileDTO {
        do {
            guard let target = URL(string: prepared.uploadUrl) else { throw NSFileProviderError(.serverUnreachable) }
            try await FinderAPI.put(source, to: target, mime: mime)
            var thumbPath: String?
            if let thumb = facts.thumbnail, let path = prepared.thumbPath, let raw = prepared.thumbUploadUrl, let url = URL(string: raw) {
                do {
                    try await FinderAPI.put(thumb, to: url, mime: "image/jpeg")
                    thumbPath = path
                } catch {
                    NSLog("[Mavinci Finder] miniatura: %@", error.localizedDescription)
                }
            }
            var body: [String: Any] = [
                "op": "completeUpload", "fileId": prepared.fileId, "path": prepared.path, "thumbPath": FinderAPI.json(thumbPath),
                "width": Self.number(facts.width), "height": Self.number(facts.height), "duration": Self.number(facts.duration),
                "sha256": FinderAPI.json(sha),
            ]
            if let base { body["baseContentVersion"] = base }
            let done = try await FinderAPI.post(body, as: MaterialUploadedReply.self, endpoint: .materials)
            return done.file
        } catch {
            _ = try? await FinderAPI.post(["op": "cancelUpload", "fileId": prepared.fileId, "path": prepared.path,
                                           "thumbPath": FinderAPI.json(prepared.thumbPath)], as: FinderOK.self, endpoint: .materials)
            throw error
        }
    }

    private func uploadNew(_ source: URL, name: String, company: String, folder: String?) async throws -> MaterialFileDTO {
        let size = try sizeChecked(source)
        let mime = MaterialMedia.mime(forName: name)
        let sha = try? MaterialMedia.sha256(source)
        let facts = await MaterialMedia.facts(for: source, name: name)
        let prepared = try await FinderAPI.post([
            "op": "prepareUpload", "companyId": company, "folderId": FinderAPI.json(folder), "name": name, "size": size, "mime": mime,
            "sha256": FinderAPI.json(sha), "thumbnail": facts.thumbnail != nil, "rename": true,
        ], as: MaterialPreparedUpload.self, endpoint: .materials)
        let file = try await send(source, prepared: prepared, mime: mime, facts: facts, sha: sha, base: nil)
        state.files[file.id] = file
        save()
        return file
    }

    private func replaceContent(_ source: URL, file: MaterialFileDTO, name: String, base: Int) async throws -> MaterialFileDTO {
        let size = try sizeChecked(source)
        let mime = MaterialMedia.mime(forName: name)
        let sha = try? MaterialMedia.sha256(source)
        let facts = await MaterialMedia.facts(for: source, name: name)
        let prepared = try await FinderAPI.post([
            "op": "prepareUpload", "replaceId": file.id, "baseContentVersion": base, "name": name, "size": size, "mime": mime,
            "sha256": FinderAPI.json(sha), "thumbnail": facts.thumbnail != nil,
        ], as: MaterialPreparedUpload.self, endpoint: .materials)
        return try await send(source, prepared: prepared, mime: mime, facts: facts, sha: sha, base: base)
    }

    private func emptyFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data().write(to: url)
        return url
    }

    /// Numer wersji treści z wersji Findera („3-<sha>” → 3).
    private static func contentVersion(_ version: NSFileProviderItemVersion) -> Int {
        let text = String(data: version.contentVersion, encoding: .utf8) ?? ""
        return Int(text.split(separator: "-").first ?? "") ?? 1
    }

    // MARK: Pomocnicze

    /// Element prosto z serwera (po odmowie zmiany — Finder wraca do tego stanu).
    private func serverItem(_ identifier: NSFileProviderItemIdentifier) async throws -> NSFileProviderItem {
        switch FinderID.parse(identifier) {
        case .materialFolder(let id): state.folders[id] = nil
        case .materialFile(let id): state.files[id] = nil
        default: break
        }
        return try await item(for: identifier)
    }

    private func dropLocal(id: String, folder: Bool) {
        if folder {
            var doomed: Set<String> = [id]
            var grown = true
            while grown {
                grown = false
                for f in state.folders.values where f.parentId.map({ doomed.contains($0) }) == true && !doomed.contains(f.id) {
                    doomed.insert(f.id)
                    grown = true
                }
            }
            for f in Array(state.files.values) where f.folderId.map({ doomed.contains($0) }) == true { state.files[f.id] = nil }
            for d in doomed { state.folders[d] = nil }
        } else {
            state.files[id] = nil
        }
        save()
    }

    private func hasChildren(_ folder: String) -> Bool {
        state.folders.values.contains { $0.parentId == folder } || state.files.values.contains { $0.folderId == folder }
    }

    private func sibling(named name: String, company: String, parent: String?, folder: Bool) -> NSFileProviderItem? {
        let lower = name.lowercased()
        if folder, let match = state.folders.values.first(where: { $0.companyId == company && $0.parentId == parent && $0.name.lowercased() == lower }) {
            return folderItem(match, names: siblingNames(company: company, parent: parent))
        }
        if !folder, let match = state.files.values.first(where: { $0.companyId == company && $0.folderId == parent && $0.name.lowercased() == lower }) {
            return fileItem(match, names: siblingNames(company: company, parent: parent))
        }
        return nil
    }

    private func freeName(_ name: String, company: String, parent: String?) -> String {
        let taken = Set(state.files.values.filter { $0.companyId == company && $0.folderId == parent }.map { $0.name.lowercased() }
            + state.folders.values.filter { $0.companyId == company && $0.parentId == parent }.map { $0.name.lowercased() })
        var candidate = name
        var number = 2
        while taken.contains(candidate.lowercased()) {
            candidate = FinderName.numbered(name, number)
            number += 1
        }
        return candidate
    }

    private func isTrashed(_ identifier: NSFileProviderItemIdentifier) -> Bool {
        switch FinderID.parse(identifier) {
        case .materialFolder(let id), .materialFile(let id): return state.trash[id] != nil
        default: return false
        }
    }

    // MARK: Elementy i nazwy

    private static func key(_ company: String, _ parent: String?) -> String { company + "|" + (parent ?? "") }

    private func manages(_ company: String) -> Bool { state.companies[company]?.manage == true }

    private func brandNames() -> [String: String] {
        FinderName.unique(state.companies.values.map { (id: $0.id, name: FinderName.safe($0.name)) })
    }

    private func brandItem(_ company: MaterialCompanyDTO, names: [String: String]) -> NSFileProviderItem {
        let manage = company.manage == true
        return FinderItem(identifier: FinderID.brand(company.id), parent: FinderID.materials,
                          filename: names[company.id] ?? FinderName.safe(company.name), folder: true,
                          allowed: manage ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems] : [.allowsReading, .allowsContentEnumerating],
                          metaTag: manage ? "m" : "v")
    }

    private func brandItems() -> [NSFileProviderItem] {
        let names = brandNames()
        return state.companies.values.map { brandItem($0, names: names) }
    }

    private func siblingNames(company: String, parent: String?) -> [String: String] {
        var entries: [(id: String, name: String)] = []
        for folder in state.folders.values where folder.companyId == company && folder.parentId == parent {
            entries.append((id: folder.id, name: FinderName.safe(folder.name)))
        }
        for file in state.files.values where file.companyId == company && file.folderId == parent {
            entries.append((id: file.id, name: FinderName.safe(file.name)))
        }
        return FinderName.unique(entries)
    }

    private func parentIdentifier(company: String, parent: String?) -> NSFileProviderItemIdentifier {
        parent.map { FinderID.materialFolder($0) } ?? FinderID.brand(company)
    }

    private func folderItem(_ folder: MaterialFolderDTO, names: [String: String]) -> NSFileProviderItem {
        let manage = manages(folder.companyId)
        let system = folder.systemKey != nil
        let allowed: NSFileProviderItemCapabilities
        if !manage {
            allowed = [.allowsReading, .allowsContentEnumerating]
        } else if system {
            // Folder domyślny marki: dodawanie i zmiana nazwy — bez przenoszenia i usuwania (jak w CRM).
            allowed = [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems, .allowsRenaming]
        } else {
            allowed = [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems, .allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]
        }
        return FinderItem(identifier: FinderID.materialFolder(folder.id), parent: parentIdentifier(company: folder.companyId, parent: folder.parentId),
                          filename: names[folder.id] ?? FinderName.safe(folder.name), folder: true,
                          allowed: allowed, metaTag: manage ? (system ? "ms" : "m") : "v",
                          created: FinderDate.parse(folder.createdAt), modified: FinderDate.parse(folder.updatedAt))
    }

    private func fileItem(_ file: MaterialFileDTO, names: [String: String]) -> NSFileProviderItem {
        let manage = manages(file.companyId)
        let allowed: NSFileProviderItemCapabilities = manage
            ? [.allowsReading, .allowsWriting, .allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]
            : [.allowsReading]
        return FinderItem(identifier: FinderID.materialFile(file.id), parent: parentIdentifier(company: file.companyId, parent: file.folderId),
                          filename: names[file.id] ?? FinderName.safe(file.name), folder: false,
                          allowed: allowed, metaTag: manage ? "m" : "v",
                          size: Int64(file.size ?? 0), created: FinderDate.parse(file.createdAt), modified: FinderDate.parse(file.updatedAt),
                          contentVersion: "\(file.contentVersion ?? 1)-\(file.sha256 ?? "")")
    }

    private func contents(company: String, parent: String?) -> [NSFileProviderItem] {
        let names = siblingNames(company: company, parent: parent)
        var items: [NSFileProviderItem] = []
        for folder in state.folders.values where folder.companyId == company && folder.parentId == parent {
            items.append(folderItem(folder, names: names))
        }
        for file in state.files.values where file.companyId == company && file.folderId == parent {
            items.append(fileItem(file, names: names))
        }
        return items
    }

    /// Wszystkie elementy Materiałów (folder „Materiały”, marki, foldery i pliki) — grupowane po folderze nadrzędnym.
    private func liveItems() -> [NSFileProviderItem] {
        guard !state.companies.isEmpty else { return [] }
        var items: [NSFileProviderItem] = [FinderItem.materialsRoot]
        items += brandItems()
        var folders: [String: [MaterialFolderDTO]] = [:]
        var files: [String: [MaterialFileDTO]] = [:]
        for folder in state.folders.values where state.companies[folder.companyId] != nil {
            folders[Self.key(folder.companyId, folder.parentId), default: []].append(folder)
        }
        for file in state.files.values where state.companies[file.companyId] != nil {
            files[Self.key(file.companyId, file.folderId), default: []].append(file)
        }
        for container in Set(folders.keys).union(files.keys) {
            let groupFolders = folders[container] ?? []
            let groupFiles = files[container] ?? []
            let names = FinderName.unique(groupFolders.map { (id: $0.id, name: FinderName.safe($0.name)) }
                                          + groupFiles.map { (id: $0.id, name: FinderName.safe($0.name)) })
            items += groupFolders.map { folderItem($0, names: names) }
            items += groupFiles.map { fileItem($0, names: names) }
        }
        return items
    }

    // MARK: Kosz

    private func trashIdentifier(_ entry: MaterialTrashDTO) -> NSFileProviderItemIdentifier {
        entry.kind == "folder" ? FinderID.materialFolder(entry.itemId) : FinderID.materialFile(entry.itemId)
    }

    /// Element kosza na najwyższym poziomie (nie leży w usuniętym razem z nim folderze).
    private func isTrashRoot(_ entry: MaterialTrashDTO) -> Bool {
        guard let parent = entry.parentId, let parentEntry = state.trash[parent] else { return true }
        return parentEntry.batch != entry.batch
    }

    private func trashItem(_ entry: MaterialTrashDTO) -> NSFileProviderItem {
        let folder = entry.kind == "folder"
        let parent: NSFileProviderItemIdentifier = isTrashRoot(entry) ? .trashContainer : FinderID.materialFolder(entry.parentId ?? "")
        return FinderItem(identifier: trashIdentifier(entry), parent: parent, filename: FinderName.safe(entry.name), folder: folder, role: .trashed,
                          size: folder ? nil : Int64(entry.size ?? 0), modified: FinderDate.parse(entry.deletedAt))
    }

    func trashRoots() -> [NSFileProviderItem] {
        let roots = state.trash.values.filter { isTrashRoot($0) }
        let names = FinderName.unique(roots.map { (id: $0.itemId, name: FinderName.safe($0.name)) })
        return roots.map { entry in
            let folder = entry.kind == "folder"
            return FinderItem(identifier: trashIdentifier(entry), parent: .trashContainer,
                              filename: names[entry.itemId] ?? FinderName.safe(entry.name), folder: folder, role: .trashed,
                              size: folder ? nil : Int64(entry.size ?? 0), modified: FinderDate.parse(entry.deletedAt))
        }
    }

    /// Kosz w Finderze: elementy Materiałów usunięte przez tego pracownika (odświeżane przy każdym otwarciu Kosza).
    func trashContents() async throws -> [NSFileProviderItem] {
        try open()
        if state.syncedAt == nil { _ = try await fullSync() }
        try await refreshTrash()
        return trashRoots()
    }

    private func trashChildren(of folder: String) -> [NSFileProviderItem] {
        guard let parentEntry = state.trash[folder] else { return [] }
        return state.trash.values.filter { $0.parentId == folder && $0.batch == parentEntry.batch }.map { trashItem($0) }
    }
}
