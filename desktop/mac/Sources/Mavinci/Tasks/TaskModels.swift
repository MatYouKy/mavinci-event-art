import SwiftUI

// MARK: Zadania — model tablic jak w CRM (`TasksPageClient`, `PrivateTasksBoardTab`, `TaskCard`, `/bridge/native/v1/tasks`).

enum TaskBoardKind: String {
    case company, mine, event
    var title: String {
        switch self {
        case .company: return "Zadania firmowe"
        case .mine: return "Moja tablica zadań"
        case .event: return "Zadania wydarzenia"
        }
    }
    var href: String { self == .company ? "/crm/tasks" : "/crm/tasks/mine" }
}

enum BoardColumnKind: String, CaseIterable, Identifiable {
    case todo, in_progress, review, completed
    var id: String { rawValue }
    init(raw: String) { self = BoardColumnKind(rawValue: raw) ?? .todo }
    /// Nazwy jak na tablicach w CRM (tablica prywatna i tablica wydarzenia mają własne: „Do sprawdzenia”, „Ukończone”).
    func label(_ board: TaskBoardKind) -> String {
        switch self {
        case .todo: return "Do zrobienia"
        case .in_progress: return "W trakcie"
        case .review: return board == .company ? "Sprawdzenie" : "Do sprawdzenia"
        case .completed: return board == .company ? "Zakończone" : "Ukończone"
        }
    }
    var color: Color {
        switch self {
        case .todo: return CrmTheme.rgb(0xeab308); case .in_progress: return CrmTheme.rgb(0x3b82f6)
        case .review: return CrmTheme.rgb(0xa855f7); case .completed: return CrmTheme.rgb(0x22c55e)
        }
    }
}

enum TaskPriorityKind: String, CaseIterable, Identifiable {
    case low, medium, high, urgent
    var id: String { rawValue }
    init(raw: String) { self = TaskPriorityKind(rawValue: raw) ?? .medium }
    var label: String { switch self { case .low: return "Niski"; case .medium: return "Średni"; case .high: return "Wysoki"; case .urgent: return "Pilne" } }
    var color: Color {
        switch self {
        case .low: return CrmTheme.rgb(0x9ca3af); case .medium: return CrmTheme.rgb(0x60a5fa)
        case .high: return CrmTheme.rgb(0xfb923c); case .urgent: return CrmTheme.rgb(0xf87171)
        }
    }
    var rank: Int { switch self { case .urgent: return 4; case .high: return 3; case .medium: return 2; case .low: return 1 } }
}

struct TaskPerson: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

struct BoardTask: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var titleLabel: String
    var description: String
    var priority: String
    var boardColumn: String
    var orderIndex: Int
    var dueDate: String?
    var createdBy: String?
    var createdAt: String
    var isPrivate: Bool
    var ownerId: String?
    var eventId: String?
    var inquiryId: String?
    var workingBy: String?
    var workingName: String
    var assignees: [TaskPerson]
    var comments: Int
    var attachments: Int

    var column: BoardColumnKind { BoardColumnKind(raw: boardColumn) }
    var priorityKind: TaskPriorityKind { TaskPriorityKind(raw: priority) }
    var due: Date? { dueDate.flatMap(MeetingDates.parse) ?? dueDate.flatMap { TaskDates.day($0) } }
    /// Data w formularzu: dzień (RRRR-MM-DD) w czasie polskim.
    var dueDay: String? { due.map { MeetingDates.format($0, "yyyy-MM-dd") } }
}

/// Kolejność kart jak w CRM: priorytet (od pilnych), termin (najbliższy), kolejność na tablicy.
func sortBoardTasks(_ tasks: [BoardTask]) -> [BoardTask] {
    tasks.sorted { a, b in
        if a.priorityKind.rank != b.priorityKind.rank { return a.priorityKind.rank > b.priorityKind.rank }
        switch (a.due, b.due) {
        case let (x?, y?): if x != y { return x < y }
        case (_?, nil): return true
        case (nil, _?): return false
        default: break
        }
        return a.orderIndex < b.orderIndex
    }
}

struct TaskBoardAccess: Codable, Equatable {
    var employeeId: String
    var isAdmin: Bool
    var canCreate: Bool
    var canManage: Bool
    var canMove: Bool
    var autoTimer: Bool
}

struct ActiveTaskTimer: Codable, Equatable {
    var id: String
    var taskId: String?
    var title: String
    var startTime: String
    var started: Date? { MeetingDates.parse(startTime) }
}

struct TaskComment: Decodable, Identifiable, Hashable {
    let id: String
    let employeeId: String?
    let name: String
    let content: String
    let createdAt: String
}

struct TaskAttachmentInfo: Decodable, Identifiable, Hashable {
    let id: String
    let fileName: String
    let fileUrl: String?
    let fileType: String
    let fileSize: Int
    let createdAt: String
    let name: String
    let linked: Bool
    var sizeLabel: String {
        fileSize < 1024 ? "\(fileSize) B" : fileSize < 1_048_576 ? String(format: "%.1f KB", Double(fileSize) / 1024) : String(format: "%.1f MB", Double(fileSize) / 1_048_576)
    }
}

struct TaskDetailInfo: Decodable {
    let creatorName: String
    let comments: [TaskComment]
    let attachments: [TaskAttachmentInfo]
}

enum TaskDates {
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = MeetingDates.zone; f.dateFormat = "yyyy-MM-dd"; return f
    }()
    static func day(_ value: String) -> Date? { dayFormatter.date(from: String(value.prefix(10))) }
    static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }
    static func short(_ date: Date) -> String { MeetingDates.format(date, "dd.MM.yyyy") }
}
