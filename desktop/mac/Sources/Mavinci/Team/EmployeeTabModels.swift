import SwiftUI
import AppKit

// MARK: Dane zakładek administratora karty pracownika (`/bridge/native/v1/employees/profile`, `src/lib/native/teamProfile.ts`).

// Kwalifikacje
struct EmployeeQualifications: Decodable {
    var certifications: [EmployeeCertification]
    var skills: [EmployeeSkillEntry]
    var certificationTypes: [CertificationTypeOption]
    var skillTypes: [SkillTypeOption]
    var licenses: [DrivingLicenseEntry]
    var licenseCategories: [LicenseCategoryOption]
}
struct EmployeeCertification: Decodable, Identifiable, Hashable {
    var id: String
    var typeId: String
    var typeName: String
    var issued: String
    var expiry: String
    var number: String
    var authority: String
    var notes: String
    var active: Bool
    var driving: Bool
    var documentUrl: String
}
struct EmployeeSkillEntry: Decodable, Identifiable, Hashable {
    var id: String
    var skillId: String
    var name: String
    var category: String
    var color: String
    var level: String
    var years: Double?
    var notes: String
}
struct CertificationTypeOption: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var validityMonths: Int?
}
struct SkillTypeOption: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var category: String
}
struct DrivingLicenseEntry: Decodable, Identifiable, Hashable {
    var id: String
    var categoryId: String
    var code: String
    var name: String
    var order: Int
    var obtained: String
    var expiry: String
    var number: String
    var notes: String
}
struct LicenseCategoryOption: Decodable, Identifiable, Hashable {
    var id: String
    var code: String
    var name: String
    var description: String
}

/// Daty dzienne (`RRRR-MM-DD`) w czasie polskim — terminy certyfikatów i praw jazdy.
enum DayDates {
    private static let parser: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = MeetingDates.zone; f.dateFormat = "yyyy-MM-dd"; return f
    }()
    static func parse(_ value: String) -> Date? { value.isEmpty ? nil : parser.date(from: String(value.prefix(10))) }
    static func string(_ date: Date) -> String { parser.string(from: date) }
    static func display(_ value: String) -> String { parse(value).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "" }
    static var today: Date { MeetingDates.calendar.startOfDay(for: Date()) }
    static func expired(_ value: String) -> Bool { parse(value).map { $0 < today } ?? false }
    static func expiring(_ value: String, days: Int) -> Bool {
        guard let date = parse(value), let limit = MeetingDates.calendar.date(byAdding: .day, value: days, to: today) else { return false }
        return date >= today && date <= limit
    }
    static func expiringMonths(_ value: String, months: Int) -> Bool {
        guard let date = parse(value), let limit = MeetingDates.calendar.date(byAdding: .month, value: months, to: Date()) else { return false }
        return date < limit && date >= today
    }
}

enum QualificationLabels {
    static let levels: [InquiryOption] = [
        .init(value: "basic", label: "Podstawowy"), .init(value: "intermediate", label: "Średniozaawansowany"),
        .init(value: "advanced", label: "Zaawansowany"), .init(value: "expert", label: "Ekspert"),
    ]
    static func level(_ value: String) -> String { levels.first { $0.value == value }?.label ?? value }
    static func levelColor(_ value: String) -> Color {
        switch value {
        case "intermediate": return CrmTheme.rgb(0x4ade80); case "advanced": return CrmTheme.rgb(0xfb923c)
        case "expert": return CrmTheme.rgb(0xc084fc); default: return CrmTheme.rgb(0x60a5fa)
        }
    }
    /// Kod kategorii z nazwy dawnego certyfikatu („Prawo jazdy kat. B” → B), jak `drivingLicenseCodeFromCertification`.
    static func drivingCode(_ name: String) -> String? {
        let pattern = #"^prawo\s+jazdy\s+(?:kat(?:egoria)?\.?\s*)?([a-z0-9]+(?:\s*\+\s*[a-z0-9]+)?)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              let range = Range(match.range(at: 1), in: trimmed) else { return nil }
        return trimmed[range].replacingOccurrences(of: " ", with: "").uppercased()
    }
}

// Konta e-mail
struct EmployeeEmailData: Decodable {
    var accounts: [EmployeeMailAccount]
    var assignments: [EmployeeMailAssignment]
    var canReceiveContactForms: Bool
    var personalEmail: String
    var notificationPreference: String
    var signatureThumb: String?
    var workEmail: String
}
struct EmployeeMailAccount: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var fromName: String
    var email: String
    var type: String
    var department: String
    var description: String
    var employeeId: String?
    var imapHost: String
    var imapPort: Int
    var imapUsername: String
    var imapSsl: Bool
    var smtpHost: String
    var smtpPort: Int
    var smtpUsername: String
    var smtpTls: Bool
    var typeLabel: String { type == "personal" ? "Osobiste" : type == "system" ? "Systemowe" : "Wspólne" }
    var typeColor: Color { type == "personal" ? CrmTheme.rgb(0x60a5fa) : type == "system" ? CrmTheme.rgb(0xc084fc) : CrmTheme.rgb(0x4ade80) }
}
struct EmployeeMailAssignment: Decodable, Hashable {
    var id: String
    var accountId: String
}

// Uprawnienia
struct EmployeePermissionsData: Decodable {
    var updatedAt: String?
    var targetIsAdmin: Bool
    var notificationDefaults: Bool
    var permissions: [String]
    var eventTabs: [String]
    var contactTabs: [String]
    var organizationTabs: [String]
    var companyAccessMode: String
    var myCompanyIds: [String]
    var rolePermissionsInherited: Bool
    var financeCompanyAccess: [String: String]
    var salesTeamId: String
    var isSalesTeamManager: Bool
    var rolePackage: RolePackage?
    var companies: [CompanyAccessOption]
    var notifications: NotificationFlags
    var webhookSources: [WebhookSourceOption]
    var salesTeams: [TeamOption]
    var catalog: PermissionCatalog
}
struct RolePackage: Decodable {
    var name: String
    var permissions: [String]
    var eventTabs: [String]
    var contactTabs: [String]
    var organizationTabs: [String]
}
struct CompanyAccessOption: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var active: Bool
}
struct NotificationFlags: Codable, Equatable {
    var contactForm: Bool
    var webhook: Bool
    var fleet: Bool
    var inquiryAssignments: Bool
    var inquiryFollowups: Bool
    var inquiryEscalations: Bool
}
struct WebhookSourceOption: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var slug: String
    var enabled: Bool
}
struct PermissionCatalog: Decodable {
    var categories: [PermissionCategory]
    var allScopes: [String]
    var financeLevels: [ValueOption]
    var eventTabs: [ValueOption]
    var contactTabs: [ValueOption]
    var organizationTabs: [ValueOption]
    var liveSections: [String]
    var recordScopeModules: [String]
}
struct PermissionCategory: Decodable, Identifiable, Hashable {
    var key: String
    var label: String
    var extra: [PermissionExtra]
    var id: String { key }
}
struct PermissionExtra: Decodable, Identifiable, Hashable {
    var key: String
    var label: String
    var description: String
    var id: String { key }
}
struct ValueOption: Decodable, Identifiable, Hashable {
    var value: String
    var label: String
    var description: String
    var id: String { value }
}

// MARK: Wywołania API zakładek

extension TeamStore {
    func profile<T: Decodable>(_ op: String, _ employeeID: String, as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        let data = try await api.get("/employees/profile", query: ["op": op, "id": employeeID])
        return try JSONDecoder().decode(T.self, from: data)
    }
    @discardableResult func profilePost(_ op: String, _ employeeID: String, _ body: [String: JSONValue] = [:]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op); payload["employeeId"] = .string(employeeID)
        let data = try await api.post("/employees/profile", payload)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }
    /// Miniatura do stopki (JPEG) — multipart przez serwer CRM do magazynu `site-images`, jak w przeglądarce.
    func uploadSignature(_ jpeg: Data, employeeID: String) async throws {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/employees/profile?op=signature&id=\(employeeID)") else { throw AppError.configuration }
        let boundary = "mavinci-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"stopka.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Błąd podczas wgrywania zdjęcia", fieldErrors: [:])
        }
    }
}

/// Zdjęcie z pliku jako JPEG (maks. 800 px, jak „max 2MB” w CRM) — do miniatury w stopce e-mail.
enum ImageJPEG {
    static func from(_ url: URL, maxSide: CGFloat = 800) -> Data? {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let image = NSImage(contentsOf: url) else { return nil }
        return from(image, maxSide: maxSide)
    }
    static func from(_ image: NSImage, maxSide: CGFloat = 800) -> Data? {
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let scale = min(1, maxSide / CGFloat(max(cg.width, cg.height)))
        let width = Int(CGFloat(cg.width) * scale), height = Int(CGFloat(cg.height) * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        NSGraphicsContext.current?.cgContext.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])
    }
}
