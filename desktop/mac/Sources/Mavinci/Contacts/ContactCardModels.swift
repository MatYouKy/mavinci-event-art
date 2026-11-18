import SwiftUI

// MARK: Karta kontaktu i organizacji — dane z `/bridge/native/v1/contacts?op=card` (`src/lib/native/contactCard.ts`),
// jak `/crm/contacts/[id]`: dane, osoby kontaktowe, reprezentacja, notatki, faktury, realizacje, opiekun, segmentacja, domeny.
// Karta nie trafia do kopii na dysku (PESEL i numer dowodu osoby prywatnej są tylko w pamięci, jak w przeglądarce).

/// Otwarta karta: identyfikator i rodzaj (organizacja, kontakt, osoba prywatna).
struct ContactRef: Equatable, Hashable {
    var id: String
    var kind: ContactKind
}

struct ContactCardAccess: Decodable, Equatable {
    var canManage: Bool
    var isAdmin: Bool
    var canManageLocations: Bool
    var me: String
}

struct ContactCardOrganization: Decodable, Equatable {
    var id: String
    var organizationType: String
    var businessType: String
    var name: String
    var alias: String
    var nip: String
    var legalForm: String
    var krs: String
    var regon: String
    var ksefInternalId: String
    var address: String
    var city: String
    var postalCode: String
    var country: String
    var email: String
    var phone: String
    var website: String
    var status: String
    var rating: Int?
    var notes: String
    var locationId: String
    var primaryContactId: String
    var legalRepresentativeId: String
    var legalRepresentativeTitle: String
    var contactIsRepresentative: Bool
    var representationType: String
    var representationRule: String
    var representationBasis: String
    var representationVerifiedAt: String
    var invoiceBuyerId: String
    var invoiceRecipientRole: Int?
    var ownerId: String
    var lifecycle: String
    var domains: [String]
    var subcontractorId: String
    var createdAt: String
    var displayName: String { alias.isEmpty ? (name.isEmpty ? "Organizacja" : name) : alias }
}

struct ContactCardPersonData: Decodable, Equatable {
    var id: String
    var kind: String
    var firstName: String
    var lastName: String
    var name: String
    var email: String
    var phone: String
    var mobile: String
    var alternativeContact: String
    var businessPhone: String
    var position: String
    var nip: String
    var pesel: String
    var idNumber: String
    var eventType: String
    var eventDetails: String
    var address: String
    var city: String
    var postalCode: String
    var country: String
    var notes: String
    var status: String
    var ownerId: String
    var lifecycle: String
    var createdAt: String
    var isIndividual: Bool { kind == "individual" }
}

/// Osoba kontaktowa organizacji (`contact_organizations`, bieżące powiązanie).
struct ContactCardPerson: Decodable, Hashable {
    var relationId: String
    var id: String
    var name: String
    var position: String
    var email: String
    var phone: String
    var mobile: String
    var primary: Bool
}

/// Organizacja kontaktu (bieżące powiązanie).
struct ContactCardOrgLink: Decodable, Hashable {
    var relationId: String
    var id: String
    var name: String
    var position: String
    var primary: Bool
}

struct ContactCardPersonRef: Decodable, Hashable {
    var id: String
    var name: String
    var position: String
    var email: String
    var phone: String
    var mobile: String
}

/// Osoba decyzyjna lub dodatkowy reprezentant (`organization_decision_makers`).
struct ContactCardDecisionMaker: Decodable, Hashable, Identifiable {
    var id: String
    var contactId: String
    var name: String
    var title: String
    var canSign: Bool
    var email: String
}

struct ContactCardNote: Decodable, Hashable, Identifiable {
    var id: String
    var note: String
    var createdAt: String
    var author: String
    var own: Bool
}

struct ContactCardInvoice: Decodable, Hashable, Identifiable {
    var id: String
    var number: String
    var status: String
    var issueDate: String
    var gross: Double
    var net: Double
}

struct ContactCardEvent: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var date: String
    var status: String
}

struct ContactCardUnit: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var role: Int
}

struct ContactCardBuyer: Decodable, Hashable {
    var id: String
    var name: String
    var nip: String
    var city: String
}

struct ContactCardLocation: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var address: String
}

struct ContactCardOwner: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
}

/// Profil marketingowy (`customer_marketing_profiles`) jak `CustomerSegmentationPanel`.
struct ContactMarketingProfile: Codable, Equatable {
    var id: String
    var marketingStatus: String
    var legalBasis: String
    var deliverability: String
    var interests: [String]
    var eventTypes: [String]
    var regions: [String]
    var budgetMin: Double?
    var budgetMax: Double?
    var frequency: String
    var consentSource: String
    var consentEvidence: String
    var consentGrantedAt: String
    var consentWithdrawnAt: String
}

struct ContactSegment: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var color: String
    var system: Bool
}

struct ContactMarketing: Decodable, Equatable {
    var canEdit: Bool
    var profile: ContactMarketingProfile
    var segments: [ContactSegment]
    var selected: [String]
}

struct ContactCard: Decodable {
    var kind: String
    var id: String
    var access: ContactCardAccess
    var tabs: [String]
    var warnings: [String]
    var organization: ContactCardOrganization?
    var contact: ContactCardPersonData?
    var persons: [ContactCardPerson]?
    var decisionMakers: [ContactCardDecisionMaker]?
    var primaryContact: ContactCardPersonRef?
    var legalRepresentative: ContactCardPersonRef?
    var notes: [ContactCardNote]?
    var invoices: [ContactCardInvoice]?
    var events: [ContactCardEvent]?
    var units: [ContactCardUnit]?
    var buyer: ContactCardBuyer?
    var location: ContactCardLocation?
    var locationMissing: Bool?
    var organizations: [ContactCardOrgLink]?
    var owners: [ContactCardOwner]
    var ownerName: String
    var marketing: ContactMarketing?
}

/// Organizacja, na którą można wystawiać faktury za inną (np. gmina za szkołę).
struct ContactInvoiceBuyerOption: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var alias: String
    var nip: String
    var city: String
    var buyerId: String
    var label: String { alias.isEmpty ? name : "\(alias) — \(name)" }
    var detail: String { [nip.isEmpty ? "brak NIP" : "NIP \(nip)", city].filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// Dane firmy z GUS / KRS / CEIDG / białej listy (`/bridge/gus/company`, `GUSCompanyData`).
struct RegistryCompany: Equatable {
    struct Person: Equatable, Hashable {
        var firstName: String
        var lastName: String
        var fullName: String
        var title: String
        var kind: String
    }
    var name = "", alias = "", nip = "", regon = "", krs = "", legalForm = "", legalFormName = "", businessType = ""
    var address = "", city = "", postalCode = "", country = "", email = "", phone = "", website = ""
    var representationType = "", representationRule = "", representationBasis = "", representationVerifiedAt = ""
    var source = "", vatStatus = "", registryName = ""
    var representatives: [Person] = []
    var missingRoles: [String] = []

    init(_ json: [String: JSONValue]) {
        func value(_ key: String) -> String { json[key]?.text ?? "" }
        name = value("name"); alias = value("alias"); nip = value("nip"); regon = value("regon"); krs = value("krs")
        legalForm = value("legalForm"); legalFormName = value("legalFormName"); businessType = value("businessType")
        address = value("address"); city = value("city"); postalCode = value("postalCode"); country = value("country")
        email = value("email"); phone = value("phone"); website = value("website")
        representationType = value("representationType"); representationRule = value("representationRule")
        representationBasis = value("representationBasis"); representationVerifiedAt = value("representationVerifiedAt")
        source = value("source"); vatStatus = value("vatStatus"); registryName = value("registryName")
        representatives = (json["representatives"]?.array ?? []).map { item in
            let o = item.object
            return Person(firstName: o["firstName"]?.text ?? "", lastName: o["lastName"]?.text ?? "", fullName: o["fullName"]?.text ?? "",
                          title: o["title"]?.text ?? "", kind: o["kind"]?.text ?? "")
        }
        missingRoles = (json["registryRoles"]?.array ?? []).filter { $0.object["nameAvailable"]?.flag != true }.map { $0.object["title"]?.text ?? "" }
            .filter { !$0.isEmpty }
    }
    var sourceLabel: String {
        switch source {
        case "gus": return "GUS (REGON)"
        case "mf_whitelist": return "Biała lista VAT"
        case "krs": return "KRS"
        case "ceidg": return "CEIDG"
        default: return "Rejestry"
        }
    }
}

/// Słowniki karty jak w CRM (etap relacji, reprezentacja, segmentacja, role na fakturze, profile działalności).
enum ContactCardText {
    static let lifecycle: [InquiryOption] = [
        .init(value: "lead", label: "Nowy lead"), .init(value: "prospect", label: "Potencjalny klient"), .init(value: "customer", label: "Klient"),
        .init(value: "inactive", label: "Nieaktywny"), .init(value: "lost", label: "Utracony"),
    ]
    static let representation: [InquiryOption] = [
        .init(value: "sole", label: "Samodzielna"), .init(value: "joint", label: "Łączna"), .init(value: "joint_with_proxy", label: "Łączna z prokurentem"),
        .init(value: "proxy", label: "Pełnomocnik / prokurent"), .init(value: "other", label: "Inny sposób"),
    ]
    /// Profile działalności w formularzu organizacji (`organizationBusinessTypeLabels`, klient — bez freelancera).
    static let businessTypes: [InquiryOption] = [
        .init(value: "company", label: "Firma / instytucja"), .init(value: "hotel", label: "Hotel"), .init(value: "restaurant", label: "Restauracja"),
        .init(value: "venue", label: "Obiekt / sala eventowa"), .init(value: "other", label: "Inny profil działalności"),
    ]
    static let marketingStatus: [InquiryOption] = [
        .init(value: "unknown", label: "Nieustalony"), .init(value: "subscribed", label: "Dopuszczona"), .init(value: "unsubscribed", label: "Wypisany"),
        .init(value: "objected", label: "Sprzeciw — nie kontaktować"),
    ]
    static let legalBasis: [InquiryOption] = [
        .init(value: "none", label: "Brak"), .init(value: "consent", label: "Zgoda"), .init(value: "legitimate_interest", label: "Uzasadniony interes"),
        .init(value: "existing_customer", label: "Istniejący klient"),
    ]
    static let deliverability: [InquiryOption] = [
        .init(value: "unknown", label: "Niezweryfikowany"), .init(value: "valid", label: "Poprawny"), .init(value: "bounced", label: "Odbija wiadomości"),
        .init(value: "invalid", label: "Nieprawidłowy"),
    ]
    static let frequency: [InquiryOption] = [
        .init(value: "important_only", label: "Tylko ważne informacje"), .init(value: "occasional", label: "Okazjonalnie"),
        .init(value: "monthly", label: "Miesięcznie"), .init(value: "weekly", label: "Tygodniowo"),
    ]
    static func roleLabel(_ role: Int?) -> String {
        role == 2 ? "Oddział lub jednostka wewnętrzna nabywcy" : "Jednostka podrzędna JST (np. szkoła, przedszkole)"
    }
    /// Formy prawne z wpisem w KRS (`requiresKrsForLegalForm`).
    static let krsLegalForms: Set<String> = ["sp_zoo", "sp_jawna", "sp_partnerska", "sp_komandytowa", "sp_komandytowo_akcyjna", "sp_akcyjna",
                                             "prosta_sp_akcyjna", "spoldzielnia", "fundacja", "stowarzyszenie"]
    static func requiresKrs(_ legalForm: String) -> Bool { krsLegalForms.contains(legalForm) }
    /// Rodzaj rejestru dla podpowiedzi przy reprezentacji (`getOrganizationRegistryProfile`).
    static func representationHelp(_ legalForm: String) -> String {
        if requiresKrs(legalForm) { return "Przepisz dokładną zasadę z Działu 2 KRS. Samo nazwisko reprezentanta nie potwierdza, czy może on podpisać umowę samodzielnie." }
        switch legalForm {
        case "jdg": return "Wskaż właściciela ujawnionego w CEIDG albo osobę działającą na podstawie pełnomocnictwa."
        case "sp_cywilna": return "Wskaż wspólnika lub pełnomocnika oraz podstawę jego umocowania (CEIDG, umowa spółki albo pełnomocnictwo)."
        case "public_institution", "local_government", "state_legal_person":
            return "Wskaż dyrektora, kierownika lub pełnomocnika oraz dokument, statut albo przepis stanowiący podstawę umocowania."
        default: return "Wskaż osobę uprawnioną i rejestr, statut, uchwałę lub pełnomocnictwo stanowiące podstawę umocowania."
        }
    }
    static func invoiceStatus(_ status: String) -> String {
        switch status { case "paid": return "Opłacona"; case "issued": return "Wystawiona"; case "draft": return "Szkic"; default: return status }
    }
    static func money(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal; formatter.minimumFractionDigits = 2; formatter.maximumFractionDigits = 2
        formatter.locale = Locale(identifier: "pl_PL")
        return (formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)) + " zł"
    }
    /// Data „rrrr-mm-dd…” jako „dd.mm.rrrr”.
    static func day(_ raw: String) -> String {
        let parts = raw.prefix(10).split(separator: "-")
        guard parts.count == 3 else { return raw }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    static func stamp(_ raw: String) -> String {
        guard let date = MeetingDates.parse(raw) else { return day(raw) }
        return MeetingDates.format(date, "dd.MM.yyyy HH:mm")
    }
    /// Telefon do porównań duplikatów (`Customer360Panel.normalizePhone`): cyfry bez prefiksu 48.
    static func phoneKey(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        if digits.count == 11 && digits.hasPrefix("48") { return String(digits.dropFirst(2)) }
        return digits
    }
    /// NIP 000-000-00-00 (`formatNip`).
    static func nip(_ raw: String) -> String {
        let d = String(raw.filter(\.isNumber).prefix(10))
        let chars = Array(d)
        if chars.count <= 3 { return d }
        if chars.count <= 6 { return String(chars[0..<3]) + "-" + String(chars[3...]) }
        if chars.count <= 8 { return String(chars[0..<3]) + "-" + String(chars[3..<6]) + "-" + String(chars[6...]) }
        return String(chars[0..<3]) + "-" + String(chars[3..<6]) + "-" + String(chars[6..<8]) + "-" + String(chars[8...])
    }
}
