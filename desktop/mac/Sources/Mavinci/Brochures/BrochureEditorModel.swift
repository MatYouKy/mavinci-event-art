import SwiftUI

// MARK: Edytor broszury (`BrochureEditorClient`) — szkic zmian z autozapisem, strony (kolejność, widoczność, wybór), podgląd
// na żywo, zdjęcia, sprawdzanie i generowanie PDF (ogólny albo dla klienta), ostatni własny PDF, szkic kampanii.

/// Edytowalna kopia broszury; różnica względem zapisanej wersji to „niezapisane zmiany”.
struct BrochureDraft: Equatable {
    var name: String
    var title: String
    var subtitle: String
    var introduction: String
    var closingText: String
    var audienceType: String
    var organizationId: String?
    var myCompanyId: String
    var contactEmployeeId: String?
    var coverImagePath: String?
    var composer: BrochureComposer
    var pages: [JSONValue]
    var items: [BrochureItem]

    init(_ brochure: BrochureEditorData.Brochure, items: [BrochureItem]) {
        name = brochure.name
        title = brochure.title
        subtitle = brochure.subtitle
        introduction = brochure.introduction
        closingText = brochure.closingText
        audienceType = brochure.audienceType
        organizationId = brochure.organizationId
        myCompanyId = brochure.myCompanyId
        contactEmployeeId = brochure.contactEmployeeId
        coverImagePath = brochure.coverImagePath
        composer = brochure.composer
        pages = brochure.decorativePages
        self.items = items
    }

    var pageInfos: [BrochurePageInfo] { pages.map { BrochurePageInfo(raw: $0.object) } }

    /// Dane broszury dla zapisu i podglądu (stan demo zmienia się w części ze statystykami — tu zostaje bez zmian).
    var payload: [String: JSONValue] {
        let optional = { (value: String?) -> JSONValue in value.map { JSONValue.string($0) } ?? .null }
        return [
            "brochure": .object([
                "name": .string(name), "title": .string(title), "subtitle": .string(subtitle), "introduction": .string(introduction),
                "closingText": .string(closingText), "audienceType": .string(audienceType), "organizationId": optional(organizationId),
                "myCompanyId": .string(myCompanyId), "contactEmployeeId": optional(contactEmployeeId), "coverImagePath": optional(coverImagePath),
            ]),
            "composer": composer.json,
            "decorativePages": .array(pages),
            "items": .array(items.map(\.json)),
        ]
    }
}

/// Wiersz nawigatora stron: numer w PDF (ukryte bez numeru), tytuł, rodzaj, miniatura.
struct BrochurePageRow: Identifiable {
    let key: String
    let title: String
    let subtitle: String
    let visible: Bool
    let imageKey: String?
    let number: Int?
    var id: String { key }
    var kind: String {
        if key.hasPrefix("product:") { return "product" }
        if key.hasPrefix("decorative:") { return "decorative" }
        return key
    }
}

/// Stan zapisu w pasku okna.
enum BrochureSaveState { case saved, pending, saving, failed }

@MainActor final class BrochureEditorModel: ObservableObject {
    enum SaveMode { case manual, quiet, auto }

    let store: BrochuresStore
    let id: String
    @Published private(set) var data: BrochureEditorData?
    @Published var draft: BrochureDraft?
    @Published private(set) var saved: BrochureDraft?
    @Published var loadError: String?
    @Published var imageUrls: [String: String] = [:]
    @Published private(set) var previewHtml = ""
    @Published private(set) var previewPages = 0
    @Published private(set) var previewLoading = false
    @Published private(set) var previewError: String?
    /// Zaznaczenie w nawigatorze: „settings” (ustawienia broszury) albo klucz strony.
    @Published var selectedPage = "settings"
    @Published var recipient: BrochureClient?
    @Published var recipientEmail = ""
    @Published var issues: [BrochureIssue]?
    @Published var issuesStale = false
    @Published var validationError: String?
    @Published private(set) var busy: String?
    @Published private(set) var saving = false
    @Published private(set) var saveFailed = false
    /// Autozapis wstrzymany: brak nazwy broszury lub tytułu okładki.
    @Published private(set) var saveBlocked: String?
    @Published private(set) var hotelAssets: [BrochureAsset] = []
    @Published private(set) var assetNotice = ""
    /// Tło za stronami podglądu (kolor motywu okna).
    var background = "#0f1119"
    /// Podgląd PDF w oknie aplikacji (ustawiany przez widok edytora).
    var showPdf: (OfferPdfPreview) -> Void = { _ in }
    private var previewTask: Task<Void, Never>?
    private var autosaveTask: Task<Void, Never>?
    private var saveTask: Task<Bool, Never>?
    private var signing: Set<String> = []
    private var hotelKey = ""
    /// Ostatnio obsłużony szkic — odświeżenie po zapisie nie oznacza raportu jako nieaktualnego.
    private var lastDraft: BrochureDraft?
    /// Studio stron: podgląd wybranej strony graficznej pod płótnem rozmieszczenia.
    @Published private(set) var canvasHtml = ""
    private(set) var canvasKey = ""
    private var canvasTask: Task<Void, Never>?

    init(store: BrochuresStore, id: String) {
        self.store = store
        self.id = id
    }

    var workspace: Workspace? { store.workspace }
    var dirty: Bool { draft != nil && draft != saved }
    var canEdit: Bool { (data?.canManage ?? false) && busy == nil }
    var canGenerate: Bool { (data?.canManage ?? false) && (data?.canViewResults ?? false) && busy == nil && pageRows.contains(where: \.visible) }
    var company: BrochureEditorData.Company? { data?.companies.first(where: { $0.id == draft?.myCompanyId }) }
    var saveState: BrochureSaveState { saving ? .saving : saveFailed ? .failed : dirty ? .pending : .saved }
    /// Ostrzeżenie „Treść zmieniła się od wygenerowania PDF” (w CRM także przy niezapisanych zmianach broszury z PDF).
    var outdatedPdf: Bool {
        guard let brochure = data?.brochure, brochure.pdfVersion > 0 else { return false }
        return brochure.modified || (dirty && brochure.hasPdf)
    }

    // MARK: Wczytanie

    func load() async {
        do {
            apply(try await store.editor(id))
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać broszury")
        }
    }

    /// Świeży stan z serwera (po wczytaniu, dodaniu lub usunięciu usługi, po PDF): szkic bez zmian; przy pierwszym wczytaniu
    /// wybrana jest pierwsza widoczna strona (jak w CRM), później zostaje bieżący wybór, o ile strona nadal istnieje.
    func apply(_ next: BrochureEditorData) {
        let firstLoad = data == nil
        data = next
        let fresh = BrochureDraft(next.brochure, items: next.items)
        draft = fresh
        saved = fresh
        saveFailed = false
        saveBlocked = nil
        autosaveTask?.cancel()
        hotelAssets = next.hotelAssets
        assetNotice = next.assetNotice
        hotelKey = "\(fresh.organizationId ?? "")|\(fresh.myCompanyId)"
        if firstLoad {
            selectedPage = visibleKeys(fresh).first ?? "settings"
        } else if selectedPage != "settings" && !pageRows.contains(where: { $0.key == selectedPage }) {
            selectedPage = visibleKeys(fresh).first ?? "settings"
        }
        draftChanged(immediate: true)
    }

    /// Zmiana nazwy, archiwum lub przywrócenie: tylko nazwa i stan, pozostałe niezapisane zmiany zostają w edytorze.
    func applyRecord(_ record: BrochureRecord) {
        guard var next = data else { return }
        next.brochure.name = record.name
        next.brochure.status = record.status
        next.brochure.updatedAt = record.updatedAt
        next.brochure.pdfVersion = record.pdfVersion
        next.brochure.modified = next.brochure.modified || record.modified
        data = next
        draft?.name = record.name
        saved?.name = record.name
    }

    // MARK: Strony

    private func visibleKeys(_ draft: BrochureDraft) -> [String] {
        BrochureComposition.ordered(
            itemIDs: draft.items.filter(\.visible).map(\.id),
            pages: draft.pageInfos.map { page in BrochureComposition.Page(id: page.id, afterItemId: page.afterItemId, visible: page.visible) },
            order: draft.composer.pageOrder
        ).filter { key in !draft.composer.hiddenPages.contains(key) }
    }

    var pageRows: [BrochurePageRow] {
        guard let draft else { return [] }
        let infos = draft.pageInfos
        let keys = BrochureComposition.ordered(
            itemIDs: draft.items.map(\.id),
            pages: infos.map { page in BrochureComposition.Page(id: page.id, afterItemId: page.afterItemId, visible: true) },
            order: draft.composer.pageOrder
        )
        var counter = 0
        var rows: [BrochurePageRow] = []
        for key in keys {
            var title = ""
            var subtitle = ""
            var visible = true
            var imageKey: String?
            if key.hasPrefix("product:"), let item = draft.items.first(where: { $0.id == String(key.dropFirst(8)) }) {
                title = item.title
                subtitle = item.base.category ?? "Usługa z katalogu"
                visible = item.visible
                imageKey = item.imagePath.isEmpty ? nil : BrochureAsset.key("offer-product-pages", item.imagePath)
            } else if key.hasPrefix("decorative:"), let page = infos.first(where: { $0.id == String(key.dropFirst(11)) }) {
                title = page.slogan.isEmpty ? "Gotowa grafika" : page.slogan.replacingOccurrences(of: "\n", with: " ")
                subtitle = BrochureLayouts.labels[page.layout] ?? "Strona graficzna"
                visible = page.visible
                imageKey = page.imagePath.isEmpty ? nil : BrochureAsset.key(page.imageBucket, page.imagePath)
            } else {
                title = ["cover": "Okładka", "intro": "Wprowadzenie", "closing": "Kontakt i następny krok"][key] ?? "Strona"
                subtitle = ["cover": "Tytuł, podtytuł i zdjęcie", "intro": "Tekst wprowadzenia", "closing": "Zakończenie i kontakt"][key] ?? ""
                visible = !draft.composer.hiddenPages.contains(key)
                if key == "cover" {
                    let path = draft.composer.coverImagePath.isEmpty ? (draft.coverImagePath ?? "") : draft.composer.coverImagePath
                    let bucket = draft.composer.coverImagePath.isEmpty ? "offer-product-pages" : draft.composer.coverImageBucket
                    imageKey = path.isEmpty ? nil : BrochureAsset.key(bucket, path)
                }
            }
            if visible { counter += 1 }
            rows.append(BrochurePageRow(key: key, title: title, subtitle: subtitle, visible: visible, imageKey: imageKey, number: visible ? counter : nil))
        }
        return rows
    }

    var selectedRow: BrochurePageRow? { pageRows.first(where: { $0.key == selectedPage }) }

    var selectedItem: BrochureItem? {
        guard selectedPage.hasPrefix("product:") else { return nil }
        return draft?.items.first(where: { $0.id == String(selectedPage.dropFirst(8)) })
    }

    func updateSelectedItem(_ change: (inout BrochureItem) -> Void) {
        guard canEdit, let itemID = selectedItem?.id, let index = draft?.items.firstIndex(where: { $0.id == itemID }) else { return }
        change(&draft!.items[index])
    }

    func toggle(_ key: String) {
        guard canEdit, draft != nil else { return }
        if key.hasPrefix("decorative:") {
            // Jak `updateDecorations` w CRM: kolejność stron zostaje zapisana w kompozycji.
            let order = pageRows.map(\.key)
            let pageID = String(key.dropFirst(11))
            guard let index = draft!.pages.firstIndex(where: { $0.object["id"]?.text == pageID }) else { return }
            var raw = draft!.pages[index].object
            raw["isVisible"] = .bool(raw["isVisible"] == JSONValue.bool(false))
            draft!.pages[index] = .object(raw)
            draft!.composer.pageOrder = order
        } else if key.hasPrefix("product:") {
            if let index = draft!.items.firstIndex(where: { $0.id == String(key.dropFirst(8)) }) { draft!.items[index].visible.toggle() }
        } else if let index = draft!.composer.hiddenPages.firstIndex(of: key) {
            draft!.composer.hiddenPages.remove(at: index)
        } else {
            draft!.composer.hiddenPages.append(key)
        }
    }

    /// Przeciągnięcie w spisie stron.
    func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        guard canEdit, draft != nil else { return }
        var keys = pageRows.map(\.key)
        keys.move(fromOffsets: source, toOffset: destination)
        draft!.composer.pageOrder = keys
    }

    /// „Przenieś wyżej / niżej” (menu strony).
    func move(_ key: String, by delta: Int) {
        guard canEdit, draft != nil else { return }
        var keys = pageRows.map(\.key)
        guard let from = keys.firstIndex(of: key) else { return }
        let target = from + delta
        guard target >= 0, target < keys.count else { return }
        keys.remove(at: from)
        keys.insert(key, at: target)
        draft!.composer.pageOrder = keys
    }

    // MARK: Zdjęcia

    /// Biblioteka zdjęć jak `decorationAssets` w CRM (katalog, oferty, portfolio, hotel, zdjęcia tej broszury).
    var assets: [BrochureAsset] {
        guard let data, let draft else { return [] }
        let items = draft.items.compactMap { item -> BrochureAsset? in
            guard let path = item.customImagePath, !path.isEmpty else { return nil }
            return BrochureAsset(key: BrochureAsset.key("offer-product-pages", path), label: "Broszura: \(item.title)", path: path, bucket: "offer-product-pages")
        }
        let pages = draft.pageInfos.filter { !$0.imagePath.isEmpty }.map { page in
            BrochureAsset(key: BrochureAsset.key(page.imageBucket, page.imagePath), label: "Broszura: \(page.slogan.isEmpty ? "grafika" : page.slogan)",
                          path: page.imagePath, bucket: page.imageBucket)
        }
        var cover: [BrochureAsset] = []
        if !draft.composer.coverImagePath.isEmpty {
            cover = [BrochureAsset(key: BrochureAsset.key(draft.composer.coverImageBucket, draft.composer.coverImagePath), label: "Okładka broszury",
                                   path: draft.composer.coverImagePath, bucket: draft.composer.coverImageBucket)]
        }
        return BrochureAsset.merge([data.library, hotelAssets, items, pages, cover])
    }

    /// Okładka: wybór z biblioteki zastępuje dawne pole zdjęcia okładki (jak w CRM).
    func setCover(path: String, bucket: String) {
        guard canEdit, draft != nil else { return }
        draft!.coverImagePath = nil
        draft!.composer.coverImagePath = path
        draft!.composer.coverImageBucket = bucket
    }

    private var neededAssets: [(bucket: String, path: String)] {
        guard let draft else { return [] }
        var list = draft.items.map { item in (bucket: "offer-product-pages", path: item.imagePath) }
        list += draft.pageInfos.map { page in (bucket: page.imageBucket, path: page.imagePath) }
        let coverPath = draft.composer.coverImagePath.isEmpty ? (draft.coverImagePath ?? "") : draft.composer.coverImagePath
        let coverBucket = draft.composer.coverImagePath.isEmpty ? "offer-product-pages" : draft.composer.coverImageBucket
        list.append((bucket: coverBucket, path: coverPath))
        return list.filter { entry in !entry.path.isEmpty }
    }

    /// Podpisane adresy brakujących miniatur (strony broszury albo cała biblioteka w oknie wyboru zdjęcia).
    func sign(_ entries: [(bucket: String, path: String)]) async {
        let missing = entries.filter { entry in
            let key = BrochureAsset.key(entry.bucket, entry.path)
            return !entry.path.isEmpty && imageUrls[key] == nil && !signing.contains(key)
        }
        guard !missing.isEmpty else { return }
        for entry in missing { signing.insert(BrochureAsset.key(entry.bucket, entry.path)) }
        var offset = 0
        while offset < missing.count {
            let chunk = Array(missing[offset..<min(offset + 200, missing.count)])
            let urls = await store.imageUrls(chunk)
            imageUrls.merge(urls) { _, new in new }
            offset += 200
        }
        for entry in missing { signing.remove(BrochureAsset.key(entry.bucket, entry.path)) }
    }

    func upload(_ url: URL) async -> (path: String, bucket: String)? {
        guard canEdit else { return nil }
        let scoped = url.startAccessingSecurityScopedResource()
        let encoded = BrochureImageEncoder.encode(url)
        if scoped { url.stopAccessingSecurityScopedResource() }
        guard let encoded else {
            workspace?.error = "Nie można odczytać tego obrazu. Wybierz JPG, PNG lub WebP do 10 MB."
            return nil
        }
        busy = "upload"
        defer { busy = nil }
        guard let result = await store.upload(id, data: encoded) else { return nil }
        if let address = result.url { imageUrls[BrochureAsset.key(result.bucket, result.path)] = address }
        return (result.path, result.bucket)
    }

    // MARK: Podgląd i autozapis

    /// Po każdej zmianie: autozapis, podgląd (z opóźnieniem jak przy pisaniu), podpisy nowych zdjęć, biblioteka hotelu
    /// i nieaktualny raport sprawdzania.
    func draftChanged(immediate: Bool = false) {
        guard let draft else { return }
        if !immediate {
            guard draft != lastDraft else { return }
            issuesStale = true
            scheduleAutosave()
        }
        lastDraft = draft
        let needed = neededAssets
        Task { await sign(needed) }
        let key = "\(draft.organizationId ?? "")|\(draft.myCompanyId)"
        if key != hotelKey {
            hotelKey = key
            Task {
                let result = await store.hotelAssets(organization: draft.organizationId, company: draft.myCompanyId)
                hotelAssets = result.assets
                assetNotice = result.notice
            }
        }
        previewTask?.cancel()
        var body = draft.payload
        body["op"] = .string("preview")
        body["id"] = .string(id)
        body["background"] = .string(background)
        previewTask = Task { [weak self] in
            if !immediate { try? await Task.sleep(for: .milliseconds(700)) }
            guard let self, !Task.isCancelled else { return }
            self.previewLoading = true
            do {
                let result = try await self.store.preview(body)
                guard !Task.isCancelled else { return }
                self.previewHtml = result.html
                self.previewPages = result.pages
                self.previewError = nil
            } catch {
                if !Task.isCancelled { self.previewError = self.store.failureText(error, "Nie udało się przygotować podglądu.") }
            }
            if !Task.isCancelled { self.previewLoading = false }
        }
        refreshCanvas(immediate: immediate)
    }

    /// Podgląd wybranej strony graficznej do płótna (po zmianie strony od razu, po edycji z krótkim opóźnieniem).
    func refreshCanvas(immediate: Bool = false) {
        canvasTask?.cancel()
        guard let draft, let raw = selectedPageRaw, raw["design"] != nil else { return }
        let key = selectedPage
        if key != canvasKey { canvasHtml = "" }
        let body: [String: JSONValue] = [
            "op": .string("pagePreview"), "id": .string(id), "page": .object(raw), "composer": draft.composer.json,
            "myCompanyId": .string(draft.myCompanyId), "organizationId": draft.organizationId.map { JSONValue.string($0) } ?? .null,
        ]
        canvasTask = Task { [weak self] in
            if !immediate { try? await Task.sleep(for: .milliseconds(350)) }
            guard let self, !Task.isCancelled else { return }
            guard let html = try? await self.store.pagePreview(body), !Task.isCancelled else { return }
            self.canvasHtml = html
            self.canvasKey = key
        }
    }

    /// Zapis w tle ok. 1,5 s po ostatniej zmianie — także po wyjściu z edytora (model żyje do końca zapisu).
    private func scheduleAutosave() {
        autosaveTask?.cancel()
        guard data?.canManage == true else { return }
        autosaveTask = Task {
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled else { return }
            if busy != nil {
                scheduleAutosave()
                return
            }
            await save(.auto)
        }
    }

    /// Wyjście z edytora: niezapisane zmiany od razu do zapisu w tle.
    func flush() {
        autosaveTask?.cancel()
        guard dirty else { return }
        Task { await save(.auto) }
    }

    /// Zapis szkicu. Pisanie nie jest blokowane: po odpowiedzi serwera szkic zostaje, a zapisana wersja to wysłany stan.
    @discardableResult
    func save(_ mode: SaveMode = .manual) async -> Bool {
        if let running = saveTask { _ = await running.value }
        guard let draft, data?.canManage == true else { return false }
        guard draft != saved else { return true }
        if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            saveBlocked = "Uzupełnij nazwę broszury (Ustawienia broszury) i tytuł okładki (Okładka), aby zapisać zmiany."
            if mode != .auto { workspace?.error = "Uzupełnij nazwę broszury i tytuł okładki." }
            return false
        }
        saveBlocked = nil
        autosaveTask?.cancel()
        let sent = draft
        var body = sent.payload
        body["op"] = .string("save")
        body["id"] = .string(id)
        body["quiet"] = .bool(true)
        let task = Task { () -> Bool in
            saving = true
            defer { saving = false }
            guard let next = await store.editorAction(body, pending: nil) else {
                saveFailed = true
                return false
            }
            data = next
            saved = sent
            saveFailed = false
            return true
        }
        saveTask = task
        let ok = await task.value
        saveTask = nil
        if ok && mode == .manual { workspace?.succeed("Zapisano broszurę") }
        return ok
    }

    // MARK: Usługi

    /// Jak w CRM: najpierw zapis bieżących zmian, potem dodanie usługi lub wariantu przed zakończeniem; nowa strona jest wybrana.
    func add(product: BrochureEditorData.Product, variant: BrochureEditorData.Variant?) async {
        guard canEdit, await save(.quiet) else { return }
        busy = "add"
        defer { busy = nil }
        let before = Set(draft?.items.map(\.id) ?? [])
        var body: [String: JSONValue] = ["op": .string("itemAdd"), "id": .string(id), "productId": .string(product.id)]
        if let variant { body["variantId"] = .string(variant.id) }
        if let next = await store.editorAction(body, pending: "Dodawanie usługi…") {
            apply(next)
            if let added = next.items.first(where: { !before.contains($0.id) }) { selectedPage = "product:" + added.id }
        }
    }

    func remove(_ item: BrochureItem) async {
        guard canEdit, await save(.quiet) else { return }
        busy = "remove"
        defer { busy = nil }
        let body: [String: JSONValue] = ["op": .string("itemRemove"), "id": .string(id), "itemId": .string(item.id)]
        if let next = await store.editorAction(body, pending: "Usuwanie usługi…") { apply(next) }
    }

    /// „Przywróć całą stronę z katalogu” — wszystkie pola strony usługi znów dziedziczą katalog.
    func restoreCatalog() {
        updateSelectedItem { item in
            item.customTitle = nil
            item.customShort = nil
            item.customDescription = nil
            item.customBenefits = nil
            item.customImagePath = nil
        }
    }

    // MARK: Sprawdzanie i PDF

    func issues(for key: String) -> [BrochureIssue] { (issues ?? []).filter { $0.pageKey == key } }

    /// Spis stron do raportu (`brochurePageReferences`): numery widocznych stron i ich tytuły.
    private func references(_ draft: BrochureDraft) -> [(key: String, number: Int, title: String)] {
        let visibleItems = draft.items.filter(\.visible)
        var titles = ["cover": "Okładka", "intro": "Wprowadzenie", "closing": "Kontakt i następny krok"]
        for item in visibleItems { titles["product:" + item.id] = item.title }
        for page in draft.pageInfos { titles["decorative:" + page.id] = page.slogan.isEmpty ? "Gotowa grafika" : page.slogan }
        return visibleKeys(draft).enumerated().map { entry in
            (key: entry.element, number: entry.offset + 1, title: titles[entry.element] ?? "Strona broszury")
        }
    }

    /// Treść stron graficznych przed zapisem (`validateBrochureContent`): tytuł, wymagane zdjęcie, punkty i adres przycisku.
    private func contentIssues(_ draft: BrochureDraft) -> [BrochureIssue] {
        let refs = references(draft)
        var result: [BrochureIssue] = []
        for raw in draft.pages {
            let fields = raw.object
            let page = BrochurePageInfo(raw: fields)
            guard page.visible, let reference = refs.first(where: { $0.key == "decorative:" + page.id }) else { continue }
            var problems: [(field: String, element: String, message: String)] = []
            if page.layout != "artwork" && page.slogan.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                problems.append((field: "slogan", element: "Tytuł strony", message: "Uzupełnij tytuł strony."))
            }
            if BrochureLayouts.requiresImage.contains(page.layout) && page.imagePath.trimmingCharacters(in: .whitespaces).isEmpty {
                problems.append((field: "imagePath", element: "Zdjęcie strony", message: "Nie wybrano zdjęcia wymaganego w tym układzie."))
            }
            let points = (fields["points"]?.array ?? []).map(\.text)
            if ["features", "features-photo", "process", "timeline", "showcase"].contains(page.layout)
                && !points.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                problems.append((field: "points", element: "Kafelki / punkty", message: "Dodaj przynajmniej jeden punkt."))
            }
            let link = fields["linkUrl"]?.text ?? ""
            if !link.isEmpty && !Self.validLink(link) {
                problems.append((field: "linkUrl", element: "Adres przycisku", message: "Wpisz pełny adres przycisku, zaczynający się od https:// lub http://."))
            }
            for problem in problems {
                result.append(BrochureIssue(
                    id: "\(reference.key):\(problem.field)", pageKey: reference.key, pageNumber: reference.number, pageTitle: reference.title,
                    field: problem.field, element: problem.element, fileName: nil, companyId: nil, reason: "content", message: problem.message,
                    remedy: problem.field == "imagePath"
                        ? "Wybierz zdjęcie z biblioteki lub wgraj własny plik. Możesz też zmienić układ strony na układ bez zdjęcia."
                        : "Popraw wskazane pole w Studio stron, zapisz broszurę i sprawdź ją ponownie."))
            }
        }
        return result
    }

    static func validLink(_ value: String) -> Bool {
        guard value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let url = URL(string: value.replacingOccurrences(of: "{{broszura}}", with: "brochure")),
              let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), let host = url.host, !host.isEmpty else { return false }
        return true
    }

    static func validEmail(_ value: String) -> Bool {
        value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    /// Raport z problemami: pierwsza strona do poprawy zostaje wybrana w spisie stron.
    private func show(_ found: [BrochureIssue]) {
        issues = found
        issuesStale = false
        if let first = found.first(where: { issue in pageRows.contains(where: { $0.key == issue.pageKey }) }) { selectedPage = first.pageKey }
    }

    /// „Sprawdź broszurę” (`validateOnly`) albo „Generuj PDF” — ogólny lub przypisany do klienta, bez wysyłki wiadomości.
    /// Zwraca wynik generatora; przy problemach raport trafia na strony w spisie stron.
    @discardableResult
    func generate(validateOnly: Bool) async -> BrochurePdfResult? {
        guard let draft, canGenerate, let workspace else { return nil }
        let email = recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty && !Self.validEmail(email) {
            workspace.error = "Wpisz prawidłowy e-mail odbiorcy lub pozostaw pole puste."
            return nil
        }
        validationError = nil
        let content = contentIssues(draft)
        if !content.isEmpty {
            show(content)
            workspace.error = "Uzupełnij wskazane pola. Strony do poprawy są oznaczone w spisie stron."
            return nil
        }
        if dirty { guard await save(.quiet) else { return nil } }
        busy = validateOnly ? "validate" : "pdf"
        defer { busy = nil }
        let body: [String: JSONValue] = [
            "brochureId": .string(id), "recipientEmail": .string(email), "recipient": recipient?.json ?? .null, "validateOnly": .bool(validateOnly),
        ]
        do {
            let result = try await workspace.withPending(validateOnly ? "Sprawdzanie broszury…" : "Generowanie PDF…") {
                try await store.generatePdf(body, fallback: "Nie udało się sprawdzić broszury.")
            }
            if !validateOnly, let next = try? await store.editor(id) { apply(next) }
            issues = []
            issuesStale = false
            if validateOnly { workspace.succeed("Sprawdzono obrazy, czcionki i układ. Broszura jest gotowa do PDF.") }
            return result
        } catch let failure as BrochureValidationFailure {
            show(failure.issues)
            workspace.error = "Nie utworzono PDF. Strony do poprawy są oznaczone w spisie stron."
        } catch {
            let message = store.failureText(error, "Nie udało się sprawdzić broszury. Spróbuj ponownie.")
            validationError = message
            issuesStale = true
            workspace.error = message
        }
        return nil
    }

    func openGenerated(_ result: BrochurePdfResult) async {
        guard let workspace, let url = result.downloadURL else { return }
        do {
            let data = try await workspace.withPending("Otwieranie PDF…") { try await BrochuresStore.download(url) }
            showPdf(OfferPdfPreview(data: data, name: result.fileName))
        } catch {
            workspace.error = store.failureText(error, "Nie udało się otworzyć PDF. Spróbuj ponownie.")
        }
    }

    func openOwnPdf() async {
        if let file = await store.ownPdf(id) { showPdf(file) }
    }

    /// „Utwórz szkic kampanii” z aktualnej ogólnej wersji PDF; kampania otwiera się w CRM.
    func createCampaign() async {
        guard let data, let workspace, data.canManage, data.canViewResults, busy == nil else { return }
        if recipient != nil || !recipientEmail.trimmingCharacters(in: .whitespaces).isEmpty {
            workspace.error = "Do kampanii wybierz wersję ogólną: bez powiązanego klienta i bez e-maila odbiorcy (Generuj PDF → Wersja ogólna)."
            return
        }
        if !data.brochure.hasPdf || data.brochure.modified || dirty {
            workspace.error = "Przed utworzeniem kampanii wygeneruj aktualną ogólną wersję PDF."
            return
        }
        busy = "campaign"
        defer { busy = nil }
        do {
            let campaign = try await workspace.withPending("Przygotowywanie kampanii…") { try await store.campaign(id) }
            if campaign.sellerDemo {
                let body: [String: JSONValue] = ["brochureId": .string(id), "campaignId": .string(campaign.id)]
                do {
                    _ = try await workspace.withPending("Przygotowywanie PDF kampanii…") {
                        try await store.generatePdf(body, fallback: "Nie udało się przygotować PDF kampanii.")
                    }
                    workspace.succeed("Utworzono szkic kampanii. Otwieram kampanię w CRM.")
                } catch {
                    workspace.error = "Szkic kampanii powstał. Przygotuj jej PDF przyciskiem w kampanii — generowanie nie zostało zakończone."
                }
            } else {
                workspace.succeed("Utworzono szkic kampanii. Otwieram kampanię w CRM.")
            }
            workspace.openCRM("/crm/campaigns?campaign=\(campaign.id)")
        } catch {
            workspace.error = store.failureText(error, "Nie udało się przygotować kampanii")
        }
    }
}
