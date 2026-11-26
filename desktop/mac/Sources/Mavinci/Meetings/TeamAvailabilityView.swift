import SwiftUI

// MARK: Spotkania → „Pracownicy” — 1:1 z widokiem w CRM (`TeamAvailabilityView.tsx`, docs/team-availability.md): wybrany dzień,
// kolumna dla każdej wybranej osoby z zakresu planu — spotkania, eventy, fazy i nieobecności. Tytuły według zakresu, spotkania
// prywatne innych osób — „Zajęty”. Zaznaczenie wolnego czasu w kolumnie zakłada spotkanie z tą osobą; chwyt kolumny godzin
// przewija dzień. Wybór osób zapamiętany na Macu.

/// Pozycja zajętości w kolumnie osoby (minuty dnia) i jej miejsce wśród nakładających się pozycji.
struct AvailabilitySlot: Identifiable {
    let block: AvailabilityBlock
    let start: Double
    let end: Double
    var column = 0
    var columns = 1
    var id: String { block.id }

    /// Jak `layoutTimeline`: grupa nakładających się pozycji dzieli szerokość kolumny.
    static func layout(_ items: [AvailabilitySlot]) -> [AvailabilitySlot] {
        let sorted = items.sorted { $0.start == $1.start ? $0.end > $1.end : $0.start < $1.start }
        var placed: [AvailabilitySlot] = []
        var cluster: [AvailabilitySlot] = []
        var columnsEnd: [Double] = []
        var clusterEnd = -Double.infinity
        func flush() {
            let count = max(1, columnsEnd.count)
            for var slot in cluster { slot.columns = count; placed.append(slot) }
            cluster = []; columnsEnd = []
        }
        for var slot in sorted {
            let end = max(slot.end, slot.start + 1)
            if !cluster.isEmpty && slot.start >= clusterEnd { flush() }
            if let free = columnsEnd.firstIndex(where: { $0 <= slot.start }) { slot.column = free; columnsEnd[free] = end }
            else { slot.column = columnsEnd.count; columnsEnd.append(end) }
            clusterEnd = cluster.isEmpty ? end : max(clusterEnd, end)
            cluster.append(slot)
        }
        if !cluster.isEmpty { flush() }
        return placed
    }
}

@MainActor struct TeamAvailabilityGrid: View {
    @ObservedObject var store: MeetingsStore
    let day: Date
    let openMeeting: (String) -> Void
    /// Nowe spotkanie w zaznaczonym czasie z osobą z kolumny (bez siebie).
    let create: (Date, Date, [String]) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("meetings.people") private var storedIDs = ""
    @State private var blocks: [AvailabilityBlock] = []
    @State private var loading = false
    @State private var problem: String?
    @State private var pickerShown = false
    @State private var search = ""
    @State private var pick: Pick?

    struct Pick: Equatable { let column: Int; var from: Double; var to: Double }
    struct PeopleGroup: Identifiable {
        let department: EmployeeDepartment
        let people: [SchedulePerson]
        var id: String { department.rawValue }
    }

    private let hour: CGFloat = 52
    private let labelWidth: CGFloat = 56
    private let columnMin: CGFloat = 150
    private let snap = 15.0
    private let maxPeople = 20
    private var calendar: Calendar { MeetingDates.calendar }

    private var selected: [String] { storedIDs.split(separator: ",").map(String.init) }
    private var columns: [SchedulePerson] {
        let byID = Dictionary(store.people.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return selected.compactMap { byID[$0] }
    }
    private var dayStart: Date { calendar.startOfDay(for: day) }
    private var dayEnd: Date { calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart.addingTimeInterval(86_400) }
    private var loadKey: String {
        "\(dayStart.timeIntervalSince1970)|\(columns.map(\.id).joined(separator: ","))|\(store.lastSync?.timeIntervalSince1970 ?? 0)"
    }
    private var groups: [PeopleGroup] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        let matching = store.people.filter { person in
            query.isEmpty || "\(person.displayName) \(person.name) \(person.surname) \(person.occupation)".lowercased().contains(query)
        }
        return EmployeeDepartment.allCases.compactMap { department in
            let people = matching.filter { $0.dept == department }
                .sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
            return people.isEmpty ? nil : PeopleGroup(department: department, people: people)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            toolbar
            if let problem { Label(problem, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
            TimelineView(.periodic(from: .now, by: 60)) { context in
                GeometryReader { geo in
                    let width = max(columnMin, (geo.size.width - labelWidth) / CGFloat(max(1, columns.count)))
                    ScrollView(.horizontal) {
                        VStack(spacing: 0) {
                            header(width: width)
                            allDayRow(width: width)
                            ScrollViewReader { proxy in
                                ScrollView(.vertical) {
                                    HStack(alignment: .top, spacing: 0) {
                                        hourLabels
                                        ForEach(Array(columns.enumerated()), id: \.element.id) { index, person in
                                            column(index: index, person: person, width: width, now: context.date)
                                        }
                                    }
                                    .frame(height: hour * 24, alignment: .topLeading)
                                }
                                .onAppear { scrollToStart(proxy) }
                                .onChange(of: dayStart) { _, _ in scrollToStart(proxy) }
                            }
                        }
                        .frame(width: labelWidth + width * CGFloat(max(1, columns.count)), height: geo.size.height, alignment: .topLeading)
                    }
                }
            }
            .background(theme.card.opacity(theme == .light ? 1 : 0.5), in: RoundedRectangle(cornerRadius: 12))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .task {
            await store.loadPeople()
            applyDefaultSelection()
        }
        .task(id: loadKey) { await load() }
    }

    // MARK: Wybór osób
    private var toolbar: some View {
        HStack(spacing: 10) {
            Button { pickerShown.toggle() } label: { Label("Osoby (\(columns.count))", systemImage: "person.2") }
                .popover(isPresented: $pickerShown, arrowEdge: .bottom) { picker }
                .help("Wybierz osoby, których plan chcesz zobaczyć")
            Text("Zajętość w planie: spotkania, eventy i nieobecności. Spotkania prywatne innych osób — „Zajęty”. Zaznacz wolny czas w kolumnie, aby zaplanować spotkanie z tą osobą.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 8)
            if loading { ProgressView().controlSize(.small) }
        }
        .controlSize(.small)
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Szukaj osoby", text: $search).textFieldStyle(.roundedBorder)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(group.department.label.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Spacer()
                                Button("Cały dział") { addDepartment(group.department) }.buttonStyle(.link).font(.caption)
                            }
                            ForEach(group.people) { person in
                                Toggle(isOn: Binding(get: { selected.contains(person.id) }, set: { on in toggle(person.id, on) })) {
                                    HStack(spacing: 6) {
                                        Text(person.displayName + (person.isSelf ? " (Ty)" : "")).lineLimit(1)
                                        if person.isSubordinate { Text("Podwładny").font(.caption2).foregroundStyle(theme.accent) }
                                    }
                                }
                                .toggleStyle(.checkbox)
                                .disabled(!selected.contains(person.id) && selected.count >= maxPeople)
                            }
                        }
                    }
                    if groups.isEmpty { Text("Brak osób do wyboru.").font(.callout).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 360)
            HStack {
                Text("Najwyżej \(maxPeople) osób naraz.").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button("Tylko ja") { setSelected(store.people.filter(\.isSelf).map(\.id)) }.buttonStyle(.link).font(.caption)
            }
        }
        .padding(14)
        .frame(width: 340)
    }

    private func setSelected(_ ids: [String]) {
        var seen = Set<String>()
        storedIDs = ids.filter { seen.insert($0).inserted }.prefix(maxPeople).joined(separator: ",")
    }
    private func toggle(_ id: String, _ on: Bool) {
        setSelected(on ? selected + [id] : selected.filter { $0 != id })
    }
    private func addDepartment(_ department: EmployeeDepartment) {
        setSelected(selected + store.people.filter { $0.dept == department }.map(\.id))
    }
    /// Pierwsze otwarcie (albo zapamiętane osoby poza zakresem): ja i mój dział, najwyżej 8 osób.
    private func applyDefaultSelection() {
        guard columns.isEmpty, let me = store.people.first(where: \.isSelf) else { return }
        let mine = store.people.filter { !$0.isSelf && $0.dept == me.dept }.prefix(7).map(\.id)
        setSelected([me.id] + mine)
    }

    private func load() async {
        let ids = columns.map(\.id)
        guard !ids.isEmpty else { blocks = []; return }
        loading = true
        defer { loading = false }
        do {
            let next = try await store.availability(ids, from: dayStart, to: dayEnd)
            guard !Task.isCancelled else { return }
            blocks = next
            problem = nil
        } catch {
            guard !Task.isCancelled else { return }
            problem = (error as? NativeFailure)?.message ?? (error is URLError ? "Brak połączenia z serwerem CRM." : "Nie udało się pobrać zajętości.")
        }
    }

    // MARK: Nagłówek i całodniowe
    private func header(width: CGFloat) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: labelWidth, height: 1)
            ForEach(columns) { person in
                HStack(spacing: 8) {
                    Text(person.initials).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                        .frame(width: 30, height: 30).background(theme.accent.opacity(0.15), in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(person.displayName + (person.isSelf ? " (Ty)" : "")).font(.callout.weight(.semibold)).lineLimit(1)
                        Text(person.occupation.isEmpty ? person.dept.label : person.occupation).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
                .frame(width: width, alignment: .leading)
            }
            if columns.isEmpty {
                Text("Wybierz osoby, których plan chcesz zobaczyć.").font(.callout).foregroundStyle(.secondary).padding(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.03))
    }

    @ViewBuilder private func allDayRow(width: CGFloat) -> some View {
        let whole = blocks.filter(\.wholeDay)
        if !whole.isEmpty {
            HStack(alignment: .top, spacing: 0) {
                Text("Cały dzień").font(.system(size: 9).weight(.medium)).foregroundStyle(.secondary)
                    .frame(width: labelWidth - 6, alignment: .trailing).padding(.trailing, 6).padding(.top, 4)
                ForEach(columns) { person in
                    VStack(spacing: 3) {
                        ForEach(whole.filter { $0.employeeId == person.id }) { block in
                            Button { open(block) } label: {
                                HStack(spacing: 4) {
                                    if !block.detailed { Image(systemName: "lock.fill").font(.system(size: 9)) }
                                    Text(block.displayTitle).font(.caption).lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .background(block.color.opacity(block.tentative ? 0.14 : 0.28), in: RoundedRectangle(cornerRadius: 5))
                                .overlay(alignment: .leading) { Rectangle().fill(block.color).frame(width: 3) }
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                            }
                            .buttonStyle(.plain)
                            .help(block.tooltip)
                        }
                    }
                    .padding(.horizontal, 2).padding(.vertical, 3)
                    .frame(width: width, alignment: .top)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.02))
        }
    }

    // MARK: Siatka
    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { h in
                Text(h == 0 ? "" : String(format: "%02d:00", h)).font(.caption2).monospacedDigit().foregroundStyle(.secondary)
                    .frame(width: labelWidth - 6, height: hour, alignment: .topTrailing)
                    .offset(y: -7)
                    .padding(.trailing, 6)
                    .id(h)
            }
        }
        .frame(width: labelWidth, height: hour * 24, alignment: .top)
        // „Chwyć i przesuń”: kolumna godzin przewija dzień (zaznaczenie w kolumnie osoby — nowe spotkanie).
        .contentShape(Rectangle())
        .grabScroll(.vertical)
        .help("Przeciągnij, żeby przesunąć godziny")
    }

    private func scrollToStart(_ proxy: ScrollViewProxy) {
        let target = calendar.isDateInToday(dayStart) ? max(0, calendar.component(.hour, from: Date()) - 2) : 7
        DispatchQueue.main.async { proxy.scrollTo(target, anchor: .top) }
    }

    private func minutes(_ date: Date) -> Double {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }

    private func slots(for person: String) -> [AvailabilitySlot] {
        let items = blocks.filter { $0.employeeId == person && !$0.wholeDay && $0.startDate < dayEnd && $0.endDate > dayStart }.map { block in
            let from = block.startDate < dayStart ? 0 : minutes(block.startDate)
            let to = block.endDate >= dayEnd ? 1440 : max(from + snap, minutes(block.endDate))
            return AvailabilitySlot(block: block, start: from, end: min(1440, to))
        }
        return AvailabilitySlot.layout(items)
    }

    private func column(index: Int, person: SchedulePerson, width: CGFloat, now: Date) -> some View {
        let today = calendar.isDate(dayStart, inSameDayAs: now)
        return ZStack(alignment: .topLeading) {
            Rectangle().fill(today ? theme.accent.opacity(0.04) : Color.clear)
            VStack(spacing: 0) {
                Color.black.opacity(0.12).frame(height: hour * 8)
                Spacer(minLength: 0)
                Color.black.opacity(0.12).frame(height: hour * 6)
            }
            ForEach(1..<24, id: \.self) { h in
                Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1).offset(y: CGFloat(h) * hour)
            }
            Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1)
            if let pick, pick.column == index {
                RoundedRectangle(cornerRadius: 5).fill(theme.accent.opacity(0.25))
                    .frame(width: max(10, width - 4), height: CGFloat((pick.to - pick.from) / 60) * hour)
                    .overlay(alignment: .topLeading) { Text("\(clock(pick.from))–\(clock(pick.to))").font(.caption2.weight(.medium)).padding(4) }
                    .offset(x: 2, y: CGFloat(pick.from / 60) * hour)
                    .allowsHitTesting(false)
            }
            ForEach(slots(for: person.id)) { slot in block(slot, width: width) }
            if today {
                Rectangle().fill(Color.red).frame(height: 2)
                    .offset(y: CGFloat(minutes(now) / 60) * hour - 1)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: width, height: hour * 24, alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(createGesture(index: index))
    }

    private func block(_ slot: AvailabilitySlot, width: CGFloat) -> some View {
        let item = slot.block
        let lane = width / CGFloat(max(1, slot.columns))
        let height = max(18, CGFloat((slot.end - slot.start) / 60) * hour - 2)
        let compact = height < 38
        return VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                if !item.detailed { Image(systemName: "lock.fill").font(.system(size: 9)) }
                Text(item.displayTitle).font(.caption.weight(.semibold)).lineLimit(1)
                if compact { Text(MeetingDates.time(item.startDate)).font(.caption2).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
            }
            if !compact {
                Text(item.timeText + (item.tentative ? " · niepotwierdzone" : "")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                if height > 58, let subtitle = item.subtitle, !subtitle.isEmpty {
                    Label(subtitle, systemImage: "mappin").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .foregroundStyle(theme.text)
        .padding(.leading, 7).padding(.trailing, 4).padding(.vertical, 3)
        .frame(width: max(12, lane - 4), height: height, alignment: .topLeading)
        .background {
            ZStack {
                item.color.opacity(item.tentative ? 0.14 : 0.3)
                if item.tentative { MeetingHatch().stroke(Color.white.opacity(0.1), lineWidth: 4) }
            }
        }
        .overlay(alignment: .leading) { Rectangle().fill(item.color).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .offset(x: CGFloat(slot.column) * lane + 2, y: CGFloat(slot.start / 60) * hour + 1)
        .onTapGesture { open(item) }
        .help(item.tooltip)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.displayTitle), \(item.timeText)")
    }

    private func open(_ block: AvailabilityBlock) {
        guard block.detailed, let id = block.itemId else { return }
        switch block.kind {
        case "meeting": openMeeting(id)
        case "event", "phase": state.showEvent(id)
        default: break
        }
    }

    private func clock(_ minutes: Double) -> String { String(format: "%02d:%02d", Int(minutes) / 60 % 24, Int(minutes) % 60) }
    private func minute(at y: CGFloat) -> Double { max(0, min(1440 - snap, (Double(y / hour) * 60 / snap).rounded(.down) * snap)) }

    private func createGesture(index: Int) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                let a = minute(at: value.startLocation.y)
                let b = minute(at: value.location.y)
                pick = Pick(column: index, from: min(a, b), to: max(a, b) + snap)
            }
            .onEnded { _ in
                guard let current = pick, current.column < columns.count else { pick = nil; return }
                pick = nil
                let single = current.to - current.from <= snap
                let from = single ? (current.from / 30).rounded(.down) * 30 : current.from
                let to = single ? from + 60 : current.to
                guard let start = calendar.date(byAdding: .minute, value: Int(from), to: dayStart),
                      let end = calendar.date(byAdding: .minute, value: Int(to), to: dayStart) else { return }
                let person = columns[current.column]
                create(start, end, person.isSelf ? [] : [person.id])
            }
    }
}
