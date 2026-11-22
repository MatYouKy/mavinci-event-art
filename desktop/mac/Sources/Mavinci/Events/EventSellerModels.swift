import SwiftUI

// MARK: Ustalenia sprzedawcy dla wybranej oferty — modele odczytów `seller-arrangements` (przygotowanie, kreator kroków,
// ustalenia realizacji, potwierdzenie realizacji) oraz wspólne reguły z CRM: `eventSchedule.ts`, `arrangements.ts`,
// `realizationWizard.ts`, `onsiteContact.ts`. Daty i godziny ustaleń są lokalne dla Europe/Warsaw (nie chwile UTC).

/// Wskazanie oferty i kroku z powiadomienia (`/crm/events/<id>?tab=seller-arrangements&offer=…&prepStep=…` albo `conversation=…`).
struct SellerArrangementsFocus: Equatable {
    var eventID: String
    var offerID: String?
    var conversationID: String?
    var step: String?
}

struct SellerClientInfo: Decodable, Equatable {
    var name: String?
    var company: String?
    var email: String?
    var phone: String?
    var hasData: Bool { [name, company, phone, email].contains { $0?.trimmingCharacters(in: .whitespaces).isEmpty == false } }
}

struct SellerContactInfo: Decodable, Equatable {
    var name: String
    var role: String
    var email: String
    var phone: String
    var json: JSONValue { .object(["name": .string(name), "role": .string(role), "email": .string(email), "phone": .string(phone)]) }
}

struct SellerDay: Decodable, Equatable {
    var date: String
    var startTime: String
    var endTime: String
    var json: JSONValue { .object(["date": .string(date), "startTime": .string(startTime), "endTime": .string(endTime)]) }
}

struct SellerRoomInfo: Decodable, Equatable {
    var id: String
    var name: String
    var notes: String
    var technical: [String: JSONValue]
}

struct SellerVenueInfo: Decodable, Equatable {
    var organizationId: String
    var organizationName: String
    var locationId: String
    var locationName: String
    var room: SellerRoomInfo
    var technicalDetails: [String: JSONValue]
}

/// `SellerEventPreparation` — etap realizacji powiązanej z ofertą.
struct SellerPreparationState: Decodable, Equatable {
    var canManage: Bool
    var eventId: String?
    var stage: String
    var matching: Bool
    var canCreateEvent: Bool
    var autoEventReady: Bool
    var sellerName: String?
    var sellerOrganization: String?
}

/// `get_seller_offer_arrangements` + `get_seller_hotel_context`.
struct SellerArrangementsData: Decodable, Equatable {
    struct Values: Decodable, Equatable {
        var revision: Int
        var room: String
        var venue: SellerVenueInfo?
        var participantCount: Double?
        var eventDays: [SellerDay]?
        var setupAt: String?
        var startsAt: String?
        var endsAt: String?
        var teardownAt: String?
        var materialsDueDate: String?
        var technical: String
        var logistics: String
        var contacts: [SellerContactInfo]
        var updatedAt: String?
        func slot(_ key: String) -> String? {
            switch key {
            case "setup_at": return setupAt
            case "starts_at": return startsAt
            case "ends_at": return endsAt
            default: return teardownAt
            }
        }
    }
    struct Offer: Decodable, Equatable {
        var id: String
        var title: String?
        var eventDate: String?
        var location: String?
        var status: String
        var baseNet: Double?
        var clientNet: Double?
    }
    struct Event: Decodable, Equatable {
        var id: String
        var name: String
        var status: String
        var location: String?
        var canViewCrm: Bool
        var setupAt: String?
        var startsAt: String?
        var endsAt: String?
        var teardownAt: String?
        func slot(_ key: String) -> String? {
            switch key {
            case "setup_at": return setupAt
            case "starts_at": return startsAt
            case "ends_at": return endsAt
            default: return teardownAt
            }
        }
    }
    struct Person: Decodable, Equatable {
        var id: String
        var name: String
        var role: String
        var email: String
        var phone: String
    }
    struct Hotel: Decodable, Equatable {
        struct Organization: Decodable, Equatable { var id: String; var name: String }
        struct Location: Decodable, Equatable { var id: String; var name: String; var rooms: [SellerRoomInfo]; var technicalDetails: [String: JSONValue] }
        var available: Bool
        var organization: Organization?
        var location: Location?
        var contacts: [Person]
    }
    var canEdit: Bool
    var values: Values
    var offer: Offer
    var client: SellerClientInfo
    var event: Event?
    var team: [Person]
    var hotel: Hotel?
    var hotelError: String?
}

/// `get_seller_realization_wizard`.
struct SellerWizardState: Decodable, Equatable {
    struct Step: Decodable, Equatable {
        var key: String
        var status: String
        var available: Bool
        var revision: Int
        var contextKey: String
        var payload: [String: JSONValue]
        var reviewNote: String?
        var submittedAt: String?
        var reviewedAt: String?
        var canSubmit: Bool
        var canReview: Bool
    }
    struct Requirement: Decodable, Equatable {
        var name: String
        var technical: String?
        var logistics: String?
        var accommodation: String?
    }
    struct Context: Decodable, Equatable {
        var location: String?
        var room: String?
        var participants: Double?
        var startsAt: String?
        var endsAt: String?
        var technical: String?
        var logistics: String?
        var materialsDue: String?
        var requirements: [Requirement]
    }
    struct History: Decodable, Equatable {
        var revision: Int
        var stepKey: String
        var action: String
        var at: String
        var payload: [String: JSONValue]?
        var reviewNote: String?
    }
    var offerId: String
    var eventId: String?
    var partnerId: String
    var companyId: String
    var revision: Int
    var finishKey: String
    var active: Bool
    var manager: Bool
    var seller: Bool
    var completed: Bool
    var completedAt: String?
    var canComplete: Bool
    var confirmationRequired: Bool
    var client: SellerClientInfo
    var legacyContactBody: String?
    var context: Context
    var steps: [Step]
    var history: [History]
}

/// `get_seller_event_draft` z kategoriami i bazą lokalizacji (`CreateSellerEventModal`).
struct SellerEventDraft: Decodable, Equatable {
    struct Item: Decodable, Equatable { var id: String; var name: String; var quantity: Double; var unit: String? }
    struct Category: Decodable, Equatable { var id: String; var name: String }
    var eventId: String?
    var alreadyConfirmed: Bool
    var eventUpdatedAt: String?
    var locationId: String?
    var categoryId: String?
    var sourceKey: String
    var revision: Int
    var brandName: String
    var offerNumber: String
    var name: String
    var location: String
    var description: String
    var setupAt: String?
    var startsAt: String?
    var endsAt: String?
    var teardownAt: String?
    var client: SellerClientInfo
    var eventDays: [SellerDay]?
    var contacts: [SellerContactInfo]
    var room: String
    var technical: String
    var logistics: String
    var items: [Item]
    var categories: [Category]
    var categoryError: String?
    var locations: [EventLocationOption]
    var locationsError: String?
    func slot(_ key: String) -> String? {
        switch key {
        case "setup_at": return setupAt
        case "starts_at": return startsAt
        case "ends_at": return endsAt
        default: return teardownAt
        }
    }
}

/// Data i godzina jednego terminu ustaleń (`{ date: 'RRRR-MM-DD', time: 'GG:MM' }`, puste = nie ustalono).
struct SellerSlot: Equatable {
    var date = ""
    var time = ""
    /// „2026-11-13T09:00:00” → data i godzina bez przeliczania strefy.
    init(_ value: String? = nil) {
        let text = value ?? ""
        date = String(text.prefix(10))
        time = text.count >= 16 ? String(text.dropFirst(11).prefix(5)) : ""
    }
    var json: JSONValue { .object(["date": .string(date), "time": .string(time)]) }
}

enum SellerText {
    /// `arrangementSchedule` — kolejność i etykiety terminów.
    static let schedule: [(key: String, label: String)] = [
        ("setup_at", "Montaż"), ("starts_at", "Początek eventu"), ("ends_at", "Koniec eventu"), ("teardown_at", "Demontaż"),
    ]
    static let timePattern = #"^([01]\d|2[0-3]):[0-5]\d$"#
    static func validTime(_ value: String) -> Bool { value.range(of: timePattern, options: .regularExpression) != nil }

    /// `arrangementLocalDate`: „2026-11-13T09:00” → „13.11.2026, 09:00”, brak → „Nie ustalono”.
    static func localDate(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "Nie ustalono" }
        let parts = value.split(separator: "T", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        let date = parts[0].split(separator: "-").reversed().joined(separator: ".")
        return parts.count > 1 ? date + ", " + String(parts[1].prefix(5)) : date
    }

    /// `deliveryTimestamp` — chwila UTC pokazana w czasie polskim („16.11.2026, 21:10”).
    static func timestamp(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) ?? isoWithoutFraction(value) else { return "Nie ustalono" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
    private static func isoWithoutFraction(_ value: String) -> Date? {
        // Znaczniki Postgresa („2026-11-16T20:10:00.123456+00:00”) — sekundy ułamkowe dowolnej długości.
        let trimmed = value.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: trimmed)
    }

    /// `sellerMoney` — kwota netto w złotych z dwoma miejscami po przecinku.
    static func money(_ amount: Double?) -> String {
        (amount ?? 0).formatted(.currency(code: "PLN").locale(Locale(identifier: "pl_PL")).precision(.fractionLength(2)))
    }

    /// `systemLabel(role, 'role', { preserveCustom: true })`.
    static func role(_ value: String) -> String {
        let text = value.trimmingCharacters(in: .whitespaces)
        if text.isEmpty { return "Nie określono" }
        return roles[text.lowercased()] ?? text
    }
    private static let roles: [String: String] = [
        "admin": "Administrator", "administrator": "Administrator", "manager": "Menedżer", "event_manager": "Kierownik eventu",
        "sales": "Sprzedaż", "salesperson": "Sprzedawca", "seller": "Sprzedawca", "sales_manager": "Kierownik sprzedaży",
        "logistics": "Logistyka", "technician": "Technik", "support": "Wsparcie", "freelancer": "Współpracownik",
        "dj": "DJ", "mc": "Konferansjer", "host": "Prowadzący", "assistant": "Asystent", "unassigned": "Nieprzypisany",
        "driver": "Kierowca", "coordinator": "Koordynator", "organizer": "Organizator", "owner": "Opiekun",
        "employee": "Pracownik", "staff": "Obsługa", "subcontractor": "Podwykonawca", "operator": "Operator",
        "sound_engineer": "Realizator dźwięku", "lighting_technician": "Technik oświetlenia",
        "sound_technician": "Technik dźwięku", "photographer": "Fotograf", "videographer": "Operator kamery",
        "instructor": "Instruktor", "animator": "Animator", "security": "Ochrona", "other": "Inna rola",
    ]

    /// Wartość pola formularza jak `String(value)` w przeglądarce (liczby całkowite bez części ułamkowej).
    static func plain(_ value: JSONValue?) -> String {
        switch value {
        case .string(let text): return text
        case .number(let number): return number.rounded() == number && abs(number) < 1e15 ? String(Int(number)) : String(number)
        case .bool(let flag): return flag ? "true" : "false"
        default: return ""
        }
    }
}

/// `eventSchedule.ts` — dni wydarzenia i godziny (także przez północ), te same komunikaty co w CRM.
enum SellerSchedule {
    static let maxDays = 31
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    static func validDay(_ day: String) -> Bool {
        guard day.range(of: #"^[1-9]\d{3}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else { return false }
        return string(date) == day
    }
    private static func string(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    static func nextDay(_ day: String) -> String {
        guard validDay(day) else { return "" }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard let date = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2] + 1, hour: 12)) else { return "" }
        let next = string(date)
        return validDay(next) ? next : ""
    }
    static func dayLabel(_ date: String) -> String { date.isEmpty ? "Data do ustalenia" : date.split(separator: "-").reversed().joined(separator: ".") }
    static func eventDayLabel(_ day: SellerDay) -> String {
        if day.startTime.isEmpty && day.endTime.isEmpty { return dayLabel(day.date) + " · godziny do ustalenia" }
        if day.endTime < day.startTime {
            return "\(dayLabel(day.date)), \(day.startTime) → \(dayLabel(nextDay(day.date))), \(day.endTime) (następny dzień)"
        }
        return "\(dayLabel(day.date)), \(day.startTime)–\(day.endTime)"
    }
    static func empty(_ date: String = "") -> SellerDay { SellerDay(date: date, startTime: "", endTime: "") }

    /// `buildSellerEventSchedule`: jeden pusty dzień = brak dni; pierwszy błąd przerywa sprawdzanie.
    static func build(_ input: [SellerDay]) -> (days: [SellerDay], startsAt: String?, endsAt: String?, error: String) {
        let days = input.count == 1 && input[0].date.isEmpty && input[0].startTime.isEmpty && input[0].endTime.isEmpty ? [] : input
        var error = ""
        var previousDate = "", previousEnd = ""
        var startsAt: String?, endsAt: String?
        if days.count > maxDays { error = "Możesz dodać do \(maxDays) dni eventu." }
        var index = 0
        while index < days.count && error.isEmpty {
            let day = days[index]
            let prefix = "Dzień \(index + 1): "
            if !validDay(day.date) { error = prefix + "wpisz poprawną datę."; break }
            if !previousDate.isEmpty && day.date <= previousDate { error = prefix + "dni muszą mieć różne daty i być ułożone chronologicznie."; break }
            if day.startTime.isEmpty != day.endTime.isEmpty { error = prefix + "uzupełnij obie godziny albo pozostaw obie do ustalenia."; break }
            if !day.startTime.isEmpty && (!SellerText.validTime(day.startTime) || !SellerText.validTime(day.endTime)) { error = prefix + "wpisz poprawne godziny w formacie HH:MM."; break }
            if !day.startTime.isEmpty && day.startTime == day.endTime { error = prefix + "godzina zakończenia musi różnić się od rozpoczęcia."; break }
            let endDate = day.endTime < day.startTime ? nextDay(day.date) : day.date
            if endDate.isEmpty { error = prefix + "data zakończenia wykracza poza obsługiwany zakres."; break }
            let start: String? = day.startTime.isEmpty ? nil : day.date + "T" + day.startTime
            let end: String? = day.endTime.isEmpty ? nil : endDate + "T" + day.endTime
            if let start, !previousEnd.isEmpty, start < previousEnd { error = prefix + "godziny nakładają się na poprzedni dzień eventu."; break }
            if index == 0 { startsAt = start }
            if index == days.count - 1 { endsAt = end }
            previousDate = day.date
            if let end { previousEnd = end }
            index += 1
        }
        return (days, startsAt, endsAt, error)
    }

    /// `legacyDay` — dotychczasowy zakres początek–koniec jako jeden dzień (także przez północ).
    private static func legacyDay(startsAt: String?, endsAt: String?) -> SellerDay? {
        guard let start = startsAt.map({ String($0.prefix(16)) }), let end = endsAt.map({ String($0.prefix(16)) }), !start.isEmpty, !end.isEmpty else { return nil }
        let date = String(start.prefix(10)), endDate = String(end.prefix(10))
        let startTime = String(start.dropFirst(11)), endTime = String(end.dropFirst(11))
        guard validDay(date), SellerText.validTime(startTime), SellerText.validTime(endTime) else { return nil }
        if (endDate == date && endTime > startTime) || (endDate == nextDay(date) && endTime < startTime) {
            return SellerDay(date: date, startTime: startTime, endTime: endTime)
        }
        return nil
    }
    static func hasLegacyRange(eventDays: [SellerDay]?, startsAt: String?, endsAt: String?) -> Bool {
        (eventDays ?? []).isEmpty && (startsAt?.isEmpty == false || endsAt?.isEmpty == false) && legacyDay(startsAt: startsAt, endsAt: endsAt) == nil
    }
    static func daysFrom(eventDays: [SellerDay]?, startsAt: String?, endsAt: String?, fallback: String) -> [SellerDay] {
        if let eventDays, !eventDays.isEmpty { return eventDays }
        if let legacy = legacyDay(startsAt: startsAt, endsAt: endsAt) { return [legacy] }
        return [empty(fallback)]
    }
}

/// Kroki kreatora przygotowań (`realizationWizard.ts`).
enum SellerWizardText {
    static let steps: [(key: String, title: String, author: String, reviewer: String)] = [
        ("contact", "Kontakt na miejscu", "Sprzedawca", "Opiekun"),
        ("organization", "Miejsce i organizacja", "Sprzedawca", "Opiekun"),
        ("materials", "Materiały i wymagania", "Sprzedawca", "Opiekun"),
        ("plan", "Plan realizacji", "Opiekun", "Sprzedawca"),
    ]
    static let keys = steps.map(\.key) + ["finish"]
    static let statuses: [String: String] = [
        "draft": "Do uzupełnienia", "submitted": "Do sprawdzenia", "changes_requested": "Wymaga poprawy",
        "approved": "Zatwierdzony", "stale": "Dane zmieniły się — do ponownego sprawdzenia",
    ]
    static let fields: [String: String] = [
        "source": "Koordynacja", "name": "Imię i nazwisko", "role": "Stanowisko / rola", "phone": "Telefon", "email": "E-mail", "note": "Dodatkowe informacje",
        "room": "Sala / przestrzeń", "participants": "Liczba uczestników", "access": "Dojazd, dostęp i osoba otwierająca",
        "schedule_confirmed": "Termin sprawdzony", "mode": "Materiały", "url": "Link do materiałów",
        "technical": "Wymagania techniczne", "logistics": "Logistyka i noclegi", "summary": "Plan dla sprzedawcy",
        "timeline": "Timeline", "team": "Zespół", "equipment": "Sprzęt i rezerwacje", "agenda": "Agenda",
    ]
    static let planChecks: [(key: String, label: String, tab: String)] = [
        ("timeline", "Timeline i godziny montażu / demontażu", "phases"),
        ("team", "Zespół i odpowiedzialności", "team"),
        ("equipment", "Sprzęt, dostępność i rezerwacje", "equipment"),
        ("agenda", "Agenda eventu", "agenda"),
        ("logistics", "Logistyka, transport i noclegi", "logistics"),
    ]
    static let actions: [String: String] = [
        "save": "Zapisano szkic", "submit": "Przekazano do sprawdzenia", "approve": "Zatwierdzono",
        "changes_requested": "Poproszono o poprawki", "complete": "Zatwierdzono przygotowania",
    ]
    static let sources: [(value: String, label: String)] = [
        ("seller", "Osobista koordynacja"), ("client", "Klient z wydarzenia"), ("other", "Inny kontakt"),
    ]

    /// `wizardPayloadValue`.
    static func value(_ key: String, _ value: JSONValue) -> String {
        if case .bool(let flag) = value { return flag ? "Tak" : "Nie" }
        if key == "source" { return ["seller": "Osobista koordynacja", "client": "Klient z wydarzenia", "other": "Inny kontakt"][SellerText.plain(value)] ?? "Nie wybrano" }
        if key == "mode" { return ["none": "Materiały nie są potrzebne", "provided": "Materiały pod linkiem"][SellerText.plain(value)] ?? "Nie wybrano" }
        return SellerText.plain(value)
    }

    /// Kolejność kluczy obiektu jsonb (krótsze najpierw, potem bajtowo) — tak CRM wypisuje zapisane dane kroku.
    static func orderedKeys(_ payload: [String: JSONValue]) -> [String] {
        payload.keys.sorted { a, b in
            let la = a.utf8.count, lb = b.utf8.count
            return la != lb ? la < lb : Array(a.utf8).lexicographicallyPrecedes(Array(b.utf8))
        }
    }

    /// `legacyContact` + `parseOnsiteContact`: kontakt przekazany wcześniej na czacie w ustalonym formacie.
    static func legacyContact(_ body: String?) -> [String: String]? {
        guard let body else { return nil }
        let pattern = #"^Koordynacja: (Osobista koordynacja|Klient z wydarzenia|Inny kontakt)\nImię i nazwisko: ([^\n]+)\nStanowisko \/ rola: ([^\n]+)\nTelefon: ([^\n]+)(?:\nE-mail: ([^\n]+))?(?:\nDodatkowe informacje:\n([\s\S]*))?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)) else { return nil }
        func group(_ index: Int) -> String {
            guard let range = Range(match.range(at: index), in: body) else { return "" }
            return String(body[range])
        }
        guard let source = sources.first(where: { $0.label == group(1) })?.value else { return nil }
        let name = group(2).trimmingCharacters(in: .whitespacesAndNewlines)
        let role = group(3).trimmingCharacters(in: .whitespacesAndNewlines)
        let phone = group(4).trimmingCharacters(in: .whitespacesAndNewlines)
        let email = group(5).trimmingCharacters(in: .whitespacesAndNewlines)
        let note = group(6).trimmingCharacters(in: .whitespacesAndNewlines)
        let control = #"[\u0000-\u001f\u007f]"#
        for (value, max, required) in [(name, 160, true), (role, 100, true), (phone, 50, true), (email, 254, false)] {
            if required && value.isEmpty { return nil }
            if value.count > max || value.range(of: control, options: .regularExpression) != nil { return nil }
        }
        let digits = phone.filter(\.isNumber).count
        guard phone.range(of: #"^\+?[\d\s().-]+$"#, options: .regularExpression) != nil, (7...15).contains(digits) else { return nil }
        if !email.isEmpty && email.range(of: #"^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$"#, options: .regularExpression) == nil { return nil }
        if note.count > 2000 { return nil }
        return ["source": source, "name": name, "role": role, "phone": phone, "email": email, "note": note]
    }
}

// MARK: Pola daty i godziny (puste = nie ustalono)

/// Data opcjonalna w czasie polskim: przełącznik + wybór dnia; wartość „RRRR-MM-DD” albo pusta.
struct SellerDateField: View {
    let label: String
    @Binding var value: String
    /// Dzień podpowiadany po włączeniu pola (np. data oferty); bez niego — dzisiaj.
    var fallback: String = ""

    var body: some View {
        HStack(spacing: 8) {
            Toggle(label, isOn: Binding(get: { !value.isEmpty }, set: { on in
                value = on ? (value.isEmpty ? (SellerSchedule.validDay(fallback) ? fallback : DayDates.string(DayDates.today)) : value) : ""
            }))
            .toggleStyle(.checkbox)
            if !value.isEmpty {
                DatePicker(label, selection: Binding(get: { DayDates.parse(value) ?? DayDates.today }, set: { value = DayDates.string($0) }),
                           displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, MeetingDates.zone)
            } else {
                Text("Nie ustalono").foregroundStyle(.secondary)
            }
        }
    }
}

/// Godzina „GG:MM”: wpis „9”, „930”, „19.30” albo „19:30” po zatwierdzeniu porządkowany do „09:00” / „19:30”.
struct SellerTimeField: View {
    let label: String
    @Binding var value: String
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(label, text: $text, prompt: Text("GG:MM"))
            .textFieldStyle(.roundedBorder)
            .font(.body.monospacedDigit())
            .frame(width: 72)
            .focused($focused)
            .onAppear { text = value }
            .onChange(of: value) { _, new in if !focused { text = new } }
            .onChange(of: text) { _, new in if focused { value = Self.normalize(new) ?? new } }
            .onChange(of: focused) { _, now in if !now { commit() } }
            .onSubmit { commit() }
    }

    private func commit() {
        let normalized = Self.normalize(text) ?? text.trimmingCharacters(in: .whitespaces)
        text = normalized
        value = normalized
    }

    static func normalize(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return "" }
        var hours = "", minutes = ""
        if let separator = trimmed.firstIndex(where: { $0 == ":" || $0 == "." }) {
            hours = String(trimmed[..<separator]); minutes = String(trimmed[trimmed.index(after: separator)...])
        } else if trimmed.allSatisfy(\.isNumber) {
            switch trimmed.count {
            case 1, 2: hours = trimmed; minutes = "00"
            case 3: hours = String(trimmed.prefix(1)); minutes = String(trimmed.suffix(2))
            case 4: hours = String(trimmed.prefix(2)); minutes = String(trimmed.suffix(2))
            default: return nil
            }
        } else { return nil }
        guard hours.count >= 1, hours.count <= 2, minutes.count == 2, hours.allSatisfy(\.isNumber), minutes.allSatisfy(\.isNumber),
              let h = Int(hours), let m = Int(minutes), (0...23).contains(h), (0...59).contains(m) else { return nil }
        return String(format: "%02d:%02d", h, m)
    }
}

/// Termin z datą i godziną (`ScheduleField` / `Schedule` w CRM).
struct SellerSlotField: View {
    let label: String
    @Binding var slot: SellerSlot
    var fallback: String = ""

    var body: some View {
        HStack(spacing: 10) {
            SellerDateField(label: label, value: Binding(get: { slot.date }, set: { date in
                slot.date = date
                if date.isEmpty { slot.time = "" }
            }), fallback: fallback)
            if !slot.date.isEmpty {
                SellerTimeField(label: label + " — godzina", value: $slot.time)
            }
        }
    }
}

/// Kontakt z wybieralnym e-mailem i telefonem (`ContactCard`).
struct SellerContactCard: View {
    let name: String
    var role: String? = nil
    var email: String? = nil
    var phone: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).textSelection(.enabled)
            if let role, !role.isEmpty { Text(SellerText.role(role)).font(.caption).foregroundStyle(.secondary) }
            if let email, !email.isEmpty, let url = URL(string: "mailto:" + email) {
                Link(destination: url) { Label(email, systemImage: "envelope") }.font(.callout)
            }
            if let phone, !phone.isEmpty {
                let dial = phone.filter { $0.isNumber || $0 == "+" }
                if !dial.isEmpty, let url = URL(string: "tel:" + dial) {
                    Link(destination: url) { Label(phone, systemImage: "phone") }.font(.callout)
                } else {
                    Label(phone, systemImage: "phone").font(.callout)
                }
            }
            if (email ?? "").isEmpty && (phone ?? "").isEmpty {
                Text("Kontakt nie został jeszcze uzupełniony.").font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    /// Treść żądania jako kanoniczny JSON (klucze posortowane) — porównanie, czy ponowienie dotyczy tej samej zmiany.
    var canonicalKey: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self) else { return UUID().uuidString }
        return String(decoding: data, as: UTF8.self)
    }
}
