import SwiftUI
import AppKit

// MARK: Zakładki karty kontaktu dotąd tylko w CRM (`/crm/contacts/[id]`): „Klient 360°” osoby (`Customer360Panel`: wskaźniki,
// oś aktywności we wszystkich kanałach, następne najlepsze działanie, powiązane organizacje, jakość danych) i organizacji
// (`Organization360Panel`: wskaźniki, historia z korespondencją i dociąganiem starszej, następne działanie, kontakty; sprzedawcy
// organizacji — `OrganizationSellersPanel`), „Zapytania” (`CustomerInquiryHistory`), „Oferty” (`CustomerOffersPanel`) oraz
// „Sprzedaż sprzedawcy” (karta sprzedawcy na Macu). Opiekun, etap relacji, segmentacja i domeny — zakładka „Relacja i segmentacja”.
// Serwer: `/bridge/native/v1/contacts` (`customer360`, `customer360Mail`, `customerOffers`, `customerInquiries`, `inquiryClient`).

struct Customer360Badge: Decodable, Equatable {
    var label: String
    var tone: String
    var color: Color {
        switch tone {
        case "info": return CrmTheme.rgb(0x7dd3fc)
        case "success": return CrmTheme.rgb(0x6ee7b7)
        case "warning": return CrmTheme.rgb(0xfcd34d)
        case "danger": return CrmTheme.rgb(0xfca5a5)
        case "brand": return CrmTheme.rgb(0xd3bb73)
        default: return .secondary
        }
    }
}

struct Customer360Data: Decodable {
    struct Target: Decodable, Equatable { var type: String; var id: String }
    struct Activity: Decodable, Identifiable, Equatable {
        var id: String
        var kind: String
        var title: String
        var description: String
        var date: String
        var target: Target?
        var status: Customer360Badge?
        var validUntil: String?
        var eventDate: String?
    }
    struct Metrics: Decodable { var openInquiries: Int; var pipelineValue: Double; var upcomingEvents: Int; var dueActions: Int }
    struct Organization: Decodable, Identifiable { var id: String; var name: String; var position: String }
    struct Quality: Decodable { var email: Bool; var phone: Bool; var organization: Bool }
    struct Person: Decodable, Identifiable { var id: String; var name: String; var position: String; var isPrimary: Bool }
    struct Seller: Decodable, Identifiable {
        var profileId: String; var contactId: String; var name: String; var email: String; var status: String; var portalEnabled: Bool; var position: String
        var id: String { profileId }
    }
    struct OtherPerson: Decodable, Identifiable { var contactId: String; var name: String; var email: String; var position: String; var id: String { contactId } }
    var kind: String
    var timeline: [Activity]
    var metrics: Metrics
    var organizations: [Organization]?
    var quality: Quality?
    var contacts: [Person]?
    var sellers: [Seller]?
    var otherPeople: [OtherPerson]?
    var sellersError: String?
    var canManageSellers: Bool?
    var hasMoreMail: Bool
    var mailOffset: Int
}

enum Customer360Format {
    private static func parse(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        // Sama data — jak `new Date('RRRR-MM-DD')` w przeglądarce (północ UTC).
        let day = DateFormatter(); day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = TimeZone(identifier: "UTC"); day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(raw.prefix(10)))
    }
    private static func format(_ raw: String, _ pattern: String) -> String {
        guard let date = parse(raw) else { return raw }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "pl_PL"); formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
    /// `Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })`.
    static func short(_ raw: String) -> String { format(raw, "dd MMM yyyy, HH:mm") }
    /// `toLocaleString('pl-PL')`.
    static func full(_ raw: String) -> String { format(raw, "d.MM.yyyy, HH:mm:ss") }
    /// `toLocaleDateString('pl-PL')`.
    static func day(_ raw: String) -> String { format(raw, "d.MM.yyyy") }
    /// `toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })`.
    static func dayTime(_ raw: String) -> String { format(raw, "dd.MM.yyyy, HH:mm") }
    /// `toLocaleString('pl-PL') + ' zł'`.
    static func money(_ value: Double) -> String {
        let formatter = NumberFormatter(); formatter.locale = Locale(identifier: "pl_PL"); formatter.numberStyle = .decimal; formatter.maximumFractionDigits = 3
        return "\(formatter.string(from: NSNumber(value: value)) ?? String(value)) zł"
    }
    static func kind(_ kind: String) -> (label: String, symbol: String, color: Color) {
        switch kind {
        case "call": return ("Połączenie", "phone", CrmTheme.rgb(0x6ee7b7))
        case "email": return ("E-mail", "envelope", CrmTheme.rgb(0x7dd3fc))
        case "inquiry": return ("Zapytanie", "scope", CrmTheme.rgb(0xfcd34d))
        case "meeting": return ("Spotkanie", "calendar", CrmTheme.rgb(0xc4b5fd))
        case "offer": return ("Oferta", "doc.text", CrmTheme.rgb(0xd3bb73))
        case "invoice": return ("Faktura", "dollarsign.circle", CrmTheme.rgb(0xf0abfc))
        default: return ("Wydarzenie", kind == "event" ? "briefcase" : "circle", CrmTheme.rgb(0xf0abfc))
        }
    }
}

/// Plakietka statusu (`SystemBadge`).
struct Customer360BadgeView: View {
    let badge: Customer360Badge
    var body: some View {
        Text(badge.label).font(.caption2.weight(.medium)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(badge.color).background(badge.color.opacity(0.12), in: Capsule())
    }
}

@MainActor enum Customer360API {
    static func get<T: Decodable>(_ state: Workspace, _ query: [String: String], as type: T.Type) async throws -> T {
        guard let api = state.nativeAPI() else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/contacts", query: query))
    }
    static func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }
    /// Element osi: zapytanie, oferta, wydarzenie, faktura i spotkanie — natywnie; wiadomość — moduł Wiadomości w CRM.
    static func open(_ state: Workspace, _ target: Customer360Data.Target) {
        switch target.type {
        case "inquiry": state.showInquiry(target.id)
        case "offer": state.open(.offers, id: target.id)
        case "event": state.showEvent(target.id)
        case "invoice": state.showInvoice(target.id)
        case "meeting": state.showMeeting(target.id)
        case "receivedEmail": state.openCRM("/crm/messages/\(target.id)?type=received")
        case "sentEmail": state.openCRM("/crm/messages/\(target.id)?type=sent")
        default: break
        }
    }
}

// MARK: Klient 360°

@MainActor struct Customer360View: View {
    let ref: ContactRef
    let store: ContactsStore
    /// Hotel — panel sprzedawców widoczny także bez sprzedawców (jak w CRM).
    let isHotel: Bool
    let organizationName: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: Customer360Data?
    @State private var error: String?
    @State private var loading = false
    @State private var loadingMail = false

    private var isOrganization: Bool { ref.kind == .organization }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let data {
                metrics(data)
                HStack(alignment: .top, spacing: 16) {
                    timeline(data).frame(maxWidth: .infinity)
                    VStack(alignment: .leading, spacing: 16) { side(data) }.frame(width: 300)
                }
                if isOrganization { sellersPanel(data) }
            } else if let error {
                Text(error).foregroundStyle(.red).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                Button("Spróbuj ponownie") { Task { await load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            }
        }
        .task(id: ref.id) { await load() }
    }

    private func panel<Content: View>(_ title: String, subtitle: String? = nil, symbol: String? = nil, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent) }
                Text(title).font(.headline)
            }
            if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func metrics(_ data: Customer360Data) -> some View {
        let items: [(String, String, String)] = [
            ("Otwarte zapytania", "\(data.metrics.openInquiries)", "scope"),
            ("Wartość szans", Customer360Format.money(data.metrics.pipelineValue), isOrganization ? "dollarsign.circle" : "briefcase"),
            (isOrganization ? "Nadchodzące eventy" : "Nadchodzące wydarzenia", "\(data.metrics.upcomingEvents)", "calendar"),
            ("Zaległe działania", "\(data.metrics.dueActions)", "clock"),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
            ForEach(items, id: \.0) { item in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(item.0).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: item.2).foregroundStyle(theme.accent)
                    }
                    Text(verbatim: item.1).font(.title3.weight(.semibold)).monospacedDigit()
                }
                .padding(14)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func timeline(_ data: Customer360Data) -> some View {
        panel(isOrganization ? "Historia organizacji" : "Oś aktywności",
              subtitle: isOrganization ? "Sprzedaż, realizacje, finanse i Twoja korespondencja z organizacją oraz jej kontaktami" : "Jedna historia kontaktu we wszystkich kanałach") {
            if data.timeline.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "text.bubble").font(.title).foregroundStyle(.secondary)
                    Text("Brak powiązanych aktywności").foregroundStyle(.secondary)
                    if !isOrganization {
                        Text("Połączenia, maile, zapytania, spotkania, oferty i wydarzenia pojawią się tutaj automatycznie.").font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(data.timeline) { item in activityRow(item) }
                }
            }
            if data.hasMoreMail {
                Button(loadingMail ? "Ładowanie…" : "Pokaż starszą korespondencję") { Task { await loadMoreMail() } }.disabled(loadingMail)
            }
        }
    }

    private func activityRow(_ item: Customer360Data.Activity) -> some View {
        let kind = Customer360Format.kind(item.kind)
        let description: String = {
            if let until = item.validUntil, !until.isEmpty { return "Ważna do \(Customer360Format.day(until))" }
            if let date = item.eventDate, !date.isEmpty, !isOrganization { return "Termin: \(Customer360Format.full(date))" }
            return item.description
        }()
        return Button { if let target = item.target { Customer360API.open(state, target) } } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: kind.symbol).foregroundStyle(kind.color).frame(width: 28, height: 28).background(kind.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(item.title).fontWeight(.medium).lineLimit(1)
                        Text(kind.label).font(.caption2).foregroundStyle(.secondary)
                        if let status = item.status { Customer360BadgeView(badge: status) }
                    }
                    if !description.isEmpty { Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    Text(isOrganization ? Customer360Format.full(item.date) : Customer360Format.short(item.date)).font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.target == nil)
    }

    @ViewBuilder private func side(_ data: Customer360Data) -> some View {
        panel(isOrganization ? "Następne działanie" : "Następne najlepsze działanie", symbol: isOrganization ? nil : "sparkles") {
            Text(recommendation(data)).fixedSize(horizontal: false, vertical: true)
        }
        if isOrganization {
            let people = data.contacts ?? []
            panel("Kontakty (\(people.count))", symbol: "person.2") {
                ForEach(people) { person in
                    Button { store.open(person.id, kind: .contact) } label: {
                        HStack {
                            Text(person.name).lineLimit(1)
                            Spacer()
                            Text(person.position.isEmpty ? (person.isPrimary ? "główny" : "kontakt") : person.position).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        } else {
            let organizations = data.organizations ?? []
            panel("Powiązane organizacje", symbol: "building.2") {
                if organizations.isEmpty { Text("Brak aktywnych powiązań.").font(.callout).foregroundStyle(.secondary) }
                ForEach(organizations) { organization in
                    Button { store.open(organization.id, kind: .organization) } label: {
                        HStack {
                            Text(organization.name).lineLimit(1)
                            Spacer()
                            Text(organization.position.isEmpty ? "kontakt" : organization.position).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let quality = data.quality {
                panel("Jakość danych", symbol: "person.text.rectangle") {
                    qualityRow("E-mail", quality.email)
                    qualityRow("Telefon", quality.phone)
                    qualityRow("Organizacja", quality.organization)
                }
            }
        }
    }

    private func qualityRow(_ label: String, _ complete: Bool) -> some View {
        HStack {
            Text(label)
            Spacer()
            if complete { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
            else { Text("uzupełnij").font(.caption).foregroundStyle(.orange) }
        }
    }

    /// Jak `recommendation` w `Customer360Panel` / `Organization360Panel`.
    private func recommendation(_ data: Customer360Data) -> String {
        let metrics = data.metrics
        if isOrganization {
            if metrics.dueActions > 0 { return "Wymagane działanie: \(metrics.dueActions) zaległe kontakty sprzedażowe." }
            if metrics.openInquiries > 0 { return "Sprawdź najbliższy krok w otwartym zapytaniu." }
            return "Brak pilnych działań dla tej organizacji."
        }
        if metrics.dueActions > 0 { return "Wykonaj \(metrics.dueActions == 1 ? "zaległy kontakt" : "\(metrics.dueActions) zaległe kontakty")." }
        if metrics.openInquiries > 0 && !data.timeline.contains(where: { $0.kind == "call" }) { return "Skontaktuj się z klientem i uzupełnij wynik rozmowy." }
        if metrics.openInquiries > 0 { return "Sprawdź najbliższą akcję w otwartym zapytaniu." }
        if data.timeline.isEmpty { return "Uzupełnij pierwszy kontakt lub utwórz zapytanie sprzedażowe." }
        return "Brak pilnych działań. Relacja z klientem jest aktualna."
    }

    // MARK: Sprzedawcy w organizacji
    @ViewBuilder private func sellersPanel(_ data: Customer360Data) -> some View {
        let sellers = data.sellers ?? []
        let others = data.otherPeople ?? []
        if data.sellersError != nil || !sellers.isEmpty || isHotel {
            panel("Sprzedawcy w tej organizacji", subtitle: "Osoby obecnie zatrudnione w \(organizationName), które sprzedają usługi przez portal.", symbol: "percent") {
                if let failure = data.sellersError {
                    Text(failure).foregroundStyle(.red)
                } else if sellers.isEmpty {
                    Text("W tej organizacji nie pracuje jeszcze żaden sprzedawca. Pokaż portal osobie decyzyjnej i mianuj ją sprzedawcą z listy poniżej.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(sellers) { seller in
                        Button { state.showSeller(contactID: seller.contactId) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "person.crop.circle").font(.title3).foregroundStyle(theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(seller.name).fontWeight(.medium)
                                    Text([seller.position, seller.email].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? "Karta sprzedawcy")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(sellerStatus(seller.status)).font(.caption.weight(.medium))
                                    Text(seller.portalEnabled ? "Portal włączony" : "Portal wyłączony").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                            .padding(8).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                if data.canManageSellers == true && !others.isEmpty {
                    Divider()
                    Text("Pozostałe osoby z organizacji").font(.subheadline.weight(.medium))
                    ForEach(others.prefix(8)) { person in
                        HStack {
                            Button(person.name) { store.open(person.contactId, kind: .contact) }.buttonStyle(.link)
                            if !person.position.isEmpty { Text(person.position).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button { state.openCRM("/crm/salespeople?new=1&contactId=\(person.contactId)") } label: { Label("Mianuj sprzedawcą", systemImage: "person.badge.plus") }
                                .controlSize(.small)
                        }
                    }
                    if others.count > 8 { Text("…oraz \(others.count - 8) innych osób w zakładce Osoby kontaktowe.").font(.caption).foregroundStyle(.secondary) }
                }
                Button { state.openCRM("/crm/salespeople/demo?organization=\(ref.id)&hotel=\(organizationName.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")") } label: {
                    Label("Pokaż portal hotelowi", systemImage: "rectangle.on.rectangle")
                }
                .buttonStyle(.link)
            }
        }
    }

    private func sellerStatus(_ status: String) -> String {
        switch status { case "onboarding": return "Do uzgodnienia"; case "inactive": return "Nieaktywny"; default: return "Aktywny" }
    }

    // MARK: Dane
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            data = try await Customer360API.get(state, ["op": "customer360", "kind": isOrganization ? "organization" : "contact", "id": ref.id], as: Customer360Data.self)
            error = nil
        } catch {
            self.error = Customer360API.message(error, isOrganization ? "Nie udało się pobrać danych organizacji" : "Nie udało się połączyć danych klienta.")
        }
    }

    private func loadMoreMail() async {
        guard let current = data else { return }
        loadingMail = true
        defer { loadingMail = false }
        struct Reply: Decodable { var items: [Customer360Data.Activity]; var hasMore: Bool; var mailOffset: Int }
        do {
            let reply = try await Customer360API.get(state, ["op": "customer360Mail", "id": ref.id, "offset": String(current.mailOffset)], as: Reply.self)
            var merged: [String: Customer360Data.Activity] = [:]
            for item in current.timeline + reply.items { merged[item.id] = item }
            var next = current
            next.timeline = merged.values.sorted { lhs, rhs in
                (Customer360Format.sortKey(lhs.date)) > (Customer360Format.sortKey(rhs.date))
            }
            next.hasMoreMail = reply.hasMore
            next.mailOffset = reply.mailOffset
            data = next
        } catch {
            state.error = "Nie udało się pobrać kolejnych wiadomości"
        }
    }
}

extension Customer360Format {
    /// Klucz sortowania osi (nowsze wyżej), jak `new Date(...).getTime()`.
    static func sortKey(_ raw: String) -> Double {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date.timeIntervalSince1970 }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date.timeIntervalSince1970 }
        let day = DateFormatter(); day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = TimeZone(identifier: "UTC"); day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(raw.prefix(10)))?.timeIntervalSince1970 ?? 0
    }
}

// MARK: Zapytania klienta

@MainActor struct CustomerInquiriesPanel: View {
    let ref: ContactRef
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    struct Item: Decodable, Identifiable { var id: String; var title: String; var stage: String; var stageLabel: String; var createdAt: String; var archived: Bool }
    struct Page: Decodable { var items: [Item]; var hasMore: Bool }
    @State private var items: [Item] = []
    @State private var loading = false
    @State private var failed = false
    @State private var more = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Zapytania i notatki klienta").font(.headline)
            Text("Historia powiązanych zapytań, ustaleń i rozmów dostępnych w Twoim zakresie uprawnień. Notatki i rozmowy zapytania — po jego otwarciu.")
                .font(.caption).foregroundStyle(.secondary)
            if !items.isEmpty {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                    GridRow {
                        Text("Zapytanie").font(.caption).foregroundStyle(.secondary)
                        Text("Utworzono").font(.caption).foregroundStyle(.secondary)
                        Text("Etap").font(.caption).foregroundStyle(.secondary)
                    }
                    Divider()
                    ForEach(items) { item in
                        GridRow {
                            Button(item.title) { state.showInquiry(item.id) }.buttonStyle(.link).lineLimit(2)
                            Text(Customer360Format.dayTime(item.createdAt)).font(.callout).foregroundStyle(.secondary)
                            HStack(spacing: 6) {
                                Circle().fill(InquiryStage(raw: item.stage).color).frame(width: 7, height: 7)
                                Text(item.stageLabel).font(.callout)
                                if item.archived { Text("Zarchiwizowane").font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            }
            if failed {
                HStack { Text("Nie udało się pobrać historii.").foregroundStyle(.red); Button("Spróbuj ponownie") { Task { await load(reset: items.isEmpty) } } }
            }
            if loading { Text("Ładowanie historii…").foregroundStyle(.secondary) }
            else if !failed && items.isEmpty { Text("Brak powiązanych zapytań.").foregroundStyle(.secondary) }
            if more && !failed { Button("Pokaż starsze zapytania") { Task { await load(reset: false) } }.disabled(loading) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .task(id: ref.id) { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        loading = true
        failed = false
        defer { loading = false }
        let offset = reset ? 0 : items.count
        do {
            let page = try await Customer360API.get(state, ["op": "customerInquiries", "kind": ref.kind == .organization ? "organization" : "contact",
                                                            "id": ref.id, "offset": String(offset)], as: Page.self)
            items = reset ? page.items : items + page.items
            more = page.hasMore
        } catch {
            failed = true
        }
    }
}

// MARK: Oferty klienta

@MainActor struct CustomerOffersPanel: View {
    let ref: ContactRef
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    struct Item: Decodable, Identifiable { var id: String; var number: String; var status: Customer360Badge?; var createdAt: String; var validUntil: String }
    struct Page: Decodable { var items: [Item]; var hasMore: Bool }
    @State private var items: [Item] = []
    @State private var loading = false
    @State private var failed = false
    @State private var more = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Oferty").font(.headline)
                Spacer()
                Button("Odśwież") { Task { await load(reset: true) } }.disabled(loading)
            }
            Text("\(ref.kind == .organization ? "Oferty przygotowane dla tej organizacji." : "Oferty przygotowane dla tej osoby.") Lista uwzględnia Twój zakres uprawnień.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(items) { item in
                Button { state.open(.offers, id: item.id) } label: {
                    HStack(spacing: 10) {
                        Text(item.number.isEmpty ? "Oferta bez numeru" : item.number).fontWeight(.medium)
                        if let status = item.status { Customer360BadgeView(badge: status) }
                        Spacer()
                        Text("Utworzono: \(Customer360Format.day(item.createdAt))").font(.caption).foregroundStyle(.secondary)
                        if !item.validUntil.isEmpty { Text("Ważna do: \(Customer360Format.day(item.validUntil))").font(.caption).foregroundStyle(.secondary) }
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if failed {
                HStack { Text("Nie udało się pobrać ofert.").foregroundStyle(.red); Button("Spróbuj ponownie") { Task { await load(reset: items.isEmpty) } } }
            }
            if loading { Text("Ładowanie ofert…").foregroundStyle(.secondary) }
            else if !failed && items.isEmpty { Text("Brak powiązanych ofert.").foregroundStyle(.secondary) }
            if more && !failed { Button("Pokaż starsze oferty") { Task { await load(reset: false) } }.disabled(loading) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .task(id: ref.id) { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        loading = true
        failed = false
        defer { loading = false }
        let offset = reset ? 0 : items.count
        do {
            let page = try await Customer360API.get(state, ["op": "customerOffers", "kind": ref.kind == .organization ? "organization" : "contact",
                                                            "id": ref.id, "offset": String(offset)], as: Page.self)
            items = reset ? page.items : items + page.items
            more = page.hasMore
        } catch {
            failed = true
        }
    }
}

// MARK: Nawigacja

extension Workspace {
    /// Karta sprzedawcy na ekranie Sprzedawców (wg kontaktu); bez tej sekcji — zakładka „Sprzedaż sprzedawcy” w CRM.
    func showSeller(contactID: String) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/salespeople" }) else {
            openCRM("/crm/contacts/\(contactID)?tab=seller")
            return
        }
        openHref("/crm/salespeople")
        sellers.focusSellerContact = contactID
    }
}
