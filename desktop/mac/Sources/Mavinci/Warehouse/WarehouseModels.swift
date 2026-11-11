import SwiftUI

// MARK: Magazyn — model jak w CRM (`/crm/equipment`, `equipmentApi.getEquipmentFeed`, `/crm/equipment/[id]`, `src/lib/native/warehouse.ts`).

/// Pozycja katalogu: sprzęt albo zestaw (jak lista „Magazyn” w CRM).
struct WarehouseEntry: Codable, Hashable, Identifiable {
    var key: String
    var id: String
    var kind: String
    var name: String
    var brand: String
    var model: String
    var categoryId: String?
    var thumbnailUrl: String?
    var description: String
    var createdAt: String?
    var active: Bool
    var unitsTotal: Int
    var unitsAvailable: Int
    var simpleQuantity: Int?
    /// Sprawne sztuki do kompletowania zestawów (dostępne, zarezerwowane, w użyciu) jak `usableEquipmentStock`.
    var usable: Int?

    var isKit: Bool { kind == "kit" }
    /// Kolor stanu jak `getStock` (0% — czerwony, < 50% — pomarańczowy, reszta — zielony).
    var stockColor: Color {
        guard unitsTotal > 0 else { return .secondary }
        let pct = Double(unitsAvailable) / Double(unitsTotal) * 100
        return pct == 0 ? CrmTheme.rgb(0xf87171) : pct < 50 ? CrmTheme.rgb(0xfb923c) : CrmTheme.rgb(0x4ade80)
    }
    var stockLabel: String {
        if isKit { return "Zestaw" }
        if let simpleQuantity { return "\(simpleQuantity) szt." }
        return "\(unitsAvailable)/\(unitsTotal)"
    }
    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || name.lowercased().contains(q) || brand.lowercased().contains(q) || model.lowercased().contains(q)
    }
}

extension WarehouseEntry: SyncKeyed { var syncKey: String { key } }

struct WarehouseAccess: Codable, Equatable {
    var canView: Bool
    var canManage: Bool
    var canCreate: Bool
}

struct WarehouseCategory: Codable, Hashable, Identifiable {
    var id: String
    var parentId: String?
    var name: String
    var description: String
    var color: String
    var level: Int
    var order: Int
    var flags: [String: Bool]
    /// Właściwości specjalne w kolejności z CRM (`special_properties`: nazwa i wartość).
    var properties: [SpecialProperty]?
}
struct SpecialProperty: Codable, Hashable {
    var name: String
    var value: Bool
}
struct WarehouseLocation: Codable, Hashable, Identifiable {
    var id: String
    var name: String
}
struct ConnectorOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var thumbnailUrl: String?
    var description: String?
    var commonUses: String?
    var active: Bool?
}
/// Przeznaczenie techniczne przewodu (`cable_categories`): grupa główna i podkategorie.
struct CableCategory: Codable, Hashable, Identifiable {
    var id: String
    var parentId: String?
    var name: String
    var description: String
    var color: String
    var order: Int
    var active: Bool
}

enum WarehouseTypeFilter: String, CaseIterable, Identifiable {
    case all, equipment, kits
    var id: String { rawValue }
    var label: String { self == .all ? "Wszystko" : self == .equipment ? "Tylko sprzęt" : "Tylko zestawy" }
}
enum WarehouseViewMode: String, CaseIterable, Identifiable {
    case grid, list, table
    var id: String { rawValue }
    var label: String { self == .grid ? "Kafelki" : self == .list ? "Lista" : "Tabela" }
    var symbol: String { self == .grid ? "square.grid.2x2" : self == .list ? "list.bullet" : "tablecells" }
}

// MARK: Karta sprzętu

struct EquipmentDimensions: Codable, Hashable {
    var length: Double?
    var width: Double?
    var height: Double?
}
struct EquipmentCable: Codable, Hashable {
    var lengthMeters: Double?
    var connectorIn: String
    var connectorOut: String
}
struct EquipmentPower: Codable, Hashable {
    var watts: Double?
    var amps: Double?
    var volts: Double?
    var phase: String
    var inputConnectorId: String?
    var outputConnectorId: String?
    var notes: String
}
struct EquipmentFlags: Codable, Hashable {
    var simpleQuantity: Bool
    var requiresSerial: Bool
    var hideEvents: Bool
    var disableUnits: Bool
    var readOnly: Bool
}
struct EquipmentCounts: Codable, Hashable {
    var images: Int
    var files: Int
    var components: Int
}
struct EquipmentUnit: Codable, Hashable, Identifiable {
    var id: String
    var serial: String
    var status: String
    var locationId: String?
    var locationName: String
    var notes: String
    var purchaseDate: String
    var lastServiceDate: String
    var repairDate: String
    var thumbnailUrl: String?
    var createdAt: String?
}
struct EquipmentHistoryEntry: Codable, Hashable, Identifiable {
    var id: String
    var field: String
    var oldValue: String
    var newValue: String
    var type: String
    var at: String?
    var author: String
}
struct EquipmentDetail: Codable, Hashable {
    var id: String
    var name: String
    var brand: String
    var model: String
    var description: String
    var notes: String
    var thumbnailUrl: String?
    var manualUrl: String
    var categoryId: String?
    var locationId: String?
    var weightKg: Double?
    var dimensions: EquipmentDimensions?
    var cable: EquipmentCable?
    var cableStockQuantity: Int
    var purchaseDate: String
    var purchasePrice: Double?
    var currentValue: Double?
    var depreciationRate: Double?
    var rentalPricePerDay: Double?
    var warrantyUntil: String
    var serialNumber: String
    var barcode: String
    var active: Bool
    var power: EquipmentPower
    var preCheckAvailable: Bool
    var requiresPreCheck: Bool
    var preCheckInstructions: String
    var flags: EquipmentFlags
    var counts: EquipmentCounts
    var units: [EquipmentUnit]
    var components: [EquipmentComponent]
    var compatible: [CompatibleItem]
    var images: [EquipmentImage]
    var files: [EquipmentFile]
    var history: [EquipmentHistoryEntry]

    var availableUnits: Int { units.filter { $0.status == "available" }.count }
    /// Ilość bez numerów sztuk: przewód (specyfikacja kabla) albo kategoria z flagą „simple_quantity”.
    var simpleStock: Bool { cable != nil || flags.simpleQuantity }
    var unitsCount: Int { cable != nil ? cableStockQuantity : units.count }
    /// Wartość bieżąca z amortyzacji jak `calculateCurrentValue` w CRM (domyślnie 10% rocznie).
    static func depreciated(price: Double?, date: String, rate: Double?) -> Double? {
        guard let price, price > 0, let purchased = DayDates.parse(date) else { return nil }
        let years = Date().timeIntervalSince(purchased) / (365.25 * 86_400)
        if years <= 0 { return price }
        return max(0, price * pow(1 - (rate ?? 10) / 100, years))
    }
}

extension EquipmentDetail: SyncKeyed { var syncKey: String { id } }

/// Parametr techniczny („Moc: 500W”) — kolejność jak w CRM.
struct SpecPair: Codable, Hashable {
    var key: String
    var value: String
}
/// Komponent zestawu (`equipment_components`): z magazynu albo własna nazwa (integralny), wliczony albo opcjonalny.
struct EquipmentComponent: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var quantity: Int
    var description: String
    var included: Bool
    var integral: Bool
    var optional: Bool
    var equipmentId: String?
    var thumbnailUrl: String?
    var specs: [SpecPair]
}
/// Element wymagany / zalecany / opcjonalny (`equipment_compatible_items`) — sprzęt, zestaw albo przewód.
struct CompatibleItem: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var targetId: String
    var name: String
    var brand: String
    var model: String
    var thumbnailUrl: String?
    var type: String
    var group: String
    var quantity: Double
    var mode: String
    var notes: String
    var order: Int
    var available: Double?
    var unit: String
    var lengthMeters: Double?
    var kitItems: [String]
}
struct EquipmentImage: Codable, Hashable, Identifiable {
    var id: String
    var url: String
    var title: String
    var primary: Bool
    var order: Int
    var createdAt: String?
}
struct EquipmentFile: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var path: String
    var url: String
    var size: Int
    var mime: String
    var createdAt: String?
}

// MARK: Zestawy i przewody

struct KitItem: Codable, Hashable, Identifiable {
    var id: String
    var equipmentId: String?
    var cableId: String?
    var quantity: Int
    var notes: String
    var order: Int
}
/// Zestaw (`/crm/equipment/kits`): pozycje to sprzęt albo przewody; `quantity` — liczba identycznych kompletów.
struct WarehouseKit: Codable, Hashable, Identifiable, SyncKeyed {
    var id: String
    var name: String
    var description: String
    var thumbnailUrl: String?
    var categoryId: String?
    var quantity: Int
    var active: Bool
    var createdAt: String?
    var items: [KitItem]
    var syncKey: String { id }
}
/// Przewód (`cables`).
struct WarehouseCable: Codable, Hashable, Identifiable, SyncKeyed {
    var id: String
    var name: String
    var description: String
    var notes: String
    var thumbnailUrl: String?
    var lengthMeters: Double?
    var connectorIn: String?
    var connectorOut: String?
    var stockQuantity: Int
    var stockUnit: String
    var minimumStock: Int
    var trackingMode: String
    var directional: Bool
    var categoryId: String?
    var cableCategoryId: String?
    var locationId: String?
    var purchaseDate: String
    var purchasePrice: Double?
    var currentValue: Double?
    var specs: [SpecPair]
    var tags: [String]
    var active: Bool
    var createdAt: String?
    var movements: [CableMovement]
    var syncKey: String { id }
    var unitLabel: String { stockUnit == "meter" ? "m" : "szt." }
    var lowStock: Bool { stockQuantity <= minimumStock }
}
/// Zmiana stanu przewodu (`cable_stock_movements`).
struct CableMovement: Codable, Hashable, Identifiable {
    var id: String
    var type: String
    var delta: Int
    var balance: Int
    var reason: String
    var at: String?
    var author: String
}

// MARK: Rental

struct RentalImage: Codable, Hashable {
    var url: String
    var title: String
    var primary: Bool
}
/// Sprzęt wynajmu od podwykonawcy (`subcontractor_rental_equipment`).
struct RentalItem: Codable, Hashable, Identifiable, SyncKeyed {
    var id: String
    var name: String
    var description: String
    var category: String
    var categoryId: String?
    var quantity: Int
    var active: Bool
    var thumbnailUrl: String?
    var notes: String
    var vatRate: Double?
    var dailyNet: Double?
    var dailyGross: Double?
    var weeklyNet: Double?
    var weeklyGross: Double?
    var monthlyNet: Double?
    var monthlyGross: Double?
    var dailyPrice: Double?
    var skills: [String]
    var images: [RentalImage]
    var specifications: String
    var subcontractorId: String?
    var company: String
    var organization: String
    var email: String
    var phone: String
    var createdAt: String?
    var syncKey: String { id }
    var cover: String? { images.first(where: \.primary)?.url ?? images.first?.url ?? thumbnailUrl }
}

/// Pozycja edytowanego zestawu (jak `kitItems` w `KitsPageClient`).
struct KitDraftItem: Hashable, Identifiable {
    var id = UUID()
    var equipmentId: String?
    var cableId: String?
    var quantity: Int
    var notes: String
    var key: String { equipmentId.map { "item-\($0)" } ?? "cable-\(cableId ?? "")" }
}

/// Kontrola stanów zestawu jak `checkKitInventory`: sprawne sztuki minus komplety innych zestawów.
enum KitInventory {
    struct Result { var maxQuantity: Int; var shortages: [String]; var error: String? }
    static func check(kitID: String?, quantity: Int, items: [KitDraftItem], kits: [WarehouseKit], entries: [WarehouseEntry], cables: [WarehouseCable]) -> Result {
        guard quantity >= 1 else { return Result(maxQuantity: 0, shortages: [], error: "Podaj dodatnią, całkowitą liczbę zestawów.") }
        guard !items.isEmpty else { return Result(maxQuantity: 0, shortages: [], error: "Dodaj przynajmniej jeden składnik zestawu.") }
        var perKit: [String: Int] = [:]
        var order: [String] = []
        for item in items {
            guard item.quantity >= 1 else { return Result(maxQuantity: 0, shortages: [], error: "Każdy składnik musi mieć dodatnią, całkowitą ilość.") }
            if perKit[item.key] == nil { order.append(item.key) }
            perKit[item.key, default: 0] += item.quantity
        }
        var allocated: [String: Int] = [:]
        for kit in kits where kit.id != kitID && kit.active {
            for item in kit.items {
                let key = item.equipmentId.map { "item-\($0)" } ?? "cable-\(item.cableId ?? "")"
                allocated[key, default: 0] += kit.quantity * item.quantity
            }
        }
        var stock: [String: (name: String, quantity: Int)] = [:]
        for entry in entries where !entry.isKit { stock["item-\(entry.id)"] = (entry.name, entry.active ? (entry.usable ?? entry.unitsAvailable) : 0) }
        for cable in cables { stock["cable-\(cable.id)"] = (cable.name, cable.active ? max(0, cable.stockQuantity) : 0) }
        var maximum = Int.max
        var shortages: [String] = []
        for key in order {
            let required = perKit[key] ?? 1
            let available = stock[key] ?? ("Składnik", 0)
            let other = allocated[key] ?? 0
            let free = max(0, available.quantity - other)
            maximum = min(maximum, free / required)
            if quantity * required > free {
                shortages.append("\(available.name): potrzeba \(quantity * required), sprawnych \(available.quantity), w innych zestawach \(other), brakuje \(quantity * required - free).")
            }
        }
        return Result(maxQuantity: maximum == Int.max ? 0 : maximum, shortages: shortages, error: nil)
    }
}

struct UnitEvent: Codable, Hashable, Identifiable {
    var id: String
    var type: String
    var description: String
    var imageUrl: String?
    var oldStatus: String
    var newStatus: String
    var at: String?
    var author: String
}

enum EquipmentCardTab: String, CaseIterable, Identifiable {
    case details, technical, purchase, components, units, gallery, files, history
    var id: String { rawValue }
    var label: String {
        switch self {
        case .details: return "Podstawowe"; case .technical: return "Parametry techniczne"; case .purchase: return "Informacje zakupowe"
        case .components: return "Skład zestawu"; case .units: return "Jednostki"; case .gallery: return "Galeria"
        case .files: return "Pliki"; case .history: return "Historia"
        }
    }
    var symbol: String {
        switch self {
        case .details: return "info.circle"; case .technical: return "wrench.and.screwdriver"; case .purchase: return "banknote"
        case .components: return "square.stack.3d.up"; case .units: return "shippingbox"; case .gallery: return "photo.on.rectangle"
        case .files: return "doc"; case .history: return "clock.arrow.circlepath"
        }
    }
}

enum WarehouseLabels {
    static let unitStatuses: [InquiryOption] = [
        .init(value: "available", label: "Dostępny"), .init(value: "damaged", label: "Uszkodzony"),
        .init(value: "in_service", label: "Serwis"), .init(value: "retired", label: "Wycofany"),
    ]
    static func unitStatus(_ value: String) -> String { unitStatuses.first { $0.value == value }?.label ?? value }
    static func unitStatusColor(_ value: String) -> Color {
        switch value {
        case "damaged": return CrmTheme.rgb(0xf87171); case "in_service": return CrmTheme.rgb(0xfb923c)
        case "retired": return CrmTheme.rgb(0x9ca3af); default: return CrmTheme.rgb(0x4ade80)
        }
    }
    /// Zdarzenia do dodania (jak lista w `UnitEventsModal`).
    static let eventTypes: [InquiryOption] = [
        .init(value: "note", label: "Notatka"), .init(value: "inspection", label: "Inspekcja"), .init(value: "service", label: "Serwis"),
        .init(value: "repair", label: "Naprawa (anuluje uszkodzenie)"), .init(value: "damage", label: "Uszkodzenie (zmienia status)"),
        .init(value: "sold", label: "Sprzedaż (usuwa jednostkę)"),
    ]
    static func eventType(_ value: String) -> String {
        ["damage": "Uszkodzenie", "repair": "Naprawa", "service": "Serwis", "status_change": "Zmiana statusu", "note": "Notatka",
         "inspection": "Inspekcja", "sold": "Sprzedaż"][value] ?? value
    }
    static func eventColor(_ value: String) -> Color {
        switch value {
        case "damage": return CrmTheme.rgb(0xf87171); case "repair": return CrmTheme.rgb(0x4ade80); case "service": return CrmTheme.rgb(0xfb923c)
        case "status_change": return CrmTheme.rgb(0x60a5fa); case "sold": return CrmTheme.rgb(0xc084fc); default: return .secondary
        }
    }
    /// Nazwy pól w historii zmian.
    static func field(_ name: String) -> String {
        ["name": "Nazwa", "warehouse_category_id": "Kategoria", "brand": "Marka", "model": "Model", "description": "Opis",
         "weight_kg": "Waga (kg)", "purchase_date": "Data zakupu", "purchase_price": "Cena zakupu", "rental_price_per_day": "Cena wynajmu za dzień",
         "serial_number": "Numer seryjny", "power_specs": "Specyfikacja prądowa", "requires_pre_check": "Sprawdzenie przed wydaniem",
         "pre_check_instructions": "Instrukcja sprawdzenia"][name] ?? name
    }
    /// Typ powiązania (`compatibility_type`): etykieta na liście i w formularzu, kolor plakietki.
    static let compatibilityTypes: [InquiryOption] = [
        .init(value: "required", label: "Wymagany"), .init(value: "recommended", label: "Rekomendowany"), .init(value: "optional", label: "Opcjonalny"),
    ]
    static func compatibilityType(_ value: String) -> String {
        ["required": "Wymagany", "recommended": "Zalecany", "optional": "Opcjonalny"][value] ?? value
    }
    static func compatibilityColor(_ value: String) -> Color {
        switch value {
        case "required": return CrmTheme.rgb(0xf87171); case "recommended": return CrmTheme.rgb(0x60a5fa); default: return CrmTheme.rgb(0x4ade80)
        }
    }
    static let quantityModes: [InquiryOption] = [
        .init(value: "per_item", label: "Na każdą sztukę sprzętu"), .init(value: "fixed", label: "Stała liczba dla całego wydarzenia"),
    ]
    static func quantityMode(_ value: String) -> String { value == "fixed" ? "łącznie" : "na sztukę" }
    /// Rozmiar pliku jak `formatBytes` w CRM (B, KB, MB, GB, do dwóch miejsc po przecinku).
    static func fileSize(_ bytes: Int) -> String {
        guard bytes > 0 else { return "0 B" }
        let units = ["B", "KB", "MB", "GB"]
        let index = min(units.count - 1, Int(log(Double(bytes)) / log(1024)))
        return "\(number(Double(bytes) / pow(1024, Double(index)))) \(units[index])"
    }
    static func money(_ value: Double?) -> String {
        guard let value else { return "-" }
        return value.formatted(.currency(code: "PLN").locale(Locale(identifier: "pl_PL")))
    }
    static func number(_ value: Double?) -> String {
        guard let value else { return "" }
        return value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never).locale(Locale(identifier: "pl_PL")))
    }
}
