import SwiftUI

// MARK: Czas pracy pracownika — 1:1 z `/crm/time-tracking/[employeeId]`: rozliczenie czasu pracy i wynagrodzenie z umów,
// nagłówek pracownika, aktualnie naliczany czas (licznik na żywo), okres, kafelki, czas według zadań, wszystkie wpisy
// (lista dniami albo tabela) z rozmowami i usuwaniem (administrator) oraz historia zmian i usunięć.

@MainActor struct WorkTimeEmployeeView: View {
    @ObservedObject var store: TimeTrackingStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("timeTracking.entriesMode") private var mode = "list"
    @State private var period = WorkTimePeriod(kind: WorkTimePeriodKind.saved)
    @State private var showHistory = false
    @State private var deletedOnly = false
    @State private var removing: WorkTimeEntry?
    @State private var historyFor: WorkTimeEntry?
    @State private var discussion: WorkTimeDiscussionTarget?

    private var page: WorkTimeEmployeePage? { store.pages[employeeID] }
    private var isAdmin: Bool { page?.me.isAdmin ?? store.isAdmin }

    /// Bez edycji (jak w CRM); usuwanie tylko dla administratora.
    private var actions: WorkTimeEntryActions {
        var value = WorkTimeEntryActions(
            edit: nil,
            history: { historyFor = $0 },
            discuss: { discussion = WorkTimeDiscussionTarget(id: $0.id, title: $0.title.nonEmpty ?? "Rozmowa o czasie pracy") },
            remove: nil,
            openTask: { state.showTask($0) },
            openEvent: { state.showEvent($0) }
        )
        if isAdmin { value.remove = { removing = $0 } }
        return value
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Button { store.openedEmployeeID = nil } label: { Label("Powrót do raportu", systemImage: "arrow.left") }.buttonStyle(.link)
                WorkTimeSettlementCard(store: store, employeeID: employeeID, dateTo: period.to).id("settlement-\(employeeID)")
                WorkTimeEarningsCard(store: store, employeeID: employeeID).id("earnings-\(employeeID)")
                if let page {
                    header(page)
                    activeBlock(page)
                    WorkTimePeriodBar(period: $period) { EmptyView() }
                        .padding(14).background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                    tiles(page)
                    taskStats(page)
                    entries(page)
                    history(page)
                } else if let error = store.pageErrors[employeeID] {
                    ContentUnavailableView {
                        Label("Czas pracy", systemImage: "clock")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadEmployee(employeeID, from: period.from, to: period.to) } }
                        Button("Powrót do raportu") { store.openedEmployeeID = nil }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .navigationTitle(page?.employee.name ?? "Czas pracy")
        .navigationSubtitle(page.map { "Wpisów: \($0.entries.count) · \(period.label)" } ?? "")
        .task(id: "\(employeeID)|\(period.from)|\(period.to)|\(state.employee?.id ?? "")") {
            await store.loadEmployee(employeeID, from: period.from, to: period.to)
        }
        .sheet(item: $historyFor) { entry in
            WorkTimeHistorySheet(store: store, entry: entry)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $discussion) { target in
            WorkTimeDiscussionSheet(store: store, target: target, isAdmin: isAdmin)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć wpis czasu pracy?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let entry = removing {
                Button("Usuń", role: .destructive) {
                    Task { await store.run("Usuwanie wpisu…", "delete", ["id": .string(entry.id)], success: "Wpis został usunięty") }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno chcesz usunąć ten wpis czasu pracy? Ta operacja jest nieodwracalna.") }
        .onAppear(perform: openFocused)
        .onChange(of: store.threads) { openFocused() }
        .onChange(of: store.focusDiscussion) { openFocused() }
    }

    /// Rozmowa wskazana w powiadomieniu — także o wpisie spoza wybranego okresu.
    private func openFocused() {
        guard let id = store.focusDiscussion, store.openedEmployeeID == employeeID, let thread = store.thread(for: id) else { return }
        store.focusDiscussion = nil
        discussion = WorkTimeDiscussionTarget(id: id, title: thread.title)
    }

    private func header(_ page: WorkTimeEmployeePage) -> some View {
        HStack(alignment: .center, spacing: 16) {
            EmployeeAvatarView(name: page.employee.name, url: page.employee.avatarUrl, crop: page.employee.avatar, size: 80)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 10) {
                    Text(page.employee.name).font(.title.weight(.light))
                    if page.active != nil { WorkTimePill(text: "Aktywny licznik", color: workTimeGreen) }
                }
                HStack(spacing: 14) {
                    if !page.employee.email.isEmpty { Label(page.employee.email, systemImage: "envelope").textSelection(.enabled) }
                    if !page.employee.phone.isEmpty { Label(page.employee.phone, systemImage: "phone").textSelection(.enabled) }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if store.pageErrors[employeeID] == nil && page.employee.id == employeeID {
                Button("Karta pracownika", systemImage: "person.crop.circle") { state.showEmployee(employeeID) }
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func activeBlock(_ page: WorkTimeEmployeePage) -> some View {
        if let active = page.active {
            VStack(alignment: .leading, spacing: 12) {
                Label("Aktualnie naliczany czas pracy", systemImage: "clock").font(.headline).foregroundStyle(workTimeGreen)
                HStack(alignment: .top, spacing: 28) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Zadanie").font(.caption).foregroundStyle(.secondary)
                        Text(active.label).font(.title3.weight(.semibold))
                        if !active.eventName.isEmpty { Text("Wydarzenie: \(active.eventName)").font(.callout).foregroundStyle(.secondary) }
                        if !active.description.isEmpty { Text(active.description).font(.callout).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Rozpoczęto").font(.caption).foregroundStyle(.secondary)
                        Text(WorkTimeFormat.dateTimeSeconds(active.start)).font(.callout)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Czas trwania").font(.caption).foregroundStyle(.secondary)
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text(WorkTimeFormat.clock(since: active.startDate, now: context.date))
                                .font(.system(size: 28, weight: .light, design: .monospaced)).foregroundStyle(workTimeGreen)
                        }
                        if let rate = active.rateText { Text("Stawka: \(rate)").font(.caption).foregroundStyle(.secondary) }
                        if active.billable { WorkTimePill(text: "Płatne", color: workTimeGreen) }
                    }
                }
            }
            .padding(18)
            .background(workTimeGreen.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(workTimeGreen.opacity(0.35), lineWidth: 1))
        }
    }

    private func tiles(_ page: WorkTimeEmployeePage) -> some View {
        HStack(spacing: 12) {
            WorkTimeTile(title: "Łączny czas", value: WorkTimeFormat.minutes(page.totals.minutes), symbol: "clock")
            WorkTimeTile(title: "Rozliczalny", value: WorkTimeFormat.minutes(page.totals.billableMinutes), symbol: "dollarsign.circle")
            WorkTimeTile(title: "Wpisy bez umowy — wartość orientacyjna", value: WorkTimeFormat.money(page.totals.revenue), symbol: "chart.line.uptrend.xyaxis")
            WorkTimeTile(title: "Wpisów", value: "\(page.totals.entries ?? page.entries.count)", symbol: "calendar")
        }
    }

    private func taskStats(_ page: WorkTimeEmployeePage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Czas pracy według zadań", systemImage: "tag").font(.headline)
            if page.tasks.isEmpty {
                Text("Brak danych dla wybranego okresu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(20)
            }
            ForEach(page.tasks) { stat in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(stat.title).font(.callout.weight(.semibold))
                            if !stat.eventName.isEmpty { Text("Wydarzenie: \(stat.eventName)").font(.caption).foregroundStyle(.secondary) }
                            Text("\(stat.entries) wpisów • Ostatnio: \(MeetingDates.parse(stat.last).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(WorkTimeFormat.minutes(stat.minutes)).font(.callout.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
                    }
                    WorkTimeBar(fraction: page.totals.minutes > 0 ? stat.minutes / page.totals.minutes : 0)
                }
                .padding(10)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    /// Wpisy pogrupowane dniami (czas polski), w kolejności od najnowszych.
    private func days(_ entries: [WorkTimeEntry]) -> [(day: String, entries: [WorkTimeEntry])] {
        var order: [String] = []
        var groups: [String: [WorkTimeEntry]] = [:]
        for entry in entries {
            if groups[entry.day] == nil { order.append(entry.day) }
            groups[entry.day, default: []].append(entry)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    private func entries(_ page: WorkTimeEmployeePage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Wszystkie wpisy czasu", systemImage: "clock").font(.headline)
                Spacer()
                Picker("Widok", selection: $mode) {
                    Label("Lista", systemImage: "list.bullet").tag("list")
                    Label("Tabela", systemImage: "tablecells").tag("table")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            if page.entries.isEmpty {
                Text("Brak wpisów czasu dla wybranego okresu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24)
            } else if mode == "table" {
                table(page)
            } else {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(days(page.entries), id: \.day) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(DayDates.parse(group.day).map { MeetingDates.format($0, "EEEE, d MMMM yyyy") } ?? group.day)
                                    .font(.callout.weight(.semibold))
                                Spacer()
                                Text("\(WorkTimeFormat.minutes(group.entries.reduce(0) { $0 + ($1.minutes ?? 0) })) · Wpisy: \(group.entries.count)")
                                    .font(.callout).foregroundStyle(.secondary)
                            }
                            ForEach(group.entries) { entry in
                                WorkTimeEntryRow(entry: entry, thread: store.thread(for: entry.id), isAdmin: isAdmin, showEmployee: false, actions: actions)
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func table(_ page: WorkTimeEmployeePage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Wyświetlanie \(page.entries.count) \(page.entries.count == 1 ? "wpisu" : "wpisów")").font(.caption).foregroundStyle(.secondary)
            Table(page.entries) {
                TableColumn("Data") { (entry: WorkTimeEntry) in Text(entry.startDate.map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "") }
                    .width(min: 80, ideal: 90)
                TableColumn("Godziny") { (entry: WorkTimeEntry) in Text(WorkTimeFormat.span(entry)).monospacedDigit() }
                    .width(min: 100, ideal: 120)
                TableColumn("Zadanie / Tytuł") { (entry: WorkTimeEntry) in Text(entry.label).help(entry.label) }
                    .width(min: 140, ideal: 220)
                TableColumn("Wydarzenie") { (entry: WorkTimeEntry) in Text(entry.eventName.nonEmpty ?? "—").foregroundStyle(.secondary) }
                    .width(min: 100, ideal: 160)
                TableColumn("Opis") { (entry: WorkTimeEntry) in Text(entry.description).lineLimit(1).help(entry.description) }
                    .width(min: 100, ideal: 200)
                TableColumn("Czas") { (entry: WorkTimeEntry) in Text(WorkTimeFormat.minutes(entry.minutes)).monospacedDigit() }
                    .width(min: 60, ideal: 70)
                TableColumn("Stawka") { (entry: WorkTimeEntry) in Text(entry.rateText ?? "-") }
                    .width(min: 70, ideal: 120)
                TableColumn("Status") { (entry: WorkTimeEntry) in
                    WorkTimePill(text: entry.billable ? "Płatne" : "Niepłatne", color: entry.billable ? workTimeGreen : Color.secondary)
                }
                .width(min: 70, ideal: 80)
                TableColumn("Akcje") { (entry: WorkTimeEntry) in tableActions(entry) }
                    .width(min: 120, ideal: 170)
            }
            .frame(height: min(640, CGFloat(page.entries.count) * 28 + 36))
        }
    }

    private func tableActions(_ entry: WorkTimeEntry) -> some View {
        let thread = store.thread(for: entry.id)
        return HStack(spacing: 6) {
            if let thread {
                Button { actions.discuss(entry) } label: { Label("\(thread.messages.count)", systemImage: "bubble.left") }
                    .buttonStyle(.borderless).foregroundStyle(thread.resolved ? workTimeGreen : workTimeOrange).help(thread.stateLabel)
            }
            if isAdmin && entry.edits > 0 {
                Button { historyFor = entry } label: { Label("\(entry.edits)", systemImage: "clock.arrow.circlepath") }
                    .buttonStyle(.borderless).help("Historia zmian")
            }
            if WorkTimeEntryMenuItems.available(entry, thread: thread, isAdmin: isAdmin, actions: actions) {
                Menu { WorkTimeEntryMenuItems(entry: entry, thread: thread, isAdmin: isAdmin, actions: actions) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
        }
    }

    @ViewBuilder private func history(_ page: WorkTimeEmployeePage) -> some View {
        if !page.history.isEmpty {
            let shown = deletedOnly ? page.history.filter { $0.action == "deleted" } : page.history
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Label("Historia zmian i usunięć", systemImage: "clock.arrow.circlepath").font(.headline)
                    if isAdmin { Text("(widok administratora)").font(.callout).foregroundStyle(.secondary) }
                    Spacer()
                    if isAdmin { Toggle("Tylko usunięte", isOn: $deletedOnly).toggleStyle(.checkbox) }
                    Button { showHistory.toggle() } label: {
                        Label(showHistory ? "Ukryj" : "Pokaż (\(shown.count))", systemImage: showHistory ? "chevron.up" : "chevron.down")
                    }
                }
                if showHistory {
                    ForEach(shown) { change in
                        WorkTimeChangeRow(change: change, you: !isAdmin && change.actorId == page.me.id, showTitle: true)
                    }
                    if shown.isEmpty {
                        Text(deletedOnly ? "Brak usuniętych wpisów" : "Brak historii zmian dla wybranego okresu")
                            .foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(20)
                    }
                }
            }
            .padding(16)
            .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
