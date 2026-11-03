import Foundation
import SwiftUI
import Network

@MainActor final class Workspace: ObservableObject {
    @Published var connection = Connection.load()
    @Published var snapshot: Snapshot?
    @Published var selection: Module? = .day
    @Published var eventRoute: EventRoute?
    @Published var refreshEventToken = UUID()
    @Published var focusedID: String?
    @Published var focusToken = UUID()
    @Published var notificationsVisible = false
    @Published var loading = false
    @Published var syncing = false
    @Published var acting = false
    @Published var editing = false
    @Published var offline = false
    @Published var error: String?
    @Published var moduleErrors: [String: String] = [:]
    @Published var compatibilityMode = false
    @Published var notice: String?
    private var backend: HTTPBackend?
    private var cache: LocalCache?
    private var generation = UUID()
    private let monitor = NWPathMonitor()
    private var pathAvailable = true
    private var verifiedConnection = false
    var employee: Employee? { snapshot?.employee }
    var modules: [Module] { Module.allCases.filter { employee?.canView($0) == true } }
    var canWrite: Bool { employee != nil && verifiedConnection && !offline && !syncing && !acting && !loading }
    var canConfigure: Bool { employee?.isAdmin == true || (!connection.valid && employee == nil) }
    var unread: Int { rows(.notifications).filter { $0.fields["is_read"]?.flag != true }.count }
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.pathAvailable = path.status == .satisfied
                if path.status != .satisfied { self?.offline = true; self?.verifiedConnection = false }
            }
        }
        monitor.start(queue: DispatchQueue(label: "pl.mavinci.network"))
    }
    func rows(_ module: Module) -> [Row] {
        if module == .events {return snapshot?.collections[Module.calendar.rawValue]?.rows.filter{$0["kind"]=="event"} ?? []}
        return snapshot?.collections[module.rawValue]?.rows ?? []
    }
    func restore() async {
        guard !loading, snapshot == nil, connection.valid else { return }
        loading = true
        defer { loading = false }
        do {
            guard let data = try Vault.read("session-\(connection.identity)") else { return }
            let session = try JSONDecoder().decode(Session.self, from: data)
            let api = HTTPBackend(connection); backend = api
            await api.restore(session)
            cache = LocalCache(namespace: digest("\(connection.identity)|\(session.user.id)"))
            // Cached permissions are valid only for reading, for at most 24 hours without server verification.
            let saved = try cache?.load()
            if let saved, Date().timeIntervalSince(saved.savedAt) <= 86_400 { snapshot = saved; offline = true }
            await refresh(force: true)
        } catch {
            self.error = friendlyError(error)
        }
    }
    func login(email: String, password: String) async {
        guard !loading else { return }
        loading = true; error = nil
        let ticket = generation
        defer { loading = false }
        let api = HTTPBackend(connection)
        do {
            let session = try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            let employee = try await api.profile()
            guard employee.is_active else { throw AppError.noEmployee }
            guard ticket == generation else { return }
            backend = api
            cache = LocalCache(namespace: digest("\(connection.identity)|\(session.user.id)"))
            snapshot = Snapshot(employee: employee)
            if let saved = try? cache?.load(), saved.employee == employee { snapshot = saved }
            verifiedConnection = true; offline = false
            await refresh(force: true)
        } catch {
            await api.logout()
            try? Vault.delete("session-\(connection.identity)")
            self.error = friendlyError(error)
        }
    }
    func refresh(force: Bool = false) async {
        guard let backend, !syncing, !acting, !editing || force else { return }
        let ticket = generation
        syncing = true
        defer { if ticket == generation { syncing = false } }
        do {
            let current = try await backend.profile()
            guard ticket == generation else { return }
            guard current.is_active else { throw AppError.noEmployee }
            if snapshot?.employee != current {
                try cache?.clear()
                snapshot = Snapshot(employee: current)
                eventRoute = nil
                focusedID = nil
                if let selection, !current.canView(selection) { self.selection = .day }
            }
            if snapshot == nil { snapshot = Snapshot(employee: current) }
            verifiedConnection = true; offline = false; error = nil
            compatibilityMode = false
            for module in modules where module != .day && module != .events {
                guard ticket == generation else { return }
                do {
                    let previous = snapshot?.collections[module.rawValue] ?? CollectionState()
                    var next = previous
                    do {
                        let reply = try await backend.sync(module, hashes: previous.hashes)
                        try next.apply(reply)
                    } catch AppError.missingSync {
                        let rows = try await backend.fullRead(module, employee: current)
                        next = CollectionState(hashes: [:], buckets: ["full": rows], lastSync: Date())
                        compatibilityMode = true
                    }
                    guard ticket == generation else { return }
                    // A full snapshot fallback must not survive switching to bucket sync.
                    next.buckets.removeValue(forKey: next.hashes.isEmpty ? "unused" : "full")
                    snapshot?.collections[module.rawValue] = next
                    moduleErrors.removeValue(forKey: module.rawValue)
                } catch AppError.unauthorized { throw AppError.unauthorized }
                catch {
                    guard ticket == generation else { return }
                    // Fail closed for server/schema/access failures; retain last good data only on transport failure.
                    if !(error is URLError) { snapshot?.collections.removeValue(forKey: module.rawValue) }
                    if error is URLError { offline = true; verifiedConnection = false }
                    moduleErrors[module.rawValue] = friendlyError(error)
                }
            }
            if current.canView(.inquiries) {
                do {
                    let day = try await backend.salesDay()
                    guard ticket == generation else { return }
                    snapshot?.salesDay = day
                    moduleErrors.removeValue(forKey: "day")
                } catch {
                    guard ticket == generation else { return }
                    if !(error is URLError) { snapshot?.salesDay = .null }
                    moduleErrors["day"] = friendlyError(error)
                }
            }
            guard ticket == generation else { return }
            // Do not extend the offline permission lease on a partial/failed synchronization.
            if moduleErrors.isEmpty { snapshot?.savedAt = Date() }
            if !editing { refreshEventToken = UUID() }
            if let snapshot {
                do { try cache?.save(snapshot) }
                catch { notice = "Nie udało się zapisać lokalnej kopii. Dane są dostępne do zamknięcia aplikacji." }
            }
        } catch {
            guard ticket == generation else { return }
            if error is URLError {
                offline = true; verifiedConnection = false
                if let snapshot, Date().timeIntervalSince(snapshot.savedAt) > 86_400 { self.snapshot = nil }
                self.error = friendlyError(error)
            } else if let issue = error as? AppError, issue == .unauthorized || issue == .noEmployee || issue == .forbidden {
                await logout()
                self.error = friendlyError(error)
            } else {
                verifiedConnection = false
                self.error = friendlyError(error)
            }
        }
    }
    func allowed(_ command: String, row: Row? = nil) -> Bool {
        guard let employee else { return false }
        switch command {
        case "contact_update": return employee.canView(.contacts) && employee.has("contacts_manage")
        case "tender_update", "tender_assign", "tender_inquiry": return employee.canView(.tenders)
        case "task_create": return employee.canView(.tasks) && (employee.has("tasks_create") || employee.has("tasks_manage"))
        case "task_update": return employee.canView(.tasks)
        case "notification_read": return true
        case "claim_inquiry": return employee.canView(.inquiries) && (employee.has("inquiries_assign") || employee.has("inquiries_manage") || employee.has("inquiries_manage_own"))
        case "complete_inquiry_followup", "snooze_inquiry_followup":
            return employee.canView(.inquiries) && (employee.has("inquiries_manage") || employee.has("inquiries_manage_all") || employee.has("inquiries_manage_team") || (employee.has("inquiries_manage_own") && row?["inquiry_owner_id"] == employee.id))
        default: return false
        }
    }
    @discardableResult func perform(_ name: String, row: Row? = nil, payload: [String: JSONValue] = [:]) async -> Bool {
        guard canWrite, allowed(name, row: row), let backend else { return false }
        acting = true; error = nil; notice = nil
        let ticket = generation
        var succeeded = false
        do {
            // Recheck identity and effective scope before every write. Database RLS/RPC remains authoritative.
            let current = try await backend.profile()
            guard ticket == generation else { return false }
            guard current == employee else { throw AppError.conflict }
            try await backend.command(name, row: row, payload: payload)
            guard ticket == generation else { return false }
            succeeded = true
            notice = "Zapisano zmiany."
        } catch {
            guard ticket == generation else { return false }
            self.error = error is URLError ? "Nie otrzymano potwierdzenia zapisu. Odśwież dane przed ponowną próbą, aby nie powtórzyć operacji." : friendlyError(error)
            if error is URLError { verifiedConnection = false; offline = true }
        }
        guard ticket == generation else { return false }
        acting = false
        if succeeded { await refresh(force: true) }
        return succeeded
    }
    func logout() async {
        let old = backend
        generation = UUID()
        // Local sign-out is immediate; server revocation cannot keep data visible.
        backend = nil
        snapshot = nil; selection = .day; focusedID = nil; eventRoute = nil; notificationsVisible = false
        verifiedConnection = false; offline = false; syncing = false; acting = false; editing = false
        moduleErrors = [:]; compatibilityMode = false; notice = nil
        do { try Vault.delete("session-\(connection.identity)") }
        catch { self.error = "Nie udało się usunąć danych logowania z pęku kluczy. Zamknij aplikację i sprawdź dostęp do pęku kluczy." }
        do { try cache?.clear() }
        catch { self.error = "Nie udało się usunąć lokalnej kopii. Sprawdź dostęp aplikacji do plików i pęku kluczy." }
        cache = nil
        await old?.logout()
    }
    func configure(_ next: Connection) async {
        guard canConfigure, next.valid else { error = AppError.configuration.localizedDescription; return }
        do {
            try next.save()
            await logout()
            connection = next
        } catch { self.error = friendlyError(error) }
    }
    func switchSection(_ module:Module) {
        guard employee?.canView(module)==true else{return}
        eventRoute=nil;focusedID=nil;notificationsVisible=false;selection=module
    }
    func eventAPI() -> HTTPBackend? { backend }
    func persistSnapshot() {if let snapshot {try? cache?.save(snapshot)}}
    func saveEventPage(_ page: EventPageCache) {
        guard employee != nil else { return }
        if snapshot?.eventPages == nil { snapshot?.eventPages = [:] }
        snapshot?.eventPages?[page.event.id] = page
        if let snapshot { try? cache?.save(snapshot) }
    }
    func showEvent(_ id: String,tab:EventTab? = nil) {
        guard UUID(uuidString: id) != nil else { return }
        eventRoute = EventRoute(id: id, origin: selection, tab:tab)
    }
    func open(_ module: Module, id: String) {
        Task {await navigate(module,id:id)}
    }
    @discardableResult func navigate(_ module:Module,id:String) async -> Bool {
        let owner=employee
        guard let owner,owner.canView(module),UUID(uuidString:id) != nil else {notice="Nie masz dostępu do tej sekcji.";return false}
        if module == .events {showEvent(id);return true}
        var record=rows(module).first{$0.id==id || (module == .calendar && $0["source_id"]==id)}
        if record == nil,let backend,!offline {
            do {record=try await backend.record(module,id:id)}
            catch {self.error=friendlyError(error);return false}
        }
        guard employee==owner,let record else {notice="Powiązana sprawa nie jest dostępna w bieżącym zakresie danych.";return false}
        let target:Module = module == .tasks && record.fields["is_inquiry"]?.flag == true ? .inquiries:module
        guard owner.canView(target) else {return false}
        if snapshot?.collections[target.rawValue] == nil {snapshot?.collections[target.rawValue]=CollectionState()}
        if !rows(target).contains(where:{$0.id==record.id}) {snapshot?.collections[target.rawValue]?.buckets["linked"]=Array((snapshot?.collections[target.rawValue]?.buckets["linked"] ?? []).filter{$0.id != record.id})+[record]}
        eventRoute=nil;focusedID=record.id;selection=target;focusToken=UUID()
        return true
    }
}
