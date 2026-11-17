import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Lokalizacje — stan ekranu (`/crm/locations`): lista, szczegóły obiektów, formularz dodawania i edycji, zapisy
// i materiały przez `/bridge/native/v1/locations` (token pracownika).

@MainActor final class LocationsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var list: CrmLocationList?
    @Published var listError: String?
    @Published private(set) var loading = false
    @Published private(set) var details: [String: CrmLocationDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    /// Otwarte szczegóły obiektu (`/crm/locations/<id>`); `nil` — lista.
    @Published var openedID: String?
    /// Formularz: nowa lokalizacja albo edycja wskazanej (ten sam formularz).
    @Published var creating = false
    @Published var editingID: String?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: CrmLocationAccess? { list?.access ?? openedID.flatMap { details[$0]?.access } }

    func reset() {
        list = nil; listError = nil; loading = false; details = [:]; detailErrors = [:]; openedID = nil; creating = false; editingID = nil
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
            let data = try JSONDecoder().decode(CrmLocationList.self, from: try await api.get("/locations", query: ["op": "list"]))
            guard owner == workspace?.employee?.id else { return }
            list = data
            listError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            listError = failureText(error, "Błąd podczas ładowania lokalizacji")
        }
    }

    func loadDetail(_ id: String) async {
        guard let api else { detailErrors[id] = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(CrmLocationDetail.self, from: try await api.get("/locations", query: ["op": "location", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            details[id] = data
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            detailErrors[id] = failureText(error, "Błąd podczas pobierania lokalizacji")
        }
    }

    func placeSearch(_ input: String, session: String) async throws -> [CrmPlacePrediction] {
        struct Reply: Decodable { var predictions: [CrmPlacePrediction] }
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/locations", query: ["op": "placeSearch", "input": input, "sessiontoken": session])).predictions
    }

    func placeDetails(_ placeID: String, session: String) async throws -> CrmPlaceDetails {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(CrmPlaceDetails.self, from: try await api.get("/locations", query: ["op": "placeDetails", "placeId": placeID, "sessiontoken": session]))
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/locations", payload))) ?? [:]
    }

    /// Zapis z paskiem postępu i komunikatem; odświeża szczegóły obiektu i listę. Zwraca odpowiedź albo `nil` przy błędzie.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], reload locationID: String?) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            if let locationID { await loadDetail(locationID) }
            Task { await load() }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// Usunięcie (`op=delete`) z paskiem postępu; po sukcesie lokalizacja znika z pamięci i z ekranu. Zwraca `true` przy sukcesie.
    @discardableResult func remove(_ pending: String, id: String) async -> Bool {
        let body: [String: JSONValue] = ["id": .string(id)]
        let reply: [String: JSONValue]? = await run(pending, "delete", body, reload: nil)
        guard reply != nil else { return false }
        details[id] = nil
        detailErrors[id] = nil
        if openedID == id { openedID = nil }
        return true
    }

    /// Materiał obiektu lub sali (multipart, pole „file”): `kind` — `plan` albo `photo`. Zwraca wpis do listy materiałów.
    func uploadMaterial(locationID: String, kind: String, file url: URL) async throws -> CrmLocationAsset {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/locations") else { throw AppError.configuration }
        components.queryItems = [URLQueryItem(name: "op", value: "upload"), URLQueryItem(name: "locationId", value: locationID), URLQueryItem(name: "kind", value: kind)]
        guard let target = components.url else { throw AppError.configuration }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let payload = try Data(contentsOf: url)
        guard !payload.isEmpty, payload.count <= 20 * 1024 * 1024, url.lastPathComponent.count <= 255 else {
            throw NativeFailure(status: 400, message: "Plik „\(url.lastPathComponent)” musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków.", fieldErrors: [:])
        }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let boundary = "mavinci-\(UUID().uuidString)"
        let safeName = url.lastPathComponent.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(payload)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się przesłać pliku „\(url.lastPathComponent)”.", fieldErrors: [:])
        }
        guard let asset = object["asset"].flatMap({ CrmLocationAsset($0) }) else { throw AppError.invalidResponse }
        return asset
    }
}

extension Workspace {
    /// Szczegóły obiektu na ekranie Lokalizacji (`/crm/locations/<id>`); bez dostępu do ekranu — strona CRM.
    func showLocation(_ id: String) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/locations" }) {
            openHref("/crm/locations")
            locations.creating = false
            locations.editingID = nil
            locations.openedID = id
        } else {
            openCRM("/crm/locations/\(id)")
        }
    }
}
