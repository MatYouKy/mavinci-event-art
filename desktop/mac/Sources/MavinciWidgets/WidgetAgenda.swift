import SwiftUI
import WidgetKit

// MARK: Terminarz — wspólny widok widżetów „Kalendarz” i „Spotkania”
//
// Mały: najbliższa pozycja (kiedy, tytuł, szczegóły). Średni: trzy najbliższe z godziną i dniem. Duży: terminarz z nagłówkami
// dni. Bardzo duży (Mac, iPad): terminarz w dwóch kolumnach. iPhone i iPad — także ekran blokady: prostokątny (najbliższa
// pozycja) i w linii z godziną. Pozycje zakończone znikają same (oś czasu ma wpisy na początek i koniec każdej pozycji do
// następnego pobrania danych), trwające mają „Teraz”. Kliknięcie pozycji otwiera ją w aplikacji, reszty widżetu — sekcję.

struct AgendaItem: Identifiable {
    let id: String
    let start: Date
    let end: Date
    let allDay: Bool
    let title: String
    let detail: String?
    let color: Color
    let icon: String
    /// Wyróżnienie złotem (np. „Odpowiedz”, „Do potwierdzenia”).
    let badge: String?
    /// Pozycja czeka na ruch pracownika (np. odpowiedź na zaproszenie) — liczona w nagłówku.
    let attention: Bool
    let link: URL?

    func ongoing(at now: Date) -> Bool { start <= now && end > now }
}

struct AgendaSnapshot {
    let state: WidgetState
    let items: [AgendaItem]
    /// Kiedy pobrano dane z serwera (kopia — czas jej zapisu).
    let updatedAt: Date?
}

struct AgendaEntry: TimelineEntry {
    let date: Date
    let snapshot: AgendaSnapshot
}

struct AgendaStyle {
    let title: String
    let icon: String
    /// Brak pozycji (z połączeniem) — pełne zdanie i wersja na ekran blokady.
    let empty: String
    let emptyShort: String
    /// Sekcja w aplikacji (kliknięcie poza pozycją).
    let link: URL?
    /// Nagłówek z dzisiejszą datą (kalendarz).
    let showsDate: Bool
    /// Dopisek nagłówka dla pozycji czekających na pracownika, np. „do odpowiedzi” → „2 do odpowiedzi”.
    let attention: String?
}

enum AgendaSource {
    case calendar, meetings

    func load() async -> AgendaSnapshot {
        switch self {
        case .calendar: return await CalendarWidgetData.load()
        case .meetings: return await MeetingsWidgetData.load()
        }
    }

    var sample: AgendaSnapshot {
        switch self {
        case .calendar: return CalendarWidgetData.sample()
        case .meetings: return MeetingsWidgetData.sample()
        }
    }
}

struct AgendaProvider: TimelineProvider {
    let source: AgendaSource

    func placeholder(in context: Context) -> AgendaEntry { AgendaEntry(date: Date(), snapshot: source.sample) }

    func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(AgendaEntry(date: Date(), snapshot: await source.load())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
        Task { completion(AgendaTimeline.make(await source.load())) }
    }
}

enum AgendaTimeline {
    /// Wpisy osi czasu: teraz oraz chwile, w których zmienia się widok (początek i koniec pozycji, północ) do następnego pobrania
    /// danych — „Teraz” i znikanie zakończonych pozycji działają bez sieci.
    static func make(_ snapshot: AgendaSnapshot) -> Timeline<AgendaEntry> {
        let now = Date()
        let refresh = now.addingTimeInterval(snapshot.state == .ready ? WidgetPlatform.refresh : WidgetPlatform.retry)
        var moments = Set<Date>()
        for item in snapshot.items {
            for moment in [item.start, item.end] where moment > now && moment < refresh { moments.insert(moment) }
        }
        if let midnight = WidgetTime.calendar.date(byAdding: .day, value: 1, to: WidgetTime.calendar.startOfDay(for: now)), midnight < refresh {
            moments.insert(midnight)
        }
        let dates = [now] + moments.sorted().prefix(12)
        return Timeline(entries: dates.map { AgendaEntry(date: $0, snapshot: snapshot) }, policy: .after(refresh))
    }
}

/// „1 osoba”, „3 osoby”, „5 osób”.
func peopleLabel(_ count: Int) -> String {
    let lastTwo = count % 100
    let last = count % 10
    if count == 1 { return "1 osoba" }
    if (2...4).contains(last) && !(12...14).contains(lastTwo) { return "\(count) osoby" }
    return "\(count) osób"
}

private enum AgendaRow: Identifiable {
    case day(Date)
    case item(AgendaItem)

    var id: String {
        switch self {
        case .day(let date): return "day-\(Int(date.timeIntervalSince1970))"
        case .item(let item): return item.id
        }
    }
}

struct AgendaWidgetView: View {
    let entry: AgendaEntry
    let style: AgendaStyle
    @Environment(\.widgetFamily) private var family

    private var now: Date { entry.date }
    /// Pozycje jeszcze niezakończone w chwili wpisu.
    private var items: [AgendaItem] { entry.snapshot.items.filter { $0.end > now } }

    private var header: WidgetHeader {
        let waiting = items.filter(\.attention).count
        if let attention = style.attention, waiting > 0 { return WidgetHeader(icon: style.icon, title: style.title, trailing: "\(waiting) \(attention)") }
        return WidgetHeader(icon: style.icon, title: style.title, trailing: style.showsDate ? WidgetTime.shortDay.string(from: now) : nil)
    }

    /// Mały widżet i ekran blokady: kliknięcie otwiera najbliższą pozycję; większe — sekcję (pozycje mają własne odnośniki).
    private var mainLink: URL? {
        if family == .systemSmall { return items.first?.link ?? style.link }
        #if os(iOS)
        if family == .accessoryRectangular || family == .accessoryInline { return items.first?.link ?? style.link }
        #endif
        return style.link
    }

    var body: some View {
        content
            .foregroundStyle(WidgetPalette.ink)
            .mavinciWidgetBackground()
            .widgetURL(mainLink)
    }

    @ViewBuilder private var content: some View {
        switch family {
        #if os(iOS)
        case .accessoryRectangular:
            rectangular
        case .accessoryInline:
            inline
        #endif
        default:
            if entry.snapshot.state == .signedOut {
                WidgetMessage(header: header, icon: "person.crop.circle.badge.exclamationmark", text: WidgetPlatform.signedOutText)
            } else if family == .systemSmall {
                small
            } else if family == .systemMedium {
                medium
            } else if family == .systemExtraLarge {
                extraLarge
            } else {
                large
            }
        }
    }

    // MARK: Opisy czasu

    /// „Teraz · do 15:00”, „Dziś, 14:00”, „Jutro · cały dzień”.
    private func moment(_ item: AgendaItem) -> String {
        if item.ongoing(at: now) {
            if item.allDay { return "Dziś · cały dzień" }
            let until = WidgetTime.calendar.isDate(item.end, inSameDayAs: now)
                ? WidgetTime.clock.string(from: item.end)
                : WidgetTime.day(item.end.addingTimeInterval(-1), now: now)
            return "Teraz · do \(until)"
        }
        let day = WidgetTime.day(item.start, now: now)
        return item.allDay ? "\(day) · cały dzień" : "\(day), \(WidgetTime.clock.string(from: item.start))"
    }

    /// Godzina w wierszu: „14:00”, „Teraz”, „Cały dzień”.
    private func clock(_ item: AgendaItem) -> String {
        if item.allDay { return "Cały dzień" }
        return item.ongoing(at: now) ? "Teraz" : WidgetTime.clock.string(from: item.start)
    }

    // MARK: Mały — najbliższa pozycja

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            Spacer(minLength: 0)
            if let next = items.first {
                Text(moment(next)).font(.system(size: 12, weight: .semibold)).foregroundStyle(WidgetPalette.gold).lineLimit(1)
                    .minimumScaleFactor(0.8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(next.title).font(.system(size: 13, weight: .semibold)).lineLimit(3)
                    if let detail = next.detail {
                        Text(detail).font(.system(size: 10.5)).foregroundStyle(WidgetPalette.ink.opacity(0.6)).lineLimit(2)
                    }
                    if let badge = next.badge {
                        Text(badge).font(.system(size: 10, weight: .semibold)).foregroundStyle(WidgetPalette.gold)
                    }
                }
                .padding(.leading, 8)
                .overlay(alignment: .leading) { Capsule().fill(next.color).frame(width: 3) }
                if items.count > 1 {
                    Text("i \(items.count - 1) więcej").font(.system(size: 10)).foregroundStyle(WidgetPalette.ink.opacity(0.5))
                }
            } else {
                empty
            }
            Spacer(minLength: 0)
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Średni — trzy najbliższe

    private var medium: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            if items.isEmpty {
                Spacer(minLength: 0)
                empty
                Spacer(minLength: 0)
            } else {
                ForEach(Array(items.prefix(entry.snapshot.state == .offline ? 2 : 3))) { item in
                    let day = item.ongoing(at: now) || WidgetTime.calendar.isDate(item.start, inSameDayAs: now)
                        ? nil : WidgetTime.day(item.start, now: now)
                    linked(item) { row(item, time: clock(item), day: day) }
                }
                Spacer(minLength: 0)
            }
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Duży i bardzo duży — terminarz z nagłówkami dni

    private var large: some View {
        let first = rows(items, budget: 16)
        return VStack(alignment: .leading, spacing: 6) {
            header
            if items.isEmpty {
                Spacer(minLength: 0)
                empty
                Spacer(minLength: 0)
            } else {
                agenda(first.rows)
                Spacer(minLength: 0)
                more(items.count - first.used)
            }
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var extraLarge: some View {
        let first = rows(items, budget: 16)
        let second = rows(Array(items.dropFirst(first.used)), budget: 16)
        return VStack(alignment: .leading, spacing: 6) {
            header
            if items.isEmpty {
                Spacer(minLength: 0)
                empty
                Spacer(minLength: 0)
            } else {
                HStack(alignment: .top, spacing: 18) {
                    agenda(first.rows).frame(maxWidth: .infinity, alignment: .topLeading)
                    agenda(second.rows).frame(maxWidth: .infinity, alignment: .topLeading)
                }
                Spacer(minLength: 0)
                more(items.count - first.used - second.used)
            }
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Wiersze z nagłówkami dni w limicie miejsca (nagłówek — 1, pozycja — 2 jednostki) i liczba pokazanych pozycji.
    private func rows(_ list: [AgendaItem], budget: Int) -> (rows: [AgendaRow], used: Int) {
        var result: [AgendaRow] = []
        var cost = 0
        var used = 0
        var current: Date?
        for item in list {
            let day = WidgetTime.calendar.startOfDay(for: max(item.start, now))
            let header = day != current
            let next = cost + (header ? 3 : 2)
            if next > budget { break }
            if header { result.append(.day(day)); current = day }
            result.append(.item(item))
            cost = next
            used += 1
        }
        return (result, used)
    }

    private func agenda(_ rows: [AgendaRow]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(rows) { row in
                switch row {
                case .day(let day):
                    Text(WidgetTime.dayTitle(day, now: now).uppercased()).font(.system(size: 9.5, weight: .semibold)).kerning(0.6)
                        .foregroundStyle(WidgetPalette.gold.opacity(0.85)).lineLimit(1).padding(.top, 2)
                case .item(let item):
                    linked(item) { self.row(item, time: clock(item), day: nil) }
                }
            }
        }
    }

    @ViewBuilder private func more(_ count: Int) -> some View {
        if count > 0 {
            Text("i \(count) więcej…").font(.system(size: 10.5)).foregroundStyle(WidgetPalette.ink.opacity(0.5))
        }
    }

    // MARK: Wiersz pozycji

    @ViewBuilder private func linked<Content: View>(_ item: AgendaItem, @ViewBuilder _ content: () -> Content) -> some View {
        if let link = item.link {
            Link(destination: link) { content() }
        } else {
            content()
        }
    }

    private func row(_ item: AgendaItem, time: String, day: String?) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(time).font(.system(size: 11, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(item.ongoing(at: now) ? WidgetPalette.gold : WidgetPalette.ink.opacity(0.8))
                if let day {
                    Text(day).font(.system(size: 9.5)).foregroundStyle(WidgetPalette.ink.opacity(0.5))
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .frame(width: 50, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: item.icon).font(.system(size: 9, weight: .semibold)).foregroundStyle(item.color)
                    Text(item.title).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                }
                if item.detail != nil || item.badge != nil {
                    HStack(spacing: 5) {
                        if let badge = item.badge {
                            Text(badge).fontWeight(.semibold).foregroundStyle(WidgetPalette.gold)
                        }
                        if let detail = item.detail {
                            Text(detail).foregroundStyle(WidgetPalette.ink.opacity(0.55))
                        }
                    }
                    .font(.system(size: 10.5))
                    .lineLimit(1)
                }
            }
            .padding(.leading, 8)
            .overlay(alignment: .leading) { Capsule().fill(item.color).frame(width: 3) }
            Spacer(minLength: 0)
        }
    }

    private var empty: some View {
        HStack(spacing: 8) {
            Image(systemName: entry.snapshot.state == .offline ? "wifi.slash" : "checkmark.seal")
                .font(.system(size: 18)).foregroundStyle(WidgetPalette.gold)
            Text(entry.snapshot.state == .offline ? "Brak połączenia z serwerem CRM." : style.empty)
                .font(.system(size: 12)).foregroundStyle(WidgetPalette.ink.opacity(0.75)).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Ekran blokady (iPhone, iPad)

    #if os(iOS)
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.snapshot.state == .signedOut {
                Label(style.title, systemImage: style.icon).font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text("Zaloguj się w aplikacji Mavinci").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
            } else if let next = items.first {
                Label(moment(next), systemImage: style.icon).font(.system(size: 12, weight: .semibold)).lineLimit(1).widgetAccentable()
                Text(next.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                if let detail = next.badge ?? next.detail {
                    Text(detail).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Label(style.title, systemImage: style.icon).font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text(entry.snapshot.state == .offline ? "Bez połączenia" : style.emptyShort).font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var inline: some View {
        if let next = items.first, entry.snapshot.state != .signedOut {
            let time = next.allDay ? WidgetTime.day(max(next.start, now), now: now) : (next.ongoing(at: now) ? "Teraz" : WidgetTime.clock.string(from: next.start))
            Label("\(time) \(next.title)", systemImage: style.icon)
        } else {
            Label(entry.snapshot.state == .signedOut ? "Mavinci — zaloguj się" : style.emptyShort, systemImage: style.icon)
        }
    }
    #endif
}
