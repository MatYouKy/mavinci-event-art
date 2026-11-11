import Foundation
import SwiftUI

// MARK: Karta wydarzenia — dane jak `/crm/events/[id]` (`src/lib/native/eventCard.ts`).

struct EventCardTabInfo: Codable, Hashable, Identifiable {
    var id: String
    var label: String
    var symbol: String {
        switch id {
        case "overview": return "square.grid.2x2"
        case "details": return "info.circle"
        case "equipment": return "shippingbox"
        case "logistics": return "truck.box"
        case "team": return "person.2"
        case "phases": return "calendar.day.timeline.left"
        case "agenda": return "list.bullet.rectangle"
        case "subcontractors": return "person.crop.rectangle.badge.checkmark"
        case "files": return "folder"
        case "tasks": return "checklist"
        case "mavinci-live": return "play.rectangle"
        case "offer": return "doc.text"
        case "calculations": return "function"
        case "contract": return "signature"
        case "seller-arrangements": return "bubble.left.and.bubble.right"
        case "finances": return "banknote"
        case "summary": return "chart.bar.doc.horizontal"
        case "history": return "clock.arrow.circlepath"
        default: return "circle"
        }
    }
}

/// Uprawnienia karty dokładnie jak `EventDetailPageClient` (liczone na serwerze).
struct EventCardFlags: Codable, Hashable {
    var tabs: [EventCardTabInfo]
    var isAdmin: Bool
    var isCreator: Bool
    var hasLimitedAccess: Bool
    var isWeddingEvent: Bool
    var userAssignmentStatus: String?
    var canViewClient: Bool
    var canViewOnsiteContact: Bool
    var canViewValues: Bool
    var canViewCommercialDocs: Bool
    var canViewBilling: Bool
    var canViewOperations: Bool
    var canEventManage: Bool
    var canManageTeam: Bool
    var canViewFinanceValues: Bool
    var canViewCommercials: Bool
    var canViewSellerCorrespondence: Bool
    var sellsEvent: Bool
    /// Role osoby w wydarzeniu (`access.roles`: admin, seller, office, manager, warehouse, driver, team…).
    var roles: [String]?
    /// Kategoria (oferty), checklista sprzętu (magazyn), podsumowanie zakresu dostępu pod Szczegółami.
    var canOffers: Bool?
    var canEquipment: Bool?
    var accessSummary: String?
    /// Akcje w Szczegółach (`showDetailsAction`).
    var showDetailsAction: Bool { canViewCommercials && canViewCommercialDocs }
    /// Edycja szczegółów (termin, lokalizacja, opis) jak `canEditEventDetails`.
    var canEditDetails: Bool { isAdmin || isCreator || canEventManage }
}

struct EventCardPage: Codable {
    var kind: String
    var canPrintCard: Bool?
    var flags: EventCardFlags?
    var event: [String: JSONValue]?
    var location: [String: JSONValue]?
    var contact: [String: JSONValue]?
    var categories: [JSONValue]?
    var offers: [JSONValue]?
    var overview: JSONValue?
    var locationName: String?
    var realization: JSONValue?
    var budget: EventBudget?
    /// Stan sprzętu w nagłówku (`EventEquipmentStatusBadge`).
    var equipmentBadge: EventEquipmentBadge?
    /// Podgląd sprzedaży kolegi: dane z wiersza wydarzenia i podsumowanie dostępu.
    var fallbackEvent: JSONValue?
    var accessSummary: String?
}

struct EventEquipmentBadge: Codable, Hashable { var label: String; var tone: String }

/// Karta „Budżet” (liczona na serwerze jak w CRM).
struct EventBudget: Codable, Hashable {
    struct Offer: Codable, Hashable {
        var id: String
        var number: String
        var accepted: Bool
        var listNet: Double
        var discountAmount: Double
        var net: Double
        var taxAmount: Double
        var gross: Double
        var taxPercent: Double?
        var hasMixedVatRates: Bool
        var logisticsPriceNet: Double?
        var costNet: Double?
        var profitNet: Double?
        var logisticsCostMissing: Bool
    }
    var source: String
    var planned: Double
    var actual: Double
    var offer: Offer?
}

/// Dodatki Szczegółów: firma realizująca, sale, historia potwierdzenia e-mail, checklista sprzętu.
struct EventCardDetails: Codable, Hashable {
    struct Company: Codable, Hashable { var id: String; var name: String?; var legal_name: String?; var logo_url: String? }
    struct Room: Codable, Hashable, Identifiable { var id: String; var name: String; var notes: String? }
    struct Rooms: Codable, Hashable { var locationId: String; var error: Bool; var rooms: [Room]; var selected: [String]; var stage: String? }
    struct Delivery: Codable, Hashable { var recipient: String; var sentAt: String }
    struct Confirmation: Codable, Hashable { var historyError: Bool; var delivery: Delivery? }
    struct Checklist: Codable, Hashable { var available: Bool; var error: Bool }
    var company: Company?
    var rooms: Rooms?
    var confirmation: Confirmation?
    var checklist: Checklist?
}

struct CachedEventDetails: Codable {
    var hash: String
    var details: EventCardDetails
    var savedAt: Date
}

struct RealizationCompany: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var legal_name: String?
    var nip: String?
    var email: String?
    var logo_url: String?
}

struct EventLocationOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var address: String?
    var city: String?
    var postal_code: String?
    var formatted_address: String?
    /// Tekst pola `location` jak `LocationSelector.handleSelectLocation`.
    var label: String { name + (city?.nonEmpty.map { ", \($0)" } ?? "") + (postal_code?.nonEmpty.map { ", \($0)" } ?? "") }
    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return true }
        return [name, city ?? "", address ?? "", formatted_address ?? ""].contains { $0.lowercased().contains(q) }
    }
}

struct EventConfirmationPreview: Codable, Hashable {
    var eventId: String
    var eventName: String
    var eventDate: String?
    var recipientEmail: String?
    var recipientName: String
}

struct CachedEventCard: Codable {
    var hash: String
    var page: EventCardPage
    var savedAt: Date
    /// Przegląd (kroki, kontrola, „Najważniejsze”) — osobny skrót, bo zmienia się częściej niż karta.
    var overview: CachedEventOverview?
    /// Dodatki Szczegółów — osobny skrót.
    var details: CachedEventDetails?
    /// Zespół wydarzenia — osobny skrót.
    var team: CachedEventTeam?
    /// Pozostałe zakładki (Harmonogram, Sprzęt, Logistyka…) — surowe dane z serwera i skrót.
    var tabs: [String: CachedEventTab]?
}

struct CachedEventTab: Codable {
    var hash: String
    var data: Data
    var savedAt: Date
}

struct CachedEventTeam: Codable {
    var hash: String
    var team: EventTeam
    var savedAt: Date
}

/// Osoba w zespole (`TeamMembersList`): przypisanie albo osoba z odpowiedzialności (autor, sprzedawca, magazyn, kierowca…).
struct EventTeamMember: Codable, Hashable, Identifiable {
    var id: String
    var employeeId: String
    var hasEmployee: Bool
    var name: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
    var role: String?
    var responsibilities: String?
    var status: String
    var invitationEmailSent: Bool
    var automatic: Bool
    var responsibilityRoles: [String]
    var permissions: [String: Bool]
}

struct EventTeam: Codable, Equatable {
    var members: [EventTeamMember]
    var error: Bool
    var leadership: JSONValue?
    var leadershipError: Bool
    var managerID: String? { leadership?.object["realization"]?.object["manager_id"]?.text.nonEmpty }
    var canManageLeader: Bool { leadership?.object["can_manage"]?.flag == true }
    var canChangeLeader: Bool { leadership?.object["can_change"]?.flag == true }
}

struct EventTeamCandidates: Codable {
    struct Employee: Codable, Hashable, Identifiable { var id: String; var name: String; var surname: String; var occupation: String? }
    struct AccessLevel: Codable, Hashable, Identifiable { var id: String; var name: String; var description: String; var slug: String? }
    struct Phase: Codable, Hashable { var phaseId: String; var name: String; var workStart: String?; var workEnd: String? }
    var employees: [Employee]
    var accessLevels: [AccessLevel]
    var phases: [String: [Phase]]
    var phasesError: Bool?
}

struct CachedEventOverview: Codable {
    var hash: String
    var overview: EventCardOverview
    var savedAt: Date
}

/// Wygodny dostęp do pól wiersza wydarzenia.
struct EventFields {
    let raw: [String: JSONValue]
    subscript(_ key: String) -> String {
        switch raw[key] {
        case .string(let value): return value
        case .number(let value): return value.rounded() == value ? String(Int(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return ""
        }
    }
    func object(_ key: String) -> [String: JSONValue] { raw[key]?.object ?? [:] }
    func number(_ key: String) -> Double? { if case .number(let v) = raw[key] { return v }; return nil }
    var id: String { self["id"] }
    var name: String { self["name"] }
    var status: String { self["status"].nonEmpty ?? "inquiry" }
    var start: Date? { MeetingDates.parse(self["event_date"]) }
    var end: Date? { MeetingDates.parse(self["event_end_date"]) }
    var categoryName: String { raw["category"]?.object["name"]?.text ?? "" }
    var categoryColor: String { raw["category"]?.object["color"]?.text ?? "" }
    var company: [String: JSONValue] { object("my_company") }
    var organization: [String: JSONValue] { object("organization") }
}
