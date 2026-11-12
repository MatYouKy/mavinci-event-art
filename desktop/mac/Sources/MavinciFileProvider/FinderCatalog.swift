import CryptoKit
import FileProvider
import Foundation
import UniformTypeIdentifiers

// MARK: Lokalna kopia struktury plików (w kontenerze rozszerzenia)
//
// Wydarzenia widoczne dla pracownika (lista odświeżana co 15 min — znikają wydarzenia usunięte i te, do których odebrano
// dostęp), zawartość wydarzeń otwartych w Finderze i kosz CRM (elementy usunięte przez tego pracownika). Z niej powstają
// nazwy (unikalne w folderze) i elementy Findera; zmiany z serwera (`changes`) aktualizują tylko wydarzenia już otwarte.
// Zapisy z Findera idą do serwera CRM, a odmowa serwera (uprawnienia, zajęta nazwa) cofa zmianę w Finderze.
// Zmiana konta = nowa kopia.

actor FinderCatalog {
    static let shared = FinderCatalog()

    struct State: Codable {
        var owner = ""
        var cursor: String?
        var events: [String: FinderEventDTO] = [:]
        var folders: [String: FinderFolderDTO] = [:]
        var files: [String: FinderFileDTO] = [:]
        var loaded: Set<String> = []
        var eventsAt: Date?
        /// Kosz CRM po identyfikatorze usuniętego elementu.
        var trash: [String: FinderTrashDTO] = [:]
        var trashAt: Date?
        /// Ostatnie pełne sprawdzenie zawartości otwartych wydarzeń (uprawnienia mogły się zmienić bez zmiany plików).
        var verifiedAt: Date?
    }

    struct ChangeSet {
        var updated: [NSFileProviderItem] = []
        var deleted: [NSFileProviderItemIdentifier] = []
        var anchor = Data()
        var reset = false
    }

    private var state = State()
    private var opened = false
    private static let eventsTTL: TimeInterval = 15 * 60

    private var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MavinciFinder", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("catalog.json")
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

    // MARK: Pobieranie z serwera

    /// Lista wydarzeń; zwraca identyfikatory elementów, które zniknęły (wydarzenie usunięte albo bez dostępu).
    @discardableResult
    private func refreshEvents() async throws -> [NSFileProviderItemIdentifier] {
        let reply = try await FinderAPI.get(["op": "events"], as: FinderEventsReply.self)
        var fresh: [String: FinderEventDTO] = [:]
        for event in reply.events { fresh[event.id] = event }
        let removed = state.events.keys.filter { fresh[$0] == nil }
        let yearsBefore = years()
        state.events = fresh
        state.eventsAt = Date()
        if state.cursor == nil { state.cursor = reply.cursor }
        var gone: [NSFileProviderItemIdentifier] = []
        for id in removed { gone += dropEvent(id) }
        gone += yearsBefore.subtracting(years()).map { FinderID.year($0) }
        save()
        return gone
    }

    private func dropEvent(_ id: String) -> [NSFileProviderItemIdentifier] {
        var gone = [FinderID.event(id)]
        for folder in state.folders.values where folder.eventId == id {
            gone.append(FinderID.folder(folder.id))
            state.folders[folder.id] = nil
        }
        for file in state.files.values where file.eventId == id {
            gone.append(FinderID.file(file.id))
            state.files[file.id] = nil
        }
        state.loaded.remove(id)
        state.events[id] = nil
        return gone
    }

    /// Cała zawartość wydarzenia naraz (przy każdym otwarciu go w Finderze).
    private func loadEvent(_ id: String) async throws {
        let reply = try await FinderAPI.get(["op": "list", "event": id], as: FinderListReply.self)
        state.events[id] = reply.event
        for folder in state.folders.values where folder.eventId == id { state.folders[folder.id] = nil }
        for file in state.files.values where file.eventId == id { state.files[file.id] = nil }
        for folder in reply.folders { state.folders[folder.id] = folder }
        for file in reply.files { state.files[file.id] = file }
        state.loaded.insert(id)
        if state.cursor == nil { state.cursor = reply.cursor }
        save()
    }

    /// Kosz CRM (elementy usunięte przez tego pracownika); zwraca elementy, które z niego zniknęły (przywrócone lub usunięte na zawsze).
    @discardableResult
    private func refreshTrash() async throws -> [String] {
        let reply = try await FinderAPI.get(["op": "trash"], as: FinderTrashReply.self)
        var fresh: [String: FinderTrashDTO] = [:]
        for entry in reply.items where entry.mine == true && fresh[entry.itemId] == nil { fresh[entry.itemId] = entry }
        let gone = state.trash.keys.filter { fresh[$0] == nil }
        state.trash = fresh
        state.trashAt = Date()
        save()
        return gone
    }

    private func knownFolder(_ id: String) async throws -> FinderFolderDTO {
        if let known = state.folders[id] { return known }
        let reply = try await FinderAPI.get(["op": "item", "kind": "folder", "id": id], as: FinderFolderReply.self)
        state.folders[id] = reply.item
        save()
        return reply.item
    }

    private func knownFile(_ id: String) async throws -> FinderFileDTO {
        if let known = state.files[id] { return known }
        let reply = try await FinderAPI.get(["op": "item", "kind": "file", "id": id], as: FinderFileReply.self)
        state.files[id] = reply.item
        save()
        return reply.item
    }

    // MARK: Odczyt dla Findera

    func children(of container: NSFileProviderItemIdentifier) async throws -> [NSFileProviderItem] {
        try open()
        switch FinderID.parse(container) {
        case .root:
            return [FinderItem.eventsRoot]
        case .events:
            if eventsStale { try await refreshEvents() }
            return years().sorted().map { yearItem($0) }
        case .year(let year):
            if eventsStale { try await refreshEvents() }
            let names = eventNames(year: year)
            return state.events.values.filter { Self.year(of: $0) == year }.map { eventItem($0, names: names) }
        case .event(let id):
            try await loadEvent(id)
            return contents(event: id, parent: nil)
        case .folder(let id):
            if state.folders[id] == nil, state.trash[id] != nil { return trashChildren(of: id) }
            let folder = try await knownFolder(id)
            if !state.loaded.contains(folder.eventId) { try await loadEvent(folder.eventId) }
            return contents(event: folder.eventId, parent: id)
        case .trash:
            try await refreshTrash()
            return trashRoots()
        case .workingSet:
            return try await everything()
        case .file, .unknown:
            throw NSFileProviderError(.noSuchItem)
        }
    }

    func item(for identifier: NSFileProviderItemIdentifier) async throws -> NSFileProviderItem {
        try open()
        switch FinderID.parse(identifier) {
        case .root:
            return FinderItem.root
        case .events:
            return FinderItem.eventsRoot
        case .year(let year):
            return yearItem(year)
        case .event(let id):
            if state.events[id] == nil { try await refreshEvents() }
            guard let event = state.events[id] else { throw NSFileProviderError(.noSuchItem) }
            return eventItem(event, names: eventNames(year: Self.year(of: event)))
        case .folder(let id):
            if state.folders[id] == nil, let trashed = state.trash[id] { return trashItem(trashed) }
            let folder = try await knownFolder(id)
            return folderItem(folder, names: siblingNames(event: folder.eventId, parent: folder.parentId))
        case .file(let id):
            if state.files[id] == nil, let trashed = state.trash[id] { return trashItem(trashed) }
            let file = try await knownFile(id)
            return fileItem(file, names: siblingNames(event: file.eventId, parent: file.parentId))
        case .workingSet, .trash, .unknown:
            throw NSFileProviderError(.noSuchItem)
        }
    }

    /// Podpisany adres treści pliku (także z kosza) i jego aktualny element (wersja z serwera).
    func download(file id: String) async throws -> (URL, NSFileProviderItem) {
        try open()
        let reply = try await FinderAPI.get(["op": "download", "id": id], as: FinderDownloadReply.self)
        guard let url = URL(string: reply.url) else { throw NSFileProviderError(.serverUnreachable) }
        if state.files[id] == nil, let trashed = state.trash[id] { return (url, trashItem(trashed)) }
        state.files[id] = reply.item
        save()
        return (url, fileItem(reply.item, names: siblingNames(event: reply.item.eventId, parent: reply.item.parentId)))
    }

    // MARK: Zmiany (zbiór roboczy)

    func currentAnchor() async -> NSFileProviderSyncAnchor? {
        do { try open() } catch { return nil }
        if state.cursor == nil { _ = try? await refreshEvents() }
        guard let cursor = state.cursor else { return nil }
        return NSFileProviderSyncAnchor(rawValue: Data(cursor.utf8))
    }

    func changes(since anchor: Data) async throws -> ChangeSet {
        try open()
        let since = String(data: anchor, encoding: .utf8) ?? ""
        let reply = try await FinderAPI.get(["op": "changes", "since": since], as: FinderChangesReply.self)
        if reply.reset == true {
            state.cursor = reply.cursor
            save()
            return ChangeSet(anchor: Data(reply.cursor.utf8), reset: true)
        }
        var result = ChangeSet(anchor: Data(reply.cursor.utf8))
        let yearsBefore = years()
        var eventsChanged = false
        var containers = Set<String>()
        for event in reply.events ?? [] {
            state.events[event.id] = event
            eventsChanged = true
        }
        for folder in reply.folders ?? [] where state.loaded.contains(folder.eventId) {
            if let old = state.folders[folder.id] { containers.insert(Self.key(old.eventId, old.parentId)) }
            state.folders[folder.id] = folder
            state.trash[folder.id] = nil
            containers.insert(Self.key(folder.eventId, folder.parentId))
        }
        for file in reply.files ?? [] where state.loaded.contains(file.eventId) {
            if let old = state.files[file.id] { containers.insert(Self.key(old.eventId, old.parentId)) }
            state.files[file.id] = file
            state.trash[file.id] = nil
            containers.insert(Self.key(file.eventId, file.parentId))
        }
        let deletions = reply.deleted ?? []
        if !deletions.isEmpty || trashStale {
            // Usunięte przez tego pracownika trafiają do Kosza Findera (kosz CRM), pozostałe znikają.
            let left = (try? await refreshTrash()) ?? []
            for id in left where state.files[id] == nil && state.folders[id] == nil {
                result.deleted.append(FinderID.file(id))
                result.deleted.append(FinderID.folder(id))
            }
        }
        for deleted in deletions {
            if deleted.kind == "folder" {
                if let old = state.folders.removeValue(forKey: deleted.id) { containers.insert(Self.key(old.eventId, old.parentId)) }
            } else {
                if let old = state.files.removeValue(forKey: deleted.id) { containers.insert(Self.key(old.eventId, old.parentId)) }
            }
            if let trashed = state.trash[deleted.id] {
                result.updated.append(trashItem(trashed))
            } else {
                result.deleted.append(deleted.kind == "folder" ? FinderID.folder(deleted.id) : FinderID.file(deleted.id))
            }
        }
        if eventsStale {
            let gone = try await refreshEvents()
            result.deleted += gone
            eventsChanged = true
        }
        if verifyStale {
            // Zakres widoczności: odebrany dostęp do folderu lub dokumentu (np. folder stał się „formalny”, zmiana roli)
            // nie zmienia samych plików, więc co 15 min porównujemy zawartość otwartych wydarzeń z tym, co widać na serwerze.
            for id in Array(state.loaded) where state.events[id] != nil {
                let folderIDs = Set(state.folders.values.filter { $0.eventId == id }.map(\.id))
                let fileIDs = Set(state.files.values.filter { $0.eventId == id }.map(\.id))
                do { try await loadEvent(id) } catch { continue }
                let nowFolders = Set(state.folders.values.filter { $0.eventId == id }.map(\.id))
                let nowFiles = Set(state.files.values.filter { $0.eventId == id }.map(\.id))
                for gone in folderIDs.subtracting(nowFolders) where state.trash[gone] == nil { result.deleted.append(FinderID.folder(gone)) }
                for gone in fileIDs.subtracting(nowFiles) where state.trash[gone] == nil { result.deleted.append(FinderID.file(gone)) }
                for folder in state.folders.values where folder.eventId == id { containers.insert(Self.key(id, folder.parentId)) }
                for file in state.files.values where file.eventId == id { containers.insert(Self.key(id, file.parentId)) }
            }
            state.verifiedAt = Date()
        }
        if eventsChanged {
            // Nazwy wydarzeń są unikalne w roku — przy zmianie odświeżamy wszystkie (to kilkaset elementów).
            result.deleted += yearsBefore.subtracting(years()).map { FinderID.year($0) }
            for year in years() {
                result.updated.append(yearItem(year))
                let names = eventNames(year: year)
                for event in state.events.values where Self.year(of: event) == year { result.updated.append(eventItem(event, names: names)) }
            }
        }
        for container in containers {
            let parts = container.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 2, state.loaded.contains(parts[0]) else { continue }
            result.updated += contents(event: parts[0], parent: parts[1].isEmpty ? nil : parts[1])
        }
        state.cursor = reply.cursor
        save()
        return result
    }

    /// Zbiór roboczy od nowa (po wygaśnięciu kursora): wszystkie wydarzenia, zawartość otwartych i kosz.
    private func everything() async throws -> [NSFileProviderItem] {
        try await refreshEvents()
        for id in Array(state.loaded) where state.events[id] != nil {
            do { try await loadEvent(id) } catch { state.loaded.remove(id) }
        }
        _ = try? await refreshTrash()
        var items: [NSFileProviderItem] = [FinderItem.eventsRoot]
        for year in years() {
            items.append(yearItem(year))
            let names = eventNames(year: year)
            for event in state.events.values where Self.year(of: event) == year { items.append(eventItem(event, names: names)) }
        }
        var containers = Set<String>()
        for folder in state.folders.values where state.loaded.contains(folder.eventId) { containers.insert(Self.key(folder.eventId, folder.parentId)) }
        for file in state.files.values where state.loaded.contains(file.eventId) { containers.insert(Self.key(file.eventId, file.parentId)) }
        for container in containers {
            let parts = container.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 2 else { continue }
            items += contents(event: parts[0], parent: parts[1].isEmpty ? nil : parts[1])
        }
        items += trashRoots()
        return items
    }

    // MARK: Zapis z Findera

    /// Miejsce w CRM dla elementu w folderze Findera: wydarzenie i folder (nil — główny folder wydarzenia).
    private func location(of parent: NSFileProviderItemIdentifier) async throws -> (event: String, folder: String?) {
        switch FinderID.parse(parent) {
        case .event(let id):
            return (id, nil)
        case .folder(let id):
            let folder = try await knownFolder(id)
            return (folder.eventId, id)
        default:
            // Mavinci, Eventy i lata to struktura z CRM — pliki dodaje się w folderach wydarzeń.
            throw NSFileProviderError(.cannotSynchronize, userInfo: [NSLocalizedDescriptionKey: "Pliki i foldery dodawaj w folderze wydarzenia."])
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
        var name = FinderName.crm(template.filename)
        if mayAlreadyExist, let existing = sibling(named: name, event: place.event, parent: place.folder, folder: isFolder) { return existing }
        if isFolder {
            let reply: FinderFolderReply
            do {
                reply = try await FinderAPI.post(["op": "createFolder", "eventId": place.event, "parentId": FinderAPI.json(place.folder), "name": name],
                                                 as: FinderFolderReply.self)
            } catch let error as FinderServerError where error.code == "exists" {
                if let existing = sibling(named: name, event: place.event, parent: place.folder, folder: true) { return existing }
                throw error
            }
            state.folders[reply.item.id] = reply.item
            save()
            return folderItem(reply.item, names: siblingNames(event: place.event, parent: place.folder))
        }
        // Nazwa zajęta w folderze (CRM wymaga unikalnych nazw) → „Plik (2).pdf”.
        let wanted = name
        name = freeName(wanted, event: place.event, parent: place.folder)
        let source = try contents ?? emptyFile()
        var attempt = 1
        while true {
            do {
                let file = try await uploadNew(source, name: name, event: place.event, parent: place.folder)
                return fileItem(file, names: siblingNames(event: place.event, parent: place.folder))
            } catch let error as FinderServerError where error.code == "exists" && attempt < 4 {
                attempt += 1
                name = FinderName.numbered(wanted, attempt)
            }
        }
    }

    /// Zmiana z Findera: kosz, przywrócenie, nazwa, położenie i treść. Odmowa serwera → element taki jak na serwerze.
    func modify(_ item: NSFileProviderItem, base: NSFileProviderItemVersion, fields: NSFileProviderItemFields,
                contents: URL?) async throws -> (NSFileProviderItem, Bool) {
        try open()
        let identifier = item.itemIdentifier
        let kind = FinderID.parse(identifier)
        let id: String
        let isFolder: Bool
        switch kind {
        case .folder(let value): id = value; isFolder = true
        case .file(let value): id = value; isFolder = false
        default:
            // Struktura (Mavinci, Eventy, lata, wydarzenia) — tylko zmiany lokalne, np. tagi.
            let current = try await self.item(for: identifier)
            return (current, false)
        }
        let moved = fields.contains(.parentItemIdentifier)
        // Do kosza: usunięcie w CRM (kosz na 30 dni).
        if moved, item.parentItemIdentifier == .trashContainer {
            do {
                _ = try await FinderAPI.post(["op": "remove", "kind": isFolder ? "folder" : "file", "id": id], as: FinderOK.self)
            } catch let error as FinderServerError where error.status == 403 {
                let current = try await serverItem(identifier)
                return (current, false)
            }
            dropLocal(id: id, folder: isFolder)
            try await refreshTrash()
            if let trashed = state.trash[id] { return (trashItem(trashed), false) }
            return (FinderItem(identifier: identifier, parent: .trashContainer, filename: item.filename, folder: isFolder, role: .trashed), false)
        }
        // Z kosza z powrotem: przywrócenie w CRM, potem ewentualne przeniesienie tam, gdzie upuszczono.
        if state.folders[id] == nil, state.files[id] == nil, state.trash[id] != nil {
            if fields.contains(.contents) || !moved {
                let current = try await self.item(for: identifier)
                return (current, false)
            }
            _ = try await FinderAPI.post(["op": "restore", "itemIds": [id]], as: FinderRestoreReply.self)
            state.trash[id] = nil
            if isFolder { state.folders[id] = nil } else { state.files[id] = nil }
            let restored = try await serverItem(identifier)
            if restored.parentItemIdentifier == item.parentItemIdentifier { return (restored, false) }
        }

        var body: [String: Any] = ["op": "update", "kind": isFolder ? "folder" : "file", "id": id]
        if fields.contains(.filename) { body["name"] = FinderName.crm(item.filename) }
        if moved {
            let place = try await location(of: item.parentItemIdentifier)
            body["eventId"] = place.event
            body["parentId"] = FinderAPI.json(place.folder)
        }
        var uploaded = false
        if fields.contains(.contents), !isFolder, let contents {
            let current = try await knownFile(id)
            let slot = try await upload(contents, name: FinderName.crm(item.filename), event: current.eventId)
            let content: [String: Any] = ["path": slot.path, "size": slot.size, "mime": slot.mime, "sha256": slot.sha,
                                          "baseContentVersion": Self.contentVersion(base)]
            body["content"] = content
            uploaded = true
        }
        if body.count == 3 {
            let current = try await self.item(for: identifier)
            return (current, false)
        }

        do {
            if isFolder {
                let reply = try await FinderAPI.post(body, as: FinderFolderReply.self)
                state.folders[id] = reply.item
                save()
                return (folderItem(reply.item, names: siblingNames(event: reply.item.eventId, parent: reply.item.parentId)), false)
            }
            let reply = try await FinderAPI.post(body, as: FinderFileReply.self)
            state.files[id] = reply.item
            save()
            return (fileItem(reply.item, names: siblingNames(event: reply.item.eventId, parent: reply.item.parentId)), false)
        } catch let error as FinderServerError where error.code == "conflict" && uploaded {
            // Ktoś zmienił plik w międzyczasie: wersja z serwera zostaje na miejscu, nasza jako kopia „(konflikt …)”.
            if let contents, let current = error.item {
                let copy = freeName(FinderName.conflictCopy(FinderName.crm(item.filename)), event: current.eventId, parent: current.parentId)
                _ = try? await uploadNew(contents, name: copy, event: current.eventId, parent: current.parentId)
                state.files[id] = current
                save()
                return (fileItem(current, names: siblingNames(event: current.eventId, parent: current.parentId)), true)
            }
            let current = try await serverItem(identifier)
            return (current, true)
        } catch let error as FinderServerError where [400, 403, 404, 409].contains(error.status) {
            // Odmowa (uprawnienia, zajęta nazwa, nazwa zastrzeżona dla dokumentów handlowych, folder do innego wydarzenia):
            // element wraca do stanu z serwera.
            NSLog("[Mavinci Finder] zmiana odrzucona: %@", error.message)
            let current = try await serverItem(identifier)
            return (current, uploaded)
        }
    }

    /// Usunięcie z Findera: do kosza CRM; z Kosza Findera — na zawsze.
    func delete(_ identifier: NSFileProviderItemIdentifier, recursive: Bool) async throws {
        try open()
        let id: String
        let isFolder: Bool
        switch FinderID.parse(identifier) {
        case .folder(let value): id = value; isFolder = true
        case .file(let value): id = value; isFolder = false
        default: throw NSFileProviderError(.deletionRejected)
        }
        if state.folders[id] == nil, state.files[id] == nil, state.trash[id] != nil {
            _ = try await FinderAPI.post(["op": "deleteForever", "itemIds": [id]], as: FinderRemoveReply.self)
            state.trash[id] = nil
            save()
            return
        }
        if isFolder, !recursive, hasChildren(id) { throw NSFileProviderError(.directoryNotEmpty) }
        do {
            _ = try await FinderAPI.post(["op": "remove", "kind": isFolder ? "folder" : "file", "id": id], as: FinderOK.self)
        } catch let error as FinderServerError where error.status == 403 {
            throw NSFileProviderError(.deletionRejected)
        }
        dropLocal(id: id, folder: isFolder)
        save()
    }

    // MARK: Wysyłanie

    private struct Uploaded {
        let path: String
        let size: Int64
        let mime: String
        let sha: String
    }

    private func upload(_ file: URL, name: String, event: String) async throws -> Uploaded {
        let slots = try await FinderAPI.post(["op": "prepareUpload", "eventId": event, "names": [name]], as: FinderUploadSlots.self)
        guard let slot = slots.slots.first, let target = URL(string: slot.url) else { throw NSFileProviderError(.serverUnreachable) }
        let ext = (name as NSString).pathExtension
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        let size = Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        let sha = try Self.sha256(file)
        try await FinderAPI.put(file, to: target, mime: mime)
        return Uploaded(path: slot.path, size: size, mime: mime, sha: sha)
    }

    private func uploadNew(_ file: URL, name: String, event: String, parent: String?) async throws -> FinderFileDTO {
        let slot = try await upload(file, name: name, event: event)
        let reply = try await FinderAPI.post(["op": "createFile", "eventId": event, "parentId": FinderAPI.json(parent), "name": name,
                                              "path": slot.path, "size": slot.size, "mime": slot.mime, "sha256": slot.sha],
                                             as: FinderFileReply.self)
        state.files[reply.item.id] = reply.item
        save()
        return reply.item
    }

    private func emptyFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data().write(to: url)
        return url
    }

    static func sha256(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 * 1024 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
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
        case .folder(let id): state.folders[id] = nil
        case .file(let id): state.files[id] = nil
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
            for f in state.files.values where f.parentId.map({ doomed.contains($0) }) == true { state.files[f.id] = nil }
            for d in doomed { state.folders[d] = nil }
        } else {
            state.files[id] = nil
        }
        save()
    }

    private func hasChildren(_ folder: String) -> Bool {
        state.folders.values.contains { $0.parentId == folder } || state.files.values.contains { $0.parentId == folder }
    }

    private func sibling(named name: String, event: String, parent: String?, folder: Bool) -> NSFileProviderItem? {
        let lower = name.lowercased()
        if folder, let match = state.folders.values.first(where: { $0.eventId == event && $0.parentId == parent && $0.name.lowercased() == lower }) {
            return folderItem(match, names: siblingNames(event: event, parent: parent))
        }
        if !folder, let match = state.files.values.first(where: { $0.eventId == event && $0.parentId == parent && $0.name.lowercased() == lower }) {
            return fileItem(match, names: siblingNames(event: event, parent: parent))
        }
        return nil
    }

    private func freeName(_ name: String, event: String, parent: String?) -> String {
        let taken = Set(state.files.values.filter { $0.eventId == event && $0.parentId == parent }.map { $0.name.lowercased() })
        var candidate = name
        var number = 2
        while taken.contains(candidate.lowercased()) {
            candidate = FinderName.numbered(name, number)
            number += 1
        }
        return candidate
    }

    // MARK: Elementy i nazwy

    private var eventsStale: Bool {
        guard let at = state.eventsAt else { return true }
        return Date().timeIntervalSince(at) > Self.eventsTTL
    }

    private var verifyStale: Bool {
        guard let at = state.verifiedAt else { return true }
        return Date().timeIntervalSince(at) > Self.eventsTTL
    }

    private var trashStale: Bool {
        guard let at = state.trashAt else { return true }
        return Date().timeIntervalSince(at) > Self.eventsTTL
    }

    private static func key(_ event: String, _ parent: String?) -> String { event + "|" + (parent ?? "") }

    static func year(of event: FinderEventDTO) -> String {
        guard let date = event.date, date.count >= 4 else { return "Bez daty" }
        return String(date.prefix(4))
    }

    private func years() -> Set<String> { Set(state.events.values.map { Self.year(of: $0) }) }

    private func yearItem(_ year: String) -> NSFileProviderItem {
        FinderItem(identifier: FinderID.year(year), parent: FinderID.events, filename: year, folder: true, role: .structure)
    }

    private func eventNames(year: String) -> [String: String] {
        let entries = state.events.values.filter { Self.year(of: $0) == year }.map { event in
            (id: event.id, name: FinderName.safe([event.date, event.name].compactMap { $0 }.joined(separator: " ")))
        }
        return FinderName.unique(entries)
    }

    private func eventItem(_ event: FinderEventDTO, names: [String: String]) -> NSFileProviderItem {
        FinderItem(identifier: FinderID.event(event.id), parent: FinderID.year(Self.year(of: event)),
                   filename: names[event.id] ?? FinderName.safe(event.name), folder: true, role: .event)
    }

    private func siblingNames(event: String, parent: String?) -> [String: String] {
        var entries: [(id: String, name: String)] = []
        for folder in state.folders.values where folder.eventId == event && folder.parentId == parent {
            entries.append((id: folder.id, name: FinderName.safe(folder.name)))
        }
        for file in state.files.values where file.eventId == event && file.parentId == parent {
            entries.append((id: file.id, name: FinderName.safe(file.name)))
        }
        return FinderName.unique(entries)
    }

    private func parentIdentifier(event: String, parent: String?) -> NSFileProviderItemIdentifier {
        parent.map { FinderID.folder($0) } ?? FinderID.event(event)
    }

    private func folderItem(_ folder: FinderFolderDTO, names: [String: String]) -> NSFileProviderItem {
        FinderItem(identifier: FinderID.folder(folder.id), parent: parentIdentifier(event: folder.eventId, parent: folder.parentId),
                   filename: names[folder.id] ?? FinderName.safe(folder.name), folder: true, role: .folder,
                   created: FinderDate.parse(folder.createdAt), modified: FinderDate.parse(folder.updatedAt))
    }

    private func fileItem(_ file: FinderFileDTO, names: [String: String]) -> NSFileProviderItem {
        FinderItem(identifier: FinderID.file(file.id), parent: parentIdentifier(event: file.eventId, parent: file.parentId),
                   filename: names[file.id] ?? FinderName.safe(file.name), folder: false, role: .file,
                   size: Int64(file.size ?? 0), created: FinderDate.parse(file.createdAt), modified: FinderDate.parse(file.updatedAt),
                   contentVersion: "\(file.contentVersion ?? 1)-\(file.sha256 ?? "")")
    }

    private func contents(event: String, parent: String?) -> [NSFileProviderItem] {
        let names = siblingNames(event: event, parent: parent)
        var items: [NSFileProviderItem] = []
        for folder in state.folders.values where folder.eventId == event && folder.parentId == parent {
            items.append(folderItem(folder, names: names))
        }
        for file in state.files.values where file.eventId == event && file.parentId == parent {
            items.append(fileItem(file, names: names))
        }
        return items
    }

    // MARK: Kosz

    /// Element kosza na najwyższym poziomie (nie leży w usuniętym razem z nim folderze).
    private func isTrashRoot(_ entry: FinderTrashDTO) -> Bool {
        guard let parent = entry.parentId, let parentEntry = state.trash[parent] else { return true }
        return parentEntry.batch != entry.batch
    }

    private func trashItem(_ entry: FinderTrashDTO) -> NSFileProviderItem {
        let folder = entry.kind == "folder"
        let parent: NSFileProviderItemIdentifier = isTrashRoot(entry) ? .trashContainer : FinderID.folder(entry.parentId ?? "")
        return FinderItem(identifier: folder ? FinderID.folder(entry.itemId) : FinderID.file(entry.itemId), parent: parent,
                          filename: FinderName.safe(entry.name), folder: folder, role: .trashed,
                          size: folder ? nil : Int64(entry.size ?? 0), modified: FinderDate.parse(entry.deletedAt))
    }

    private func trashRoots() -> [NSFileProviderItem] {
        let roots = state.trash.values.filter { isTrashRoot($0) }
        let names = FinderName.unique(roots.map { (id: $0.itemId, name: FinderName.safe($0.name)) })
        return roots.map { entry in
            let folder = entry.kind == "folder"
            return FinderItem(identifier: folder ? FinderID.folder(entry.itemId) : FinderID.file(entry.itemId), parent: .trashContainer,
                              filename: names[entry.itemId] ?? FinderName.safe(entry.name), folder: folder, role: .trashed,
                              size: folder ? nil : Int64(entry.size ?? 0), modified: FinderDate.parse(entry.deletedAt))
        }
    }

    private func trashChildren(of folder: String) -> [NSFileProviderItem] {
        guard let parentEntry = state.trash[folder] else { return [] }
        return state.trash.values.filter { $0.parentId == folder && $0.batch == parentEntry.batch }.map { trashItem($0) }
    }
}

struct FinderOK: Decodable {}
struct FinderRestoreReply: Decodable { let restored: Int? }
struct FinderRemoveReply: Decodable { let removed: Int? }
