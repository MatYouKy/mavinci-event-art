import Foundation

// MARK: Umowa wydarzenia w silniku dokumentów — składanie umowy tym samym kodem co zakładka „Umowa” w CRM
// (`fetchEventContractData` w `src/lib/CRM/contracts/eventContractData.ts`), uruchamianym w Chrome na Macu na stronie
// `/native-engine/contracts` z tokenem pracownika (uprawnienia jak w CRM). Z wyniku: podgląd bieżącej treści, szkic umowy
// („Przygotuj umowę”), odświeżenie z szablonu i danych, PDF zapisywany w CRM (`/bridge/events/contract-pdf`), pola i warunki,
// depozyt oraz wystawienie szkicu z uwagami (`EventContractEditor.swift`), klauzule tej umowy z wyborem rozbieżnych wersji
// wspólnych ustaleń i złożenie treści po zmianie szablonu (`EventContractClauses.swift`), edycja treści, audyt AI i anulowanie
// (`EventContractContent.swift`).

/// Wynik `eventContract` z silnika: stan umowy po składaniu, strony do wydruku (podgląd i PDF) i uwagi.
struct EventContractEngineResult: Decodable {
    var contractId: String?
    var created: Bool
    var status: String
    var templateId: String?
    var templateName: String
    var sourceOutdated: Bool
    var modifiedAfterGeneration: Bool
    var generatedPdfPath: String?
    var unplacedClauseCategories: [String]
    var unresolvedConflicts: Int
    var pageCount: Int
    var pagesHtml: String?
    var cssText: String?
    /// `state`: pola, warunki, osoby podpisujące i depozyt.
    var edit: EventContractEditData?
    /// `state`: uwagi przed wystawieniem.
    var preflight: [EventContractPreflightIssue]?
    /// `clauses`, `saveClauses`, `applySelections`: klauzule tej umowy i rozbieżne wersje wspólnych ustaleń.
    var clauses: EventContractClausesData?
    /// `content`: treść do edycji.
    var content: EventContractContentData?
    /// `audit`: wynik audytu AI do przeglądu; `applyAudit`: liczba usuniętych i poprawionych fragmentów.
    var audit: EventContractAuditPayload?
    /// `saveContent`: treść zapisana (starszy silnik nie zwraca pola).
    var saved: Bool?
}

/// Treść umowy do edycji (`content`): ciągły dokument, style dokumentu, krój, interlinia i znacznik zapisanej umowy.
struct EventContractContentData: Decodable {
    var flowContent: String
    var cssText: String
    var font: String
    var lineHeight: Double
    var stamp: String
}

/// Wynik audytu AI (`ContractAuditResult`): duplikaty do usunięcia i kwestie z wariantami do wyboru.
struct ContractAuditResult: Decodable {
    struct Duplicate: Decodable, Identifiable {
        var id: String
        var keepBlockId: String
        var removeBlockIds: [String]
        var reason: String
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
            keepBlockId = try c.decodeIfPresent(String.self, forKey: .keepBlockId) ?? ""
            removeBlockIds = try c.decodeIfPresent([String].self, forKey: .removeBlockIds) ?? []
            reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        }
        enum CodingKeys: String, CodingKey { case id, keepBlockId, removeBlockIds, reason }
    }
    struct Operation: Decodable {
        var blockId: String
        /// `replace` albo `remove`.
        var action: String
        var replacementText: String
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            blockId = try c.decodeIfPresent(String.self, forKey: .blockId) ?? ""
            action = try c.decodeIfPresent(String.self, forKey: .action) ?? "replace"
            replacementText = try c.decodeIfPresent(String.self, forKey: .replacementText) ?? ""
        }
        enum CodingKeys: String, CodingKey { case blockId, action, replacementText }
    }
    struct Option: Decodable, Identifiable {
        var id: String
        var label: String
        var explanation: String
        var operations: [Operation]
        init(id: String, label: String, explanation: String) {
            self.id = id
            self.label = label
            self.explanation = explanation
            operations = []
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
            explanation = try c.decodeIfPresent(String.self, forKey: .explanation) ?? ""
            operations = try c.decodeIfPresent([Operation].self, forKey: .operations) ?? []
        }
        enum CodingKeys: String, CodingKey { case id, label, explanation, operations }
    }
    struct Issue: Decodable, Identifiable {
        var id: String
        var severity: String
        var title: String
        var description: String
        var relatedBlockIds: [String]
        var options: [Option]
        var recommendedOptionId: String
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
            severity = try c.decodeIfPresent(String.self, forKey: .severity) ?? "info"
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
            relatedBlockIds = try c.decodeIfPresent([String].self, forKey: .relatedBlockIds) ?? []
            options = try c.decodeIfPresent([Option].self, forKey: .options) ?? []
            recommendedOptionId = try c.decodeIfPresent(String.self, forKey: .recommendedOptionId) ?? ""
        }
        enum CodingKeys: String, CodingKey { case id, severity, title, description, relatedBlockIds, options, recommendedOptionId }
    }
    var summary: String
    var duplicates: [Duplicate]
    var issues: [Issue]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        duplicates = try c.decodeIfPresent([Duplicate].self, forKey: .duplicates) ?? []
        issues = try c.decodeIfPresent([Issue].self, forKey: .issues) ?? []
    }
    enum CodingKeys: String, CodingKey { case summary, duplicates, issues }
}

/// Fragment umowy lub klauzula przekazana do audytu (`ContractAuditBlock`).
struct ContractAuditBlock: Decodable, Identifiable {
    var id: String
    var text: String
}

/// `audit` / `applyAudit` z silnika. Wynik audytu wraca do silnika bez zmian (`raw`) razem z treścią, która była audytowana.
struct EventContractAuditPayload: Decodable {
    var raw: JSONValue?
    var result: ContractAuditResult?
    var blocks: [ContractAuditBlock]?
    var source: String?
    var stamp: String?
    var removed: Int?
    var changed: Int?
    enum CodingKeys: String, CodingKey { case audit, blocks, source, stamp, removed, changed }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        raw = try c.decodeIfPresent(JSONValue.self, forKey: .audit)
        result = try c.decodeIfPresent(ContractAuditResult.self, forKey: .audit)
        blocks = try c.decodeIfPresent([ContractAuditBlock].self, forKey: .blocks)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        stamp = try c.decodeIfPresent(String.self, forKey: .stamp)
        removed = try c.decodeIfPresent(Int.self, forKey: .removed)
        changed = try c.decodeIfPresent(Int.self, forKey: .changed)
    }
}

/// „Asystent AI” w oknie klauzul: wynik audytu i powiązanie fragmentów z klauzulami.
struct EventContractClauseAudit: Decodable {
    var audit: ContractAuditResult
    var blocks: [ContractAuditBlock]
    var blockToClauseId: [String: String]
}

/// Czynności silnika: `preview` — podgląd bieżącej treści; `create` — szkic umowy (`ensureContractRecord`);
/// `refresh` — „Odśwież szablon i dane” (`handleRefreshFromOffer`); `pdf` — strony do „Generuj PDF” (`handlePrint`);
/// `state` — pola, warunki i uwagi; `saveFields` — „Zapisz” pól; `saveDeposit` — depozyt; `status` — zmiana statusu szkicu;
/// `clauses` — „Klauzule tej umowy”; `saveClauses` — „Zapisz klauzule umowy”; `applySelections` — „Zastosuj wybory do umowy”;
/// `content` / `saveContent` — edycja treści; `audit` / `applyAudit` — audyt AI umowy.
enum EventContractEngineMode: String {
    case preview, create, refresh, pdf, state, saveFields, saveDeposit, status, clauses, saveClauses, applySelections
    case content, saveContent, audit, applyAudit
}

enum EventContractNative {
    /// Składanie umowy działa w przeglądarce Chromium na Macu (Chrome, Edge, Brave…).
    static var available: Bool { ContractEngine.available }
    /// Podgląd PDF bez zapisu wymaga też lokalnego druku (Chrome i fonty wydruków).
    static var previewAvailable: Bool { ChromePdfEngine.available }
    /// `CONTRACT_AMOUNTS_REQUIRED` z CRM.
    static let amountsRequired = "Kwoty umowy widzi osoba z dostępem do kwot — poproś sprzedawcę lub administratora."
}

extension Workspace {
    /// Umowa wydarzenia złożona w silniku dokumentów (Chrome na Macu) tokenem pracownika.
    func eventContract(eventID: String, mode: EventContractEngineMode, canViewAmounts: Bool, hosts: [String],
                       extra: [String: JSONValue] = [:]) async throws -> EventContractEngineResult {
        guard let backend = eventAPI() else { throw AppError.configuration }
        let token = try await backend.token()
        var input: [String: JSONValue] = extra
        input.merge([
            "token": .string(token),
            "eventId": .string(eventID),
            "canViewAmounts": .bool(canViewAmounts),
            "mode": .string(mode.rawValue),
        ]) { $1 }
        if let employee { input["employeeId"] = .string(employee.id) }
        return try await contractEngine(.eventContract, input: input, hosts: hosts, as: EventContractEngineResult.self)
    }

    /// „Asystent AI” klauzul (`auditClauses`): aktywne klauzule z okna, bez składania umowy.
    func eventContractClauseAudit(eventID: String, canViewAmounts: Bool, hosts: [String], items: [JSONValue]) async throws -> EventContractClauseAudit {
        guard let backend = eventAPI() else { throw AppError.configuration }
        let token = try await backend.token()
        var input: [String: JSONValue] = [
            "token": .string(token),
            "eventId": .string(eventID),
            "canViewAmounts": .bool(canViewAmounts),
            "mode": .string("auditClauses"),
            "auditItems": .array(items),
        ]
        if let employee { input["employeeId"] = .string(employee.id) }
        struct Reply: Decodable { var clauseAudit: EventContractClauseAudit? }
        guard let result = try await contractEngine(.eventContract, input: input, hosts: hosts, as: Reply.self).clauseAudit else {
            throw NativeFailure(status: 0, message: "Serwer CRM nie obsługuje jeszcze asystenta klauzul na Macu — zaktualizuj CRM.", fieldErrors: [:])
        }
        return result
    }

    /// Podgląd stron umowy jako PDF (bez zapisu): zadanie wydruku z CRM i druk w Chrome na Macu.
    func eventContractPreviewPdf(eventID: String, contractID: String?, pagesHtml: String, cssText: String) async throws -> Data {
        guard let backend = eventAPI(), let base = connection.crm,
              let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/events/contract-pdf?render=local") else {
            throw AppError.configuration
        }
        var body: [String: JSONValue] = [
            "eventId": .string(eventID), "pagesHtml": .string(pagesHtml), "cssText": .string(cssText), "preview": .bool(true),
        ]
        if let contractID { body["contractId"] = .string(contractID) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        struct Reply: Decodable { let job: PrintJob }
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkPrintResponse(data, response)
        let job = try JSONDecoder().decode(Reply.self, from: data).job
        return try await ChromePdfEngine.shared.render(job)
    }

    /// „Generuj PDF”: strony z silnika, druk w Chrome na Macu (bez Chrome — na serwerze), zapis w Dokumenty → Umowy.
    func generateEventContractPdf(eventID: String, contractID: String, pagesHtml: String, cssText: String) async throws {
        let body: [String: JSONValue] = [
            "eventId": .string(eventID), "contractId": .string(contractID), "pagesHtml": .string(pagesHtml), "cssText": .string(cssText),
        ]
        _ = try await generateStoredDocument(path: "/bridge/events/contract-pdf", body: try JSONEncoder().encode(body))
    }
}
