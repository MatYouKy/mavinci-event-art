import Foundation
import SwiftUI

// MARK: Finanse — stan sekcji `/crm/invoices` na Macu: działalności z „Podglądem finansów” i stan każdej z nich (Centrum
// finansów, terminy i monity, biała lista, zamknięcia miesięcy) z kopii na dysku (`finance-…`, AES-GCM) — pokazywany od razu,
// odświeżany w tle przez `/bridge/native/v1/finance` (token pracownika). Zapisy jak w panelach CRM, z oknem postępu
// i komunikatem; po zapisie świeży stan z serwera.

/// Części ekranu Finanse (lewa kolumna).
enum FinancePart: String, CaseIterable, Identifiable {
    case center, statements, reconciliation, deadlines, declarations, accountant, periods, invoices, ksef, entries
    var id: String { rawValue }
    var label: String {
        switch self {
        case .center: return "Centrum finansów"
        case .statements: return "Wyciągi"
        case .reconciliation: return "Uzgodnienie wyciągów"
        case .deadlines: return "Terminy i monity"
        case .declarations: return "Deklaracje ZUS i podatki"
        case .accountant: return "Przekazanie księgowej"
        case .periods: return "Zamknięcie miesięcy"
        case .entries: return "Koszty i wypłaty"
        case .invoices: return "Faktury"
        case .ksef: return "KSeF"
        }
    }
    var detail: String {
        switch self {
        case .center: return "Gotówka, należności, podatki, prognoza"
        case .statements: return "PDF i MT940, import, pliki"
        case .reconciliation: return "Operacje ↔ faktury, propozycje"
        case .deadlines: return "Kalendarz, monity, biała lista"
        case .declarations: return "DRA, PIT-4R, VAT-7, CIT-8"
        case .accountant: return "Saldeo, wyciągi, płatności zbiorcze"
        case .periods: return "Blokada miesięcy po przekazaniu"
        case .entries: return "Wypłaty, gotówka, koszty spoza faktur"
        case .invoices: return "Rejestr sprzedaży, pro formy, szkice"
        case .ksef: return "Wystawione i otrzymane, synchronizacja"
        }
    }
    var symbol: String {
        switch self {
        case .center: return "scalemass"
        case .statements: return "building.columns"
        case .reconciliation: return "arrow.left.arrow.right"
        case .deadlines: return "calendar.badge.clock"
        case .declarations: return "doc.plaintext"
        case .accountant: return "paperplane"
        case .periods: return "lock"
        case .entries: return "creditcard"
        case .invoices: return "doc.text"
        case .ksef: return "doc.badge.arrow.up"
        }
    }
    /// Grupa w lewej kolumnie.
    var group: String {
        switch self {
        case .center: return "Przegląd"
        case .statements, .reconciliation: return "Bank"
        case .deadlines, .declarations, .accountant, .periods: return "Podatki i terminy"
        case .entries, .invoices, .ksef: return "Koszty i dokumenty"
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
        case .statements:
            return "Wyciągi rachunku bieżącego i VAT miesiąc po miesiącu: które pliki są wgrane (PDF i MT940), podgląd, pobranie, zmiana nazwy i usunięcie pliku bez powiązań. Import nowego wyciągu sprawdza okres, saldo i numer rachunku, a potem uzgadnia miesiąc.\n\nPo co: komplet wyciągów to podstawa uzgodnienia, gotówki i prognozy."
        case .reconciliation:
            return "Każda operacja z wyciągu ma jeden stan: rozliczona, wyjaśniona, propozycja, do wyboru, częściowo albo brak dokumentu. Pewne dopasowania robi system, resztę zatwierdzasz albo rozliczasz ręcznie: dokument, wyjaśnienie bez faktury, deklaracja, umowa stała, para płatność + zwrot.\n\nPo co: płatności faktur, ZUS i podatków są potwierdzone wyciągiem, a księgowa dostaje listę braków."
        case .invoices:
            return "Rejestr sprzedaży: faktury lokalne i wystawione w KSeF, pro formy i szkice wybranych działalności — z sumami, filtrami i kartą faktury (strony, pozycje, zapłata, KSeF, powiązane dokumenty). Z karty: podgląd PDF, oznaczenie jako wysłanej lub opłaconej, anulowanie, usunięcie szkicu. Wystawianie, edycja, korekta, e-mail i wysyłka do KSeF — w CRM.\n\nPo co: widzisz każdą fakturę i jej stan bez szukania po zakładkach."
        case .accountant:
            return "Paczka miesiąca dla księgowej: do Saldeo wyłącznie dokumenty spoza KSeF (z istniejącym opisem na kopii PDF), do księgowej oryginalne wyciągi i opisy płatności zbiorczych. Najpierw plik kontrolny (plan wysyłki i dokładne załączniki), potem akceptacja i zapis paczki ZIP albo wysyłka jednym przyciskiem; braki dokumentów zostają w CRM na liście „Do dosłania”. Wysyłkę przygotowuje administrator CRM.\n\nPo co: księgowa dostaje komplet bez duplikatów faktur KSeF, a każda wysyłka jest sprawdzona i zapisana w historii."
        case .ksef:
            return "Faktury pobrane z KSeF wybranej działalności — wystawione i otrzymane — ze stanem zapłaty, terminem, wpłatami i uwagami do płatności. Synchronizacja za wybrany zakres dat pobiera nowe faktury (już pobrane pomija), a dziennik pokazuje jej przebieg i błędy. Wpłaty z wyciągów przypisuje uzgadnianie; tu dodasz wpłatę ręczną, ustawisz termin, oznaczysz fakturę jako opłaconą albo nieopłaconą i zamkniesz uwagę. Konfiguracja KSeF (certyfikat, token) — w CRM.\n\nPo co: faktury z KSeF i ich zapłata w jednym miejscu, bez szukania po zakładkach."
        case .entries:
            return "Ręczne zapisy kosztów, których nie ma w KSeF ani na fakturach: wynagrodzenia i wypłaty, podwykonawcy, zakupy, zwroty kosztów, gotówka. Zapłacone i poniesione liczą się do wyniku, planowane — nie.\n\nPo co: raporty i wynik obejmują też koszty bez faktury."
        case .declarations:
            return "Rejestr deklaracji (DRA, PIT-4R, VAT-7, CIT-8) z kwotą do zapłaty, plikami i rozbiciem na pracowników. Przelewy z okresem w tytule przypisują się przy uzgadnianiu wyciągu — tu widać niedopłatę, nadpłatę albo brak przelewu.\n\nPo co: kwota z deklaracji i przelew z banku zgadzają się co do grosza."
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
    /// Działalności z „Podglądem finansów” (firmy z NIP; marki bez NIP — np. Event Rulers — pomija serwer).
    @Published private(set) var companies: [FinCompany] = []
    @Published private(set) var states: [String: FinState] = [:]
    /// Filtr działalności jak w CRM: wybrane działalności; pusty — wszystkie.
    @Published private(set) var selectedIDs: Set<String> = []
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
    /// Wyciągi, uzgodnienie i deklaracje (`/bridge/native/v1/finance/bank`).
    lazy var bank: FinanceBankStore = {
        let store = FinanceBankStore()
        store.finance = self
        return store
    }()
    /// Przekazanie księgowej — Saldeo (`/bridge/native/v1/finance/saldeo`).
    lazy var saldeo: FinanceSaldeoStore = {
        let store = FinanceSaldeoStore()
        store.finance = self
        return store
    }()

    private struct Disk: Codable {
        var companies: [FinCompany]
        var selectedIDs: [String]?
        var selectionInitialized: Bool?
        var states: [String: FinState]
    }
    private var namespace: String?
    private var file: SealedFile<Disk>?
    private var syncTask: Task<Void, Never>?
    private var syncedAt: [String: Date] = [:]
    /// Pierwszy wybór (domyślna działalność) zrobiony — później wybór pracownika jest zapamiętany.
    private var selectionInitialized = false

    var api: NativeAPI? { workspace?.nativeAPI() }

    /// Wybrane działalności w kolejności listy (pusty wybór albo nieaktualny — wszystkie).
    var scopeCompanies: [FinCompany] {
        let picked = companies.filter { selectedIDs.contains($0.id) }
        return picked.isEmpty ? companies : picked
    }
    var allSelected: Bool { scopeCompanies.count == companies.count }
    /// Wybrane działalności z wczytanym stanem.
    var scope: FinScope {
        FinScope(entries: scopeCompanies.compactMap { company in states[company.id].map { FinCompanyState(company: company, state: $0) } })
    }
    var scopeTitle: String {
        let picked = scopeCompanies
        if picked.count == 1 { return picked[0].name }
        if allSelected { return "Wszystkie działalności" }
        return "\(picked.count) działalności"
    }
    func company(_ id: String?) -> FinCompany? { companies.first { $0.id == id } }
    func isSelected(_ id: String) -> Bool { scopeCompanies.contains { $0.id == id } }
    /// Najstarsze z pobrań wybranych działalności (opis „pobrano” w nagłówku).
    var loadedAt: String? { scopeCompanies.compactMap { states[$0.id]?.loadedAt }.min() }

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
                selectedIDs = Set(saved.selectedIDs ?? [])
                selectionInitialized = saved.selectionInitialized ?? false
                loaded = true
            }
        }
    }

    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); syncTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil
        companies = []; states = [:]; selectedIDs = []; selectionInitialized = false; loaded = false; loadError = nil
        syncing = false; periodsLoading = false
        part = .center; list = .obligations; includeOverdueIn = false; includeUnassigned = false; syncedAt = [:]
        bank.reset()
        saldeo.reset()
    }

    private func persist() {
        guard let file else { return }
        let disk = Disk(companies: companies, selectedIDs: Array(selectedIDs), selectionInitialized: selectionInitialized, states: states)
        Task.detached(priority: .utility) { try? file.save(disk) }
    }

    // MARK: Filtr działalności
    /// Zaznaczenie / odznaczenie działalności; wszystkie albo żadna — „Wszystkie działalności”.
    func toggle(_ id: String) {
        var next = Set(scopeCompanies.map(\.id))
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        if next.isEmpty || next.count == companies.count { next = [] }
        selectedIDs = next
        selectionInitialized = true
        persist()
        Task { await sync() }
    }

    func selectAll() {
        selectedIDs = []
        selectionInitialized = true
        persist()
        Task { await sync() }
    }

    func selectOnly(_ id: String) {
        selectedIDs = companies.count > 1 ? [id] : []
        selectionInitialized = true
        persist()
        Task { await sync() }
    }

    // MARK: Synchronizacja
    /// Stan wybranych działalności z serwera. Bez `force` — każda najwyżej co 5 minut (start aplikacji, powrót do sekcji).
    func sync(force: Bool = false) async {
        if let syncTask {
            await syncTask.value
            if !force && scopeCompanies.allSatisfy({ states[$0.id] != nil }) { return }
        }
        let task = Task { await performSync(force: force) }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }

    /// Po uruchomieniu: czeka na kopię z dysku, potem odświeża w tle.
    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        await sync()
    }

    private func fetchState(_ api: NativeAPI, company: String?) async throws -> FinStateReply {
        var query: [String: String] = ["op": "state"]
        if let company {
            query["company"] = company
            if let year = states[company]?.periodsYear { query["year"] = String(year) }
        }
        return try JSONDecoder().decode(FinStateReply.self, from: try await api.get("/finance", query: query))
    }

    private func stale(_ id: String) -> Bool {
        guard let last = syncedAt[id] else { return true }
        return Date().timeIntervalSince(last) >= 300
    }

    private func performSync(force: Bool) async {
        guard let api else { if !loaded { loadError = "Brak połączenia z serwerem CRM." }; return }
        let owner = workspace?.employee?.id
        syncing = true
        defer { syncing = false }
        var failure: Error?
        // Bez listy działalności — najpierw lista (i stan pierwszej działalności), potem wybrane.
        if companies.isEmpty {
            do {
                let reply = try await fetchState(api, company: nil)
                guard owner == workspace?.employee?.id else { return }
                apply(reply)
            } catch {
                guard owner == workspace?.employee?.id else { return }
                failure = error
            }
        }
        let targets = scopeCompanies.map(\.id).filter { force || states[$0] == nil || stale($0) }
        // Zapytania o kilka działalności naraz.
        let requests: [(String, Task<FinStateReply, Error>)] = targets.map { id in (id, Task { try await self.fetchState(api, company: id) }) }
        for (id, request) in requests {
            do {
                let reply = try await request.value
                guard owner == workspace?.employee?.id else { return }
                apply(reply)
            } catch {
                guard owner == workspace?.employee?.id else { return }
                if let failed = error as? NativeFailure, failed.status == 403 { states[id] = nil }
                failure = error
            }
        }
        if let failure {
            if (failure as? AppError) == .unauthorized { loadError = failureText(failure, "Sesja wygasła."); return }
            if scope.entries.isEmpty { loadError = failureText(failure, "Nie udało się wczytać finansów.") }
            else { workspace?.notice = failureText(failure, "Nie udało się odświeżyć finansów — pokazuję ostatnią kopię.") }
        } else {
            loadError = nil
        }
        persist()
    }

    /// Odpowiedź serwera: lista działalności (bez odebranych — także w kopii i filtrze), stan działalności i pierwszy wybór.
    private func apply(_ reply: FinStateReply) {
        companies = reply.companies
        let allowed = Set(reply.companies.map(\.id))
        states = states.filter { allowed.contains($0.key) }
        selectedIDs = selectedIDs.filter { allowed.contains($0) }
        if let id = reply.company, let next = reply.state {
            states[id] = next
            syncedAt[id] = Date()
        }
        if !selectionInitialized, !companies.isEmpty {
            // Jak w CRM: na początek domyślna działalność.
            let preferred = companies.first { $0.isDefault == true } ?? companies[0]
            selectedIDs = companies.count > 1 ? [preferred.id] : []
            selectionInitialized = true
        }
        loaded = true
    }

    /// Zamknięcia miesięcy innego roku (dla wybranych działalności).
    func loadPeriods(year: Int) async {
        guard let api else { return }
        periodsLoading = true
        defer { periodsLoading = false }
        for company in scopeCompanies {
            do {
                let reply = try JSONDecoder().decode(FinPeriodsReply.self, from: try await api.get("/finance", query: ["op": "periods", "company": company.id, "year": String(year)]))
                guard var current = states[company.id] else { continue }
                current.periodsYear = reply.year
                current.periods = reply.periods
                current.periodsError = nil
                states[company.id] = current
            } catch {
                workspace?.error = failureText(error, "Nie udało się wczytać zamknięć miesięcy.")
            }
        }
        persist()
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

    /// „Sprawdź na białej liście” / „Sprawdź przelewy” — dla wybranych działalności (albo wskazanej przy jednej pozycji),
    /// komunikaty jak w CRM, zsumowane dla działalności.
    func checkWhitelist(_ mode: String, company: String? = nil, ids: [String]? = nil, force: Bool = false) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        let targets = company.map { [$0] } ?? scopeCompanies.map(\.id)
        var checked = 0
        var ok = 0
        var bad = 0
        var noAccount = 0
        var stopped: [String] = []
        var failed: String?
        await workspace.withPending(mode == "payables" ? "Sprawdzanie faktur na białej liście VAT…" : "Sprawdzanie przelewów na białej liście VAT…") {
            for id in targets {
                var body: [String: JSONValue] = ["companyId": .string(id), "mode": .string(mode)]
                if let ids { body["ids"] = .array(ids.map { .string($0) }) }
                if force { body["force"] = .bool(true) }
                do {
                    let reply = try await post("whitelist", body, timeout: 120)
                    let summary = reply["summary"]?.object ?? [:]
                    checked += Int(reply["checked"]?.number ?? 0)
                    ok += Int(summary["ok"]?.number ?? 0)
                    bad += Int((summary["not_listed"]?.number ?? 0) + (summary["not_found"]?.number ?? 0))
                    noAccount += Int(summary["no_account"]?.number ?? 0)
                    if let message = reply["error"]?.text.nonEmpty { stopped.append(message) }
                } catch {
                    failed = failureText(error, "Nie udało się sprawdzić białej listy.")
                    break
                }
            }
        }
        if checked == 0 && stopped.isEmpty && failed == nil {
            workspace.notice = mode == "payables" ? "Wszystkie faktury do zapłaty były już dziś sprawdzone." : "Brak przelewów do sprawdzenia."
        } else if checked > 0 {
            var text = "Sprawdzono \(checked): na liście \(ok)"
            if bad > 0 { text += ", problem: \(bad)" }
            if noAccount > 0 { text += ", bez rachunku: \(noAccount)" }
            text += "."
            if bad > 0 { workspace.notice = text } else { workspace.succeed(text) }
        }
        await sync(force: true)
        if let failed { workspace.error = failed }
        else if let message = stopped.first { workspace.notice = message }
    }

    /// „Pobierz UPO” — brakujące UPO działalności z KSeF (do 10 na kliknięcie), komunikaty jak w CRM.
    func fetchMissingUpo(company id: String) async {
        guard let workspace else { return }
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
    /// Adres z danych CRM (`/crm/invoices?tab=…&section=…`, `/crm/invoices/<id>`): części z ekranem natywnym — na Macu,
    /// reszta w CRM.
    func open(_ href: String) {
        if href.contains("section=deadlines") { part = .deadlines; return }
        if href.contains("section=accountant") { part = .accountant; return }
        if href.contains("section=reconciliation") || href.contains("section=control") { part = .reconciliation; return }
        if href.contains("section=statements") { part = .statements; return }
        if href.contains("section=declarations") { part = .declarations; return }
        if href.contains("tab=expenses") { part = .entries; return }
        if href.contains("tab=local") { part = .invoices; return }
        if href.contains("tab=ksef") { part = .ksef; return }
        if let range = href.range(of: "/crm/invoices/"), !href.contains("/crm/invoices/new") {
            let id = String(href[range.upperBound...].prefix(36))
            if id.count == 36, !id.contains("/") { part = .invoices; bank.selectedInvoice = id; return }
        }
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
