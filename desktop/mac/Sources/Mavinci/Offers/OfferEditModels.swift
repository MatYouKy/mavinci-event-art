import Foundation

// MARK: Oferty, część B — dane do edycji oferty (`op=editor`, `op=assumptions`, `src/lib/native/offerEdit.ts`) i odczyty
// pomocnicze: osoby kontaktowe organizacji, kalkulacje wydarzenia, propozycja założeń z AI.

/// Formularz „Informacje podstawowe” (jak `formData` w `OfferBasicInfo`) i listy do wyboru.
struct OfferEditorData: Decodable {
    struct Organization: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var alias: String?
        var label: String { alias?.isEmpty == false ? alias! : name }
    }
    struct Person: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var email: String?
        var phone: String?
        var primary: Bool?
        var detail: String { [email, phone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
    }
    struct Event: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var date: String?
        var detail: String { date.flatMap(OfferText.day) ?? "" }
    }
    struct Calculation: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
        var accepted: Bool
    }
    struct Place: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
        var search: String
    }
    struct Section: Codable, Hashable {
        var key: String
        var title: String
        var content: String
    }
    var title: String
    var inheritedTitle: String
    var clientType: String
    var organizationId: String?
    var contactId: String?
    var eventId: String?
    var eventDate: String?
    var fromInquiry: Bool
    var scheduleStart: String
    var scheduleEnd: String
    var location: String
    var guestCount: Double?
    var guestsPerTable: Double
    var tableCount: Double?
    var needsTables: Bool
    var validUntil: String?
    var notes: String
    var heroPath: String?
    var heroAlt: String
    var infoSections: [Section]
    var pricingSource: String
    var calculationId: String?
    var calculations: [Calculation]
    var organizations: [Organization]
    var individuals: [Person]
    var events: [Event]
    var locations: [Place]
}

/// Założenia wydarzenia do edycji (trzy karty z `EVENT_ASSUMPTION_OPTIONS`) i cel wydarzenia.
struct OfferAssumptionsData: Decodable {
    struct Item: Codable, Hashable {
        var key: String
        var label: String
        var value: String
        var badge_value: String?
    }
    struct Option: Decodable, Identifiable, Hashable {
        var key: String
        var label: String
        var question: String
        var placeholder: String
        var multiline: Bool
        var defaultValue: String
        var defaultBadge: String
        var id: String { key }
    }
    var items: [Item]
    var goal: String
    var guestCount: Double?
    var maxLength: Int
    var options: [Option]
}

struct OfferAssumptionsDraft: Decodable {
    var items: [OfferAssumptionsData.Item]
    var goal: String?
    var sources: String?
}

extension OffersStore {
    private func read<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get(path))
    }

    func editor(_ id: String) async throws -> OfferEditorData {
        try await read("/offers?op=editor&id=\(id)", as: OfferEditorData.self)
    }

    func contacts(organization: String) async throws -> [OfferEditorData.Person] {
        struct Reply: Decodable { var contacts: [OfferEditorData.Person] }
        return try await read("/offers?op=contacts&organization=\(organization)", as: Reply.self).contacts
    }

    func calculations(_ id: String, event: String?) async throws -> [OfferEditorData.Calculation] {
        struct Reply: Decodable { var calculations: [OfferEditorData.Calculation] }
        return try await read("/offers?op=calculations&id=\(id)&event=\(event ?? "")", as: Reply.self).calculations
    }

    func assumptionsEditor(_ id: String) async throws -> OfferAssumptionsData {
        try await read("/offers?op=assumptions&id=\(id)", as: OfferAssumptionsData.self)
    }

    /// „Zaproponuj z AI” dla trzech wybranych kart (do 2 minut).
    func draftAssumptions(_ id: String, items: [OfferAssumptionsData.Item], goal: String, instructions: String, generateGoal: Bool) async throws -> OfferAssumptionsDraft {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Propozycja AI wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        let body: [String: JSONValue] = [
            "op": .string("assumptionsAI"), "id": .string(id), "goal": .string(goal), "instructions": .string(instructions),
            "generateGoal": .bool(generateGoal), "items": .array(items.map(\.json)),
        ]
        return try JSONDecoder().decode(OfferAssumptionsDraft.self, from: try await api.post("/offers", body, timeout: 120))
    }
}

extension OfferAssumptionsData.Item {
    var json: JSONValue {
        .object(["key": .string(key), "label": .string(label), "value": .string(value), "badge_value": .string(badge_value ?? "")])
    }
}
