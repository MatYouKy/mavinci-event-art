import Foundation
import SwiftUI

// MARK: Czas pracy — stan ekranu (`/crm/time-tracking`): moje wpisy z licznikiem, raport zespołu, strony pracowników
// (`/crm/time-tracking/<id>`), rozmowy o wpisach, rozliczenia i wynagrodzenie. Wszystko przez `/bridge/native/v1/time`.

@MainActor final class TimeTrackingStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: WorkTimeHome?
    @Published var homeError: String?
    @Published private(set) var loadingHome = false
    @Published private(set) var dashboard: WorkTimeDashboard?
    @Published var dashboardError: String?
    @Published private(set) var loadingDashboard = false
    @Published private(set) var pages: [String: WorkTimeEmployeePage] = [:]
    @Published var pageErrors: [String: String] = [:]
    @Published private(set) var threads: [WorkTimeThread] = []
    @Published private(set) var discussionError = ""
    /// Otwarta strona pracownika (`/crm/time-tracking/<id>`); `nil` — ekran główny.
    @Published var openedEmployeeID: String?
    /// Wpis, którego rozmowę otworzyć (powiadomienie `?discussion=<wpis>`).
    @Published var focusDiscussion: String?
    /// Licznik zmian danych — karty rozliczenia i wynagrodzenia odświeżają się po zapisie.
    @Published private(set) var revision = 0

    private var dashboardQuery: (from: String, to: String, employee: String?)?
    private var employeeQuery: (id: String, from: String, to: String)?
    private var dashboardSequence = 0
    private var employeeSequence = 0

    var api: NativeAPI? { workspace?.nativeAPI() }
    var me: WorkTimeMe? { home?.me ?? pages.values.first?.me }
    var isAdmin: Bool { me?.isAdmin ?? false }

    func reset() {
        home = nil; homeError = nil; loadingHome = false; dashboard = nil; dashboardError = nil; loadingDashboard = false
        pages = [:]; pageErrors = [:]; threads = []; discussionError = ""; openedEmployeeID = nil; focusDiscussion = nil
        dashboardQuery = nil; employeeQuery = nil; revision = 0
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func thread(for entryID: String) -> WorkTimeThread? { threads.first { $0.entryId == entryID } }

    private func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/time", query: query))
    }

    private func apply(_ discussions: WorkTimeDiscussions) {
        threads = discussions.threads
        discussionError = discussions.error
    }

    func loadHome() async {
        guard api != nil else { homeError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        loadingHome = true
        defer { loadingHome = false }
        do {
            let data = try await get(WorkTimeHome.self, ["op": "home"])
            guard owner == workspace?.employee?.id else { return }
            home = data
            apply(data.discussions)
            homeError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            homeError = failureText(error, "Błąd podczas ładowania wpisów czasu")
        }
    }

    func loadDashboard(from: String, to: String, employee: String?) async {
        guard api != nil else { dashboardError = "Brak połączenia z serwerem CRM."; return }
        dashboardQuery = (from, to, employee)
        dashboardSequence += 1
        let sequence = dashboardSequence
        let owner = workspace?.employee?.id
        loadingDashboard = true
        defer { if sequence == dashboardSequence { loadingDashboard = false } }
        var query = ["op": "dashboard", "from": from, "to": to]
        if let employee { query["employee"] = employee }
        do {
            let data = try await get(WorkTimeDashboard.self, query)
            guard sequence == dashboardSequence, owner == workspace?.employee?.id else { return }
            dashboard = data
            dashboardError = nil
        } catch {
            guard sequence == dashboardSequence, owner == workspace?.employee?.id else { return }
            dashboardError = failureText(error, "Błąd podczas pobierania danych")
        }
    }

    func loadEmployee(_ id: String, from: String, to: String) async {
        guard api != nil else { pageErrors[id] = "Brak połączenia z serwerem CRM."; return }
        employeeQuery = (id, from, to)
        employeeSequence += 1
        let sequence = employeeSequence
        let owner = workspace?.employee?.id
        do {
            let data = try await get(WorkTimeEmployeePage.self, ["op": "employee", "id": id, "from": from, "to": to])
            guard sequence == employeeSequence, owner == workspace?.employee?.id else { return }
            pages[id] = data
            apply(data.discussions)
            pageErrors[id] = nil
        } catch {
            guard sequence == employeeSequence, owner == workspace?.employee?.id else { return }
            pageErrors[id] = failureText(error, "Błąd podczas ładowania danych")
        }
    }

    /// Rozmowy o wpisach (jak `useTimeEntryDiscussions`: co 20 s i po zmianie).
    func refreshDiscussions() async {
        guard let data = try? await get(WorkTimeDiscussions.self, ["op": "discussions"]) else { return }
        apply(data)
    }

    /// Odświeżenie tego, co jest na ekranie (przycisk „Odśwież”, po zapisie).
    func reloadVisible() async {
        if home != nil || openedEmployeeID == nil { await loadHome() }
        if let query = dashboardQuery, openedEmployeeID == nil, isAdmin { await loadDashboard(from: query.from, to: query.to, employee: query.employee) }
        if let id = openedEmployeeID, let query = employeeQuery, query.id == id { await loadEmployee(id, from: query.from, to: query.to) }
        revision += 1
    }

    func history(_ entryID: String) async throws -> [WorkTimeChange] {
        struct Reply: Decodable { var history: [WorkTimeChange] }
        return try await get(Reply.self, ["op": "history", "entry": entryID]).history
    }

    func settlement(employee: String, until: Date) async throws -> WorkTimeSettlementPreview {
        try await get(WorkTimeSettlementPreview.self, ["op": "settlement", "employee": employee, "until": MeetingDates.iso(until)])
    }

    func earnings(employee: String, month: String) async throws -> WorkTimeEarnings {
        try await get(WorkTimeEarnings.self, ["op": "earnings", "employee": employee, "month": month])
    }

    func contracts(employee: String) async throws -> [WorkTimeContract] {
        struct Reply: Decodable { var contracts: [WorkTimeContract] }
        return try await get(Reply.self, ["op": "contracts", "employee": employee]).contracts
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/time", payload))) ?? [:]
    }

    /// Zapis z paskiem postępu i komunikatem; po sukcesie odświeża ekran. Zwraca `true`, gdy się udało.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String? = nil) async -> Bool {
        guard let workspace else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = success ?? reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            await reloadVisible()
            await refreshDiscussions()
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    /// Po zapisie rozliczenia lub umowy w kartach — odświeżenie pozostałych kart.
    func bump() { revision += 1 }
}

extension Workspace {
    /// Czas pracy: ekran główny albo strona pracownika (`/crm/time-tracking/<id>`), opcjonalnie z otwartą rozmową o wpisie.
    func showTimeTracking(employee: String?, discussion: String? = nil) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/time-tracking" }) {
            openHref("/crm/time-tracking")
            timeTracking.openedEmployeeID = employee
            timeTracking.focusDiscussion = discussion
        } else {
            var target = "/crm/time-tracking" + (employee.map { "/\($0)" } ?? "")
            if let discussion { target += "?discussion=\(discussion)" }
            openCRM(target)
        }
    }
}
