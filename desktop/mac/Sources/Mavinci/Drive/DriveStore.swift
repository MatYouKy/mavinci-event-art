import AppKit
import CryptoKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Dysk (`/crm/materials`) — ta sama chmura co w Finderze, w CRM i w telefonie
//
// Działy z uprawnieniami pracownika (`op=root`), foldery Ofert, Kalkulacji, Umów, Magazynu i Pracowników (`op=list`), pliki do
// podglądu (Quick Look), otwarcia i pobrania (`op=download`), pliki do sprzętu w Magazynie i do dokumentów pracownika
// (`prepareUpload` → treść na podpisany adres → `completeUpload`; dokument z profilu — także nazwa, rodzaj, opis i termin
// ważności), usunięcie dokumentu pracownika (`deleteFile`). Eventy — lista wydarzeń z `/bridge/native/v1/files` (pliki wydarzenia: `EventFilesTab`), Materiały —
// `MaterialsStore`. Wszystko tokenem pracownika — który plik widać, decyduje baza (RLS jak w CRM).
// Lokalnie na dysku (zaszyfrowane): działy, ostatnio oglądane foldery i lista wydarzeń — ekran otwiera się od razu, także bez
// internetu. Pliki do podglądu i otwarcia — kopie w katalogu tymczasowym (klucz: plik i jego wersja).

@MainActor final class DriveStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var root: DriveRoot?
    @Published var rootError: String?
    @Published private(set) var loading = false
    /// Wybrany dział (pamiętany na tym Macu).
    @Published private(set) var section: DriveSection?
    /// Otwarty folder w dziale (brak — główny folder działu).
    @Published private(set) var nodes: [String: String] = [:]
    @Published private(set) var listings: [String: DriveListing] = [:]
    @Published private(set) var listLoading: Set<String> = []
    @Published private(set) var listErrors: [String: String] = [:]
    /// Rozwinięte foldery w drzewie Dysku.
    @Published var expanded: Set<String> = []
    @Published private(set) var events: [DriveEvent]?
    @Published private(set) var eventsError: String?
    /// Eventy: rozwinięty rok i otwarte wydarzenie (jego pliki).
    @Published var eventYear: String?
    @Published var eventID: String?
    @Published private(set) var uploading = false

    private struct Cache: Codable {
        var root: DriveRoot?
        var listings: [String: DriveListing]
        var events: [DriveEvent]?
    }

    private static let sectionKey = "drive.section"
    private static let maxUpload = 50 * 1024 * 1024
    private var namespace: String?
    private var cacheFile: SealedFile<Cache>?
    private var inflight = Set<String>()

    var api: NativeAPI? { workspace?.nativeAPI() }

    /// Otwarty folder bieżącego działu (główny folder — identyfikator działu).
    var currentNode: String? { section.map { nodes[$0.rawValue] ?? $0.rawValue } }
    var currentListing: DriveListing? { currentNode.flatMap { listings[$0] } }
    func info(_ section: DriveSection) -> DriveSectionInfo? { root?.sections.first { $0.key == section.rawValue } }

    // MARK: Kopia na dysku

    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<Cache>(namespace: "drive-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            cacheFile = sealed
            guard let saved else { return }
            if root == nil, let savedRoot = saved.root {
                root = savedRoot
                chooseSection()
            }
            if listings.isEmpty { listings = saved.listings }
            if events == nil { events = saved.events }
        }
    }

    func reset(clearDisk: Bool = true) {
        if clearDisk { try? cacheFile?.clear() }
        cacheFile = nil; namespace = nil; inflight = []
        root = nil; rootError = nil; loading = false; section = nil; nodes = [:]
        listings = [:]; listLoading = []; listErrors = [:]; expanded = []
        events = nil; eventsError = nil; eventYear = nil; eventID = nil; uploading = false
    }

    private func saveCache() {
        guard let cacheFile else { return }
        // Najwyżej 80 ostatnich folderów (bieżący dział najpierw).
        var copy = listings
        if copy.count > 80 {
            let current = section?.rawValue ?? ""
            for key in copy.keys.filter({ !$0.hasPrefix(current) }) where copy.count > 80 { copy[key] = nil }
            for key in copy.keys where copy.count > 80 { copy[key] = nil }
        }
        let value = Cache(root: root, listings: copy, events: events)
        Task.detached(priority: .utility) { try? cacheFile.save(value) }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Odczyt

    func loadRoot(quiet: Bool = false) async {
        guard let api else {
            if root == nil { rootError = "Brak połączenia z serwerem CRM." }
            return
        }
        let owner = workspace?.employee?.id
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            let data = try JSONDecoder().decode(DriveRoot.self, from: try await api.get("/drive", query: ["op": "root"]))
            guard owner == workspace?.employee?.id else { return }
            root = data
            rootError = nil
            chooseSection()
            saveCache()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if root == nil {
                rootError = failureText(error, "Nie udało się otworzyć Dysku.")
            } else if !quiet {
                workspace?.error = failureText(error, "Nie udało się odświeżyć Dysku.")
            }
        }
    }

    /// Dział na start: ostatnio otwarty, Materiały albo pierwszy dostępny (bez dostępu do bieżącego — inny).
    private func chooseSection() {
        let available = root?.available.compactMap(\.section) ?? []
        if let section, available.contains(section) { return }
        let saved = DriveSection(rawValue: UserDefaults.standard.string(forKey: Self.sectionKey) ?? "")
        if let saved, available.contains(saved) { section = saved }
        else { section = available.contains(.materials) ? .materials : available.first }
    }

    func select(_ next: DriveSection) {
        section = next
        UserDefaults.standard.set(next.rawValue, forKey: Self.sectionKey)
        if next.browsable, let node = currentNode { Task { await loadListing(node, quiet: listings[node] != nil) } }
        if next == .events { Task { await loadEvents(quiet: events != nil) } }
    }

    /// Folder w treści (także z okruszków i drzewa); identyfikator działu — główny folder działu.
    func openNode(_ id: String) {
        guard let section else { return }
        nodes[section.rawValue] = id == section.rawValue ? nil : id
        Task { await loadListing(id, quiet: listings[id] != nil) }
    }

    func toggle(_ id: String) {
        if expanded.contains(id) {
            expanded.remove(id)
        } else {
            expanded.insert(id)
            if listings[id] == nil { Task { await loadListing(id, quiet: true) } }
        }
    }

    /// Folder z serwera; `expandPath` — ścieżka rozwija się w drzewie Dysku (bez — np. zakładka „Dokumenty” w profilu pracownika).
    func loadListing(_ node: String, quiet: Bool = false, expandPath: Bool = true) async {
        guard let api, !inflight.contains(node) else { return }
        let owner = workspace?.employee?.id
        inflight.insert(node)
        if !quiet { listLoading.insert(node) }
        defer {
            inflight.remove(node)
            listLoading.remove(node)
        }
        do {
            let data = try JSONDecoder().decode(DriveListing.self, from: try await api.get("/drive", query: ["op": "list", "node": node]))
            guard owner == workspace?.employee?.id else { return }
            listings[node] = data
            listErrors[node] = nil
            // Ścieżka otwartego folderu rozwinięta w drzewie (sprzęt jest tylko w treści).
            for folder in data.path where expandPath && folder.id != node && !folder.id.hasPrefix("warehouse:item:") {
                expanded.insert(folder.id)
                if listings[folder.id] == nil { Task { await loadListing(folder.id, quiet: true) } }
            }
            saveCache()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if let failure = error as? NativeFailure, failure.status == 404 || failure.status == 403 {
                // Folder zniknął albo nie ma już dostępu — wracamy do głównego folderu działu.
                listings[node] = nil
                for (key, value) in nodes where value == node { nodes[key] = nil }
                if failure.status == 403 { await loadRoot(quiet: true) }
                return
            }
            listErrors[node] = failureText(error, "Nie udało się pobrać folderu.")
        }
    }

    func loadEvents(quiet: Bool = false) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(DriveEventsReply.self, from: try await api.get("/files", query: ["op": "events"]))
            guard owner == workspace?.employee?.id else { return }
            events = data.events
            eventsError = nil
            if eventYear == nil, eventID == nil { eventYear = eventYears.first }
            saveCache()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if events == nil || !quiet { eventsError = failureText(error, "Nie udało się pobrać wydarzeń.") }
        }
    }

    /// Lata w Eventy — od najnowszego, „Bez daty” na końcu.
    var eventYears: [String] {
        Array(Set((events ?? []).map(DriveText.year))).sorted { a, b in
            if a == DriveText.noDate { return false }
            if b == DriveText.noDate { return true }
            return a > b
        }
    }

    func events(in year: String) -> [DriveEvent] {
        (events ?? []).filter { DriveText.year($0) == year }.sorted { ($0.date ?? "") > ($1.date ?? "") }
    }

    /// Odświeżenie działów i bieżącego folderu (po zmianach i w tle).
    func refresh(quiet: Bool = true) async {
        await loadRoot(quiet: quiet)
        guard let section else { return }
        if section.browsable, let node = currentNode { await loadListing(node, quiet: quiet) }
        if section == .events { await loadEvents(quiet: quiet) }
    }

    // MARK: Pliki

    private func link(_ file: DriveFile, mode: String) async throws -> DriveDownload {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(DriveDownload.self, from: try await api.get("/drive", query: ["op": "download", "id": file.id, "mode": mode]))
    }

    private static func folder(_ file: DriveFile) -> URL {
        let key = SHA256.hash(data: Data((file.id + "|" + file.version).utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-dysk/\(key)", isDirectory: true)
    }

    private static func safeName(_ file: DriveFile) -> String {
        let safe = file.name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        return safe.isEmpty ? "plik" : safe
    }

    /// Kopia pliku w katalogu tymczasowym (podgląd, otwarcie, przeciąganie) — pobierana raz na wersję pliku.
    func localFile(_ file: DriveFile) async throws -> URL {
        let folder = Self.folder(file)
        let target = folder.appendingPathComponent(Self.safeName(file))
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let link = try await link(file, mode: "preview")
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        let (temporary, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: target.path) { try? FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: temporary, to: target)
        return target
    }

    func cachedLocalFile(_ file: DriveFile) -> URL? {
        let url = Self.folder(file).appendingPathComponent(Self.safeName(file))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Kopia do podglądu (Quick Look) z modalnym wskaźnikiem.
    func previewFile(_ file: DriveFile) async -> URL? {
        guard let workspace else { return nil }
        do {
            return try await workspace.withPending("Otwieranie…") { try await localFile(file) }
        } catch {
            workspace.error = failureText(error, "Nie udało się otworzyć pliku.")
            return nil
        }
    }

    func openExternally(_ file: DriveFile) async {
        if let local = await previewFile(file) { NSWorkspace.shared.open(local) }
    }

    /// Kopia w „Pobrane” (z nazwą bez nadpisywania) i pokazanie w Finderze.
    func downloadToDownloads(_ file: DriveFile) async {
        guard let workspace else { return }
        do {
            let local = try await workspace.withPending("Pobieranie…") { try await localFile(file) }
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

    /// Przeciągnięcie pliku z aplikacji do Findera albo innej aplikacji (pobrany przy upuszczeniu, gdy nie ma kopii).
    func dragProvider(_ file: DriveFile) -> NSItemProvider {
        if let local = cachedLocalFile(file), let ready = NSItemProvider(contentsOf: local) {
            ready.suggestedName = file.name
            return ready
        }
        let provider = NSItemProvider()
        let store = self
        provider.registerFileRepresentation(forTypeIdentifier: file.utType.identifier, fileOptions: [], visibility: .all) { completion in
            Task { @MainActor in
                do { completion(try await store.localFile(file), false, nil) } catch { completion(nil, false, error) }
            }
            return nil
        }
        provider.suggestedName = file.name
        return provider
    }

    /// Rekord w aplikacji: oferta, wydarzenie, zapytanie, sprzęt, umowa, profil pracownika; księga znaku — w CRM.
    func openRecord(_ record: DriveRecord) {
        guard let workspace, UUID(uuidString: record.id) != nil else { return }
        switch record.type {
        case "offer": workspace.showOffer(record.id)
        case "event": workspace.showEvent(record.id)
        case "inquiry": workspace.open(.inquiries, id: record.id)
        case "equipment": workspace.showEquipment(record.id)
        case "employee": workspace.showEmployee(record.id)
        case "contract":
            if workspace.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/contracts" }) {
                workspace.openHref("/crm/contracts")
                workspace.contracts.selectedContractID = record.id
            } else {
                workspace.openCRM(DriveText.recordPath(record))
            }
        default: workspace.openCRM(DriveText.recordPath(record))
        }
    }

    // MARK: Pliki do sprzętu w Magazynie i do dokumentów pracownika

    private static func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    /// Pliki z Findera (przycisk albo przeciągnięcie) do sprzętu: zdjęcie JPG/PNG/WebP/GIF do 10 MB — galeria sprzętu,
    /// pozostałe do 50 MB — pliki sprzętu (jak w CRM); do dokumentów pracownika — pliki do 50 MB (nazwa z nazwy pliku).
    /// Foldery pomijamy.
    func upload(_ urls: [URL], to node: String) async {
        guard let workspace, let api else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        let files = urls.filter { !Self.isDirectory($0) }
        let place = DriveText.uploadPlace(node)
        guard !files.isEmpty else { workspace.error = "Do \(place) dodawaj pliki — bez folderów."; return }
        uploading = true
        defer { uploading = false }
        var added = 0
        var failed: [String] = []
        for (index, source) in files.enumerated() {
            let name = source.lastPathComponent
            do {
                try await workspace.withPending(files.count == 1 ? "Wysyłam „\(name)”" : "Wysyłam pliki (\(index + 1) z \(files.count))") {
                    try await send(source, name: name, to: node, api: api)
                }
                added += 1
            } catch {
                failed.append("\(name) — \(failureText(error, "nie udało się wysłać"))")
            }
        }
        await loadListing(node, quiet: true)
        if added > 0 { FinderDomain.driveChanged() }
        if failed.isEmpty {
            workspace.succeed(added == 1 ? "Dodano plik do \(place)" : "Dodano pliki do \(place) (\(added))")
        } else {
            workspace.error = (added > 0 ? "Dodano \(added), nie dodano: " : "Nie dodano: ") + failed.joined(separator: "; ")
        }
    }

    private func send(_ source: URL, name: String, to node: String, api: NativeAPI, details: [String: JSONValue] = [:]) async throws {
        let size = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > Self.maxUpload { throw NativeFailure(status: 413, message: "plik przekracza 50 MB (limit plików \(DriveText.uploadPlace(node)))", fieldErrors: [:]) }
        let mime = UTType(filenameExtension: source.pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
        let prepared = try JSONDecoder().decode(DriveUpload.self, from: try await api.post("/drive", [
            "op": .string("prepareUpload"), "parentId": .string(node), "name": .string(name), "size": .number(Double(size)), "mime": .string(mime),
        ]))
        do {
            guard let target = URL(string: prepared.signedUrl) else { throw AppError.invalidResponse }
            var request = URLRequest(url: target)
            request.httpMethod = "PUT"
            request.setValue(mime, forHTTPHeaderField: "Content-Type")
            request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
            request.setValue("false", forHTTPHeaderField: "x-upsert")
            let (_, response) = try await URLSession.shared.upload(for: request, fromFile: source)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
            var body: [String: JSONValue] = [
                "op": .string("completeUpload"), "parentId": .string(node), "bucket": .string(prepared.bucket), "path": .string(prepared.path),
                "name": .string(name), "size": .number(Double(size)), "mime": .string(mime),
            ]
            body.merge(details) { current, _ in current }
            _ = try await api.post("/drive", body, timeout: 120)
        } catch {
            _ = try? await api.post("/drive", [
                "op": .string("cancelUpload"), "parentId": .string(node), "bucket": .string(prepared.bucket), "path": .string(prepared.path),
            ])
            throw error
        }
    }
}

// MARK: Miniatury (zdjęcia sprzętu, logotypy) — adresy publiczne magazynu, kopia w pamięci (i w pamięci podręcznej URLSession)

@MainActor final class DriveThumbnails {
    static let shared = DriveThumbnails()
    private let cache = NSCache<NSString, NSImage>()
    private var loading: [String: Task<NSImage?, Never>] = [:]

    func cached(_ url: String) -> NSImage? { cache.object(forKey: url as NSString) }

    func image(_ url: String) async -> NSImage? {
        if let hit = cached(url) { return hit }
        if let task = loading[url] { return await task.value }
        guard let remote = URL(string: url), remote.scheme == "https" else { return nil }
        let task = Task<NSImage?, Never> {
            guard let result = try? await URLSession.shared.data(from: remote),
                  (result.1 as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { return nil }
            return NSImage(data: result.0)
        }
        loading[url] = task
        let image = await task.value
        loading[url] = nil
        if let image { cache.setObject(image, forKey: url as NSString) }
        return image
    }
}

/// Miniatura pliku Dysku: zdjęcie z magazynu albo ikona typu z systemu.
@MainActor struct DriveFileThumb: View {
    let file: DriveFile
    let side: CGFloat
    var fit = false
    @State private var image: NSImage?

    var body: some View {
        ZStack {
            Color.primary.opacity(0.05)
            if let image {
                if fit { Image(nsImage: image).resizable().scaledToFit().padding(side * 0.06) } else { Image(nsImage: image).resizable().scaledToFill() }
            } else {
                Image(nsImage: NSWorkspace.shared.icon(for: file.utType)).resizable().scaledToFit().padding(side * 0.14)
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: side > 60 ? 8 : 5))
        .task(id: file.thumbnailUrl ?? file.id) {
            guard let url = file.thumbnailUrl else { image = nil; return }
            image = DriveThumbnails.shared.cached(url)
            if image == nil { image = await DriveThumbnails.shared.image(url) }
        }
    }
}

// MARK: Dokumenty pracownika (profil → Dokumenty)

extension DriveStore {

    /// Folder dokumentów pracownika w Dysku (`employees:<id>:documents`).
    static func documentsNode(_ employeeID: String) -> String { "employees:\(employeeID.lowercased()):documents" }

    /// Nowy dokument z formularza: plik do 50 MB z nazwą, rodzajem, opisem i terminem ważności (jak w CRM).
    @discardableResult
    func uploadDocument(_ source: URL, employeeID: String, title: String, type: EmployeeDocumentType, description: String, expiry: Date?) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        let node = Self.documentsNode(employeeID)
        var details: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "documentType": .string(type.rawValue),
            "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
        ]
        if let expiry {
            let format = DateFormatter()
            format.calendar = Calendar(identifier: .gregorian)
            format.locale = Locale(identifier: "en_US_POSIX")
            format.timeZone = TimeZone(identifier: "Europe/Warsaw")
            format.dateFormat = "yyyy-MM-dd"
            details["expiryDate"] = .string(format.string(from: expiry))
        }
        uploading = true
        defer { uploading = false }
        do {
            try await workspace.withPending("Dodaję dokument „\(source.lastPathComponent)”") {
                try await send(source, name: source.lastPathComponent, to: node, api: api, details: details)
            }
            await loadListing(node, quiet: true, expandPath: false)
            FinderDomain.driveChanged()
            workspace.succeed("Dodano dokument")
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się dodać dokumentu.")
            return false
        }
    }

    /// Usunięcie dokumentu pracownika (kto może — decyduje baza: zarządzanie pracownikami albo autor dokumentu).
    @discardableResult
    func deleteDocument(_ file: DriveFile, employeeID: String) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            _ = try await workspace.withPending("Usuwam dokument…") {
                try await api.post("/drive", ["op": .string("deleteFile"), "id": .string(file.id)])
            }
            await loadListing(Self.documentsNode(employeeID), quiet: true, expandPath: false)
            FinderDomain.driveChanged()
            workspace.succeed("Usunięto dokument")
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się usunąć dokumentu.")
            return false
        }
    }
}
