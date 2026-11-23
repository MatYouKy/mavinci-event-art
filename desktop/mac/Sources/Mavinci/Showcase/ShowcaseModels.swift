import Foundation
import SwiftUI

// MARK: Strefa sprzedawcy → „Prezentacje” — modele i reguły wspólne z CRM (`src/lib/showcase/showcaseShared.ts`): działy,
// karty (tytuł, hasło, produkty katalogu, treść: wstęp, zdjęcie główne, bloki), produkty z katalogu i realizacje na bieżąco,
// lista kontrolna i ceny do pokazu. API: `/bridge/native/v1/showcase`.

enum ShowcaseLimits {
    static let sectionTitle = 80
    static let sectionSubtitle = 240
    static let title = 120
    static let tagline = 240
    static let lead = 1500
    static let products = 12
    static let blocks = 30
    static let blockTitle = 80
    static let blockText = 4000
    static let blockIntro = 600
    static let photos = 60
    static let caption = 200
    static let rows = 40
    static let rowTitle = 200
    static let rowText = 1500
    static let refs = 24
    static let uploadBytes = 40 * 1024 * 1024
}

/// Ikona działu: klucz jak w CRM (lucide) i odpowiednik SF Symbols.
struct ShowcaseIconInfo: Identifiable, Hashable {
    let key: String
    let label: String
    let symbol: String
    var id: String { key }

    static let all: [ShowcaseIconInfo] = [
        ShowcaseIconInfo(key: "sparkles", label: "Efekty", symbol: "sparkles"),
        ShowcaseIconInfo(key: "monitor", label: "Ekrany", symbol: "display"),
        ShowcaseIconInfo(key: "tv", label: "Telewizory i monitory", symbol: "tv"),
        ShowcaseIconInfo(key: "speaker", label: "Nagłośnienie", symbol: "hifispeaker.2"),
        ShowcaseIconInfo(key: "lightbulb", label: "Oświetlenie", symbol: "lightbulb"),
        ShowcaseIconInfo(key: "stage", label: "Scena", symbol: "theatermasks"),
        ShowcaseIconInfo(key: "mic", label: "Konferencje", symbol: "mic"),
        ShowcaseIconInfo(key: "music", label: "Muzyka", symbol: "music.note"),
        ShowcaseIconInfo(key: "camera", label: "Foto i wideo", symbol: "camera"),
        ShowcaseIconInfo(key: "gamepad", label: "Atrakcje", symbol: "gamecontroller"),
        ShowcaseIconInfo(key: "party", label: "Imprezy", symbol: "party.popper"),
        ShowcaseIconInfo(key: "users", label: "Obsługa", symbol: "person.3"),
        ShowcaseIconInfo(key: "building", label: "Obiekty", symbol: "building.2"),
        ShowcaseIconInfo(key: "utensils", label: "Gastronomia", symbol: "fork.knife"),
        ShowcaseIconInfo(key: "gift", label: "Pakiety", symbol: "gift"),
        ShowcaseIconInfo(key: "star", label: "Wyróżnione", symbol: "star"),
        ShowcaseIconInfo(key: "layers", label: "Inne", symbol: "square.3.layers.3d"),
        ShowcaseIconInfo(key: "award", label: "Realizacje", symbol: "rosette"),
    ]

    static func symbol(_ key: String) -> String { all.first { $0.key == key }?.symbol ?? "sparkles" }
}

/// Urządzenie w podglądzie (poziomo, w punktach ekranu) — jak `SHOWCASE_DEVICES` w CRM.
enum ShowcaseDevice: String, CaseIterable, Identifiable {
    case ipad13, ipad11
    var id: String { rawValue }
    var label: String { self == .ipad13 ? "iPad Pro 13″" : "iPad Air 11″" }
    var size: CGSize { self == .ipad13 ? CGSize(width: 1376, height: 1032) : CGSize(width: 1180, height: 820) }
    var wide: Bool { self == .ipad13 }
}

// MARK: Treść karty

enum ShowcaseMediaSource: String, Codable, Hashable {
    case upload, product, site, material
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ShowcaseMediaSource(rawValue: raw) ?? .upload
    }
}

/// Zdjęcie: `upload` — wersje WebP w prezentacjach, `product` — zdjęcie produktu z katalogu, `site` — zdjęcie realizacji ze strony,
/// `material` — zdjęcie z bazy zdjęć (Materiały): odnośnik do pliku i wspólna wersja WebP do pokazu (bez kopii w karcie).
struct ShowcaseMedia: Codable, Hashable, Identifiable {
    var id: String
    var source: ShowcaseMediaSource
    var path: String
    var thumb: String?
    var width: Int?
    var height: Int?
    var caption: String

    enum CodingKeys: String, CodingKey { case id, source, path, thumb, width, height, caption }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ShowcaseShared.newID()
        source = (try? c.decode(ShowcaseMediaSource.self, forKey: .source)) ?? .upload
        path = (try? c.decode(String.self, forKey: .path)) ?? ""
        thumb = try? c.decodeIfPresent(String.self, forKey: .thumb)
        if let value = try? c.decodeIfPresent(Double.self, forKey: .width) { width = Int(value) } else { width = nil }
        if let value = try? c.decodeIfPresent(Double.self, forKey: .height) { height = Int(value) } else { height = nil }
        caption = (try? c.decodeIfPresent(String.self, forKey: .caption)) ?? ""
    }

    /// Stały klucz (adres w `urls`, kopia na dysku) — źródło i ścieżka.
    var key: String { "\(source.rawValue):\(path)" }
}

struct ShowcaseBlockStyle: Identifiable, Hashable {
    let key: String
    let label: String
    let title: String
    var id: String { key.isEmpty ? title : key }
}

enum ShowcaseBlockKind: String, Codable, CaseIterable, Identifiable {
    case photos, points, catalog, specs, faq, text, realizations
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ShowcaseBlockKind(rawValue: raw) ?? .text
    }

    var label: String {
        switch self {
        case .photos: return "Zdjęcia"
        case .points: return "Punkty"
        case .catalog: return "Z katalogu produktów"
        case .specs: return "Specyfikacja"
        case .faq: return "Pytania klientów"
        case .text: return "Tekst"
        case .realizations: return "Realizacje"
        }
    }

    var symbol: String {
        switch self {
        case .photos: return "photo.on.rectangle"
        case .points: return "checklist"
        case .catalog: return "shippingbox"
        case .specs: return "tablecells"
        case .faq: return "questionmark.bubble"
        case .text: return "text.alignleft"
        case .realizations: return "rosette"
        }
    }

    /// Warianty bloku (pierwszy — domyślny) — jak `SHOWCASE_BLOCK_STYLES` w CRM.
    var styles: [ShowcaseBlockStyle] {
        switch self {
        case .photos: return [
            ShowcaseBlockStyle(key: "large", label: "Duże zdjęcia — jak to wygląda", title: "Jak to wygląda"),
            ShowcaseBlockStyle(key: "grid", label: "Siatka — galeria", title: "Galeria"),
        ]
        case .points: return [
            ShowcaseBlockStyle(key: "benefits", label: "Kafelki — korzyści", title: "Korzyści"),
            ShowcaseBlockStyle(key: "steps", label: "Kroki z numerami — przygotowanie", title: "Jak przygotowujemy"),
            ShowcaseBlockStyle(key: "checklist", label: "Lista z ✓ — co obejmuje", title: "Co obejmuje"),
        ]
        case .catalog: return [
            ShowcaseBlockStyle(key: "variants", label: "Warianty i ceny", title: "Warianty"),
            ShowcaseBlockStyle(key: "benefits", label: "Korzyści z karty produktu", title: "Korzyści"),
            ShowcaseBlockStyle(key: "preparation", label: "Przygotowanie i wymagania", title: "Przygotowanie i wymagania"),
            ShowcaseBlockStyle(key: "packages", label: "Pakiety sprzedażowe", title: "Pakiety"),
        ]
        case .specs: return [ShowcaseBlockStyle(key: "", label: "Tabela: parametr — wartość", title: "Specyfikacja")]
        case .faq: return [ShowcaseBlockStyle(key: "", label: "Pytanie — odpowiedź", title: "Pytania klientów")]
        case .text: return [ShowcaseBlockStyle(key: "", label: "Akapity tekstu", title: "Opis")]
        case .realizations: return [ShowcaseBlockStyle(key: "", label: "Realizacje ze strony www", title: "Nasze realizacje")]
        }
    }

    func defaultTitle(_ style: String) -> String { (styles.first { $0.key == style } ?? styles[0]).title }

    /// Etykiety pól wiersza: punkt, parametr albo pytanie.
    var rowLabels: (String, String) {
        switch self {
        case .specs: return ("Parametr (np. „Rozdzielczość”)", "Wartość")
        case .faq: return ("Pytanie klienta (np. „Czy ekran jest widoczny w dzień?”)", "Odpowiedź")
        default: return ("Punkt (np. „Widoczny z każdego miejsca sali”)", "Opis (opcjonalnie)")
        }
    }

    var hasRows: Bool { self == .points || self == .specs || self == .faq }
}

struct ShowcaseRow: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var text: String

    init(id: String = ShowcaseShared.newID(), title: String = "", text: String = "") {
        self.id = id; self.title = title; self.text = text
    }
}

struct ShowcaseBlock: Codable, Hashable, Identifiable {
    var id: String
    var kind: ShowcaseBlockKind
    var title: String
    var hidden: Bool
    var style: String
    var productId: String?
    var text: String
    var photos: [ShowcaseMedia]
    var rows: [ShowcaseRow]
    var refs: [String]

    enum CodingKeys: String, CodingKey { case id, kind, title, hidden, style, productId, text, photos, rows, refs }

    init(kind: ShowcaseBlockKind, style: String? = nil, productId: String? = nil) {
        let resolved = kind.styles.contains { $0.key == style } ? (style ?? "") : kind.styles[0].key
        id = ShowcaseShared.newID()
        self.kind = kind
        title = kind.defaultTitle(resolved)
        hidden = false
        self.style = resolved
        self.productId = kind == .catalog ? productId : nil
        text = ""
        photos = []
        rows = []
        refs = []
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ShowcaseShared.newID()
        kind = (try? c.decode(ShowcaseBlockKind.self, forKey: .kind)) ?? .text
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        hidden = (try? c.decodeIfPresent(Bool.self, forKey: .hidden)) ?? false
        style = (try? c.decodeIfPresent(String.self, forKey: .style)) ?? ""
        productId = try? c.decodeIfPresent(String.self, forKey: .productId)
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? ""
        photos = (try? c.decodeIfPresent([ShowcaseMedia].self, forKey: .photos)) ?? []
        rows = (try? c.decodeIfPresent([ShowcaseRow].self, forKey: .rows)) ?? []
        refs = (try? c.decodeIfPresent([String].self, forKey: .refs)) ?? []
    }

    /// Blok bez własnej treści (bez sprawdzania danych produktu).
    var isBlank: Bool { photos.isEmpty && rows.isEmpty && text.isEmpty && refs.isEmpty }
}

struct ShowcaseContent: Codable, Hashable {
    var lead: String
    var hero: ShowcaseMedia?
    var blocks: [ShowcaseBlock]

    init(lead: String = "", hero: ShowcaseMedia? = nil, blocks: [ShowcaseBlock] = []) {
        self.lead = lead; self.hero = hero; self.blocks = blocks
    }

    enum CodingKeys: String, CodingKey { case lead, hero, blocks }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lead = (try? c.decodeIfPresent(String.self, forKey: .lead)) ?? ""
        hero = try? c.decodeIfPresent(ShowcaseMedia.self, forKey: .hero)
        blocks = (try? c.decodeIfPresent([ShowcaseBlock].self, forKey: .blocks)) ?? []
    }

    /// Treść jako JSON do wysłania na serwer.
    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return value
    }

    /// Wszystkie zdjęcia karty (zdjęcie główne i bloki zdjęć).
    var media: [ShowcaseMedia] { (hero.map { [$0] } ?? []) + blocks.flatMap(\.photos) }
}

// MARK: Widoki z serwera

struct ShowcaseAccess: Codable, Hashable {
    var view: Bool
    var manage: Bool
}

struct ShowcaseFont: Codable, Hashable {
    var family: String
    var url: String?
}

/// Marka z księgi znaku domyślnej firmy (logo, sygnet, kolory i fonty według ról).
struct ShowcaseBrand: Codable, Hashable {
    var name: String
    var logoUrl: String?
    var sygnetUrl: String?
    var accent: String
    var surface: String
    var headingFont: ShowcaseFont?
    var bodyFont: ShowcaseFont?
}

struct ShowcaseURLPair: Codable, Hashable {
    var url: String?
    var thumb: String?
}

struct ShowcaseSection: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var subtitle: String
    var icon: String
    var cover: ShowcaseMedia?
    var isActive: Bool
    /// Miejsce w układzie pracownika (serwer zwraca listę już w jego układzie), bez układu — kolejność domyślna.
    var sortOrder: Int
    var version: Int
    var itemCount: Int
    /// Ukryty w układzie tego pracownika (u innych bez zmian).
    var hiddenForMe: Bool?
}

struct ShowcaseItemSummary: Codable, Hashable, Identifiable {
    var id: String
    var sectionId: String
    var title: String
    var tagline: String
    var isActive: Bool
    var sortOrder: Int
    var version: Int
    var thumbKey: String?
    var productNames: [String]
    var blockCount: Int
    var problems: Int
    var updatedAt: String
    /// Ukryta w układzie tego pracownika (u innych bez zmian).
    var hiddenForMe: Bool?
}

/// Własny układ pracownika (`ShowcaseLayout` w `showcaseShared.ts`): kolejność działów i kart w działach, ukryte u niego.
struct ShowcaseLayoutEntry: Codable, Hashable {
    var id: String
    var hidden: Bool
}

struct ShowcaseLayout: Codable, Hashable {
    var sections: [ShowcaseLayoutEntry]
    var items: [String: [ShowcaseLayoutEntry]]
}

struct ShowcaseHome: Codable {
    var access: ShowcaseAccess
    var sections: [ShowcaseSection]
    var items: [ShowcaseItemSummary]
    var urls: [String: ShowcaseURLPair]
    var brand: ShowcaseBrand
    /// Własny układ pracownika; `nil` — kolejność domyślna.
    var layout: ShowcaseLayout?
    /// Czy serwer zapisuje własny układ (po aktualizacji bazy).
    var personal: Bool?
}

struct ShowcasePoint: Codable, Hashable {
    var title: String
    var text: String
}

struct ShowcaseProductVariant: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var shortDescription: String
    var description: String
    var benefits: [String]
    var image: ShowcaseMedia?
    var priceNet: Double?
    var priceGross: Double?
    var recommended: Bool
}

struct ShowcaseProductPackage: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var description: String
    var scope: String
    var bonus: String
    var image: ShowcaseMedia?
    var priceNet: Double?
    var priceOnRequest: Bool
    var highlighted: Bool
}

struct ShowcasePreparationStep: Codable, Hashable {
    var title: String
    var details: String
    var leadDays: Double?
}

/// Produkt katalogu na bieżąco (Oferty → Produkty).
struct ShowcaseProduct: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var category: String
    var isActive: Bool
    /// Produkt z konfiguratorem (scena, ekran LED) — wycena po konfiguracji w edytorze oferty, nie z pokazu (starsza kopia na dysku — brak).
    var configurable: Bool?
    var shortDescription: String
    var description: String
    var image: ShowcaseMedia?
    var unit: String
    var priceNet: Double?
    var priceGross: Double?
    var vatRate: Double?
    var benefits: [ShowcasePoint]
    var variants: [ShowcaseProductVariant]
    var packages: [ShowcaseProductPackage]
    var requirements: [ShowcasePoint]
    var preparation: [ShowcasePreparationStep]
    var setupHours: Double?
    var teardownHours: Double?

    var media: [ShowcaseMedia] { [image].compactMap { $0 } + variants.compactMap(\.image) + packages.compactMap(\.image) }
}

struct ShowcaseRealization: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var location: String
    var date: String?
    var category: String
    var description: String
    var photos: [ShowcaseMedia]
    var siteUrl: String?
}

struct ShowcaseItem: Codable, Hashable {
    var id: String
    var sectionId: String
    var title: String
    var tagline: String
    var isActive: Bool
    /// Aktywna karta także na stronie produktu dla klienta (`/produkty/<id>`); `nil` — serwer bez przełącznika (migracja 20261128100000).
    var showOnProductPage: Bool?
    var productIds: [String]
    var content: ShowcaseContent
    var version: Int
    var createdAt: String
    var createdByName: String?
    var updatedAt: String
    var updatedByName: String?
}

struct ShowcaseDetail: Codable, Hashable {
    var item: ShowcaseItem
    var products: [ShowcaseProduct]
    var realizations: [ShowcaseRealization]
    var urls: [String: ShowcaseURLPair]
}

/// Zdjęcie do wyboru: `media` — gotowe zdjęcie (produkt, realizacja), bez — plik z bazy zdjęć (odnośnik) albo social media (kopia).
struct ShowcasePickPhoto: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var thumbnailUrl: String?
    var url: String?
    var width: Double?
    var height: Double?
    var media: ShowcaseMedia?
}

struct ShowcasePhotosReply: Codable {
    var source: String
    var photos: [ShowcasePickPhoto]
    var problem: String?
    var hasMore: Bool?
}

struct ShowcasePhotoReply: Codable, Hashable {
    var photo: ShowcaseMedia
    var urls: [String: ShowcaseURLPair]
}

/// Zdjęcie z dysku: `stored == "materials"` — zapisane w bazie zdjęć (Materiały → Zdjęcia), `existing` — ten plik już tam był.
struct ShowcaseUploadReply: Codable {
    struct StoredFile: Codable, Hashable { var id: String; var name: String; var folderName: String; var companyName: String }
    var photo: ShowcaseMedia
    var urls: [String: ShowcaseURLPair]
    var stored: String?
    var existing: Bool?
    var file: StoredFile?
    var reply: ShowcasePhotoReply { ShowcasePhotoReply(photo: photo, urls: urls) }
}

/// Album bazy zdjęć (Materiały → Albumy) w oknie wyboru.
struct ShowcaseAlbumOption: Codable, Hashable, Identifiable {
    var id: String
    var companyId: String
    var companyName: String
    var name: String
    var count: Int
    var thumbnailUrl: String?
}

/// Dokąd trafiają zdjęcia z dysku (Materiały → marka → Zdjęcia) i albumy bazy zdjęć.
struct ShowcasePhotoBaseReply: Codable {
    struct Base: Codable, Hashable { var companyId: String; var companyName: String; var folderId: String?; var folderName: String }
    var base: Base?
    var albums: [ShowcaseAlbumOption]
    var canView: Bool
    var problem: String?
}

struct ShowcaseProductOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var category: String
    var priceNet: Double?
    var unit: String
    var thumbnailUrl: String?
}

struct ShowcaseRealizationOption: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var location: String
    var date: String?
    var photos: Int
    var thumbnailUrl: String?
}

struct ShowcaseEventOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var date: String?
}

/// Źródła w oknie wyboru zdjęć: baza zdjęć (Materiały i albumy), produkty, realizacje, biblioteka social media.
enum ShowcasePhotoSource: String, CaseIterable, Identifiable {
    case material, product, site, social
    var id: String { rawValue }
    var label: String {
        switch self {
        case .material: return "Baza zdjęć"
        case .product: return "Produkty"
        case .site: return "Realizacje"
        case .social: return "Social media"
        }
    }
    var symbol: String {
        switch self {
        case .material: return "photo.stack"
        case .product: return "shippingbox"
        case .site: return "rosette"
        case .social: return "sparkles"
        }
    }
    /// Źródło z listą „właścicieli” zdjęć (produkt, realizacja) — najpierw lista z miniaturami, potem zdjęcia.
    var needsOwner: Bool { self == .product || self == .site }
}

/// Lista kontrolna karty.
struct ShowcaseCheck: Identifiable, Hashable {
    let key: String
    let label: String
    let ok: Bool
    let hint: String
    var blockID: String? = nil
    var id: String { key }
}

// MARK: Reguły (jak `showcaseShared.ts`)

enum ShowcaseShared {
    static func newID() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(20)) }

    /// Treść nowej karty: szkielet pokazu.
    static func defaultContent() -> ShowcaseContent {
        ShowcaseContent(blocks: [
            ShowcaseBlock(kind: .photos, style: "large"), ShowcaseBlock(kind: .points, style: "benefits"),
            ShowcaseBlock(kind: .photos, style: "grid"), ShowcaseBlock(kind: .points, style: "steps"), ShowcaseBlock(kind: .faq),
        ])
    }

    static func catalogHasContent(_ product: ShowcaseProduct?, style: String) -> Bool {
        guard let product else { return false }
        switch style {
        case "variants": return !product.variants.isEmpty
        case "benefits": return !product.benefits.isEmpty || product.variants.contains { !$0.benefits.isEmpty }
        case "preparation": return !product.requirements.isEmpty || !product.preparation.isEmpty || product.setupHours != nil || product.teardownHours != nil
        case "packages": return !product.packages.isEmpty
        default: return false
        }
    }

    /// Blok bez treści (nie pokazuje się na spotkaniu). `products` — produkty z serwera (bloki katalogu); `nil` — bez sprawdzania.
    static func blockIsEmpty(_ block: ShowcaseBlock, products: [ShowcaseProduct]?) -> Bool {
        switch block.kind {
        case .photos: return block.photos.isEmpty
        case .points, .specs, .faq: return block.rows.filter { !$0.title.isEmpty || !$0.text.isEmpty }.isEmpty
        case .text: return block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .realizations: return block.refs.isEmpty
        case .catalog:
            guard let productId = block.productId else { return true }
            guard let products else { return false }
            return !catalogHasContent(products.first { $0.id == productId }, style: block.style)
        }
    }

    static func visibleBlocks(_ content: ShowcaseContent, products: [ShowcaseProduct]?) -> [ShowcaseBlock] {
        content.blocks.filter { !$0.hidden && !blockIsEmpty($0, products: products) }
    }

    static func checklist(title: String, productIDs: [String], content: ShowcaseContent, products: [ShowcaseProduct]?) -> [ShowcaseCheck] {
        let photos = content.media.count
        var checks: [ShowcaseCheck] = [
            ShowcaseCheck(key: "title", label: "Tytuł", ok: !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, hint: "Krótka nazwa, którą klient od razu zrozumie."),
            ShowcaseCheck(key: "hero", label: "Zdjęcie główne", ok: content.hero != nil, hint: "Duże zdjęcie na ekranie startowym karty."),
            ShowcaseCheck(key: "lead", label: "Wstęp", ok: content.lead.trimmingCharacters(in: .whitespacesAndNewlines).count >= 25, hint: "1–3 zdania: co klient dostaje i dlaczego warto."),
            ShowcaseCheck(key: "products", label: "Produkty z katalogu", ok: !productIDs.isEmpty, hint: "Warianty, ceny i przygotowanie zaciągną się z Oferty → Produkty."),
            ShowcaseCheck(key: "photos", label: "Zdjęcia", ok: photos >= 4, hint: "Co najmniej 4 zdjęcia — „Jak to wygląda” i galeria (teraz \(photos))."),
        ]
        for block in content.blocks where !block.hidden {
            if block.kind == .catalog && block.productId == nil {
                checks.append(ShowcaseCheck(key: "block-\(block.id)", label: "Blok „\(block.title)”", ok: false, hint: "Wybierz produkt z katalogu.", blockID: block.id))
            } else if blockIsEmpty(block, products: products) {
                let hint = block.kind == .catalog ? "Produkt nie ma tej treści w katalogu — blok się nie pokaże." : "Pusty — nie pokaże się na spotkaniu."
                checks.append(ShowcaseCheck(key: "block-\(block.id)", label: "Blok „\(block.title)”", ok: false, hint: hint, blockID: block.id))
            }
        }
        return checks
    }

    /// Cena do pokazu: „1200 zł netto” (bez groszy, gdy pełne złote).
    static func price(_ value: Double?, kind: String = "netto") -> String {
        guard let value, value.isFinite else { return "" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        let whole = abs(value - value.rounded()) < 0.005
        formatter.minimumFractionDigits = whole ? 0 : 2
        formatter.maximumFractionDigits = whole ? 0 : 2
        return "\(formatter.string(from: NSNumber(value: value)) ?? String(value)) zł \(kind)"
    }

    /// Liczba z odmianą: 1 karta, 2 karty, 5 kart.
    static func plural(_ value: Int, _ one: String, _ few: String, _ many: String) -> String {
        if value == 1 { return one }
        let tens = value % 100
        return (2...4).contains(value % 10) && !(12...14).contains(tens) ? few : many
    }

    static func hours(_ value: Double) -> String {
        let whole = abs(value - value.rounded()) < 0.01
        return whole ? String(Int(value.rounded())) : String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",")
    }

    /// Kolor z `#rrggbb` (księga znaku).
    static func color(_ hex: String, fallback: Color) -> Color {
        let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")).prefix(6)
        guard value.count == 6, let number = Int(value, radix: 16) else { return fallback }
        return Color(red: Double((number >> 16) & 0xff) / 255, green: Double((number >> 8) & 0xff) / 255, blue: Double(number & 0xff) / 255)
    }

    /// Przeniesienie elementu na miejsce wskazanego (w dół — za nim, w górę — przed nim).
    static func move<T>(_ list: [T], from: Int, to: Int) -> [T] {
        guard list.indices.contains(from), list.indices.contains(to), from != to else { return list }
        var next = list
        let item = next.remove(at: from)
        next.insert(item, at: to)
        return next
    }
}
