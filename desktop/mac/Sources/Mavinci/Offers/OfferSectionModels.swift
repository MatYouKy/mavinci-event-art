import Foundation

// MARK: Oferty, część C1 — wymagania techniczne oferty (`op=requirements`, zapis `op=requirementsSave`) oraz pakiety oferty
// i logistyka (`op=packages`, zapis `op=packagesSave` → `save_offer_packages_and_logistics`), `src/lib/native/offerSections.ts`.

/// Wymaganie techniczne (jak `OfferRequirementEntry`); `label` — nazwa kategorii (`getOfferRequirementLabel`).
struct OfferRequirement: Codable, Identifiable, Equatable {
    var key: String
    var category: String
    var title: String
    var description: String
    var sources: [String]
    var origin: String
    var included: Bool
    var priority: Double?
    var label: String?
    var id: String { key }

    /// Własne wymaganie dodane w ofercie (jak `addRequirement`).
    static func manual() -> OfferRequirement {
        OfferRequirement(key: "manual:\(Int(Date().timeIntervalSince1970 * 1000))", category: "other", title: "WŁASNE WYMAGANIE",
                         description: "", sources: ["Ustalenie w ofercie"], origin: "manual", included: true, priority: 0, label: "INNE WYMAGANIE")
    }

    var json: JSONValue {
        .object([
            "key": .string(key), "category": .string(category), "title": .string(title), "description": .string(description),
            "sources": .array(sources.map { JSONValue.string($0) }), "origin": .string(origin), "included": .bool(included),
        ])
    }
}

struct OfferRequirementsData: Decodable {
    var canEdit: Bool
    var entries: [OfferRequirement]
    /// Wynik „Odśwież automatycznie” (szablon i produkty bez zapisanych zmian).
    var automatic: [OfferRequirement]
}

// MARK: Pakiety i logistyka

/// Pozycja oferty, z której składa się pakiet.
struct OfferPackagePosition: Decodable, Identifiable, Hashable {
    var id: String
    var product_id: String
    var product_variant_id: String?
    var name: String
    var quantity: Double
    var unit: String
    var unit_price: Double
    var days: Double
}

struct OfferPackageItem: Codable, Hashable {
    var offer_item_id: String
    var product_id: String
    var product_variant_id: String?
    var quantity: Double

    var json: JSONValue {
        .object([
            "offer_item_id": .string(offer_item_id), "product_id": .string(product_id),
            "product_variant_id": product_variant_id.map { JSONValue.string($0) } ?? .null, "quantity": .number(quantity),
        ])
    }
}

struct OfferPackage: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var price_net: Double
    var list_price_net: Double
    var discount_amount: Double
    var discount_percent: Double
    var is_recommended: Bool
    var items: [OfferPackageItem]

    static func blank() -> OfferPackage {
        OfferPackage(id: UUID().uuidString.lowercased(), name: "", description: "", price_net: 0, list_price_net: 0, discount_amount: 0,
                     discount_percent: 0, is_recommended: false, items: [])
    }

    var json: JSONValue {
        .object([
            "id": .string(id), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
            "discount_amount": .number(discount_amount.isFinite ? discount_amount : 0), "is_recommended": .bool(is_recommended),
            "items": .array(items.map(\.json)),
        ])
    }

    /// Cena jak `calculate` w `OfferPackagesEditor`: suma pozycji (cena × dni × ilość), rabat 0…suma, procent i cena po rabacie.
    func calculated(_ positions: [OfferPackagePosition], discount: Double? = nil) -> OfferPackage {
        var next = self
        let list = OfferLogisticsMath.round(items.reduce(0) { sum, item in
            let position = positions.first { $0.id == item.offer_item_id }
            return sum + (position?.unit_price ?? 0) * (position?.days ?? 1) * item.quantity
        })
        let amount = min(list, max(0, (discount ?? discount_amount).isFinite ? (discount ?? discount_amount) : 0))
        next.list_price_net = list
        next.discount_amount = OfferLogisticsMath.round(amount)
        next.discount_percent = list > 0 ? OfferLogisticsMath.round(amount / list * 100) : 0
        next.price_net = OfferLogisticsMath.round(list - amount)
        return next
    }
}

/// Wiersz szacunku logistyki (jak `LogisticsEstimateRow`); trasa i wycena paliwa z kalkulatora CRM są przechowywane bez zmian.
struct OfferLogisticsRow: Codable, Identifiable, Equatable {
    var id: String
    var kind: String
    var name: String
    var quantity: Double?
    var units: Double?
    var rate: Double?
    var included_hours: Double?
    var consumption: Double?
    var fuel_estimate: JSONValue?
    var route: JSONValue?

    private static func value(_ number: Double?) -> JSONValue { number.map { $0.isFinite ? JSONValue.number($0) : .null } ?? .null }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id), "kind": .string(kind), "name": .string(name), "quantity": Self.value(quantity), "units": Self.value(units),
            "rate": Self.value(rate), "included_hours": Self.value(included_hours), "consumption": Self.value(consumption),
        ]
        if let fuel_estimate, fuel_estimate != .null { object["fuel_estimate"] = fuel_estimate }
        if let route, route != .null { object["route"] = route }
        return .object(object)
    }
}

struct OfferLogisticsEstimate: Codable, Equatable {
    var version: Int
    var route: JSONValue?
    var rows: [OfferLogisticsRow]
    var reserve_percent: Double?
    var notes: String

    static func empty() -> OfferLogisticsEstimate { OfferLogisticsEstimate(version: 1, route: nil, rows: [], reserve_percent: 0, notes: "") }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "version": .number(1), "rows": .array(rows.map(\.json)),
            "reserve_percent": reserve_percent.map { $0.isFinite ? JSONValue.number($0) : .null } ?? .null, "notes": .string(notes),
        ]
        if let route, route != .null { object["route"] = route }
        return .object(object)
    }
}

/// Logistyka oferty: szacunek (albo kwota ręczna, gdy `estimate == nil`), koszt dla firmy, dopłata klienta i opis.
struct OfferLogistics: Decodable, Equatable {
    var estimate: OfferLogisticsEstimate?
    var cost: Double?
    var price: Double?
    var enabled: Bool
    var description: String

    var json: JSONValue {
        .object([
            "estimate": estimate?.json ?? .null,
            "cost": cost.map { $0.isFinite ? JSONValue.number($0) : .null } ?? .null,
            "price": price.map { $0.isFinite ? JSONValue.number($0) : .null } ?? .null,
            "enabled": .bool(enabled), "description": .string(description),
        ])
    }
}

struct OfferPackagesData: Decodable {
    var canEdit: Bool
    var enabled: Bool
    var revision: Double
    var positions: [OfferPackagePosition]
    var logistics: OfferLogistics
    var packages: [OfferPackage]
}

/// Koszt logistyki jak `logisticsEstimate.ts` (koszt wiersza, suma, rezerwa i komunikat błędu) — do podglądu przy wpisywaniu;
/// zapis i tak liczy serwer.
enum OfferLogisticsMath {
    static let kinds: [(key: String, label: String)] = [
        ("fuel", "Paliwo"), ("travel", "Czas ekipy"), ("meals", "Wyżywienie"), ("accommodation", "Nocleg"), ("other", "Inny koszt"),
    ]
    static func kindLabel(_ kind: String) -> String { kinds.first { $0.key == kind }?.label ?? "Inny koszt" }

    static func round(_ value: Double) -> Double { ((value + Double.ulpOfOne) * 100).rounded() / 100 }

    private static func valid(_ value: Double?, _ max: Double, positive: Bool = false) -> Bool {
        guard let value, value.isFinite, value >= 0, !positive || value > 0, value <= max else { return false }
        return abs(value * 100 - (value * 100).rounded()) < 0.00001
    }

    /// Nowy wiersz jak `newLogisticsEstimateRow`.
    static func newRow(_ kind: String, route: JSONValue?) -> OfferLogisticsRow {
        let names = ["fuel": "Paliwo — przejazd w obie strony", "travel": "Ekipa — czas podróży", "meals": "Posiłki i napoje",
                     "accommodation": "Nocleg ekipy", "other": "Parking / opłaty / inne"]
        var units: Double? = kind == "fuel" || kind == "travel" ? nil : 1
        if kind == "fuel", let distance = route?.object["distance_km"], case .number(let km) = distance { units = km }
        return OfferLogisticsRow(id: UUID().uuidString.lowercased(), kind: kind, name: names[kind] ?? "Inny koszt", quantity: 1, units: units,
                                 rate: nil, included_hours: 0, consumption: nil, fuel_estimate: nil, route: nil)
    }

    /// Koszt wiersza (`logisticsEstimateRowCost`); `nil` — dane do uzupełnienia.
    static func cost(_ row: OfferLogisticsRow) -> Double? {
        guard valid(row.quantity, 10000, positive: true), let quantity = row.quantity, quantity == quantity.rounded(),
              valid(row.units, 100000), let units = row.units, valid(row.rate, 99999999.99), let rate = row.rate else { return nil }
        if row.kind == "fuel" {
            guard valid(row.consumption, 1000, positive: true), let consumption = row.consumption, rate > 0 else { return nil }
            let fuel = (units / 100 * consumption * rate * 100).rounded() / 100
            return round(fuel * quantity)
        }
        let included = row.included_hours ?? 0
        if row.kind == "travel" && (!valid(row.included_hours, 100000) || included > units) { return nil }
        return round(quantity * (units - (row.kind == "travel" ? included : 0)) * rate)
    }

    struct Summary {
        var error: String
        var subtotal: Double
        var reserve: Double
        var total: Double?
    }

    /// `summarizeLogisticsEstimate`.
    static func summary(_ estimate: OfferLogisticsEstimate) -> Summary {
        var error = ""
        if estimate.rows.isEmpty || estimate.rows.count > 30 {
            error = "Dodaj od 1 do 30 pozycji kosztowych. Dla braku kosztów wybierz kwotę ręczną i wpisz 0."
        }
        if !valid(estimate.reserve_percent, 100) { error = "Podaj rezerwę od 0 do 100% (maksymalnie dwa miejsca po przecinku)." }
        if estimate.notes.count > 2000 { error = "Założenia mogą mieć do 2000 znaków." }
        var ids = Set<String>()
        var subtotal = 0.0
        for row in estimate.rows {
            let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty || row.name.count > 120 || row.id.isEmpty || ids.contains(row.id) {
                error = "Każda pozycja musi mieć własną nazwę (do 120 znaków)."
            }
            ids.insert(row.id)
            if let amount = cost(row) {
                subtotal += amount
            } else {
                error = "Uzupełnij ilość, czas lub dystans i stawkę wybranych kosztów. Godziny wliczone w pakiet nie mogą przekraczać czasu podróży."
            }
        }
        subtotal = round(subtotal)
        let reserve = round(subtotal * (estimate.reserve_percent ?? 0) / 100)
        let total = round(subtotal + reserve)
        if total > 99999999.99 { error = "Szacunek przekracza maksymalną kwotę." }
        return Summary(error: error, subtotal: subtotal, reserve: reserve, total: error.isEmpty ? total : nil)
    }

    /// „Ostatnie obliczenie: Olsztyn → Gdańsk · 320 km (z powrotem)” z zapisanej trasy kalkulatora CRM.
    static func routeText(_ route: JSONValue?) -> String? {
        guard let route, case .object(let fields) = route, let km = fields["distance_km"], case .number(let distance) = km else { return nil }
        let origin = fields["origin"]?.text ?? ""
        let destination = fields["resolved_destination"]?.text.isEmpty == false ? fields["resolved_destination"]!.text : (fields["destination"]?.text ?? "")
        let way = fields["round_trip"] == JSONValue.bool(false) ? "(w jedną stronę)" : "(z powrotem)"
        return "\(origin) → \(destination) · \(OfferText.number(distance)) km \(way)"
    }
}

extension OffersStore {
    func requirements(_ id: String) async throws -> OfferRequirementsData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferRequirementsData.self, from: try await api.get("/offers?op=requirements&id=\(id)"))
    }

    func packages(_ id: String) async throws -> OfferPackagesData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferPackagesData.self, from: try await api.get("/offers?op=packages&id=\(id)"))
    }

    private func writeSection<T: Decodable>(_ body: [String: JSONValue], pending: String, success: String, as type: T.Type) async throws -> T {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        let data = try await workspace.withPending(pending) { try await api.post("/offers", body) }
        let reply = try JSONDecoder().decode(T.self, from: data)
        workspace.succeed(success)
        if let id = body["id"]?.text {
            Task {
                await loadDetail(id)
                await sync(force: true)
            }
        }
        return reply
    }

    /// „Zapisz” wymagań (puste opisy pomijane, tytuł i priorytet uzupełnia serwer).
    func saveRequirements(_ id: String, _ entries: [OfferRequirement]) async throws -> OfferRequirementsData {
        try await writeSection(["op": .string("requirementsSave"), "id": .string(id), "entries": .array(entries.map(\.json))],
                               pending: "Zapisywanie wymagań…", success: "Wymagania oferty zostały zapisane", as: OfferRequirementsData.self)
    }

    /// Pakiety (`nil` — bez zmian), widoczność pakietów i logistyka (`nil` — bez zmian) z kontrolą wersji treści oferty.
    func savePackages(_ id: String, revision: Double, packages: [OfferPackage]?, enabled: Bool, logistics: OfferLogistics?) async throws -> OfferPackagesData {
        let body: [String: JSONValue] = [
            "op": .string("packagesSave"), "id": .string(id), "revision": .number(revision), "enabled": .bool(enabled),
            "packages": packages.map { list in JSONValue.array(list.map(\.json)) } ?? .null,
            "logistics": logistics?.json ?? .null,
        ]
        return try await writeSection(body, pending: "Zapisywanie…", success: "Zapisano zmiany", as: OfferPackagesData.self)
    }
}
