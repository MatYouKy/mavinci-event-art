import SwiftUI
import AppKit
import PDFKit
import UniformTypeIdentifiers

struct EventPageView: View {
    let eventID: String
    var initialTab:EventTab? = nil
    @EnvironmentObject var workspace: Workspace
    @StateObject private var store = EventPageStore()
    @State private var form: EventForm?
    var body: some View {
        VStack(alignment:.leading,spacing:0) {
            if let error = store.error { MessageBar(text:error,warning:true) { store.error=nil } }
            if let page = store.page {
                header(page)
                ScrollView(.horizontal,showsIndicators:false) {
                    HStack(spacing:4) {
                        ForEach(page.access.tabs) { tab in
                            Button { store.selectedTab=tab } label: {
                                Label(tab.title,systemImage:tab.symbol).padding(.horizontal,12).padding(.vertical,9)
                                    .background(store.selectedTab == tab ? Color.accentColor.opacity(0.18) : .clear,in:RoundedRectangle(cornerRadius:6))
                            }.buttonStyle(.plain).accessibilityAddTraits(store.selectedTab == tab ? .isSelected : [])
                        }
                    }.padding(10)
                }.crmBar()
                if store.selectedTab == .overview { overview(page) }
                else { EventDataView(store:store,form:$form).id(store.selectedTab) }
            } else if store.loading {
                ProgressView("Pobieranie wydarzenia…").frame(maxWidth:.infinity,maxHeight:.infinity)
            } else {
                ContentUnavailableView("Nie można otworzyć wydarzenia",systemImage:"calendar.badge.exclamationmark",description:Text("Sprawdź połączenie i aktualny dostęp do tej sprawy."))
            }
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
        .navigationTitle(store.page?.event.title ?? "Wydarzenie")
        .toolbar {
            ToolbarItem(placement:.navigation) {
                Button { workspace.eventRoute=nil } label: { Label("Wróć",systemImage:"chevron.left") }.help("Wróć do poprzedniego widoku")
            }
            ToolbarItem(placement:.primaryAction) { if store.loading || store.saving { ProgressView().controlSize(.small) } }
        }
        .task(id:eventID) { if let initialTab{store.selectedTab=initialTab}; await store.load(eventID,workspace:workspace) }
        .onChange(of:store.selectedTab) { _,_ in Task { await store.loadTab(workspace:workspace) } }
        .onChange(of:workspace.refreshEventToken) { _,_ in Task { await store.load(eventID,workspace:workspace) } }
        .onDisappear { store.cancel() }
        .sheet(item:$form,onDismiss: {
            workspace.editing=false
            Task { await workspace.refresh(); await store.load(eventID,workspace:workspace) }
        }) { form in EventFormView(form:form,store:store) }
    }
    private func header(_ page:EventPageCache) -> some View {
        HStack(alignment:.top,spacing:20) {
            VStack(alignment:.leading,spacing:6) {
                Text(page.event.title).font(.title2.bold()).textSelection(.enabled)
                HStack(spacing:14) {
                    Text(Labels.date(page.event["event_date"]))
                    if !page.event["event_end_date"].isEmpty { Text("– \(Labels.date(page.event["event_end_date"]))") }
                    Text(Labels.text(page.event["status"])).foregroundStyle(.secondary)
                }.font(.callout)
            }
            Spacer()
            if page.access.manage {
                Button("Edytuj wydarzenie",systemImage:"square.and.pencil") {
                    form=EventForm(title:"Edytuj wydarzenie",table:"events",fields:EventSchema.overviewFields,record:page.event)
                }.disabled(!workspace.canWrite || store.loading || store.saving)
            }
        }.padding(20)
    }
    private func overview(_ page:EventPageCache) -> some View {
        ScrollView {
            VStack(alignment:.leading,spacing:22) {
                if let assignment=page.access.assignment,assignment["status"] == "pending" {
                    GroupBox("Zaproszenie do wydarzenia") {
                        HStack {
                            Text("Potwierdź swój udział.")
                            Spacer()
                            Button("Odrzuć") { Task { await store.respond(assignment,accept:false,workspace:workspace) } }
                            Button("Akceptuj") { Task { await store.respond(assignment,accept:true,workspace:workspace) } }.buttonStyle(.borderedProminent)
                        }.padding(8).disabled(!workspace.canWrite || store.saving)
                    }
                }
                workflow(page)
                EventRecordFields(row:page.event)
            }.padding(24).frame(maxWidth:1000,alignment:.leading)
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
    }
    private func workflow(_ page:EventPageCache) -> some View {
        VStack(alignment:.leading,spacing:12) {
            if let state=page.access.workflow {
                EventRecordFields(row:Row(state))
                if page.access.manage {
                    Button("Wyznacz kierownika realizacji…",systemImage:"person.badge.key") {
                        form=EventForm(title:"Wyznacz kierownika realizacji",table:"__manager",fields:[.init(id:"employee_id",label:"Pracownik z przyjętym zaproszeniem",kind:.lookup("employees"),required:true)])
                    }
                }
                if state["is_manager"]?.flag == true {
                    let realization=state["realization"]?.object ?? [:]
                    if realization["started_at"] == nil || realization["started_at"] == .null {
                        Button("Przejmij realizację",systemImage:"play") {Task {await store.workflow("start",workspace:workspace)}}
                    } else if realization["completed_at"] == nil || realization["completed_at"] == .null {
                        Button("Zakończ realizację…",systemImage:"checkmark.circle") {
                            form=EventForm(title:"Podsumowanie realizacji",table:"__complete",fields:[.init(id:"notes",label:"Podsumowanie",kind:.multiline,required:true)],record:Row(["notes":.string("Wszystko OK.")]))
                        }
                    }
                }
                if state["warehouseAllowed"]?.flag == true {
                    let handoff=state["handoff"]?.object ?? [:]
                    if handoff["accepted_at"] == nil || handoff["accepted_at"] == .null {
                        Button("Przejmij przygotowanie magazynowe",systemImage:"shippingbox") {Task {await store.workflow("accept_warehouse",workspace:workspace)}}
                    } else if handoff["ready_at"] == nil || handoff["ready_at"] == .null {
                        Button("Potwierdź gotowość do realizacji",systemImage:"checkmark.seal") {Task {await store.workflow("ready_warehouse",workspace:workspace)}}
                    }
                }
            }
        }.disabled(!workspace.canWrite || store.loading || store.saving)
    }

}

struct EventEntry: Identifiable {
    let section: String
    let sectionTitle: String
    let row: Row
    var id:String { section+":"+row.id }
    var title:String { EventSchema.summary(row) }
    var status:String { row.status }
}
struct EventDataView: View {
    @ObservedObject var store: EventPageStore
    @Binding var form: EventForm?
    @EnvironmentObject var workspace: Workspace
    @State private var selected: String?
    @State private var filter = ""
    @State private var section = "all"
    @State private var preview: NativePreview?
    @State private var fileError: String?
    @State private var downloading=false
    @State private var importing=false
    @State private var uploading=false
    @State private var folderID=""
    var entries:[EventEntry] {
        store.sections.filter { section == "all" || $0.id == section }.flatMap { part in
            part.rows.map { EventEntry(section:part.id,sectionTitle:part.title,row:$0) }
        }.filter { filter.isEmpty || $0.title.localizedStandardContains(filter) }
    }
    var entry:EventEntry? { entries.first { $0.id == selected } }
    var body:some View {
        VStack(spacing:0) {
            HStack {
                Picker("Zbiór",selection:$section) {
                    Text("Wszystkie zbiory").tag("all")
                    ForEach(store.sections) { s in Text("\(s.title) (\(s.rows.count))").tag(s.id) }
                }.frame(maxWidth:320)
                TextField("Szukaj w zakładce",text:$filter).textFieldStyle(.roundedBorder).frame(maxWidth:300)
                Spacer()
                if let page=store.page { createButtons(page) }
            }.padding(12).crmBar()
            ForEach(store.sections.filter { $0.error != nil }) { s in
                Text("\(s.title): \(s.error ?? "")").font(.callout).foregroundStyle(.orange).frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,14).padding(.vertical,6)
            }
            if let fileError { Text(fileError).font(.callout).foregroundStyle(.red).padding(10) }
            GeometryReader { available in
              HStack(alignment:.top,spacing:0) {
                Table(entries,selection:$selected) {
                    TableColumn("Nazwa") { e in Text(e.title).lineLimit(2) }.width(min:210,ideal:360)
                    TableColumn("Zbiór") { e in Text(e.sectionTitle).foregroundStyle(.secondary) }.width(min:110,ideal:160)
                    TableColumn("Stan / termin") { e in
                        Text(e.row.status.isEmpty ? Labels.date(e.row.date) : Labels.text(e.row.status)).foregroundStyle(.secondary)
                    }.width(min:120,ideal:170)
                }.contextMenu(forSelectionType:String.self) { ids in
                    if let id=ids.first,let e=entries.first(where:{$0.id==id}),let page=store.page,
                       let edit=EventSchema.editForm(section:e.section,row:e.row,page:page) {
                        Button("Edytuj") { form=edit }.disabled(!workspace.canWrite || store.saving)
                    }
                } primaryAction: { ids in selected=ids.first }
                .overlay { if entries.isEmpty && !store.loading { ContentUnavailableView("Brak pozycji",systemImage:store.selectedTab.symbol,description:Text("Brak danych w wybranym zbiorze lub filtrze.")) } }
                .frame(width:max(1,available.size.width-381),height:available.size.height)
                Divider()
                ScrollView {
                    if let entry,let page=store.page {
                        VStack(alignment:.leading,spacing:18) {
                            Text(entry.title).font(.title3.bold()).textSelection(.enabled)
                            if let edit=EventSchema.editForm(section:entry.section,row:entry.row,page:page) {
                                Button("Edytuj",systemImage:"square.and.pencil") { form=edit }.disabled(!workspace.canWrite || store.saving)
                            }
                            if entry.section == "event_equipment" {
                                let loaded=entry.row.fields["is_loaded"]?.flag == true
                                Button(loaded ? "Cofnij oznaczenie załadunku" : "Oznacz jako załadowane",systemImage:loaded ? "arrow.uturn.backward":"checkmark.square") {
                                    Task { await store.toggleEquipment(entry.row,workspace:workspace) }
                                }.disabled(!workspace.canWrite || store.saving || (loaded && page.event.fields["loading_locked"]?.flag == true))
                            }
                            if let path=documentPath(entry.row) {
                                Button(downloading ? "Pobieranie…":"Otwórz dokument",systemImage:"doc.richtext") { openDocument(path,name:entry.title) }.disabled(workspace.offline || downloading)
                            }
                            if entry.section == "offers" { link(.inquiries,key:"inquiry_id",row:entry.row,label:"Otwórz zapytanie") }
                            EventRecordFields(row:entry.row)
                        }.padding(20).frame(maxWidth:.infinity,alignment:.leading)
                    } else { ContentUnavailableView("Wybierz pozycję",systemImage:"cursorarrow.click").padding(.top,60) }
                }.frame(width:380,height:available.size.height)
              }.frame(width:available.size.width,height:available.size.height)
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
            if let gap=remainingActions {
                Text(gap).font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,alignment:.leading).padding(10).crmBar()
            }
        }.sheet(item:$preview) { NativeDocumentPreview(preview:$0) }
        .fileImporter(isPresented:$importing,allowedContentTypes:[.item]) { result in
            guard case .success(let url)=result else {return}
            upload(url)
        }
    }
    @ViewBuilder private func createButtons(_ page:EventPageCache) -> some View {
        if page.access.manage {
            if store.selectedTab == .files {
                Picker("Folder",selection:$folderID) {
                    Text("Folder główny").tag("")
                    ForEach(page.sections["event_folders"] ?? []) {folder in Text(folder.title).tag(folder.id)}
                }.frame(maxWidth:200)
                Button(uploading ? "Wysyłanie…":"Dodaj plik…",systemImage:"square.and.arrow.up") {importing=true}
                    .disabled(!workspace.canWrite || store.saving || uploading)
            }
            if store.selectedTab == .tasks {
                Button("Nowe zadanie",systemImage:"plus") { form=EventForm(title:"Nowe zadanie wydarzenia",table:"tasks",fields:EventSchema.taskFields) }
                    .disabled(!workspace.canWrite || store.loading || store.saving)
            }
            if store.selectedTab == .team {
                Button("Dodaj osobę",systemImage:"person.badge.plus") { form=EventForm(title:"Zaproś osobę do wydarzenia",table:"employee_assignments",fields:EventSchema.teamFields) }
                    .disabled(!workspace.canWrite || store.loading || store.saving)
            }
            if store.selectedTab == .agenda, page.sections["event_agendas"]?.isEmpty != false {
                Button("Utwórz agendę",systemImage:"plus") {form=EventForm(title:"Utwórz agendę wydarzenia",table:"event_agendas",fields:EventSchema.agendaHeaderFields)}.disabled(!workspace.canWrite || store.loading || store.saving)
            }
            if store.selectedTab == .agenda,let agenda=page.sections["event_agendas"]?.first {
                Menu("Dodaj") {
                    Button("Punkt agendy") { form=EventForm(title:"Dodaj punkt agendy",table:"event_agenda_items",fields:EventSchema.agendaFields,fixed:["agenda_id":.string(agenda.id)]) }
                    Button("Notatkę") { form=EventForm(title:"Dodaj notatkę agendy",table:"event_agenda_notes",fields:EventSchema.noteFields,fixed:["agenda_id":.string(agenda.id)]) }
                }.disabled(!workspace.canWrite || store.loading || store.saving)
            }
        }
        if page.access.canManageCosts,store.selectedTab == .finances {
            Button("Zaplanuj koszt",systemImage:"plus") { form=EventForm(title:"Zaplanuj koszt wydarzenia",table:"event_costs",fields:EventSchema.costFields) }
                .disabled(!workspace.canWrite || store.loading || store.saving)
        }
    }
    private var remainingActions:String? {
        switch store.selectedTab {
        case .offer:return "Dostępne są dane i dokumenty ofert. Pełny edytor wariantów, akceptacje i wysyłka ofert wymagają dalszego wdrożenia natywnego."
        case .contract:return "Dostępne są umowy, ich treść i zapisane dokumenty. Generowanie, redakcja, podpis i rozliczanie umów wymagają dalszego wdrożenia natywnego."
        case .calculations:return "Dostępne są kalkulacje i ich pozycje. Pełny edytor, przeliczanie i zatwierdzanie wymagają dalszego wdrożenia natywnego."
        case .equipment:return "Załadunek korzysta z tej samej funkcji bazy co telefon. Dobór sprzętu, rezerwacje, egzemplarze i obsługa konfliktów wymagają dalszego wdrożenia natywnego."
        case .logistics:return "Dostępne są pojazdy, kierowcy i plan logistyki. Edycja przydziałów, planowanie tras i rozliczenie pojazdów wymagają dalszego wdrożenia natywnego."
        case .subcontractors:return "Dostępne są zlecenia i dokumenty. Zamawianie, potwierdzanie wytycznych i rozliczenie podwykonawcy wymagają dalszego wdrożenia natywnego."
        case .wedding:return "Dostępne są odpowiedzi, osoby, harmonogram, muzyka i atrakcje. Edycja oraz generowanie karty wymagają dalszego wdrożenia natywnego."
        case .live:return "Dostępny jest projekt i uprawnienia. Edycja manifestu, gry, publikacja oraz nadawanie dostępu wymagają dalszego wdrożenia natywnego."
        case .seller:return "Dostępny jest podgląd ofert sprzedawcy. Rozmowy, ustalenia i kreator przygotowania wymagają dalszego wdrożenia natywnego."
        case .phases:return "Możesz edytować istniejące etapy. Tworzenie etapów, pełna oś czasu, przydziały zasobów i rozwiązywanie konfliktów wymagają dalszego wdrożenia natywnego."
        case .finances:return "Podsumowania liczy serwer. Dostępne jest planowanie i edycja oczekujących kosztów; wystawianie faktur, płatności i zatwierdzanie rozliczeń wymagają dalszego wdrożenia natywnego."
        default:return nil
        }
    }
    private func upload(_ url:URL) {
        guard let api=workspace.eventAPI(),let page=store.page,let identity=workspace.employee else {return}
        uploading=true;fileError=nil;workspace.editing=true
        Task {
            defer {uploading=false;workspace.editing=false}
            let access=url.startAccessingSecurityScopedResource()
            defer {if access {url.stopAccessingSecurityScopedResource()}}
            do {
                let size=(try url.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0
                guard size<=25*1024*1024 else {fileError="Wybierz plik o rozmiarze do 25 MB.";return}
                let data=try Data(contentsOf:url)
                let mime=UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                try await api.uploadEventFile(data:data,name:url.lastPathComponent,mime:mime,eventID:page.event.id,folderID:folderID.isEmpty ? nil:folderID,employee:identity)
                guard workspace.employee == identity else {return}
                await store.loadTab(workspace:workspace)
            } catch {fileError=error is URLError ? "Nie potwierdzono przesłania pliku. Odśwież zakładkę przed ponowną próbą.":friendlyError(error)}
        }
    }
    private func link(_ module:Module,key:String,row:Row,label:String) -> some View {
        Button(label) { workspace.open(module,id:row[key]) }.disabled(row[key].isEmpty || workspace.employee?.canView(module) != true)
    }
    private func documentPath(_ row:Row) -> String? {
        for key in ["file_path","generated_pdf_path","pdf_path","pdf_url"] where !row[key].isEmpty {
            let path=row[key]
            if !path.contains("://") { return path }
            if let url=URL(string:path),url.host == URL(string:workspace.connection.url)?.host,
               let range=url.path.range(of:"/event-files/") { return String(url.path[range.upperBound...]).removingPercentEncoding }
        }
        return nil
    }
    private func openDocument(_ path:String,name:String) {
        guard let api=workspace.eventAPI(),let identity=workspace.employee else { return }
        downloading=true; fileError=nil
        Task {
            defer { downloading=false }
            do {
                let data=try await api.fileData(path)
                guard workspace.employee == identity else { return }
                preview=NativePreview(name:name,data:data)
            } catch { fileError=friendlyError(error) }
        }
    }
}

struct EventRecordFields: View {
    let row:Row
    var body:some View {
        VStack(alignment:.leading,spacing:14) {
            ForEach(row.fields.keys.filter { EventSchema.labels[$0] != nil }.sorted(),id:\.self) { key in
                if let value=row.fields[key],value != .null { EventValueView(label:EventSchema.labels[key] ?? "Dane",key:key,value:value) }
            }
        }.frame(maxWidth:.infinity,alignment:.leading)
    }
}
struct EventValueView: View {
    let label:String
    let key:String
    let value:JSONValue
    var body:some View {
        VStack(alignment:.leading,spacing:4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content
        }
    }
    @ViewBuilder private var content:some View {
        switch value {
        case .object(let fields): EventRecordFields(row:Row(fields)).padding(.leading,8)
        case .array(let rows):
            ForEach(Array(rows.enumerated()),id:\.offset) { _,v in
                if case .object(let f)=v { EventRecordFields(row:Row(f)) }
                else { Text(display(v)).textSelection(.enabled) }
            }
        case .string(let text) where key == "content" && text.contains("<"):
            NativeRichText(html:text).frame(minHeight:220)
        default: Text(display(value)).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)
        }
    }
    private func display(_ value:JSONValue) -> String {
        switch value {
        case .bool(let b): return b ? "Tak":"Nie"
        case .number(let n): return EventSchema.moneyFields.contains(key) ? n.formatted(.currency(code:"PLN").locale(Locale(identifier:"pl_PL"))) : n.formatted(.number.locale(Locale(identifier:"pl_PL")))
        case .string(let s):
            if EventSchema.moneyFields.contains(key),let amount=Double(s) {return amount.formatted(.currency(code:"PLN").locale(Locale(identifier:"pl_PL")))}
            if EventSchema.stateFields.contains(key) { return Labels.values[s] ?? (key == "role" ? s : "Inny stan") }
            if key.hasSuffix("_at") || key.hasSuffix("_date") || ["event_date","event_end_date","due_date","start_time","end_time","departure_time","arrival_time","return_departure_time","return_arrival_time","valid_until","assignment_start","assignment_end","assigned_start","assigned_end"].contains(key) { return Labels.date(s) }
            if ["file_path","generated_pdf_path"].contains(key) { return "Dokument dostępny w plikach wydarzenia" }
            return s
        default: return "—"
        }
    }
}
struct NativeRichText:NSViewRepresentable {
    let html:String
    func makeNSView(context:Context) -> NSScrollView {
        let view=NSTextView(); view.isEditable=false; view.isSelectable=true; view.drawsBackground=false
        let scroll=NSScrollView(); scroll.documentView=view; scroll.hasVerticalScroller=true; return scroll
    }
    func updateNSView(_ nsView:NSScrollView,context:Context) {
        guard let text=nsView.documentView as? NSTextView else { return }
        let safe=html.replacingOccurrences(of:"(?is)<(script|style|iframe|object|embed)[^>]*>.*?</\\1\\s*>|<(img|link|meta|base)[^>]*>",with:"",options:.regularExpression)
        guard let data=safe.data(using:.utf8) else {return}
        // Native AppKit document renderer. Never embed the CRM in WebKit.
        if let rich=try? NSAttributedString(data:data,options:[.documentType:NSAttributedString.DocumentType.html],documentAttributes:nil) { text.textStorage?.setAttributedString(rich) }
        else { text.string="Nie można wyświetlić treści dokumentu." }
    }
}
struct NativePreview:Identifiable { let id=UUID(); let name:String; let data:Data }
struct BinaryDocument:FileDocument {
    static var readableContentTypes:[UTType] { [.data] }
    var data:Data
    init(data:Data) { self.data=data }
    init(configuration:ReadConfiguration)throws { data=configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration:WriteConfiguration)throws -> FileWrapper { FileWrapper(regularFileWithContents:data) }
}
struct NativeDocumentPreview:View {
    let preview:NativePreview
    @Environment(\.dismiss) private var dismiss
    @State private var exporting=false
    var pdf:Bool { preview.data.starts(with:Data("%PDF".utf8)) }
    var body:some View {
        VStack {
            HStack { Text(preview.name).font(.headline); Spacer(); Button("Zapisz jako…") { exporting=true }; Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }.padding()
            if pdf { NativePDF(data:preview.data) }
            else if let image=NSImage(data:preview.data) { ScrollView([.horizontal,.vertical]) { Image(nsImage:image).resizable().scaledToFit() } }
            else { ContentUnavailableView("Podgląd tego formatu jest niedostępny",systemImage:"doc",description:Text("Zapisz plik i otwórz go w odpowiedniej aplikacji.")) }
        }.frame(minWidth:700,minHeight:650)
        .fileExporter(isPresented:$exporting,document:BinaryDocument(data:preview.data),contentType:pdf ? .pdf:.data,defaultFilename:preview.name) { _ in }
    }
}
struct NativePDF:NSViewRepresentable {
    let data:Data
    func makeNSView(context:Context) -> PDFView { let view=PDFView(); view.autoScales=true; return view }
    func updateNSView(_ view:PDFView,context:Context) { if view.document?.dataRepresentation() != data { view.document=PDFDocument(data:data) } }
}
