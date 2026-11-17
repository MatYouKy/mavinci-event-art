import Foundation
import SwiftUI

// MARK: Bazy danych — stan ekranu (`/crm/databases`): lista baz, otwarte arkusze i zapisy przez `/bridge/native/v1/databases`.

@MainActor final class CustomDatabasesStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var list: CustomDatabaseList?
    @Published var listError: String?
    @Published private(set) var loading = false
    @Published private(set) var details: [String: CustomDatabaseDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    /// Otwarta baza (`/crm/databases/<id>`); `nil` — lista.
    @Published var openedID: String?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: CustomDatabaseAccess? { list?.access ?? openedID.flatMap { details[$0]?.access } }

    func reset() {
        list = nil; listError = nil; loading = false; details = [:]; detailErrors = [:]; openedID = nil
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func load() async {
        guard let api else { listError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        loading = true
        defer { loading = false }
        do {
            let data = try JSONDecoder().decode(CustomDatabaseList.self, from: try await api.get("/databases", query: ["op": "list"]))
            guard owner == workspace?.employee?.id else { return }
            list = data
            listError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            listError = failureText(error, "Błąd podczas ładowania baz danych")
        }
    }

    func loadDetail(_ id: String) async {
        guard let api else { detailErrors[id] = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(CustomDatabaseDetail.self, from: try await api.get("/databases", query: ["op": "database", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            details[id] = data
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            detailErrors[id] = failureText(error, "Nie udało się wczytać bazy danych.")
        }
    }

    func shares(_ id: String) async throws -> CustomDatabaseShares {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(CustomDatabaseShares.self, from: try await api.get("/databases", query: ["op": "shares", "id": id]))
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/databases", payload))) ?? [:]
    }

    /// Zapis z paskiem postępu i komunikatem; odświeża otwartą bazę i listę. Zwraca odpowiedź albo `nil` przy błędzie.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], reload databaseID: String?) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            if let databaseID { await loadDetail(databaseID) }
            Task { await load() }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// Usunięcie (`op=delete`) z paskiem postępu; po sukcesie baza znika z pamięci i z ekranu. Zwraca `true` przy sukcesie.
    @discardableResult func remove(_ pending: String, id: String) async -> Bool {
        let body: [String: JSONValue] = ["id": .string(id)]
        let reply: [String: JSONValue]? = await run(pending, "delete", body, reload: nil)
        guard reply != nil else { return false }
        details[id] = nil
        detailErrors[id] = nil
        if openedID == id { openedID = nil }
        return true
    }

    /// Komórka arkusza — bez okna postępu (edycja jak w arkuszu); rekord podmieniany odpowiedzią serwera.
    func setCell(_ databaseID: String, record recordID: String, column columnID: String, value: JSONValue) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        // Od razu widać nową wartość; przy błędzie wraca stan z serwera.
        if var detail = details[databaseID], let index = detail.records.firstIndex(where: { $0.id == recordID }) {
            detail.records[index].data[columnID] = value
            details[databaseID] = detail
        }
        do {
            let reply = try await post("cell", ["id": .string(recordID), "columnId": .string(columnID), "value": value])
            if let raw = reply["record"], let data = try? JSONEncoder().encode(raw),
               let record = try? JSONDecoder().decode(CustomDatabaseRecord.self, from: data),
               var detail = details[databaseID], let index = detail.records.firstIndex(where: { $0.id == recordID }) {
                detail.records[index] = record
                details[databaseID] = detail
            }
        } catch {
            workspace.error = failureText(error, "Błąd podczas aktualizacji komórki")
            await loadDetail(databaseID)
        }
    }

    /// Szerokość kolumny po przeciągnięciu krawędzi nagłówka (zapis w tle).
    func setWidth(_ databaseID: String, column columnID: String, width: Double) async {
        if var detail = details[databaseID], let index = detail.columns.firstIndex(where: { $0.id == columnID }) {
            detail.columns[index].width = width
            details[databaseID] = detail
        }
        guard workspace?.canWrite == true else { return }
        do { try await post("columnUpdate", ["id": .string(columnID), "width": .number(width.rounded())]) }
        catch { workspace?.error = failureText(error, "Nie udało się zapisać szerokości kolumny.") }
    }
}

extension Workspace {
    /// Baza danych na ekranie Baz Danych (`/crm/databases/<id>`); bez dostępu do ekranu — strona CRM.
    func showDatabase(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/databases" }) {
            openHref("/crm/databases")
            databases.openedID = id
        } else {
            openCRM("/crm/databases/\(id)")
        }
    }
}
