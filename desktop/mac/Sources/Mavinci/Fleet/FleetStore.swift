import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Flota — stan ekranu: lista (`op=list`), karty pojazdów (`op=vehicle`), oś czasu (`op=timeline`) i zapisy przez
// `/bridge/native/v1/fleet`. Zdjęcia galerii i paragony idą tym samym serwerem (multipart, token pracownika).

@MainActor final class FleetStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var list: FleetListState?
    @Published var loadError: String?
    @Published private(set) var loading = false
    @Published private(set) var details: [String: FleetVehicleDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    /// Otwarta karta pojazdu (`/crm/fleet/<id>`); `nil` — lista.
    @Published var openedID: String?
    /// Karta nowego pojazdu (ten sam formularz co edycja) zamiast listy.
    @Published var creating = false
    /// Zakładka karty otwieranej z innego miejsca (np. po dodaniu pojazdu).
    @Published var openedTab: FleetVehicleTab?
    /// Karta otwierana od razu w trybie edycji („Edytuj” z listy).
    @Published var editRequested = false

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: FleetAccess? { list?.access ?? openedID.flatMap { details[$0]?.access } }
    var dictionaries: FleetDictionaries? { list?.dictionaries ?? details.values.first?.dictionaries }

    func reset() {
        list = nil; loadError = nil; loading = false; details = [:]; detailErrors = [:]; openedID = nil; creating = false; openedTab = nil; editRequested = false
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func load() async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        loading = true
        defer { loading = false }
        do {
            let data = try JSONDecoder().decode(FleetListState.self, from: try await api.get("/fleet?op=list"))
            guard owner == workspace?.employee?.id else { return }
            list = data
            loadError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            loadError = failureText(error, "Nie udało się wczytać floty.")
        }
    }

    func loadDetail(_ id: String) async {
        guard let api else { detailErrors[id] = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        do {
            let data = try JSONDecoder().decode(FleetVehicleDetail.self, from: try await api.get("/fleet", query: ["op": "vehicle", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            details[id] = data
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            detailErrors[id] = failureText(error, "Nie udało się wczytać pojazdu.")
        }
    }

    func timeline(vehicleID: String?, from: Date, to: Date) async throws -> FleetTimelineData {
        guard let api else { throw AppError.configuration }
        var query = ["op": "timeline", "from": MeetingDates.iso(from), "to": MeetingDates.iso(to)]
        if let vehicleID { query["id"] = vehicleID }
        return try JSONDecoder().decode(FleetTimelineData.self, from: try await api.get("/fleet", query: query))
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/fleet", payload))) ?? [:]
    }

    /// Zapis z paskiem postępu; komunikat sukcesu z serwera, odświeżenie karty i listy. Zwraca odpowiedź albo `nil` przy błędzie.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], reload vehicleID: String?) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            if let vehicleID { await loadDetail(vehicleID) }
            Task { await load() }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// Usunięcie (`op=delete`) z paskiem postępu; po sukcesie karta pojazdu znika z pamięci i z ekranu. Zwraca `true` przy sukcesie.
    @discardableResult func remove(_ pending: String, id: String) async -> Bool {
        let body: [String: JSONValue] = ["id": .string(id)]
        let reply: [String: JSONValue]? = await run(pending, "delete", body, reload: nil)
        guard reply != nil else { return false }
        details[id] = nil
        detailErrors[id] = nil
        if openedID == id { openedID = nil }
        return true
    }

    /// Plik przez serwer CRM (multipart, pole „file”): `image` — zdjęcie galerii, `receipt` — paragon (zwraca adres).
    @discardableResult func upload(_ op: String, vehicleID: String, file url: URL) async throws -> [String: JSONValue] {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/fleet") else { throw AppError.configuration }
        components.queryItems = [URLQueryItem(name: "op", value: op), URLQueryItem(name: "vehicleId", value: vehicleID)]
        guard let target = components.url else { throw AppError.configuration }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var payload = try Data(contentsOf: url)
        var name = url.lastPathComponent
        var mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        // Duże zdjęcia zmniejszamy do JPEG (limit 10 MB jak w CRM).
        if mime.hasPrefix("image/"), payload.count > 10 * 1024 * 1024, let jpeg = ImageJPEG.from(url, maxSide: 3000) {
            payload = jpeg; mime = "image/jpeg"; name = url.deletingPathExtension().lastPathComponent + ".jpg"
        }
        let boundary = "mavinci-\(UUID().uuidString)"
        let safeName = name.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
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
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Błąd podczas przesyłania pliku", fieldErrors: [:])
        }
        return object
    }

    /// Zdjęcia do galerii pojazdu — po kolei, z paskiem postępu (jak `VehicleGallery`).
    func uploadImages(_ urls: [URL], vehicleID: String) async {
        guard !urls.isEmpty, let workspace else { return }
        var failures: [String] = []
        var sent = 0
        for (index, url) in urls.enumerated() {
            let label = urls.count > 1 ? "Przesyłanie \(index + 1)/\(urls.count)…" : "Przesyłanie…"
            await workspace.withPending(label) {
                do {
                    guard UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) ?? false else {
                        failures.append("\(url.lastPathComponent) nie jest obrazem"); return
                    }
                    try await upload("image", vehicleID: vehicleID, file: url)
                    sent += 1
                } catch {
                    failures.append(failureText(error, "Błąd podczas przesyłania \(url.lastPathComponent)"))
                }
            }
        }
        if !failures.isEmpty { workspace.error = failures.joined(separator: "\n") }
        if sent > 0 {
            if failures.isEmpty { workspace.succeed("Przesyłanie zakończone") }
            await loadDetail(vehicleID)
            Task { await load() }
        }
    }
}

extension Workspace {
    /// Karta pojazdu na ekranie Floty (`/crm/fleet/<id>`); bez dostępu do ekranu — strona CRM.
    func showVehicle(_ id: String, tab: FleetVehicleTab? = nil) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/fleet" }) {
            openHref("/crm/fleet")
            fleet.creating = false
            fleet.openedTab = tab
            fleet.editRequested = false
            fleet.openedID = id
        } else {
            openCRM("/crm/fleet/\(id)")
        }
    }
}
