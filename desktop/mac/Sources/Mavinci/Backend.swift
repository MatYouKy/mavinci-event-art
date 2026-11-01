import Foundation

/// Future owned server implements this contract; views never depend on Supabase URLs or SQL.
protocol WorkspaceBackend: Actor {
    func login(email: String, password: String) async throws -> Session
    func restore(_ session: Session) async
    func profile() async throws -> Employee
    func sync(_ module: Module, hashes: [String: String]) async throws -> SyncReply
    func fullRead(_ module: Module, employee: Employee) async throws -> [Row]
    func salesDay() async throws -> JSONValue
    func command(_ name: String, row: Row?, payload: [String: JSONValue]) async throws
    func logout() async
}

actor HTTPBackend: WorkspaceBackend {
    let connection: Connection
    private var session: Session?
    private var invalidated = false
    private var refreshJob: Task<Session, Error>?
    private let http: URLSession
    init(_ connection: Connection) {
        self.connection = connection
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25
        c.timeoutIntervalForResource = 60
        c.httpShouldSetCookies = false
        http = URLSession(configuration: c)
    }
    var native: Bool { connection.provider == .server }
    private var sessionKey: String { "session-\(connection.identity)" }
    func restore(_ session: Session) { self.session = session }
    private func persist(_ s: Session) throws {
        guard !invalidated else { throw AppError.unauthorized }
        try Vault.write(sessionKey, JSONEncoder().encode(s)); session = s
    }
    func login(email: String, password: String) async throws -> Session {
        let path = native ? "/api/native/v1/login" : "/auth/v1/token"
        let data = try await request(path, query: native ? [] : [.init(name: "grant_type", value: "password")],
            body: ["email": .string(email), "password": .string(password)], auth: false)
        let s = try JSONDecoder().decode(Session.self, from: data)
        try persist(s)
        return s
    }
    func token() async throws -> String {
        guard let s = session else { throw AppError.unauthorized }
        if s.expiresAt > Date().timeIntervalSince1970 + 90 { return s.access_token }
        if let refreshJob { return try await refreshJob.value.access_token }
        let path = native ? "/api/native/v1/refresh" : "/auth/v1/token"
        let job = Task<Session, Error> {
            let data = try await self.request(path, query: self.native ? [] : [.init(name: "grant_type", value: "refresh_token")],
                body: ["refresh_token": .string(s.refresh_token)], auth: false)
            return try JSONDecoder().decode(Session.self, from: data)
        }
        refreshJob = job
        defer { refreshJob = nil }
        let renewed = try await job.value
        try persist(renewed)
        return renewed.access_token
    }
    func request(_ path: String, method: String? = nil, query: [URLQueryItem] = [], body: [String: JSONValue]? = nil, auth: Bool = true, range: Int? = nil, rawBody: Data? = nil, contentType: String? = nil) async throws -> Data {
        guard connection.valid, var u = URLComponents(string: connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw AppError.configuration }
        u.queryItems = query.isEmpty ? nil : query
        guard let url = u.url else { throw AppError.configuration }
        var req = URLRequest(url: url)
        req.httpMethod = method ?? (body == nil ? "GET" : "POST")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !native { req.setValue(connection.publicKey, forHTTPHeaderField: "apikey") }
        if auth { req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization") }
        req.setValue("MavinciDesktop/0.1", forHTTPHeaderField: "User-Agent")
        if let body { req.httpBody = try JSONEncoder().encode(body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let rawBody { req.httpBody = rawBody; req.setValue(contentType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type") }
        if req.httpMethod == "PATCH" || req.httpMethod == "POST" { req.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        if let range {
            req.setValue("items", forHTTPHeaderField: "Range-Unit")
            req.setValue("\(range)-\(range + 199)", forHTTPHeaderField: "Range")
        }
        let (data, response) = try await http.data(for: req)
        guard let response = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let failure = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if path.hasSuffix("native_workspace_sync") {
                if failure?["code"] as? String == "PGRST202" { throw AppError.missingSync }
                if failure?["code"] as? String == "22023",body?["p_set"]?.text == "calendar",failure?["message"] as? String == "Nieznany zbiór." {throw AppError.missingSync}
            }
            if response.statusCode == 401 { throw AppError.unauthorized }
            if response.statusCode == 403 { throw AppError.forbidden }
            if response.statusCode == 409 { throw AppError.conflict }
            #if DEBUG
            let code = failure?["code"] as? String ?? "nieznany"
            print("[Mavinci] HTTP \(response.statusCode) • \(req.httpMethod ?? "GET") \(path) • kod: \(code)")
            #endif
            throw AppError.server
        }
        return data
    }
    func profile() async throws -> Employee {
        if native { return try JSONDecoder().decode(Employee.self, from: await request("/api/native/v1/me")) }
        guard let session else { throw AppError.unauthorized }
        let select = "id,auth_user_id,name,surname,role,access_level,permissions,finance_access_scope,company_access_mode,my_company_ids,invoice_company_permissions,finance_company_access,sales_team_id,is_active,event_tabs,access_levels(event_tabs)"
        let data = try await request("/rest/v1/employees", query: [.init(name: "select", value: select), .init(name: "auth_user_id", value: "eq.\(session.user.id)"), .init(name: "is_active", value: "eq.true")])
        let rows = try JSONDecoder().decode([Employee].self, from: data)
        guard rows.count == 1 else { throw AppError.noEmployee }
        return rows[0]
    }
    func sync(_ module: Module, hashes: [String: String]) async throws -> SyncReply {
        let data = try await request(native ? "/api/native/v1/sync" : "/rest/v1/rpc/native_workspace_sync",
            body: ["p_set": .string(module.rawValue), "p_hashes": .object(hashes.mapValues(JSONValue.string))])
        return try JSONDecoder().decode(SyncReply.self, from: data)
    }
    func read(_ table: String, _ select: String, _ filters: [String: String]) async throws -> [Row] {
        var all: [Row] = []
        for offset in stride(from: 0, to: 100_000, by: 200) {
            let query = [URLQueryItem(name: "select", value: select), .init(name: "order", value: "id.asc")] + filters.map { URLQueryItem(name: $0.key, value: $0.value) }
            let data = try await request("/rest/v1/\(table)", query: query, range: offset)
            let rows = try JSONDecoder().decode([Row].self, from: data)
            all += rows
            if rows.count < 200 { return all }
        }
        // Do not silently present a truncated collection as complete.
        throw AppError.invalidResponse
    }
    static let taskFields = "id,title,description,priority,status,board_column,due_date,created_at,updated_at,is_private,owner_id,created_by,event_id,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details,next_action_at,archived_at,deleted_at"
    static let contactFields = "id,first_name,last_name,email,phone,mobile,status,last_contact_date,tags"
    static let eventFields = "id,name,description,event_date,event_end_date,status,location,created_by,created_at,updated_at"
    static let offerFields = "id,title,offer_number,status,valid_until,inquiry_id,event_id,created_at,updated_at"
    static let tenderFields = "id,title,status,submission_deadline,assigned_to,inquiry_id,created_at"
    func fullRead(_ module: Module, employee: Employee) async throws -> [Row] {
        guard !native else { throw AppError.unsupported }
        switch module {
        case .tasks:
            guard let session else { throw AppError.unauthorized }
            let own = try await read("tasks", Self.taskFields, ["owner_id": "eq.\(session.user.id)", "is_private": "eq.true", "is_inquiry": "eq.false", "deleted_at": "is.null"])
            let assigned = try await read("tasks", Self.taskFields + ",assigned_filter:task_assignees!inner()", ["assigned_filter.employee_id": "eq.\(employee.id)", "is_private": "eq.false", "is_inquiry": "eq.false", "deleted_at": "is.null"])
            return Array(Dictionary((own + assigned).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values)
        case .inquiries: return try await read("tasks", Self.taskFields, ["is_inquiry":"eq.true", "deleted_at":"is.null", "archived_at":"is.null"])
        case .contacts: return try await read("contacts", Self.contactFields, ["status":"eq.active"])
        case .events: return try await read("events", Self.eventFields, [:])
        case .offers: return try await read("offers", Self.offerFields, [:])
        case .tenders: return try await read("tenders", Self.tenderFields, [:])
        case .notifications:
            let rows = try await read("notification_recipients", "id,is_read,notification:notifications(id,title,message,category,related_entity_type,related_entity_id,action_url,created_at)", ["user_id": "eq.\(employee.id)"])
            return rows.compactMap { r in
                var fields = r.fields["notification"]?.object ?? [:]
                guard !fields.isEmpty, fields["related_entity_type"]?.text != "event_phase_assignment" else { return nil }
                fields["id"] = r.fields["id"]; fields["is_read"] = r.fields["is_read"]
                return Row(fields)
            }
        case .calendar: return try await calendarRows(employee: employee)
        case .day: return []
        }
    }
    func salesDay() async throws -> JSONValue {
        let data = try await request(native ? "/api/native/v1/sales-day" : "/rest/v1/rpc/get_my_sales_day", body: [:])
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
    func command(_ name: String, row: Row?, payload: [String: JSONValue]) async throws {
        if native {
            var body = payload; body["command"] = .string(name); body["id"] = row.map { .string($0.id) } ?? .null
            if name == "task_update", let row { body["expected_updated_at"] = .string(row["updated_at"]) }
            _ = try await request("/api/native/v1/command", body: body)
            return
        }
        switch name {
        case "task_create":
            guard let session else { throw AppError.unauthorized }
            var body = payload; body["owner_id"] = .string(session.user.id)
            body["is_private"] = .bool(true); body["is_inquiry"] = .bool(false); body["event_id"] = .null
            _ = try await request("/rest/v1/tasks", body: body)
        case "task_update":
            guard let row, !row["updated_at"].isEmpty else { throw AppError.conflict }
            let data = try await request("/rest/v1/tasks", method: "PATCH", query: [.init(name:"id", value:"eq.\(row.id)"), .init(name:"updated_at", value:"eq.\(row["updated_at"])")], body: payload)
            guard try JSONDecoder().decode([Row].self, from: data).count == 1 else { throw AppError.conflict }
        case "notification_read":
            guard let row else { throw AppError.invalidResponse }
            let data = try await request("/rest/v1/notification_recipients", method: "PATCH", query: [.init(name:"id",value:"eq.\(row.id)")], body: ["is_read": .bool(true), "read_at": .string(ISO8601DateFormatter().string(from: Date()))])
            guard try JSONDecoder().decode([Row].self, from: data).count == 1 else { throw AppError.conflict }
        case "claim_inquiry", "snooze_inquiry_followup", "complete_inquiry_followup":
            guard let row else { throw AppError.invalidResponse }
            var body = payload; body["p_inquiry_id"] = .string(row.id)
            _ = try await request("/rest/v1/rpc/\(name)", body: body)
        default: throw AppError.unsupported
        }
    }
    func logout() async {
        let old = session
        invalidated = true; session = nil
        refreshJob?.cancel(); refreshJob = nil
        try? Vault.delete(sessionKey)
        // Revoke with the captured token; never refresh or persist credentials during sign-out.
        guard let old, let url = URL(string: connection.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + (native ? "/api/native/v1/logout" : "/auth/v1/logout?scope=local")) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(old.access_token)", forHTTPHeaderField: "Authorization")
        if !native { req.setValue(connection.publicKey, forHTTPHeaderField: "apikey") }
        _ = try? await http.data(for: req)
    }
}
