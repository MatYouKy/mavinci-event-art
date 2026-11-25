import SwiftUI
import AppKit

@MainActor struct TendersView:View {
    @EnvironmentObject var state:Workspace
    /// Nawigacja okna, w którym jest widok (inne okna mają własną).
    @EnvironmentObject private var nav: WindowNavigation
    @State private var search=""
    @State private var includeHidden=false
    @State private var scope="active"
    @State private var status=""
    @State private var minimumScore=0
    @State private var selectedID:String?
    @State private var modalID:String?
    /// Strona „Konfiguracja filtrów” (jak `/crm/tenders/config`) zamiast listy.
    @State private var showingConfig=false
    @State private var memo=TendersListMemo()
    /// Lista po filtrach — liczona raz na zmianę przetargów, filtrów albo minuty, nie przy każdej publikacji `Workspace`
    /// (w trakcie synchronizacji kilkanaście razy), bo przetargów jest kilka tysięcy.
    private func rows(now:Date)->[Row] {
        let buckets=state.snapshot?.collections[Module.tenders.rawValue]?.buckets ?? [:]
        let key="\(search)|\(scope)|\(status)|\(includeHidden)|\(minimumScore)|\(state.employee?.id ?? "")|\(Int(now.timeIntervalSince1970/60))"
        if let known=memo.rows(buckets:buckets,key:key){return known}
        let fresh=filtered(now:now)
        memo.store(fresh,buckets:buckets,key:key)
        return fresh
    }
    private func filtered(now:Date)->[Row] {
        state.rows(.tenders).filter{row in
            if !includeHidden && WorkspacePresentation.isArchived(row,module:.tenders,now:now){return false}
            if !status.isEmpty && row["status"] != status{return false}
            if (row.fields["relevance_score"]?.number ?? 0)<Double(minimumScore){return false}
            if scope=="mine" && row["assigned_to"] != state.employee?.id{return false}
            if scope=="watched" && row.fields["is_watched"]?.flag != true{return false}
            if scope=="matched" && row.fields["is_matched"]?.flag != true && row["manual_relevance"] != "relevant"{return false}
            return search.isEmpty || [row.title,row["contracting_authority"],row["location"],row["description"]].joined(separator:" ").localizedStandardContains(search)
        }.sorted{
            if $0["submission_deadline"] != $1["submission_deadline"] {return !$0["submission_deadline"].isEmpty && ($1["submission_deadline"].isEmpty || $0["submission_deadline"]<$1["submission_deadline"])}
            return ($0.fields["relevance_score"]?.number ?? 0)>($1.fields["relevance_score"]?.number ?? 0)
        }
    }
    var body:some View {
        Group{
            if showingConfig{
                TenderFilterConfigView{showingConfig=false}.navigationTitle("Konfiguracja filtrów")
            }else{
                list.navigationTitle("Przetargi").searchable(text:$search,prompt:"Tytuł, zamawiający lub miejscowość")
            }
        }
        // Przetarg wskazany z powiadomienia albo wyszukiwania — powrót z konfiguracji do listy (lista pokaże go po pojawieniu się).
        .onChange(of:nav.focusToken){_,_ in if showingConfig && nav.focusedID != nil{showingConfig=false}}
        .sheet(isPresented:Binding(get:{modalID != nil},set:{if !$0{modalID=nil}})){
            if let id=modalID{
                VStack(spacing:0){HStack{Text("Szczegóły przetargu").font(.headline);Spacer();Button("Zamknij"){modalID=nil}.keyboardShortcut(.cancelAction)}.padding();TenderDetails(tenderID:id,onOpenInquiry:{id in modalID=nil;state.open(.inquiries,id:id)})}.frame(width:780,height:760)
            }
        }
    }
    private var list:some View{
        TimelineView(.periodic(from:.now,by:60)){context in
            let visible=rows(now:context.date)
            GeometryReader { outer in
                let wide=outer.size.width>=1180
                VStack(spacing:0){
                    if let error=state.moduleErrors["tenders"]{Text(error).foregroundStyle(.orange).padding(10)}
                    HStack(spacing:12){
                        Picker("Zakres",selection:$scope){Text("Aktywne").tag("active");Text("Moje").tag("mine");Text("Obserwowane").tag("watched");Text("Dopasowane").tag("matched")}.frame(maxWidth:200)
                        Picker("Status",selection:$status){Text("Wszystkie statusy").tag("");ForEach(TenderDetails.statuses,id:\.self){Text(Labels.text($0)).tag($0)}}.frame(maxWidth:195)
                        Toggle("Także przeszłe i ukryte",isOn:$includeHidden).toggleStyle(.checkbox)
                        Spacer();Text("\(visible.count) pozycji").foregroundStyle(.secondary)
                        Button("Konfiguracja",systemImage:"slider.horizontal.3"){showingConfig=true}
                            .help("Konfiguracja filtrów — słowa kluczowe, kody CPV, lokalizacje i progi oceny (jak w CRM)")
                    }.padding(.horizontal,14).frame(height:46).crmBar()
                    GeometryReader{available in
                        let side=wide && selectedID != nil
                        HStack(alignment:.top,spacing:0){
                            table(visible,now:context.date).frame(width:max(1,available.size.width-(side ? 421:0)),height:available.size.height)
                            if side,let id=selectedID{
                                Divider();TenderDetails(tenderID:id).id(id).frame(width:420,height:available.size.height)
                            }
                        }.frame(width:available.size.width,height:available.size.height,alignment:.topLeading)
                    }
                }.frame(width:outer.size.width,height:outer.size.height,alignment:.topLeading)
                .onChange(of:selectedID){_,id in if !wide{modalID=id}}
                .onAppear{reveal(wide:wide)}.onChange(of:nav.focusToken){_,_ in reveal(wide:wide)}
                .onChange(of:wide){_,isWide in if isWide{modalID=nil}else{modalID=selectedID}}
            }
        }
    }
    private func table(_ rows:[Row],now:Date)->some View{
            Table(rows,selection:$selectedID){
                TableColumn("Przetarg / zamawiający"){row in
                    VStack(alignment:.leading,spacing:4){
                        HStack(alignment:.top){if row.fields["is_watched"]?.flag==true{Image(systemName:"star.fill").foregroundStyle(.yellow)};Text(row.title).font(.callout.weight(.medium)).lineLimit(2)}
                        Text(row["contracting_authority"]).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }.padding(.vertical,6)
                }.width(min:250,ideal:430)
                TableColumn("Dopasowanie"){row in TenderScore(row:row)}.width(min:100,ideal:115,max:140)
                TableColumn("Termin / pozostało"){row in
                    VStack(alignment:.leading,spacing:3){Text(Labels.date(row["submission_deadline"])).font(.caption);Text(WorkspacePresentation.remaining(row["submission_deadline"],now:now)).font(.caption.weight(.semibold)).foregroundStyle(urgency(row,now:now))}.monospacedDigit()
                }.width(min:145,ideal:165,max:190)
                TableColumn("Miejsce / stan"){row in VStack(alignment:.leading,spacing:4){Text(row["location"]).font(.caption).lineLimit(1);Text(Labels.text(row["status"])).font(.caption).foregroundStyle(.secondary)}}.width(min:110,ideal:150,max:190)
            }.contextMenu(forSelectionType:String.self){ids in if let id=ids.first{Button("Szczegóły"){selectedID=id;modalID=id}}}primaryAction:{ids in selectedID=ids.first}
             .overlay{if rows.isEmpty{ContentUnavailableView("Brak przetargów",systemImage:"briefcase",description:Text("Zmień filtry lub uwzględnij przeszłe i ukryte przetargi."))}}
    }
    private func urgency(_ row:Row,now:Date)->Color{
        guard let deadline=CalendarDates.date(row["submission_deadline"])else{return .secondary}
        return deadline<=now ? .secondary:deadline.timeIntervalSince(now)<=172800 ? .orange:.primary
    }
    private func reveal(wide:Bool){guard let id=nav.focusedID,state.storedRow(.tenders,id:id) != nil else{return};search="";status="";scope="active";includeHidden=true;selectedID=id;if !wide{modalID=id}}
}

/// Wynik filtrowania listy przetargów: przeliczany, gdy zmienią się dane przetargów (porównanie zbiorów — przy tych samych
/// danych natychmiastowe, bo tablice współdzielą pamięć) albo klucz filtrów i minuty.
final class TendersListMemo {
    private var buckets:[String:[Row]]?
    private var key=""
    private var cached:[Row]=[]
    /// Zapamiętana lista, gdy dane i klucz się nie zmieniły; inaczej `nil`.
    func rows(buckets current:[String:[Row]],key next:String)->[Row]? {
        guard next==key,let buckets,buckets==current else{return nil}
        return cached
    }
    func store(_ rows:[Row],buckets current:[String:[Row]],key next:String) {buckets=current;key=next;cached=rows}
}

@MainActor extension Workspace {
    /// Rekord sekcji po identyfikatorze bez składania całej listy — ta sama kolejność co `rows(module)` (zbiory, potem powiązane).
    func storedRow(_ module:Module,id:String)->Row? {
        guard module != .events else{return rows(module).first{$0.id==id}}
        guard let buckets=snapshot?.collections[module.rawValue]?.buckets else{return nil}
        for key in buckets.keys.filter({$0 != "linked"}).sorted() {
            if let row=buckets[key]?.first(where:{$0.id==id}) {return row}
        }
        return buckets["linked"]?.first{$0.id==id}
    }
}
struct TenderScore:View{
    let row:Row
    var body:some View{
        if let value=row.fields["relevance_score"],value != .null{
            let score=max(0,min(100,value.number))
            VStack(alignment:.leading,spacing:4){Text("\(Int(score))/100").font(.callout.monospacedDigit().weight(.semibold));ProgressView(value:score,total:100).tint(score>=70 ? .green:score>=40 ? .yellow:.secondary)}
        }else{Text("Brak oceny").font(.caption).foregroundStyle(.secondary)}
    }
}

@MainActor struct TenderDetails:View{
    static let statuses=["new","reviewing","interested","preparing","submitted","won","lost","ignored"]
    let tenderID:String
    var onOpenInquiry:((String)->Void)?=nil
    @EnvironmentObject var state:Workspace
    @State private var loaded:Row?
    @State private var notes=""
    @State private var status="new"
    @State private var ready=false
    @State private var error:String?
    @State private var assignee=""
    private var row:Row?{state.storedRow(.tenders,id:tenderID) ?? loaded}
    var body:some View{
        ScrollView{
            if let row{
                VStack(alignment:.leading,spacing:18){
                    Text(row.title).font(.title2.bold()).textSelection(.enabled)
                    TenderScore(row:row)
                    LabeledContent("Stan",value:Labels.text(row["status"]))
                    value("Zamawiający",row["contracting_authority"]);value("Lokalizacja",row["location"])
                    value("Data publikacji",Labels.date(row["publication_date"]));value("Termin składania ofert",Labels.date(row["submission_deadline"]))
                    TimelineView(.periodic(from:.now,by:60)){context in Text(WorkspacePresentation.remaining(row["submission_deadline"],now:context.date)).font(.headline).monospacedDigit()}
                    if let amount=row.fields["estimated_value"],amount.number>0{value("Szacowana wartość",amount.number.formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier:"pl_PL")))+" "+row["currency"])}
                    let cpv=row.fields["cpv_codes"]?.array.map(\.text).joined(separator:", ") ?? ""
                    value("Kody CPV",cpv);value("Opis",row["description"])
                    Divider()
                    value("Opiekun",row["assigned_to"].isEmpty ? "Nieprzypisany":row["assigned_to"]==state.employee?.id ? "Ty":assignee.isEmpty ? "Przypisany pracownik":assignee)
                    HStack{
                        Button(row.fields["is_watched"]?.flag==true ? "Przestań obserwować":"Obserwuj",systemImage:row.fields["is_watched"]?.flag==true ? "star.fill":"star"){
                            Task{_ = await state.update(.tenders,row:row,values:["is_watched":.bool(row.fields["is_watched"]?.flag != true)])}
                        }
                        Button(row["assigned_to"]==state.employee?.id ? "Zwolnij":"Przypisz do mnie"){
                            Task{_ = await state.tenderAction(row["assigned_to"]==state.employee?.id ? "release":"assign",row:row)}
                        }
                    }.disabled(!state.canWrite)
                    if !row["inquiry_id"].isEmpty{
                        Button("Otwórz zapytanie",systemImage:"arrow.up.forward.app"){openInquiry(row["inquiry_id"])}.disabled(state.employee?.canView(.inquiries) != true)
                        Text("Etap prowadzonego zapytania jest źródłem statusu tego przetargu.").font(.caption).foregroundStyle(.secondary)
                    }else{
                        Button("Dodaj do lejka zapytań",systemImage:"plus.bubble"){
                            Task{if let id=await state.tenderAction("inquiry",row:row){openInquiry(id)}}
                        }.buttonStyle(.borderedProminent).disabled(!state.canWrite || state.employee?.canView(.inquiries) != true || deadlinePassed(row))
                    }
                    if let url=URL(string:row["source_url"]),["https","http"].contains(url.scheme ?? "") {Link("Otwórz ogłoszenie źródłowe",destination:url)}
                    Picker("Status",selection:$status){ForEach(Self.statuses,id:\.self){Text(Labels.text($0)).tag($0)}}.disabled(!state.canWrite || !row["inquiry_id"].isEmpty)
                    TextField("Notatki",text:$notes,axis:.vertical).lineLimit(4...12).textFieldStyle(.roundedBorder).disabled(!state.canWrite)
                    Button("Zapisz status i notatki",systemImage:"checkmark"){
                        Task{
                            var body:[String:JSONValue]=["notes":notes.isEmpty ? .null:.string(notes)]
                            if row["inquiry_id"].isEmpty{body["status"] = .string(status)}
                            if await state.update(.tenders,row:row,values:body){error=nil}else{error=state.error}
                        }
                    }.disabled(!ready || !state.canWrite)
                    HStack{
                        Button("Trafny",systemImage:row["manual_relevance"]=="relevant" ? "hand.thumbsup.fill":"hand.thumbsup"){
                            Task{_ = await state.update(.tenders,row:row,values:["manual_relevance":row["manual_relevance"]=="relevant" ? .null:.string("relevant")])}
                        }
                        Button("Nietrafny",systemImage:row["manual_relevance"]=="irrelevant" ? "hand.thumbsdown.fill":"hand.thumbsdown"){
                            Task{_ = await state.update(.tenders,row:row,values:["manual_relevance":row["manual_relevance"]=="irrelevant" ? .null:.string("irrelevant")])}
                        }
                    }.disabled(!state.canWrite)
                    Button(row.fields["is_hidden"]?.flag==true ? "Przywróć na listę":"Ukryj przetarg",systemImage:row.fields["is_hidden"]?.flag==true ? "eye":"eye.slash"){
                        Task{_ = await state.update(.tenders,row:row,values:["is_hidden":.bool(row.fields["is_hidden"]?.flag != true)])}
                    }.disabled(!state.canWrite)
                    if let error{Text(error).font(.callout).foregroundStyle(.red)}
                }.padding(22).frame(maxWidth:.infinity,alignment:.leading)
                .onChange(of:row["status"]){old,new in if status==old{status=new}}
                .onChange(of:row["notes"]){old,new in if notes==old{notes=new}}
            }else if let error{Text(error).foregroundStyle(.red).padding()}else{ProgressView().padding(40)}
        }.task(id:tenderID){
            let actor=state.employee
            do{
                if let fetched=try await state.eventAPI()?.record(.tenders,id:tenderID),actor==state.employee{loaded=fetched;state.acceptRecord(fetched,module:.tenders)}
                guard actor==state.employee,let row else{throw AppError.forbidden}
                notes=row["notes"];status=row["status"];ready=true
                if UUID(uuidString:row["assigned_to"]) != nil,let api=state.eventAPI(){
                    let people=try await api.read("employees","id,name,surname",["id":"eq.\(row["assigned_to"])"])
                    if actor==state.employee,let person=people.first{assignee=[person["name"],person["surname"]].joined(separator:" ")}
                }
            }catch{self.error=friendlyError(error)}
        }
    }
    private func value(_ label:String,_ text:String)->some View{VStack(alignment:.leading,spacing:5){Text(label).font(.caption).foregroundStyle(.secondary);Text(text.isEmpty ? "—":text).textSelection(.enabled)}}
    private func deadlinePassed(_ row:Row)->Bool{CalendarDates.date(row["submission_deadline"]).map{$0<=Date()} ?? false}
    private func openInquiry(_ id:String){if let onOpenInquiry{onOpenInquiry(id)}else{state.open(.inquiries,id:id)}}
}
