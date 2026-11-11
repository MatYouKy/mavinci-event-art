import SwiftUI

// MARK: Plan pracownika i oś czasu zespołu — dane `get_employee_schedule` jak `EmployeeScheduleCalendar` (dzień / tydzień,
// godziny od góry, pasek „cały dzień”) i `EmployeesTimelineView` (wiersze pracowników, dzień / tydzień / miesiąc).

extension Workspace {
    /// Pozycja planu: spotkanie, zadanie, zapytanie, wydarzenie lub faza; pozostałe — CRM.
    func openScheduleItem(_ item: ScheduleItem) {
        switch item.kind {
        case "meeting": showMeeting(item.itemID)
        case "task": open(.tasks, id: item.itemID)
        case "inquiry": open(.inquiries, id: item.itemID)
        case "event", "phase":
            let parts = item.url.split(separator: "/").map(String.init)
            if let index = parts.firstIndex(of: "events"), index + 1 < parts.count {
                let id = String(parts[index + 1].split(separator: "?").first ?? "")
                if UUID(uuidString: id) != nil { showEvent(id); return }
            }
            if item.kind == "event", UUID(uuidString: item.itemID) != nil { showEvent(item.itemID) }
        default:
            if !item.url.isEmpty { openCRM(item.url) }
        }
    }
}

/// Filtry grup planu (wspólne dla planu pracownika i osi zespołu).
struct ScheduleGroupFilter: View {
    @Binding var groups: Set<ScheduleGroup>
    var body: some View {
        HStack(spacing: 6) {
            ForEach(ScheduleGroup.allCases) { group in
                Toggle(isOn: Binding(get: { groups.contains(group) }, set: { on in if on { groups.insert(group) } else { groups.remove(group) } })) {
                    Label { Text(group.label) } icon: { Image(systemName: "circle.fill").foregroundStyle(group.color) }
                }
                .toggleStyle(.button)
            }
        }
    }
}

enum ScheduleFormat {
    static func tooltip(_ item: ScheduleItem) -> String {
        var parts = ["\(item.kindLabel): \(item.title)"]
        if !item.subtitle.isEmpty { parts.append(item.subtitle) }
        parts.append(item.allDay ? "Cały dzień" : "\(MeetingDates.time(item.start))–\(MeetingDates.time(item.end))")
        return parts.joined(separator: "\n")
    }
    static func visible(_ items: [ScheduleItem], _ groups: Set<ScheduleGroup>) -> [ScheduleItem] {
        items.filter { item in groups.contains { $0.kinds.contains(item.kind) } }
    }
}

// MARK: Plan pracownika (dzień / tydzień)

struct ScheduleDayBlock: Identifiable {
    let item: ScheduleItem
    let start: Date
    let end: Date
    var column: Int
    var columns: Int
    var id: String { item.id }

    /// Nakładające się pozycje obok siebie (jak `layoutDay` w CRM), minimum 30 min wysokości.
    static func layout(_ items: [ScheduleItem], dayStart: Date, dayEnd: Date) -> [ScheduleDayBlock] {
        let sorted = items.map { item -> (ScheduleItem, Date, Date) in
            let s = max(item.start, dayStart)
            var e = min(item.end, dayEnd)
            if e.timeIntervalSince(s) < 1800 { e = s.addingTimeInterval(1800) }
            return (item, s, e)
        }.sorted { $0.1 < $1.1 }
        var result: [ScheduleDayBlock] = []
        var cluster: [Int] = []
        var clusterEnd = Date.distantPast
        var columnEnds: [Date] = []
        for (item, s, e) in sorted {
            if !cluster.isEmpty && s >= clusterEnd {
                for index in cluster { result[index].columns = columnEnds.count }
                cluster = []; columnEnds = []
            }
            var column = columnEnds.firstIndex(where: { $0 <= s }) ?? -1
            if column < 0 { columnEnds.append(e); column = columnEnds.count - 1 } else { columnEnds[column] = e }
            result.append(ScheduleDayBlock(item: item, start: s, end: e, column: column, columns: 1))
            cluster.append(result.count - 1)
            clusterEnd = max(clusterEnd, e)
        }
        for index in cluster { result[index].columns = max(1, columnEnds.count) }
        return result
    }
}

@MainActor struct EmployeeScheduleGrid: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let defaultWeek: Bool
    let storageKey: String
    var initialDate: Date?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var chosenWeek: Bool?
    @State private var anchor = MeetingDates.calendar.startOfDay(for: Date())
    @State private var groups = Set(ScheduleGroup.allCases)
    @State private var items: [ScheduleItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var prepared = false

    private let hourHeight: CGFloat = 44
    private let gutter: CGFloat = 52
    private var calendar: Calendar { MeetingDates.calendar }
    private var isWeek: Bool { chosenWeek ?? defaultWeek }
    private var days: [Date] {
        if !isWeek { return [anchor] }
        let monday = MeetingDates.startOfWeek(anchor)
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
    }
    private var rangeKey: String { "\(employeeID)|\(days.first?.timeIntervalSince1970 ?? 0)|\(isWeek)" }
    private var shown: [ScheduleItem] { ScheduleFormat.visible(items, groups) }
    private var title: String {
        guard let first = days.first, let last = days.last else { return "" }
        if !isWeek { return MeetingDates.format(first, "EEEE, d MMMM yyyy").capitalized }
        return "\(MeetingDates.format(first, "d MMM")) – \(MeetingDates.format(last, "d MMM yyyy"))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            toolbar
            if let error { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
            grid
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .onAppear {
            guard !prepared else { return }
            prepared = true
            if let initialDate { anchor = calendar.startOfDay(for: initialDate) }
            if let saved = UserDefaults.standard.string(forKey: storageKey) { chosenWeek = saved == "week" }
        }
        .task(id: rangeKey) { await load() }
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Picker("Widok", selection: Binding(get: { isWeek }, set: { week in
                chosenWeek = week; UserDefaults.standard.set(week ? "week" : "day", forKey: storageKey)
            })) {
                Text("Dzień").tag(false); Text("Tydzień").tag(true)
            }.pickerStyle(.segmented).labelsHidden().fixedSize()
            Button { shift(-1) } label: { Image(systemName: "chevron.left") }.help(isWeek ? "Poprzedni tydzień" : "Poprzedni dzień")
            Button("Dziś") { anchor = calendar.startOfDay(for: Date()) }
            Button { shift(1) } label: { Image(systemName: "chevron.right") }.help(isWeek ? "Następny tydzień" : "Następny dzień")
            Text(title).font(.callout.weight(.semibold))
            if loading { ProgressView().controlSize(.small) }
            Spacer(minLength: 8)
            ScheduleGroupFilter(groups: $groups)
        }
        .controlSize(.small)
    }

    private func shift(_ direction: Int) {
        anchor = calendar.date(byAdding: .day, value: direction * (isWeek ? 7 : 1), to: anchor) ?? anchor
    }

    private func load() async {
        guard let first = days.first, let last = days.last, let end = calendar.date(byAdding: .day, value: 1, to: last) else { return }
        loading = true
        do {
            let entries = try await store.schedule([employeeID], from: first, to: end)
            guard !Task.isCancelled else { return }
            items = entries.map(\.item); error = nil
        } catch {
            if !Task.isCancelled { self.error = store.failureText(error, "Nie udało się wczytać planu.") }
        }
        loading = false
    }

    private var grid: some View {
        VStack(spacing: 0) {
            dayHeaders
            allDayStrip
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        hoursGrid(now: context.date)
                    }
                }
                .frame(height: 480)
                .onAppear { proxy.scrollTo("hour-7", anchor: .top) }
            }
        }
    }

    private var dayHeaders: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutter, height: 1)
            ForEach(days, id: \.self) { day in
                let today = calendar.isDateInToday(day)
                VStack(spacing: 1) {
                    Text(MeetingDates.format(day, "EEE").capitalized).font(.caption2).foregroundStyle(.secondary)
                    Text(MeetingDates.format(day, "d")).font(.callout.weight(today ? .bold : .regular))
                        .foregroundStyle(today ? theme.accent : .primary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.bottom, 4)
    }

    private var allDayStrip: some View {
        let allDay = shown.filter { $0.allDay || $0.end.timeIntervalSince($0.start) >= 20 * 3600 }
        return HStack(alignment: .top, spacing: 0) {
            Text("Cały dzień").font(.caption2).foregroundStyle(.secondary).frame(width: gutter, alignment: .leading)
            ForEach(days, id: \.self) { day in
                let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                VStack(spacing: 2) {
                    ForEach(allDay.filter { $0.start < next && $0.end > day }) { item in
                        Button { state.openScheduleItem(item) } label: {
                            Text(item.title).font(.caption2.weight(.medium)).lineLimit(1).padding(.horizontal, 5).padding(.vertical, 2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(item.color.opacity(0.28), in: RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain).help(ScheduleFormat.tooltip(item))
                    }
                }
                .padding(.horizontal, 1)
                .frame(maxWidth: .infinity, minHeight: 18, alignment: .top)
            }
        }
        .padding(.bottom, 4)
    }

    private func hoursGrid(now: Date) -> some View {
        let timed = shown.filter { !$0.allDay && $0.end.timeIntervalSince($0.start) < 20 * 3600 }
        return HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 0) {
                ForEach(0..<24, id: \.self) { hour in
                    Text(String(format: "%02d:00", hour)).font(.caption2).foregroundStyle(.secondary)
                        .frame(width: gutter, height: hourHeight, alignment: .topLeading).id("hour-\(hour)")
                }
            }
            ForEach(days, id: \.self) { day in dayColumn(day, items: timed, now: now) }
        }
        .frame(height: hourHeight * 24)
    }

    private func dayColumn(_ day: Date, items: [ScheduleItem], now: Date) -> some View {
        let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
        let blocks = ScheduleDayBlock.layout(items.filter { $0.start < next && $0.end > day }, dayStart: day, dayEnd: next)
        let today = calendar.isDate(day, inSameDayAs: now)
        return GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .topLeading) {
                ForEach(0..<24, id: \.self) { hour in
                    Rectangle().fill(Color.primary.opacity(0.06)).frame(width: width, height: 1).offset(y: CGFloat(hour) * hourHeight)
                }
                Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1, height: hourHeight * 24)
                ForEach(blocks) { block in blockView(block, day: day, width: width, now: now) }
                if today {
                    Rectangle().fill(Color.red).frame(width: width, height: 2).offset(y: y(now, day: day) - 1)
                }
            }
        }
        .background(today ? theme.accent.opacity(0.04) : Color.clear)
    }

    private func y(_ date: Date, day: Date) -> CGFloat { CGFloat(date.timeIntervalSince(day) / 3600) * hourHeight }

    private func blockView(_ block: ScheduleDayBlock, day: Date, width: CGFloat, now: Date) -> some View {
        let columnWidth = (width - 4) / CGFloat(max(1, block.columns))
        let top = y(block.start, day: day)
        let height = max(18, y(block.end, day: day) - top - 2)
        let item = block.item
        return Button { state.openScheduleItem(item) } label: {
            HStack(spacing: 4) {
                Rectangle().fill(item.color).frame(width: 3)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title).font(.caption2.weight(.semibold)).lineLimit(height > 34 ? 2 : 1)
                    if height > 30 { Text("\(MeetingDates.time(item.start))–\(MeetingDates.time(item.end))").font(.system(size: 9)).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            .frame(width: max(10, columnWidth - 2), height: height, alignment: .topLeading)
            .background(item.color.opacity(0.22), in: RoundedRectangle(cornerRadius: 5))
            .opacity(item.end <= now ? 0.55 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(ScheduleFormat.tooltip(item))
        .offset(x: 2 + CGFloat(block.column) * columnWidth, y: top + 1)
    }
}

// MARK: Oś czasu zespołu (administrator)

enum TeamZoom: String, CaseIterable, Identifiable {
    case month, week, day
    var id: String { rawValue }
    var label: String { self == .month ? "Miesiąc" : self == .week ? "Tydzień" : "Dzień" }
}

/// Pozycja na osi: pojedyncza albo (miesiąc) krótkie pozycje jednego dnia zebrane w komórkę dnia.
struct TeamTimelineEntry: Identifiable {
    let id: String
    let start: Date
    let end: Date
    let items: [ScheduleItem]
    let day: Date?
    var lane = 0
}

@MainActor struct TeamTimelineView: View {
    @ObservedObject var store: TeamStore
    let members: [TeamMember]
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("team.timeline.zoom") private var zoom: TeamZoom = .week
    @State private var anchor = MeetingDates.calendar.startOfDay(for: Date())
    @State private var groups = Set(ScheduleGroup.allCases)
    @State private var entries: [TeamScheduleEntry] = []
    @State private var loading = false
    @State private var error: String?

    private let labelWidth: CGFloat = 210
    private let laneHeight: CGFloat = 28
    private var calendar: Calendar { MeetingDates.calendar }
    private var range: (start: Date, end: Date) {
        switch zoom {
        case .day: return (anchor, calendar.date(byAdding: .day, value: 1, to: anchor) ?? anchor)
        case .week:
            let monday = MeetingDates.startOfWeek(anchor)
            return (monday, calendar.date(byAdding: .day, value: 7, to: monday) ?? monday)
        case .month:
            let first = calendar.date(from: calendar.dateComponents([.year, .month], from: anchor)) ?? anchor
            return (first, calendar.date(byAdding: .month, value: 1, to: first) ?? first)
        }
    }
    private var loadKey: String { "\(zoom.rawValue)|\(range.start.timeIntervalSince1970)|\(members.map(\.id).joined(separator: ","))" }
    private var title: String {
        switch zoom {
        case .day: return MeetingDates.format(range.start, "EEEE, d MMMM yyyy").capitalized
        case .week:
            let last = calendar.date(byAdding: .day, value: 6, to: range.start) ?? range.start
            return "\(MeetingDates.format(range.start, "d MMM")) – \(MeetingDates.format(last, "d MMM yyyy"))"
        case .month: return MeetingDates.format(range.start, "LLLL yyyy").capitalized
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            controls
            if let error { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).padding(.horizontal, 14) }
            GeometryReader { geo in
                let trackWidth = max(200, geo.size.width - labelWidth - 28)
                ScrollView(.vertical) {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        LazyVStack(alignment: .leading, spacing: 4, pinnedViews: [.sectionHeaders]) {
                            Section {
                                ForEach(members) { member in row(member, width: trackWidth, now: context.date) }
                            } header: {
                                scale(width: trackWidth).background(theme.page)
                            }
                        }
                        .padding(.horizontal, 14).padding(.bottom, 10)
                    }
                }
            }
        }
        .task(id: loadKey) { await load() }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Picker("Powiększenie", selection: $zoom) { ForEach(TeamZoom.allCases) { Text($0.label).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            Button { shift(-1) } label: { Image(systemName: "chevron.left") }
            Button("Dziś") { anchor = calendar.startOfDay(for: Date()) }
            Button { shift(1) } label: { Image(systemName: "chevron.right") }
            Text(title).font(.callout.weight(.semibold))
            if loading { ProgressView().controlSize(.small) }
            Spacer(minLength: 8)
            ScheduleGroupFilter(groups: $groups)
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.bottom, 8)
    }

    private func shift(_ direction: Int) {
        switch zoom {
        case .day: anchor = calendar.date(byAdding: .day, value: direction, to: anchor) ?? anchor
        case .week: anchor = calendar.date(byAdding: .day, value: 7 * direction, to: anchor) ?? anchor
        case .month: anchor = calendar.date(byAdding: .month, value: direction, to: anchor) ?? anchor
        }
    }

    private func load() async {
        let ids = Array(members.map(\.id).prefix(300))
        guard !ids.isEmpty else { entries = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        loading = true
        do {
            let next = try await store.schedule(ids, from: range.start, to: range.end)
            guard !Task.isCancelled else { return }
            entries = next; error = nil
        } catch {
            if !Task.isCancelled { self.error = store.failureText(error, "Nie udało się wczytać planu zespołu.") }
        }
        loading = false
    }

    // MARK: Podziałka
    private func x(_ date: Date, width: CGFloat) -> CGFloat {
        let span = range.end.timeIntervalSince(range.start)
        return CGFloat(max(0, min(span, date.timeIntervalSince(range.start))) / span) * width
    }
    private var ticks: [(date: Date, label: String, strong: Bool)] {
        var result: [(date: Date, label: String, strong: Bool)] = []
        switch zoom {
        case .day:
            for hour in 0..<24 {
                guard let date = calendar.date(byAdding: .hour, value: hour, to: range.start) else { continue }
                result.append((date, hour % 2 == 0 ? String(format: "%02d", hour) : "", hour % 6 == 0))
            }
        case .week:
            for offset in 0..<7 {
                guard let date = calendar.date(byAdding: .day, value: offset, to: range.start) else { continue }
                result.append((date, MeetingDates.format(date, "EEE d.MM").capitalized, true))
            }
        case .month:
            var date = range.start
            while date < range.end {
                result.append((date, MeetingDates.format(date, "d"), calendar.component(.weekday, from: date) == 2))
                date = calendar.date(byAdding: .day, value: 1, to: date) ?? range.end
            }
        }
        return result
    }

    private func scale(width: CGFloat) -> some View {
        HStack(spacing: 0) {
            Text("Pracownik").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: labelWidth, alignment: .leading)
            ZStack(alignment: .topLeading) {
                ForEach(Array(ticks.enumerated()), id: \.offset) { _, tick in
                    Text(tick.label).font(.caption2.weight(tick.strong ? .semibold : .regular)).foregroundStyle(.secondary)
                        .lineLimit(1).fixedSize().offset(x: x(tick.date, width: width) + 3)
                }
            }
            .frame(width: width, height: 18, alignment: .topLeading)
            .clipped()
        }
        .padding(.vertical, 6)
    }

    // MARK: Wiersze pracowników
    private func timelineEntries(for member: TeamMember) -> [TeamTimelineEntry] {
        let items = ScheduleFormat.visible(entries.filter { $0.employeeId == member.id }.map(\.item), groups)
        var list: [TeamTimelineEntry] = []
        if zoom == .month {
            var byDay: [Date: [ScheduleItem]] = [:]
            for item in items {
                if item.allDay || item.end.timeIntervalSince(item.start) >= 20 * 3600 {
                    list.append(TeamTimelineEntry(id: item.id, start: item.start, end: item.end, items: [item], day: nil))
                } else {
                    byDay[calendar.startOfDay(for: item.start), default: []].append(item)
                }
            }
            for (day, dayItems) in byDay {
                let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                list.append(TeamTimelineEntry(id: "day-\(member.id)-\(day.timeIntervalSince1970)", start: day, end: next,
                                              items: dayItems.sorted { $0.start < $1.start }, day: day))
            }
        } else {
            list = items.map { TeamTimelineEntry(id: $0.id, start: $0.start, end: $0.end, items: [$0], day: nil) }
        }
        // Tory: pozycje nakładające się (z minimalną szerokością na osi) w kolejnych wierszach.
        let minimum = range.end.timeIntervalSince(range.start) * 0.035
        var ends: [Date] = []
        return list.sorted { $0.start < $1.start }.map { entry -> TeamTimelineEntry in
            var placed = entry
            let end = max(entry.end, entry.start.addingTimeInterval(minimum))
            if let lane = ends.firstIndex(where: { $0 <= entry.start }) { ends[lane] = end; placed.lane = lane }
            else { ends.append(end); placed.lane = ends.count - 1 }
            return placed
        }
    }

    private func row(_ member: TeamMember, width: CGFloat, now: Date) -> some View {
        let placed = timelineEntries(for: member)
        let lanes = (placed.map(\.lane).max() ?? -1) + 1
        let height = max(52, CGFloat(lanes) * laneHeight + 12)
        let count = placed.reduce(0) { $0 + $1.items.count }
        let caption = placed.isEmpty ? member.subtitle : "\(count) poz."
        return HStack(spacing: 0) {
            Button {
                store.openedTab = .timeline; store.openedDate = zoom == .day ? range.start : nil; store.openedID = member.id
            } label: {
                HStack(spacing: 8) {
                    TeamAvatar(member: member, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(member.listName).font(.callout.weight(.medium)).lineLimit(1)
                        Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(width: labelWidth, alignment: .leading)
            .help("Otwórz plan: \(member.fullName)")
            track(placed, width: width, height: height, now: now)
        }
        .padding(.vertical, 3).padding(.horizontal, 6)
        .background(theme.card.opacity(theme == .light ? 1 : 0.7), in: RoundedRectangle(cornerRadius: 8))
    }

    private func track(_ placed: [TeamTimelineEntry], width: CGFloat, height: CGFloat, now: Date) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(ticks.enumerated()), id: \.offset) { _, tick in
                Rectangle().fill(Color.primary.opacity(tick.strong ? 0.09 : 0.04)).frame(width: 1, height: height).offset(x: x(tick.date, width: width))
            }
            ForEach(placed) { entry in bar(entry, width: width) }
            if now >= range.start && now < range.end {
                Rectangle().fill(Color.red).frame(width: 2, height: height).offset(x: x(now, width: width) - 1)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .clipped()
    }

    private func bar(_ entry: TeamTimelineEntry, width: CGFloat) -> some View {
        let left = x(entry.start, width: width)
        let barWidth = max(24, x(entry.end, width: width) - left - 1)
        let first = entry.items[0]
        let label = entry.items.count > 1 ? "\(entry.items.count) poz." : first.title
        let color = entry.items.count > 1 ? Color.secondary : first.color
        return Button {
            if let day = entry.day, entry.items.count > 1 { zoom = .day; anchor = day } else { state.openScheduleItem(first) }
        } label: {
            HStack(spacing: 3) {
                Rectangle().fill(color).frame(width: 3)
                Text(label).font(.caption2.weight(.medium)).lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(width: barWidth, height: laneHeight - 4, alignment: .leading)
            .background(color.opacity(0.24), in: RoundedRectangle(cornerRadius: 4))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(entry.items.map(ScheduleFormat.tooltip).joined(separator: "\n\n"))
        .offset(x: left, y: 6 + CGFloat(entry.lane) * laneHeight)
    }
}
