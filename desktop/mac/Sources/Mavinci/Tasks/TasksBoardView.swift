import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Tablice zadań — 1:1 z CRM: „Zadania firmowe” (`/crm/tasks`) i „Moja tablica zadań” (`/crm/tasks/mine`).
// Kolumny Do zrobienia → Zakończone, karty jak `TaskCard`, przeciąganie z automatycznym licznikiem czasu, wyszukiwanie po tytule,
// formularz zadania, szczegóły w panelu bocznym jak karta zadania w CRM: osoby (przypisz się, wypisz się, dodaj i usuń osobę),
// pliki (dodaj, usuń / odlinkuj), komentarze, edycja.

struct TaskEditRequest: Identifiable {
    let id = UUID()
    var task: BoardTask?
    var column: BoardColumnKind = .todo
}

@MainActor struct TasksBoardView: View {
    @ObservedObject var store: TasksStore
    /// Tablica osadzona w karcie wydarzenia: własny pasek (bez paska okna) i panel szczegółów obok kolumn.
    var embedded = false
    @EnvironmentObject private var state: Workspace
    /// Nawigacja okna, w którym jest widok (inne okna mają własną).
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var selectedID: String?
    @State private var inspectorShown = false
    @State private var editor: TaskEditRequest?
    @State private var deleting: BoardTask?
    @State private var switching: BoardTask?
    @State private var stopping: (task: BoardTask, column: BoardColumnKind)?
    @State private var targeted: BoardColumnKind?

    private var board: TaskBoardKind { store.board }
    private var canCreate: Bool { store.access?.canCreate ?? (board == .mine) }
    private var canManage: Bool { store.access?.canManage ?? (board == .mine) }
    private var canMove: Bool { store.access?.canMove ?? (board == .mine) }
    private var query: String { search.trimmingCharacters(in: .whitespaces).lowercased() }
    private var visible: [BoardTask] { query.isEmpty ? store.tasks : store.tasks.filter { $0.title.lowercased().contains(query) || $0.titleLabel.lowercased().contains(query) } }

    var body: some View {
        if embedded { shared(embeddedLayout) } else { shared(windowLayout) }
    }

    private var inspectorPanel: some View {
        TaskInspector(task: store.task(selectedID), store: store, canManage: canManage, canMove: canMove,
                      edit: { editor = TaskEditRequest(task: $0, column: $0.column) }, remove: { deleting = $0 }, start: startTimer)
    }

    /// Karta wydarzenia: tytuł „Zadania wydarzenia”, wyszukiwanie, dodawanie i szczegóły zadania w panelu po prawej.
    private var embeddedLayout: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(board.title).font(.title3.weight(.light))
                Text(store.syncing && store.tasks.isEmpty ? "Wczytywanie zadań…" : "\(store.tasks.count) zadań").font(.callout).foregroundStyle(.secondary)
                Spacer()
                TextField("Szukaj zadania po tytule…", text: $search).textFieldStyle(.roundedBorder).frame(width: 240)
                if canCreate {
                    Button { editor = TaskEditRequest() } label: { Label("Dodaj zadanie", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
                Button { inspectorShown.toggle() } label: { Image(systemName: "sidebar.trailing") }.help("Pokaż lub ukryj szczegóły zadania")
                Button { Task { await store.sync(force: true) } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież zadania").disabled(store.syncing)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            statusBar
            HStack(spacing: 0) {
                content.frame(maxWidth: .infinity, maxHeight: .infinity)
                if inspectorShown {
                    Divider()
                    inspectorPanel.frame(width: 360).background(theme.page)
                }
            }
        }
    }

    private var windowLayout: some View {
        VStack(spacing: 0) {
            statusBar
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(board.title)
        .navigationSubtitle(store.syncing && store.tasks.isEmpty ? "Wczytywanie zadań…" : "\(store.tasks.count) zadań")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj zadania po tytule…")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if canCreate {
                    Button { editor = TaskEditRequest() } label: { Label("Nowe zadanie", systemImage: "plus") }
                        .help("Nowe zadanie (⌘N)").keyboardShortcut("n")
                }
                Button { inspectorShown.toggle() } label: { Label("Szczegóły", systemImage: "sidebar.trailing") }
                    .help("Pokaż lub ukryj szczegóły zadania")
            }
        }
        .inspector(isPresented: $inspectorShown) {
            inspectorPanel
                .inspectorColumnWidth(min: 300, ideal: 370, max: 520)
                .background(theme.page)
        }
    }

    /// Arkusze, potwierdzenia i odświeżanie — wspólne dla tablicy w oknie i w karcie wydarzenia.
    private func shared<V: View>(_ base: V) -> some View {
        base
        .sheet(item: $editor) { request in
            TaskEditorSheet(store: store, request: request) { id in selectedID = id }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń zadanie", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let task = deleting {
                Button("Usuń", role: .destructive) {
                    Task { if await store.delete(task), selectedID == task.id { selectedID = nil } }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Czy na pewno chcesz usunąć to zadanie? Usunięte zostaną również wszystkie powiązane wpisy czasu pracy. Ta operacja jest nieodwracalna.")
        }
        .confirmationDialog("Timer już aktywny", isPresented: Binding(get: { switching != nil }, set: { if !$0 { switching = nil } }), titleVisibility: .visible) {
            if let task = switching {
                Button("Zatrzymaj poprzedni i rozpocznij nowy") { Task { await store.timer("switch", task: task) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Aktualnie pracujesz nad: \(store.timer?.title ?? "Bez nazwy")\(store.timer?.started.map { " (od \(MeetingDates.time($0)))" } ?? ""). Chcesz rozpocząć: \(switching?.titleLabel ?? "").")
        }
        .confirmationDialog("Zatrzymać czas pracy?", isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible) {
            if let pending = stopping {
                Button("Zatrzymaj licznik") {
                    Task { await store.timer("stop"); await store.move(pending.task, to: pending.column, working: false, startTimer: false) }
                }
                Button("Nie zatrzymuj") { Task { await store.move(pending.task, to: pending.column, working: false, startTimer: false) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Zadanie jest przenoszone do kolejnego etapu. Czy chcesz zatrzymać licznik czasu?")
        }
        .task(id: state.employee?.id) {
            if store.tasks.isEmpty { await store.backgroundSync() }
            // Zmiany innych osób (przeniesienia, przypisania, komentarze) — co 30 s, tylko zmienione koszyki.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                await store.backgroundSync()
            }
        }
        .onAppear { reveal() }
        .onChange(of: nav.focusToken) { _, _ in reveal() }
        .onChange(of: store.focusID) { _, _ in reveal() }
        .onChange(of: store.lastSync) { _, _ in reveal() }
        .onChange(of: selectedID) { _, id in if id != nil { inspectorShown = true } }
    }

    // MARK: Pasek stanu (licznik czasu, wyniki wyszukiwania)
    @ViewBuilder private var statusBar: some View {
        if store.timer != nil || !query.isEmpty {
            HStack(spacing: 10) {
                if let timer = store.timer {
                    Image(systemName: "clock.fill").foregroundStyle(CrmTheme.rgb(0x4ade80)).symbolEffect(.pulse)
                    Text("Pracujesz nad: ").foregroundStyle(.secondary) + Text(timer.title).fontWeight(.semibold)
                    if let started = timer.started { Text("od \(MeetingDates.time(started))").foregroundStyle(.secondary) }
                    Button("Zatrzymaj") { Task { await store.timer("stop") } }.controlSize(.small)
                }
                Spacer(minLength: 8)
                if !query.isEmpty {
                    Text(visible.isEmpty ? "Nie znaleziono zadań pasujących do wpisanego tytułu."
                         : "Wyniki: \(visible.count) z \(store.tasks.count) zadań we wszystkich kolumnach")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.callout)
            .padding(.horizontal, 14).padding(.vertical, 7)
        }
    }

    @ViewBuilder private var content: some View {
        if store.tasks.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label(board.title, systemImage: "checklist")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie zadań…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            GeometryReader { geo in
                let spacing: CGFloat = 12
                let width = max(250, (geo.size.width - 28 - spacing * 3) / 4)
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: spacing) {
                        ForEach(BoardColumnKind.allCases) { column in
                            columnView(column, width: width, height: max(220, geo.size.height - 14))
                        }
                    }
                    .padding(.horizontal, 14).padding(.bottom, 8)
                }
            }
        }
    }

    private func columnView(_ column: BoardColumnKind, width: CGFloat, height: CGFloat) -> some View {
        let items = visible.filter { $0.column == column }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle().fill(column.color).frame(width: 8, height: 8)
                Text(column.label(board)).font(.callout.weight(.semibold))
                Spacer()
                Text("\(items.count)").font(.callout).foregroundStyle(.secondary).monospacedDigit()
                if canCreate {
                    Button { editor = TaskEditRequest(column: column) } label: { Image(systemName: "plus") }
                        .buttonStyle(.borderless).foregroundStyle(theme.accent).help("Dodaj zadanie")
                }
            }
            ScrollView(.vertical) {
                LazyVStack(spacing: 10) {
                    ForEach(items) { task in card(task) }
                    if items.isEmpty {
                        Text(targeted == column ? "Upuść tutaj" : "Brak zadań").font(.caption).foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .padding(12)
        .frame(width: width, height: height, alignment: .top)
        .background(targeted == column ? theme.accent.opacity(0.10) : column.color.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .dropDestination(for: String.self) { ids, _ in
            guard canMove, let value = ids.first, value.hasPrefix("mavinci-task:") else { return false }
            let id = String(value.dropFirst("mavinci-task:".count))
            guard let task = store.task(id) else { return false }
            drop(task, on: column)
            return true
        } isTargeted: { inside in
            if inside && canMove { targeted = column } else if targeted == column { targeted = nil }
        }
    }

    @ViewBuilder private func card(_ task: BoardTask) -> some View {
        let view = TaskCardView(task: task, board: board, selected: selectedID == task.id, canManage: canManage, canMove: canMove,
                                timerActive: store.timer?.taskId == task.id, busy: store.busy.contains(task.id), me: store.access?.employeeId,
                                open: { selectedID = task.id; inspectorShown = true },
                                edit: { editor = TaskEditRequest(task: task, column: task.column) },
                                remove: { deleting = task }, start: { startTimer(task) },
                                move: { drop(task, on: $0) }, browser: { state.openCRM("/crm/tasks/\(task.id)") })
        if canMove {
            view.draggable("mavinci-task:\(task.id)") {
                Text(task.titleLabel).font(.callout.weight(.semibold)).padding(10).background(theme.card, in: RoundedRectangle(cornerRadius: 8))
            }
        } else {
            view
        }
    }

    /// Jak `handleDrop` w CRM: „W trakcie” uruchamia licznik (gdy nie działa inny), wyjście z „W trakcie” pyta o zatrzymanie.
    private func drop(_ task: BoardTask, on column: BoardColumnKind) {
        guard canMove, task.column != column else { return }
        let old = task.column
        let auto = store.access?.autoTimer ?? true
        if auto && column == .in_progress && old != .in_progress {
            if let timer = store.timer, timer.taskId != task.id {
                state.notice = "Zakończ poprzednie zadanie aby rozpocząć kolejne lub przenieś je do zrobienia"
                return
            }
            if store.timer == nil {
                Task { await store.move(task, to: column, working: true, startTimer: true) }
                return
            }
        }
        if auto && (column == .review || column == .completed) && old == .in_progress, store.timer?.taskId == task.id {
            stopping = (task, column)
            return
        }
        Task { await store.move(task, to: column, working: false, startTimer: false) }
    }

    private func startTimer(_ task: BoardTask) {
        if store.timer != nil { switching = task } else { Task { await store.timer("start", task: task) } }
    }

    /// Zadanie wskazane z pulpitu lub powiadomienia: zaznacz i pokaż szczegóły; zadanie spoza tablicy — druga tablica.
    private func reveal() {
        let target = store.focusID ?? (board == .mine && nav.selection == .tasks ? nav.focusedID : nil)
        guard let id = target else { return }
        if store.task(id) != nil {
            store.focusID = nil
            search = ""; selectedID = id; inspectorShown = true
        } else if board == .mine, store.loaded, state.companyTasks.task(id) != nil,
                  state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/tasks" }) {
            nav.focusedID = nil
            state.inWindow(nav) { state.openHref("/crm/tasks") }
            state.companyTasks.focusID = id
        }
    }
}

// MARK: Karta zadania (jak `TaskCard`)

@MainActor struct TaskCardView: View {
    let task: BoardTask
    let board: TaskBoardKind
    let selected: Bool
    let canManage: Bool
    let canMove: Bool
    let timerActive: Bool
    let busy: Bool
    let me: String?
    let open: () -> Void
    let edit: () -> Void
    let remove: () -> Void
    let start: () -> Void
    let move: (BoardColumnKind) -> Void
    let browser: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var hovering = false

    private var people: [TaskPerson] {
        let mine = task.assignees.filter { $0.id == me }
        return mine + task.assignees.filter { $0.id != me }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                Text(task.titleLabel).font(.callout.weight(.semibold)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                if busy { ProgressView().controlSize(.mini) }
                if canManage && hovering {
                    Button(action: edit) { Image(systemName: "pencil") }.buttonStyle(.borderless).foregroundStyle(theme.accent).help("Edytuj")
                    Button(action: remove) { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(CrmTheme.rgb(0xf87171)).help("Usuń")
                }
            }
            if !task.description.isEmpty {
                Text(task.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 6) {
                pill(task.priorityKind.label, task.priorityKind.color)
                if !task.workingName.isEmpty {
                    HStack(spacing: 4) {
                        Circle().fill(CrmTheme.rgb(0x4ade80)).frame(width: 6, height: 6)
                        Text(task.workingName).lineLimit(1)
                    }
                    .font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(CrmTheme.rgb(0x22c55e).opacity(0.14), in: Capsule()).foregroundStyle(CrmTheme.rgb(0x4ade80))
                }
                if let due = TaskDates.label(task) {
                    Label(due, systemImage: "calendar").font(.caption2).foregroundStyle(.secondary)
                }
                if task.comments > 0 {
                    Label("\(task.comments)", systemImage: "text.bubble").font(.caption2.weight(.medium))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(CrmTheme.rgb(0x3b82f6).opacity(0.14), in: Capsule()).foregroundStyle(CrmTheme.rgb(0x60a5fa))
                }
                if task.attachments > 0 { Label("\(task.attachments)", systemImage: "paperclip").font(.caption2).foregroundStyle(.secondary) }
            }
            if !people.isEmpty {
                HStack(spacing: -7) {
                    ForEach(people.prefix(5)) { person in
                        EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 28)
                    }
                    if people.count > 5 { Text("+\(people.count - 5)").font(.caption2).foregroundStyle(.secondary).padding(.leading, 10) }
                }
            }
            if canMove {
                Button(action: start) {
                    Label(timerActive ? "Aktywny" : "Rozpocznij", systemImage: timerActive ? "clock" : "play.fill")
                        .font(.caption).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderless)
                .padding(.vertical, 5)
                .background((timerActive ? CrmTheme.rgb(0x22c55e) : theme.accent).opacity(timerActive ? 0.18 : 0.12), in: RoundedRectangle(cornerRadius: 6))
                .foregroundStyle(timerActive ? CrmTheme.rgb(0x4ade80) : theme.accent)
                .disabled(timerActive)
                .help(timerActive ? "Timer aktywny" : "Rozpocznij zadanie")
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? theme.accent.opacity(0.14) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) { if selected { RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: 3).padding(.vertical, 6) } }
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onHover { hovering = $0 }
        .onTapGesture(perform: open)
        .contextMenu {
            Button("Pokaż szczegóły", systemImage: "info.circle", action: open)
            Button("Otwórz w CRM", systemImage: "safari", action: browser)
            if canMove {
                Button(timerActive ? "Licznik aktywny" : "Rozpocznij licznik", systemImage: "play.fill", action: start).disabled(timerActive)
                Menu("Przenieś do") {
                    ForEach(BoardColumnKind.allCases) { column in
                        Button(column.label(board)) { move(column) }.disabled(column == task.column)
                    }
                }
            }
            if canManage {
                Divider()
                Button("Edytuj…", systemImage: "pencil", action: edit)
                Button("Usuń…", systemImage: "trash", role: .destructive, action: remove)
            }
        }
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.16), in: Capsule()).foregroundStyle(color)
    }
}

// MARK: Szczegóły zadania (inspektor) — opis, osoby, załączniki, komentarze. Uprawnienia jak w CRM (`TaskDetailClient`):
// przypisać się i dodać osobę może każdy, kto widzi zadanie; wypisać inną osobę — autor zadania, administrator,
// „Zadania — zarządzanie” (na tablicy wydarzenia — zarządzający zadaniami); usunąć komentarz — autor komentarza lub zadania
// i zarządzający; usunąć plik — autor pliku i zarządzający. Edycja — zarządzający albo właściciel zadania.

@MainActor struct TaskInspector: View {
    let task: BoardTask?
    @ObservedObject var store: TasksStore
    let canManage: Bool
    let canMove: Bool
    let edit: (BoardTask) -> Void
    let remove: (BoardTask) -> Void
    let start: (BoardTask) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var comment = ""
    @State private var sending = false
    @State private var importing = false
    @State private var unassigning: TaskPerson?
    @State private var removingFile: TaskAttachmentInfo?

    private var me: String? { store.access?.employeeId ?? state.employee?.id }
    private var manageAll: Bool { (store.access?.isAdmin ?? false) || (store.access?.tasksManage ?? false) }
    private func isCreator(_ task: BoardTask) -> Bool {
        guard let me = me else { return false }
        return task.createdBy == me || store.details[task.id]?.createdBy == me
    }
    /// Wypisanie innej osoby: autor zadania i zarządzający (jak przycisk usuwania osoby w CRM).
    private func removesOthers(_ task: BoardTask) -> Bool { manageAll || isCreator(task) || (store.board == .event && canManage) }
    private var unassignMessage: String {
        guard let person = unassigning else { return "" }
        return person.id == me ? "Nie będziesz już przypisany(-a) do tego zadania." : "„\(person.name)” zostanie usunięty(-a) z zadania."
    }
    private var removeFileMessage: String {
        guard let file = removingFile else { return "" }
        return file.linked ? "„\(file.fileName)” zostanie odłączony od zadania (zostaje w plikach wydarzenia)." : "„\(file.fileName)” zostanie trwale usunięty."
    }
    /// Edycja: zarządzający tablicą albo właściciel zadania (na tablicy wydarzenia — zarządzający).
    private func edits(_ task: BoardTask) -> Bool { canManage || (store.board != .event && me != nil && task.ownerId == me) }

    var body: some View {
        if let task {
            ScrollView { details(task).padding(18).frame(maxWidth: .infinity, alignment: .leading) }
                .task(id: task.id) { await store.loadDetail(task.id) }
                .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                    guard case .success(let urls) = result else { return }
                    Task { await store.attach(urls, to: task) }
                }
                .confirmationDialog(unassigning?.id == me ? "Wypisać się z zadania?" : "Usunąć osobę z zadania?",
                                    isPresented: Binding(get: { unassigning != nil }, set: { if !$0 { unassigning = nil } }), titleVisibility: .visible) {
                    if let person = unassigning {
                        Button(person.id == me ? "Wypisz się" : "Usuń z zadania", role: .destructive) { Task { await store.unassign(task, employee: person.id) } }
                        Button("Anuluj", role: .cancel) {}
                    }
                } message: { Text(unassignMessage) }
                .confirmationDialog(removingFile?.linked == true ? "Odlinkować plik?" : "Usunąć plik?",
                                    isPresented: Binding(get: { removingFile != nil }, set: { if !$0 { removingFile = nil } }), titleVisibility: .visible) {
                    if let file = removingFile {
                        Button(file.linked ? "Odlinkuj" : "Usuń", role: .destructive) { Task { await store.deleteAttachment(file, task: task) } }
                        Button("Anuluj", role: .cancel) {}
                    }
                } message: { Text(removeFileMessage) }
        } else {
            ContentUnavailableView("Wybierz zadanie", systemImage: "checklist", description: Text("Kliknij kartę na tablicy."))
        }
    }

    private func details(_ task: BoardTask) -> some View {
        let detail = store.details[task.id]
        let timerActive = store.timer?.taskId == task.id
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(task.titleLabel).font(.title3.weight(.semibold)).textSelection(.enabled)
                HStack(spacing: 6) {
                    pill(task.column.label(store.board), task.column.color)
                    pill(task.priorityKind.label, task.priorityKind.color)
                    if task.isPrivate { pill("Prywatne", .secondary) }
                }
            }
            if canMove {
                HStack(spacing: 8) {
                    Button { start(task) } label: { Label(timerActive ? "Licznik aktywny" : "Rozpocznij", systemImage: timerActive ? "clock" : "play.fill") }
                        .disabled(timerActive)
                    if timerActive { Button("Zatrzymaj") { Task { await store.timer("stop") } } }
                    Spacer()
                    Menu("Przenieś do") {
                        ForEach(BoardColumnKind.allCases) { column in
                            Button(column.label(store.board)) { Task { await store.move(task, to: column, working: false, startTimer: false) } }
                                .disabled(column == task.column)
                        }
                    }.fixedSize()
                }.controlSize(.small)
            }
            if !task.description.isEmpty { section("Opis") { Text(task.description).textSelection(.enabled) } }
            section("Szczegóły") {
                VStack(alignment: .leading, spacing: 6) {
                    if let due = TaskDates.label(task, long: true) { row("Termin wykonania", due) }
                    if !task.workingName.isEmpty { row("Pracuje teraz", task.workingName) }
                    if let detail, !detail.creatorName.isEmpty { row("Utworzył(a)", detail.creatorName) }
                }
            }
            if !task.isPrivate { people(task) }
            if task.inquiryId != nil || task.eventId != nil {
                VStack(alignment: .leading, spacing: 4) {
                    if let inquiry = task.inquiryId, state.employee?.canView(.inquiries) == true {
                        Button("Otwórz zapytanie", systemImage: "tray") { state.open(.inquiries, id: inquiry) }
                    }
                    if let event = task.eventId, state.employee?.canView(.events) == true {
                        Button("Otwórz event", systemImage: "sparkles") { state.showEvent(event) }
                    }
                }.buttonStyle(.link).linkCursor()
            }
            section(detail.map { "Załączniki (\($0.attachments.count))" } ?? "Załączniki") {
                if let detail {
                    if detail.attachments.isEmpty { Text("Brak załączników").font(.caption).foregroundStyle(.secondary) }
                    ForEach(detail.attachments) { file in
                        HStack(spacing: 6) {
                            Button {
                                if let raw = file.fileUrl, let url = URL(string: raw) { NSWorkspace.shared.open(url) }
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: file.fileType.hasPrefix("image/") ? "photo" : "doc").foregroundStyle(theme.accent)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(file.fileName).lineLimit(1)
                                        Text("\(file.sizeLabel)\(file.name.isEmpty ? "" : " · \(file.name)")").font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.up.forward.square").foregroundStyle(.secondary)
                                }
                                .padding(8).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(file.fileUrl == nil).help("Otwórz plik")
                            if manageAll || (me != nil && file.uploadedBy == me) {
                                Button { removingFile = file } label: { Image(systemName: file.linked ? "minus.circle" : "trash") }
                                    .buttonStyle(.borderless).foregroundStyle(.secondary).help(file.linked ? "Odlinkuj plik" : "Usuń plik")
                            }
                        }
                    }
                    Button { importing = true } label: { Label("Dodaj plik…", systemImage: "paperclip") }.controlSize(.small)
                } else { ProgressView().controlSize(.small) }
            }
            section(detail.map { "Komentarze (\($0.comments.count))" } ?? "Komentarze") {
                if let detail {
                    ForEach(detail.comments) { item in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(item.name.isEmpty ? "Pracownik" : item.name).font(.caption.weight(.semibold))
                                Text(MeetingDates.parse(item.createdAt).map { MeetingDates.format($0, "d MMM, HH:mm") } ?? "").font(.caption2).foregroundStyle(.secondary)
                                Spacer()
                                if item.employeeId == me || manageAll || isCreator(task) {
                                    Button { Task { await store.deleteComment(item, task: task) } } label: { Image(systemName: "trash") }
                                        .buttonStyle(.borderless).foregroundStyle(.secondary).help("Usuń komentarz")
                                }
                            }
                            Text(item.content).textSelection(.enabled)
                        }
                        .padding(9).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                    HStack(alignment: .bottom, spacing: 6) {
                        TextField("Napisz komentarz…", text: $comment, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder)
                        Button {
                            let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !text.isEmpty else { return }
                            sending = true
                            Task { if await store.comment(task, text) { comment = "" }; sending = false }
                        } label: { Image(systemName: "paperplane.fill") }
                        .disabled(sending || comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .keyboardShortcut(.return, modifiers: .command).help("Wyślij (⌘↩)")
                    }
                } else { ProgressView().controlSize(.small) }
            }
            HStack {
                Button("Pełne szczegóły w CRM", systemImage: "safari") { state.openCRM("/crm/tasks/\(task.id)") }.buttonStyle(.link).linkCursor()
                Spacer()
            }
            if canManage || edits(task) {
                HStack {
                    if canManage { Button(role: .destructive) { remove(task) } label: { Label("Usuń…", systemImage: "trash") } }
                    Spacer()
                    if edits(task) { Button { edit(task) } label: { Label("Edytuj", systemImage: "pencil") }.buttonStyle(.borderedProminent).keyboardShortcut("e") }
                }
            }
        }
    }

    /// Osoby: lista z wypisaniem, „Przypisz się” / „Wypisz się” i dodawanie osoby (wyszukiwanie wśród pracowników).
    private func people(_ task: BoardTask) -> some View {
        let assigned = me.map { me in task.assignees.contains { $0.id == me } } ?? false
        return section("Osoby (\(task.assignees.count))") {
            VStack(alignment: .leading, spacing: 6) {
                if task.assignees.isEmpty { Text("Brak przypisanych osób").font(.caption).foregroundStyle(.secondary) }
                ForEach(task.assignees) { person in
                    HStack(spacing: 7) {
                        EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 24)
                        Text(person.id == me ? "\(person.name) (Ty)" : person.name)
                        Spacer()
                        if person.id == me || removesOthers(task) {
                            Button { unassigning = person } label: { Image(systemName: "xmark.circle") }
                                .buttonStyle(.borderless).foregroundStyle(.secondary).help(person.id == me ? "Wypisz się" : "Usuń z zadania")
                        }
                    }
                }
                if let me = me {
                    if assigned {
                        Button { unassigning = task.assignees.first { $0.id == me } } label: { Label("Wypisz się", systemImage: "person.badge.minus") }.controlSize(.small)
                    } else {
                        Button { Task { await store.assign(task, employee: me, name: state.employee?.displayName ?? "Ty") } } label: {
                            Label("Przypisz się", systemImage: "person.badge.plus")
                        }
                        .controlSize(.small).buttonStyle(.borderedProminent)
                    }
                }
                TaskPeopleAdder(store: store, task: task)
            }
        }
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 120, alignment: .leading)
            Text(value).textSelection(.enabled)
        }
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            content()
        }
    }
}

/// „Dodaj osobę” w panelu zadania: wyszukiwanie wśród pracowników (bez już przypisanych, do 5 wyników) i od razu zapis.
@MainActor struct TaskPeopleAdder: View {
    @ObservedObject var store: TasksStore
    let task: BoardTask
    @State private var query = ""

    private var matches: [MeetingPerson] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        let assigned = Set(task.assignees.map(\.id))
        return Array(store.employees.filter { !assigned.contains($0.id) && ($0.name.lowercased().contains(q) || ($0.nickname ?? "").lowercased().contains(q)) }.prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("Dodaj osobę", text: $query, prompt: Text("Dodaj osobę — imię, nazwisko lub email…")).textFieldStyle(.roundedBorder)
            ForEach(matches) { person in
                Button {
                    query = ""
                    Task { await store.assign(task, employee: person.id, name: person.name) }
                } label: {
                    HStack {
                        Image(systemName: "person.badge.plus")
                        Text(person.name)
                        Spacer()
                        Text(person.nickname ?? "").font(.caption).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).padding(.vertical, 2)
            }
        }
        .task { await store.loadEmployees() }
    }
}
