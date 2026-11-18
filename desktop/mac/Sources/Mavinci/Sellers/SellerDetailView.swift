import SwiftUI

// MARK: Karta sprzedawcy na Macu — „Gotowość do pracy” (te same kroki co CRM, `src/lib/seller/readiness.ts`), opiekun i konto
// w portalu, marki, oferty na osi w 5 etapach (widok opiekuna), realizacje oraz „Prowizje i narzuty” — całe konto sprzedawcy
// (prowizje, narzuty z ofert, wypłaty i saldo; dla osób z dostępem do finansów) z przełącznikiem „Wynagrodzenie w portalu
// sprzedawcy” (zakładka „Moje wynagrodzenie” w portalu — `SellerVisibilityView.swift`). Rozmowy ze sprzedawcą i historia zmian —
// `SellerChatView.swift`; ustawienia (opiekun, widoczność wynagrodzenia, profil, warunki marek, portal) — `SellerSettingsView.swift`,
// także z akcji „Gotowości do pracy”; indywidualne ceny — `SellerPricingView.swift`; podgląd brandingu — w ustawieniach.

@MainActor struct SellerDetailView: View {
    @ObservedObject var store: SellersStore
    let seller: SellerCockpitState.Seller
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    /// Karta z magazynu sprzedawców — odświeżenie kokpitu (przycisk, ⌘R) odświeża też otwartą kartę.
    private var card: SellerCardState? { store.cards[seller.id] }
    @State private var error: String?
    @State private var readinessOpen: Bool?
    @State private var offerFilter = "all"
    @State private var chatShown = false
    @State private var auditShown = false
    /// Ustawienia sprzedawcy — z przycisku w nagłówku albo z akcji „Gotowości do pracy” (z sekcją do pokazania).
    @State private var settings: SellerSettingsRequest?
    /// Indywidualny cennik sprzedawcy (`SellerPricingView.swift`).
    @State private var pricingShown = false
    /// Ponowne wysłanie dostępu do portalu z osobistą wiadomością (`SellerInviteView.swift`).
    @State private var inviteShown = false
    /// „Rozliczenia” — przewinięcie do konta prowizji i narzutów na tej karcie.
    @State private var scrollTarget: String?
    /// Pokazanie / ukrycie wynagrodzenia w portalu (cała zakładka albo marka) — okno z powodem i powiadomieniem.
    @State private var visibility: SellerVisibilityChange?

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let card {
                    readiness(card)
                    people(card)
                    offers(card)
                    events(card)
                    // Czy sprzedawca widzi w portalu zakładkę „Moje wynagrodzenie” — niezależnie od dostępu do konta niżej
                    // (zmienia opiekun sprzedawcy, finanse albo administrator; uprawnienia sprawdza baza).
                    SellerPortalPayCard(terms: card.terms) { visibility = $0 }
                    // Konto prowizji i narzutów — widoczne, gdy baza udostępni je użytkownikowi (dostęp do finansów).
                    if store.commissionAccount(seller.id)?.hidden != true {
                        EmployeeCommissionsView(store: store, employeeID: seller.id, employeeName: seller.name, kind: .partner)
                            .id("commissions")
                    }
                } else if let error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).foregroundStyle(.red)
                        Button("Spróbuj ponownie") { Task { await load() } }
                    }
                } else {
                    ProgressView("Wczytywanie karty sprzedawcy…").frame(maxWidth: .infinity, minHeight: 160)
                }
            }
            .padding(20).frame(maxWidth: 980, alignment: .leading)
        }
        .onChange(of: scrollTarget) { _, target in
            guard let target else { return }
            withAnimation { proxy.scrollTo(target, anchor: .top) }
            scrollTarget = nil
        }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task { await load() }
        .sheet(isPresented: $chatShown) {
            SellerChatSheet(store: store, seller: seller).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $auditShown) {
            SellerAuditSheet(store: store, seller: seller).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $pricingShown) {
            SellerPricingSheet(store: store, partnerID: seller.id).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $inviteShown) {
            SellerInviteSheet(store: store, partnerID: seller.id, sellerName: seller.name, email: seller.email, managerName: seller.managerName) {
                Task { await load() }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $settings) { request in
            SellerSettingsSheet(store: store, seller: seller, focus: request.focus)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $visibility) { change in
            SellerVisibilityDialog(change: change) { reason, notify in
                await store.setCommissionVisibility(partner: seller.id, change: change, reason: reason, notify: notify)
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private func load() async {
        do { _ = try await store.card(seller.id); error = nil }
        catch { self.error = store.failureText(error, "Nie udało się wczytać karty sprzedawcy.") }
    }

    // MARK: Nagłówek

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(seller.name).font(.title2.weight(.light)).textSelection(.enabled)
                chip(seller.statusLabel, tone: seller.status == "active" ? "success" : "neutral")
                chip(seller.portalLabel, tone: seller.portalAccount == "active" ? "success" : seller.portalAccount == "invited" ? "waiting" : "neutral")
            }
            Text(seller.organization ?? "Bez organizacji").foregroundStyle(.secondary)
            HStack(spacing: 14) {
                if let email = seller.email, !email.isEmpty { Text(email).textSelection(.enabled) }
                if let phone = seller.phone, !phone.isEmpty { Text(phone).textSelection(.enabled) }
                Text("Ostatnia aktywność: \(SellerDates.relative(seller.lastActivityAt, empty: "brak"))").foregroundStyle(.secondary)
            }
            .font(.callout)
            HStack(spacing: 8) {
                Button("Karta w CRM") { state.openCRM(card?.links.card ?? seller.cardHref) }
                Button { chatShown = true } label: { Label("Rozmowa", systemImage: "bubble.left.and.bubble.right") }
                Button { auditShown = true } label: { Label("Historia zmian", systemImage: "clock.arrow.circlepath") }
                Button { settings = SellerSettingsRequest(focus: nil) } label: { Label("Ustawienia", systemImage: "gearshape") }
                if card != nil { Button { pricingShown = true } label: { Label("Indywidualne ceny", systemImage: "tag") } }
                if seller.hasMoney, card != nil {
                    // Konto prowizji i narzutów jest na tej karcie (niżej) — przewiń; bez dostępu do konta — rozliczenia w CRM.
                    Button("Rozliczenia (\(seller.payable))") {
                        if store.commissionAccount(seller.id)?.hidden != true { scrollTarget = "commissions" }
                        else if let card { state.openCRM(card.links.settlements) }
                    }
                }
            }
            .controlSize(.small)
        }
    }

    // MARK: Gotowość do pracy

    @ViewBuilder private func readiness(_ card: SellerCardState) -> some View {
        if let readiness = card.readiness {
            let summary = readiness.summary
            let open = readinessOpen ?? !summary.complete
            VStack(alignment: .leading, spacing: 10) {
                Button { readinessOpen = !open } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "person.crop.circle.badge.checkmark").font(.title3)
                            .foregroundStyle(summary.complete ? Color.green : theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(summary.complete ? "Sprzedawca gotowy do pracy" : summary.ready ? "Gotowy do startu — reszta po stronie hotelu" : "Gotowość do pracy").font(.headline)
                            Text("Wymagane: \(summary.requiredDone)/\(summary.requiredTotal) · wszystkie kroki: \(summary.done)/\(summary.total)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: open ? "chevron.up" : "chevron.down").foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                ProgressView(value: Double(summary.done), total: Double(max(1, summary.total))).tint(summary.complete ? .green : theme.accent)
                if open {
                    ForEach(readiness.steps) { step in readinessRow(step, card: card) }
                }
            }
            .padding(16).background(theme.card, in: RoundedRectangle(cornerRadius: 14))
        } else if let message = card.readinessError {
            Text(message).font(.caption).foregroundStyle(.secondary)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func readinessRow(_ step: SellerCardState.Step, card: SellerCardState) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon(step.state)).foregroundStyle(stateColor(step.state)).frame(width: 22).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(step.label).font(.callout)
                    if step.required && step.state == "todo" { chip("wymagane", tone: "warning") }
                    if step.state == "waiting" { chip("czeka na hotel", tone: "waiting") }
                }
                Text(step.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let action = step.action {
                Button(action.label) { run(action, card: card) }.controlSize(.small).disabled(action.kind == "resend" && !state.canWrite)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func run(_ action: SellerCardState.Action, card: SellerCardState) {
        switch action.kind {
        case "resend":
            // Podgląd treści e-maila i osobista wiadomość przed wysłaniem.
            inviteShown = true
        case "branding":
            // „Ustaw wygląd” — ustawienia z rozwiniętym podglądem brandingu i wizytówki.
            settings = SellerSettingsRequest(focus: "branding")
        case "link":
            state.openCRM(action.href ?? card.links.card)
        default:
            // Sekcje ustawień (organizacja, marki, dostęp, opiekun) — arkusz ustawień przewinięty do wskazanej sekcji.
            settings = SellerSettingsRequest(focus: action.section)
        }
    }

    private func icon(_ state: String) -> String {
        switch state {
        case "done": return "checkmark.circle.fill"
        case "waiting": return "hourglass"
        default: return "circle"
        }
    }

    private func stateColor(_ value: String) -> Color {
        switch value {
        case "done": return .green
        case "todo": return .orange
        case "waiting": return .blue
        default: return .secondary
        }
    }

    // MARK: Opiekun, konto, marki

    private func people(_ card: SellerCardState) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Opiekun i konto").font(.headline)
                LabeledContent("Opiekun", value: card.manager.name ?? "Brak opiekuna")
                if let backup = card.manager.backupName { LabeledContent("Zastępca", value: backup) }
                if card.manager.name != nil && !card.manager.ok {
                    Text("Opiekun nie ma uprawnień do prowadzenia sprzedawców.").font(.caption).foregroundStyle(.orange)
                }
                LabeledContent("Portal", value: card.portal.account == "active" ? "Aktywny" : card.portal.account == "invited" ? "Zaproszony" : "Bez konta")
                if let last = card.portal.lastSignInAt { LabeledContent("Ostatnie logowanie", value: SellerDates.relative(last)) }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 6) {
                Text("Marki i prowizja").font(.headline)
                if card.terms.isEmpty { Text("Brak warunków marek.").font(.callout).foregroundStyle(.secondary) }
                ForEach(card.terms) { term in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(term.name).font(.callout)
                            Spacer()
                            Text(term.active ? "aktywna" : "nieaktywna").font(.caption).foregroundStyle(term.active ? Color.green : Color.secondary)
                        }
                        if term.commission {
                            Text("Prowizja \(rate(term.rate)) od zysku · \(term.commissionsVisible ? "widoczna w portalu" : "ukryta przed hotelem")")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Bez rozliczenia prowizyjnego").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func rate(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "pl_PL"))) + "%"
    }

    // MARK: Oferty i realizacje

    private func offers(_ card: SellerCardState) -> some View {
        let rows = card.offers.filter { offer in
            switch offerFilter {
            case "mine": return offer.journey.needsAction
            case "ended": return offer.journey.ended
            case "all": return true
            default: return offer.journey.key == offerFilter && !offer.journey.ended
            }
        }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Oferty").font(.headline)
                Spacer()
                if card.canViewOffers && !card.offers.isEmpty {
                    Picker("Etap", selection: $offerFilter) {
                        Text("Wszystkie etapy").tag("all")
                        Text("Wymaga mojej reakcji").tag("mine")
                        Text("Oferta").tag("offer")
                        Text("U klienta").tag("client")
                        Text("U opiekuna").tag("manager")
                        Text("Wydarzenie").tag("event")
                        Text("Zakończone bez realizacji").tag("ended")
                    }
                    .labelsHidden().frame(maxWidth: 240)
                }
            }
            if !card.canViewOffers {
                Text("Twój zakres uprawnień nie obejmuje ofert tego sprzedawcy.").font(.callout).foregroundStyle(.secondary)
            } else if rows.isEmpty {
                Text(card.offers.isEmpty ? "Sprzedawca nie ma jeszcze ofert." : "Brak ofert na tym etapie.").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(rows) { offer in
                    Button { state.open(.offers, id: offer.id) } label: { offerRow(offer) }
                        .buttonStyle(.plain)
                        .contextMenu { Button("Otwórz w CRM") { state.openCRM(offer.href) } }
                }
            }
        }
        .padding(16).background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func offerRow(_ offer: SellerCardState.Offer) -> some View {
        let tone = SellerTone.color(offer.journey.tone, accent: theme.accent)
        let title = (offer.number.map { $0 + " · " } ?? "") + offer.title
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.callout.weight(.medium)).lineLimit(1)
                Spacer()
                if let net = offer.net { Text("\(net) netto").font(.caption).monospacedDigit() }
            }
            Text([offer.client ?? "Klient do uzupełnienia", offer.brand, offer.eventDate.map { Labels.date($0) }].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            SellerJourneyBar(index: offer.journey.index, tone: tone, ended: offer.journey.ended)
            HStack(spacing: 6) {
                chip("\(offer.journey.stageLabel) · \(offer.journey.state)", tone: offer.journey.tone)
                if offer.journey.actor != "—" && !offer.journey.ended { Text("Teraz działa: \(offer.journey.actor)").font(.caption2).foregroundStyle(.secondary) }
            }
            Text(offer.journey.now).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        .background(offer.journey.needsAction ? theme.accent.opacity(0.08) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func events(_ card: SellerCardState) -> some View {
        if !card.events.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Realizacje").font(.headline)
                ForEach(card.events) { event in
                    Button { state.showEvent(event.id, cardTab: nil) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.name).lineLimit(1)
                                Text([event.brand, Labels.text(event.status)].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Labels.date(event.date ?? "")).font(.caption).monospacedDigit()
                        }
                        .padding(8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(16).background(theme.card, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func chip(_ text: String, tone: String) -> some View {
        Text(text).font(.caption2).padding(.horizontal, 7).padding(.vertical, 2)
            .background(SellerTone.color(tone, accent: theme.accent).opacity(0.13), in: Capsule())
            .foregroundStyle(SellerTone.color(tone, accent: theme.accent))
    }
}

/// Oś oferty w 5 etapach (Oferta → U klienta → U opiekuna → Wydarzenie → Rozliczenie) — kreski jak w portalu i CRM.
struct SellerJourneyBar: View {
    static let labels = ["Oferta", "U klienta", "U opiekuna", "Wydarzenie", "Rozliczenie"]
    let index: Int
    let tone: Color
    let ended: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<Self.labels.count, id: \.self) { step in
                Capsule()
                    .fill(step < index ? theme.accent.opacity(0.5) : step == index ? (ended ? Color.secondary : tone) : Color.primary.opacity(0.1))
                    .frame(height: 5)
                    .help(Self.labels[step])
            }
        }
        .frame(maxWidth: 320)
        .accessibilityLabel("Etap \(min(index, Self.labels.count - 1) + 1) z \(Self.labels.count): \(Self.labels[max(0, min(index, Self.labels.count - 1))])")
    }
}
