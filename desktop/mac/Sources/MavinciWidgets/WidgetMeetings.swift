import SwiftUI
import WidgetKit

// MARK: Widżet „Spotkania” — Twoje spotkania na 14 dni
//
// Spotkania, w których pracownik jest autorem albo uczestnikiem (bez odwołanych i odrzuconych) — trwające i najbliższe, z miejscem,
// liczbą osób i organizatorem. Zaproszenie bez odpowiedzi — złote „Odpowiedz” i licznik „… do odpowiedzi” w nagłówku; „Może”
// (Twoja odpowiedź) i „Wstępne” (status spotkania) jak w CRM. Serwer: `GET /bridge/native/v1/widgets?op=meetings`
// (`meetingsWidget` w `src/lib/native/widgets.ts`), kopia bez sieci: `widget-meetings.json` w kontenerze grupy. Kliknięcie
// spotkania otwiera je w aplikacji (`…://meeting/<id>`), reszty widżetu — Spotkania.

struct MeetingsWidget: Widget {
    static let style = AgendaStyle(
        title: "Spotkania",
        icon: "person.2.fill",
        empty: "Brak spotkań w najbliższych 2 tygodniach.",
        emptyShort: "Brak spotkań",
        link: WidgetPlatform.link("meetings"),
        showsDate: false,
        attention: "do odpowiedzi"
    )

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pl.mavinci.widget.meetings", provider: AgendaProvider(source: .meetings)) { entry in
            AgendaWidgetView(entry: entry, style: Self.style)
        }
        .configurationDisplayName("Spotkania")
        .description("Twoje najbliższe spotkania z miejscem i uczestnikami; zaproszenia czekające na odpowiedź są wyróżnione.")
        .supportedFamilies(WidgetPlatform.families)
    }
}

struct MeetingsWidgetItem: Codable {
    let id: String
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let color: String
    let location: String?
    /// Status spotkania: `confirmed` | `tentative`.
    let status: String
    /// Twoja odpowiedź: `accepted` | `tentative` | `pending`.
    let response: String
    /// Organizator (gdy to nie Ty).
    let organizer: String?
    let mine: Bool
    let participants: Int
    let isPrivate: Bool
}

struct MeetingsWidgetReply: Codable {
    let meetings: [MeetingsWidgetItem]
    let total: Int
    let pending: Int
    let generatedAt: String
}

enum MeetingsWidgetData {
    static func load() async -> AgendaSnapshot {
        let loaded: WidgetAPI.Loaded<MeetingsWidgetReply> = await WidgetAPI.load("/bridge/native/v1/widgets?op=meetings", cache: "widget-meetings.json")
        return AgendaSnapshot(state: loaded.state, items: loaded.reply?.meetings.compactMap(agendaItem) ?? [], updatedAt: loaded.updatedAt)
    }

    static func agendaItem(_ meeting: MeetingsWidgetItem) -> AgendaItem? {
        guard let start = WidgetTime.parse(meeting.start), let end = WidgetTime.parse(meeting.end) else { return nil }
        let pending = meeting.response == "pending"
        let badge: String?
        if pending { badge = "Odpowiedz" }
        else if meeting.response == "tentative" { badge = "Może" }
        else if meeting.status == "tentative" { badge = "Wstępne" }
        else { badge = nil }
        let detail = [meeting.location, meeting.participants > 1 ? peopleLabel(meeting.participants) : nil, meeting.organizer]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return AgendaItem(id: meeting.id, start: start, end: end, allDay: meeting.allDay, title: meeting.title,
                          detail: detail.isEmpty ? nil : detail, color: WidgetPalette.hex(meeting.color),
                          icon: meeting.isPrivate ? "lock.fill" : "person.2.fill", badge: badge, attention: pending,
                          link: UUID(uuidString: meeting.id) != nil ? WidgetPlatform.link("meeting", meeting.id) : WidgetPlatform.link("meetings"))
    }

    static func sample() -> AgendaSnapshot {
        let now = Date()
        func at(_ hours: Double) -> Date { now.addingTimeInterval(hours * 3600) }
        let items = [
            AgendaItem(id: "1", start: at(0.5), end: at(1.5), allDay: false, title: "Omówienie scenariusza gali", detail: "Biuro Mavinci · 4 osoby",
                       color: WidgetPalette.hex("#d3bb73"), icon: "person.2.fill", badge: nil, attention: false, link: nil),
            AgendaItem(id: "2", start: at(5), end: at(6), allDay: false, title: "Wizja lokalna w hotelu", detail: "Hotel · 3 osoby · Anna Nowak",
                       color: WidgetPalette.hex("#0ea5e9"), icon: "person.2.fill", badge: "Odpowiedz", attention: true, link: nil),
            AgendaItem(id: "3", start: at(25), end: at(26), allDay: false, title: "Spotkanie z dostawcą oświetlenia", detail: "Online · 2 osoby",
                       color: WidgetPalette.hex("#8b5cf6"), icon: "person.2.fill", badge: nil, attention: false, link: nil),
        ]
        return AgendaSnapshot(state: .ready, items: items, updatedAt: now)
    }
}
