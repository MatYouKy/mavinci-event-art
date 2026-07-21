import Foundation

// MARK: - CRM API Errors

/// Errors that can occur when communicating with the Mavinci CRM API.
enum CRMAPIError: LocalizedError {
    case invalidURL
    case noToken
    case networkError(Error)
    case unauthorized
    case serverError(Int)
    case decodingError(Error)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The CRM base URL is invalid or not configured."
        case .noToken:
            return "No sync token found in Keychain. Please configure your token in Settings."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .unauthorized:
            return "Unauthorized. Your sync token may be expired or invalid."
        case .serverError(let code):
            return "Server returned an error (HTTP \(code))."
        case .decodingError(let error):
            return "Failed to decode the server response: \(error.localizedDescription)"
        case .invalidResponse:
            return "Received an invalid or unexpected response from the server."
        }
    }
}

// MARK: - CRM API Client

/// Handles all HTTP communication with the Mavinci CRM backend.
/// Uses the Bridge API endpoint for task synchronization.
@available(macOS 13.0, *)
final class CRMAPIClient {

    // MARK: - Singleton

    static let shared = CRMAPIClient()

    // MARK: - Constants

    private static let defaultsKeyBaseURL = "crm_base_url"
    private static let timeoutInterval: TimeInterval = 30
    private static let syncPath = "/bridge/tasks/sync"

    // MARK: - Properties

    /// The CRM base URL, read from UserDefaults.
    var baseURL: String {
        UserDefaults.standard.string(forKey: Self.defaultsKeyBaseURL) ?? ""
    }

    /// The session configured with appropriate timeout and caching policies.
    private let session: URLSession

    /// JSON decoder configured for the CRM API response format.
    private let decoder: JSONDecoder

    /// JSON encoder for request bodies.
    private let encoder: JSONEncoder

    // MARK: - Initialization

    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = Self.timeoutInterval
        configuration.timeoutIntervalForResource = Self.timeoutInterval
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData

        self.session = URLSession(configuration: configuration)

        self.decoder = JSONDecoder()
        // The CRM API already returns snake_case keys matching our Codable structs,
        // so we use the default key decoding strategy (no conversion needed).

        self.encoder = JSONEncoder()
    }

    // MARK: - Public API

    /// Fetches all tasks assigned to the authenticated employee from the CRM.
    /// - Returns: The decoded `CRMTasksResponse` containing tasks and metadata.
    /// - Throws: `CRMAPIError` if the request fails for any reason.
    func fetchTasks() async throws -> CRMTasksResponse {
        let url = try buildSyncURL()

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        applyHeaders(to: &request)

        logRequest("GET", url: url)

        let (data, response) = try await performRequest(request)
        try validateHTTPResponse(response)

        do {
            let tasksResponse = try decoder.decode(CRMTasksResponse.self, from: data)
            log("Fetched \(tasksResponse.tasks?.count ?? 0) tasks for \(tasksResponse.employee_name ?? "unknown")")
            return tasksResponse
        } catch {
            throw CRMAPIError.decodingError(error)
        }
    }

    /// Pushes local completion status changes to the CRM backend.
    /// - Parameter updates: An array of task completion state changes to push.
    /// - Returns: The decoded `CompletionResponse` with per-task results.
    /// - Throws: `CRMAPIError` if the request fails for any reason.
    func pushCompletionUpdates(_ updates: [CompletionUpdate]) async throws -> CompletionResponse {
        let url = try buildSyncURL()

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = CompletionRequest(updates: updates)
        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw CRMAPIError.decodingError(error)
        }

        logRequest("POST", url: url, detail: "\(updates.count) update(s)")

        let (data, response) = try await performRequest(request)
        try validateHTTPResponse(response)

        do {
            let completionResponse = try decoder.decode(CompletionResponse.self, from: data)
            log("Push result: success=\(completionResponse.success), results=\(completionResponse.results?.count ?? 0)")
            return completionResponse
        } catch {
            throw CRMAPIError.decodingError(error)
        }
    }

    /// Tests the connection to the CRM by performing a task fetch.
    /// - Returns: A tuple indicating whether the connection succeeded, the number of tasks, and the employee name.
    /// - Throws: `CRMAPIError` if the connection test fails.
    func testConnection() async throws -> (success: Bool, taskCount: Int, employeeName: String) {
        let response = try await fetchTasks()

        guard response.success else {
            let errorMessage = response.error ?? "Unknown server error"
            log("Connection test failed: \(errorMessage)")
            throw CRMAPIError.serverError(0)
        }

        let taskCount = response.tasks?.count ?? 0
        let employeeName = response.employee_name ?? "Unknown"

        log("Connection test passed: \(taskCount) tasks for \(employeeName)")
        return (success: true, taskCount: taskCount, employeeName: employeeName)
    }

    // MARK: - Private Helpers

    /// Builds the sync endpoint URL with the token as a query parameter.
    private func buildSyncURL() throws -> URL {
        print("[CRMAPIClient] buildSyncURL started")

        let base = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        print("[CRMAPIClient] Configured base URL: \(base.isEmpty ? "<EMPTY>" : base)")

        guard !base.isEmpty else {
            print("[CRMAPIClient] Base URL is empty")
            throw CRMAPIError.invalidURL
        }

        print("[CRMAPIClient] Base URL loaded: \(!base.isEmpty)")
        print("[CRMAPIClient] Reading token from Keychain…")

        guard let token = KeychainService.shared.loadToken(), !token.isEmpty else {
            print("[CRMAPIClient] No token found in Keychain")
            throw CRMAPIError.noToken
        }

        print("[CRMAPIClient] Token loaded from Keychain")

        // Ensure HTTPS
        guard base.lowercased().hasPrefix("https://") else {
            log("Rejecting non-HTTPS base URL")
            throw CRMAPIError.invalidURL
        }

        // Build the URL with query parameters
        let urlString = base.hasSuffix("/")
            ? "\(base.dropLast())\(Self.syncPath)"
            : "\(base)\(Self.syncPath)"

        guard var components = URLComponents(string: urlString) else {
            throw CRMAPIError.invalidURL
        }

        components.queryItems = [
            URLQueryItem(name: "token", value: token)
        ]

        guard let url = components.url else {
            throw CRMAPIError.invalidURL
        }

        return url
    }

    /// Applies standard headers to a request.
    private func applyHeaders(to request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("MavinciReminders/1.0 macOS", forHTTPHeaderField: "User-Agent")
    }

    /// Performs the URL request, mapping transport-level errors to `CRMAPIError`.
    private func performRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .timedOut:
                log("Request timed out after \(Self.timeoutInterval)s")
            case .notConnectedToInternet, .networkConnectionLost:
                log("No network connection")
            case .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
                log("TLS/certificate validation failed")
            default:
                log("URL error: \(error.code.rawValue)")
            }
            throw CRMAPIError.networkError(error)
        } catch {
            throw CRMAPIError.networkError(error)
        }
    }

    /// Validates the HTTP response status code.
    private func validateHTTPResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw CRMAPIError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            return // Success
        case 401, 403:
            log("Received unauthorized response (\(httpResponse.statusCode))")
            throw CRMAPIError.unauthorized
        default:
            log("Server error: HTTP \(httpResponse.statusCode)")
            throw CRMAPIError.serverError(httpResponse.statusCode)
        }
    }

    // MARK: - Logging

    /// Logs a message with a masked token for security.
    private func log(_ message: String) {
        print("[CRMAPIClient] \(message)")
    }

    /// Logs an outgoing request with method and masked URL.
    private func logRequest(_ method: String, url: URL, detail: String? = nil) {
        let maskedURL = maskTokenInURL(url)
        let suffix = detail.map { " (\($0))" } ?? ""
        log("\(method) \(maskedURL)\(suffix)")
    }

    /// Replaces the token value in a URL string with a masked version for safe logging.
    private func maskTokenInURL(_ url: URL) -> String {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            return url.absoluteString
        }

        var maskedComponents = components
        maskedComponents.queryItems = queryItems.map { item in
            if item.name == "token", let value = item.value, value.count > 4 {
                let prefix = String(value.prefix(4))
                return URLQueryItem(name: item.name, value: "\(prefix)...")
            }
            return item
        }

        return maskedComponents.url?.absoluteString ?? url.absoluteString
    }
}
