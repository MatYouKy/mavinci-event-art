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
    /// „Pokazuj na stronie produktu dla klienta” (bez przełącznika na serwerze — `true`, nie wysyłamy).
    var showOnProductPage: Bool
    /// Serwer zna przełącznik strony produktu (po migracji 20261128100000).
    var productPageSwitch: Bool
    var productIDs: [String]
    var content: ShowcaseContent
    /// Wersja karty, z której powstała kopia — zapis z inną wersją serwer odrzuca (zmiany z innego okna).
    var version: Int

    init(_ detail: ShowcaseDetail) {
        title = detail.item.title
        tagline = detail.item.tagline
        isActive = detail.item.isActive
        showOnProductPage = detail.item.showOnProductPage ?? true
        productPageSwitch = detail.item.showOnProductPage != nil
        productIDs = detail.item.productIds
        content = detail.item.content
        version = detail.item.version
    }

    func differs(from detail: ShowcaseDetail) -> Bool {
        title != detail.item.title || tagline != detail.item.tagline || isActive != detail.item.isActive
            || showOnProductPage != (detail.item.showOnProductPage ?? true)
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
    /// Marka działu (zapis tylko, gdy serwer ją obsługuje — `home.companies`).
    var companyId: String?
    var id: String { sectionID ?? "new" }

    init(_ section: ShowcaseSection?) {
        sectionID = section?.id
        version = section?.version ?? 1
        title = section?.title ?? ""
        subtitle = section?.subtitle ?? ""
        icon = section?.icon ?? "sparkles"
        isActive = section?.isActive ?? true
        cover = section?.cover
        companyId = section?.companyId
    }
}

/// Podgląd jak na iPadzie: od strony startowej, działu albo karty (także niezapisanej z edytora).
struct ShowcasePreviewRequest: Identifiable {
    let id = UUID()
    var sectionID: String?
    var itemID: String?
    var draft: ShowcaseDetail?
}

/// Zapis prezentacji na dysku Maca (karty, potem zdjęcia): postęp i wynik.
struct ShowcaseOfflineState: Equatable {
    var saving: Bool
    var done: Int
    var total: Int
    var failed: Int
    var label: String
}

/// Realizacja dodana w edytorze (nazwa i miniatura przed zapisem).
struct ShowcaseRefInfo: Hashable {
    var title: String
    var thumb: String?
}

/// Karta albo dział, do którego trafia zdjęcie; `none` — nowy dział (tylko baza zdjęć, produkty i realizacje).
enum ShowcaseUploadTarget {
    case item(String), section(String), none
    var query: String {
        switch self {
        case .item(let id): return "item=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        case .section(let id): return "section=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        case .none: return ""
        }
    }
    var body: [String: JSONValue] {
        switch self {
        case .item(let id): return ["itemId": .string(id)]
        case .section(let id): return ["sectionId": .string(id)]
        case .none: return [:]
        }
    }
    var canCopy: Bool { if case .none = self { return false } else { return true } }
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
    /// Prezentacje na dysku (pokaz bez internetu) — `nil`, zanim zapis ruszył.
    @Published private(set) var offlineState: ShowcaseOfflineState?
    private var offlineTask: Task<Void, Never>?
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
        offlineTask?.cancel(); offlineTask = nil; offlineState = nil
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
            saveOffline()
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

    /// Karta do podglądu (bez zmiany kopii roboczej): zapisana na dysku w aktualnej wersji, ze zdjęciami — od razu (odświeżenie
    /// w tle); inaczej z serwera, a bez internetu — z dysku.
    func fetchDetail(_ id: String) async -> ShowcaseDetail? {
        let version = home?.items.first { $0.id == id }?.version
        if let version, let saved = await savedDetail(id, version: version), saved.item.version == version, !missingImages(saved) {
            remember(urls: saved.urls)
            Task { [weak self] in _ = await self?.downloadDetail(id) }
            return saved
        }
        if let fresh = await downloadDetail(id) { return fresh }
        if let detail = details[id] { return detail }
        return await savedDetail(id, version: nil)
    }

    // MARK: Pokaz bez internetu

    /// Karta z serwera do pamięci na dysku (bez zmiany kopii roboczej edytora).
    private func downloadDetail(_ id: String) async -> ShowcaseDetail? {
        guard let api, let data = try? await api.get("/showcase", query: ["op": "item", "id": id]),
              let detail = try? JSONDecoder().decode(ShowcaseDetail.self, from: data) else { return nil }
        remember(urls: detail.urls)
        if let file = detailFile(id) { let copy = detail; Task.detached(priority: .utility) { try? file.save(copy) } }
        return detail
    }

    /// Karta zapisana na dysku (albo otwarta w edytorze w tej samej wersji).
    private func savedDetail(_ id: String, version: Int?) async -> ShowcaseDetail? {
        if let detail = details[id], version == nil || detail.item.version == version { return detail }
        guard let file = detailFile(id) else { return nil }
        return await Task.detached(priority: .utility) { try? file.load() }.value
    }

    /// Czy któregoś zdjęcia karty (pełnego albo miniatury) brakuje na dysku.
    private func missingImages(_ detail: ShowcaseDetail) -> Bool {
        detail.urls.values.contains { pair in [pair.url, pair.thumb].compactMap { $0 }.contains { !SocialImageCache.shared.stored($0) } }
    }

    /// Karty widoczne w układzie pracownika i wszystkie ich zdjęcia na dysku (jak w aplikacji na telefonie i iPadzie): podgląd pokazu
    /// otwiera kartę od razu, bez internetu działa cały pokaz. Pobiera tylko zmienione karty i brakujące zdjęcia (jeden zapis naraz).
    private func saveOffline() {
        guard offlineTask == nil else { return }
        offlineTask = Task { [weak self] in
            await self?.prefetchOffline()
            self?.offlineTask = nil
        }
    }

    private func prefetchOffline() async {
        guard let home, api != nil else { return }
        let owner = workspace?.employee?.id
        let visible = sectionsForMe.flatMap { itemsForMe(in: $0.id) }
        var links = Set<String>()
        for pair in home.urls.values { if let link = pair.thumb ?? pair.url { links.insert(link) } }
        var failed = 0
        offlineState = ShowcaseOfflineState(saving: true, done: 0, total: visible.count, failed: 0, label: "Zapisuję karty na dysk")
        for (index, summary) in visible.enumerated() {
            guard !Task.isCancelled, owner == workspace?.employee?.id else { return }
            var detail = await savedDetail(summary.id, version: summary.version)
            if detail?.item.version != summary.version || detail.map(missingImages) ?? true {
                if let fresh = await downloadDetail(summary.id) { detail = fresh } else { failed += 1 }
            }
            if let detail {
                for pair in detail.urls.values {
                    if let link = pair.url { links.insert(link) }
                    if let link = pair.thumb { links.insert(link) }
                }
            }
            offlineState?.done = index + 1
        }
        let pending = links.filter { !SocialImageCache.shared.stored($0) }.sorted()
        offlineState = ShowcaseOfflineState(saving: true, done: 0, total: pending.count, failed: failed, label: "Pobieram zdjęcia na dysk")
        var done = 0
        for start in stride(from: 0, to: pending.count, by: 4) {
            guard !Task.isCancelled, owner == workspace?.employee?.id else { return }
            let batch = Array(pending[start..<min(start + 4, pending.count)])
            let saved = await withTaskGroup(of: Bool.self) { group -> Int in
                for link in batch { group.addTask { await SocialImageCache.shared.store(link) } }
                var count = 0
                for await ok in group where ok { count += 1 }
                return count
            }
            failed += batch.count - saved
            done += batch.count
            offlineState?.done = done
        }
        offlineState = ShowcaseOfflineState(saving: false, done: pending.count, total: pending.count, failed: failed,
                                            label: failed == 0 ? "Prezentacje zapisane na dysku — pokaz działa bez internetu"
                                                : "Część prezentacji nie zapisała się na dysku — dokończę przy następnym odświeżeniu")
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
    /// Nowa karta; `example` — karta z przykładu z instrukcji („?”): pełna treść do podejrzenia i przerobienia, ukryta.
    func createItem(sectionID: String, title: String?, productID: String?, example: Bool = false) async {
        var body: [String: JSONValue] = ["sectionId": .string(sectionID)]
        if let title, !title.isEmpty { body["title"] = .string(String(title.prefix(ShowcaseLimits.title))) }
        if let productID { body["productId"] = .string(productID) }
        if example { body["example"] = .bool(true) }
        creating = false
        let success = example ? "Utworzono kartę z przykładu (ukryta) — dodaj zdjęcia z bazy i produkt, potem pokaż ją na spotkaniach"
            : productID == nil ? "Utworzono kartę" : "Utworzono kartę z danymi produktu — dodaj zdjęcia i pytania klientów"
        let pending = example ? "Tworzę kartę z przykładu" : productID == nil ? "Tworzę kartę" : "Tworzę kartę z produktu"
        if let detail = await runDetail(pending, "createItem", body, success: success) {
            self.sectionID = detail.item.sectionId
            openedID = detail.item.id
        }
    }

    @discardableResult func saveItem(_ id: String) async -> ShowcaseDetail? {
        guard let draft = drafts[id] else { return nil }
        var body: [String: JSONValue] = [
            "id": .string(id), "version": .number(Double(draft.version)), "title": .string(draft.title), "tagline": .string(draft.tagline),
            "isActive": .bool(draft.isActive), "productIds": .array(draft.productIDs.map { JSONValue.string($0) }), "content": draft.content.json,
        ]
        if draft.productPageSwitch { body["showOnProductPage"] = .bool(draft.showOnProductPage) }
        return await runDetail("Zapisuję kartę", "saveItem", body, success: "Zapisano kartę")
    }

    /// Asystent AI: propozycje treści z danych produktów karty i opisu od sprzedawcy (bez zapisu — wstawia sprzedawca).
    func assist(draft: ShowcaseDraft, brief: String, fields: [ShowcaseAiField]) async throws -> ShowcaseAiSuggestion {
        guard let workspace, workspace.canWrite else { throw NativeFailure(status: 0, message: "Asystent AI wymaga połączenia z serwerem CRM.", fieldErrors: [:]) }
        let body: [String: JSONValue] = [
            "title": .string(draft.title), "tagline": .string(draft.tagline), "productIds": .array(draft.productIDs.map { JSONValue.string($0) }),
            "content": draft.content.json, "brief": .string(String(brief.prefix(2000))), "fields": .array(fields.map { JSONValue.string($0.rawValue) }),
        ]
        return try JSONDecoder().decode(ShowcaseAiSuggestion.self, from: try await post("assist", body, timeout: 180))
    }

    /// Instrukcja „?” (te same rozdziały co w CRM i w telefonie — `presentationsHelp.ts` na serwerze).
    func help() async throws -> ShowcaseHelpManual {
        struct Reply: Decodable { let manual: ShowcaseHelpManual }
        return try JSONDecoder().decode(Reply.self, from: try await fetch(["op": "help"])).manual
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
    /// Zapis działu; `pendingCover` — okładka z dysku wybrana przed utworzeniem działu (wgrywa się zaraz po utworzeniu).
    func saveSection(_ draft: ShowcaseSectionDraft, pendingCover: URL? = nil) async {
        guard let workspace = guardWrite() else { return }
        var body: [String: JSONValue] = [
            "title": .string(draft.title), "subtitle": .string(draft.subtitle), "icon": .string(draft.icon), "isActive": .bool(draft.isActive),
            "cover": draft.cover.map { cover in (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(cover))) ?? .null } ?? .null,
        ]
        if let id = draft.sectionID { body["id"] = .string(id); body["version"] = .number(Double(draft.version)) }
        if home?.companies != nil { body["companyId"] = draft.companyId.map { JSONValue.string($0) } ?? .null }
        struct Reply: Decodable { let section: ShowcaseSection }
        do {
            let data = try await workspace.withPending(draft.sectionID == nil ? "Tworzę dział" : "Zapisuję dział") { try await post("saveSection", body) }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            await load(quiet: true)
            if draft.sectionID == nil {
                workspace.succeed("Utworzono dział — dodaj karty")
                sectionID = reply.section.id
                var next = ShowcaseSectionDraft(reply.section)
                next.cover = reply.section.cover ?? draft.cover
                if let pendingCover, let photo = await upload([pendingCover], target: .section(reply.section.id), next: "okładka zapisana").first?.photo {
                    next.cover = photo
                    var coverBody = body
                    coverBody["id"] = .string(reply.section.id)
                    coverBody["version"] = .number(Double(reply.section.version))
                    coverBody["cover"] = (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(photo))) ?? .null
                    if let saved = try? JSONDecoder().decode(Reply.self, from: try await post("saveSection", coverBody)) {
                        next = ShowcaseSectionDraft(saved.section)
                        await load(quiet: true)
                    }
                }
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

    // MARK: Własny układ pracownika

    /// Kolejność działów w układzie pracownika (inni widzą swój układ).
    func reorderSections(_ ids: [String]) async {
        if var current = home {
            current.sections = current.sections.map { (section: ShowcaseSection) -> ShowcaseSection in
                var copy = section
                copy.sortOrder = ids.firstIndex(of: section.id) ?? copy.sortOrder
                return copy
            }
            home = current
        }
        await saveLayout(success: "Zmieniono kolejność działów w Twoim układzie")
    }

    /// Kolejność kart działu w układzie pracownika (bez zmiany działu karty).
    func reorderItems(sectionID: String, ids: [String], success: String) async {
        if var current = home {
            current.items = current.items.map { (item: ShowcaseItemSummary) -> ShowcaseItemSummary in
                guard item.sectionId == sectionID, let index = ids.firstIndex(of: item.id) else { return item }
                var copy = item
                copy.sortOrder = index
                return copy
            }
            home = current
        }
        await saveLayout(success: success)
    }

    /// Ukrycie albo pokazanie działu lub karty w układzie pracownika.
    func setHidden(section id: String, _ hidden: Bool) async {
        guard var current = home else { return }
        current.sections = current.sections.map { section in var copy = section; if section.id == id { copy.hiddenForMe = hidden }; return copy }
        home = current
        await saveLayout(success: hidden ? "Dział ukryty w Twoim układzie (inni widzą swój układ)" : "Dział znów widoczny w Twoim układzie")
    }

    func setHidden(item id: String, _ hidden: Bool) async {
        guard var current = home else { return }
        current.items = current.items.map { item in var copy = item; if item.id == id { copy.hiddenForMe = hidden }; return copy }
        home = current
        await saveLayout(success: hidden ? "Karta ukryta w Twoim układzie (inni widzą swój układ)" : "Karta znów widoczna w Twoim układzie")
    }

    /// „Układ domyślny” — kolejność z przygotowania, bez ukrytych u pracownika.
    func resetLayout() async {
        await run("Przywracam układ domyślny", "resetLayout", [:], success: "Przywrócono układ domyślny")
    }

    /// Bieżący układ do zapisu (jak `showcaseLayoutOf`): wszystkie działy i karty w kolejności z listy, z ukrytymi.
    private func layoutPayload() -> JSONValue {
        let entry = { (id: String, hidden: Bool?) -> JSONValue in .object(["id": .string(id), "hidden": .bool(hidden == true)]) }
        var items: [String: JSONValue] = [:]
        for section in home?.sections ?? [] {
            let list = self.items(in: section.id)
            if !list.isEmpty { items[section.id] = .array(list.map { entry($0.id, $0.hiddenForMe) }) }
        }
        return .object(["sections": .array(sections.map { entry($0.id, $0.hiddenForMe) }), "items": .object(items)])
    }

    private func saveLayout(success: String) async {
        await run("Zapisuję Twój układ", "saveLayout", ["layout": layoutPayload()], success: success)
    }

    /// Na spotkaniu: bez działów i kart ukrytych w układzie pracownika (karty ukrytego działu też znikają).
    var sectionsForMe: [ShowcaseSection] { sections.filter { $0.hiddenForMe != true } }
    func itemsForMe(in sectionID: String) -> [ShowcaseItemSummary] {
        guard sectionsForMe.contains(where: { $0.id == sectionID }) else { return [] }
        return items(in: sectionID).filter { $0.hiddenForMe != true }
    }

    /// Przeniesienie kart do działu dla wszystkich (przygotowanie): kolejność domyślna działu, karta z innego działu przechodzi tutaj.
    func moveItems(sectionID: String, ids: [String], success: String) async {
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
        await run("Przenoszę kartę", "reorderItems", ["sectionId": .string(sectionID), "ids": .array(ids.map { JSONValue.string($0) })], success: success)
    }

    /// Karta przeciągnięta na dział — na koniec tego działu (dla wszystkich; przygotowanie prezentacji).
    func moveItem(_ itemID: String, toSection target: ShowcaseSection) async {
        guard let item = home?.items.first(where: { $0.id == itemID }), item.sectionId != target.id else { return }
        let ids = items(in: target.id).map(\.id) + [itemID]
        await moveItems(sectionID: target.id, ids: ids, success: "Przeniesiono kartę do działu „\(target.title)”")
    }

    // MARK: Zdjęcia
    /// Zdjęcia z Findera lub z okna wyboru (JPEG, PNG, WebP bez zmian; HEIC, TIFF i większe — JPEG) → baza zdjęć (Materiały →
    /// Zdjęcia, ten sam plik drugi raz się nie zapisze) i wersja WebP do pokazu; bez prawa zmian w Materiałach — tylko prezentacja.
    func upload(_ files: [URL], target: ShowcaseUploadTarget, next: String = "zapisz zmiany") async -> [ShowcasePhotoReply] {
        guard let workspace = guardWrite() else { return [] }
        var replies: [ShowcaseUploadReply] = []
        var errors: [String] = []
        for (index, file) in files.enumerated() {
            do {
                let reply = try await workspace.withPending("Wgrywam zdjęcia do bazy (\(index + 1)/\(files.count))") { () async throws -> ShowcaseUploadReply in
                    let prepared = try await Task.detached(priority: .userInitiated) { try SocialStore.prepare(file) }.value
                    return try await uploadBytes(prepared.0, mime: prepared.1, name: Self.uploadName(file.lastPathComponent, mime: prepared.1), target: target)
                }
                replies.append(reply)
                remember(urls: reply.urls)
            } catch {
                errors.append(failureText(error, "Nie udało się wgrać „\(file.lastPathComponent)”."))
            }
        }
        if let first = errors.first { workspace.error = first }
        else if !replies.isEmpty { workspace.succeed(Self.uploadSummary(replies, next: next)) }
        if replies.contains(where: { $0.stored == "materials" }) { FinderDomain.signal() }
        return replies.map(\.reply)
    }

    /// Nazwa w Materiałach zgodna z treścią (HEIC i TIFF zamienione na JPEG dostają „.jpg”).
    static func uploadName(_ name: String, mime: String) -> String {
        let base = (name as NSString).deletingPathExtension.isEmpty ? "zdjecie" : (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension.lowercased()
        switch mime {
        case "image/png": return ext == "png" ? name : base + ".png"
        case "image/webp": return ext == "webp" ? name : base + ".webp"
        default: return ["jpg", "jpeg"].contains(ext) ? name : base + ".jpg"
        }
    }

    /// „Dodano zdjęcia: 2 — w bazie zdjęć: Materiały → Mavinci → Zdjęcia (to zdjęcie już tam było) — zapisz zmiany”.
    static func uploadSummary(_ replies: [ShowcaseUploadReply], next: String) -> String {
        let stored = replies.filter { $0.stored == "materials" }
        let existing = stored.filter { $0.existing == true }.count
        var text = "Dodano zdjęcia: \(replies.count)"
        if let file = stored.first?.file { text += " — w bazie zdjęć: Materiały → \(file.companyName) → \(file.folderName)" }
        if existing > 0 { text += existing == 1 && stored.count == 1 ? " (to zdjęcie już tam było)" : " (już było: \(existing))" }
        if !next.isEmpty { text += " — \(next)" }
        return text
    }

    private func uploadBytes(_ data: Data, mime: String, name: String, target: ShowcaseUploadTarget) async throws -> ShowcaseUploadReply {
        guard let api else { throw AppError.configuration }
        guard data.count <= ShowcaseLimits.uploadBytes else {
            throw NativeFailure(status: 413, message: "Zdjęcie może mieć najwyżej 40 MB.", fieldErrors: [:])
        }
        let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let fileName = String(name.prefix(200)).addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
        let suffix = target.query.isEmpty ? "" : "&\(target.query)"
        guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/showcase?op=upload&base=1&name=\(fileName)\(suffix)") else { throw AppError.configuration }
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
        return try JSONDecoder().decode(ShowcaseUploadReply.self, from: body)
    }

    /// Zdjęcia z okna wyboru: produkt i realizacja — bez kopiowania (adresy z listy), baza zdjęć — odnośnik do Materiałów
    /// (wspólna wersja WebP do pokazu), social media — kopia WebP.
    func pick(_ photos: [ShowcasePickPhoto], source: ShowcasePhotoSource, target: ShowcaseUploadTarget) async -> [ShowcasePhotoReply] {
        guard let workspace = guardWrite() else { return [] }
        var replies: [ShowcasePhotoReply] = []
        var errors: [String] = []
        for (index, photo) in photos.enumerated() {
            if let media = photo.media {
                let thumb: String? = photo.thumbnailUrl ?? (media.source == .site ? (media.thumb ?? media.path) : nil)
                let full: String? = photo.url ?? (media.source == .site ? media.path : thumb)
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
                if source == .material { body["reference"] = .bool(true) }
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

    func photos(source: ShowcasePhotoSource, owner: String?, query text: String, album: String? = nil, offset: Int = 0) async throws -> ShowcasePhotosReply {
        var params = ["op": "photos", "source": source.rawValue]
        switch source {
        case .product: if let owner { params["product"] = owner }
        case .site: if let owner { params["realization"] = owner }
        case .material, .social:
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { params["q"] = trimmed }
            if source == .material {
                if let album { params["album"] = album }
                if offset > 0 { params["offset"] = String(offset) }
            }
        }
        return try JSONDecoder().decode(ShowcasePhotosReply.self, from: try await fetch(params))
    }

    /// Baza zdjęć: dokąd trafiają zdjęcia z dysku i albumy (Materiały → Albumy).
    func photoBase() async throws -> ShowcasePhotoBaseReply {
        try JSONDecoder().decode(ShowcasePhotoBaseReply.self, from: try await fetch(["op": "photoBase"]))
    }

    /// Pliki z bazy do albumu (odnośniki, bez kopiowania) — `nil` przy błędzie (komunikat w pasku).
    func addToAlbum(_ album: ShowcaseAlbumOption, fileIDs: [String]) async -> (added: Int, skipped: Int)? {
        guard let workspace = guardWrite(), let api, !fileIDs.isEmpty else { return nil }
        struct Reply: Decodable { let added: Int; let skipped: Int }
        do {
            let data = try await workspace.withPending("Dodaję do albumu") {
                try await api.post("/materials", ["op": .string("albumAdd"), "id": .string(album.id), "fileIds": .array(fileIDs.map { .string($0) })])
            }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            if reply.added > 0 { workspace.succeed("Dodano do albumu „\(album.name)”: \(reply.added) — bez kopiowania plików") }
            else { workspace.notice = "Album „\(album.name)” ma już to zdjęcie albo zdjęcie należy do innej marki." }
            return (reply.added, reply.skipped)
        } catch {
            workspace.error = failureText(error, "Nie udało się dodać do albumu.")
            return nil
        }
    }

    /// Nowy album w bazie zdjęć (opcjonalnie z wybranymi plikami) — identyfikator albumu.
    func createAlbum(companyID: String, name: String, fileIDs: [String]) async -> String? {
        guard let workspace = guardWrite(), let api else { return nil }
        struct Album: Decodable { let id: String }
        struct Reply: Decodable { let album: Album; let added: Int }
        do {
            let data = try await workspace.withPending("Tworzę album") {
                try await api.post("/materials", [
                    "op": .string("createAlbum"), "companyId": .string(companyID), "name": .string(name), "fileIds": .array(fileIDs.map { .string($0) }),
                ])
            }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            workspace.succeed(reply.added > 0 ? "Utworzono album „\(name)” (\(reply.added) zdj.)" : "Utworzono album „\(name)”")
            return reply.album.id
        } catch {
            workspace.error = failureText(error, "Nie udało się utworzyć albumu.")
            return nil
        }
    }
}
