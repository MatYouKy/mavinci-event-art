import Foundation

extension HTTPBackend {
    func record(_ module:Module,id:String) async throws -> Row? {
        guard UUID(uuidString:id) != nil else {throw AppError.invalidResponse}
        if native {return try JSONDecoder().decode(Row.self,from:await request("/api/native/v1/records/\(module.rawValue)/\(id)"))}
        let table:String,fields:String
        switch module {
        case .contacts:table="contacts";fields=Self.contactFields
        case .tenders:table="tenders";fields=Self.tenderFields
        case .tasks,.inquiries:table="tasks";fields=Self.taskFields
        case .offers:table="offers";fields=Self.offerFields
        case .events:table="events";fields=Self.eventFields
        case .calendar:
            let result=try await read("meetings","id,title,datetime_start,datetime_end,location_text,recurrence_days,color",["id":"eq.\(id)","deleted_at":"is.null"])
            guard let row=result.first else{return nil}
            var f=row.fields;f["id"] = .string("meeting:\(id)");f["source_id"] = .string(id);f["kind"] = .string("meeting");f["name"]=f["title"];f["event_date"]=f["datetime_start"];f["event_end_date"]=f["datetime_end"];f["location"]=f["location_text"]
            return Row(f)
        default:throw AppError.unsupported
        }
        return try await read(table,fields,["id":"eq.\(id)"]).first
    }
    func updateRecord(_ module:Module,row:Row,values:[String:JSONValue]) async throws -> Row {
        let allowed:Set<String>
        switch module {
        case .contacts:allowed=["first_name","last_name","email","phone","mobile","position","address","city","postal_code","country","notes"]
        case .tenders:allowed=["notes","status","is_watched","is_hidden","manual_relevance"]
        default:throw AppError.unsupported
        }
        guard Set(values.keys).isSubset(of:allowed),!row["updated_at"].isEmpty else {throw AppError.conflict}
        if native {
            return try JSONDecoder().decode(Row.self,from:await request("/api/native/v1/records/\(module.rawValue)/\(row.id)",method:"PATCH",body:["values":.object(values),"expected_updated_at":.string(row["updated_at"])]))
        }
        let fields=module == .contacts ? Self.contactFields:Self.tenderFields
        let data=try await request("/rest/v1/\(module.rawValue)",method:"PATCH",query:[.init(name:"id",value:"eq.\(row.id)"),.init(name:"updated_at",value:"eq.\(row["updated_at"])") , .init(name:"select",value:fields)],body:values)
        let rows=try JSONDecoder().decode([Row].self,from:data)
        guard rows.count==1 else{throw AppError.conflict}
        return rows[0]
    }
    func tenderAction(_ action:String,row:Row,employee:Employee) async throws -> JSONValue {
        if native {return try JSONDecoder().decode(JSONValue.self,from:await request("/api/native/v1/tenders/\(row.id)/action",body:["action":.string(action)]))}
        switch action {
        case "assign","release":return try await rpc("assign_tender",["p_tender_id":.string(row.id),"p_employee_id":action=="assign" ? .string(employee.id):.null])
        case "inquiry":return try await rpc("create_inquiry_from_tender",["p_tender_id":.string(row.id)])
        default:throw AppError.unsupported
        }
    }
}

@MainActor extension Workspace {
    func acceptRecord(_ record:Row,module:Module) {
        guard snapshot != nil else{return}
        var collection=snapshot?.collections[module.rawValue] ?? CollectionState()
        var replaced=false
        for key in Array(collection.buckets.keys) {
            collection.buckets[key]=collection.buckets[key]?.map {old in
                if old.id==record.id {replaced=true;return record};return old
            }
        }
        if !replaced {collection.buckets["linked",default:[]].append(record)}
        snapshot?.collections[module.rawValue]=collection
        persistSnapshot()
    }
    @discardableResult func update(_ module:Module,row:Row,values:[String:JSONValue]) async -> Bool {
        let command=module == .contacts ? "contact_update":"tender_update"
        guard canWrite,allowed(command),let api=eventAPI(),let actor=employee else{return false}
        acting=true;error=nil
        defer {if employee==actor{acting=false}}
        do {
            guard try await api.profile()==actor else{throw AppError.conflict}
            let record=try await api.updateRecord(module,row:row,values:values)
            guard employee==actor else{return false}
            acceptRecord(record,module:module)
            return true
        } catch {
            if employee==actor {self.error=error is URLError ? "Nie potwierdzono wyniku zapisu. Odśwież dane przed ponowną próbą.":friendlyError(error)}
            return false
        }
    }
    @discardableResult func tenderAction(_ action:String,row:Row) async -> String? {
        guard canWrite,allowed("tender_assign"),let api=eventAPI(),let actor=employee else{return nil}
        acting=true;error=nil
        defer {if employee==actor{acting=false}}
        do {
            guard try await api.profile()==actor else{throw AppError.conflict}
            let result=try await api.tenderAction(action,row:row,employee:actor)
            guard employee==actor else{return nil}
            if let saved=try await api.record(.tenders,id:row.id) {acceptRecord(saved,module:.tenders)}
            return action=="inquiry" ? result.text:row.id
        } catch {
            if employee==actor {self.error=error is URLError ? "Nie potwierdzono wyniku czynności. Odśwież przetarg przed ponowną próbą.":friendlyError(error)}
            return nil
        }
    }
}
