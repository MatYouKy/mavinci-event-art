import SwiftUI
import AppKit
import PDFKit

// MARK: Agenda (1:1 z `EventAgendaTab`): harmonogram (godzina, etap, opis — sortowany, godziny przed 6:00 jako noc), uwagi w drzewie
// (do 3 poziomów), edycja z zapisem całości, PDF w Dokumenty → Agenda (drukowany na Macu, zapis w CRM), podgląd, pobranie i druk.

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

/// Edytowany etap i uwaga (uwagi płasko: rodzic przed dziećmi, `level` 0–2).
private struct AgendaDraftItem: Identifiable, Hashable { let id = UUID(); var time: String; var title: String; var description: String; var editing: Bool }
private struct AgendaDraftNote: Identifiable, Hashable { let id: String; var parent: String?; var content: String; var level: Int }

enum AgendaTime {
    /// Minuty do sortowania: godziny przed 6:00 liczą się jako noc po wydarzeniu.
    static func minutes(_ time: String) -> Int {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return Int.max }
        return parts[0] * 60 + parts[1] + (parts[0] < 6 ? 24 * 60 : 0)
    }
    static func valid(_ time: String) -> Bool { time.range(of: #"^\d{2}:\d{2}$"#, options: .regularExpression) != nil }
    static func date(_ time: String) -> Date {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        var components = MeetingDates.calendar.dateComponents([.year, .month, .day], from: Date())
        components.hour = parts.first ?? 0
        components.minute = parts.count > 1 ? parts[1] : 0
        return MeetingDates.calendar.date(from: components) ?? Date()
    }
    static func text(_ date: Date) -> String {
        let parts = MeetingDates.calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

@MainActor struct EventAgendaTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editMode = false
    @State private var items: [AgendaDraftItem] = []
    @State private var notes: [AgendaDraftNote] = []
    @State private var saving = false
    @State private var generating = false
    @State private var preview: NativePreview?

    private var data: AgendaTabData? { store.tab(eventID, "agenda", as: AgendaTabData.self) }

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
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    private func content(_ data: AgendaTabData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Agenda wydarzenia").font(.title2.weight(.light))
                    Spacer()
                    actions(data)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("Harmonogram").font(.headline)
                    if editMode { editItems } else { viewItems(data) }
                }
                .padding(16)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Uwagi").font(.headline)
                        Spacer()
                        if data.canManage && editMode {
                            Button { addNote(parent: nil, level: 0) } label: { Label("Dodaj uwagę", systemImage: "plus") }.controlSize(.small)
                        }
                    }
                    if editMode { editNotes } else { viewNotes(data.notes) }
                }
                .padding(16)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(18)
        }
    }

    @ViewBuilder private func actions(_ data: AgendaTabData) -> some View {
        HStack(spacing: 8) {
            if data.canManage && !editMode {
                Button { beginEdit(data) } label: { Label("Edytuj agendę", systemImage: "list.bullet") }
            }
            if data.canManage && editMode {
                Button { Task { await save(data) } } label: { Label(saving ? "Zapisywanie..." : "Zapisz", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).disabled(saving)
                Button("Anuluj") { editMode = false }.disabled(saving)
            } else if let agenda = data.agenda {
                let shouldGenerate = agenda.generatedPdfPath == nil || agenda.modified || !agenda.pdfExists
                if data.canManage && shouldGenerate {
                    let label = generating ? "Generowanie..." : (agenda.generatedPdfPath != nil || agenda.modified) ? "Regeneruj PDF" : "Generuj PDF"
                    Button { Task { await generate() } } label: { Label(label, systemImage: "arrow.down.doc") }.disabled(generating)
                }
                if agenda.generatedPdfPath != nil && agenda.pdfExists && !agenda.modified {
                    Button { Task { await openPdf(download: false) } } label: { Label("Pokaż PDF", systemImage: "eye") }
                    Button { Task { await openPdf(download: true) } } label: { Label("Pobierz PDF", systemImage: "arrow.down.circle") }
                }
                Button { Task { await printPdf(agenda) } } label: { Label("Drukuj", systemImage: "printer") }
            }
        }
        .controlSize(.regular)
    }

    // MARK: Harmonogram

    @ViewBuilder private func viewItems(_ data: AgendaTabData) -> some View {
        if data.items.isEmpty {
            VStack(spacing: 8) {
                Text("Brak etapów w harmonogramie").foregroundStyle(.secondary)
                if data.canManage { Button("Dodaj harmonogram") { beginEdit(data) } }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 18)
        } else {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    Text("GODZINA").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text("ETAP").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text("OPIS").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                Divider().gridCellColumns(3)
                ForEach(Array(data.items.enumerated()), id: \.offset) { item in
                    GridRow(alignment: .top) {
                        Text(item.element.time.isEmpty ? "--:--" : item.element.time).font(.callout.monospacedDigit().weight(.semibold)).foregroundStyle(theme.accent)
                        Text(item.element.title.isEmpty ? "—" : item.element.title).font(.callout.weight(.medium))
                        Text(item.element.description.isEmpty ? "—" : item.element.description).font(.callout).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private var editItems: some View {
        VStack(alignment: .leading, spacing: 8) {
            if items.isEmpty {
                Button { addItem() } label: { Label("Dodaj pierwszy etap", systemImage: "plus") }
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
            } else {
                ForEach($items) { $item in itemEditor($item) }
                Button { addItem() } label: { Label("Dodaj kolejny etap", systemImage: "plus") }
            }
        }
    }

    private func itemEditor(_ item: Binding<AgendaDraftItem>) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "clock").foregroundStyle(theme.accent).padding(.top, 4)
            if item.wrappedValue.editing {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        DatePicker("", selection: Binding(get: { AgendaTime.date(item.wrappedValue.time) }, set: { item.wrappedValue.time = AgendaTime.text($0) }),
                                   displayedComponents: .hourAndMinute)
                            .labelsHidden().frame(width: 90)
                        TextField("Tytuł etapu...", text: item.title).textFieldStyle(.roundedBorder)
                            .onSubmit { item.wrappedValue.editing = false }
                    }
                    TextField("Opis etapu...", text: item.description, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
                }
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(item.wrappedValue.time.isEmpty ? "--:--" : item.wrappedValue.time).font(.callout.monospacedDigit().weight(.semibold)).foregroundStyle(theme.accent)
                        Text(item.wrappedValue.title.isEmpty ? "(bez tytułu)" : item.wrappedValue.title).font(.callout.weight(.medium))
                    }
                    if !item.wrappedValue.description.isEmpty { Text(item.wrappedValue.description).font(.callout).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { item.wrappedValue.editing.toggle() } label: { Image(systemName: item.wrappedValue.editing ? "checkmark" : "pencil") }
                .buttonStyle(.borderless).help(item.wrappedValue.editing ? "Zatwierdź (Enter)" : "Edytuj")
            Button { let id = item.wrappedValue.id; items.removeAll { $0.id == id } } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless).foregroundStyle(.red)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    /// `getNextRoundedTime`: pełna godzina po ostatnim etapie (albo bieżąca pełna godzina).
    private func addItem() {
        var hour = MeetingDates.calendar.component(.hour, from: Date())
        if let last = items.last, AgendaTime.valid(last.time), let lastHour = Int(last.time.prefix(2)) { hour = (lastHour + 1) % 24 }
        items.append(AgendaDraftItem(time: String(format: "%02d:00", hour), title: "", description: "", editing: true))
    }

    // MARK: Uwagi

    @ViewBuilder private func viewNotes(_ notes: [AgendaTabData.Note]) -> some View {
        if notes.isEmpty {
            Text("Brak uwag do agendy.").foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(flatten(notes).enumerated()), id: \.offset) { item in
                    HStack(alignment: .top, spacing: 6) {
                        Text("•").foregroundStyle(theme.accent)
                        Text(item.element.content).font(.callout)
                    }
                    .padding(.leading, CGFloat(item.element.depth) * 24)
                }
            }
        }
    }

    private func flatten(_ notes: [AgendaTabData.Note], depth: Int = 0) -> [(content: String, depth: Int)] {
        notes.flatMap { note -> [(content: String, depth: Int)] in
            [(content: note.content, depth: depth)] + flatten(note.children, depth: depth + 1)
        }
    }

    private var editNotes: some View {
        VStack(alignment: .leading, spacing: 6) {
            if notes.isEmpty { Text("Brak uwag. Dodaj pierwszą uwagę.").foregroundStyle(.secondary) }
            ForEach($notes) { $note in
                HStack(spacing: 6) {
                    Text("•").foregroundStyle(theme.accent)
                    TextField("Treść uwagi...", text: $note.content).textFieldStyle(.roundedBorder)
                    if note.level < 2 {
                        Button { addNote(parent: note.id, level: note.level + 1) } label: { Image(systemName: "chevron.right") }
                            .buttonStyle(.borderless).help("Dodaj podpunkt")
                    }
                    Button { removeNote(note.id) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                }
                .padding(.leading, CGFloat(note.level) * 24)
            }
        }
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

    // MARK: Czynności

    private func beginEdit(_ data: AgendaTabData) {
        items = data.items.map { AgendaDraftItem(time: $0.time, title: $0.title, description: $0.description, editing: true) }
        var flat: [AgendaDraftNote] = []
        func walk(_ list: [AgendaTabData.Note], parent: String?) {
            for note in list {
                let id = note.id ?? UUID().uuidString
                flat.append(AgendaDraftNote(id: id, parent: parent, content: note.content, level: note.level))
                walk(note.children, parent: id)
            }
        }
        walk(data.notes, parent: nil)
        notes = flat
        editMode = true
    }

    private func noteTree(_ parent: String?) -> JSONValue {
        .array(notes.filter { $0.parent == parent }.map { note in
            .object(["id": .string(note.id), "content": .string(note.content), "level": .number(Double(note.level)), "children": noteTree(note.id)])
        })
    }

    private func save(_ data: AgendaTabData) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let sorted = items.sorted { (a, b) -> Bool in
            if a.time.isEmpty != b.time.isEmpty { return !a.time.isEmpty }
            return AgendaTime.minutes(a.time) < AgendaTime.minutes(b.time)
        }
        let start = data.agenda?.start.nonEmpty ?? data.event.start
        let end = data.agenda?.end.nonEmpty ?? data.event.end
        let body: [String: JSONValue] = [
            "start": .string(start), "end": .string(end),
            "items": .array(sorted.map { .object(["time": .string($0.time), "title": .string($0.title), "description": .string($0.description)]) }),
            "notes": noteTree(nil),
        ]
        do {
            try await store.tabAction(eventID, "agenda", "save", body, reload: ["agenda"], success: "Agenda została zapisana", pending: "Zapisywanie agendy…")
            editMode = false
        } catch {
            state.error = store.failureText(error, "Wystąpił błąd podczas zapisywania agendy")
        }
    }

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
