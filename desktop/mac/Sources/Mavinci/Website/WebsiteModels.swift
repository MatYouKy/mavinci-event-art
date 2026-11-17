import Foundation

// MARK: Strona — odpowiedzi `/bridge/native/v1/website` (`src/lib/native/website.ts`): odwiedziny podstron, analiza ruchu,
// Schema.org (dane globalne, obszary obsługi, miasta, wyjątki odmiany) i „Marketing i ADS” (`MarketingOverviewDTO`).

struct WebsiteAccess: Decodable, Hashable {
    var canEdit: Bool
    var canReset: Bool
    var canViewMarketing: Bool
    var canManageMarketing: Bool
}

struct WebsitePageVisits: Decodable, Identifiable, Hashable {
    var url: String
    var title: String
    var visits: Int
    var id: String { url }
}

struct WebsitePagesState: Decodable {
    var access: WebsiteAccess
    var pages: [WebsitePageVisits]
    func visits(_ url: String) -> Int { pages.first { $0.url == url }?.visits ?? 0 }
}

/// Węzeł struktury strony (stała struktura jak w CRM, odwiedziny z ostatnich 30 dni).
struct WebsiteNode: Identifiable, Hashable {
    var url: String
    var title: String
    var children: [WebsiteNode] = []
    var id: String { url }

    static let structure: [WebsiteNode] = [
        .init(url: "/", title: "Strona główna"),
        .init(url: "/o-nas", title: "O nas"),
        .init(url: "/uslugi", title: "Usługi", children: [
            .init(url: "/uslugi/kasyno", title: "Kasyno"),
            .init(url: "/uslugi/naglosnienie", title: "Nagłośnienie"),
            .init(url: "/uslugi/streaming", title: "Streaming"),
            .init(url: "/uslugi/quizy-teleturnieje", title: "Quizy i Teleturnieje"),
            .init(url: "/uslugi/symulatory-vr", title: "Symulatory VR"),
            .init(url: "/uslugi/technika-sceniczna", title: "Technika Sceniczna"),
            .init(url: "/uslugi/wieczory-tematyczne", title: "Wieczory Tematyczne"),
            .init(url: "/uslugi/konferencje", title: "Konferencje"),
            .init(url: "/uslugi/integracje", title: "Integracje"),
        ]),
        .init(url: "/portfolio", title: "Portfolio"),
        .init(url: "/zespol", title: "Zespół"),
    ]

    /// Filtr wyszukiwania jak `filteredTree`: węzeł zostaje, gdy pasuje on albo któreś z dzieci.
    static func filter(_ nodes: [WebsiteNode], _ query: String) -> [WebsiteNode] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return nodes }
        return nodes.compactMap { node in
            let children = filter(node.children, q)
            let matches = node.url.localizedCaseInsensitiveContains(q) || node.title.localizedCaseInsensitiveContains(q)
            guard matches || !children.isEmpty else { return nil }
            var copy = node
            copy.children = children
            return copy
        }
    }
}

struct WebsiteAnalytics: Decodable {
    struct TopPage: Decodable, Identifiable, Hashable { var url: String; var visits: Int; var uniqueVisitors: Int; var avgTime: Int; var id: String { url } }
    struct Source: Decodable, Identifiable, Hashable { var source: String; var visits: Int; var id: String { source } }
    struct Device: Decodable, Identifiable, Hashable { var device: String; var visits: Int; var percentage: Int; var id: String { device } }
    struct City: Decodable, Identifiable, Hashable { var city: String; var submissions: Int; var id: String { city } }
    struct Day: Decodable, Identifiable, Hashable { var date: String; var visits: Int; var id: String { date } }
    var access: WebsiteAccess
    var online: Int
    var totalVisits: Int
    var uniqueVisitors: Int
    var avgTimeOnPage: Int
    var contactForms: Int
    var topPages: [TopPage]
    var trafficSources: [Source]
    var devices: [Device]
    var topCities: [City]
    var dailyVisits: [Day]
}

struct SchemaPlace: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var locality: String
    var postalCode: String
    var region: String
    var order: Int
}

struct SchemaState: Decodable {
    var access: WebsiteAccess
    var global: [String: String]?
    var places: [SchemaPlace]
}

struct PolishCitySuggestion: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var slug: String
    var postalCode: String
    var region: String
}

struct CityCaseItem: Decodable, Identifiable, Hashable {
    var id: String
    var cityKey: String
    var nominative: String
    var genitive: String
    var locative: String
    var preposition: String
}

struct CityPlaceDetails: Decodable {
    var name: String
    var postalCode: String
    var region: String
    var formattedAddress: String
    var placeId: String
}

enum WebsiteFormat {
    private static let integer: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.maximumFractionDigits = 0; return f
    }()
    private static let decimal: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; return f
    }()
    private static let money: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .currency; f.currencyCode = "PLN"; return f
    }()
    static func number(_ value: Double, digits: Int = 0) -> String {
        decimal.maximumFractionDigits = digits
        return decimal.string(from: NSNumber(value: value)) ?? "\(value)"
    }
    static func count(_ value: Int) -> String { integer.string(from: NSNumber(value: value)) ?? "\(value)" }
    static func currency(_ value: Double, _ code: String = "PLN") -> String {
        money.currencyCode = code.isEmpty ? "PLN" : code
        return money.string(from: NSNumber(value: value)) ?? String(format: "%.2f zł", value)
    }
    static func percent(_ value: Double) -> String { "\(number(value, digits: 2))%" }
    /// „45s” albo „2m 5s” jak `formatTime` w analityce CRM.
    static func duration(_ seconds: Int) -> String { seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s" }
    static func dateTime(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "Jeszcze nie synchronizowano" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm:ss")
    }
    static func day(_ value: String) -> String { DayDates.parse(value).map { MeetingDates.format($0, "dd.MM") } ?? value }
}

// MARK: Marketing i ADS

struct MarketingCompany: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var isDefault: Bool
    enum CodingKeys: String, CodingKey { case id, name, isDefault = "is_default" }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        isDefault = (try? c.decode(Bool.self, forKey: .isDefault)) ?? false
    }
}

struct MarketingIntegration: Decodable, Identifiable {
    var id: String
    var provider: String
    var status: String
    var lastSyncedAt: String?
    var lastError: String?
    var settings: [String: JSONValue]?
    enum CodingKeys: String, CodingKey { case id, provider, status, lastSyncedAt = "last_synced_at", lastError = "last_error", settings }
}

struct MarketingMetric: Decodable {
    var source: String
    var date: String
    var impressions: Double
    var clicks: Double
    var spend: Double
    var conversions: Double
    var engagement: Double
    var messages: Double
    var organicClicks: Double
    var organicImpressions: Double
    enum CodingKeys: String, CodingKey { case source, date = "metric_date", impressions, clicks, spend, conversions, engagement, messages, organicClicks, organicImpressions }
}

struct MarketingTotals: Decodable {
    var impressions: Double
    var clicks: Double
    var spend: Double
    var conversions: Double
    var organicClicks: Double
    var organicImpressions: Double
    var averagePosition: Double
}

struct MarketingCampaign: Decodable, Identifiable {
    var id: String
    var provider: String
    var name: String
    var status: String
    var objective: String?
    var budgetDaily: Double?
    var budgetLifetime: Double?
    var currency: String?
    var impressions: Double
    var clicks: Double
    var spend: Double
    var conversions: Double
    var syncedAt: String?
    enum CodingKeys: String, CodingKey {
        case id, provider, name, status, objective, budgetDaily = "budget_daily", budgetLifetime = "budget_lifetime", currency, impressions, clicks, spend, conversions
        case syncedAt = "synced_at"
    }
    var active: Bool { ["ACTIVE", "ENABLED"].contains(status.uppercased()) }
    var toggleable: Bool { ["ACTIVE", "ENABLED", "PAUSED"].contains(status.uppercased()) }
}

struct MarketingMessage: Decodable, Identifiable {
    var id: String
    var senderName: String?
    var preview: String
    var receivedAt: String?
    var isRead: Bool
    enum CodingKeys: String, CodingKey { case id, senderName = "sender_name", preview = "message_preview", receivedAt = "received_at", isRead = "is_read" }
}

struct MarketingInsight: Decodable {
    struct Recommendation: Decodable, Hashable { var title: String; var rationale: String; var priority: String?; var channel: String? }
    var id: String
    var summary: String
    var recommendations: [Recommendation]
    var risks: [String]
    var opportunities: [String]
    var createdAt: String?
    enum CodingKeys: String, CodingKey { case id, summary, recommendations, risks, opportunities, createdAt = "created_at" }
}

struct MarketingSettings: Decodable {
    var automaticSyncEnabled: Bool
    var aiAnalysisEnabled: Bool
}

struct MarketingOverview: Decodable {
    var companies: [MarketingCompany]
    var selectedCompanyId: String?
    var integrations: [MarketingIntegration]
    var metrics: [MarketingMetric]
    var totals: MarketingTotals
    var campaigns: [MarketingCampaign]
    var messages: [MarketingMessage]
    var unreadMessages: Int
    var latestInsight: MarketingInsight?
    var settings: MarketingSettings
    var canManage: Bool
}

enum MarketingLabels {
    static func status(_ status: String) -> String {
        switch status.uppercased() {
        case "ACTIVE", "ENABLED": return "Aktywna"
        case "PAUSED": return "Wstrzymana"
        case "CONNECTED": return "Połączona"
        case "SYNCING": return "Synchronizacja"
        case "ERROR", "NEEDS_ATTENTION": return "Wymaga uwagi"
        case "REMOVED": return "Usunięta"
        case "NOT_CONNECTED": return "Niepołączona"
        default: return "Brak danych"
        }
    }
    static let objectives: [String: String] = [
        "SEARCH": "Wyszukiwarka", "DISPLAY": "Sieć reklamowa", "VIDEO": "Wideo", "SHOPPING": "Zakupy", "PERFORMANCE_MAX": "Performance Max",
        "DEMAND_GEN": "Generowanie popytu", "OUTCOME_LEADS": "Pozyskiwanie kontaktów", "OUTCOME_SALES": "Sprzedaż", "OUTCOME_TRAFFIC": "Ruch",
        "OUTCOME_AWARENESS": "Rozpoznawalność", "OUTCOME_ENGAGEMENT": "Zaangażowanie",
    ]
}
