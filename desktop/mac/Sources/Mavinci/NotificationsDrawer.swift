import SwiftUI

@MainActor struct NotificationsDrawer:View {
    @EnvironmentObject var state:Workspace
    @State private var unreadOnly=false
    @State private var message:String?
    @State private var opening=false
    private var rows:[Row]{state.rows(.notifications).filter{!unreadOnly || $0.fields["is_read"]?.flag != true}.sorted{$0["created_at"]>$1["created_at"]}}
    var body:some View{
        VStack(spacing:0){
            HStack{Text("Powiadomienia").font(.title2.bold());Text("\(state.unread)").foregroundStyle(.secondary);Spacer();Button{state.notificationsVisible=false}label:{Image(systemName:"xmark")}.buttonStyle(.plain).accessibilityLabel("Zamknij powiadomienia").keyboardShortcut(.cancelAction)}.padding(18)
            HStack{Toggle("Tylko nieprzeczytane",isOn:$unreadOnly).toggleStyle(.checkbox);Spacer();Button("Przeczytaj wszystkie"){Task{await state.markAllNotificationsRead()}}.disabled(!state.canWrite || state.unread==0)}.font(.caption).padding(.horizontal,18).padding(.bottom,12)
            Divider()
            if let problem=state.moduleErrors["notifications"]{Text(problem).font(.callout).foregroundStyle(.orange).padding(12)}
            if let message{Text(message).font(.callout).foregroundStyle(.orange).frame(maxWidth:.infinity,alignment:.leading).padding(12)}
            List(rows){row in
                VStack(alignment:.leading,spacing:9){
                    HStack(alignment:.top,spacing:8){if row.fields["is_read"]?.flag != true{Circle().fill(.blue).frame(width:7,height:7).padding(.top,5)};Text(row.title).font(.callout.weight(.semibold)).textSelection(.enabled)}
                    if !row["message"].isEmpty{Text(row["message"]).font(.callout).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled)}
                    if row.fields["metadata"]?.object["kind"]?.text == "event_workflow_digest" {
                        ForEach(Array((row.fields["metadata"]?.object["actions"]?.array ?? []).enumerated()), id: \.offset) { _, action in
                            if let eventID=action.object["event_id"]?.text,UUID(uuidString:eventID) != nil {
                                Button(action.object["event_name"]?.text ?? "Otwórz wydarzenie") {state.showEvent(eventID)}.font(.caption)
                            }
                        }
                    }
                    Text(Labels.date(row["created_at"])).font(.caption).foregroundStyle(.tertiary)
                    HStack{
                        Button("Otwórz sprawę",systemImage:"arrow.up.forward.app"){
                            opening=true;message=nil
                            Task{
                                let opened=await state.routeNotification(row)
                                if opened{state.notificationsVisible=false;if row.fields["is_read"]?.flag != true && state.canWrite{_ = await state.perform("notification_read",row:row)}}
                                else{message=state.error ?? state.notice ?? "Ta sprawa nie ma jeszcze dostępnej sekcji natywnej."}
                                opening=false
                            }
                        }.disabled(opening)
                        Spacer()
                        if row.fields["is_read"]?.flag != true{
                            Button{Task{_ = await state.perform("notification_read",row:row)}}label:{Image(systemName:"envelope.open")}.help("Oznacz jako przeczytane").disabled(!state.canWrite)
                        }
                    }.font(.caption)
                }.padding(.vertical,10)
            }.listStyle(.plain).frame(maxWidth:.infinity,maxHeight:.infinity)
                .overlay{if rows.isEmpty{ContentUnavailableView("Brak powiadomień",systemImage:"bell")}}
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.top).background(.regularMaterial)
    }
}

@MainActor extension Workspace {
    @discardableResult func routeNotification(_ row:Row) async -> Bool {
        error=nil;notice=nil
        let metadata=row.fields["metadata"]?.object ?? [:]
        var type=row["related_entity_type"],id=row["related_entity_id"]
        var tab=metadata["tab"]?.text ?? metadata["event_tab"]?.text ?? ""
        let raw=row["action_url"]
        if raw == "/crm/events/actions" || metadata["kind"]?.text == "event_workflow_digest" {
            guard employee?.canView(.events)==true else{notice="Nie masz dostępu do wydarzeń.";return false}
            selection = .events
            return true
        }
        if let url=URLComponents(string:raw),!raw.isEmpty {
            let parts=url.path.split(separator:"/").map(String.init)
            let q=Dictionary((url.queryItems ?? []).map{($0.name,$0.value ?? "")},uniquingKeysWith:{first,_ in first})
            if let crm=parts.firstIndex(of:"crm"),parts.count>crm+1{
                let section=parts[crm+1]
                let next=parts.count>crm+2 ? parts[crm+2]:""
                let aliases:[String:(String,[String])]=["events":("event",["eventId","event","id"]),"inquiries":("inquiry",["inquiryId","inquiry","id"]),"tasks":("task",["taskId","task","id"]),"offers":("offer",["offerId","offer","id"]),"tenders":("tender",["tender","tenderId","id"]),"contacts":("contact",["contact","contactId","id"]),"clients":("contact",["contact","contactId","id"]),"meetings":("meeting",["meetingId","meeting","id"])]
                if let mapping=aliases[section]{
                    let candidate=UUID(uuidString:next) != nil ? next:mapping.1.compactMap{q[$0]}.first{UUID(uuidString:$0) != nil} ?? ""
                    if !candidate.isEmpty{type=mapping.0;id=candidate;tab=q["tab"] ?? tab}
                }
                // Spotkania: /crm/calendar/meeting/<id> i /crm/calendar?meeting=<id>.
                if section=="calendar"{
                    let candidate=next=="meeting" && parts.count>crm+3 ? parts[crm+3]:(q["meeting"] ?? q["meetingId"] ?? "")
                    if UUID(uuidString:candidate) != nil{type="meeting";id=candidate}
                }
            }
        }
        if ["task","tasks"].contains(type),let inquiry=metadata["inquiry_id"]?.text,UUID(uuidString:inquiry) != nil,id==inquiry{type="inquiry";id=inquiry}
        if UUID(uuidString:id)==nil || !["event","events","task","tasks","inquiry","inquiries","contact","contacts","client","offer","offers","tender","tenders","meeting","meetings"].contains(type){
            for (key,target) in [("meeting_id","meeting"),("inquiry_id","inquiry"),("event_id","event"),("offer_id","offer"),("tender_id","tender"),("task_id","task")] {
                if let candidate=metadata[key]?.text,UUID(uuidString:candidate) != nil{type=target;id=candidate;break}
            }
        }
        guard UUID(uuidString:id) != nil else{notice="Powiadomienie nie zawiera obsługiwanego powiązania.";return false}
        switch type {
        case "event","events":
            guard employee?.canView(.events)==true else{notice="Nie masz dostępu do wydarzeń.";return false}
            let aliases:[String:EventTab]=["details":.overview,"warehouse":.equipment,"checklist":.equipment,"fleet":.logistics]
            showEvent(id,tab:EventTab(rawValue:tab) ?? aliases[tab]);return true
        case "task","tasks":return await navigate(.tasks,id:id)
        case "inquiry","inquiries":return await navigate(.inquiries,id:id)
        case "contact","contacts","client":return await navigate(.contacts,id:id)
        case "offer","offers":return await navigate(.offers,id:id)
        case "tender","tenders":return await navigate(.tenders,id:id)
        case "meeting","meetings":showMeeting(id);return true
        default:notice="Powiązana sprawa nie ma jeszcze dostępnej sekcji natywnej.";return false
        }
    }
    func markAllNotificationsRead() async {
        guard canWrite,let api=eventAPI(),let actor=employee else{return}
        acting=true;defer{if employee==actor{acting=false}}
        do{
            guard try await api.profile()==actor else{throw AppError.conflict}
            try await api.markAllNotificationsRead(employee:actor)
            guard employee==actor else{return}
            var collection=snapshot?.collections["notifications"] ?? CollectionState()
            for key in Array(collection.buckets.keys){collection.buckets[key]=collection.buckets[key]?.map{row in var f=row.fields;f["is_read"] = .bool(true);return Row(f)}}
            snapshot?.collections["notifications"]=collection;persistSnapshot()
        }catch{if employee==actor{self.error=friendlyError(error)}}
    }
}
extension HTTPBackend {
    func markAllNotificationsRead(employee:Employee) async throws {
        if native{_ = try await request("/api/native/v1/notifications/read-all",body:[:]);return}
        _ = try await request("/rest/v1/notification_recipients",method:"PATCH",query:[.init(name:"user_id",value:"eq.\(employee.id)"),.init(name:"is_read",value:"eq.false"),.init(name:"select",value:"id")],body:["is_read":.bool(true),"read_at":.string(ISO8601DateFormatter().string(from:Date()))])
    }
}
