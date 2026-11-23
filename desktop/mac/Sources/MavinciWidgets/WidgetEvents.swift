import SwiftUI
import WidgetKit

// MARK: Widżet „Wydarzenia” — najbliższe eventy (30 dni)
//
// Eventy widoczne dla pracownika (jak lista Eventów w CRM — RLS — oraz jego realizacje), które trwają albo zaczynają się w ciągu
// 30 dni, bez anulowanych: dzień i godzina, miejsce, klient i kolor kategorii. Etap sprzedaży eventów jeszcze niepotwierdzonych
// („Zapytanie”, „Oferta do wysłania”, „Oferta wysłana”) widzą tylko osoby z dostępem do etapów sprzedaży; zapytanie albo oferta
// do wysłania na 72 godziny przed eventem — złote „do potwierdzenia” w nagłówku. Serwer: `GET /bridge/native/v1/widgets?op=events`
// (`eventsWidget` w `src/lib/native/widgets.ts`), kopia bez sieci: `widget-events.json` w kontenerze grupy. Kliknięcie eventu
// otwiera jego kartę w aplikacji (`…://event/<id>`), reszty widżetu — Eventy (`…://events`).

struct EventsWidget: Widget {
    static let style = AgendaStyle(
        title: "Wydarzenia",
        icon: "sparkles",
        empty: "Brak wydarzeń w najbliższych 30 dniach.",
        emptyShort: "Brak wydarzeń",
        link: WidgetPlatform.link("events"),
        showsDate: false,
        attention: "do potwierdzenia",
        counts: true
    )

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pl.mavinci.widget.events", provider: AgendaProvider(source: .events)) { entry in
            AgendaWidgetView(entry: entry, style: Self.style)
        }
        .configurationDisplayName("Wydarzenia")
        .description("Najbliższe eventy (30 dni): termin, miejsce i klient; niepotwierdzone tuż przed terminem są wyróżnione.")
        .supportedFamilies(WidgetPlatform.families)
    }
}

struct EventsWidgetItem: Codable {
    let id: String
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let color: String
    let location: String?
    let client: String?
    let category: String?
    /// Etap sprzedaży eventu niepotwierdzonego („Zapytanie”, „Oferta wysłana”…) — tylko dla osób, które go widzą.
    let stage: String?
    /// Zapytanie albo oferta do wysłania na 72 godziny przed eventem.
    let attention: Bool
}

struct EventsWidgetReply: Codable {
    let events: [EventsWidgetItem]
    let total: Int
    let days: Int
    /// Brak dostępu do eventów (lista zawsze pusta).
    let available: Bool?
    let generatedAt: String
}

enum EventsWidgetData {
    static func load() async -> AgendaSnapshot {
        let loaded: WidgetAPI.Loaded<EventsWidgetReply> = await WidgetAPI.load("/bridge/native/v1/widgets?op=events", cache: "widget-events.json")
        let notice = loaded.reply?.available == false ? "Nie masz dostępu do eventów." : nil
        return AgendaSnapshot(state: loaded.state, items: loaded.reply?.events.compactMap(agendaItem) ?? [], updatedAt: loaded.updatedAt,
                              notice: notice)
    }

    static func agendaItem(_ event: EventsWidgetItem) -> AgendaItem? {
        guard let start = WidgetTime.parse(event.start), let end = WidgetTime.parse(event.end) else { return nil }
        let place = [event.location, event.client].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return AgendaItem(id: event.id, start: start, end: end, allDay: event.allDay, title: event.title,
                          detail: place.isEmpty ? event.category : Optional(place), color: WidgetPalette.hex(event.color),
                          icon: "sparkles", badge: event.stage, attention: event.attention,
                          link: UUID(uuidString: event.id) != nil ? WidgetPlatform.link("event", event.id) : WidgetPlatform.link("events"))
    }

    static func sample() -> AgendaSnapshot {
        let now = Date()
        func at(_ hours: Double) -> Date { now.addingTimeInterval(hours * 3600) }
        let items = [
            AgendaItem(id: "1", start: at(5), end: at(11), allDay: false, title: "Gala firmowa", detail: "Hotel · Klient firmowy",
                       color: WidgetPalette.hex("#d3bb73"), icon: "sparkles", badge: nil, attention: false, link: nil),
            AgendaItem(id: "2", start: at(50), end: at(60), allDay: false, title: "Wesele w pałacu", detail: "Pałac · Para młoda",
                       color: WidgetPalette.hex("#ec4899"), icon: "sparkles", badge: "Oferta wysłana", attention: false, link: nil),
            AgendaItem(id: "3", start: at(170), end: at(178), allDay: false, title: "Konferencja", detail: "Centrum kongresowe",
                       color: WidgetPalette.hex("#0ea5e9"), icon: "sparkles", badge: nil, attention: false, link: nil),
        ]
        return AgendaSnapshot(state: .ready, items: items, updatedAt: now)
    }
}
