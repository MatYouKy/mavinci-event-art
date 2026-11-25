import AppKit
import Foundation
import SwiftUI

// MARK: Oferty — lista (`/crm/offers`) na dysku z synchronizacją i strona oferty (`/crm/offers/[id]`) z serwera
// (`/bridge/native/v1/offers`, `src/lib/native/offers.ts`). Część A: odczyt, status, usuwanie, PDF do podglądu.

struct OfferListItem: Codable, Identifiable, Hashable {
    var id: String
    var number: String
    var title: String?
    var status: String
    var client: String
    var net: Double
    var gross: Double
    var totalAmount: Double
    var validUntil: String?
    var createdAt: String?
    var updatedAt: String?
    var creator: String?
    var eventId: String?
    var inquiryId: String?
    var eventName: String?
    var eventDate: String?
    var seller: Bool
    var search: String
    var phones: [String]

    var numberText: String { number.isEmpty ? "Brak numeru" : number }
    /// „Event” na liście CRM: tytuł oferty albo nazwa wydarzenia.
    var titleText: String { title ?? "-" }
    var statusLabel: String { OfferText.status(status) }
    var validText: String { validUntil.flatMap(OfferText.day) ?? "-" }
    var sortValid: String { validUntil ?? "" }
    var sortCreated: String { createdAt ?? "" }
    var sortTitle: String { title ?? "" }
}

struct OffersState: Codable {
    var hash: String
    var canView: Bool
    var canManage: Bool
    var isAdmin: Bool
    var offers: [OfferListItem]
    var syncedAt: Date?
}

/// Strona oferty z serwera — widok policzony tymi samymi funkcjami co CRM.
struct OfferDetail: Codable {
    struct Head: Codable {
        var id: String
        var number: String
        var title: String
        var status: String
        var seller: Bool
        var eventId: String?
        var inquiryId: String?
        var updatedAt: String?
        var createdAt: String?
        var validUntil: String?
        /// Wersja treści (`content_revision`) — kontrola zapisu pakietów i logistyki.
        var contentRevision: Double?
    }
    struct Source: Codable {
        var kind: String
        var id: String?
        var label: String
    }
    struct Totals: Codable {
        var gross: Double
        var net: Double
        var discountAmount: Double
        var discountPercent: Double
        var taxAmount: Double
        var taxPercent: Double
        var mixedVat: Bool
        /// Suma rabatów pozycji (rabat na ofertę — `discountAmount`); starszy serwer jej nie wysyła.
        var lineDiscountAmount: Double?
    }
    struct Generated: Codable {
        var name: String
        var at: String
    }
    struct Basic: Codable {
        var title: String
        var titleInherited: Bool
        var clientType: String
        var organization: String
        var legalName: String?
        var contactName: String
        var contactEmail: String?
        var contactPhone: String?
        var sellerDescription: String?
        var eventLabel: String
        var audience: String
        var guestCount: Double?
        var pricingSource: String
        var calculation: String?
        var hero: String
        var heroPath: String?
        var heroUrl: String?
        var heroAlt: String?
        /// „Tło ofert” miejsca wydarzenia — okładka oferty bez własnej grafiki (`heroPath` — tylko własna grafika oferty).
        var venueBackgroundPath: String?
        var venueBackgroundUrl: String?
        /// Okładka bez tła miejsca: co zrobić (lokalizacja bez tła / miejsce wpisane ręcznie), lokalizacja miejsca (do otwarcia)
        /// i lokalizacja pasująca do wpisanego miejsca (do powiązania jednym kliknięciem).
        var venueHint: String?
        var venueLocationId: String?
        var venueSuggestion: VenueSuggestion?
        var start: String
        var end: String
        var location: String
        var totals: Totals
        var lastGenerated: Generated?
        var notes: String?
        /// Okładka do podglądu: własna grafika oferty, a bez niej „Tło ofert” miejsca wydarzenia.
        var coverImage: (path: String, url: String)? {
            if let heroPath { return heroUrl.map { (path: heroPath, url: $0) } }
            guard let venueBackgroundPath, let venueBackgroundUrl else { return nil }
            return (path: venueBackgroundPath, url: venueBackgroundUrl)
        }
    }
    struct Assumption: Codable, Hashable {
        var key: String
        var badge: String
        var label: String
        var detail: String
    }
    struct Assumptions: Codable {
        var items: [Assumption]
        var legacy: String
        var goal: String
        var guestNote: String?
    }
    struct Layout: Codable, Hashable {
        var print: String
        var stage: Bool
        var hasAddons: Bool
        var hasPackages: Bool
        var blockedByElements: Bool
        var hasProductVariants: Bool
        var showsVariantComparison: Bool
        var showVariants: Bool
        var showVariantPrices: Bool
    }
    struct AddonRow: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var quantity: Double
        var unit: String
        var days: Double
        var unitPrice: Double
        var subtotal: Double
    }
    struct Item: Codable, Identifiable, Hashable {
        var id: String
        var order: Double
        var productId: String?
        var name: String
        var description: String
        var variantName: String?
        var baseProduct: String?
        var quantity: Double
        var unit: String
        var days: Double
        var unitPrice: Double
        var unitGross: Double
        var discountPercent: Double
        var discountAmount: Double
        var subtotal: Double
        var net: Double
        var gross: Double
        var imagePath: String?
        var imageUrl: String?
        var layout: Layout
        var addons: [AddonRow]
    }
    struct SummaryRow: Codable, Hashable {
        var label: String
        var net: Double
        var gross: Double
        var emphasis: Bool?
    }
    struct Discount: Codable {
        var listNet: Double
        var taxPercent: Double
        var amount: Double
        var percent: Double
        var logisticsNet: Double
        /// Rabaty pozycji — podstawa rabatu na ofertę (`listNet`) jest już po nich.
        var lineDiscountNet: Double?
        /// Jak klient widzi rabat w PDF: `lines` | `total` | `none` (starszy serwer — brak, czyli `lines`).
        var display: String?
    }
    struct Summary: Codable {
        var rows: [SummaryRow]
        var vat: String
        var logisticsNote: String?
        /// Rabat łączny, gdy oferta ma rabaty pozycji i rabat na ofertę.
        var discountNote: String?
        var calculation: Bool
        var discount: Discount
    }
    struct HistoryEntry: Codable, Identifiable, Hashable {
        var id: String
        var type: String
        var description: String
        var at: String?
        var author: String?
    }
    struct ContextItem: Codable, Hashable {
        var label: String
        var value: String
        var kind: String
    }
    struct Inquiry: Codable {
        var id: String
        var title: String
        var message: String?
        var source: String
        var client: String?
        var email: String?
        var phone: String?
        var receivedEmailId: String?
        var contactMessageId: String?
        var items: [ContextItem]
    }
    /// Szkic wcześniej zaakceptowanej oferty: wersja treści z zapisanym uzasadnieniem aktualizacji.
    struct DraftRevision: Codable {
        var savedRevision: Double?
    }
    /// Lokalizacja z bazy pasująca do miejsca wpisanego w ofercie.
    struct VenueSuggestion: Codable {
        var id: String
        var name: String
    }
    struct PdfFile: Codable {
        var exists: Bool
        var stale: Bool
        var fileName: String
    }
    struct Pdf: Codable {
        var exists: Bool
        var stale: Bool
        /// Po wygenerowaniu PDF zmieniono „Tło ofert” miejsca oferty (PDF nieaktualny także z tego powodu).
        var venueNote: String?
        var fileName: String
        /// Ostatni PDF w wersji angielskiej (`offer_language_documents`).
        var en: PdfFile?
    }
    var canView: Bool
    var canManage: Bool
    var canEdit: Bool
    var offer: Head
    var source: Source?
    var basic: Basic
    var assumptions: Assumptions
    var vatRate: Double
    var items: [Item]
    var summary: Summary
    var history: [HistoryEntry]
    var updatedAfterAcceptance: String?
    var inquiry: Inquiry?
    var pdf: Pdf
    var amendmentSource: String?
    var draftRevision: DraftRevision?
    /// Cennik sezonowy oferty: pasek „Cennik: …” nad pozycjami i „Przelicz według cennika…” (starszy serwer — brak).
    var seasonPrices: OfferPriceNotice?
    /// Akceptacja rabatu ponad limit (`src/lib/CRM/Offers/offerApproval.ts`) — sekcja w „Informacjach”; brak — nic do pokazania.
    var approval: Approval?

    /// Stan akceptacji rabatu i marży (progi `sales_offer_guardrails`) — teksty liczy serwer, jak karta „Informacje” w CRM.
    struct Approval: Codable, Equatable {
        struct Note: Codable, Equatable {
            var label: String
            var text: String
        }
        /// `success` | `pending` | `warning` | `info`.
        var tone: String
        var title: String
        var reasons: [String]
        var note: Note?
        var meta: String?
        var hint: String?
        var canRequest: Bool
        var canApprove: Bool
        var canReject: Bool
        var approveLabel: String
        /// Wysyłka oferty zablokowana do akceptacji (przycisk „Wyślij ofertę” wyłączony).
        var blocksSending: Bool
        var notePlaceholder: String
    }
}

enum OfferText {
    static let statuses: [(key: String, label: String)] = [
        ("draft", "Szkic"), ("sent", "Wysłana"), ("accepted", "Zaakceptowana"), ("rejected", "Odrzucona"), ("expired", "Wygasła"),
    ]
    static func status(_ key: String) -> String { statuses.first { $0.key == key }?.label ?? key }
    /// Kolory statusu jak w CRM (lista: wygasła szara; strona oferty: wygasła pomarańczowa).
    static func color(_ status: String, page: Bool = false) -> Color {
        switch status {
        case "sent": return .blue
        case "accepted": return .green
        case "rejected": return .red
        case "expired": return page ? .orange : .gray
        default: return .gray
        }
    }
    private static let fixed: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()
    private static let total: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter
    }()
    static func amount(_ value: Double) -> String { fixed.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value) }
    /// „1 230,00 zł”.
    static func money(_ value: Double) -> String { amount(value) + " zł" }
    /// „1 230,00 PLN” (strona oferty).
    static func pln(_ value: Double) -> String { amount(value) + " PLN" }
    /// „Łączna wartość” na liście (jak `toLocaleString('pl-PL')`).
    static func sum(_ value: Double) -> String { (total.string(from: NSNumber(value: value)) ?? String(value)) + " zł" }
    static func number(_ value: Double) -> String { total.string(from: NSNumber(value: value)) ?? String(value) }
    /// Kwota do pola edycji: „1234,50” (bez separatora tysięcy).
    static func plainAmount(_ value: Double) -> String { String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",") }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    static func date(_ raw: String) -> Date? {
        if raw.count == 10, let date = dayFormatter.date(from: raw) { return date }
        return MeetingDates.parse(raw)
    }
    /// „1.12.2026” (jak `toLocaleDateString('pl-PL')`).
    static func day(_ raw: String) -> String? { date(raw).map { MeetingDates.format($0, "d.MM.yyyy") } }
    /// „1.12.2026, 18:00” (jak `toLocaleString('pl-PL')`).
    static func dayTime(_ raw: String?) -> String {
        guard let raw, let date = date(raw) else { return "-" }
        return MeetingDates.format(date, "d.MM.yyyy, HH:mm")
    }
    /// „1 grudnia 2026 o 18:00” (ostatnie wygenerowanie PDF).
    static func long(_ raw: String) -> String {
        guard let date = date(raw) else { return raw }
        return MeetingDates.format(date, "d MMMM yyyy, HH:mm")
    }
    /// Wyszukiwanie jak `matchesOfferSearch`: każde słowo w numerze, tytule, wydarzeniu lub danych klienta; numer telefonu cyframi.
    static func matches(_ item: OfferListItem, _ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let terms = SearchText.fold(trimmed).split(separator: " ").map(String.init)
        if terms.isEmpty { return true }
        let digits = trimmed.filter(\.isNumber)
        let phoneLike = trimmed.allSatisfy { $0.isNumber || " +().-".contains($0) }
        if phoneLike && digits.count >= 3 && item.phones.contains(where: { $0.contains(digits) }) { return true }
        return terms.allSatisfy { item.search.contains($0) }
    }
}

@MainActor final class OffersStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: OffersState?
    @Published var syncing = false
    @Published var loadError: String?
    @Published var selectedID: String?
    /// Strona oferty otwarta na ekranie Ofert (zamiast listy).
    @Published var openedID: String?
    @Published private(set) var details: [String: OfferDetail] = [:]
    @Published var detailErrors: [String: String] = [:]

    private var namespace: String?
    private var file: SealedFile<OffersState>?
    private var syncTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var offers: [OfferListItem] { state?.offers ?? [] }
    var loaded: Bool { state != nil }
    func offer(_ id: String?) -> OfferListItem? { id.flatMap { id in offers.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<OffersState>(namespace: "offers-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if state == nil, let saved { state = saved }
        }
    }

    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); syncTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; state = nil; syncing = false; loadError = nil
        selectedID = nil; openedID = nil; details = [:]; detailErrors = [:]
    }

    // MARK: Synchronizacja
    func sync(force: Bool = false) async {
        if let syncTask {
            await syncTask.value
            if !force { return }
        }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }

    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        await sync()
    }

    private func performSync() async {
        guard let api else { return }
        syncing = true
        defer { syncing = false }
        do {
            var next = try JSONDecoder().decode(OffersState.self, from: try await api.get("/offers?op=state"))
            next.syncedAt = Date()
            if state?.hash != next.hash { state = next } else { state?.syncedAt = next.syncedAt }
            loadError = nil
            if let file, let snapshot = state {
                await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
            }
        } catch {
            if state == nil { loadError = failureText(error, "Nie udało się pobrać ofert.") }
        }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    private func writable(_ text: String) -> (NativeAPI, Workspace)? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = text
            return nil
        }
        return (api, workspace)
    }

    // MARK: Strona oferty
    func loadDetail(_ id: String) async {
        guard let api else { return }
        do {
            details[id] = try JSONDecoder().decode(OfferDetail.self, from: try await api.get("/offers?op=offer&id=\(id)"))
            detailErrors[id] = nil
        } catch {
            detailErrors[id] = failureText(error, "Nie udało się pobrać oferty")
        }
    }

    /// Zmiana treści oferty (część B): serwer zwraca odświeżoną stronę oferty; lista synchronizuje się w tle.
    @discardableResult func change(_ id: String, _ op: String, _ fields: [String: JSONValue], pending: String = "Zapisywanie…",
                                   success: String, timeout: TimeInterval? = nil) async -> Bool {
        guard case let (api, workspace)? = writable("Zapis wymaga połączenia z serwerem CRM.") else { return false }
        var body = fields
        body["op"] = .string(op)
        body["id"] = .string(id)
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/offers", body, timeout: timeout) }
            details[id] = try JSONDecoder().decode(OfferDetail.self, from: data)
            workspace.succeed(success)
            Task { await sync(force: true) }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    /// Status z listy „Status oferty” (bez akceptacji — ta ma osobną ścieżkę).
    @discardableResult func setStatus(_ id: String, _ status: String) async -> Bool {
        guard case let (api, workspace)? = writable("Zmiana statusu wymaga połączenia z serwerem CRM.") else { return false }
        do {
            let body: [String: JSONValue] = ["op": .string("status"), "id": .string(id), "status": .string(status)]
            let data = try await workspace.withPending("Zmiana statusu…") { try await api.post("/offers", body) }
            details[id] = try JSONDecoder().decode(OfferDetail.self, from: data)
            workspace.succeed("Status oferty zmieniony na: \(OfferText.status(status))")
            Task { await sync(force: true) }
            return true
        } catch {
            workspace.error = failureText(error, "Błąd podczas zmiany statusu")
            return false
        }
    }

    func delete(_ id: String) async -> Bool {
        guard case let (api, workspace)? = writable("Usunięcie wymaga połączenia z serwerem CRM.") else { return false }
        do {
            _ = try await workspace.withPending("Usuwanie oferty…") { try await api.post("/offers", ["op": .string("delete"), "id": .string(id)]) }
            if openedID == id { openedID = nil }
            if selectedID == id { selectedID = nil }
            details[id] = nil
            await sync(force: true)
            workspace.succeed("Oferta i wszystkie pliki zostały usunięte")
            return true
        } catch {
            workspace.error = failureText(error, "Błąd podczas usuwania oferty")
            return false
        }
    }

    /// Zapisany PDF oferty (`language`: `pl` albo `en`): `open` — podgląd w domyślnej aplikacji, inaczej zapis w Pobranych.
    /// Zapisany PDF oferty (podpisany adres z serwera i pobranie pliku).
    private func pdfFile(_ id: String, language: String, pending: String) async throws -> (data: Data, name: String) {
        guard let api, let workspace else { throw AppError.configuration }
        struct Link: Decodable { let url: String; let name: String }
        return try await workspace.withPending(pending) { () async throws -> (data: Data, name: String) in
            let link = try JSONDecoder().decode(Link.self, from: try await api.get("/offers?op=pdf&id=\(id)&language=\(language)"))
            guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
            let result = try await URLSession.shared.data(from: url)
            guard (result.1 as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
            return (result.0, link.name)
        }
    }

    /// „Pokaż PDF” — plik do podglądu w oknie aplikacji (`OfferPdfViewer`).
    func pdfPreview(_ id: String, language: String = "pl") async -> OfferPdfPreview? {
        do {
            let file = try await pdfFile(id, language: language, pending: "Otwieranie PDF…")
            return OfferPdfPreview(data: file.data, name: file.name)
        } catch {
            workspace?.error = failureText(error, "Błąd podczas otwierania PDF")
            return nil
        }
    }

    /// „Pobierz PDF” — zapis w Pobranych.
    func downloadPdf(_ id: String, language: String = "pl") async {
        do {
            let file = try await pdfFile(id, language: language, pending: "Pobieranie PDF…")
            _ = try ContractFiles.saveToDownloads(file.data, name: file.name)
            workspace?.succeed("Pobieranie PDF...")
        } catch {
            workspace?.error = failureText(error, "Błąd podczas pobierania PDF")
        }
    }
}

extension Workspace {
    /// Strona oferty na ekranie Ofert (z pulpitu, zapytania, powiadomienia, karty wydarzenia); bez dostępu — strona w CRM.
    func showOffer(_ id: String) {
        guard UUID(uuidString: id) != nil else { return }
        guard employee?.canView(.offers) == true else { openCRM("/crm/offers/\(id)"); return }
        switchSection(.offers)
        offers.selectedID = id
        offers.openedID = id
    }

    /// Karta produktu z katalogu (pozycja oferty).
    func showProduct(_ id: String) {
        guard UUID(uuidString: id) != nil else { return }
        guard let item = navigation.flatMap(\.flattened).first(where: { $0.screen == .products }) else {
            openCRM("/crm/offers/products/\(id)"); return
        }
        openHref(item.href)
        products.selectedID = id
        products.openedID = id
    }
}
