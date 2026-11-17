import Foundation
import SwiftUI

// MARK: Kampanie e-mail — stan ekranu „Centrum Kampanii” (`/crm/campaigns`): lista, wybrana kampania, odbiorcy, demo
// kampanii z broszury i czynności przez `/bridge/native/v1/campaigns` (token pracownika). PDF kampanii z broszury —
// `/bridge/brochures/generate-pdf`, jak w CRM.

@MainActor final class MailCampaignsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: MailCampaignHome?
    @Published var loadError: String?
    @Published private(set) var loading = false
    /// Wybrana kampania; `nil` — pierwsza z listy (jak w CRM).
    @Published var selectedID: String?
    /// Kampania wskazana z innego miejsca (np. po utworzeniu szkicu z broszury) — wybierana po wczytaniu listy.
    @Published var requestedID: String?
    @Published private(set) var recipients: [String: [MailCampaignRecipient]] = [:]
    @Published var recipientErrors: [String: String] = [:]
    @Published private(set) var demos: [String: MailCampaignDemo] = [:]
    @Published var demoErrors: [String: String] = [:]
    @Published private(set) var generatingDemo = false

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: MailCampaignAccess? { home?.access }
    var campaigns: [MailCampaign] { home?.campaigns ?? [] }
    var selected: MailCampaign? {
        guard let id = selectedID else { return nil }
        return campaigns.first { $0.id == id }
    }

    func reset() {
        home = nil; loadError = nil; loading = false; selectedID = nil; requestedID = nil
        recipients = [:]; recipientErrors = [:]; demos = [:]; demoErrors = [:]; generatingDemo = false
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    /// Lista kampanii, segmenty, konta i szablony. `quiet` — odświeżenie w tle (bez wskaźnika ładowania).
    func load(quiet: Bool = false) async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            let data = try JSONDecoder().decode(MailCampaignHome.self, from: try await api.get("/campaigns", query: ["op": "home"]))
            guard owner == workspace?.employee?.id else { return }
            home = data
            loadError = nil
            pickSelection()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if !quiet || home == nil { loadError = failureText(error, "Nie udało się załadować Centrum Kampanii") }
        }
    }

    /// Wybór jak `setSelectedId` po wczytaniu: zostaje bieżąca, potem wskazana z zewnątrz, potem pierwsza.
    private func pickSelection() {
        let ids = Set(campaigns.map(\.id))
        if let requestedID, ids.contains(requestedID) {
            selectedID = requestedID
            self.requestedID = nil
            return
        }
        if let selectedID, ids.contains(selectedID) { return }
        selectedID = campaigns.first?.id
    }

    func loadRecipients(_ id: String) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(MailCampaignRecipients.self, from: try await api.get("/campaigns", query: ["op": "recipients", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            recipients[id] = data.recipients
            recipientErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            recipientErrors[id] = failureText(error, "Nie udało się wczytać odbiorców kampanii.")
        }
    }

    func loadDemo(_ id: String) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(MailCampaignDemo.self, from: try await api.get("/campaigns", query: ["op": "demo", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            demos[id] = data
            demoErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            demoErrors[id] = "Nie udało się wczytać danych demonstracji kampanii."
        }
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/campaigns", payload, timeout: 120))) ?? [:]
    }

    /// Czynność z paskiem postępu i komunikatem; potem odświeża listę (i odbiorców wskazanej kampanii).
    /// Zwraca odpowiedź albo `nil` przy błędzie (komunikat w pasku błędów).
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], recipientsOf campaignID: String? = nil) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            if let id = reply["campaign"]?.object["id"]?.text.nonEmpty, op == "create" { selectedID = id }
            await load(quiet: true)
            if let campaignID { await loadRecipients(campaignID) }
            return reply
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się")
            // Zmiana w przeglądarce lub stan kolejki mógł się zmienić — świeża lista pokazuje aktualny stan.
            await load(quiet: true)
            return nil
        }
    }

    /// „Generuj PDF przypisany do kampanii” — ten sam serwer PDF broszur co w CRM (do 4 minut).
    func generateDemoPdf(campaignID: String, brochureID: String) async {
        guard let workspace, let api, !generatingDemo else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/brochures/generate-pdf") else { return }
        generatingDemo = true
        defer { generatingDemo = false }
        demoErrors[campaignID] = nil
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 240
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
            request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
            let body: [String: JSONValue] = ["brochureId": .string(brochureID), "campaignId": .string(campaignID)]
            request.httpBody = try JSONEncoder().encode(body)
            let prepared: URLRequest = request
            let (data, response) = try await workspace.withPending("Przygotowywanie PDF kampanii…") { try await URLSession.shared.data(for: prepared) }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { throw AppError.unauthorized }
            guard (200..<300).contains(status) else {
                let result = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
                demoErrors[campaignID] = result["error"]?.text.nonEmpty ?? "Nie udało się przygotować PDF kampanii."
                return
            }
            workspace.succeed("PDF kampanii jest gotowy.")
            await loadDemo(campaignID)
        } catch {
            demoErrors[campaignID] = failureText(error, "Nie udało się przygotować PDF kampanii.")
        }
    }
}

extension Workspace {
    /// Kampania w Centrum Kampanii (`/crm/campaigns?campaign=<id>`; `nil` — lista kampanii); bez dostępu do ekranu — strona CRM.
    func showCampaign(_ id: String?) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/campaigns" }) else {
            openCRM(id.map { "/crm/campaigns?campaign=\($0)" } ?? "/crm/campaigns")
            return
        }
        openHref("/crm/campaigns")
        guard let id else { return }
        mailCampaigns.requestedID = id
        if mailCampaigns.campaigns.contains(where: { $0.id == id }) { mailCampaigns.selectedID = id }
        Task { await mailCampaigns.load(quiet: true) }
    }
}
