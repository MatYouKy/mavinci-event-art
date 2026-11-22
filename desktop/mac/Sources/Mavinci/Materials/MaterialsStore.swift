import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Materiały (`/crm/materials`) — baza plików firmy natywnie, 1:1 z CRM
//
// Marki z dostępem, drzewo folderów, zawartość folderu (sortowanie jak w CRM), wyszukiwanie w Materiałach i w plikach
// wydarzeń („Zapisz w Materiałach”), karta pliku (opis, tagi, wersje, podmiana treści), kosz na 30 dni i wysyłka plików oraz
// całych folderów z Findera (z postępem; miniatura zdjęcia, klatka wideo i strona PDF jak w przeglądarce). Wszystko przez
// `/bridge/native/v1/materials` tokenem pracownika — uprawnienia i zakres marek liczy baza (RLS).
// Lokalnie na dysku: marki, drzewo i ostatnio oglądane foldery (zaszyfrowane) oraz miniatury — ekran otwiera się od razu,
// także bez internetu. Pliki do podglądu (Quick Look), otwarcia i przeciągania — kopie w katalogu tymczasowym.

@MainActor final class MaterialsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: MaterialsHome?
    @Published var loadError: String?
    @Published private(set) var loading = false
    /// Wybrana marka i folder (nil — główny folder marki).
    @Published private(set) var companyID: String?
    @Published private(set) var folderID: String?
    @Published var sort: MaterialsSort = .name { didSet { if sort != oldValue { Task { await loadList() } } } }
    @Published private(set) var listings: [String: MaterialsListing] = [:]
    @Published private(set) var listLoading = false
    @Published var trashMode = false
    @Published private(set) var trash: [MaterialTrashItem] = []
    @Published private(set) var trashLoading = false
    @Published var query = ""
    @Published var scope: MaterialsScope = .materials
    @Published private(set) var search: MaterialsSearchReply?
    @Published private(set) var searching = false
    @Published private(set) var details: [String: MaterialFileDetail] = [:]
    @Published var uploads: MaterialsUploadBatch?
    /// Albumy wybranej marki i otwarty album (nil — foldery). Album to odnośniki do plików, bez kopii.
    @Published private(set) var albums: [MaterialAlbum] = []
    @Published private(set) var albumID: String?
    @Published private(set) var albumFiles: [String: [MaterialFile]] = [:]

    private var namespace: String?
    private var homeFile: SealedFile<MaterialsHome>?
    private var listsFile: SealedFile<[String: MaterialsListing]>?
    private var uploadTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: MaterialAccess? { home?.access }
    var canManage: Bool { home?.access.manage == true }
    var folders: [MaterialFolder] { home?.folders ?? [] }

    private func key(_ company: String?, _ folder: String?, _ sort: MaterialsSort) -> String { "\(company ?? "")|\(folder ?? "")|\(sort.rawValue)" }
    var listing: MaterialsListing? { listings[key(companyID ?? home?.company.id, folderID, sort)] }
    var searchActive: Bool { query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 }

    // MARK: Kopia na dysku

    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let homeSealed = SealedFile<MaterialsHome>(namespace: "materials-home-\(next)")
        let listsSealed = SealedFile<[String: MaterialsListing]>(namespace: "materials-lists-\(next)")
        MaterialsThumbnails.shared.open(namespace: next)
        Task {
            let saved = await Task.detached(priority: .userInitiated) { (try? homeSealed.load(), try? listsSealed.load()) }.value
            guard namespace == next else { return }
            homeFile = homeSealed
            listsFile = listsSealed
            if home == nil, let savedHome = saved.0 ?? nil {
                home = savedHome
                if companyID == nil { companyID = savedHome.company.id }
            }
            if listings.isEmpty, let savedLists = saved.1 ?? nil { listings = savedLists }
        }
    }

    func reset(clearDisk: Bool = true) {
        uploadTask?.cancel(); uploadTask = nil
        searchTask?.cancel(); searchTask = nil
        if clearDisk {
            try? homeFile?.clear()
            try? listsFile?.clear()
            MaterialsThumbnails.shared.clear()
        }
        homeFile = nil; listsFile = nil; namespace = nil
        home = nil; loadError = nil; loading = false; companyID = nil; folderID = nil; sort = .name
        listings = [:]; listLoading = false; trashMode = false; trash = []; trashLoading = false
        query = ""; scope = .materials; search = nil; searching = false; details = [:]; uploads = nil
        albums = []; albumID = nil; albumFiles = [:]
    }

    private func saveLists() {
        guard let listsFile else { return }
        // Najwyżej 60 ostatnich folderów (bieżąca marka najpierw).
        var copy = listings
        if copy.count > 60 {
            let current = companyID ?? ""
            for key in copy.keys.filter({ !$0.hasPrefix(current + "|") }) where copy.count > 60 { copy[key] = nil }
            for key in copy.keys where copy.count > 60 { copy[key] = nil }
        }
        Task.detached(priority: .utility) { try? listsFile.save(copy) }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Odczyt

    func loadHome(quiet: Bool = false) async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        var query: [String: String] = ["op": "home"]
        if let companyID { query["company"] = companyID }
        do {
            let data = try JSONDecoder().decode(MaterialsHome.self, from: try await api.get("/materials", query: query))
            guard owner == workspace?.employee?.id else { return }
            // Marka bez dostępu → serwer podaje pierwszą dostępną.
            if companyID != data.company.id { companyID = data.company.id; folderID = nil }
            home = data
            loadError = nil
            if let homeFile { let copy = data; Task.detached(priority: .utility) { try? homeFile.save(copy) } }
            if let folderID, !data.folders.contains(where: { $0.id == folderID }) { self.folderID = nil }
            purgeIfDue(data)
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if !quiet || home == nil { loadError = failureText(error, "Nie udało się pobrać Materiałów.") }
        }
    }

    /// Sprzątanie (kosz po 30 dniach, stare wersje, przerwane wysyłki) — najwyżej co 6 godzin, jak w CRM.
    private func purgeIfDue(_ data: MaterialsHome) {
        guard data.access.manage, let api, let employee = workspace?.employee?.id else { return }
        let key = "materials.purgeAt.\(employee)"
        let last = UserDefaults.standard.double(forKey: key)
        guard Date().timeIntervalSince1970 - last > 6 * 3600 else { return }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: key)
        Task { _ = try? await api.post("/materials", ["op": .string("purge")]) }
    }

    func loadList(quiet: Bool = false) async {
        guard let api, let company = companyID ?? home?.company.id else { return }
        let folder = folderID, order = sort
        let owner = workspace?.employee?.id
        if !quiet { listLoading = true }
        defer { if !quiet { listLoading = false } }
        var query: [String: String] = ["op": "list", "company": company, "sort": order.rawValue, "limit": "500"]
        if let folder { query["folder"] = folder }
        do {
            let data = try JSONDecoder().decode(MaterialsListing.self, from: try await api.get("/materials", query: query))
            guard owner == workspace?.employee?.id else { return }
            listings[key(company, folder, order)] = data
            saveLists()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if let failure = error as? NativeFailure, failure.status == 404, folder != nil, folderID == folder {
                folderID = nil
                await loadList()
                return
            }
            if !quiet { workspace?.error = failureText(error, "Nie udało się pobrać plików.") }
        }
    }

    /// Kolejne pliki folderu (ponad 500).
    func loadMore() async {
        guard let api, let company = companyID, let current = listing else { return }
        var query: [String: String] = ["op": "list", "company": company, "sort": sort.rawValue, "limit": "500", "offset": String(current.files.count)]
        if let folderID { query["folder"] = folderID }
        do {
            let data = try JSONDecoder().decode(MaterialsListing.self, from: try await api.get("/materials", query: query))
            var merged = current
            merged.files += data.files.filter { file in !current.files.contains { $0.id == file.id } }
            merged.total = data.total
            listings[key(company, folderID, sort)] = merged
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać plików.")
        }
    }

    /// Odświeżenie drzewa i bieżącego folderu (po zmianach i w tle).
    func refresh(quiet: Bool = true) async {
        await loadHome(quiet: quiet)
        await loadList(quiet: quiet)
        if trashMode { await loadTrash() }
        await loadAlbums()
        if let albumID { await loadAlbum(albumID) }
    }

    // MARK: Nawigacja

    func openFolder(_ id: String?) {
        trashMode = false
        albumID = nil
        query = ""
        folderID = id
        Task { await loadList(quiet: listing != nil) }
    }

    func switchCompany(_ id: String) {
        guard id != companyID else { return }
        companyID = id
        folderID = nil
        trashMode = false
        albumID = nil
        albums = []
        query = ""
        trash = []
        Task {
            await loadHome(quiet: true)
            await loadList()
        }
    }

    func path(of folder: String?) -> [MaterialFolder] {
        var result: [MaterialFolder] = []
        var cursor = folder
        var depth = 0
        while let id = cursor, let item = folders.first(where: { $0.id == id }), depth < 40 {
            result.insert(item, at: 0)
            cursor = item.parentId
            depth += 1
        }
        return result
    }

    /// Folder i wszystkie jego podfoldery (blokada przeniesienia folderu do samego siebie).
    func descendants(of id: String) -> Set<String> {
        var result: Set<String> = [id]
        var grown = true
        while grown {
            grown = false
            for folder in folders where folder.parentId.map({ result.contains($0) }) == true && !result.contains(folder.id) {
                result.insert(folder.id)
                grown = true
            }
        }
        return result
    }

    /// Kolejność folderów: domyślne marki (wg kolejności), potem alfabetycznie.
    static func ordered(_ list: [MaterialFolder]) -> [MaterialFolder] {
        list.sorted { a, b in
            if (a.systemKey == nil) != (b.systemKey == nil) { return a.systemKey != nil }
            if a.sortOrder != b.sortOrder { return a.sortOrder < b.sortOrder }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }

    // MARK: Wyszukiwanie

    /// Wyszukiwanie z opóźnieniem po wpisaniu (Materiały wszystkich marek albo pliki wydarzeń).
    func scheduleSearch() {
        searchTask?.cancel()
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2 else { search = nil; searching = false; return }
        let currentScope = scope
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled, let api else { return }
            searching = true
            defer { searching = false }
            do {
                let data = try await api.get("/materials", query: ["op": "search", "q": text, "scope": currentScope.rawValue])
                guard !Task.isCancelled else { return }
                search = try JSONDecoder().decode(MaterialsSearchReply.self, from: data)
            } catch {
                if !Task.isCancelled { workspace?.error = failureText(error, "Nie udało się wyszukać.") }
            }
        }
    }

    // MARK: Karta pliku

    func loadDetail(_ id: String) async {
        guard let api else { return }
        do {
            details[id] = try JSONDecoder().decode(MaterialFileDetail.self, from: try await api.get("/materials", query: ["op": "file", "id": id]))
        } catch {
            if let failure = error as? NativeFailure, failure.status == 404 { details[id] = nil }
        }
    }

    // MARK: Czynności

    private func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval? = nil) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return try await api.post("/materials", payload, timeout: timeout)
    }

    /// Czynność z modalnym wskaźnikiem; po sukcesie — odświeżenie i sygnał dla Findera.
    @discardableResult
    private func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?, timeout: TimeInterval? = nil) async -> Data? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body, timeout: timeout) }
            if let success { workspace.succeed(success) }
            FinderDomain.signal()
            return data
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się.")
            return nil
        }
    }

    func createFolder(_ name: String, parent: String?) async {
        guard let company = companyID else { return }
        let body: [String: JSONValue] = ["companyId": .string(company), "parentId": parent.map { .string($0) } ?? .null, "name": .string(name)]
        guard await run("Tworzę folder", "createFolder", body, success: "Utworzono folder") != nil else { return }
        await refresh()
    }

    func rename(_ ref: MaterialRef, to name: String) async {
        guard name != ref.name else { return }
        guard await run("Zmieniam nazwę", "rename", ["kind": .string(ref.kind), "id": .string(ref.id), "name": .string(name)], success: "Zmieniono nazwę") != nil else { return }
        if ref.kind == "file" { details[ref.id] = nil }
        await refresh()
    }

    /// Przeniesienie do folderu tej samej marki (`nil` — główny folder marki).
    func move(_ refs: [MaterialRef], to target: String?) async {
        guard let workspace, let company = companyID, !refs.isEmpty else { return }
        var blocked = Set<String>()
        for ref in refs where ref.kind == "folder" { blocked.formUnion(descendants(of: ref.id)) }
        if let target, blocked.contains(target) {
            workspace.notice = "Nie można przenieść folderu do niego samego ani do jego podfolderu."
            return
        }
        let body: [String: JSONValue] = [
            "companyId": .string(company), "items": .array(refs.map(\.json)), "targetFolderId": target.map { .string($0) } ?? .null,
        ]
        guard let data = await run("Przenoszę", "move", body, success: nil),
              let result = try? JSONDecoder().decode(MaterialBatchResult.self, from: data) else { return }
        if result.failed.isEmpty {
            workspace.succeed((result.moved ?? 0) == 1 ? "Przeniesiono" : "Przeniesiono: \(result.moved ?? 0)")
        } else {
            let moved = result.moved ?? 0
            workspace.error = (moved > 0 ? "Przeniesiono: \(moved). " : "") + "Nie przeniesiono: " + result.failed.map { "\($0.name) — \($0.error)" }.joined(separator: "; ")
        }
        await refresh()
    }

    /// Do kosza na 30 dni (folder razem z zawartością).
    func remove(_ refs: [MaterialRef]) async {
        guard let workspace, !refs.isEmpty else { return }
        guard let data = await run("Przenoszę do kosza", "remove", ["items": .array(refs.map(\.json))], success: nil),
              let result = try? JSONDecoder().decode(MaterialBatchResult.self, from: data) else { return }
        if result.failed.isEmpty {
            workspace.succeed((result.removed ?? 0) == 1 ? "Przeniesiono do kosza" : "Przeniesiono do kosza: \(result.removed ?? 0)")
        } else {
            let removed = result.removed ?? 0
            workspace.error = (removed > 0 ? "Usunięto: \(removed). " : "") + "Nie usunięto: " + result.failed.map { "\($0.name) — \($0.error)" }.joined(separator: "; ")
        }
        for ref in refs where ref.kind == "file" { details[ref.id] = nil }
        await refresh()
    }

    /// Opis i tagi pliku.
    func updateFile(_ id: String, description: String, tags: [String]) async {
        let body: [String: JSONValue] = ["id": .string(id), "description": .string(description), "tags": .array(tags.map { .string($0) })]
        guard await run("Zapisuję opis", "updateFile", body, success: "Zapisano opis i tagi") != nil else { return }
        await loadDetail(id)
        await loadList(quiet: true)
    }

    /// Plik wydarzenia → kopia w Materiałach (bez duplikatu tego samego pliku w marce).
    func copyFromEvent(_ hit: MaterialEventHit, to folder: String?) async {
        guard let workspace, let company = companyID else { return }
        let body: [String: JSONValue] = ["eventFileId": .string(hit.id), "companyId": .string(company), "folderId": folder.map { .string($0) } ?? .null]
        guard let data = await run("Zapisuję w Materiałach", "copyFromEvent", body, success: nil, timeout: 300),
              let reply = try? JSONDecoder().decode(MaterialCopyReply.self, from: data) else { return }
        if reply.existing { workspace.notice = "Ten plik jest już w Materiałach tej marki." }
        else { workspace.succeed("Zapisano „\(reply.file.name)” w Materiałach") }
        await refresh()
    }

    // MARK: Kosz

    func loadTrash() async {
        guard let api, let company = companyID, canManage else { trash = []; return }
        trashLoading = true
        defer { trashLoading = false }
        do {
            trash = try JSONDecoder().decode(MaterialTrashReply.self, from: try await api.get("/materials", query: ["op": "trash", "company": company])).items
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać kosza.")
        }
    }

    func restore(_ items: [MaterialTrashItem]) async {
        guard !items.isEmpty else { return }
        guard await run("Przywracam", "restore", ["ids": .array(items.map { .string($0.id) })],
                        success: items.count == 1 ? "Przywrócono „\(items[0].name)”" : "Przywrócono: \(items.count)") != nil else { return }
        await refresh()
        await loadTrash()
    }

    func deleteForever(_ items: [MaterialTrashItem]) async {
        guard !items.isEmpty else { return }
        guard await run("Usuwam na zawsze", "deleteForever", ["ids": .array(items.map { .string($0.id) })], success: "Usunięto na zawsze") != nil else { return }
        await loadTrash()
        await loadHome(quiet: true)
    }

    func emptyTrash() async {
        guard let company = companyID else { return }
        guard await run("Opróżniam kosz", "deleteForever", ["companyId": .string(company), "all": .bool(true)], success: "Kosz jest pusty") != nil else { return }
        await loadTrash()
        await loadHome(quiet: true)
    }

    // MARK: Pliki lokalnie (podgląd, otwarcie, przeciąganie, pobieranie)

    /// Podpisany adres (1 h): materiał, poprzednia wersja, plik z kosza albo plik wydarzenia.
    func signedURL(kind: String, id: String, download: Bool = false) async throws -> MaterialUrlReply {
        guard let api else { throw AppError.configuration }
        var query = ["op": "url", "kind": kind, "id": id]
        if download { query["mode"] = "download" }
        return try JSONDecoder().decode(MaterialUrlReply.self, from: try await api.get("/materials", query: query))
    }

    /// Kopia pliku w katalogu tymczasowym (jedna na wersję treści) — Quick Look, otwarcie, przeciągnięcie do Findera.
    func localFile(kind: String = "material", id: String, version: Int = 1, name: String) async throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-materialy/\(kind)-\(id)-\(version)", isDirectory: true)
        let safe = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let target = folder.appendingPathComponent(safe.isEmpty ? "plik" : safe)
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let link = try await signedURL(kind: kind, id: id)
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        let (temporary, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: target.path) { try? FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: temporary, to: target)
        return target
    }

    func localFile(_ file: MaterialFile) async throws -> URL {
        try await localFile(kind: "material", id: file.id, version: file.contentVersion, name: file.name)
    }

    /// Kopia już pobrana (przeciąganie bez czekania).
    func cachedLocalFile(_ file: MaterialFile) -> URL? {
        let safe = file.name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-materialy/material-\(file.id)-\(file.contentVersion)/\(safe.isEmpty ? "plik" : safe)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Kopia w „Pobrane” (z nazwą bez nadpisywania) i pokazanie w Finderze.
    func downloadToDownloads(kind: String = "material", id: String, version: Int = 1, name: String) async {
        guard let workspace else { return }
        do {
            let local = try await workspace.withPending("Pobieranie…") { try await localFile(kind: kind, id: id, version: version, name: name) }
            let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            let base = (local.lastPathComponent as NSString).deletingPathExtension
            let ext = local.pathExtension
            var target = folder.appendingPathComponent(local.lastPathComponent)
            var copy = 1
            while FileManager.default.fileExists(atPath: target.path) {
                target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                copy += 1
            }
            try FileManager.default.copyItem(at: local, to: target)
            NSWorkspace.shared.activateFileViewerSelecting([target])
            workspace.succeed("Plik został pobrany")
        } catch {
            workspace.error = failureText(error, "Nie udało się pobrać pliku.")
        }
    }

    /// Przeciągnięcie pliku z aplikacji do Findera albo innej aplikacji: plik (pobrany przy upuszczeniu) i odnośnik dla
    /// przenoszenia między folderami w aplikacji.
    func dragProvider(_ file: MaterialFile, refs: [MaterialRef]) -> NSItemProvider {
        let provider: NSItemProvider
        if let local = cachedLocalFile(file), let ready = NSItemProvider(contentsOf: local) {
            provider = ready
        } else {
            provider = NSItemProvider()
            let type = MaterialsText.type(of: file.name)
            let store = self
            provider.registerFileRepresentation(forTypeIdentifier: type.identifier, fileOptions: [], visibility: .all) { completion in
                Task { @MainActor in
                    do { completion(try await store.localFile(file), false, nil) } catch { completion(nil, false, error) }
                }
                return nil
            }
        }
        provider.suggestedName = file.name
        provider.registerObject(MaterialsDrag.payload(refs) as NSString, visibility: .ownProcess)
        return provider
    }

    func folderDragProvider(_ refs: [MaterialRef]) -> NSItemProvider {
        NSItemProvider(object: MaterialsDrag.payload(refs) as NSString)
    }

    // MARK: Albumy

    var album: MaterialAlbum? { albums.first { $0.id == albumID } }

    /// Albumy marki (bez migracji albumów na serwerze — pusta lista).
    func loadAlbums() async {
        guard let api, let company = companyID ?? home?.company.id else { return }
        if let data = try? await api.get("/materials", query: ["op": "albums", "company": company]),
           let reply = try? JSONDecoder().decode(MaterialAlbumsReply.self, from: data) {
            guard company == (companyID ?? home?.company.id) else { return }
            albums = reply.albums
            if let albumID, !reply.albums.contains(where: { $0.id == albumID }) { self.albumID = nil }
        } else {
            albums = []
        }
    }

    func openAlbum(_ id: String?) {
        trashMode = false
        query = ""
        albumID = id
        if let id { Task { await loadAlbum(id) } }
    }

    func loadAlbum(_ id: String) async {
        guard let api else { return }
        do {
            let reply = try JSONDecoder().decode(MaterialAlbumReply.self, from: try await api.get("/materials", query: ["op": "album", "id": id]))
            albumFiles[id] = reply.files
            if let index = albums.firstIndex(where: { $0.id == id }) { albums[index] = reply.album }
        } catch {
            if let failure = error as? NativeFailure, failure.status == 404 { albumFiles[id] = nil; if albumID == id { albumID = nil } }
            else { workspace?.error = failureText(error, "Nie udało się otworzyć albumu.") }
        }
    }

    /// Nowy album (z zaznaczonymi plikami — odnośniki) w bieżącej marce.
    func createAlbum(_ name: String, fileIDs: [String] = []) async {
        guard let company = companyID ?? home?.company.id else { return }
        let body: [String: JSONValue] = ["companyId": .string(company), "name": .string(name), "fileIds": .array(fileIDs.map { .string($0) })]
        guard let data = await run("Tworzę album", "createAlbum", body, success: nil) else { return }
        struct Reply: Decodable { let album: MaterialAlbum; let added: Int }
        if let reply = try? JSONDecoder().decode(Reply.self, from: data) {
            workspace?.succeed(reply.added > 0 ? "Utworzono album „\(reply.album.name)” (\(reply.added)) — pliki zostały na swoich miejscach" : "Utworzono album „\(reply.album.name)”")
        }
        await loadAlbums()
    }

    func updateAlbum(_ album: MaterialAlbum, name: String, description: String) async {
        let body: [String: JSONValue] = ["id": .string(album.id), "name": .string(name), "description": .string(description)]
        guard await run("Zapisuję album", "updateAlbum", body, success: "Zapisano album") != nil else { return }
        await loadAlbums()
    }

    func setAlbumCover(_ album: MaterialAlbum, file: MaterialFile) async {
        guard await run("Ustawiam okładkę", "updateAlbum", ["id": .string(album.id), "coverFileId": .string(file.id)], success: "Ustawiono okładkę albumu") != nil else { return }
        await loadAlbum(album.id)
    }

    /// Usunięcie albumu — pliki zostają w Materiałach.
    func deleteAlbum(_ album: MaterialAlbum) async {
        guard await run("Usuwam album", "deleteAlbum", ["id": .string(album.id)], success: "Usunięto album — pliki zostały w Materiałach") != nil else { return }
        if albumID == album.id { albumID = nil }
        albumFiles[album.id] = nil
        await loadAlbums()
    }

    /// Pliki do albumu — odnośniki (ten sam plik może być w wielu albumach).
    func addToAlbum(_ album: MaterialAlbum, fileIDs: [String]) async {
        guard !fileIDs.isEmpty else { return }
        let body: [String: JSONValue] = ["id": .string(album.id), "fileIds": .array(fileIDs.map { .string($0) })]
        guard let data = await run("Dodaję do albumu", "albumAdd", body, success: nil),
              let reply = try? JSONDecoder().decode(MaterialAlbumAddReply.self, from: data) else { return }
        if reply.added > 0 {
            workspace?.succeed("Dodano do albumu „\(album.name)”: \(reply.added)" + (reply.skipped > 0 ? " (pominięto: \(reply.skipped))" : "") + " — bez kopiowania plików")
        } else {
            workspace?.notice = "Album „\(album.name)” ma już te pliki."
        }
        await loadAlbums()
        if albumFiles[album.id] != nil { await loadAlbum(album.id) }
    }

    /// Usunięcie odnośników z albumu — pliki zostają w Materiałach.
    func removeFromAlbum(_ album: MaterialAlbum, fileIDs: [String]) async {
        guard !fileIDs.isEmpty else { return }
        let body: [String: JSONValue] = ["id": .string(album.id), "fileIds": .array(fileIDs.map { .string($0) })]
        guard await run("Usuwam z albumu", "albumRemove", body, success: fileIDs.count == 1 ? "Usunięto z albumu — plik został w Materiałach" : "Usunięto z albumu: \(fileIDs.count)") != nil else { return }
        await loadAlbum(album.id)
        await loadAlbums()
    }

    /// Kolejność plików w albumie (przeciąganie) — od razu na ekranie, potem na serwerze.
    func reorderAlbum(_ album: MaterialAlbum, ids: [String]) async {
        if let files = albumFiles[album.id] { albumFiles[album.id] = ids.compactMap { id in files.first { $0.id == id } } }
        guard let workspace, workspace.canWrite, let api else { return }
        do {
            _ = try await api.post("/materials", ["op": .string("albumReorder"), "id": .string(album.id), "fileIds": .array(ids.map { .string($0) })])
            workspace.succeed("Zmieniono kolejność w albumie")
        } catch {
            workspace.error = failureText(error, "Nie udało się zmienić kolejności.")
            await loadAlbum(album.id)
        }
    }

    func reorderAlbums(_ ids: [String]) async {
        guard let company = companyID ?? home?.company.id else { return }
        albums = ids.compactMap { id in albums.first { $0.id == id } }
        guard let workspace, workspace.canWrite, let api else { return }
        do {
            _ = try await api.post("/materials", ["op": .string("albumsReorder"), "companyId": .string(company), "ids": .array(ids.map { .string($0) })])
            workspace.succeed("Zmieniono kolejność albumów")
        } catch {
            workspace.error = failureText(error, "Nie udało się zmienić kolejności albumów.")
            await loadAlbums()
        }
    }

    // MARK: Wysyłka

    /// Pliki i foldery z Findera (albo okna wyboru) do folderu marki: foldery powstają jak na dysku, najwyżej 100 plików naraz.
    func upload(_ urls: [URL], to parent: String?) {
        guard let workspace else { return }
        guard canManage else { workspace.notice = "Nie masz uprawnień do dodawania plików w Materiałach tej marki."; return }
        guard workspace.canWrite else { workspace.error = "Wysyłka wymaga połączenia z serwerem CRM."; return }
        guard uploadTask == nil, let company = home?.company else { return }
        var jobs = Self.jobs(from: urls, parent: parent)
        if jobs.count > MaterialsText.maxBatch {
            workspace.notice = "Naraz można wgrać najwyżej \(MaterialsText.maxBatch) plików — wgrywam pierwsze \(MaterialsText.maxBatch)."
            jobs = Array(jobs.prefix(MaterialsText.maxBatch))
        }
        guard !jobs.isEmpty else { workspace.notice = "Nie znaleziono plików do wysłania."; return }
        start(jobs, company: company, temporary: urls)
    }

    /// Nowa treść pliku (poprzednia zostaje jako wersja na 30 dni).
    func replace(_ file: MaterialFile, with url: URL) {
        guard let workspace, canManage, uploadTask == nil, let company = home?.company else { return }
        guard workspace.canWrite else { workspace.error = "Wysyłka wymaga połączenia z serwerem CRM."; return }
        let job = MaterialsUploadJob(url: url, dirs: [], parent: file.folderId, replace: (file.id, file.contentVersion))
        start([job], company: company, temporary: [url])
    }

    func cancelUploads() { uploadTask?.cancel() }

    private func start(_ jobs: [MaterialsUploadJob], company: MaterialCompany, temporary: [URL]) {
        let maxBytes = Int64(home?.maxBytes ?? 2_147_483_648)
        uploads = MaterialsUploadBatch(rows: jobs.map { job -> MaterialsUploadRow in
            let size = MaterialMedia.size(of: job.url)
            let place = ([company.name] + path(of: job.parent).map(\.name) + job.dirs).joined(separator: " / ")
            return MaterialsUploadRow(id: job.id, name: job.url.lastPathComponent, size: size, place: place,
                                      status: size > maxBytes ? .failed : .waiting, error: size > maxBytes ? "Plik jest większy niż 2 GB." : nil)
        }, running: true)
        uploadTask = Task { [weak self] in
            guard let self else { return }
            var cache: [String: String?] = [:]
            var done = 0, failed = 0
            for job in jobs {
                guard let row = self.uploads?.rows.first(where: { $0.id == job.id }), row.status == .waiting else {
                    failed += 1
                    continue
                }
                if Task.isCancelled { self.patch(job.id) { $0.status = .cancelled }; continue }
                self.patch(job.id) { $0.status = .uploading }
                do {
                    var target: String? = job.parent
                    if job.replace == nil { target = try await self.ensureFolders(company: company.id, parent: job.parent, dirs: job.dirs, cache: &cache) }
                    try await self.send(job, company: company.id, folder: target)
                    self.patch(job.id) { $0.status = .done; $0.sent = $0.size }
                    done += 1
                } catch is CancellationError {
                    self.patch(job.id) { $0.status = .cancelled }
                } catch let error as URLError where error.code == .cancelled {
                    self.patch(job.id) { $0.status = .cancelled }
                } catch {
                    failed += 1
                    let message = self.failureText(error, "Nie udało się wysłać pliku.")
                    self.patch(job.id) { $0.status = .failed; $0.error = message }
                }
            }
            let cancelled = Task.isCancelled
            self.uploadTask = nil
            self.uploads?.running = false
            PortfolioDrop.cleanup(temporary)
            FinderDomain.signal()
            await self.refresh()
            for job in jobs { if let id = job.replace?.id { self.details[id] = nil; await self.loadDetail(id) } }
            guard let workspace = self.workspace else { return }
            if cancelled {
                workspace.notice = done > 0 ? "Wysyłkę przerwano — wgrano: \(done)." : "Wysyłkę przerwano."
            } else if failed > 0 {
                workspace.error = "Wgrano: \(done). Nie udało się: \(failed) — szczegóły w oknie wysyłki."
            } else {
                workspace.succeed(done == 1 ? (jobs.first?.replace != nil ? "Podmieniono plik" : "Wgrano plik") : "Wgrano pliki: \(done)")
                self.uploads = nil
            }
        }
    }

    func closeUploads() {
        guard uploads?.running != true else { return }
        uploads = nil
    }

    private func patch(_ id: UUID, _ change: (inout MaterialsUploadRow) -> Void) {
        guard var batch = uploads, let index = batch.rows.firstIndex(where: { $0.id == id }) else { return }
        change(&batch.rows[index])
        uploads = batch
    }

    /// Folder docelowy dla pliku z przeciągniętego folderu (tworzy brakujące podfoldery, jak na dysku).
    private func ensureFolders(company: String, parent: String?, dirs: [String], cache: inout [String: String?]) async throws -> String? {
        var current = parent
        for index in dirs.indices {
            let key = "\(parent ?? "")/" + dirs[...index].joined(separator: "/")
            if let known = cache[key] { current = known; continue }
            let name = String(dirs[index].trimmingCharacters(in: .whitespacesAndNewlines).prefix(255)).nonEmptyName
            let parentID = current
            if let existing = folders.first(where: { $0.parentId == parentID && $0.name.lowercased() == name.lowercased() }) {
                cache[key] = existing.id
                current = existing.id
                continue
            }
            do {
                let data = try await post("createFolder", ["companyId": .string(company), "parentId": parentID.map { .string($0) } ?? .null, "name": .string(name)])
                let created = try JSONDecoder().decode(MaterialFolderCreated.self, from: data).item
                if var updated = home { updated.folders.append(created); home = updated }
                cache[key] = created.id
                current = created.id
            } catch let failure as NativeFailure where failure.status == 409 {
                await loadHome(quiet: true)
                guard let existing = folders.first(where: { $0.parentId == parentID && $0.name.lowercased() == name.lowercased() }) else { throw failure }
                cache[key] = existing.id
                current = existing.id
            }
        }
        return current
    }

    /// Wpis i podpisane adresy → plik (z postępem) i miniatura do magazynu → potwierdzenie; błąd sprząta wpis i obiekty.
    private func send(_ job: MaterialsUploadJob, company: String, folder: String?) async throws {
        let url = job.url
        let name = url.lastPathComponent
        let size = MaterialMedia.size(of: url)
        let mime = MaterialMedia.mime(forName: name)
        let sha = await Task.detached(priority: .utility) { try? MaterialMedia.sha256(url) }.value
        let facts = await MaterialMedia.facts(for: url, name: name)
        try Task.checkCancellation()
        var body: [String: JSONValue] = [
            "name": .string(name), "size": .number(Double(size)), "mime": .string(mime), "sha256": sha.map { .string($0) } ?? .null,
            "thumbnail": .bool(facts.thumbnail != nil),
        ]
        if let replace = job.replace {
            body["replaceId"] = .string(replace.id)
            body["baseContentVersion"] = .number(Double(replace.version))
        } else {
            body["companyId"] = .string(company)
            body["folderId"] = folder.map { .string($0) } ?? .null
        }
        let prepared = try JSONDecoder().decode(MaterialPrepared.self, from: try await post("prepareUpload", body))
        do {
            guard let target = URL(string: prepared.uploadUrl) else { throw AppError.invalidResponse }
            try await MaterialsTransfer.put(file: url, to: target, mime: mime) { [weak self] sent in
                Task { @MainActor in self?.patch(job.id) { $0.sent = sent } }
            }
            var thumbPath: String?
            if let thumb = facts.thumbnail, let path = prepared.thumbPath, let raw = prepared.thumbUploadUrl, let thumbURL = URL(string: raw) {
                do {
                    try await MaterialsTransfer.put(data: thumb, to: thumbURL, mime: "image/jpeg")
                    thumbPath = path
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    thumbPath = nil
                }
            }
            var complete: [String: JSONValue] = [
                "fileId": .string(prepared.fileId), "path": .string(prepared.path), "thumbPath": thumbPath.map { .string($0) } ?? .null,
                "width": facts.width.map { .number(Double($0)) } ?? .null, "height": facts.height.map { .number(Double($0)) } ?? .null,
                "duration": facts.duration.map { .number($0) } ?? .null, "sha256": sha.map { .string($0) } ?? .null,
            ]
            if let replace = job.replace { complete["baseContentVersion"] = .number(Double(replace.version)) }
            _ = try await post("completeUpload", complete, timeout: 180)
        } catch {
            let cancel: [String: JSONValue] = [
                "fileId": .string(prepared.fileId), "path": .string(prepared.path), "thumbPath": prepared.thumbPath.map { .string($0) } ?? .null,
            ]
            _ = try? await post("cancelUpload", cancel)
            throw error
        }
    }

    /// Pliki do wysłania: pliki wprost i zawartość folderów (bez plików ukrytych i pakietów aplikacji).
    nonisolated static func jobs(from urls: [URL], parent: String?) -> [MaterialsUploadJob] {
        var jobs: [MaterialsUploadJob] = []
        let keys: [URLResourceKey] = [.isDirectoryKey, .isPackageKey, .isHiddenKey, .isRegularFileKey]
        for url in urls where url.isFileURL {
            let values = try? url.resourceValues(forKeys: Set(keys))
            if values?.isDirectory == true && values?.isPackage != true {
                let root = url.lastPathComponent
                guard let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys,
                                                                   options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
                let base = url.standardizedFileURL.pathComponents
                for case let item as URL in walker {
                    let info = try? item.resourceValues(forKeys: Set(keys))
                    guard info?.isRegularFile == true, info?.isPackage != true else { continue }
                    if FinderNameRules.excluded(item.lastPathComponent) { continue }
                    let parts = item.standardizedFileURL.pathComponents
                    let relative = parts.count > base.count + 1 ? Array(parts[base.count..<(parts.count - 1)]) : []
                    jobs.append(MaterialsUploadJob(url: item, dirs: [root] + relative, parent: parent, replace: nil))
                }
            } else if values?.isRegularFile == true || values == nil {
                if FinderNameRules.excluded(url.lastPathComponent) { continue }
                jobs.append(MaterialsUploadJob(url: url, dirs: [], parent: parent, replace: nil))
            }
        }
        return jobs
    }
}

// MARK: Wysyłka — pomocnicze

struct MaterialsUploadJob {
    let id = UUID()
    let url: URL
    let dirs: [String]
    let parent: String?
    let replace: (id: String, version: Int)?
}

struct MaterialsUploadRow: Identifiable {
    enum Status { case waiting, uploading, done, failed, cancelled }
    let id: UUID
    var name: String
    var size: Int64
    var place: String
    var sent: Int64 = 0
    var status: Status
    var error: String?
}

struct MaterialsUploadBatch {
    var rows: [MaterialsUploadRow]
    var running: Bool
}

/// Pliki pomijane przy wysyłce (systemowe i tymczasowe — jak w Finderze).
enum FinderNameRules {
    static func excluded(_ filename: String) -> Bool {
        let lower = filename.lowercased()
        return filename.hasPrefix(".") || filename.hasPrefix("~$") || filename == "Icon\r" || lower.hasSuffix(".tmp")
            || lower.hasSuffix(".crdownload") || lower.hasSuffix(".part") || lower.hasSuffix(".download")
    }
}

private extension String {
    var nonEmptyName: String { isEmpty ? "Folder" : self }
}

/// Przeciąganie elementów Materiałów w aplikacji (przenoszenie między folderami): tekst z prefiksem i listą odnośników.
enum MaterialsDrag {
    static let prefix = "mavinci-materials:"

    static func payload(_ refs: [MaterialRef]) -> String {
        let data = (try? JSONEncoder().encode(refs)) ?? Data("[]".utf8)
        return prefix + (String(data: data, encoding: .utf8) ?? "[]")
    }

    static func refs(_ text: String) -> [MaterialRef]? {
        guard text.hasPrefix(prefix), let data = String(text.dropFirst(prefix.count)).data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([MaterialRef].self, from: data)
    }
}

/// Wysyłka na podpisane adresy magazynu z postępem.
enum MaterialsTransfer {
    private final class Progress: NSObject, URLSessionTaskDelegate {
        let report: @Sendable (Int64) -> Void
        init(_ report: @escaping @Sendable (Int64) -> Void) { self.report = report }
        func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                        totalBytesExpectedToSend: Int64) {
            report(totalBytesSent)
        }
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 120
        c.timeoutIntervalForResource = 6 * 3600
        c.httpShouldSetCookies = false
        return URLSession(configuration: c)
    }()

    private static func request(_ target: URL, mime: String) -> URLRequest {
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        return request
    }

    static func put(file: URL, to target: URL, mime: String, progress: @escaping @Sendable (Int64) -> Void) async throws {
        let (_, response) = try await session.upload(for: request(target, mime: mime), fromFile: file, delegate: Progress(progress))
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 413 { throw NativeFailure(status: 413, message: "Plik jest za duży dla magazynu.", fieldErrors: [:]) }
        guard (200..<300).contains(http.statusCode) else {
            throw NativeFailure(status: http.statusCode, message: "Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.", fieldErrors: [:])
        }
    }

    static func put(data: Data, to target: URL, mime: String) async throws {
        let (_, response) = try await session.upload(for: request(target, mime: mime), from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw AppError.server }
    }
}

// MARK: Miniatury na dysku

/// Miniatury plików (JPEG z magazynu) w Application Support — po jednej na wersję treści, osobno dla konta.
@MainActor final class MaterialsThumbnails {
    static let shared = MaterialsThumbnails()
    private let memory = NSCache<NSString, NSImage>()
    private var loading: [String: Task<NSImage?, Never>] = [:]
    private var folder: URL?

    func open(namespace: String) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mavinci/Desktop/v1/materials-thumbs/\(namespace)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        folder = base
        memory.removeAllObjects()
    }

    func clear() {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        memory.removeAllObjects()
        loading = [:]
    }

    private func key(_ file: MaterialFile) -> String { "\(file.id)-\(file.contentVersion)" }

    func cached(_ file: MaterialFile) -> NSImage? {
        let name = key(file)
        if let image = memory.object(forKey: name as NSString) { return image }
        guard let folder, let image = NSImage(contentsOf: folder.appendingPathComponent(name + ".jpg")) else { return nil }
        memory.setObject(image, forKey: name as NSString)
        return image
    }

    func image(_ file: MaterialFile) async -> NSImage? {
        if let image = cached(file) { return image }
        guard let raw = file.thumbnailUrl, let url = URL(string: raw) else { return nil }
        let name = key(file)
        if let task = loading[name] { return await task.value }
        let target = folder?.appendingPathComponent(name + ".jpg")
        let task = Task<NSImage?, Never> {
            guard let result = try? await URLSession.shared.data(from: url) else { return nil }
            let (data, response) = result
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let image = NSImage(data: data) else { return nil }
            if let target { try? data.write(to: target, options: .atomic) }
            return image
        }
        loading[name] = task
        let image = await task.value
        loading[name] = nil
        if let image { memory.setObject(image, forKey: name as NSString) }
        return image
    }
}
