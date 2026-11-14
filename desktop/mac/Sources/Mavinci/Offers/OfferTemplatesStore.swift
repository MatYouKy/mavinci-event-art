import SwiftUI
import PDFKit
import CoreText

// MARK: Szablony ofert (`/crm/offers?tab=templates`, `OfferPageTemplatesEditor`), część F1 — kategorie szablonów z wyglądem
// i zdjęciem hero, szablony stron (5 etapów dokumentu), własne tło PDF. Serwer: `src/lib/native/offerTemplates.ts`.

/// Wygląd kategorii (`CategoryDesignConfig`) — nazwy pól jak w bazie.
struct OfferTemplateDesign: Codable, Equatable {
    var primary_color: String
    var secondary_color: String
    var accent_color: String
    var surface_color: String
    var hero_opacity: Double
    var hero_gradient_enabled: Bool
    var hero_gradient_end: Double
    var hero_height: Double
    var logo_scale: Double
    var assumptions_layout: String
    var visual_image_height: Double
    var pricing_style: String
    var info_page_enabled: Bool
    var info_page_title: String
    var order_process_text: String
    var requirements_page_enabled: Bool
    var requirements_page_title: String
    var requirements_page_subtitle: String
    var technical_requirements_text: String
    var reservation_terms_text: String

    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .object([:]) }
        return value
    }

    func color(_ hex: String) -> Color { CrmTheme.hex(hex) ?? .gray }
    var primary: Color { color(primary_color) }
    var accent: Color { color(accent_color) }
    var surface: Color { color(surface_color) }
}

struct OfferTemplatesState: Decodable {
    struct Brand: Decodable {
        var logoUrl: String?
        var headingFontUrl: String?
    }
    struct Category: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var description: String
        var isDefault: Bool
        var color: String
        var heroPath: String?
        var heroUrl: String?
        var heroAlt: String
        var design: OfferTemplateDesign
        var eventCategories: [String]
    }
    struct Template: Decodable, Identifiable, Equatable {
        var id: String
        var type: String
        var name: String
        var description: String
        var isDefault: Bool
        var isActive: Bool
        var pdfPath: String?
        var pdfWidth: Double
        var pdfHeight: Double
        var categoryId: String?
        var variantKey: String
        var fieldCount: Int
    }
    var canEditCategories: Bool
    var canEditTemplates: Bool
    var canDeleteTemplates: Bool
    var defaults: OfferTemplateDesign
    var brand: Brand
    var categories: [Category]
    var templates: [Template]
}

/// Etapy dokumentu (`templateTypes` w CRM).
enum OfferTemplateKind {
    struct Kind: Identifiable {
        let key: String
        let label: String
        let symbol: String
        let detail: String
        var id: String { key }
    }
    static let all: [Kind] = [
        Kind(key: "cover", label: "1. Okładka", symbol: "doc.text", detail: "Nazwa wydarzenia, termin, klient i zdjęcie przewodnie"),
        Kind(key: "about", label: "2. Założenia wydarzenia", symbol: "building.2", detail: "Najważniejsze liczby, cel spotkania i rekomendowany zakres"),
        Kind(key: "product", label: "3. Strony produktów i usług", symbol: "shippingbox", detail: "Powtarzalna strona z opisem, grafiką i danymi pozycji"),
        Kind(key: "pricing", label: "4. Wycena", symbol: "dollarsign.circle", detail: "Podsumowanie cenowe i warunki"),
        Kind(key: "final", label: "5. Zakończenie", symbol: "checkmark.circle", detail: "Zdjęcie, dane sprzedawcy i czytelne wezwanie do kontaktu"),
    ]
    static let variants: [(key: String, label: String)] = [
        ("default", "Domyślny"), ("compact", "Kompaktowy - do 3 produktów na stronie"), ("visual", "Duża grafika"),
    ]
}

@MainActor final class OfferTemplatesStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: OfferTemplatesState?
    @Published var loadError: String?
    @Published private(set) var loading = false
    /// Krój nagłówków z brandbooka (podgląd stron jak w CRM); bez niego — systemowy.
    @Published private(set) var headingDescriptor: CTFontDescriptor?

    private var api: NativeAPI? { workspace?.nativeAPI() }

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
            let next = try JSONDecoder().decode(OfferTemplatesState.self, from: try await api.get("/offers?op=templates"))
            state = next
            loadError = nil
            if headingDescriptor == nil, let address = next.brand.headingFontUrl { headingDescriptor = await Self.fontDescriptor(address) }
        } catch {
            loadError = failureText(error, "Błąd pobierania szablonów")
        }
    }

    /// Zapis z odświeżeniem listy; komunikat sukcesu albo błąd w snackbarze.
    @discardableResult
    func perform(_ body: [String: JSONValue], pending: String) async -> String? {
        guard let api, let workspace, workspace.canWrite else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        struct Reply: Decodable { var message: String?; var savedId: String? }
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/offers", body, timeout: 120) }
            state = try JSONDecoder().decode(OfferTemplatesState.self, from: data)
            let reply = try? JSONDecoder().decode(Reply.self, from: data)
            if let message = reply?.message { workspace.succeed(message) }
            return reply?.savedId ?? ""
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    func createTemplate(category: String, type: String, name: String, description: String, variant: String, isDefault: Bool, isActive: Bool) async -> Bool {
        await perform([
            "op": .string("templateCreate"), "categoryId": .string(category), "type": .string(type), "name": .string(name),
            "description": .string(description), "variantKey": .string(variant), "isDefault": .bool(isDefault), "isActive": .bool(isActive),
        ], pending: "Tworzenie...") != nil
    }

    func deleteTemplate(_ id: String) async {
        await perform(["op": .string("templateDelete"), "id": .string(id)], pending: "Usuwanie szablonu…")
    }

    func deleteBackground(_ id: String) async {
        await perform(["op": .string("templateBackgroundDelete"), "id": .string(id)], pending: "Usuwanie pliku PDF…")
    }

    /// „Własne tło” — PDF strony; wymiary pierwszej strony do edytora pól (jak wykrywanie w CRM).
    func uploadBackground(_ id: String, url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.starts(with: Array("%PDF-".utf8)) else {
            workspace?.error = "Wybierz plik PDF"
            return
        }
        guard data.count <= 12 * 1024 * 1024 else {
            workspace?.error = "Plik PDF może mieć maksymalnie 12 MB"
            return
        }
        var body: [String: JSONValue] = ["op": .string("templateBackground"), "id": .string(id), "data": .string(data.base64EncodedString())]
        if let page = PDFDocument(data: data)?.page(at: 0) {
            let box = page.bounds(for: .mediaBox)
            let rotated = page.rotation % 180 != 0
            body["width"] = .number(Double(rotated ? box.height : box.width).rounded())
            body["height"] = .number(Double(rotated ? box.width : box.height).rounded())
        }
        await perform(body, pending: "Wgrywanie…")
    }

    /// Nagłówek podglądu w kroju z brandbooka.
    func heading(_ size: CGFloat) -> Font {
        guard let headingDescriptor else { return .system(size: size, weight: .light) }
        return Font(CTFontCreateWithFontDescriptor(headingDescriptor, size, nil))
    }

    /// Krój nagłówków z brandbooka pobrany z pliku (bez instalowania w systemie).
    private static func fontDescriptor(_ address: String) async -> CTFontDescriptor? {
        guard let url = URL(string: address), let result = try? await URLSession.shared.data(from: url) else { return nil }
        return CTFontManagerCreateFontDescriptorFromData(result.0 as CFData)
    }
}
