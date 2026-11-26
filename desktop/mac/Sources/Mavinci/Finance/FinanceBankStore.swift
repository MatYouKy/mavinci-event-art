import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Bank i deklaracje na Macu — stan ekranów „Wyciągi”, „Uzgodnienie wyciągów” i „ZUS i podatki — deklaracje”
// (`/bridge/native/v1/finance/bank`, token pracownika), a także faktur, KSeF oraz kosztów i wypłat (`/bridge/native/v1/finance`).
// Dane trzymane w pamięci na czas pracy (wczytywane przy wejściu na ekran i po każdej zmianie); zapisy z oknem postępu
// i komunikatem jak w CRM, potem świeży stan z serwera.

/// Podgląd dokumentu: plik (PDF, obraz) albo faktura KSeF z danych XML.
enum BankPreviewItem: Identifiable {
    case file(BankFile)
    case ksef(KsefPreview)
    var id: String {
        switch self {
        case .file(let file): return file.id.uuidString
        case .ksef(let invoice): return "ksef:\(invoice.id)"
        }
    }
}

@MainActor final class FinanceBankStore: ObservableObject {
    weak var finance: FinanceStore?
    var workspace: Workspace? { finance?.workspace }
    var api: NativeAPI? { workspace?.nativeAPI() }

    /// Działalność ekranów banku (jedna — uzgodnienie, wyciągi i deklaracje dotyczą jednego podatnika).
    @Published var companyID: String?

    // Uzgodnienie
    @Published private(set) var periods: [BankPeriod] = []
    @Published private(set) var periodsLoaded = false
    @Published private(set) var periodsLoading = false
    @Published var period: BankPeriod?
    @Published private(set) var months: [String: BankMonth] = [:]
    @Published private(set) var monthLoading = false
    @Published var monthError: String?
    @Published var statusFilter = "todo"
    @Published var accountFilter = "all"
    @Published var search = ""
    @Published var selectedTx: String?
    /// Wybór dokumentu w propozycji „do wyboru” (id propozycji → indeks dokumentu).
    @Published var choice: [String: Int] = [:]

    // Wyciągi
    @Published var statementsYear = Calendar.current.component(.year, from: Date())
    @Published private(set) var statementLists: [String: BankStatementsReply] = [:]
    @Published private(set) var statementsLoading = false
    @Published var statementsError: String?
    @Published var statementMonth: Int?

    // Deklaracje
    @Published var declarationsYear = Calendar.current.component(.year, from: Date())
    @Published var declarationKind = "all"
    @Published private(set) var declarationLists: [String: FinDeclarationsReply] = [:]
    @Published private(set) var declarationsLoading = false
    @Published var declarationsError: String?
    @Published var openDeclaration: String?

    // Faktury (rejestr sprzedaży)
    @Published private(set) var invoices: FinInvoicesReply?
    @Published private(set) var invoicesLoading = false
    @Published var invoicesError: String?
    @Published var selectedInvoice: String?

    // Koszty i wypłaty
    @Published private(set) var entries: FinEntriesReply?
    @Published private(set) var entriesLoading = false
    @Published var entriesError: String?

    // KSeF (faktury pobrane z KSeF, osobno dla każdej działalności)
    @Published private(set) var ksefCompanies: FinKsefCompaniesReply?
    @Published var ksefError: String?
    @Published var ksefCompanyID: String?
    @Published private(set) var ksefLists: [String: FinKsefInvoicesReply] = [:]
    @Published private(set) var ksefLoading = false
    @Published var ksefListError: String?

    // MARK: Działalność
    /// Działalności dostępne na ekranach banku — wybrane w filtrze Finansów.
    var companies: [FinCompany] { finance?.scopeCompanies ?? [] }
    var company: FinCompany? {
        let list = companies
        return list.first { $0.id == companyID } ?? list.first
    }
    func selectCompany(_ id: String) {
        guard companyID != id else { return }
        companyID = id
        selectedTx = nil
        period = periods.first { $0.companyId == id }
        openDeclaration = nil
        statementMonth = nil
    }

    // MARK: Przejścia z „Terminów i monitów” (działalność pozycji i właściwy miesiąc / rok)

    /// Uzgodnienie miesiąca: operacje do zrobienia bez filtrów. Bez wyciągu za ten miesiąc — ekran wyciągów z komunikatem.
    func openReconciliation(company: String, year: Int, month: Int) async {
        selectCompany(company)
        if !periodsLoaded { await loadPeriods() }
        statusFilter = "todo"
        accountFilter = "all"
        search = ""
        selectedTx = nil
        let target = BankPeriod(companyId: company, year: year, month: month)
        if periods.contains(target) {
            period = target
            finance?.part = .reconciliation
        } else {
            openStatements(company: company, year: year, month: month)
            workspace?.notice = "Brak wczytanego wyciągu za \(FinFormat.months[max(0, min(11, month - 1))]) \(year) — wczytaj go, a uzgodnienie samo dopasuje płatności."
        }
    }

    /// Wyciągi działalności za rok (z zaznaczonym miesiącem).
    func openStatements(company: String, year: Int, month: Int?) {
        selectCompany(company)
        statementsYear = year
        statementMonth = month
        finance?.part = .statements
    }

    /// Rejestr deklaracji działalności za rok, zawężony do rodzaju (ZUS, PIT, VAT, CIT).
    func openDeclarations(company: String, year: Int, kind: String) {
        selectCompany(company)
        declarationsYear = year
        declarationKind = DeclarationKinds.all.contains(where: { $0.0 == kind }) ? kind : "all"
        openDeclaration = nil
        finance?.part = .declarations
    }

    func reset() {
        companyID = nil
        periods = []; periodsLoaded = false; periodsLoading = false; period = nil
        months = [:]; monthLoading = false; monthError = nil
        statusFilter = "todo"; accountFilter = "all"; search = ""; selectedTx = nil; choice = [:]
        statementLists = [:]; statementsLoading = false; statementsError = nil; statementMonth = nil
        declarationLists = [:]; declarationsLoading = false; declarationsError = nil; openDeclaration = nil; declarationKind = "all"
        entries = nil; entriesLoading = false; entriesError = nil
        invoices = nil; invoicesLoading = false; invoicesError = nil; selectedInvoice = nil
        ksefCompanies = nil; ksefError = nil; ksefCompanyID = nil; ksefLists = [:]; ksefLoading = false; ksefListError = nil
        let year = Calendar.current.component(.year, from: Date())
        statementsYear = year
        declarationsYear = year
    }

    // MARK: Połączenie
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func get<T: Decodable>(_ query: [String: String], as type: T.Type = T.self) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/finance/bank", query: query))
    }

    @discardableResult func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval? = nil) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: try await api.post("/finance/bank", payload, timeout: timeout))) ?? [:]
    }

    /// Plik do serwera (multipart, pole „file”) z polami formularza — import wyciągu, plik deklaracji, dokument wyjaśnienia.
    func upload(_ op: String, fields: [String: String], file: URL?, limit: Int) async throws -> [String: JSONValue] {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/finance/bank?op=\(op)") else {
            throw AppError.configuration
        }
        let boundary = "mavinci-\(UUID().uuidString)"
        var body = Data()
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        if let file {
            let access = file.startAccessingSecurityScopedResource()
            defer { if access { file.stopAccessingSecurityScopedResource() } }
            let content = try Data(contentsOf: file)
            guard content.count <= limit else {
                throw NativeFailure(status: 400, message: "Plik „\(file.lastPathComponent)” jest większy niż \(limit / 1024 / 1024) MB.", fieldErrors: [:])
            }
            let name = file.lastPathComponent.replacingOccurrences(of: "\"", with: "")
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(Self.mime(file))\r\n\r\n".utf8))
            body.append(content)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się przesłać pliku.", fieldErrors: [:])
        }
        return object
    }

    static func mime(_ file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "pdf": return "application/pdf"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "xml": return "application/xml"
        case "zip": return "application/zip"
        case "txt", "sta", "mt940": return "text/plain"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    /// Wybór pliku z dysku (Finder); `types` — rozszerzenia.
    static func pickFile(_ title: String, types: [String]) -> URL? {
        let panel = NSOpenPanel()
        panel.title = title
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = types.compactMap { UTType(filenameExtension: $0) }
        return panel.runModal() == .OK ? panel.url : nil
    }

    /// Zapis z oknem postępu; komunikat serwera (sukces albo ostrzeżenie); `true` przy sukcesie.
    /// Tekst trwającej czynności banku — arkusze (`BankSheetFrame`) pokazują go nad sobą; wskaźnik okna głównego
    /// (`Workspace.pending`) jest pod otwartym arkuszem.
    @Published private(set) var busy: String?

    /// `Workspace.withPending` i ten sam tekst w `busy` (wskaźnik w otwartym arkuszu).
    func withBusy<T>(_ workspace: Workspace, _ text: String, _ work: () async throws -> T) async rethrows -> T {
        busy = text
        defer { busy = nil }
        return try await workspace.withPending(text, work)
    }

    @discardableResult func act(_ pending: String, _ op: String, _ body: [String: JSONValue], timeout: TimeInterval? = nil) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await withBusy(workspace, pending) { try await post(op, body, timeout: timeout) }
            announce(reply)
            return reply
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się.")
            return nil
        }
    }

    func announce(_ reply: [String: JSONValue]) {
        guard let message = reply["message"]?.text.nonEmpty else { return }
        if reply["tone"]?.text == "warning" { workspace?.notice = message } else { workspace?.succeed(message) }
    }

    // MARK: Uzgodnienie
    var companyPeriods: [BankPeriod] {
        guard let id = company?.id else { return [] }
        return periods.filter { $0.companyId == id }
    }
    var month: BankMonth? { period.flatMap { months[$0.id] } }

    func loadPeriods() async {
        guard !periodsLoading else { return }
        periodsLoading = true
        defer { periodsLoading = false }
        do {
            let reply = try await get(["op": "periods"], as: BankPeriodsReply.self)
            periods = reply.periods
            periodsLoaded = true
            let list = companyPeriods
            if let current = period, list.contains(current) { return }
            period = list.first
        } catch {
            monthError = failureText(error, "Nie udało się wczytać listy wyciągów.")
        }
    }

    /// Uzgodnienie wybranego miesiąca (bez `force` — z pamięci, gdy już wczytane).
    func loadMonth(force: Bool = false) async {
        guard let period else { return }
        if !force, months[period.id] != nil { return }
        monthLoading = true
        defer { monthLoading = false }
        do {
            let reply = try await get(["op": "month", "company": period.companyId, "year": String(period.year), "month": String(period.month)], as: BankMonth.self)
            months[period.id] = reply
            monthError = nil
            // Przy wyborze spośród kilku dokumentów — wskazany przez bazę (np. ręczna płatność z dnia przelewu).
            for transaction in reply.transactions {
                guard let proposal = transaction.proposal, proposal.kind == "choose", choice[proposal.id] == nil,
                      let index = proposal.documents.firstIndex(where: \.suggested) else { continue }
                choice[proposal.id] = index
            }
            if let selected = selectedTx, !reply.transactions.contains(where: { $0.id == selected }) { selectedTx = nil }
        } catch {
            monthError = failureText(error, "Nie udało się wczytać uzgodnienia.")
        }
    }

    func step(_ offset: Int) {
        let list = companyPeriods
        guard let current = period, let index = list.firstIndex(of: current) else { return }
        let next = index + offset
        guard list.indices.contains(next) else { return }
        period = list[next]
        selectedTx = nil
    }

    /// Czynność na operacji / miesiącu, potem świeże uzgodnienie (i deklaracje, gdy dotyczy).
    @discardableResult func reconcileAction(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> Bool {
        let reply = await act(pending, op, body, timeout: 180)
        guard reply != nil else { return false }
        await loadMonth(force: true)
        invalidateDeclarations()
        return true
    }

    func runReconciliation() async {
        guard let period else { return }
        await reconcileAction("Uzgadnianie wyciągu…", "run", ["companyId": .string(period.companyId), "year": .number(Double(period.year)), "month": .number(Double(period.month))])
    }

    func accept(_ tx: BankTx) async {
        guard let proposal = tx.proposal else { return }
        var body: [String: JSONValue] = ["transactionId": .string(tx.id), "proposalId": .string(proposal.id), "rule": .string(proposal.rule)]
        if proposal.kind == "choose" {
            guard let index = choice[proposal.id] else { workspace?.notice = "Wybierz jeden dokument z listy."; return }
            body["index"] = .number(Double(index))
        } else {
            body["index"] = .null
        }
        await reconcileAction("Zatwierdzanie propozycji…", "accept", body)
    }

    @discardableResult func reject(_ tx: BankTx) async -> Bool {
        guard let proposal = tx.proposal else { return false }
        return await reconcileAction("Odrzucanie propozycji…", "reject", ["transactionId": .string(tx.id), "proposalId": .string(proposal.id), "rule": .string(proposal.rule)])
    }

    func undo(_ tx: BankTx, kind: String, id: String?) async {
        var body: [String: JSONValue] = ["transactionId": .string(tx.id), "kind": .string(kind)]
        if let id { body["id"] = .string(id) }
        await reconcileAction("Cofanie…", "undo", body)
    }

    /// Lista dla księgowej: operacje bez dokumentu (jak „Braki dokumentów (CSV)” w CRM) — plik w Pobranych.
    func exportMissing() {
        guard let month else { return }
        let open = month.transactions.filter(\.isOpen)
        guard !open.isEmpty else { workspace?.succeed("Wszystkie operacje są rozliczone lub wyjaśnione."); return }
        func escape(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        func amount(_ value: Double) -> String { String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",") }
        var lines = [["Data", "Rachunek", "Kierunek", "Kontrahent", "Tytuł", "Kwota", "Pozostało", "Waluta", "Status", "Wskazówka"].map(escape).joined(separator: ";")]
        for t in open {
            lines.append([
                t.date, t.accountKind == "vat" ? "VAT" : "bieżący", t.credit ? "Wpływ" : "Wydatek", t.counterparty ?? "", t.title ?? "",
                amount(t.amount), amount(t.remaining), t.currency, BankStatus.label(t.status), t.proposal?.reason ?? "",
            ].map(escape).joined(separator: ";"))
        }
        let name = "braki-dokumentow-\(month.year)-\(String(format: "%02d", month.month)).csv"
        do {
            _ = try ContractFiles.saveToDownloads(Data(("\u{FEFF}" + lines.joined(separator: "\n")).utf8), name: name)
            workspace?.succeed("Zapisano „\(name)” w Pobranych.")
        } catch {
            workspace?.error = "Nie udało się zapisać pliku CSV."
        }
    }

    // MARK: Wyciągi
    private func statementsKey(_ company: String, _ year: Int) -> String { "\(company):\(year)" }
    var statementList: BankStatementsReply? { company.flatMap { statementLists[statementsKey($0.id, statementsYear)] } }

    func loadStatements(force: Bool = false) async {
        guard let company else { return }
        let key = statementsKey(company.id, statementsYear)
        if !force, statementLists[key] != nil { return }
        statementsLoading = true
        defer { statementsLoading = false }
        do {
            statementLists[key] = try await get(["op": "statements", "company": company.id, "year": String(statementsYear)], as: BankStatementsReply.self)
            statementsError = nil
        } catch {
            statementsError = failureText(error, "Nie udało się wczytać wyciągów.")
        }
    }

    /// Po zmianie wyciągów: listy plików, okresy i miesiące uzgodnienia do ponownego wczytania.
    func invalidateStatements(company: String) {
        statementLists = statementLists.filter { !$0.key.hasPrefix(company + ":") }
        months = months.filter { !$0.key.hasPrefix(company + ":") }
        periodsLoaded = false
    }

    /// Import wyciągu (PDF albo MT940). Gdy numer rachunku wymaga potwierdzenia — pytanie i ponowne wysłanie.
    func importStatement(company: String, year: Int, month: Int, accountType: String, format: String, file: URL, confirmed: Bool = false) async -> (done: Bool, question: (title: String, text: String, confirm: String)?) {
        guard let workspace else { return (false, nil) }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return (false, nil) }
        let fields = [
            "companyId": company, "year": String(year), "month": String(month), "accountType": accountType, "format": format,
            "confirmAccount": confirmed ? "true" : "false",
        ]
        do {
            let reply = try await withBusy(workspace, "Import wyciągu — odczyt, zapis operacji i uzgodnienie…") {
                try await upload("statementImport", fields: fields, file: file, limit: 10 * 1024 * 1024)
            }
            if reply["needsConfirmation"]?.flag == true {
                return (false, (reply["title"]?.text ?? "Sprawdź numer rachunku", reply["question"]?.text ?? "", reply["confirm"]?.text ?? "Importuj"))
            }
            announce(reply)
            invalidateStatements(company: company)
            statementsYear = year
            statementMonth = month
            await loadStatements(force: true)
            return (true, nil)
        } catch {
            workspace.error = failureText(error, "Błąd podczas importu wyciągu.")
            return (false, nil)
        }
    }

    func renameStatement(_ statement: BankStatementFile, to name: String) async {
        guard let company = company?.id else { return }
        guard await act("Zmiana nazwy…", "statementRename", ["id": .string(statement.id), "name": .string(name)]) != nil else { return }
        invalidateStatements(company: company)
        await loadStatements(force: true)
    }

    /// Sprawdzenie przed usunięciem — zwraca pytanie do potwierdzenia albo pokazuje powód blokady.
    func checkRemoval(_ statement: BankStatementFile) async -> String? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await withBusy(workspace, "Sprawdzanie powiązań wyciągu…") { try await post("statementCheck", ["id": .string(statement.id)], timeout: 120) }
            return reply["question"]?.text.nonEmpty
        } catch {
            workspace.error = failureText(error, "Nie można usunąć tego wyciągu.")
            return nil
        }
    }

    func deleteStatement(_ statement: BankStatementFile) async {
        guard let company = company?.id else { return }
        guard await act("Usuwanie pliku wyciągu…", "statementDelete", ["id": .string(statement.id)], timeout: 120) != nil else { return }
        invalidateStatements(company: company)
        await loadStatements(force: true)
    }

    // MARK: Pliki i podgląd
    private func decodeFile(_ payload: BankFilePayload) -> BankFile? {
        guard let raw = payload.data, let data = Data(base64Encoded: raw) else { return nil }
        return BankFile(name: payload.name ?? "plik", mime: payload.mime ?? "application/octet-stream", data: data)
    }

    /// Plik z magazynu (wyciąg, plik deklaracji, dokument wyjaśnienia).
    func file(kind: String, id: String) async -> BankFile? {
        guard let workspace else { return nil }
        do {
            let payload: BankFilePayload = try await withBusy(workspace, "Pobieranie pliku…") { try await get(["op": "file", "kind": kind, "id": id], as: BankFilePayload.self) }
            guard let file = decodeFile(payload) else { workspace.error = "Nie udało się odczytać pliku."; return nil }
            return file
        } catch {
            workspace.error = failureText(error, "Nie udało się pobrać pliku.")
            return nil
        }
    }

    /// Podgląd dokumentu rozliczenia (faktura CRM — PDF, spoza KSeF — wgrany plik, KSeF — dane z XML).
    func preview(source: String, id: String) async -> BankPreviewItem? {
        guard let workspace else { return nil }
        do {
            let payload: BankFilePayload = try await withBusy(workspace, "Otwieranie dokumentu…") { try await get(["op": "document", "source": source, "id": id], as: BankFilePayload.self) }
            if let invoice = payload.invoice { return .ksef(invoice) }
            guard let file = decodeFile(payload) else { workspace.error = "Nie udało się odczytać dokumentu."; return nil }
            return show(file)
        } catch {
            workspace.error = failureText(error, "Nie udało się otworzyć dokumentu.")
            return nil
        }
    }

    /// PDF i obrazy — podgląd w aplikacji; inne pliki (MT940, XML, ZIP) — od razu do Pobranych.
    func show(_ file: BankFile) -> BankPreviewItem? {
        if file.mime == "application/pdf" || file.mime.hasPrefix("image/") { return .file(file) }
        save(file)
        return nil
    }

    func save(_ file: BankFile) {
        do {
            _ = try ContractFiles.saveToDownloads(file.data, name: file.name)
            workspace?.succeed("Zapisano „\(file.name)” w Pobranych.")
        } catch {
            workspace?.error = "Nie udało się zapisać pliku w Pobranych."
        }
    }

    // MARK: Deklaracje
    private func declarationsKey(_ company: String, _ year: Int) -> String { "\(company):\(year)" }
    var declarationList: FinDeclarationsReply? { company.flatMap { declarationLists[declarationsKey($0.id, declarationsYear)] } }

    func loadDeclarations(force: Bool = false) async {
        guard let company else { return }
        let key = declarationsKey(company.id, declarationsYear)
        if !force, declarationLists[key] != nil { return }
        declarationsLoading = true
        defer { declarationsLoading = false }
        do {
            declarationLists[key] = try await get(["op": "declarations", "company": company.id, "years": String(declarationsYear)], as: FinDeclarationsReply.self)
            declarationsError = nil
        } catch {
            declarationsError = failureText(error, "Nie udało się wczytać deklaracji.")
        }
    }

    func invalidateDeclarations() {
        declarationLists = [:]
    }

    /// Zapis w rejestrze deklaracji, potem świeża lista (i uzgodnienie — przelewy i stany deklaracji).
    @discardableResult func declarationAction(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> [String: JSONValue]? {
        guard let reply = await act(pending, op, body) else { return nil }
        invalidateDeclarations()
        // Stany deklaracji są też w uzgodnieniu: otwarty miesiąc — od razu świeży, pozostałe — przy następnym otwarciu.
        if finance?.part == .reconciliation, let current = period {
            months = months.filter { $0.key == current.id }
            await loadMonth(force: true)
        } else {
            months = [:]
        }
        await loadDeclarations(force: true)
        return reply
    }

    // MARK: Koszty i wypłaty (`/bridge/native/v1/finance`, op=entries | entrySave | entryDelete)
    func loadEntries(force: Bool = false) async {
        guard let api else { return }
        if !force, entries != nil { return }
        entriesLoading = true
        defer { entriesLoading = false }
        do {
            entries = try JSONDecoder().decode(FinEntriesReply.self, from: try await api.get("/finance", query: ["op": "entries"]))
            entriesError = nil
        } catch {
            entriesError = failureText(error, "Nie udało się pobrać kosztów i wypłat.")
        }
    }

    /// Zapis kosztu / usunięcie (trasa `/finance`), komunikat jak w CRM, potem świeża lista.
    @discardableResult func entryAction(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            var payload = body
            payload["op"] = .string(op)
            let data = try await withBusy(workspace, pending) { try await api.post("/finance", payload) }
            announce((try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:])
            await loadEntries(force: true)
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    // MARK: Faktury (`/bridge/native/v1/finance`, op=invoices | invoice | invoiceStatus | invoiceCancel | invoiceDelete)
    func loadInvoices(force: Bool = false) async {
        guard let api else { return }
        if !force, invoices != nil { return }
        invoicesLoading = true
        defer { invoicesLoading = false }
        do {
            invoices = try JSONDecoder().decode(FinInvoicesReply.self, from: try await api.get("/finance", query: ["op": "invoices"]))
            invoicesError = nil
        } catch {
            invoicesError = failureText(error, "Nie udało się pobrać faktur.")
        }
    }

    func invoiceDetail(_ id: String) async throws -> FinInvoiceDetail {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(FinInvoiceDetail.self, from: try await api.get("/finance", query: ["op": "invoice", "id": id]))
    }

    /// Czynność na fakturze (trasa `/finance`), komunikat jak w CRM, potem świeży rejestr. `false` — błąd albo brak zapisu.
    @discardableResult func invoiceAction(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            var payload = body
            payload["op"] = .string(op)
            let data = try await withBusy(workspace, pending) { try await api.post("/finance", payload) }
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            announce(reply)
            await loadInvoices(force: true)
            // Zapłaty i statusy faktur są też w Centrum, terminach i uzgodnieniu.
            months = [:]
            Task { await finance?.sync(force: true) }
            return reply["ok"]?.flag != false
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    // MARK: Karta faktury — PDF, UPO, e-mail (`/bridge/native/v1/finance`, op=invoicePdf | invoicePdfFile | invoiceUpo)

    /// E-maile z fakturą wysłane z karty w tej sesji (jak „Wysłano e-mail: N×” na karcie faktury w CRM).
    @Published var invoiceEmailsSent: [String: Int] = [:]

    /// „Generuj PDF” / „Regeneruj PDF”: wydruk z danych faktury zapisany w plikach (wydarzenie — folder „Faktury”).
    @discardableResult func generateInvoicePdf(_ id: String, regenerate: Bool) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            let data = try await withBusy(workspace, regenerate ? "Regenerowanie dokumentu PDF…" : "Generowanie dokumentu PDF…") {
                try await api.post("/finance", ["op": .string("invoicePdf"), "id": .string(id)], timeout: 180)
            }
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "PDF wygenerowany i zapisany")
            await loadInvoices(force: true)
            return true
        } catch {
            workspace.error = failureText(error, "Błąd generowania PDF")
            return false
        }
    }

    /// Zapisany PDF faktury (podgląd, pobranie, druk).
    func storedInvoicePdf(_ id: String) async -> BankFile? {
        guard let workspace, let api else { return nil }
        do {
            let data = try await withBusy(workspace, "Pobieranie PDF…") { try await api.get("/finance", query: ["op": "invoicePdfFile", "id": id]) }
            guard let file = decodeFile(try JSONDecoder().decode(BankFilePayload.self, from: data)) else {
                workspace.error = "Nie można pobrać pliku. Wygeneruj PDF ponownie."
                return nil
            }
            return file
        } catch {
            workspace.error = failureText(error, "Błąd pobierania PDF")
            return nil
        }
    }

    /// „Pobierz UPO (XML)” — zapisane UPO albo pobrane teraz z KSeF; plik trafia do Pobranych.
    func downloadInvoiceUpo(_ id: String) async {
        struct Reply: Decodable { var name: String; var xml: String }
        guard let workspace, let api else { return }
        do {
            let data = try await withBusy(workspace, "Pobieranie z KSeF…") {
                try await api.post("/finance", ["op": .string("invoiceUpo"), "id": .string(id)], timeout: 180)
            }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            save(BankFile(name: reply.name, mime: "application/xml", data: Data(reply.xml.utf8)))
        } catch {
            workspace.error = failureText(error, "Nie udało się pobrać UPO z KSeF.")
        }
    }

    // MARK: KSeF (`/bridge/native/v1/finance`, op=ksef | ksefInvoices | ksefPaid | ksefUnpaid | ksefPayment… | ksefReviewResolve |
    // ksefDelete | ksefCorrection…; synchronizacja — trasy CRM `/bridge/ksef/auth/token` i `/bridge/ksef/invoices/issued|received`)
    func loadKsefCompanies(force: Bool = false) async {
        guard let api else { return }
        if !force, ksefCompanies != nil { return }
        do {
            ksefCompanies = try JSONDecoder().decode(FinKsefCompaniesReply.self, from: try await api.get("/finance", query: ["op": "ksef"]))
            ksefError = nil
        } catch {
            let text = failureText(error, "Nie udało się pobrać konfiguracji KSeF.")
            if ksefCompanies == nil { ksefError = text } else { workspace?.error = text }
        }
    }

    func loadKsefInvoices(_ company: String, force: Bool = false) async {
        guard let api else { return }
        if !force, ksefLists[company] != nil { return }
        if ksefLists[company] == nil { ksefListError = nil }
        ksefLoading = true
        defer { ksefLoading = false }
        do {
            ksefLists[company] = try JSONDecoder().decode(FinKsefInvoicesReply.self, from: try await api.get("/finance", query: ["op": "ksefInvoices", "company": company]))
            ksefListError = nil
        } catch {
            let text = failureText(error, "Nie udało się pobrać faktur KSeF.")
            if ksefLists[company] == nil { ksefListError = text } else { workspace?.error = text }
        }
    }

    /// Rozliczenie korekty „in minus” (GET `ksefCorrection`): korekta, faktury korygowane, wpłaty, operacje i kompensata.
    func ksefCorrection(_ id: String) async throws -> FinKsefCorrection {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(FinKsefCorrection.self, from: try await api.get("/finance", query: ["op": "ksefCorrection", "id": id]))
    }

    /// Wpłata, termin, uwaga albo usunięcie faktury KSeF (trasa `/finance`), komunikat jak w CRM, potem świeża lista.
    @discardableResult func ksefAction(_ pending: String, _ op: String, _ body: [String: JSONValue], company: String) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            var payload = body
            payload["op"] = .string(op)
            let data = try await withBusy(workspace, pending) { try await api.post("/finance", payload) }
            announce((try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:])
            await loadKsefInvoices(company, force: true)
            // Wpłaty faktur KSeF są też w Centrum, terminach i uzgodnieniu.
            months = [:]
            Task { await finance?.sync(force: true) }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    /// Trasa CRM `/bridge/ksef/…` z tokenem pracownika (KSeF potrafi odpowiadać kilka minut); błąd — `error` albo `details`.
    private func ksefBridge(_ path: String, _ body: [String: JSONValue], fallback: String) async throws -> [String: JSONValue] {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw AppError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard (200..<300).contains(http.statusCode), object["success"]?.flag == true else {
            let message = object["error"]?.text.nonEmpty ?? object["details"]?.text.nonEmpty ?? "\(fallback) (HTTP \(http.statusCode))"
            throw NativeFailure(status: http.statusCode, message: message, fieldErrors: [:])
        }
        return object
    }

    /// Synchronizacja z KSeF za zakres dat (jak „Synchronizuj” w CRM): logowanie do KSeF danymi działalności, potem faktury
    /// wystawione i otrzymane równolegle; komunikat z liczbą nowych i pominiętych faktur, potem świeże dane.
    func syncKsef(company: String, from: Date, to: Date) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        let start = FinanceText.dayString(from)
        let end = FinanceText.dayString(to)
        guard start <= end else { workspace.error = "Data „od” nie może być późniejsza niż data „do”."; return }
        do {
            let summary: String = try await withBusy(workspace, "Synchronizacja z KSeF…") {
                let auth = try await self.ksefBridge("/bridge/ksef/auth/token", ["companyId": .string(company)], fallback: "Błąd automatycznej autoryzacji KSeF")
                guard auth["data"]?.object["redeemed"]?.flag == true else {
                    throw NativeFailure(status: 400, message: auth["error"]?.text.nonEmpty ?? "Błąd automatycznej autoryzacji KSeF.", fieldErrors: [:])
                }
                let payload: [String: JSONValue] = [
                    "companyId": .string(company), "dateFrom": .string("\(start)T00:00:00"), "dateTo": .string("\(end)T23:59:59"),
                ]
                async let issuedReply = self.ksefBridge("/bridge/ksef/invoices/issued", payload, fallback: "Błąd synchronizacji wystawionych")
                async let receivedReply = self.ksefBridge("/bridge/ksef/invoices/received", payload, fallback: "Błąd synchronizacji otrzymanych")
                let issued = try await issuedReply
                let received = try await receivedReply
                func count(_ reply: [String: JSONValue], _ key: String) -> Int { Int(reply["data"]?.object[key]?.number ?? 0) }
                let added = count(issued, "newCount") + count(received, "newCount")
                let skipped = count(issued, "skippedCount") + count(received, "skippedCount")
                var parts: [String] = []
                if added > 0 { parts.append("Nowe: \(added)") }
                if skipped > 0 { parts.append("Pominięte (już istnieją): \(skipped)") }
                return parts.isEmpty ? "Synchronizacja zakończona - brak nowych faktur" : "Synchronizacja zakończona. " + parts.joined(separator: ", ")
            }
            workspace.succeed(summary)
            months = [:]
            if invoices != nil { await loadInvoices(force: true) }
            Task { await finance?.sync(force: true) }
        } catch {
            workspace.error = failureText(error, "Błąd synchronizacji.")
        }
        // Stan logowania, automatycznej synchronizacji i dziennik — także po błędzie.
        await loadKsefCompanies(force: true)
        await loadKsefInvoices(company, force: true)
    }

    func addDeclarationFile(_ declaration: FinDeclaration, file: URL) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            let reply = try await withBusy(workspace, "Dodawanie pliku deklaracji…") {
                try await upload("declarationFile", fields: ["declarationId": declaration.id], file: file, limit: 20 * 1024 * 1024)
            }
            announce(reply)
            invalidateDeclarations()
            await loadDeclarations(force: true)
        } catch {
            workspace.error = failureText(error, "Nie udało się wgrać pliku.")
        }
    }
}
