import SwiftUI

// MARK: „Szybkie akcje” w nagłówku karty kontaktu i organizacji — 1:1 z `ContactQuickActions` w CRM (`/crm/contacts/[id]`):
// „Dodaj zapytanie”, „Wyślij broszurę”, „Wyślij ofertę” (wybór jednej z 100 najnowszych ofert odbiorcy → `OfferEmailSheet`),
// „Utwórz event” (kreator z organizacją i osobą kontaktową; osoba w kilku organizacjach — najpierw wybór organizacji),
// „Broszury klienta” i „Historia wysyłek broszur”. Uprawnienia jak w CRM. Oferty: `offersToSend`
// w `src/lib/native/contactCustomer360.ts` (`/bridge/native/v1/contacts`).

/// Okna „Szybkich akcji” — jedno naraz (wybór oferty → wysyłka, wybór organizacji → kreator).
private enum ContactQuickRoute: Identifiable {
    case brochureMail
    case brochures(String)
    case offers
    case offer(String)
    case eventOrganization
    case event(organizationID: String?)
    var id: String {
        switch self {
        case .brochureMail: return "brochure-mail"
        case .brochures(let tab): return "brochures-\(tab)"
        case .offers: return "offers"
        case .offer(let id): return "offer-\(id)"
        case .eventOrganization: return "event-organization"
        case .event(let organization): return "event-\(organization ?? "none")"
        }
    }
}

@MainActor struct ContactQuickActionsMenu: View {
    /// Klient karty: `contact` albo `organization` (jak `RecipientContext`).
    let context: BrochureRecipientContext
    /// Bieżące organizacje osoby (karta osoby) — do „Utwórz event”.
    let organizations: [ContactCardOrgLink]
    /// „Dodaj zapytanie” — okno nowego zapytania karty (dane klienta pobiera karta).
    let addInquiry: (() -> Void)?
    var preparingInquiry = false
    @EnvironmentObject private var state: Workspace
    @State private var route: ContactQuickRoute?

    private var employee: Employee? { state.employee }
    private var isOrganization: Bool { context.type == "organization" }
    private var canManageOffers: Bool { employee?.has("offers_manage") == true }
    private var canViewBrochures: Bool { employee?.has("offers_brochures_view_own") == true || employee?.has("offers_brochures_view_all") == true }
    private var canCreateEvent: Bool { employee?.has("events_create") == true || employee?.has("events_manage") == true }
    private var hasActions: Bool { addInquiry != nil || canManageOffers || canViewBrochures || canCreateEvent }

    var body: some View {
        if hasActions {
            Menu {
                if let addInquiry {
                    Button { addInquiry() } label: { Label("Dodaj zapytanie", systemImage: "plus") }
                        .help("Utwórz zapytanie w lejku sprzedażowym z danymi klienta.").disabled(preparingInquiry)
                }
                if canManageOffers && canViewBrochures {
                    Button { route = .brochureMail } label: { Label("Wyślij broszurę…", systemImage: "book") }
                        .help("Wybierz broszurę i przygotuj wiadomość z załącznikiem.")
                }
                if canManageOffers {
                    Button { route = .offers } label: { Label("Wyślij ofertę…", systemImage: "doc.text") }
                        .help("Wybierz powiązaną ofertę i otwórz wiadomość do odbiorcy.")
                }
                if canCreateEvent {
                    Button { createEvent() } label: { Label("Utwórz event…", systemImage: "calendar.badge.plus") }
                        .help("Otwórz kreator z danymi kontaktu i organizacji.")
                }
                if canViewBrochures {
                    Divider()
                    Button { route = .brochures("saved") } label: { Label("Broszury klienta…", systemImage: "books.vertical") }
                        .help("Otwórz i pobierz zapisane PDF-y bez ponownego generowania.")
                    Button { route = .brochures("history") } label: { Label("Historia wysyłek broszur…", systemImage: "clock.arrow.circlepath") }
                        .help("Sprawdź wiadomości, załączniki i stan wysyłki.")
                }
            } label: {
                Label("Szybkie akcje", systemImage: "bolt")
            }
            .fixedSize()
            .help("Zapytanie, broszura, oferta, event i historia wysyłek dla tego klienta")
            .sheet(item: $route) { route in
                sheet(route)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
    }

    /// Organizacja — od razu kreator; osoba — jej jedyna organizacja albo wybór (jak `createEvent` w CRM).
    private func createEvent() {
        if isOrganization { route = .event(organizationID: context.id); return }
        if organizations.count > 1 { route = .eventOrganization } else { route = .event(organizationID: organizations.first?.id) }
    }

    @ViewBuilder private func sheet(_ route: ContactQuickRoute) -> some View {
        switch route {
        case .brochureMail:
            ClientBrochureMailSheet(context: context)
        case .brochures(let tab):
            ClientBrochuresSheet(context: context, initialTab: tab, canSendNew: canManageOffers)
        case .offers:
            ContactOfferPickerSheet(context: context) { id in self.route = .offer(id) }
        case .offer(let id):
            OfferEmailSheet(store: state.offers, offerID: id)
        case .eventOrganization:
            ContactEventOrganizationSheet(organizations: organizations) { organization in self.route = .event(organizationID: organization) }
        case .event(let organization):
            EventCreateSheet(store: state.events, initialOrganizationID: organization, initialContactID: isOrganization ? nil : context.id)
                .warehouseSheetStyle(state)
        }
    }
}

/// „Wybierz ofertę do wysłania”: oferty odbiorcy; bez aktualnego PDF — tylko „Otwórz ofertę”.
@MainActor private struct ContactOfferPickerSheet: View {
    let context: BrochureRecipientContext
    let choose: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var offers: [Offer]?
    @State private var error: String?

    struct Offer: Decodable, Identifiable { var id: String; var number: String; var eventId: String?; var ready: Bool }
    private struct Reply: Decodable { var items: [Offer] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Wybierz ofertę do wysłania").font(.title2.bold())
            if let error {
                Text(error).foregroundStyle(.orange)
            } else if let offers {
                if offers.isEmpty {
                    ContentUnavailableView("Brak dostępnych ofert powiązanych z tym odbiorcą", systemImage: "doc.text")
                } else {
                    List(offers) { offer in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(offer.number).textSelection(.enabled)
                                if !offer.ready { Text("Najpierw wygeneruj aktualny PDF.").font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            Button("Otwórz ofertę") { dismiss(); state.showOffer(offer.id) }.controlSize(.small)
                            Button("Przygotuj e-mail") { choose(offer.id) }.controlSize(.small).disabled(!offer.ready)
                        }
                    }
                }
            } else {
                ProgressView("Wczytywanie ofert…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Text("Lista obejmuje maksymalnie 100 najnowszych dostępnych ofert. Odbiorcę możesz uzupełnić w wiadomości.")
                .font(.caption).foregroundStyle(.secondary)
            HStack { Spacer(); Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(20)
        .frame(minWidth: 560, minHeight: 420)
        .task { await load() }
    }

    private func load() async {
        do {
            offers = try await Customer360API.get(state, ["op": "offersToSend", "kind": context.type, "id": context.id], as: Reply.self).items
        } catch {
            self.error = Customer360API.message(error, "Nie udało się pobrać ofert powiązanych z tym odbiorcą.")
        }
    }
}

/// „Organizacja eventu”: osoba w kilku organizacjach — wybór organizacji albo klient indywidualny.
@MainActor private struct ContactEventOrganizationSheet: View {
    let organizations: [ContactCardOrgLink]
    let open: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var organizationID = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Organizacja eventu").font(.title2.bold())
            Text("Wskaż organizację, dla której przygotowujesz event z tym kontaktem.").foregroundStyle(.secondary)
            Picker("Organizacja", selection: $organizationID) {
                Text("Bez organizacji — klient indywidualny").tag("")
                ForEach(organizations, id: \.id) { organization in Text(organization.name).tag(organization.id) }
            }
            .labelsHidden()
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Otwórz kreator") { open(organizationID.isEmpty ? nil : organizationID) }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
