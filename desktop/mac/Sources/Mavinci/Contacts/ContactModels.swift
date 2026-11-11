import SwiftUI

// MARK: Kontakty — model jak w CRM (`/crm/contacts`, `clientsApi.getClientsList`, `src/lib/native/contacts.ts`,
// `/bridge/native/v1/contacts`).

enum ContactKind: String, CaseIterable, Identifiable {
    case organization, contact, individual
    var id: String { rawValue }
    var label: String {
        switch self { case .organization: return "Organizacja"; case .contact: return "Kontakt"; case .individual: return "Osoba prywatna" }
    }
    var plural: String {
        switch self { case .organization: return "Organizacje"; case .contact: return "Kontakty"; case .individual: return "Osoby prywatne" }
    }
    /// Ikony jak na stronie: Building2, User, UserCircle.
    var symbol: String {
        switch self { case .organization: return "building.2"; case .contact: return "person"; case .individual: return "person.crop.circle" }
    }
    /// Kolory odznak jak `getContactTypeColor` w CRM.
    var color: Color {
        switch self {
        case .organization: return CrmTheme.rgb(0x60a5fa); case .contact: return CrmTheme.rgb(0x4ade80); case .individual: return CrmTheme.rgb(0x9ca3af)
        }
    }
}

/// Bieżące powiązanie kontaktu z organizacją (`contact_organizations.is_current`).
struct ContactLink: Codable, Hashable {
    var relationId: String
    var position: String
    var primary: Bool
    var decisionMaker: Bool
    var id: String
    var name: String
}

struct ContactEntry: Codable, Hashable, Identifiable {
    var key: String
    var id: String
    var kind: String
    var name: String
    var legalName: String
    var alias: String
    var email: String
    var phone: String
    var mobile: String
    var city: String
    var status: String
    var rating: Int?
    var tags: [String]
    var avatarUrl: String?
    var createdAt: String?
    var seller: Bool
    var sellerStatus: String
    var address: String
    var postalCode: String
    var country: String
    var website: String
    var nip: String
    var notes: String
    var lifecycle: String
    var businessType: String
    var legalForm: String
    var krs: String
    var regon: String
    var mapsUrl: String
    var firstName: String
    var lastName: String
    var position: String
    var businessPhone: String
    var companyName: String
    var alternativeContact: String
    var eventType: String
    var eventDetails: String
    var links: [ContactLink]
    var count: Int?

    var contactKind: ContactKind { ContactKind(rawValue: kind) ?? .contact }
    var isOrganization: Bool { contactKind == .organization }
    var isIndividual: Bool { contactKind == .individual }
    /// Telefon na karcie listy (`mobile || phone`).
    var listPhone: String { mobile.isEmpty ? phone : mobile }
    /// „Zadzwoń” jak na karcie kontaktu: osoba prywatna — telefon główny, pozostali — komórkowy.
    var callPhone: String {
        if isIndividual { return phone.isEmpty ? mobile : phone }
        return mobile.isEmpty ? phone : mobile
    }
    var created: Date? { createdAt.flatMap(MeetingDates.parse) }
    var relatedCount: Int { count ?? links.count }
    var greetingName: String { isOrganization ? "" : firstName }
    /// Wyszukiwanie jak na stronie: nazwa i e-mail bez wielkości liter, telefony dosłownie.
    func matches(_ query: String) -> Bool {
        let raw = query.trimmingCharacters(in: .whitespaces)
        if raw.isEmpty { return true }
        let lower = raw.lowercased()
        return name.lowercased().contains(lower) || legalName.lowercased().contains(lower) || email.lowercased().contains(lower)
            || phone.contains(raw) || mobile.contains(raw)
    }
    var sellerLabel: String {
        if isOrganization { return "Sprzedawcy" }
        switch sellerStatus { case "onboarding": return "Sprzedawca — do uzgodnienia"; case "inactive": return "Sprzedawca nieaktywny"; default: return "Sprzedawca" }
    }
    var sellerHelp: String {
        if isOrganization { return "W tej organizacji pracują sprzedawcy z dostępem do portalu" }
        switch sellerStatus {
        case "onboarding": return "Profil sprzedawcy w trakcie uzgadniania warunków"
        case "inactive": return "Profil sprzedawcy jest nieaktywny"
        default: return "Aktywny sprzedawca zewnętrzny"
        }
    }
    var sellerColor: Color {
        if !isOrganization && sellerStatus == "onboarding" { return CrmTheme.rgb(0xfde68a) }
        if !isOrganization && sellerStatus == "inactive" { return .secondary }
        return CrmTheme.rgb(0xd3bb73)
    }
    var fullAddress: String {
        let place = [postalCode, city].filter { !$0.isEmpty }.joined(separator: " ")
        return [address, place, country].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Uprawnienia sekcji (liczone na serwerze jak w CRM: `contacts_manage` do edycji i usuwania).
struct ContactAccess: Codable, Equatable {
    var canManage: Bool
    var canCreate: Bool
    var isAdmin: Bool
}

enum ContactTypeFilter: String, CaseIterable, Identifiable {
    case all, organization, contact, individual
    var id: String { rawValue }
    var label: String { self == .all ? "Wszystkie typy" : ContactKind(rawValue: rawValue)!.plural }
    func matches(_ entry: ContactEntry) -> Bool { self == .all || entry.kind == rawValue }
}

enum ContactViewMode: String, CaseIterable, Identifiable {
    case grid, list
    var id: String { rawValue }
    var label: String { self == .grid ? "Kafelki" : "Lista" }
    var symbol: String { self == .grid ? "square.grid.2x2" : "list.bullet" }
}

/// Słowniki formularzy jak w CRM (`businessTypeLabels`, `organizationStatusLabels`, `legalFormLabels`, rodzaje uroczystości).
enum ContactDictionaries {
    static let businessTypes: [InquiryOption] = [
        .init(value: "company", label: "Firma"), .init(value: "hotel", label: "Hotel"), .init(value: "restaurant", label: "Restauracja"),
        .init(value: "venue", label: "Miejsce eventowe"), .init(value: "freelancer", label: "Freelancer"), .init(value: "other", label: "Inne"),
    ]
    static let organizationStatuses: [InquiryOption] = [
        .init(value: "active", label: "Aktywna"), .init(value: "inactive", label: "Nieaktywna"), .init(value: "blacklisted", label: "Czarna lista"),
    ]
    static let legalForms: [InquiryOption] = [
        .init(value: "jdg", label: "Jednoosobowa działalność gospodarcza (JDG)"),
        .init(value: "sp_zoo", label: "Spółka z ograniczoną odpowiedzialnością (sp. z o.o.)"),
        .init(value: "sp_jawna", label: "Spółka jawna"), .init(value: "sp_partnerska", label: "Spółka partnerska"),
        .init(value: "sp_cywilna", label: "Spółka cywilna"), .init(value: "sp_komandytowa", label: "Spółka komandytowa"),
        .init(value: "sp_komandytowo_akcyjna", label: "Spółka komandytowo-akcyjna"), .init(value: "sp_akcyjna", label: "Spółka akcyjna (S.A.)"),
        .init(value: "prosta_sp_akcyjna", label: "Prosta spółka akcyjna (P.S.A.)"), .init(value: "spoldzielnia", label: "Spółdzielnia"),
        .init(value: "fundacja", label: "Fundacja"), .init(value: "stowarzyszenie", label: "Stowarzyszenie"),
        .init(value: "public_institution", label: "Instytucja publiczna / jednostka sektora publicznego"),
        .init(value: "local_government", label: "Jednostka samorządu terytorialnego"),
        .init(value: "state_legal_person", label: "Państwowa osoba prawna"),
        .init(value: "other_legal_entity", label: "Inna osoba prawna lub jednostka organizacyjna"), .init(value: "other", label: "Inna"),
    ]
    static let eventTypes: [InquiryOption] = [
        .init(value: "wesele", label: "Wesele"), .init(value: "urodziny", label: "Urodziny"), .init(value: "rocznica", label: "Rocznica"),
        .init(value: "impreza firmowa", label: "Impreza firmowa"), .init(value: "dodatki", label: "Dodatki"), .init(value: "inne", label: "Inne"),
    ]
    static func label(_ value: String, in options: [InquiryOption]) -> String {
        value.isEmpty ? "" : (options.first { $0.value == value }?.label ?? value)
    }
}

enum ContactFormat {
    static func date(_ date: Date?) -> String { date.map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "" }
    /// „Wyświetlono N kontaktów” z poprawną odmianą.
    static func count(_ n: Int) -> String {
        let tens = n % 100, units = n % 10
        if n == 1 { return "1 kontakt" }
        if (2...4).contains(units) && !(12...14).contains(tens) { return "\(n) kontakty" }
        return "\(n) kontaktów"
    }
}
