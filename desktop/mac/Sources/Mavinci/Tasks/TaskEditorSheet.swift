import SwiftUI
import UniformTypeIdentifiers

/// Nowe zadanie i edycja — jak formularz w CRM: tytuł, opis, załączniki (każda tablica, jak w aplikacji na telefonie; pliki
/// przeciągnięte z Findera na strefę „Przeciągnij pliki tutaj” albo „Dodaj pliki”), priorytet,
/// kolumna, termin wykonania (dzień i opcjonalnie godzina — bez godziny cały dzień, jak w CRM i w aplikacji) i przypisani pracownicy
/// (tablica firmowa). Tablica prywatna zapisuje zadanie prywatne z identyfikatorem nadanym raz na formularz, więc ponowienie po
/// zerwanym połączeniu nie tworzy duplikatu. Treść arkusza nie czyta wpisywanego tytułu ani wyszukiwania pracownika — czytają
/// je `TaskSaveButton` i `TaskAssigneeSearch`, więc litera nie przelicza całego formularza.
@MainActor struct TaskEditorSheet: View {
    @ObservedObject var store: TasksStore
    let request: TaskEditRequest
    let saved: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    @State private var title = ""
    @State private var details = ""
    @State private var priority: TaskPriorityKind = .medium
    @State private var column: BoardColumnKind = .todo
    @State private var hasDue = false
    @State private var due = Date()
    /// Termin z godziną (bez niej — cały dzień, do 23:59).
    @State private var hasTime = false
    @State private var assignees: [String] = []
    @State private var files: [AttachmentFile] = []
    /// Informacja o pominiętych folderach (dodajemy tylko pliki).
    @State private var filesNote: String?
    @State private var importing = false
    @State private var saving = false
    @State private var savedID: String?
    @State private var newID = UUID().uuidString.lowercased()
    @State private var problem: String?
    @State private var prepared = false

    private var editing: BoardTask? { request.task }
    /// Tablica firmowa i tablica wydarzenia: przypisania (tablica prywatna — tylko własne zadania). Załączniki — na każdej tablicy.
    private var company: Bool { store.board != .mine }
    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(editing == nil ? "Nowe zadanie" : "Edytuj zadanie").font(.title2.bold())
                Spacer()
            }.padding([.horizontal, .top], 20).padding(.bottom, 6)

            Form {
                Section {
                    TextField("Tytuł", text: $title, prompt: Text("Wprowadź tytuł zadania"))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Opis").font(.caption).foregroundStyle(.secondary)
                        TextEditor(text: $details).frame(minHeight: 80).font(.body)
                    }
                }
                .disabled(savedID != nil)

                Section("Załączniki") {
                    ForEach(files) { file in
                        HStack {
                            Image(systemName: file.contentType.hasPrefix("image/") ? "photo" : "doc").foregroundStyle(theme.accent)
                            VStack(alignment: .leading) { Text(file.name).lineLimit(1); Text(file.sizeLabel).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button { files.removeAll { $0.id == file.id } } label: { Image(systemName: "minus.circle.fill") }
                                .buttonStyle(.borderless).foregroundStyle(.red).disabled(saving || savedID != nil).help("Usuń załącznik")
                        }
                    }
                    TaskAttachmentDropZone(disabled: saving || savedID != nil, choose: { importing = true }, drop: addFiles)
                    if let filesNote { Text(filesNote).font(.caption).foregroundStyle(.orange) }
                }

                Section {
                    Picker("Priorytet", selection: $priority) { ForEach(TaskPriorityKind.allCases) { Text($0.label).tag($0) } }
                    Picker("Kolumna", selection: $column) { ForEach(BoardColumnKind.allCases) { Text($0.label(store.board)).tag($0) } }
                    Toggle("Termin wykonania", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Data", selection: $due, displayedComponents: .date)
                            .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                        Toggle("Godzina", isOn: $hasTime)
                        if hasTime {
                            DatePicker("Do godziny", selection: $due, displayedComponents: .hourAndMinute)
                                .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                        }
                        Text(hasTime ? "Termin: do \(MeetingDates.time(due))." : "Bez godziny — termin na cały dzień (do końca dnia).")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .disabled(savedID != nil)

                if company {
                    Section("Przypisani pracownicy") {
                        if !assignees.isEmpty {
                            ForEach(assignees, id: \.self) { id in
                                HStack {
                                    Image(systemName: "person").foregroundStyle(theme.accent)
                                    Text(personName(id))
                                    Spacer()
                                    Button { assignees.removeAll { $0 == id } } label: { Image(systemName: "xmark.circle.fill") }
                                        .buttonStyle(.borderless).foregroundStyle(.secondary).help("Usuń z zadania")
                                }
                            }
                        }
                        TaskAssigneeSearch(store: store, assignees: $assignees)
                    }
                    .disabled(savedID != nil)
                }

                if savedID != nil && !saving {
                    Section { Label("Zadanie jest zapisane. Pozostałe pliki oczekują na ponowne przesłanie.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)

            HStack {
                Spacer()
                Button(savedID != nil ? "Zamknij" : "Anuluj") { if savedID != nil { store.finishSave() }; dismiss() }
                    .keyboardShortcut(.cancelAction).disabled(saving)
                TaskSaveButton(title: $title, saving: saving, label: savedID != nil ? "Ponów przesyłanie" : editing == nil ? "Utwórz" : "Zapisz") {
                    Task { await save() }
                }
            }.padding(16)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 520, idealHeight: company ? 700 : 600)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: savedID != nil ? "Przesyłanie załączników…" : "Zapisywanie zadania…") } }
        .interactiveDismissDisabled(saving)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            addFiles(urls)
        }
        .onChange(of: hasTime) { _, on in
            // Godzina włączona przy terminie bez godziny — zaczynamy od 18:00 (zamiast końca dnia).
            guard on, prepared, editing?.dueTime == nil else { return }
            due = MeetingDates.calendar.date(bySettingHour: 18, minute: 0, second: 0, of: due) ?? due
        }
        .task {
            guard !prepared else { return }
            prepared = true
            if let task = editing {
                title = task.title; details = task.description; priority = task.priorityKind; column = task.column
                if let date = task.due { hasDue = true; due = date; hasTime = task.dueTime != nil }
                assignees = task.assignees.map(\.id)
            } else {
                column = request.column
                if store.board == .company, let me = store.access?.employeeId ?? state.employee?.id { assignees = [me] }
            }
            if company { await store.loadEmployees() }
        }
    }

    /// Pliki z „Dodaj pliki” i przeciągnięte z Findera — bez powtórzeń; foldery pomijane z informacją.
    private func addFiles(_ urls: [URL]) {
        var skipped = 0
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            var directory: ObjCBool = false
            guard url.isFileURL, FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), !directory.boolValue else {
                skipped += 1
                continue
            }
            guard !files.contains(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) else { continue }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            files.append(AttachmentFile(url: url, size: size))
        }
        filesNote = skipped > 0 ? "Foldery nie są dodawane — przeciągnij pliki z ich wnętrza." : nil
    }

    private func personName(_ id: String) -> String {
        store.employees.first { $0.id == id }?.name ?? editing?.assignees.first { $0.id == id }?.name ?? (id == state.employee?.id ? state.employee?.displayName ?? "Ty" : "Pracownik")
    }

    private func save() async {
        guard valid, !saving else { return }
        problem = nil
        saving = true
        defer { saving = false }
        do {
            var id = savedID
            if id == nil {
                let data: [String: JSONValue] = [
                    "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "description": .string(details),
                    "priority": .string(priority.rawValue),
                    "boardColumn": .string(column.rawValue),
                    "dueDate": hasDue ? .string(TaskDates.dayString(due)) : .null,
                    "dueTime": hasDue && hasTime ? .string(MeetingDates.time(due)) : .null,
                ]
                let target = editing?.id ?? (company ? nil : newID)
                id = try await store.save(id: target, existing: editing != nil, data: data, assignees: company ? assignees : nil)
                savedID = id
            }
            // Załączniki po zapisie zadania; przesłane znikają z listy, więc ponowienie nie dubluje plików.
            if let id {
                for file in files {
                    try await store.upload(file.url, to: id)
                    files.removeAll { $0.id == file.id }
                }
            }
            state.succeed(editing == nil ? "Zadanie zostało utworzone" : "Zadanie zostało zaktualizowane")
            store.finishSave()
            if let id { saved(id) }
            dismiss()
        } catch {
            let message = store.failureText(error, "Błąd podczas zapisywania zadania")
            problem = savedID != nil ? "Zadanie zapisane. \(message) Ponów przesyłanie pozostałych plików." : message
        }
    }
}

/// Strefa załączników zadania: przeciągnięcie plików z Findera (podświetlenie przy przeciąganiu) albo „Dodaj pliki”.
/// Jak strefa w formularzu zadania w CRM.
@MainActor struct TaskAttachmentDropZone: View {
    let disabled: Bool
    let choose: () -> Void
    let drop: ([URL]) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var targeted = false

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: targeted ? "arrow.down.doc.fill" : "arrow.down.doc")
                .font(.system(size: 26)).foregroundStyle(theme.accent)
            Text(targeted ? "Upuść, aby dodać pliki" : "Przeciągnij pliki tutaj").font(.headline)
            Button(action: choose) { Label("Dodaj pliki", systemImage: "paperclip") }.disabled(disabled)
            Text("Zdjęcia, PDF-y, dokumenty i inne pliki — możesz dodać kilka naraz.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18).padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: 10).fill(theme.accent.opacity(targeted ? 0.14 : 0.04)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(theme.accent.opacity(targeted ? 0.9 : 0.4), style: StrokeStyle(lineWidth: targeted ? 2 : 1.5, dash: [7, 5]))
        )
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .opacity(disabled ? 0.5 : 1)
        .dropDestination(for: URL.self) { urls, _ in
            let fileURLs = urls.filter(\.isFileURL)
            guard !disabled, !fileURLs.isEmpty else { return false }
            drop(fileURLs)
            return true
        } isTargeted: { targeted = $0 && !disabled }
        .animation(.easeOut(duration: 0.12), value: targeted)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Strefa upuszczania załączników")
    }
}

/// Przycisk zapisu zadania — sam sprawdza tytuł, więc wpisywanie tytułu nie przelicza całego formularza.
@MainActor struct TaskSaveButton: View {
    @Binding var title: String
    let saving: Bool
    let label: String
    let action: () -> Void

    var body: some View {
        Button(label, action: action)
            .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
    }
}

/// „Dodaj pracownika” do zadania: wyszukiwanie wśród pracowników (bez już przypisanych, do 5 wyników) — zapytanie w tym
/// widoku, więc wpisywanie nie przelicza całego formularza.
@MainActor struct TaskAssigneeSearch: View {
    @ObservedObject var store: TasksStore
    @Binding var assignees: [String]
    @State private var query = ""

    private var matches: [MeetingPerson] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(store.employees.filter { !assignees.contains($0.id) && ($0.name.lowercased().contains(q) || ($0.nickname ?? "").lowercased().contains(q)) }.prefix(5))
    }

    var body: some View {
        TextField("Dodaj pracownika", text: $query, prompt: Text("Wpisz imię, nazwisko lub email..."))
        ForEach(matches) { person in
            Button {
                assignees.append(person.id); query = ""
            } label: {
                HStack { Text(person.name); Spacer(); Text(person.nickname ?? "").font(.caption).foregroundStyle(.secondary) }
                    .contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }
}
