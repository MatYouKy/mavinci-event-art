import SwiftUI

// MARK: Zespół — model jak w CRM (`/crm/employees`, `EmployeeViews`, `/crm/employees/[id]`, `src/lib/native/team.ts`).

struct TeamMember: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var surname: String
    var nickname: String
    var email: String
    var personalEmail: String
    var notificationPreference: String
    var phone: String
    var phonePrivate: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
    var backgroundUrl: String?
    var background: AvatarCrop?
    var role: String
    var accessLevel: String
    var accessLevelId: String?
    var occupation: String
    var region: String
    var street: String
    var city: String
    var postalCode: String
    var skills: [String]
    var active: Bool
    var notes: String
    var createdAt: String?
    var lastActiveAt: String?
    var showOnWebsite: Bool
    var websiteBio: String
    var linkedin: String
    var instagram: String
    var facebook: String
    var orderIndex: Int

    var fullName: String { "\(name) \(surname)".trimmingCharacters(in: .whitespaces) }
    /// Kafelek: pseudonim albo imię (pełne imię i nazwisko pod spodem, gdy jest pseudonim).
    var cardName: String { nickname.isEmpty ? name : nickname }
    /// Lista i widok szczegółowy: pseudonim albo imię i nazwisko.
    var listName: String { nickname.isEmpty ? fullName : nickname }
    var subtitle: String { occupation.isEmpty ? TeamLabels.role(role) : occupation }
    var created: Date? { createdAt.flatMap(MeetingDates.parse) }
    var lastActive: Date? { lastActiveAt.flatMap(MeetingDates.parse) }
    /// Kropka aktywności jak `EmployeeAvatar` (zielona ≤ 10 min, żółta ≤ 30 min od ostatniej aktywności w CRM).
    func presence(_ now: Date = Date()) -> TeamPresence {
        guard let last = lastActive else { return .offline }
        let minutes = now.timeIntervalSince(last) / 60
        return minutes <= 10 ? .active : minutes <= 30 ? .idle : .offline
    }
    /// Wyszukiwanie jak na stronie: imię, nazwisko, pseudonim, e-mail i stanowisko.
    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || "\(name) \(surname) \(nickname) \(email) \(occupation)".lowercased().contains(q)
    }
}

enum TeamPresence {
    case active, idle, offline
    var color: Color { self == .active ? CrmTheme.rgb(0x22c55e) : CrmTheme.rgb(0xeab308) }
    var label: String { self == .active ? "Aktywny w CRM" : self == .idle ? "Nieaktywny > 10 min" : "" }
}

/// Uprawnienia sekcji (liczone na serwerze jak `useCurrentEmployee` w CRM).
struct TeamAccess: Codable, Equatable {
    var employeeId: String
    var isAdmin: Bool
    var canView: Bool
    var canManage: Bool
    var canCreate: Bool
    var canApproveAbsences: Bool
    var canViewPersonnel: Bool
}

struct EmployeeEventAssignment: Codable, Hashable, Identifiable {
    var id: String
    var role: String
    var hours: Double?
    var status: String
    var responsibilities: String
    var eventId: String
    var eventName: String
    var eventDate: String?
    var eventStatus: String
    var date: Date? { eventDate.flatMap(MeetingDates.parse) }
}
struct EmployeeEmailAccount: Codable, Hashable, Identifiable {
    var id: String
    var email: String
    var primary: Bool
}
struct EmployeeAbsence: Codable, Hashable, Identifiable {
    var id: String
    var type: String
    var start: String
    var end: String
    var allDay: Bool
    var status: String
    var notes: String
    var approvedAt: String?
    var createdAt: String?
    var startDate: Date? { MeetingDates.parse(start) }
    var endDate: Date? { MeetingDates.parse(end) }
    /// Liczba dni jak w CRM (`Math.ceil(różnica / dzień)`).
    var days: Int {
        guard let s = startDate, let e = endDate else { return 0 }
        return Int((e.timeIntervalSince(s) / 86_400).rounded(.up))
    }
}
struct TeamOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var description: String?
}
struct EmployeeDetail: Codable {
    var events: [EmployeeEventAssignment]
    var emailAccounts: [EmployeeEmailAccount]
    var absences: [EmployeeAbsence]
    var accessLevels: [TeamOption]
}

/// Pozycja planu pracownika (`get_employee_schedule`) z identyfikatorem osoby (oś czasu zespołu).
struct TeamScheduleEntry: Identifiable, Equatable {
    let employeeId: String
    let item: ScheduleItem
    var id: String { "\(employeeId)-\(item.id)" }
}
struct TeamScheduleRow: Decodable {
    let employee_id: String?
    let kind: String?
    let item_id: String?
    let title: String?
    let subtitle: String?
    let starts_at: String?
    let ends_at: String?
    let all_day: Bool?
    let status: String?
    let color: String?
    let url: String?

    var entry: TeamScheduleEntry? {
        guard let employee = employee_id, let kind, ScheduleItem.kinds[kind] != nil,
              let start = starts_at.flatMap(MeetingDates.parse), let end = ends_at.flatMap(MeetingDates.parse) else { return nil }
        let label = ScheduleItem.kinds[kind]?.label ?? ""
        let name = (title ?? "").trimmingCharacters(in: .whitespaces)
        return TeamScheduleEntry(employeeId: employee, item: ScheduleItem(
            kind: kind, itemID: item_id ?? "", title: name.isEmpty ? label : name, subtitle: subtitle ?? "", start: start,
            end: max(end, start.addingTimeInterval(900)), allDay: all_day == true, status: status ?? "",
            color: meetingColor(color ?? "") ?? CrmTheme.rgb(0x64748b), url: (url ?? "").hasPrefix("/") ? (url ?? "") : ""))
    }
}

/// Grupy pozycji planu (filtry jak `SCHEDULE_GROUPS`).
enum ScheduleGroup: String, CaseIterable, Identifiable {
    case events, meetings, funnel, absences
    var id: String { rawValue }
    var label: String {
        switch self { case .events: return "Wydarzenia i fazy"; case .meetings: return "Spotkania"; case .funnel: return "Lejek i zadania"; case .absences: return "Nieobecności" }
    }
    var kinds: Set<String> {
        switch self { case .events: return ["event", "phase"]; case .meetings: return ["meeting"]; case .funnel: return ["inquiry", "task", "call"]; case .absences: return ["absence"] }
    }
    var color: Color {
        switch self {
        case .events: return CrmTheme.rgb(0x3b82f6); case .meetings: return CrmTheme.rgb(0x0ea5e9)
        case .funnel: return CrmTheme.rgb(0xf59e0b); case .absences: return CrmTheme.rgb(0x10b981)
        }
    }
}

/// Etykiety i kolory jak `getRoleLabel`, `getAccessLevelLabel`, `getAccessLevelColor` i zakładka „Oś czasu”.
enum TeamLabels {
    static func role(_ role: String) -> String {
        let labels = ["admin": "Administrator", "manager": "Menedżer", "event_manager": "Menedżer eventów", "sales": "Sprzedaż",
                      "logistics": "Logistyka", "technician": "Technik", "support": "Wsparcie", "freelancer": "Freelancer", "dj": "DJ",
                      "mc": "Konferansjer", "assistant": "Asystent", "unassigned": "Nieprzypisany", "employee": "Pracownik"]
        return labels[role] ?? prettify(role)
    }
    static func accessLevel(_ level: String) -> String {
        let labels = ["admin": "Pełny dostęp", "manager": "Menedżer", "lead": "Kierownik", "operator": "Operator", "external": "Zewnętrzny",
                      "guest": "Gość", "unassigned": "Nieprzypisany", "instructor": "Instruktor"]
        return labels[level] ?? prettify(level)
    }
    static func accessLevelColor(_ level: String) -> Color {
        let colors: [String: Int] = ["admin": 0xc084fc, "manager": 0x60a5fa, "lead": 0x22d3ee, "operator": 0x4ade80, "external": 0xfb923c,
                                     "guest": 0x9ca3af, "unassigned": 0x9ca3af, "instructor": 0x2dd4bf]
        return CrmTheme.rgb(colors[level] ?? 0x9ca3af)
    }
    static let absenceTypes: [InquiryOption] = [
        .init(value: "vacation", label: "Urlop wypoczynkowy"), .init(value: "sick_leave", label: "Zwolnienie lekarskie"),
        .init(value: "unpaid_leave", label: "Urlop bezpłatny"), .init(value: "training", label: "Szkolenie"),
        .init(value: "remote_work", label: "Praca zdalna"), .init(value: "other", label: "Inne"),
    ]
    static func absenceType(_ type: String) -> String { absenceTypes.first { $0.value == type }?.label ?? prettify(type) }
    static func absenceColor(_ type: String) -> Color {
        let colors: [String: Int] = ["vacation": 0x10b981, "sick_leave": 0xef4444, "unpaid_leave": 0x6b7280, "training": 0x06b6d4,
                                     "remote_work": 0x14b8a6, "other": 0x8b5cf6]
        return CrmTheme.rgb(colors[type] ?? 0x3b82f6)
    }
    static func absenceStatus(_ status: String) -> (label: String, color: Color) {
        switch status {
        case "approved": return ("Zatwierdzona", CrmTheme.rgb(0x4ade80))
        case "rejected": return ("Odrzucona", CrmTheme.rgb(0xf87171))
        case "cancelled": return ("Anulowana", CrmTheme.rgb(0x9ca3af))
        default: return ("Oczekuje", CrmTheme.rgb(0xfacc15))
        }
    }
    static let notificationOptions: [InquiryOption] = [
        .init(value: "work", label: "Email służbowy"), .init(value: "personal", label: "Email prywatny"),
        .init(value: "both", label: "Oba emaile"), .init(value: "none", label: "Nie wysyłaj emaili"),
    ]
    static func assignmentStatus(_ status: String) -> String {
        switch status {
        case "accepted": return "Potwierdzony"; case "pending", "invited": return "Zaproszony"; case "declined", "rejected": return "Odrzucił"
        case "": return ""; default: return prettify(status)
        }
    }
    private static func prettify(_ value: String) -> String {
        let text = value.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}

enum TeamViewMode: String, CaseIterable, Identifiable {
    case grid, list, table, timeline
    var id: String { rawValue }
    var label: String {
        switch self { case .grid: return "Kafelki"; case .list: return "Lista"; case .table: return "Szczegółowy"; case .timeline: return "Oś czasu" }
    }
    var symbol: String {
        switch self { case .grid: return "square.grid.2x2"; case .list: return "list.bullet"; case .table: return "list.bullet.indent"; case .timeline: return "clock" }
    }
}

enum EmployeeTab: String, CaseIterable, Identifiable {
    case overview, personnel, qualifications, emails, permissions, documents, tasks, events, timeline
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: return "Przegląd"; case .personnel: return "Umowy i rozliczenia"; case .qualifications: return "Kwalifikacje"
        case .emails: return "Konta Email"; case .permissions: return "Uprawnienia"; case .documents: return "Dokumenty"
        case .tasks: return "Zadania"; case .events: return "Wydarzenia"; case .timeline: return "Oś czasu"
        }
    }
    var symbol: String {
        switch self {
        case .overview: return "person"; case .personnel: return "doc.text"; case .qualifications: return "rosette"; case .emails: return "envelope"
        case .permissions: return "lock"; case .documents: return "doc"; case .tasks: return "checklist"; case .events: return "calendar"
        case .timeline: return "clock"
        }
    }
}
