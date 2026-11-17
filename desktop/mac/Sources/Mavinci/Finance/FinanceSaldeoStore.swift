import AppKit
import SwiftUI

// MARK: Przekazanie księgowej (Saldeo) — stan ekranu jak `SaldeoDeliveryPanel` w CRM: działalność i miesiąc, dokumenty spoza
// KSeF, płatności zbiorcze, braki i „Do dosłania”, plik kontrolny, paczka ZIP i wysyłka sprawdzonego pakietu.
// Serwer: `/bridge/native/v1/finance/saldeo` (token pracownika). Wysyłka jak w CRM: rezerwacja → dokumenty do Saldeo przez
// trasę CRM `/bridge/integrations/saldeo` (PIN tylko na serwerze) → wyciągi i opisy płatności zbiorczych do księgowej przez
// `send-email` → potwierdzenie. Wysyłane są dokładnie bajty z pliku kontrolnego (trzymane w pamięci do wysyłki).

struct SaldeoSetup: Decodable {
    struct Company: Decodable, Identifiable {
        var id: String
        var name: String
        var isDefault: Bool
        var saldeoEmail: String
        var accountantEmail: String
        var canManage: Bool
    }
    struct Account: Decodable, Identifiable {
        var id: String
        var email: String
    }
    var companies: [Company]
    var accounts: [Account]
    var isSaldeoAdmin: Bool
}

struct SaldeoMonth: Decodable {
    struct Counts: Decodable {
        var pending: Int
        var sent: Int
        var statements: Int
        var collective: Int
        var ksef: Int
        var statementOnly: Int
        var excluded: Int
        var hidden: Int
    }
    struct Link: Decodable, Identifiable {
        var bankId: String
        var date: String
        var amount: Double
        var currency: String
        var assigned: Double
        var reference: String
        var group: [String]
        var id: String { bankId }
    }
    struct Doc: Decodable, Identifiable {
        var key: String
        var source: String
        var sourceLabel: String
        var number: String
        var kind: String
        var counterparty: String
        var date: String
        var amount: Double?
        var currency: String
        var state: String
        var sentAt: String?
        var hasLink: Bool
        var note: String
        var editable: Bool
        var links: [Link]
        var id: String { key }
    }
    struct Collective: Decodable, Identifiable {
        struct Item: Decodable, Identifiable {
            var key: String
            var number: String
            var counterparty: String
            var allocated: Double?
            var id: String { key }
        }
        var id: String
        var date: String
        var amount: Double
        var currency: String
        var counterparty: String
        var reference: String
        var statementName: String
        var documents: [Item]
    }
    struct Unlinked: Decodable, Identifiable {
        var id: String
        var key: String
        var date: String
        var credit: Bool
        var amount: Double
        var currency: String
        var counterparty: String
        var status: String
        var reference: String
        var note: String
        var canAcknowledge: Bool
        var acknowledged: Bool
        var staleAcknowledgment: Bool
        var expected: [String: JSONValue]
    }
    struct Followup: Decodable, Identifiable {
        var id: String
        var bankId: String
        var reference: String
        var date: String
        var amount: Double
        var currency: String
        var counterparty: String
        var note: String
        var acknowledgedAt: String
        var status: String
    }
    struct Handoff: Decodable {
        var deliveredAt: String
        var deliveredTo: String
    }
    var companyId: String
    var month: Int
    var year: Int
    var canManage: Bool
    var counts: Counts
    var documents: [Doc]
    var collective: [Collective]
    var unlinked: [Unlinked]
    var followups: [Followup]
    var blockers: [String]
    var warnings: [String]
    var latestHandoff: Handoff?
}

struct SaldeoDetails: Decodable, Identifiable {
    struct Origin: Decodable {
        var source: String
        var id: String
        var original: String
    }
    struct Related: Decodable {
        var label: String
        var note: String
    }
    struct Linked: Decodable {
        var key: String
        var number: String
        var counterparty: String
        var allocatedAmount: Double?
        var documentAmount: Double?
        var currency: String
    }
    struct Payment: Decodable, Identifiable {
        var id: String
        var date: String
        var postingDate: String
        var reference: String
        var counterparty: String
        var title: String
        var currency: String
        var documentCurrency: String
        var statementName: String
        var note: String
        var direction: String
        var amount: Double
        var allocatedAmount: Double?
        var documentAmount: Double?
        var collective: Bool
        var linkedDocuments: [Linked]
    }
    var key: String
    var number: String
    var kind: String
    var sourceLabel: String
    var date: String
    var dueDate: String
    var entryType: String
    var hasPaymentLink: Bool
    var canEditNote: Bool
    var canManage: Bool
    var origin: Origin?
    var counterparty: String
    var amount: Double?
    var currency: String
    var ksefReference: String
    var note: String
    var relatedNotes: [Related]
    var payments: [Payment]
    var hasPreview: Bool
    var previewMissing: String?
    var disposition: String
    var id: String { key }
    var isPayment: Bool { entryType == "payment" }
}

struct SaldeoReview: Decodable {
    struct SourceCheck: Codable {
        var bucket: String
        var path: String
        var filename: String
        var digest: String
    }
    struct Prepared: Decodable {
        var key: String
        var source: String
        var sourceId: String
        var number: String
        var saldeoType: String
        var filename: String
        var contentType: String
        var size: Int
        var content: String
        var sha256: String
    }
    struct Accountant: Decodable {
        var filename: String
        var contentType: String
        var size: Int
        var content: String
    }
    struct Batch: Decodable {
        var type: String
        var keys: [String]
    }
    var fingerprint: String
    var revision: String
    var createdAt: String
    var html: String
    var filename: String
    var blockers: [String]
    var reportHash: String
    var reportAlreadySent: Bool
    var emailAccountId: String
    var sender: String
    var saldeoEmail: String
    var accountantEmail: String
    var sourceChecks: [SourceCheck]
    var prepared: [Prepared]
    var accountant: [Accountant]
    var batches: [Batch]
}

private struct SaldeoReviewReply: Decodable {
    var message: String
    var review: SaldeoReview
}

private struct SaldeoSendCheck: Decodable {
    var toSend: [String]
    var companyName: String
    var period: String
    var statementCount: Int
    var collectiveCount: Int
    var accountantItem: JSONValue
}

private struct SaldeoClaims: Decodable {
    struct Claim: Decodable {
        var id: String
        var key: String
    }
    var claimed: [Claim]
}

/// Stan „Automatyczny PIN Saldeo” (jak w CRM; PIN nie wraca do aplikacji).
enum SaldeoPin: Equatable {
    case checking, ready, missing, failed(String)
    var message: String {
        switch self {
        case .checking: return "Sprawdzam uprawnienia administratora i konfigurację PIN-u…"
        case .ready: return "Administrator zweryfikowany. PIN jest skonfigurowany na serwerze i zostanie dodany automatycznie podczas wysyłki."
        case .missing: return "Brak poprawnego PIN_SALDEO na serwerze. Uzupełnij konfigurację i uruchom serwer ponownie; PIN-u nie wpisuje się w aplikacji ani w przeglądarce."
        case .failed(let message): return message
        }
    }
}

private struct SaldeoFailure: Error { let message: String }

enum SaldeoText {
    static let months = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"]
    static func pad(_ value: Int, _ width: Int = 2) -> String { String(format: "%0\(width)d", value) }
    /// Odmiana liczebnika: 1 dokument, 2–4 dokumenty, 5+ dokumentów (12–14 — dokumentów).
    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        if count == 1 { return one }
        return (2...4).contains(count % 10) && !(12...14).contains(count % 100) ? few : many
    }
    static func money(_ value: Double?, _ currency: String) -> String {
        guard let value, value.isFinite else { return "Brak zapisanej kwoty" }
        return FinFormat.money(value, currency.isEmpty ? "PLN" : currency)
    }
    /// Jak `safeFilename` w CRM: bez znaków diakrytycznych, tylko litery, cyfry, „.”, „_” i „-”.
    static func safeFilename(_ value: String) -> String {
        var result = ""
        var gap = false
        for scalar in value.decomposedStringWithCanonicalMapping.unicodeScalars where !(0x300...0x36F).contains(scalar.value) {
            let allowed = (0x30...0x39).contains(scalar.value) || (0x41...0x5A).contains(scalar.value) || (0x61...0x7A).contains(scalar.value)
                || scalar == "." || scalar == "_" || scalar == "-"
            if allowed {
                if gap { result.append("-"); gap = false }
                result.unicodeScalars.append(scalar)
            } else {
                gap = true
            }
        }
        while result.hasPrefix("-") { result.removeFirst() }
        while result.hasSuffix("-") { result.removeLast() }
        return result.isEmpty ? "dokument" : result
    }
    /// Jak `html()` w CRM — znaki specjalne w treści wiadomości.
    static func html(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#039;")
    }
}

/// Paczka ZIP (bez kompresji) z dokładnych bajtów sprawdzonych załączników — jak `buildSaldeoDeliveryBundle` w CRM.
enum SaldeoBundle {
    private static let table: [UInt32] = (0..<256).map { index -> UInt32 in
        var value = UInt32(index)
        for _ in 0..<8 { value = value & 1 == 1 ? 0xEDB8_8320 ^ (value >> 1) : value >> 1 }
        return value
    }

    static func crc32(_ data: Data) -> UInt32 {
        var checksum: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
            for byte in buffer { checksum = table[Int((checksum ^ UInt32(byte)) & 0xFF)] ^ (checksum >> 8) }
        }
        return checksum ^ 0xFFFF_FFFF
    }

    static func build(_ files: [(name: String, data: Data)]) throws -> Data {
        guard !files.isEmpty else { throw SaldeoFailure(message: "Brak przygotowanych plików do pobrania.") }
        guard files.count <= 65535 else { throw SaldeoFailure(message: "Zbyt wiele plików w paczce. Podziel ją na mniejsze części.") }
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date())
        let dosDate = UInt16(((max(1980, min(2107, parts.year ?? 1980)) - 1980) << 9) | ((parts.month ?? 1) << 5) | (parts.day ?? 1))
        let dosTime = UInt16(((parts.hour ?? 0) << 11) | ((parts.minute ?? 0) << 5) | ((parts.second ?? 0) / 2))
        var names = Set<String>()
        var local = Data()
        var central = Data()
        for file in files {
            let name = file.name.replacingOccurrences(of: "\\", with: "/")
            let segments = name.components(separatedBy: "/")
            if name.isEmpty || name.hasPrefix("/") || segments.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
                || name.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) {
                throw SaldeoFailure(message: "Nieprawidłowa nazwa pliku w paczce. Przygotuj paczkę ponownie.")
            }
            let unique = name.precomposedStringWithCanonicalMapping.lowercased(with: Locale(identifier: "pl_PL"))
            guard names.insert(unique).inserted else {
                throw SaldeoFailure(message: "Nazwa „\(name)” powtarza się w paczce. Każdy załącznik musi mieć osobną nazwę.")
            }
            let nameBytes = Data(name.utf8)
            guard nameBytes.count <= 65535 else { throw SaldeoFailure(message: "Nazwa załącznika jest zbyt długa.") }
            guard local.count + file.data.count <= 512 * 1024 * 1024 else { throw SaldeoFailure(message: "Paczka przekracza 512 MB. Przygotuj mniejsze paczki.") }
            let checksum = crc32(file.data)
            let offset = UInt32(local.count)
            local.le32(0x0403_4B50); local.le16(20); local.le16(0x0800); local.le16(0); local.le16(dosTime); local.le16(dosDate)
            local.le32(checksum); local.le32(UInt32(file.data.count)); local.le32(UInt32(file.data.count)); local.le16(UInt16(nameBytes.count)); local.le16(0)
            local.append(nameBytes)
            local.append(file.data)
            central.le32(0x0201_4B50); central.le16(20); central.le16(20); central.le16(0x0800); central.le16(0); central.le16(dosTime); central.le16(dosDate)
            central.le32(checksum); central.le32(UInt32(file.data.count)); central.le32(UInt32(file.data.count)); central.le16(UInt16(nameBytes.count))
            central.le16(0); central.le16(0); central.le16(0); central.le16(0); central.le32(0); central.le32(offset)
            central.append(nameBytes)
        }
        var end = Data()
        end.le32(0x0605_4B50); end.le16(0); end.le16(0); end.le16(UInt16(files.count)); end.le16(UInt16(files.count))
        end.le32(UInt32(central.count)); end.le32(UInt32(local.count)); end.le16(0)
        return local + central + end
    }
}

private extension Data {
    mutating func le16(_ value: UInt16) { var raw = value.littleEndian; Swift.withUnsafeBytes(of: &raw) { append(contentsOf: $0) } }
    mutating func le32(_ value: UInt32) { var raw = value.littleEndian; Swift.withUnsafeBytes(of: &raw) { append(contentsOf: $0) } }
}

@MainActor final class FinanceSaldeoStore: ObservableObject {
    weak var finance: FinanceStore?
    var workspace: Workspace? { finance?.workspace }
    var api: NativeAPI? { workspace?.nativeAPI() }

    @Published private(set) var setup: SaldeoSetup?
    @Published var setupError: String?
    @Published private(set) var companyID: String?
    @Published private(set) var month = Calendar.current.component(.month, from: Date())
    @Published private(set) var year = Calendar.current.component(.year, from: Date())
    /// Okres wybrany dla każdej działalności (jak zapamiętanie w karcie przeglądarki) — tylko na czas pracy.
    private var periods: [String: (month: Int, year: Int)] = [:]
    @Published private(set) var data: SaldeoMonth?
    @Published private(set) var loading = false
    @Published var loadError: String?
    @Published var emailAccountID = "" { didSet { if oldValue != emailAccountID { invalidateReview() } } }
    @Published var saldeoEmail = "" { didSet { if oldValue != saldeoEmail { invalidateReview() } } }
    @Published var accountantEmail = "" { didSet { if oldValue != accountantEmail { invalidateReview() } } }
    @Published private(set) var pin: SaldeoPin = .checking
    @Published private(set) var review: SaldeoReview?
    @Published var reviewApproved = false
    @Published private(set) var busy = false
    @Published private(set) var followupSaving: String?
    @Published var outcome: String?
    @Published var failure: String?
    private var controlFile: URL?
    private var loadToken = 0

    var loadKey: String { "\(companyID ?? "")|\(month)|\(year)" }
    var isSaldeoAdmin: Bool { setup?.isSaldeoAdmin == true }
    /// Działalności z filtra Finansów, dla których serwer zwrócił dostęp.
    var companies: [SaldeoSetup.Company] {
        let scope = Set(finance?.scopeCompanies.map(\.id) ?? [])
        return (setup?.companies ?? []).filter { scope.contains($0.id) }
    }
    var company: SaldeoSetup.Company? { companies.first { $0.id == companyID } }
    var senderAddress: String { setup?.accounts.first(where: { $0.id == emailAccountID })?.email ?? "" }

    func reset() {
        setup = nil; setupError = nil; companyID = nil; periods = [:]; data = nil; loading = false; loadError = nil
        emailAccountID = ""; saldeoEmail = ""; accountantEmail = ""; pin = .checking
        review = nil; reviewApproved = false; busy = false; followupSaving = nil; outcome = nil; failure = nil; controlFile = nil
        month = Calendar.current.component(.month, from: Date()); year = Calendar.current.component(.year, from: Date())
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? SaldeoFailure { return failure.message }
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    private func get<T: Decodable>(_ query: [String: String], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/finance/saldeo", query: query))
    }

    private func post<T: Decodable>(_ op: String, _ body: [String: JSONValue], as type: T.Type, timeout: TimeInterval? = nil) async throws -> T {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return try JSONDecoder().decode(T.self, from: try await api.post("/finance/saldeo", payload, timeout: timeout))
    }

    /// Długie operacje (plik kontrolny, kontrola przed wysyłką) — pobranie plików i kopii z opisem trwa dłużej niż zwykłe zapytanie.
    private func postLong<T: Decodable>(_ op: String, _ body: [String: JSONValue], as type: T.Type) async throws -> T {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/finance/saldeo") else {
            throw AppError.configuration
        }
        var payload = body
        payload["op"] = .string(op)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 900
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Serwer CRM nie wykonał operacji (\(http.statusCode)).", fieldErrors: [:])
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private var target: [String: String] {
        ["company": companyID ?? "", "month": String(month), "year": String(year)]
    }
    private var targetBody: [String: JSONValue] {
        ["company": .string(companyID ?? ""), "month": .number(Double(month)), "year": .number(Double(year))]
    }

    // MARK: Działalność, okres, ustawienia
    func loadSetup(force: Bool = false) async {
        if !force, setup != nil { ensureCompany(); return }
        do {
            setup = try await get(["op": "setup"], as: SaldeoSetup.self)
            setupError = nil
            if !(setup?.accounts.contains(where: { $0.id == emailAccountID }) ?? false) { emailAccountID = setup?.accounts.first?.id ?? "" }
            ensureCompany()
        } catch {
            let text = failureText(error, "Nie można pobrać ustawień wysyłki.")
            if setup == nil { setupError = text } else { workspace?.error = text }
        }
    }

    /// Wybrana działalność musi być w filtrze Finansów — inaczej pierwsza z listy (domyślna na początku).
    func ensureCompany() {
        guard let first = companies.first else { return }
        if company == nil { select(first.id) }
    }

    func select(_ id: String) {
        guard id != companyID, let next = companies.first(where: { $0.id == id }) else { return }
        if let current = companyID { periods[current] = (month: month, year: year) }
        companyID = id
        let now = Date()
        let saved = periods[id] ?? (month: Calendar.current.component(.month, from: now), year: Calendar.current.component(.year, from: now))
        month = saved.month; year = saved.year
        saldeoEmail = next.saldeoEmail
        accountantEmail = next.accountantEmail
        data = nil; loadError = nil; outcome = nil; failure = nil
        invalidateReview()
    }

    func setPeriod(month newMonth: Int, year newYear: Int) {
        guard (1...12).contains(newMonth), (2000...2100).contains(newYear), newMonth != month || newYear != year else { return }
        month = newMonth; year = newYear
        if let companyID { periods[companyID] = (month: month, year: year) }
        data = nil; loadError = nil; outcome = nil; failure = nil
        invalidateReview()
    }

    func step(_ offset: Int) {
        var newMonth = month + offset
        var newYear = year
        if newMonth < 1 { newMonth = 12; newYear -= 1 }
        if newMonth > 12 { newMonth = 1; newYear += 1 }
        setPeriod(month: newMonth, year: newYear)
    }

    /// Każda zmiana danych, odbiorców lub okresu unieważnia sprawdzony pakiet (jak w CRM).
    func invalidateReview() {
        review = nil
        reviewApproved = false
        controlFile = nil
    }

    func checkPin() async {
        guard let companyID else { return }
        pin = .checking
        do {
            struct Reply: Decodable { var configured: Bool }
            let reply = try await get(["op": "pin", "company": companyID], as: Reply.self)
            guard companyID == self.companyID else { return }
            pin = reply.configured ? .ready : .missing
        } catch {
            guard companyID == self.companyID else { return }
            pin = .failed(failureText(error, "Nie można sprawdzić konfiguracji Saldeo."))
        }
    }

    // MARK: Miesiąc
    /// Świeży stan miesiąca. `resetMessages` — jak „Odśwież” w CRM (czyści komunikaty i sprawdzony pakiet).
    func load(resetMessages: Bool = true) async {
        guard companyID != nil else { return }
        loadToken += 1
        let token = loadToken
        let key = loadKey
        if resetMessages { outcome = nil; failure = nil; invalidateReview() }
        if data.map({ "\($0.companyId)|\($0.month)|\($0.year)" }) != key { data = nil }
        loading = true
        defer { if token == loadToken { loading = false } }
        do {
            let fresh = try await get(target.merging(["op": "month"]) { $1 }, as: SaldeoMonth.self)
            guard token == loadToken, key == loadKey else { return }
            data = fresh
            loadError = nil
        } catch {
            guard token == loadToken else { return }
            let text = failureText(error, "Nie można odczytać wszystkich danych miesiąca.")
            if data == nil { loadError = text } else { workspace?.error = text }
        }
    }

    func details(_ key: String) async throws -> SaldeoDetails {
        try await get(target.merging(["op": "details", "key": key]) { $1 }, as: SaldeoDetails.self)
    }

    /// Podgląd pliku pozycji — PDF i obrazy w aplikacji, inne formaty do Pobranych.
    func preview(_ key: String) async -> BankPreviewItem? {
        guard let workspace, let bank = finance?.bank else { return nil }
        do {
            let payload: BankFilePayload = try await workspace.withPending("Pobieranie pliku…") {
                try await get(target.merging(["op": "file", "key": key]) { $1 }, as: BankFilePayload.self)
            }
            guard let raw = payload.data, let content = Data(base64Encoded: raw) else { workspace.error = "Nie udało się odczytać pliku."; return nil }
            return bank.show(BankFile(name: payload.name ?? "plik", mime: payload.mime ?? "application/octet-stream", data: content))
        } catch {
            workspace.error = failureText(error, "Nie można otworzyć pliku.")
            return nil
        }
    }

    /// Poprawa istniejącego opisu z analizy; `nil` — zapisano, inaczej komunikat do okna szczegółów.
    func saveNote(_ details: SaldeoDetails, note: String) async -> String? {
        guard let workspace, let origin = details.origin else { return "Tutaj można tylko poprawić istniejący opis." }
        guard workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        do {
            var body = targetBody
            body["key"] = .string(details.key)
            body["originSource"] = .string(origin.source)
            body["originId"] = .string(origin.id)
            body["original"] = .string(origin.original)
            body["note"] = .string(note)
            struct Reply: Decodable { var message: String }
            // Pakiet unieważniony nawet wtedy, gdy odpowiedź serwera nie dotrze.
            invalidateReview()
            let reply = try await workspace.withPending("Zapisywanie opisu…") { try await post("note", body, as: Reply.self) }
            outcome = reply.message
            workspace.succeed(reply.message)
            await load(resetMessages: false)
            return nil
        } catch {
            return failureText(error, "Nie udało się zapisać opisu.")
        }
    }

    /// „Świadomie wysyłam pozostałe dokumenty — dokument do tego wydatku doślę później” albo „Usuń z listy”.
    func setFollowup(bankId: String, acknowledged: Bool, expected: [String: JSONValue]?) async {
        guard let workspace, followupSaving == nil, !busy else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        followupSaving = bankId
        outcome = nil; failure = nil
        invalidateReview()
        defer { followupSaving = nil }
        do {
            var body = targetBody
            body["bankId"] = .string(bankId)
            body["acknowledged"] = .bool(acknowledged)
            if acknowledged, let expected { body["expected"] = .object(expected) }
            struct Reply: Decodable { var message: String }
            let reply = try await workspace.withPending("Zapisywanie listy „Do dosłania”…") { try await post("followup", body, as: Reply.self) }
            outcome = reply.message
            await load(resetMessages: false)
        } catch {
            failure = failureText(error, "Nie udało się zapisać potwierdzenia braku. Odśwież listę przed ponowieniem.")
        }
    }

    /// „Pobierz rejestr transakcji CSV” albo lista „Dokumenty do dosłania” — plik w Pobranych.
    func exportCsv(_ kind: String) async {
        guard let workspace else { return }
        do {
            struct Reply: Decodable { var filename: String; var content: String }
            let reply = try await workspace.withPending("Przygotowanie pliku CSV…") {
                try await get(target.merging(["op": "csv", "kind": kind]) { $1 }, as: Reply.self)
            }
            _ = try ContractFiles.saveToDownloads(Data(reply.content.utf8), name: reply.filename)
            workspace.succeed("Zapisano „\(reply.filename)” w Pobranych.")
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać pliku CSV.")
        }
    }

    // MARK: Plik kontrolny i paczka
    private var settingsBody: [String: JSONValue] {
        var body = targetBody
        body["emailAccountId"] = .string(emailAccountID)
        body["saldeoEmail"] = .string(saldeoEmail)
        body["accountantEmail"] = .string(accountantEmail)
        return body
    }

    /// „1. Pobierz plik kontrolny” — nic nie jest wysyłane; plik trafia do Pobranych i otwiera się w przeglądarce.
    func prepareReview() async {
        guard let workspace, companyID != nil, !busy else { return }
        guard workspace.canWrite else { workspace.error = "Ta czynność wymaga połączenia z serwerem CRM."; return }
        busy = true
        outcome = nil; failure = nil
        invalidateReview()
        defer { busy = false }
        do {
            let reply = try await workspace.withPending("Pobieram dane do pliku kontrolnego — bez wysyłki…") {
                try await postLong("review", settingsBody, as: SaldeoReviewReply.self)
            }
            review = reply.review
            reviewApproved = false
            outcome = reply.message
            openControlFile()
            // Świeża lista bez czyszczenia komunikatów — nie unieważnia właśnie przygotowanej kontroli.
            await load(resetMessages: false)
        } catch {
            failure = failureText(error, "Nie udało się przygotować pliku kontrolnego.") + "\nŻadna wiadomość nie została wysłana w tym przebiegu."
        }
        if pin != .ready { await checkPin() }
    }

    /// Plik kontrolny w Pobranych, otwarty w domyślnej przeglądarce (ten sam plik przy kolejnym otwarciu).
    func openControlFile() {
        guard let review else { return }
        if let controlFile, FileManager.default.fileExists(atPath: controlFile.path) {
            NSWorkspace.shared.open(controlFile)
            return
        }
        do {
            let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            let base = (review.filename as NSString).deletingPathExtension
            var url = folder.appendingPathComponent(review.filename)
            var copy = 1
            while FileManager.default.fileExists(atPath: url.path) {
                url = folder.appendingPathComponent("\(base) (\(copy)).html")
                copy += 1
            }
            try Data(review.html.utf8).write(to: url)
            controlFile = url
            NSWorkspace.shared.open(url)
        } catch {
            workspace?.error = "Nie udało się zapisać pliku kontrolnego w Pobranych."
        }
    }

    func revealControlFile() {
        if let controlFile { NSWorkspace.shared.activateFileViewerSelecting([controlFile]) }
    }

    /// „Pobierz sprawdzoną paczkę ZIP” — foldery „saldeo” i „ksiegowa”; niczego nie wysyła i nie zmienia historii wysyłek.
    func saveBundle() {
        guard let review, reviewApproved, review.blockers.isEmpty, !busy else { return }
        do {
            var files: [(name: String, data: Data)] = []
            for (index, file) in review.prepared.enumerated() {
                guard let content = Data(base64Encoded: file.content) else { throw SaldeoFailure(message: "Nieprawidłowa zawartość pliku „\(file.filename)”. Przygotuj paczkę ponownie.") }
                files.append(("saldeo/\(SaldeoText.pad(index + 1, 3))-\(SaldeoText.safeFilename(file.filename))", content))
            }
            for (index, file) in review.accountant.enumerated() {
                guard let content = Data(base64Encoded: file.content) else { throw SaldeoFailure(message: "Nieprawidłowa zawartość pliku „\(file.filename)”. Przygotuj paczkę ponownie.") }
                files.append(("ksiegowa/\(SaldeoText.pad(index + 1, 3))-\(SaldeoText.safeFilename(file.filename))", content))
            }
            let instructions = "PACZKA ZA \(SaldeoText.pad(month))/\(year)\nWersja kontroli: \(review.revision)\n\nFolder saldeo: wyłącznie nowe dokumenty spoza KSeF, wcześniej niewysłane z CRM.\nFolder ksiegowa: oryginalne wyciągi i wyłącznie opisy płatności zbiorczych.\n\nZIP służy do pobrania i ręcznego przekazania zawartości. Sam ZIP nie jest formatem importu rozrachunków Saldeo.\nPobranie nie wysyła niczego i nie oznacza dokumentów jako wysłane w CRM. Po ręcznym przekazaniu nie ponawiaj automatycznej wysyłki tych samych plików bez sprawdzenia historii i Saldeo.\nPlik kontrolny oraz wewnętrzne braki, kadry i listy uzgodnień nie są częścią tej paczki.\n\nPLIKI:\n\(files.map(\.name).joined(separator: "\n"))\n"
            files.append(("PRZECZYTAJ.txt", Data(instructions.utf8)))
            let zip = try SaldeoBundle.build(files)
            let name = "saldeo-\(year)-\(SaldeoText.pad(month))-\(review.revision.prefix(8)).zip"
            _ = try ContractFiles.saveToDownloads(zip, name: name)
            failure = nil
            outcome = "Zapisano paczkę sprawdzonych plików „\(name)” w Pobranych. Niczego nie wysłano i nie zmieniono historii wysyłek. Jeśli przekażesz ją ręcznie, nie wysyłaj tych samych plików ponownie z aplikacji ani z CRM bez kontroli w Saldeo."
        } catch {
            failure = failureText(error, "Nie udało się przygotować paczki ZIP.")
        }
    }

    // MARK: Wysyłka
    /// Trasa CRM wysyłki do Saldeo (PIN dodaje serwer). Każdy błąd — wynik niepewny, jak w CRM.
    private func dispatchToSaldeo(_ body: [String: JSONValue]) async throws -> String? {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/integrations/saldeo") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), object["success"]?.flag == true else {
            throw SaldeoFailure(message: "Nie udało się potwierdzić wysyłki do Saldeo.")
        }
        return object["messageId"]?.text.nonEmpty
    }

    private func claim(recipient: String, items: [JSONValue]) async throws -> [SaldeoClaims.Claim] {
        var body: [String: JSONValue] = ["company": .string(companyID ?? ""), "recipient": .string(recipient), "items": .array(items)]
        body["op"] = .string("claim")
        guard let api else { throw AppError.configuration }
        let reply = try JSONDecoder().decode(SaldeoClaims.self, from: try await api.post("/finance/saldeo", body))
        return reply.claimed
    }

    private func complete(_ ids: [String], status: String, messageId: String?) async throws {
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = [
            "op": .string("complete"), "attemptIds": .array(ids.map { .string($0) }), "status": .string(status),
            "messageId": messageId.map { .string($0) } ?? .null,
        ]
        _ = try await api.post("/finance/saldeo", body)
    }

    /// „2. Wyślij sprawdzony pakiet” — jak `processCompleteMonth('send')`: kontrola niezmienności, potem paczki do Saldeo
    /// (rezerwacja → wysyłka → potwierdzenie), na końcu wyciągi i opisy płatności zbiorczych do księgowej.
    func send() async {
        guard let workspace, let api, let review, reviewApproved, review.blockers.isEmpty, !busy, companyID != nil else {
            failure = "Najpierw pobierz plik kontrolny, usuń wskazane blokady i potwierdź sprawdzenie pakietu."
            return
        }
        guard workspace.canWrite else { workspace.error = "Wysyłka wymaga połączenia z serwerem CRM."; return }
        busy = true
        outcome = nil; failure = nil
        var smtpStarted = false
        var sentFiles = 0
        defer { busy = false; workspace.pending = nil }
        do {
            workspace.pending = "Sprawdzam, czy dane nie zmieniły się od kontroli…"
            var body = settingsBody
            body["fingerprint"] = .string(review.fingerprint)
            body["revision"] = .string(review.revision)
            body["createdAt"] = .string(review.createdAt)
            body["reportHash"] = .string(review.reportHash)
            body["sourceChecks"] = .array(review.sourceChecks.map {
                .object(["bucket": .string($0.bucket), "path": .string($0.path), "filename": .string($0.filename), "digest": .string($0.digest)])
            })
            let check = try await postLong("sendCheck", body, as: SaldeoSendCheck.self)
            for (index, batch) in review.batches.enumerated() {
                workspace.pending = "3/4 — Wysyłam paczkę dokumentów do Saldeo \(index + 1)/\(review.batches.count) (\(batch.keys.count) plików)…"
                let files = batch.keys.compactMap { key in review.prepared.first(where: { $0.key == key }) }
                guard files.count == batch.keys.count else { throw SaldeoFailure(message: "Plik nie należy do zatwierdzonej paczki. Przygotuj nowy plik kontrolny.") }
                let items: [JSONValue] = files.map { file in
                    .object([
                        "key": .string("file:\(file.key)"), "kind": .string("saldeo_document"),
                        "metadata": .object([
                            "period_month": .number(Double(month)), "period_year": .number(Double(year)), "source_type": .string(file.source),
                            "source_id": .string(file.sourceId), "saldeo_document_type": .string(batch.type), "filename": .string(file.filename),
                            "reviewed": .bool(true), "control_revision": .string(review.revision), "email_account_id": .string(review.emailAccountId),
                            "content_sha256": .string(file.sha256), "mime_type": .string(file.contentType),
                        ]),
                    ])
                }
                let claims = try await claim(recipient: review.saldeoEmail, items: items)
                if claims.isEmpty { continue }
                let keys = Set(claims.map(\.key))
                let payload = files.filter { keys.contains("file:\($0.key)") }
                smtpStarted = true
                let ids = claims.map(\.id)
                var messageId: String?
                do {
                    messageId = try await dispatchToSaldeo([
                        "companyId": .string(companyID ?? ""), "emailAccountId": .string(review.emailAccountId), "recipient": .string(review.saldeoEmail),
                        "periodMonth": .number(Double(month)), "periodYear": .number(Double(year)), "documentType": .string(batch.type),
                        "controlRevision": .string(review.revision), "attemptIds": .array(ids.map { .string($0) }),
                        "attachments": .array(payload.map { file in
                            .object([
                                "attemptId": .string(claims.first(where: { $0.key == "file:\(file.key)" })?.id ?? ""), "filename": .string(file.filename),
                                "content": .string(file.content), "contentType": .string(file.contentType), "contentDisposition": .string("attachment"),
                            ])
                        }),
                    ])
                } catch {
                    try? await complete(ids, status: "uncertain", messageId: nil)
                    throw SaldeoFailure(message: "Wynik wysyłki wiadomości jest niepewny. Przerwano dalsze wysyłki. Sprawdź pocztę i Saldeo przed ponowieniem; rezerwacja chroni przed duplikatami.")
                }
                do {
                    try await complete(ids, status: "sent", messageId: messageId)
                } catch {
                    throw SaldeoFailure(message: "Serwer pocztowy przyjął wiadomość, ale nie udało się potwierdzić historii w CRM. Nie ponawiaj wysyłki: sprawdź pocztę i odbiór w Saldeo. Dalsze wysyłki zostały zatrzymane.")
                }
                sentFiles += payload.count
            }
            workspace.pending = "4/4 — Wysyłam wyciągi i opisy płatności zbiorczych do księgowej…"
            var reportSent = false
            if !review.accountant.isEmpty {
                let claims = try await claim(recipient: review.accountantEmail, items: [check.accountantItem])
                if !claims.isEmpty {
                    smtpStarted = true
                    let ids = claims.map(\.id)
                    let period = check.period
                    let subject = "Wyciągi\(check.collectiveCount > 0 ? " i płatności zbiorcze" : "") — \(check.companyName) — \(period)"
                    let collective = check.collectiveCount > 0
                        ? " oraz zestawienie \(check.collectiveCount) płatności zbiorczych, z numerami referencyjnymi przelewów i podziałem kwot pomiędzy faktury"
                        : ". W tym okresie nie ma zapisanych powiązań wymagających opisu płatności zbiorczej"
                    let html = "<p>Dzień dobry,</p><p>Przekazuję przygotowany w CRM zestaw za <strong>\(SaldeoText.html(period))</strong>, <strong>\(SaldeoText.html(check.companyName))</strong>.</p>\n"
                        + "        <p>Do Saldeo przekazano w tym przebiegu \(sentFiles) nowych dokumentów spoza KSeF. Nie dołączamy ponownie faktur KSeF ani ich kopii z CRM.</p>\n"
                        + "        <p>W załącznikach: \(check.statementCount) oryginalnych wyciągów bankowych\(collective).</p>\n"
                        + "        <p>Zwykłych płatności, VAT, ZUS i PIT nie opisujemy ponownie — są na wyciągach. Wewnętrzne listy braków i uzgodnień pozostają w CRM.</p>\n"
                        + "        <p><strong>Wysłanie e-maila nie potwierdza przyjęcia dokumentów przez Saldeo. Opisy płatności zbiorczych są załącznikiem do wyciągów, nie importem rozrachunków.</strong></p><p>Pozdrawiam</p>"
                    var messageId: String?
                    do {
                        let reply = try await api.edgeFunction("send-email", connection: workspace.connection, body: [
                            "emailAccountId": .string(review.emailAccountId), "to": .string(review.accountantEmail), "subject": .string(subject), "body": .string(html),
                            "attachments": .array(review.accountant.map { file in
                                .object([
                                    "filename": .string(file.filename), "content": .string(file.content), "contentType": .string(file.contentType),
                                    "contentDisposition": .string("attachment"),
                                ])
                            }),
                        ])
                        messageId = reply["messageId"]?.text.nonEmpty
                    } catch {
                        try? await complete(ids, status: "uncertain", messageId: nil)
                        throw SaldeoFailure(message: "Wynik wysyłki wiadomości jest niepewny. Przerwano dalsze wysyłki. Sprawdź pocztę i Saldeo przed ponowieniem; rezerwacja chroni przed duplikatami.")
                    }
                    do {
                        try await complete(ids, status: "sent", messageId: messageId)
                    } catch {
                        throw SaldeoFailure(message: "Serwer pocztowy przyjął wiadomość, ale nie udało się potwierdzić historii w CRM. Nie ponawiaj wysyłki: sprawdź pocztę i odbiór w Saldeo. Dalsze wysyłki zostały zatrzymane.")
                    }
                    reportSent = true
                }
            }
            invalidateReview()
            let accountantPart = reportSent
                ? "wyciągi i wymagane opisy płatności zbiorczych wysłane do księgowej"
                : !review.accountant.isEmpty ? "identyczne wyciągi i opisy były już wysłane — pominięto duplikat" : "brak wyciągów i opisów do wysłania księgowej"
            let text = "Zakończono przekazanie: \(sentFiles) nowych plików wysłanych e-mailem do Saldeo; \(accountantPart). Odbiór w Saldeo pozostaje niepotwierdzony. Braki i zadania pozostają w CRM."
            outcome = text
            workspace.succeed("Pakiet miesiąca przekazany.")
            workspace.pending = nil
            await load(resetMessages: false)
            Task { await finance?.sync(force: true) }
        } catch {
            if smtpStarted { invalidateReview() }
            failure = failureText(error, "Nie udało się przekazać miesiąca.")
                + (smtpStarted
                    ? "\nZapisanych nowych wysyłek plików: \(sentFiles). Znanych udanych wysyłek CRM nie powtórzy."
                    : "\nŻadna wiadomość nie została wysłana w tym przebiegu.")
            if smtpStarted {
                workspace.pending = nil
                await load(resetMessages: false)
            }
        }
    }
}
