import SwiftUI
import WidgetKit

// MARK: Terminarz — wspólny widok widżetów „Kalendarz”, „Spotkania” i „Wydarzenia”
//
// Mały: najbliższa pozycja (kiedy, tytuł, szczegóły). Średni: najbliższe pozycje z godziną i dniem. Duży: terminarz z nagłówkami
// dni. Bardzo duży (Mac, iPad): terminarz w dwóch kolumnach. Średni i większe pokazują tylko pozycje mieszczące się w całości
// (stałe wysokości wierszy — `WidgetLayout`, miejsce mierzone `GeometryReader`), z linią podziału między pozycjami tego samego
// dnia; resztę opisuje „i 3 więcej…”. iPhone i iPad — także ekran blokady: prostokątny (najbliższa pozycja) i w linii z godziną.
// Pozycje zakończone znikają same (oś czasu ma wpisy na początek i koniec każdej pozycji do następnego pobrania danych), trwające
// mają „Teraz”. Przypomnienie (`AgendaStyle.countdown` — Kalendarz i Spotkania): pozycja zaczynająca się w ciągu godziny ma
// złote „za 25 min” (mały widżet i ekran blokady — w ciągu 2 godzin), oś czasu ma wtedy wpis co minutę. Kliknięcie pozycji
// otwiera ją w aplikacji, reszty widżetu — sekcję.

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
    /// Komunikat zamiast pustej listy (np. brak dostępu do eventów).
    var notice: String? = nil
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
    /// Liczba pozycji w nagłówku (gdy nic nie czeka na pracownika).
    var counts: Bool = false
    /// Przypomnienie „za 25 min” przed początkiem pozycji (musi zgadzać się z `AgendaSource.countdown` — wpisy osi czasu).
    var countdown: Bool = false
}

enum AgendaSource {
    case calendar, meetings, events

    func load() async -> AgendaSnapshot {
        switch self {
        case .calendar: return await CalendarWidgetData.load()
        case .meetings: return await MeetingsWidgetData.load()
        case .events: return await EventsWidgetData.load()
        }
    }

    var sample: AgendaSnapshot {
        switch self {
        case .calendar: return CalendarWidgetData.sample()
        case .meetings: return MeetingsWidgetData.sample()
        case .events: return EventsWidgetData.sample()
        }
    }

    /// Oś czasu z wpisem co minutę przed początkiem pozycji (przypomnienie „za 25 min”).
    var countdown: Bool { self != .events }
}

struct AgendaProvider: TimelineProvider {
    let source: AgendaSource

    func placeholder(in context: Context) -> AgendaEntry { AgendaEntry(date: Date(), snapshot: source.sample) }

    func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(AgendaEntry(date: Date(), snapshot: await source.load())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
        Task { completion(AgendaTimeline.make(await source.load(), countdown: source.countdown)) }
    }
}

enum AgendaTimeline {
    /// Przypomnienie w wierszach listy — do godziny przed początkiem.
    static let rowCountdown = 60
    /// Przypomnienie w małym widżecie i na ekranie blokady — do 2 godzin przed początkiem.
    static let nextCountdown = 120

    /// Wpisy osi czasu: teraz oraz chwile, w których zmienia się widok (początek i koniec pozycji, północ, a z przypomnieniem — każda
    /// minuta przed początkiem pozycji) do następnego pobrania danych — „Teraz”, „za 25 min” i znikanie zakończonych pozycji działają
    /// bez sieci.
    static func make(_ snapshot: AgendaSnapshot, countdown: Bool) -> Timeline<AgendaEntry> {
        let now = Date()
        let refresh = now.addingTimeInterval(snapshot.state == .ready ? WidgetPlatform.refresh : WidgetPlatform.retry)
        var moments = Set<Date>()
        for item in snapshot.items {
            for moment in [item.start, item.end] where moment > now && moment < refresh { moments.insert(moment) }
            guard countdown, !item.allDay, item.start > now,
                  item.start < refresh.addingTimeInterval(Double(nextCountdown) * 60) else { continue }
            for minutes in 1...nextCountdown {
                let moment = item.start.addingTimeInterval(-Double(minutes) * 60)
                if moment <= now { break }
                if moment < refresh { moments.insert(moment) }
            }
        }
        if let midnight = WidgetTime.calendar.date(byAdding: .day, value: 1, to: WidgetTime.calendar.startOfDay(for: now)), midnight < refresh {
            moments.insert(midnight)
        }
        let dates = [now] + moments.sorted().prefix(60)
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

    var isItem: Bool {
        if case .item = self { return true }
        return false
    }
}

/// Kolumna terminarza: wiersze (nagłówki dni i pozycje) i liczba pokazanych pozycji.
private struct AgendaColumn {
    let rows: [AgendaRow]
    let used: Int
}

struct AgendaWidgetView: View {
    let entry: AgendaEntry
    let style: AgendaStyle
    @Environment(\.widgetFamily) private var family

    private var now: Date { entry.date }
    /// Pozycje jeszcze niezakończone w chwili wpisu.
    private var items: [AgendaItem] { entry.snapshot.items.filter { $0.end > now } }

    private var header: WidgetHeader {
        let list = items
        let waiting = list.filter(\.attention).count
        if let attention = style.attention, waiting > 0 { return WidgetHeader(icon: style.icon, title: style.title, trailing: "\(waiting) \(attention)") }
        if style.counts && !list.isEmpty { return WidgetHeader(icon: style.icon, title: style.title, trailing: "\(list.count)") }
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
            } else {
                large
            }
        }
    }

    // MARK: Opisy czasu

    /// „Za 25 min · 14:00”, „Teraz · do 15:00”, „Dziś, 14:00”, „Jutro · cały dzień”.
    private func moment(_ item: AgendaItem) -> String {
        if item.ongoing(at: now) {
            if item.allDay { return "Dziś · cały dzień" }
            let until = WidgetTime.calendar.isDate(item.end, inSameDayAs: now)
                ? WidgetTime.clock.string(from: item.end)
                : WidgetTime.day(item.end.addingTimeInterval(-1), now: now)
            return "Teraz · do \(until)"
        }
        if style.countdown && !item.allDay,
           let soon = WidgetTime.countdown(to: item.start, now: now, limit: AgendaTimeline.nextCountdown, capitalized: true) {
            return "\(soon) · \(WidgetTime.clock.string(from: item.start))"
        }
        let day = WidgetTime.day(item.start, now: now)
        return item.allDay ? "\(day) · cały dzień" : "\(day), \(WidgetTime.clock.string(from: item.start))"
    }

    /// Godzina w wierszu: „14:00”, „Teraz”, „Cały dzień”.
    private func clock(_ item: AgendaItem) -> String {
        if item.allDay { return "Cały dzień" }
        return item.ongoing(at: now) ? "Teraz" : WidgetTime.clock.string(from: item.start)
    }

    /// Druga linia pod godziną: przypomnienie „za 25 min” (złote) albo dzień (średni widżet, pozycje nie na dziś).
    private func timeNote(_ item: AgendaItem, day: String?) -> (text: String, soon: Bool)? {
        if style.countdown && !item.allDay,
           let soon = WidgetTime.countdown(to: item.start, now: now, limit: AgendaTimeline.rowCountdown) {
            return (soon, true)
        }
        guard let day else { return nil }
        return (day, false)
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
                    Text(next.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    if let detail = next.detail {
                        Text(detail).font(.system(size: 10.5)).foregroundStyle(WidgetPalette.ink.opacity(0.6)).lineLimit(1)
                    }
                    if let badge = next.badge {
                        Text(badge).font(.system(size: 10, weight: .semibold)).foregroundStyle(WidgetPalette.gold).lineLimit(1)
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

    // MARK: Średni — najbliższe pozycje w całości

    private var medium: some View {
        VStack(alignment: .leading, spacing: WidgetLayout.headerSpacing) {
            header
            if items.isEmpty {
                Spacer(minLength: 0)
                empty
                Spacer(minLength: 0)
            } else {
                GeometryReader { geometry in
                    mediumList(height: geometry.size.height)
                }
            }
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: false)
        }
        .padding(WidgetLayout.inset(family))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mediumList(height: CGFloat) -> some View {
        let shown = Array(items.prefix(WidgetLayout.rows(in: height)))
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    WidgetDivider()
                }
                linked(item) { row(item, day: dayNote(item)) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Dzień pod godziną w średnim widżecie — dla pozycji, które nie są dziś (ani nie trwają).
    private func dayNote(_ item: AgendaItem) -> String? {
        if item.ongoing(at: now) || WidgetTime.calendar.isDate(item.start, inSameDayAs: now) { return nil }
        return WidgetTime.day(item.start, now: now)
    }

    // MARK: Duży i bardzo duży — terminarz z nagłówkami dni (bardzo duży — dwie kolumny)

    private var large: some View {
        VStack(alignment: .leading, spacing: WidgetLayout.headerSpacing) {
            header
            if items.isEmpty {
                Spacer(minLength: 0)
                empty
                Spacer(minLength: 0)
            } else {
                GeometryReader { geometry in
                    agendaColumns(height: geometry.size.height)
                }
            }
            WidgetFooter(state: entry.snapshot.state, updatedAt: entry.snapshot.updatedAt, showUpdated: true)
        }
        .padding(WidgetLayout.inset(family))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Kolumny terminarza z pozycjami w całości; gdy wszystkie się nie mieszczą — miejsce na „i N więcej…”.
    private func agendaColumns(height: CGFloat) -> some View {
        let list = items
        let count = WidgetLayout.columns(family)
        let first = layout(list, height: height, count: count)
        let columns = first.reduce(0, { $0 + $1.used }) < list.count ? layout(list, height: height - WidgetLayout.more, count: count) : first
        let rest = list.count - columns.reduce(0, { $0 + $1.used })
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: WidgetLayout.columnSpacing) {
                ForEach(0..<columns.count, id: \.self) { index in
                    agenda(columns[index].rows).frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            Spacer(minLength: 0)
            if rest > 0 {
                WidgetMore(count: rest)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Kolejne kolumny wypełniane po kolei pozycjami, które mieszczą się w `height`.
    private func layout(_ list: [AgendaItem], height: CGFloat, count: Int) -> [AgendaColumn] {
        var result: [AgendaColumn] = []
        var rest = list
        for _ in 0..<count {
            let column = fill(rest, height: height)
            result.append(column)
            rest = Array(rest.dropFirst(column.used))
        }
        return result
    }

    /// Nagłówki dni i pozycje mieszczące się w całości w `height` (nagłówek dnia — `dayHeader`, pozycja — `row`, kolejna pozycja
    /// tego samego dnia — także linia podziału).
    private func fill(_ list: [AgendaItem], height: CGFloat) -> AgendaColumn {
        var rows: [AgendaRow] = []
        var used: CGFloat = 0
        var count = 0
        var current: Date?
        for item in list {
            let day = WidgetTime.calendar.startOfDay(for: max(item.start, now))
            let newDay = day != current
            let cost = (newDay ? WidgetLayout.dayHeader : WidgetLayout.divider) + WidgetLayout.row
            if used + cost > height { break }
            if newDay {
                rows.append(.day(day))
                current = day
            }
            rows.append(.item(item))
            used += cost
            count += 1
        }
        return AgendaColumn(rows: rows, used: count)
    }

    private func agenda(_ rows: [AgendaRow]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, line in
                switch line {
                case .day(let day):
                    dayTitle(day)
                case .item(let item):
                    if index > 0 && rows[index - 1].isItem {
                        WidgetDivider()
                    }
                    linked(item) { row(item, day: nil) }
                }
            }
        }
    }

    private func dayTitle(_ day: Date) -> some View {
        Text(WidgetTime.dayTitle(day, now: now).uppercased()).font(.system(size: 9.5, weight: .semibold)).kerning(0.6)
            .foregroundStyle(WidgetPalette.gold.opacity(0.85)).lineLimit(1)
            .padding(.bottom, 2)
            .frame(maxWidth: .infinity, minHeight: WidgetLayout.dayHeader, maxHeight: WidgetLayout.dayHeader, alignment: .bottomLeading)
    }

    // MARK: Wiersz pozycji

    @ViewBuilder private func linked<Content: View>(_ item: AgendaItem, @ViewBuilder _ content: () -> Content) -> some View {
        if let link = item.link {
            Link(destination: link) { content() }
        } else {
            content()
        }
    }

    /// Wiersz o stałej wysokości: godzina (pod nią przypomnienie albo dzień), kolor pozycji, tytuł, wyróżnienie i szczegóły.
    private func row(_ item: AgendaItem, day: String?) -> some View {
        let note = timeNote(item, day: day)
        return HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(clock(item)).font(.system(size: 11, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(item.ongoing(at: now) ? WidgetPalette.gold : WidgetPalette.ink.opacity(0.8))
                if let note {
                    Text(note.text).font(.system(size: 9.5, weight: note.soon ? .semibold : .regular))
                        .foregroundStyle(note.soon ? WidgetPalette.gold : WidgetPalette.ink.opacity(0.5))
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .frame(width: 52, alignment: .leading)
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
        .frame(maxWidth: .infinity, minHeight: WidgetLayout.row, maxHeight: WidgetLayout.row, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var empty: some View {
        HStack(spacing: 8) {
            Image(systemName: entry.snapshot.state == .offline ? "wifi.slash" : (entry.snapshot.notice == nil ? "checkmark.seal" : "info.circle"))
                .font(.system(size: 18)).foregroundStyle(WidgetPalette.gold)
            Text(entry.snapshot.state == .offline ? "Brak połączenia z serwerem CRM." : (entry.snapshot.notice ?? style.empty))
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
