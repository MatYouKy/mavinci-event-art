import FileProvider
import Foundation

// MARK: Rozszerzenie Findera „Mavinci” (File Provider, replikowane)
//
// Mavinci → Eventy → rok → „RRRR-MM-DD Nazwa” → foldery i pliki z zakładki Pliki (`FinderCatalog`),
// Mavinci → Materiały → marka → foldery i pliki z Materiałów (`MaterialsCatalog`, tylko z dostępem do Materiałów) oraz
// Mavinci → Oferty / Kalkulacje / Umowy / Magazyn i „Z księgi znaku” w folderze marki w Materiałach (`DriveCatalog`, Dysk) —
// ten sam układ co Dysk w CRM, na Macu i w telefonie.
// Treść pliku pobiera się przy pierwszym otwarciu (potem zostaje na dysku, macOS może ją zwolnić przy braku miejsca).
// Zmiany z CRM przychodzą przez zbiór roboczy (`changes` od kursora; punkt synchronizacji łączy kursor wydarzeń, Materiałów i Dysku)
// — aplikacja sygnalizuje je co minutę. Z Findera: dodawanie plików i folderów, edycja (konflikt → kopia „(konflikt …)”),
// zmiana nazwy, przenoszenie, kosz (= kosz CRM na 30 dni, „Odłóż” przywraca). Odmowa serwera przywraca w Finderze stan z CRM.

@objc(MavinciFileProviderExtension)
final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
    let domain: NSFileProviderDomain

    required init(domain: NSFileProviderDomain) {
        self.domain = domain
        super.init()
    }

    func invalidate() {}

    func item(for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest,
              completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        Task {
            do {
                let item: NSFileProviderItem
                let kind = FinderID.parse(identifier)
                if kind.isDrive {
                    item = try await DriveCatalog.shared.item(for: identifier)
                } else if kind.isMaterials {
                    item = try await MaterialsCatalog.shared.item(for: identifier)
                } else {
                    item = try await FinderCatalog.shared.item(for: identifier)
                }
                progress.completedUnitCount = 1
                completionHandler(item, nil)
            } catch {
                completionHandler(nil, FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func fetchContents(for itemIdentifier: NSFileProviderItemIdentifier, version requestedVersion: NSFileProviderItemVersion?,
                       request: NSFileProviderRequest,
                       completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 100)
        let domain = self.domain
        Task {
            do {
                let remote: URL
                let item: NSFileProviderItem
                switch FinderID.parse(itemIdentifier) {
                case .file(let id): (remote, item) = try await FinderCatalog.shared.download(file: id)
                case .materialFile(let id): (remote, item) = try await MaterialsCatalog.shared.download(file: id)
                case .driveFile(let id):
                    switch try await DriveCatalog.shared.content(file: id) {
                    case .remote(let url, let found): (remote, item) = (url, found)
                    case .data(let data, let found):
                        // „Kolory marki.txt” — treść z kopii Dysku, bez pobierania.
                        guard let manager = NSFileProviderManager(for: domain) else { throw NSFileProviderError(.providerNotFound) }
                        let local = try manager.temporaryDirectoryURL().appendingPathComponent(UUID().uuidString)
                        try data.write(to: local)
                        progress.completedUnitCount = 100
                        completionHandler(local, found, nil)
                        return
                    }
                default: throw NSFileProviderError(.noSuchItem)
                }
                guard let manager = NSFileProviderManager(for: domain) else { throw NSFileProviderError(.providerNotFound) }
                let local = try manager.temporaryDirectoryURL().appendingPathComponent(UUID().uuidString)
                progress.completedUnitCount = 10
                try await FinderAPI.download(remote, to: local)
                progress.completedUnitCount = 100
                completionHandler(local, item, nil)
            } catch {
                completionHandler(nil, nil, FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func createItem(basedOn itemTemplate: NSFileProviderItem, fields: NSFileProviderItemFields, contents url: URL?,
                    options: NSFileProviderCreateItemOptions = [], request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let mayAlreadyExist = options.contains(.mayAlreadyExist)
        Task {
            do {
                let item: NSFileProviderItem
                let parent = FinderID.parse(itemTemplate.parentItemIdentifier)
                if parent.isDrive {
                    item = try await DriveCatalog.shared.create(template: itemTemplate, contents: url, mayAlreadyExist: mayAlreadyExist)
                } else if parent.isMaterials {
                    item = try await MaterialsCatalog.shared.create(template: itemTemplate, contents: url, mayAlreadyExist: mayAlreadyExist)
                } else {
                    item = try await FinderCatalog.shared.create(template: itemTemplate, contents: url, mayAlreadyExist: mayAlreadyExist)
                }
                progress.completedUnitCount = 1
                completionHandler(item, [], false, nil)
            } catch {
                completionHandler(nil, [], false, FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func modifyItem(_ item: NSFileProviderItem, baseVersion version: NSFileProviderItemVersion, changedFields: NSFileProviderItemFields,
                    contents newContents: URL?, options: NSFileProviderModifyItemOptions = [], request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let domain = self.domain
        Task {
            do {
                let result: (NSFileProviderItem, Bool)
                let kind = FinderID.parse(item.itemIdentifier)
                if kind.isDrive {
                    // Dysk w Finderze jest tylko do odczytu (poza dodawaniem plików do sprzętu) — element zostaje jak na serwerze.
                    let current = try await DriveCatalog.shared.item(for: item.itemIdentifier)
                    result = (current, false)
                } else if changedFields.contains(.parentItemIdentifier), FinderID.parse(item.parentItemIdentifier).isDrive {
                    // Plik z Eventy albo z Materiałów przeniesiony do Dysku — wraca na miejsce (kopia: przeciągnięcie z ⌥ dodaje plik).
                    if kind.isMaterials {
                        let current = try await MaterialsCatalog.shared.item(for: item.itemIdentifier)
                        result = (current, false)
                    } else {
                        let current = try await FinderCatalog.shared.item(for: item.itemIdentifier)
                        result = (current, false)
                    }
                } else if kind.isMaterials {
                    result = try await MaterialsCatalog.shared.modify(item, base: version, fields: changedFields, contents: newContents)
                } else {
                    result = try await FinderCatalog.shared.modify(item, base: version, fields: changedFields, contents: newContents)
                    // Plik z wydarzenia upuszczony w Materiałach — kopia pojawia się po sprawdzeniu zmian.
                    if changedFields.contains(.parentItemIdentifier), FinderID.parse(item.parentItemIdentifier).isMaterials {
                        NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in }
                    }
                }
                progress.completedUnitCount = 1
                completionHandler(result.0, [], result.1, nil)
            } catch {
                completionHandler(nil, [], false, FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func deleteItem(identifier: NSFileProviderItemIdentifier, baseVersion version: NSFileProviderItemVersion,
                    options: NSFileProviderDeleteItemOptions = [], request: NSFileProviderRequest,
                    completionHandler: @escaping (Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let recursive = options.contains(.recursive)
        Task {
            do {
                let kind = FinderID.parse(identifier)
                if kind.isDrive {
                    // Oferty, Kalkulacje, Umowy, Magazyn i księga znaku — usuwanie tylko w CRM.
                    throw NSFileProviderError(.deletionRejected)
                } else if kind.isMaterials {
                    try await MaterialsCatalog.shared.delete(identifier, recursive: recursive)
                } else {
                    try await FinderCatalog.shared.delete(identifier, recursive: recursive)
                }
                progress.completedUnitCount = 1
                completionHandler(nil)
            } catch {
                completionHandler(FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
        FinderEnumerator(container: containerItemIdentifier, domain: domain)
    }
}

// MARK: Wydarzenia, Materiały i Dysk razem: główny folder, Kosz, zbiór roboczy i punkt synchronizacji

enum FinderSync {
    /// Punkt synchronizacji: kursor wydarzeń (`e`), Materiałów (`m`) i Dysku (`d`). Dawny punkt (sam kursor wydarzeń) — `m` i `d` puste.
    struct Anchor: Codable {
        var e: String?
        var m: String?
        var d: String?
    }

    static func parse(_ anchor: NSFileProviderSyncAnchor) -> Anchor {
        if let value = try? JSONDecoder().decode(Anchor.self, from: anchor.rawValue) { return value }
        let text = String(data: anchor.rawValue, encoding: .utf8) ?? ""
        return Anchor(e: text.isEmpty ? nil : text, m: nil, d: nil)
    }

    static func encode(_ anchor: Anchor) -> NSFileProviderSyncAnchor {
        NSFileProviderSyncAnchor(rawValue: (try? JSONEncoder().encode(anchor)) ?? Data())
    }

    /// Wydarzenia — bez dostępu do nich (403) pusto, Materiały działają dalej; inne błędy (np. brak sieci) przerywają.
    static func events(_ work: () async throws -> [NSFileProviderItem]) async throws -> [NSFileProviderItem] {
        do { return try await work() } catch let error as FinderServerError where error.status == 403 { return [] }
    }

    static func isSignedOut(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == NSFileProviderErrorDomain && ns.code == NSFileProviderError.Code.notAuthenticated.rawValue
    }

    #if os(iOS)
    /// iPhone i iPad: aplikacja Mavinci prosi o zmiany tylko, gdy jest otwarta (na Macu — co minutę z paska menu), więc
    /// przeglądanie folderu w aplikacji Pliki prosi o nie samo — najwyżej co 2 minuty.
    private static let signalLock = NSLock()
    private static var lastSignal = Date.distantPast

    static func signalIfStale(_ domain: NSFileProviderDomain) {
        signalLock.lock()
        let due = Date().timeIntervalSince(lastSignal) > 120
        if due { lastSignal = Date() }
        signalLock.unlock()
        if due { NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in } }
    }
    #endif
}

final class FinderEnumerator: NSObject, NSFileProviderEnumerator {
    let container: NSFileProviderItemIdentifier
    let domain: NSFileProviderDomain

    init(container: NSFileProviderItemIdentifier, domain: NSFileProviderDomain) {
        self.container = container
        self.domain = domain
        super.init()
    }

    func invalidate() {}

    private static func children(of container: NSFileProviderItemIdentifier) async throws -> [NSFileProviderItem] {
        let kind = FinderID.parse(container)
        switch kind {
        case .root:
            var items: [NSFileProviderItem] = [FinderItem.eventsRoot]
            if let materials = await MaterialsCatalog.shared.rootItem() { items.append(materials) }
            items += await DriveCatalog.shared.rootItems()
            return items
        case .trash:
            var items = try await FinderSync.events { try await FinderCatalog.shared.children(of: .trashContainer) }
            do { items += try await MaterialsCatalog.shared.trashContents() } catch {
                if FinderSync.isSignedOut(error) { throw error }
                items += await MaterialsCatalog.shared.trashRoots()
            }
            return items
        case .workingSet:
            var items = try await FinderSync.events { try await FinderCatalog.shared.children(of: .workingSet) }
            if items.isEmpty { items = [FinderItem.eventsRoot] }
            // Bez sieci Materiały oddają kopię z dysku; błąd serwera bez kopii — pusto (wydarzenia działają dalej).
            do { items += try await MaterialsCatalog.shared.everything() } catch {
                if FinderSync.isSignedOut(error) { throw error }
                NSLog("[Mavinci Finder] Materiały w zbiorze roboczym: %@", error.localizedDescription)
            }
            do { items += try await DriveCatalog.shared.everything() } catch {
                if FinderSync.isSignedOut(error) { throw error }
                NSLog("[Mavinci Finder] Dysk w zbiorze roboczym: %@", error.localizedDescription)
            }
            return items
        default:
            if kind.isDrive { return try await DriveCatalog.shared.children(of: container) }
            if kind.isMaterials {
                // W folderze „Logotypy i księga znaku” — także „Z księgi znaku” (Dysk).
                var items = try await MaterialsCatalog.shared.children(of: container)
                items += await DriveCatalog.shared.brandFolders(in: container)
                return items
            }
            return try await FinderCatalog.shared.children(of: container)
        }
    }

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        let container = self.container
        let domain = self.domain
        Task {
            do {
                let items = try await Self.children(of: container)
                var start = 0
                while start < items.count {
                    let end = min(start + 200, items.count)
                    observer.didEnumerate(Array(items[start..<end]))
                    start = end
                }
                observer.finishEnumerating(upTo: nil)
                #if os(iOS)
                if container != .workingSet { FinderSync.signalIfStale(domain) }
                #endif
                // Kopia Materiałów starsza niż 15 minut (np. aplikacja zamknięta) — prośba o sprawdzenie zmian.
                if FinderID.parse(container).isMaterials, await MaterialsCatalog.shared.needsRefresh {
                    NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in }
                }
            } catch {
                observer.finishEnumeratingWithError(FinderAPI.mapped(error))
            }
        }
    }

    func enumerateChanges(for observer: NSFileProviderChangeObserver, from anchor: NSFileProviderSyncAnchor) {
        let container = self.container
        Task {
            // W rozszerzeniu replikowanym zmiany zbiera zbiór roboczy; pozostałe foldery nie mają własnych zmian.
            guard container == .workingSet else {
                observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
                return
            }
            let parts = FinderSync.parse(anchor)
            var next = parts
            var updated: [NSFileProviderItem] = []
            var deleted: [NSFileProviderItemIdentifier] = []
            do {
                let changes = try await FinderCatalog.shared.changes(since: Data((parts.e ?? "").utf8))
                if changes.reset {
                    observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
                    return
                }
                updated += changes.updated
                deleted += changes.deleted
                next.e = String(data: changes.anchor, encoding: .utf8)
            } catch let error as FinderServerError where error.status == 403 {
                // Bez dostępu do wydarzeń — Materiały synchronizują się dalej.
            } catch {
                observer.finishEnumeratingWithError(FinderAPI.mapped(error))
                return
            }
            do {
                let changes = try await MaterialsCatalog.shared.changes(since: parts.m)
                updated += changes.updated
                deleted += changes.deleted
                if let cursor = changes.cursor { next.m = cursor }
            } catch {
                // Materiały nie zatrzymują wydarzeń: kursor Materiałów zostaje, spróbujemy przy następnym sprawdzeniu.
                if FinderSync.isSignedOut(error) {
                    observer.finishEnumeratingWithError(FinderAPI.mapped(error))
                    return
                }
                NSLog("[Mavinci Finder] zmiany w Materiałach: %@", error.localizedDescription)
            }
            do {
                let changes = try await DriveCatalog.shared.changes()
                updated += changes.updated
                deleted += changes.deleted
                if let cursor = changes.cursor { next.d = cursor }
            } catch {
                // Dysk nie zatrzymuje wydarzeń ani Materiałów: różnica zostanie oddana przy następnym sprawdzeniu.
                if FinderSync.isSignedOut(error) {
                    observer.finishEnumeratingWithError(FinderAPI.mapped(error))
                    return
                }
                NSLog("[Mavinci Finder] zmiany w Dysku: %@", error.localizedDescription)
            }
            if !updated.isEmpty { observer.didUpdate(updated) }
            if !deleted.isEmpty { observer.didDeleteItems(withIdentifiers: deleted) }
            observer.finishEnumeratingChanges(upTo: FinderSync.encode(next), moreComing: false)
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        Task {
            let events = await FinderCatalog.shared.currentAnchor()
            let materials = await MaterialsCatalog.shared.currentCursor()
            let drive = await DriveCatalog.shared.currentCursor()
            if events == nil && materials == nil && drive == nil {
                completionHandler(nil)
                return
            }
            completionHandler(FinderSync.encode(.init(e: events.flatMap { String(data: $0.rawValue, encoding: .utf8) }, m: materials, d: drive)))
        }
    }
}
