import Foundation
import SwiftUI

// MARK: Marketing → „Realizacje” — modele i reguły wspólne z CRM i telefonem (`src/lib/portfolio/portfolioShared.ts`):
// kopia robocza realizacji (`marketing_portfolio_items.content`), stan publikacji na stronie, limity pól, ikony elementów
// realizacji, adres (slug), lista kontrolna przed publikacją i podgląd w Google. API: `/bridge/native/v1/portfolio`.

enum PortfolioStatus: String, Codable, CaseIterable {
    case draft, published, changed, conflict

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PortfolioStatus(rawValue: raw) ?? .draft
    }

    var label: String {
        switch self {
        case .draft: return "Szkic"
        case .published: return "Na stronie"
        case .changed: return "Niepublikowane zmiany"
        case .conflict: return "Zmieniono na stronie"
        }
    }

    var color: Color {
        switch self {
        case .draft: return .secondary
        case .published: return .green
        case .changed: return .orange
        case .conflict: return .red
        }
    }

    /// Realizacja jest na stronie (także ze zmianami do opublikowania).
    var onSite: Bool { self != .draft }
}

/// Limity pól — te same co `PORTFOLIO_LIMITS` w CRM.
enum PortfolioLimits {
    static let title = 120
    static let slug = 90
    static let category = 60
    static let client = 120
    static let location = 160
    static let description = 600
    static let detailedDescription = 8000
    static let metaDescription = 320
    static let metaMin = 120
    static let metaMax = 160
    static let keywords = 15
    static let keyword = 60
    static let tags = 12
    static let tag = 40
    static let gallery = 60
    static let alt = 160
    static let features = 12
    static let featureTitle = 60
    static let featureDescription = 160
    static let videoUrl = 500
    static let uploadBytes = 40 * 1024 * 1024
    static let detailedRecommended = 600
    static let galleryRecommended = 5
}

/// Ikona elementu realizacji: nazwa ikony lucide (strona rysuje ją po nazwie) i odpowiednik SF Symbols na Macu.
struct PortfolioIcon: Identifiable, Hashable {
    let name: String
    let label: String
    let category: String
    let symbol: String
    var id: String { name }

    static let all: [PortfolioIcon] = [
        PortfolioIcon(name: "Users", label: "Zespół", category: "Ludzie", symbol: "person.3"),
        PortfolioIcon(name: "UserCheck", label: "Ekspert", category: "Ludzie", symbol: "person.crop.circle.badge.checkmark"),
        PortfolioIcon(name: "UsersRound", label: "Grupa", category: "Ludzie", symbol: "person.2.circle"),
        PortfolioIcon(name: "Clock", label: "Terminowość", category: "Czas", symbol: "clock"),
        PortfolioIcon(name: "Timer", label: "Szybkość", category: "Czas", symbol: "timer"),
        PortfolioIcon(name: "Calendar", label: "Planowanie", category: "Czas", symbol: "calendar"),
        PortfolioIcon(name: "Award", label: "Jakość", category: "Jakość", symbol: "rosette"),
        PortfolioIcon(name: "Star", label: "Wyróżnienie", category: "Jakość", symbol: "star"),
        PortfolioIcon(name: "BadgeCheck", label: "Certyfikat", category: "Jakość", symbol: "checkmark.seal"),
        PortfolioIcon(name: "Target", label: "Precyzja", category: "Jakość", symbol: "target"),
        PortfolioIcon(name: "Lightbulb", label: "Innowacyjność", category: "Technologia", symbol: "lightbulb"),
        PortfolioIcon(name: "Zap", label: "Energia", category: "Technologia", symbol: "bolt"),
        PortfolioIcon(name: "Radio", label: "Sprzęt", category: "Technologia", symbol: "dot.radiowaves.left.and.right"),
        PortfolioIcon(name: "Settings", label: "Konfiguracja", category: "Technologia", symbol: "gearshape"),
        PortfolioIcon(name: "Mic", label: "Audio", category: "Technologia", symbol: "mic"),
        PortfolioIcon(name: "CheckCircle2", label: "Kompleksowość", category: "Realizacja", symbol: "checkmark.circle"),
        PortfolioIcon(name: "Package", label: "Kompletność", category: "Realizacja", symbol: "shippingbox"),
        PortfolioIcon(name: "Truck", label: "Logistyka", category: "Realizacja", symbol: "truck.box"),
        PortfolioIcon(name: "Wrench", label: "Serwis", category: "Realizacja", symbol: "wrench.and.screwdriver"),
        PortfolioIcon(name: "TrendingUp", label: "Wzrost", category: "Sukces", symbol: "chart.line.uptrend.xyaxis"),
        PortfolioIcon(name: "ThumbsUp", label: "Zadowolenie", category: "Sukces", symbol: "hand.thumbsup"),
        PortfolioIcon(name: "Heart", label: "Pasja", category: "Sukces", symbol: "heart"),
        PortfolioIcon(name: "Sparkles", label: "Wyjątkowość", category: "Sukces", symbol: "sparkles"),
    ]

    static func named(_ name: String) -> PortfolioIcon { all.first { $0.name == name } ?? all[7] }
}

struct PortfolioPhoto: Codable, Hashable {
    /// Wersja na komputer (do 2200 px, WebP) — `portfolio_projects.image` / `gallery[].src`.
    var src: String
    /// Wersja na telefon (800 px).
    var mobile: String
    /// Miniatura w kreatorze (700 px).
    var thumb: String
    var alt: String
    var width: Int?
    var height: Int?

    enum CodingKeys: String, CodingKey { case src, mobile, thumb, alt, width, height }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = try c.decode(String.self, forKey: .src)
        let mobileValue = (try? c.decodeIfPresent(String.self, forKey: .mobile)) ?? ""
        let thumbValue = (try? c.decodeIfPresent(String.self, forKey: .thumb)) ?? ""
        mobile = mobileValue.isEmpty ? src : mobileValue
        thumb = thumbValue.isEmpty ? mobile : thumbValue
        alt = (try? c.decodeIfPresent(String.self, forKey: .alt)) ?? ""
        width = (try? c.decodeIfPresent(Double.self, forKey: .width)).map { Int($0.rounded()) }
        height = (try? c.decodeIfPresent(Double.self, forKey: .height)).map { Int($0.rounded()) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(src, forKey: .src)
        try c.encode(mobile, forKey: .mobile)
        try c.encode(thumb, forKey: .thumb)
        try c.encode(alt, forKey: .alt)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
    }
}

struct PortfolioFeature: Codable, Hashable {
    var icon: String
    var title: String
    var description: String

    init(icon: String = "Star", title: String = "", description: String = "") {
        self.icon = icon
        self.title = title
        self.description = description
    }

    enum CodingKeys: String, CodingKey { case icon, title, description }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        icon = (try? c.decodeIfPresent(String.self, forKey: .icon)) ?? "Star"
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
    }
}

/// Kopia robocza realizacji — ten sam kształt co `PortfolioContent` w CRM (serwer normalizuje ją przy zapisie).
struct PortfolioContent: Codable, Equatable {
    var title = ""
    var slug = ""
    var category = ""
    var client = ""
    var location = ""
    /// `YYYY-MM-DD` albo `nil`.
    var eventDate: String?
    var description = ""
    var detailedDescription = ""
    var metaDescription = ""
    var keywords: [String] = []
    var tags: [String] = []
    var image: PortfolioPhoto?
    var gallery: [PortfolioPhoto] = []
    var features: [PortfolioFeature] = []
    var eventCitySlug: String?
    var referenceCitySlugs: [String] = []
    /// `nil` — automatycznie (tag „konferencje”), `true` / `false` — zawsze / nigdy na stronach konferencji.
    var conferenceReferenceEnabled: Bool?
    var isFeatured = false
    var orderIndex = 0
    var videoUrl = ""

    init() {}

    enum CodingKeys: String, CodingKey {
        case title, slug, category, client, location, eventDate, description, detailedDescription, metaDescription, keywords, tags
        case image, gallery, features, eventCitySlug, referenceCitySlugs, conferenceReferenceEnabled, isFeatured, orderIndex, videoUrl
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func string(_ key: CodingKeys) -> String { (try? c.decodeIfPresent(String.self, forKey: key)) ?? "" }
        title = string(.title)
        slug = string(.slug)
        category = string(.category)
        client = string(.client)
        location = string(.location)
        let date = string(.eventDate)
        eventDate = date.isEmpty ? nil : date
        description = string(.description)
        detailedDescription = string(.detailedDescription)
        metaDescription = string(.metaDescription)
        keywords = (try? c.decodeIfPresent([String].self, forKey: .keywords)) ?? []
        tags = (try? c.decodeIfPresent([String].self, forKey: .tags)) ?? []
        image = (try? c.decodeIfPresent(PortfolioPhoto.self, forKey: .image)) ?? nil
        gallery = (try? c.decodeIfPresent([PortfolioPhoto].self, forKey: .gallery)) ?? []
        features = (try? c.decodeIfPresent([PortfolioFeature].self, forKey: .features)) ?? []
        let city = string(.eventCitySlug)
        eventCitySlug = city.isEmpty ? nil : city
        referenceCitySlugs = (try? c.decodeIfPresent([String].self, forKey: .referenceCitySlugs)) ?? []
        conferenceReferenceEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .conferenceReferenceEnabled)) ?? nil
        isFeatured = (try? c.decodeIfPresent(Bool.self, forKey: .isFeatured)) ?? false
        orderIndex = (try? c.decodeIfPresent(Double.self, forKey: .orderIndex)).map { Int($0.rounded()) } ?? 0
        videoUrl = string(.videoUrl)
    }

    /// Wszystkie pola, także puste (`null`) — jak treść w CRM.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(slug, forKey: .slug)
        try c.encode(category, forKey: .category)
        try c.encode(client, forKey: .client)
        try c.encode(location, forKey: .location)
        try c.encode(eventDate, forKey: .eventDate)
        try c.encode(description, forKey: .description)
        try c.encode(detailedDescription, forKey: .detailedDescription)
        try c.encode(metaDescription, forKey: .metaDescription)
        try c.encode(keywords, forKey: .keywords)
        try c.encode(tags, forKey: .tags)
        try c.encode(image, forKey: .image)
        try c.encode(gallery, forKey: .gallery)
        try c.encode(features, forKey: .features)
        try c.encode(eventCitySlug, forKey: .eventCitySlug)
        try c.encode(referenceCitySlugs, forKey: .referenceCitySlugs)
        try c.encode(conferenceReferenceEnabled, forKey: .conferenceReferenceEnabled)
        try c.encode(isFeatured, forKey: .isFeatured)
        try c.encode(orderIndex, forKey: .orderIndex)
        try c.encode(videoUrl, forKey: .videoUrl)
    }

    /// Treść jako JSON do wysłania na serwer.
    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return value
    }

    /// Zdjęcie główne i galeria (w tej kolejności).
    var photos: [PortfolioPhoto] { (image.map { [$0] } ?? []) + gallery }

    /// Dodaje zdjęcia: pierwsze bez zdjęcia głównego zostaje głównym, pozostałe trafiają do galerii (do limitu).
    mutating func add(_ added: [PortfolioPhoto]) {
        for photo in added {
            if image == nil { image = photo } else if gallery.count < PortfolioLimits.gallery { gallery.append(photo) }
        }
    }

    /// Zdjęcia upuszczone na zdjęcie główne: pierwsze zostaje głównym (dotychczasowe — na początek galerii), reszta — do galerii.
    mutating func addAsMain(_ added: [PortfolioPhoto]) {
        guard let first = added.first else { return }
        if let image, gallery.count < PortfolioLimits.gallery { gallery.insert(image, at: 0) }
        image = first
        add(Array(added.dropFirst()))
    }

    /// Zdjęcia upuszczone na kafelek galerii — wstawione w to miejsce (bez zdjęcia głównego pierwsze zostaje głównym).
    mutating func insert(_ added: [PortfolioPhoto], at index: Int) {
        var queue = added
        if image == nil, !queue.isEmpty { image = queue.removeFirst() }
        var position = min(max(0, index), gallery.count)
        for photo in queue where gallery.count < PortfolioLimits.gallery {
            gallery.insert(photo, at: position)
            position += 1
        }
    }

    /// Nowy tytuł; adres strony idzie za tytułem, gdy realizacji nie ma na stronie, a adres był pusty albo powstał ze starego
    /// tytułu (jak `portfolioWithTitle` w CRM).
    mutating func setTitle(_ value: String, onSite: Bool) {
        let clean = String(value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(PortfolioLimits.title))
        let followSlug = !onSite && (slug.isEmpty || slug == portfolioSlug(title))
        title = clean
        if followSlug { slug = portfolioSlug(clean) }
    }

    /// Dopisuje elementy, których jeszcze nie ma (ten sam tytuł bez względu na wielkość liter), do limitu.
    mutating func addFeatures(_ proposed: [PortfolioFeature]) {
        let locale = Locale(identifier: "pl_PL")
        var known = Set(features.map { $0.title.lowercased(with: locale) })
        for feature in proposed where !feature.title.isEmpty && features.count < PortfolioLimits.features {
            let key = feature.title.lowercased(with: locale)
            if known.contains(key) { continue }
            known.insert(key)
            features.append(feature)
        }
    }

    /// Opisy alt z propozycji: zdjęcia bez opisu (`all` — także zastąpienie istniejących). Zwraca liczbę uzupełnionych.
    @discardableResult mutating func applyAlts(_ alts: [PortfolioAiAlt], all: Bool = false) -> Int {
        var map: [String: String] = [:]
        for item in alts {
            let clean = String(item.alt.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(PortfolioLimits.alt))
            if !clean.isEmpty { map[item.src] = clean }
        }
        var filled = 0
        if let current = image, let alt = map[current.src], all || current.alt.isEmpty { image?.alt = alt; filled += 1 }
        for index in gallery.indices {
            if let alt = map[gallery[index].src], all || gallery[index].alt.isEmpty { gallery[index].alt = alt; filled += 1 }
        }
        return filled
    }
}

/// Frazy (słowa kluczowe, tagi, miasta) dopisane bez powtórzeń (wielkość liter bez znaczenia) do limitu.
func portfolioMergePhrases(_ values: [String], _ added: [String], max: Int, maxLength: Int) -> [String] {
    var next: [String] = []
    let locale = Locale(identifier: "pl_PL")
    for item in values + added {
        let clean = String(item.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(maxLength))
        guard !clean.isEmpty, next.count < max else { continue }
        if next.contains(where: { $0.lowercased(with: locale) == clean.lowercased(with: locale) }) { continue }
        next.append(clean)
    }
    return next
}

/// Lista kontrolna → kotwica pola w kreatorze (jak `portfolioCheckTarget` w CRM); opisy alt — pierwsze zdjęcie bez opisu.
func portfolioCheckTarget(_ key: String, _ content: PortfolioContent) -> String {
    switch key {
    case "alt":
        if let image = content.image, image.alt.isEmpty { return "image" }
        return content.gallery.isEmpty ? "image" : "gallery"
    case "title", "slug", "image", "description", "meta", "detailed", "gallery", "keywords", "city", "features":
        return key
    default:
        return "title"
    }
}

struct PortfolioListItem: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let slug: String
    let status: PortfolioStatus
    let category: String
    let location: String
    let eventDate: String?
    let thumbnailUrl: String?
    let photos: Int
    let isFeatured: Bool
    let orderIndex: Int
    let eventId: String?
    let eventName: String?
    let siteUrl: String?
    let publishedAt: String?
    let updatedAt: String
    let problems: Int
}

struct PortfolioCity: Codable, Identifiable, Hashable {
    let locality: String
    let name: String
    var id: String { locality }
}

struct PortfolioCounts: Codable, Hashable {
    let draft: Int
    let published: Int
    let changed: Int
}

struct PortfolioHome: Codable {
    let items: [PortfolioListItem]
    let categories: [String]
    let cities: [PortfolioCity]
    let counts: PortfolioCounts
    let siteUrl: String
}

struct PortfolioEvent: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let date: String?
    let location: String
    let category: String?

    /// Data, miejsce i rodzaj w jednej linii.
    var summary: String {
        [date.map { PortfolioDates.display(String($0.prefix(10))) }, location.isEmpty ? nil : location, category].compactMap { $0 }.joined(separator: " · ")
    }
}

struct PortfolioItem: Codable {
    let id: String
    let version: Int
    let status: PortfolioStatus
    let content: PortfolioContent
    let eventId: String?
    let companyId: String?
    let portfolioProjectId: String?
    let publishedSlug: String?
    let siteUrl: String?
    let publishedAt: String?
    let publishedByName: String?
    let createdAt: String
    let createdByName: String?
    let updatedAt: String
    let updatedByName: String?
    let problems: [String]
    let siteContent: PortfolioContent?
}

struct PortfolioDetail: Codable {
    let item: PortfolioItem
    let event: PortfolioEvent?
}

enum PortfolioPhotoSource: String, CaseIterable, Identifiable {
    case event, material, social
    var id: String { rawValue }
    var label: String {
        switch self {
        case .event: return "Pliki eventu"
        case .material: return "Materiały"
        case .social: return "Biblioteka social media"
        }
    }
    var button: String {
        switch self {
        case .event: return "Z eventu"
        case .material: return "Z Materiałów"
        case .social: return "Z biblioteki social"
        }
    }
    var symbol: String {
        switch self {
        case .event: return "folder"
        case .material: return "photo.stack"
        case .social: return "sparkles"
        }
    }
}

struct PortfolioPhotoOption: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let thumbnailUrl: String?
    let width: Int?
    let height: Int?
    let bytes: Int?
}

struct PortfolioPhotosReply: Codable {
    let photos: [PortfolioPhotoOption]
    let problem: String?
}

struct PortfolioEventsReply: Codable {
    let events: [PortfolioEvent]
}

struct PortfolioPhotoReply: Codable {
    let photo: PortfolioPhoto
}

enum PortfolioAiField: String, CaseIterable, Identifiable {
    case title, titles, description, detailedDescription, metaDescription, keywords, tags, city, referenceCities, features, alts
    var id: String { rawValue }
    var label: String {
        switch self {
        case .title: return "Tytuł"
        case .titles: return "Propozycje tytułu"
        case .description: return "Krótki opis"
        case .detailedDescription: return "Szczegółowy opis"
        case .metaDescription: return "Opis w Google"
        case .keywords: return "Słowa kluczowe"
        case .tags: return "Tagi"
        case .city: return "Miasto realizacji"
        case .referenceCities: return "Priorytetowe miasta"
        case .features: return "Elementy realizacji"
        case .alts: return "Opisy zdjęć (alt)"
        }
    }

    /// Pola panelu „Asystent AI” (kilka naraz); pozostałe — przyciski przy sekcjach.
    static let panel: [PortfolioAiField] = [.title, .description, .detailedDescription, .metaDescription, .keywords, .features, .alts]
}

/// Asystent AI przy sekcji kreatora — te same pola i etykiety co `PORTFOLIO_AI_SECTIONS` w CRM.
enum PortfolioAiSection: String, Identifiable {
    case title, descriptions, features, seo, alts
    var id: String { rawValue }
    var fields: [PortfolioAiField] {
        switch self {
        case .title: return [.titles]
        case .descriptions: return [.description, .detailedDescription]
        case .features: return [.features]
        case .seo: return [.metaDescription, .keywords, .tags, .city, .referenceCities]
        case .alts: return [.alts]
        }
    }
    /// Zdjęcia jako kontekst (pierwsze 6) — przy SEO bez zdjęć.
    var photos: Bool { self != .seo }
    var button: String {
        switch self {
        case .title: return "Zaproponuj tytuł"
        case .descriptions: return "Napisz opisy"
        case .features: return "Zaproponuj elementy"
        case .seo: return "Uzupełnij SEO"
        case .alts: return "Opisz zdjęcia"
        }
    }
    var pending: String {
        switch self {
        case .title: return "Asystent AI szuka tytułu"
        case .descriptions: return "Asystent AI pisze opisy"
        case .features: return "Asystent AI dobiera elementy realizacji"
        case .seo: return "Asystent AI przygotowuje SEO"
        case .alts: return "Asystent AI opisuje zdjęcia"
        }
    }
}

struct PortfolioAiAlt: Codable, Hashable {
    let src: String
    let alt: String
}

struct PortfolioAiResult: Codable {
    let title: String?
    let titles: [String]?
    let description: String?
    let detailedDescription: String?
    let metaDescription: String?
    let keywords: [String]?
    let tags: [String]?
    let eventCitySlug: String?
    let referenceCitySlugs: [String]?
    let features: [PortfolioFeature]?
    let alts: [PortfolioAiAlt]?
    let model: String
    let usedPhotos: Bool

    /// Podgląd propozycji pola (pusty — brak propozycji).
    func preview(_ field: PortfolioAiField) -> String {
        switch field {
        case .title: return title ?? ""
        case .titles: return (titles ?? []).joined(separator: "\n")
        case .description: return description ?? ""
        case .detailedDescription: return detailedDescription ?? ""
        case .metaDescription: return metaDescription ?? ""
        case .keywords: return (keywords ?? []).joined(separator: ", ")
        case .tags: return (tags ?? []).joined(separator: ", ")
        case .city: return eventCitySlug ?? ""
        case .referenceCities: return (referenceCitySlugs ?? []).joined(separator: ", ")
        case .features: return (features ?? []).map { $0.description.isEmpty ? $0.title : "\($0.title) — \($0.description)" }.joined(separator: "\n")
        case .alts: return (alts ?? []).isEmpty ? "" : "\(alts?.count ?? 0) opisów zdjęć"
        }
    }

    /// Wstawia propozycję pola do treści; `false` — brak propozycji.
    @discardableResult func apply(_ field: PortfolioAiField, to content: inout PortfolioContent, onSite: Bool = true) -> Bool {
        switch field {
        case .title:
            guard let title, !title.isEmpty else { return false }
            content.setTitle(title, onSite: onSite)
        case .titles:
            guard let first = titles?.first, !first.isEmpty else { return false }
            content.setTitle(first, onSite: onSite)
        case .description:
            guard let description, !description.isEmpty else { return false }
            content.description = description
        case .detailedDescription:
            guard let detailedDescription, !detailedDescription.isEmpty else { return false }
            content.detailedDescription = detailedDescription
        case .metaDescription:
            guard let metaDescription, !metaDescription.isEmpty else { return false }
            content.metaDescription = metaDescription
        case .keywords:
            guard let keywords, !keywords.isEmpty else { return false }
            content.keywords = keywords
        case .tags:
            guard let tags, !tags.isEmpty else { return false }
            content.tags = portfolioMergePhrases(content.tags, tags, max: PortfolioLimits.tags, maxLength: PortfolioLimits.tag)
        case .city:
            guard let eventCitySlug, !eventCitySlug.isEmpty else { return false }
            content.eventCitySlug = eventCitySlug
        case .referenceCities:
            guard let referenceCitySlugs, !referenceCitySlugs.isEmpty else { return false }
            content.referenceCitySlugs = portfolioMergePhrases(content.referenceCitySlugs, referenceCitySlugs, max: 60, maxLength: 120)
        case .features:
            guard let features, !features.isEmpty else { return false }
            content.features = features
        case .alts:
            guard let alts, !alts.isEmpty else { return false }
            content.applyAlts(alts, all: true)
        }
        return true
    }
}

// MARK: Reguły wspólne z CRM

/// Adres realizacji z tytułu: małe litery bez polskich znaków, słowa rozdzielone „-” (jak `portfolioSlug` w CRM).
func portfolioSlug(_ value: String) -> String {
    let polish: [Character: Character] = ["ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z"]
    let lowered = value.lowercased(with: Locale(identifier: "pl_PL"))
    let mapped = String(lowered.map { polish[$0] ?? $0 })
    let folded = mapped.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "pl_PL"))
    var result = ""
    var lastDash = false
    for scalar in folded.unicodeScalars {
        let alphanumeric = (scalar.value >= 97 && scalar.value <= 122) || (scalar.value >= 48 && scalar.value <= 57)
        if alphanumeric {
            result.unicodeScalars.append(scalar)
            lastDash = false
        } else if !lastDash && !result.isEmpty {
            result.append("-")
            lastDash = true
        }
    }
    while result.hasSuffix("-") { result.removeLast() }
    if result.count > PortfolioLimits.slug { result = String(result.prefix(PortfolioLimits.slug)) }
    while result.hasSuffix("-") { result.removeLast() }
    return result
}

func isPortfolioSlug(_ value: String) -> Bool {
    !value.isEmpty && value.count <= PortfolioLimits.slug && value.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
}

struct PortfolioCheck: Identifiable {
    let key: String
    let label: String
    let ok: Bool
    let hint: String
    let required: Bool
    var id: String { key }
}

/// Lista kontrolna przed publikacją: pola wymagane i zalecenia SEO (te same w CRM, na Macu i w telefonie).
func portfolioChecklist(_ content: PortfolioContent) -> [PortfolioCheck] {
    let photos = content.photos
    let withoutAlt = photos.filter { $0.alt.isEmpty }.count
    let meta = content.metaDescription.count
    let detailed = content.detailedDescription.count
    return [
        PortfolioCheck(key: "title", label: "Tytuł", ok: content.title.count >= 3, hint: "Nazwa realizacji widoczna na stronie i w Google.", required: true),
        PortfolioCheck(key: "slug", label: "Adres strony", ok: isPortfolioSlug(content.slug), hint: "Np. jubileusz-30-lat-tymbark — małe litery i myślniki.", required: true),
        PortfolioCheck(key: "image", label: "Zdjęcie główne", ok: content.image != nil, hint: "Zdjęcie na górze strony i w udostępnieniach.", required: true),
        PortfolioCheck(key: "description", label: "Krótki opis", ok: content.description.count >= 40, hint: "Co, dla kogo, gdzie — 1–2 zdania na kartę realizacji.", required: true),
        PortfolioCheck(key: "meta", label: "Opis w Google", ok: meta >= PortfolioLimits.metaMin && meta <= PortfolioLimits.metaMax,
                       hint: "\(PortfolioLimits.metaMin)–\(PortfolioLimits.metaMax) znaków (teraz \(meta)).", required: false),
        PortfolioCheck(key: "detailed", label: "Szczegółowy opis", ok: detailed >= PortfolioLimits.detailedRecommended,
                       hint: "Najlepiej od \(PortfolioLimits.detailedRecommended) znaków: zakres usług, technika, przebieg (teraz \(detailed)).", required: false),
        PortfolioCheck(key: "gallery", label: "Galeria", ok: content.gallery.count >= PortfolioLimits.galleryRecommended,
                       hint: "Co najmniej \(PortfolioLimits.galleryRecommended) zdjęć (teraz \(content.gallery.count)).", required: false),
        PortfolioCheck(key: "alt", label: "Opisy zdjęć (alt)", ok: !photos.isEmpty && withoutAlt == 0,
                       hint: withoutAlt > 0 ? "\(withoutAlt) zdjęć bez opisu." : "Opis każdego zdjęcia pomaga w Google Grafika.", required: false),
        PortfolioCheck(key: "keywords", label: "Słowa kluczowe", ok: content.keywords.count >= 3, hint: "Np. „gala firmowa Olsztyn”, „scena z ekranem LED” — 3–10 fraz.", required: false),
        PortfolioCheck(key: "city", label: "Miasto realizacji", ok: content.eventCitySlug != nil, hint: "Realizacja pojawi się na stronach usług w tym mieście.", required: false),
        PortfolioCheck(key: "features", label: "Elementy realizacji", ok: content.features.count >= 3, hint: "Np. scena, oświetlenie, prowadzący — 3–6 elementów.", required: false),
    ]
}

/// Braki blokujące publikację (pola wymagane).
func portfolioPublishProblems(_ content: PortfolioContent) -> [PortfolioCheck] {
    portfolioChecklist(content).filter { $0.required && !$0.ok }
}

/// Wynik w Google: tytuł, adres i opis (jak `portfolioSearchPreview` w CRM).
func portfolioSearchPreview(_ content: PortfolioContent) -> (title: String, url: String, description: String) {
    (title: "\(content.title.isEmpty ? "Realizacja" : content.title) | Portfolio MAVINCI",
     url: "mavinci.pl › portfolio › \(content.slug.isEmpty ? "adres-realizacji" : content.slug)",
     description: content.metaDescription.isEmpty ? content.description : content.metaDescription)
}

/// Dodaje frazy (rozdzielone przecinkami) do listy bez powtórzeń (wielkość liter bez znaczenia), do limitu.
func portfolioAddPhrases(_ text: String, to values: [String], max: Int, maxLength: Int) -> [String] {
    var next = values
    let locale = Locale(identifier: "pl_PL")
    for part in text.split(separator: ",") {
        let clean = String(part.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(maxLength))
        guard !clean.isEmpty, next.count < max else { continue }
        if next.contains(where: { $0.lowercased(with: locale) == clean.lowercased(with: locale) }) { continue }
        next.append(clean)
    }
    return next
}

enum PortfolioDates {
    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Europe/Warsaw") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func parse(_ value: String?) -> Date? { value.flatMap { day.date(from: String($0.prefix(10))) } }
    static func format(_ date: Date) -> String { day.string(from: date) }
    /// `2026-05-12` → `12.05.2026`.
    static func display(_ value: String?) -> String {
        guard let value, value.count >= 10 else { return value ?? "" }
        let parts = value.prefix(10).split(separator: "-")
        guard parts.count == 3 else { return String(value.prefix(10)) }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    /// Data i godzina zapisu (`created_at`, `published_at`).
    static func moment(_ value: String?) -> String {
        guard let value, let date = iso.date(from: value) ?? isoPlain.date(from: value) else { return value ?? "" }
        return date.formatted(.dateTime.day().month(.twoDigits).year().hour().minute().locale(Locale(identifier: "pl_PL")))
    }
}
