import SwiftUI
import AppKit
import PDFKit

// MARK: Agenda jako scenariusz (dane jak w `EventAgendaTab`): punkty programu z godziną i czasem trwania, przeciąganie i przenoszenie
// z przeliczeniem godzin, edycja w miejscu z zapisem od razu, uwagi w drzewie (do 3 poziomów), PDF w Dokumenty → Agenda
// (drukowany na Macu, zapis w CRM), podgląd, pobranie i druk.

struct AgendaTabData: Decodable {
    struct Event: Decodable { var name: String; var date: String; var start: String; var end: String }
    struct Agenda: Decodable { var id: String; var start: String; var end: String; var generatedPdfPath: String?; var modified: Bool; var pdfExists: Bool }
    struct Item: Decodable, Hashable { var id: String?; var time: String; var title: String; var description: String }
    struct Note: Decodable, Hashable { var id: String?; var content: String; var level: Int; var children: [Note] }
    var canManage: Bool
    var event: Event
    var agenda: Agenda?
    var items: [Item]
    var notes: [Note]
}


/// Punkt programu w edycji: początek w minutach od północy dnia wydarzenia (po północy > 1440) i czas trwania do następnego punktu.
private struct AgendaRow: Identifiable, Hashable {
    var id = UUID()
    var start: Int
    var duration: Int
    var title: String
    var description: String
    var end: Int { start + duration }
}
private struct AgendaDraftNote: Identifiable, Hashable { let id: String; var parent: String?; var content: String; var level: Int }

enum AgendaTime {
    /// Minuty do sortowania: godziny przed 6:00 liczą się jako noc po wydarzeniu.
    static func minutes(_ time: String) -> Int {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return Int.max }
        return parts[0] * 60 + parts[1] + (parts[0] < 6 ? 24 * 60 : 0)
    }
    static func valid(_ time: String) -> Bool { time.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil }
    /// „HH:mm” z minut (po północy — godzina następnego dnia).
    static func text(minutes: Int) -> String {
        let value = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", value / 60, value % 60)
    }
    /// Wpisana godzina („19”, „1930”, „19:30”, „19.30”) → minuty z regułą nocy.
    static func parse(_ text: String) -> Int? {
        let digits = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ".", with: ":")
        var hour: Int?
        var minute = 0
        if digits.contains(":") {
            let parts = digits.split(separator: ":").map(String.init)
            guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
            hour = h
            minute = m
        } else if let value = Int(digits) {
            if digits.count <= 2 { hour = value } else { hour = value / 100; minute = value % 100 }
        }
        guard let hour, (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return hour * 60 + minute + (hour < 6 ? 24 * 60 : 0)
    }
}

/// Agenda jako scenariusz: punkty programu w kolejności z godziną i czasem trwania. Przeciągnięcie albo przeniesienie punktu,
/// zmiana godziny lub czasu trwania przelicza godziny kolejnych punktów; zapis od razu (po chwili bez zmian), usunięcie z „Cofnij”.
/// Dane w bazie bez zmian: `event_agenda_items.time` (godzina) i `order_index` (kolejność), koniec programu w `event_agendas.end_time`.
/// Pole godziny: „19”, „1930”, „19:30” albo „19.30”; ↩ albo wyjście z pola zapisuje, błędna wartość wraca do poprzedniej.
private struct AgendaTimeField: View {
    let minutes: Int
    let set: (Int) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("--:--", text: $text)
            .textFieldStyle(.roundedBorder)
            .font(.body.weight(.semibold).monospacedDigit())
            .focused($focused)
            .onSubmit { commit() }
            .onAppear { text = AgendaTime.text(minutes: minutes) }
            .onChange(of: minutes) { _, new in if !focused { text = AgendaTime.text(minutes: new) } }
            .onChange(of: focused) { _, now in if !now { commit() } }
    }

    private func commit() {
        guard let value = AgendaTime.parse(text) else {
            text = AgendaTime.text(minutes: minutes)
            return
        }
        text = AgendaTime.text(minutes: value)
        if value != minutes { set(value) }
    }
}

@MainActor struct EventAgendaTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var rows: [AgendaRow] = []
    @State private var notes: [AgendaDraftNote] = []
    @State private var loadedRows: [AgendaRow] = []
    @State private var loadedNotes: [AgendaDraftNote] = []
    @State private var selection: UUID?
    @State private var saveTask: Task<Void, Never>?
    @State private var saving = false
    @State private var saveError: String?
    @State private var generating = false
    @State private var preview: NativePreview?

    private var data: AgendaTabData? { store.tab(eventID, "agenda", as: AgendaTabData.self) }
    private var dirty: Bool { rows != loadedRows || notes != loadedNotes }
    /// Pusty punkt albo pusta uwaga wstrzymują zapis (serwer pomija puste wpisy — zniknęłyby w trakcie pisania).
    private var incomplete: Bool {
        rows.contains { $0.title.trimmingCharacters(in: .whitespaces).isEmpty } || notes.contains { $0.content.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|agenda"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać agendy", systemImage: "list.bullet.rectangle")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "agenda") } } }
            } else {
                ProgressView("Ładowanie agendy...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "agenda") }
        .task(id: data?.items) { load() }
        .onChange(of: rows) { _, _ in changed() }
        .onChange(of: notes) { _, _ in changed() }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    // MARK: Wczytanie i zapis

    /// Program z serwera — tylko gdy nie ma niezapisanych zmian (wpisywany tekst nie znika po odświeżeniu).
    private func load() {
        guard let data, !dirty || rows.isEmpty && notes.isEmpty else { return }
        let starts = data.items.map { AgendaTime.minutes($0.time) }
        let end = data.agenda.map { AgendaTime.minutes($0.end) }
        var next: [AgendaRow] = []
        for (index, item) in data.items.enumerated() {
            let start = starts[index] == Int.max ? (next.last?.end ?? 18 * 60) : starts[index]
            var duration = 30
            if index + 1 < starts.count, starts[index + 1] != Int.max, starts[index + 1] > start { duration = starts[index + 1] - start }
            else if index + 1 == starts.count, let end, end != Int.max, end > start, end - start <= 12 * 60 { duration = end - start }
            next.append(AgendaRow(start: start, duration: duration, title: item.title, description: item.description))
        }
        var flat: [AgendaDraftNote] = []
        func walk(_ list: [AgendaTabData.Note], parent: String?) {
            for note in list {
                let id = note.id ?? UUID().uuidString
                flat.append(AgendaDraftNote(id: id, parent: parent, content: note.content, level: note.level))
                walk(note.children, parent: id)
            }
        }
        walk(data.notes, parent: nil)
        // Ta sama treść co na ekranie (np. po własnym zapisie) — zostają obecne wiersze, żeby nie gubić kursora w polu.
        if Self.sameRows(next, rows) { next = rows }
        if Self.sameNotes(flat, notes) { flat = notes }
        rows = next
        notes = flat
        loadedRows = next
        loadedNotes = flat
    }

    private static func sameRows(_ a: [AgendaRow], _ b: [AgendaRow]) -> Bool {
        let trim: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        return a.count == b.count && zip(a, b).allSatisfy { x, y in
            x.start == y.start && x.duration == y.duration && trim(x.title) == trim(y.title) && trim(x.description) == trim(y.description)
        }
    }

    private static func sameNotes(_ a: [AgendaDraftNote], _ b: [AgendaDraftNote]) -> Bool {
        a.count == b.count && zip(a, b).allSatisfy { x, y in
            x.level == y.level && x.content.trimmingCharacters(in: .whitespacesAndNewlines) == y.content.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func changed() {
        guard dirty, data?.canManage == true else { return }
        saveError = nil
        saveTask?.cancel()
        guard !incomplete else { return }
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(900))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func save() async {
        guard let data else { return }
        saving = true
        defer { saving = false }
        let snapshotRows = rows
        let snapshotNotes = notes
        let start = snapshotRows.first.map { AgendaTime.text(minutes: $0.start) } ?? (data.agenda?.start.nonEmpty ?? data.event.start)
        let end = snapshotRows.last.map { AgendaTime.text(minutes: $0.end) } ?? (data.agenda?.end.nonEmpty ?? data.event.end)
        let body: [String: JSONValue] = [
            "start": .string(start), "end": .string(end),
            "items": .array(snapshotRows.map { row in
                .object(["time": .string(AgendaTime.text(minutes: row.start)), "title": .string(row.title), "description": .string(row.description)])
            }),
            "notes": noteTree(nil, in: snapshotNotes),
        ]
        do {
            try await store.tabAction(eventID, "agenda", "save", body, reload: [], success: nil, pending: nil)
            loadedRows = snapshotRows
            loadedNotes = snapshotNotes
            await store.loadTab(eventID, "agenda")
        } catch {
            saveError = store.failureText(error, "Nie udało się zapisać agendy")
        }
    }

    // MARK: Widok

    private func content(_ data: AgendaTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Agenda").font(.title2.weight(.semibold))
                Text(summary).foregroundStyle(.secondary).lineLimit(1)
                saveStatus
                Spacer()
                actions(data)
            }
            .padding(.horizontal, 18).padding(.top, 12)
            EventArrangementsBanner(store: store, eventID: eventID, area: .agenda).padding(.horizontal, 18)
            HSplitView {
                program(data).frame(minWidth: 560, maxWidth: .infinity, maxHeight: .infinity)
                notesPanel(data).frame(minWidth: 240, idealWidth: 320, maxWidth: 460, maxHeight: .infinity)
            }
        }
    }

    private var summary: String {
        guard let first = rows.first, let last = rows.last else { return "Brak punktów programu" }
        return NativeList.count(rows.count, "punkt", "punkty", "punktów") + " · " + AgendaTime.text(minutes: first.start) + "–" + AgendaTime.text(minutes: last.end)
            + " · " + TimelineText.hours(last.end - first.start, minutesInParentheses: false)
    }

    @ViewBuilder private var saveStatus: some View {
        if let saveError {
            Label(saveError, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red).lineLimit(1)
        } else if incomplete {
            Label("Uzupełnij puste pola, aby zapisać", systemImage: "pencil").font(.caption).foregroundStyle(.orange)
        } else if saving {
            HStack(spacing: 4) { ProgressView().controlSize(.mini); Text("Zapisywanie…").font(.caption).foregroundStyle(.secondary) }
        } else if dirty {
            Text("Zmiany czekają na zapis…").font(.caption).foregroundStyle(.secondary)
        } else if !rows.isEmpty {
            Label("Zapisano", systemImage: "checkmark").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func actions(_ data: AgendaTabData) -> some View {
        HStack(spacing: 8) {
            if data.canManage {
                Button { add(after: selectedIndex ?? rows.count - 1) } label: { Label("Dodaj punkt", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return, modifiers: .command)
                    .help("Nowy punkt pod zaznaczonym (⌘↩)")
            }
            if let agenda = data.agenda {
                let shouldGenerate = agenda.generatedPdfPath == nil || agenda.modified || !agenda.pdfExists
                Menu {
                    if data.canManage && shouldGenerate {
                        Button((agenda.generatedPdfPath != nil || agenda.modified) ? "Regeneruj PDF" : "Generuj PDF", systemImage: "arrow.down.doc") {
                            Task { await generate() }
                        }
                        .disabled(generating || dirty)
                    }
                    if agenda.generatedPdfPath != nil && agenda.pdfExists && !agenda.modified {
                        Button("Pokaż PDF", systemImage: "eye") { Task { await openPdf(download: false) } }
                        Button("Pobierz PDF", systemImage: "arrow.down.circle") { Task { await openPdf(download: true) } }
                    }
                    Button("Drukuj", systemImage: "printer") { Task { await printPdf(agenda) } }
                } label: { Label(generating ? "Generowanie…" : "PDF", systemImage: "doc.richtext") }
                .fixedSize()
            }
        }
    }

    private var selectedIndex: Int? { rows.firstIndex { $0.id == selection } }

    // MARK: Program (scenariusz)

    @ViewBuilder private func program(_ data: AgendaTabData) -> some View {
        if rows.isEmpty {
            ContentUnavailableView {
                Label("Brak punktów programu", systemImage: "list.bullet.rectangle")
            } description: {
                Text(data.canManage ? "Dodaj pierwszy punkt — kolejne ustawiają się po nim automatycznie." : "Agenda nie została jeszcze przygotowana.")
            } actions: {
                if data.canManage { Button("Dodaj pierwszy punkt") { add(after: -1) } }
            }
        } else {
            VStack(spacing: 0) {
                FinanceListHeader(columns: [("", 18, .center), ("Lp.", 26, .trailing), ("Godzina", 64, .leading), ("Czas trwania", 150, .leading),
                                            ("Do", 44, .leading), ("Punkt programu", nil, .leading), ("", 28, .center)])
                    .padding(.horizontal, 10)
                List(selection: $selection) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { item in
                        row(item.offset, data.canManage).tag(item.element.id)
                    }
                    .onMove { from, to in if data.canManage { move(from, to) } }
                    .moveDisabled(!data.canManage)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .onDeleteCommand { if data.canManage, let index = selectedIndex { remove(index) } }
                Text(data.canManage ? "Przeciągnij punkt, aby zmienić kolejność — godziny kolejnych punktów przeliczą się same. Zmiana godziny lub czasu trwania przesuwa dalszą część programu."
                                    : "Tylko do odczytu.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 18).padding(.vertical, 6)
            }
        }
    }

    private func row(_ index: Int, _ editable: Bool) -> some View {
        let item = rows[index]
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "line.3.horizontal").foregroundStyle(.tertiary).frame(width: 18).help(editable ? "Przeciągnij, aby przenieść" : "")
            Text("\(index + 1)").monospacedDigit().foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
            if editable {
                AgendaTimeField(minutes: item.start) { setStart(index, $0) }.frame(width: 64, alignment: .leading)
                durationControl(index).frame(width: 150, alignment: .leading)
            } else {
                Text(AgendaTime.text(minutes: item.start)).monospacedDigit().fontWeight(.semibold).foregroundStyle(theme.accent).frame(width: 64, alignment: .leading)
                Text(TimelineText.hours(item.duration, minutesInParentheses: false)).foregroundStyle(.secondary).frame(width: 150, alignment: .leading)
            }
            Text(AgendaTime.text(minutes: item.end)).monospacedDigit().foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                if editable {
                    TextField("Punkt programu", text: binding(index, \.title)).textFieldStyle(.plain).fontWeight(.medium)
                    TextField("Opis, osoba odpowiedzialna, uwagi…", text: binding(index, \.description), axis: .vertical)
                        .textFieldStyle(.plain).font(.callout).foregroundStyle(.secondary).lineLimit(1...4)
                } else {
                    Text(item.title.isEmpty ? "—" : item.title).fontWeight(.medium)
                    if !item.description.isEmpty { Text(item.description).font(.callout).foregroundStyle(.secondary) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if editable {
                Menu { menu(index) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().frame(width: 28)
            }
        }
        .padding(.vertical, 3)
        .contextMenu { if editable { menu(index) } }
    }

    private func binding(_ index: Int, _ path: WritableKeyPath<AgendaRow, String>) -> Binding<String> {
        let id = rows[index].id
        return Binding(get: { rows.first { $0.id == id }?[keyPath: path] ?? "" },
                       set: { value in if let position = rows.firstIndex(where: { $0.id == id }) { rows[position][keyPath: path] = value } })
    }

    private func durationControl(_ index: Int) -> some View {
        let id = rows[index].id
        let duration = rows[index].duration
        let presets: [Int] = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]
        return HStack(spacing: 2) {
            Button { setDuration(id, duration - 5) } label: { Image(systemName: "minus").frame(width: 14, height: 14) }.disabled(duration <= 5)
            Menu {
                ForEach(presets, id: \.self) { value in
                    Button(TimelineText.hours(value, minutesInParentheses: false)) { setDuration(id, value) }
                }
            } label: {
                Text(TimelineText.hours(duration, minutesInParentheses: false)).monospacedDigit()
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Czas trwania (\(duration) min) — wybierz albo zmieniaj − / + co 5 min")
            Button { setDuration(id, duration + 5) } label: { Image(systemName: "plus").frame(width: 14, height: 14) }
        }
        .buttonStyle(.borderless)
    }

    @ViewBuilder private func menu(_ index: Int) -> some View {
        Button("Wstaw punkt poniżej", systemImage: "plus") { add(after: index) }
        Button("Duplikuj", systemImage: "plus.square.on.square") { duplicate(index) }
        Divider()
        Button("Przenieś wyżej", systemImage: "arrow.up") { move(IndexSet(integer: index), index - 1) }.disabled(index == 0)
        Button("Przenieś niżej", systemImage: "arrow.down") { move(IndexSet(integer: index), index + 2) }.disabled(index >= rows.count - 1)
        Divider()
        Button("Usuń punkt", systemImage: "trash", role: .destructive) { remove(index) }
    }

    // MARK: Zmiany programu — godziny kolejnych punktów liczone od początku programu i czasów trwania

    private func reflow(from start: Int? = nil) {
        guard !rows.isEmpty else { return }
        if let start { rows[0].start = start }
        for index in rows.indices.dropFirst() { rows[index].start = rows[index - 1].end }
    }

    private func move(_ from: IndexSet, _ to: Int) {
        let begin = rows.first?.start
        rows.move(fromOffsets: from, toOffset: to)
        reflow(from: begin)
    }

    /// Godzina pierwszego punktu przesuwa cały program; godzina dalszego punktu zmienia czas trwania poprzedniego i przesuwa resztę.
    private func setStart(_ index: Int, _ minutes: Int) {
        guard rows.indices.contains(index) else { return }
        if index == 0 {
            reflow(from: minutes)
            return
        }
        let previous = rows[index - 1]
        guard minutes > previous.start else {
            state.snack = Snack(kind: .info, text: "Godzina musi być późniejsza niż początek poprzedniego punktu (\(AgendaTime.text(minutes: previous.start))). Aby zmienić kolejność, przeciągnij punkt.")
            return
        }
        rows[index - 1].duration = minutes - previous.start
        reflow()
    }

    private func setDuration(_ id: UUID, _ minutes: Int) {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        rows[index].duration = max(5, minutes)
        reflow()
    }

    private func add(after index: Int) {
        let eventStart = AgendaTime.parse(data?.agenda?.start ?? "") ?? AgendaTime.parse(data?.event.start ?? "") ?? 18 * 60
        let start = index >= 0 && index < rows.count ? rows[index].end : (rows.last?.end ?? eventStart)
        let row = AgendaRow(start: start, duration: 30, title: "", description: "")
        rows.insert(row, at: min(rows.count, index + 1))
        reflow()
        selection = row.id
    }

    private func duplicate(_ index: Int) {
        var copy = rows[index]
        copy.id = UUID()
        rows.insert(copy, at: index + 1)
        reflow()
        selection = copy.id
    }

    private func remove(_ index: Int) {
        guard rows.indices.contains(index) else { return }
        let removed = rows[index]
        let begin = rows.first?.start
        rows.remove(at: index)
        reflow(from: index == 0 ? begin : nil)
        state.snack = Snack(kind: .success, text: "Usunięto punkt: " + (removed.title.isEmpty ? "(bez nazwy)" : removed.title), action: Snack.Action(title: "Cofnij") {
            rows.insert(removed, at: min(index, rows.count))
            reflow(from: index == 0 ? removed.start : nil)
        })
    }

    // MARK: Uwagi

    private func notesPanel(_ data: AgendaTabData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Uwagi").font(.headline)
                Spacer()
                if data.canManage {
                    Button { addNote(parent: nil, level: 0) } label: { Label("Dodaj uwagę", systemImage: "plus") }.controlSize(.small)
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    if notes.isEmpty { Text("Brak uwag do agendy.").foregroundStyle(.secondary) }
                    ForEach($notes) { $note in
                        HStack(spacing: 6) {
                            Text("•").foregroundStyle(theme.accent)
                            if data.canManage {
                                TextField("Treść uwagi...", text: $note.content, axis: .vertical).textFieldStyle(.plain).lineLimit(1...4)
                                if note.level < 2 {
                                    Button { addNote(parent: note.id, level: note.level + 1) } label: { Image(systemName: "arrow.turn.down.right") }
                                        .buttonStyle(.borderless).help("Dodaj podpunkt")
                                }
                                Button { removeNote(note.id) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                            } else {
                                Text(note.content).font(.callout)
                            }
                        }
                        .padding(.leading, CGFloat(note.level) * 20)
                        .padding(.vertical, 3).padding(.horizontal, 6)
                        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
        .padding(14)
    }

    private func addNote(parent: String?, level: Int) {
        let note = AgendaDraftNote(id: "temp-\(UUID().uuidString)", parent: parent, content: "", level: level)
        guard let parent, let index = notes.firstIndex(where: { $0.id == parent }) else { notes.append(note); return }
        var end = index + 1
        while end < notes.count && isDescendant(notes[end], of: parent) { end += 1 }
        notes.insert(note, at: end)
    }
    private func isDescendant(_ note: AgendaDraftNote, of ancestor: String) -> Bool {
        var current = note.parent
        while let id = current {
            if id == ancestor { return true }
            current = notes.first { $0.id == id }?.parent
        }
        return false
    }
    private func removeNote(_ id: String) {
        notes.removeAll { $0.id == id || isDescendant($0, of: id) }
    }

    private func noteTree(_ parent: String?, in list: [AgendaDraftNote]) -> JSONValue {
        .array(list.filter { $0.parent == parent }.map { note in
            .object(["id": .string(note.id), "content": .string(note.content), "level": .number(Double(note.level)), "children": noteTree(note.id, in: list)])
        })
    }

    // MARK: PDF

    private struct PdfFile: Decodable { var url: String; var name: String }

    /// „Generuj / Regeneruj PDF”: dane z CRM → PDF na Macu (Chrome) albo na serwerze → plik w Dokumenty → Agenda.
    private func generate() async {
        guard !generating else { return }
        generating = true
        defer { generating = false }
        await state.withPending(ChromePdfEngine.available ? "Generowanie agendy PDF…" : "Generowanie agendy PDF na serwerze…") {
            do {
                let payload = try await store.tabQueryData(eventID, "agenda", "pdfPayload")
                let result = try await state.generateStoredDocument(path: "/bridge/events/agenda-pdf", body: payload)
                state.succeed("Agenda PDF została zapisana w folderze Dokumenty → Agenda")
                await store.loadTab(eventID, "agenda")
                if let pdf = result.pdf { preview = NativePreview(name: "agenda.pdf", data: pdf) }
            } catch {
                state.error = store.failureText(error, "Wystąpił błąd podczas generowania PDF")
            }
        }
    }

    private func fetchPdf() async throws -> (Data, String) {
        let file = try await store.tabQuery(eventID, "agenda", "pdf", as: PdfFile.self)
        guard let url = URL(string: file.url) else { throw AppError.invalidResponse }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
        return (data, file.name)
    }

    private func openPdf(download: Bool) async {
        await state.withPending(download ? "Pobieranie…" : "Otwieranie PDF…") {
            do {
                let (data, name) = try await fetchPdf()
                if !download { preview = NativePreview(name: name, data: data); return }
                let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                let base = (name as NSString).deletingPathExtension
                var target = folder.appendingPathComponent(name)
                var copy = 1
                while FileManager.default.fileExists(atPath: target.path) { target = folder.appendingPathComponent("\(base) (\(copy)).pdf"); copy += 1 }
                try data.write(to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = store.failureText(error, download ? "Błąd podczas pobierania PDF" : "Błąd podczas otwierania PDF")
                await store.loadTab(eventID, "agenda")
            }
        }
    }

    /// „Drukuj”: systemowe okno druku z PDF agendy.
    private func printPdf(_ agenda: AgendaTabData.Agenda) async {
        guard agenda.generatedPdfPath != nil, agenda.pdfExists, !agenda.modified else {
            state.snack = Snack(kind: .info, text: "Najpierw wygeneruj PDF agendy — wydruk powstaje z aktualnego pliku.")
            return
        }
        do {
            let (data, _) = try await fetchPdf()
            guard let document = PDFDocument(data: data), let operation = document.printOperation(for: NSPrintInfo.shared, scalingMode: .pageScaleToFit, autoRotate: true) else {
                throw AppError.invalidResponse
            }
            operation.run()
        } catch {
            state.error = store.failureText(error, "Nie udało się przygotować wydruku.")
        }
    }
}
