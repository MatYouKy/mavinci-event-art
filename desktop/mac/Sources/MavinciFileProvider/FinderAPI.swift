import FileProvider
import Foundation

// MARK: Połączenie rozszerzenia z serwerem CRM — token ze wspólnej sesji (`FinderShared`), RLS jak w przeglądarce.
// Pliki wydarzeń: `/bridge/native/v1/files`, Materiały: `/bridge/native/v1/materials` (`endpoint: .materials`),
// Dysk (Oferty, Kalkulacje, Umowy, Magazyn, księga znaku): `/bridge/native/v1/drive` (`endpoint: .drive`).

enum FinderAPI {
    enum Endpoint: String {
        case files = "/bridge/native/v1/files"
        case materials = "/bridge/native/v1/materials"
        case drive = "/bridge/native/v1/drive"
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 3600
        c.httpShouldSetCookies = false
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    private static func makeRequest(_ endpoint: Endpoint, query: [String: String]? = nil) async throws -> URLRequest {
        guard let connection = FinderShared.connection() else { throw NSFileProviderError(.notAuthenticated) }
        var components = URLComponents(string: connection.crm.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + endpoint.rawValue)
        if let query { components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = components?.url else { throw NSFileProviderError(.serverUnreachable) }
        let token: String
        do { token = try await FinderShared.validAccessToken() } catch { throw mapped(error) }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(FinderShared.client, forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue(FinderShared.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    static func get<T: Decodable>(_ query: [String: String], as type: T.Type, endpoint: Endpoint = .files) async throws -> T {
        let request = try await makeRequest(endpoint, query: query)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) } catch { throw NSFileProviderError(.serverUnreachable) }
        guard let http = response as? HTTPURLResponse else { throw NSFileProviderError(.serverUnreachable) }
        switch http.statusCode {
        case 200..<300:
            do { return try JSONDecoder().decode(T.self, from: data) } catch {
                NSLog("[Mavinci Finder] odpowiedź %@: %@", query["op"] ?? "", error.localizedDescription)
                throw NSFileProviderError(.serverUnreachable)
            }
        case 401:
            throw NSFileProviderError(.notAuthenticated)
        case 404, 410:
            throw NSFileProviderError(.noSuchItem)
        default:
            NSLog("[Mavinci Finder] %@ → HTTP %d", query["op"] ?? "", http.statusCode)
            throw refusal(endpoint, status: http.statusCode, data: data)
        }
    }

    /// Wartość JSON dla pola, które może być puste (`null` — np. główny folder wydarzenia).
    static func json(_ value: String?) -> Any {
        if let value { return value }
        return NSNull()
    }

    /// Zapis: `{op, …}` → odpowiedź; odmowa serwera jako `FinderServerError` / `MaterialServerError` (kod, komunikat,
    /// aktualny plik przy konflikcie).
    static func post<T: Decodable>(_ body: [String: Any], as type: T.Type, endpoint: Endpoint = .files) async throws -> T {
        var request = try await makeRequest(endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) } catch { throw NSFileProviderError(.serverUnreachable) }
        guard let http = response as? HTTPURLResponse else { throw NSFileProviderError(.serverUnreachable) }
        if (200..<300).contains(http.statusCode) {
            do { return try JSONDecoder().decode(T.self, from: data) } catch {
                NSLog("[Mavinci Finder] odpowiedź %@: %@", (body["op"] as? String) ?? "", error.localizedDescription)
                throw NSFileProviderError(.serverUnreachable)
            }
        }
        if http.statusCode == 401 { throw NSFileProviderError(.notAuthenticated) }
        let failure = refusal(endpoint, status: http.statusCode, data: data)
        let message = (failure as? FinderServerError)?.message ?? (failure as? MaterialServerError)?.message ?? ""
        NSLog("[Mavinci Finder] %@ → HTTP %d %@", (body["op"] as? String) ?? "", http.statusCode, message)
        throw failure
    }

    /// Odmowa serwera: pliki wydarzeń — `FinderServerError` (`item`), Materiały i Dysk — `MaterialServerError` (`file` tylko w Materiałach).
    private static func refusal(_ endpoint: Endpoint, status: Int, data: Data) -> Error {
        switch endpoint {
        case .files:
            let failure = try? JSONDecoder().decode(FinderFailureBody.self, from: data)
            return FinderServerError(status: status, code: failure?.code, message: failure?.error ?? "Serwer CRM odrzucił zmianę.", item: failure?.item)
        case .materials, .drive:
            let failure = try? JSONDecoder().decode(MaterialFailureBody.self, from: data)
            return MaterialServerError(status: status, code: failure?.code, message: failure?.error ?? "Serwer CRM odrzucił zmianę.", file: failure?.file)
        }
    }

    /// Wysłanie pliku na podpisany adres magazynu (jak „Dodaj pliki” w karcie wydarzenia).
    static func put(_ file: URL, to target: URL, mime: String) async throws {
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        let response: URLResponse
        do { (_, response) = try await session.upload(for: request, fromFile: file) } catch { throw NSFileProviderError(.serverUnreachable) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            NSLog("[Mavinci Finder] wysyłanie → HTTP %d", (response as? HTTPURLResponse)?.statusCode ?? 0)
            throw NSFileProviderError(.serverUnreachable)
        }
    }

    /// Wysłanie danych (miniatura JPEG) na podpisany adres magazynu.
    static func put(_ data: Data, to target: URL, mime: String) async throws {
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        let response: URLResponse
        do { (_, response) = try await session.upload(for: request, from: data) } catch { throw NSFileProviderError(.serverUnreachable) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSFileProviderError(.serverUnreachable)
        }
    }

    /// Pobranie treści pliku z podpisanego adresu magazynu do pliku tymczasowego Findera.
    static func download(_ remote: URL, to destination: URL) async throws {
        let temporary: URL
        let response: URLResponse
        do { (temporary, response) = try await session.download(from: remote) } catch { throw NSFileProviderError(.serverUnreachable) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            try? FileManager.default.removeItem(at: temporary)
            throw NSFileProviderError(.noSuchItem)
        }
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
    }

    /// Błąd dla Findera: wylogowanie → „Zaloguj się”, brak sieci → spróbuj później.
    static func mapped(_ error: Error) -> Error {
        if let server = error as? FinderServerError { return mapped(status: server.status, message: server.message) }
        if let server = error as? MaterialServerError { return mapped(status: server.status, message: server.message) }
        if let failure = error as? FinderShared.Failure {
            switch failure {
            case .signedOut: return NSFileProviderError(.notAuthenticated)
            case .offline, .server: return NSFileProviderError(.serverUnreachable)
            }
        }
        let ns = error as NSError
        if ns.domain == NSFileProviderErrorDomain || ns.domain == NSCocoaErrorDomain { return error }
        return NSFileProviderError(.serverUnreachable)
    }

    private static func mapped(status: Int, message: String) -> Error {
        switch status {
        case 401: return NSFileProviderError(.notAuthenticated)
        case 403: return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError, userInfo: [NSLocalizedDescriptionKey: message])
        case 404, 410: return NSFileProviderError(.noSuchItem)
        case 400, 409, 413: return NSFileProviderError(.cannotSynchronize, userInfo: [NSLocalizedDescriptionKey: message])
        default: return NSFileProviderError(.serverUnreachable)
        }
    }
}

/// Treść odmowy serwera (`{error, code, item?}`) — poza funkcją generyczną, bo Swift nie pozwala zagnieżdżać w niej typów.
private struct FinderFailureBody: Decodable {
    let error: String?
    let code: String?
    let item: FinderFileDTO?
}

/// Treść odmowy serwera Materiałów (`{error, code, file?}`).
private struct MaterialFailureBody: Decodable {
    let error: String?
    let code: String?
    let file: MaterialFileDTO?
}
