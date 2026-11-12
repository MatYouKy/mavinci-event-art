import FileProvider
import Foundation

// MARK: Rozszerzenie Findera „Mavinci” (File Provider, replikowane)
//
// Mavinci → Eventy → rok → „RRRR-MM-DD Nazwa” → foldery i pliki z zakładki Pliki. Treść pliku pobiera się przy pierwszym
// otwarciu (potem zostaje na dysku, macOS może ją zwolnić przy braku miejsca). Zmiany z CRM przychodzą przez zbiór roboczy
// (`changes` od kursora) — aplikacja sygnalizuje je co minutę. Z Findera: dodawanie plików i folderów w folderach wydarzeń,
// edycja (konflikt → kopia „(konflikt …)”), zmiana nazwy, przenoszenie, kosz (= kosz CRM na 30 dni, „Odłóż” przywraca).
// Odmowa serwera (uprawnienia, zajęta nazwa) przywraca w Finderze stan z CRM.

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
                let item = try await FinderCatalog.shared.item(for: identifier)
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
                guard case .file(let id) = FinderID.parse(itemIdentifier) else { throw NSFileProviderError(.noSuchItem) }
                let (remote, item) = try await FinderCatalog.shared.download(file: id)
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
                let item = try await FinderCatalog.shared.create(template: itemTemplate, contents: url, mayAlreadyExist: mayAlreadyExist)
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
        Task {
            do {
                let (current, fetch) = try await FinderCatalog.shared.modify(item, base: version, fields: changedFields, contents: newContents)
                progress.completedUnitCount = 1
                completionHandler(current, [], fetch, nil)
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
                try await FinderCatalog.shared.delete(identifier, recursive: recursive)
                progress.completedUnitCount = 1
                completionHandler(nil)
            } catch {
                completionHandler(FinderAPI.mapped(error))
            }
        }
        return progress
    }

    func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
        FinderEnumerator(container: containerItemIdentifier)
    }
}

final class FinderEnumerator: NSObject, NSFileProviderEnumerator {
    let container: NSFileProviderItemIdentifier

    init(container: NSFileProviderItemIdentifier) {
        self.container = container
        super.init()
    }

    func invalidate() {}

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        let container = self.container
        Task {
            do {
                let items = try await FinderCatalog.shared.children(of: container)
                var start = 0
                while start < items.count {
                    let end = min(start + 200, items.count)
                    observer.didEnumerate(Array(items[start..<end]))
                    start = end
                }
                observer.finishEnumerating(upTo: nil)
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
            do {
                let changes = try await FinderCatalog.shared.changes(since: anchor.rawValue)
                if changes.reset {
                    observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
                    return
                }
                if !changes.updated.isEmpty { observer.didUpdate(changes.updated) }
                if !changes.deleted.isEmpty { observer.didDeleteItems(withIdentifiers: changes.deleted) }
                observer.finishEnumeratingChanges(upTo: NSFileProviderSyncAnchor(rawValue: changes.anchor), moreComing: false)
            } catch {
                observer.finishEnumeratingWithError(FinderAPI.mapped(error))
            }
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        Task { completionHandler(await FinderCatalog.shared.currentAnchor()) }
    }
}
