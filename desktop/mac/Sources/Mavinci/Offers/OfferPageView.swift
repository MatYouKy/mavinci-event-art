import AppKit
import SwiftUI

// MARK: Strona oferty (`/crm/offers/[id]`, `page.tsx`) — nagłówek z numerem, źródłem i statusem; lewa kolumna: informacje
// podstawowe (`OfferBasicInfo`), założenia wydarzenia, pozycje oferty z układem w PDF (`OfferItems`) i historia zmian;
// prawa: akcje (status, przejścia do wydarzenia / zapytania, zapisany PDF), kontekst zapytania i podsumowanie (`OfferDetails`).
// Część A — odczyt, zmiana statusu i usuwanie; edycja treści, generowanie PDF i wysyłka w kolejnych częściach (do tego czasu w CRM).

@MainActor struct OfferPageView: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @EnvironmentObject var state: Workspace
    @Environment(\.crmTheme) var theme
    @State private var deleting = false

    var detail: OfferDetail? { store.details[offerID] }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let detail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if detail.offer.seller { sellerNotice }
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: 14) {
                                VStack(spacing: 14) { mainColumn(detail) }.frame(minWidth: 560, maxWidth: .infinity)
                                VStack(spacing: 14) { sideColumn(detail) }.frame(width: 400)
                            }
                            VStack(spacing: 14) {
                                mainColumn(detail)
                                sideColumn(detail)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 1400, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
            } else if let problem = store.detailErrors[offerID] {
                ContentUnavailableView {
                    Label(problem.lowercased().contains("nie znaleziono") ? "Oferta nie została znaleziona" : "Nie udało się pobrać oferty",
                          systemImage: "exclamationmark.triangle")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(offerID) } }
                    Button("Wróć do listy") { store.openedID = nil }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(detail.map { "Oferta \($0.offer.number)" } ?? "Oferta")
        .task(id: offerID) { await store.loadDetail(offerID) }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await store.loadDetail(offerID) }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć tę ofertę?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Usuń ofertę", role: .destructive) { Task { _ = await store.delete(offerID) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(detail?.offer.eventId != nil
                 ? "Sprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.\nWszystkie pliki PDF zostaną usunięte.\n\nTej operacji nie można cofnąć."
                 : "Wszystkie pliki PDF zostaną usunięte.\n\nTej operacji nie można cofnąć.")
        }
    }

    // MARK: Nagłówek
    private var header: some View {
        let item = store.offer(offerID)
        return HStack(spacing: 10) {
            Button { store.openedID = nil } label: { Label("Oferty", systemImage: "chevron.left") }
                .help("Wróć do listy ofert")
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text("Oferta \(detail?.offer.number ?? item?.number ?? "")").font(.headline).lineLimit(1)
                    if let source = detail?.source {
                        Text(source.kind == "event" ? "Wydarzenie" : "Zapytanie").font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                    }
                }
                Text(detail?.offer.title ?? item?.titleText ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if let status = detail?.offer.status ?? item?.status { OfferStatusBadge(status: status, page: true) }
            Spacer()
            Button { Task { await store.loadDetail(offerID) } } label: { Image(systemName: "arrow.clockwise") }
                .help("Odśwież ofertę")
            Menu {
                Button { state.openCRM("/crm/offers/\(offerID)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                if let detail, detail.canManage, !detail.offer.seller {
                    Divider()
                    Button(role: .destructive) { deleting = true } label: { Label("Usuń…", systemImage: "trash") }
                        .disabled(!state.canWrite)
                }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .help("Więcej czynności")
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    private var sellerNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.crop.circle.badge.checkmark").foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text("Oferta z portalu sprzedawcy").font(.callout.weight(.semibold))
                Text("Obsługa zapytania sprzedawcy, akceptacja terminu i zasobów — w CRM. Poniżej dane oferty i historia.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Otwórz w CRM") { state.openCRM("/crm/offers/\(offerID)") }.controlSize(.small)
        }
        .padding(12)
        .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Kolumny
    @ViewBuilder func mainColumn(_ detail: OfferDetail) -> some View {
        OfferBasicInfoCard(detail: detail)
        OfferAssumptionsCard(assumptions: detail.assumptions)
        if !detail.offer.seller {
            OfferItemsCard(detail: detail)
            OfferPendingCard(offerID: offerID)
        }
        OfferHistoryCard(detail: detail)
    }

    @ViewBuilder func sideColumn(_ detail: OfferDetail) -> some View {
        if !detail.offer.seller { OfferActionsCard(store: store, detail: detail) }
        if let inquiry = detail.inquiry { OfferInquiryContextCard(inquiry: inquiry) }
        OfferSummaryCard(detail: detail)
    }
}

// MARK: Karta sekcji

/// Karta sekcji strony oferty (tytuł, opcjonalny podpis i treść).
struct OfferCard<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var symbol: String? = nil
    @ViewBuilder var content: Content
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                if let symbol { Label(title, systemImage: symbol).font(.headline) } else { Text(title).font(.headline) }
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }
}

/// Pole „etykieta nad wartością” z ikoną (jak bloki `OfferBasicInfo`).
struct OfferInfoField<Content: View>: View {
    let symbol: String
    let label: String
    @ViewBuilder var content: Content
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                content
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Informacje podstawowe

@MainActor struct OfferBasicInfoCard: View {
    let detail: OfferDetail
    @Environment(\.crmTheme) private var theme
    @State private var heroLarge = false

    var body: some View {
        let basic = detail.basic
        OfferCard(title: "Informacje podstawowe") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), alignment: .topLeading)], alignment: .leading, spacing: 14) {
                OfferInfoField(symbol: "doc.text", label: "Tytuł oferty") {
                    Text(basic.title).font(.callout.weight(.medium)).textSelection(.enabled)
                    if basic.titleInherited { Text("Pobrany z wydarzenia lub zapytania").font(.caption2).foregroundStyle(.secondary) }
                }
                if basic.clientType == "business" {
                    OfferInfoField(symbol: "building.2", label: "Organizacja") {
                        Text(basic.organization.isEmpty ? "Brak organizacji" : basic.organization).font(.callout.weight(.medium)).textSelection(.enabled)
                        if let legal = basic.legalName { Text("Nazwa prawna: \(legal)").font(.caption).foregroundStyle(.secondary) }
                        Text("Osoba kontaktowa").font(.caption).foregroundStyle(.secondary).padding(.top, 4)
                        Text(basic.contactName.isEmpty ? "Nie wybrano osoby kontaktowej" : basic.contactName).font(.callout).textSelection(.enabled)
                        if let email = basic.contactEmail { Text(email).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                } else {
                    OfferInfoField(symbol: "person", label: "Klient indywidualny") {
                        Text(basic.contactName.isEmpty ? "Brak klienta" : basic.contactName).font(.callout.weight(.medium)).textSelection(.enabled)
                        if let email = basic.contactEmail { Text(email).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                }
                if let phone = basic.contactPhone {
                    OfferInfoField(symbol: "phone", label: "Telefon klienta") { Text(phone).font(.callout).textSelection(.enabled) }
                }
                if let description = basic.sellerDescription {
                    OfferInfoField(symbol: "text.quote", label: "Opis od sprzedawcy") { Text(description).font(.callout).textSelection(.enabled) }
                }
                OfferInfoField(symbol: "doc.text", label: "Wydarzenie / zapytanie") {
                    Text(basic.eventLabel).font(.callout).textSelection(.enabled)
                }
                OfferInfoField(symbol: "person.3", label: "Uczestnicy") {
                    Text(basic.audience).font(.callout)
                }
                OfferInfoField(symbol: "function", label: "Źródło wyceny") {
                    Text(basic.pricingSource).font(.callout.weight(.medium))
                    if let calculation = basic.calculation { Text(calculation).font(.caption).foregroundStyle(.secondary) }
                }
                OfferInfoField(symbol: "photo", label: "Grafika hero oferty") {
                    Text(basic.hero).font(.callout)
                    if let path = basic.heroPath, let url = basic.heroUrl {
                        Button { heroLarge = true } label: {
                            ProductThumb(path: path, url: url).frame(width: 180, height: 100)
                        }
                        .buttonStyle(.plain)
                        .help(basic.heroAlt ?? "Grafika hero oferty")
                        .popover(isPresented: $heroLarge) { ProductLargeImage(path: path, url: url).frame(width: 640, height: 400).padding(10) }
                    }
                }
                OfferInfoField(symbol: "calendar", label: "Początek wydarzenia") {
                    Text(basic.start).font(.callout)
                    Text("Koniec wydarzenia").font(.caption).foregroundStyle(.secondary).padding(.top, 4)
                    Text(basic.end).font(.callout)
                }
                OfferInfoField(symbol: "mappin.and.ellipse", label: "Miejsce wydarzenia") { Text(basic.location).font(.callout).textSelection(.enabled) }
                OfferInfoField(symbol: "calendar.badge.clock", label: "Ważna do") {
                    Text(detail.offer.validUntil.flatMap(OfferText.day) ?? "-").font(.callout)
                }
                OfferInfoField(symbol: "banknote", label: "Wartość oferty") {
                    (Text(OfferText.pln(basic.totals.gross)).font(.title3.weight(.semibold)) + Text(" brutto").font(.caption).foregroundColor(.secondary))
                        .monospacedDigit()
                    if basic.totals.discountAmount > 0 {
                        Text("Rabat \(String(format: "%.2f", basic.totals.discountPercent))%: −\(OfferText.pln(basic.totals.discountAmount)) netto")
                            .font(.caption).foregroundStyle(.green)
                    }
                    Text("Netto: \(OfferText.pln(basic.totals.net))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    Text("VAT (\(basic.totals.mixedVat ? "wg stawek pozycji" : "\(OfferText.number(basic.totals.taxPercent))%")): \(OfferText.pln(basic.totals.taxAmount))")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                if let generated = basic.lastGenerated {
                    OfferInfoField(symbol: "person.badge.clock", label: "Ostatnio wygenerowana przez") {
                        Text(generated.name).font(.callout)
                        Text(OfferText.long(generated.at)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let notes = basic.notes {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Notatki").font(.caption).foregroundStyle(.secondary)
                    Text(notes).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 4)
            }
        }
    }
}

// MARK: Założenia wydarzenia

struct OfferAssumptionsCard: View {
    let assumptions: OfferDetail.Assumptions
    @Environment(\.crmTheme) private var theme

    var body: some View {
        OfferCard(title: "Założenia wydarzenia") {
            if let note = assumptions.guestNote { Text(note).font(.caption).foregroundStyle(.secondary) }
            if !assumptions.items.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), alignment: .topLeading)], alignment: .leading, spacing: 10) {
                    ForEach(assumptions.items, id: \.self) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Text(item.badge).font(.callout.weight(.bold)).monospacedDigit()
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
                                .foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.label).font(.callout.weight(.medium))
                                if !item.detail.isEmpty { Text(item.detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            } else if !assumptions.legacy.isEmpty {
                Text(assumptions.legacy).font(.callout).textSelection(.enabled)
            }
            if !assumptions.goal.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Cel wydarzenia").font(.caption).foregroundStyle(.secondary)
                    Text(assumptions.goal).font(.callout).textSelection(.enabled)
                }
            }
            if assumptions.items.isEmpty && assumptions.legacy.isEmpty {
                Text("Brak zapisanych założeń.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: Pozycje oferty

@MainActor struct OfferItemsCard: View {
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace

    var body: some View {
        OfferCard(title: "Pozycje oferty", subtitle: detail.items.isEmpty ? nil : "\(detail.items.count) poz. · kolejność jak w PDF") {
            if detail.items.isEmpty {
                Text("Brak pozycji w ofercie").font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else {
                VStack(spacing: 10) {
                    ForEach(detail.items) { item in OfferItemRow(item: item, vatRate: detail.vatRate) }
                }
            }
        }
    }
}

@MainActor struct OfferItemRow: View {
    let item: OfferDetail.Item
    let vatRate: Double
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var large = false

    private var layoutLabel: String {
        switch item.layout.print {
        case "compact": return "Kompaktowo · 3/str."
        case "visual": return "Duża grafika"
        default: return item.layout.stage ? "Rozbudowany" : "Osobna strona"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let path = item.imagePath, let url = item.imageUrl {
                    Button { large = true } label: { ProductThumb(path: path, url: url) }
                        .buttonStyle(.plain).help("Podgląd")
                        .popover(isPresented: $large) { ProductLargeImage(path: path, url: url).frame(width: 520, height: 390).padding(10) }
                } else {
                    ProductThumb(path: nil, url: nil)
                }
            }
            .frame(width: 80, height: 96)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.name).font(.callout.weight(.semibold))
                    if let variant = item.variantName {
                        Text("Wariant: \(variant)").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                    }
                }
                if let base = item.baseProduct { Text("Produkt bazowy: \(base)").font(.caption).foregroundStyle(.secondary) }
                if !item.description.isEmpty {
                    Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 14) {
                    Text("Ilość: ") + Text("\(OfferText.number(item.quantity)) \(item.unit) × \(OfferText.number(item.days)) dni").bold()
                    Text("Cena netto: ") + Text(OfferText.pln(item.unitPrice)).bold()
                    Text("Cena brutto (VAT \(OfferText.number(vatRate))%): ") + Text(OfferText.pln(item.unitGross)).bold()
                }
                .font(.caption).monospacedDigit()
                HStack(spacing: 6) {
                    Text("Układ w PDF:").foregroundStyle(.secondary)
                    Text(layoutLabel).fontWeight(.medium)
                    if item.layout.hasProductVariants {
                        Text("·").foregroundStyle(.secondary)
                        Text(item.layout.showVariants ? "Pokaż warianty" : "Warianty ukryte")
                        Text("·").foregroundStyle(.secondary)
                        Text(item.layout.showVariantPrices && item.layout.showVariants ? "Ceny wariantów" : "Bez cen wariantów")
                    }
                }
                .font(.caption)
                if let note = layoutNote { Text(note).font(.caption2).foregroundStyle(.secondary) }
                if !item.addons.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(item.addons) { row in
                            HStack {
                                Text("\(row.name) · \(OfferText.number(row.quantity)) \(row.unit) × \(OfferText.number(row.days)) dni × \(OfferText.money(row.unitPrice))")
                                Spacer()
                                Text("\(OfferText.money(row.subtotal)) netto").monospacedDigit()
                            }
                        }
                    }
                    .font(.caption2).foregroundStyle(.secondary)
                    .padding(8)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 2) {
                if item.discountPercent > 0 {
                    Text("Rabat: \(OfferText.number(item.discountPercent))%").font(.caption2).foregroundStyle(.green)
                }
                Text("Wartość netto").font(.caption2).foregroundStyle(.secondary)
                Text(OfferText.pln(item.net)).font(.callout.weight(.semibold)).monospacedDigit()
                Text("brutto · VAT \(OfferText.number(vatRate))%").font(.caption2).foregroundStyle(.secondary)
                Text(OfferText.pln(item.gross)).font(.caption).monospacedDigit()
                if item.discountAmount > 0 {
                    Text(OfferText.pln(item.subtotal)).font(.caption2).strikethrough().foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .frame(minWidth: 130, alignment: .trailing)
        }
        .padding(10)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.06)))
        .contextMenu {
            if let product = item.productId {
                Button("Otwórz produkt", systemImage: "shippingbox") { state.showProduct(product) }
                Button("Publiczna karta produktu", systemImage: "safari") { state.openCRM("/produkty/\(product)") }
            }
        }
    }

    /// Objaśnienia układu jak pod przyciskami w CRM.
    private var layoutNote: String? {
        if item.layout.hasPackages { return "Strony prezentacji elementów i wybór pakietu. Kalkulacja obejmuje tylko wybrany zakres." }
        if !item.layout.stage && item.layout.hasAddons { return "Dodatki wymagają szczegółowej kalkulacji — układ kompaktowy wyłączony." }
        if item.layout.showsVariantComparison { return "Wybór układu strony zacznie obowiązywać po wyłączeniu „Pokaż warianty”." }
        if !item.layout.stage && item.layout.blockedByElements { return "Produkt ma elementy lub warianty — układ kompaktowy jest wyłączony." }
        return nil
    }
}

/// Sekcje strony oferty, które dochodzą w kolejnych częściach (do tego czasu w CRM).
@MainActor struct OfferPendingCard: View {
    let offerID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Pozostałe sekcje oferty").font(.headline)
                Text("Wymagania techniczne, pakiety oferty i propozycje dodatkowe oraz edycja treści dojdą na Macu w kolejnych częściach — do tego czasu zmienisz je w CRM.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button { state.openCRM("/crm/offers/\(offerID)") } label: { Label("Otwórz w CRM", systemImage: "safari") }.controlSize(.small)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }
}

// MARK: Historia zmian

struct OfferHistoryCard: View {
    let detail: OfferDetail
    var body: some View {
        OfferCard(title: "Historia zmian", symbol: "clock.arrow.circlepath") {
            if let at = detail.updatedAfterAcceptance {
                Text("Oferta zaktualizowana po akceptacji: \(OfferText.dayTime(at))").font(.caption).foregroundStyle(.orange)
            }
            if detail.history.isEmpty {
                Text("Brak historii zmian").font(.callout).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(detail.history) { entry in
                        HStack(alignment: .top, spacing: 10) {
                            Circle().fill(Self.color(entry.type)).frame(width: 8, height: 8).padding(.top, 5)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(entry.author ?? "System").font(.callout.weight(.medium))
                                    Text(OfferText.dayTime(entry.at)).font(.caption).foregroundStyle(.secondary)
                                }
                                Text(entry.description).font(.callout).foregroundStyle(Self.color(entry.type)).textSelection(.enabled)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Kolory typów zmian jak `getChangeTypeColor`.
    static func color(_ type: String) -> Color {
        switch type {
        case "created": return .green
        case "status_changed": return .blue
        case "item_added": return .purple
        case "item_removed": return .red
        case "generated_pdf": return Color(red: 0.83, green: 0.73, blue: 0.45)
        default: return .secondary
        }
    }
}

// MARK: Akcje

@MainActor struct OfferActionsCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        OfferCard(title: "Akcje") {
            VStack(alignment: .leading, spacing: 10) {
                if detail.canManage {
                    ProductField(label: "Status oferty") {
                        Picker("", selection: Binding(get: { detail.offer.status }, set: { next in Task { await change(next) } })) {
                            ForEach(OfferText.statuses, id: \.key) { item in Text(item.label).tag(item.key) }
                        }
                        .labelsHidden()
                        .disabled(!state.canWrite)
                    }
                } else {
                    HStack {
                        Text("Status oferty").font(.caption).foregroundStyle(.secondary)
                        OfferStatusBadge(status: detail.offer.status, page: true)
                    }
                }
                if let previous = detail.amendmentSource, detail.offer.status != "accepted" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Edytujesz zmianę oferty. Poprzednia rezerwacja pozostaje aktywna do zatwierdzenia tej wersji.").font(.caption)
                        Button("Poprzednia oferta") { state.showOffer(previous) }.buttonStyle(.link).font(.caption)
                    }
                    .padding(8)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }
                if let source = detail.source, let id = source.id {
                    Button { openSource(source.kind, id) } label: {
                        Label(source.label, systemImage: source.kind == "event" ? "calendar" : "doc.text").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if source.kind == "event", let inquiry = detail.offer.inquiryId {
                        Button { state.showInquiry(inquiry) } label: {
                            Label("Przejdź do zapytania", systemImage: "doc.text").frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                Divider()
                Text("Język dokumentu: ") + Text("PL").bold() + Text(" · kwoty w PLN")
                if detail.pdf.exists {
                    if detail.pdf.stale {
                        Text("Zapisany PDF nie zawiera ostatnich zmian oferty. Możesz go obejrzeć lub pobrać. Przed wysłaniem wygeneruj aktualną wersję.")
                            .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack {
                        Button { Task { await store.pdf(detail.offer.id, open: true) } } label: { Label("Pokaż PDF (PL)", systemImage: "eye") }
                        Button { Task { await store.pdf(detail.offer.id, open: false) } } label: { Label("Pobierz PDF (PL)", systemImage: "arrow.down.doc") }
                    }
                } else {
                    Text("Oferta nie ma jeszcze wygenerowanego PDF.").font(.caption).foregroundStyle(.secondary)
                }
                if detail.canManage {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Generowanie PDF, wysyłka e-mailem, rezerwacja sprzętu i powiązania oferty — na razie w CRM.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Button { state.openCRM("/crm/offers/\(detail.offer.id)") } label: { Label("Otwórz akcje w CRM", systemImage: "safari") }
                    }
                    .padding(.top, 2)
                }
            }
            .controlSize(.small)
        }
    }

    private func openSource(_ kind: String, _ id: String) {
        if kind == "event" { state.showEvent(id) } else { state.showInquiry(id) }
    }

    /// Jak `handleStatusChange`: akceptacja oferty z zapytania — w zapytaniu; z wydarzeniem — rezerwacja sprzętu (na razie w CRM).
    private func change(_ next: String) async {
        guard next != detail.offer.status else { return }
        if next == "accepted" {
            if let inquiry = detail.offer.inquiryId, detail.offer.eventId == nil {
                state.notice = "Użyj akceptacji wariantu w zapytaniu."
                state.showInquiry(inquiry)
            } else if detail.offer.eventId != nil {
                state.notice = "Akceptacja oferty z wydarzeniem odbywa się przez rezerwację sprzętu — otwieram ofertę w CRM."
                state.openCRM("/crm/offers/\(detail.offer.id)")
            } else {
                state.notice = "Użyj akceptacji wariantu w zapytaniu lub przycisku rezerwacji sprzętu."
            }
            return
        }
        _ = await store.setStatus(detail.offer.id, next)
    }
}

// MARK: Kontekst zapytania

@MainActor struct OfferInquiryContextCard: View {
    let inquiry: OfferDetail.Inquiry
    @EnvironmentObject private var state: Workspace
    @State private var open = true

    var body: some View {
        OfferCard(title: "Kontekst zapytania", symbol: "text.bubble") {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Źródło: \(inquiry.source)").font(.caption).foregroundStyle(.secondary)
                    if let client = inquiry.client { Label(client, systemImage: "person").font(.callout) }
                    if let email = inquiry.email {
                        Button { if let url = URL(string: "mailto:\(email)") { NSWorkspace.shared.open(url) } } label: { Label(email, systemImage: "envelope") }
                            .buttonStyle(.link).font(.callout)
                    }
                    if let phone = inquiry.phone { Label(phone, systemImage: "phone").font(.callout).textSelection(.enabled) }
                    ForEach(inquiry.items, id: \.self) { item in
                        Label {
                            Text(item.label + ": ").foregroundColor(.secondary) + Text(item.kind == "date" ? (OfferText.date(item.value).map { MeetingDates.format($0, "d MMM yyyy, HH:mm") } ?? item.value) : item.value)
                        } icon: {
                            Image(systemName: item.kind == "date" ? "calendar.badge.clock" : item.kind == "location" ? "mappin.and.ellipse" : "target")
                        }
                        .font(.callout)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Treść wiadomości").font(.caption).foregroundStyle(.secondary)
                        Text(inquiry.message ?? "Brak zapisanej treści źródłowej.").font(.callout).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                    }
                    if let received = inquiry.receivedEmailId {
                        Button { state.openCRM("/crm/messages/\(received)?type=received") } label: { Label("Otwórz wiadomość źródłową", systemImage: "arrow.up.forward.square") }
                            .buttonStyle(.link).font(.callout)
                    } else if let message = inquiry.contactMessageId {
                        Button { state.openCRM("/crm/messages/\(message)?type=contact") } label: { Label("Otwórz wiadomość źródłową", systemImage: "arrow.up.forward.square") }
                            .buttonStyle(.link).font(.callout)
                    }
                    Button { state.showInquiry(inquiry.id) } label: { Label("Otwórz zapytanie", systemImage: "tray") }
                        .buttonStyle(.link).font(.callout)
                }
                .padding(.top, 6)
            } label: {
                Text(inquiry.title).font(.callout.weight(.medium)).lineLimit(2)
            }
        }
    }
}

// MARK: Informacje i podsumowanie

struct OfferSummaryCard: View {
    let detail: OfferDetail
    var body: some View {
        OfferCard(title: "Informacje") {
            HStack {
                Text("Status").font(.caption).foregroundStyle(.secondary)
                OfferStatusBadge(status: detail.offer.status, page: true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Podsumowanie").font(.caption).foregroundStyle(.secondary)
                Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 6) {
                    GridRow {
                        Text("Cała oferta").gridColumnAlignment(.leading)
                        Text("Netto")
                        Text("Brutto")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    Divider().gridCellColumns(3)
                    ForEach(Array(detail.summary.rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            Text(row.label).gridColumnAlignment(.leading)
                            Text(signed(row.net)).monospacedDigit()
                            Text(signed(row.gross)).monospacedDigit()
                        }
                        .font(row.emphasis == true ? .callout.weight(.semibold) : .callout)
                        .foregroundStyle(row.net < 0 ? Color.green : Color.primary)
                    }
                }
                Text(detail.summary.vat).font(.caption).foregroundStyle(.secondary)
                if let note = detail.summary.logisticsNote { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            Divider()
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Utworzona").foregroundStyle(.secondary)
                    Text(OfferText.dayTime(detail.offer.createdAt))
                }
                GridRow {
                    Text("Ostatnia aktualizacja").foregroundStyle(.secondary)
                    Text(OfferText.dayTime(detail.offer.updatedAt))
                }
                GridRow {
                    Text("Wygasa").foregroundStyle(.secondary)
                    Text(OfferText.dayTime(detail.offer.validUntil))
                }
            }
            .font(.caption)
        }
    }

    private func signed(_ value: Double) -> String { value < 0 ? "−" + OfferText.amount(-value) : OfferText.amount(value) }
}
