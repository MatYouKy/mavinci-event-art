import Foundation

// MARK: Cenniki sezonowe (`/crm/offers?tab=pricelists`, `PriceListsManager` w CRM; serwer `src/lib/native/priceLists.ts`)
//
// Cena oferty zależy od marki i roku eventu: marka ma cenniki na sezony (szkic → aktywny → archiwum), aktywny cennik podpowiada
// ceny ofert eventów z datą w sezonie, a oferty pamiętają swój cennik (gwarancja ceny). Ekran: lista cenników według marek,
// edytor cen produktów i wariantów, nowy cennik (z cenami z katalogu), kopia na kolejny sezon z podwyżką, zmiana cen o %,
// „Do sprawdzenia” — oferty w toku z cennikiem innym niż sezon terminu, szkice bez cennika i lata z eventami marki bez cennika.

struct PriceListsState: Decodable {
    struct Company: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct Category: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct PriceList: Decodable, Identifiable, Hashable {
        var id: String
        var companyId: String
        var company: String
        var name: String
        var seasonFrom: String
        var seasonTo: String
        var season: String
        var status: String
        var statusLabel: String
        var notes: String
        var entryCount: Int
        var offerCount: Int
    }
    /// „Do sprawdzenia” (`price_list_attention`; opisy z serwera jak w CRM).
    struct Attention: Decodable, Hashable {
        struct Offer: Decodable, Identifiable, Hashable {
            var id: String
            var kind: String
            var date: String
            var title: String
            var text: String
        }
        struct Gap: Decodable, Identifiable, Hashable {
            var id: String
            var companyId: String
            var year: Int
            var events: Int
            var text: String
        }
        var offers: [Offer]
        var missing: [Gap]
        var hint: String
        var isEmpty: Bool { offers.isEmpty && missing.isEmpty }
    }
    var canManage: Bool
    var companies: [Company]
    var categories: [Category]
    var lists: [PriceList]
    /// Starszy serwer albo baza bez migracji — brak (sekcja się nie pokazuje).
    var attention: Attention?
}

struct PriceListEditorData: Decodable {
    struct Row: Decodable, Identifiable, Hashable {
        var key: String
        var productId: String
        var variantId: String?
        var productName: String
        var label: String
        var categoryId: String?
        /// Kategoria główna i dodatkowe (starszy serwer — brak, wtedy sama główna).
        var categoryIds: [String]?
        var category: String?
        var catalogPrice: Double
        var entryId: String?
        var price: Double?
        var inactive: Bool
        var id: String { key }
    }
    var canManage: Bool
    var list: PriceListsState.PriceList
    var rows: [Row]
}

/// Daty sezonu jako „rrrr-mm-dd” (czas polski) i z powrotem.
enum PriceListDates {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func date(_ raw: String) -> Date? { formatter.date(from: String(raw.prefix(10))) }
    /// 1 stycznia i 31 grudnia przyszłego roku (domyślny sezon nowego cennika).
    static var nextYear: (from: Date, to: Date) {
        let year = Calendar.current.component(.year, from: Date()) + 1
        return (date("\(year)-01-01") ?? Date(), date("\(year)-12-31") ?? Date())
    }
}

/// Zaokrąglenia cen jak w CRM (`PRICE_ROUNDING_STEPS`).
enum PriceListRounding {
    static let steps: [Double] = [0.01, 1, 5, 10, 50, 100]
    static func label(_ step: Double) -> String { step == 0.01 ? "do grosza" : "do \(OfferText.number(step)) zł" }
}

@MainActor final class PriceListsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: PriceListsState?
    @Published private(set) var editor: PriceListEditorData?
    @Published var selectedID: String?
    @Published var loadError: String?
    @Published private(set) var loading = false
    @Published private(set) var editorLoading = false
    @Published var editorError: String?

    private var api: NativeAPI? { workspace?.nativeAPI() }
    var canManage: Bool { state?.canManage == true }
    var selected: PriceListsState.PriceList? { selectedID.flatMap { id in state?.lists.first { $0.id == id } } }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    func load() async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        loading = true
        defer { loading = false }
        do {
            state = try JSONDecoder().decode(PriceListsState.self, from: try await api.get("/price-lists?op=state"))
            loadError = nil
            if selectedID == nil || selected == nil {
                selectedID = state?.lists.first { $0.status == "active" }?.id ?? state?.lists.first?.id
            }
            if let selectedID { await loadEditor(selectedID) } else { editor = nil }
        } catch {
            loadError = failureText(error, "Nie udało się pobrać cenników.")
        }
    }

    func select(_ id: String?) async {
        selectedID = id
        if let id { await loadEditor(id) } else { editor = nil }
    }

    func loadEditor(_ id: String) async {
        guard let api else { return }
        editorLoading = true
        defer { editorLoading = false }
        do {
            let data = try JSONDecoder().decode(PriceListEditorData.self, from: try await api.get("/price-lists?op=list&id=\(id)"))
            if selectedID == id { editor = data; editorError = nil }
        } catch {
            if selectedID == id { editorError = failureText(error, "Nie udało się pobrać cen cennika.") }
        }
    }

    /// Zapis zmieniający listę cenników (nowy, ustawienia, status, usunięcie, kopia): odświeżona lista, komunikat, wybór zapisanego.
    @discardableResult func changeList(_ op: String, _ fields: [String: JSONValue], pending: String) async -> Bool {
        struct Reply: Decodable { var savedId: String?; var message: String? }
        guard let data = await send(op, fields, pending: pending) else { return false }
        do {
            state = try JSONDecoder().decode(PriceListsState.self, from: data)
            let reply = try? JSONDecoder().decode(Reply.self, from: data)
            if let saved = reply?.savedId { selectedID = saved }
            if selected == nil { selectedID = state?.lists.first?.id }
            if let message = reply?.message { workspace?.succeed(message) }
            if let selectedID { await loadEditor(selectedID) } else { editor = nil }
            return true
        } catch {
            workspace?.error = "Nie udało się odczytać odpowiedzi serwera."
            return false
        }
    }

    /// Zapis cen (ceny, uzupełnienie z katalogu, zmiana o %): odświeżony edytor, komunikat i liczniki na liście.
    @discardableResult func changePrices(_ op: String, _ fields: [String: JSONValue], pending: String) async -> Bool {
        struct Reply: Decodable { var message: String? }
        guard let data = await send(op, fields, pending: pending) else { return false }
        do {
            editor = try JSONDecoder().decode(PriceListEditorData.self, from: data)
            if let message = (try? JSONDecoder().decode(Reply.self, from: data))?.message { workspace?.succeed(message) }
            if let api, let next = try? JSONDecoder().decode(PriceListsState.self, from: try await api.get("/price-lists?op=state")) { state = next }
            return true
        } catch {
            workspace?.error = "Nie udało się odczytać odpowiedzi serwera."
            return false
        }
    }

    private func send(_ op: String, _ fields: [String: JSONValue], pending: String) async -> Data? {
        guard let api, let workspace, workspace.canWrite else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        var body = fields
        body["op"] = .string(op)
        do {
            return try await workspace.withPending(pending) { try await api.post("/price-lists", body, timeout: 120) }
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać cennika.")
            return nil
        }
    }
}
