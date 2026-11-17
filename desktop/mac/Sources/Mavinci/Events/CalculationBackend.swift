import Foundation

// MARK: Źródło kalkulacji dla edytora (`CalculationEditorView`, formularz pozycji, import, kalkulator trasy, wysyłka e-mailem):
// zakładka „Kalkulacje” wydarzenia (`/bridge/native/v1/events/card`, `tabQuery` / `tabAction`) albo karta zapytania
// (`/bridge/native/v1/inquiries`, `calcQuery` / `calcAction` / `calcEmail`). Te same odczyty i czynności serwera
// (`src/lib/native/eventCalculations.ts`) — w CRM to ten sam `CalculationEditor` z `eventId` albo `inquiryContext`.

/// Wiadomość z kalkulacją (podgląd i wysyłka).
struct CalculationEmailDraft {
    var calculationID: String
    var accountId: String
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var text: String
    var fileIDs: [String]
    var scheduledAt: Date?
}

struct CalculationBackend {
    /// Odczyt modułu kalkulacji (`editor`, `catalog`, `pdf`, `pdfPayload`, `travel`, `importSources`, `emailSetup`).
    let read: @MainActor (_ query: String, _ params: [String: String]) async throws -> Data
    /// Czynność z paskiem postępu; `reload` — zakładki wydarzenia do odświeżenia (w zapytaniu bez znaczenia).
    let act: @MainActor (_ action: String, _ body: [String: JSONValue], _ reload: [String], _ success: String?, _ pending: String?) async throws -> Data
    /// Spalanie pojazdu (`consumption`) i cena paliwa (`fuel`) do kalkulatora trasy.
    let logistics: @MainActor (_ query: String, _ params: [String: String]) async throws -> Data
    let previewEmail: @MainActor (_ draft: CalculationEmailDraft) async throws -> String
    /// Wysyłka albo zaplanowanie; zwraca komunikat jak w CRM.
    let sendEmail: @MainActor (_ draft: CalculationEmailDraft) async throws -> String
    let failure: @MainActor (_ error: Error, _ fallback: String) -> String
    /// Właściciel w żądaniu wydruku `/bridge/events/calculation-pdf` (`eventId` albo `inquiryId` z wydarzeniem zapytania).
    let owner: [String: String]
    /// Kalkulacja zapytania (inne komunikaty: PDF „przy zapytaniu”, oferty zapytania).
    let isInquiry: Bool

    var savedPdfMessage: String { isInquiry ? "PDF kalkulacji zapisany przy zapytaniu" : "PDF kalkulacji zapisany w plikach wydarzenia" }
    var importSourceName: String { isInquiry ? "ofert zapytania" : "ofert wydarzenia" }
    /// Pliki wydarzenia w wysyłce e-mailem — w zapytaniu tylko, gdy jest już powiązane z wydarzeniem (jak `eventId &&` w CRM).
    var hasEvent: Bool { owner["eventId"] != nil }

    @MainActor func query<T: Decodable>(_ name: String, _ params: [String: String] = [:], as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await read(name, params))
    }

    @MainActor func queryData(_ name: String, _ params: [String: String] = [:]) async throws -> Data {
        try await read(name, params)
    }

    @MainActor @discardableResult func action(_ name: String, _ body: [String: JSONValue] = [:], reload: [String], success: String?,
                                              pending: String? = "Zapisywanie…") async throws -> Data {
        try await act(name, body, reload, success, pending)
    }

    @MainActor func logisticsQuery<T: Decodable>(_ name: String, _ params: [String: String] = [:], as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await logistics(name, params))
    }

    @MainActor func failureText(_ error: Error, _ fallback: String) -> String { failure(error, fallback) }

    /// Treść żądania wydruku: właściciel i kalkulacja.
    func printQuery(_ calculationID: String) -> [String: String] {
        var query = owner
        query["calculationId"] = calculationID
        return query
    }

    /// Kalkulacje wydarzenia (zakładka karty wydarzenia).
    @MainActor static func event(_ store: EventCardStore, _ eventID: String) -> CalculationBackend {
        CalculationBackend(
            read: { query, params in try await store.tabQueryData(eventID, "calculations", query, params) },
            act: { action, body, reload, success, pending in
                try await store.tabAction(eventID, "calculations", action, body, reload: reload, success: success, pending: pending)
            },
            logistics: { query, params in try await store.tabQueryData(eventID, "logistics", query, params) },
            previewEmail: { draft in
                try await store.calculationEmailPreview(eventID, calculationID: draft.calculationID, accountId: draft.accountId,
                                                        subject: draft.subject, text: draft.text)
            },
            sendEmail: { draft in
                try await store.sendCalculationEmail(eventID, calculationID: draft.calculationID, accountId: draft.accountId, to: draft.to,
                                                     cc: draft.cc, bcc: draft.bcc, subject: draft.subject, text: draft.text,
                                                     fileIDs: draft.fileIDs, scheduledAt: draft.scheduledAt)
            },
            failure: { error, fallback in store.failureText(error, fallback) },
            owner: ["eventId": eventID],
            isInquiry: false
        )
    }
}
