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
        case .portrait: return "Instagram i Facebook — najlepszy zasięg w feedzie"
        case .square: return "Instagram i Facebook"
        case .story: return "Relacje — strefy bezpieczne u góry i u dołu"
        case .landscape: return "Facebook — post poziomy"
        }
    }
}

enum SocialChannel: String, Codable, CaseIterable, Identifiable, Hashable {
    case instagramFeed = "instagram_feed", instagramStory = "instagram_story", facebookFeed = "facebook_feed"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .instagramFeed: return "Instagram — post"
        case .instagramStory: return "Instagram — relacja"
        case .facebookFeed: return "Facebook — post"
        }
    }
    /// Formaty grafiki kanału w kolejności wyboru (jak `SOCIAL_CHANNEL_FORMATS`).
    var formats: [SocialFormat] {
        switch self {
        case .instagramFeed: return [.portrait, .square]
        case .instagramStory: return [.story]
        case .facebookFeed: return [.landscape, .portrait, .square]
        }
    }
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
        case .inherit: return "Jak dla wydarzenia i klienta"
        case .unknown: return "Nieustalona"
        case .requested: return "Czeka na odpowiedź klienta"
        case .granted: return "Jest zgoda"
        case .denied: return "Brak zgody"
        case .notRequired: return "Niepotrzebna"
        }
    }
}

enum SocialConsentPlatform: String, CaseIterable, Identifiable {
    case instagram, facebook, website
    var id: String { rawValue }
    var label: String { self == .instagram ? "Instagram" : self == .facebook ? "Facebook" : "Strona WWW" }
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

struct SocialMetaStatus: Codable, Hashable {
    var connected: Bool
    var pageId: String?
    var pageName: String?
    var instagramId: String?
    var instagramUsername: String?
    var channels: [String: SocialMetaChannelState]
    var comments: SocialMetaComments
    var missingScopes: [String]
    var lastError: String?

    func channel(_ channel: SocialChannel) -> SocialMetaChannelState? { channels[channel.rawValue] }
    var allReady: Bool { SocialChannel.allCases.allSatisfy { channel($0)?.ready == true } }
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
        case "event": return "z wydarzenia"
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
        case "event_file": return "Z plików wydarzenia"
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
}

struct SocialSpecLogo: Codable, Hashable {
    var src: String
    var aspect: Double?
}

/// Część danych szablonu potrzebna na Macu: gotowość, logo i strefy grafiki dla nakładki edytora kadru.
struct SocialSpec: Codable, Hashable {
    var templateId: String
    var ready: Bool
    var logo: SocialSpecLogo?
    var guides: [String: SocialGuides]
}

struct SocialVariant: Codable, Identifiable, Hashable {
    var id: String
    var format: SocialFormat
    var assetId: String?
    var crop: SocialCrop?
    var effectiveCrop: SocialCrop?
    var headline: String
    var subline: String
    var renderedUrl: String?
    var renderedAt: String?
    var upToDate: Bool
    var asset: SocialAsset?
}

struct SocialAiSuggestion: Codable, Hashable {
    var caption: String
    var hashtags: [String]
    var headline: String
    var subline: String
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
    var status: String
    var format: SocialFormat?
    var permalink: String?
    var error: String?
    var attempts: Int
    var publishedAt: String?
    var attemptedAt: String?

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

/// Komentarz Facebook / Instagram (`isOwn` — konto marki; `repliedByName` — odpowiedź wysłana z CRM).
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

    var platformLabel: String { platform == "facebook" ? "Facebook" : "Instagram" }
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
}

struct SocialCommentsReply: Codable, Hashable {
    var companyId: String
    var threads: [SocialCommentThread]
    var unanswered: Int
    var canReply: Bool
    var replyChannels: SocialReplyChannels

    func canReply(to thread: SocialCommentThread) -> Bool {
        canReply && (thread.platform == "facebook" ? replyChannels.facebook : replyChannels.instagram)
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
