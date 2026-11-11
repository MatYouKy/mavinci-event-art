import SwiftUI

// MARK: Harmonogram — dane zakładki `phases` (`src/lib/native/eventTabs.ts`) i geometria osi czasu jak `src/lib/timeline.ts`.

struct PhasesTabData: Decodable {
    struct Event: Decodable { var start: String; var end: String; var plannedSetupAt: String?; var plannedTeardownAt: String? }
    struct Phase: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var description: String?
        var start: String
        var end: String
        var sequenceOrder: Double?
        var color: String?
        var notes: String?
        var typeId: String?
        var typeName: String?
        var typeColor: String?
        var rank: Double?
        var startDate: Date { MeetingDates.parse(start) ?? .distantPast }
        var endDate: Date { MeetingDates.parse(end) ?? .distantPast }
        var colorHex: String { color?.nonEmpty ?? typeColor?.nonEmpty ?? "#3b82f6" }
        /// Załadunek i rozładunek (`isWarehousePhase`).
        var isWarehouse: Bool { ["załadunek", "rozładunek"].contains((typeName?.nonEmpty ?? name).trimmingCharacters(in: .whitespaces).lowercased()) }
    }
    struct PhaseType: Decodable, Identifiable, Hashable { var id: String; var name: String; var color: String?; var durationHours: Double?; var rank: Double }
    struct Range: Decodable, Hashable { var start: String; var end: String }
    struct Person: Decodable, Hashable { var id: String; var name: String; var avatarUrl: String?; var avatar: AvatarCrop? }
    struct Accepted: Decodable, Hashable { var id: String; var reason: String; var acceptedAt: String?; var by: String? }
    struct Assignment: Decodable, Identifiable, Hashable {
        var id: String
        var phaseId: String
        var employeeId: String
        var employee: Person?
        var start: String?
        var end: String?
        var workStart: String?
        var workEnd: String?
        var status: String
        var role: String?
        var notes: String?
        var acceptedConflicts: [Accepted]
    }
    struct PhaseVehicle: Decodable, Identifiable, Hashable {
        var id: String; var phaseId: String; var vehicleId: String?; var start: String?; var end: String?
        var name: String; var registration: String?; var driver: String?; var purpose: String?; var notes: String?
    }
    struct PhaseEquipment: Decodable, Identifiable, Hashable {
        var id: String; var phaseId: String; var itemId: String?; var name: String; var start: String?; var end: String?; var quantity: Double?; var notes: String?
    }
    struct EventVehicle: Decodable, Hashable { var id: String; var vehicleId: String?; var name: String; var availableFrom: String?; var availableUntil: String? }
    struct EventEquipment: Decodable, Hashable { var id: String; var name: String; var category: String?; var kind: String; var quantity: Double? }
    struct Travel: Decodable, Hashable { var outbound: Double?; var inbound: Double? }
    struct FlexibleTravel: Decodable, Hashable { var key: String; var name: String; var description: String? }

    var event: Event
    var phases: [Phase]
    var phaseTypes: [PhaseType]
    var suggestions: [String: Range?]
    var travel: Travel
    var flexibleTravel: [FlexibleTravel]
    var team: [Person]
    var assignments: [Assignment]
    var phaseVehicles: [PhaseVehicle]
    var phaseEquipment: [PhaseEquipment]
    var eventVehicles: [EventVehicle]
    var eventEquipment: [EventEquipment]
}

enum TimelineZoom: String, CaseIterable, Identifiable {
    case days, hours, quarter
    var id: String { rawValue }
    var label: String { switch self { case .days: return "Całość"; case .hours: return "Godziny"; case .quarter: return "15 min" } }
    /// Przyciąganie i najkrótszy czas przy przeciąganiu (`useTimelineDrag`).
    var snap: TimeInterval { switch self { case .quarter: return 300; case .hours: return 900; case .days: return 3600 } }
    var minimumSpacing: CGFloat { switch self { case .quarter: return 42; case .hours: return 58; case .days: return 88 } }
    var minimumInterval: TimeInterval { switch self { case .quarter: return 300; case .hours: return 900; case .days: return 3600 } }
}

/// Skala osi: przeliczenie czasu na punkty i podziałka (`getTimeMarkerInterval`, `generateTimeMarkers`).
struct TimelineScale {
    let start: Date
    let end: Date
    let width: CGFloat
    var duration: TimeInterval { max(1, end.timeIntervalSince(start)) }
    func x(_ date: Date) -> CGFloat { CGFloat(date.timeIntervalSince(start) / duration) * width }
    func seconds(_ dx: CGFloat) -> TimeInterval { Double(dx / max(width, 1)) * duration }

    private static let intervals: [TimeInterval] = [300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200, 86400, 172800, 604800, 1209600, 2592000]

    func markerInterval(_ zoom: TimelineZoom) -> TimeInterval {
        let maximum = max(2, Int(width / zoom.minimumSpacing))
        return Self.intervals.first { $0 >= zoom.minimumInterval && duration / $0 <= Double(maximum) } ?? Self.intervals.last!
    }
    func markers(_ zoom: TimelineZoom) -> [Date] {
        let interval = markerInterval(zoom)
        let dayStart = MeetingDates.calendar.startOfDay(for: start)
        let offset = start.timeIntervalSince(dayStart)
        var current = dayStart.addingTimeInterval((offset / interval).rounded(.up) * interval)
        var result: [Date] = []
        while current <= end && result.count < 2000 {
            result.append(current)
            current = current.addingTimeInterval(interval)
        }
        return result
    }
    func markerLabel(_ date: Date, zoom: TimelineZoom) -> String {
        let interval = markerInterval(zoom)
        let c = MeetingDates.calendar.dateComponents([.hour, .minute], from: date)
        if interval >= 86400 { return MeetingDates.format(date, "dd.MM") }
        if duration > 86400 && c.hour == 0 && c.minute == 0 { return MeetingDates.format(date, "dd.MM") }
        if interval < 3600 && c.minute != 0 { return ":" + MeetingDates.format(date, "mm") }
        return MeetingDates.format(date, "HH:mm")
    }
}

enum TimelineText {
    /// Godziny na pasku fazy zależnie od powiększenia (`formatTimeLabel`).
    static func time(_ date: Date, zoom: TimelineZoom) -> String {
        switch zoom {
        case .days: return MeetingDates.format(date, "d MMM")
        case .hours: return MeetingDates.format(date, "HH:mm")
        case .quarter:
            return MeetingDates.calendar.component(.minute, from: date) == 0 ? MeetingDates.format(date, "HH:mm") : ":" + MeetingDates.format(date, "mm")
        }
    }
    /// Czas w godzinach: „2 h (120 min)”, „1 h 30 min (90 min)”, „45 min”; `minutesInParentheses: false` — bez nawiasu.
    static func hours(_ minutes: Int, minutesInParentheses: Bool = true) -> String {
        let total = max(0, minutes)
        if total < 60 { return "\(total) min" }
        let hours = total / 60, rest = total % 60
        let main: String = rest == 0 ? "\(hours) h" : "\(hours) h \(rest) min"
        return minutesInParentheses ? main + " (\(total) min)" : main
    }
    /// „2 d 4 h”, „4 h”, „3 h 15 min”, „45 min” (`getPhaseDuration`, w godzinach).
    static func duration(_ start: Date, _ end: Date) -> String {
        let minutes = Int((max(0, end.timeIntervalSince(start)) / 60).rounded())
        if minutes > 24 * 60 { return "\(minutes / 1440) d \((minutes % 1440) / 60) h" }
        return hours(minutes, minutesInParentheses: false)
    }
    /// „14.11, 18:00” (`toLocaleString('pl-PL', {day, month, hour, minute})`).
    static func short(_ value: String?) -> String {
        guard let date = value.flatMap(MeetingDates.parse) else { return "—" }
        return MeetingDates.format(date, "dd.MM, HH:mm")
    }
    /// „14.11.2026, 18:00:00” (`toLocaleString('pl-PL')`).
    static func full(_ value: String?) -> String {
        guard let date = value.flatMap(MeetingDates.parse) else { return "—" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm:ss")
    }
    /// „3h 15m” (`calculateDuration` w panelu zasobów).
    static func hoursMinutes(_ start: String?, _ end: String?) -> String {
        guard let from = start.flatMap(MeetingDates.parse), let to = end.flatMap(MeetingDates.parse) else { return "0h 0m" }
        return hours(Int((to.timeIntervalSince(from) / 60).rounded()), minutesInParentheses: false)
    }
}

/// Wiersz zasobu na osi (pracownik, pojazd, sprzęt) — jak `ResourceTimeline`.
struct TimelineResource: Identifiable {
    enum Kind: String { case employee, vehicle, equipment }
    struct Bar: Identifiable {
        var id: String
        var phase: PhasesTabData.Phase?
        var start: Date
        var end: Date
        var quantity: Double?
        var role: String?
        var status: String?
        /// Wiersz w bazie (pojazd z kilku faz jest jedną ciągłą linią — bez edycji).
        var editable: Bool
    }
    var id: String
    var kind: Kind
    var name: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
    var category: String?
    var bars: [Bar]
}
