import Foundation

// MARK: Oferty, część C2 — propozycje dodatkowe „Zobacz, co warto dobrać do takiego wydarzenia” (`op=recommendations`,
// `op=recommendationBuild`, `op=recommendationPreview`, `op=recommendationsSave`; `src/lib/native/offerRecommendations.ts`).

/// Propozycja: zapisany obiekt bez zmian (`raw`, wraca do serwera przy zapisie listy) i dane do edycji.
struct OfferRecommendationView: Decodable, Identifiable, Equatable {
    var raw: JSONValue
    var imageUrl: String?
    var modular: Bool
    /// Zestaw z własną ceną zamiast ceny z kalkulatora.
    var modularManual: Bool?
    var configured: Bool
    var basePrice: Double
    var addons: [ProductAddonItem]

    private func field(_ key: String) -> JSONValue? { raw.object[key] }
    private func number(_ key: String) -> Double? {
        if case .number(let value)? = field(key) { return value }
        return nil
    }

    var id: String { field("id")?.text ?? "" }
    var productID: String { field("product_id")?.text ?? "" }
    var name: String { field("name")?.text ?? "" }
    var description: String { field("description")?.text ?? "" }
    var unit: String { field("unit")?.text ?? "" }
    var quantity: Double { number("quantity") ?? 0 }
    var days: Double { number("days") ?? 1 }
    var unitPrice: Double { number("unit_price") ?? 0 }
    var discountPercent: Double { number("discount_percent") ?? 0 }
    var imagePath: String? {
        let path = field("image_path")?.text ?? ""
        return path.isEmpty ? nil : path
    }
    /// Układ w PDF: `compact` (domyślnie), `full_page`, `visual`.
    var layout: String {
        let value = field("pdf_layout")?.text ?? ""
        return value.isEmpty ? "compact" : value
    }
    var net: Double { quantity * days * unitPrice }
    /// Zapisana konfiguracja zestawu (scena, LED).
    var modularSnapshot: JSONValue? { raw.object["pricing_configuration"]?.object["modular"] }

    func with(layout: String) -> OfferRecommendationView {
        var copy = self
        var object = raw.object
        object["pdf_layout"] = .string(layout)
        copy.raw = .object(object)
        return copy
    }

    static let layouts: [(key: String, label: String)] = [
        ("compact", "Kompaktowo · 3/str."), ("full_page", "Osobna strona"), ("visual", "Duża grafika"),
    ]
}

struct OfferRecommendationsData: Decodable {
    var canEdit: Bool
    var vatRate: Double
    /// Stan zapisanej listy — zapis odrzuca zmiany, gdy ktoś w międzyczasie zmienił propozycje.
    var hash: String
    var items: [OfferRecommendationView]
}

struct OfferRecommendationPreview: Decodable {
    var item: OfferRecommendationView
    var error: String?
}

extension OffersStore {
    func recommendations(_ id: String) async throws -> OfferRecommendationsData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferRecommendationsData.self, from: try await api.get("/offers?op=recommendations&id=\(id)"))
    }

    /// „Dodaj propozycję” — gotowa propozycja z wyceną jak w CRM (bez zapisu; trafia na listę w edycji).
    func buildRecommendation(_ id: String, productID: String, draft: OfferItemDraft, exclude: [String]) async throws -> OfferRecommendationView {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Dodawanie wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        let body: [String: JSONValue] = [
            "op": .string("recommendationBuild"), "id": .string(id), "productId": .string(productID), "draft": draft.json,
            "exclude": .array(exclude.map { JSONValue.string($0) }),
        ]
        return try JSONDecoder().decode(OfferRecommendationView.self, from: try await api.post("/offers", body))
    }

    /// Podgląd w oknie „Edytuj propozycję”: propozycja po zmianach (cena z konfiguracji i rabatu) i błąd zapisu.
    func previewRecommendation(_ id: String, item: OfferRecommendationView, patch: [String: JSONValue]) async throws -> OfferRecommendationPreview {
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = ["op": .string("recommendationPreview"), "id": .string(id), "item": item.raw, "patch": .object(patch)]
        return try JSONDecoder().decode(OfferRecommendationPreview.self, from: try await api.post("/offers", body))
    }

    /// Zapis listy (kolejność, układ, usunięcia, nowe) i — opcjonalnie — zmian jednej propozycji z okna edycji.
    func saveRecommendations(_ id: String, hash: String, items: [OfferRecommendationView], editID: String? = nil,
                             patch: [String: JSONValue] = [:], success: String) async throws -> OfferRecommendationsData {
        var body: [String: JSONValue] = [
            "op": .string("recommendationsSave"), "id": .string(id), "hash": .string(hash), "items": .array(items.map(\.raw)),
        ]
        if let editID { body["edit"] = .object(["itemId": .string(editID), "patch": .object(patch)]) }
        return try await writeSection(body, pending: "Zapisywanie propozycji…", success: success, as: OfferRecommendationsData.self)
    }
}
