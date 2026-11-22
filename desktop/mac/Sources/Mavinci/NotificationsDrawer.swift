import SwiftUI
import AppKit

@MainActor struct NotificationsDrawer:View {
    @EnvironmentObject var state:Workspace
    /// Nawigacja okna, w którym jest widok (inne okna mają własną).
    @EnvironmentObject private var nav: WindowNavigation
    @State private var unreadOnly=false
    @State private var message:String?
    @State private var opening=false
    private var rows:[Row]{state.rows(.notifications).filter{!unreadOnly || $0.fields["is_read"]?.flag != true}.sorted{$0["created_at"]>$1["created_at"]}}
    var body:some View{
        VStack(spacing:0){
            HStack{Text("Powiadomienia").font(.title2.bold());Text("\(state.unread)").foregroundStyle(.secondary);Spacer();Button{nav.notificationsVisible=false}label:{Image(systemName:"xmark")}.buttonStyle(.plain).accessibilityLabel("Zamknij powiadomienia").keyboardShortcut(.cancelAction)}.padding(18)
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
                                Button(action.object["event_name"]?.text ?? "Otwórz event") {state.showEvent(eventID)}.font(.caption)
                            }
                        }
                    }
                    Text(Labels.date(row["created_at"])).font(.caption).foregroundStyle(.tertiary)
                    HStack{
                        Button("Otwórz sprawę",systemImage:"arrow.up.forward.app"){
                            opening=true;message=nil
                            Task{
                                let opened=await state.routeNotification(row)
                                if opened{nav.notificationsVisible=false;if row.fields["is_read"]?.flag != true && state.canWrite{_ = await state.perform("notification_read",row:row)}}
                                else{message=state.error ?? state.notice ?? "Nie udało się otworzyć powiązanej sprawy."}
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
            guard employee?.canView(.events)==true else{notice="Nie masz dostępu do eventów.";return false}
            selection = .events
            return true
        }
        // Rozmowa ze sprzedawcą (`send_seller_message`: metadata `workflow: seller_chat`, `sales_partner_id`, `conversation_id`;
        // adres karty kontaktu lub sprzedawcy z `conversation`) — arkusz rozmów na ekranie Sprzedawców, nie strona CRM.
        let chatLink=SellerChatRequest(href:raw)
        if metadata["workflow"]?.text == "seller_chat" || chatLink != nil {
            var request=chatLink ?? SellerChatRequest(sellerID:nil,contactID:nil,name:nil,conversationID:nil)
            if let seller=metadata["sales_partner_id"]?.text,UUID(uuidString:seller) != nil{request.sellerID=seller}
            if let conversation=metadata["conversation_id"]?.text,UUID(uuidString:conversation) != nil{request.conversationID=conversation}
            if request.sellerID != nil || request.contactID != nil {
                showSellerChat(request,href:raw.isEmpty ? "/crm/salespeople" : raw)
                return true
            }
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
                    // Ustalenia sprzedawcy: wskazana oferta (`offer`), rozmowa (`conversation`) i krok przygotowań (`prepStep`).
                    if section=="events",!candidate.isEmpty,q["tab"]=="seller-arrangements"{
                        let offer=q["offer"].flatMap{UUID(uuidString:$0) != nil ? $0:nil}
                        let conversation=q["conversation"].flatMap{UUID(uuidString:$0) != nil ? $0:nil}
                        if offer != nil || conversation != nil{sellerFocus=SellerArrangementsFocus(eventID:candidate,offerID:offer,conversationID:conversation,step:q["prepStep"])}
                    }
                }
                // Czas pracy: /crm/time-tracking/<pracownik>?discussion=<wpis> — rozmowa o wpisie na stronie pracownika.
                if section=="time-tracking"{
                    let employeeID=UUID(uuidString:next) != nil ? next:nil
                    let entry=q["discussion"].flatMap{UUID(uuidString:$0) != nil ? $0:nil}
                    showTimeTracking(employee:employeeID,discussion:entry)
                    return true
                }
                // Finanse: /crm/invoices/<id> — karta faktury w Finansach; zakładki (Centrum, KSeF, faktury, koszty) i sekcje
                // „Dokumenty i rozliczenia” (wyciągi, uzgodnienie, terminy, deklaracje, księgowa, zamknięcie miesięcy) — na Macu.
                if section=="invoices"{
                    if UUID(uuidString:next) != nil{showInvoice(next);return true}
                    if let part=Self.financePart(tab:q["tab"] ?? "",section:q["section"] ?? ""){showFinance(part)}else{openCRM(raw)}
                    return true
                }
                // Wiadomości: /crm/messages/<id>?type=received|sent|contact_form — treść w Wiadomościach; bez id — skrzynka.
                if section=="messages"{
                    if UUID(uuidString:next) != nil{return await showMessage(next,type:q["type"] ?? "received")}
                    return showScreen(.messages,fallback:raw)
                }
                // Flota: /crm/fleet/<pojazd> — karta pojazdu; przypomnienie o przeglądzie — „Serwis i naprawy”, o polisie — „Ubezpieczenia”.
                if section=="fleet"{
                    guard UUID(uuidString:next) != nil else{return showScreen(.fleet,fallback:raw)}
                    let compliance=metadata["compliance_type"]?.text ?? ""
                    var vehicleTab: FleetVehicleTab? = nil
                    if compliance.hasPrefix("insurance"){vehicleTab = .insurance}else if compliance.contains("inspection"){vehicleTab = .maintenance}
                    showVehicle(next,tab:vehicleTab)
                    return true
                }
                // Pracownicy: /crm/employees/<id>?tab=… — karta pracownika (nieobecności i nadgodziny — oś czasu).
                if section=="employees",UUID(uuidString:next) != nil{
                    showEmployee(next,tab:EmployeeTab(rawValue:q["tab"] ?? ""))
                    return true
                }
                // Broszury: /crm/brochures/<id>#seller-demo-report — broszura (raport pokazu) w Broszurach.
                if section=="brochures"{
                    if UUID(uuidString:next) != nil{showBrochure(next);return true}
                    return showScreen(.brochures,fallback:raw)
                }
                // Stan systemu: /crm/settings/system-health — integracje, jakość danych i bezpieczeństwo (administrator).
                if section=="settings",next=="system-health"{return showSystemHealth()}
                // Social media: /crm/marketing/social?post=<id>[&tab=comments] — post w kreatorze (bez id — kalendarz albo komentarze);
                // ?tab=stats&report=<id> — raport tygodniowy w zakładce Statystyki.
                if section=="marketing",next=="social"{
                    if q["tab"]=="stats",q["post"]==nil{
                        showSocialStats(report: q["report"].flatMap{UUID(uuidString:$0) != nil ? $0:nil})
                        return true
                    }
                    showSocialPost(q["post"].flatMap{UUID(uuidString:$0) != nil ? $0:nil}, comments: q["tab"]=="comments")
                    return true
                }
                // Kampanie e-mail: /crm/campaigns?campaign=<id> — kampania w Centrum Kampanii (bez id — lista kampanii).
                if section=="campaigns"{
                    showCampaign(q["campaign"].flatMap{UUID(uuidString:$0) != nil ? $0:nil})
                    return true
                }
                // Spotkania: /crm/calendar/meeting/<id> i /crm/calendar?meeting=<id>.
                if section=="calendar"{
                    let candidate=next=="meeting" && parts.count>crm+3 ? parts[crm+3]:(q["meeting"] ?? q["meetingId"] ?? "")
                    if UUID(uuidString:candidate) != nil{type="meeting";id=candidate}
                }
            }
        }
        if ["task","tasks"].contains(type),let inquiry=metadata["inquiry_id"]?.text,UUID(uuidString:inquiry) != nil,id==inquiry{type="inquiry";id=inquiry}
        if UUID(uuidString:id)==nil || !["event","events","task","tasks","inquiry","inquiries","contact","contacts","client","offer","offers","tender","tenders","meeting","meetings","employee","employees"].contains(type){
            for (key,target) in [("meeting_id","meeting"),("inquiry_id","inquiry"),("event_id","event"),("offer_id","offer"),("tender_id","tender"),("task_id","task")] {
                if let candidate=metadata[key]?.text,UUID(uuidString:candidate) != nil{type=target;id=candidate;break}
            }
        }
        guard UUID(uuidString:id) != nil else{
            // Pozostałe adresy CRM: sekcja z paska bocznego, jeśli ma ekran na Macu, inaczej strona CRM.
            if !raw.isEmpty{return openCRMLink(raw)}
            notice="Powiadomienie nie zawiera obsługiwanego powiązania.";return false
        }
        switch type {
        case "event","events":
            guard employee?.canView(.events)==true else{notice="Nie masz dostępu do eventów.";return false}
            showEvent(id,cardTab:tab);return true
        case "task","tasks":return await navigate(.tasks,id:id)
        case "inquiry","inquiries":return await navigate(.inquiries,id:id)
        case "contact","contacts","client":return await navigate(.contacts,id:id)
        case "offer","offers":return await navigate(.offers,id:id)
        case "tender","tenders":return await navigate(.tenders,id:id)
        case "meeting","meetings":showMeeting(id);return true
        case "employee","employees":showEmployee(id);return true
        default:
            if !raw.isEmpty{return openCRMLink(raw)}
            notice="Powiadomienie nie zawiera obsługiwanego powiązania.";return false
        }
    }
    /// Część Finansów dla adresu `/crm/invoices?tab=…&section=…` (jak zakładki strony CRM); `nil` — tylko w CRM.
    static func financePart(tab:String,section:String) -> FinancePart? {
        switch tab {
        case "","center","dashboard":return .center
        case "ksef":return .ksef
        case "local":return .invoices
        case "expenses":return .entries
        case "external":
            switch section {
            case "","deadlines":return section.isEmpty ? .center : .deadlines
            case "statements":return .statements
            case "reconciliation":return .reconciliation
            case "declarations":return .declarations
            case "accountant":return .accountant
            case "periods":return .periods
            default:return nil
            }
        default:return nil
        }
    }
    /// Ekran z paska bocznego (np. Wiadomości, Flota); bez dostępu do niego — strona CRM.
    @discardableResult func showScreen(_ screen:CrmScreen,fallback:String) -> Bool {
        if let item=navigation.flatMap(\.flattened).first(where:{$0.screen == screen}){openHref(item.href)}else{openCRM(fallback)}
        return true
    }
    /// Wiadomość e-mail z powiadomienia — Wiadomości na Macu z otwartą treścią (także spoza bieżącej skrzynki i kopii na dysku).
    func showMessage(_ id:String,type:String) async -> Bool {
        let kind=["received","sent","contact_form"].contains(type) ? type:"received"
        guard let item=navigation.flatMap(\.flattened).first(where:{$0.screen == .messages}) else{openCRM("/crm/messages/\(id)?type=\(kind)");return true}
        openHref(item.href)
        let key="\(kind):\(id)"
        if messages.item(key) == nil{
            messages.open(account:"",folder:.all)
            if messages.item(key) == nil,await messages.loadDetail(id:id,type:kind) == nil{
                error="Nie udało się otworzyć wiadomości — mogła zostać usunięta albo nie masz dostępu do tej skrzynki."
                return false
            }
        }
        messages.select(key)
        return true
    }
    /// Stan systemu i jakość danych (`/crm/settings/system-health`) — arkusz w oknie, tylko administrator.
    @discardableResult func showSystemHealth() -> Bool {
        guard employee?.isAdmin == true else{notice="Stan systemu i jakość danych są dostępne wyłącznie dla administratora.";return false}
        activeNavigation.systemHealthShown=true
        return true
    }
    /// Adres CRM bez natywnego rekordu: dokładnie ta sekcja z paska bocznego, jeśli ma ekran na Macu, inaczej strona CRM.
    @discardableResult func openCRMLink(_ raw:String) -> Bool {
        let path=URLComponents(string:raw)?.path ?? raw
        if !raw.hasPrefix("http"),let item=navigation.flatMap(\.flattened).first(where:{($0.module != nil || $0.screen != nil) && $0.path == path}){
            openHref(item.href);return true
        }
        openCRM(raw)
        return true
    }
    /// Odnośnik z treści (np. szczegóły „Stanu systemu”) — rekord albo sekcja na Macu jak powiadomienie, inaczej CRM.
    func openLink(_ href:String) async {
        if href.hasPrefix("http"),!href.contains("/crm/"){
            if let url=URL(string:href){NSWorkspace.shared.open(url)}
            return
        }
        let path=href.hasPrefix("http") ? (URLComponents(string:href).map{$0.path+($0.query.map{"?"+$0} ?? "")} ?? href):href
        await routeNotification(Row(["action_url":.string(path)]))
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
