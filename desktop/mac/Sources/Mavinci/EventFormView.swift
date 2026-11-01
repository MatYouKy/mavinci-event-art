import SwiftUI

struct EventFormView: View {
    let form:EventForm
    @ObservedObject var store:EventPageStore
    @EnvironmentObject var workspace:Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var values:[String:String]=[:]
    @State private var lookups:[String:[Row]]=[:]
    @State private var errors:[String:String]=[:]
    @State private var failure:String?
    @State private var initialized=false
    @FocusState private var focused:String?
    var body:some View {
        VStack(alignment:.leading,spacing:14) {
            Text(form.title).font(.title2.bold())
            Form {
                ForEach(form.fields) { field in
                    VStack(alignment:.leading,spacing:5) {
                        editor(field)
                        if let error=errors[field.id] { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                }
            }.formStyle(.grouped).disabled(store.saving)
            if let failure { Text(failure).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(store.saving)
                Spacer()
                Button(store.saving ? "Zapisywanie…":"Zapisz") { save() }.keyboardShortcut(.defaultAction)
                    .disabled(store.saving || !initialized || !workspace.canWrite)
            }
        }.padding(24).frame(width:620,height:form.fields.count > 5 ? 640:520)
        .task { await initialize() }
        .onAppear { workspace.editing=true }
        .onDisappear { workspace.editing=false }
        .interactiveDismissDisabled(store.saving)
    }
    private func binding(_ key:String) -> Binding<String> {
        Binding(get:{values[key] ?? ""},set:{ values[key]=$0; errors.removeValue(forKey:key) })
    }
    @ViewBuilder private func editor(_ field:EventField) -> some View {
        switch field.kind {
        case .multiline: TextField(field.label,text:binding(field.id),axis:.vertical).lineLimit(3...8).focused($focused,equals:field.id)
        case .choice(let choices): Picker(field.label,selection:binding(field.id)) { ForEach(choices,id:\.self) { Text(Labels.text($0)).tag($0) } }
        case .lookup(let table):
            Picker(field.label,selection:binding(field.id)) {
                Text("Wybierz…").tag("")
                ForEach(lookups[table] ?? []) { row in Text([row.title,row["surname"]].filter{!$0.isEmpty}.joined(separator:" ")).tag(row.id) }
            }
        case .date:
            TextField(field.label,text:binding(field.id),prompt:Text("DD.MM.RRRR GG:mm")).focused($focused,equals:field.id)
            DatePicker("Wybierz w kalendarzu",selection:Binding(get:{DateInput.parse(values[field.id] ?? "") ?? Date()},set:{ values[field.id]=DateInput.formatter().string(from:$0); errors.removeValue(forKey:field.id) }),displayedComponents:[.date,.hourAndMinute])
                .environment(\.locale,Locale(identifier:"pl_PL")).environment(\.timeZone,TimeZone(identifier:"Europe/Warsaw")!)
        case .day:
            TextField(field.label,text:binding(field.id),prompt:Text("DD.MM.RRRR")).focused($focused,equals:field.id)
            DatePicker("Wybierz datę",selection:Binding(get:{parseDay(values[field.id] ?? "") ?? Date()},set:{values[field.id]=dayFormat().string(from:$0);errors.removeValue(forKey:field.id)}),displayedComponents:.date).environment(\.locale,Locale(identifier:"pl_PL"))
        case .time: TextField(field.label,text:binding(field.id),prompt:Text("GG:mm")).focused($focused,equals:field.id)
        case .toggle: Toggle(field.label,isOn:Binding(get:{values[field.id]=="true"},set:{values[field.id]=$0 ? "true":"false"}))
        default: TextField(field.label,text:binding(field.id)).focused($focused,equals:field.id)
        }
    }
    private func initialize() async {
        for field in form.fields {
            if form.table == "event_agendas",form.record == nil,field.id == "event_name" {values[field.id]=store.page?.event.title}
            if let value=form.record?.fields[field.id] {
                switch value {
                case .number(let n): values[field.id]=n.formatted(.number.grouping(.never).locale(Locale(identifier:"pl_PL")))
                case .bool(let b): values[field.id]=b ? "true":"false"
                default: values[field.id]=value.text
                }
            }
            let raw=values[field.id] ?? ""
            switch field.kind {
            case .date: if !raw.isEmpty { values[field.id]=Labels.date(raw) }
            case .day: values[field.id]=raw.isEmpty ? dayFormat().string(from:Date()):Labels.date(raw)
            case .time:
                if raw.contains("T"),let time=raw.split(separator:"T").last { values[field.id]=String(time.prefix(5)) }
                else { values[field.id]=String(raw.prefix(5)) }
            case .choice(let choices): if raw.isEmpty { values[field.id]=choices.contains("medium") ? "medium":choices.first }
            case .integer: if raw.isEmpty { values[field.id]="0" }
            case .lookup(let table):
                do { lookups[table]=try await workspace.eventAPI()?.eventLookup(table) ?? [] }
                catch { failure=friendlyError(error) }
            default: break
            }
        }
        initialized=true
    }
    private func save() {
        errors=[:]; failure=nil
        var payload:[String:JSONValue]=[:]
        for field in form.fields {
            let text=(values[field.id] ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
            if text.isEmpty { if field.required { errors[field.id]="Uzupełnij to pole." }; payload[field.id] = .null; continue }
            switch field.kind {
            case .date:
                if let date=DateInput.parse(text) { payload[field.id] = .string(ISO8601DateFormatter().string(from:date)) }
                else { errors[field.id]="Wpisz datę w formacie DD.MM.RRRR GG:mm." }
            case .day:
                if let date=parseDay(text) { let f=dayFormat(); f.dateFormat="yyyy-MM-dd"; payload[field.id] = .string(f.string(from:date)) }
                else { errors[field.id]="Wpisz rzeczywistą datę w formacie DD.MM.RRRR." }
            case .time:
                let parts=text.split(separator:":")
                if parts.count==2,let h=Int(parts[0]),let m=Int(parts[1]),(0...23).contains(h),(0...59).contains(m) {
                    let date=String((store.page?.event["event_date"] ?? "").prefix(10))
                    payload[field.id] = .string("\(date)T\(String(format:"%02d:%02d",h,m)):00")
                } else { errors[field.id]="Wpisz godzinę w formacie GG:mm." }
            case .decimal:
                let normalized=text.replacingOccurrences(of:",",with:".")
                if let amount=Decimal(string:normalized,locale:Locale(identifier:"en_US_POSIX")),amount>=0,
                   normalized.range(of:"^[0-9]+(?:\\.[0-9]{1,2})?$",options:.regularExpression) != nil {
                    payload[field.id] = .string(NSDecimalNumber(decimal:amount).stringValue)
                } else { errors[field.id]="Wpisz kwotę nieujemną, z najwyżej dwoma miejscami po przecinku." }
            case .integer:
                if let n=Int(text),n>=0 { payload[field.id] = .number(Double(n)) } else { errors[field.id]="Wpisz nieujemną liczbę całkowitą." }
            case .toggle: payload[field.id] = .bool(text=="true")
            default: payload[field.id] = .string(text)
            }
        }
        for (start,end) in [("event_date","event_end_date"),("start_time","end_time")] {
            if let first=DateInput.parse(values[start] ?? ""),let last=DateInput.parse(values[end] ?? ""),last<first { errors[end]="Koniec nie może poprzedzać początku." }
        }
        if let first=form.fields.first(where:{errors[$0.id] != nil}) { focused=first.id; return }
        Task {
            if await store.save(form,payload:payload,workspace:workspace) { dismiss() }
            else { failure=store.error ?? "Nie udało się zapisać danych. Odśwież kartę przed ponowną próbą." }
        }
    }
    private func dayFormat() -> DateFormatter {
        let f=DateFormatter(); f.locale=Locale(identifier:"pl_PL");f.timeZone=TimeZone(identifier:"Europe/Warsaw");f.dateFormat="dd.MM.yyyy";f.isLenient=false;return f
    }
    private func parseDay(_ text:String) -> Date? { let f=dayFormat();guard let d=f.date(from:text),f.string(from:d)==text else {return nil};return d }
}
