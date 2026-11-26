import Foundation
import SwiftUI

// MARK: Rental → Wypożyczenia klientom — modele odpowiedzi `/bridge/native/v1/rental` (`src/lib/native/rental.ts`, funkcje bazy
// `rental_*`, `docs/rental.md`). Klucze JSON w snake_case (dekoder `ClientRentalJSON.decoder`). Pola sprzedaży (ceny, kaucja,
// rozliczenie) przychodzą tylko osobom ze sprzedaży — opcjonalne.

enum ClientRentalJSON {
    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

enum ClientRentalStatus: String, Codable, CaseIterable, Identifiable {
    case draft, reserved, issued, returned, settled, cancelled
    var id: String { rawValue }
    var label: String {
        switch self {
        case .draft: return "Szkic"
        case .reserved: return "Zarezerwowane"
        case .issued: return "Wydane"
        case .returned: return "Zwrócone"
        case .settled: return "Rozliczone"
        case .cancelled: return "Anulowane"
        }
    }
    var color: Color {
        switch self {
        case .draft: return .secondary
        case .reserved: return CrmTheme.rgb(0x7dd3fc)
        case .issued: return CrmTheme.rgb(0xd3bb73)
        case .returned: return CrmTheme.rgb(0x6ee7b7)
        case .settled: return CrmTheme.rgb(0x34d399)
        case .cancelled: return CrmTheme.rgb(0xfca5a5)
        }
    }
}

struct ClientRentalAccess: Decodable, Equatable {
    var create = false
    var salesView = false
    var salesManage = false
    var salesAll = false
    var warehouseView = false
    var warehouseAct = false
    var admin = false
    var own = false
    var employeeId: String?
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        create = (try? c.decode(Bool.self, forKey: .create)) ?? false
        salesView = (try? c.decode(Bool.self, forKey: .salesView)) ?? false
        salesManage = (try? c.decode(Bool.self, forKey: .salesManage)) ?? false
        salesAll = (try? c.decode(Bool.self, forKey: .salesAll)) ?? false
        warehouseView = (try? c.decode(Bool.self, forKey: .warehouseView)) ?? false
        warehouseAct = (try? c.decode(Bool.self, forKey: .warehouseAct)) ?? false
        admin = (try? c.decode(Bool.self, forKey: .admin)) ?? false
        own = (try? c.decode(Bool.self, forKey: .own)) ?? false
        employeeId = try? c.decode(String.self, forKey: .employeeId)
    }
    private enum Keys: String, CodingKey { case create, salesView, salesManage, salesAll, warehouseView, warehouseAct, admin, own, employeeId }
}

struct ClientRentalTotals: Decodable, Equatable {
    var linesNet: Double
    var discountAmount: Double
    var rentalNet: Double
    var chargesNet: Double
    var net: Double
    var vat: Double
    var gross: Double
    var deposit: Double
    var depositReturned: Double?
}

struct ClientRentalListRow: Decodable, Identifiable, Equatable {
    struct Sales: Decodable, Equatable { var totals: ClientRentalTotals }
    var id: String
    var number: String
    var status: ClientRentalStatus
    var title: String
    var clientName: String
    var startsAt: String
    var endsAt: String
    var handover: String
    var sellerName: String?
    var itemsCount: Int
    var quantity: Int
    var outQty: Int
    var openIssues: Int
    var overdue: Bool
    var sales: Sales?

    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || "\(number) \(title) \(clientName)".lowercased().contains(q)
    }
}

struct ClientRentalItem: Decodable, Identifiable, Equatable {
    var id: String
    var position: Int
    var kind: String
    var equipmentId: String?
    var kitId: String?
    var kitName: String?
    var name: String
    var quantity: Int
    var unit: String
    var note: String?
    var thumbnailUrl: String?
    var storageLocation: String?
    var hasUnits: Bool
    var issuedQty: Int
    var returnedOkQty: Int
    var returnedDamagedQty: Int
    var returnedMissingQty: Int
    var damagedBackQty: Int
    var damagedOutQty: Int
    var missingBackQty: Int
    var missingOutQty: Int
    var outQty: Int
    var openDamaged: Int
    var openMissing: Int
    // Tylko sprzedaż:
    var priceMode: String?
    var unitPrice: Double?
    var days: Double?
    var discountPercent: Double?
    var replacementValue: Double?
    var lineNet: Double?

    var isEquipment: Bool { kind == "equipment" }
    /// Sztuki, które wróciły na stan albo z niego zeszły (nie zajmują magazynu w terminie wypożyczenia).
    var settled: Int { returnedOkQty + damagedBackQty + damagedOutQty + missingBackQty + missingOutQty }
}

struct ClientRentalTrip: Decodable, Identifiable, Equatable {
    var id: String
    var kind: String
    var vehicleId: String?
    var vehicleName: String?
    var driverId: String?
    var driverName: String?
    var startsAt: String
    var endsAt: String
    var note: String?
    var label: String { kind == "delivery" ? "Dostawa do klienta" : "Odbiór od klienta" }
}

struct ClientRentalProtocolLine: Decodable, Equatable {
    var itemId: String
    var name: String
    var unit: String
    var qty: Int
    var damaged: Int
    var missing: Int
    var note: String?
    var photos: [String]
}

struct ClientRentalProtocol: Decodable, Identifiable, Equatable {
    var id: String
    var kind: String
    var seq: Int
    var number: String
    var personName: String
    var note: String?
    var createdAt: String
    var createdByName: String?
    var lines: [ClientRentalProtocolLine]
    var isIssue: Bool { kind == "issue" }
}

struct ClientRentalFile: Decodable, Identifiable, Equatable {
    var id: String
    var protocolId: String?
    var area: String
    var kind: String
    var storagePath: String
    var fileName: String
    var mimeType: String?
    var sizeBytes: Int?
    var uploadedByName: String?
    var createdAt: String
}

struct ClientRentalLogEntry: Decodable, Equatable {
    var area: String
    var action: String
    var details: [String: JSONValue]?
    var note: String?
    var actorName: String?
    var createdAt: String

    static let labels: [String: String] = [
        "created": "Utworzono wypożyczenie", "updated": "Zmieniono dane", "items": "Zmieniono pozycje", "reserved": "Zarezerwowano sprzęt",
        "unreserved": "Cofnięto rezerwację", "cancelled": "Anulowano", "issued": "Wydano sprzęt", "returned": "Przyjęto zwrot (całość)",
        "returned_partly": "Przyjęto zwrot częściowy", "damaged_back": "Uszkodzone — sprawne, wraca na stan", "damaged_service": "Uszkodzone — do serwisu",
        "damaged_write_off": "Uszkodzone — spisane ze stanu", "missing_back": "Brak — oddane później", "missing_write_off": "Brak — spisane ze stanu",
        "charges": "Zmieniono naliczenia", "settled": "Rozliczono", "unsettled": "Cofnięto rozliczenie", "trips": "Zmieniono dostawę / odbiór",
        "warehouse_note": "Zmieniono uwagi magazynu", "invoice_linked": "Dołączono fakturę", "invoice_unlinked": "Odłączono fakturę",
        "file_added": "Dodano plik", "file_removed": "Usunięto plik",
    ]
    var label: String {
        let base = Self.labels[action] ?? action
        if let protocolNumber = details?["protocol"]?.text, !protocolNumber.isEmpty { return "\(base) · \(protocolNumber)" }
        return base
    }
}

struct ClientRentalCharge: Decodable, Identifiable, Equatable {
    var id: String?
    var itemId: String?
    var kind: String
    var description: String
    var amount: Double
    var createdAt: String?
    static let kinds: [(String, String)] = [("damage", "Uszkodzenie"), ("missing", "Brak"), ("late", "Opóźniony zwrot"), ("cleaning", "Czyszczenie"), ("other", "Inne")]
}

struct ClientRentalInvoice: Decodable, Identifiable, Equatable {
    var invoiceId: String
    var kind: String
    var invoiceNumber: String
    var status: String
    var totalGross: Double
    var id: String { invoiceId }
    static let kinds: [(String, String)] = [("rental", "Za wypożyczenie"), ("deposit", "Kaucja"), ("charges", "Naliczenia")]
}

struct ClientRentalSales: Decodable, Equatable {
    var discountPercent: Double
    var vatRate: Double
    var depositAmount: Double
    var depositReceivedAt: String?
    var depositReturnedAmount: Double?
    var depositSettledAt: String?
    var salesNote: String?
    var totals: ClientRentalTotals
    var charges: [ClientRentalCharge]
    var invoices: [ClientRentalInvoice]
}

struct ClientRentalDetail: Decodable, Identifiable, Equatable {
    var id: String
    var number: String
    var status: ClientRentalStatus
    var title: String
    var clientName: String
    var organizationId: String?
    var contactId: String?
    var organizationName: String?
    var contactName: String?
    var recipientName: String?
    var recipientPhone: String?
    var startsAt: String
    var endsAt: String
    var defaultDays: Double
    var handover: String
    var deliveryAddress: String?
    var myCompanyId: String?
    var myCompanyName: String?
    var sellerId: String?
    var sellerName: String?
    var warehouseNote: String?
    var cancelReason: String?
    var createdAt: String
    var updatedAt: String
    var overdue: Bool
    var access: ClientRentalAccess
    var items: [ClientRentalItem]
    var trips: [ClientRentalTrip]
    var protocols: [ClientRentalProtocol]
    var files: [ClientRentalFile]
    var log: [ClientRentalLogEntry]
    var sales: ClientRentalSales?

    var issues: [ClientRentalItem] { items.filter { $0.openDamaged + $0.openMissing > 0 } }
    var equipment: [ClientRentalItem] { items.filter(\.isEquipment) }
}

struct ClientRentalConflict: Decodable, Equatable, Hashable {
    var type: String
    var id: String
    var name: String
    var startsAt: String
    var endsAt: String?
    var qty: Int?
}

struct ClientRentalAvailability: Decodable, Equatable {
    var equipmentId: String
    var name: String
    var required: Int
    var stock: Int
    var events: Int
    var rentals: Int
    var available: Int
    var shortage: Int
    var conflicts: [ClientRentalConflict]
}

// MARK: Katalog magazynu (`op=stock` → `rental_catalog`): okno zajęcia, kategorie, sprzęt i zestawy z wolnymi sztukami

struct ClientRentalCatalog: Decodable, Equatable {
    /// Okno zajęcia magazynu: od wyjazdu sprzętu (wydanie / dostawa) do powrotu (zwrot / odbiór).
    struct Window: Decodable, Equatable { var startsAt: String; var endsAt: String }
    var window: Window
    var categories: [ClientRentalCatalogCategory]
    var items: [ClientRentalCatalogItem]
    var kits: [ClientRentalCatalogKit]
}

struct ClientRentalCatalogCategory: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var parentId: String?
    var level: Int?
    var orderIndex: Int?
}

struct ClientRentalCatalogItem: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var brand: String?
    var model: String?
    var categoryId: String?
    var thumbnailUrl: String?
    /// Cena za dobę z katalogu — tylko sprzedaż.
    var price: Double?
    /// Stan sprawny.
    var stock: Int
    /// Najwięcej sztuk zajętych naraz w oknie przez eventy i inne wypożyczenia.
    var busy: Int
    /// Wolne w oknie (bez pozycji tego wypożyczenia) — ile łącznie może mieć to wypożyczenie.
    var available: Int
    var detail: String { [brand, model].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ") }
}

struct ClientRentalCatalogKit: Decodable, Identifiable, Equatable {
    struct Component: Decodable, Equatable { var equipmentId: String; var quantity: Int; var name: String }
    var id: String
    var name: String
    var categoryId: String?
    var thumbnailUrl: String?
    /// Ile kompletów da się złożyć z wolnych składników.
    var available: Int
    var components: [Component]
    var summary: String { components.map { "\($0.quantity)× \($0.name)" }.joined(separator: ", ") }
}

/// Kategoria w kolejności drzewa (filtr katalogu).
struct ClientRentalCategoryNode: Identifiable, Equatable {
    var category: ClientRentalCatalogCategory
    var depth: Int
    var id: String { category.id }
}

/// Pozycja formularza w liczeniu zapotrzebowania (`settled` — sztuki, które już nie zajmują magazynu).
struct ClientRentalDemandLine: Equatable {
    var kind: String
    var equipmentID: String?
    var kitID: String?
    var quantity: Int
    var settled: Int
}

/// Katalog: kategorie, wyszukiwanie i wolne sztuki — jak `rentalCategoryPaths`, `rentalLinesDemand`, `rentalKitFree` we wspólnym
/// `src/lib/CRM/rental/rental.ts` (CRM i telefon).
enum ClientRentalCatalogLogic {
    /// Ścieżka kategorii „Nadrzędna › Podrzędna”.
    static func paths(_ categories: [ClientRentalCatalogCategory]) -> [String: String] {
        let byID = Dictionary(categories.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var paths: [String: String] = [:]
        func path(_ id: String, _ seen: Set<String>) -> String {
            if let cached = paths[id] { return cached }
            guard let category = byID[id] else { return "" }
            var parent = ""
            if let parentID = category.parentId, !seen.contains(parentID) { parent = path(parentID, seen.union([id])) }
            let value = parent.isEmpty ? category.name : "\(parent) › \(category.name)"
            paths[id] = value
            return value
        }
        for category in categories { _ = path(category.id, []) }
        return paths
    }

    /// Kategoria z wszystkimi podrzędnymi.
    static func scope(_ categories: [ClientRentalCatalogCategory], _ id: String) -> Set<String> {
        var scope: Set<String> = [id]
        var grew = true
        while grew {
            grew = false
            for category in categories where !scope.contains(category.id) {
                if let parent = category.parentId, scope.contains(parent) { scope.insert(category.id); grew = true }
            }
        }
        return scope
    }

    /// Kategorie w kolejności drzewa z głębokością (lista wyboru filtra).
    static func tree(_ categories: [ClientRentalCatalogCategory]) -> [ClientRentalCategoryNode] {
        let ids = Set(categories.map(\.id))
        var children: [String: [ClientRentalCatalogCategory]] = [:]
        for category in categories {
            let parent = category.parentId.flatMap { ids.contains($0) ? $0 : nil } ?? ""
            children[parent, default: []].append(category)
        }
        func ordered(_ list: [ClientRentalCatalogCategory]) -> [ClientRentalCatalogCategory] {
            list.sorted {
                let a = $0.orderIndex ?? Int.max, b = $1.orderIndex ?? Int.max
                return a != b ? a < b : $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
        }
        var result: [ClientRentalCategoryNode] = []
        func visit(_ parent: String, _ depth: Int, _ seen: Set<String>) {
            for category in ordered(children[parent] ?? []) where !seen.contains(category.id) {
                result.append(ClientRentalCategoryNode(category: category, depth: depth))
                visit(category.id, depth + 1, seen.union([category.id]))
            }
        }
        visit("", 0, [])
        return result
    }

    /// Każde słowo wyszukiwania w nazwie, marce, modelu albo kategorii (bez polskich znaków i wielkości liter).
    static func matches(_ query: String, _ fields: [String?]) -> Bool {
        func fold(_ text: String) -> String {
            text.replacingOccurrences(of: "ł", with: "l").replacingOccurrences(of: "Ł", with: "L")
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL")).lowercased()
        }
        let words = fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return true }
        let haystack = fold(fields.compactMap { $0 }.joined(separator: " "))
        return words.allSatisfy { haystack.contains($0) }
    }

    /// Sztuki sprzętu zajęte przez pozycje: sprzęt (bez tego, co wróciło albo zeszło ze stanu) i zestawy nierozpisane (wg składu).
    static func demand(_ lines: [ClientRentalDemandLine], kits: [ClientRentalCatalogKit]) -> [String: Int] {
        let kitByID = Dictionary(kits.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var demand: [String: Int] = [:]
        func add(_ id: String, _ qty: Int) { if qty > 0 { demand[id, default: 0] += qty } }
        for line in lines where line.kind == "equipment" {
            if let equipment = line.equipmentID { add(equipment, line.quantity - line.settled) }
            else if let kit = line.kitID { for part in kitByID[kit]?.components ?? [] { add(part.equipmentId, part.quantity * line.quantity) } }
        }
        return demand
    }

    /// Ile kompletów zestawu można jeszcze dodać przy obecnych pozycjach (składnik spoza katalogu — niedostępny).
    static func kitFree(_ kit: ClientRentalCatalogKit, items: [String: ClientRentalCatalogItem], demand: [String: Int]) -> Int {
        guard !kit.components.isEmpty else { return 0 }
        return max(0, kit.components.map { part -> Int in
            guard let item = items[part.equipmentId], part.quantity > 0 else { return 0 }
            return max(0, item.available - (demand[part.equipmentId] ?? 0)) / part.quantity
        }.min() ?? 0)
    }
}

struct ClientRentalUnit: Decodable, Identifiable, Equatable {
    var id: String
    var serial: String?
    var status: String
    var location: String?
}

struct ClientRentalOption: Decodable, Identifiable, Hashable { var id: String; var name: String }

struct ClientRentalClientHit: Decodable, Identifiable, Equatable {
    var kind: String
    var id: String
    var name: String
}

struct ClientRentalInvoiceHit: Decodable, Identifiable, Equatable {
    var id: String
    var invoiceNumber: String
    var totalGross: Double
}

// MARK: Formatowanie (czas polski, kwoty)

enum ClientRentalFormat {
    static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    private static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let isoPlain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let date = iso.date(from: raw) ?? isoPlain.date(from: raw) { return date }
        // Ułamki sekund z bazy (mikrosekundy, np. czas wydania) — bez nich.
        return isoPlain.date(from: raw.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
    }
    static func string(_ date: Date) -> String { isoPlain.string(from: date) }
    static func dateTime(_ raw: String?) -> String {
        guard let date = date(raw) else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateFormat = "dd.MM.yyyy HH:mm"
        return f.string(from: date)
    }
    static func money(_ value: Double?) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2
        return (f.string(from: NSNumber(value: value ?? 0)) ?? "0,00") + " zł"
    }
    static func number(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "").trimmingCharacters(in: .whitespaces)
        return clean.isEmpty ? nil : Double(clean)
    }
    static func plain(_ value: Double?) -> String {
        guard let value else { return "" }
        return value == value.rounded() ? String(Int(value)) : String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
    /// Wartość netto pozycji jak w bazie: cena × ilość × doby (albo ryczałt) × (1 − rabat).
    static func lineNet(price: Double?, quantity: Int, mode: String, days: Double?, defaultDays: Double, discount: Double?) -> Double {
        let factor = mode == "flat" ? 1 : (days ?? defaultDays)
        return ((price ?? 0) * Double(quantity) * factor * (1 - (discount ?? 0) / 100) * 100).rounded() / 100
    }
}

struct ClientRentalStatusBadge: View {
    let status: ClientRentalStatus
    var body: some View {
        Text(status.label).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(status.color).background(status.color.opacity(0.15), in: Capsule())
    }
}
