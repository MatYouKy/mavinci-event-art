import SwiftUI

// MARK: Oferty wydarzenia (1:1 z `EventTabOffer`): lista ofert z wartością brutto i netto, statusem, klientem i datami,
// usuwanie (szkic / wysłana, administrator — każda), otwarcie oferty. Kreator nowej oferty, wysyłka e-mailem i rezerwacja
// sprzętu należą do modułu Oferty i otwierają się w CRM.

struct OfferTabData: Decodable {
    struct Offer: Decodable, Identifiable, Hashable {
        var id: String; var number: String?; var status: String; var client: String; var gross: Double; var net: Double
        var validUntil: String?; var createdAt: String?; var updatedAt: String?; var notes: String?
    }
    var isAdmin: Bool
    var eventStatus: String
    var offers: [Offer]
}

@MainActor struct EventOfferTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var deleting: OfferTabData.Offer?
    @State private var busy: String?
    @State private var selected: String?

    private var data: OfferTabData? { store.tab(eventID, "offer", as: OfferTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|offer"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać ofert", systemImage: "doc.text")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "offer") } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "offer") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "offer") } }
        .confirmationDialog("Czy na pewno chcesz usunąć tę ofertę?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let offer = deleting { Button("Usuń", role: .destructive) { Task { await remove(offer) } } }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: { Text("Tej operacji nie można cofnąć.") }
    }

    @ViewBuilder private func content(_ data: OfferTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Oferty").font(.title2.weight(.semibold))
                Text(NativeList.count(data.offers.count, "oferta", "oferty", "ofert")).foregroundStyle(.secondary)
                Spacer()
                if !data.offers.isEmpty && data.eventStatus == "offer_to_send" {
                    Button { state.openCRM("/crm/events/\(eventID)?tab=offer") } label: { Label("Wyślij ofertę", systemImage: "paperplane") }
                        .help("Wysyłka oferty e-mailem otworzy się w CRM.")
                }
                Button { state.openCRM("/crm/events/\(eventID)?tab=offer") } label: { Label("Nowa oferta", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).help("Kreator oferty otworzy się w CRM.")
            }
            .padding(.horizontal, 18).padding(.top, 12)
            if data.offers.isEmpty {
                ContentUnavailableView {
                    Label("Brak ofert dla tego eventu", systemImage: "dollarsign.circle")
                } description: { Text("Kreator oferty otwiera się w CRM.") } actions: {
                    Button("Utwórz pierwszą ofertę") { state.openCRM("/crm/events/\(eventID)?tab=offer") }
                }
            } else {
                table(data)
            }
        }
    }

    /// Natywna tabela ofert: dwuklik / ↩ otwiera ofertę, czynności w menu „…” i pod prawym przyciskiem.
    private func table(_ data: OfferTabData) -> some View {
        let lp = NativeList.numbers(data.offers)
        return Table(data.offers, selection: $selected) {
            TableColumn("") { (offer: OfferTabData.Offer) in
                Image(systemName: offer.status == "accepted" ? "doc.text.fill" : "doc.text")
                    .foregroundStyle(Self.statusColor(offer.status)).frame(width: 24, height: 24)
            }.width(32)
            TableColumn("Lp.") { (offer: OfferTabData.Offer) in NativeRowNumber(value: lp[offer.id]) }.width(36)
            TableColumn("Numer") { (offer: OfferTabData.Offer) in
                Text(offer.number ?? "Brak numeru").fontWeight(.medium).lineLimit(1).help(offer.notes ?? "")
            }.width(min: 120, ideal: 170)
            TableColumn("Klient") { (offer: OfferTabData.Offer) in Text(offer.client).lineLimit(1).help(offer.client) }.width(min: 120, ideal: 220)
            TableColumn("Status") { (offer: OfferTabData.Offer) in
                EventDotLabel(label: Self.statusLabel(offer.status), color: Self.statusColor(offer.status))
            }.width(min: 100, ideal: 130)
            TableColumn("Brutto") { (offer: OfferTabData.Offer) in
                Text(Self.money(offer.gross)).monospacedDigit().fontWeight(.medium).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 100, ideal: 130)
            TableColumn("Netto") { (offer: OfferTabData.Offer) in
                Text(Self.money(offer.net)).monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 100, ideal: 130)
            TableColumn("Ważna do") { (offer: OfferTabData.Offer) in
                Text(Self.day(offer.validUntil) ?? "—").monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 100)
            TableColumn("Zmieniona") { (offer: OfferTabData.Offer) in
                Text(Self.day(offer.updatedAt ?? offer.createdAt) ?? "—").monospacedDigit().foregroundStyle(.secondary)
                    .help("Utworzona: " + (Self.day(offer.createdAt) ?? "—"))
            }.width(min: 80, ideal: 100)
            TableColumn("") { (offer: OfferTabData.Offer) in
                Menu { menu(offer, data) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
            }.width(30)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let offer = data.offers.first(where: { $0.id == id }) { menu(offer, data) }
        } primaryAction: { ids in
            if let id = ids.first, let offer = data.offers.first(where: { $0.id == id }) { open(offer) }
        }
        .opacity(busy == nil ? 1 : 0.6)
    }

    @ViewBuilder private func menu(_ offer: OfferTabData.Offer, _ data: OfferTabData) -> some View {
        let canDelete = offer.status == "draft" || offer.status == "sent" || data.isAdmin
        let deleteTitle: String = canDelete ? "Usuń ofertę" : (offer.status == "accepted" ? "Nie można usunąć zaakceptowanej oferty" : "Nie można usunąć odrzuconej oferty")
        Button("Otwórz ofertę", systemImage: "doc.text.magnifyingglass") { open(offer) }
        if offer.status == "draft" || offer.status == "sent" {
            Button("Zarezerwuj sprzęt (w CRM)", systemImage: "lock") { state.openCRM("/crm/events/\(eventID)?tab=offer") }
        }
        if data.eventStatus == "offer_to_send" {
            Button("Wyślij ofertę (w CRM)", systemImage: "paperplane") { state.openCRM("/crm/events/\(eventID)?tab=offer") }
        }
        Divider()
        Button(deleteTitle, systemImage: "trash", role: .destructive) { deleting = offer }.disabled(!canDelete || busy == offer.id)
    }

    private static func statusLabel(_ status: String) -> String {
        switch status {
        case "draft": return "Szkic"
        case "sent": return "Wysłana"
        case "accepted": return "Zaakceptowana"
        case "rejected": return "Odrzucona"
        case "expired": return "Wygasła"
        default: return "Nieznany"
        }
    }
    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "draft": return CrmTheme.rgb(0x9ca3af)
        case "sent": return CrmTheme.rgb(0x60a5fa)
        case "accepted": return CrmTheme.rgb(0x4ade80)
        case "rejected": return CrmTheme.rgb(0xf87171)
        default: return CrmTheme.rgb(0xfacc15)
        }
    }
    private static func day(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if let date = MeetingDates.parse(value) { return MeetingDates.format(date, "dd.MM.yyyy") }
        let parts = value.prefix(10).split(separator: "-")
        return parts.count == 3 ? "\(parts[2]).\(parts[1]).\(parts[0])" : value
    }
    private static func money(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return (formatter.string(from: NSNumber(value: value)) ?? String(value)) + " zł"
    }

    /// Oferta na karcie natywnej (sekcja Oferty), a gdy niedostępna — w CRM.
    private func open(_ offer: OfferTabData.Offer) {
        if state.native.meta("offers") != nil || state.native.records["offers"] != nil { state.showNative("offers", focus: offer.id) }
        else { state.openCRM("/crm/offers/\(offer.id)") }
    }

    private func remove(_ offer: OfferTabData.Offer) async {
        deleting = nil
        busy = offer.id
        defer { busy = nil }
        do {
            try await store.tabAction(eventID, "offer", "delete", ["offerId": .string(offer.id)], reload: ["offer"], success: "Oferta została usunięta", pending: "Usuwanie oferty…")
            await store.loadOverview(eventID)
        } catch {
            state.error = store.failureText(error, "Błąd podczas usuwania oferty")
        }
    }
}
