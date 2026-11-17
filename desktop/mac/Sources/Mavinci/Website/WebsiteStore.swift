import Foundation
import SwiftUI

// MARK: Strona — stan ekranu (`/crm/page?tab=website`): struktura i odwiedziny, analiza ruchu, Schema.org i „Marketing i ADS”
// przez `/bridge/native/v1/website` (token pracownika).

enum WebsiteTab: String, CaseIterable, Identifiable {
    case structure, marketing, analytics, schema
    var id: String { rawValue }
    var label: String {
        switch self {
        case .structure: return "Struktura strony"
        case .marketing: return "Marketing i ADS"
        case .analytics: return "Analityka"
        case .schema: return "Schema.org"
        }
    }
    var symbol: String {
        switch self {
        case .structure: return "doc.text"
        case .marketing: return "gauge.with.needle"
        case .analytics: return "chart.bar"
        case .schema: return "curlybraces"
        }
    }
}

@MainActor final class WebsiteStore: ObservableObject {
    weak var workspace: Workspace?
    @Published var tab: WebsiteTab = .structure
    /// Analiza jednej podstrony (`/crm/page/analytics?url=…`); `nil` — wszystkie strony.
    @Published var analyticsURL: String?
    @Published private(set) var pages: WebsitePagesState?
    @Published var pagesError: String?
    @Published private(set) var loadingPages = false
    @Published private(set) var analytics: WebsiteAnalytics?
    @Published var analyticsError: String?
    @Published private(set) var loadingAnalytics = false
    @Published var online: Int?
    @Published private(set) var schema: SchemaState?
    @Published var schemaError: String?
    @Published private(set) var marketing: MarketingOverview?
    @Published var marketingError: String?
    @Published private(set) var loadingMarketing = false
    /// Zmienia się przy „Odśwież” — widok analizy ruchu wczytuje dane ponownie.
    @Published private(set) var refreshToken = 0
    private var analyticsSequence = 0

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: WebsiteAccess? { pages?.access ?? analytics?.access ?? schema?.access }

    func reset() {
        tab = .structure; analyticsURL = nil; pages = nil; pagesError = nil; analytics = nil; analyticsError = nil; online = nil
        schema = nil; schemaError = nil; marketing = nil; marketingError = nil
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/website", query: query))
    }

    func loadPages() async {
        let owner = workspace?.employee?.id
        loadingPages = true
        defer { loadingPages = false }
        do {
            let data = try await get(WebsitePagesState.self, ["op": "pages", "days": "30"])
            guard owner == workspace?.employee?.id else { return }
            pages = data; pagesError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            pagesError = failureText(error, "Nie udało się pobrać statystyk odwiedzin.")
        }
    }

    /// Analiza ruchu: ostatnie `range` dni albo zakres dni (`from`–`to`), opcjonalnie jedna podstrona.
    func loadAnalytics(range: Int, from: String?, to: String?) async {
        analyticsSequence += 1
        let sequence = analyticsSequence
        let owner = workspace?.employee?.id
        loadingAnalytics = true
        defer { if sequence == analyticsSequence { loadingAnalytics = false } }
        var query = ["op": "analytics", "range": "\(range)"]
        if let from, let to { query["from"] = from; query["to"] = to }
        if let analyticsURL { query["url"] = analyticsURL }
        do {
            let data = try await get(WebsiteAnalytics.self, query)
            guard sequence == analyticsSequence, owner == workspace?.employee?.id else { return }
            analytics = data; online = data.online; analyticsError = nil
        } catch {
            guard sequence == analyticsSequence, owner == workspace?.employee?.id else { return }
            analyticsError = failureText(error, "Błąd ładowania danych")
        }
    }

    func refreshOnline() async {
        struct Reply: Decodable { var online: Int }
        if let reply = try? await get(Reply.self, ["op": "online"]) { online = reply.online }
    }

    func loadSchema() async {
        let owner = workspace?.employee?.id
        do {
            let data = try await get(SchemaState.self, ["op": "schema"])
            guard owner == workspace?.employee?.id else { return }
            schema = data; schemaError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            schemaError = failureText(error, "Nie udało się pobrać danych Schema.org.")
        }
    }

    func cities(_ query: String) async throws -> [PolishCitySuggestion] {
        struct Reply: Decodable { var cities: [PolishCitySuggestion] }
        return try await get(Reply.self, ["op": "cities", "query": query]).cities
    }

    func cityCases() async throws -> [CityCaseItem] {
        struct Reply: Decodable { var cases: [CityCaseItem] }
        return try await get(Reply.self, ["op": "cityCases"]).cases
    }

    func citySearch(_ input: String, session: String) async throws -> [CrmPlacePrediction] {
        struct Reply: Decodable { var predictions: [CrmPlacePrediction] }
        return try await get(Reply.self, ["op": "citySearch", "input": input, "sessiontoken": session]).predictions
    }

    func cityPlace(_ placeID: String, session: String) async throws -> CityPlaceDetails {
        try await get(CityPlaceDetails.self, ["op": "cityPlace", "placeId": placeID, "sessiontoken": session])
    }

    func loadMarketing(companyID: String?) async {
        let owner = workspace?.employee?.id
        loadingMarketing = true
        defer { loadingMarketing = false }
        var query = ["op": "marketing"]
        if let companyID { query["companyId"] = companyID }
        do {
            let data = try await get(MarketingOverview.self, query)
            guard owner == workspace?.employee?.id else { return }
            marketing = data; marketingError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            marketingError = failureText(error, "Błąd wczytywania marketingu")
        }
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/website", payload, timeout: 300))) ?? [:]
    }

    /// Zapis z paskiem postępu i komunikatem. Zwraca odpowiedź albo `nil` przy błędzie (komunikat w pasku błędów).
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// „Odśwież”: struktura, Schema.org i marketing (gdy były wczytane), analiza ruchu przez `refreshToken`.
    func refreshVisible() async {
        await loadPages()
        if schema != nil { await loadSchema() }
        if let marketing { await loadMarketing(companyID: marketing.selectedCompanyId) }
        refreshToken += 1
    }

    /// Analiza ruchu konkretnej podstrony (przycisk „Analityka” w strukturze strony).
    func showAnalytics(for url: String?) {
        analyticsURL = url
        tab = .analytics
    }
}
