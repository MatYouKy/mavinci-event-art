import SwiftUI
import UniformTypeIdentifiers

/// Nowe zadanie i edycja — jak formularz w CRM: tytuł, opis, załączniki (tablica firmowa), priorytet, kolumna, termin
/// wykonania i przypisani pracownicy (tablica firmowa). Tablica prywatna zapisuje zadanie prywatne z identyfikatorem
/// nadanym raz na formularz, więc ponowienie po zerwanym połączeniu nie tworzy duplikatu.
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
    @State private var assignees: [String] = []
    @State private var personQuery = ""
    @State private var files: [AttachmentFile] = []
    @State private var importing = false
    @State private var saving = false
    @State private var savedID: String?
    @State private var newID = UUID().uuidString.lowercased()
    @State private var problem: String?
    @State private var prepared = false

    private var editing: BoardTask? { request.task }
    /// Tablica firmowa i tablica wydarzenia: przypisania i załączniki (tablica prywatna — tylko własne zadania).
    private var company: Bool { store.board != .mine }
    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var matches: [MeetingPerson] {
        let q = personQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(store.employees.filter { !assignees.contains($0.id) && ($0.name.lowercased().contains(q) || ($0.nickname ?? "").lowercased().contains(q)) }.prefix(5))
    }

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

                if company {
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
                        Button { importing = true } label: { Label("Dodaj pliki", systemImage: "paperclip") }.disabled(saving || savedID != nil)
                        Text("Zdjęcia, PDF-y, dokumenty i inne pliki. Możesz wybrać kilka naraz.").font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section {
                    Picker("Priorytet", selection: $priority) { ForEach(TaskPriorityKind.allCases) { Text($0.label).tag($0) } }
                    Picker("Kolumna", selection: $column) { ForEach(BoardColumnKind.allCases) { Text($0.label(store.board)).tag($0) } }
                    Toggle("Termin wykonania", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Data", selection: $due, displayedComponents: .date)
                            .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
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
                        TextField("Dodaj pracownika", text: $personQuery, prompt: Text("Wpisz imię, nazwisko lub email..."))
                        ForEach(matches) { person in
                            Button {
                                assignees.append(person.id); personQuery = ""
                            } label: {
                                HStack { Text(person.name); Spacer(); Text(person.nickname ?? "").font(.caption).foregroundStyle(.secondary) }
                                    .contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
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
                Button(savedID != nil ? "Ponów przesyłanie" : editing == nil ? "Utwórz" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(!valid || saving)
            }.padding(16)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 520, idealHeight: company ? 700 : 520)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: savedID != nil ? "Przesyłanie załączników…" : "Zapisywanie zadania…") } }
        .interactiveDismissDisabled(saving)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if !files.contains(where: { $0.url == url }) { files.append(AttachmentFile(url: url, size: size)) }
            }
        }
        .task {
            guard !prepared else { return }
            prepared = true
            if let task = editing {
                title = task.title; details = task.description; priority = task.priorityKind; column = task.column
                if let date = task.due { hasDue = true; due = date }
                assignees = task.assignees.map(\.id)
            } else {
                column = request.column
                if store.board == .company, let me = store.access?.employeeId ?? state.employee?.id { assignees = [me] }
            }
            if company { await store.loadEmployees() }
        }
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
                ]
                let target = editing?.id ?? (company ? nil : newID)
                id = try await store.save(id: target, existing: editing != nil, data: data, assignees: company ? assignees : nil)
                savedID = id
            }
            // Załączniki po zapisie zadania; przesłane znikają z listy, więc ponowienie nie dubluje plików.
            if let id, company {
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
