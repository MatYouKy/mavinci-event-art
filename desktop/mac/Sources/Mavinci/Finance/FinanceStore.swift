import Foundation
import SwiftUI

// MARK: Finanse — stan sekcji `/crm/invoices` na Macu: działalności z „Podglądem finansów” i stan każdej z nich (Centrum
// finansów, terminy i monity, biała lista, zamknięcia miesięcy) z kopii na dysku (`finance-…`, AES-GCM) — pokazywany od razu,
// odświeżany w tle przez `/bridge/native/v1/finance` (token pracownika). Zapisy jak w panelach CRM, z oknem postępu
// i komunikatem; po zapisie świeży stan z serwera.

/// Części ekranu Finanse (lewa kolumna).
enum FinancePart: String, CaseIterable, Identifiable {
    case center, deadlines, periods
    var id: String { rawValue }
    var label: String {
        switch self {
        case .center: return "Centrum finansów"
        case .deadlines: return "Terminy i monity"
        case .periods: return "Zamknięcie miesięcy"
        }
    }
    var detail: String {
        switch self {
        case .center: return "Gotówka, należności, podatki, prognoza"
        case .deadlines: return "ZUS, podatki, monity, biała lista"
        case .periods: return "Blokada miesięcy po przekazaniu"
        }
    }
    var symbol: String {
        switch self {
        case .center: return "scalemass"
        case .deadlines: return "calendar.badge.clock"
        case .periods: return "lock"
        }
    }
    /// Opis pod „?”: co jest w tej części i po co.
    var help: String {
        switch self {
        case .center:
            return "Jeden ekran „na dziś” dla wybranej działalności: gotówka z wyciągów, należności i zobowiązania z wiekowaniem, ZUS i podatki (szacunek VAT, rezerwa CIT), prognoza salda na 13 tygodni, kompletność danych i zamknięcie poprzedniego miesiąca.\n\nPo co: widzisz, czy starczy pieniędzy, co jest po terminie i których danych brakuje, zanim policzysz cokolwiek dalej."
        case .deadlines:
            return "Kalendarz ZUS i podatków z kwotami z deklaracji i potwierdzeniem zapłaty z wyciągów, należności po terminie z przypomnieniami e-mail do klientów, faktury kosztowe do zapłaty (termin dostawcy, biała lista VAT) i kontrola przelewów ponad 15 000 zł.\n\nPo co: nic nie umyka — ani termin w urzędzie, ani klient, który nie zapłacił, ani przelew na rachunek spoza wykazu."
        case .periods:
            return "Zamknięcie miesiąca po przekazaniu go księgowej: wyciągi, dopasowania i faktury z tego miesiąca nie zmienią się bez śladu. Ponowne otwarcie wymaga uzasadnienia i zostaje w historii.\n\nPo co: księgowa dostaje dane, które później nikt po cichu nie zmieni."
        }
    }
}

/// Lista w części „Terminy i monity”.
enum FinDeadlinesList: String, CaseIterable, Identifiable {
    case obligations, receivables, payables, payments
    var id: String { rawValue }
    var label: String {
        switch self {
        case .obligations: return "ZUS i podatki"
        case .receivables: return "Należności"
        case .payables: return "Do zapłaty"
        case .payments: return "Przelewy ponad 15 000 zł"
        }
    }
}

@MainActor final class FinanceStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var companies: [FinCompany] = []
    @Published private(set) var states: [String: FinState] = [:]
    /// Wybrana działalność; `nil` — pierwsza z listy.
    @Published var companyID: String?
    /// Lista działalności znana (z dysku albo z serwera).
    @Published private(set) var loaded = false
    @Published var loadError: String?
    @Published private(set) var syncing = false
    @Published private(set) var periodsLoading = false
    @Published var part: FinancePart = .center
    @Published var list: FinDeadlinesList = .obligations
    /// Przełączniki prognozy (jak w CRM — nie zapisywane).
    @Published var includeOverdueIn = false
    @Published var includeUnassigned = false

    private struct Disk: Codable {
        var companies: [FinCompany]
        var companyID: String?
        var states: [String: FinState]
    }
    private var namespace: String?
    private var file: SealedFile<Disk>?
    private var syncTask: Task<Void, Never>?
    private var syncedAt: [String: Date] = [:]

    var api: NativeAPI? { workspace?.nativeAPI() }
    var company: FinCompany? {
        if let companyID, let match = companies.first(where: { $0.id == companyID }) { return match }
        return companies.first
    }
    var state: FinState? { company.flatMap { states[$0.id] } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<Disk>(namespace: "finance-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if !loaded, let saved {
                companies = saved.companies
                states = saved.states
                if companyID == nil { companyID = saved.companyID }
                loaded = true
            }
        }
    }

    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); syncTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil
        companies = []; states = [:]; companyID = nil; loaded = false; loadError = nil; syncing = false; periodsLoading = false
        part = .center; list = .obligations; includeOverdueIn = false; includeUnassigned = false; syncedAt = [:]
    }

    private func persist() {
        guard let file else { return }
        let disk = Disk(companies: companies, companyID: companyID, states: states)
        Task.detached(priority: .utility) { try? file.save(disk) }
    }

    // MARK: Synchronizacja
    /// Stan wybranej działalności z serwera. Bez `force` — najwyżej co 5 minut (start aplikacji, powrót do sekcji).
    func sync(force: Bool = false) async {
        if let syncTask {
            await syncTask.value
            if !force { return }
        }
        if !force, let id = company?.id, let last = syncedAt[id], Date().timeIntervalSince(last) < 300 { return }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }

    /// Po uruchomieniu: czeka na kopię z dysku, potem odświeża w tle.
    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        await sync()
    }

    private func performSync() async {
        guard let api else { if !loaded { loadError = "Brak połączenia z serwerem CRM." }; return }
        let owner = workspace?.employee?.id
        let requested = company?.id
        var query: [String: String] = ["op": "state"]
        if let requested { query["company"] = requested }
        if let requested, let year = states[requested]?.periodsYear { query["year"] = String(year) }
        syncing = true
        defer { syncing = false }
        do {
            let reply = try JSONDecoder().decode(FinStateReply.self, from: try await api.get("/finance", query: query))
            guard owner == workspace?.employee?.id else { return }
            companies = reply.companies
            let allowed = Set(reply.companies.map(\.id))
            states = states.filter { allowed.contains($0.key) }
            if let id = reply.company, let next = reply.state {
                states[id] = next
                syncedAt[id] = Date()
                let keep = companyID.map({ allowed.contains($0) }) ?? false
                if !keep { companyID = id }
            } else if reply.companies.isEmpty {
                companyID = nil
            }
            loaded = true
            loadError = nil
            persist()
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if (error as? AppError) == .unauthorized { loadError = failureText(error, "Sesja wygasła."); return }
            if let failure = error as? NativeFailure, failure.status == 403 {
                // Odebrane uprawnienia — kopia tej działalności znika z dysku.
                if let requested { states[requested] = nil; persist() }
            }
            if state == nil { loadError = failureText(error, "Nie udało się wczytać finansów.") }
            else { workspace?.notice = failureText(error, "Nie udało się odświeżyć finansów — pokazuję ostatnią kopię.") }
        }
    }

    /// Zmiana działalności: od razu kopia z dysku (jeśli jest), w tle świeży stan.
    func select(_ id: String) {
        guard id != company?.id else { return }
        companyID = id
        persist()
        Task { await sync(force: states[id] == nil) }
    }

    /// Zamknięcia miesięcy innego roku.
    func loadPeriods(year: Int) async {
        guard let api, let id = company?.id else { return }
        periodsLoading = true
        defer { periodsLoading = false }
        do {
            let reply = try JSONDecoder().decode(FinPeriodsReply.self, from: try await api.get("/finance", query: ["op": "periods", "company": id, "year": String(year)]))
            guard var current = states[id] else { return }
            current.periodsYear = reply.year
            current.periods = reply.periods
            current.periodsError = nil
            states[id] = current
            persist()
        } catch {
            workspace?.error = failureText(error, "Nie udało się wczytać zamknięć miesięcy.")
        }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval? = nil) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/finance", payload, timeout: timeout))) ?? [:]
    }

    /// Zapis z oknem postępu; komunikat sukcesu z serwera, potem świeży stan działalności. Zwraca `true` przy sukcesie.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> Bool {
        guard let workspace else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            await sync(force: true)
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    /// „Sprawdź na białej liście” / „Sprawdź przelewy” — komunikaty jak w CRM.
    func checkWhitelist(_ mode: String, ids: [String]? = nil, force: Bool = false) async {
        guard let workspace, let id = company?.id else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        var body: [String: JSONValue] = ["companyId": .string(id), "mode": .string(mode)]
        if let ids { body["ids"] = .array(ids.map { .string($0) }) }
        if force { body["force"] = .bool(true) }
        do {
            let reply = try await workspace.withPending(mode == "payables" ? "Sprawdzanie faktur na białej liście VAT…" : "Sprawdzanie przelewów na białej liście VAT…") {
                try await post("whitelist", body, timeout: 120)
            }
            let summary = reply["summary"]?.object ?? [:]
            let checked = Int(reply["checked"]?.number ?? 0)
            let bad = Int((summary["not_listed"]?.number ?? 0) + (summary["not_found"]?.number ?? 0))
            let stopped = reply["error"]?.text.nonEmpty
            if checked == 0 && stopped == nil {
                workspace.notice = mode == "payables" ? "Wszystkie faktury do zapłaty były już dziś sprawdzone." : "Brak przelewów do sprawdzenia."
            } else {
                var text = "Sprawdzono \(checked): na liście \(Int(summary["ok"]?.number ?? 0))"
                if bad > 0 { text += ", problem: \(bad)" }
                let noAccount = Int(summary["no_account"]?.number ?? 0)
                if noAccount > 0 { text += ", bez rachunku: \(noAccount)" }
                text += "."
                if bad > 0 { workspace.notice = text } else { workspace.succeed(text) }
            }
            await sync(force: true)
            if let stopped { workspace.notice = stopped }
        } catch {
            workspace.error = failureText(error, "Nie udało się sprawdzić białej listy.")
        }
    }

    /// „Pobierz UPO” — brakujące UPO z KSeF (do 10 na kliknięcie), komunikaty jak w CRM.
    func fetchMissingUpo() async {
        guard let workspace, let id = company?.id else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            let reply = try await workspace.withPending("Pobieranie UPO z KSeF…") { try await post("upoMissing", ["companyId": .string(id)], timeout: 180) }
            var parts = ["Pobrano UPO: \(Int(reply["fetched"]?.number ?? 0))"]
            let remaining = Int(reply["remaining"]?.number ?? 0)
            let unavailable = Int(reply["unavailable"]?.number ?? 0)
            if remaining > 0 { parts.append("do pobrania: \(remaining)") }
            if unavailable > 0 { parts.append("bez sesji w KSeF: \(unavailable)") }
            let failed = Int(reply["failed"]?.number ?? 0)
            let text = parts.joined(separator: ", ") + "."
            if failed > 0 {
                let first = reply["failures"]?.array.first?.object
                let detail = first.map { "\($0["invoice"]?.text ?? ""): \($0["error"]?.text ?? "")" }
                workspace.notice = detail.map { text + " " + $0 } ?? text
            } else {
                workspace.succeed(text)
            }
            await sync(force: true)
        } catch {
            workspace.error = failureText(error, "Nie udało się pobrać UPO z KSeF.")
        }
    }

    // MARK: Przypomnienie o płatności
    func reminderSetup(_ invoiceID: String) async throws -> FinReminderSetup {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(FinReminderSetup.self, from: try await api.get("/finance", query: ["op": "reminder", "invoice": invoiceID]))
    }

    func reminderPreview(_ invoiceID: String, accountId: String, subject: String, text: String, recipientName: String) async throws -> String {
        struct Reply: Decodable { var html: String }
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = [
            "op": .string("reminderPreview"), "invoiceId": .string(invoiceID), "accountId": .string(accountId),
            "subject": .string(subject), "text": .string(text), "recipientName": .string(recipientName),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/finance", body)).html
    }

    func reminderSend(_ invoiceID: String, accountId: String, to: String, cc: String, bcc: String, subject: String, text: String,
                      recipientName: String, scheduledAt: Date?) async throws -> FinReminderResult {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = [
            "op": .string("reminderSend"), "invoiceId": .string(invoiceID), "accountId": .string(accountId), "to": .string(to),
            "cc": .string(cc), "bcc": .string(bcc), "subject": .string(subject), "text": .string(text), "recipientName": .string(recipientName),
        ]
        if let scheduledAt { body["scheduledAt"] = .string(MeetingDates.iso(scheduledAt)) }
        return try JSONDecoder().decode(FinReminderResult.self, from: try await api.post("/finance", body, timeout: 180))
    }

    // MARK: Odnośniki
    /// Adres z danych CRM (`/crm/invoices?tab=…&section=…`, `/crm/invoices/<id>`): terminy i zamknięcia — na Macu, reszta w CRM.
    func open(_ href: String) {
        if href.contains("section=deadlines") { part = .deadlines; return }
        if href.contains("section=accountant") { part = .periods; return }
        workspace?.openCRM(href)
    }
}

extension Workspace {
    /// Finanse (`/crm/invoices`) na wskazanej części; bez dostępu do sekcji w menu — strona CRM.
    func showFinance(_ part: FinancePart, list: FinDeadlinesList? = nil) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/invoices" }) else {
            openCRM(part == .deadlines ? "/crm/invoices?tab=external&section=deadlines" : "/crm/invoices")
            return
        }
        openHref("/crm/invoices")
        finance.part = part
        if let list { finance.list = list }
        Task { await finance.sync() }
    }
}
