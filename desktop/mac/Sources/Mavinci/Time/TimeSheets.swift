import SwiftUI

// MARK: Czas pracy — arkusze: „Rozpocznij timer” (zadanie z listy albo własny tytuł, umowa), „Edytuj wpis czasu”
// (kontrola wersji wpisu), „Historia zmian” i rozmowa „do wyjaśnienia” przy wpisie.

private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/// Umowa do rozliczenia czasu (`PersonnelTimeContractPicker`): pusta — dobór według daty pracy.
@MainActor struct WorkTimeContractPicker: View {
    @ObservedObject var store: TimeTrackingStore
    let employeeID: String
    @Binding var selection: String
    @State private var options: [WorkTimeContract] = []
    @State private var problem = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Umowa do rozliczenia", selection: $selection) {
                Text("Dobierz automatycznie według daty pracy").tag("")
                ForEach(options) { Text($0.label).tag($0.id) }
            }
            if !problem.isEmpty { Text(problem).font(.caption).foregroundStyle(.orange) }
        }
        .task(id: employeeID) {
            do { options = try await store.contracts(employee: employeeID) } catch { problem = "Nie udało się pobrać umów." }
        }
    }
}

/// „Rozpocznij timer” (`StartTimerModal`): zadanie z ostatnich zadań albo własny tytuł, opis i umowa.
@MainActor struct WorkTimeStartSheet: View {
    @ObservedObject var store: TimeTrackingStore
    let employeeID: String
    let tasks: [WorkTimeTask]
    @Environment(\.dismiss) private var dismiss
    @State private var contractID = ""
    @State private var name = ""
    @State private var details = ""
    @State private var taskID: String?
    @State private var busy = false
    @State private var problem: String?

    private var filtered: [WorkTimeTask] {
        let query = trimmed(name)
        return query.isEmpty ? tasks : tasks.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        FleetSheetFrame(title: "Rozpocznij timer", subtitle: "Licznik nalicza czas do zatrzymania", symbol: "play.circle", submitTitle: "Rozpocznij",
                        busy: busy, canSubmit: !trimmed(name).isEmpty, problem: problem, width: 580, height: 640) { start() } content: {
            Section { WorkTimeContractPicker(store: store, employeeID: employeeID, selection: $contractID) }
            Section("Nazwa zadania") {
                TextField("Nazwa zadania", text: Binding(get: { name }, set: { value in
                    guard value != name else { return }
                    name = value; taskID = nil; problem = nil
                }), prompt: Text("Wpisz nazwę lub wybierz z listy..."))
                if taskID != nil {
                    Label("Powiązane z zadaniem", systemImage: "checkmark.circle").foregroundStyle(workTimeGreen)
                } else if !trimmed(name).isEmpty && filtered.isEmpty {
                    Label("Własny tytuł zostanie utworzony", systemImage: "checkmark.circle").foregroundStyle(.blue)
                }
                if taskID == nil && !filtered.isEmpty {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(filtered) { task in
                                Button {
                                    name = task.title; taskID = task.id; problem = nil
                                } label: {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(task.title)
                                        if !task.eventName.isEmpty { Text(task.eventName).font(.caption).foregroundStyle(.secondary) }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                Divider()
                            }
                        }
                    }
                    .frame(maxHeight: 200)
                }
            }
            Section("Opis (opcjonalnie)") {
                TextField("Opis", text: $details, prompt: Text("Co będziesz robić?"), axis: .vertical).lineLimit(3...6).labelsHidden()
            }
        }
    }

    private func start() {
        guard !busy else { return }
        let title = trimmed(name)
        guard !title.isEmpty else { problem = "Podaj tytuł zadania"; return }
        var body: [String: JSONValue] = ["title": .string(title), "description": .string(details)]
        if let taskID { body["taskId"] = .string(taskID) }
        if !contractID.isEmpty { body["contractId"] = .string(contractID) }
        busy = true
        Task {
            let ok = await store.run("Uruchamianie timera…", "start", body)
            busy = false
            if ok { dismiss() }
        }
    }
}

/// „Edytuj wpis czasu” (`EditEntryModal`): tytuł, opis, początek i koniec; zapis tylko, gdy wpis nie zmienił się w międzyczasie.
@MainActor struct WorkTimeEditSheet: View {
    @ObservedObject var store: TimeTrackingStore
    let entry: WorkTimeEntry
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var details: String
    @State private var start: Date
    @State private var end: Date
    @State private var busy = false

    init(store: TimeTrackingStore, entry: WorkTimeEntry) {
        self.store = store
        self.entry = entry
        _title = State(initialValue: entry.title)
        _details = State(initialValue: entry.description)
        _start = State(initialValue: entry.startDate ?? Date())
        _end = State(initialValue: entry.endDate ?? Date())
    }

    /// Pełne minuty (jak pola daty i godziny w CRM).
    private func minute(_ date: Date) -> Date {
        Calendar.current.date(from: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)) ?? date
    }
    private var duration: String {
        let minutes = (minute(end).timeIntervalSince(minute(start)) / 60).rounded(.down)
        return minutes > 0 ? WorkTimeFormat.minutes(minutes) : "---"
    }
    private var problem: String? {
        if trimmed(title).isEmpty { return "Podaj tytuł" }
        if minute(end) <= minute(start) { return "Koniec musi być późniejszy niż początek." }
        return nil
    }

    var body: some View {
        FleetSheetFrame(title: "Edytuj wpis czasu", subtitle: entry.label, symbol: "pencil.circle", submitTitle: "Zapisz zmiany",
                        busy: busy, canSubmit: problem == nil, problem: problem, width: 540, height: 540) { save() } content: {
            Section {
                TextField("Tytuł", text: $title)
                TextField("Opis", text: $details, axis: .vertical).lineLimit(3...6)
            }
            Section {
                DatePicker("Rozpoczęcie", selection: $start, displayedComponents: [.date, .hourAndMinute])
                DatePicker("Zakończenie", selection: $end, displayedComponents: [.date, .hourAndMinute])
                LabeledContent("Czas trwania") { Text(duration).fontWeight(.semibold).monospacedDigit() }
            }
        }
    }

    private func save() {
        guard !busy, problem == nil else { return }
        let body: [String: JSONValue] = [
            "id": .string(entry.id), "updatedAt": .string(entry.updatedAt ?? ""), "title": .string(trimmed(title)), "description": .string(details),
            "start": .string(MeetingDates.iso(minute(start))), "end": .string(MeetingDates.iso(minute(end))),
            "contractId": entry.contractId.map { .string($0) } ?? .null,
        ]
        busy = true
        Task {
            let ok = await store.run("Zapisywanie wpisu…", "update", body)
            busy = false
            if ok { dismiss() }
        }
    }
}

/// Zmiana wpisu: akcja, autor, data i zmienione pola „przed → po”.
@MainActor struct WorkTimeChangeRow: View {
    let change: WorkTimeChange
    var you = false
    var showTitle = false
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                WorkTimePill(text: change.actionLabel, color: change.actionColor)
                if change.action == "deleted" {
                    Label("Wpis nieodwracalnie usunięty", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(workTimeRed)
                }
                Spacer()
                Text(WorkTimeFormat.dateTime(change.at)).font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 4) {
                Image(systemName: "person").foregroundStyle(.secondary)
                Text(change.actorLabel)
                if you { Text("(Ty)").foregroundStyle(.secondary) }
            }
            .font(.callout)
            if showTitle && !change.title.isEmpty { Text("Wpis: \(change.title)").font(.callout).foregroundStyle(.secondary) }
            switch change.action {
            case "updated":
                ForEach(change.changes) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(field.label):").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        HStack(alignment: .top, spacing: 8) {
                            Text(field.before).frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                .background(workTimeRed.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                            Image(systemName: "arrow.right").foregroundStyle(.secondary).padding(.top, 6)
                            Text(field.after).frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                .background(workTimeGreen.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                        }
                        .font(.callout).textSelection(.enabled)
                    }
                }
            case "created":
                Text("Wpis został utworzony").font(.callout).foregroundStyle(.secondary)
            case "deleted":
                Text("Wpis został usunięty").font(.callout).foregroundStyle(.secondary)
            default:
                EmptyView()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// „Historia zmian” wpisu (`HistoryModal`).
@MainActor struct WorkTimeHistorySheet: View {
    @ObservedObject var store: TimeTrackingStore
    let entry: WorkTimeEntry
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var items: [WorkTimeChange]?
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "clock.arrow.circlepath").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Historia zmian").font(.title3.weight(.semibold))
                    Text(entry.label).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(18)
            Divider()
            Group {
                if let problem {
                    ContentUnavailableView("Historia zmian", systemImage: "exclamationmark.triangle", description: Text(problem))
                } else if let items {
                    if items.isEmpty {
                        ContentUnavailableView("Brak historii zmian", systemImage: "clock.arrow.circlepath")
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 10) { ForEach(items) { WorkTimeChangeRow(change: $0) } }.padding(18)
                        }
                    }
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: 640, height: 580)
        .background(theme.page)
        .task {
            do { items = try await store.history(entry.id) } catch { problem = store.failureText(error, "Nie udało się pobrać historii zmian.") }
        }
    }
}

/// Rozmowa o wpisie (`TimeEntryDiscussion`): wątek rozpoczyna administrator, pracownik odpowiada; administrator oznacza wyjaśnienie.
@MainActor struct WorkTimeDiscussionSheet: View {
    @ObservedObject var store: TimeTrackingStore
    let target: WorkTimeDiscussionTarget
    let isAdmin: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var reply = ""
    @State private var busy = false
    @State private var problem = ""

    private var thread: WorkTimeThread? { store.thread(for: target.id) }
    private var shownProblem: String { problem.nonEmpty ?? store.discussionError }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.bubble.right").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(target.title).font(.title3.weight(.semibold)).lineLimit(1)
                    if let thread, !thread.employeeName.isEmpty {
                        Text([thread.employeeName, WorkTimeFormat.dateTime(thread.start)].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let thread { WorkTimePill(text: thread.stateLabel, color: thread.resolved ? workTimeGreen : workTimeOrange) }
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(busy)
            }
            .padding(18)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(thread?.messages ?? []) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(message.author).font(.callout.weight(.semibold))
                                    Spacer()
                                    Text(WorkTimeFormat.dateTimeSeconds(message.at)).font(.caption).foregroundStyle(.secondary)
                                }
                                Text(message.body).textSelection(.enabled)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
                            .id(message.id)
                        }
                        if thread == nil {
                            Text(isAdmin ? "Brak wątku. Zadaj pytanie, aby rozpocząć wyjaśnianie tego wpisu." : "Brak wątku do tego wpisu.")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(18)
                }
                .onAppear { if let last = thread?.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) } }
                .onChange(of: thread?.messages.count) { if let last = thread?.messages.last?.id { withAnimation { proxy.scrollTo(last, anchor: .bottom) } } }
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                if thread?.resolved == true {
                    Text("Wątek oznaczono jako wyjaśniony.").foregroundStyle(.secondary)
                } else if thread != nil || isAdmin {
                    Text(thread == nil ? "Pytanie do wpisu" : "Odpowiedź").font(.callout.weight(.semibold))
                    TextField("Wiadomość", text: $reply, prompt: Text(thread == nil ? "Zadaj pytanie…" : "Napisz odpowiedź…"), axis: .vertical)
                        .lineLimit(2...6).textFieldStyle(.roundedBorder).labelsHidden().disabled(busy)
                    HStack {
                        Text("\(reply.count)/4000").font(.caption).foregroundStyle(reply.count > 4000 ? workTimeRed : .secondary)
                        Spacer()
                        Button(busy ? "Zapisywanie…" : "Wyślij", action: send)
                            .buttonStyle(.borderedProminent)
                            .disabled(busy || trimmed(reply).isEmpty || reply.count > 4000 || !store.discussionError.isEmpty)
                    }
                }
                if isAdmin, let thread {
                    Button(thread.resolved ? "Otwórz ponownie" : "Oznacz jako wyjaśnione") { resolve(!thread.resolved) }.disabled(busy)
                }
                if !shownProblem.isEmpty { Text(shownProblem).font(.callout).foregroundStyle(.orange) }
            }
            .padding(18)
        }
        .frame(width: 620, height: 640)
        .background(theme.page)
        .task { await store.refreshDiscussions() }
    }

    private func send() {
        let body = reply
        guard !busy, !trimmed(body).isEmpty else { return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        busy = true; problem = ""
        Task {
            do {
                try await store.post("discussionPost", ["entryId": .string(target.id), "body": .string(body)])
                reply = ""
                await store.refreshDiscussions()
            } catch {
                problem = store.failureText(error, "Nie udało się zapisać wiadomości.")
            }
            busy = false
        }
    }

    private func resolve(_ resolved: Bool) {
        guard !busy else { return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        busy = true; problem = ""
        Task {
            do {
                try await store.post("discussionResolve", ["entryId": .string(target.id), "resolved": .bool(resolved)])
                await store.refreshDiscussions()
            } catch {
                problem = store.failureText(error, "Nie udało się zapisać wiadomości.")
            }
            busy = false
        }
    }
}
