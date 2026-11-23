import SwiftUI
import WidgetKit

// MARK: Widżet „Kalendarz” — plan pracownika na 7 dni
//
// Te same dane co „Mój plan” na pulpicie CRM, Maca i telefonu (`get_employee_schedule`): eventy i fazy, spotkania, zadania
// z terminem, kontakty w zapytaniach, oddzwonienia i nieobecności. Serwer: `GET /bridge/native/v1/widgets?op=calendar`
// (`calendarWidget` w `src/lib/native/widgets.ts`), kopia bez sieci: `widget-calendar.json` w kontenerze grupy. Kliknięcie
// pozycji otwiera event, spotkanie, zadanie, zapytanie albo kontakt; reszta widżetu — kalendarz w aplikacji.

struct CalendarWidget: Widget {
    static let style = AgendaStyle(
        title: "Kalendarz",
        icon: "calendar",
        empty: "Nic więcej w planie na najbliższe 7 dni.",
        emptyShort: "Nic w planie",
        link: WidgetPlatform.link("calendar"),
        showsDate: true,
        attention: nil
    )

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pl.mavinci.widget.calendar", provider: AgendaProvider(source: .calendar)) { entry in
            AgendaWidgetView(entry: entry, style: Self.style)
        }
        .configurationDisplayName("Kalendarz")
        .description("Twój plan na 7 dni: eventy, spotkania, zadania z terminem, kontakty z zapytań i nieobecności — jak „Mój plan” w CRM.")
        .supportedFamilies(WidgetPlatform.families)
    }
}

struct CalendarWidgetItem: Codable {
    let id: String
    /// `event` | `phase` | `meeting` | `inquiry` | `task` | `call` | `absence`
    let kind: String
    let title: String
    let subtitle: String?
    let start: String
    let end: String
    let allDay: Bool
    let status: String?
    let color: String
    /// Co otworzyć: `event` | `meeting` | `task` | `inquiry` | `contact` (z identyfikatorem `targetId`).
    let target: String?
    let targetId: String?
}

struct CalendarWidgetReply: Codable {
    let items: [CalendarWidgetItem]
    let total: Int
    let generatedAt: String
}

enum CalendarWidgetData {
    static func load() async -> AgendaSnapshot {
        let loaded: WidgetAPI.Loaded<CalendarWidgetReply> = await WidgetAPI.load("/bridge/native/v1/widgets?op=calendar", cache: "widget-calendar.json")
        return AgendaSnapshot(state: loaded.state, items: loaded.reply?.items.compactMap(agendaItem) ?? [], updatedAt: loaded.updatedAt)
    }

    static func agendaItem(_ item: CalendarWidgetItem) -> AgendaItem? {
        guard let start = WidgetTime.parse(item.start), let end = WidgetTime.parse(item.end) else { return nil }
        let waiting = (item.kind == "event" || item.kind == "phase") && item.status == "pending"
        let badge: String?
        if waiting { badge = "Do potwierdzenia" }
        else if item.kind == "meeting" && item.status == "tentative" { badge = "Wstępne" }
        else { badge = nil }
        return AgendaItem(id: item.id, start: start, end: end, allDay: item.allDay, title: item.title, detail: item.subtitle,
                          color: WidgetPalette.hex(item.color), icon: icon(item.kind), badge: badge, attention: waiting, link: link(item))
    }

    static func icon(_ kind: String) -> String {
        switch kind {
        case "event": return "sparkles"
        case "phase": return "flag.fill"
        case "meeting": return "person.2.fill"
        case "inquiry": return "envelope.fill"
        case "task": return "checkmark.circle.fill"
        case "call": return "phone.fill"
        case "absence": return "airplane"
        default: return "calendar"
        }
    }

    static func link(_ item: CalendarWidgetItem) -> URL? {
        guard let target = item.target, let id = item.targetId, ["event", "meeting", "task", "inquiry", "contact"].contains(target),
              UUID(uuidString: id) != nil else { return WidgetPlatform.link("calendar") }
        return WidgetPlatform.link(target, id)
    }

    static func sample() -> AgendaSnapshot {
        let now = Date()
        func at(_ hours: Double) -> Date { now.addingTimeInterval(hours * 3600) }
        let items = [
            AgendaItem(id: "1", start: at(1), end: at(2), allDay: false, title: "Spotkanie z klientem — gala firmowa", detail: "Biuro Mavinci",
                       color: WidgetPalette.hex("#0ea5e9"), icon: "person.2.fill", badge: nil, attention: false, link: nil),
            AgendaItem(id: "2", start: at(3.5), end: at(4), allDay: false, title: "Wysłać ofertę na wesele", detail: "Wysoki priorytet",
                       color: WidgetPalette.hex("#f97316"), icon: "checkmark.circle.fill", badge: nil, attention: false, link: nil),
            AgendaItem(id: "3", start: at(26), end: at(32), allDay: false, title: "Wesele w pałacu", detail: "Pałac · Wesela",
                       color: WidgetPalette.hex("#3b82f6"), icon: "sparkles", badge: "Do potwierdzenia", attention: true, link: nil),
        ]
        return AgendaSnapshot(state: .ready, items: items, updatedAt: now)
    }
}
