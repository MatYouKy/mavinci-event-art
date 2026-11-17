import SwiftUI

// MARK: Czas pracy — odpowiedzi `/bridge/native/v1/time` (`src/lib/native/timeTracking.ts`): wpisy z licznikiem, raport zespołu,
// strona pracownika, rozmowy o wpisach, rozliczenie czasu pracy i wynagrodzenie z umów.

struct WorkTimeMe: Decodable, Hashable {
    var id: String
    var isAdmin: Bool
}

/// Wpis czasu pracy (`time_entries`) z nazwą zadania i wydarzenia.
struct WorkTimeEntry: Decodable, Identifiable, Hashable {
    var id: String
    var employeeId: String
    var employeeName: String
    var taskId: String?
    var taskTitle: String
    var eventId: String?
    var eventName: String
    var title: String
    var description: String
    var start: String
    var end: String?
    var minutes: Double?
    var billable: Bool
    var rate: Double?
    var currency: String
    var rateBasis: String
    var contractId: String?
    var edits: Int
    var updatedAt: String?

    /// Jak w CRM: tytuł zadania, potem własny tytuł, w ostateczności „Praca”.
    var label: String { taskTitle.nonEmpty ?? title.nonEmpty ?? "Praca" }
    var startDate: Date? { MeetingDates.parse(start) }
    var endDate: Date? { end.flatMap { MeetingDates.parse($0) } }
    var isActive: Bool { end == nil }
    /// „45 PLN/h netto” (stawka z warunków umowy).
    var rateText: String? {
        guard let rate else { return nil }
        return "\(WorkTimeFormat.number(rate)) \(currency)/h" + (rateBasis.isEmpty ? "" : " \(rateBasis)")
    }
    /// Dzień rozpoczęcia w czasie polskim (`RRRR-MM-DD`).
    var day: String { startDate.map { DayDates.string($0) } ?? String(start.prefix(10)) }
}

struct WorkTimeNorm: Decodable, Hashable {
    var month: String
    var sentence: String
    var holidays: String
}

/// Zadanie do licznika (ostatnie 50 zadań).
struct WorkTimeTask: Decodable, Identifiable, Hashable {
    var id: String
    var title: String
    var eventId: String?
    var eventName: String
}

struct WorkTimeMessage: Decodable, Identifiable, Hashable {
    var id: String
    var author: String
    var body: String
    var at: String?
}

/// Wątek „do wyjaśnienia” przy wpisie (`list_time_entry_discussions`).
struct WorkTimeThread: Decodable, Identifiable, Hashable {
    var id: String
    var entryId: String
    var resolved: Bool
    var title: String
    var description: String
    var start: String?
    var minutes: Double?
    var employeeName: String
    var messages: [WorkTimeMessage]
    var stateLabel: String { resolved ? "Wyjaśnione" : "Do wyjaśnienia" }
}

struct WorkTimeDiscussions: Decodable, Hashable {
    var threads: [WorkTimeThread]
    var error: String
}

/// Ekran „Czas pracy”: mój licznik i moje wpisy.
struct WorkTimeHome: Decodable {
    var me: WorkTimeMe
    var norm: WorkTimeNorm?
    var active: WorkTimeEntry?
    var entries: [WorkTimeEntry]
    var tasks: [WorkTimeTask]
    var discussions: WorkTimeDiscussions
}

struct WorkTimeOption: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
}

struct WorkTimeRange: Decodable, Hashable {
    var from: String
    var to: String
}

/// Pracownik w raporcie zespołu (`AdminDashboard`).
struct WorkTimePerson: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
    var minutes: Double
    var billableMinutes: Double
    var revenue: Double
    var entries: Int
    var days: Int
    var active: WorkTimeEntry?
}

struct WorkTimeDay: Decodable, Identifiable, Hashable {
    var date: String
    var minutes: Double
    var entries: Int
    var employees: Int
    var id: String { date }
}

struct WorkTimeTotals: Decodable, Hashable {
    var minutes: Double
    var billableMinutes: Double
    var revenue: Double
    var employees: Int?
    var entries: Int?
}

struct WorkTimeDashboard: Decodable {
    var range: WorkTimeRange
    var employees: [WorkTimeOption]
    var people: [WorkTimePerson]
    var daily: [WorkTimeDay]
    var totals: WorkTimeTotals
}

struct WorkTimeEmployeeInfo: Decodable, Hashable {
    var id: String
    var name: String
    var email: String
    var phone: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
}

/// Czas według zadań na stronie pracownika.
struct WorkTimeTaskStat: Decodable, Identifiable, Hashable {
    var taskId: String?
    var title: String
    var eventName: String
    var minutes: Double
    var entries: Int
    var last: String
    var id: String { taskId ?? "no-task" }
}

struct WorkTimeFieldChange: Decodable, Identifiable, Hashable {
    var field: String
    var label: String
    var before: String
    var after: String
    var id: String { field }
}

/// Zmiana wpisu (`admin_time_entries_history_view`).
struct WorkTimeChange: Decodable, Identifiable, Hashable {
    var id: String
    var entryId: String
    var action: String
    var at: String?
    var actor: String
    var actorId: String?
    var title: String
    var changes: [WorkTimeFieldChange]

    var actionLabel: String {
        switch action {
        case "created": return "Utworzono"
        case "updated": return "Edytowano"
        case "deleted": return "Usunięto"
        default: return action
        }
    }
    var actionColor: Color {
        switch action {
        case "created": return CrmTheme.rgb(0x4ade80)
        case "updated": return CrmTheme.rgb(0x60a5fa)
        case "deleted": return CrmTheme.rgb(0xf87171)
        default: return .secondary
        }
    }
    var actorLabel: String { actor.nonEmpty ?? "Autor niedostępny (starszy wpis lub system)" }
}

struct WorkTimeEmployeePage: Decodable {
    var me: WorkTimeMe
    var range: WorkTimeRange
    var employee: WorkTimeEmployeeInfo
    var active: WorkTimeEntry?
    var entries: [WorkTimeEntry]
    var tasks: [WorkTimeTaskStat]
    var history: [WorkTimeChange]
    var totals: WorkTimeTotals
    var discussions: WorkTimeDiscussions
}

/// Zapisane rozliczenie czasu pracy (`employee_time_settlements`).
struct WorkTimeSettlement: Decodable, Identifiable, Hashable {
    var id: String
    var until: String
    var hours: Double
    var rate: Double
    var amount: Double
    var reportMinutes: Double
    var createdAt: String?
    var notes: String
    var voidedAt: String?
    var voidReason: String
    var untilDate: Date? { MeetingDates.parse(until) }
}

/// Podgląd rozliczenia (`get_employee_time_settlement_preview`).
struct WorkTimeSettlementPreview: Decodable, Hashable {
    var canManage: Bool
    var latest: WorkTimeSettlement?
    var latestChanged: Bool
    var history: [WorkTimeSettlement]
    var minutes: Double
    var entryCount: Int
    var crossingCount: Int
    var signature: String
}

/// Umowa pracownika do rozliczenia czasu (bez szkiców).
struct WorkTimeContract: Decodable, Identifiable, Hashable {
    var id: String
    var number: String
    var start: String
    var end: String
    /// „U/1/2026 · 01.01.2026 – bezterminowo” jak `PersonnelTimeContractPicker`.
    var label: String {
        "\(number) · \(WorkTimeFormat.day(start)) – \(end.isEmpty ? "bezterminowo" : WorkTimeFormat.day(end))"
    }
}

struct WorkTimeAmount: Decodable, Identifiable, Hashable {
    var currency: String
    var basis: String
    var amount: Double
    var id: String { currency + basis }
}

struct WorkTimeBalance: Decodable, Identifiable, Hashable {
    var id: String
    var contract: String
    var currency: String
    var net: Double
    var paid: Double
    var remaining: Double
}

struct WorkTimeUnlinked: Decodable, Identifiable, Hashable {
    var id: String
    var title: String
    var start: String
    var minutes: Double
}

/// Wynagrodzenie z umów (`PersonnelEarnings`).
struct WorkTimeEarnings: Decodable {
    var contracts: [WorkTimeContract]
    var totals: [WorkTimeAmount]
    var settlements: [WorkTimeBalance]
    var unlinked: [WorkTimeUnlinked]
}

/// Wątek do otwarcia w arkuszu rozmowy.
struct WorkTimeDiscussionTarget: Identifiable, Hashable {
    var id: String
    var title: String
}

/// Okres raportu jak w CRM (`time-tracking-period`): tydzień, miesiąc, rok z przesunięciem albo własny zakres.
enum WorkTimePeriodKind: String, CaseIterable, Identifiable {
    case week, month, year, custom
    var id: String { rawValue }
    var label: String {
        switch self {
        case .week: return "Tydzień"
        case .month: return "Miesiąc"
        case .year: return "Rok"
        case .custom: return "Własny zakres"
        }
    }
    static let storageKey = "timeTracking.period"
    static var saved: WorkTimePeriodKind { WorkTimePeriodKind(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .month }
}

struct WorkTimePeriod: Equatable {
    var kind: WorkTimePeriodKind
    var offset = 0
    /// Zastosowany zakres (`RRRR-MM-DD`).
    var from: String
    var to: String

    init(kind: WorkTimePeriodKind) {
        self.kind = kind
        let range = Self.range(kind == .custom ? .month : kind, offset: 0)
        from = range.0; to = range.1
    }

    static func range(_ kind: WorkTimePeriodKind, offset: Int) -> (String, String) {
        let c = MeetingDates.calendar
        let today = c.startOfDay(for: Date())
        switch kind {
        case .week:
            let monday = c.date(byAdding: .day, value: offset * 7, to: MeetingDates.startOfWeek(today)) ?? today
            let sunday = c.date(byAdding: .day, value: 6, to: monday) ?? monday
            return (DayDates.string(monday), DayDates.string(sunday))
        case .year:
            let year = c.component(.year, from: today) + offset
            return (String(format: "%04d-01-01", year), String(format: "%04d-12-31", year))
        case .month, .custom:
            let first = c.date(from: c.dateComponents([.year, .month], from: today)) ?? today
            let start = c.date(byAdding: .month, value: offset, to: first) ?? first
            let next = c.date(byAdding: .month, value: 1, to: start) ?? start
            let end = c.date(byAdding: .day, value: -1, to: next) ?? start
            return (DayDates.string(start), DayDates.string(end))
        }
    }

    mutating func select(_ kind: WorkTimePeriodKind) {
        self.kind = kind
        offset = 0
        UserDefaults.standard.set(kind.rawValue, forKey: WorkTimePeriodKind.storageKey)
        if kind != .custom { (from, to) = Self.range(kind, offset: 0) }
    }

    mutating func move(_ step: Int) {
        guard kind != .custom else { return }
        offset += step
        (from, to) = Self.range(kind, offset: offset)
    }

    /// Etykieta jak `getPeriodLabel`: „10 lis - 16 lis 2026”, „listopad 2026”, „2026”.
    var label: String {
        guard let start = DayDates.parse(from), let end = DayDates.parse(to) else { return "" }
        switch kind {
        case .custom: return "Własny zakres"
        case .week: return "\(MeetingDates.format(start, "dd MMM")) - \(MeetingDates.format(end, "dd MMM yyyy"))"
        case .month: return MeetingDates.format(start, "LLLL yyyy")
        case .year: return MeetingDates.format(start, "yyyy")
        }
    }
}

enum WorkTimeFormat {
    /// „2h 5m” (minuty zaokrąglone).
    static func minutes(_ value: Double?) -> String {
        let total = max(0, Int((value ?? 0).rounded()))
        return "\(total / 60)h \(total % 60)m"
    }
    /// Licznik „HH:MM:SS”.
    static func clock(since start: Date?, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start ?? now)))
        return String(format: "%02d:%02d:%02d", seconds / 3600, seconds % 3600 / 60, seconds % 60)
    }
    private static let currency: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .currency; f.currencyCode = "PLN"; return f
    }()
    /// Kwota w walucie (domyślnie „1 234,50 zł”).
    static func money(_ value: Double, _ code: String = "PLN") -> String {
        currency.currencyCode = code.nonEmpty ?? "PLN"
        return currency.string(from: NSNumber(value: value)) ?? String(format: "%.2f %@", value, code)
    }
    private static let decimal: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.maximumFractionDigits = 2; f.usesGroupingSeparator = false; return f
    }()
    static func number(_ value: Double) -> String { decimal.string(from: NSNumber(value: value)) ?? "\(value)" }
    /// Godziny z dwoma miejscami po przecinku („12,50”).
    static func hours(_ minutes: Double) -> String { String(format: "%.2f", minutes / 60).replacingOccurrences(of: ".", with: ",") }
    /// Liczba dodatnia z najwyżej dwoma miejscami po przecinku (jak `decimal` w rozliczeniu); inaczej `nil`.
    static func decimalInput(_ text: String) -> Double? {
        let value = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard value.range(of: #"^\d+(?:\.\d{1,2})?$"#, options: .regularExpression) != nil else { return nil }
        return Double(value)
    }
    static func day(_ value: String) -> String { value.isEmpty ? "—" : (DayDates.display(value).nonEmpty ?? value) }
    static func dateTime(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
    static func dateTimeSeconds(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm:ss")
    }
    static func shortDate(_ date: Date?) -> String { date.map { MeetingDates.format($0, "dd MMM yyyy") } ?? "" }
    /// „10:00 - 12:30” albo „10:00 - w trakcie”.
    static func span(_ entry: WorkTimeEntry) -> String {
        let start = entry.startDate.map { MeetingDates.time($0) } ?? ""
        return "\(start) - " + (entry.endDate.map { MeetingDates.time($0) } ?? "w trakcie")
    }
}

/// Pigułka statusu (np. „Płatne”, „Aktywny”).
struct WorkTimePill: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}

/// Kafelek statystyki.
struct WorkTimeTile: View {
    let title: String
    let value: String
    let symbol: String
    var color: Color?
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                Text(title).font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            Text(value).font(.title2.weight(.semibold).monospacedDigit()).foregroundStyle(color ?? Color.primary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Pasek proporcji (czas pracownika / zadania na tle całości).
struct WorkTimeBar: View {
    let fraction: Double
    @Environment(\.crmTheme) private var theme
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule().fill(theme.accent).frame(width: proxy.size.width * min(1, max(0, fraction)))
            }
        }
        .frame(height: 6)
    }
}
