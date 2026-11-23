import SwiftUI
import WidgetKit

// MARK: Widżety Mavinci — Mac (pulpit, Centrum powiadomień) oraz iPhone i iPad (ekran główny, ekran blokady)
//
// „Moje zadania” (prywatne i przypisane do Ciebie — jak tablica „Moje zadania”), „Zadania prywatne”, „Kalendarz” (plan na 7 dni —
// `WidgetCalendar.swift`), „Spotkania” (najbliższe spotkania z przypomnieniem „za 25 min” — `WidgetMeetings.swift`) i „Wydarzenia”
// (najbliższe eventy na 30 dni — `WidgetEvents.swift`). Rozmiary: mały, średni, duży i bardzo duży (listy pokazują tylko pozycje
// mieszczące się w całości, z liniami podziału — `WidgetLayout`);
// na iPhonie i iPadzie także ekran blokady (prostokątny i w linii). Kliknięcie pozycji otwiera ją w aplikacji (`mavinci://task/<id>`,
// na telefonie `mavinci-crm://…`), kliknięcie widżetu — sekcję. Odświeżanie: co 15 minut na Macu (na telefonie według budżetu
// systemu) i od razu po zmianach w aplikacji (Mac — `WidgetBridge.reload`, telefon — po wyjściu z aplikacji).
// Rozszerzenie `MavinciWidgets.appex`: Mac — `scripts/build-app.sh` (tylko z podpisem zespołu Mavinci), iPhone i iPad —
// `mobile/plugins/withMavinciWidgets.js` (EAS Build). Wspólne: `WidgetSupport.swift`, sesja — `FinderShared`.

@main
struct MavinciWidgetBundle: WidgetBundle {
    var body: some Widget {
        MyTasksWidget()
        PrivateTasksWidget()
        CalendarWidget()
        MeetingsWidget()
        EventsWidget()
    }
}

struct MyTasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pl.mavinci.widget.tasks", provider: TasksProvider(privateOnly: false)) { entry in
            TasksWidgetView(entry: entry, privateOnly: false)
        }
        .configurationDisplayName("Moje zadania")
        .description("Otwarte zadania z tablicy „Moje zadania” — prywatne i przypisane do Ciebie, z terminem i priorytetem.")
        .supportedFamilies(WidgetPlatform.families)
    }
}

struct PrivateTasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pl.mavinci.widget.private-tasks", provider: TasksProvider(privateOnly: true)) { entry in
            TasksWidgetView(entry: entry, privateOnly: true)
        }
        .configurationDisplayName("Zadania prywatne")
        .description("Twoje prywatne zadania z Mavinci — z terminem i priorytetem.")
        .supportedFamilies(WidgetPlatform.families)
    }
}

struct TasksProvider: TimelineProvider {
    let privateOnly: Bool

    func placeholder(in context: Context) -> TasksEntry { .sample(privateOnly: privateOnly) }

    func getSnapshot(in context: Context, completion: @escaping (TasksEntry) -> Void) {
        if context.isPreview { completion(.sample(privateOnly: privateOnly)); return }
        Task { completion(await WidgetTasksAPI.entry(privateOnly: privateOnly)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TasksEntry>) -> Void) {
        Task {
            let entry = await WidgetTasksAPI.entry(privateOnly: privateOnly)
            // Bez połączenia albo bez logowania — kolejna próba szybciej.
            let next = Date().addingTimeInterval(entry.state == .ready ? WidgetPlatform.refresh : WidgetPlatform.retry)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: Wygląd

/// „1 otwarte zadanie”, „3 otwarte zadania”, „5 otwartych zadań”.
private func openTasksLabel(_ count: Int) -> String {
    let lastTwo = count % 100
    let last = count % 10
    if count == 1 { return "otwarte zadanie" }
    if (2...4).contains(last) && !(12...14).contains(lastTwo) { return "otwarte zadania" }
    return "otwartych zadań"
}

struct TasksWidgetView: View {
    let entry: TasksEntry
    let privateOnly: Bool
    @Environment(\.widgetFamily) private var family

    private var title: String { privateOnly ? "Zadania prywatne" : "Moje zadania" }
    private var icon: String { privateOnly ? "lock.fill" : "checklist" }
    private var header: WidgetHeader { WidgetHeader(icon: icon, title: title, trailing: entry.total > 0 ? "\(entry.total)" : nil) }

    var body: some View {
        content
            .foregroundStyle(WidgetPalette.ink)
            .mavinciWidgetBackground()
            .widgetURL(WidgetPlatform.link("tasks"))
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
            if entry.state == .signedOut {
                WidgetMessage(header: header, icon: "person.crop.circle.badge.exclamationmark", text: WidgetPlatform.signedOutText)
            } else if family == .systemSmall {
                small
            } else {
                list
            }
        }
    }

    // MARK: Mały — liczba otwartych zadań i najbliższe

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            Spacer(minLength: 0)
            Text("\(entry.total)").font(.system(size: 34, weight: .semibold)).monospacedDigit().widgetAccentable()
            Text(openTasksLabel(entry.total)).font(.system(size: 11)).foregroundStyle(WidgetPalette.ink.opacity(0.6))
            if let first = entry.tasks.first {
                let due = WidgetDue.label(first.dueDate, now: entry.date)
                VStack(alignment: .leading, spacing: 1) {
                    Text(first.title).font(.system(size: 11, weight: .medium)).lineLimit(2)
                    if let due {
                        Text(due.text).font(.system(size: 10)).foregroundStyle(due.overdue ? WidgetPalette.overdue : WidgetPalette.ink.opacity(0.55))
                    }
                }
                .padding(.top, 2)
            }
            WidgetFooter(state: entry.state, updatedAt: entry.updatedAt, showUpdated: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Średni, duży i bardzo duży — zadania w całości, z liniami podziału (bardzo duży — dwie kolumny)

    private var list: some View {
        VStack(alignment: .leading, spacing: WidgetLayout.headerSpacing) {
            header
            if entry.tasks.isEmpty {
                Spacer(minLength: 0)
                emptyMessage
                Spacer(minLength: 0)
            } else {
                GeometryReader { geometry in
                    columns(height: geometry.size.height)
                }
            }
            if let timer = entry.timer {
                Label("Licznik: \(timer.title)", systemImage: "timer").font(.system(size: 10.5)).foregroundStyle(WidgetPalette.gold).lineLimit(1)
            }
            WidgetFooter(state: entry.state, updatedAt: entry.updatedAt, showUpdated: family == .systemLarge || family == .systemExtraLarge)
        }
        .padding(WidgetLayout.inset(family))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptyMessage: some View {
        HStack(spacing: 8) {
            Image(systemName: entry.state == .offline ? "wifi.slash" : "checkmark.seal")
                .font(.system(size: 18)).foregroundStyle(WidgetPalette.gold)
            Text(entry.state == .offline ? "Brak połączenia z serwerem CRM." : "Brak otwartych zadań — wszystko zrobione.")
                .font(.system(size: 12)).foregroundStyle(WidgetPalette.ink.opacity(0.75))
        }
    }

    /// Zadania, które mieszczą się w `height` w całości (kolumny po tyle samo wierszy); duży i bardzo duży — „i N więcej…”
    /// pod listą, średni — sam licznik w nagłówku.
    private func columns(height: CGFloat) -> some View {
        let count = WidgetLayout.columns(family)
        let total = max(entry.total, entry.tasks.count)
        let full = WidgetLayout.rows(in: height)
        let showsMore = family != .systemMedium && total > full * count
        let perColumn = showsMore ? WidgetLayout.rows(in: height - WidgetLayout.more) : full
        let shown = Array(entry.tasks.prefix(perColumn * count))
        let rest = total - shown.count
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: WidgetLayout.columnSpacing) {
                ForEach(0..<count, id: \.self) { column in
                    taskColumn(Array(shown.dropFirst(column * perColumn).prefix(perColumn)))
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            Spacer(minLength: 0)
            if showsMore && rest > 0 {
                WidgetMore(count: rest)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func taskColumn(_ tasks: [WidgetTask]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                if index > 0 {
                    WidgetDivider()
                }
                linked(task)
            }
        }
    }

    @ViewBuilder private func linked(_ task: WidgetTask) -> some View {
        if let url = WidgetPlatform.link("task", task.id) {
            Link(destination: url) { row(task) }
        } else {
            row(task)
        }
    }

    /// Wiersz zadania o stałej wysokości: priorytet, tytuł, termin („po terminie” na czerwono), kolumna tablicy, kłódka.
    private func row(_ task: WidgetTask) -> some View {
        let due = WidgetDue.label(task.dueDate, now: entry.date)
        let column: String? = task.column == "in_progress" ? "W trakcie" : (task.column == "review" ? "Do sprawdzenia" : nil)
        let locked = !privateOnly && task.isPrivate
        return HStack(alignment: .top, spacing: 8) {
            Circle().fill(WidgetPalette.priority(task.priority)).frame(width: 7, height: 7).padding(.top, 5)
            VStack(alignment: .leading, spacing: 1) {
                Text(task.title).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                if due != nil || column != nil || locked {
                    HStack(spacing: 6) {
                        if let due {
                            Label(due.text, systemImage: due.overdue ? "exclamationmark.circle" : "calendar")
                                .foregroundStyle(due.overdue ? WidgetPalette.overdue : WidgetPalette.ink.opacity(0.55))
                        }
                        if let column {
                            Text(column).foregroundStyle(WidgetPalette.gold.opacity(task.column == "review" ? 0.8 : 1))
                        }
                        if locked {
                            Image(systemName: "lock.fill").foregroundStyle(WidgetPalette.ink.opacity(0.4))
                        }
                    }
                    .font(.system(size: 10.5))
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: WidgetLayout.row, maxHeight: WidgetLayout.row, alignment: .leading)
        .contentShape(Rectangle())
    }

    // MARK: Ekran blokady (iPhone, iPad)

    #if os(iOS)
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.state == .signedOut {
                Label(title, systemImage: icon).font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text("Zaloguj się w aplikacji Mavinci").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
            } else {
                Label("\(entry.total) \(openTasksLabel(entry.total))", systemImage: icon).font(.system(size: 12, weight: .semibold))
                    .lineLimit(1).widgetAccentable()
                if let first = entry.tasks.first {
                    Text(first.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    if let due = WidgetDue.label(first.dueDate, now: entry.date) {
                        Text(due.text).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    Text(entry.state == .offline ? "Bez połączenia" : "Wszystko zrobione").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var inline: some View {
        if entry.state == .signedOut {
            Label("Mavinci — zaloguj się", systemImage: icon)
        } else if let first = entry.tasks.first {
            Label("\(entry.total) · \(first.title)", systemImage: icon)
        } else {
            Label("Brak otwartych zadań", systemImage: icon)
        }
    }
    #endif
}
