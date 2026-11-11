import SwiftUI
import AppKit

@MainActor struct RecordsView: View {
    let module:Module
    @EnvironmentObject var state:Workspace
    @State private var search=""
    @State private var selection:String?
    @State private var sortOrder=[KeyPathComparator(\Row.title)]
    @State private var onlyMine=false
    @State private var onlyOpen=true
    @State private var includeHidden=false
    @State private var status=""
    @State private var modalID:String?
    @State private var editingContact=false
    private var archivable:Bool{module == .events || module == .offers}
    private var rows:[Row] {
        state.rows(module).filter{row in
            if archivable && !includeHidden && WorkspacePresentation.isArchived(row,module:module){return false}
            if !status.isEmpty && row["status"] != status{return false}
            let text=[row.title,row.email,row.phone,row["offer_number"],row["description"],row.details["client_text"]?.text ?? ""].joined(separator:" ")
            if !search.isEmpty && !text.localizedStandardContains(search){return false}
            if onlyMine && module == .inquiries && row["inquiry_owner_id"] != state.employee?.id{return false}
            if onlyOpen && module == .inquiries && ["completed","done","cancelled","won","lost"].contains(row.status){return false}
            return true
        }.sorted(using:sortOrder)
    }
    private var selected:Row?{state.rows(module).first{$0.id==selection}}
    private var statusCodes:[String]{Set(state.rows(module).map{$0["status"]}.filter{!$0.isEmpty}).sorted()}
    var body:some View {
        GeometryReader { outer in
            let wide=outer.size.width>=1000
            VStack(spacing:0) {
                if let problem=state.moduleErrors[module == .events ? "calendar":module.rawValue] {
                    MessageBar(text:problem,warning:true){state.moduleErrors.removeValue(forKey:module.rawValue)}
                }
                HStack(spacing:14) {
                    Text("\(rows.count) pozycji").font(.callout).foregroundStyle(.secondary)
                    if module == .inquiries {
                        Toggle("Tylko moje",isOn:$onlyMine).toggleStyle(.checkbox)
                        Toggle("Otwarte",isOn:$onlyOpen).toggleStyle(.checkbox)
                    }
                    if archivable {
                        Picker("Status",selection:$status){Text("Wszystkie statusy").tag("");ForEach(statusCodes,id:\.self){Text(Labels.text($0)).tag($0)}}.frame(maxWidth:230)
                        Toggle(search.isEmpty ? "Pokaż również ukryte":"Szukaj również w ukrytych",isOn:$includeHidden).toggleStyle(.checkbox)
                    }
                    Spacer(minLength:0)
                    if module == .contacts {
                        Label("Kontakty CRM",systemImage:"building.2").font(.caption).foregroundStyle(.secondary)
                        Button("Edytuj",systemImage:"square.and.pencil"){editingContact=true}.keyboardShortcut("e").disabled(selected==nil || !state.canWrite || !state.allowed("contact_update"))
                    }
                }.padding(.horizontal,14).frame(height:46).crmBar()
                GeometryReader { available in
                    let side=wide && selected != nil && module != .events
                    let sideWidth:CGFloat=350
                    let tableWidth=max(1,available.size.width-(side ? sideWidth+1:0))
                    HStack(alignment:.top,spacing:0) {
                        table.frame(width:tableWidth,height:available.size.height,alignment:.topLeading)
                        if side,let selected {
                            Divider()
                            inspector(selected).frame(width:sideWidth,height:available.size.height,alignment:.topLeading)
                        }
                    }.frame(width:available.size.width,height:available.size.height,alignment:.topLeading)
                }
                if module == .contacts {
                    Text("Wyłącznie kartoteka CRM. Aplikacja nie odczytuje ani nie łączy prywatnych kontaktów z telefonu lub Maca.").font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,alignment:.leading).padding(10).crmBar()
                }
            }.frame(width:outer.size.width,height:outer.size.height,alignment:.topLeading)
            .onChange(of:selection){_,id in
                guard let id else{return}
                if module == .events{state.showEvent(id)}else if !wide{modalID=id}
            }
            .onChange(of:wide){_,value in if value{modalID=nil}else if let selection{modalID=selection}}
            .onAppear{reveal(wide:wide)}
            .onChange(of:state.focusToken){_,_ in reveal(wide:wide)}
        }.navigationTitle(module.title).searchable(text:$search,prompt:"Szukaj w tej sekcji")
        .sheet(isPresented:Binding(get:{modalID != nil},set:{if !$0{modalID=nil}})) {
            if let row=state.rows(module).first(where:{$0.id==modalID}) {
                VStack(spacing:0){HStack{Text("Szczegóły").font(.headline);Spacer();Button("Zamknij"){modalID=nil}.keyboardShortcut(.cancelAction)}.padding();inspector(row)}.frame(width:620,height:660)
                    .sheet(isPresented:$editingContact){ContactEditor(contactID:row.id)}
            }
        }
        .sheet(isPresented:Binding(get:{editingContact && modalID==nil},set:{editingContact=$0})) {
            if let selected{ContactEditor(contactID:selected.id)}
        }
    }
    private var table:some View {
        Table(rows,selection:$selection,sortOrder:$sortOrder) {
            TableColumn(module == .contacts ? "Imię i nazwisko":"Nazwa",value:\.title){row in Text(row.title).lineLimit(2)}.width(min:230,ideal:420)
            TableColumn("Stan",value:\.status){row in Text(Labels.text(row.status)).foregroundStyle(.secondary)}.width(min:100,ideal:140,max:180)
            TableColumn(module == .contacts ? "Telefon":"Termin",value:\.date){row in Text(module == .contacts ? (row.phone.isEmpty ? "—":row.phone):Labels.date(row.date)).monospacedDigit()}.width(min:135,ideal:160,max:190)
        }.contextMenu(forSelectionType:String.self){ids in
            if let id=ids.first {
                Button("Pokaż szczegóły"){selection=id}
                if module == .contacts{Button("Edytuj kontakt CRM"){selection=id;editingContact=true}.disabled(!state.canWrite || !state.allowed("contact_update"))}
            }
        }primaryAction:{ids in if let id=ids.first{selection=id;if module == .events{state.showEvent(id)}}}
        .overlay{if rows.isEmpty{ContentUnavailableView("Brak pozycji",systemImage:module.symbol,description:Text(archivable ? "Zmień filtry lub uwzględnij ukryte rekordy.":"Zmień wyszukiwanie lub odśwież dane."))}}
    }
    private func inspector(_ row:Row)->some View {
        RecordInspector(row:row,module:module,editTask:{},editContact:module == .contacts ? {editingContact=true}:nil)
    }
    private func reveal(wide:Bool) {
        guard let id=state.focusedID,state.rows(module).contains(where:{$0.id==id})else{return}
        search="";status="";includeHidden=true;onlyOpen=false;onlyMine=false;selection=id
        if !wide && module != .events{modalID=id}
    }
}

struct RecordInspector: View {
    let row: Row
    let module: Module
    let editTask: () -> Void
    var editContact: (() -> Void)? = nil
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
                if module == .contacts, let editContact {
                    Button("Edytuj kontakt CRM",systemImage:"square.and.pencil",action:editContact).disabled(!state.canWrite || !state.allowed("contact_update"))
                    field("Stanowisko",row["position"]);field("Adres",row["address"]);field("Miejscowość",row["city"]);field("Kod pocztowy",row["postal_code"]);field("Kraj",row["country"]);field("Notatki",row["notes"])
                }
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
