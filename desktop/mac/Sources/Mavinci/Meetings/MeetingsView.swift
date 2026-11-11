import SwiftUI
import AppKit

// MARK: Spotkania — oś czasu jak kalendarz w Teams (dzień / tydzień roboczy / tydzień) i lista, 1:1 ze stroną `/crm/meetings`.

enum MeetingsMode: String, CaseIterable, Identifiable {
    case day, workweek, week, list
    var id: String { rawValue }
    var label: String {
        switch self { case .day: return "Dzień"; case .workweek: return "Tydzień roboczy"; case .week: return "Tydzień"; case .list: return "Lista" }
    }
}

/// Formularz spotkania: nowe (opcjonalnie z zaznaczonym czasem) albo edycja istniejącego.
struct MeetingEditorRequest: Identifiable {
    let id = UUID()
    var meeting: Meeting?
    var start: Date?
    var end: Date?
}

/// Licznik zaproszeń czekających na odpowiedź (pasek boczny).
struct MeetingsPendingBadge: View {
    @ObservedObject var store: MeetingsStore
    var body: some View {
        let count = store.meetings.filter { $0.needsResponse(from: store.employeeId) && $0.endDate >= Date() }.count
        Text(count > 0 ? "\(count)" : "").foregroundStyle(.secondary).monospacedDigit()
            .help(count > 0 ? "Zaproszenia na spotkania czekające na Twoją odpowiedź" : "")
    }
}

@MainActor struct MeetingsView: View {
    @ObservedObject var store: MeetingsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("meetings.mode") private var mode: MeetingsMode = .workweek
    @AppStorage("meetings.all") private var showAll = false
    @State private var kind = 0
    @State private var statuses: Set<MeetingStatus> = Set(MeetingStatus.allCases)
    @State private var showDeclined = false
    @State private var onlyPending = false
    @State private var search = ""
    @State private var anchor = MeetingDates.calendar.startOfDay(for: Date())
    @State private var selectedID: String?
    @State private var inspectorShown = false
    @State private var editor: MeetingEditorRequest?
    @State private var removing: Meeting?
    @State private var cancelling: Meeting?

    private var calendar: Calendar { MeetingDates.calendar }
    private var me: String? { store.employeeId ?? state.employee?.id }
    private var days: [Date] {
        switch mode {
        case .day, .list: return [anchor]
        case .workweek, .week:
            let monday = MeetingDates.startOfWeek(anchor)
            return (0..<(mode == .workweek ? 5 : 7)).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
        }
    }
    private var filtered: [Meeting] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.meetings.filter { m in
            if !showAll && !m.isParticipant(me) { return false }
            if kind == 1 && m.isPrivate { return false }
            if kind == 2 && !m.isPrivate { return false }
            if !statuses.contains(m.meetingStatus) { return false }
            if !showDeclined && m.response(of: me) == .declined { return false }
            if onlyPending && !m.needsResponse(from: me) { return false }
            if query.isEmpty { return true }
            return [m.title, m.location, m.notes].contains { $0.lowercased().contains(query) }
        }
    }
    private var pendingCount: Int { store.meetings.filter { $0.needsResponse(from: me) && $0.endDate >= Date() }.count }
    private var rangeTitle: String {
        guard let first = days.first, let last = days.last else { return "" }
        if mode == .day { return MeetingDates.format(first, "EEEE, d MMMM yyyy").capitalized }
        if calendar.component(.month, from: first) == calendar.component(.month, from: last) {
            return "\(calendar.component(.day, from: first))–\(MeetingDates.format(last, "d LLLL yyyy"))"
        }
        return "\(MeetingDates.format(first, "d MMM")) – \(MeetingDates.format(last, "d MMM yyyy"))"
    }

    var body: some View {
        VStack(spacing: 0) {
            navigationBar
            filterBar
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Spotkania")
        .navigationSubtitle(subtitle)
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj spotkań")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { editor = MeetingEditorRequest() } label: { Label("Nowe spotkanie", systemImage: "plus") }
                    .help("Nowe spotkanie (⌘N)").keyboardShortcut("n")
                Button { inspectorShown.toggle() } label: { Label("Szczegóły", systemImage: "sidebar.trailing") }
                    .help("Pokaż lub ukryj szczegóły spotkania")
            }
        }
        .inspector(isPresented: $inspectorShown) {
            MeetingInspector(meeting: store.meeting(selectedID), store: store, me: me,
                             edit: { editor = MeetingEditorRequest(meeting: $0) }, remove: { removing = $0 }, setStatus: setStatus)
                .inspectorColumnWidth(min: 300, ideal: 350, max: 480)
                .background(theme.page)
        }
        .sheet(item: $editor) { request in
            MeetingEditorSheet(store: store, request: request)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń spotkanie", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let meeting = removing {
                Button(meeting.seriesId == nil ? "Usuń spotkanie" : "Usuń tylko ten termin", role: .destructive) {
                    Task { await store.delete(meeting) }; if selectedID == meeting.id { selectedID = nil }
                }
                if meeting.seriesId != nil {
                    Button("Usuń to i kolejne w cyklu", role: .destructive) {
                        Task { await store.delete(meeting, scope: "future") }; if selectedID == meeting.id { selectedID = nil }
                    }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("„\(removing?.title ?? "")” zniknie z planu wszystkich uczestników.")
        }
        .confirmationDialog("Odwołaj spotkanie", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), titleVisibility: .visible) {
            if let meeting = cancelling {
                Button("Odwołaj spotkanie", role: .destructive) { Task { await store.setStatus(meeting, .cancelled) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Spotkanie „\(cancelling?.title ?? "")” zostanie oznaczone jako odwołane\(cancelling?.seriesId != nil ? " (tylko ten termin)" : ""). Uczestnicy nie dostaną już przypomnień.")
        }
        .task(id: state.employee?.id) { if store.meetings.isEmpty { await store.backgroundSync() } }
        .task(id: days.first) { await store.loadHolidays(for: days) }
        .onAppear { reveal() }
        .onChange(of: store.focusID) { _, _ in reveal() }
        .onChange(of: store.lastSync) { _, _ in reveal() }
        .onChange(of: selectedID) { _, id in if id != nil { inspectorShown = true } }
    }

    private var subtitle: String {
        if store.syncing && store.meetings.isEmpty { return "Pobieranie spotkań…" }
        if pendingCount > 0 { return "Czeka na Twoją odpowiedź: \(pendingCount)" }
        return "Przeciągnij spotkanie, aby zmienić termin; zaznacz wolny czas, aby dodać spotkanie"
    }

    @ViewBuilder private var content: some View {
        if store.meetings.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Spotkania", systemImage: "person.2")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie spotkań…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if mode == .list {
            MeetingsListView(meetings: filtered, store: store, me: me, selectedID: $selectedID,
                             create: { editor = MeetingEditorRequest() }, edit: { editor = MeetingEditorRequest(meeting: $0) },
                             remove: { removing = $0 }, setStatus: setStatus)
        } else {
            MeetingsTimelineGrid(days: days, meetings: filtered, store: store, me: me, selectedID: $selectedID,
                                 create: { editor = MeetingEditorRequest(start: $0, end: $1) },
                                 edit: { editor = MeetingEditorRequest(meeting: $0) },
                                 remove: { removing = $0 }, setStatus: setStatus)
                .padding(.horizontal, 14).padding(.bottom, 14)
        }
    }

    private var navigationBar: some View {
        HStack(spacing: 10) {
            if mode != .list {
                Button("Dziś") { anchor = calendar.startOfDay(for: Date()) }
                    .keyboardShortcut("t", modifiers: .command).help("Dziś (⌘T)")
                ControlGroup {
                    Button { step(-1) } label: { Image(systemName: "chevron.left") }
                        .keyboardShortcut(.leftArrow, modifiers: .command).help("Wcześniej (⌘←)")
                    Button { step(1) } label: { Image(systemName: "chevron.right") }
                        .keyboardShortcut(.rightArrow, modifiers: .command).help("Później (⌘→)")
                }.fixedSize()
                DatePicker("Przejdź do dnia", selection: Binding(get: { anchor }, set: { anchor = calendar.startOfDay(for: $0) }), displayedComponents: .date)
                    .labelsHidden().datePickerStyle(.compact).fixedSize()
                    .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                Text(rangeTitle).font(.title3.weight(.semibold)).lineLimit(1).padding(.leading, 4)
            } else {
                Text("Wszystkie spotkania").font(.title3.weight(.semibold))
            }
            Spacer(minLength: 12)
            if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja spotkań") }
            Picker("Widok", selection: $mode) { ForEach(MeetingsMode.allCases) { Text($0.label).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Picker("Zakres", selection: $showAll) { Text("Moje").tag(false); Text("Wszystkie").tag(true) }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                Picker("Rodzaj", selection: $kind) {
                    Text("Firmowe i prywatne").tag(0)
                    Text("Firmowe").tag(1)
                    Label("Prywatne", systemImage: "lock").tag(2)
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
                ForEach(MeetingStatus.allCases) { status in
                    Toggle(isOn: Binding(get: { statuses.contains(status) }, set: { on in
                        if on { statuses.insert(status) } else if statuses.count > 1 { statuses.remove(status) }
                    })) {
                        Label { Text(status.label) } icon: { Image(systemName: "circle.fill").foregroundStyle(statuses.contains(status) ? status.color : .secondary) }
                    }.toggleStyle(.button)
                }
                Toggle("Odrzucone przeze mnie", isOn: $showDeclined).toggleStyle(.button)
                Toggle(isOn: $onlyPending) {
                    Label(pendingCount > 0 ? "Czeka na moją odpowiedź (\(pendingCount))" : "Czeka na moją odpowiedź", systemImage: "questionmark.circle")
                }.toggleStyle(.button)
            }
            .controlSize(.small)
            .padding(.horizontal, 16).padding(.bottom, 10)
        }
    }

    private func step(_ direction: Int) {
        anchor = calendar.date(byAdding: .day, value: direction * (mode == .day ? 1 : 7), to: anchor) ?? anchor
    }
    private func setStatus(_ meeting: Meeting, _ status: MeetingStatus) {
        if status == .cancelled { cancelling = meeting } else { Task { await store.setStatus(meeting, status) } }
    }
    /// Spotkanie wskazane z powiadomienia albo „Mojego planu”: przejdź do jego tygodnia i pokaż szczegóły.
    private func reveal() {
        guard let id = store.focusID, let meeting = store.meeting(id) else { return }
        store.focusID = nil
        if mode == .list { mode = .workweek }
        anchor = calendar.startOfDay(for: meeting.startDate)
        if mode == .workweek, calendar.component(.weekday, from: anchor) == 1 || calendar.component(.weekday, from: anchor) == 7 { mode = .week }
        selectedID = meeting.id
        inspectorShown = true
    }
}

// MARK: Oś czasu

/// Siatka godzin z kolumnami dni: przeciąganie zmienia termin (co 15 min, także na inny dzień), dolna krawędź — długość,
/// zaznaczenie wolnego czasu otwiera nowe spotkanie. Nachodzące się spotkania dzielą szerokość kolumny.
@MainActor struct MeetingsTimelineGrid: View {
    let days: [Date]
    let meetings: [Meeting]
    @ObservedObject var store: MeetingsStore
    let me: String?
    @Binding var selectedID: String?
    let create: (Date, Date) -> Void
    let edit: (Meeting) -> Void
    let remove: (Meeting) -> Void
    let setStatus: (Meeting, MeetingStatus) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var drag: Drag?
    @State private var pick: Pick?

    struct Drag: Equatable { let id: String; let resize: Bool; var minutes: Double; var dayShift: Int }
    struct Pick: Equatable { let day: Int; var from: Double; var to: Double }

    private let hour: CGFloat = 52
    private let labelWidth: CGFloat = 56
    private let snap = 15.0
    private var calendar: Calendar { MeetingDates.calendar }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            GeometryReader { geo in
                let width = max(70, (geo.size.width - labelWidth) / CGFloat(max(1, days.count)))
                VStack(spacing: 0) {
                    header(width: width, now: context.date)
                    allDayRow(width: width)
                    ScrollViewReader { proxy in
                        ScrollView(.vertical) {
                            ZStack(alignment: .topLeading) {
                                hourLines.padding(.leading, labelWidth)
                                HStack(alignment: .top, spacing: 0) {
                                    hourLabels
                                    ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                                        column(index: index, day: day, width: width, now: context.date)
                                    }
                                }
                            }
                            .frame(height: hour * 24)
                            .coordinateSpace(.named("meetings-grid"))
                        }
                        .onAppear { scrollToStart(proxy) }
                        .onChange(of: days.first) { _, _ in scrollToStart(proxy) }
                    }
                }
                .background(theme.card.opacity(theme == .light ? 1 : 0.5), in: RoundedRectangle(cornerRadius: 12))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func isoDay(_ date: Date) -> String { MeetingDates.format(date, "yyyy-MM-dd") }
    private func isAllDay(_ m: Meeting) -> Bool { m.allDay || m.endDate.timeIntervalSince(m.startDate) >= 86_400 }
    private func minutes(_ date: Date) -> Double {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }
    private func clock(_ minutes: Double) -> String { String(format: "%02d:%02d", Int(minutes) / 60 % 24, Int(minutes) % 60) }

    private func scrollToStart(_ proxy: ScrollViewProxy) {
        let showsToday = days.contains { calendar.isDateInToday($0) }
        let target = showsToday ? max(0, calendar.component(.hour, from: Date()) - 2) : 7
        DispatchQueue.main.async { proxy.scrollTo(target, anchor: .top) }
    }

    // MARK: Nagłówek i spotkania całodniowe
    private func header(width: CGFloat, now: Date) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: labelWidth, height: 1)
            ForEach(days, id: \.self) { day in
                let today = calendar.isDate(day, inSameDayAs: now)
                let holiday = store.holidays[isoDay(day)]
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .center, spacing: 6) {
                        Text("\(calendar.component(.day, from: day))").font(.title3.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(today ? CrmTheme.rgb(0x13161f) : theme.text)
                            .frame(minWidth: 30, minHeight: 30)
                            .background(Circle().fill(today ? theme.accent : Color.clear))
                        Text(MeetingDates.format(day, "EEE").uppercased()).font(.caption.weight(.medium))
                            .foregroundStyle(today ? theme.accent : .secondary)
                    }
                    if let holiday { Text(holiday).font(.caption2).foregroundStyle(CrmTheme.rgb(0xf87171).opacity(0.9)).lineLimit(1).help(holiday) }
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
                .frame(width: width, alignment: .leading)
            }
        }
        .background(Color.primary.opacity(0.03))
    }

    @ViewBuilder private func allDayRow(width: CGFloat) -> some View {
        let whole = meetings.filter(isAllDay)
        if !whole.isEmpty {
            HStack(alignment: .top, spacing: 0) {
                Text("Cały dzień").font(.system(size: 9).weight(.medium)).foregroundStyle(.secondary).frame(width: labelWidth - 6, alignment: .trailing).padding(.trailing, 6).padding(.top, 4)
                ForEach(days, id: \.self) { day in
                    let start = calendar.startOfDay(for: day)
                    let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
                    VStack(spacing: 3) {
                        ForEach(whole.filter { $0.startDate < end && $0.endDate > start }) { m in
                            Button { selectedID = m.id } label: {
                                HStack(spacing: 4) {
                                    if m.isPrivate { Image(systemName: "lock.fill").font(.system(size: 9)) }
                                    Text(m.title).font(.caption).lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .background(m.tint.opacity(0.28), in: RoundedRectangle(cornerRadius: 5))
                                .overlay(alignment: .leading) { Rectangle().fill(m.tint).frame(width: 3) }
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                            }.buttonStyle(.plain)
                            .contextMenu { menu(m) }
                        }
                    }.padding(.horizontal, 2).padding(.vertical, 3).frame(width: width, alignment: .top)
                }
            }
            .background(Color.primary.opacity(0.02))
        }
    }

    // MARK: Siatka
    private var hourLines: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { h in
                VStack(spacing: 0) {
                    Rectangle().fill(Color.primary.opacity(h == 0 ? 0 : 0.08)).frame(height: 1)
                    Spacer(minLength: 0)
                    Rectangle().fill(Color.primary.opacity(0.035)).frame(height: 1)
                    Spacer(minLength: 0)
                }
                .frame(height: hour)
                .id(h)
            }
        }
        .allowsHitTesting(false)
    }

    private var hourLabels: some View {
        ZStack(alignment: .topTrailing) {
            ForEach(1..<24, id: \.self) { h in
                Text(String(format: "%02d:00", h)).font(.caption2).monospacedDigit().foregroundStyle(.secondary)
                    .offset(y: CGFloat(h) * hour - 7)
            }
        }
        .padding(.trailing, 6)
        .frame(width: labelWidth, height: hour * 24, alignment: .topTrailing)
        .allowsHitTesting(false)
    }

    private func slots(for day: Date) -> [TimelineSlot] {
        let start = calendar.startOfDay(for: day)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return [] }
        let items = meetings.filter { !isAllDay($0) && $0.startDate < end && $0.endDate > start }.map { m -> TimelineSlot in
            let from = m.startDate < start ? 0 : minutes(m.startDate)
            let to = m.endDate >= end ? 1440 : max(from + snap, minutes(m.endDate))
            return TimelineSlot(meeting: m, start: from, end: min(1440, to), realStart: m.startDate, realEnd: m.endDate)
        }
        return layoutTimeline(items)
    }

    private func column(index: Int, day: Date, width: CGFloat, now: Date) -> some View {
        let today = calendar.isDate(day, inSameDayAs: now)
        let weekday = calendar.component(.weekday, from: day)
        let free = weekday == 1 || weekday == 7 || store.holidays[isoDay(day)] != nil
        let placed = slots(for: day)
        let dragging = placed.contains { $0.meeting.id == drag?.id }
        return ZStack(alignment: .topLeading) {
            Rectangle().fill(today ? theme.accent.opacity(0.05) : free ? Color.primary.opacity(0.025) : Color.clear)
            VStack(spacing: 0) {
                Color.black.opacity(0.12).frame(height: hour * 8)
                Spacer(minLength: 0)
                Color.black.opacity(0.12).frame(height: hour * 6)
            }
            Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1)
            if let pick, pick.day == index {
                RoundedRectangle(cornerRadius: 5).fill(theme.accent.opacity(0.25))
                    .frame(width: max(10, width - 4), height: CGFloat((pick.to - pick.from) / 60) * hour)
                    .overlay(alignment: .topLeading) {
                        Text("\(clock(pick.from))–\(clock(pick.to))").font(.caption2.weight(.medium)).padding(4)
                    }
                    .offset(x: 2, y: CGFloat(pick.from / 60) * hour)
                    .allowsHitTesting(false)
            }
            ForEach(placed) { slot in block(slot, dayIndex: index, width: width) }
            if today { nowLine(now) }
        }
        .frame(width: width, height: hour * 24, alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(createGesture(index: index))
        .zIndex(dragging ? 1 : 0)
    }

    private func nowLine(_ now: Date) -> some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(Color.red).frame(height: 2)
            Circle().fill(Color.red).frame(width: 8, height: 8).offset(x: -4)
        }
        .offset(y: CGFloat(minutes(now) / 60) * hour - 1)
        .allowsHitTesting(false)
    }

    private func minute(at y: CGFloat) -> Double {
        max(0, min(1440 - snap, (Double(y / hour) * 60 / snap).rounded(.down) * snap))
    }

    private func createGesture(index: Int) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                let a = minute(at: value.startLocation.y)
                let b = minute(at: value.location.y)
                pick = Pick(day: index, from: min(a, b), to: max(a, b) + snap)
            }
            .onEnded { _ in
                guard let current = pick, current.day < days.count else { pick = nil; return }
                pick = nil
                let single = current.to - current.from <= snap
                let from = single ? (current.from / 30).rounded(.down) * 30 : current.from
                let to = single ? from + 60 : current.to
                let base = calendar.startOfDay(for: days[current.day])
                guard let start = calendar.date(byAdding: .minute, value: Int(from), to: base),
                      let end = calendar.date(byAdding: .minute, value: Int(to), to: base) else { return }
                create(start, end)
            }
    }

    // MARK: Spotkanie na osi
    private func preview(_ m: Meeting, _ d: Drag) -> (Date, Date) {
        if d.resize {
            let end = m.endDate.addingTimeInterval(d.minutes * 60)
            return (m.startDate, max(end, m.startDate.addingTimeInterval(snap * 60)))
        }
        let shifted = calendar.date(byAdding: .day, value: d.dayShift, to: m.startDate) ?? m.startDate
        let start = shifted.addingTimeInterval(d.minutes * 60)
        return (start, start.addingTimeInterval(m.endDate.timeIntervalSince(m.startDate)))
    }

    private func finish(_ m: Meeting) {
        guard let current = drag, current.id == m.id else { drag = nil; return }
        drag = nil
        let (start, end) = preview(m, current)
        if start != m.startDate || end != m.endDate { Task { await store.move(m, start: start, end: end) } }
    }

    private func moveGesture(_ m: Meeting, dayIndex: Int, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named("meetings-grid"))
            .onChanged { value in
                let minutes = (Double(value.translation.height / hour) * 60 / snap).rounded() * snap
                let raw = days.count > 1 ? Int((value.translation.width / width).rounded()) : 0
                let shift = min(max(raw, -dayIndex), days.count - 1 - dayIndex)
                drag = Drag(id: m.id, resize: false, minutes: minutes, dayShift: shift)
                selectedID = m.id
            }
            .onEnded { _ in finish(m) }
    }

    private func resizeGesture(_ m: Meeting, slot: TimelineSlot) -> some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .named("meetings-grid"))
            .onChanged { value in
                let minutes = (Double(value.translation.height / hour) * 60 / snap).rounded() * snap
                drag = Drag(id: m.id, resize: true, minutes: max(minutes, snap - (slot.end - slot.start)), dayShift: 0)
                selectedID = m.id
            }
            .onEnded { _ in finish(m) }
    }

    private func block(_ slot: TimelineSlot, dayIndex: Int, width: CGFloat) -> some View {
        let m = slot.meeting
        let status = m.meetingStatus
        let mine = m.response(of: me)
        let cancelled = status == .cancelled
        let declined = mine == .declined
        let hatched = status == .tentative || mine == .tentative
        let pending = mine == .pending && !cancelled
        let saving = store.saving.contains(m.id)
        let editable = store.canEdit(m) && !m.allDay && !saving
        let active = drag?.id == m.id ? drag : nil
        let laneWidth = width / CGFloat(max(1, slot.columns))
        let shiftY = active.map { $0.resize ? 0 : CGFloat($0.minutes / 60) * hour } ?? 0
        let shiftX = active.map { $0.resize ? 0 : CGFloat($0.dayShift) * width } ?? 0
        let extra = active.map { $0.resize ? CGFloat($0.minutes / 60) * hour : 0 } ?? 0
        let height = max(18, CGFloat((slot.end - slot.start) / 60) * hour - 2 + extra)
        let compact = height < 38
        let selected = selectedID == m.id
        let times = active.map { preview(m, $0) } ?? (slot.realStart, slot.realEnd)
        let continues = slot.end >= 1440 && slot.realEnd > (calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: days[min(dayIndex, days.count - 1)])) ?? slot.realEnd)
        var detail = "\(MeetingDates.time(times.0))–\(MeetingDates.time(times.1))"
        if cancelled { detail += " · Odwołane" } else if status == .tentative { detail += " · Wstępne" }
        if !cancelled && declined { detail += " · Odrzucone" }
        if pending { detail += " · Odpowiedz" }
        return VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                if m.isPrivate { Image(systemName: "lock.fill").font(.system(size: 9)) }
                if pending { Image(systemName: "questionmark.circle.fill").font(.system(size: 10)).foregroundStyle(theme.accent) }
                if m.seriesId != nil && !compact { Image(systemName: "repeat").font(.system(size: 9)).foregroundStyle(.secondary) }
                Text(m.title).font(.caption.weight(.semibold)).strikethrough(cancelled || declined).lineLimit(1)
                if compact { Text(MeetingDates.time(times.0)).font(.caption2).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
                if saving { ProgressView().controlSize(.mini) }
            }
            if !compact {
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                if height > 58 && !m.location.isEmpty {
                    Label(m.location, systemImage: "mappin").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .foregroundStyle(theme.text)
        .padding(.leading, 7).padding(.trailing, 4).padding(.vertical, 3)
        .frame(width: max(12, laneWidth - 4), height: height, alignment: .topLeading)
        .background {
            ZStack {
                m.tint.opacity(pending ? 0.12 : cancelled || declined ? 0.14 : 0.3)
                if hatched { MeetingHatch().stroke(Color.white.opacity(0.1), lineWidth: 4) }
            }
        }
        .overlay(alignment: .leading) { Rectangle().fill(m.tint).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .opacity(cancelled || declined ? 0.6 : 1)
        .shadow(color: selected || active != nil ? theme.accent.opacity(0.55) : .clear, radius: active != nil ? 8 : 3)
        .overlay(alignment: .bottom) {
            if editable && !continues {
                Capsule().fill(Color.primary.opacity(0.35)).frame(width: 24, height: 3).padding(.bottom, 2)
                    .frame(maxWidth: .infinity).frame(height: 9).contentShape(Rectangle())
                    .onHover { inside in if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() } }
                    .gesture(resizeGesture(m, slot: slot))
                    .help("Przeciągnij, aby zmienić długość")
            }
        }
        .contentShape(Rectangle())
        .offset(x: CGFloat(slot.column) * laneWidth + 2 + shiftX, y: CGFloat(slot.start / 60) * hour + 1 + shiftY)
        .zIndex(active != nil ? 3 : selected ? 2 : 1)
        .onTapGesture { selectedID = m.id }
        .gesture(moveGesture(m, dayIndex: dayIndex, width: width), including: editable ? .all : .subviews)
        .contextMenu { menu(m) }
        .help("\(m.title) · \(MeetingDates.time(slot.realStart))–\(MeetingDates.time(slot.realEnd))\(m.location.isEmpty ? "" : " · \(m.location)")")
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(m.title), \(detail)")
    }

    @ViewBuilder private func menu(_ m: Meeting) -> some View {
        MeetingMenuItems(meeting: m, store: store, me: me, open: { selectedID = m.id }, edit: { edit(m) }, remove: { remove(m) },
                         setStatus: { setStatus(m, $0) })
    }
}

/// Ukośne paski — spotkanie wstępne albo „może” (jak w Teams).
struct MeetingHatch: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        var x = -rect.height
        while x < rect.width {
            path.move(to: CGPoint(x: x, y: rect.height))
            path.addLine(to: CGPoint(x: x + rect.height, y: 0))
            x += 12
        }
        return path
    }
}

/// Czynności spotkania (menu kontekstowe osi, listy i szczegółów).
@MainActor struct MeetingMenuItems: View {
    let meeting: Meeting
    @ObservedObject var store: MeetingsStore
    let me: String?
    let open: () -> Void
    let edit: () -> Void
    let remove: () -> Void
    let setStatus: (MeetingStatus) -> Void
    var body: some View {
        Button("Pokaż szczegóły", systemImage: "info.circle", action: open)
        if let mine = meeting.response(of: me), meeting.createdBy != me, meeting.meetingStatus != .cancelled {
            Divider()
            ForEach(MeetingResponse.answers) { response in
                Button { Task { await store.respond(meeting, response) } } label: {
                    Label(response.action, systemImage: mine == response ? "checkmark" : response.symbol)
                }
            }
        }
        if store.canEdit(meeting) {
            Divider()
            Button("Edytuj…", systemImage: "pencil", action: edit)
            Menu("Status spotkania") {
                ForEach(MeetingStatus.allCases) { status in
                    Button { setStatus(status) } label: {
                        Label(status.label, systemImage: meeting.meetingStatus == status ? "checkmark" : status.symbol)
                    }.disabled(meeting.meetingStatus == status)
                }
            }
            Divider()
            Button("Usuń…", systemImage: "trash", role: .destructive, action: remove)
        }
    }
}

// MARK: Lista

@MainActor struct MeetingsListView: View {
    let meetings: [Meeting]
    @ObservedObject var store: MeetingsStore
    let me: String?
    @Binding var selectedID: String?
    let create: () -> Void
    let edit: (Meeting) -> Void
    let remove: (Meeting) -> Void
    let setStatus: (Meeting, MeetingStatus) -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let now = Date()
        let upcoming = meetings.filter { $0.endDate >= now }.sorted { $0.startDate < $1.startDate }
        let past = meetings.filter { $0.endDate < now }.sorted { $0.startDate > $1.startDate }
        List(selection: $selectedID) {
            if !upcoming.isEmpty {
                Section("Nadchodzące (\(upcoming.count))") { ForEach(upcoming) { row($0, now: now) } }
            }
            if !past.isEmpty {
                Section("Zakończone (\(past.count))") { ForEach(past) { row($0, now: now) } }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .overlay {
            if meetings.isEmpty {
                ContentUnavailableView {
                    Label("Brak spotkań do wyświetlenia", systemImage: "person.2")
                } actions: {
                    Button("Dodaj spotkanie", action: create).buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func row(_ m: Meeting, now: Date) -> some View {
        let status = m.meetingStatus
        let mine = m.response(of: me)
        let live = m.startDate <= now && m.endDate >= now
        return HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(m.tint).frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if m.isPrivate { Image(systemName: "lock.fill").font(.caption).foregroundStyle(.secondary) }
                    Text(m.title).font(.body.weight(.semibold)).strikethrough(status == .cancelled).lineLimit(1)
                    Spacer(minLength: 8)
                    if m.needsResponse(from: me) { badge("Odpowiedz", theme.accent) }
                    if status != .confirmed { badge(status.label, status.color) }
                    if live { badge("W trakcie", MeetingResponse.accepted.color) }
                    else if m.endDate < now { badge("Zakończone", .secondary) }
                }
                HStack(spacing: 14) {
                    Label(m.allDay ? "\(MeetingDates.format(m.startDate, "d MMMM yyyy")) · Cały dzień"
                          : "\(MeetingDates.format(m.startDate, "EEE, d MMMM yyyy, HH:mm"))–\(MeetingDates.time(m.endDate))", systemImage: "clock")
                    if m.seriesId != nil { Label(meetingRecurrenceLabel(m.recurrenceDays), systemImage: "repeat") }
                    if !m.location.isEmpty { Label(m.location, systemImage: "mappin").lineLimit(1) }
                    if !m.participants.isEmpty { Label("\(m.participants.count)", systemImage: "person.2") }
                    Label(m.kindLabel, systemImage: m.isPrivate ? "lock" : "building.2")
                    if let mine, m.createdBy != me, mine != .pending { Label(mine.label, systemImage: mine.symbol).foregroundStyle(mine.color) }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .opacity(status == .cancelled || mine == .declined ? 0.6 : 1)
        .tag(m.id)
        .contextMenu {
            MeetingMenuItems(meeting: m, store: store, me: me, open: { selectedID = m.id }, edit: { edit(m) }, remove: { remove(m) },
                             setStatus: { setStatus(m, $0) })
        }
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.semibold)).padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.16), in: Capsule()).foregroundStyle(color)
    }
}

// MARK: Szczegóły (inspektor)

@MainActor struct MeetingInspector: View {
    let meeting: Meeting?
    @ObservedObject var store: MeetingsStore
    let me: String?
    let edit: (Meeting) -> Void
    let remove: (Meeting) -> Void
    let setStatus: (Meeting, MeetingStatus) -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let m = meeting {
            ScrollView { details(m).padding(18).frame(maxWidth: .infinity, alignment: .leading) }
        } else {
            ContentUnavailableView("Wybierz spotkanie", systemImage: "person.2", description: Text("Kliknij spotkanie na osi czasu lub na liście."))
        }
    }

    private func details(_ m: Meeting) -> some View {
        let status = m.meetingStatus
        let mine = m.response(of: me)
        let organizer = m.createdBy != nil && m.createdBy == me
        let alerts = [m.alert1, m.alert2, m.alertCritical].compactMap(meetingAlertLabel)
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 2).fill(m.tint).frame(height: 4)
                Text(m.title).font(.title2.weight(.semibold)).strikethrough(status == .cancelled).textSelection(.enabled)
                HStack(spacing: 6) {
                    pill(status.label, status.color, symbol: status.symbol)
                    pill(m.kindLabel, .secondary, symbol: m.isPrivate ? "lock.fill" : "building.2")
                    if m.seriesId != nil { pill(meetingRecurrenceLabel(m.recurrenceDays), .secondary, symbol: "repeat") }
                }
            }

            if let mine, !organizer, status != .cancelled {
                VStack(alignment: .leading, spacing: 8) {
                    Text(mine == .pending ? "Czy będziesz na spotkaniu?" : "Twoja odpowiedź: \(mine.label)").font(.callout)
                    HStack(spacing: 6) {
                        ForEach(MeetingResponse.answers) { response in
                            Button { Task { await store.respond(m, response) } } label: {
                                Label(response.action, systemImage: response.symbol).frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(mine == response ? response.color : Color.primary.opacity(0.18))
                            .foregroundStyle(mine == response ? CrmTheme.rgb(0x13161f) : theme.text)
                        }
                    }.controlSize(.large)
                }
                .padding(12).background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }

            section("Termin", symbol: "clock") {
                Text(m.allDay ? "\(MeetingDates.format(m.startDate, "EEEE, d MMMM yyyy")) · Cały dzień"
                     : "\(MeetingDates.format(m.startDate, "EEEE, d MMMM yyyy")), \(MeetingDates.time(m.startDate))–\(MeetingDates.time(m.endDate))")
                    .textSelection(.enabled)
            }
            if !m.location.isEmpty { section("Lokalizacja", symbol: "mappin") { Text(m.location).textSelection(.enabled) } }
            if !m.creatorName.isEmpty { section("Organizator", symbol: "person.crop.circle") { Text(m.creatorName) } }
            if !m.participants.isEmpty {
                section(m.responseSummary.isEmpty ? "Uczestnicy" : "Uczestnicy · \(m.responseSummary)", symbol: "person.2") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(sortedParticipants(m)) { p in
                            let isOrganizer = p.employeeId != nil && p.employeeId == m.createdBy
                            let response = MeetingResponse(raw: isOrganizer ? "accepted" : p.response)
                            HStack(spacing: 8) {
                                Circle().fill(p.employeeId == nil ? Color.secondary.opacity(0.5) : response.color).frame(width: 8, height: 8)
                                Text(p.name).lineLimit(1)
                                Spacer(minLength: 6)
                                Text(isOrganizer ? "Organizator" : p.employeeId == nil ? "Kontakt" : response.label)
                                    .font(.caption).foregroundStyle(isOrganizer ? theme.accent : .secondary)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                        }
                    }
                }
            }
            if !alerts.isEmpty { section("Przypomnienia", symbol: "bell") { VStack(alignment: .leading, spacing: 2) { ForEach(alerts, id: \.self) { Text($0) } } } }
            if !m.notes.isEmpty { section("Notatki", symbol: "note.text") { Text(m.notes).textSelection(.enabled) } }

            if store.canEdit(m) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Status spotkania").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    Picker("Status spotkania", selection: Binding(get: { status }, set: { setStatus(m, $0) })) {
                        ForEach(MeetingStatus.allCases) { Text($0.label).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden()
                }
                HStack {
                    Button(role: .destructive) { remove(m) } label: { Label("Usuń", systemImage: "trash") }
                    Spacer()
                    Button { edit(m) } label: { Label("Edytuj", systemImage: "pencil") }.buttonStyle(.borderedProminent).keyboardShortcut("e")
                }
            }
        }
    }

    private func sortedParticipants(_ m: Meeting) -> [MeetingParticipant] {
        m.participants.sorted { a, b in
            if a.employeeId == m.createdBy { return true }
            if b.employeeId == m.createdBy { return false }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
    private func pill(_ text: String, _ color: Color, symbol: String) -> some View {
        Label(text, systemImage: symbol).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
    private func section<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            content()
        }
    }
}
