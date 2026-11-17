import Foundation
import SwiftUI

// MARK: Kampanie e-mail — odpowiedzi `/bridge/native/v1/campaigns` (`src/lib/native/campaigns.ts`), etykiety i kolory
// statusów jak w `CampaignsPageClient` oraz szkic edycji wersji roboczej.

struct MailCampaignAccess: Decodable, Hashable {
    var canView: Bool
    var canManage: Bool
    var canApprove: Bool
}

struct MailCampaignAudience: Decodable, Hashable {
    var entityTypes: [String]
    var eventTypes: [String]
    var regions: [String]
    var budgetMin: Double?
    var budgetMax: Double?
}

struct MailCampaign: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var subject: String
    var content: String
    var previewText: String
    var status: String
    var emailAccountId: String
    var templateId: String
    var segmentIds: [String]
    var audience: MailCampaignAudience
    var eligibleCount: Int
    var excludedCount: Int
    var sentCount: Int
    var failedCount: Int
    var openedCount: Int
    var clickedCount: Int
    var unsubscribedCount: Int
    var testSentAt: String
    var testSentTo: String
    var submittedAt: String
    var approvedAt: String
    var scheduledAt: String
    var startedAt: String
    var completedAt: String
    var pausedAt: String
    var batchSize: Int
    var sendIntervalSeconds: Int
    var trackOpens: Bool
    var trackClicks: Bool
    var updatedAt: String
    var brochureGenerationId: String

    var state: MailCampaignStatus { MailCampaignStatus(rawValue: status) ?? .draft }
    var hasBrochure: Bool { !brochureGenerationId.isEmpty }
    /// Kolejka pracuje — lista i odbiorcy odświeżani co 15 s (jak w CRM).
    var isRunning: Bool { state == .scheduled || state == .sending }
}

struct MailCampaignSegment: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var color: String
    var description: String
}

struct MailCampaignAccount: Decodable, Identifiable, Hashable {
    var id: String
    var email: String
    var fromName: String
    var label: String { fromName.isEmpty ? email : "\(fromName) — \(email)" }
}

struct MailCampaignTemplate: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var subject: String
    var body: String
}

struct MailCampaignHome: Decodable {
    var access: MailCampaignAccess
    var campaigns: [MailCampaign]
    var segments: [MailCampaignSegment]
    var accounts: [MailCampaignAccount]
    var templates: [MailCampaignTemplate]
}

struct MailCampaignRecipient: Decodable, Identifiable, Hashable {
    var id: String
    var email: String
    var name: String
    var legalBasis: String
    var status: String
    var exclusionReason: String
    var sentAt: String
    var openedAt: String
    var clickedAt: String
    var failedAt: String
    var attempts: Int
    var error: String

    var isExcluded: Bool { status == "excluded" || status == "unsubscribed" }
    var statusText: String {
        let label = MailCampaignLabels.recipientStatus[status] ?? status
        guard !exclusionReason.isEmpty else { return label }
        return "\(label) — \(MailCampaignLabels.exclusion[exclusionReason] ?? exclusionReason)"
    }
    var statusColor: Color {
        if ["sent", "delivered", "opened", "clicked", "replied"].contains(status) { return CrmTheme.rgb(0x6ee7b7) }
        if ["failed", "bounced"].contains(status) { return CrmTheme.rgb(0xfca5a5) }
        if ["excluded", "unsubscribed"].contains(status) { return CrmTheme.rgb(0xfcd34d) }
        if ["queued", "processing", "retry"].contains(status) { return CrmTheme.rgb(0x7dd3fc) }
        return Color.secondary
    }
}

struct MailCampaignRecipients: Decodable {
    var recipients: [MailCampaignRecipient]
}

struct MailCampaignDemoReport: Decodable, Hashable {
    var visits: Int
    var sessions: Int
    var pdfs: Int
    var downloads: Int
}

struct MailCampaignDemo: Decodable {
    var report: MailCampaignDemoReport
    var brochureId: String
    var tagged: Bool
    var url: String
}

enum MailCampaignStatus: String, CaseIterable {
    case draft, pending_approval, approved, scheduled, sending, paused, sent, cancelled, failed

    var label: String {
        switch self {
        case .draft: return "Wersja robocza"
        case .pending_approval: return "Czeka na zatwierdzenie"
        case .approved: return "Zatwierdzona"
        case .scheduled: return "Zaplanowana"
        case .sending: return "Wysyłanie"
        case .paused: return "Wstrzymana"
        case .sent: return "Wysłana"
        case .cancelled: return "Anulowana"
        case .failed: return "Błąd"
        }
    }

    /// Kolory jak klasy statusu w CRM (slate, amber, emerald, sky, blue, orange, red).
    var color: Color {
        switch self {
        case .draft: return CrmTheme.rgb(0xcbd5e1)
        case .pending_approval: return CrmTheme.rgb(0xfcd34d)
        case .approved, .sent: return CrmTheme.rgb(0x6ee7b7)
        case .scheduled: return CrmTheme.rgb(0x7dd3fc)
        case .sending: return CrmTheme.rgb(0x93c5fd)
        case .paused: return CrmTheme.rgb(0xfdba74)
        case .cancelled, .failed: return CrmTheme.rgb(0xfca5a5)
        }
    }

    /// Wysyłka zaplanowana lub zakończona — sekcja z postępem kolejki i licznikami.
    var showsDelivery: Bool {
        let states: [MailCampaignStatus] = [.scheduled, .sending, .paused, .sent, .cancelled, .failed]
        return states.contains(self)
    }
}

struct MailCampaignInterval: Identifiable, Hashable {
    let seconds: Int
    let label: String
    var id: Int { seconds }
}

enum MailCampaignLabels {
    static let exclusion: [String: String] = [
        "missing_email": "Brak adresu e-mail",
        "objection": "Sprzeciw marketingowy",
        "unsubscribed": "Wypisany z komunikacji",
        "no_marketing_permission": "Brak zgody lub podstawy komunikacji",
        "missing_legal_basis": "Brak podstawy prawnej",
        "email_bounced": "Adres wcześniej odbijał wiadomości",
        "invalid_email": "Nieprawidłowy adres",
        "suppression_list": "Centralna lista wykluczeń",
        "duplicate_email": "Duplikat adresu",
        "consent_changed": "Zmieniona zgoda",
        "campaign_cancelled": "Kampania anulowana",
        "audience_business_type": "Inny rodzaj organizacji",
    ]

    static let recipientStatus: [String: String] = [
        "eligible": "Dopuszczony",
        "queued": "W kolejce",
        "processing": "Wysyłanie",
        "retry": "Ponowienie",
        "sent": "Wysłany",
        "delivered": "Dostarczony",
        "opened": "Otwarty",
        "clicked": "Kliknięty",
        "replied": "Odpowiedź",
        "failed": "Błąd",
        "bounced": "Odbity",
        "excluded": "Wykluczony",
        "unsubscribed": "Wypisany",
    ]

    /// Odstępy między partiami (`<select>` w CRM).
    static let intervals: [MailCampaignInterval] = [
        MailCampaignInterval(seconds: 60, label: "1 minuta"), MailCampaignInterval(seconds: 120, label: "2 minuty"),
        MailCampaignInterval(seconds: 300, label: "5 minut"), MailCampaignInterval(seconds: 600, label: "10 minut"),
    ]

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    /// Data jak `Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' })`; pusta — „—”.
    static func date(_ value: String) -> String {
        guard !value.isEmpty, let date = MeetingDates.parse(value) else { return "—" }
        return formatter.string(from: date)
    }
}

/// Edytowana wersja robocza: pola formularza i reguły odbiorców (typy wydarzeń i regiony jako tekst „po przecinku”).
struct MailCampaignDraft: Equatable {
    var name = ""
    var subject = ""
    var content = ""
    var previewText = ""
    var emailAccountId = ""
    var templateId = ""
    var segmentIds: [String] = []
    var entityTypes: [String] = []
    var eventTypes = ""
    var regions = ""
    var budgetMin = ""
    var budgetMax = ""
    var trackOpens = false
    var trackClicks = false

    init() {}

    init(_ campaign: MailCampaign) {
        name = campaign.name
        subject = campaign.subject
        content = campaign.content
        previewText = campaign.previewText
        emailAccountId = campaign.emailAccountId
        templateId = campaign.templateId
        segmentIds = campaign.segmentIds
        entityTypes = campaign.audience.entityTypes
        eventTypes = campaign.audience.eventTypes.joined(separator: ", ")
        regions = campaign.audience.regions.joined(separator: ", ")
        budgetMin = Self.budgetText(campaign.audience.budgetMin)
        budgetMax = Self.budgetText(campaign.audience.budgetMax)
        trackOpens = campaign.trackOpens
        trackClicks = campaign.trackClicks
    }

    static func budgetText(_ value: Double?) -> String {
        guard let value, value > 0 else { return "" }
        return value.rounded() == value ? String(Int(value)) : String(value)
    }

    static func split(_ text: String) -> [JSONValue] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { JSONValue.string($0) }
    }

    static func budget(_ text: String) -> JSONValue {
        let raw = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")
        guard let value = Double(raw), value > 0 else { return .null }
        return .number(value)
    }

    /// Treść zapisu `op=save` (serwer scala reguły z zapisanymi i usuwa puste).
    func payload(id: String, updatedAt: String) -> [String: JSONValue] {
        let audience: [String: JSONValue] = [
            "entityTypes": .array(entityTypes.map { JSONValue.string($0) }),
            "eventTypes": .array(Self.split(eventTypes)),
            "regions": .array(Self.split(regions)),
            "budgetMin": Self.budget(budgetMin),
            "budgetMax": Self.budget(budgetMax),
        ]
        return [
            "id": .string(id), "updatedAt": .string(updatedAt), "name": .string(name), "subject": .string(subject),
            "content": .string(content), "previewText": .string(previewText), "emailAccountId": .string(emailAccountId),
            "templateId": .string(templateId), "segmentIds": .array(segmentIds.map { JSONValue.string($0) }),
            "audience": .object(audience), "trackOpens": .bool(trackOpens), "trackClicks": .bool(trackClicks),
        ]
    }
}
