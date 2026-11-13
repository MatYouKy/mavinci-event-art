import Foundation

// MARK: Karta produktu, część B — modele i operacje: sprzęt i zestawy, obsada z kosztem, Mavinci LIVE, klauzule umowy
// i zakres wariantu (`/bridge/native/v1/products?op=resources`, `src/lib/native/productResources.ts`).

struct ProductKitItem: Codable, Hashable {
    var quantity: Double
    var name: String
    var detail: String?
}

struct ProductStaffSnapshot: Codable, Hashable {
    var cit_rate: Double?
    var dividend_rate: Double?
    var updated_at: String?
    var valid: Bool {
        guard let cit = cit_rate, let dividend = dividend_rate else { return false }
        return cit >= 0 && cit < 100 && dividend >= 0 && dividend < 100
    }
}

/// Rozliczenie roli obsady (`PackageStaffCompensation`): za realizację lub za godzinę, sposób rozliczenia i parametry gotówki.
struct ProductStaffCompensation: Codable, Hashable {
    var rate_basis: String?
    var rate: Double?
    var settlement_method: String?
    var compensation_snapshot: ProductStaffSnapshot?

    var hourly: Bool { rate_basis == "hourly" }
    var json: JSONValue {
        var object: [String: JSONValue] = [
            "rate_basis": .string(rate_basis ?? "per_service"),
            "rate": rate.map { JSONValue.number($0) } ?? .null,
            "settlement_method": .string(settlement_method ?? "invoice"),
        ]
        if settlement_method == "cash_non_deductible", let snapshot = compensation_snapshot {
            var values: [String: JSONValue] = [
                "cit_rate": snapshot.cit_rate.map { JSONValue.number($0) } ?? .null,
                "dividend_rate": snapshot.dividend_rate.map { JSONValue.number($0) } ?? .null,
            ]
            if let updated = snapshot.updated_at { values["updated_at"] = .string(updated) }
            object["compensation_snapshot"] = .object(values)
        } else {
            object["compensation_snapshot"] = .null
        }
        return .object(object)
    }
}

enum ProductStaffCost {
    static let settlements: [(key: String, label: String)] = [
        ("invoice", "Faktura / rachunek — koszt netto"),
        ("cash_documented", "Gotówka z dokumentem kosztowym"),
        ("cash_non_deductible", "Gotówka — finansowanie z zysku (CIT i dywidenda)"),
    ]
    static func settlementLabel(_ key: String?) -> String { settlements.first { $0.key == key }?.label ?? "" }

    private static func round2(_ value: Double) -> Double { ((value + .ulpOfOne) * 100).rounded() / 100 }

    /// Ilość jednostek (osoby × godziny przy stawce godzinowej) i stawka — jak `staffCostItem`.
    static func units(quantity: Double, hours: Double?, compensation: ProductStaffCompensation) -> Double {
        round2(quantity * (compensation.hourly ? (hours ?? 0) : 1))
    }

    /// Wypłata (bez kosztu finansowania) — „Łączna wartość netto” / „Łącznie do wypłaty”.
    static func payout(quantity: Double, hours: Double?, compensation: ProductStaffCompensation?) -> Double? {
        guard let compensation, let rate = compensation.rate, rate.isFinite, rate >= 0 else { return nil }
        let units = units(quantity: quantity, hours: hours, compensation: compensation)
        guard units > 0 else { return nil }
        return units * rate
    }

    /// Koszt dla spółki (`packageCostLineNet`): przy gotówce bez dokumentu — z kosztem finansowania z zysku.
    static func companyCost(quantity: Double, hours: Double?, compensation: ProductStaffCompensation?) -> Double? {
        guard let compensation, var cost = payout(quantity: quantity, hours: hours, compensation: compensation) else { return nil }
        if compensation.settlement_method == "cash_non_deductible" {
            guard let snapshot = compensation.compensation_snapshot, snapshot.valid,
                  let cit = snapshot.cit_rate, let dividend = snapshot.dividend_rate else { return nil }
            cost /= (1 - cit / 100) * (1 - dividend / 100)
        }
        return round2(cost)
    }
}

struct ProductResources: Codable {
    struct Overrides: Codable, Hashable {
        var equipment: Bool
        var staff: Bool
        var mavinciLive: Bool
        var contractClauses: Bool
    }
    struct Variant: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var active: Bool
        var overrides: Overrides
    }
    struct Scope: Codable {
        var variantId: String?
        var variantName: String?
        var inherited: Overrides
    }
    struct Equipment: Codable, Identifiable, Hashable {
        var id: String
        var mode: String
        var targetId: String
        var name: String
        var brand: String?
        var model: String?
        var thumbnail: String?
        var category: String?
        var available: Double?
        var quantity: Double
        var optional: Bool
        var notes: String?
        var supplier: String?
        var kitItems: [ProductKitItem]

        var isKit: Bool { mode == "kit" }
        var isRental: Bool { mode == "rental" }
        var subtitle: String {
            if isRental { return "Sprzęt rental" + (supplier.map { " · \($0)" } ?? "") }
            return [brand, model].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " • ")
        }
    }
    struct StaffRow: Codable, Identifiable, Hashable {
        var id: String
        var role: String
        var roleLabel: String
        var quantity: Double
        var estimatedHours: Double?
        var hourlyRate: Double?
        var optional: Bool
        var notes: String?
        var paymentType: String?
        var compensation: ProductStaffCompensation?
        var cost: Double?
    }
    struct Skill: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var description: String?
        var category: String?
        var minimum: String
        var equipment: [String]
    }
    struct Staff: Codable {
        var rows: [StaffRow]
        var costNet: Double?
        var requiredSkills: [Skill]
    }
    struct LiveModule: Codable, Identifiable, Hashable {
        var key: String
        var name: String
        var description: String?
        var selected: Bool
        var id: String { key }
    }
    struct Live: Codable {
        var available: Bool
        var modules: [LiveModule]
    }
    struct Clause: Codable, Identifiable, Hashable {
        var id: String
        var category: String
        var topic: String
        var title: String
        var content: String
        var sharedKey: String?
    }
    struct ClauseCategory: Codable, Hashable {
        var key: String
        var label: String
    }
    struct ClauseTopic: Codable, Hashable {
        var value: String
        var category: String
        var label: String
    }
    struct SharedClause: Codable, Hashable {
        var key: String
        var category: String
        var topic: String
        var title: String
        var content: String
    }
    struct Placeholder: Codable, Hashable {
        var value: String
        var label: String
    }
    struct ClauseMeta: Codable {
        var categories: [ClauseCategory]
        var topics: [ClauseTopic]
        var shared: [SharedClause]
        var placeholders: [Placeholder]

        func topics(_ category: String) -> [ClauseTopic] { topics.filter { $0.category == category } }
        func topicLabel(_ topic: String) -> String { topics.first { $0.value == topic }?.label ?? "Inny typ" }
        func categoryLabel(_ category: String) -> String { categories.first { $0.key == category }?.label ?? category }
        func shared(_ key: String?) -> SharedClause? { key.flatMap { key in shared.first { $0.key == key } } }
    }

    var canEdit: Bool
    var packages: Bool
    var variants: [Variant]
    var scope: Scope
    var equipment: [Equipment]
    var staff: Staff
    var live: Live
    var clauses: [Clause]
    var clauseMeta: ClauseMeta
    var compensation: ProductStaffSnapshot?
}

/// Sprzęt lub zestaw z magazynu do wyboru w „Dodaj sprzęt”.
struct ProductCatalogEquipment: Codable, Identifiable, Hashable {
    var id: String
    var kind: String
    var name: String
    var brand: String?
    var model: String?
    var description: String?
    var thumbnail: String?
    var category: String?
    var available: Double?
    var kitItems: [ProductKitItem]

    var isKit: Bool { kind == "kit" }
    var searchText: String { [name, brand ?? "", model ?? "", category ?? ""].joined(separator: " ") }
}

extension ProductsStore {
    func scope(_ productID: String) -> String? { scopes[productID].flatMap { $0.isEmpty ? nil : $0 } }

    func loadResources(_ productID: String) async {
        guard let api else { return }
        let variant = scope(productID)
        do {
            let path = "/products?op=resources&id=\(productID)" + (variant.map { "&variant=\($0)" } ?? "")
            let payload = try JSONDecoder().decode(ProductResources.self, from: try await api.get(path))
            guard scope(productID) == variant else { return }
            resources[productID] = payload
            resourceErrors[productID] = nil
        } catch {
            resourceErrors[productID] = failureText(error, "Nie udało się pobrać sprzętu, obsady i klauzul.")
        }
    }

    func setScope(_ productID: String, variant: String?) {
        scopes[productID] = variant ?? ""
        Task { await loadResources(productID) }
    }

    /// Zmiana sprzętu, obsady, Mavinci LIVE, klauzul lub zakresu wariantu; po zapisie odświeża gotowość karty i katalog.
    @discardableResult func changeResources(_ productID: String, _ op: String, _ fields: [String: JSONValue],
                                            pending: String = "Zapisywanie…", success: String) async -> Bool {
        guard let api, let workspace else { return false }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return false
        }
        var body = fields
        body["op"] = .string(op)
        body["id"] = .string(productID)
        if body["variantId"] == nil { body["variantId"] = scope(productID).map { JSONValue.string($0) } ?? .null }
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/products", body) }
            resources[productID] = try JSONDecoder().decode(ProductResources.self, from: data)
            workspace.succeed(success)
            Task {
                await loadDetail(productID)
                await sync(force: true)
            }
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return false
        }
    }

    func loadEquipmentCatalog() async {
        guard let api else { return }
        struct Reply: Decodable { let items: [ProductCatalogEquipment] }
        do {
            equipmentCatalog = try JSONDecoder().decode(Reply.self, from: try await api.get("/products?op=equipmentCatalog")).items
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać katalogu sprzętu.")
            if equipmentCatalog == nil { equipmentCatalog = [] }
        }
    }
}
