import Foundation

// MARK: Oferty, część B2 — pozycje oferty: katalog do dodawania (`op=itemCatalog`), dane pozycji (`op=itemEditor`), szkic
// wyceny i podgląd liczony na serwerze (`op=itemPreview`, te same funkcje co okna CRM), liczba osób do wyceny (`op=audienceSave`).
// Produkty z konfiguratorem (scena, LED): szkic niesie konfigurację (`modular`, z `op=modular`) i znacznik własnej ceny.

/// Liczba osób i stołów oferty (jak `OfferAudience`).
struct OfferAudience: Codable, Equatable {
    var guest_count: Double?
    var guests_per_table: Double?
    var table_count: Double?
}

struct OfferItemVariant: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var priceNet: Double
    var recommended: Bool
    var quantitySource: String
}

struct OfferItemPackage: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var included: String
    var priceNet: Double
    var priceOnRequest: Bool
    var audiencePricing: Bool
    var includeProductAddons: Bool
    var resourcesMissing: Bool
    var priceText: String { priceOnRequest && priceNet <= 0 ? "Wycena indywidualna" : "\(OfferText.number(priceNet)) zł netto" }
}

/// Szkic pozycji (jak stan okien `AddOfferItemModal` / `EditOfferItemModal`).
struct OfferItemDraft: Codable, Equatable {
    var variantId: String?
    var packageId: String
    var quantity: Double
    var quantitySource: String
    var days: Double
    var unitPrice: Double
    var discountPercent: Double
    var addons: [ProductAddonItem]
    var variantPrices: [String: Double]
    var showVariants: Bool
    var showVariantPrices: Bool
    var name: String?
    var vatRate: Double?
    /// Konfiguracja produktu modułowego (scena, LED) — wtedy bez pakietów, wariantów i dodatków.
    var modular: JSONValue? = nil
    /// Własna cena bazowa zamiast ceny z kalkulatora.
    var modularManual: Bool? = nil
    /// Licznik zmian konfiguracji — klucz podglądu bez kodowania całej konfiguracji (poza JSON).
    var modularRevision = 0
    /// Pakiety zmienione w tej ofercie (cena, zakres, cena z liczby osób, sprzęt i obsada, koszty); `nil` — jak zapisane.
    var packageOptions: [JSONValue]? = nil

    private enum CodingKeys: String, CodingKey {
        case variantId, packageId, quantity, quantitySource, days, unitPrice, discountPercent, addons, variantPrices, showVariants
        case showVariantPrices, name, vatRate, modular, modularManual, packageOptions
    }

    private static func value(_ number: Double) -> JSONValue { number.isFinite ? .number(number) : .null }

    /// Zmiana szkicu do odświeżenia podglądu (konfiguracja jako numer zmiany, klucze posortowane).
    var signature: String {
        var object = json.object
        if modular != nil { object["modular"] = .number(Double(modularRevision)) }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(JSONValue.object(object)) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "variantId": variantId.map { JSONValue.string($0) } ?? .null,
            "packageId": .string(packageId),
            "quantity": Self.value(quantity),
            "quantitySource": .string(quantitySource),
            "days": Self.value(days),
            "unitPrice": Self.value(unitPrice),
            "discountPercent": Self.value(discountPercent),
            "addons": .array(addons.map(\.json)),
            "variantPrices": .object(variantPrices.mapValues { Self.value($0) }),
            "showVariants": .bool(showVariants),
            "showVariantPrices": .bool(showVariantPrices),
        ]
        if let name { object["name"] = .string(name) }
        if let vatRate { object["vatRate"] = Self.value(vatRate) }
        if let modular {
            object["modular"] = modular
            object["modularManual"] = .bool(modularManual == true)
        }
        if let packageOptions { object["packageOptions"] = .array(packageOptions) }
        return .object(object)
    }
}

struct OfferCatalogProduct: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var category: String?
    var unit: String
    var basePrice: Double
    var imagePath: String?
    var imageUrl: String?
    var modular: Bool
    var quantitySource: String
    var variants: [OfferItemVariant]
    var packages: [OfferItemPackage]
    /// Pełne pakiety (sprzęt i obsada, koszty, cena z liczby osób) do zmian tylko w tej ofercie.
    var packageOptions: [JSONValue]?
    var productAddons: [ProductAddonItem]
    var proposal: String?
    var initial: OfferItemDraft

    static func == (lhs: OfferCatalogProduct, rhs: OfferCatalogProduct) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    var priceText: String {
        if let cheapest = variants.map(\.priceNet).min() { return "od \(OfferText.money(cheapest))" }
        if let first = packages.first { return first.priceText }
        return OfferText.money(basePrice)
    }
}

struct OfferItemCatalog: Decodable {
    var audience: OfferAudience
    var vatRate: Double
    /// Skąd są ceny katalogu (cennik sezonowy oferty albo ceny z katalogu); starszy serwer — brak.
    var priceNotice: OfferPriceNotice?
    var products: [OfferCatalogProduct]
}

struct OfferItemEditorData: Decodable {
    var id: String
    var productId: String?
    var productName: String?
    var productDescription: String?
    var productUnit: String
    var modular: Bool
    var audience: OfferAudience
    var vatRate: Double
    var variants: [OfferItemVariant]
    var packages: [OfferItemPackage]
    var packageOptions: [JSONValue]?
    /// Sprzęt i obsada pakietów z karty produktu („Pobierz sprzęt i obsadę z produktu”).
    var catalogResources: [String: JSONValue]?
    var productAddons: [ProductAddonItem]
    var productQuantitySource: String
    var productBasePrice: Double
    var canLoadProductAddons: Bool
    /// „Przejdź na konfigurator — przelicz tę pozycję”: wcześniejsza wycena produktu, który ma teraz konfigurator.
    var canUseConfigurator: Bool?
    var allowIndividual: Bool
    var draft: OfferItemDraft
}

/// Wycena szkicu z serwera (ilość po przeliczeniu z liczby osób, cena z dodatkami, rabat, VAT) i komunikat błędu.
struct OfferItemPreview: Decodable, Equatable {
    var quantity: Double
    var unitPrice: Double
    var configuredPrice: Double
    var subtotal: Double
    var discountAmount: Double
    var total: Double
    var vat: Double
    var gross: Double
    var audienceRequired: Bool
    var needsTables: Bool
    var audienceNote: String?
    var packageAudiencePricing: Bool
    var packageResourcesMissing: Bool
    var error: String?
}

extension OffersStore {
    /// Katalog do dodawania pozycji albo — `recommendationExclude != nil` — propozycji dodatkowych (bez produktów już na liście).
    func itemCatalog(_ id: String, recommendationExclude: [String]? = nil) async throws -> OfferItemCatalog {
        guard let api else { throw AppError.configuration }
        var path = "/offers?op=itemCatalog&id=\(id)"
        if let recommendationExclude { path += "&mode=recommendation&exclude=\(recommendationExclude.joined(separator: ","))" }
        return try JSONDecoder().decode(OfferItemCatalog.self, from: try await api.get(path))
    }

    func itemEditor(_ id: String, item: String) async throws -> OfferItemEditorData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferItemEditorData.self, from: try await api.get("/offers?op=itemEditor&id=\(id)&item=\(item)"))
    }

    /// Podgląd wyceny: dodawanie (`productID`) albo edycja (`itemID`).
    func previewItem(_ id: String, productID: String?, itemID: String?, draft: OfferItemDraft, recommendation: Bool = false) async throws -> OfferItemPreview {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = ["op": .string("itemPreview"), "id": .string(id), "draft": draft.json, "recommendation": .bool(recommendation)]
        if let productID { body["productId"] = .string(productID) }
        if let itemID { body["itemId"] = .string(itemID) }
        return try JSONDecoder().decode(OfferItemPreview.self, from: try await api.post("/offers", body))
    }

    /// „Zapisz liczbę osób i przelicz” — z kontrolą, że nikt w międzyczasie nie zmienił danych.
    func saveAudience(_ id: String, guests: Double?, perTable: Double, tables: Double?, expected: OfferAudience) async throws -> OfferAudience {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var audience: OfferAudience }
        let body: [String: JSONValue] = [
            "op": .string("audienceSave"), "id": .string(id),
            "guestCount": guests.map { JSONValue.number($0) } ?? .null, "guestsPerTable": .number(perTable),
            "tableCount": tables.map { JSONValue.number($0) } ?? .null,
            "expected": .object([
                "guest_count": expected.guest_count.map { JSONValue.number($0) } ?? .null,
                "guests_per_table": .number(expected.guests_per_table ?? 10),
                "table_count": expected.table_count.map { JSONValue.number($0) } ?? .null,
            ]),
        ]
        let audience = try JSONDecoder().decode(Reply.self, from: try await api.post("/offers", body)).audience
        Task { await loadDetail(id) }
        return audience
    }
}
