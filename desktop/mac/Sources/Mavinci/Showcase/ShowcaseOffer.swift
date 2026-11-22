import Foundation
import SwiftUI
import AppKit

// MARK: Strefa sprzedawcy → „Prezentacje” → „Oferta ze spotkania” — natywnie na Macu, ten sam przepływ co pokaz w CRM i na iPadzie
// (`src/lib/showcase/showcaseOffer.server.ts`, `ShowcaseOfferSheet.tsx`): klient mówi „chcę ofertę” — „Do oferty” przy wariancie,
// pakiecie albo w nagłówku karty, potem klient (z CRM albo nowy, bez duplikatów), otwarte zapytanie klienta albo nowe zapytanie
// (źródło „Rozmowa / spotkanie”), rabat w progach (powyżej progu — prośba o akceptację przed wysłaniem), utworzenie oferty i PDF,
// PDF na ekranie, wysyłka e-mailem, oferta albo zapytanie w aplikacji. Szkic oferty zostaje na dysku (zaszyfrowany, osobno dla
// konta); ceny, rabat i akceptację liczy serwer CRM tymi samymi funkcjami co kreator ofert. Rabat pozycji i rabat całej oferty —
// razem, z rabatem łącznym; jak klient widzi rabat w PDF (przy pozycjach, rabat łączny, same ceny po rabacie) — wybór sprzedawcy
// zapamiętany na serwerze (ten sam w CRM i na iPadzie). Osoba kontaktowa firmy — lista wyboru. Klient może być roboczy (sama
// nazwa, bez dodawania do bazy) — przypisuje się go później w CRM.
// Nowe pola szkicu są opcjonalne — szkic zapisany na dysku przez starszą wersję aplikacji wczytuje się bez błędu.

// MARK: Modele (jak `ShowcaseOffer*` w `showcaseShared.ts`)

struct ShowcaseOfferLine: Codable, Hashable, Identifiable {
    var key: String
    var productId: String
    /// `product` | `variant` | `package`.
    var kind: String
    var optionId: String?
    var label: String
    var quantity: Int
    var days: Int
    var priceOnRequest: Bool
    var agreedPrice: Double?
    /// Rabat pozycji (0–100%); rabat całej oferty liczy się po nim.
    var discountPercent: Double?
    var itemId: String?
    var itemTitle: String
    var id: String { key }
    var discount: Double { discountPercent ?? 0 }
}

struct ShowcaseOfferClient: Codable, Hashable {
    var organizationId: String?
    var organizationName = ""
    var contactId: String?
    var contactName = ""
    var company = ""
    var nip = ""
    var firstName = ""
    var lastName = ""
    var email = ""
    var phone = ""
    /// Klient roboczy — sama nazwa, bez dodawania do bazy klientów (klienta przypisuje się później w CRM).
    var placeholder: String?
    var chosen: Bool { organizationId != nil || contactId != nil }
    /// Klient roboczy: nazwa bez klienta z CRM i bez nowego klienta (jak `isShowcaseOfferPlaceholder`).
    var isPlaceholder: Bool {
        !(placeholder ?? "").isEmpty && !chosen && company.isEmpty && firstName.isEmpty && lastName.isEmpty
    }
}

struct ShowcaseOfferEvent: Codable, Hashable {
    var name = ""
    /// `YYYY-MM-DD` albo `YYYY-MM-DDTHH:MM` (puste — bez terminu).
    var date = ""
    var location = ""
    /// Miejsce z bazy lokalizacji (CRM → Lokalizacje); `nil` — wpisane ręcznie.
    var locationId: String?
    var guestCount: Int?
}

/// Podpowiedź miejsca z bazy lokalizacji („Nazwa, miasto” — jak w zapytaniach CRM).
struct ShowcaseOfferLocation: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var city: String
    var address: String
    var label: String
}

struct ShowcaseOfferDraft: Codable, Equatable {
    var id: String
    var lines: [ShowcaseOfferLine] = []
    /// Rabat całej oferty — od wartości pozycji po ich rabatach.
    var discountPercent: Double = 0
    /// Jak klient widzi rabat w PDF: `lines` | `total` | `none` (`nil` — przy pozycjach).
    var discountDisplay: String?
    var client = ShowcaseOfferClient()
    var inquiryId: String?
    var inquiryTitle = ""
    var event = ShowcaseOfferEvent()
    var note = ""
    var updatedAt = ""

    static func empty() -> ShowcaseOfferDraft { ShowcaseOfferDraft(id: UUID().uuidString.lowercased()) }

    var display: String { discountDisplay ?? "lines" }
}

struct ShowcaseOfferSetup: Decodable {
    struct Guardrails: Decodable {
        var enabled: Bool
        var maxDiscountPercent: Double
        var minMarginPercent: Double
    }
    var canOffer: Bool
    var reason: String
    var canApprove: Bool
    var guardrails: Guardrails
    var validDays: Int
    /// Zapamiętany rabat w PDF sprzedawcy (`lines` | `total` | `none`); starszy serwer go nie wysyła.
    var discountDisplay: String?
}

struct ShowcaseOfferClientHit: Decodable, Hashable {
    var kind: String
    var id: String
    var name: String
    var detail: String
    var organizationId: String?
    var organizationName: String
    var email: String
    var phone: String
    var rowID: String { "\(kind):\(id)" }
}

struct ShowcaseOfferPerson: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var email: String
    var phone: String
}

struct ShowcaseOfferInquiry: Decodable, Hashable, Identifiable {
    var id: String
    var title: String
    var stage: String
    var stageLabel: String
    var date: String?
    var location: String
    var guestCount: Int?
    var updatedAt: String
}

struct ShowcaseOfferClientContext: Decodable {
    var persons: [ShowcaseOfferPerson]
    var inquiries: [ShowcaseOfferInquiry]
}

struct ShowcaseOfferPreviewLine: Decodable, Hashable {
    var key: String
    var name: String
    var unit: String
    var quantity: Double
    var days: Double
    var unitPrice: Double
    var subtotal: Double
    /// Wartość netto przed rabatem pozycji i ten rabat (%).
    var listSubtotal: Double?
    var discountPercent: Double?
    var quantityFromAudience: Bool
    var error: String?
}

struct ShowcaseOfferPreview: Decodable {
    var lines: [ShowcaseOfferPreviewLine]
    /// Wartość pozycji po ich rabatach (podstawa rabatu całej oferty).
    var listNet: Double
    var discountPercent: Double
    var discountAmount: Double
    /// Suma rabatów pozycji i rabat łączny (pozycje + cała oferta) — ten liczy się do progu akceptacji.
    var lineDiscountAmount: Double?
    var effectiveDiscountPercent: Double?
    var net: Double
    var taxPercent: Double
    var tax: Double
    var gross: Double
    var problem: String?
}

struct ShowcaseOfferApproval: Decodable, Equatable {
    var required: Bool
    var canSend: Bool
    var status: String?
    var reasons: [String]
    var canApprove: Bool
}

struct ShowcaseOfferResult: Decodable {
    var offerId: String
    var number: String
    var inquiryId: String
    var inquiryCreated: Bool
    var clientName: String
    var clientEmail: String
    /// Oferta bez klienta w bazie (klient roboczy) — klienta przypisuje się w CRM.
    var clientPlaceholder: Bool?
    var net: Double
    var gross: Double
    var approval: ShowcaseOfferApproval
}

struct ShowcaseOfferStatus: Decodable {
    var offerId: String
    var number: String
    var status: String
    var pdfReady: Bool
    var approval: ShowcaseOfferApproval
}

struct ShowcaseOfferEmailSetup: Decodable {
    struct Account: Decodable, Hashable, Identifiable {
        var id: String
        var label: String
    }
    var number: String
    var accounts: [Account]
    var to: String
    var recipientName: String
    var subject: String
    var text: String
    var pdfReady: Bool
}

/// Błąd „Utwórz ofertę” po zapisaniu zapytania i klienta — ponowna próba dopina ofertę do nich (bez drugiego zapytania).
struct ShowcaseOfferCreateFailure: Error, LocalizedError {
    var message: String
    var inquiryId: String?
    var organizationId: String?
    var contactId: String?
    var errorDescription: String? { message }
}

// MARK: Reguły (jak `showcaseShared.ts`)

enum ShowcaseOfferRules {
    static let lines = 30
    static let quantity = 9999
    static let days = 30
    static let note = 2000
    static let validDays = 14
    static let discountPresets: [Double] = [0, 5, 10, 15]
    /// Rabat pozycji z listy: 0–100% co 1 punkt.
    static let discountSteps: [Double] = (0...100).map(Double.init)
    /// Rabat w PDF dla klienta (jak `SHOWCASE_OFFER_DISCOUNT_DISPLAYS`).
    static let discountDisplays: [(key: String, label: String, hint: String)] = [
        ("lines", "Przy pozycjach", "Klient widzi rabat każdej pozycji i rabat na ofertę."),
        ("total", "Rabat łączny", "Pozycje w cenach przed rabatem, pod tabelą jeden rabat łączny."),
        ("none", "Ceny po rabacie", "Klient widzi tylko ceny po rabacie — bez kwoty rabatu."),
    ]

    /// Lista wartości rabatu z bieżącą (np. 12,5% po zamianie trybu).
    static func discountSteps(including value: Double?) -> [Double] {
        guard let value, !discountSteps.contains(value) else { return discountSteps }
        return (discountSteps + [value]).sorted()
    }

    static func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func emailValid(_ value: String) -> Bool {
        trimmed(value).range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    /// Sprawdzenie szkicu przed utworzeniem oferty (te same komunikaty co CRM i serwer).
    static func problem(_ draft: ShowcaseOfferDraft) -> String? {
        if draft.lines.isEmpty { return "Dodaj do oferty co najmniej jedną pozycję („Do oferty” przy wariancie albo pakiecie)." }
        if let unpriced = draft.lines.first(where: { $0.priceOnRequest && ($0.agreedPrice ?? 0) <= 0 }) { return "Wpisz uzgodnioną cenę: \(unpriced.label)." }
        let client = draft.client
        let company = trimmed(client.company)
        let first = trimmed(client.firstName)
        let last = trimmed(client.lastName)
        if !client.chosen && company.isEmpty && (first.isEmpty || last.isEmpty) && !client.isPlaceholder {
            return "Wybierz klienta z CRM, wpisz firmę lub imię i nazwisko klienta albo nazwę roboczą (bez bazy)."
        }
        if client.contactId == nil && (!first.isEmpty || !last.isEmpty) && (first.isEmpty || last.isEmpty) { return "Podaj imię i nazwisko osoby kontaktowej." }
        if !trimmed(client.email).isEmpty && !emailValid(client.email) { return "Podaj poprawny adres e-mail." }
        let nip = client.nip.filter(\.isNumber)
        if !nip.isEmpty && nip.count != 10 { return "NIP ma 10 cyfr." }
        return nil
    }

    static func approvalHint(_ setup: ShowcaseOfferSetup?, discount: Double) -> String {
        guard let setup, !setup.canApprove, setup.guardrails.enabled else { return "" }
        let limit = setup.guardrails.maxDiscountPercent
        return discount > limit ? "Rabat powyżej \(percent(limit)) — ofertę utworzysz i pokażesz klientowi od razu, a wyślesz po akceptacji rabatu." : ""
    }

    /// Rabat 0–100% z dwoma miejscami po przecinku („12,5”).
    static func discount(_ text: String) -> Double {
        guard let value = Double(text.replacingOccurrences(of: ",", with: ".").filter { $0.isNumber || $0 == "." }), value.isFinite else { return 0 }
        return min(100, max(0, (value * 100).rounded() / 100))
    }

    /// Uzgodniona cena netto (dodatnia, z groszami) albo `nil`.
    static func price(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        guard let value = Double(clean), value.isFinite, value > 0, value <= 99_999_999 else { return nil }
        return (value * 100).rounded() / 100
    }

    /// „12 300,00 zł”.
    static func amount(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return "\(formatter.string(from: NSNumber(value: value.isFinite ? value : 0)) ?? String(value)) zł"
    }

    /// „10%”, „12,5%”.
    static func percent(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return "\(formatter.string(from: NSNumber(value: value.isFinite ? value : 0)) ?? String(value))%"
    }

    /// „15.01.2027, 19:00” z `2027-01-15T19:00`.
    static func dateLabel(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        let parts = value.split(separator: "T", maxSplits: 1).map(String.init)
        let date = parts[0].split(separator: "-").map(String.init)
        guard date.count == 3 else { return value }
        return "\(date[2]).\(date[1]).\(date[0])" + (parts.count > 1 ? ", \(parts[1])" : "")
    }
}

// MARK: Stan i serwer

@MainActor final class ShowcaseOfferStore: ObservableObject {
    enum AddResult { case added(String), exists(String), full, unavailable(String) }

    weak var showcase: ShowcaseStore?
    @Published private(set) var setup: ShowcaseOfferSetup?
    @Published var draft = ShowcaseOfferDraft.empty() {
        didSet { if !restoring && draft != oldValue { scheduleSave() } }
    }

    private var file: SealedFile<ShowcaseOfferDraft>?
    private var namespace: String?
    private var restoring = false
    private var saveTask: Task<Void, Never>?

    private var api: NativeAPI? { showcase?.api }
    var count: Int { draft.lines.count }
    var canOffer: Bool { setup?.canOffer == true }

    // MARK: Szkic na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        namespace = next
        setup = nil
        let sealed = SealedFile<ShowcaseOfferDraft>(namespace: "showcase-offer-\(next)")
        file = sealed
        replace(.empty())
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next, let saved, draft.lines.isEmpty else { return }
            replace(saved)
        }
    }

    /// Rabat w PDF z ustawień sprzedawcy — w szkicu jeszcze nieruszanym.
    private func applyPreferredDisplay() {
        guard let display = setup?.discountDisplay, draft.updatedAt.isEmpty, draft.display != display else { return }
        var next = draft
        next.discountDisplay = display
        replace(next)
    }

    /// Jak klient widzi rabat w PDF: zmiana w szkicu i zapamiętanie wyboru sprzedawcy na serwerze (`false` — wyboru nie zapamiętano).
    func setDiscountDisplay(_ display: String) async -> Bool {
        draft.discountDisplay = display
        setup?.discountDisplay = display
        do {
            _ = try await post("offerDiscountDisplay", ["discountDisplay": .string(display)])
            return true
        } catch {
            return false
        }
    }

    func reset(clearDisk: Bool) {
        saveTask?.cancel()
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; setup = nil
        replace(.empty())
    }

    /// Szkic bez zapisu na dysk (wczytanie, wyczyszczenie).
    private func replace(_ value: ShowcaseOfferDraft) {
        restoring = true
        draft = value
        restoring = false
    }

    private func scheduleSave() {
        saveTask?.cancel()
        guard let file else { return }
        var stamped = draft
        stamped.updatedAt = ISO8601DateFormatter().string(from: Date())
        let copy = stamped
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await Task.detached(priority: .utility) { try? file.save(copy) }.value
        }
    }

    /// Nowy szkic po utworzeniu oferty (w trybie rabatu sprzedawcy).
    func clearDraft() {
        var next = ShowcaseOfferDraft.empty()
        next.discountDisplay = setup?.discountDisplay
        draft = next
    }

    // MARK: Podpowiedzi i katalog („Dodaj pozycję”, miejsce z bazy lokalizacji)
    func locations(_ text: String) async -> [ShowcaseOfferLocation] {
        struct Reply: Decodable { let locations: [ShowcaseOfferLocation] }
        var params = ["op": "offerLocations"]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["q"] = trimmed }
        guard let data = try? await get(params), let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return [] }
        return reply.locations
    }

    /// Produkt katalogu na bieżąco (warianty, pakiety) z adresami zdjęć.
    func product(_ id: String) async throws -> (ShowcaseProduct, [String: ShowcaseURLPair]) {
        struct Reply: Decodable { let product: ShowcaseProduct; let urls: [String: ShowcaseURLPair] }
        let reply = try JSONDecoder().decode(Reply.self, from: try await get(["op": "offerProduct", "id": id]))
        return (reply.product, reply.urls)
    }

    // MARK: Koszyk
    func add(_ product: ShowcaseProduct, kind: String, option: String?, item: (id: String, title: String)?) -> AddResult {
        guard let line = ShowcaseOfferRules.line(for: product, kind: kind, option: option, item: item) else { return .unavailable(product.name) }
        if draft.lines.contains(where: { $0.key == line.key }) { return .exists(line.label) }
        guard draft.lines.count < ShowcaseOfferRules.lines else { return .full }
        draft.lines.append(line)
        return .added(line.label)
    }

    func has(_ product: ShowcaseProduct, kind: String, option: String?) -> Bool {
        guard let line = ShowcaseOfferRules.line(for: product, kind: kind, option: option, item: nil) else { return false }
        return draft.lines.contains { $0.key == line.key }
    }

    // MARK: Serwer
    private func json(_ draft: ShowcaseOfferDraft) -> JSONValue {
        (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(draft))) ?? .null
    }

    private func get(_ params: [String: String]) async throws -> Data {
        guard let api else { throw AppError.configuration }
        return try await api.get("/showcase", query: params)
    }

    private func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval = 120) async throws -> Data {
        guard let showcase else { throw AppError.configuration }
        return try await showcase.post(op, body, timeout: timeout)
    }

    func loadSetup() async {
        guard let data = try? await get(["op": "offerSetup"]), var value = try? JSONDecoder().decode(ShowcaseOfferSetup.self, from: data) else { return }
        value.discountDisplay = ["total", "none"].contains(value.discountDisplay ?? "") ? value.discountDisplay : "lines"
        setup = value
        applyPreferredDisplay()
    }

    func preview(_ draft: ShowcaseOfferDraft) async throws -> ShowcaseOfferPreview {
        try JSONDecoder().decode(ShowcaseOfferPreview.self, from: try await post("offerPreview", ["draft": json(draft)]))
    }

    func clients(_ query: String) async throws -> [ShowcaseOfferClientHit] {
        struct Reply: Decodable { let clients: [ShowcaseOfferClientHit] }
        return try JSONDecoder().decode(Reply.self, from: try await get(["op": "offerClients", "q": query])).clients
    }

    func context(organization: String?, contact: String?) async throws -> ShowcaseOfferClientContext {
        var params = ["op": "offerClient"]
        if let organization { params["organization"] = organization } else if let contact { params["contact"] = contact }
        return try JSONDecoder().decode(ShowcaseOfferClientContext.self, from: try await get(params))
    }

    /// „Utwórz ofertę” — błąd po zapisaniu zapytania niesie identyfikatory zapytania i klienta (`ShowcaseOfferCreateFailure`).
    func create(_ draft: ShowcaseOfferDraft) async throws -> ShowcaseOfferResult {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/showcase") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let body: [String: JSONValue] = ["op": .string("offerCreate"), "draft": json(draft)]
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw ShowcaseOfferCreateFailure(message: object?["error"] as? String ?? "Nie udało się utworzyć oferty (\(status)).",
                                             inquiryId: object?["inquiryId"] as? String,
                                             organizationId: object?["organizationId"] as? String,
                                             contactId: object?["contactId"] as? String)
        }
        return try JSONDecoder().decode(ShowcaseOfferResult.self, from: data)
    }

    func status(_ id: String) async throws -> ShowcaseOfferStatus {
        try JSONDecoder().decode(ShowcaseOfferStatus.self, from: try await get(["op": "offerStatus", "id": id]))
    }

    func requestApproval(_ id: String, note: String) async throws -> ShowcaseOfferApproval {
        try JSONDecoder().decode(ShowcaseOfferApproval.self, from: try await post("offerApproval", ["id": .string(id), "note": .string(note)]))
    }

    /// PDF jak „Generuj PDF” w CRM (`/bridge/offers/generate-pdf`, postęp etapów) — wspólna funkcja modułu ofert.
    func generatePdf(_ id: String, progress: @escaping (String) -> Void) async throws -> Int {
        guard let offers = showcase?.workspace?.offers else { throw AppError.configuration }
        let result = try await offers.generatePdf(id, language: "pl", signature: nil) { step, detail in
            progress(detail ?? OfferPdfSteps.label(step))
        }
        return result.pageCount
    }

    /// Zapisany PDF oferty do podglądu w aplikacji (podpisany adres z serwera, 1 godzina).
    func pdf(_ id: String) async throws -> OfferPdfPreview {
        struct Link: Decodable { let url: String; let name: String }
        let link = try JSONDecoder().decode(Link.self, from: try await get(["op": "offerPdf", "id": id]))
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), !data.isEmpty else {
            throw NativeFailure(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "Nie udało się pobrać PDF oferty.", fieldErrors: [:])
        }
        return OfferPdfPreview(data: data, name: link.name)
    }

    func emailSetup(_ id: String) async throws -> ShowcaseOfferEmailSetup {
        try JSONDecoder().decode(ShowcaseOfferEmailSetup.self, from: try await get(["op": "offerEmail", "id": id]))
    }

    func sendEmail(_ id: String, to: String, subject: String, text: String, accountID: String, recipientName: String) async throws -> String? {
        struct Reply: Decodable { let warning: String? }
        let body: [String: JSONValue] = [
            "id": .string(id), "to": .string(to), "subject": .string(subject), "text": .string(text),
            "accountId": .string(accountID), "recipientName": .string(recipientName),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await post("offerEmailSend", body, timeout: 180)).warning
    }
}

// MARK: Przycisk „Do oferty” (pokaz)

struct ShowcaseOfferAddButton: View {
    let accent: Color
    let added: Bool
    var label = "Do oferty"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(added ? "W ofercie" : label, systemImage: added ? "checkmark.circle" : "plus")
                .font(.system(size: 15))
                .foregroundStyle(accent)
                .padding(.horizontal, 16).frame(height: 44)
                .background(Capsule().fill(added ? accent.opacity(0.16) : Color.clear))
                .overlay(Capsule().stroke(added ? accent : accent.opacity(0.5)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Panel oferty (obok pokazu)

@MainActor struct ShowcaseOfferPanel: View {
    @ObservedObject var offer: ShowcaseOfferStore
    let accent: Color
    /// Komunikat w oknie pokazu (sukces / błąd).
    let notify: (String, Bool) -> Void
    let close: () -> Void
    /// Oferta albo zapytanie w aplikacji (zamyka pokaz).
    let openRecord: (Module, String) -> Void
    @Binding var pdfFile: OfferPdfPreview?

    @State private var preview: ShowcaseOfferPreview?
    @State private var previewing = false
    @State private var previewError: String?
    @State private var query = ""
    @State private var hits: [ShowcaseOfferClientHit] = []
    @State private var searching = false
    @State private var newClient = false
    @State private var context: ShowcaseOfferClientContext?
    @State private var newPerson = false
    @State private var busy: String?
    @State private var result: ShowcaseOfferResult?
    @State private var pdfReady = false
    @State private var approval: ShowcaseOfferApproval?
    @State private var approvalNote = ""
    @State private var email: ShowcaseOfferEmailSetup?
    @State private var emailTo = ""
    @State private var emailSubject = ""
    @State private var emailText = ""
    @State private var emailAccount = ""
    @State private var sent = false
    @State private var customDiscount = ""
    @State private var agreedText: [String: String] = [:]
    @State private var guestsText = ""
    @State private var dropTarget: String?
    @State private var addingLine = false
    @State private var locationHits: [ShowcaseOfferLocation] = []
    @FocusState private var locationFocused: Bool

    private var draft: ShowcaseOfferDraft { offer.draft }
    private var client: ShowcaseOfferClient { offer.draft.client }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Label(result.map { "Oferta \($0.number)" } ?? "Oferta dla klienta", systemImage: "list.clipboard").font(.title3.bold())
                Spacer()
                Button { close() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Zamknij panel oferty")
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
            if let result {
                ScrollView { resultView(result).padding(16) }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if let setup = offer.setup, !setup.canOffer {
                            Text(setup.reason).font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.15)))
                        }
                        clientSection
                        eventSection
                        linesSection
                        discountSection
                        noteSection
                    }
                    .padding(16)
                }
                Divider()
                footer
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay {
            if let busy {
                ZStack {
                    Color.black.opacity(0.35)
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text(busy).font(.callout).multilineTextAlignment(.center)
                    }
                    .padding(24).frame(maxWidth: 320)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
        .task { if offer.setup == nil { await offer.loadSetup() } }
        .task(id: previewKey) {
            guard result == nil else { return }
            guard !draft.lines.isEmpty else { preview = nil; previewError = nil; previewing = false; return }
            previewing = true
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            do {
                preview = try await offer.preview(draft)
                previewError = nil
            } catch {
                previewError = offer.showcase?.failureText(error, "Nie udało się przeliczyć oferty.") ?? "Nie udało się przeliczyć oferty."
            }
            previewing = false
        }
        .task(id: query) {
            let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard term.count >= 2, !client.chosen else { hits = []; searching = false; return }
            searching = true
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            hits = (try? await offer.clients(term)) ?? []
            searching = false
        }
        .task(id: clientKey) {
            guard client.chosen else { context = nil; return }
            context = (try? await offer.context(organization: client.organizationId, contact: client.contactId)) ?? ShowcaseOfferClientContext(persons: [], inquiries: [])
        }
        .onAppear { syncFields() }
        .onChange(of: offer.draft.id) { _, _ in syncFields() }
    }

    private var previewKey: String {
        let lines = draft.lines.map { "\($0.key)|\($0.quantity)|\($0.days)|\($0.agreedPrice ?? -1)|\($0.discount)" }.joined(separator: ",")
        return "\(lines)#\(draft.discountPercent)#\(draft.event.guestCount ?? -1)#\(result?.offerId ?? "")"
    }
    private var clientKey: String { "\(client.organizationId ?? "")|\(client.contactId ?? "")" }

    /// Pola z tekstem (rabat, liczba osób, ceny uzgodnione) po wczytaniu innego szkicu.
    private func syncFields() {
        customDiscount = ShowcaseOfferRules.discountPresets.contains(draft.discountPercent) ? "" : ShowcaseOfferRules.percent(draft.discountPercent).replacingOccurrences(of: "%", with: "")
        guestsText = draft.event.guestCount.map(String.init) ?? ""
        agreedText = Dictionary(uniqueKeysWithValues: draft.lines.compactMap { line in line.agreedPrice.map { (line.key, String(format: "%.2f", $0).replacingOccurrences(of: ".", with: ",")) } })
    }

    private func update(_ change: (inout ShowcaseOfferDraft) -> Void) {
        var next = offer.draft
        change(&next)
        offer.draft = next
    }

    // MARK: Klient
    private var clientSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                if client.chosen {
                    chosenClient
                } else if client.isPlaceholder {
                    placeholderClient
                } else if newClient {
                    newClientForm
                } else {
                    HStack {
                        TextField("Firma, NIP, osoba, e-mail albo telefon", text: $query).textFieldStyle(.roundedBorder)
                        if searching { ProgressView().controlSize(.small) }
                    }
                    ForEach(hits, id: \.rowID) { hit in
                        Button { choose(hit) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: hit.kind == "organization" ? "building.2" : "person").foregroundStyle(accent).frame(width: 20)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(hit.name).lineLimit(1)
                                    if !hit.detail.isEmpty { Text(hit.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 4).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && !searching && hits.isEmpty {
                        HStack(spacing: 4) {
                            Text("Brak wyników.").foregroundStyle(.secondary)
                            Button("Dodaj nowego klienta") { newClient = true }.buttonStyle(.link)
                        }
                        .font(.callout)
                    }
                    if query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && !searching {
                        placeholderOption
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: {
            HStack {
                Label("Klient", systemImage: "building.2")
                Spacer()
                if !client.chosen && !client.isPlaceholder { Button(newClient ? "Szukaj w CRM" : "Nowy klient") { newClient.toggle() }.buttonStyle(.link) }
            }
        }
    }

    /// „Bez bazy: „nazwa”” — klient roboczy z wpisanej frazy.
    private var placeholderOption: some View {
        let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return Button { choosePlaceholder(name) } label: {
            HStack(spacing: 10) {
                Image(systemName: "pencil").foregroundStyle(accent).frame(width: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Bez bazy: „\(name)”").lineLimit(1)
                    Text("Klient roboczy — oferta bez klienta w CRM, przypiszesz go później.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var placeholderClient: some View {
        HStack(spacing: 10) {
            Image(systemName: "pencil").foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(client.placeholder ?? "").font(.headline)
                Text("Klient roboczy — bez dodawania do bazy. Klienta przypiszesz w CRM, zanim wyślesz ofertę.").font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button("Zmień") { query = client.placeholder ?? ""; clearClient() }.buttonStyle(.link)
        }
    }

    private var chosenClient: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: client.organizationId != nil ? "building.2.fill" : "person.fill").foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(client.organizationName.isEmpty ? (client.contactName.isEmpty ? "Klient z CRM" : client.contactName) : client.organizationName).font(.headline)
                    if client.organizationId != nil && !client.contactName.isEmpty { Text(client.contactName).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                Button("Zmień") { clearClient() }
            }
            if client.organizationId != nil, let context {
                Text("Osoba kontaktowa").font(.caption).foregroundStyle(.secondary)
                Picker("Osoba kontaktowa", selection: Binding(get: { newPerson ? "new" : (client.contactId ?? "") }, set: { choosePerson($0) })) {
                    Text("Bez osoby kontaktowej (oferta na firmę)").tag("")
                    ForEach(context.persons) { person in
                        Text([person.name, person.email.isEmpty ? person.phone : person.email].filter { !$0.isEmpty }.joined(separator: " — ")).tag(person.id)
                    }
                    Divider()
                    Text("+ Nowa osoba kontaktowa").tag("new")
                }
                .labelsHidden()
                .frame(maxWidth: 420, alignment: .leading)
                if newPerson { personFields }
            }
            if let context {
                Text("Zapytanie").font(.caption).foregroundStyle(.secondary)
                inquiryOption(nil, title: "Nowe zapytanie", detail: "Źródło: rozmowa na spotkaniu · etap „Zakwalifikowane”")
                ForEach(context.inquiries) { inquiry in
                    inquiryOption(inquiry, title: inquiry.title,
                                  detail: [inquiry.stageLabel, ShowcaseOfferRules.dateLabel(inquiry.date), inquiry.location].filter { !$0.isEmpty }.joined(separator: " · "))
                }
                if let inquiryID = draft.inquiryId, !context.inquiries.contains(where: { $0.id == inquiryID }) {
                    inquiryRow(active: true, title: draft.inquiryTitle.isEmpty ? "Zapytanie klienta" : draft.inquiryTitle, detail: "Oferta trafi do tego zapytania") {}
                }
            }
        }
    }

    private func inquiryOption(_ inquiry: ShowcaseOfferInquiry?, title: String, detail: String) -> some View {
        inquiryRow(active: draft.inquiryId == inquiry?.id, title: title, detail: detail) {
            update { next in
                next.inquiryId = inquiry?.id
                next.inquiryTitle = inquiry?.title ?? ""
                if let guests = inquiry?.guestCount, next.event.guestCount == nil { next.event.guestCount = guests }
            }
            guestsText = offer.draft.event.guestCount.map(String.init) ?? ""
        }
    }

    private func inquiryRow(active: Bool, title: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: active ? "largecircle.fill.circle" : "circle").foregroundStyle(active ? accent : .secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).lineLimit(1)
                    if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(active ? accent.opacity(0.12) : Color.secondary.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? accent : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var newClientForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Firma (opcjonalnie)", text: binding(\.client.company)).textFieldStyle(.roundedBorder)
            TextField("NIP", text: binding(\.client.nip)).textFieldStyle(.roundedBorder)
            personFields
            Text("Bez duplikatów: istniejąca firma (NIP, nazwa) i osoba (e-mail, telefon) zostaną użyte zamiast nowych.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var personFields: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField("Imię", text: binding(\.client.firstName)).textFieldStyle(.roundedBorder)
                TextField("Nazwisko", text: binding(\.client.lastName)).textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 8) {
                TextField("E-mail", text: binding(\.client.email)).textFieldStyle(.roundedBorder)
                TextField("Telefon", text: binding(\.client.phone)).textFieldStyle(.roundedBorder)
            }
        }
    }

    private func binding(_ path: WritableKeyPath<ShowcaseOfferDraft, String>) -> Binding<String> {
        Binding(get: { offer.draft[keyPath: path] }, set: { value in update { $0[keyPath: path] = value } })
    }

    private func choose(_ hit: ShowcaseOfferClientHit) {
        update { next in
            next.inquiryId = nil
            next.inquiryTitle = ""
            var chosen = ShowcaseOfferClient()
            chosen.organizationId = hit.organizationId
            chosen.organizationName = hit.organizationName
            if hit.kind == "contact" { chosen.contactId = hit.id; chosen.contactName = hit.name }
            next.client = chosen
        }
        query = ""
        hits = []
        newPerson = false
    }

    /// Osoba kontaktowa z listy: bez osoby, osoba firmy albo nowa osoba (`new`).
    private func choosePerson(_ id: String) {
        if id == "new" {
            newPerson = true
            update { $0.client.contactId = nil; $0.client.contactName = "" }
            return
        }
        newPerson = false
        let person = context?.persons.first { $0.id == id }
        update { next in
            next.client.contactId = person?.id
            next.client.contactName = person?.name ?? ""
            next.client.firstName = ""; next.client.lastName = ""; next.client.email = ""; next.client.phone = ""
        }
    }

    private func clearClient() {
        update { $0.client = ShowcaseOfferClient(); $0.inquiryId = nil; $0.inquiryTitle = "" }
        context = nil
        newPerson = false
    }

    /// Klient roboczy: oferta bez klienta w bazie — sama nazwa, klienta przypisuje się później w CRM.
    private func choosePlaceholder(_ name: String) {
        let clean = String(name.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(200))
        guard !clean.isEmpty else { return }
        update { next in
            var placeholder = ShowcaseOfferClient()
            placeholder.placeholder = clean
            next.client = placeholder
            next.inquiryId = nil
            next.inquiryTitle = ""
        }
        query = ""
        hits = []
        newClient = false
        newPerson = false
    }

    // MARK: Wydarzenie
    private var eventSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                if draft.inquiryId != nil {
                    let selected = context?.inquiries.first { $0.id == draft.inquiryId }
                    let place = [ShowcaseOfferRules.dateLabel(selected?.date), selected?.location ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
                    Text("Termin, miejsce i ustalenia z zapytania „\(selected?.title ?? (draft.inquiryTitle.isEmpty ? "klienta" : draft.inquiryTitle))”\(place.isEmpty ? "" : " (\(place))").")
                        .font(.callout).foregroundStyle(.secondary)
                } else {
                    TextField("Nazwa wydarzenia (np. Gala firmowa 2027)", text: binding(\.event.name)).textFieldStyle(.roundedBorder)
                    HStack(spacing: 8) {
                        Toggle("Termin", isOn: hasDate).toggleStyle(.checkbox)
                        if hasDate.wrappedValue {
                            DatePicker("", selection: eventDay, displayedComponents: .date).labelsHidden()
                            Toggle("Godzina", isOn: hasTime).toggleStyle(.checkbox)
                            if hasTime.wrappedValue { DatePicker("", selection: eventDay, displayedComponents: .hourAndMinute).labelsHidden() }
                        }
                        Spacer(minLength: 0)
                    }
                    locationField
                }
                HStack(spacing: 8) {
                    Text("Liczba osób")
                    TextField("np. 120", text: $guestsText).textFieldStyle(.roundedBorder).frame(width: 110)
                        .onChange(of: guestsText) { _, value in
                            let digits = String(value.filter(\.isNumber).prefix(6))
                            if digits != value { guestsText = digits }
                            let number = Int(digits).map { min(100_000, $0) }
                            update { $0.event.guestCount = (number ?? 0) > 0 ? number : nil }
                        }
                    Spacer(minLength: 0)
                }
                Text("Ceny „na osobę” i „na stół” liczą się z tej liczby.").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: { Label("Wydarzenie", systemImage: "calendar") }
    }

    private static let dayFormat: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    private static let fullFormat: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter
    }()

    private var hasDate: Binding<Bool> {
        Binding(get: { !offer.draft.event.date.isEmpty }, set: { on in
            update { $0.event.date = on ? Self.dayFormat.string(from: Date()) : "" }
        })
    }
    private var hasTime: Binding<Bool> {
        Binding(get: { offer.draft.event.date.contains("T") }, set: { on in
            update { next in
                let day = String(next.event.date.prefix(10))
                next.event.date = on ? "\(day)T19:00" : day
            }
        })
    }
    private var eventDay: Binding<Date> {
        Binding(get: {
            let value = offer.draft.event.date
            return (value.contains("T") ? Self.fullFormat.date(from: value) : Self.dayFormat.date(from: value)) ?? Date()
        }, set: { date in
            update { next in next.event.date = next.event.date.contains("T") ? Self.fullFormat.string(from: date) : Self.dayFormat.string(from: date) }
        })
    }

    // MARK: Miejsce — podpowiedzi z bazy lokalizacji albo własny tekst
    private var locationField: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "mappin.and.ellipse").foregroundStyle(.secondary)
                TextField("Miejsce (np. Hotel Omega, Olsztyn)", text: Binding(get: { offer.draft.event.location }, set: { value in
                    update { $0.event.location = value; $0.event.locationId = nil }
                }))
                .textFieldStyle(.roundedBorder)
                .focused($locationFocused)
                if draft.event.locationId != nil { Image(systemName: "checkmark.seal.fill").foregroundStyle(accent).help("Z bazy lokalizacji") }
            }
            if locationFocused && draft.event.locationId == nil {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(locationHits.prefix(6)) { hit in
                        Button {
                            update { $0.event.location = hit.label; $0.event.locationId = hit.id }
                            locationFocused = false
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(hit.label).lineLimit(1)
                                if !hit.address.isEmpty { Text(hit.address).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    let typed = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !typed.isEmpty && !locationHits.contains(where: { $0.label.compare(typed, options: [.caseInsensitive], locale: Locale(identifier: "pl_PL")) == .orderedSame }) {
                        Button {
                            update { $0.event.location = typed; $0.event.locationId = nil }
                            locationFocused = false
                        } label: {
                            Label("Użyj wpisanego: „\(typed)”", systemImage: "plus").foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
            }
            Text(draft.event.locationId != nil ? "Z bazy lokalizacji — zapytanie i oferta będą powiązane z obiektem."
                 : (draft.event.location.isEmpty ? "Zacznij pisać — podpowiemy obiekty z bazy lokalizacji." : "Własne miejsce — zapisze się jako tekst."))
                .font(.caption).foregroundStyle(.secondary)
        }
        .task(id: "\(locationFocused)|\(draft.event.location)") {
            guard locationFocused, draft.event.locationId == nil else { return }
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            locationHits = await offer.locations(draft.event.location)
        }
    }

    // MARK: Pozycje
    private var linesSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                if draft.lines.isEmpty {
                    Text("Dodaj pozycję z katalogu („Dodaj pozycję”) albo przyciskiem „Do oferty” przy wariancie i pakiecie na kartach pokazu.").font(.callout).foregroundStyle(.secondary)
                }
                ForEach(draft.lines) { line in lineRow(line) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: {
            HStack {
                Label("Pozycje (\(draft.lines.count))", systemImage: "list.bullet.rectangle")
                Spacer()
                if previewing { ProgressView().controlSize(.small) }
                Button { addingLine = true } label: { Label("Dodaj pozycję", systemImage: "plus") }
                    .controlSize(.small).disabled(draft.lines.count >= ShowcaseOfferRules.lines)
            }
        }
        .sheet(isPresented: $addingLine) {
            ShowcaseOfferAddLineSheet(offer: offer, accent: accent) { product, kind, option in
                switch offer.add(product, kind: kind, option: option, item: nil) {
                case .added(let label): notify("Dodano do oferty: \(label)", false); return true
                case .exists(let label): notify("\(label) jest już w ofercie.", false); return false
                case .full: notify("Oferta ma już \(ShowcaseOfferRules.lines) pozycji.", true); return false
                case .unavailable(let name):
                    notify(product.configurable == true ? "\(name): produkt z konfiguratorem — dodasz go w edytorze oferty po jej utworzeniu." : "\(name) jest wycofany z katalogu.", true)
                    return false
                }
            }
        }
    }

    private func lineRow(_ line: ShowcaseOfferLine) -> some View {
        let view = preview?.lines.first { $0.key == line.key }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                OfferDragHandle(id: line.key, label: line.label)
                VStack(alignment: .leading, spacing: 1) {
                    Text(view?.name ?? line.label).font(.body.weight(.medium))
                    if !line.itemTitle.isEmpty { Text("z karty „\(line.itemTitle)”").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(view.flatMap { $0.error == nil ? ShowcaseOfferRules.amount($0.subtotal) : nil } ?? "—").font(.body.weight(.semibold)).foregroundStyle(accent).monospacedDigit()
                    if let view, view.error == nil, line.discount > 0, let list = view.listSubtotal {
                        Text(ShowcaseOfferRules.amount(list)).font(.caption).strikethrough().foregroundStyle(.secondary).monospacedDigit()
                    }
                    if let view, view.error == nil {
                        Text("\(quantityText(view.quantity)) × \(ShowcaseOfferRules.amount(view.unitPrice))\(view.days > 1 ? " × \(Int(view.days)) dni" : "")")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
            HStack(spacing: 10) {
                if view?.quantityFromAudience == true {
                    Text("\(quantityText(view?.quantity ?? 0)) \(view?.unit == "stół" ? "stołów" : "osób") (z liczby osób)").font(.callout).foregroundStyle(.secondary)
                } else {
                    Stepper("\(line.quantity) szt.", value: lineBinding(line.key, \.quantity), in: 1...ShowcaseOfferRules.quantity)
                }
                Stepper(line.days == 1 ? "1 dzień" : "\(line.days) dni", value: lineBinding(line.key, \.days), in: 1...ShowcaseOfferRules.days)
                discountPicker(value: line.discount, label: "Rabat pozycji: \(line.label)") { value in setLineDiscount(line.key, value) }
                Spacer(minLength: 0)
                Button(role: .destructive) { update { $0.lines.removeAll { $0.key == line.key } } } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).help("Usuń z oferty")
            }
            .padding(.leading, 30)
            if line.priceOnRequest {
                HStack(spacing: 6) {
                    TextField("Uzgodniona cena netto", text: agreedBinding(line.key)).textFieldStyle(.roundedBorder).frame(width: 180)
                    Text("zł netto").foregroundStyle(.secondary)
                }
                .padding(.leading, 30)
            }
            if let error = view?.error { Text(error).font(.caption).foregroundStyle(.red).padding(.leading, 30) }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.secondary.opacity(0.07)))
        .offerDropTarget(id: line.key, enabled: true, targeted: $dropTarget) { dragged in
            let ids = offer.draft.lines.map(\.key)
            guard let order = OfferReorder.order(ids, moving: dragged, onto: line.key) else { return false }
            update { next in next.lines = order.compactMap { key in next.lines.first { $0.key == key } } }
            return true
        }
    }

    private func quantityText(_ value: Double) -> String {
        abs(value - value.rounded()) < 0.001 ? String(Int(value.rounded())) : String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }

    private func lineBinding(_ key: String, _ path: WritableKeyPath<ShowcaseOfferLine, Int>) -> Binding<Int> {
        Binding(get: { offer.draft.lines.first { $0.key == key }?[keyPath: path] ?? 1 }, set: { value in
            update { next in
                if let index = next.lines.firstIndex(where: { $0.key == key }) { next.lines[index][keyPath: path] = value }
            }
        })
    }

    private func setLineDiscount(_ key: String, _ value: Double) {
        update { next in
            if let index = next.lines.firstIndex(where: { $0.key == key }) { next.lines[index].discountPercent = value }
        }
    }

    /// Rabat z listy 0–100% (`mixed` — pozycje mają różne rabaty: „Różne” bez wyboru).
    private func discountPicker(value: Double, mixed: Bool = false, label: String, change: @escaping (Double) -> Void) -> some View {
        Picker(label, selection: Binding(get: { mixed ? -1 : value }, set: { selected in if selected >= 0 { change(selected) } })) {
            if mixed { Text("Różne — wybierz…").tag(-1.0) }
            ForEach(ShowcaseOfferRules.discountSteps(including: mixed ? nil : value), id: \.self) { step in
                Text(step > 0 ? "Rabat −\(ShowcaseOfferRules.percent(step))" : "Bez rabatu").tag(step)
            }
        }
        .labelsHidden()
        .frame(width: 140)
        .help(label)
    }

    private func agreedBinding(_ key: String) -> Binding<String> {
        Binding(get: { agreedText[key] ?? "" }, set: { value in
            agreedText[key] = value
            update { next in
                if let index = next.lines.firstIndex(where: { $0.key == key }) { next.lines[index].agreedPrice = ShowcaseOfferRules.price(value) }
            }
        })
    }

    // MARK: Rabat i notatka
    private var discountSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Text("Rabat pozycji").font(.caption).foregroundStyle(.secondary)
                linesDiscountControls
                Text("Rabat na całą ofertę").font(.caption).foregroundStyle(.secondary)
                offerDiscountControls
                Text("Liczy się od wartości pozycji po ich rabatach.").font(.caption).foregroundStyle(.secondary)
                if let preview, (preview.effectiveDiscountPercent ?? 0) > 0 {
                    Text("Rabat łączny: \(ShowcaseOfferRules.percent(preview.effectiveDiscountPercent ?? 0)) · −\(ShowcaseOfferRules.amount((preview.lineDiscountAmount ?? 0) + preview.discountAmount)) netto")
                        .font(.callout)
                }
                Divider()
                discountDisplayControls
                let hint = ShowcaseOfferRules.approvalHint(offer.setup, discount: preview?.effectiveDiscountPercent ?? preview?.discountPercent ?? draft.discountPercent)
                if !hint.isEmpty { Label(hint, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: { Label("Rabat", systemImage: "percent") }
    }

    /// Rabat przy pozycjach (lista przy każdej pozycji) i ten sam rabat dla wszystkich naraz.
    @ViewBuilder private var linesDiscountControls: some View {
        Text("Przy każdej pozycji — lista „Rabat” pod pozycją.").font(.callout).foregroundStyle(.secondary)
        if draft.lines.count > 1 {
            let first = draft.lines.first?.discount ?? 0
            let mixed = !draft.lines.allSatisfy { $0.discount == first }
            HStack(spacing: 8) {
                Text("Ten sam rabat na wszystkie pozycje").font(.callout)
                discountPicker(value: first, mixed: mixed, label: "Rabat każdej pozycji") { value in
                    update { next in for index in next.lines.indices { next.lines[index].discountPercent = value } }
                }
            }
        }
    }

    /// Rabat całej oferty: progi i własny procent.
    private var offerDiscountControls: some View {
        HStack(spacing: 6) {
            ForEach(ShowcaseOfferRules.discountPresets, id: \.self) { value in
                let active = draft.discountPercent == value && customDiscount.isEmpty
                Button {
                    customDiscount = ""
                    update { $0.discountPercent = value }
                } label: {
                    Text(ShowcaseOfferRules.percent(value)).frame(minWidth: 40).padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Capsule().fill(active ? accent.opacity(0.2) : Color.secondary.opacity(0.1)))
                        .overlay(Capsule().stroke(active ? accent : Color.clear))
                }
                .buttonStyle(.plain)
            }
            TextField("Inny", text: $customDiscount).textFieldStyle(.roundedBorder).frame(width: 70)
                .onChange(of: customDiscount) { _, value in
                    guard !value.isEmpty else { return }
                    update { $0.discountPercent = ShowcaseOfferRules.discount(value) }
                }
            Text("%").foregroundStyle(.secondary)
        }
    }

    /// Jak klient widzi rabat w PDF (preferencja sprzedawcy, zapamiętana na serwerze dla kolejnych ofert).
    private var discountDisplayControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Rabat w PDF dla klienta").font(.caption).foregroundStyle(.secondary)
            Picker("Rabat w PDF dla klienta", selection: Binding(get: { draft.display }, set: { changeDiscountDisplay($0) })) {
                ForEach(ShowcaseOfferRules.discountDisplays, id: \.key) { option in Text(option.label).tag(option.key) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text((ShowcaseOfferRules.discountDisplays.first { $0.key == draft.display }?.hint ?? "") + " Wybór zapamiętujemy — także w CRM, na iPadzie i telefonie.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func changeDiscountDisplay(_ display: String) {
        guard display != draft.display else { return }
        Task {
            let saved = await offer.setDiscountDisplay(display)
            if !saved { notify("Nie udało się zapamiętać ustawienia na serwerze — obowiązuje w tej ofercie.", true) }
        }
    }

    private var noteSection: some View {
        GroupBox {
            TextField("Co ustaliliście? (zostaje w CRM, nie trafia do PDF)", text: Binding(get: { offer.draft.note }, set: { value in
                update { $0.note = String(value.prefix(ShowcaseOfferRules.note)) }
            }), axis: .vertical)
            .lineLimit(3...6)
            .textFieldStyle(.roundedBorder)
            .padding(4)
        } label: { Label("Notatka ze spotkania", systemImage: "note.text") }
    }

    // MARK: Podsumowanie i utworzenie
    private var problem: String? {
        ShowcaseOfferRules.problem(draft) ?? preview?.problem ?? previewError
    }
    private var canCreate: Bool { offer.canOffer && problem == nil && !previewing && preview != nil && busy == nil }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let preview {
                let lineDiscount = preview.lineDiscountAmount ?? 0
                if preview.discountAmount > 0 || lineDiscount > 0 {
                    totalRow("Wartość pozycji netto", ShowcaseOfferRules.amount(preview.listNet + lineDiscount))
                    if lineDiscount > 0 {
                        totalRow("Rabaty pozycji", "−" + ShowcaseOfferRules.amount(lineDiscount))
                    }
                    if preview.discountAmount > 0 {
                        totalRow("Rabat na ofertę \(ShowcaseOfferRules.percent(preview.discountPercent))", "−" + ShowcaseOfferRules.amount(preview.discountAmount))
                    }
                    if lineDiscount > 0 && preview.discountAmount > 0 {
                        totalRow("Rabat łączny \(ShowcaseOfferRules.percent(preview.effectiveDiscountPercent ?? 0))", "−" + ShowcaseOfferRules.amount(lineDiscount + preview.discountAmount))
                    }
                }
                totalRow("Netto · VAT \(Int(preview.taxPercent))% \(ShowcaseOfferRules.amount(preview.tax))", ShowcaseOfferRules.amount(preview.net))
                HStack {
                    Text("Brutto").font(.title3.bold())
                    Spacer()
                    Text(ShowcaseOfferRules.amount(preview.gross)).font(.title3.bold()).monospacedDigit()
                }
                .foregroundStyle(accent)
            }
            if let problem, !draft.lines.isEmpty { Text(problem).font(.caption).foregroundStyle(.orange) }
            Button { Task { await create() } } label: {
                Label("Utwórz ofertę i PDF", systemImage: "doc.richtext").frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent).tint(accent).controlSize(.large)
            .disabled(!canCreate)
            .keyboardShortcut(.return, modifiers: .command)
            Text("Oferta ważna \(offer.setup?.validDays ?? ShowcaseOfferRules.validDays) dni · szkic zapisuje się na tym Macu").font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
        .padding(16)
    }

    private func totalRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.callout)
    }

    private func create() async {
        guard canCreate else { return }
        busy = "Tworzę ofertę i zapytanie…"
        let current = offer.draft
        do {
            let created = try await offer.create(current)
            result = created
            approval = created.approval
            pdfReady = false
            sent = false
            email = nil
            offer.clearDraft()
            await generatePdf(created)
        } catch let failure as ShowcaseOfferCreateFailure {
            if let inquiry = failure.inquiryId {
                // Zapytanie i klient już są w CRM — ponowna próba dopina do nich ofertę.
                update { next in
                    next.inquiryId = inquiry
                    if next.inquiryTitle.isEmpty { next.inquiryTitle = "Zapytanie ze spotkania" }
                    if failure.organizationId != nil || failure.contactId != nil {
                        next.client.organizationId = failure.organizationId
                        next.client.contactId = failure.contactId
                        next.client.company = ""; next.client.nip = ""; next.client.firstName = ""; next.client.lastName = ""
                    }
                }
            }
            busy = nil
            notify(failure.message, true)
        } catch {
            busy = nil
            notify(offer.showcase?.failureText(error, "Nie udało się utworzyć oferty.") ?? "Nie udało się utworzyć oferty.", true)
        }
    }

    private func generatePdf(_ created: ShowcaseOfferResult) async {
        busy = "Generuję PDF oferty…"
        do {
            _ = try await offer.generatePdf(created.offerId) { label in busy = label }
            pdfReady = true
        } catch {
            pdfReady = false
            let reason = (error as? OfferPdfFailure)?.message ?? offer.showcase?.failureText(error, "spróbuj ponownie.") ?? "spróbuj ponownie."
            notify("Oferta \(created.number) jest zapisana, ale PDF się nie wygenerował: \(reason)", true)
        }
        busy = nil
    }

    // MARK: Po utworzeniu
    @ViewBuilder private func resultView(_ result: ShowcaseOfferResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Oferta \(result.number) jest gotowa").font(.title3.bold())
                    Text("\(result.clientName) · \(result.inquiryCreated ? "nowe zapytanie w CRM" : "dopięta do zapytania klienta")").foregroundStyle(.secondary)
                    if result.clientPlaceholder == true {
                        Text("Klient roboczy — przypisz klienta w CRM (oferta → Klient) przed wysłaniem oferty.").font(.callout).foregroundStyle(.orange)
                    }
                    Text("\(ShowcaseOfferRules.amount(result.gross)) brutto · \(ShowcaseOfferRules.amount(result.net)) netto").font(.headline).foregroundStyle(accent)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))

            if let approval, approval.required, !approval.canSend {
                VStack(alignment: .leading, spacing: 8) {
                    Label(approval.reasons.isEmpty ? "Rabat przekracza próg." : approval.reasons.joined(separator: " · "), systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(approval.status == "pending" ? "Prośba o akceptację czeka na decyzję. Ofertę możesz już pokazać klientowi."
                         : "Ofertę możesz pokazać klientowi od razu — wyślesz ją po akceptacji rabatu.").font(.callout).foregroundStyle(.secondary)
                    if approval.status != "pending" {
                        TextField("Uzasadnienie (opcjonalnie), np. stały klient", text: $approvalNote).textFieldStyle(.roundedBorder)
                    }
                    HStack {
                        if approval.status != "pending" {
                            Button { Task { await requestApproval(result) } } label: { Label("Poproś o akceptację", systemImage: "paperplane") }
                                .buttonStyle(.borderedProminent).tint(accent)
                        }
                        Button { Task { await refresh(result) } } label: { Label("Sprawdź decyzję", systemImage: "arrow.clockwise") }
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.1)))
            }

            VStack(spacing: 8) {
                if pdfReady {
                    Button { Task { await showPdf(result) } } label: { Label("Pokaż PDF klientowi", systemImage: "doc.richtext").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).tint(accent).controlSize(.large)
                } else {
                    Button { Task { await generatePdf(result) } } label: { Label("Wygeneruj PDF", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).tint(accent).controlSize(.large).disabled(busy != nil)
                }
                Button { Task { await openEmail(result) } } label: { Label(sent ? "Wysłano e-mailem" : "Wyślij e-mailem", systemImage: "envelope").frame(maxWidth: .infinity) }
                    .controlSize(.large)
                    .disabled(!pdfReady || busy != nil || sent || approval?.canSend == false)
                    .help(approval?.canSend == false ? "Wysyłka po akceptacji rabatu" : pdfReady ? "" : "Najpierw PDF oferty")
                HStack(spacing: 8) {
                    Button { openInApp(result) } label: { Label("Otwórz w CRM", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity) }
                    Button { newOffer() } label: { Label("Nowa oferta", systemImage: "plus").frame(maxWidth: .infinity) }
                }
                .controlSize(.large)
            }

            if let email { emailForm(email, result: result) }
        }
    }

    private func emailForm(_ setup: ShowcaseOfferEmailSetup, result: ShowcaseOfferResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Wyślij ofertę \(setup.number)").font(.headline)
            if setup.accounts.isEmpty {
                Text("Nie masz skrzynki do wysyłki. Dodaj ją w Wiadomościach (Skrzynki) albo wyślij ofertę z karty oferty.").font(.callout).foregroundStyle(.secondary)
            } else {
                Picker("Z adresu", selection: $emailAccount) {
                    ForEach(setup.accounts) { account in Text(account.label).tag(account.id) }
                }
                TextField("Do (kilka adresów oddziel przecinkiem)", text: $emailTo).textFieldStyle(.roundedBorder)
                TextField("Temat", text: $emailSubject).textFieldStyle(.roundedBorder)
                TextEditor(text: $emailText).font(.body).frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
                Text("Stopka firmy dołączy się jak w CRM. PDF oferty w załączniku.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Spacer()
                    Button("Anuluj") { email = nil }
                    Button { Task { await sendEmail(result, setup: setup) } } label: { Label("Wyślij", systemImage: "paperplane") }
                        .buttonStyle(.borderedProminent).tint(accent)
                        .disabled(busy != nil || emailAccount.isEmpty || emailSubject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                  || emailText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !recipientsValid)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))
    }

    private var recipientsValid: Bool {
        let list = emailTo.split(whereSeparator: { $0 == "," || $0 == ";" }).map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return !list.isEmpty && list.allSatisfy(ShowcaseOfferRules.emailValid)
    }

    private func showPdf(_ result: ShowcaseOfferResult) async {
        busy = "Otwieram PDF…"
        do {
            pdfFile = try await offer.pdf(result.offerId)
        } catch {
            notify(offer.showcase?.failureText(error, "Nie udało się otworzyć PDF.") ?? "Nie udało się otworzyć PDF.", true)
        }
        busy = nil
    }

    private func openEmail(_ result: ShowcaseOfferResult) async {
        busy = "Przygotowuję wiadomość…"
        do {
            let setup = try await offer.emailSetup(result.offerId)
            emailTo = setup.to.isEmpty ? result.clientEmail : setup.to
            emailSubject = setup.subject
            emailText = setup.text
            emailAccount = setup.accounts.first?.id ?? ""
            email = setup
        } catch {
            notify(offer.showcase?.failureText(error, "Nie udało się przygotować wiadomości.") ?? "Nie udało się przygotować wiadomości.", true)
        }
        busy = nil
    }

    private func sendEmail(_ result: ShowcaseOfferResult, setup: ShowcaseOfferEmailSetup) async {
        busy = "Wysyłam ofertę…"
        do {
            let warning = try await offer.sendEmail(result.offerId, to: emailTo, subject: emailSubject, text: emailText, accountID: emailAccount, recipientName: setup.recipientName)
            sent = true
            email = nil
            if let warning, !warning.isEmpty { notify(warning, true) } else { notify("Oferta \(result.number) wysłana do \(emailTo).", false) }
        } catch {
            notify(offer.showcase?.failureText(error, "Nie udało się wysłać oferty.") ?? "Nie udało się wysłać oferty.", true)
        }
        busy = nil
    }

    private func requestApproval(_ result: ShowcaseOfferResult) async {
        busy = "Wysyłam prośbę o akceptację…"
        do {
            approval = try await offer.requestApproval(result.offerId, note: approvalNote)
            notify("Prośba o akceptację rabatu wysłana — dostaniesz powiadomienie po decyzji.", false)
        } catch {
            notify(offer.showcase?.failureText(error, "Nie udało się wysłać prośby o akceptację.") ?? "Nie udało się wysłać prośby o akceptację.", true)
        }
        busy = nil
    }

    private func refresh(_ result: ShowcaseOfferResult) async {
        do {
            let status = try await offer.status(result.offerId)
            approval = status.approval
            pdfReady = status.pdfReady
            if status.approval.required && status.approval.canSend { notify("Rabat zaakceptowany — możesz wysłać ofertę.", false) }
        } catch {
            notify(offer.showcase?.failureText(error, "Nie udało się odświeżyć oferty.") ?? "Nie udało się odświeżyć oferty.", true)
        }
    }

    private func openInApp(_ result: ShowcaseOfferResult) {
        let canOffers = offer.showcase?.workspace?.employee?.canView(.offers) == true
        if canOffers { openRecord(.offers, result.offerId) } else { openRecord(.inquiries, result.inquiryId) }
    }

    private func newOffer() {
        result = nil
        approval = nil
        email = nil
        sent = false
        preview = nil
        approvalNote = ""
        syncFields()
    }
}

/// Wiersz z zawijaniem (przyciski osób kontaktowych).
struct ShowcaseFlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { y += row + spacing; x = 0; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: width.isFinite ? width : widest, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

// MARK: „Dodaj pozycję” — produkt z katalogu, potem wariant, pakiet albo sam produkt (jak „Do oferty” w pokazie)

@MainActor struct ShowcaseOfferAddLineSheet: View {
    @ObservedObject var offer: ShowcaseOfferStore
    let accent: Color
    /// Dodanie pozycji — `true` zamyka okno.
    let onAdd: (ShowcaseProduct, String, String?) -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var options: [ShowcaseProductOption] = []
    @State private var product: ShowcaseProduct?
    @State private var urls: [String: ShowcaseURLPair] = [:]
    @State private var loading = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                if product != nil { Button { product = nil } label: { Label("Katalog", systemImage: "chevron.left") } }
                Text(product?.name ?? "Dodaj pozycję z katalogu").font(.title3.weight(.semibold)).lineLimit(1)
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let product {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if product.configurable == true {
                            Text("Produkt z konfiguratorem — dodasz go w edytorze oferty po jej utworzeniu.").font(.callout).foregroundStyle(.orange)
                        }
                        if !product.packages.isEmpty { Text("PAKIETY").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                        ForEach(product.packages) { pack in
                            optionRow(title: pack.name, detail: pack.scope, thumb: pack.image, price: pack.priceOnRequest ? "wycena indywidualna" : ShowcaseShared.price(pack.priceNet)) {
                                choose(product, "package", pack.id)
                            }
                        }
                        if !product.variants.isEmpty { Text("WARIANTY").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                        ForEach(product.variants) { variant in
                            optionRow(title: variant.name + (variant.recommended ? " · polecany" : ""), detail: variant.shortDescription, thumb: variant.image, price: ShowcaseShared.price(variant.priceNet)) {
                                choose(product, "variant", variant.id)
                            }
                        }
                    }
                }
            } else {
                TextField("Szukaj produktu w katalogu", text: $query).textFieldStyle(.roundedBorder)
                List(options) { option in
                    Button { Task { await open(option.id) } } label: {
                        HStack(spacing: 10) {
                            Color.clear.frame(width: 64, height: 44)
                                .overlay { if let thumb = option.thumbnailUrl { SocialImageView(url: thumb) } else { Image(systemName: "shippingbox").foregroundStyle(accent.opacity(0.5)) } }
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.name).lineLimit(1)
                                Text([option.category, option.priceNet.map { ShowcaseShared.price($0) + (option.unit.isEmpty ? "" : " / \(option.unit)") } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if loading { ProgressView().controlSize(.small) } else if let problem { Text(problem).font(.callout).foregroundStyle(.secondary) }
        }
        .padding(20)
        .frame(width: 620, height: 560)
        .task(id: product == nil ? query : "-") { await search() }
    }

    private func optionRow(title: String, detail: String, thumb: ShowcaseMedia?, price: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Color.clear.frame(width: 64, height: 44)
                    .overlay { SocialImageView(url: thumb.flatMap { urls[$0.key]?.thumb }) }
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lineLimit(1)
                    if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer()
                Text(price).foregroundStyle(accent)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(product?.configurable == true)
    }

    private func search() async {
        guard product == nil, let showcase = offer.showcase else { return }
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        loading = true
        defer { loading = false }
        do {
            options = try await showcase.products(query: query)
            problem = options.isEmpty ? "Brak produktów pasujących do wyszukiwania." : nil
        } catch {
            if !Task.isCancelled { options = []; problem = showcase.failureText(error, "Nie udało się pobrać katalogu.") }
        }
    }

    private func open(_ id: String) async {
        loading = true
        defer { loading = false }
        do {
            let (view, map) = try await offer.product(id)
            // Bez wariantów i pakietów — od razu sam produkt.
            if view.variants.isEmpty && view.packages.isEmpty {
                if onAdd(view, "product", nil) { dismiss() }
                return
            }
            urls = map
            product = view
        } catch {
            problem = offer.showcase?.failureText(error, "Nie udało się pobrać produktu.") ?? "Nie udało się pobrać produktu."
        }
    }

    private func choose(_ product: ShowcaseProduct, _ kind: String, _ option: String) {
        if onAdd(product, kind, option) { dismiss() }
    }
}

