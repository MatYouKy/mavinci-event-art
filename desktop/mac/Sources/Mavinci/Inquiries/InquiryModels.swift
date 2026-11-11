import SwiftUI

// MARK: Lejek zapytań — model jak w CRM (`src/lib/CRM/inquiries/pipeline.ts`, `InquiriesPageClient`, `/bridge/native/v1/inquiries`).

enum InquiryStage: String, CaseIterable, Identifiable {
    case new, contacted, qualified, proposal, negotiation, won, lost
    var id: String { rawValue }
    init(raw: String) { self = InquiryStage(rawValue: raw) ?? .new }
    var label: String {
        switch self {
        case .new: return "Nowe zapytanie"; case .contacted: return "Kontakt podjęty"; case .qualified: return "Zakwalifikowane"
        case .proposal: return "Oferta wysłana"; case .negotiation: return "Negocjacje"; case .won: return "Wygrane"; case .lost: return "Przegrane"
        }
    }
    var shortLabel: String {
        switch self {
        case .new: return "Nowe"; case .contacted: return "Kontakt"; case .qualified: return "Kwalifikacja"
        case .proposal: return "Oferta"; case .negotiation: return "Negocjacje"; case .won: return "Wygrane"; case .lost: return "Przegrane"
        }
    }
    var color: Color {
        switch self {
        case .new: return CrmTheme.rgb(0xfbbf24); case .contacted: return CrmTheme.rgb(0x38bdf8); case .qualified: return CrmTheme.rgb(0x60a5fa)
        case .proposal: return CrmTheme.rgb(0xa78bfa); case .negotiation: return CrmTheme.rgb(0xe879f9); case .won: return CrmTheme.rgb(0x34d399)
        case .lost: return CrmTheme.rgb(0xf87171)
        }
    }
    var defaultProbability: Int {
        switch self { case .new: return 10; case .contacted: return 20; case .qualified: return 40; case .proposal: return 60; case .negotiation: return 75; case .won: return 100; case .lost: return 0 }
    }
    var closed: Bool { self == .won || self == .lost }
}

struct InquiryOption: Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}
let inquiryLostCategories: [InquiryOption] = [
    .init(value: "price", label: "Cena"), .init(value: "availability", label: "Brak dostępnego terminu"),
    .init(value: "competitor", label: "Wybrano konkurencję"), .init(value: "no_response", label: "Brak odpowiedzi klienta"),
    .init(value: "scope", label: "Zakres poza ofertą"), .init(value: "timing", label: "Odłożona decyzja"),
    .init(value: "market_research", label: "Badanie rynku"), .init(value: "duplicate", label: "Duplikat zapytania"),
    .init(value: "other", label: "Inny powód"),
]

struct Inquiry: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var titleLabel: String
    var sourceLabel: String
    var typeLabels: [String]
    var description: String
    var message: String
    var stage: String
    var ownerId: String?
    var ownerName: String
    var ownerTeamId: String?
    var nextActionAt: String?
    var lastContactAt: String?
    var firstContactAt: String?
    var slaDueAt: String?
    var estimatedValue: Double?
    var probability: Int
    var lostReason: String
    var lostReasonCategory: String
    var linkedOfferId: String?
    var eventId: String?
    var contactId: String?
    var organizationId: String?
    var clientText: String
    var clientCompany: String
    var clientPhone: String
    var clientEmail: String
    var locationText: String
    var scope: String
    var sourceName: String
    var member: Bool
    var createdAt: String

    var inquiryStage: InquiryStage { InquiryStage(raw: stage) }
    var isOpen: Bool { !inquiryStage.closed }
    var nextAction: Date? { nextActionAt.flatMap(MeetingDates.parse) }
    var lastContact: Date? { lastContactAt.flatMap(MeetingDates.parse) }
    var firstContact: Date? { firstContactAt.flatMap(MeetingDates.parse) }
    var slaDue: Date? { slaDueAt.flatMap(MeetingDates.parse) }
    var created: Date { MeetingDates.parse(createdAt) ?? .distantPast }
    func overdue(_ now: Date = Date()) -> Bool { isOpen && (nextAction.map { $0 < now } ?? false) }
    func firstContactBreached(_ now: Date = Date()) -> Bool {
        isOpen && ownerId != nil && firstContactAt == nil && (slaDue.map { $0 < now } ?? false)
    }
    var missingNextAction: Bool { isOpen && firstContactAt != nil && nextActionAt == nil }
    /// Braki jak na karcie w CRM (`getInquiryWarnings`).
    var warnings: [String] {
        guard isOpen else { return [] }
        var result: [String] = []
        if ownerId == nil { result.append("Brak opiekuna") }
        if clientEmail.isEmpty && clientPhone.isEmpty { result.append("Brak danych kontaktowych") }
        if nextActionAt == nil { result.append("Brak następnego działania") }
        if [.qualified, .proposal, .negotiation].contains(inquiryStage) && (estimatedValue ?? 0) == 0 { result.append("Brak wartości") }
        if [.proposal, .negotiation].contains(inquiryStage) && linkedOfferId == nil { result.append("Brak powiązanej oferty") }
        return result
    }
    var weightedValue: Double { isOpen ? (estimatedValue ?? 0) * Double(probability) / 100 : 0 }
    var searchText: String {
        ([title, titleLabel, typeLabels.joined(separator: " "), sourceLabel, description, clientText, clientCompany, clientEmail, clientPhone,
          locationText, scope, sourceName, ownerName, lostReason]).joined(separator: " ").lowercased()
    }
}

/// Uprawnienia lejka (liczone na serwerze tak jak w CRM).
struct InquiryAccess: Codable, Equatable {
    var employeeId: String
    var salesTeamId: String?
    var isTeamManager: Bool
    var isAdmin: Bool
    var canViewPool: Bool
    var canViewTeam: Bool
    var canViewAll: Bool
    var canAssign: Bool
    var canClaim: Bool
    var canCreate: Bool
    var manageAll: Bool
    var manageOwn: Bool
    var manageTeam: Bool

    /// `canManageInquiry` z CRM: wszystkie, własne albo zespołu (menedżer zespołu).
    func canManage(_ inquiry: Inquiry) -> Bool {
        if isAdmin || manageAll { return true }
        if inquiry.ownerId == employeeId && manageOwn { return true }
        return isTeamManager && salesTeamId != nil && inquiry.ownerTeamId == salesTeamId && manageTeam
    }
}

enum InquiryScope: String, CaseIterable, Identifiable {
    case mine, collaborating, pool, team, all
    var id: String { rawValue }
    var label: String {
        switch self { case .mine: return "Moje"; case .collaborating: return "Współpracuję"; case .pool: return "Nieprzypisane"; case .team: return "Zespół"; case .all: return "Wszystkie" }
    }
    var symbol: String {
        switch self { case .mine: return "person"; case .collaborating: return "person.2"; case .pool: return "tray"; case .team: return "person.3"; case .all: return "square.grid.2x2" }
    }
}

enum InquiryStatusFilter: String, CaseIterable, Identifiable {
    case open, completed, all
    var id: String { rawValue }
    var label: String { switch self { case .open: return "Aktywne"; case .completed: return "Zamknięte"; case .all: return "Wszystkie" } }
}

enum InquiryAttention: String, CaseIterable, Identifiable {
    case unassigned, firstContact, overdue, missingNext
    var id: String { rawValue }
    var label: String {
        switch self {
        case .unassigned: return "Bez opiekuna"; case .firstContact: return "SLA pierwszego kontaktu"
        case .overdue: return "Zaległe działania"; case .missingNext: return "Brak następnego działania"
        }
    }
    var color: Color {
        switch self {
        case .unassigned: return CrmTheme.rgb(0xfbbf24); case .firstContact: return CrmTheme.rgb(0xf87171)
        case .overdue: return CrmTheme.rgb(0xfb923c); case .missingNext: return CrmTheme.rgb(0xa78bfa)
        }
    }
    func matches(_ inquiry: Inquiry, now: Date) -> Bool {
        switch self {
        case .unassigned: return inquiry.isOpen && inquiry.ownerId == nil
        case .firstContact: return inquiry.firstContactBreached(now)
        case .overdue: return inquiry.overdue(now)
        case .missingNext: return inquiry.missingNextAction
        }
    }
}

enum InquiryFormat {
    private static let currency: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .currency; f.currencyCode = "PLN"; f.maximumFractionDigits = 0; return f
    }()
    static func money(_ value: Double) -> String { currency.string(from: NSNumber(value: value)) ?? "\(Int(value)) zł" }
    static func short(_ date: Date) -> String { MeetingDates.format(date, "dd.MM, HH:mm") }
    static func full(_ date: Date) -> String { MeetingDates.format(date, "d MMMM yyyy, HH:mm") }
}
