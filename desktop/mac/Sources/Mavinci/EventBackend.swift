import Foundation

extension HTTPBackend {
    func rpc(_ name: String, _ parameters: [String:JSONValue]) async throws -> JSONValue {
        guard !native else { throw AppError.unsupported }
        return try JSONDecoder().decode(JSONValue.self, from: await request("/rest/v1/rpc/\(name)",body:parameters))
    }
    func calendarRows(employee: Employee) async throws -> [Row] {
        var result: [Row] = []
        let events = try await read("events",Self.eventFields+",category:event_categories(name,color)",[:])
        for event in events {
            var r = event.fields; r["kind"] = .string("event"); r["source_id"] = .string(event.id)
            result.append(Row(r))
        }
        let select = "id,title,datetime_start,datetime_end,location_text,recurrence_days,color"
        let owned = try await read("meetings",select,["created_by":"eq.\(employee.id)","deleted_at":"is.null"])
        let invitations = try await read("meeting_participants","id,meeting_id",["employee_id":"eq.\(employee.id)"])
        var meetings = Dictionary(owned.map { ($0.id,$0) },uniquingKeysWith: { first,_ in first })
        let ids = invitations.map { $0["meeting_id"] }.filter { UUID(uuidString:$0) != nil && meetings[$0] == nil }
        for index in stride(from:0,to:ids.count,by:100) {
            let chunk = Array(ids[index..<min(index+100,ids.count)])
            for row in try await read("meetings",select,["id":"in.(\(chunk.joined(separator:",")))","deleted_at":"is.null"]) { meetings[row.id] = row }
        }
        for row in meetings.values {
            var r = row.fields
            r["source_id"] = .string(row.id); r["id"] = .string("meeting:\(row.id)"); r["kind"] = .string("meeting")
            r["name"] = r["title"]; r["event_date"] = r["datetime_start"]; r["event_end_date"] = r["datetime_end"]; r["location"] = r["location_text"]
            result.append(Row(r))
        }
        return result
    }
    func eventPage(_ id: String, employee: Employee) async throws -> EventPageCache {
        guard UUID(uuidString:id) != nil else { throw AppError.invalidResponse }
        if native {
            return try JSONDecoder().decode(EventPageCache.self,from:await request("/api/native/v1/events/\(id)"))
        }
        let actor = try await profile()
        guard actor == employee else { throw AppError.conflict }
        let operational = try await rpc("get_realization_workspace",["p_event_id":.string(id)])
        let isOperational = operational.object["operational_only"]?.flag == true
        if isOperational {
            var info = operational.object
            info["location_info"] = info["location"]; info["location"] = .string(info["location"]?.object["name"]?.text ?? "")
            let access = EventAccess(tabs:[.overview,.agenda,.equipment,.team,.logistics,.files,.tasks],manage:false,finance:[:],operationalOnly:true,workflow:try await eventWorkflowState(id))
            return EventPageCache(event:Row(info),access:access)
        }
        guard try await rpc("current_employee_can_view_event",["p_event_id":.string(id)]).flag else { throw AppError.forbidden }
        let manage = try await rpc("current_employee_can_manage_event",["p_event_id":.string(id)]).flag
        let assignments = try await read("employee_assignments","id,employee_id,status,can_invite_members,can_edit_agenda,can_edit_tasks,can_edit_equipment,can_edit_files",["event_id":"eq.\(id)","employee_id":"eq.\(employee.id)"])
        let finance = try await rpc("get_event_finance_access",["p_event_id":.string(id)]).object
        var select = Self.eventFields + ",planned_setup_at,planned_teardown_at,purchase_order_number,loading_confirmed,loading_locked,loading_notes,equipment_checklist_notes,category_info:event_categories(name,color),organization:organizations!events_organization_id_fkey(id,name,alias),contact:contacts!events_contact_person_id_fkey(id,first_name,last_name,phone,mobile,email),location_info:locations(name,formatted_address,address,city)"
        if (finance["canViewCommercials"]?.flag ?? (finance["canViewCosts"]?.flag == true)) { select += ",notes,expected_revenue,budget,billing_arrangement" }
        let rows = try await read("events",select,["id":"eq.\(id)"])
        guard let event = rows.first else { throw AppError.forbidden }
        let custom = employee.event_tabs?.isEmpty == false ? employee.event_tabs! : employee.access_levels?.object["event_tabs"]?.array.map(\.text) ?? []
        let assigned = assignments.first
        var defaults: [EventTab]
        if employee.isAdmin || employee.has("events_manage") || manage { defaults = EventTab.allCases.filter { $0 != .wedding } }
        else if assigned?["status"] == "accepted" { defaults = [.overview,.team,.agenda,.files,.tasks] }
        else { defaults = [.overview] }
        var tabs = custom.isEmpty || employee.isAdmin ? defaults : custom.compactMap(EventTab.init(rawValue:))
        if assigned?["status"] == "pending" || assigned?["status"] == "rejected", !manage && !employee.has("events_manage") { tabs = [.overview] }
        if finance["canViewCosts"]?.flag != true { tabs.removeAll { $0 == .finances } }
        if !(finance["canViewCommercials"]?.flag ?? (finance["canViewCosts"]?.flag == true)) { tabs.removeAll { $0 == .calculations } }
        let category = event.fields["category_info"]?.object["name"]?.text ?? ""
        if category.lowercased().hasPrefix("wesel"), tabs.contains(.agenda) { tabs = tabs.map { $0 == .agenda ? .wedding : $0 } }
        let workflow = try await eventWorkflowState(id)
        return EventPageCache(event:event,access:EventAccess(tabs:tabs,manage:manage,finance:finance,operationalOnly:false,workflow:workflow,assignment:assigned))
    }
    func eventSections(_ tab: EventTab, page: EventPageCache) async throws -> [EventSection] {
        let eventID = page.event.id
        guard page.access.tabs.contains(tab) else { throw AppError.forbidden }
        if native {
            let data = try await request("/api/native/v1/events/\(eventID)/tabs/\(tab.rawValue)")
            let map = try JSONDecoder().decode([String:[Row]].self,from:data)
            return map.keys.sorted().map { EventSection(id:$0,title:EventSectionTitles.title($0),rows:map[$0] ?? []) }
        }
        func section(_ table: String, _ title: String, select: String = "*", key: String = "event_id", value: String? = nil, filters: [String:String] = [:]) async throws -> EventSection {
            var f = filters; f[key] = "eq.\(value ?? eventID)"
            do { return EventSection(id:table,title:title,rows:try await read(table,select,f)) }
            catch { return EventSection(id:table,title:title,rows:[],error:friendlyError(error)) }
        }
        func children(_ table: String, _ title: String, parentKey: String, ids: [String], select: String = "*") async throws -> EventSection {
            var all: [Row] = []
            let valid = ids.filter { UUID(uuidString:$0) != nil }
            for index in stride(from:0,to:valid.count,by:100) {
                let chunk = Array(valid[index..<min(index+100,valid.count)])
                do { all += try await read(table,select,[parentKey:"in.(\(chunk.joined(separator:",")))"]) }
                catch { return EventSection(id:table,title:title,rows:[],error:friendlyError(error)) }
            }
            return EventSection(id:table,title:title,rows:all)
        }
        switch tab {
        case .overview: return []
        case .phases:
            let phases = try await section("event_phases","Etapy wydarzenia")
            let ids = phases.rows.map(\.id)
            return [phases,
                try await children("event_phase_assignments","Zespół etapów",parentKey:"phase_id",ids:ids,select:"*,employee:employees!event_phase_assignments_employee_id_fkey(id,name,surname)"),
                try await children("event_phase_equipment","Zasoby etapów",parentKey:"phase_id",ids:ids,select:"*,equipment_items(name),equipment_kits(name)"),
                try await children("event_phase_vehicles","Pojazdy etapów",parentKey:"phase_id",ids:ids)]
        case .agenda:
            let agendas = try await section("event_agendas","Agenda")
            return [agendas,
                try await children("event_agenda_items","Punkty agendy",parentKey:"agenda_id",ids:agendas.rows.map(\.id)),
                try await children("event_agenda_notes","Notatki i ustalenia",parentKey:"agenda_id",ids:agendas.rows.map(\.id))]
        case .wedding:
            let cards = try await section("wedding_cards","Karta wesela")
            let ids = cards.rows.map(\.id)
            return [cards,
                try await children("wedding_card_answers","Odpowiedzi w karcie",parentKey:"wedding_card_id",ids:ids),
                try await children("wedding_card_people","Osoby",parentKey:"wedding_card_id",ids:ids),
                try await children("wedding_schedule_items","Harmonogram",parentKey:"wedding_card_id",ids:ids),
                try await children("wedding_music_tracks","Muzyka",parentKey:"wedding_card_id",ids:ids),
                try await children("wedding_attraction_choices","Atrakcje",parentKey:"wedding_card_id",ids:ids)]
        case .team:
            let members = try await rpc("get_event_responsibility_team",["p_event_id":.string(eventID)])
            let responsibility = members.array.enumerated().map { i,v -> Row in var f=v.object; if f["id"] == nil { f["id"] = .string(f["employee_id"]?.text ?? "person-\(i)") }; return Row(f) }
            return [EventSection(id:"responsibility",title:"Zespół odpowiedzialny za wydarzenie",rows:responsibility),
                try await section("employee_assignments","Przypisania i zaproszenia",select:"id,event_id,employee_id,role,responsibilities,status,responded_at,employee:employees!employee_assignments_employee_id_fkey(id,name,surname,phone_number,email)")]
        case .equipment:
            return [try await section("event_equipment","Sprzęt i zestawy",select:"id,event_id,equipment_id,kit_id,quantity,status,is_loaded,notes,removed_from_offer,equipment:equipment_items(name,brand,model),kit:equipment_kits(name)",filters:["or":"(removed_from_offer.is.null,removed_from_offer.eq.false)"]),
                try await section("event_loading_checklist","Lista załadunku")]
        case .logistics:
            return [try await section("event_vehicles","Pojazdy i kierowcy",select:"*,vehicle:vehicles!event_vehicles_vehicle_id_fkey(name,registration_number,brand,model),driver:employees!event_vehicles_driver_id_fkey(name,surname)"),
                try await section("event_logistics_timeline","Plan logistyki")]
        case .tasks: return [try await section("tasks","Zadania wydarzenia",select:Self.taskFields,filters:["deleted_at":"is.null"])]
        case .files: return [try await section("event_folders","Foldery"),try await section("event_files","Pliki i dokumenty")]
        case .offer:
            let offers = try await section("offers","Oferty",select:"id,event_id,title,offer_number,status,subtotal,total_amount,tax_amount,tax_percent,discount_percent,discount_amount,valid_until,guest_count,created_at,updated_at,pdf_url")
            return [offers,try await children("offer_items","Pozycje ofert",parentKey:"offer_id",ids:offers.rows.map(\.id))]
        case .calculations:
            guard page.access.canViewCommercials else { throw AppError.forbidden }
            let calculations = try await section("event_calculations","Kalkulacje realizacji")
            return [calculations,try await children("event_calculation_items","Pozycje kalkulacji",parentKey:"calculation_id",ids:calculations.rows.map(\.id))]
        case .finances:
            guard page.access.canViewCosts else { throw AppError.forbidden }
            let rawSummary = try await rpc("get_event_financial_summary",["p_event_id":.string(eventID)])
            var summary = rawSummary.object.isEmpty ? (rawSummary.array.first?.object ?? [:]) : rawSummary.object
            summary["id"] = .string(eventID)
            return [EventSection(id:"finance_summary",title:"Podsumowanie z serwera",rows:[Row(summary)]),
                try await section("event_costs","Koszty",select:"*,category_info:event_cost_categories(name)"),
                try await section("event_invoice_settlements","Faktury i rozrachunki"),
                try await section("event_commissions","Prowizje",select:"id,beneficiary_name,calculation_type,rate,base_amount,amount,company_cost_amount,payment_method,status"),
                try await section("event_cash_transactions","Operacje gotówkowe")]
        case .contract: return [try await section("event_partner_arrangements","Ustalenia z partnerem"),try await section("contracts","Umowy")]
        case .seller:
            let result=try await rpc("get_event_seller_correspondence",["p_event":.string(eventID)])
            return [EventSection(id:"seller_correspondence",title:"Oferty i ustalenia ze sprzedawcą",rows:(result.object["offers"]?.array ?? []).map {Row($0.object)})]
        case .subcontractors:
            return [try await section("subcontractor_tasks","Zlecenia podwykonawców",select:page.access.canViewCosts ? "*,subcontractor:subcontractors(company_name,contact_person,email,phone)" : "id,event_id,task_name,description,status,subcontractor:subcontractors(company_name,contact_person,email,phone)"),
                try await section("subcontractor_contracts","Dokumenty podwykonawców")]
        case .history:
            return [try await section("event_audit_log","Historia zmian",select:page.access.canViewCosts ? "*" : "id,action,created_at,user_name,field_name")]
        case .live:
            return [try await section("mavinci_event_projects","Projekt Mavinci LIVE",select:"id,name,enabled_modules,version,updated_at"),
                try await section("mavinci_event_module_access","Dostępy do modułów")]
        }
    }
    func eventWorkflowState(_ id:String) async throws -> [String:JSONValue] {
        var value=try await rpc("get_event_realization_assignment",["p_event_id":.string(id)]).object
        value["warehouseAllowed"] = try await rpc("can_prepare_warehouse_event",["p_event_id":.string(id)])
        let data=try await request("/rest/v1/event_warehouse_handoffs",query:[.init(name:"event_id",value:"eq.\(id)"),.init(name:"select",value:"event_id,accepted_at,accepted_by_name,ready_at,ready_by_name")])
        let rows=try JSONDecoder().decode([Row].self,from:data)
        value["handoff"] = rows.first.map {.object($0.fields)} ?? .null
        return value
    }
    func eventWorkflow(_ name:String,page:EventPageCache,employee:Employee) async throws {
        let current=try await eventPage(page.event.id,employee:employee)
        if native {_ = try await request("/api/native/v1/events/\(page.event.id)/workflow",body:["action":.string(name)]);return}
        switch name {
        case "start":
            guard current.access.workflow?["is_manager"]?.flag == true else {throw AppError.forbidden}
            _ = try await rpc("advance_realization",["p_event_id":.string(page.event.id),"p_action":.string("start"),"p_notes":.null])
        case "accept_warehouse", "ready_warehouse":
            guard current.access.workflow?["warehouseAllowed"]?.flag == true else {throw AppError.forbidden}
            if name == "accept_warehouse" {_ = try await rpc("accept_warehouse_event",["p_event_id":.string(page.event.id)])}
            else {_ = try await rpc("advance_warehouse_event",["p_event_id":.string(page.event.id),"p_action":.string("ready")])}
        default:throw AppError.unsupported
        }
    }
    func eventLookup(_ table: String) async throws -> [Row] {
        if native {return try JSONDecoder().decode([Row].self,from:await request("/api/native/v1/options/\(table)"))}
        switch table {
        case "employees": return try await read(table,"id,name,surname",["is_active":"eq.true"])
        case "event_cost_categories": return try await read(table,"id,name",["is_active":"eq.true"])
        default: throw AppError.unsupported
        }
    }
    func saveEventForm(_ form: EventForm, payload: [String:JSONValue], page: EventPageCache, employee: Employee) async throws {
        let current = try await eventPage(page.event.id,employee:employee)
        if native {
            _ = try await request("/api/native/v1/events/\(page.event.id)/form",body:["table":.string(form.table),"id":form.record.map{.string($0.id)} ?? .null,"expected_updated_at":form.record.map{.string($0["updated_at"])} ?? .null,"payload":.object(payload),"fixed":.object(form.fixed)])
            return
        }
        if form.table == "__manager" {
            guard current.access.manage,let target=payload["employee_id"],!target.text.isEmpty else {throw AppError.forbidden}
            _ = try await rpc("appoint_realization_manager",["p_event_id":.string(page.event.id),"p_employee_id":target]);return
        }
        if form.table == "__complete" {
            guard current.access.workflow?["is_manager"]?.flag == true,let notes=payload["notes"],!notes.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else {throw AppError.forbidden}
            _ = try await rpc("advance_realization",["p_event_id":.string(page.event.id),"p_action":.string("complete"),"p_notes":notes]);return
        }
        let financial = form.table == "event_costs"
        guard current.access.manage || (financial && current.access.canManageCosts) else { throw AppError.forbidden }
        let allowedTables = ["events","event_phases","event_agenda_items","event_agenda_notes","event_agendas","tasks","employee_assignments","event_costs"]
        guard allowedTables.contains(form.table) else { throw AppError.unsupported }
        var body = payload
        let keys = Set(form.fields.map(\.id)).union(form.fixed.keys)
        guard Set(body.keys).isSubset(of:keys) else { throw AppError.invalidResponse }
        for (key,value) in form.fixed { body[key] = value }
        if form.table == "events" {
            guard form.record?.id == page.event.id else { throw AppError.invalidResponse }
        }
        if form.record == nil {
            if ["tasks","employee_assignments","event_costs","event_agendas"].contains(form.table) { body["event_id"] = .string(page.event.id) }
            if form.table == "event_agendas" {body["created_by"] = .string(employee.id)}
            if form.table == "tasks" {
                body["is_private"] = .bool(false); body["is_inquiry"] = .bool(false)
                body["owner_id"] = .string(employee.auth_user_id); body["created_by"] = .string(employee.id)
            }
            if form.table == "employee_assignments" { body["status"] = .string("pending") }
            if form.table == "event_costs" { body["created_by"] = .string(employee.id); body["status"] = .string("pending") }
        }
        if financial,let amount=body["amount"],Decimal(string:amount.text).map({$0<=0}) != false {throw AppError.invalidResponse}
        if form.table == "tasks" { body["status"] = body["board_column"]; if body["status"]?.text != "in_progress" { body["currently_working_by"] = .null } }
        if ["event_agenda_items","event_agenda_notes"].contains(form.table) {
            let parent=form.fixed["agenda_id"]?.text ?? form.record?["agenda_id"] ?? ""
            guard UUID(uuidString:parent) != nil else {throw AppError.invalidResponse}
            let data=try await request("/rest/v1/event_agendas",method:"PATCH",query:[.init(name:"id",value:"eq.\(parent)"),.init(name:"event_id",value:"eq.\(page.event.id)")],body:["modified_after_generation":.bool(true),"updated_at":.string(ISO8601DateFormatter().string(from:Date()))])
            guard try JSONDecoder().decode([Row].self,from:data).count == 1 else {throw AppError.conflict}
        }
        if let row = form.record {
            var query = [URLQueryItem(name:"id",value:"eq.\(row.id)")]
            if !row["updated_at"].isEmpty { query.append(.init(name:"updated_at",value:"eq.\(row["updated_at"])")) }
            if ["events","tasks","employee_assignments","event_costs","event_phases"].contains(form.table), form.table != "events" { query.append(.init(name:"event_id",value:"eq.\(page.event.id)")) }
            if financial { query.append(.init(name:"status",value:"eq.pending")) }
            let data = try await request("/rest/v1/\(form.table)",method:"PATCH",query:query,body:body)
            guard try JSONDecoder().decode([Row].self,from:data).count == 1 else { throw AppError.conflict }
        } else {
            _ = try await request("/rest/v1/\(form.table)",body:body)
        }
    }
    func setEquipmentLoaded(_ row: Row, loaded: Bool, page: EventPageCache, employee: Employee) async throws {
        let current = try await eventPage(page.event.id,employee:employee)
        guard current.access.tabs.contains(.equipment) else { throw AppError.forbidden }
        _ = try await rpc("set_event_equipment_loaded",["p_equipment_id":.string(row.id),"p_loaded":.bool(loaded)])
    }
    func respondEventInvitation(_ row: Row, accept: Bool, employee: Employee) async throws {
        let data = try await request("/rest/v1/employee_assignments",method:"PATCH",query:[.init(name:"id",value:"eq.\(row.id)"),.init(name:"employee_id",value:"eq.\(employee.id)"),.init(name:"status",value:"eq.pending")],body:["status":.string(accept ? "accepted":"rejected"),"responded_at":.string(ISO8601DateFormatter().string(from:Date()))])
        guard try JSONDecoder().decode([Row].self,from:data).count == 1 else { throw AppError.conflict }
    }
    func fileData(_ path: String) async throws -> Data {
        if native {return try await request("/api/native/v1/files",query:[.init(name:"path",value:path)])}
        guard !path.isEmpty, !path.hasPrefix("/"), !path.split(separator:"/").contains("..") else { throw AppError.invalidResponse }
        // Authenticated storage read keeps the user's RLS and avoids public or long-lived links.
        let escaped = path.split(separator:"/").map { String($0).addingPercentEncoding(withAllowedCharacters:.urlPathAllowed) ?? "" }.joined(separator:"/")
        return try await request("/storage/v1/object/authenticated/event-files/\(escaped)")
    }
}
enum EventSectionTitles {
    static func title(_ key:String) -> String { ["event_phases":"Etapy","event_agendas":"Agenda","event_agenda_items":"Punkty agendy","event_agenda_notes":"Notatki agendy","employee_assignments":"Przypisania","event_equipment":"Sprzęt","event_loading_checklist":"Załadunek","event_vehicles":"Pojazdy","event_logistics_timeline":"Plan logistyki","tasks":"Zadania","event_files":"Pliki","event_folders":"Foldery","offers":"Oferty","offer_items":"Pozycje oferty","event_calculations":"Kalkulacje","event_calculation_items":"Pozycje kalkulacji","event_costs":"Koszty","event_commissions":"Prowizje","event_cash_transactions":"Gotówka","event_invoice_settlements":"Faktury","contracts":"Umowy","subcontractor_tasks":"Zlecenia podwykonawców","subcontractor_contracts":"Dokumenty podwykonawców","event_audit_log":"Historia","mavinci_event_projects":"Mavinci LIVE"][key] ?? "Dane wydarzenia" }
}

extension HTTPBackend {
    func uploadEventFile(data:Data,name:String,mime:String,eventID:String,folderID:String?,employee:Employee) async throws {
        let current=try await eventPage(eventID,employee:employee)
        guard current.access.manage,current.access.tabs.contains(.files),data.count<=25*1024*1024 else {throw AppError.forbidden}
        if native {
            _ = try await request("/api/native/v1/events/\(eventID)/files",method:"POST",query:[.init(name:"name",value:name),.init(name:"folder_id",value:folderID)],rawBody:data,contentType:mime);return
        }
        let path="\(eventID)/\(UUID().uuidString)/\(name)"
        let escaped=path.split(separator:"/").map {String($0).addingPercentEncoding(withAllowedCharacters:.urlPathAllowed) ?? ""}.joined(separator:"/")
        _ = try await request("/storage/v1/object/event-files/\(escaped)",method:"POST",rawBody:data,contentType:mime)
        do {
            _ = try await request("/rest/v1/event_files",body:["event_id":.string(eventID),"folder_id":folderID.map(JSONValue.string) ?? .null,"name":.string(name),"original_name":.string(name),"file_path":.string(path),"file_size":.number(Double(data.count)),"mime_type":.string(mime),"uploaded_by":.string(employee.auth_user_id)])
        } catch {
            // If the metadata request failed before returning, do not erase a possibly committed file.
            // An administrator can identify orphaned uploads by their event/UUID path.
            throw error
        }
    }
}
