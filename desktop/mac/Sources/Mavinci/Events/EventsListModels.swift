import SwiftUI

// MARK: Wydarzenia — lista jak `/crm/events` (`EventsPageClient`, `src/lib/native/events.ts`).

struct EventBudgetAmount: Codable, Hashable {
    var currency: String
    var amount: Double
}

/// Wydarzenie na liście: termin, klient, miejsce, status (lub etap operacyjny), stan rozliczeń, kategoria i budżet.
struct EventListItem: Codable, Hashable, Identifiable, SyncKeyed {
    var id: String
    var name: String
    var description: String
    var date: String?
    var endDate: String?
    var createdAt: String?
    var status: String
    var displayStatus: String
    var operationalLabel: String
    var state: String
    var stateLabel: String
    var stateDays: Int
    var categoryId: String?
    var categoryName: String
    var categoryColor: String
    var organization: String
    var organizationAlias: String
    var contact: String
    var location: String
    var locationName: String
    var locationAddress: String
    var locationCity: String
    var locationPostal: String
    var myCompany: String
    var budgetVisible: Bool
    var budgets: [EventBudgetAmount]
    var expectedRevenue: Double?
    var budget: Double?
    var salesColleague: Bool
    var salesColleagueSeller: String
    var syncKey: String { id }

    var start: Date? { date.flatMap(MeetingDates.parse) }
    var end: Date? { (endDate ?? date).flatMap(MeetingDates.parse) }
    /// Klient jak `getOrgLabel`: alias albo nazwa firmy, inaczej osoba kontaktowa.
    var clientLabel: String { organizationAlias.nonEmpty ?? organization.nonEmpty ?? contact.nonEmpty ?? "Brak klienta" }
    var isContactClient: Bool { organization.isEmpty && organizationAlias.isEmpty && !contact.isEmpty }
    /// Miejsce jak `getLocationLabelDesktop`.
    var locationLabel: String {
        if !locationName.isEmpty { return locationName + (locationCity.isEmpty ? "" : " — \(locationCity)") }
        return location.nonEmpty ?? "Brak lokalizacji"
    }
    var mapsURL: URL? {
        let query = locationAddress.nonEmpty ?? locationName.nonEmpty ?? location.nonEmpty
        guard let query, let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        return URL(string: "https://www.google.com/maps/search/?api=1&query=\(encoded)")
    }
    /// Kwota do sortowania jak w CRM (PLN z faktur albo planowany budżet).
    var budgetSortValue: Double {
        guard budgetVisible else { return 0 }
        if let pln = budgets.first(where: { $0.currency == "PLN" }) { return pln.amount }
        return budgets.isEmpty ? (expectedRevenue ?? 0) : 0
    }
    var budgetLabel: String {
        guard budgetVisible else { return "—" }
        if !budgets.isEmpty { return budgets.map { EventLabels.money($0.amount, currency: $0.currency) }.joined(separator: " / ") }
        return EventLabels.money(expectedRevenue ?? 0, currency: "PLN")
    }
    var budgetTitle: String {
        budgets.isEmpty ? "Planowany budżet brutto" : "Ostateczna wartość brutto z wystawionych faktur sprzedaży / końcowych, z uwzględnieniem korekt"
    }
    /// Płatność po terminie (czerwony wykrzyknik jak w CRM).
    var overdue: Bool { ["late", "overdue"].contains(state) }
    /// Pilność minionego wydarzenia jak `getPastUrgency`.
    var urgency: Color? {
        if ["late", "overdue"].contains(state) { return CrmTheme.rgb(0xf87171) }
        if ["completed", "settlement", "awaiting"].contains(state) { return CrmTheme.rgb(0xfb923c) }
        return nil
    }
    func matches(_ terms: [String]) -> Bool {
        guard !terms.isEmpty else { return true }
        let text = EventLabels.normalize([name, description, location, locationName, locationAddress, locationCity, locationPostal, organization,
                                          organizationAlias, contact].joined(separator: " "))
        return terms.allSatisfy { text.contains($0) }
    }
}

struct EventsAccess: Codable, Equatable {
    var canView: Bool
    var canManage: Bool
    var canCreate: Bool
}
struct EventCategoryOption: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var color: String
}

enum EventsSortField: String, CaseIterable, Identifiable {
    case date, name, budget, created
    var id: String { rawValue }
    var label: String { ["date": "Data wydarzenia", "name": "Nazwa", "budget": "Budżet", "created": "Data utworzenia"][rawValue] ?? rawValue }
}
enum EventsViewMode: String, CaseIterable, Identifiable {
    case list, grid, table
    var id: String { rawValue }
    var label: String { self == .list ? "Lista" : self == .grid ? "Kafelki" : "Tabela" }
    var symbol: String { self == .list ? "list.bullet" : self == .grid ? "square.grid.2x2" : "tablecells" }
}

enum EventLabels {
    static let statuses: [InquiryOption] = [
        .init(value: "inquiry", label: "Zapytanie"), .init(value: "offer_to_send", label: "Oferta do wysłania"),
        .init(value: "offer_sent", label: "Oferta wysłana"), .init(value: "offer_accepted", label: "Oferta zaakceptowana"),
        .init(value: "in_preparation", label: "W przygotowaniu"), .init(value: "ready_for_live", label: "Gotowy do realizacji"),
        .init(value: "in_progress", label: "W trakcie"), .init(value: "completed", label: "Zrealizowany"),
        .init(value: "cancelled", label: "Anulowany"), .init(value: "invoiced", label: "Zafakturowany"), .init(value: "settled", label: "Rozliczony"),
    ]
    /// Etapy operacyjne (pracownicy bez wglądu w sprzedaż) jak `OPERATIONAL_LABELS`.
    static let operational: [InquiryOption] = [
        .init(value: "inquiry", label: "Nowe wydarzenie"), .init(value: "offer_accepted", label: "Do potwierdzenia"),
        .init(value: "in_preparation", label: "W przygotowaniu"), .init(value: "ready_for_live", label: "Gotowe do realizacji"),
        .init(value: "in_progress", label: "W trakcie realizacji"), .init(value: "completed", label: "Zrealizowane"),
        .init(value: "settled", label: "Zakończone"), .init(value: "cancelled", label: "Anulowane"),
    ]
    static func status(_ value: String) -> String { statuses.first { $0.value == value }?.label ?? value }
    /// Kolory odznak jak `EVENT_STATUS_BADGE_CLASSES` (tło i tekst).
    static func statusColors(_ value: String) -> (background: Color, text: Color) {
        switch value {
        case "inquiry": return (CrmTheme.rgb(0x5e3344), CrmTheme.rgb(0xf2dce4))
        case "offer_to_send": return (CrmTheme.rgb(0x7f1734), CrmTheme.rgb(0xffd8e1))
        case "offer_sent": return (CrmTheme.rgb(0x8f4f31), CrmTheme.rgb(0xffe0bd))
        case "offer_accepted", "ready_for_live", "completed": return (CrmTheme.rgb(0x10b981).opacity(0.35), CrmTheme.rgb(0xd1fae5))
        case "in_preparation": return (CrmTheme.rgb(0xf59e0b).opacity(0.3), CrmTheme.rgb(0xfef3c7))
        case "in_progress": return (CrmTheme.rgb(0x941d3e), CrmTheme.rgb(0xffe0e7))
        case "cancelled": return (CrmTheme.rgb(0xef4444).opacity(0.45), CrmTheme.rgb(0xfee2e2))
        default: return (CrmTheme.rgb(0xd3bb73).opacity(0.3), CrmTheme.rgb(0xfff0bd))
        }
    }
    static func money(_ value: Double, currency: String) -> String {
        value.formatted(.currency(code: currency.isEmpty ? "PLN" : currency).locale(Locale(identifier: "pl_PL")))
    }
    /// Wyszukiwanie bez wielkości liter i polskich znaków (jak `normalizeEventSearch`).
    static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pl_PL"))
            .replacingOccurrences(of: "ł", with: "l").replacingOccurrences(of: "Ł", with: "l").lowercased()
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    }
    static func dateRange(_ item: EventListItem) -> String {
        guard let start = item.start else { return "—" }
        let day = MeetingDates.format(start, "dd.MM.yyyy")
        let time = MeetingDates.format(start, "HH:mm")
        guard let end = item.endDate.flatMap(MeetingDates.parse), end > start else { return "\(day) \(time)" }
        if Calendar.current.isDate(start, inSameDayAs: end) { return "\(day) \(time)–\(MeetingDates.format(end, "HH:mm"))" }
        return "\(day) – \(MeetingDates.format(end, "dd.MM.yyyy"))"
    }
}

/// Odznaka statusu wydarzenia (lub etapu operacyjnego).
struct EventStatusPill: View {
    let item: EventListItem
    var body: some View {
        let colors = EventLabels.statusColors(item.displayStatus)
        Text(item.operationalLabel.nonEmpty ?? EventLabels.status(item.displayStatus))
            .font(.caption.weight(.medium)).lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(colors.background, in: Capsule())
            .foregroundStyle(colors.text)
    }
}
