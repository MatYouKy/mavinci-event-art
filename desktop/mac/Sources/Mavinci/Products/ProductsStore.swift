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
        resources = [:]; resourceErrors = [:]; scopes = [:]; equipmentCatalog = nil
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
            refreshEnglish(id)
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

    /// Wersja angielska po zmianie treści (w tle, jak w CRM po zapisie sekcji).
    func refreshEnglish(_ id: String) {
        guard let api else { return }
        Task {
            _ = try? await api.post("/products", ["op": .string("english"), "id": .string(id)])
        }
    }

    /// „Przetłumacz PL → EN” z nagłówka karty — z oknem postępu i komunikatem.
    func translate(_ id: String) async {
        guard case let (api, workspace)? = writable("Tłumaczenie wymaga połączenia z serwerem CRM.") else { return }
        do {
            _ = try await workspace.withPending("Przygotowywanie wersji angielskiej…") {
                try await api.post("/products", ["op": .string("english"), "id": .string(id)])
            }
            workspace.succeed("Wersja angielska jest aktualna")
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować wersji angielskiej.")
        }
    }
}
