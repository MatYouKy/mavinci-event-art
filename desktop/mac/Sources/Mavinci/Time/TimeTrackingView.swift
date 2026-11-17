import SwiftUI

// MARK: Czas pracy — 1:1 z `/crm/time-tracking`: nagłówek z wymiarem czasu pracy w miesiącu, dla administratora przełącznik
// Dashboard / Lista, rozliczenie czasu pracy i wynagrodzenie z umów, licznik (start/stop), statystyki i moje wpisy z edycją,
// historią zmian, rozmowami „do wyjaśnienia” i usuwaniem. Strona pracownika: `WorkTimeEmployeeView`.

/// Czynności na wpisie czasu (wiersz listy, tabela, menu kontekstowe). `nil` — czynność niedostępna w tym widoku.
struct WorkTimeEntryActions {
    var edit: ((WorkTimeEntry) -> Void)?
    var history: ((WorkTimeEntry) -> Void)?
    var discuss: (WorkTimeEntry) -> Void
    var remove: ((WorkTimeEntry) -> Void)?
    var openTask: (String) -> Void
    var openEvent: (String) -> Void
}

let workTimeGreen = CrmTheme.rgb(0x4ade80)
let workTimeOrange = CrmTheme.rgb(0xfb923c)
let workTimeRed = CrmTheme.rgb(0xf87171)

@MainActor struct TimeTrackingView: View {
    @ObservedObject var store: TimeTrackingStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("timeTracking.adminView") private var adminView = "dashboard"
    @State private var startingTimer = false
    @State private var editing: WorkTimeEntry?
    @State private var historyFor: WorkTimeEntry?
    @State private var removing: WorkTimeEntry?
    @State private var discussion: WorkTimeDiscussionTarget?

    private var home: WorkTimeHome? { store.home }
    private var isAdmin: Bool { home?.me.isAdmin ?? false }
    private var showDashboard: Bool { isAdmin && adminView == "dashboard" }

    var body: some View {
        Group {
            if let id = store.openedEmployeeID {
                WorkTimeEmployeeView(store: store, employeeID: id).id(id)
            } else {
                main
            }
        }
        .task(id: state.employee?.id) { await store.loadHome() }
        .task {
            // Rozmowy o wpisach odświeżane co 20 s (jak `useTimeEntryDiscussions`).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                await store.refreshDiscussions()
            }
        }
    }

    private var actions: WorkTimeEntryActions {
        WorkTimeEntryActions(
            edit: { editing = $0 },
            history: { historyFor = $0 },
            discuss: { discussion = WorkTimeDiscussionTarget(id: $0.id, title: $0.title.nonEmpty ?? "Rozmowa o czasie pracy") },
            remove: { removing = $0 },
            openTask: { state.showTask($0) },
            openEvent: { state.showEvent($0) }
        )
    }

    private var main: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let home {
                    if !showDashboard {
                        WorkTimeSettlementCard(store: store, employeeID: home.me.id, dateTo: nil).id("settlement-\(home.me.id)")
                    }
                    WorkTimeEarningsCard(store: store, employeeID: home.me.id).id("earnings-\(home.me.id)")
                    if showDashboard {
                        WorkTimeDashboardView(store: store)
                    } else {
                        timer(home)
                        stats(home)
                        entryList(home)
                    }
                } else if let error = store.homeError {
                    ContentUnavailableView {
                        Label("Czas pracy", systemImage: "clock")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadHome() } }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .navigationTitle("Czas pracy")
        .navigationSubtitle(home.map { showDashboard ? "Raport zespołu" : "Wpisów: \($0.entries.count)" } ?? "")
        .sheet(isPresented: $startingTimer) {
            if let home {
                WorkTimeStartSheet(store: store, employeeID: home.me.id, tasks: home.tasks)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: $editing) { entry in
            WorkTimeEditSheet(store: store, entry: entry)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $historyFor) { entry in
            WorkTimeHistorySheet(store: store, entry: entry)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $discussion) { target in
            WorkTimeDiscussionSheet(store: store, target: target, isAdmin: isAdmin)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć wpis czasu?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let entry = removing {
                Button("Usuń", role: .destructive) { Task { await store.run("Usuwanie wpisu…", "delete", ["id": .string(entry.id)]) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno chcesz usunąć ten wpis czasu?") }
        .onAppear(perform: openFocused)
        .onChange(of: store.threads) { openFocused() }
        .onChange(of: store.focusDiscussion) { openFocused() }
    }

    /// Rozmowa wskazana w powiadomieniu (`?discussion=<wpis>`).
    private func openFocused() {
        guard let id = store.focusDiscussion, store.openedEmployeeID == nil, let thread = store.thread(for: id) else { return }
        store.focusDiscussion = nil
        discussion = WorkTimeDiscussionTarget(id: id, title: thread.title)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Śledzenie czasu pracy", systemImage: "clock").font(.title2.weight(.light))
                Text(showDashboard ? "Raport czasu pracy zespołu" : "Loguj swój czas pracy i zarządzaj wpisami").foregroundStyle(.secondary)
                if let norm = home?.norm {
                    (Text(norm.month).fontWeight(.semibold) + Text(": \(norm.sentence)")
                        + Text(norm.holidays.isEmpty ? "" : " · święta: \(norm.holidays)").foregroundStyle(.secondary))
                        .font(.callout)
                        .help("Wymiar czasu pracy pełnego etatu w bieżącym miesiącu (dni ustawowo wolne z kalendarza świąt)")
                }
            }
            Spacer()
            if store.loadingHome { ProgressView().controlSize(.small) }
            if isAdmin {
                Picker("Widok", selection: $adminView) {
                    Label("Dashboard", systemImage: "chart.bar").tag("dashboard")
                    Label("Lista", systemImage: "list.bullet").tag("list")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
        }
    }

    @ViewBuilder private func timer(_ home: WorkTimeHome) -> some View {
        if let active = home.active {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Circle().fill(workTimeGreen).frame(width: 8, height: 8)
                        Text("Timer aktywny").font(.callout.weight(.semibold)).foregroundStyle(workTimeGreen)
                    }
                    HStack(spacing: 8) {
                        Text(active.label).font(.title3.weight(.semibold))
                        if let task = active.taskId {
                            Button { state.showTask(task) } label: { Label("Zadanie", systemImage: "arrow.up.right.square") }
                                .buttonStyle(.link).help("Otwórz zadanie")
                        }
                    }
                    if !active.description.isEmpty { Text(active.description).foregroundStyle(.secondary) }
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(WorkTimeFormat.clock(since: active.startDate, now: context.date))
                        .font(.system(size: 34, weight: .light, design: .monospaced))
                }
                Button {
                    Task { await store.run("Zatrzymywanie timera…", "stop", ["id": .string(active.id)]) }
                } label: { Label("Zatrzymaj", systemImage: "stop.fill") }
                    .buttonStyle(.borderedProminent).tint(.red).controlSize(.large)
            }
            .padding(18)
            .background(workTimeGreen.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(workTimeGreen.opacity(0.35), lineWidth: 1))
        } else {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Brak aktywnego timera").font(.title3)
                    Text("Rozpocznij nowy timer lub dodaj wpis ręcznie").foregroundStyle(.secondary)
                }
                Spacer()
                Button { startingTimer = true } label: { Label("Rozpocznij timer", systemImage: "play.fill") }
                    .buttonStyle(.borderedProminent).controlSize(.large).disabled(!state.canWrite)
            }
            .padding(18)
            .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func stats(_ home: WorkTimeHome) -> some View {
        let entries = home.entries
        let total = entries.reduce(0) { $0 + ($1.minutes ?? 0) }
        let billable = entries.filter(\.billable).reduce(0) { $0 + ($1.minutes ?? 0) }
        // Jak w CRM: łączny czas dzielony przez liczbę wpisów / 5 (co najmniej 1).
        let average = entries.isEmpty ? 0 : (total / max(1, Double(entries.count) / 5)).rounded(.down)
        return HStack(spacing: 12) {
            WorkTimeTile(title: "Łącznie", value: WorkTimeFormat.minutes(total), symbol: "clock")
            WorkTimeTile(title: "Płatne", value: WorkTimeFormat.minutes(billable), symbol: "dollarsign.circle")
            WorkTimeTile(title: "Wpisów", value: "\(entries.count)", symbol: "calendar")
            WorkTimeTile(title: "Śr. dziennie", value: WorkTimeFormat.minutes(average), symbol: "checkmark.circle")
        }
    }

    private func entryList(_ home: WorkTimeHome) -> some View {
        LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(home.entries) { entry in
                WorkTimeEntryRow(entry: entry, thread: store.thread(for: entry.id), isAdmin: isAdmin, showEmployee: false, actions: actions)
            }
            if home.entries.isEmpty {
                ContentUnavailableView("Brak wpisów czasu pracy", systemImage: "clock").frame(maxWidth: .infinity).padding(30)
            }
        }
    }
}

/// Wiersz wpisu czasu: tytuł (zadanie), „Płatne”, opis, wydarzenie, data i godziny, czas trwania, stawka oraz czynności.
@MainActor struct WorkTimeEntryRow: View {
    let entry: WorkTimeEntry
    let thread: WorkTimeThread?
    let isAdmin: Bool
    let showEmployee: Bool
    let actions: WorkTimeEntryActions
    @Environment(\.crmTheme) private var theme

    private var canEdit: Bool { actions.edit != nil && entry.end != nil }
    private var canHistory: Bool { actions.history != nil && isAdmin && entry.edits > 0 }
    private var hasMenu: Bool { WorkTimeEntryMenuItems.available(entry, thread: thread, isAdmin: isAdmin, actions: actions) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(entry.label).font(.headline)
                    if let task = entry.taskId {
                        Button { actions.openTask(task) } label: { Label("Przejdź", systemImage: "arrow.up.right.square") }
                            .buttonStyle(.link).font(.caption).help("Otwórz zadanie")
                    }
                    if entry.billable { WorkTimePill(text: "Płatne", color: workTimeGreen) }
                    if entry.isActive { WorkTimePill(text: "W trakcie", color: workTimeGreen) }
                    if showEmployee && !entry.employeeName.isEmpty { WorkTimePill(text: entry.employeeName, color: theme.accent) }
                }
                if !entry.description.isEmpty { Text(entry.description).foregroundStyle(.secondary).textSelection(.enabled) }
                if !entry.eventName.isEmpty {
                    if let event = entry.eventId {
                        Button { actions.openEvent(event) } label: { Text("Wydarzenie: \(entry.eventName)") }.buttonStyle(.link).font(.callout)
                    } else {
                        Text("Wydarzenie: \(entry.eventName)").font(.callout).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 14) {
                    Label(WorkTimeFormat.shortDate(entry.startDate), systemImage: "calendar")
                    Label(WorkTimeFormat.span(entry), systemImage: "clock")
                    Text(WorkTimeFormat.minutes(entry.minutes)).fontWeight(.semibold).foregroundStyle(theme.accent)
                    if let rate = entry.rateText { Label(rate, systemImage: "dollarsign.circle") }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if let thread {
                    Button { actions.discuss(entry) } label: {
                        Label("\(thread.stateLabel) · \(thread.messages.count)", systemImage: "bubble.left")
                    }
                    .buttonStyle(.bordered).controlSize(.small).tint(thread.resolved ? workTimeGreen : workTimeOrange)
                }
                if canEdit, let edit = actions.edit {
                    Button { edit(entry) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                }
                if canHistory, let history = actions.history {
                    Button { history(entry) } label: { Label("\(entry.edits)", systemImage: "clock.arrow.circlepath") }
                        .buttonStyle(.borderless).help("Historia zmian")
                }
                if hasMenu {
                    Menu { menu } label: { Image(systemName: "ellipsis") }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                }
            }
        }
        .padding(14)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
        .contextMenu { if hasMenu { menu } }
    }

    private var menu: some View { WorkTimeEntryMenuItems(entry: entry, thread: thread, isAdmin: isAdmin, actions: actions) }
}

/// Pozycje menu wpisu (wiersz, tabela, menu kontekstowe): wątek, edycja, historia zmian, usuwanie.
@MainActor struct WorkTimeEntryMenuItems: View {
    let entry: WorkTimeEntry
    let thread: WorkTimeThread?
    let isAdmin: Bool
    let actions: WorkTimeEntryActions

    static func available(_ entry: WorkTimeEntry, thread: WorkTimeThread?, isAdmin: Bool, actions: WorkTimeEntryActions) -> Bool {
        isAdmin || thread != nil || (actions.edit != nil && entry.end != nil) || (actions.history != nil && isAdmin && entry.edits > 0) || actions.remove != nil
    }

    var body: some View {
        if isAdmin || thread != nil {
            Button(thread.map { "Otwórz wątek · \($0.stateLabel) (\($0.messages.count))" } ?? "Rozpocznij wątek", systemImage: "bubble.left") { actions.discuss(entry) }
        }
        if entry.end != nil, let edit = actions.edit { Button("Edytuj", systemImage: "pencil") { edit(entry) } }
        if isAdmin && entry.edits > 0, let history = actions.history { Button("Historia zmian", systemImage: "clock.arrow.circlepath") { history(entry) } }
        if let remove = actions.remove {
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { remove(entry) }
        }
    }
}
