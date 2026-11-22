import Foundation
import SwiftUI

// MARK: Social media — odpowiedzi `/bridge/native/v1/social` (`src/lib/social/*`), etykiety statusów, kanałów, formatów
// i zgód jak w CRM (`src/lib/social/socialShared.ts`) oraz kadr znormalizowany do zdjęcia (0…1). Modele są też kopią na dysku.

enum SocialFormat: String, Codable, CaseIterable, Identifiable, Hashable {
    case portrait = "4:5", square = "1:1", story = "9:16", landscape = "1.91:1"
    var id: String { rawValue }
    var width: Double { self == .landscape ? 1200 : 1080 }
    var height: Double {
        switch self {
        case .portrait: return 1350
        case .square: return 1080
        case .story: return 1920
        case .landscape: return 628
        }
    }
    var aspect: Double { width / height }
    var label: String {
        switch self {
        case .portrait: return "Post 4:5"
        case .square: return "Kwadrat 1:1"
        case .story: return "Relacja 9:16"
        case .landscape: return "Poziomy 1,91:1"
        }
    }
    var hint: String {
        switch self {
        case .portrait: return "Instagram, Facebook i LinkedIn — najlepszy zasięg w feedzie"
        case .square: return "Instagram, Facebook i LinkedIn"
        case .story: return "Relacje — strefy bezpieczne u góry i u dołu"
        case .landscape: return "Facebook i LinkedIn — post poziomy"
        }
    }
}

enum SocialChannel: String, Codable, CaseIterable, Identifiable, Hashable {
    case instagramFeed = "instagram_feed", instagramStory = "instagram_story", facebookFeed = "facebook_feed", linkedinPage = "linkedin_page"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .instagramFeed: return "Instagram — post"
        case .instagramStory: return "Instagram — relacja"
        case .facebookFeed: return "Facebook — post"
        case .linkedinPage: return "LinkedIn — post"
        }
    }
    /// Formaty grafiki kanału w kolejności wyboru (jak `SOCIAL_CHANNEL_FORMATS`).
    var formats: [SocialFormat] {
        switch self {
        case .instagramFeed: return [.portrait, .square]
        case .instagramStory: return [.story]
        case .facebookFeed, .linkedinPage: return [.landscape, .portrait, .square]
        }
    }
    /// Kanał publikowany przez Meta (Facebook, Instagram); LinkedIn — osobna integracja marki (`isMetaChannel`).
    var isMeta: Bool { self != .linkedinPage }
    func format(in available: [SocialFormat]) -> SocialFormat? { formats.first { available.contains($0) } }
}

enum SocialPostStatus: String, Codable, Hashable {
    case draft, inReview = "in_review", changesRequested = "changes_requested", approved, scheduled, publishing, failed, published, cancelled
    /// Status nowszy niż ta wersja aplikacji (bez błędu dekodowania całego kalendarza).
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SocialPostStatus(rawValue: raw) ?? .unknown
    }

    var label: String {
        switch self {
        case .draft: return "Szkic"
        case .inReview: return "Do akceptacji"
        case .changesRequested: return "Do poprawy"
        case .approved: return "Zatwierdzony"
        case .scheduled: return "Zaplanowany"
        case .publishing: return "Publikowanie…"
        case .failed: return "Błąd publikacji"
        case .published: return "Opublikowany"
        case .cancelled: return "Anulowany"
        case .unknown: return "Inny status"
        }
    }
    var color: Color {
        switch self {
        case .draft, .unknown: return .secondary
        case .inReview: return .orange
        case .changesRequested: return Color(red: 0.95, green: 0.5, blue: 0.25)
        case .approved: return .green
        case .scheduled, .publishing: return .blue
        case .failed: return .red
        case .published: return Color(red: 0.83, green: 0.73, blue: 0.45)
        case .cancelled: return .red
        }
    }
    /// Treść można zmieniać (nie: opublikowany, anulowany, w trakcie publikacji).
    var editable: Bool { ![.published, .cancelled, .publishing, .unknown].contains(self) }
}

enum SocialPostAction: String, Codable, Hashable {
    case submit, approve, requestChanges = "request_changes", reopen, cancel, schedule, unschedule, publish
    /// Akcja nowsza niż ta wersja aplikacji — pomijana w przyciskach.
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SocialPostAction(rawValue: raw) ?? .unknown
    }

    var label: String {
        switch self {
        case .submit: return "Wyślij do akceptacji"
        case .approve: return "Zatwierdź"
        case .requestChanges: return "Do poprawy"
        case .reopen: return "Przywróć do szkicu"
        case .cancel: return "Anuluj post"
        case .schedule: return "Zaplanuj publikację"
        case .unschedule: return "Wstrzymaj publikację"
        case .publish: return "Oznacz jako opublikowany"
        case .unknown: return ""
        }
    }
    var success: String {
        switch self {
        case .submit: return "Wysłano post do akceptacji"
        case .approve: return "Post zatwierdzony"
        case .requestChanges: return "Post wrócił do poprawy"
        case .reopen: return "Post jest znowu szkicem"
        case .cancel: return "Post anulowany"
        case .schedule: return "Publikacja zaplanowana"
        case .unschedule: return "Publikacja wstrzymana — post jest zatwierdzony"
        case .publish: return "Post oznaczony jako opublikowany"
        case .unknown: return ""
        }
    }
}

enum SocialConsentStatus: String, Codable, CaseIterable, Identifiable, Hashable {
    case inherit, unknown, requested, granted, denied, notRequired = "not_required"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .inherit: return "Jak dla eventu i klienta"
        case .unknown: return "Nieustalona"
        case .requested: return "Czeka na odpowiedź klienta"
        case .granted: return "Jest zgoda"
        case .denied: return "Brak zgody"
        case .notRequired: return "Niepotrzebna"
        }
    }
}

enum SocialConsentPlatform: String, CaseIterable, Identifiable {
    case instagram, facebook, linkedin, website
    var id: String { rawValue }
    var label: String {
        switch self {
        case .instagram: return "Instagram"
        case .facebook: return "Facebook"
        case .linkedin: return "LinkedIn"
        case .website: return "Strona WWW"
        }
    }
}

struct SocialCrop: Codable, Hashable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double

    private static func round(_ value: Double) -> Double { (value * 10000).rounded() / 10000 }

    /// Największy kadr formatu pośrodku zdjęcia (`centerCrop`).
    static func center(width: Double, height: Double, format: SocialFormat) -> SocialCrop {
        let imageAspect = width / height
        if imageAspect > format.aspect {
            let w = format.aspect / imageAspect
            return SocialCrop(x: round((1 - w) / 2), y: 0, w: round(w), h: 1)
        }
        let h = imageAspect / format.aspect
        return SocialCrop(x: 0, y: round((1 - h) / 2), w: 1, h: round(h))
    }

    /// Kadr w proporcjach formatu i w granicach zdjęcia, ze środkiem w tym samym miejscu (`fitCrop`).
    func fitted(width: Double, height: Double, format: SocialFormat) -> SocialCrop {
        let centerX = x + w / 2
        let centerY = y + h / 2
        var widthPx = min(1, max(0.08, w)) * width
        var heightPx = widthPx / format.aspect
        if heightPx > height { heightPx = height; widthPx = heightPx * format.aspect }
        if widthPx > width { widthPx = width; heightPx = widthPx / format.aspect }
        let nw = widthPx / width
        let nh = heightPx / height
        return SocialCrop(x: Self.round(min(max(centerX - nw / 2, 0), 1 - nw)), y: Self.round(min(max(centerY - nh / 2, 0), 1 - nh)),
                          w: Self.round(nw), h: Self.round(nh))
    }

    func moved(dx: Double, dy: Double) -> SocialCrop {
        SocialCrop(x: Self.round(min(max(x + dx, 0), 1 - w)), y: Self.round(min(max(y + dy, 0), 1 - h)), w: w, h: h)
    }

    /// Powiększenie wokół środka (`factor` < 1 — przybliżenie).
    func zoomed(_ factor: Double, width: Double, height: Double, format: SocialFormat) -> SocialCrop {
        SocialCrop(x: x + (w - w * factor) / 2, y: y + (h - h * factor) / 2, w: w * factor, h: h * factor).fitted(width: width, height: height, format: format)
    }

    // Kadr w proporcjach miejsca zdjęcia w układzie (jak `socialAspectCrop` / `fitAspectCrop` / `socialCropFitsAspect`).

    static func center(width: Double, height: Double, aspect: Double) -> SocialCrop {
        let imageAspect = width / max(1, height)
        if imageAspect > aspect {
            let w = aspect / imageAspect
            return SocialCrop(x: round((1 - w) / 2), y: 0, w: round(w), h: 1)
        }
        let h = imageAspect / aspect
        return SocialCrop(x: 0, y: round((1 - h) / 2), w: 1, h: round(h))
    }

    func fitted(width: Double, height: Double, aspect: Double) -> SocialCrop {
        let centerX = x + w / 2
        let centerY = y + h / 2
        var widthPx = min(1, max(0.08, w)) * width
        var heightPx = widthPx / aspect
        if heightPx > height { heightPx = height; widthPx = heightPx * aspect }
        if widthPx > width { widthPx = width; heightPx = widthPx / aspect }
        let nw = widthPx / width
        let nh = heightPx / height
        return SocialCrop(x: Self.round(min(max(centerX - nw / 2, 0), 1 - nw)), y: Self.round(min(max(centerY - nh / 2, 0), 1 - nh)),
                          w: Self.round(nw), h: Self.round(nh))
    }

    func zoomed(_ factor: Double, width: Double, height: Double, aspect: Double) -> SocialCrop {
        SocialCrop(x: x + (w - w * factor) / 2, y: y + (h - h * factor) / 2, w: w * factor, h: h * factor).fitted(width: width, height: height, aspect: aspect)
    }

    /// Kadr ma proporcje miejsca (tolerancja 1,5%).
    func fits(width: Double, height: Double, aspect: Double) -> Bool {
        let actual = (w * width) / max(1, h * height)
        return abs(actual / aspect - 1) < 0.015
    }

    var json: JSONValue { .object(["x": .number(x), "y": .number(y), "w": .number(w), "h": .number(h)]) }
}

struct SocialAccess: Codable, Hashable {
    var view: Bool
    var create: Bool
    var consent: Bool
    var approve: Bool
    var publish: Bool
    var admin: Bool
    var employeeId: String?
}

struct SocialCompany: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var isDefault: Bool
}

struct SocialSettings: Codable, Hashable {
    var aiCaptionsEnabled: Bool
    var aiConsentAt: String?
    /// Analiza AI w raporcie tygodniowym (Etap 3; zgoda akceptującego).
    var aiReportsEnabled: Bool?
    var aiReportsConsentAt: String?
    var defaultHashtags: [String]
    var captionStyle: String
    var updatedAt: String?
}

struct SocialTemplateColors: Codable, Hashable {
    var overlay: String?
    var accent: String?
    var text: String?
}

struct SocialTemplate: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var isDefault: Bool
    var ready: Bool
    var problems: [String]
    var logoId: String?
    var titleFontId: String?
    var captionFontId: String?
    var overlayColorId: String?
    var accentColorId: String?
    var textColorId: String?
    var colors: SocialTemplateColors
    var logoUrl: String?
    var titleFontLabel: String
    var captionFontLabel: String
    var updatedAt: String
    /// Styl grafik nowych postów marki (`classic` gdy brak).
    var defaultStyle: String?

    var graphicStyle: SocialGraphicStyle { SocialGraphicStyle(raw: defaultStyle) }
}

struct SocialPostItem: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var title: String
    var status: SocialPostStatus
    var channels: [SocialChannel]
    var scheduledAt: String?
    var captionPreview: String
    var thumbnailUrl: String?
    var formats: [SocialFormat]
    /// Liczba zdjęć w poście (okładka + karuzela; starszy serwer — brak).
    var photos: Int?
    /// Siatka profilu / panorama (duża grafika pocięta na kafelki; starszy serwer — brak).
    var canvas: SocialCanvasBrief?
    var authorId: String?
    var authorName: String?
    var revision: Int
    var approvedRevision: Int?
    var eventId: String?
    var publishedAt: String?
    var publishedUrl: String?
    var publishError: String?
    var updatedAt: String

    var scheduledDate: Date? { scheduledAt.flatMap(SocialDates.parse) }
    var displayTitle: String { title.isEmpty ? (captionPreview.isEmpty ? "Post bez tytułu" : captionPreview) : title }
}

struct SocialCounts: Codable, Hashable {
    var inReview: Int
    var changesRequested: Int
    var proposals: Int
    var failed: Int?
    var unansweredComments: Int?
}

/// Konto Meta marki (bez tokenów): strona, Instagram, gotowość kanałów do publikacji, komentarze, brakujące uprawnienia.
struct SocialMetaChannelState: Codable, Hashable {
    var ready: Bool
    var problem: String?
}

struct SocialMetaComments: Codable, Hashable {
    var facebookRead: Bool
    var facebookReply: Bool
    var instagram: Bool
}

/// Statystyki postów: Facebook — `read_insights`, Instagram — `instagram_manage_insights` (Etap 3).
struct SocialMetaInsights: Codable, Hashable {
    var facebook: Bool
    var instagram: Bool
}

/// Strona firmowa LinkedIn marki (kanał „LinkedIn — post”); gotowość kanału — `channels["linkedin_page"]`.
struct SocialLinkedInStatus: Codable, Hashable {
    var connected: Bool
    var organizationId: String?
    var organizationName: String?
    var comments: Bool
}

struct SocialMetaStatus: Codable, Hashable {
    var connected: Bool
    var pageId: String?
    var pageName: String?
    var instagramId: String?
    var instagramUsername: String?
    var channels: [String: SocialMetaChannelState]
    var comments: SocialMetaComments
    var insights: SocialMetaInsights?
    var missingScopes: [String]
    var lastError: String?
    var linkedin: SocialLinkedInStatus?

    func channel(_ channel: SocialChannel) -> SocialMetaChannelState? { channels[channel.rawValue] }
    /// LinkedIn bez połączonej strony — publikacja ręczna (paczka + „Oznacz jako opublikowany”), nie błąd.
    func manual(_ channel: SocialChannel) -> Bool { channel == .linkedinPage && linkedin?.connected != true }
    /// Kanały z automatyczną publikacją (Meta zawsze, LinkedIn po połączeniu strony) są gotowe.
    var allReady: Bool { SocialChannel.allCases.filter { !manual($0) }.allSatisfy { channel($0)?.ready == true } }
}

struct SocialRange: Codable, Hashable {
    var from: String
    var to: String
}

struct SocialHome: Codable {
    var companies: [SocialCompany]
    var company: SocialCompany
    var access: SocialAccess
    var range: SocialRange
    var settings: SocialSettings
    var templates: [SocialTemplate]
    var posts: [SocialPostItem]
    var counts: SocialCounts
    var meta: SocialMetaStatus?
}

struct SocialConsentState: Codable, Hashable {
    var status: String
    var channels: [String]
    var source: String
    var allows: Bool { status == "granted" || status == "not_required" }
    var label: String { (SocialConsentStatus(rawValue: status) ?? .unknown).label }
    var sourceLabel: String {
        switch source {
        case "asset": return "ustawiona dla zdjęcia"
        case "event": return "z eventu"
        case "organization": return "z klienta"
        default: return "brak ustaleń"
        }
    }
}

struct SocialAsset: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var kind: String
    var source: String
    var status: String
    var title: String
    var note: String
    var originalName: String
    var width: Double?
    var height: Double?
    var thumbnailUrl: String?
    var workUrl: String?
    var crops: [String: SocialCrop]
    var eventId: String?
    var eventName: String?
    var eventDate: String?
    var organizationId: String?
    var organizationName: String?
    var portfolioProjectId: String?
    var portfolioTitle: String?
    var visibleBrands: [String]
    var consentStatus: String
    var consentChannels: [String]
    var consentNote: String
    var consentBy: String?
    var consentAt: String?
    var consent: SocialConsentState
    var createdBy: String?
    var createdByName: String?
    var createdAt: String
    var updatedAt: String
    var usedIn: Int

    var displayTitle: String { title.isEmpty ? (originalName.isEmpty ? "Zdjęcie" : originalName) : title }
    var statusLabel: String {
        switch status {
        case "proposed": return "Propozycja"
        case "archived": return "Archiwum"
        case "uploading": return "Wgrywanie"
        default: return "W bibliotece"
        }
    }
    var sourceLabel: String {
        switch source {
        case "event_file": return "Z plików eventu"
        case "portfolio": return "Z realizacji na stronie"
        case "camera": return "Z telefonu"
        case "mac": return "Z Maca"
        default: return "Z dysku"
        }
    }
    func proposal(_ format: SocialFormat) -> SocialCrop? { crops[format.rawValue] }
}

struct SocialLibraryPage: Codable {
    var companies: [SocialCompany]
    var company: SocialCompany
    var access: SocialAccess
    var assets: [SocialAsset]
    var total: Int
    var offset: Int
    var limit: Int
    var proposals: Int
}

struct SocialAssetUsage: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var status: String
    var scheduledAt: String?
}

struct SocialAssetDetail: Codable {
    var asset: SocialAsset?
    var access: SocialAccess?
    var posts: [SocialAssetUsage]?
    var duplicateOf: String?
    var message: String?
}

struct SocialGuideRect: Codable, Hashable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct SocialGuides: Codable, Hashable {
    var logo: SocialGuideRect
    var text: SocialGuideRect
    var unsafeTop: SocialGuideRect?
    var unsafeBottom: SocialGuideRect?
    /// Widoczna część zdjęcia (passe-partout, kino); brak — zdjęcie na całej grafice.
    var window: SocialGuideRect?
}

struct SocialSpecLogo: Codable, Hashable {
    var src: String
    var aspect: Double?
}

/// Część danych szablonu potrzebna na Macu: gotowość, logo i strefy grafiki dla nakładki edytora kadru (styl → format).
struct SocialSpec: Codable, Hashable {
    var templateId: String
    var ready: Bool
    var logo: SocialSpecLogo?
    var guides: [String: SocialGuides]
    var styleGuides: [String: [String: SocialGuides]]?
    var defaultStyle: String?

    /// Strefy formatu w stylu grafiki (starszy serwer bez stylów — strefy stylu „Klasyczny”).
    func guides(_ style: SocialGraphicStyle, _ format: SocialFormat) -> SocialGuides? {
        styleGuides?[style.rawValue]?[format.rawValue] ?? guides[format.rawValue]
    }
}

struct SocialVariant: Codable, Identifiable, Hashable {
    var id: String
    var format: SocialFormat
    var assetId: String?
    var crop: SocialCrop?
    var effectiveCrop: SocialCrop?
    var headline: String
    var subline: String
    /// Styl grafiki i napis nad tytułem (starszy serwer — brak: „Klasyczny” bez napisu).
    var style: String?
    var kicker: String?
    /// Proporcje kadru: format albo — w układzie — miejsce zdjęcia 1 (starszy serwer — brak).
    var aspect: Double?
    var renderedUrl: String?
    var renderedAt: String?
    var upToDate: Bool
    var asset: SocialAsset?
}

/// Kolejne zdjęcie karuzeli (pozycja 1–9; okładka to warianty) z grafikami w formatach feedu.
struct SocialSlide: Codable, Hashable {
    struct Format: Codable, Hashable {
        var format: SocialFormat
        var crop: SocialCrop?
        var effectiveCrop: SocialCrop?
        var renderedUrl: String?
        var upToDate: Bool
    }
    var position: Int
    var assetId: String
    var asset: SocialAsset?
    var formats: [Format]

    func format(_ format: SocialFormat) -> Format? { formats.first { $0.format == format } }
}

// MARK: Układy grafik jako dane (`socialLayout.ts`)

/// Prostokąt 0…1 grafiki.
struct SocialLayoutRect: Codable, Hashable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    var json: JSONValue { .object(["x": .number(x), "y": .number(y), "w": .number(w), "h": .number(h)]) }
}

struct SocialLayoutFill: Codable, Hashable {
    var color: String
    var opacity: Double
}

struct SocialLayoutStroke: Codable, Hashable {
    var color: String
    var width: Double
    var opacity: Double
}

/// Element układu (zdjęcie, przyciemnienie, prostokąt, logo, tekst) — pola typu jak w definicji JSON.
struct SocialLayoutElement: Codable, Hashable, Identifiable {
    var id: String
    var type: String
    var rect: SocialLayoutRect
    var formats: [String: SocialLayoutRect]?
    var slot: Int?
    var radius: Double?
    var color: String?
    var direction: String?
    var from: Double?
    var to: Double?
    var fill: SocialLayoutFill?
    var stroke: SocialLayoutStroke?
    var align: String?
    var valign: String?
    var bind: String?
    var font: String?
    var size: Double?
    var tracking: Double?

    func rect(_ format: SocialFormat) -> SocialLayoutRect { formats?[format.rawValue] ?? rect }

    var json: JSONValue {
        var object: [String: JSONValue] = ["id": .string(id), "type": .string(type), "rect": rect.json]
        if let formats, !formats.isEmpty { object["formats"] = .object(formats.mapValues { $0.json }) }
        if let slot { object["slot"] = .number(Double(slot)) }
        if let radius { object["radius"] = .number(radius) }
        if let color { object["color"] = .string(color) }
        if let direction { object["direction"] = .string(direction) }
        if let from { object["from"] = .number(from) }
        if let to { object["to"] = .number(to) }
        if type == "box" {
            object["fill"] = fill.map { .object(["color": .string($0.color), "opacity": .number($0.opacity)]) } ?? .null
            object["stroke"] = stroke.map { .object(["color": .string($0.color), "width": .number($0.width), "opacity": .number($0.opacity)]) } ?? .null
        }
        if let align { object["align"] = .string(align) }
        if let valign { object["valign"] = .string(valign) }
        if let bind { object["bind"] = .string(bind) }
        if let font { object["font"] = .string(font) }
        if let size { object["size"] = .number(size) }
        if let tracking { object["tracking"] = .number(tracking) }
        return .object(object)
    }
}

// MARK: Duża grafika — siatka profilu i panorama (`socialLayout.ts`, Etap G)

/// Kafelek / slajd 4:5 i widoczna szerokość kafelka w siatce profilu (środek 3:4 kafelka 1080 × 1350).
let socialTileSize = (width: 1080.0, height: 1350.0)
let socialGridStep = 1012.5
let socialGridHidden = (1080.0 - 1012.5) / 2

/// Duża grafika: siatka profilu (rzędy po 3 kafelki) albo panorama (slajdy obok siebie).
struct SocialLayoutCanvas: Codable, Hashable {
    var mode: String
    var rows: Int?
    var slides: Int?

    var isGrid: Bool { mode == "grid" }
    var tileCount: Int { isGrid ? (rows ?? 1) * 3 : (slides ?? 2) }
    /// Wymiary w px: siatka 2 × 1012,5 + 1080 = 3105 szerokości, panorama — slajdy po 1080.
    var size: CGSize {
        isGrid ? CGSize(width: socialGridStep * 2 + socialTileSize.width, height: socialTileSize.height * Double(rows ?? 1))
            : CGSize(width: socialTileSize.width * Double(slides ?? 2), height: socialTileSize.height)
    }
    var label: String {
        isGrid ? "Siatka profilu — \(tileCount) \(tileCount == 3 ? "kafelki" : "kafelków")" : "Panorama — \(tileCount) \(tileCount == 5 ? "slajdów" : "slajdy")"
    }
    var shortLabel: String { isGrid ? "Siatka \(tileCount)" : "Panorama \(tileCount)" }

    /// Kafelki w kolejności czytania (1 — lewy górny): wycinek z dużej grafiki i widoczna część w siatce profilu (px).
    var tiles: [SocialCanvasTile] {
        if isGrid {
            return (0..<(rows ?? 1)).flatMap { row in
                (0..<3).map { col -> SocialCanvasTile in
                    let left = Double(col) * socialGridStep
                    return SocialCanvasTile(position: row * 3 + col + 1,
                                            frame: CGRect(x: left.rounded(), y: Double(row) * socialTileSize.height, width: socialTileSize.width, height: socialTileSize.height),
                                            visible: CGRect(x: left + socialGridHidden, y: Double(row) * socialTileSize.height, width: socialGridStep, height: socialTileSize.height))
                }
            }
        }
        return (0..<(slides ?? 2)).map { col in
            let rect = CGRect(x: Double(col) * socialTileSize.width, y: 0, width: socialTileSize.width, height: socialTileSize.height)
            return SocialCanvasTile(position: col + 1, frame: rect, visible: rect)
        }
    }

    /// Styki po złożeniu (px) i pasy obcinane w siatce profilu (po bokach całej grafiki).
    var seamsX: [Double] { isGrid ? [1.0, 2.0].map { socialGridHidden + $0 * socialGridStep } : (1..<max(2, slides ?? 2)).map { Double($0) * socialTileSize.width } }
    var seamsY: [Double] { isGrid && (rows ?? 1) > 1 ? (1..<(rows ?? 1)).map { Double($0) * socialTileSize.height } : [] }
    var hiddenStrips: [(x: Double, w: Double)] { isGrid ? [(x: 0, w: socialGridHidden), (x: size.width - socialGridHidden, w: socialGridHidden)] : [] }

    var json: JSONValue {
        var object: [String: JSONValue] = ["mode": .string(mode)]
        if let rows { object["rows"] = .number(Double(rows)) }
        if let slides { object["slides"] = .number(Double(slides)) }
        return .object(object)
    }
}

/// Elementy przechodzące przez styk kafelków (logo, teksty, prostokąty) albo wchodzące w pas obcinany w siatce — w feedzie
/// byłyby przecięte (`socialCanvasCrossings` w `socialLayout.ts`; ostrzeżenie, bez blokady).
func socialCanvasCrossings(_ definition: SocialLayoutDefinition) -> [String] {
    guard let canvas = definition.canvas else { return [] }
    let size = canvas.size
    return definition.elements.compactMap { element in
        if element.type == "photo" || element.type == "shade" { return nil }
        let left = element.rect.x * size.width
        let right = (element.rect.x + element.rect.w) * size.width
        let top = element.rect.y * size.height
        let bottom = (element.rect.y + element.rect.h) * size.height
        let crosses = canvas.seamsX.contains { left < $0 - 1 && right > $0 + 1 } || canvas.seamsY.contains { top < $0 - 1 && bottom > $0 + 1 }
            || canvas.hiddenStrips.contains { left < $0.x + $0.w - 1 && right > $0.x + 1 }
        return crosses ? element.id : nil
    }
}

struct SocialCanvasTile: Hashable {
    let position: Int
    let frame: CGRect
    let visible: CGRect
}

/// Siatka / panorama w kalendarzu (rodzaj i liczba kafelków).
struct SocialCanvasBrief: Codable, Hashable {
    var mode: String
    var tiles: Int
    var label: String { mode == "grid" ? "Siatka · \(tiles) \(tiles == 3 ? "kafelki" : "kafelków")" : "Panorama · \(tiles) \(tiles == 5 ? "slajdów" : "slajdy")" }
}

/// Duża grafika w karcie posta (z serwera).
struct SocialCanvasInfo: Codable, Hashable {
    var mode: String
    var rows: Int?
    var slides: Int?
    var tiles: Int
    var width: Double
    var height: Double
    var label: String
}

/// Kafelek po zapisie (plik z serwera; 1 — lewy górny).
struct SocialTile: Codable, Hashable {
    var position: Int
    var renderedUrl: String?
    var upToDate: Bool
}

/// Definicja układu: tło (rola koloru szablonu), elementy w kolejności rysowania (zdjęcia zawsze pod resztą); `canvas` —
/// duża grafika (siatka profilu, panorama): prostokąty względem całej grafiki, rozmiary w px kafelka 1080.
struct SocialLayoutDefinition: Codable, Hashable {
    var v: Int
    var background: String
    var elements: [SocialLayoutElement]
    var canvas: SocialLayoutCanvas?

    /// Wymiary rysowania: duża grafika albo format posta.
    func frameSize(_ format: SocialFormat) -> CGSize { canvas?.size ?? CGSize(width: format.width, height: format.height) }
    /// Proporcje całej grafiki (szerokość / wysokość).
    func aspect(_ format: SocialFormat) -> Double {
        let size = frameSize(format)
        return size.width / max(1, size.height)
    }

    /// Liczba miejsc na zdjęcia (miejsce 0 — zdjęcie wariantu, kolejne — kolaż).
    var slots: Int { max(1, elements.compactMap { $0.type == "photo" ? ($0.slot ?? 0) + 1 : nil }.max() ?? 1) }

    func slotRect(_ slot: Int, _ format: SocialFormat) -> SocialLayoutRect? {
        elements.first { $0.type == "photo" && ($0.slot ?? 0) == slot }?.rect(format)
    }

    /// Proporcje miejsca w px formatu (szerokość / wysokość) — kadr zdjęcia w układzie ma te proporcje.
    func slotAspect(_ slot: Int, _ format: SocialFormat) -> Double {
        let size = frameSize(format)
        guard let rect = slotRect(slot, format) else { return size.width / max(1, size.height) }
        return max(0.05, (rect.w * size.width) / max(1, rect.h * size.height))
    }

    /// Zaokrąglenie rogów miejsca (px dla szerokości 1080).
    func slotRadius(_ slot: Int) -> Double { elements.first { $0.type == "photo" && ($0.slot ?? 0) == slot }?.radius ?? 0 }
    /// Zaokrąglenie do podglądu rysowanego w skali „szerokość / 1080”: duża grafika ma promienie w px kafelka na całej
    /// szerokości (3105 / 1080·n), więc przeliczamy je na tę skalę (jak `radius * scale` w HTML renderu).
    func previewRadius(_ slot: Int) -> Double {
        guard let canvas else { return slotRadius(slot) }
        return slotRadius(slot) * 1080 / max(1, canvas.size.width)
    }

    var json: JSONValue {
        var object: [String: JSONValue] = ["v": .number(Double(v)), "background": .string(background), "elements": .array(elements.map(\.json))]
        if let canvas { object["canvas"] = canvas.json }
        return .object(object)
    }
}

/// Układ do wyboru w kreatorze: układ marki (`id`) albo gotowy (`key`).
struct SocialLayoutOption: Codable, Hashable {
    var id: String?
    var key: String?
    var name: String
    var description: String
    var definition: SocialLayoutDefinition
    var slots: Int
    var archived: Bool
    var choice: SocialLayoutChoice { SocialLayoutChoice(id: id, key: key) }
    /// Klucz listy (gotowe układy nie mają `id`).
    var identity: String { id ?? key ?? name }
}

/// Wybrany układ (`id` — układ marki, `key` — gotowy).
struct SocialLayoutChoice: Hashable {
    var id: String?
    var key: String?
    var json: JSONValue { json(refresh: false) }
    /// `refresh` — ten sam układ w aktualnej wersji (zmieniony w edytorze układów po zapisaniu posta).
    func json(refresh: Bool) -> JSONValue {
        var object: [String: JSONValue] = ["id": id.map { .string($0) } ?? .null, "key": key.map { .string($0) } ?? .null]
        if refresh { object["refresh"] = .bool(true) }
        return .object(object)
    }
}

/// Układ posta (migawka definicji zapisana w wariantach).
struct SocialPostLayout: Codable, Hashable {
    var id: String?
    var key: String?
    var name: String
    var definition: SocialLayoutDefinition
    var slots: Int
    /// Układ zmieniono po zapisaniu posta (post ma migawkę) — „Wczytaj nową wersję” (starszy serwer — brak).
    var outdated: Bool?
    var choice: SocialLayoutChoice { SocialLayoutChoice(id: id, key: key) }
}

/// Układ marki w edytorze układów (`op=layouts`).
struct SocialLayoutItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var definition: SocialLayoutDefinition
    var slots: Int
    var archived: Bool
    /// Liczba postów z tym układem (usunąć można tylko nieużywany — inaczej archiwum).
    var usedBy: Int
    var updatedAt: String
}

/// Gotowy układ — punkt wyjścia nowego układu marki.
struct SocialLayoutPreset: Codable, Identifiable, Hashable {
    var key: String
    var name: String
    var description: String
    var definition: SocialLayoutDefinition
    var slots: Int
    var id: String { key }
}

/// Odpowiedź edytora układów: układy marki (także archiwalne), gotowe układy, szablon marki do podglądu (logo, fonty,
/// kolory z księgi znaku); po zapisie — `savedId`. Kopia na dysku per marka.
struct SocialLayoutsReply: Codable, Hashable {
    var companyId: String
    var access: SocialAccess
    var layouts: [SocialLayoutItem]
    var presets: [SocialLayoutPreset]
    var template: SocialTemplate?
    var spec: SocialSpec?
    var savedId: String?
}

/// Limity edytora układów (te same co `SOCIAL_LAYOUT_LIMITS`).
enum SocialLayoutLimits {
    static let elements = 40
    static let slots = 4
    static let name = 80
}

extension SocialLayoutDefinition {
    /// Powód, dla którego definicji nie da się zapisać — 1:1 z `socialLayoutProblem` (`nil` — w porządku).
    var problem: String? {
        if elements.isEmpty { return "Dodaj elementy układu." }
        if elements.count > SocialLayoutLimits.elements { return "Układ może mieć najwyżej \(SocialLayoutLimits.elements) elementów." }
        let used = Array(Set(elements.filter { $0.type == "photo" }.map { $0.slot ?? 0 })).sorted()
        if used.isEmpty || used.enumerated().contains(where: { $0.offset != $0.element }) {
            return "Układ musi mieć zdjęcie 1, a kolejne zdjęcia kolażu numerowane po kolei (2, 3, 4)."
        }
        return nil
    }
}

/// Zdjęcie kolażu w miejscu 1–3 (miejsce 0 — zdjęcie wariantu) z kadrami w formatach posta.
struct SocialSlot: Codable, Hashable {
    struct Format: Codable, Hashable {
        var format: SocialFormat
        var crop: SocialCrop?
        var effectiveCrop: SocialCrop?
        var aspect: Double
    }
    var slot: Int
    var assetId: String
    var asset: SocialAsset?
    var formats: [Format]
    func format(_ format: SocialFormat) -> Format? { formats.first { $0.format == format } }
}

/// Karuzela: najwyżej 9 kolejnych zdjęć (Instagram — 10 w poście), tylko formaty feedu (`SOCIAL_SLIDE_FORMATS`).
let socialSlidesLimit = 9
let socialSlideFormats: [SocialFormat] = [.portrait, .square, .landscape]

struct SocialAiSuggestion: Codable, Hashable {
    var caption: String
    var hashtags: [String]
    var headline: String
    var subline: String
}

// MARK: Asystent AI (te same wartości co `SOCIAL_AI_*` w `src/lib/social/socialShared.ts`)

enum SocialAiGoal: String, CaseIterable, Identifiable {
    case realization, backstage, announcement, offer, team, inspiration
    var id: String { rawValue }
    var label: String {
        switch self {
        case .realization: return "Realizacja"
        case .backstage: return "Za kulisami"
        case .announcement: return "Zapowiedź"
        case .offer: return "Oferta i usługi"
        case .team: return "Zespół i sprzęt"
        case .inspiration: return "Inspiracja"
        }
    }
}

enum SocialAiTone: String, CaseIterable, Identifiable {
    case elegant, warm, factual, energetic
    var id: String { rawValue }
    var label: String {
        switch self {
        case .elegant: return "Elegancki"
        case .warm: return "Ciepły"
        case .factual: return "Rzeczowy"
        case .energetic: return "Energiczny"
        }
    }
}

enum SocialAiLength: String, CaseIterable, Identifiable {
    case short, medium, long
    var id: String { rawValue }
    var label: String { self == .short ? "Krótki" : self == .medium ? "Średni" : "Dłuższy" }
}

enum SocialAiRewrite: String, CaseIterable, Identifiable {
    case shorter, elegant, cta, story, fix, english
    var id: String { rawValue }
    var label: String {
        switch self {
        case .shorter: return "Krócej"
        case .elegant: return "Bardziej elegancko"
        case .cta: return "Dodaj zaproszenie do kontaktu"
        case .story: return "Jak krótka historia"
        case .fix: return "Popraw język"
        case .english: return "Po angielsku"
        }
    }
}

struct SocialAiHashtagGroup: Codable, Hashable {
    var key: String
    var label: String
    var tags: [String]
}

/// Odpowiedź asystenta (`op=assist`) — bez zapisu w poście.
struct SocialAssistReply: Codable {
    var mode: String
    var suggestions: [SocialAiSuggestion]
    var hashtagGroups: [SocialAiHashtagGroup]
    var usedPhoto: Bool
    var photoNote: String?
}

// MARK: Style grafik (te same wartości co `SOCIAL_GRAPHIC_STYLES` w `src/lib/social/socialShared.ts`)

enum SocialGraphicStyle: String, CaseIterable, Identifiable {
    case classic, frame, mat, cinema, vignette, cover
    var id: String { rawValue }

    init(raw: String?) { self = raw.flatMap { SocialGraphicStyle(rawValue: $0) } ?? .classic }

    var label: String {
        switch self {
        case .classic: return "Klasyczny"
        case .frame: return "Rama"
        case .mat: return "Passe-partout"
        case .cinema: return "Kino"
        case .vignette: return "Winieta"
        case .cover: return "Okładka"
        }
    }

    var hint: String {
        switch self {
        case .classic: return "Zdjęcie na całej grafice, przyciemniona góra i dół, logo u góry, tytuł i podpis na dole."
        case .frame: return "Jak klasyczny, z cienką ramką w kolorze akcentu i miękkim cieniem przy krawędziach."
        case .mat: return "Zdjęcie w passe-partout w kolorze marki z linią akcentu; tytuł i podpis na pasie pod zdjęciem."
        case .cinema: return "Kinowe pasy u góry i u dołu: logo na górnym pasie, tytuł i podpis na dolnym."
        case .vignette: return "Ciemna winieta wokół kadru — mocniejszy nastrój i uwaga na środku zdjęcia."
        case .cover: return "Układ okładki: logo w rogu, duży tytuł wyrównany do lewej."
        }
    }
}

/// Podpowiedzi napisu nad tytułem (jak `SOCIAL_KICKER_SUGGESTIONS`) i limity (jak `SOCIAL_LIMITS.kicker`).
let socialKickerSuggestions = ["Realizacja", "Za kulisami", "Zapowiedź", "Case study", "Nowość"]
let socialKickerLimit = 40
let socialKickerRecommended = 22

/// Zalecana liczba hashtagów (jak `SOCIAL_HASHTAGS_RECOMMENDED`).
let socialHashtagsRecommended = 3...12

/// Przełącza hashtag (dodaje na końcu albo usuwa) — bez względu na wielkość liter (jak `toggleHashtag`).
func socialToggleHashtag(_ current: [String], _ tag: String) -> [String] {
    guard let normalized = socialHashtags(tag).first else { return current }
    let key = normalized.lowercased()
    return current.contains { $0.lowercased() == key } ? current.filter { $0.lowercased() != key } : current + [normalized]
}

struct SocialPostFull: Codable, Hashable {
    var id: String
    var companyId: String
    var title: String
    var status: SocialPostStatus
    var channels: [SocialChannel]
    var scheduledAt: String?
    var captionPreview: String
    var thumbnailUrl: String?
    var formats: [SocialFormat]
    /// Liczba zdjęć w poście (okładka + karuzela; starszy serwer — brak).
    var photos: Int?
    /// Siatka profilu / panorama (duża grafika pocięta na kafelki; starszy serwer — brak).
    var canvas: SocialCanvasBrief?
    var authorId: String?
    var authorName: String?
    var revision: Int
    var approvedRevision: Int?
    var eventId: String?
    var publishedAt: String?
    var publishedUrl: String?
    var updatedAt: String
    var caption: String
    var hashtags: [String]
    var templateId: String?
    var portfolioProjectId: String?
    var aiSuggestions: [SocialAiSuggestion]
    var submittedAt: String?
    var reviewedAt: String?
    var reviewedByName: String?
    var reviewNote: String?
    var publishedByName: String?
    var scheduledByName: String?
    var publishAttempts: Int?
    var publishError: String?
    var createdAt: String
}

struct SocialProblems: Codable, Hashable {
    var submit: [String]
    var publish: [String]
    /// Co blokuje publikację w Meta (konto, uprawnienia, grafiki).
    var meta: [String]?
}

/// Stan publikacji kanału w Meta (link albo błąd).
struct SocialPublication: Codable, Hashable {
    var channel: SocialChannel
    /// Kafelek siatki profilu (osobny post Instagram); 0 albo brak — cały post.
    var tile: Int?
    var status: String
    var format: SocialFormat?
    var permalink: String?
    var error: String?
    var attempts: Int
    var publishedAt: String?
    var attemptedAt: String?
    /// Wyniki z Meta (Etap 3): stan narastająco od publikacji; brak wartości — Meta nie podaje metryki dla kanału.
    var metrics: SocialMetricValues?
    var rate: Double?
    var metricsSyncedAt: String?
    var metricsError: String?

    var statusLabel: String {
        switch status {
        case "published": return "Opublikowano"
        case "sending": return "Wysyłanie"
        case "failed": return "Błąd"
        default: return "Czeka"
        }
    }
}

struct SocialCommentCounts: Codable, Hashable {
    var total: Int
    var unanswered: Int
}

struct SocialPublishResult: Codable, Hashable {
    var status: String
    var error: String?
}

/// Komentarz Facebook / Instagram / LinkedIn (`isOwn` — konto marki; `repliedByName` — odpowiedź wysłana z CRM).
struct SocialComment: Codable, Identifiable, Hashable {
    var id: String
    var platform: String
    var authorName: String
    var isOwn: Bool
    var message: String
    var commentedAt: String
    var likeCount: Int
    var answeredAt: String?
    var repliedByName: String?

    var platformLabel: String { SocialCommentPlatform.label(platform) }
}

/// Platforma komentarza (jak `SOCIAL_COMMENT_PLATFORM_LABELS`, `SOCIAL_REPLY_SUCCESS`, `SOCIAL_REPLY_AUTHOR`).
enum SocialCommentPlatform {
    static func label(_ platform: String) -> String {
        platform == "facebook" ? "Facebook" : platform == "linkedin" ? "LinkedIn" : "Instagram"
    }
    static func replySuccess(_ platform: String) -> String {
        platform == "facebook" ? "Odpowiedź opublikowana na Facebooku"
            : platform == "linkedin" ? "Odpowiedź opublikowana na LinkedInie" : "Odpowiedź opublikowana na Instagramie"
    }
    static func replyAuthor(_ platform: String) -> String {
        platform == "facebook" ? "strona marki" : platform == "linkedin" ? "strona firmowa marki" : "profil marki"
    }
    static func symbol(_ platform: String) -> String {
        platform == "facebook" ? "f.square" : platform == "linkedin" ? "building.2" : "camera"
    }
}

struct SocialCommentPost: Codable, Hashable {
    var id: String
    var title: String
    var thumbnailUrl: String?
}

struct SocialCommentThread: Codable, Identifiable, Hashable {
    var id: String
    var platform: String
    var authorName: String
    var isOwn: Bool
    var message: String
    var commentedAt: String
    var likeCount: Int
    var answeredAt: String?
    var repliedByName: String?
    var postId: String
    var permalink: String?
    var post: SocialCommentPost?
    var replies: [SocialComment]

    var root: SocialComment {
        SocialComment(id: id, platform: platform, authorName: authorName, isOwn: isOwn, message: message, commentedAt: commentedAt,
                      likeCount: likeCount, answeredAt: answeredAt, repliedByName: repliedByName)
    }
}

struct SocialReplyChannels: Codable, Hashable {
    var facebook: Bool
    var instagram: Bool
    var linkedin: Bool?
}

struct SocialCommentsReply: Codable, Hashable {
    var companyId: String
    var threads: [SocialCommentThread]
    var unanswered: Int
    var canReply: Bool
    var replyChannels: SocialReplyChannels

    func canReply(to thread: SocialCommentThread) -> Bool {
        guard canReply else { return false }
        switch thread.platform {
        case "facebook": return replyChannels.facebook
        case "linkedin": return replyChannels.linkedin == true
        default: return replyChannels.instagram
        }
    }
}

struct SocialHistoryItem: Codable, Hashable {
    var kind: String
    var actorName: String?
    var note: String?
    var revision: Int?
    var createdAt: String
    var label: String {
        switch kind {
        case "created": return "Utworzono"
        case "submitted": return "Wysłano do akceptacji"
        case "approved": return "Zatwierdzono"
        case "changes_requested": return "Do poprawy"
        case "reopened": return "Przywrócono do szkicu"
        case "edited_after_approval": return "Zmiana po zatwierdzeniu"
        case "cancelled": return "Anulowano"
        case "published": return "Opublikowano"
        case "scheduled": return "Zaplanowano publikację"
        case "unscheduled": return "Wstrzymano publikację"
        case "publish_failed": return "Błąd publikacji"
        default: return kind
        }
    }
}

struct SocialEventSummary: Codable, Hashable {
    var id: String
    var name: String
    var date: String?
    var location: String
    var organizationName: String?
}

struct SocialPortfolioSummary: Codable, Hashable {
    var id: String
    var title: String
}

struct SocialGridItem: Codable, Identifiable, Hashable {
    var id: String
    var status: SocialPostStatus
    var imageUrl: String?
    var date: String?
    /// `crm` — post z kalendarza, `instagram` — ostatni post z profilu.
    var source: String?
    var permalink: String?
}

struct SocialNamedCompany: Codable, Hashable {
    var id: String
    var name: String
}

struct SocialPostDetail: Codable {
    var company: SocialNamedCompany
    var post: SocialPostFull
    var access: SocialAccess
    var actions: [SocialPostAction]
    var canPublishNow: Bool?
    var variants: [SocialVariant]
    /// Karuzela (starszy serwer — brak).
    var slides: [SocialSlide]?
    /// Układ jako dane, układy do wyboru i zdjęcia kolażu (starszy serwer — brak).
    var layout: SocialPostLayout?
    var layouts: [SocialLayoutOption]?
    var slots: [SocialSlot]?
    /// Siatka profilu / panorama: kształt, kafelki po zapisie i gotowe układy dużej grafiki (starszy serwer — brak).
    var canvas: SocialCanvasInfo?
    var tiles: [SocialTile]?
    var canvasLayouts: [SocialLayoutOption]?
    var problems: SocialProblems
    var publications: [SocialPublication]?
    var meta: SocialMetaStatus?
    var comments: SocialCommentCounts?
    var publishResult: SocialPublishResult?
    var history: [SocialHistoryItem]
    var template: SocialTemplate?
    var templates: [SocialTemplate]
    var spec: SocialSpec?
    var event: SocialEventSummary?
    var portfolio: SocialPortfolioSummary?
    var grid: [SocialGridItem]
    var publicationText: String
    var settings: SocialSettings

    func variant(_ format: SocialFormat) -> SocialVariant? { variants.first { $0.format == format } }
    var formatsWithPhoto: [SocialFormat] { variants.filter { $0.assetId != nil }.map(\.format) }
}

struct SocialConsentRecord: Codable, Hashable {
    var id: String
    var eventId: String?
    var organizationId: String?
    var status: String
    var channels: [String]
    var note: String
    var decidedAt: String?
}

struct SocialEventOption: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var date: String?
    var location: String
    var organizationId: String?
    var organizationName: String?
    var eventConsent: SocialConsentRecord?
    var organizationConsent: SocialConsentRecord?
}

struct SocialEventsReply: Codable { var events: [SocialEventOption] }

struct SocialEventFile: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var url: String?
    var bytes: Double?
    var imported: Bool
}

struct SocialEventFilesReply: Codable { var files: [SocialEventFile] }

struct SocialPortfolioProject: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var location: String
    var date: String?
    var images: [String]
}

struct SocialPortfolioReply: Codable { var projects: [SocialPortfolioProject] }

struct SocialBrandLogo: Codable, Identifiable, Hashable {
    var id: String
    var label: String
    var variant: String
    var background: String
    var url: String?
}

struct SocialBrandFont: Codable, Identifiable, Hashable {
    var id: String
    var label: String
    var family: String
    var role: String
    var hasFile: Bool
}

struct SocialBrandColor: Codable, Identifiable, Hashable {
    var id: String
    var label: String
    var hex: String
    var role: String
}

struct SocialBrandbook: Codable {
    var logos: [SocialBrandLogo]
    var fonts: [SocialBrandFont]
    var colors: [SocialBrandColor]
}

struct SocialUploadTicket: Codable {
    var assetId: String
    var bucket: String
    var path: String
    var companyId: String
    var proposal: Bool
}

// MARK: Statystyki (Etap 3) — te same metryki, pory i formatowanie co `socialShared.ts` w CRM i w telefonie.

enum SocialMetric: String, CaseIterable, Identifiable {
    case views, reach, interactions, saves, profileVisits, shares, likes, comments, follows, clicks, replies
    var id: String { rawValue }
    static let kpis: [SocialMetric] = [.views, .reach, .interactions, .saves, .profileVisits]

    var label: String {
        switch self {
        case .views: return "Wyświetlenia"
        case .reach: return "Zasięg"
        case .interactions: return "Interakcje"
        case .saves: return "Zapisania"
        case .profileVisits: return "Wejścia na profil"
        case .shares: return "Udostępnienia"
        case .likes: return "Polubienia i reakcje"
        case .comments: return "Komentarze"
        case .follows: return "Nowi obserwujący"
        case .clicks: return "Kliknięcia"
        case .replies: return "Odpowiedzi na relację"
        }
    }

    var hint: String {
        switch self {
        case .views: return "Ile razy treść została wyświetlona (z powtórzeniami)."
        case .reach: return "Liczba osób (kont), które zobaczyły treść — na Facebooku: unikalne wyświetlenia."
        case .interactions: return "Polubienia, komentarze, zapisania i udostępnienia razem."
        case .saves: return "Ile osób zapisało post na Instagramie."
        case .profileVisits: return "Wejścia na profil Instagram z tego posta lub relacji."
        case .shares: return "Udostępnienia posta."
        case .likes: return "Polubienia (Instagram) i reakcje (Facebook)."
        case .comments: return "Komentarze pod postem."
        case .follows: return "Konta, które zaczęły obserwować profil po tym poście."
        case .clicks: return "Kliknięcia w post na Facebooku."
        case .replies: return "Odpowiedzi na relację Instagram."
        }
    }
}

/// Wyniki postu / kanału (brak wartości — Meta nie podaje metryki).
struct SocialMetricValues: Codable, Hashable {
    var views: Double? = nil
    var reach: Double? = nil
    var interactions: Double? = nil
    var saves: Double? = nil
    var profileVisits: Double? = nil
    var shares: Double? = nil
    var likes: Double? = nil
    var comments: Double? = nil
    var follows: Double? = nil
    var clicks: Double? = nil
    var replies: Double? = nil

    subscript(metric: SocialMetric) -> Double? {
        switch metric {
        case .views: return views
        case .reach: return reach
        case .interactions: return interactions
        case .saves: return saves
        case .profileVisits: return profileVisits
        case .shares: return shares
        case .likes: return likes
        case .comments: return comments
        case .follows: return follows
        case .clicks: return clicks
        case .replies: return replies
        }
    }

    var available: [SocialMetric] { SocialMetric.allCases.filter { self[$0] != nil } }
}

/// Suma wyników publikacji: `posts` — posty, `publications` — kanały, `rate` — interakcje / zasięg.
struct SocialTotals: Codable, Hashable {
    var posts: Int
    var publications: Int
    var rate: Double?
    var views: Double?
    var reach: Double?
    var interactions: Double?
    var saves: Double?
    var profileVisits: Double?
    var shares: Double?
    var likes: Double?
    var comments: Double?
    var follows: Double?
    var clicks: Double?
    var replies: Double?

    var metrics: SocialMetricValues {
        SocialMetricValues(views: views, reach: reach, interactions: interactions, saves: saves, profileVisits: profileVisits, shares: shares,
                           likes: likes, comments: comments, follows: follows, clicks: clicks, replies: replies)
    }
}

struct SocialChannelTotals: Codable, Hashable, Identifiable {
    var channel: SocialChannel
    var totals: SocialTotals
    var id: String { channel.rawValue }
}

/// Pora publikacji (dzień od poniedziałku = 0, pasmo godzin — `SocialNumbers.timeBands`) i średni wynik postów w tej porze.
struct SocialBestTime: Codable, Hashable, Identifiable {
    var weekday: Int
    var band: Int
    var label: String
    var posts: Int
    var rate: Double
    var avgReach: Double
    var avgInteractions: Double
    var id: String { "\(weekday)-\(band)" }
}

struct SocialBestTimes: Codable, Hashable {
    var sample: Int
    var minSample: Int
    var cells: [SocialBestTime]
    var top: [SocialBestTime]

    func cell(_ weekday: Int, _ band: Int) -> SocialBestTime? { cells.first { $0.weekday == weekday && $0.band == band } }
}

struct SocialTopPost: Codable, Hashable, Identifiable {
    var postId: String
    var title: String
    var channels: [SocialChannel]
    var publishedAt: String?
    var permalink: String?
    var metrics: SocialMetricValues
    var thumbnailUrl: String?
    var id: String { postId }
}

struct SocialTimelinePoint: Codable, Hashable {
    var date: String
    var views: Double
    var interactions: Double
}

struct SocialRecommendation: Codable, Hashable {
    var title: String
    var rationale: String
    var priority: String
    var channel: String

    var priorityLabel: String {
        switch priority {
        case "high": return "Wysoki"
        case "low": return "Niski"
        default: return "Średni"
        }
    }
    var priorityColor: Color {
        switch priority {
        case "high": return .red
        case "low": return .secondary
        default: return .orange
        }
    }
}

struct SocialReportSummary: Codable, Hashable, Identifiable {
    var id: String
    var periodStart: String
    var periodEnd: String
    var summary: String
    var aiUsed: Bool
    var createdAt: String
    var updatedAt: String?
}

struct SocialReportComments: Codable, Hashable {
    var received: Int
    var unanswered: Int
}

/// Raport tygodniowy „Trendy i rekomendacje” (`marketing_ai_insights`, `kind = social_weekly`).
struct SocialReport: Codable, Hashable, Identifiable {
    var id: String
    var periodStart: String
    var periodEnd: String
    var summary: String
    var aiUsed: Bool
    var createdAt: String
    var updatedAt: String?
    var trends: [String]
    var recommendations: [SocialRecommendation]
    var risks: [String]
    var opportunities: [String]
    var model: String?
    var totals: SocialTotals?
    var previous: SocialTotals?
    var channels: [SocialChannelTotals]
    var topPosts: [SocialTopPost]
    var bestTimes: [SocialBestTime]
    var comments: SocialReportComments?
    var scheduledNext: Int?
    var aiNote: String?
}

struct SocialStatsRange: Codable, Hashable {
    var days: Int
    var from: String
    var to: String
}

struct SocialStatsSync: Codable, Hashable {
    var publications: Int
    var withMetrics: Int
    var lastSyncedAt: String?
    var problems: [String]
}

struct SocialStatsInsights: Codable, Hashable {
    var connected: Bool
    var facebook: Bool
    var instagram: Bool
    var missingScopes: [String]
}

struct SocialStatsSettings: Codable, Hashable {
    var aiReportsEnabled: Bool
    var aiReportsConsentAt: String?
}

/// Zakładka „Statystyki” (`op=stats`).
struct SocialStats: Codable {
    var companies: [SocialCompany]
    var company: SocialCompany
    var access: SocialAccess
    var range: SocialStatsRange
    var totals: SocialTotals
    var previous: SocialTotals
    var channels: [SocialChannelTotals]
    var timeline: [SocialTimelinePoint]
    var bestTimes: SocialBestTimes
    var topPosts: [SocialTopPost]
    var sync: SocialStatsSync
    var insights: SocialStatsInsights
    var reports: [SocialReportSummary]
    var report: SocialReport?
    var settings: SocialStatsSettings
    var canRefresh: Bool
    var canGenerate: Bool
    var lastWeekStart: String
}

/// Liczby jak w CRM: „1 234”, „12,3 tys.”, „1,2 mln”, „4,2%”, zmiana „+12%” / „−5%” / „nowe”, okres „10–16.11.2026”.
enum SocialNumbers {
    static let ranges = [7, 28, 90]
    static let timeBands = ["0–6", "6–9", "9–12", "12–15", "15–18", "18–21", "21–24"]
    static let weekdaysShort = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"]

    static func number(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let sign = value < 0 ? "−" : ""
        let magnitude = abs(value)
        if magnitude >= 1_000_000 { return sign + String(format: "%.1f", magnitude / 1_000_000).replacingOccurrences(of: ".", with: ",") + " mln" }
        if magnitude >= 10_000 { return sign + String(format: "%.1f", magnitude / 1000).replacingOccurrences(of: ".", with: ",") + " tys." }
        let digits = Array(String(Int(magnitude.rounded())))
        var result = ""
        for (index, digit) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { result.append("\u{00A0}") }
            result.append(digit)
        }
        return sign + result
    }

    static func number(_ value: Int) -> String { number(Double(value)) }

    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.1f", value * 100).replacingOccurrences(of: ".", with: ",") + "%"
    }

    static func change(_ current: Double?, _ previous: Double?) -> String? {
        guard let current, let previous else { return nil }
        if previous == 0 { return current > 0 ? "nowe" : nil }
        let change = Int(((current - previous) / previous * 100).rounded())
        if change == 0 { return "0%" }
        return change > 0 ? "+\(change)%" : "−\(abs(change))%"
    }

    static func period(_ start: String, _ end: String) -> String {
        let a = start.split(separator: "-").map(String.init)
        let b = end.split(separator: "-").map(String.init)
        guard a.count == 3, b.count == 3 else { return [start, end].filter { !$0.isEmpty }.joined(separator: " – ") }
        let dayA = String(a[2].prefix(2)), dayB = String(b[2].prefix(2))
        if a[0] != b[0] { return "\(dayA).\(a[1]).\(a[0])–\(dayB).\(b[1]).\(b[0])" }
        if a[1] != b[1] { return "\(dayA).\(a[1])–\(dayB).\(b[1]).\(b[0])" }
        return "\(dayA)–\(dayB).\(b[1]).\(b[0])"
    }

    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        let n = abs(count)
        if n == 1 { return one }
        return (2...4).contains(n % 10) && !(12...14).contains(n % 100) ? few : many
    }
}

enum SocialDates {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ value: String) -> Date? { fractional.date(from: value) ?? plain.date(from: value) }
    static func iso(_ date: Date) -> String { fractional.string(from: date) }
    static func dateTime(_ value: String?) -> String {
        guard let value, let date = parse(value) else { return "" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }
}

/// Hashtagi jak w CRM: „#” na początku, bez spacji i interpunkcji, bez powtórzeń, w kolejności wpisania.
func socialHashtags(_ raw: String) -> [String] {
    let separators = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;"))
    let banned = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "[]#.,;:!?\"'()<>{}/\\|"))
    var seen = Set<String>()
    var result: [String] = []
    for part in raw.components(separatedBy: separators) {
        let cleaned = String(part.unicodeScalars.filter { !banned.contains($0) })
        guard !cleaned.isEmpty else { continue }
        let tag = "#" + cleaned
        let key = tag.lowercased()
        if seen.insert(key).inserted { result.append(tag) }
    }
    return result
}

/// Tekst do publikacji: opis i hashtagi (oddzielone pustą linią).
func socialPublicationText(_ caption: String, _ hashtags: [String]) -> String {
    let body = caption.trimmingCharacters(in: .whitespacesAndNewlines)
    let tags = hashtags.joined(separator: " ")
    if body.isEmpty { return tags }
    return tags.isEmpty ? body : body + "\n\n" + tags
}
