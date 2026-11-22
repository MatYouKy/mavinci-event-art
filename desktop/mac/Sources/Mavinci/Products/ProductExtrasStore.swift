import Foundation

// MARK: Karta produktu, część C1 — modele i operacje: warianty (elementy) ze zdjęciami, przygotowanie i zamówienia,
// wymagania produktu, powiązane usługi na stronie, dodatki i limity pakietu (`/bridge/native/v1/products?op=extras`,
// `src/lib/native/productExtras.ts`).

/// Dodatek lub limit pakietu (`ProductAddon` w CRM — te same pola w `pricing_addons`).
struct ProductAddonItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var kind: String
    var unit: String
    var included_quantity: Double
    var quantity: Double
    var unit_price: Double
    var enabled: Bool
    var price_on_request: Bool?
    var quantity_source: String?
    var staff_role: String?
    var staff_hours: Double?
    var max_quantity: Double?

    static let kinds: [(key: String, label: String)] = [
        ("over_limit", "Ponad limit w pakiecie"), ("quantity", "Ilość × cena"), ("optional", "Opcjonalny dodatek"),
    ]
    static func kindLabel(_ key: String) -> String { kinds.first { $0.key == key }?.label ?? key }

    static func blank() -> ProductAddonItem {
        ProductAddonItem(id: UUID().uuidString.lowercased(), name: "", description: "", kind: "quantity", unit: "szt.",
                         included_quantity: 0, quantity: 0, unit_price: 0, enabled: false)
    }

    /// Płatna ilość (`addonQuantity`): opcjonalny 0/1, ponad limit — nadwyżka, ilość × cena — ilość.
    var payableQuantity: Double {
        kind == "optional" ? (enabled ? 1 : 0) : kind == "over_limit" ? max(0, quantity - included_quantity) : quantity
    }
    var onRequest: Bool { price_on_request == true && unit_price <= 0 }
    /// „120,00 zł netto / h” albo „Wycena indywidualna”.
    var rateText: String {
        onRequest ? "Wycena indywidualna" : "\(ProductText.money(unit_price)) netto" + (kind == "optional" ? "" : " / \(unit)")
    }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id), "name": .string(name), "description": .string(description), "kind": .string(kind), "unit": .string(unit),
            "included_quantity": .number(included_quantity), "quantity": .number(quantity), "unit_price": .number(unit_price),
            "enabled": .bool(enabled),
        ]
        if price_on_request == true { object["price_on_request"] = .bool(true) }
        if let quantity_source, kind != "optional" { object["quantity_source"] = .string(quantity_source) }
        if let role = staff_role?.trimmingCharacters(in: .whitespaces), !role.isEmpty { object["staff_role"] = .string(role) }
        if let staff_hours { object["staff_hours"] = .number(staff_hours) }
        if let max_quantity { object["max_quantity"] = .number(max_quantity) }
        return .object(object)
    }
}

struct ProductExtras: Codable {
    struct Defaults: Codable {
        var serviceDurationHours: Double?
        var extensionPriceNetPerHour: Double?
    }
    struct Variant: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var shortDescription: String
        var description: String
        var benefits: [String]
        var imagePath: String?
        var imageAlt: String
        var imageUrl: String?
        var priceNet: Double
        var priceGross: Double
        var quantitySource: String
        var serviceDurationHours: Double?
        var extensionPriceNetPerHour: Double?
        var recommended: Bool
        var active: Bool

        static func blank() -> Variant {
            Variant(id: UUID().uuidString.lowercased(), name: "", shortDescription: "", description: "", benefits: [], imagePath: nil,
                    imageAlt: "", imageUrl: nil, priceNet: 0, priceGross: 0, quantitySource: "manual", serviceDurationHours: nil,
                    extensionPriceNetPerHour: nil, recommended: false, active: true)
        }

        var json: JSONValue {
            .object([
                "id": .string(id), "name": .string(name), "shortDescription": .string(shortDescription), "description": .string(description),
                "benefits": .array(benefits.map { JSONValue.string($0) }), "imagePath": imagePath.map { JSONValue.string($0) } ?? .null,
                "imageAlt": .string(imageAlt), "priceNet": .number(priceNet), "priceGross": .number(priceGross),
                "quantitySource": .string(quantitySource),
                "serviceDurationHours": serviceDurationHours.map { JSONValue.number($0) } ?? .null,
                "extensionPriceNetPerHour": extensionPriceNetPerHour.map { JSONValue.number($0) } ?? .null,
                "recommended": .bool(recommended), "active": .bool(active),
            ])
        }
    }
    struct PreparationItem: Codable, Identifiable, Hashable {
        var id: String
        var kind: String
        var title: String
        var details: String?
        var leadDays: Int
        var anchor: String
        var ownerRole: String
        var supplier: String?
        var quantity: Double?
        var unit: String?
        var blocksReady: Bool
        var active: Bool
    }
    struct Preparation: Codable {
        var available: Bool
        var error: String?
        var canManage: Bool
        var items: [PreparationItem]
    }
    struct Requirement: Codable, Identifiable, Hashable {
        var id: String
        var category: String
        var title: String
        var description: String
    }
    struct RequirementCategory: Codable, Hashable {
        var value: String
        var label: String
        var defaultTitle: String
    }
    struct Service: Codable, Identifiable, Hashable {
        var id: String
        var title: String
        var path: String?
        var active: Bool
    }
    struct Related: Codable {
        var ids: [String]
        var url: String?
        var label: String?
        var publicPath: String?
        var services: [Service]
        var error: String?
    }

    var canEdit: Bool
    var elementMode: Bool
    var vatRate: Double
    var defaults: Defaults
    var packageElementIds: [String]
    var variants: [Variant]
    var preparation: Preparation
    var requirements: [Requirement]
    var requirementCategories: [RequirementCategory]
    var related: Related
    var addons: [ProductAddonItem]
    var packages: Packages

    struct Packages: Codable {
        var enabled: Bool
        var items: [ProductSalesPackageItem]
    }

    func requirementLabel(_ category: String) -> String { requirementCategories.first { $0.value == category }?.label ?? "Inne" }
}

/// Słowniki kroków przygotowania (`EVENT_STEP_*_LABELS`) i podgląd zdania jak w CRM.
enum ProductPreparationText {
    static let kinds: [(key: String, label: String)] = [
        ("order", "Zamówienie"), ("stock_check", "Sprawdzenie stanu"),
        ("venue_confirmation", "Potwierdzenie z klientem / obiektem"), ("task", "Zadanie"),
    ]
    static let roles: [(key: String, label: String)] = [("warehouse", "Magazyn"), ("sales", "Sprzedawca"), ("manager", "Kierownik realizacji")]
    static let anchors: [(key: String, label: String)] = [("event", "przed eventem"), ("loading", "przed załadunkiem")]

    static func kind(_ key: String) -> String { kinds.first { $0.key == key }?.label ?? key }
    static func role(_ key: String) -> String { roles.first { $0.key == key }?.label ?? key }

    /// „Każde wydarzenie z tą usługą dostanie krok: … — 4 dni przed wydarzeniem, odpowiada magazyn.”
    static func preview(title: String, leadDays: Int?, anchor: String, role: String) -> String {
        let name = title.trimmingCharacters(in: .whitespaces).isEmpty ? "…" : title.trimmingCharacters(in: .whitespaces)
        let when: String
        if let days = leadDays, (0...90).contains(days) {
            if days == 0 { when = anchor == "loading" ? "w dniu załadunku" : "w dniu eventu" }
            else { when = "\(days) \(days == 1 ? "dzień" : "dni") \(anchors.first { $0.key == anchor }?.label ?? "")" }
        } else {
            when = "…"
        }
        return "Każdy event z tą usługą dostanie krok: \(name) — \(when), odpowiada \(Self.role(role).lowercased())."
    }
}

extension ProductsStore {
    func loadExtras(_ productID: String) async {
        guard let api else { return }
        do {
            extras[productID] = try JSONDecoder().decode(ProductExtras.self, from: try await api.get("/products?op=extras&id=\(productID)"))
            extrasErrors[productID] = nil
        } catch {
            extrasErrors[productID] = failureText(error, "Nie udało się pobrać wariantów, wymagań i dodatków.")
        }
    }

    /// Zapis części C1; `english` — odśwież wersję angielską jak w CRM (treść widoczna w ofercie).
    @discardableResult func changeExtras(_ productID: String, _ op: String, _ fields: [String: JSONValue], pending: String = "Zapisywanie…",
                                         success: String, english: Bool = true) async -> Bool {
        guard let api, let workspace else { return false }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return false
        }
        var body = fields
        body["op"] = .string(op)
        body["id"] = .string(productID)
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/products", body) }
            extras[productID] = try JSONDecoder().decode(ProductExtras.self, from: data)
            workspace.succeed(success)
            if english { refreshEnglish(productID) }
            Task {
                await loadDetail(productID)
                await loadResources(productID)
                await sync(force: true)
            }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }
}

extension ProductAddonItem {
    private enum Keys: String, CodingKey {
        case id, name, description, kind, unit, included_quantity, quantity, unit_price, enabled, price_on_request, quantity_source,
             staff_role, staff_hours, max_quantity
    }

    /// Odczyt odporny na starsze zapisy (brakujące pola, liczby zapisane jako tekst).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        func number(_ key: Keys) -> Double? {
            if let value = try? c.decodeIfPresent(Double.self, forKey: key) { return value }
            if let text = try? c.decodeIfPresent(String.self, forKey: key) { return Double(text.replacingOccurrences(of: ",", with: ".")) }
            return nil
        }
        self.init(id: (try? c.decodeIfPresent(String.self, forKey: .id)) ?? UUID().uuidString.lowercased(),
                  name: (try? c.decodeIfPresent(String.self, forKey: .name)) ?? "",
                  description: (try? c.decodeIfPresent(String.self, forKey: .description)) ?? "",
                  kind: (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "quantity",
                  unit: (try? c.decodeIfPresent(String.self, forKey: .unit)) ?? "szt.",
                  included_quantity: number(.included_quantity) ?? 0,
                  quantity: number(.quantity) ?? 0,
                  unit_price: number(.unit_price) ?? 0,
                  enabled: (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? false,
                  price_on_request: try? c.decodeIfPresent(Bool.self, forKey: .price_on_request),
                  quantity_source: try? c.decodeIfPresent(String.self, forKey: .quantity_source),
                  staff_role: try? c.decodeIfPresent(String.self, forKey: .staff_role),
                  staff_hours: number(.staff_hours),
                  max_quantity: number(.max_quantity))
    }
}

// MARK: Pakiety sprzedaży (`ProductSalesPackage` w CRM — te same pola w `sales_packages`)

struct ProductPackageCostItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var quantity: Double
    var unit_cost_net: Double
    var settlement_method: String?
    var compensation_snapshot: ProductStaffSnapshot?
}

struct ProductPackageEquipmentItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var equipment_item_id: String?
    var equipment_kit_id: String?
    var quantity: Double
    var is_optional: Bool
    var notes: String
}

struct ProductPackageStaffItem: Codable, Identifiable, Hashable {
    var id: String
    var role: String
    var quantity: Double
    var estimated_hours: Double?
    var is_optional: Bool
    var notes: String
    var compensation: ProductStaffCompensation?
}

struct ProductPackageResourcesItem: Codable, Hashable {
    var equipment: [ProductPackageEquipmentItem]
    var staff: [ProductPackageStaffItem]
}

struct ProductAudiencePricing: Codable, Hashable {
    var fixed_net: Double
    var per_guest_net: Double
    var per_table_net: Double
    var reference_guests: Double

    /// Cena w katalogu dla liczby osób referencyjnych, średnio 10 osób przy stole (`audiencePackagePrice`).
    var referencePrice: Double? {
        guard reference_guests >= 1, reference_guests == reference_guests.rounded() else { return nil }
        let tables = (reference_guests / 10).rounded(.up)
        let price = ((fixed_net + per_guest_net * reference_guests + per_table_net * tables + .ulpOfOne) * 100).rounded() / 100
        return price <= 999_999_999 ? price : nil
    }
}

struct ProductSalesPackageItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var included_label: String
    var element_ids: [String]
    var price_net: Double
    var extension_price_net_per_hour: Double?
    var bonus: String
    var highlighted: Bool
    var image_path: String?
    var image_alt: String
    var price_on_request: Bool?
    var include_product_addons: Bool?
    var audience_pricing: ProductAudiencePricing?
    var cost_items: [ProductPackageCostItem]?
    var resources: ProductPackageResourcesItem?
    var image_url: String?

    static func blank() -> ProductSalesPackageItem {
        ProductSalesPackageItem(id: UUID().uuidString.lowercased(), name: "", description: "", included_label: "", element_ids: [], price_net: 0,
                                extension_price_net_per_hour: nil, bonus: "", highlighted: false, image_path: nil, image_alt: "")
    }

    var priceText: String { price_on_request == true && price_net <= 0 ? "Wycena indywidualna" : "\(ProductText.number(price_net)) zł netto" }

    var json: JSONValue {
        var copy = self
        copy.image_url = nil
        guard let data = try? JSONEncoder().encode(copy), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return value
    }

    /// Koszt spółki na 1 pakiet (`packageCostNet`): pozycje kosztowe i obsada ze stawkami; `nil` — nieustalony.
    var costNet: Double? {
        let staff = (resources?.staff ?? []).filter { !$0.is_optional && $0.compensation != nil }
        if cost_items == nil && staff.isEmpty { return nil }
        var total = 0.0
        for row in cost_items ?? [] {
            guard let line = ProductPackageCosts.line(row) else { return nil }
            total += (line * 100).rounded()
        }
        for row in staff {
            guard let line = ProductStaffCost.companyCost(quantity: row.quantity, hours: row.estimated_hours, compensation: row.compensation) else { return nil }
            total += (line * 100).rounded()
        }
        return total / 100
    }
    var unpricedStaff: Int { (resources?.staff ?? []).filter { !$0.is_optional && $0.compensation == nil }.count }
}

enum ProductPackageCosts {
    /// Koszt pozycji (`packageCostLineNet`): ilość × stawka, przy gotówce z zysku — z kosztem finansowania.
    static func line(_ row: ProductPackageCostItem) -> Double? {
        guard row.quantity.isFinite, row.quantity > 0, row.unit_cost_net.isFinite, row.unit_cost_net >= 0 else { return nil }
        var cost = row.quantity * row.unit_cost_net
        if row.settlement_method == "cash_non_deductible" {
            guard let snapshot = row.compensation_snapshot, snapshot.valid, let cit = snapshot.cit_rate, let dividend = snapshot.dividend_rate else { return nil }
            cost /= (1 - cit / 100) * (1 - dividend / 100)
        }
        return ((cost + .ulpOfOne) * 100).rounded() / 100
    }
}
