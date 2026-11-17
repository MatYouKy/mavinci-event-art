import SwiftUI

// MARK: Oś czasu floty — `VehicleSingleTimeline` (karta pojazdu) i `VehiclesTimelineView` (lista): zakres jak
// `getFleetTimelineScale` (dzień: 7 dni, tydzień: 28, miesiąc: 90), nawigacja, „Dzisiaj”, linia dnia dzisiejszego, wydarzenia
// w granicach harmonogramu (`event_timeline_bounds`) i serwis. Kliknięcie wydarzenia otwiera jego kartę.

@MainActor struct FleetTimelineView: View {
    @ObservedObject var store: FleetStore
    /// `nil` — wszystkie pojazdy (wiersz na pojazd).
    let vehicleID: String?
    /// Pojazdy przefiltrowane na liście (szukaj, status, kategoria); `nil` — wszystkie.
    let visibleIDs: Set<String>?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("fleet.timeline.zoom") private var zoom = "week"
    @State private var anchor = Date()
    @State private var data: FleetTimelineData?
    @State private var loading = false
    @State private var problem: String?

    private static let names = ["day": "Dzień", "week": "Tydzień", "month": "Miesiąc"]
    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = MeetingDates.zone; c.locale = Locale(identifier: "pl_PL"); return c }

    /// Zakres widoku jak `getFleetTimelineScale`.
    private func scale(_ level: String) -> (start: Date, end: Date, days: Int, column: CGFloat) {
        let before = level == "day" ? 3 : level == "week" ? 14 : 30
        let days = level == "day" ? 7 : level == "week" ? 28 : 90
        let column: CGFloat = level == "day" ? 120 : level == "week" ? 60 : 30
        let start = calendar.date(byAdding: .day, value: -before, to: calendar.startOfDay(for: anchor)) ?? anchor
        let end = calendar.date(byAdding: .day, value: days, to: start) ?? anchor
        return (start, end, days, column)
    }

    /// Lista pobiera zawsze najszerszy zakres (miesiąc) — lupa zmienia tylko skalę, bez ponownego wczytywania (jak CRM).
    private var fetchKey: String {
        let range = vehicleID == nil ? scale("month") : scale(zoom)
        return "\(vehicleID ?? "all")|\(DayDates.string(range.start))|\(DayDates.string(range.end))"
    }

    private var rows: [FleetTimelineVehicle] {
        (data?.vehicles ?? []).filter { visibleIDs?.contains($0.id) ?? true }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if loading && data == nil {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            } else if let problem, data == nil {
                ContentUnavailableView {
                    Label("Timeline", systemImage: "chart.line.uptrend.xyaxis")
                } description: { Text(problem) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
            } else {
                GeometryReader { geo in grid(available: geo.size.width) }
                    .frame(minHeight: vehicleID == nil ? 260 : 240)
            }
            legend
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
        .task(id: fetchKey) { await load() }
    }

    private func load() async {
        let range = vehicleID == nil ? scale("month") : scale(zoom)
        loading = true
        defer { loading = false }
        do {
            data = try await store.timeline(vehicleID: vehicleID, from: range.start, to: range.end)
            problem = nil
        } catch {
            problem = store.failureText(error, "Błąd podczas ładowania timeline")
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(vehicleID == nil ? "Timeline wykorzystania pojazdów" : "Timeline wykorzystania").font(.headline)
                Text(vehicleID == nil ? "Widok wykorzystania \(rows.count) pojazdów" : "Widok wykorzystania pojazdu na wydarzeniach i w serwisie")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if loading && data != nil { ProgressView().controlSize(.small) }
            HStack(spacing: 4) {
                Button { move(-1) } label: { Image(systemName: "chevron.left") }.help("Poprzedni okres")
                Button("Dzisiaj") { anchor = Date() }
                Button { move(1) } label: { Image(systemName: "chevron.right") }.help("Następny okres")
            }
            Picker("Skala", selection: $zoom) {
                ForEach(["day", "week", "month"], id: \.self) { Text(Self.names[$0] ?? $0).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
    }

    private func move(_ direction: Int) {
        switch zoom {
        case "day": anchor = calendar.date(byAdding: .day, value: 7 * direction, to: anchor) ?? anchor
        case "week": anchor = calendar.date(byAdding: .day, value: 28 * direction, to: anchor) ?? anchor
        default: anchor = calendar.date(byAdding: .month, value: 3 * direction, to: anchor) ?? anchor
        }
    }

    // MARK: Siatka

    private func grid(available: CGFloat) -> some View {
        let s = scale(zoom)
        let names: CGFloat = vehicleID == nil ? 220 : 0
        let total = max(CGFloat(s.days) * s.column, available - names)
        let column = total / CGFloat(s.days)
        let columns = (0..<s.days).compactMap { calendar.date(byAdding: .day, value: $0, to: s.start) }
        return ScrollView(.vertical) {
            HStack(alignment: .top, spacing: 0) {
                if vehicleID == nil {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Pojazdy").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(height: 44, alignment: .center).padding(.leading, 10)
                        Divider()
                        ForEach(rows) { vehicle in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(vehicle.name).font(.callout.weight(.medium)).lineLimit(1)
                                Text(vehicle.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            .padding(.horizontal, 10).frame(width: names, height: 56, alignment: .leading)
                            .contentShape(Rectangle())
                            .onTapGesture { store.openedTab = .timeline; store.openedID = vehicle.id }
                            .help("Otwórz kartę pojazdu")
                            Divider()
                        }
                    }
                    .frame(width: names)
                    Divider()
                }
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 0) {
                        dateHeader(columns, column: column)
                        Divider()
                        if vehicleID == nil {
                            if rows.isEmpty {
                                Text("Brak pojazdów do wyświetlenia").foregroundStyle(.secondary).frame(width: total, height: 80)
                            }
                            ForEach(rows) { vehicle in
                                lane(vehicle.entries, columns: columns, column: column, total: total, scale: s, stacked: false)
                                    .frame(width: total, height: 56)
                                Divider()
                            }
                        } else {
                            let entries = rows.first?.entries ?? []
                            lane(entries, columns: columns, column: column, total: total, scale: s, stacked: true)
                                .frame(width: total, height: 200)
                                .overlay {
                                    if entries.isEmpty { Text("Brak wydarzeń w wybranym okresie czasu").foregroundStyle(.secondary) }
                                }
                        }
                    }
                    .frame(width: total)
                }
            }
        }
    }

    private func dateHeader(_ columns: [Date], column: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(columns, id: \.self) { date in
                VStack(spacing: 1) {
                    Text(MeetingDates.format(date, "d MMM")).font(.caption.weight(.medium))
                    Text(MeetingDates.format(date, "EEE")).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(width: column, height: 44)
                .background(calendar.isDateInToday(date) ? theme.accent.opacity(0.2) : Color.clear)
                .overlay(alignment: .trailing) { Rectangle().fill(theme.accent.opacity(0.1)).frame(width: 1) }
            }
        }
    }

    private func lane(_ entries: [FleetTimelineEntry], columns: [Date], column: CGFloat, total: CGFloat,
                      scale s: (start: Date, end: Date, days: Int, column: CGFloat), stacked: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(columns, id: \.self) { date in
                    Rectangle().fill(calendar.isDateInToday(date) ? theme.accent.opacity(0.06) : Color.clear).frame(width: column)
                        .overlay(alignment: .trailing) { Rectangle().fill(theme.accent.opacity(0.06)).frame(width: 1) }
                }
            }
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                if let start = MeetingDates.parse(entry.start), let span = position(start, MeetingDates.parse(entry.end) ?? start, scale: s, total: total, column: column) {
                    bar(entry, width: span.size)
                        .frame(width: span.size, height: stacked ? 48 : 40)
                        .offset(x: span.offset, y: stacked ? CGFloat(20 + (index % 3) * 60) : 8)
                }
            }
            if let now = position(Date(), Date().addingTimeInterval(1), scale: s, total: total, column: 0) {
                Rectangle().fill(Color.red.opacity(0.8)).frame(width: 2).offset(x: now.offset)
            }
        }
    }

    /// Położenie paska jak `getClippedTimelinePosition` (przycięte do zakresu, minimalna szerokość ćwierć kolumny).
    private func position(_ start: Date, _ end: Date, scale s: (start: Date, end: Date, days: Int, column: CGFloat), total: CGFloat, column: CGFloat) -> (offset: CGFloat, size: CGFloat)? {
        let boundsStart = s.start.timeIntervalSince1970, boundsEnd = s.end.timeIntervalSince1970
        let from = max(start.timeIntervalSince1970, boundsStart)
        let rawEnd = end.timeIntervalSince1970
        let to = min(rawEnd > start.timeIntervalSince1970 ? rawEnd : start.timeIntervalSince1970 + 0.001, boundsEnd)
        guard from < boundsEnd, to > boundsStart, to > from else { return nil }
        let duration = boundsEnd - boundsStart
        let offset = CGFloat((from - boundsStart) / duration) * total
        let size = min(total - offset, max(column * 0.25, CGFloat((to - from) / duration) * total))
        return (offset, size)
    }

    private func bar(_ entry: FleetTimelineEntry, width: CGFloat) -> some View {
        let event = entry.type == "event"
        let color = FleetTone.hex(entry.color, fallback: event ? CrmTheme.rgb(0x3b82f6) : CrmTheme.rgb(0xf97316))
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: event ? "calendar" : "wrench.and.screwdriver").font(.caption2)
                Text(entry.title).font(.caption.weight(.semibold)).lineLimit(1)
            }
            if width > 100 && !entry.location.isEmpty { Label(entry.location, systemImage: "mappin").font(.caption2).lineLimit(1) }
            if width > 150 && !entry.driver.isEmpty { Label(entry.driver, systemImage: "person").font(.caption2).lineLimit(1) }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 6).padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(color.opacity(0.85), in: RoundedRectangle(cornerRadius: 6))
        .help([entry.title, entry.description].filter { !$0.isEmpty }.joined(separator: "\n"))
        .contentShape(Rectangle())
        .onTapGesture {
            if event, let id = entry.relatedId { state.showEvent(id) }
        }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            legendItem(CrmTheme.rgb(0x3b82f6), "Wydarzenie zaplanowane")
            legendItem(CrmTheme.rgb(0x22c55e), "Wydarzenie potwierdzone")
            legendItem(CrmTheme.rgb(0xf97316), "Serwis w trakcie")
            legendItem(CrmTheme.rgb(0xef4444), "Anulowane/Niepomyślne")
        }
        .font(.caption).foregroundStyle(.secondary)
    }

    private func legendItem(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3).fill(color).frame(width: 14, height: 10)
            Text(text)
        }
    }
}
