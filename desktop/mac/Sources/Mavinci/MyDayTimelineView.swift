import SwiftUI

// MARK: „Mój plan” — oś czasu dnia jak na dashboardzie CRM (`MyDayTimeline.tsx`) i w aplikacji mobilnej (`MyScheduleSection.tsx`):
// te same dane `get_employee_schedule` (wydarzenia, fazy, spotkania, kontakty w zapytaniach, zadania z terminem, oddzwonienia, nieobecności).

struct ScheduleItem: Identifiable, Equatable {
    let kind: String
    let itemID: String
    let title: String
    let subtitle: String
    let start: Date
    let end: Date
    let allDay: Bool
    let status: String
    let color: Color
    let url: String
    var id: String { "\(kind)-\(itemID)-\(start.timeIntervalSince1970)" }
    static let kinds: [String: (label: String, symbol: String)] = [
        "event": ("Wydarzenie", "calendar"), "phase": ("Faza wydarzenia", "square.stack.3d.up"), "meeting": ("Spotkanie", "person.2"),
        "inquiry": ("Kontakt w zapytaniu", "tray"), "task": ("Zadanie", "checklist"), "call": ("Oddzwonienie", "phone.arrow.up.right"), "absence": ("Nieobecność", "sun.max"),
    ]
    var kindLabel: String { Self.kinds[kind]?.label ?? "Pozycja" }
    var symbol: String { Self.kinds[kind]?.symbol ?? "circle" }
}

struct MyDayTimelineView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("timelineDays") private var days = 1
    @State private var hover: String?

    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.locale = Locale(identifier: "pl_PL"); c.timeZone = TimeZone(identifier: "Europe/Warsaw")!; return c }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let now = context.date
            let today = calendar.startOfDay(for: now)
            let items = scheduleItems
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Mój plan").font(.title3.weight(.light))
                        let count = items.filter { $0.start < calendar.date(byAdding: .day, value: 1, to: today)! && $0.end > today }.count
                        Text(count == 0 ? "Dziś nic nie zaplanowano" : "Dziś: \(count) \(count == 1 ? "pozycja" : count < 5 ? "pozycje" : "pozycji")").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Picker("Zakres", selection: $days) { Text("Dziś").tag(1); Text("3 dni").tag(3) }.pickerStyle(.segmented).labelsHidden().frame(width: 150)
                }
                if state.scheduleFailed && items.isEmpty { Text("Nie udało się pobrać planu. Odśwież (⌘R).").font(.callout).foregroundStyle(.secondary) }
                ForEach(0..<days, id: \.self) { offset in
                    let day = calendar.date(byAdding: .day, value: offset, to: today)!
                    dayRow(day: day, now: now, offset: offset, items: items)
                }
            }
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card.opacity(theme == .light ? 1 : 0.85), in: RoundedRectangle(cornerRadius: 12))
        }
        // Plan z dysku od razu; odświeża go synchronizacja obszaru roboczego (po dashboardzie).
        .task(id: state.employee?.id) { if state.scheduleRows == nil { await state.loadSchedule() } }
    }

    private func dayTitle(_ day: Date, offset: Int) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = calendar.timeZone; f.dateFormat = "d MMM"
        if offset == 0 { return "Dziś · \(f.string(from: day))" }
        if offset == 1 { return "Jutro · \(f.string(from: day))" }
        f.dateFormat = "EEEE · d MMM"; return f.string(from: day).capitalized
    }

    @ViewBuilder private func dayRow(day: Date, now: Date, offset: Int, items: [ScheduleItem]) -> some View {
        let next = calendar.date(byAdding: .day, value: 1, to: day)!
        let dayItems = items.filter { $0.start < next && $0.end > day }
        let allDay = dayItems.filter(\.allDay)
        let timed = dayItems.filter { !$0.allDay }
        // Zakres godzin: 8–18, poszerzony o pozycje dnia.
        let startHour = min(8, timed.map { max(0, calendar.component(.hour, from: max($0.start, day))) }.min() ?? 8)
        let endHour = max(18, timed.map { $0.end >= next ? 24 : calendar.component(.hour, from: $0.end) + (calendar.component(.minute, from: $0.end) > 0 ? 1 : 0) }.max() ?? 18)
        VStack(alignment: .leading, spacing: 8) {
            Text(dayTitle(day, offset: offset)).font(.callout.weight(offset == 0 ? .semibold : .regular)).foregroundStyle(offset == 0 ? theme.accent : .primary)
            if !allDay.isEmpty {
                HStack(spacing: 6) { ForEach(allDay) { item in chip(item, now: now) } }
            }
            if timed.isEmpty && allDay.isEmpty {
                Text("Nic nie zaplanowano").font(.caption).foregroundStyle(.secondary)
            } else if !timed.isEmpty {
                track(day: day, items: timed, startHour: startHour, endHour: min(24, endHour), now: now, isToday: offset == 0)
            }
        }
    }

    struct Placed: Identifiable { let item: ScheduleItem; let lane: Int; var id: String { item.id } }
    /// Nakładające się pozycje w kolejnych torach (jak oś czasu w CRM).
    private func lanes(_ items: [ScheduleItem]) -> [Placed] {
        var ends: [Date] = []
        return items.sorted { $0.start < $1.start }.map { item in
            if let lane = ends.firstIndex(where: { $0 <= item.start }) { ends[lane] = item.end; return Placed(item: item, lane: lane) }
            ends.append(item.end); return Placed(item: item, lane: ends.count - 1)
        }
    }

    private func track(day: Date, items: [ScheduleItem], startHour: Int, endHour: Int, now: Date, isToday: Bool) -> some View {
        let placed = lanes(items)
        let laneCount = (placed.map(\.lane).max() ?? 0) + 1
        let from = calendar.date(byAdding: .hour, value: startHour, to: day)!
        let to = calendar.date(byAdding: .hour, value: endHour, to: day)!
        let span = to.timeIntervalSince(from)
        let laneHeight: CGFloat = 46
        return GeometryReader { geo in
            let width = geo.size.width
            let x = { (date: Date) -> CGFloat in CGFloat(max(0, min(span, date.timeIntervalSince(from))) / span) * width }
            ZStack(alignment: .topLeading) {
                ForEach(startHour...endHour, id: \.self) { hour in
                    let position = CGFloat(hour - startHour) / CGFloat(max(1, endHour - startHour)) * width
                    Rectangle().fill(Color.primary.opacity(0.07)).frame(width: 1, height: CGFloat(laneCount) * laneHeight + 4).offset(x: position, y: 18)
                    if hour < endHour { Text(String(format: "%02d:00", hour)).font(.caption2).foregroundStyle(.secondary).offset(x: position + 3, y: 0) }
                }
                ForEach(placed) { entry in
                    let item = entry.item
                    let lane = entry.lane
                    let left = x(item.start)
                    let minimum = width * CGFloat(3600 / span) * 0.5
                    let blockWidth = max(minimum, x(item.end) - left)
                    Button { open(item) } label: {
                        HStack(spacing: 6) {
                            Rectangle().fill(item.color).frame(width: 3)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title).font(.caption.weight(.semibold)).lineLimit(1)
                                Text("\(time(item.start, day: day))–\(time(item.end, day: day)) · \(item.kindLabel)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.trailing, 6).frame(width: blockWidth, height: laneHeight - 6, alignment: .leading)
                        .background(item.color.opacity(hover == item.id ? 0.32 : 0.2), in: RoundedRectangle(cornerRadius: 6))
                        .opacity(item.end <= now ? 0.55 : 1)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .onHover { inside in hover = inside ? item.id : nil }
                    .help("\(item.kindLabel): \(item.title)\(item.subtitle.isEmpty ? "" : " — \(item.subtitle)")")
                    .offset(x: left, y: 20 + CGFloat(lane) * laneHeight)
                }
                if isToday, now >= from, now <= to {
                    Rectangle().fill(Color.red).frame(width: 2, height: CGFloat(laneCount) * laneHeight + 8).offset(x: x(now) - 1, y: 14)
                }
            }
        }
        .frame(height: CGFloat(laneCount) * laneHeight + 26)
    }

    private func chip(_ item: ScheduleItem, now: Date) -> some View {
        Button { open(item) } label: {
            Label(item.title, systemImage: item.symbol).font(.caption).lineLimit(1).padding(.horizontal, 8).padding(.vertical, 4)
                .background(item.color.opacity(0.2), in: Capsule())
        }.buttonStyle(.plain).help("\(item.kindLabel) · cały dzień")
    }

    private func time(_ date: Date, day: Date) -> String {
        if date < day { return "wcz." }
        if date >= calendar.date(byAdding: .day, value: 1, to: day)! { return "dalej" }
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = calendar.timeZone; f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    private func open(_ item: ScheduleItem) {
        switch item.kind {
        case "meeting":
            state.showMeeting(item.itemID)
        case "task": state.open(.tasks, id: item.itemID)
        case "inquiry": state.open(.inquiries, id: item.itemID)
        case "event", "phase":
            let parts = item.url.split(separator: "/").map(String.init)
            if let index = parts.firstIndex(of: "events"), index + 1 < parts.count {
                let id = String(parts[index + 1].split(separator: "?").first ?? "")
                if UUID(uuidString: id) != nil { state.showEvent(id); return }
            }
            if item.kind == "event", UUID(uuidString: item.itemID) != nil { state.showEvent(item.itemID) }
        case "call": if !item.url.isEmpty { state.openCRM(item.url) }
        default: break
        }
    }

    /// Pozycje planu z `get_employee_schedule` (kopia na dysku, odświeżana w tle przez obszar roboczy).
    private var scheduleItems: [ScheduleItem] {
        guard let rows = state.scheduleRows, let employeeID = state.employee?.id else { return [] }
        let parse = ISO8601DateFormatter(); parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        func date(_ raw: String) -> Date? { parse.date(from: raw) ?? plain.date(from: raw) }
        return rows.compactMap { row in
            guard row["employee_id"] == employeeID, ScheduleItem.kinds[row["kind"]] != nil, let start = date(row["starts_at"]), let end = date(row["ends_at"]) else { return nil }
            return ScheduleItem(kind: row["kind"], itemID: row["item_id"], title: row["title"].isEmpty ? (ScheduleItem.kinds[row["kind"]]?.label ?? "") : row["title"],
                                subtitle: row["subtitle"], start: start, end: max(end, start.addingTimeInterval(900)), allDay: row.fields["all_day"]?.flag == true,
                                status: row["status"], color: WorkspacePresentation.color(row["color"]) ?? CrmTheme.rgb(0xd3bb73), url: row["url"])
        }
    }
}
