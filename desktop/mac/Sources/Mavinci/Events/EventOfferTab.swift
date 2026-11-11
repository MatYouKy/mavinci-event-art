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

    private func content(_ data: OfferTabData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Oferty").font(.title2.weight(.light))
                        Text("Zarządzaj ofertami dla tego eventu").font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !data.offers.isEmpty && data.eventStatus == "offer_to_send" {
                        Button { state.openCRM("/crm/events/\(eventID)?tab=offer") } label: { Label("Wyślij ofertę", systemImage: "paperplane") }
                            .help("Wysyłka oferty e-mailem otworzy się w CRM.")
                    }
                    Button { state.openCRM("/crm/events/\(eventID)?tab=offer") } label: { Label("Nowa oferta", systemImage: "plus") }
                        .buttonStyle(.borderedProminent).help("Kreator oferty otworzy się w CRM.")
                }
                if data.offers.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "dollarsign.circle").font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text("Brak ofert dla tego eventu").foregroundStyle(.secondary)
                        Button("Utwórz pierwszą ofertę") { state.openCRM("/crm/events/\(eventID)?tab=offer") }
                    }
                    .frame(maxWidth: .infinity).padding(40)
                    .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                } else {
                    ForEach(data.offers) { offer in row(offer, data) }
                }
            }
            .padding(18)
        }
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

    private func row(_ offer: OfferTabData.Offer, _ data: OfferTabData) -> some View {
        let canDelete = offer.status == "draft" || offer.status == "sent" || data.isAdmin
        let lockedReason: String = offer.status == "accepted" ? "Nie można usunąć zaakceptowanej oferty" : "Nie można usunąć odrzuconej oferty"
        let color = Self.statusColor(offer.status)
        let updated = offer.updatedAt != nil && offer.updatedAt != offer.createdAt ? Self.day(offer.updatedAt) : nil
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(offer.number ?? "Brak numeru").font(.headline)
                        Text(Self.statusLabel(offer.status)).font(.caption.weight(.semibold)).foregroundStyle(color)
                            .padding(.horizontal, 7).padding(.vertical, 3).background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 5))
                    }
                    Text("Klient: " + offer.client).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Self.money(offer.gross)).font(.title3.weight(.light)).foregroundStyle(theme.accent)
                    Text("netto: " + Self.money(offer.net)).font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 10) {
                if let valid = Self.day(offer.validUntil) { Text("Ważna do: " + valid) }
                if let created = Self.day(offer.createdAt) { Text("Utworzona: " + created) }
                if let updated { Text("•"); Text("Zaktualizowana: " + updated) }
                Spacer()
                if offer.status == "draft" || offer.status == "sent" {
                    Button { state.openCRM("/crm/events/\(eventID)?tab=offer") } label: { Image(systemName: "lock") }
                        .buttonStyle(.borderless).help("Zarezerwuj sprzęt (w CRM)")
                }
                if canDelete {
                    Button { deleting = offer } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                        .help("Usuń ofertę").disabled(busy == offer.id)
                } else {
                    Image(systemName: "trash").foregroundStyle(.tertiary).help(lockedReason)
                }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let notes = offer.notes?.nonEmpty { Text(notes).font(.callout).foregroundStyle(.secondary).padding(.top, 2) }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .opacity(busy == offer.id ? 0.5 : 1)
        .contentShape(Rectangle())
        .onTapGesture { open(offer) }
        .help("Otwórz ofertę")
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
