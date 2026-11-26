import Foundation
import SwiftUI
import AppKit
import ImageIO
import UniformTypeIdentifiers

// MARK: Zakupy (`/crm/purchases`, `docs/purchases.md`) — stan ekranu: „Moje wydatki” (miesiąc pracownika, `op=state`),
// „Rozliczenia pracowników” (`op=review`) i zapisy przez `/bridge/native/v1/purchases` (te same funkcje bazy co CRM).
// Plik dokumentu (zdjęcie paragonu, zdjęcia stron, PDF) — multipart przez serwer CRM, który go zapisuje i odczytuje AI.

enum PurchaseTab: String, CaseIterable, Identifiable {
    case mine, review
    var id: String { rawValue }
}

@MainActor final class PurchasesStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: PurchaseState?
    @Published private(set) var loading = false
    @Published var loadError: String?
    @Published private(set) var year: Int
    @Published private(set) var month: Int
    @Published var tab: PurchaseTab = .mine
    /// Wiersze „Rozliczeń pracowników”; `nil` — jeszcze nie wczytane.
    @Published private(set) var reviewRows: [PurchaseReviewRow]?
    /// Otwarte rozliczenie pracownika (okno „Zakupy — pracownik”).
    @Published var reviewing: PurchaseMonth?

    init() {
        let now = PurchaseFormat.currentMonth()
        year = now.year
        month = now.month
    }

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: PurchaseAccess { state?.access ?? PurchaseAccess() }
    var categories: PurchaseCategories { state?.categories ?? .empty }
    /// Miesiąc jeszcze się nie zaczął — nie da się go rozliczyć.
    var futureMonth: Bool {
        let now = PurchaseFormat.currentMonth()
        return year * 12 + month > now.year * 12 + now.month
    }
    /// Bieżący (albo późniejszy) miesiąc — dalej nie ma czego przeglądać (zakup nie może mieć daty z przyszłości).
    var lastMonth: Bool {
        let now = PurchaseFormat.currentMonth()
        return year * 12 + month >= now.year * 12 + now.month
    }
    var isCurrentMonth: Bool {
        let now = PurchaseFormat.currentMonth()
        return year == now.year && month == now.month
    }
    /// Rozliczenia czekające na decyzję.
    var waiting: Int { reviewRows?.filter { $0.state == .submitted }.count ?? 0 }

    func reset() {
        let now = PurchaseFormat.currentMonth()
        state = nil; loading = false; loadError = nil; year = now.year; month = now.month; tab = .mine; reviewRows = nil; reviewing = nil
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    private static func failure(_ message: String) -> NativeFailure { NativeFailure(status: 400, message: message, fieldErrors: [:]) }

    // MARK: Odczyt

    /// Miesiąc „Moich wydatków”; `reload` — wczytaj ponownie także ten sam miesiąc (link z powiadomienia).
    func setPeriod(year: Int, month: Int, reload: Bool = false) {
        guard (2000...2100).contains(year), (1...12).contains(month) else { return }
        guard reload || year != self.year || month != self.month else { return }
        self.year = year
        self.month = month
        Task { await load() }
    }

    func shift(_ delta: Int) {
        let next = PurchaseFormat.shift(year, month, delta)
        setPeriod(year: next.year, month: next.month)
    }

    /// Stan miesiąca (prawa, dokumenty, rozliczenia działalności, kategorie); zatwierdzający — także „Rozliczenia pracowników”.
    func load() async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        let year = self.year, month = self.month
        loading = true
        defer { loading = false }
        do {
            let data = try await api.get("/purchases", query: ["op": "state", "year": String(year), "month": String(month)])
            let next = try PurchaseJSON.decoder.decode(PurchaseState.self, from: data)
            guard owner == workspace?.employee?.id, year == self.year, month == self.month else { return }
            state = next
            loadError = nil
            // Sam zatwierdzający (bez własnych zakupów) widzi tylko rozliczenia pracowników.
            if !next.access.record && next.access.approve { tab = .review }
            if next.access.approve { await loadReview() }
        } catch {
            guard owner == workspace?.employee?.id else { return }
            loadError = failureText(error, "Nie udało się wczytać zakupów.")
        }
    }

    func loadReview() async {
        guard let api else { return }
        struct Reply: Decodable { var rows: [PurchaseReviewRow] }
        do {
            reviewRows = try PurchaseJSON.decoder.decode(Reply.self, from: try await api.get("/purchases", query: ["op": "review"])).rows
        } catch {
            if reviewRows == nil { reviewRows = [] }
            workspace?.error = failureText(error, "Nie udało się wczytać rozliczeń.")
        }
    }

    /// Rozliczenie pracownika w oknie (z listy albo z linku w powiadomieniu o wysłanym rozliczeniu).
    func openReview(employee: String, year: Int, month: Int) async {
        guard let api, let workspace else { return }
        do {
            let data = try await workspace.withPending("Wczytywanie rozliczenia…") {
                try await api.get("/purchases", query: ["op": "state", "employee": employee, "year": String(year), "month": String(month)])
            }
            if let next = try PurchaseJSON.decoder.decode(PurchaseState.self, from: data).month { reviewing = next }
        } catch {
            workspace.error = failureText(error, "Nie udało się wczytać rozliczenia.")
        }
    }

    /// Eventy do przypisania zakupu: tej działalności, nieanulowane, które pracownik widzi (bez szukania — najbliższe dziś).
    func events(company: String, query: String) async throws -> [PurchaseEventOption] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { var events: [PurchaseEventOption] }
        var params = ["op": "events", "company": company]
        if !query.isEmpty { params["q"] = query }
        return try PurchaseJSON.decoder.decode(Reply.self, from: try await api.get("/purchases", query: params)).events
    }

    /// Wszystkie koszty eventu i ich suma.
    func costs(event: String) async throws -> PurchaseEventCosts {
        guard let api else { throw AppError.configuration }
        return try PurchaseJSON.decoder.decode(PurchaseEventCosts.self, from: try await api.get("/purchases", query: ["op": "costs", "event": event]))
    }

    /// Plik dokumentu — podpisany adres na 10 minut (podgląd w przeglądarce).
    func openFile(_ document: PurchaseDocument) async {
        guard let api else { return }
        struct Reply: Decodable { var url: String }
        do {
            let reply = try PurchaseJSON.decoder.decode(Reply.self, from: try await api.get("/purchases", query: ["op": "file", "id": document.id]))
            if let url = URL(string: reply.url) { NSWorkspace.shared.open(url) }
        } catch {
            workspace?.error = failureText(error, "Nie udało się otworzyć pliku.")
        }
    }

    // MARK: Plik dokumentu

    /// Jeden PDF albo zdjęcie (do 10 MB) albo kilka zdjęć stron (do 10, każde do 15 MB) — serwer składa z nich PDF, zapisuje go
    /// i odczytuje AI. Zdjęcia HEIC, TIFF, WebP (np. z iPhone'a) wysyłamy jako JPEG; za duże zdjęcie — pomniejszone.
    func upload(company: String, files: [URL]) async throws -> PurchaseUpload {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm else { throw AppError.configuration }
        guard !files.isEmpty else { throw Self.failure("Dodaj zdjęcie albo plik dokumentu.") }
        guard files.count <= PurchaseLimits.maxPages else { throw Self.failure("Dokument może mieć najwyżej \(PurchaseLimits.maxPages) stron (zdjęć).") }
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/purchases?op=upload") else {
            throw AppError.configuration
        }
        let boundary = "mavinci-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"company\"\r\n\r\n\(company)\r\n".utf8))
        for file in files {
            let part = try Self.filePart(file, single: files.count == 1)
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(part.name)\"\r\nContent-Type: \(part.mime)\r\n\r\n".utf8))
            body.append(part.data)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się dodać pliku.", fieldErrors: [:])
        }
        return try PurchaseJSON.decoder.decode(PurchaseUpload.self, from: data)
    }

    private struct FilePart {
        let name: String
        let mime: String
        let data: Data
    }

    private static func filePart(_ file: URL, single: Bool) throws -> FilePart {
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        var data = try Data(contentsOf: file)
        var name = file.lastPathComponent
        var mime = "application/pdf"
        let type = UTType(filenameExtension: file.pathExtension.lowercased())
        let limit = single ? PurchaseLimits.maxFileBytes : PurchaseLimits.maxPageBytes
        guard !data.isEmpty else { throw failure("Plik „\(name)” jest pusty.") }
        if type?.conforms(to: .pdf) == true {
            if data.count > PurchaseLimits.maxFileBytes { throw failure("Plik „\(name)” jest za duży — najwyżej 10 MB.") }
        } else if type?.conforms(to: .jpeg) == true || type?.conforms(to: .png) == true {
            mime = type?.conforms(to: .png) == true ? "image/png" : "image/jpeg"
            if data.count > limit {
                guard let smaller = jpeg(data, maxPixel: 3200), smaller.count <= limit else {
                    throw failure("Zdjęcie „\(name)” jest za duże — najwyżej \(single ? 10 : 15) MB.")
                }
                data = smaller
                mime = "image/jpeg"
                name = (name as NSString).deletingPathExtension + ".jpg"
            }
        } else if type?.conforms(to: .image) == true {
            guard var converted = jpeg(data, maxPixel: nil) else { throw failure("Nie udało się odczytać zdjęcia „\(name)” — zapisz je jako JPG albo PNG.") }
            if converted.count > limit {
                guard let smaller = jpeg(data, maxPixel: 3200), smaller.count <= limit else {
                    throw failure("Zdjęcie „\(name)” jest za duże — najwyżej \(single ? 10 : 15) MB.")
                }
                converted = smaller
            }
            data = converted
            mime = "image/jpeg"
            name = (name as NSString).deletingPathExtension + ".jpg"
        } else {
            throw failure("Obsługiwane są pliki PDF i zdjęcia (JPG, PNG, HEIC, WebP) — „\(name)” ma inny format.")
        }
        let safe = name.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        return FilePart(name: safe.isEmpty ? "dokument" : safe, mime: mime, data: data)
    }

    /// Zdjęcie jako JPEG: bez pomniejszania (z orientacją z EXIF) albo pomniejszone do `maxPixel` (orientacja już zastosowana).
    private static func jpeg(_ data: Data, maxPixel: Int?) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        if let maxPixel {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        } else {
            CGImageDestinationAddImageFromSource(destination, source, 0, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        }
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }

    /// Plik wysłany, ale zakup niezapisany (okno zamknięte albo plik zamieniony) — serwer usuwa go, jeśli nie ma dokumentu.
    func discard(_ path: String) {
        guard let api else { return }
        Task { _ = try? await api.post("/purchases", ["op": .string("discard"), "path": .string(path)]) }
    }

    // MARK: Zapisy

    /// Zapis zakupu (nowy albo poprawka) — dokument po zapisie.
    func save(id: String?, data: [String: JSONValue]) async throws -> PurchaseDocument {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = ["op": .string("save"), "data": .object(data)]
        if let id { body["id"] = .string(id) }
        struct Reply: Decodable { var document: PurchaseDocument }
        return try PurchaseJSON.decoder.decode(Reply.self, from: try await api.post("/purchases", body)).document
    }

    func delete(_ document: PurchaseDocument) async {
        guard let api, let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            _ = try await workspace.withPending("Usuwanie zakupu…") {
                try await api.post("/purchases", ["op": .string("delete"), "id": .string(document.id)])
            }
            workspace.succeed("Zakup usunięty.")
            await load()
        } catch {
            workspace.error = failureText(error, "Nie udało się usunąć zakupu.")
        }
    }

    /// „Wyślij rozliczenie” miesiąca działalności (`purchase_submit`); `nil` — wysłane, inaczej komunikat błędu.
    func submit(_ company: PurchaseMonthCompany, month: PurchaseMonth, note: String) async -> String? {
        guard let api, let workspace else { return "Brak połączenia z serwerem CRM." }
        guard workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        let text = String(note.purchaseTrimmed.prefix(2000))
        let body: [String: JSONValue] = [
            "op": .string("submit"), "companyId": .string(company.id), "year": .number(Double(month.year)), "month": .number(Double(month.month)),
            "note": text.isEmpty ? .null : .string(text),
        ]
        do {
            let next = try PurchaseJSON.decoder.decode(PurchaseMonth.self, from: try await api.post("/purchases", body))
            if var current = state, current.month?.id == next.id {
                current.month = next
                state = current
            }
            workspace.succeed("Rozliczenie wysłane do zatwierdzenia.")
            return nil
        } catch {
            return failureText(error, "Nie udało się wysłać rozliczenia.")
        }
    }

    /// „Zatwierdź” albo „Zwróć do poprawy” / „Cofnij zatwierdzenie” (`purchase_decide`); `nil` — zapisane, inaczej komunikat błędu.
    func decide(_ company: PurchaseMonthCompany, approve: Bool, note: String) async -> String? {
        guard let api, let workspace else { return "Brak połączenia z serwerem CRM." }
        guard workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        guard let settlement = company.settlement else { return "To rozliczenie nie zostało jeszcze wysłane." }
        let text = String(note.purchaseTrimmed.prefix(2000))
        if !approve && text.isEmpty { return "Napisz, co trzeba poprawić — pracownik zobaczy tę uwagę." }
        let body: [String: JSONValue] = [
            "op": .string("decide"), "settlementId": .string(settlement.id), "approve": .bool(approve), "note": text.isEmpty ? .null : .string(text),
        ]
        do {
            let next = try PurchaseJSON.decoder.decode(PurchaseMonth.self, from: try await api.post("/purchases", body))
            reviewing = next
            workspace.succeed(approve ? "Rozliczenie zatwierdzone." : "Rozliczenie zwrócone do poprawy.")
            await loadReview()
            return nil
        } catch {
            return failureText(error, "Nie udało się zapisać decyzji.")
        }
    }
}

extension Workspace {
    /// Zakupy z linku: `/crm/purchases?employee=…&year=…&month=…` — rozliczenie pracownika (zatwierdzający),
    /// `?year=…&month=…` — własny miesiąc. Bez ekranu Zakupów w menu — strona CRM.
    func showPurchases(employee: String?, year: Int?, month: Int?) {
        var period: (year: Int, month: Int)?
        if let year, let month, (2000...2100).contains(year), (1...12).contains(month) { period = (year, month) }
        guard let item = navigation.flatMap(\.flattened).first(where: { $0.screen == .purchases }) else {
            var query: [String] = []
            if let employee { query.append("employee=\(employee)") }
            if let period { query.append("year=\(period.year)"); query.append("month=\(period.month)") }
            openCRM("/crm/purchases" + (query.isEmpty ? "" : "?" + query.joined(separator: "&")))
            return
        }
        openHref(item.href)
        guard let period else { return }
        if let employee, employee != self.employee?.id {
            purchases.tab = .review
            Task {
                await purchases.openReview(employee: employee, year: period.year, month: period.month)
                await purchases.loadReview()
            }
        } else {
            purchases.tab = .mine
            purchases.setPeriod(year: period.year, month: period.month, reload: true)
        }
    }
}
