import Foundation
import WidgetKit

// MARK: Dane widżetów zadań — serwer CRM i kopia w kontenerze grupy
//
// `GET /bridge/native/v1/tasks?op=widget` (otwarte zadania z „Moich zadań” i licznik czasu — `tasksWidget` w
// `src/lib/native/tasks.ts`) przez `WidgetAPI` (`WidgetSupport.swift`): token ze wspólnej sesji, ostatnia odpowiedź
// w kontenerze (`widget-tasks.json`, tylko dla tego samego konta) — bez internetu widżet pokazuje ją z dopiskiem „bez połączenia”.

struct WidgetTask: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let priority: String
    /// Kolumna tablicy: `todo` | `in_progress` | `review`.
    let column: String
    let dueDate: String?
    let isPrivate: Bool
}

struct WidgetTimer: Codable, Hashable {
    let id: String
    let taskId: String?
    let title: String
    let startTime: String
}

struct WidgetTasksReply: Codable {
    let tasks: [WidgetTask]
    let total: Int
    let privateTotal: Int
    let timer: WidgetTimer?
    let generatedAt: String
}

struct TasksEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
    /// Zadania widżetu (dla „Zadań prywatnych” — tylko prywatne).
    let tasks: [WidgetTask]
    let total: Int
    let timer: WidgetTimer?
    /// Kiedy pobrano dane z serwera (kopia — czas jej zapisu).
    let updatedAt: Date?

    static func sample(privateOnly: Bool) -> TasksEntry {
        let day = 86_400.0
        let iso = ISO8601DateFormatter()
        let tasks = [
            WidgetTask(id: "1", title: "Potwierdzić salę z klientem", priority: "high", column: "todo",
                       dueDate: iso.string(from: Date().addingTimeInterval(3 * 3600)), isPrivate: true),
            WidgetTask(id: "2", title: "Wysłać ofertę na galę firmową", priority: "medium", column: "in_progress",
                       dueDate: iso.string(from: Date().addingTimeInterval(day)), isPrivate: false),
            WidgetTask(id: "3", title: "Zamówić dodatkowe oświetlenie", priority: "low", column: "todo", dueDate: nil, isPrivate: true),
        ].filter { !privateOnly || $0.isPrivate }
        return TasksEntry(date: Date(), state: .ready, tasks: tasks, total: tasks.count, timer: nil, updatedAt: Date())
    }
}

enum WidgetTasksAPI {
    /// Wpis widżetu: dane z serwera, a bez połączenia — ostatnia kopia tego samego konta.
    static func entry(privateOnly: Bool) async -> TasksEntry {
        let loaded: WidgetAPI.Loaded<WidgetTasksReply> = await WidgetAPI.load("/bridge/native/v1/tasks?op=widget", cache: "widget-tasks.json")
        guard let reply = loaded.reply else {
            return TasksEntry(date: Date(), state: loaded.state, tasks: [], total: 0, timer: nil, updatedAt: nil)
        }
        let tasks = privateOnly ? reply.tasks.filter(\.isPrivate) : reply.tasks
        return TasksEntry(date: Date(), state: loaded.state, tasks: tasks, total: privateOnly ? reply.privateTotal : reply.total,
                          timer: reply.timer, updatedAt: loaded.updatedAt)
    }
}

// MARK: Termin — te same reguły co `src/lib/CRM/tasks/taskDue.ts` (czas polski; 23:59, północ i dawny zapis o północy UTC = cały dzień)

enum WidgetDue {
    static let zone = WidgetTime.zone
    static let calendar = WidgetTime.calendar
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0) ?? .current; return c
    }()
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()
    private static let dayOnly: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"; return f
    }()
    private static let short: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateFormat = "d.MM"; return f
    }()
    static let clock = WidgetTime.clock

    /// Chwila terminu i czy to termin na cały dzień.
    static func parse(_ value: String) -> (date: Date, allDay: Bool)? {
        if value.count == 10, let day = dayOnly.date(from: value) { return (day, true) }
        let normalized = value.replacingOccurrences(of: " ", with: "T")
        guard let date = fractional.date(from: normalized) ?? plain.date(from: normalized) else { return nil }
        let atUTC = utc.dateComponents([.hour, .minute, .second], from: date)
        if atUTC.hour == 0 && atUTC.minute == 0 && atUTC.second == 0 {
            let day = utc.dateComponents([.year, .month, .day], from: date)
            return (calendar.date(from: day) ?? date, true)
        }
        let local = calendar.dateComponents([.hour, .minute], from: date)
        let allDay = (local.hour == 23 && local.minute == 59) || (local.hour == 0 && local.minute == 0)
        return (date, allDay)
    }

    /// „Dziś, 18:00”, „Jutro”, „Wczoraj”, „27.11” i czy termin minął (cały dzień — po jego końcu).
    static func label(_ value: String?, now: Date) -> (text: String, overdue: Bool)? {
        guard let value, let due = parse(value) else { return nil }
        let day: String
        if calendar.isDate(due.date, inSameDayAs: now) { day = "Dziś" }
        else if let next = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(due.date, inSameDayAs: next) { day = "Jutro" }
        else if let previous = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(due.date, inSameDayAs: previous) { day = "Wczoraj" }
        else { day = short.string(from: due.date) }
        let end = due.allDay ? (calendar.date(bySettingHour: 23, minute: 59, second: 59, of: due.date) ?? due.date) : due.date
        return (due.allDay ? day : "\(day), \(clock.string(from: due.date))", end < now)
    }
}
