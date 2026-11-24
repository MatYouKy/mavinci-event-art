import AppKit
import Foundation

// MARK: Produkty — katalog oferty (`/crm/offers?tab=catalog`) i karta produktu (`/crm/offers/products/[id]`): kopia katalogu
// na dysku, synchronizacja, karta z gotowością do oferty i zapis sekcji (`/bridge/native/v1/products`, `src/lib/native/products.ts`).

struct ProductCategory: Codable, Hashable, Identifiable {
    var id: String
    var name: String
}

struct ProductReadinessGroup: Codable, Hashable {
    var key: String
    var label: String
    var short: String
    var ok: Bool
}

struct ProductListItem: Codable, Identifiable, Hashable {
    struct Readiness: Codable, Hashable {
        var ready: Bool
        var summary: String
        var groups: [ProductReadinessGroup]
    }
    var id: String
    var name: String
    var categoryId: String?
    /// Kategoria główna i dodatkowe (starszy serwer — brak, wtedy sama główna).
    var categoryIds: [String]?
    var category: String?
    var active: Bool
    var order: Double
    var priceNet: Double
    var priceGross: Double
    var fromVariant: Bool
    var margin: Double?
    var unit: String
    var description: String
    var tags: [String]
    var imagePath: String?
    var imageUrl: String?
    var personnel: Bool
    var subcontractor: Bool
    var packages: Int
    var variants: Int
    var updatedAt: String?
    var readiness: Readiness

    var categoryText: String { category ?? "Bez kategorii" }
    /// Czy produkt należy do kategorii (główna albo dodatkowa).
    func inCategory(_ id: String) -> Bool { (categoryIds ?? [categoryId].compactMap { $0 }).contains(id) }
    var sortCategory: String { category ?? "" }
    var sortMargin: Double { margin ?? -1_000_000 }
    var sortReadiness: String { (readiness.ready ? "0" : "1") + readiness.summary }
    var activeText: String { active ? "Aktywny" : "Nieaktywny" }
    /// „3 wariantów” albo jednostka (jak kafelek katalogu w CRM).
    var unitText: String { variants > 0 ? "\(variants) wariantów" : (unit.isEmpty ? "szt." : unit) }
    var searchText: String { ([name, description] + tags).joined(separator: " ") }
}

struct ProductsState: Codable {
    var hash: String
    var canView: Bool
    var canEdit: Bool
    var isAdmin: Bool
    var categories: [ProductCategory]
    var products: [ProductListItem]
    var syncedAt: Date?
}

/// Usługa lub sprzęt do wynajęcia z katalogu podwykonawcy (wybór w sekcji „Podwykonawca”).
struct ProductSupplierService: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var type: String
    var unit: String?
    var settlementMethod: String?
    var priceNet: Double?
    var priceGross: Double?
    var unitPrice: Double?
    var vatRate: Double?
    var economicCost: Double?
    var dailyPriceNet: Double?
    var dailyPriceGross: Double?
    var rentalPricePerDay: Double?

    var isEquipment: Bool { type == "equipment" }
    /// „[USŁUGA] Nazwa - 100 zł / h · koszt firmy …” jak lista w CRM.
    var label: String {
        let price = isEquipment ? rentalPricePerDay : unitPrice
        let unitName = isEquipment ? "dzień" : (unit?.isEmpty == false ? unit! : "szt")
        var text = "\(isEquipment ? "[WYNAJEM]" : "[USŁUGA]") \(name) - \(ProductText.number(price ?? 0)) zł / \(unitName)"
        if !isEquipment && settlementMethod == "cash_non_deductible" {
            text += " · koszt firmy \(ProductText.number(economicCost ?? price ?? 0)) zł"
        }
        return text
    }
}

/// Karta produktu z serwera: pola produktu (słownik kolumn `offer_products`), gotowość do oferty i słowniki do edycji.
struct ProductDetail: Codable {
    struct Facts: Codable {
        var variants: Int
        var packages: Int
        var packageNames: [String]
        var addons: Int
        var stage: Bool
        var compactBlockReason: String?
        var individualExtensionRates: Bool
        var staffCostNet: Double?
    }
    struct Exemption: Codable, Hashable {
        var reason: String
        var at: String?
    }
    struct Check: Codable, Hashable, Identifiable {
        var key: String
        var label: String
        var state: String
        var anchor: String
        var detail: String
        var exemptionKey: String?
        var exemption: Exemption?
        var id: String { key }
    }
    struct Group: Codable, Hashable, Identifiable {
        var key: String
        var label: String
        var short: String
        var ok: Bool
        var checks: [Check]
        var id: String { key }
    }
    struct Readiness: Codable {
        var ready: Bool
        var summary: String
        var resourcesChecked: Bool
        var groups: [Group]
        var missing: [Check] { groups.flatMap(\.checks).filter { $0.state == "missing" } }
    }
    var canView: Bool
    var canEdit: Bool
    var product: [String: JSONValue]
    var imageUrl: String?
    /// Zdjęcie wybrane z Dysku: plik, miejsce i wersja (starszy serwer albo zdjęcie z komputera — brak).
    var imageSource: ProductImageSource?
    var facts: Facts
    var readiness: Readiness
    var categories: [ProductCategory]
    var subcontractors: [ProductCategory]
    var services: [ProductSupplierService]

    var id: String { ProductValue.text(product, "id") }
    var name: String { ProductValue.text(product, "name") }
    var active: Bool { product["is_active"].map { $0 != .bool(false) } ?? true }
    var packagePricing: Bool { facts.packages > 0 }
    var categoryName: String? {
        let id = ProductValue.text(product, "category_id")
        return categories.first { $0.id == id }?.name
    }
}

/// Zdjęcie produktu z Dysku (`src/lib/CRM/Offers/productImageSource.ts`): oryginał zostaje w Dysku, produkt ma lekką wersję WebP;
/// `version` — wersja treści pliku użyta w produkcie, `currentVersion` — bieżąca w Dysku (większa — w Dysku podmieniono zdjęcie).
struct ProductImageSource: Codable, Hashable {
    var fileId: String
    var version: Int
    var currentVersion: Int?
    var name: String
    var place: String
    var missing: Bool

    /// „Z Dysku: Mavinci / Zdjęcia / … / plik.jpg” (jak `productImageSourceText`).
    var text: String {
        if missing { return "Z Dysku — pliku już nie ma w Dysku albo nie masz do niego dostępu (zdjęcie produktu zostaje)." }
        return "Z Dysku: " + [place, name].filter { !$0.isEmpty }.joined(separator: " / ")
    }

    /// W Dysku podmieniono treść pliku po wybraniu zdjęcia do produktu.
    var outdated: Bool { !missing && (currentVersion ?? 0) > version }
}

/// Odczyt pól produktu ze słownika kolumn (liczby z bazy mogą przyjść jako tekst).
enum ProductValue {
    static func text(_ fields: [String: JSONValue], _ key: String) -> String {
        switch fields[key] {
        case .string(let value)?: return value
        case .number(let value)?: return ProductText.plain(value)
        default: return ""
        }
    }
    static func number(_ fields: [String: JSONValue], _ key: String) -> Double? {
        switch fields[key] {
        case .number(let value)?: return value
        case .string(let value)?: return Double(value.replacingOccurrences(of: ",", with: "."))
        default: return nil
        }
    }
    static func flag(_ fields: [String: JSONValue], _ key: String) -> Bool {
        if case .bool(let value)? = fields[key] { return value }
        return false
    }
    static func list(_ fields: [String: JSONValue], _ key: String) -> [String] {
        guard case .array(let items)? = fields[key] else { return [] }
        return items.compactMap { item in
            if case .string(let value) = item { return value }
            return nil
        }
    }
}

enum ProductText {
    private static let decimal: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter
    }()
    private static let fixed: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()
    /// „1 234,5” (jak `toLocaleString('pl-PL')`).
    static func number(_ value: Double) -> String { decimal.string(from: NSNumber(value: value)) ?? String(value) }
    /// „1 234,50 zł” (jak `formatMoney` w katalogu CRM).
    static func money(_ value: Double) -> String { (fixed.string(from: NSNumber(value: value)) ?? String(value)) + " zł" }
    private static func few(_ count: Int) -> Bool { (2...4).contains(count % 10) && !(12...14).contains(count % 100) }
    /// „1 zdjęcie”, „3 zdjęcia”, „5 zdjęć” (jak `photosText` w CRM).
    static func photos(_ count: Int) -> String { count == 1 ? "1 zdjęcie" : few(count) ? "\(count) zdjęcia" : "\(count) zdjęć" }
    /// Opis „Duplikuj” w potwierdzeniu (jak `PRODUCT_DUPLICATE_NOTE` w CRM).
    static let duplicateNote = "Powstanie nowy produkt z kopią całej karty: warianty, pakiety, dodatki, wymagania, klauzule, sprzęt, obsada, "
        + "Mavinci LIVE, przygotowanie, ceny w cennikach sezonów, zdjęcia z kadrami i teksty EN. Kopia będzie nieaktywna — włącz „Produkt "
        + "aktywny”, gdy będzie gotowa. Ceny sprzedawców nie są kopiowane."
    /// „Nazwa (kopia)”.
    static func duplicateName(_ name: String) -> String { String((name.trimmingCharacters(in: .whitespacesAndNewlines) + " (kopia)").prefix(300)) }
    /// „jest 1 zdjęcie”, „są 3 zdjęcia”, „jest 5 zdjęć”.
    static func photosCount(_ count: Int) -> String { (count != 1 && few(count) ? "są " : "jest ") + photos(count) }
    private static let editable: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 4
        return formatter
    }()
    /// Liczba do pola edycji: bez zbędnych zer i separatora tysięcy, przecinek dziesiętny.
    static func plain(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 { return String(Int64(value)) }
        return editable.string(from: NSNumber(value: value)) ?? String(value).replacingOccurrences(of: ".", with: ",")
    }
    /// Odczyt liczby wpisanej po polsku („1 234,5”) albo z kropką; `nil` — pole puste lub błędne.
    static func parse(_ text: String) -> Double? {
        let cleaned = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{a0}", with: "")
            .replacingOccurrences(of: "\u{202f}", with: "").replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }
    static func margin(_ value: Double?) -> String { value.map { "\(Int($0.rounded()))%" } ?? "—" }
    static let marginUnknown = "Brak kosztu produktu — uzupełnij koszt, aby policzyć marżę."
    /// „1 brak”, „3 braki”, „5 braków”.
    static func missing(_ count: Int) -> String {
        if count == 1 { return "1 brak" }
        let few = [2, 3, 4].contains(count % 10) && ![12, 13, 14].contains(count % 100)
        return "\(count) \(few ? "braki" : "braków")"
    }
    static let quantitySources: [(key: String, label: String)] = [
        ("manual", "Ilość wpisywana ręcznie"), ("guests", "Liczba osób z oferty"), ("tables", "Liczba stołów z oferty"),
    ]
}

/// Zdjęcia produktów: podpisane adresy zmieniają się przy każdej synchronizacji, więc pamięć podręczna jest po ścieżce w magazynie.
@MainActor final class ProductImageCache {
    static let shared = ProductImageCache()
    private var images: [String: NSImage] = [:]
    private var loading: [String: Task<NSImage?, Never>] = [:]

    func cached(_ path: String?) -> NSImage? { path.flatMap { images[$0] } }

    func image(path: String, url: String) async -> NSImage? {
        if let image = images[path] { return image }
        if let task = loading[path] { return await task.value }
        let task = Task<NSImage?, Never> {
            guard let address = URL(string: url),
                  let result = try? await URLSession.shared.data(from: address),
                  (result.1 as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { return nil }
            return NSImage(data: result.0)
        }
        loading[path] = task
        let image = await task.value
        loading[path] = nil
        if let image { images[path] = image }
        return image
    }

    /// Zdjęcie właśnie wysłane z Maca — bez ponownego pobierania.
    func store(_ image: NSImage, path: String) { images[path] = image }
}

@MainActor final class ProductsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: ProductsState?
    @Published var syncing = false
    @Published var loadError: String?
    @Published var selectedID: String?
    /// Karta produktu otwarta na ekranie katalogu (zamiast listy).
    @Published var openedID: String?
    @Published private(set) var details: [String: ProductDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    /// Sprzęt, obsada, Mavinci LIVE i klauzule karty (część B) w wybranym zakresie: produkt bazowy albo wariant.
    @Published var resources: [String: ProductResources] = [:]
    @Published var resourceErrors: [String: String] = [:]
    /// Wybrany zakres konfiguracji na karcie: identyfikator wariantu albo brak (produkt bazowy).
    @Published var scopes: [String: String] = [:]
    /// Katalog sprzętu i zestawów do wyboru (pobierany przy pierwszym „Dodaj sprzęt”).
    @Published var equipmentCatalog: [ProductCatalogEquipment]?
    /// Warianty, przygotowanie, wymagania, powiązane usługi i dodatki karty (część C1).
    @Published var extras: [String: ProductExtras] = [:]
    @Published var extrasErrors: [String: String] = [:]
    /// Teksty wersji angielskiej karty (część C2b) i liczba trwających tłumaczeń produktu (także w tle po zapisie).
    @Published var english: [String: ProductEnglishDocument] = [:]
    @Published var englishErrors: [String: String] = [:]
    @Published var englishBusy: [String: Int] = [:]
    /// Zdjęcia produktów, wariantów i pakietów jeszcze w JPG/PNG, postęp zamiany na WebP i zdjęcia, których nie udało się zamienić
    /// (pasek w katalogu, jak `ProductImagesWebpBanner` w CRM).
    @Published var imagesPending = 0
    @Published var imagesProgress: ImagesProgress?
    @Published var imagesProblems: [ImageConversionProblem] = []

    struct ImagesProgress: Equatable { var done: Int; var total: Int }
    struct ImageConversionProblem: Decodable, Hashable { let key: String; let label: String; let error: String }

    private var namespace: String?
    private var file: SealedFile<ProductsState>?
    private var syncTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var products: [ProductListItem] { state?.products ?? [] }
    var categories: [ProductCategory] { state?.categories ?? [] }
    var loaded: Bool { state != nil }
    var canEdit: Bool { state?.canEdit ?? false }
    func product(_ id: String?) -> ProductListItem? { id.flatMap { id in products.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<ProductsState>(namespace: "products-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if state == nil, let saved { state = saved }
        }
    }

    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); syncTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; state = nil; syncing = false; loadError = nil
        selectedID = nil; openedID = nil; details = [:]; detailErrors = [:]
        resources = [:]; resourceErrors = [:]; scopes = [:]; equipmentCatalog = nil; extras = [:]; extrasErrors = [:]
        english = [:]; englishErrors = [:]; englishBusy = [:]
        imagesPending = 0; imagesProgress = nil; imagesProblems = []
    }

    // MARK: Synchronizacja
    func sync(force: Bool = false) async {
        if let syncTask {
            await syncTask.value
            if !force { return }
        }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }

    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        await sync()
    }

    private func performSync() async {
        guard let api else { return }
        syncing = true
        defer { syncing = false }
        do {
            var next = try JSONDecoder().decode(ProductsState.self, from: try await api.get("/products?op=state"))
            next.syncedAt = Date()
            if state?.hash != next.hash {
                state = next
            } else if var current = state {
                // Te same dane — tylko świeże podpisane adresy miniatur.
                current.products = next.products
                current.syncedAt = next.syncedAt
                state = current
            }
            loadError = nil
            if let file, let snapshot = state {
                await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
            }
        } catch {
            if state == nil { loadError = failureText(error, "Nie udało się pobrać produktów.") }
        }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    private func writable(_ text: String) -> (NativeAPI, Workspace)? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = text
            return nil
        }
        return (api, workspace)
    }

    // MARK: Karta produktu
    func loadDetail(_ id: String) async {
        guard let api else { return }
        do {
            let detail = try JSONDecoder().decode(ProductDetail.self, from: try await api.get("/products?op=product&id=\(id)"))
            details[id] = detail
            detailErrors[id] = nil
        } catch {
            detailErrors[id] = failureText(error, "Nie udało się pobrać produktu.")
        }
    }

    /// Zapis sekcji karty (jak „Zapisz” w sekcji karty produktu w CRM). Zwraca `true` po zapisie; błąd jest w komunikacie okna.
    @discardableResult func saveSection(_ id: String, section: String, patch: [String: JSONValue], success: String = "Zapisano sekcję produktu") async -> Bool {
        guard case let (api, workspace)? = writable("Zapis wymaga połączenia z serwerem CRM.") else { return false }
        do {
            let body: [String: JSONValue] = ["op": .string("section"), "id": .string(id), "section": .string(section), "patch": .object(patch)]
            let data = try await workspace.withPending("Zapisywanie…") { try await api.post("/products", body) }
            details[id] = try JSONDecoder().decode(ProductDetail.self, from: data)
            workspace.succeed(success)
            Task { await sync(force: true) }
            // Kadry zdjęć nie zmieniają treści — wersja EN zostaje bez zmian.
            if section != "image_crops" { refreshEnglish(id) }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać sekcji.")
            return false
        }
    }

    /// „Nie dotyczy” z powodem albo przywrócenie wymagania (`reason == nil`).
    @discardableResult func setExemption(_ id: String, key: String, reason: String?, success: String) async -> Bool {
        guard case let (api, workspace)? = writable("Zapis wymaga połączenia z serwerem CRM.") else { return false }
        do {
            let body: [String: JSONValue] = ["op": .string("exemption"), "id": .string(id), "key": .string(key),
                                             "reason": reason.map { JSONValue.string($0) } ?? .null]
            let data = try await workspace.withPending("Zapisywanie…") { try await api.post("/products", body) }
            details[id] = try JSONDecoder().decode(ProductDetail.self, from: data)
            workspace.succeed(success)
            Task { await sync(force: true) }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać.")
            return false
        }
    }

    /// Zdjęcie do oferty — wysyłka do magazynu; zwraca ścieżkę (zapis w sekcji `offer_image`) albo `nil`.
    func uploadImage(_ id: String, data: Data) async -> String? {
        guard case let (api, workspace)? = writable("Wysłanie zdjęcia wymaga połączenia z serwerem CRM.") else { return nil }
        struct Reply: Decodable { let path: String }
        do {
            let body: [String: JSONValue] = ["op": .string("image"), "id": .string(id), "data": .string(data.base64EncodedString())]
            let reply = try await workspace.withPending("Wysyłanie zdjęcia…") { try await api.post("/products", body) }
            return try JSONDecoder().decode(Reply.self, from: reply).path
        } catch {
            workspace.error = failureText(error, "Nie udało się wysłać zdjęcia.")
            return nil
        }
    }

    /// Zdjęcie produktu z Dysku: serwer przygotowuje lekką wersję WebP z pliku Materiałów (oryginał zostaje w Dysku) i zwraca jej
    /// ścieżkę — zapis w produkcie przez sekcję `offer_image`, jak przy zdjęciu z komputera.
    func imageFromMaterial(_ id: String, fileID: String) async -> String? {
        guard case let (api, workspace)? = writable("Zdjęcie z Dysku wymaga połączenia z serwerem CRM.") else { return nil }
        struct Reply: Decodable { let path: String }
        do {
            let body: [String: JSONValue] = ["op": .string("imageFromMaterial"), "id": .string(id), "fileId": .string(fileID)]
            let reply = try await workspace.withPending("Przygotowanie zdjęcia z Dysku…") { try await api.post("/products", body, timeout: 150) }
            return try JSONDecoder().decode(Reply.self, from: reply).path
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować zdjęcia z Dysku.")
            return nil
        }
    }

    /// Pełny podgląd zdjęcia z Dysku w oknie zdjęcia (wariant, pakiet) — `nil`, gdy nie udało się go pobrać (zostaje miniatura).
    func materialPreview(_ file: MaterialFile) async -> NSImage? {
        guard let api,
              let data = try? await api.get("/materials", query: ["op": "url", "kind": "material", "id": file.id, "mode": "preview"]),
              let reply = try? JSONDecoder().decode(MaterialUrlReply.self, from: data), let url = URL(string: reply.url),
              let loaded = try? await URLSession.shared.data(from: url) else { return nil }
        return NSImage(data: loaded.0)
    }

    // MARK: Zamiana starszych zdjęć JPG/PNG na WebP (`convertOfferImages` na serwerze)

    func loadImagesPending() async {
        guard let api else { return }
        struct Reply: Decodable { let count: Int; let canEdit: Bool }
        guard let data = try? await api.get("/products?op=imagesPending"),
              let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return }
        imagesPending = reply.canEdit ? reply.count : 0
    }

    /// Zamiana porcjami po 4 zdjęcia (nowy plik WebP obok starego, nowa ścieżka i kadry); zdjęcia z błędem pomijamy w kolejnych
    /// porcjach i pokazujemy pod paskiem. Stare pliki zostają w magazynie (wcześniejsze broszury).
    func convertImages() async {
        guard imagesProgress == nil, imagesPending > 0,
              case let (api, workspace)? = writable("Zamiana zdjęć wymaga połączenia z serwerem CRM.") else { return }
        struct Reply: Decodable { let converted: Int; let failed: [ImageConversionProblem]; let remaining: Int }
        var done = 0
        var total = imagesPending
        var problems: [ImageConversionProblem] = []
        imagesProblems = []
        imagesProgress = ImagesProgress(done: 0, total: total)
        do {
            for _ in 0..<500 {
                let body: [String: JSONValue] = ["op": .string("imagesConvert"), "limit": .number(4), "skip": .array(problems.map { .string($0.key) })]
                let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/products", body, timeout: 170))
                done += reply.converted
                problems += reply.failed
                total = max(total, done + problems.count + reply.remaining)
                imagesProgress = ImagesProgress(done: done, total: total)
                if reply.remaining == 0 || (reply.converted == 0 && reply.failed.isEmpty) { break }
            }
            imagesProblems = problems
            imagesProgress = nil
            workspace.succeed(problems.isEmpty ? "Zamieniono \(ProductText.photos(done)) na WebP"
                              : "Zamieniono \(ProductText.photos(done)) na WebP. Nie udało się zamienić: \(problems.count)")
        } catch {
            imagesProblems = problems
            imagesProgress = nil
            workspace.error = failureText(error, "Nie udało się zamienić zdjęć na WebP.")
        }
        await loadImagesPending()
        await sync(force: true)
    }

    /// Usługi i sprzęt podwykonawcy (organizacja z listy „Podwykonawca”).
    func services(organization: String) async -> [ProductSupplierService] {
        guard let api else { return [] }
        struct Reply: Decodable { let services: [ProductSupplierService] }
        do {
            return try JSONDecoder().decode(Reply.self, from: try await api.get("/products?op=services&organization=\(organization)")).services
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać usług podwykonawcy.")
            return []
        }
    }

    /// Nowy produkt (nazwa i kategoria); resztę uzupełnia się na karcie. Zwraca identyfikator.
    func create(name: String, categoryID: String?) async -> String? {
        guard case let (api, workspace)? = writable("Dodanie produktu wymaga połączenia z serwerem CRM.") else { return nil }
        struct Reply: Decodable { let id: String }
        do {
            var body: [String: JSONValue] = ["op": .string("create"), "name": .string(name)]
            if let categoryID { body["category_id"] = .string(categoryID) }
            let data = try await workspace.withPending("Dodawanie produktu…") { try await api.post("/products", body) }
            let id = try JSONDecoder().decode(Reply.self, from: data).id
            await sync(force: true)
            workspace.succeed("Produkt dodany do katalogu")
            refreshEnglish(id)
            return id
        } catch {
            workspace.error = failureText(error, "Nie udało się dodać produktu.")
            return nil
        }
    }

    /// „Duplikuj” (`src/lib/CRM/Offers/productDuplicate.ts`): nowy, nieaktywny produkt z kopią całej karty — warianty, pakiety,
    /// dodatki, wymagania, klauzule, sprzęt, obsada, Mavinci LIVE, przygotowanie, ceny w cennikach sezonów, zdjęcia z kadrami
    /// i teksty EN. Po kopii otwiera kartę nowego produktu; części pominięte z braku uprawnień są w komunikacie.
    @discardableResult func duplicate(_ id: String) async -> String? {
        guard case let (api, workspace)? = writable("Duplikowanie produktu wymaga połączenia z serwerem CRM.") else { return nil }
        struct Reply: Decodable { let id: String; let name: String; let skipped: [String]; let imagesMissing: Int }
        do {
            let body: [String: JSONValue] = ["op": .string("duplicate"), "id": .string(id)]
            let data = try await workspace.withPending("Duplikowanie produktu…") { try await api.post("/products", body, timeout: 170) }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            await sync(force: true)
            selectedID = reply.id
            openedID = reply.id
            refreshEnglish(reply.id)
            var parts = ["Utworzono „\(reply.name)” — kopia jest nieaktywna. Wprowadź zmiany i włącz „Produkt aktywny”."]
            if !reply.skipped.isEmpty { parts.append("Bez: \(reply.skipped.joined(separator: ", ")) (brak uprawnień).") }
            if reply.imagesMissing > 0 { parts.append("Nie udało się skopiować zdjęć: \(reply.imagesMissing) — dodaj je ponownie.") }
            let text = parts.joined(separator: " ")
            if reply.skipped.isEmpty && reply.imagesMissing == 0 { workspace.succeed(text) } else { workspace.snack = Snack(kind: .info, text: text) }
            return reply.id
        } catch {
            workspace.error = failureText(error, "Nie udało się zduplikować produktu.")
            return nil
        }
    }

    func delete(_ id: String) async -> Bool {
        guard case let (api, workspace)? = writable("Usunięcie wymaga połączenia z serwerem CRM.") else { return false }
        do {
            let body: [String: JSONValue] = ["op": .string("delete"), "id": .string(id)]
            _ = try await workspace.withPending("Usuwanie produktu…") { try await api.post("/products", body) }
            if openedID == id { openedID = nil }
            if selectedID == id { selectedID = nil }
            details[id] = nil
            await sync(force: true)
            workspace.succeed("Produkt został usunięty")
            return true
        } catch {
            workspace.error = failureText(error, "Błąd usuwania produktu")
            return false
        }
    }

    /// Wersja angielska po zmianie treści (w tle, jak w CRM po zapisie sekcji): tłumaczy brakujące i nieaktualne pola.
    func refreshEnglish(_ id: String) {
        guard let api else { return }
        englishBusy[id, default: 0] += 1
        Task {
            if let data = try? await api.post("/products", ["op": .string("english"), "id": .string(id)], timeout: 190),
               let document = try? JSONDecoder().decode(ProductEnglishDocument.self, from: data) {
                english[id] = document
                englishErrors[id] = nil
            }
            englishBusy[id] = max(0, (englishBusy[id] ?? 1) - 1)
        }
    }

    /// „Przetłumacz PL → EN” — z oknem postępu i komunikatem (tłumaczenie trwa do 3 minut).
    func translate(_ id: String) async {
        guard case let (api, workspace)? = writable("Tłumaczenie wymaga połączenia z serwerem CRM.") else { return }
        englishBusy[id, default: 0] += 1
        defer { englishBusy[id] = max(0, (englishBusy[id] ?? 1) - 1) }
        do {
            let data = try await workspace.withPending("Przygotowywanie wersji angielskiej…") {
                try await api.post("/products", ["op": .string("english"), "id": .string(id)], timeout: 190)
            }
            let document = try JSONDecoder().decode(ProductEnglishDocument.self, from: data)
            english[id] = document
            englishErrors[id] = nil
            if document.ready { workspace.succeed("Wersja angielska jest aktualna") }
            else { workspace.error = "Nie wszystkie pola zostały przetłumaczone (\(document.missing.count)). Spróbuj ponownie albo uzupełnij je ręcznie." }
        } catch let failure as URLError where failure.code == .timedOut {
            workspace.error = "Przekroczono czas oczekiwania na odpowiedź. Serwer może nadal kończyć operację. Spróbuj ponownie za chwilę — gotowe tłumaczenia zostaną wykorzystane."
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować wersji angielskiej.")
        }
    }
}
