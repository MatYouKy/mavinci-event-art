import Foundation
import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Rental → Wypożyczenia klientom — stan ekranu: lista (`op=list`), karta (`op=detail`) i zapisy przez
// `/bridge/native/v1/rental` (te same funkcje bazy co CRM). Pliki (skany, zdjęcia, dokumenty) — multipart przez serwer CRM.

@MainActor final class ClientRentalsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var rentals: [ClientRentalListRow] = []
    @Published private(set) var access = ClientRentalAccess()
    @Published private(set) var loaded = false
    @Published private(set) var loading = false
    @Published var loadError: String?
    @Published private(set) var details: [String: ClientRentalDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    /// Otwarta karta (`/crm/rental/<id>`); `nil` — lista.
    @Published var openedID: String?
    @Published private(set) var busy = false
    @Published private(set) var options: Options?
    /// „Tylko moje” (sprzedaż: wypożyczenia, których jestem opiekunem lub autorem).
    @Published var mine = false
    /// Wypożyczenie utworzone przed chwilą — karta otwiera od razu katalog magazynu (jak `?pozycje=1` w CRM).
    @Published var openItemsFor: String?

    struct Options: Decodable { var companies: [ClientRentalOption]; var employees: [ClientRentalOption]; var vehicles: [ClientRentalOption] }

    var api: NativeAPI? { workspace?.nativeAPI() }

    func reset() {
        rentals = []; access = ClientRentalAccess(); loaded = false; loading = false; loadError = nil; details = [:]; detailErrors = [:]
        openedID = nil; busy = false; options = nil; mine = false; openItemsFor = nil
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
        let mine = self.mine
        loading = true
        defer { loading = false }
        struct Reply: Decodable { var access: ClientRentalAccess; var rentals: [ClientRentalListRow] }
        do {
            let reply = try ClientRentalJSON.decoder.decode(Reply.self, from: try await api.get("/rental", query: ["op": "list", "mine": mine ? "1" : "0"]))
            guard owner == workspace?.employee?.id, mine == self.mine else { return }
            rentals = reply.rentals; access = reply.access; loaded = true; loadError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            loadError = failureText(error, "Nie udało się wczytać wypożyczeń.")
        }
    }

    func loadDetail(_ id: String) async {
        guard let api else { detailErrors[id] = "Brak połączenia z serwerem CRM."; return }
        struct Reply: Decodable { var rental: ClientRentalDetail }
        do {
            let reply = try ClientRentalJSON.decoder.decode(Reply.self, from: try await api.get("/rental", query: ["op": "detail", "id": id]))
            details[id] = reply.rental; detailErrors[id] = nil
        } catch {
            detailErrors[id] = failureText(error, "Nie udało się wczytać wypożyczenia.")
        }
    }

    func loadOptions() async {
        guard options == nil, let api else { return }
        options = try? ClientRentalJSON.decoder.decode(Options.self, from: try await api.get("/rental", query: ["op": "options"]))
    }

    /// GET z dekodowaniem (słowniki, dostępność, konflikty pojazdu, egzemplarze).
    func query<T: Decodable>(_ params: [String: String], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try ClientRentalJSON.decoder.decode(T.self, from: try await api.get("/rental", query: params))
    }

    /// Zapis (POST JSON); odpowiedź z kartą odświeża ją w pamięci. Zwraca odpowiedź albo `nil` (błąd — w `workspace.error`).
    @discardableResult func run(_ body: [String: JSONValue], success: String? = nil, refreshList: Bool = true) async -> [String: JSONValue]? {
        guard let api else { workspace?.error = "Brak połączenia z serwerem CRM."; return nil }
        busy = true
        defer { busy = false }
        do {
            let data = try await api.post("/rental", body)
            struct Reply: Decodable { var rental: ClientRentalDetail? }
            if let rental = try? ClientRentalJSON.decoder.decode(Reply.self, from: data).rental { details[rental.id] = rental }
            let raw = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            if let success { workspace?.notice = success }
            if refreshList { Task { await load() } }
            return raw
        } catch {
            workspace?.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// Plik do wypożyczenia: skan protokołu, zdjęcie, dokument; `protocolPhoto` — zdjęcie do protokołu (zwraca ścieżkę).
    func upload(_ file: URL, rentalID: String, area: String, kind: String, protocolID: String? = nil, protocolPhoto: Bool = false) async throws -> [String: JSONValue] {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm else { throw AppError.configuration }
        var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/rental")
        var items = [URLQueryItem(name: "op", value: "upload"), URLQueryItem(name: "id", value: rentalID), URLQueryItem(name: "area", value: area), URLQueryItem(name: "kind", value: kind)]
        if let protocolID { items.append(URLQueryItem(name: "protocol", value: protocolID)) }
        if protocolPhoto { items.append(URLQueryItem(name: "protocolPhoto", value: "1")) }
        components?.queryItems = items
        guard let url = components?.url else { throw AppError.configuration }
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        let content = try Data(contentsOf: file)
        if content.count > 25 * 1024 * 1024 { throw NativeFailure(status: 400, message: "Plik „\(file.lastPathComponent)” jest większy niż 25 MB.", fieldErrors: [:]) }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let boundary = "mavinci-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(file.lastPathComponent.replacingOccurrences(of: "\"", with: ""))\"\r\nContent-Type: \(type)\r\n\r\n".utf8))
        body.append(content)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
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
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się przesłać pliku „\(file.lastPathComponent)”.", fieldErrors: [:])
        }
        struct Reply: Decodable { var rental: ClientRentalDetail? }
        if let rental = try? ClientRentalJSON.decoder.decode(Reply.self, from: data).rental { details[rental.id] = rental }
        return object
    }

    /// Plik z magazynu `rental-files` — podpisany adres na 10 minut.
    func openFile(_ path: String) async {
        do {
            struct Reply: Decodable { var url: String }
            let reply = try await query(["op": "fileUrl", "path": path], as: Reply.self)
            if let url = URL(string: reply.url) { NSWorkspace.shared.open(url) }
        } catch {
            workspace?.error = failureText(error, "Nie udało się otworzyć pliku.")
        }
    }

    /// PDF protokołu do podpisu — drukowany na Macu (Chrome) albo na serwerze, otwierany w Podglądzie.
    func printProtocol(rentalID: String, protocolID: String, number: String) async {
        guard let workspace else { return }
        do {
            let file = try await workspace.printDocument(path: "/bridge/rental/\(rentalID)/protocols/\(protocolID)", fallbackName: "protokol-\(number).pdf")
            NSWorkspace.shared.open(file)
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować protokołu.")
        }
    }
}

extension Workspace {
    /// Karta wypożyczenia (`/crm/rental/<id>`); bez dostępu do ekranu — strona CRM.
    func showClientRental(_ id: String?) {
        if navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/rental" }) {
            openHref("/crm/rental")
            clientRentals.openedID = id
        } else {
            openCRM(id.map { "/crm/rental/\($0)" } ?? "/crm/rental")
        }
    }
}
