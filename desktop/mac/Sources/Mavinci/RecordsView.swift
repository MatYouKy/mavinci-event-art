import SwiftUI
import AppKit

struct RecordsView: View {
    let module: Module
    @EnvironmentObject var state: Workspace
    @State private var search = ""
    @State private var selection: String?
    @State private var sortOrder = [KeyPathComparator(\Row.title)]
    @State private var onlyMine = false
    @State private var onlyOpen = true
    @State private var editingTask: Row?
    @State private var showEditor = false
    var rows: [Row] {
        let phrase = search.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
        return state.rows(module).filter { row in
            let haystack = [row.title, row.email, row.phone, row["offer_number"], row.details["client_text"]?.text ?? ""].joined(separator: " ").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
            if !phrase.isEmpty && !haystack.contains(phrase) { return false }
            if onlyMine && module == .inquiries && row["inquiry_owner_id"] != state.employee?.id { return false }
            if onlyOpen {
                if [.inquiries, .tasks].contains(module) && ["completed", "done", "cancelled", "won", "lost"].contains(row.status) { return false }
                if module == .notifications && row.fields["is_read"]?.flag == true { return false }
            }
            return true
        }.sorted(using: sortOrder)
    }
    var selected: Row? { state.rows(module).first { $0.id == selection } }
    var body: some View {
        VStack(spacing: 0) {
            if let problem = state.moduleErrors[module.rawValue] {
                MessageBar(text: problem, warning: true) { state.moduleErrors.removeValue(forKey: module.rawValue) }
            }
            HStack {
                Text("\(rows.count) pozycji").font(.callout).foregroundStyle(.secondary)
                if module == .inquiries { Toggle("Tylko moje", isOn: $onlyMine).toggleStyle(.checkbox) }
                if [.inquiries, .tasks, .notifications].contains(module) {
                    Toggle(module == .notifications ? "Nieprzeczytane" : "Otwarte", isOn: $onlyOpen).toggleStyle(.checkbox)
                }
                Spacer()
                if let date = state.snapshot?.collections[module.rawValue]?.lastSync {
                    Text("Odświeżono \(date.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(12).background(.bar)
            GeometryReader { available in
              HSplitView {
                Table(rows, selection: $selection, sortOrder: $sortOrder) {
                    TableColumn(module == .contacts ? "Imię i nazwisko" : "Nazwa", value: \.title) { row in
                        HStack(spacing: 6) {
                            if module == .notifications && row.fields["is_read"]?.flag != true { Circle().fill(.blue).frame(width: 6, height: 6).accessibilityLabel("Nieprzeczytane") }
                            Text(row.title).lineLimit(2)
                        }
                    }.width(min: 210, ideal: 340)
                    TableColumn("Stan", value: \.status) { row in
                        Text(module == .notifications ? (row.fields["is_read"]?.flag == true ? "Przeczytane" : "Nowe") : Labels.text(row.status)).foregroundStyle(.secondary)
                    }.width(min: 100, ideal: 130, max: 180)
                    TableColumn(module == .contacts ? "Telefon" : "Termin", value: \.date) { row in
                        Text(module == .contacts ? (row.phone.isEmpty ? "—" : row.phone) : Labels.date(row.date)).monospacedDigit()
                    }.width(min: 140, ideal: 160, max: 200)
                }
                .contextMenu(forSelectionType: String.self) { ids in
                    if let id = ids.first, let row = rows.first(where: { $0.id == id }) {
                        Button("Pokaż szczegóły") { if module == .events { state.showEvent(id) } else { selection = id } }
                        if module == .tasks {
                            Button("Edytuj zadanie") { edit(row) }.disabled(!state.canWrite || !state.allowed("task_update", row: row))
                        }
                        if module == .notifications {
                            Button("Oznacz jako przeczytane") { Task { await state.perform("notification_read", row: row) } }.disabled(!state.canWrite || row.fields["is_read"]?.flag == true)
                        }
                        Divider()
                        Button("Kopiuj nazwę") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(row.title, forType: .string) }
                    }
                } primaryAction: { ids in
                    if let id = ids.first { if module == .events { state.showEvent(id) } else { selection = id } }
                }
                .overlay { if rows.isEmpty { ContentUnavailableView(search.isEmpty ? "Brak pozycji" : "Brak wyników", systemImage: module.symbol, description: Text(search.isEmpty ? "Odśwież dane lub zmień filtry." : "Zmień szukany tekst.")) } }
                .frame(minWidth: 540, maxHeight: .infinity)
                if module != .events, let row = selected {
                    RecordInspector(row: row, module: module, editTask: { edit(row) }).id(row.id)
                        .frame(minWidth: 320, idealWidth: 370, maxWidth: 480)
                } else if module != .events {
                    ContentUnavailableView("Wybierz pozycję", systemImage: "cursorarrow.click", description: Text("Zaznacz wiersz, aby zobaczyć szczegóły i dostępne czynności."))
                        .frame(minWidth: 320, idealWidth: 370, maxWidth: 480)
                }
              }.frame(width: available.size.width, height: available.size.height)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            if [.contacts, .offers, .tenders].contains(module) {
                Text("Pierwsza wersja: lista i podgląd danych. Tworzenie oraz edycja tego modułu są w kolejnych etapach.")
                    .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(.bar)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .navigationTitle(module.title)
        .searchable(text: $search, prompt: "Szukaj w tej sekcji")
        .toolbar {
            if module == .tasks {
                ToolbarItem {
                    Button { editingTask = nil; showEditor = true } label: { Label("Nowe zadanie", systemImage: "plus") }
                        .keyboardShortcut("n").disabled(!state.canWrite || !state.allowed("task_create"))
                }
                ToolbarItem {
                    Button { if let selected { edit(selected) } } label: { Label("Edytuj", systemImage: "square.and.pencil") }
                        .keyboardShortcut("e").disabled(selected == nil || !state.canWrite)
                }
            }
        }
        .sheet(isPresented: $showEditor) { TaskEditor(row: editingTask) }
        .onAppear { revealTarget() }
        .onChange(of: state.focusedID) { _, _ in revealTarget() }
        .onChange(of: selection) { _, id in if module == .events, let id { state.showEvent(id) } }
    }
    private func edit(_ row: Row) { editingTask = row; showEditor = true }
    private func revealTarget() {
        guard let id = state.focusedID else { return }
        onlyOpen = false; onlyMine = false; search = ""; selection = id
    }
}

struct RecordInspector: View {
    let row: Row
    let module: Module
    let editTask: () -> Void
    @EnvironmentObject var state: Workspace
    @State private var followupSheet = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(row.title).font(.title2.bold()).textSelection(.enabled)
                if !row.status.isEmpty { Label(Labels.text(row.status), systemImage: module.symbol).font(.callout).foregroundStyle(.secondary) }
                if module != .contacts { field("Termin", Labels.date(row.date)) }
                if !row["description"].isEmpty { field("Opis", row["description"]) }
                if !row["message"].isEmpty { field("Treść", row["message"]) }
                if !row.phone.isEmpty {
                    field("Telefon", row.phone)
                    Button("Zadzwoń", systemImage: "phone") { openContact("tel", value: row.phone) }.disabled(state.offline)
                }
                if !row.email.isEmpty {
                    field("E-mail", row.email)
                    Button("Napisz e-mail", systemImage: "envelope") { openContact("mailto", value: row.email) }.disabled(state.offline)
                }
                if module == .inquiries {
                    field("Klient", row.details["client_text"]?.text ?? "")
                    field("Miejsce", row.details["location_text"]?.text ?? "")
                    field("Zakres", row.details["scope"]?.text ?? "")
                    if let raw = row.details["termin"]?.text { field("Data wydarzenia", Labels.date(raw)) }
                    field("Kolejne działanie", Labels.date(row["next_action_at"]))
                    if row["inquiry_owner_id"].isEmpty {
                        Button("Przypisz do mnie", systemImage: "person.badge.plus") { Task { await state.perform("claim_inquiry", row: row) } }
                            .disabled(!state.canWrite || !state.allowed("claim_inquiry", row: row))
                    }
                    Button("Zapisz wykonany kontakt…", systemImage: "checkmark.bubble") { followupSheet = true }
                        .disabled(!state.canWrite || !state.allowed("complete_inquiry_followup", row: row))
                    Button("Odłóż kontakt o godzinę", systemImage: "clock.arrow.circlepath") {
                        Task { await state.perform("snooze_inquiry_followup", row: row, payload: ["p_minutes": .number(60)]) }
                    }.disabled(!state.canWrite || !state.allowed("snooze_inquiry_followup", row: row))
                }
                if module == .tasks {
                    field("Priorytet", Labels.text(row["priority"]))
                    Button("Edytuj zadanie", systemImage: "square.and.pencil", action: editTask)
                        .disabled(!state.canWrite || !state.allowed("task_update", row: row))
                }
                if module == .events { field("Miejsce", row["location"]); field("Koniec wydarzenia", Labels.date(row["event_end_date"])) }
                if module == .offers { field("Numer oferty", row["offer_number"]); related(.inquiries, key: "inquiry_id", label: "Otwórz zapytanie") }
                if module == .notifications {
                    Button("Oznacz jako przeczytane", systemImage: "envelope.open") { Task { await state.perform("notification_read", row: row) } }
                        .disabled(!state.canWrite || row.fields["is_read"]?.flag == true)
                    if let target = notificationTarget {
                        Button("Otwórz powiązaną sprawę", systemImage: "arrow.up.forward.app") { state.open(target, id: row["related_entity_id"]) }
                            .disabled(state.employee?.canView(target) != true)
                    } else if !row["related_entity_id"].isEmpty || !row["action_url"].isEmpty {
                        Text("Powiązany ekran lub odpowiedź na zaproszenie wymaga kolejnego etapu aplikacji.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if module == .tenders { related(.inquiries, key: "inquiry_id", label: "Otwórz zapytanie") }
                if [.tasks, .inquiries, .offers].contains(module) { related(.events, key: "event_id", label: "Otwórz wydarzenie") }
                if module == .inquiries { related(.offers, key: "linked_offer_id", label: "Otwórz ofertę") }
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
        }.sheet(isPresented: $followupSheet) { FollowupEditor(row: row) }
    }
    @ViewBuilder private func field(_ label: String, _ value: String) -> some View {
        if !value.isEmpty { VStack(alignment: .leading, spacing: 4) { Text(label).font(.caption).foregroundStyle(.secondary); Text(value).textSelection(.enabled) } }
    }
    @ViewBuilder private func related(_ module: Module, key: String, label: String) -> some View {
        if !row[key].isEmpty && state.employee?.canView(module) == true {
            Button(label, systemImage: module.symbol) { state.open(module, id: row[key]) }
        }
    }
    private var notificationTarget: Module? {
        guard !row["related_entity_id"].isEmpty else { return nil }
        return ["task": .tasks, "inquiry": .inquiries, "event": .events, "offer": .offers, "tender": .tenders, "contact": .contacts][row["related_entity_type"]]
    }
    private func openContact(_ scheme: String, value: String) {
        var parts = URLComponents(); parts.scheme = scheme; parts.path = value
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }
}

enum DateInput {
    static func formatter() -> DateFormatter {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = TimeZone(identifier: "Europe/Warsaw"); f.dateFormat = "dd.MM.yyyy HH:mm"; f.isLenient = false
        return f
    }
    static func parse(_ text: String) -> Date? {
        let f = formatter(); guard let date = f.date(from: text), f.string(from: date) == text else { return nil }; return date
    }
}
struct EditableDate: View {
    @Binding var text: String
    var body: some View {
        TextField("Data i godzina", text: $text, prompt: Text("DD.MM.RRRR GG:mm"))
        DatePicker("Wybierz w kalendarzu", selection: Binding(get: { DateInput.parse(text) ?? Date() }, set: { text = DateInput.formatter().string(from: $0) }), displayedComponents: [.date, .hourAndMinute])
            .environment(\.locale, Locale(identifier: "pl_PL")).environment(\.timeZone, TimeZone(identifier: "Europe/Warsaw")!)
        if DateInput.parse(text) == nil { Text("Wpisz rzeczywistą datę i godzinę, np. 05.11.2026 10:30.").font(.caption).foregroundStyle(.red) }
    }
}
struct TaskEditor: View {
    let row: Row?
    @EnvironmentObject var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var priority = "medium"
    @State private var stage = "todo"
    @State private var hasDueDate = false
    @State private var dateText = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var titleFocused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(row == nil ? "Nowe prywatne zadanie" : "Edycja zadania").font(.title2.bold())
            Form {
                TextField("Tytuł", text: $title).focused($titleFocused)
                if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { Text("Wpisz tytuł zadania.").font(.caption).foregroundStyle(.secondary) }
                TextField("Opis", text: $description, axis: .vertical).lineLimit(3...8)
                Picker("Priorytet", selection: $priority) { ForEach(Labels.priorities, id: \.self) { Text(Labels.text($0)).tag($0) } }
                Picker("Etap", selection: $stage) { ForEach(Labels.taskStages, id: \.self) { Text(Labels.text($0)).tag($0) } }
                Toggle("Ustaw termin", isOn: $hasDueDate)
                if hasDueDate { EditableDate(text: $dateText) }
            }.formStyle(.grouped).disabled(saving)
            if let error { Text(error).foregroundStyle(.red).font(.callout).textSelection(.enabled) }
            HStack {
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Spacer()
                Button(saving ? "Zapisywanie…" : "Zapisz") { save() }.keyboardShortcut(.defaultAction)
                    .disabled(saving || !state.canWrite || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (hasDueDate && DateInput.parse(dateText) == nil))
            }
        }.padding(24).frame(width: 580)
            .onAppear {
                state.editing = true
                if let row {
                    title = row.title; description = row["description"]; priority = row["priority"]
                    stage = Labels.taskStages.contains(row.status) ? row.status : "todo"
                    hasDueDate = !row["due_date"].isEmpty; dateText = Labels.date(row["due_date"])
                } else { dateText = DateInput.formatter().string(from: Date()) }
                titleFocused = true
            }.onDisappear { state.editing = false }
            .interactiveDismissDisabled(saving)
    }
    private func save() {
        saving = true; error = nil
        var payload: [String: JSONValue] = ["title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "description": description.isEmpty ? .null : .string(description), "priority": .string(priority), "status": .string(stage), "board_column": .string(stage)]
        payload["due_date"] = hasDueDate ? DateInput.parse(dateText).map { .string(ISO8601DateFormatter().string(from: $0)) } ?? .null : .null
        if row == nil { payload["created_by"] = .string(state.employee?.id ?? "") }
        else if stage != "in_progress" { payload["currently_working_by"] = .null }
        Task {
            if await state.perform(row == nil ? "task_create" : "task_update", row: row, payload: payload) { dismiss() }
            else { error = state.error ?? "Nie udało się zapisać zmian. Odśwież dane przed ponowną próbą." }
            saving = false
        }
    }
}

struct FollowupEditor: View {
    let row: Row
    @EnvironmentObject var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var next = true
    @State private var text = DateInput.formatter().string(from: Date().addingTimeInterval(86_400))
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Zapisz wykonany kontakt").font(.title2.bold())
            Text(row.title).foregroundStyle(.secondary)
            Form {
                Toggle("Zaplanuj kolejne działanie", isOn: $next)
                if next { EditableDate(text: $text) }
            }.formStyle(.grouped).disabled(saving)
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                Button("Anuluj") { dismiss() }.disabled(saving)
                Spacer()
                Button("Potwierdź kontakt") {
                    saving = true
                    Task {
                        let value = next ? DateInput.parse(text).map { JSONValue.string(ISO8601DateFormatter().string(from: $0)) } ?? .null : .null
                        if await state.perform("complete_inquiry_followup", row: row, payload: ["p_next_action_at": value]) { dismiss() }
                        else { error = state.error ?? "Nie udało się zapisać kontaktu." }
                        saving = false
                    }
                }.disabled(saving || !state.canWrite || (next && DateInput.parse(text) == nil)).keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 540).onAppear { state.editing = true }.onDisappear { state.editing = false }.interactiveDismissDisabled(saving)
    }
}
