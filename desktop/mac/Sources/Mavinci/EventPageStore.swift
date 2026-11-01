import Foundation
import SwiftUI

@MainActor final class EventPageStore: ObservableObject {
    @Published var page: EventPageCache?
    @Published var sections: [EventSection] = []
    @Published var selectedTab: EventTab = .overview
    @Published var loading = false
    @Published var saving = false
    @Published var error: String?
    private var requestID = UUID()
    private(set) var eventID = ""
    func cancel() { requestID = UUID() }
    func load(_ id: String, workspace: Workspace) async {
        guard !saving && !workspace.editing, let employee = workspace.employee else { return }
        let ticket = UUID(); requestID = ticket; eventID = id
        loading = true; error = nil
        defer { if requestID == ticket { loading = false } }
        if page == nil { page = workspace.snapshot?.eventPages?[id] }
        guard !workspace.offline, let api = workspace.eventAPI() else {
            if let page, Date().timeIntervalSince(page.loadedAt) <= 86_400 {
                sections = cachedSections(selectedTab,page:page)
            } else { page = nil; sections = []; error = "Połącz się z serwerem, aby pobrać kartę wydarzenia." }
            return
        }
        do {
            var fresh = try await api.eventPage(id,employee:employee)
            guard requestID == ticket, workspace.employee == employee else { return }
            if let page, page.access == fresh.access {
                fresh.sections = page.sections; fresh.loadedTabs = page.loadedTabs; fresh.sectionErrors = page.sectionErrors
            }
            page = fresh
            if !fresh.access.tabs.contains(selectedTab) { selectedTab = fresh.access.tabs.first ?? .overview }
            workspace.saveEventPage(fresh)
            await loadTab(workspace:workspace)
        } catch {
            guard requestID == ticket, workspace.employee == employee else { return }
            if !(error is URLError) { page = nil; sections = [] }
            self.error = friendlyError(error)
        }
    }
    func loadTab(workspace: Workspace) async {
        guard !saving, let current = page, let employee = workspace.employee, current.access.tabs.contains(selectedTab) else { return }
        let tab = selectedTab
        let ticket = UUID(); requestID = ticket
        if workspace.offline {
            sections = cachedSections(tab,page:current)
            if tab != .overview && !(current.loadedTabs.contains(tab.rawValue)) { error = "Ta zakładka nie została jeszcze zapisana do pracy bez internetu." }
            return
        }
        guard let api = workspace.eventAPI() else { return }
        loading = true; error = nil; sections = []
        defer { if requestID == ticket { loading = false } }
        do {
            let next = try await api.eventSections(tab,page:current)
            guard requestID == ticket, selectedTab == tab, workspace.employee == employee else { return }
            sections = next
            for section in next {
                page?.sections[section.id] = section.rows
                if page?.sectionErrors == nil { page?.sectionErrors = [:] }
                page?.sectionErrors?[section.id] = section.error
            }
            if next.allSatisfy({ $0.error == nil }) && page?.loadedTabs.contains(tab.rawValue) == false { page?.loadedTabs.append(tab.rawValue) }
            page?.loadedAt = Date()
            if let page { workspace.saveEventPage(page) }
        } catch {
            guard requestID == ticket, workspace.employee == employee else { return }
            self.error = friendlyError(error)
        }
    }
    private func cachedSections(_ tab: EventTab,page:EventPageCache) -> [EventSection] {
        let keys: [String]
        switch tab {
        case .overview: keys = []
        case .phases: keys = ["event_phases","event_phase_assignments","event_phase_equipment","event_phase_vehicles"]
        case .agenda: keys = ["event_agendas","event_agenda_items","event_agenda_notes"]
        case .wedding: keys = ["wedding_cards","wedding_card_answers","wedding_card_people","wedding_schedule_items","wedding_music_tracks","wedding_attraction_choices"]
        case .team: keys = ["responsibility","employee_assignments"]
        case .equipment: keys = ["event_equipment","event_loading_checklist"]
        case .logistics: keys = ["event_vehicles","event_logistics_timeline"]
        case .files: keys = ["event_folders","event_files"]
        case .tasks: keys = ["tasks"]
        case .offer: keys = ["offers","offer_items"]
        case .calculations: keys = ["event_calculations","event_calculation_items"]
        case .finances: keys = ["finance_summary","event_costs","event_invoice_settlements","event_commissions","event_cash_transactions"]
        case .contract: keys = ["event_partner_arrangements","contracts"]
        case .seller: keys = ["seller_correspondence"]
        case .subcontractors: keys = ["subcontractor_tasks","subcontractor_contracts"]
        case .history: keys = ["event_audit_log"]
        case .live: keys = ["mavinci_event_projects","mavinci_event_module_access"]
        }
        return keys.map { EventSection(id:$0,title:EventSectionTitles.title($0),rows:page.sections[$0] ?? [],error:page.sectionErrors?[$0]) }
    }
    func save(_ form: EventForm,payload:[String:JSONValue],workspace:Workspace) async -> Bool {
        guard workspace.canWrite, let api = workspace.eventAPI(), let page, let employee = workspace.employee, !saving else { return false }
        saving = true; error = nil
        var success = false
        do {
            try await api.saveEventForm(form,payload:payload,page:page,employee:employee)
            guard workspace.employee == employee else { saving = false; return false }
            success = true
        } catch { self.error = error is URLError ? "Nie potwierdzono wyniku zapisu. Odśwież kartę przed ponowną próbą." : friendlyError(error) }
        saving = false
        return success
    }
    func workflow(_ name:String,workspace:Workspace) async {
        guard workspace.canWrite,let api=workspace.eventAPI(),let page,let employee=workspace.employee,!saving else { return }
        saving=true;error=nil
        do { try await api.eventWorkflow(name,page:page,employee:employee) }
        catch {self.error=friendlyError(error)}
        saving=false
        await load(eventID,workspace:workspace)
    }
    func toggleEquipment(_ row:Row,workspace:Workspace) async {
        guard workspace.canWrite,let api=workspace.eventAPI(),let page,let employee=workspace.employee,!saving else { return }
        saving = true; error = nil
        do { try await api.setEquipmentLoaded(row,loaded:row.fields["is_loaded"]?.flag != true,page:page,employee:employee) }
        catch { self.error = friendlyError(error) }
        saving = false
        await loadTab(workspace:workspace)
    }
    func respond(_ row:Row,accept:Bool,workspace:Workspace) async {
        guard workspace.canWrite, let api=workspace.eventAPI(), let employee=workspace.employee,!saving else { return }
        saving=true; error=nil
        do { try await api.respondEventInvitation(row,accept:accept,employee:employee) }
        catch { self.error=friendlyError(error) }
        saving=false
        await load(eventID,workspace:workspace)
    }
}
