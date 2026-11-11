import SwiftUI

// MARK: Spotkania — model jak w CRM (`src/lib/CRM/meetings/meetingStatus.ts`, `/bridge/native/v1/meetings`).

/// Status spotkania: wstępne (termin do potwierdzenia), potwierdzone, odwołane.
enum MeetingStatus: String, CaseIterable, Identifiable {
    case confirmed, tentative, cancelled
    var id: String { rawValue }
    init(raw: String) { self = MeetingStatus(rawValue: raw) ?? .confirmed }
    var label: String {
        switch self { case .confirmed: return "Potwierdzone"; case .tentative: return "Wstępne"; case .cancelled: return "Odwołane" }
    }
    var action: String {
        switch self { case .confirmed: return "Potwierdź"; case .tentative: return "Oznacz jako wstępne"; case .cancelled: return "Odwołaj" }
    }
    var color: Color {
        switch self { case .confirmed: return CrmTheme.rgb(0x4ade80); case .tentative: return CrmTheme.rgb(0xf5c26b); case .cancelled: return CrmTheme.rgb(0xf87171) }
    }
    var symbol: String {
        switch self { case .confirmed: return "checkmark.circle"; case .tentative: return "questionmark.circle"; case .cancelled: return "xmark.circle" }
    }
}

/// Odpowiedź uczestnika na zaproszenie (jak w Teams).
enum MeetingResponse: String, CaseIterable, Identifiable {
    case accepted, tentative, declined, pending
    var id: String { rawValue }
    init(raw: String) { self = MeetingResponse(rawValue: raw) ?? .accepted }
    var label: String {
        switch self { case .accepted: return "Przyjęte"; case .tentative: return "Może"; case .declined: return "Odrzucone"; case .pending: return "Czeka na odpowiedź" }
    }
    var action: String {
        switch self { case .accepted: return "Przyjmuję"; case .tentative: return "Może"; case .declined: return "Odrzucam"; case .pending: return "Bez odpowiedzi" }
    }
    var color: Color {
        switch self {
        case .accepted: return CrmTheme.rgb(0x4ade80)
        case .tentative: return CrmTheme.rgb(0xf5c26b)
        case .declined: return CrmTheme.rgb(0xf87171)
        case .pending: return CrmTheme.rgb(0xa8adba)
        }
    }
    var symbol: String {
        switch self { case .accepted: return "checkmark"; case .tentative: return "questionmark"; case .declined: return "xmark"; case .pending: return "clock" }
    }
    static let answers: [MeetingResponse] = [.accepted, .tentative, .declined]
}

struct MeetingParticipant: Codable, Hashable, Identifiable {
    var id: String
    var employeeId: String?
    var contactId: String?
    var name: String
    var response: String
    var respondedAt: String?
}

struct Meeting: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var start: String
    var end: String?
    var allDay: Bool
    var color: String
    var notes: String
    var locationId: String?
    var locationText: String
    var locationName: String
    var createdBy: String?
    var creatorName: String
    var isPrivate: Bool
    var status: String
    var seriesId: String?
    var recurrenceDays: Int
    var recurrenceIndex: Int?
    var alert1: Int?
    var alert2: Int?
    var alertCritical: Int?
    var relatedEventIds: [String]
    var participants: [MeetingParticipant]

    var startDate: Date { MeetingDates.parse(start) ?? .distantPast }
    var endDate: Date {
        let begin = startDate
        let finish = end.flatMap(MeetingDates.parse) ?? begin.addingTimeInterval(3600)
        return finish > begin ? finish : begin.addingTimeInterval(1800)
    }
    var meetingStatus: MeetingStatus { MeetingStatus(raw: status) }
    var tint: Color { meetingColor(color) ?? CrmTheme.rgb(0xd3bb73) }
    var location: String { locationName.isEmpty ? locationText : locationName }
    var kindLabel: String { isPrivate ? "Prywatne" : "Firmowe" }

    func response(of employee: String?) -> MeetingResponse? {
        guard let employee else { return nil }
        if createdBy == employee { return .accepted }
        return participants.first { $0.employeeId == employee }.map { MeetingResponse(raw: $0.response) }
    }
    func isParticipant(_ employee: String?) -> Bool {
        guard let employee else { return false }
        return createdBy == employee || participants.contains { $0.employeeId == employee }
    }
    func needsResponse(from employee: String?) -> Bool { meetingStatus != .cancelled && response(of: employee) == .pending }
    /// „Przyjęte 3 · Może 1 · Bez odpowiedzi 2 · Odrzucone 1” (bez organizatora).
    var responseSummary: String {
        var counts: [MeetingResponse: Int] = [:]
        for p in participants where p.employeeId != nil && p.employeeId != createdBy { counts[MeetingResponse(raw: p.response), default: 0] += 1 }
        return [MeetingResponse.accepted, .tentative, .pending, .declined].compactMap { response in
            guard let n = counts[response], n > 0 else { return nil }
            return "\(response == .pending ? "Bez odpowiedzi" : response.label) \(n)"
        }.joined(separator: " · ")
    }
    /// Pełna lista uczestników do `save_meeting` — bez niej zapis usunąłby pominięte osoby.
    var participantPayload: [JSONValue] {
        participants.compactMap { p in
            if let e = p.employeeId { return .object(["employee_id": .string(e)]) }
            if let c = p.contactId { return .object(["contact_id": .string(c)]) }
            return nil
        }
    }
}

/// Kolor spotkania z zapisu „#rrggbb” / „#rgb” (bez izolacji do wątku głównego — model jest używany także poza widokami).
func meetingColor(_ raw: String) -> Color? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
    let hex = text.count == 3 ? text.map { String(repeating: String($0), count: 2) }.joined() : text
    guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else { return nil }
    let rgb = hex.count == 8 ? value >> 8 : value
    return Color(.sRGB, red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255,
                 blue: Double(rgb & 255) / 255, opacity: hex.count == 8 ? Double(value & 255) / 255 : 1)
}

struct MeetingPerson: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    var nickname: String?
    var label: String { (nickname?.isEmpty == false ? nickname! : name) }
}

struct MeetingPlace: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    var detail: String?
}

enum MeetingDates {
    static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian); c.locale = Locale(identifier: "pl_PL"); c.timeZone = zone; c.firstWeekday = 2; return c
    }()
    private static let fractional: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? plain.date(from: value)
            ?? plain.date(from: value.replacingOccurrences(of: " ", with: "T").replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
    }
    static func iso(_ date: Date) -> String { fractional.string(from: date) }
    private static let lock = NSLock()
    private static var formatters: [String: DateFormatter] = [:]
    /// Data w czasie polskim według wzorca (formatery zapamiętane — oś czasu formatuje setki dat na sekundę przy przeciąganiu).
    static func format(_ date: Date, _ pattern: String) -> String {
        lock.lock(); defer { lock.unlock() }
        if let f = formatters[pattern] { return f.string(from: date) }
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateFormat = pattern
        formatters[pattern] = f
        return f.string(from: date)
    }
    static func time(_ date: Date) -> String { format(date, "HH:mm") }
    static func startOfWeek(_ date: Date) -> Date {
        let c = calendar
        let day = c.startOfDay(for: date)
        let weekday = c.component(.weekday, from: day)
        return c.date(byAdding: .day, value: -((weekday + 5) % 7), to: day) ?? day
    }
}

struct MeetingOption: Hashable, Identifiable {
    let value: Int
    let label: String
    var id: Int { value }
}
let meetingRecurrenceOptions: [MeetingOption] = [
    .init(value: 0, label: "Nie powtarzaj"), .init(value: 1, label: "Codziennie"), .init(value: 7, label: "Co tydzień"), .init(value: 14, label: "Co dwa tygodnie"),
]
let meetingAlertOptions: [MeetingOption] = [
    .init(value: 0, label: "W momencie rozpoczęcia"), .init(value: 5, label: "5 minut przed"), .init(value: 10, label: "10 minut przed"),
    .init(value: 15, label: "15 minut przed"), .init(value: 30, label: "30 minut przed"), .init(value: 45, label: "45 minut przed"),
    .init(value: 60, label: "1 godzinę przed"), .init(value: 120, label: "2 godziny przed"), .init(value: 180, label: "3 godziny przed"),
    .init(value: 360, label: "6 godzin przed"), .init(value: 720, label: "12 godzin przed"), .init(value: 1440, label: "1 dzień przed"),
    .init(value: 2880, label: "2 dni przed"), .init(value: 4320, label: "3 dni przed"), .init(value: 10080, label: "7 dni przed"),
]
func meetingRecurrenceLabel(_ days: Int) -> String { meetingRecurrenceOptions.first { $0.value == days }?.label ?? "Nie powtarzaj" }
func meetingAlertLabel(_ minutes: Int?) -> String? {
    guard let minutes else { return nil }
    return meetingAlertOptions.first { $0.value == minutes }?.label ?? "\(minutes) min przed"
}

/// Układ nachodzących się spotkań w kolumnie dnia (jak `layoutTimeline` w CRM): grupa nakładających się spotkań dzieli szerokość.
struct TimelineSlot: Identifiable {
    let meeting: Meeting
    let start: Double
    let end: Double
    let realStart: Date
    let realEnd: Date
    var column = 0
    var columns = 1
    var id: String { meeting.id }
}

func layoutTimeline(_ items: [TimelineSlot]) -> [TimelineSlot] {
    let sorted = items.sorted { $0.start == $1.start ? $0.end > $1.end : $0.start < $1.start }
    var placed: [TimelineSlot] = []
    var cluster: [TimelineSlot] = []
    var columnsEnd: [Double] = []
    var clusterEnd = -Double.infinity
    func flush() {
        let count = max(1, columnsEnd.count)
        for var slot in cluster { slot.columns = count; placed.append(slot) }
        cluster = []; columnsEnd = []
    }
    for var slot in sorted {
        let end = max(slot.end, slot.start + 1)
        if !cluster.isEmpty && slot.start >= clusterEnd { flush() }
        if let free = columnsEnd.firstIndex(where: { $0 <= slot.start }) { slot.column = free; columnsEnd[free] = end }
        else { slot.column = columnsEnd.count; columnsEnd.append(end) }
        clusterEnd = cluster.isEmpty ? end : max(clusterEnd, end)
        cluster.append(slot)
    }
    if !cluster.isEmpty { flush() }
    return placed
}
