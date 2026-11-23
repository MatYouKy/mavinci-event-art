import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Broszury (`/crm/brochures`), część G1 — lista, edytor, podgląd, sprawdzanie i PDF. Serwer: `src/lib/native/brochures.ts`
// (`/bridge/native/v1/brochures`); PDF i sprawdzanie — `/bridge/brochures/generate-pdf` tokenem pracownika, jak w CRM.

struct BrochureListState: Decodable {
    struct Brochure: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var status: String
        var updatedAt: String
        var pdfVersion: Int
        var modified: Bool
        var title: String
        var audienceType: String
        var organization: String?
        var pageCount: Int
    }
    var canManage: Bool
    var canViewResults: Bool
    var brochures: [Brochure]
}

/// Rekord po zmianie nazwy, archiwizacji lub przywróceniu (`BrochureManagementRecord`).
struct BrochureRecord: Decodable, Equatable {
    var id: String
    var name: String
    var status: String
    var updatedAt: String
    var pdfVersion: Int
    var modified: Bool
}

struct BrochureAudience: Identifiable {
    let key: String
    /// Etykieta na liście („Hotele”).
    let group: String
    /// Etykieta w edytorze („Hotel”).
    let label: String
    var id: String { key }
    static let all: [BrochureAudience] = [
        BrochureAudience(key: "hotel", group: "Hotele", label: "Hotel"),
        BrochureAudience(key: "venue", group: "Sale i obiekty", label: "Sala / obiekt"),
        BrochureAudience(key: "agency", group: "Agencje", label: "Agencja"),
        BrochureAudience(key: "corporate", group: "Klienci biznesowi", label: "Klient biznesowy"),
        BrochureAudience(key: "wedding", group: "Branża weselna", label: "Branża weselna"),
        BrochureAudience(key: "general", group: "Ogólna", label: "Ogólna"),
    ]
    static func group(_ key: String) -> String { all.first(where: { $0.key == key })?.group ?? "Inny odbiorca" }
}

/// Układy stron graficznych (`BROCHURE_LAYOUTS`).
enum BrochureLayouts {
    static let labels: [String: String] = [
        "signature": "Okładka autorska", "photo": "Zdjęcie i hasło", "editorial": "Fotografia w ramce", "statement": "Plansza z hasłem",
        "split": "Zdjęcie obok tekstu", "features": "Korzyści / strefa sprzedawcy", "features-photo": "Zdjęcie nad kafelkami",
        "process": "Etapy współpracy", "artwork": "Gotowa grafika", "showcase": "Zdjęcie i karty usług", "timeline": "Oś czasu",
    ]
    static let requiresImage: Set<String> = ["photo", "editorial", "split", "artwork", "showcase", "signature", "features-photo"]
}

/// Ustawienia kompozycji (`BrochureComposer`) — kolejność i ukryte strony stałe, okładka, kolory.
struct BrochureComposer: Codable, Equatable {
    var pageOrder: [String]
    var hiddenPages: [String]
    var coverImagePath: String
    var coverImageBucket: String
    var brandColor: String
    var accentColor: String
    var coverX: Double
    var coverY: Double
    var coverOverlay: Double

    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .object([:]) }
        return value
    }
}

/// Plik z biblioteki zdjęć broszury (`BrochureImageAsset`); klucz `kontener:ścieżka`.
struct BrochureAsset: Codable, Identifiable, Hashable {
    var key: String
    var label: String
    var path: String
    var bucket: String
    var id: String { key }
    static func key(_ bucket: String, _ path: String) -> String { "\(bucket):\(path)" }
    /// Źródło w bibliotece zdjęć (filtr okna wyboru).
    var group: String {
        if label.hasPrefix("Oferta: ") { return "offer" }
        if label.hasPrefix("Portfolio: ") { return "portfolio" }
        if bucket == "seller-brand-assets" || label.hasPrefix("Hotel: ") { return "hotel" }
        if label.hasPrefix("Broszura: ") || label == "Okładka broszury" || label == "Aktualny plik" { return "brochure" }
        return "service"
    }
    /// Lista bez powtórzeń jak `new Map(...)` w CRM: miejsce pierwszego wystąpienia, opis ostatniego.
    static func merge(_ groups: [[BrochureAsset]]) -> [BrochureAsset] {
        var order: [String] = []
        var values: [String: BrochureAsset] = [:]
        for group in groups {
            for asset in group {
                if values[asset.key] == nil { order.append(asset.key) }
                values[asset.key] = asset
            }
        }
        return order.compactMap { values[$0] }
    }
}

/// Strona usługi z katalogu z personalizacją tylko w tej broszurze; puste pola dziedziczą treść katalogu.
struct BrochureItem: Codable, Identifiable, Equatable {
    struct Base: Codable, Equatable {
        var title: String
        var short: String
        var description: String
        var compactDescription: String
        var benefits: [String]
        var imagePath: String
        var category: String?
    }
    var id: String
    var productId: String
    var variantId: String?
    var displayOrder: Int
    var customTitle: String?
    var customShort: String?
    var customDescription: String?
    var customBenefits: [String]?
    var customImagePath: String?
    var layout: String
    var visible: Bool
    var base: Base

    private static func filled(_ value: String?) -> String? { (value?.isEmpty ?? true) ? nil : value }
    var title: String { Self.filled(customTitle) ?? base.title }
    var short: String { Self.filled(customShort) ?? base.short }
    var description: String { Self.filled(customDescription) ?? (layout == "compact" ? base.compactDescription : base.description) }
    var benefits: [String] {
        (customBenefits ?? base.benefits).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    var imagePath: String { Self.filled(customImagePath) ?? base.imagePath }

    /// Zapis i podgląd: pola edytowalne (puste teksty serwer zapisuje jako dziedziczenie z katalogu).
    var json: JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string(id), "displayOrder": .number(Double(displayOrder)), "layout": .string(layout), "visible": .bool(visible),
        ]
        if let customTitle { fields["customTitle"] = .string(customTitle) }
        if let customShort { fields["customShort"] = .string(customShort) }
        if let customDescription { fields["customDescription"] = .string(customDescription) }
        if let customBenefits { fields["customBenefits"] = .array(customBenefits.map { JSONValue.string($0) }) }
        if let customImagePath { fields["customImagePath"] = .string(customImagePath) }
        return .object(fields)
    }
}

struct BrochureEditorData: Decodable {
    struct Brochure: Decodable {
        var id: String
        var name: String
        var status: String
        var updatedAt: String
        var pdfVersion: Int
        var modified: Bool
        var title: String
        var subtitle: String
        var introduction: String
        var closingText: String
        var audienceType: String
        var organizationId: String?
        var myCompanyId: String
        var contactEmployeeId: String?
        var coverImagePath: String?
        var hasPdf: Bool
        var sellerDemo: Bool
        /// Cennik strony „Cennik” (migracja 20261129130000); `supportsPriceList` — baza ma już tę kolumnę.
        var priceListId: String?
        var supportsPriceList: Bool?
        var composer: BrochureComposer
        var decorativePages: [JSONValue]
    }
    /// Cennik sezonowy do wyboru (bez archiwum).
    struct PriceListOption: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var companyId: String
        var season: String
        var status: String
    }
    struct Variant: Decodable, Identifiable {
        var id: String
        var name: String
        var imagePath: String?
    }
    struct Product: Decodable, Identifiable {
        var id: String
        var name: String
        var category: String?
        var imagePath: String?
        var imageUrl: String?
        var variants: [Variant]
    }
    struct Option: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct Company: Decodable, Identifiable {
        var id: String
        var name: String
        var primaryColor: String
        var secondaryColor: String
    }
    struct OwnPdf: Decodable {
        var version: Int
        var recipient: String
    }
    var canManage: Bool
    var canViewResults: Bool
    var currentEmployeeId: String
    var brochure: Brochure
    var items: [BrochureItem]
    var products: [Product]
    var organizations: [Option]
    var companies: [Company]
    var employees: [Option]
    /// Starszy serwer — brak (wybór cennika ukryty).
    var priceLists: [PriceListOption]?
    var library: [BrochureAsset]
    var studio: BrochureStudio
    var hotelAssets: [BrochureAsset]
    var assetNotice: String
    var ownPdf: OwnPdf?
}

/// Studio stron z serwera (`decorativePages.ts`): układy, ikony, domyślne rozmieszczenie układów i nowe strony.
struct BrochureStudio: Decodable {
    struct Layout: Decodable, Identifiable {
        var key: String
        var label: String
        var requiresImage: Bool
        var id: String { key }
    }
    struct Icon: Decodable, Identifiable {
        var key: String
        var label: String
        var id: String { key }
    }
    struct Preset: Decodable, Identifiable {
        var key: String
        var label: String
        var page: JSONValue
        var id: String { key }
    }
    var layouts: [Layout]
    var icons: [Icon]
    var defaults: [String: BrochurePageDesign]
    var presets: [Preset]
    var maxPages: Int
    /// Motywy w tle i ich położenie (`BROCHURE_ORNAMENTS`, `BROCHURE_ORNAMENT_PLACES`); starszy serwer — lista podstawowa.
    var ornaments: [Icon]?
    var ornamentPlaces: [Icon]?

    var ornamentOptions: [Icon] {
        ornaments ?? [Icon(key: "none", label: "Bez motywu"), Icon(key: "arc", label: "Łuki"), Icon(key: "grid", label: "Siatka punktów")]
    }
    var placeOptions: [Icon] { ornamentPlaces ?? [Icon(key: "top-right", label: "Prawy górny róg")] }

    func label(_ layout: String) -> String { layouts.first(where: { $0.key == layout })?.label ?? layout }
    func requiresImage(_ layout: String) -> Bool { layouts.first(where: { $0.key == layout })?.requiresImage ?? false }
    func design(for layout: String) -> BrochurePageDesign { defaults[layout] ?? defaults["photo"] ?? BrochurePageDesign.fallback }
}

/// Pole na stronie graficznej w procentach strony (`PageRect`).
struct BrochureRect: Codable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    /// Jak `normalizeRect`: szerokość 12–100, wysokość 8–100, pole w granicach strony.
    func normalized() -> BrochureRect {
        let w = min(100, max(12, width)), h = min(100, max(8, height))
        return BrochureRect(x: min(100 - w, max(0, x)), y: min(100 - h, max(0, y)), width: w, height: h)
    }
}

/// Rozmieszczenie i wygląd strony graficznej (`BrochurePageDesign`).
struct BrochurePageDesign: Codable, Equatable {
    var text: BrochureRect
    var image: BrochureRect
    var details: BrochureRect
    var theme: String
    var align: String
    var fontSize: Double
    var imageTint: Double?
    var imageFade: Double?
    var overlay: Double
    var imageFit: String
    var imageX: Double
    var showBrand: Bool
    var ornament: String?
    var ornamentPlace: String? = nil

    static let fallback = BrochurePageDesign(
        text: BrochureRect(x: 10, y: 59, width: 80, height: 29), image: BrochureRect(x: 0, y: 0, width: 100, height: 100),
        details: BrochureRect(x: 10, y: 47, width: 80, height: 41), theme: "dark", align: "left", fontSize: 36, imageTint: nil, imageFade: nil,
        overlay: 62, imageFit: "cover", imageX: 50, showBrand: true, ornament: nil)

    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .object([:]) }
        return value
    }

    /// Zapisany wygląd strony uzupełniony domyślnym dla układu, w zakresach CRM (`pageDesign`).
    static func normalized(_ raw: [String: JSONValue], base: BrochurePageDesign) -> BrochurePageDesign {
        func number(_ value: JSONValue?) -> Double? {
            if case .number(let n) = value ?? .null { return n }
            if case .string(let text) = value ?? .null, let n = Double(text) { return n }
            return nil
        }
        func bounded(_ value: JSONValue?, _ fallback: Double, _ low: Double, _ high: Double) -> Double {
            guard let n = number(value) else { return fallback }
            return min(high, max(low, n))
        }
        func rect(_ value: JSONValue?, _ fallback: BrochureRect) -> BrochureRect {
            let fields = value?.object ?? [:]
            let width = bounded(fields["width"], fallback.width, 12, 100), height = bounded(fields["height"], fallback.height, 8, 100)
            return BrochureRect(x: bounded(fields["x"], fallback.x, 0, 100 - width), y: bounded(fields["y"], fallback.y, 0, 100 - height), width: width, height: height)
        }
        let theme = raw["theme"]?.text ?? ""
        let align = raw["align"]?.text ?? ""
        let fit = raw["imageFit"]?.text ?? ""
        // Motyw i położenie sprawdza serwer (`pageDesign`); tu tylko format klucza — nowy motyw z CRM nie znika po zapisie z Maca.
        let key = { (value: String) -> Bool in value.range(of: "^[a-z-]{1,24}$", options: .regularExpression) != nil }
        let ornament = raw["ornament"]?.text ?? ""
        let place = raw["ornamentPlace"]?.text ?? ""
        var showBrand = base.showBrand
        if case .bool(let flag) = raw["showBrand"] ?? .null { showBrand = flag }
        return BrochurePageDesign(
            text: rect(raw["text"], base.text), image: rect(raw["image"], base.image), details: rect(raw["details"], base.details),
            theme: ["light", "dark"].contains(theme) ? theme : base.theme,
            align: ["left", "center", "right"].contains(align) ? align : base.align,
            fontSize: bounded(raw["fontSize"], base.fontSize, 20, 64),
            imageTint: bounded(raw["imageTint"], base.imageTint ?? 0, 0, 100),
            imageFade: bounded(raw["imageFade"], base.imageFade ?? 0, 0, 100),
            overlay: bounded(raw["overlay"], base.overlay, 0, 90),
            imageFit: ["cover", "contain"].contains(fit) ? fit : base.imageFit,
            imageX: bounded(raw["imageX"], 50, 0, 100),
            showBrand: showBrand,
            ornament: key(ornament) ? ornament : "none",
            ornamentPlace: key(place) ? place : "top-right")
    }
}

/// Strona graficzna (`BrochureDecorativePage`) — odczyt pól; edycja w Studio stron zmienia surowy zapis strony.
struct BrochurePageInfo {
    let raw: [String: JSONValue]
    var id: String { raw["id"]?.text ?? "" }
    var layout: String { raw["layout"]?.text ?? "photo" }
    var slogan: String { raw["slogan"]?.text ?? "" }
    var visible: Bool { raw["isVisible"] != JSONValue.bool(false) }
    var imagePath: String { raw["imagePath"]?.text ?? "" }
    var imageBucket: String { raw["imageBucket"]?.text.isEmpty == false ? raw["imageBucket"]!.text : "offer-product-pages" }
    var afterItemId: String? {
        if case .string(let value) = raw["afterItemId"] ?? .null { return value }
        return nil
    }
}

/// Kolejność stron jak `composeBrochureContent` i `orderedBrochureKeys` w CRM.
enum BrochureComposition {
    struct Page {
        let id: String
        let afterItemId: String?
        let visible: Bool
    }

    static func content(itemIDs: [String], pages: [Page]) -> [String] {
        let ids = Set(itemIDs)
        var groups: [String: [String]] = [:]
        for page in pages where page.visible {
            var anchor = ""
            if let after = page.afterItemId { anchor = ids.contains(after) ? after : (itemIDs.last ?? "") }
            groups[anchor, default: []].append("decorative:" + page.id)
        }
        var keys = groups[""] ?? []
        for id in itemIDs {
            keys.append("product:" + id)
            keys += groups[id] ?? []
        }
        return keys
    }

    static func ordered(itemIDs: [String], pages: [Page], order: [String]) -> [String] {
        let keys = ["cover", "intro"] + content(itemIDs: itemIDs, pages: pages) + ["closing"]
        let available = Set(keys)
        var requested: [String] = []
        for key in order where available.contains(key) && !requested.contains(key) { requested.append(key) }
        if requested.isEmpty { return keys }
        // Nowe strony trafiają przed zakończenie bez zmiany ułożonej kompozycji.
        let missing = keys.filter { !requested.contains($0) }
        let closing = requested.firstIndex(of: "closing") ?? requested.count
        requested.insert(contentsOf: missing, at: closing)
        return requested
    }
}

/// Klient, do którego przypisana jest wersja PDF (`BrochureClient`).
struct BrochureClient: Equatable {
    var contactId: String?
    var organizationId: String?
    var name: String
    var organizationName: String?
    var json: JSONValue {
        var fields: [String: JSONValue] = ["name": .string(name)]
        if let contactId { fields["contactId"] = .string(contactId) }
        if let organizationId { fields["organizationId"] = .string(organizationId) }
        if let organizationName { fields["organizationName"] = .string(organizationName) }
        return .object(fields)
    }
}

struct BrochureClientResult: Decodable, Identifiable {
    struct Organization: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    var id: String
    var name: String
    var email: String
    var organizations: [Organization]
}

/// Problem z raportu sprawdzania (`BrochureValidationIssue`).
struct BrochureIssue: Decodable, Identifiable {
    var id: String
    var pageKey: String
    var pageNumber: Int?
    var pageTitle: String
    var field: String
    var element: String
    var fileName: String?
    var companyId: String?
    var reason: String?
    var message: String
    var remedy: String
    var label: String {
        if let pageNumber { return "Strona \(pageNumber) „\(pageTitle)” — \(element)" }
        return "\(pageTitle) — \(element)"
    }
}

/// Błąd generatora PDF z raportem problemów (odpowiedź 422).
struct BrochureValidationFailure: Error, LocalizedError {
    let message: String
    let issues: [BrochureIssue]
    var errorDescription: String? { message }
}

/// Wynik generatora (`/bridge/brochures/generate-pdf`).
struct BrochurePdfResult {
    var version: Int?
    var downloadURL: URL?
    var fileName: String
    /// Zapisana wersja PDF (`sales_brochure_generations.id`) — załącznik przygotowanej wiadomości.
    var generationId: String? = nil
}

@MainActor final class BrochuresStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: BrochureListState?
    @Published var loadError: String?
    @Published private(set) var loading = false

    var api: NativeAPI? { workspace?.nativeAPI() }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if let failure = error as? BrochureValidationFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    func load() async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        loading = true
        defer { loading = false }
        do {
            state = try JSONDecoder().decode(BrochureListState.self, from: try await api.get("/brochures?op=state"))
            loadError = nil
        } catch {
            loadError = failureText(error, "Nie udało się pobrać broszur")
        }
    }

    /// Nowa broszura (pusta albo z szablonu „Hotele”) — zwraca jej identyfikator.
    func create(hotelTemplate: Bool) async -> String? {
        struct Reply: Decodable { var savedId: String?; var notice: String? }
        guard let api, let workspace, workspace.canWrite else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        do {
            let data = try await workspace.withPending("Tworzenie broszury…") {
                try await api.post("/brochures", ["op": .string("create"), "hotelTemplate": .bool(hotelTemplate)], timeout: 90)
            }
            state = try JSONDecoder().decode(BrochureListState.self, from: data)
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            if let notice = reply.notice { workspace.snack = Snack(kind: .info, text: notice) }
            return reply.savedId
        } catch {
            workspace.error = failureText(error, "Nie udało się utworzyć broszury")
            return nil
        }
    }

    /// Zmiana nazwy, archiwum („Usuń broszurę”) albo przywrócenie — zwraca zmieniony rekord; błąd pokazuje okno.
    func manage(id: String, action: String, name: String, updatedAt: String) async throws -> BrochureRecord {
        struct Reply: Decodable { var record: BrochureRecord; var message: String? }
        guard let api, let workspace, workspace.canWrite else { throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:]) }
        let body: [String: JSONValue] = ["op": .string("manage"), "id": .string(id), "action": .string(action), "name": .string(name), "updatedAt": .string(updatedAt)]
        let data = try await api.post("/brochures", body)
        state = try? JSONDecoder().decode(BrochureListState.self, from: data)
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        if let message = reply.message { workspace.succeed(message) }
        return reply.record
    }

    // MARK: Edytor

    func editor(_ id: String) async throws -> BrochureEditorData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(BrochureEditorData.self, from: try await api.get("/brochures?op=editor&id=\(id)"))
    }

    /// Operacja edytora zwracająca świeży stan edytora (zapis, dodanie lub usunięcie usługi). Bez `pending` (autozapis)
    /// okno nie jest blokowane i nie pojawia się komunikat o sukcesie.
    func editorAction(_ body: [String: JSONValue], pending: String?) async -> BrochureEditorData? {
        struct Reply: Decodable { var message: String? }
        guard let api, let workspace, workspace.canWrite else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        do {
            let data: Data
            if let pending {
                data = try await workspace.withPending(pending) { try await api.post("/brochures", body, timeout: 90) }
            } else {
                data = try await api.post("/brochures", body, timeout: 90)
            }
            let next = try JSONDecoder().decode(BrochureEditorData.self, from: data)
            if pending != nil, let message = (try? JSONDecoder().decode(Reply.self, from: data))?.message { workspace.succeed(message) }
            return next
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać broszury")
            return nil
        }
    }

    func preview(_ body: [String: JSONValue]) async throws -> (html: String, pages: Int) {
        struct Reply: Decodable { var html: String; var totalPages: Int }
        guard let api else { throw AppError.configuration }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body, timeout: 60))
        return (reply.html, reply.totalPages)
    }

    /// Jedna strona graficzna (HTML) do płótna Studio stron.
    func pagePreview(_ body: [String: JSONValue]) async throws -> String {
        struct Reply: Decodable { var html: String }
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body, timeout: 60)).html
    }

    func imageUrls(_ assets: [(bucket: String, path: String)]) async -> [String: String] {
        struct Reply: Decodable { var urls: [String: String] }
        guard let api, !assets.isEmpty else { return [:] }
        let list = assets.map { entry in JSONValue.object(["bucket": .string(entry.bucket), "path": .string(entry.path)]) }
        guard let data = try? await api.post("/brochures", ["op": .string("imageUrls"), "assets": .array(list)]) else { return [:] }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.urls ?? [:]
    }

    func hotelAssets(organization: String?, company: String) async -> (assets: [BrochureAsset], notice: String) {
        struct Reply: Decodable { var assets: [BrochureAsset]; var notice: String }
        guard let api, let organization else { return ([], "") }
        guard let data = try? await api.get("/brochures?op=hotelAssets&organization=\(organization)&company=\(company)"),
              let reply = try? JSONDecoder().decode(Reply.self, from: data) else {
            return ([], "Biblioteka organizacji jest niedostępna. Nadal możesz wgrać własne zdjęcia.")
        }
        return (reply.assets, reply.notice)
    }

    func clients(mode: String, query: String) async throws -> [BrochureClientResult] {
        struct Reply: Decodable { var results: [BrochureClientResult] }
        guard let api else { throw AppError.configuration }
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))) ?? ""
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/brochures?op=clients&mode=\(mode)&q=\(encoded)")).results
    }

    /// Wgranie własnego zdjęcia (zmniejszonego na Macu) do biblioteki broszury.
    func upload(_ brochureID: String, data: Data) async -> (path: String, bucket: String, url: String?)? {
        struct Reply: Decodable { var path: String; var bucket: String; var url: String?; var message: String? }
        guard let api, let workspace, workspace.canWrite else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        do {
            let body: [String: JSONValue] = ["op": .string("imageUpload"), "id": .string(brochureID), "data": .string(data.base64EncodedString())]
            let reply = try JSONDecoder().decode(Reply.self, from: try await workspace.withPending("Wgrywanie zdjęcia…") {
                try await api.post("/brochures", body, timeout: 120)
            })
            if let message = reply.message { workspace.succeed(message) }
            return (reply.path, reply.bucket, reply.url)
        } catch {
            workspace.error = failureText(error, "Nie udało się wgrać zdjęcia. Spróbuj ponownie.")
            return nil
        }
    }

    /// Ostatni własny PDF tej broszury — pobrany do podglądu w oknie aplikacji.
    func ownPdf(_ brochureID: String) async -> OfferPdfPreview? {
        struct Reply: Decodable { var url: String; var fileName: String }
        guard let api, let workspace else { return nil }
        do {
            return try await workspace.withPending("Otwieranie PDF…") { () async throws -> OfferPdfPreview in
                let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/brochures?op=ownPdf&id=\(brochureID)"))
                guard let url = URL(string: reply.url) else { throw AppError.invalidResponse }
                return OfferPdfPreview(data: try await Self.download(url), name: reply.fileName)
            }
        } catch {
            workspace.error = failureText(error, "Nie udało się otworzyć PDF. Spróbuj ponownie.")
            return nil
        }
    }

    static func download(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw NativeFailure(status: http.statusCode, message: "Nie udało się pobrać pliku PDF. Spróbuj ponownie.", fieldErrors: [:])
        }
        return data
    }

    /// „Utwórz szkic kampanii” — identyfikator kampanii i informacja, czy broszura ma włączone demo.
    func campaign(_ brochureID: String) async throws -> (id: String, sellerDemo: Bool) {
        struct Reply: Decodable { var campaignId: String; var sellerDemo: Bool }
        guard let api else { throw AppError.configuration }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", ["op": .string("campaign"), "id": .string(brochureID)]))
        return (reply.campaignId, reply.sellerDemo)
    }

    /// Generowanie lub sprawdzenie PDF jak w CRM (`/bridge/brochures/generate-pdf`, do 3 minut).
    func generatePdf(_ body: [String: JSONValue], fallback: String) async throws -> BrochurePdfResult {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/brochures/generate-pdf") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 240
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        let result = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        if !(200..<300).contains(status) {
            let http = status == 403 ? "Brak dostępu do tej operacji."
                : status == 504 ? "Serwer nie zakończył operacji w wymaganym czasie. Sprawdź jej stan przed ponowieniem."
                : "\(fallback) (HTTP \(status))"
            let message = (result["error"]?.text).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? http
            if let raw = result["issues"], let encoded = try? JSONEncoder().encode(raw),
               let issues = try? JSONDecoder().decode([BrochureIssue].self, from: encoded), !issues.isEmpty {
                throw BrochureValidationFailure(message: message, issues: issues)
            }
            throw NativeFailure(status: status, message: message, fieldErrors: [:])
        }
        let generation = result["generation"]?.object ?? [:]
        let version = generation["version"].map { value in Int(value.number) }
        let generationId = generation["id"]?.text
        return BrochurePdfResult(version: version, downloadURL: (result["downloadUrl"]?.text).flatMap { URL(string: $0) },
                                 fileName: result["fileName"]?.text.isEmpty == false ? result["fileName"]!.text : "Broszura.pdf",
                                 generationId: generationId?.isEmpty == false ? generationId : nil)
    }
}

/// Zdjęcie z dysku zmniejszone przed wgraniem (jak `optimizeOfferImage` w CRM: do 1600 × 2200 px).
enum BrochureImageEncoder {
    static let maxSize = CGSize(width: 1600, height: 2200)
    static let sourceLimit = 10 * 1024 * 1024

    static func encode(_ url: URL) -> Data? {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()),
              type.conforms(to: .jpeg) || type.conforms(to: .png) || type.conforms(to: .webP),
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= sourceLimit,
              let source = NSImage(contentsOf: url),
              let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil), cg.width > 0, cg.height > 0 else { return nil }
        let scale = min(1, maxSize.width / CGFloat(cg.width), maxSize.height / CGFloat(cg.height))
        let width = max(1, Int((CGFloat(cg.width) * scale).rounded()))
        let height = max(1, Int((CGFloat(cg.height) * scale).rounded()))
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        let png = type.conforms(to: .png)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        if !png {
            NSColor.white.setFill()
            NSRect(x: 0, y: 0, width: width, height: height).fill()
        }
        NSGraphicsContext.current?.cgContext.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.restoreGraphicsState()
        let data = png ? rep.representation(using: .png, properties: [:]) : rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
        guard let data, data.count <= sourceLimit else { return nil }
        return data
    }
}
