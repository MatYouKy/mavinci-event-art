import Foundation
import SwiftUI
import AppKit

// MARK: Strefa sprzedawcy → „Prezentacje” (`/crm/presentations`) — działy i karty na spotkania z klientami przez
// `/bridge/native/v1/showcase` (token pracownika, te same reguły co CRM: podgląd — dostęp do ofert albo „Prezentacje — podgląd”,
// przygotowanie — „Prezentacje — przygotowanie” albo „Zarządzanie ofertami”). Lista i otwarte karty są na dysku (zaszyfrowane),
// zdjęcia — w pamięci podręcznej obrazów; widok otwiera się od razu, także bez internetu. Niezapisane zmiany zostają w pamięci
// przy przejściu do innej karty lub sekcji.

/// Kopia robocza karty w edytorze (niezapisane zmiany).
struct ShowcaseDraft: Equatable {
    var title: String
    var tagline: String
    var isActive: Bool
    var productIDs: [String]
    var content: ShowcaseContent
    /// Wersja karty, z której powstała kopia — zapis z inną wersją serwer odrzuca (zmiany z innego okna).
    var version: Int

    init(_ detail: ShowcaseDetail) {
        title = detail.item.title
        tagline = detail.item.tagline
        isActive = detail.item.isActive
        productIDs = detail.item.productIds
        content = detail.item.content
        version = detail.item.version
    }

    func differs(from detail: ShowcaseDetail) -> Bool {
        title != detail.item.title || tagline != detail.item.tagline || isActive != detail.item.isActive
            || productIDs != detail.item.productIds || content != detail.item.content
    }
}

/// Dział w edytorze (nowy — bez `id`).
struct ShowcaseSectionDraft: Identifiable, Equatable {
    var sectionID: String?
    var version: Int
    var title: String
    var subtitle: String
    var icon: String
    var isActive: Bool
    var cover: ShowcaseMedia?
    var id: String { sectionID ?? "new" }

    init(_ section: ShowcaseSection?) {
        sectionID = section?.id
        version = section?.version ?? 1
        title = section?.title ?? ""
        subtitle = section?.subtitle ?? ""
        icon = section?.icon ?? "sparkles"
        isActive = section?.isActive ?? true
        cover = section?.cover
    }
}

/// Podgląd jak na iPadzie: od strony startowej, działu albo karty (także niezapisanej z edytora).
struct ShowcasePreviewRequest: Identifiable {
    let id = UUID()
    var sectionID: String?
    var itemID: String?
    var draft: ShowcaseDetail?
}

/// Realizacja dodana w edytorze (nazwa i miniatura przed zapisem).
struct ShowcaseRefInfo: Hashable {
    var title: String
    var thumb: String?
}

enum ShowcaseUploadTarget {
    case item(String), section(String)
    var query: String {
        switch self {
        case .item(let id): return "item=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        case .section(let id): return "section=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        }
    }
    var body: [String: JSONValue] {
        switch self {
        case .item(let id): return ["itemId": .string(id)]
        case .section(let id): return ["sectionId": .string(id)]
        }
    }
}

@MainActor final class ShowcaseStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: ShowcaseHome?
    @Published var loadError: String?
    @Published private(set) var loading = false
    /// Dział wybrany w lewej kolumnie.
    @Published var sectionID: String?
    /// Karta otwarta w edytorze.
    @Published var openedID: String?
    @Published private(set) var details: [String: ShowcaseDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    @Published var drafts: [String: ShowcaseDraft] = [:]
    /// Adresy zdjęć (klucz `ShowcaseMedia.key`) z listy, kart i zdjęć dodanych w edytorze przed zapisem.
    @Published private(set) var urls: [String: ShowcaseURLPair] = [:]
    /// Nazwy produktów i realizacji dodanych w edytorze (przed zapisem karty).
    @Published var productNames: [String: String] = [:]
    @Published var realizationInfo: [String: ShowcaseRefInfo] = [:]
    @Published var query = ""
    @Published var sectionSheet: ShowcaseSectionDraft?
    @Published var creating = false
    @Published var preview: ShowcasePreviewRequest?
    /// Oferta ze spotkania (koszyk z pokazu, klient, utworzenie oferty i PDF) — `ShowcaseOffer.swift`.
    let offer = ShowcaseOfferStore()

    private var namespace: String?
    private var homeFile: SealedFile<ShowcaseHome>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var canManage: Bool { home?.access.manage == true }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        offer.showcase = self
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        offer.open(namespace: next)
        let sealed = SealedFile<ShowcaseHome>(namespace: "showcase-home-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            homeFile = sealed
            if home == nil, let saved { apply(saved) }
        }
    }

    func reset(clearDisk: Bool = true) {
        if clearDisk, let homeFile { try? homeFile.clear() }
        if clearDisk { for id in details.keys { try? detailFile(id)?.clear() } }
        offer.reset(clearDisk: clearDisk)
        homeFile = nil; namespace = nil; home = nil; loadError = nil; loading = false; sectionID = nil; openedID = nil
        details = [:]; detailErrors = [:]; drafts = [:]; urls = [:]; productNames = [:]; realizationInfo = [:]; query = ""
        sectionSheet = nil; creating = false; preview = nil
    }

    private func detailFile(_ id: String) -> SealedFile<ShowcaseDetail>? {
        guard let namespace else { return nil }
        return SealedFile<ShowcaseDetail>(namespace: "showcase-item-\(namespace)-\(id)")
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    private func apply(_ data: ShowcaseHome) {
        home = data
        urls.merge(data.urls) { _, new in new }
        if let sectionID, !data.sections.contains(where: { $0.id == sectionID }) { self.sectionID = nil }
    }

    // MARK: Lista
    func load(quiet: Bool = false) async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            let data = try JSONDecoder().decode(ShowcaseHome.self, from: try await api.get("/showcase", query: ["op": "home"]))
            guard owner == workspace?.employee?.id else { return }
            apply(data)
            loadError = nil
            if let homeFile { let copy = data; Task.detached(priority: .utility) { try? homeFile.save(copy) } }
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if !quiet || home == nil { loadError = failureText(error, "Nie udało się pobrać prezentacji.") }
        }
    }

    /// Działy w kolejności pokazu.
    var sections: [ShowcaseSection] {
        let locale = Locale(identifier: "pl_PL")
        return (home?.sections ?? []).sorted { a, b in
            a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.title.compare(b.title, locale: locale) == .orderedAscending
        }
    }

    var selectedSection: ShowcaseSection? {
        let list = sections
        return list.first { $0.id == sectionID } ?? list.first
    }

    /// Karty działu w kolejności pokazu.
    func items(in sectionID: String) -> [ShowcaseItemSummary] {
        let locale = Locale(identifier: "pl_PL")
        return (home?.items ?? []).filter { $0.sectionId == sectionID }.sorted { a, b in
            a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.title.compare(b.title, locale: locale) == .orderedAscending
        }
    }

    /// Wyszukiwanie we wszystkich kartach (tytuł, hasło, produkty).
    var searchResults: [ShowcaseItemSummary] {
        let locale = Locale(identifier: "pl_PL")
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: locale)
        guard !needle.isEmpty else { return [] }
        return (home?.items ?? []).filter { item in
            ([item.title, item.tagline] + item.productNames).contains { $0.lowercased(with: locale).contains(needle) }
        }
    }

    func url(_ key: String?) -> ShowcaseURLPair? {
        guard let key else { return nil }
        return urls[key]
    }

    func remember(urls added: [String: ShowcaseURLPair]) { urls.merge(added) { _, new in new } }

    // MARK: Karta
    func detail(_ id: String) -> ShowcaseDetail? { details[id] }

    func dirty(_ id: String) -> Bool {
        guard let draft = drafts[id], let detail = details[id] else { return false }
        return draft.differs(from: detail)
    }

    func stale(_ id: String) -> Bool {
        guard let draft = drafts[id], let detail = details[id] else { return false }
        return draft.version != detail.item.version && draft.differs(from: detail)
    }

    func loadDetail(_ id: String) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        if details[id] == nil, let file = detailFile(id), let saved = await Task.detached(priority: .userInitiated, operation: { try? file.load() }).value {
            remember(saved, own: false)
        }
        do {
            let data = try JSONDecoder().decode(ShowcaseDetail.self, from: try await api.get("/showcase", query: ["op": "item", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            remember(data, own: false)
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if let failure = error as? NativeFailure, failure.status == 404 {
                details[id] = nil; drafts[id] = nil
                try? detailFile(id)?.clear()
            }
            detailErrors[id] = failureText(error, "Nie udało się otworzyć karty.")
        }
    }

    /// Karta do podglądu (bez zmiany kopii roboczej).
    func fetchDetail(_ id: String) async -> ShowcaseDetail? {
        if let api, let data = try? await api.get("/showcase", query: ["op": "item", "id": id]),
           let detail = try? JSONDecoder().decode(ShowcaseDetail.self, from: data) {
            remember(urls: detail.urls)
            return detail
        }
        return details[id]
    }

    /// Nowa wersja karty z serwera. Kopia robocza bez zmian (albo odpowiedź na własną czynność) — od nowa; ze zmianami zostaje.
    private func remember(_ detail: ShowcaseDetail, own: Bool) {
        let id = detail.item.id
        let untouched: Bool
        if let draft = drafts[id], let previous = details[id] { untouched = !draft.differs(from: previous) } else { untouched = true }
        details[id] = detail
        if own || untouched || drafts[id] == nil { drafts[id] = ShowcaseDraft(detail) }
        remember(urls: detail.urls)
        for product in detail.products { productNames[product.id] = product.name }
        for realization in detail.realizations {
            realizationInfo[realization.id] = ShowcaseRefInfo(title: realization.title, thumb: realization.photos.first.flatMap { detail.urls[$0.key]?.thumb })
        }
        if let file = detailFile(id) { let copy = detail; Task.detached(priority: .utility) { try? file.save(copy) } }
    }

    func discardDraft(_ id: String) {
        guard let detail = details[id] else { return }
        drafts[id] = ShowcaseDraft(detail)
    }

    func keepDraft(_ id: String) {
        guard let detail = details[id] else { return }
        drafts[id]?.version = detail.item.version
    }

    func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval = 120) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return try await api.post("/showcase", payload, timeout: timeout)
    }

    private func guardWrite() -> Workspace? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        return workspace
    }

    @discardableResult private func runDetail(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?) async -> ShowcaseDetail? {
        guard let workspace = guardWrite() else { return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body) }
            let detail = try JSONDecoder().decode(ShowcaseDetail.self, from: data)
            remember(detail, own: true)
            detailErrors[detail.item.id] = nil
            if let success { workspace.succeed(success) }
            Task { await load(quiet: true) }
            return detail
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się.")
            return nil
        }
    }

    /// Prosta czynność (kolejność, usunięcie) z modalnym wskaźnikiem; po niej odświeżenie listy.
    @discardableResult private func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?) async -> Data? {
        guard let workspace = guardWrite() else { return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body) }
            if let success { workspace.succeed(success) }
            await load(quiet: true)
            return data
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się.")
            await load(quiet: true)
            return nil
        }
    }

    /// Nowa karta w dziale — pusta (szkielet pokazu) albo z produktu katalogu („Utwórz z produktu”).
    func createItem(sectionID: String, title: String?, productID: String?) async {
        var body: [String: JSONValue] = ["sectionId": .string(sectionID)]
        if let title, !title.isEmpty { body["title"] = .string(String(title.prefix(ShowcaseLimits.title))) }
        if let productID { body["productId"] = .string(productID) }
        creating = false
        let success = productID == nil ? "Utworzono kartę" : "Utworzono kartę z danymi produktu — dodaj zdjęcia i pytania klientów"
        if let detail = await runDetail(productID == nil ? "Tworzę kartę" : "Tworzę kartę z produktu", "createItem", body, success: success) {
            self.sectionID = detail.item.sectionId
            openedID = detail.item.id
        }
    }

    @discardableResult func saveItem(_ id: String) async -> ShowcaseDetail? {
        guard let draft = drafts[id] else { return nil }
        let body: [String: JSONValue] = [
            "id": .string(id), "version": .number(Double(draft.version)), "title": .string(draft.title), "tagline": .string(draft.tagline),
            "isActive": .bool(draft.isActive), "productIds": .array(draft.productIDs.map { JSONValue.string($0) }), "content": draft.content.json,
        ]
        return await runDetail("Zapisuję kartę", "saveItem", body, success: "Zapisano kartę")
    }

    func duplicateItem(_ id: String) async {
        if let detail = await runDetail("Kopiuję kartę", "duplicateItem", ["id": .string(id)], success: "Utworzono kopię (ukrytą) — popraw ją i pokaż na spotkaniach") {
            openedID = detail.item.id
        }
    }

    func deleteItem(_ id: String) async {
        guard await run("Usuwam kartę", "deleteItem", ["id": .string(id)], success: "Usunięto kartę") != nil else { return }
        try? detailFile(id)?.clear()
        if openedID == id { openedID = nil }
        details[id] = nil; drafts[id] = nil; detailErrors[id] = nil
    }

    // MARK: Działy i kolejność
    func saveSection(_ draft: ShowcaseSectionDraft) async {
        guard let workspace = guardWrite() else { return }
        var body: [String: JSONValue] = [
            "title": .string(draft.title), "subtitle": .string(draft.subtitle), "icon": .string(draft.icon), "isActive": .bool(draft.isActive),
            "cover": draft.cover.map { cover in (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(cover))) ?? .null } ?? .null,
        ]
        if let id = draft.sectionID { body["id"] = .string(id); body["version"] = .number(Double(draft.version)) }
        struct Reply: Decodable { let section: ShowcaseSection }
        do {
            let data = try await workspace.withPending(draft.sectionID == nil ? "Tworzę dział" : "Zapisuję dział") { try await post("saveSection", body) }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            await load(quiet: true)
            if draft.sectionID == nil {
                workspace.succeed("Utworzono dział — dodaj okładkę i karty")
                sectionID = reply.section.id
                var next = ShowcaseSectionDraft(reply.section)
                next.cover = draft.cover
                sectionSheet = next
            } else {
                workspace.succeed("Zapisano dział")
                sectionSheet = nil
            }
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać działu.")
        }
    }

    func deleteSection(_ id: String) async {
        guard await run("Usuwam dział", "deleteSection", ["id": .string(id), "withItems": .bool(true)], success: "Usunięto dział") != nil else { return }
        if let openedID, details[openedID]?.item.sectionId == id { self.openedID = nil }
        if sectionID == id { sectionID = nil }
        sectionSheet = nil
    }

    func reorderSections(_ ids: [String]) async {
        if var current = home {
            current.sections = current.sections.map { (section: ShowcaseSection) -> ShowcaseSection in
                var copy = section
                copy.sortOrder = ids.firstIndex(of: section.id) ?? copy.sortOrder
                return copy
            }
            home = current
        }
        await run("Zmieniam kolejność działów", "reorderSections", ["ids": .array(ids.map { JSONValue.string($0) })], success: "Zmieniono kolejność działów")
    }

    /// Kolejność kart w dziale; karta z innego działu przechodzi do tego działu.
    func reorderItems(sectionID: String, ids: [String], success: String) async {
        if var current = home {
            current.items = current.items.map { (item: ShowcaseItemSummary) -> ShowcaseItemSummary in
                guard let index = ids.firstIndex(of: item.id) else { return item }
                var copy = item
                copy.sectionId = sectionID
                copy.sortOrder = index
                return copy
            }
            home = current
        }
        await run("Zmieniam kolejność kart", "reorderItems", ["sectionId": .string(sectionID), "ids": .array(ids.map { JSONValue.string($0) })], success: success)
    }

    /// Karta przeciągnięta na dział — na koniec tego działu.
    func moveItem(_ itemID: String, toSection target: ShowcaseSection) async {
        guard let item = home?.items.first(where: { $0.id == itemID }), item.sectionId != target.id else { return }
        let ids = items(in: target.id).map(\.id) + [itemID]
        await reorderItems(sectionID: target.id, ids: ids, success: "Przeniesiono kartę do działu „\(target.title)”")
    }

    // MARK: Zdjęcia
    /// Zdjęcia z Findera lub z okna wyboru (JPEG, PNG, WebP bez zmian; HEIC, TIFF i większe — JPEG) → serwer CRM zapisuje wersje WebP.
    func upload(_ files: [URL], target: ShowcaseUploadTarget) async -> [ShowcasePhotoReply] {
        guard let workspace = guardWrite() else { return [] }
        var replies: [ShowcasePhotoReply] = []
        var errors: [String] = []
        for (index, file) in files.enumerated() {
            do {
                let reply = try await workspace.withPending("Wgrywam zdjęcia (\(index + 1)/\(files.count))") { () async throws -> ShowcasePhotoReply in
                    let prepared = try await Task.detached(priority: .userInitiated) { try SocialStore.prepare(file) }.value
                    return try await uploadBytes(prepared.0, mime: prepared.1, target: target)
                }
                replies.append(reply)
                remember(urls: reply.urls)
            } catch {
                errors.append(failureText(error, "Nie udało się wgrać „\(file.lastPathComponent)”."))
            }
        }
        if let first = errors.first { workspace.error = first }
        else if !replies.isEmpty { workspace.succeed("Dodano zdjęcia: \(replies.count) — zapisz zmiany") }
        return replies
    }

    private func uploadBytes(_ data: Data, mime: String, target: ShowcaseUploadTarget) async throws -> ShowcasePhotoReply {
        guard let api else { throw AppError.configuration }
        guard data.count <= ShowcaseLimits.uploadBytes else {
            throw NativeFailure(status: 413, message: "Zdjęcie może mieć najwyżej 40 MB.", fieldErrors: [:])
        }
        guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/showcase?op=upload&\(target.query)") else { throw AppError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 240
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
            throw NativeFailure(status: status, message: object?["error"] as? String ?? "Nie udało się wgrać zdjęcia.", fieldErrors: [:])
        }
        return try JSONDecoder().decode(ShowcasePhotoReply.self, from: body)
    }

    /// Zdjęcia z okna wyboru: produkt i realizacja — bez kopiowania (adresy z listy), Materiały, wydarzenie i social media — kopia WebP.
    func pick(_ photos: [ShowcasePickPhoto], source: ShowcasePhotoSource, target: ShowcaseUploadTarget) async -> [ShowcasePhotoReply] {
        guard let workspace = guardWrite() else { return [] }
        var replies: [ShowcasePhotoReply] = []
        var errors: [String] = []
        for (index, photo) in photos.enumerated() {
            if let media = photo.media {
                let full: String? = media.source == .site ? media.path : photo.thumbnailUrl
                let thumb: String? = media.source == .site ? (media.thumb ?? media.path) : photo.thumbnailUrl
                let reply = ShowcasePhotoReply(photo: media, urls: [media.key: ShowcaseURLPair(url: full, thumb: thumb)])
                replies.append(reply)
                remember(urls: reply.urls)
                continue
            }
            do {
                var body = target.body
                body["source"] = .string(source.rawValue)
                body["fileId"] = .string(photo.id)
                body["caption"] = .string((photo.name as NSString).deletingPathExtension)
                let data = try await workspace.withPending("Dodaję zdjęcia (\(index + 1)/\(photos.count))") { try await post("import", body, timeout: 180) }
                let reply = try JSONDecoder().decode(ShowcasePhotoReply.self, from: data)
                replies.append(reply)
                remember(urls: reply.urls)
            } catch {
                errors.append(failureText(error, "Nie udało się dodać „\(photo.name)”."))
            }
        }
        if let first = errors.first { workspace.error = first }
        else if !replies.isEmpty { workspace.succeed("Dodano zdjęcia: \(replies.count) — zapisz zmiany") }
        return replies
    }

    // MARK: Wybór
    private func fetch(_ params: [String: String]) async throws -> Data {
        guard let api else { throw AppError.configuration }
        return try await api.get("/showcase", query: params)
    }

    func products(query text: String) async throws -> [ShowcaseProductOption] {
        struct Reply: Decodable { let products: [ShowcaseProductOption] }
        var params = ["op": "products"]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["q"] = trimmed }
        return try JSONDecoder().decode(Reply.self, from: try await fetch(params)).products
    }

    func realizations(query text: String) async throws -> [ShowcaseRealizationOption] {
        struct Reply: Decodable { let realizations: [ShowcaseRealizationOption] }
        var params = ["op": "realizations"]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["q"] = trimmed }
        return try JSONDecoder().decode(Reply.self, from: try await fetch(params)).realizations
    }

    func events(query text: String) async throws -> [ShowcaseEventOption] {
        struct Reply: Decodable { let events: [ShowcaseEventOption] }
        var params = ["op": "events"]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["q"] = trimmed }
        return try JSONDecoder().decode(Reply.self, from: try await fetch(params)).events
    }

    func photos(source: ShowcasePhotoSource, owner: String?, query text: String) async throws -> ShowcasePhotosReply {
        var params = ["op": "photos", "source": source.rawValue]
        switch source {
        case .product: if let owner { params["product"] = owner }
        case .site: if let owner { params["realization"] = owner }
        case .event: if let owner { params["event"] = owner }
        case .material, .social:
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { params["q"] = trimmed }
        }
        return try JSONDecoder().decode(ShowcasePhotosReply.self, from: try await fetch(params))
    }
}
