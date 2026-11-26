import SwiftUI

// MARK: Działy, zakres planu i dostępność pracowników — odpowiednik `src/lib/CRM/meetings/teamAvailability.ts`
// (docs/team-availability.md). Dane: `/bridge/native/v1/meetings` (`people`, `availability`), e-mail do osób spoza firmy — `notify`.

/// Dział pracownika: wyznacza zakres planu (Zarząd — wszyscy; Sprzedaż i Biuro — Sprzedaż, Biuro, Magazyn; Magazyn — swój dział).
enum EmployeeDepartment: String, CaseIterable, Identifiable {
    case management, sales, office, warehouse
    var id: String { rawValue }
    /// Pusty albo nieznany dział — Biuro (jak w bazie).
    init(raw: String?) { self = EmployeeDepartment(rawValue: raw ?? "") ?? .office }
    var label: String {
        switch self { case .management: return "Zarząd"; case .sales: return "Sprzedaż"; case .office: return "Biuro"; case .warehouse: return "Magazyn" }
    }
    var hint: String {
        switch self {
        case .management: return "Widzi plan wszystkich pracowników."
        case .sales, .office: return "Widzi plan Sprzedaży, Biura i Magazynu."
        case .warehouse: return "Magazyn, DJ i technicy — widzi plan swojego działu."
        }
    }
}

/// Osoba z zakresu planu (`get_schedule_people`).
struct SchedulePerson: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let surname: String
    let nickname: String
    let avatarUrl: String?
    let department: String
    let supervisorId: String?
    let occupation: String
    let isSelf: Bool
    let isSubordinate: Bool

    var dept: EmployeeDepartment { EmployeeDepartment(raw: department) }
    var displayName: String {
        let nick = nickname.trimmingCharacters(in: .whitespaces)
        if !nick.isEmpty { return nick }
        let full = "\(name) \(surname)".trimmingCharacters(in: .whitespaces)
        return full.isEmpty ? "Pracownik" : full
    }
    var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let text = parts.compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return text.isEmpty ? "?" : text
    }
}

/// Zajętość (`get_team_availability`): spotkanie, event, faza albo nieobecność; bez szczegółów — „Zajęty”.
struct AvailabilityBlock: Decodable, Hashable, Identifiable {
    let employeeId: String
    let kind: String
    let itemId: String?
    let title: String?
    let subtitle: String?
    let start: String
    let end: String
    let allDay: Bool
    /// Spotkanie wstępne, zaproszenie bez odpowiedzi / „może”, wniosek o nieobecność do akceptacji.
    let tentative: Bool
    /// Szczegóły widoczne (osoba z zakresu albo spotkanie z moim udziałem).
    let detailed: Bool

    var id: String { "\(employeeId)|\(kind)|\(itemId ?? "")|\(start)|\(end)" }
    var startDate: Date { MeetingDates.parse(start) ?? .distantPast }
    var endDate: Date {
        let finish = MeetingDates.parse(end) ?? startDate.addingTimeInterval(3600)
        return finish > startDate ? finish : startDate.addingTimeInterval(900)
    }
    var displayTitle: String {
        if let title, !title.isEmpty { return title }
        return kind == "absence" ? "Nieobecność" : "Zajęty"
    }
    var kindLabel: String {
        switch kind { case "meeting": return "Spotkanie"; case "event": return "Event"; case "phase": return "Faza eventu"; default: return "Nieobecność" }
    }
    var color: Color {
        guard detailed else { return CrmTheme.rgb(0x8a8f9c) }
        switch kind {
        case "meeting": return CrmTheme.rgb(0x0ea5e9)
        case "event": return CrmTheme.rgb(0x3b82f6)
        case "phase": return CrmTheme.rgb(0x8b5cf6)
        default: return CrmTheme.rgb(0x10b981)
        }
    }
    /// Cały dzień albo co najmniej doba — wiersz „Cały dzień”.
    var wholeDay: Bool { allDay || endDate.timeIntervalSince(startDate) >= 86_400 }
    /// „10:00–11:00”, „cały dzień”, kilka dni — „02.12 10:00 – 03.12 02:00” (czas polski).
    var timeText: String {
        let calendar = MeetingDates.calendar
        if allDay {
            let last = endDate.addingTimeInterval(-1)
            return calendar.isDate(startDate, inSameDayAs: last) ? "cały dzień"
                : "\(MeetingDates.format(startDate, "dd.MM"))–\(MeetingDates.format(last, "dd.MM"))"
        }
        if calendar.isDate(startDate, inSameDayAs: endDate) { return "\(MeetingDates.time(startDate))–\(MeetingDates.time(endDate))" }
        return "\(MeetingDates.format(startDate, "dd.MM HH:mm")) – \(MeetingDates.format(endDate, "dd.MM HH:mm"))"
    }
    var tooltip: String {
        var parts = [displayTitle, timeText]
        if let subtitle, !subtitle.isEmpty { parts.append(subtitle) }
        if detailed { parts.append(kindLabel) }
        if tentative { parts.append("niepotwierdzone") }
        return parts.joined(separator: " · ")
    }
}

/// Osoba zajęta w terminie spotkania i jej pozycje.
struct MeetingConflict: Identifiable {
    let id: String
    let blocks: [AvailabilityBlock]
}

enum TeamAvailability {
    /// Zajętość wybranych osób nachodząca na termin [from, to), w kolejności `ids`.
    static func conflicts(_ blocks: [AvailabilityBlock], from: Date, to: Date, ids: [String]) -> [MeetingConflict] {
        guard to > from else { return [] }
        var result: [MeetingConflict] = []
        for id in ids {
            let hits = blocks.filter { $0.employeeId == id && $0.startDate < to && $0.endDate > from }.sorted { $0.startDate < $1.startDate }
            if !hits.isEmpty { result.append(MeetingConflict(id: id, blocks: hits)) }
        }
        return result
    }
    /// „10:00–11:00 Spotkanie z klientem (niepotwierdzone); cały dzień Nieobecność”.
    static func line(_ blocks: [AvailabilityBlock]) -> String {
        blocks.map { "\($0.timeText) \($0.displayTitle)\($0.tentative ? " (niepotwierdzone)" : "")" }.joined(separator: "; ")
    }
    static func headline(_ count: Int) -> String {
        if count == 1 { return "Jedna osoba ma już coś w planie w tym czasie" }
        let lastTwo = count % 100, last = count % 10
        let few = (2...4).contains(last) && !(12...14).contains(lastTwo)
        return "\(count) \(few ? "osoby mają" : "osób ma") już coś w planie w tym czasie"
    }
}

/// Stan spotkania sprzed zmiany — serwer wybiera wiadomość dla osób spoza firmy (zaproszenie, zmiana, odwołanie, „nieaktualne”).
struct MeetingMailBefore: Equatable {
    var start: String
    var end: String?
    var allDay: Bool
    var location: String
    var status: String
    var contactIds: [String]

    init(_ meeting: Meeting) {
        start = meeting.start; end = meeting.end; allDay = meeting.allDay; location = meeting.location
        status = meeting.meetingStatus.rawValue
        contactIds = meeting.participants.compactMap(\.contactId)
    }
    var json: JSONValue {
        .object([
            "start": .string(start), "end": end.map { JSONValue.string($0) } ?? .null, "allDay": .bool(allDay),
            "location": .string(location), "status": .string(status), "contactIds": .array(contactIds.map { .string($0) }),
        ])
    }
}

/// Wynik wysyłki do osób spoza firmy (`op=notify`).
struct MeetingMailResult: Decodable {
    let sent: Int
    let skipped: [String]
    let noMailbox: Bool
    let message: String?
    let failedCount: Int

    private enum CodingKeys: String, CodingKey { case sent, skipped, noMailbox, message, failed }
    private struct Failure: Decodable { let name: String? }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sent = (try? c.decode(Int.self, forKey: .sent)) ?? 0
        skipped = (try? c.decode([String].self, forKey: .skipped)) ?? []
        noMailbox = (try? c.decode(Bool.self, forKey: .noMailbox)) ?? false
        message = try? c.decode(String.self, forKey: .message)
        failedCount = ((try? c.decode([Failure].self, forKey: .failed)) ?? []).count
    }
}

/// Pytanie po zmianie spotkania: wysłać osobom spoza firmy e-mail? (przeciągnięcie terminu, zmiana statusu).
struct MeetingMailOffer: Identifiable {
    let id = UUID()
    let meetingId: String
    let question: String
    let names: [String]
    let before: MeetingMailBefore
    let scope: String
}

/// Ostrzeżenie w formularzu spotkania (jak „Asystent planowania” w Teams): kto z firmy ma już coś w planie w tym terminie.
/// Nie blokuje zapisu; edytowane spotkanie się nie liczy (`exclude`). Zapytanie po krótkiej zwłoce — zmiana godziny nie odpytuje
/// serwera po każdym kroku.
@MainActor struct MeetingConflictsRow: View {
    let store: MeetingsStore
    let ids: [String]
    let from: Date
    let to: Date
    let exclude: String?
    /// Nazwy osób (bieżący pracownik — „Ty”).
    let names: [String: String]
    @State private var blocks: [AvailabilityBlock] = []
    @State private var checked: String?
    @State private var failed = false

    private var key: String { "\(ids.joined(separator: ","))|\(from.timeIntervalSince1970)|\(to.timeIntervalSince1970)|\(exclude ?? "")" }

    var body: some View {
        let conflicts = TeamAvailability.conflicts(blocks, from: from, to: to, ids: ids)
        VStack(alignment: .leading, spacing: 4) {
            if checked != key {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Sprawdzanie, czy uczestnicy są wolni…")
                }
                .font(.caption).foregroundStyle(.secondary)
            } else if failed {
                Label("Nie udało się sprawdzić zajętości uczestników.", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.secondary)
            } else if conflicts.isEmpty {
                Label(ids.count > 1 ? "Uczestnicy z firmy są wolni w tym czasie." : "Masz wolny czas w tym terminie.", systemImage: "checkmark.circle")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Label(TeamAvailability.headline(conflicts.count), systemImage: "exclamationmark.triangle.fill")
                    .font(.callout.weight(.medium)).foregroundStyle(.orange)
                ForEach(conflicts) { conflict in
                    (Text("\(names[conflict.id] ?? "Pracownik"): ").fontWeight(.medium) + Text(TeamAvailability.line(conflict.blocks)))
                        .font(.caption).textSelection(.enabled)
                }
                Text("Możesz zapisać spotkanie mimo to — uczestnicy zdecydują w odpowiedzi.").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: key) {
            let current = key
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            guard to > from, !ids.isEmpty else { blocks = []; failed = false; checked = current; return }
            do {
                let next = try await store.availability(ids, from: from, to: to, exclude: exclude)
                guard !Task.isCancelled else { return }
                blocks = next; failed = false
            } catch {
                guard !Task.isCancelled else { return }
                blocks = []; failed = true
            }
            checked = current
        }
    }
}
