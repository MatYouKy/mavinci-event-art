import Foundation
import SwiftUI

// MARK: Sprzedawcy zewnętrzni (`/crm/salespeople`) — kokpit opiekuna, karta sprzedawcy z „Gotowością do pracy”
// i instrukcja opiekuna. Dane i teksty liczy serwer CRM (`/bridge/native/v1/sellers`, `src/lib/native/sellers.ts`)
// z tych samych źródeł co przeglądarka: oś w 5 etapach (`offerJourney.ts`), kroki gotowości (`readiness.ts`),
// instrukcja (`src/lib/help/managerHelp.ts`). Aplikacja tylko wyświetla i wywołuje te same operacje.

/// Kokpit opiekuna (`op=cockpit`).
struct SellerCockpitState: Decodable {
    struct Viewer: Decodable { let employeeId: String?; let isAdmin: Bool }
    struct Manager: Decodable, Identifiable, Hashable { let id: String; let name: String; let eligible: Bool }
    struct Tile: Decodable, Identifiable { let key: String; let label: String; let value: String; let helper: String; var id: String { key } }
    struct Badge: Decodable, Hashable { let text: String; let tone: String }
    struct Target: Decodable, Hashable { let kind: String; let id: String?; let tab: String?; let href: String }
    struct Inquiry: Decodable, Hashable, Identifiable { let id: String; let status: String; let guestName: String }
    struct Item: Decodable, Identifiable {
        let id: String
        let title: String
        let meta: [String]
        let quote: String?
        let at: String?
        let atStyle: String?
        let side: String?
        let sideTone: String?
        let badges: [Badge]?
        let target: Target?
        let inquiry: Inquiry?
    }
    struct TodayGroup: Decodable, Identifiable {
        let key: String; let title: String; let symbol: String; let tone: String; let empty: String; let items: [Item]
        var id: String { key }
    }
    struct Stage: Decodable, Identifiable { let key: String; let label: String; let hint: String; let count: Int; let detail: String; var id: String { key } }
    struct Upcoming: Decodable, Identifiable { let eventId: String; let name: String; let date: String?; let status: String; let sellerName: String; var id: String { eventId } }
    struct Warning: Decodable { let sellerId: String; let sellerName: String; let message: String; let label: String; let href: String }
    struct Seller: Decodable, Identifiable, Hashable {
        struct Offers: Decodable, Hashable { let draft: Int; let pdf: Int; let review: Int; let accepted: Int; let total: Int }
        let id: String
        let contactId: String?
        let name: String
        let organization: String?
        let email: String?
        let phone: String?
        let status: String
        let statusLabel: String
        let portalAccount: String
        let portalLabel: String
        let lastActivityAt: String?
        let lastSignInAt: String?
        let managerName: String?
        let backupManagerName: String?
        let managerOk: Bool
        let offers: Offers
        let upcomingEvents: Int
        let payable: String
        let forecast: String
        let hasMoney: Bool
        let warnings: [String]
        let cardHref: String
    }
    let viewer: Viewer
    let managers: [Manager]
    let managerFilter: String?
    let todayCount: Int
    let empty: Bool
    let tiles: [Tile]
    let groups: [TodayGroup]
    let stages: [Stage]
    let upcoming: [Upcoming]
    let warnings: [Warning]
    let sellers: [Seller]
    let priceRequestsError: String?
}

/// Karta sprzedawcy (`op=seller`).
struct SellerCardState: Decodable {
    struct Action: Decodable, Hashable { let kind: String; let label: String; let href: String?; let section: String? }
    struct Step: Decodable, Identifiable { let key: String; let label: String; let state: String; let detail: String; let required: Bool; let action: Action?; var id: String { key } }
    struct Summary: Decodable { let done: Int; let total: Int; let requiredDone: Int; let requiredTotal: Int; let ready: Bool; let complete: Bool }
    struct Readiness: Decodable { let summary: Summary; let steps: [Step] }
    struct Manager: Decodable { let name: String?; let backupName: String?; let ok: Bool }
    struct Portal: Decodable { let account: String; let lastSignInAt: String? }
    struct Term: Decodable, Identifiable { let companyId: String; let name: String; let active: Bool; let commission: Bool; let rate: Double?; let commissionsVisible: Bool; var id: String { companyId } }
    struct Journey: Decodable, Hashable { let index: Int; let key: String; let stageLabel: String; let state: String; let now: String; let tone: String; let actor: String; let needsAction: Bool; let ended: Bool }
    struct Offer: Decodable, Identifiable {
        let id: String; let number: String?; let title: String; let client: String?; let brand: String; let net: String?
        let eventDate: String?; let eventId: String?; let createdAt: String; let journey: Journey; let href: String
    }
    struct Event: Decodable, Identifiable { let id: String; let name: String; let date: String?; let status: String; let brand: String? }
    struct Links: Decodable { let card: String; let settings: String; let branding: String; let chat: String; let settlements: String; let pricing: String }
    let id: String
    let contactId: String?
    let readiness: Readiness?
    let readinessError: String?
    let manager: Manager
    let portal: Portal
    let terms: [Term]
    let canViewOffers: Bool
    let offers: [Offer]
    let events: [Event]
    let links: Links
}

/// Instrukcja opiekuna (`op=help`) — ta sama treść co panel „?” w CRM.
struct SellersHelp: Decodable {
    struct FAQ: Decodable, Hashable { let q: String; let a: String }
    struct Chapter: Decodable, Identifiable, Hashable { let id: String; let title: String; let summary: String; let steps: [String]?; let notes: [String]?; let faq: [FAQ]? }
    struct Stage: Decodable, Identifiable { let key: String; let label: String; let hint: String; var id: String { key } }
    let title: String
    let stages: [Stage]
    let chapters: [Chapter]
}

/// Daty jak w CRM (`sellerUi.tsx`): „dziś, 14:05”, „wczoraj”, „5 dni temu”; „dziś”, „jutro”, „za 4 dni”.
enum SellerDates {
    private static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = iso.date(from: raw) { return value }
        iso.formatOptions = [.withInternetDateTime]
        if let value = iso.date(from: raw) { return value }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = zone; day.dateFormat = "yyyy-MM-dd HH:mm"
        return day.date(from: String(raw.prefix(10)) + " 12:00")
    }
    private static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = zone; return c }
    private static func days(from: Date, to: Date) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: from), to: calendar.startOfDay(for: to)).day ?? 0
    }
    static func relative(_ raw: String?, empty: String = "") -> String {
        guard let value = date(raw) else { return empty }
        let ago = days(from: value, to: Date())
        if ago <= 0 {
            let time = DateFormatter(); time.locale = Locale(identifier: "pl_PL"); time.timeZone = zone; time.dateFormat = "HH:mm"
            return "dziś, \(time.string(from: value))"
        }
        if ago == 1 { return "wczoraj" }
        if ago < 30 { return "\(ago) dni temu" }
        let months = ago / 30
        if months < 12 { return months == 1 ? "miesiąc temu" : "\(months) mies. temu" }
        return Labels.date(raw ?? "")
    }
    static func until(_ raw: String?) -> String {
        guard let value = date(raw) else { return "bez terminu" }
        let ahead = days(from: Date(), to: value)
        if ahead < 0 { return "\(-ahead) dni temu" }
        if ahead == 0 { return "dziś" }
        if ahead == 1 { return "jutro" }
        return "za \(ahead) dni"
    }
}

/// Kolory tonów z serwera (oś, stan, ostrzeżenia).
enum SellerTone {
    static func color(_ tone: String?, accent: Color) -> Color {
        switch tone {
        case "action", "brand": return accent
        case "waiting", "info": return .blue
        case "success": return .green
        case "danger": return .red
        case "warning": return .orange
        default: return .secondary
        }
    }
}

@MainActor final class SellersStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var cockpit: SellerCockpitState?
    @Published var loadError: String?
    @Published private(set) var loading = false
    @Published private(set) var help: SellersHelp?
    @Published var helpError: String?
    /// Karty sprzedawców pobrane w tej sesji (odświeżane przy każdym otwarciu).
    @Published private(set) var cards: [String: SellerCardState] = [:]
    /// Konto prowizji i narzutów sprzedawcy (sekcja „Prowizje i narzuty” karty, `EmployeeCommissionsView`) i błąd wczytania.
    @Published var commissionAccounts: [String: EmployeeCommissionAccount] = [:]
    @Published var commissionErrors: [String: String] = [:]
    /// Sprzedawca (kontakt) do pokazania po wejściu na ekran — „Sprzedaż sprzedawcy” z karty kontaktu; ekran go zaznacza i czyści.
    @Published var focusSellerContact: String?
    /// Filtr opiekuna (tylko administrator); pusty — wszyscy.
    @Published var managerFilter: String = UserDefaults.standard.string(forKey: "sellersManagerFilter") ?? "" {
        didSet { UserDefaults.standard.set(managerFilter, forKey: "sellersManagerFilter") }
    }

    var api: NativeAPI? { workspace?.nativeAPI() }

    func reset() {
        cockpit = nil; loadError = nil; loading = false; help = nil; helpError = nil; cards = [:]; commissionAccounts = [:]; commissionErrors = [:]
        focusSellerContact = nil
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func load() async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        loading = true
        defer { loading = false }
        do {
            let path = "/sellers?op=cockpit" + (managerFilter.isEmpty ? "" : "&manager=\(managerFilter)")
            let data = try JSONDecoder().decode(SellerCockpitState.self, from: try await api.get(path))
            guard owner == workspace?.employee?.id else { return }
            // Nieaktualny filtr opiekuna (np. po zmianie uprawnień) — wracamy do wszystkich.
            if !managerFilter.isEmpty, !data.viewer.isAdmin || (!data.managers.isEmpty && !data.managers.contains(where: { $0.id == managerFilter }) && managerFilter != data.viewer.employeeId) {
                managerFilter = ""
            }
            cockpit = data
            loadError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            loadError = failureText(error, "Nie udało się wczytać kokpitu opiekuna.")
        }
    }

    func card(_ id: String) async throws -> SellerCardState {
        guard let api else { throw AppError.configuration }
        let owner = workspace?.employee?.id
        let data = try JSONDecoder().decode(SellerCardState.self, from: try await api.get("/sellers?op=seller&id=\(id)"))
        guard owner == workspace?.employee?.id else { throw AppError.unauthorized }
        cards[id] = data
        return data
    }

    func loadHelp() async {
        guard help == nil, let api else { return }
        do {
            help = try JSONDecoder().decode(SellersHelp.self, from: try await api.get("/sellers?op=help"))
            helpError = nil
        } catch {
            helpError = failureText(error, "Nie udało się wczytać instrukcji.")
        }
    }

    /// Odpowiedź na zapytanie klienta od sprzedawcy (`respond_seller_inquiry`).
    func respond(inquiry: String, status: String, response: String) async -> String? {
        guard let api, let workspace, workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        do {
            let reply = try await workspace.withPending("Zapisywanie odpowiedzi…") {
                try await api.post("/sellers", ["op": .string("inquiryRespond"), "id": .string(inquiry), "status": .string(status), "response": .string(response)])
            }
            let message = (try? JSONDecoder().decode([String: JSONValue].self, from: reply))?["message"]?.text
            workspace.succeed(message?.isEmpty == false ? message! : "Zapisano.")
            await load()
            return nil
        } catch {
            return failureText(error, "Nie udało się zapisać odpowiedzi.")
        }
    }

    /// Zapytanie CRM z zapytania klienta (`convert_seller_inquiry`) — zwraca identyfikator zapytania CRM.
    func convert(inquiry: String) async -> String? {
        guard let api, let workspace, workspace.canWrite else { workspace?.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending("Tworzenie zapytania CRM…") {
                try await api.post("/sellers", ["op": .string("inquiryConvert"), "id": .string(inquiry)])
            }
            let id = (try? JSONDecoder().decode([String: JSONValue].self, from: reply))?["inquiryId"]?.text
            await load()
            return id?.isEmpty == false ? id : nil
        } catch {
            workspace.error = failureText(error, "Nie udało się utworzyć zapytania CRM.")
            return nil
        }
    }

    /// Ponowne zaproszenie do portalu — ta sama trasa co w CRM (`/bridge/seller/invite`, token pracownika).
    func resendInvite(_ partnerId: String) async -> Bool {
        guard let api, let workspace, workspace.canWrite,
              let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/seller/invite") else {
            workspace?.error = "Wysłanie zaproszenia wymaga połączenia z serwerem CRM."
            return false
        }
        do {
            let result: [String: JSONValue] = try await workspace.withPending("Wysyłanie zaproszenia…") {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.timeoutInterval = 60
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
                request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
                request.httpBody = try JSONEncoder().encode(["salesPartnerId": JSONValue.string(partnerId), "forceEmail": .bool(true)])
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 401 { throw AppError.unauthorized }
                let body = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
                guard (200..<300).contains(status) else {
                    let message = body["error"]?.text ?? ""
                    throw NativeFailure(status: status, message: message.isEmpty ? "Nie udało się wysłać zaproszenia (HTTP \(status))." : message, fieldErrors: [:])
                }
                return body
            }
            let email = result["email"]?.text ?? ""
            workspace.succeed(result["emailSent"]?.flag == true ? "Zaproszenie wysłano ponownie na \(email)." : "Konto \(email) jest już połączone z portalem.")
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się wysłać zaproszenia.")
            return false
        }
    }
}
