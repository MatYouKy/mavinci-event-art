import AppKit
import SwiftUI

// MARK: Strona oferty (`/crm/offers/[id]`, `page.tsx`) — nagłówek z numerem, źródłem i statusem; lewa kolumna: informacje
// podstawowe (`OfferBasicInfo`), założenia wydarzenia, pozycje oferty z układem w PDF (`OfferItems`) i historia zmian;
// prawa: akcje (status, przejścia do wydarzenia / zapytania, zapisany PDF), kontekst zapytania i podsumowanie (`OfferDetails`).
// Część A — odczyt, zmiana statusu i usuwanie; część B1 — edycja informacji podstawowych, założeń, rabatu, kolejności, układu
// i wariantów pozycji; część B2 — dodawanie i edycja pozycji; część C1 — wymagania techniczne, pakiety oferty i logistyka;
// część C2 — propozycje dodatkowe. Generowanie PDF i wysyłka w kolejnych częściach (do tego czasu w CRM).

@MainActor struct OfferPageView: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @EnvironmentObject var state: Workspace
    @Environment(\.crmTheme) var theme
    @State private var deleting = false
    /// Edycja informacji podstawowych i założeń (część B).
    @State private var basicSheet = false
    @State private var assumptionsSheet = false

    var detail: OfferDetail? { store.details[offerID] }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let detail {
                // Dwie kolumny od ok. 1000 pkt szerokości: treść oferty po lewej, informacje podstawowe, akcje i podsumowanie
                // w kolumnie bocznej po prawej; w wąskim oknie kolumna boczna nad treścią.
                GeometryReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            // Oferta z portalu sprzedawcy: oś, zgoda na cenę i ocena opiekuna (`Sellers/SellerOfferReview.swift`).
                            if detail.offer.seller { SellerOfferReviewPanel(offerID: offerID) { Task { await store.loadDetail(offerID) } } }
                            if proxy.size.width >= 1000 {
                                HStack(alignment: .top, spacing: 14) {
                                    VStack(spacing: 14) { mainColumn(detail) }.frame(maxWidth: .infinity, alignment: .top)
                                    VStack(spacing: 14) { sideColumn(detail) }.frame(width: proxy.size.width >= 1400 ? 440 : 380)
                                }
                            } else {
                                VStack(spacing: 14) {
                                    sideColumn(detail)
                                    mainColumn(detail)
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: 1680, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    }
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
        .sheet(isPresented: $basicSheet) { OfferBasicInfoSheet(store: store, offerID: offerID) }
        .sheet(isPresented: $assumptionsSheet) { OfferAssumptionsSheet(store: store, offerID: offerID) }
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

    // MARK: Kolumny
    @ViewBuilder func mainColumn(_ detail: OfferDetail) -> some View {
        let editAssumptions: (() -> Void)? = editable(detail) ? { assumptionsSheet = true } : nil
        OfferAssumptionsCard(assumptions: detail.assumptions, onEdit: editAssumptions)
        if !detail.offer.seller {
            OfferItemsCard(store: store, detail: detail)
            OfferRequirementsCard(store: store, detail: detail)
            OfferPackagesCard(store: store, detail: detail)
            OfferRecommendationsCard(store: store, detail: detail)
        }
        OfferHistoryCard(detail: detail)
    }

    /// Kolumna boczna: informacje podstawowe, akcje, kontekst zapytania i podsumowanie.
    @ViewBuilder func sideColumn(_ detail: OfferDetail) -> some View {
        let editBasic: (() -> Void)? = editable(detail) ? { basicSheet = true } : nil
        let offerID = detail.offer.id
        // Miejsce wpisane w ofercie → lokalizacja z bazy (miejsce okładki z jej „Tłem ofert”).
        let linkLocation: ((String) -> Void)? = editable(detail) ? { locationID in
            Task {
                await store.change(offerID, "linkLocation", ["locationId": .string(locationID)], pending: "Powiązywanie miejsca…",
                                   success: "Miejsce oferty powiązane z lokalizacją")
            }
        } : nil
        OfferBasicInfoCard(detail: detail, onEdit: editBasic, onOpenLocation: { state.showLocation($0) }, onLinkLocation: linkLocation)
        if !detail.offer.seller { OfferActionsCard(store: store, detail: detail) }
        if let inquiry = detail.inquiry { OfferInquiryContextCard(inquiry: inquiry) }
        OfferSummaryCard(store: store, detail: detail)
    }

    /// Edycja treści jak `canEditCrmContent` w CRM (zarządzający, nie zaakceptowana, nie z portalu sprzedawcy) i połączenie.
    private func editable(_ detail: OfferDetail) -> Bool { detail.canEdit && state.canWrite }
}

// MARK: Karta sekcji

/// Karta sekcji strony oferty (tytuł, opcjonalny podpis i treść).
struct OfferCard<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var symbol: String? = nil
    /// Czynność w nagłówku karty (np. „Edytuj”).
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    if let symbol { Label(title, systemImage: symbol).font(.headline) } else { Text(title).font(.headline) }
                    if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if let trailing { trailing.controlSize(.small) }
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
    var onEdit: (() -> Void)? = nil
    /// Okładka bez „Tła ofert”: otwarcie lokalizacji miejsca i powiązanie wpisanego miejsca z lokalizacją z bazy.
    var onOpenLocation: ((String) -> Void)? = nil
    var onLinkLocation: ((String) -> Void)? = nil
    @Environment(\.crmTheme) private var theme
    @State private var heroLarge = false

    var body: some View {
        let basic = detail.basic
        OfferCard(title: "Informacje podstawowe", trailing: onEdit.map { edit in AnyView(Button(action: edit) { Label("Edytuj", systemImage: "pencil") }) }) {
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
                    if let onEdit {
                        Button(basic.guestCount == nil ? "Uzupełnij liczbę osób" : "Zmień liczbę osób", action: onEdit)
                            .buttonStyle(.link).font(.caption)
                    }
                }
                OfferInfoField(symbol: "function", label: "Źródło wyceny") {
                    Text(basic.pricingSource).font(.callout.weight(.medium))
                    if let calculation = basic.calculation { Text(calculation).font(.caption).foregroundStyle(.secondary) }
                }
                OfferInfoField(symbol: "photo", label: "Grafika hero oferty") {
                    Text(basic.hero).font(.callout)
                    if let cover = basic.coverImage {
                        let note: String = basic.heroPath != nil ? basic.heroAlt ?? "Grafika hero oferty" : basic.hero
                        Button { heroLarge = true } label: {
                            ProductThumb(path: cover.path, url: cover.url).frame(width: 180, height: 100)
                        }
                        .buttonStyle(.plain)
                        .help(note)
                        .popover(isPresented: $heroLarge) { ProductLargeImage(path: cover.path, url: cover.url).frame(width: 640, height: 400).padding(10) }
                    }
                    if let hint = basic.venueHint {
                        Text(hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        if let locationID = basic.venueLocationId, let onOpenLocation {
                            Button("Otwórz lokalizację") { onOpenLocation(locationID) }.buttonStyle(.link).font(.caption)
                        }
                        if let suggestion = basic.venueSuggestion, let onLinkLocation {
                            let title: String = "Powiąż z lokalizacją „\(suggestion.name)”"
                            Button(title) { onLinkLocation(suggestion.id) }.buttonStyle(.link).font(.caption)
                        }
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
                    if basic.totals.hasLineDiscounts {
                        Text(basic.totals.lineDiscountLabel).font(.caption).foregroundStyle(.green)
                    }
                    if basic.totals.discountAmount > 0 {
                        Text(basic.totals.offerDiscountLabel).font(.caption).foregroundStyle(.green)
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
    var onEdit: (() -> Void)? = nil
    @Environment(\.crmTheme) private var theme

    var body: some View {
        OfferCard(title: "Założenia wydarzenia", trailing: onEdit.map { edit in AnyView(Button(action: edit) { Label("Edytuj", systemImage: "pencil") }) }) {
            if let note = assumptions.guestNote { Text(note).font(.caption).foregroundStyle(.secondary) }
            if !assumptions.items.isEmpty {
                // Jak strona „Założenia” w PDF: trzy poziome bloki jeden pod drugim, z burgundowym znacznikiem.
                VStack(spacing: 10) {
                    ForEach(assumptions.items, id: \.self) { item in OfferAssumptionBlock(item: item) }
                }
            } else if !assumptions.legacy.isEmpty {
                Text(assumptions.legacy).font(.callout).textSelection(.enabled)
            }
            if !assumptions.goal.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("CEL WYDARZENIA").font(.caption.weight(.semibold)).foregroundStyle(theme.accent).tracking(0.6)
                    Text(assumptions.goal).font(.body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 4)
            }
            if assumptions.items.isEmpty && assumptions.legacy.isEmpty {
                Text("Brak zapisanych założeń.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }
}

/// Blok założenia jak w PDF: znacznik z wartością (albo numerem 01–03), tytuł wielkimi literami i opis.
struct OfferAssumptionBlock: View {
    let item: OfferDetail.Assumption
    @Environment(\.crmTheme) private var theme

    var body: some View {
        HStack(alignment: item.detail.isEmpty ? .center : .top, spacing: 16) {
            OfferAssumptionTile(value: item.badge)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.label.uppercased(with: Locale(identifier: "pl_PL")))
                    .font(.callout.weight(.bold)).foregroundStyle(theme.accent)
                if !item.detail.isEmpty {
                    Text(item.detail).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, item.detail.isEmpty ? 0 : 2)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.06)))
    }
}

/// Burgundowy znacznik z PDF (kwadrat z zaokrąglonymi rogami, biały napis, mniejsza czcionka dla dłuższych wartości).
struct OfferAssumptionTile: View {
    let value: String
    static let burgundy = Color(red: 0x6B / 255, green: 0x00 / 255, blue: 0x24 / 255)

    var body: some View {
        let text = value.uppercased(with: Locale(identifier: "pl_PL"))
        let size: CGFloat = text.count >= 6 ? 12 : text.count >= 4 ? 15 : 19
        Text(text)
            .font(.system(size: size, weight: .heavy))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, 4)
            .frame(width: 56, height: 56)
            .background(Self.burgundy, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.12)))
    }
}

// MARK: Pozycje oferty

/// Okno pozycji: dodawanie (`itemID == nil`) albo edycja.
struct OfferItemRoute: Identifiable {
    let itemID: String?
    var id: String { itemID ?? "new" }
}

@MainActor struct OfferItemsCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @State private var deleting: OfferDetail.Item?
    @State private var route: OfferItemRoute?
    @State private var dropTarget: String?

    private var canEdit: Bool { detail.canEdit && state.canWrite }

    var body: some View {
        let addButton: AnyView? = canEdit
            ? AnyView(Button { route = OfferItemRoute(itemID: nil) } label: { Label("Dodaj pozycję", systemImage: "plus") })
            : nil
        OfferCard(title: "Pozycje oferty",
                  subtitle: detail.items.isEmpty ? nil : canEdit ? "Kolejność zmienisz, przeciągając uchwyt, lub z menu pozycji" : "\(detail.items.count) poz. · kolejność jak w PDF",
                  trailing: addButton) {
            if detail.items.isEmpty {
                Text("Brak pozycji w ofercie").font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else {
                VStack(spacing: 10) {
                    ForEach(detail.items) { item in
                        let index = detail.items.firstIndex { $0.id == item.id } ?? 0
                        OfferItemRow(store: store, offerID: detail.offer.id, item: item, vatRate: detail.vatRate, canEdit: canEdit,
                                     first: index == 0, last: index == detail.items.count - 1,
                                     onMove: { step in move(index, step) }, onDelete: { deleting = item },
                                     onEdit: { route = OfferItemRoute(itemID: item.id) })
                            .offerDropTarget(id: item.id, enabled: canEdit, targeted: $dropTarget) { dragged in reorder(dragged, onto: item.id) }
                    }
                }
            }
        }
        .sheet(item: $route) { route in OfferItemSheet(store: store, offerID: detail.offer.id, itemID: route.itemID) }
        .confirmationDialog("Czy na pewno chcesz usunąć tę pozycję?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Usuń pozycję", role: .destructive) {
                if let item = deleting {
                    Task { await store.change(detail.offer.id, "itemDelete", ["itemId": .string(item.id)], pending: "Usuwanie pozycji…", success: "Pozycja usunięta") }
                }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("Tej operacji nie można cofnąć.")
        }
    }

    /// Upuszczenie przeciągniętej pozycji na innej (`reorder_offer_items` z kontrolą bieżącej kolejności).
    private func reorder(_ dragged: String, onto target: String) -> Bool {
        let expected = detail.items.map(\.id)
        guard canEdit, let next = OfferReorder.order(expected, moving: dragged, onto: target) else { return false }
        Task {
            await store.change(detail.offer.id, "itemsReorder",
                               ["itemIds": .array(next.map { JSONValue.string($0) }), "expectedIds": .array(expected.map { JSONValue.string($0) })],
                               success: "Kolejność pozycji zaktualizowana")
        }
        return true
    }

    /// Przesunięcie pozycji o jedno miejsce (`reorder_offer_items` z kontrolą bieżącej kolejności).
    private func move(_ index: Int, _ step: Int) {
        let target = index + step
        guard canEdit, detail.items.indices.contains(target) else { return }
        let expected = detail.items.map(\.id)
        var next = expected
        next.swapAt(index, target)
        Task {
            await store.change(detail.offer.id, "itemsReorder",
                               ["itemIds": .array(next.map { JSONValue.string($0) }), "expectedIds": .array(expected.map { JSONValue.string($0) })],
                               success: "Kolejność pozycji zaktualizowana")
        }
    }
}

@MainActor struct OfferItemRow: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let item: OfferDetail.Item
    let vatRate: Double
    var canEdit = false
    var first = true
    var last = true
    var onMove: (Int) -> Void = { _ in }
    var onDelete: () -> Void = {}
    var onEdit: () -> Void = {}
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var large = false

    private var layoutLabel: String { Self.layoutName(item.layout.print, stage: item.layout.stage) }
    static func layoutName(_ layout: String, stage: Bool) -> String {
        switch layout {
        case "compact": return "Kompaktowo · 3/str."
        case "visual": return "Duża grafika"
        default: return stage ? "Rozbudowany" : "Osobna strona"
        }
    }
    /// Pole „Pokaż warianty” wyłączone (zapisane `show_product_variants_in_pdf = false`).
    private var variantsHidden: Bool { !item.layout.showVariants && !item.layout.hasAddons }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if canEdit && !(first && last) {
                OfferDragHandle(id: item.id, label: item.name)
            }
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
                if canEdit { layoutControls } else { layoutSummary }
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
                if canEdit {
                    Menu {
                        menuItems
                    } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                        .padding(.bottom, 4)
                }
                if item.discountPercent > 0 {
                    Text("Rabat pozycji: \(OfferText.number(item.discountPercent))%").font(.caption2).foregroundStyle(.green)
                }
                Text("Wartość netto").font(.caption2).foregroundStyle(.secondary)
                Text(OfferText.pln(item.net)).font(.callout.weight(.semibold)).monospacedDigit()
                if item.discountAmount > 0 {
                    // Wartość netto przed rabatem pozycji.
                    Text(OfferText.pln(item.net + item.discountAmount)).font(.caption2).strikethrough().foregroundStyle(.secondary).monospacedDigit()
                }
                Text("brutto · VAT \(OfferText.number(vatRate))%").font(.caption2).foregroundStyle(.secondary)
                Text(OfferText.pln(item.gross)).font(.caption).monospacedDigit()
            }
            .frame(minWidth: 130, alignment: .trailing)
        }
        .padding(10)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.06)))
        .contextMenu { menuItems }
    }

    @ViewBuilder private var menuItems: some View {
        if let product = item.productId {
            Button("Otwórz produkt", systemImage: "shippingbox") { state.showProduct(product) }
            Button("Publiczna karta produktu", systemImage: "safari") { state.openCRM("/produkty/\(product)") }
        }
        if canEdit {
            Divider()
            Button("Edytuj pozycję…", systemImage: "pencil") { onEdit() }
            Button("Przesuń wyżej", systemImage: "arrow.up") { onMove(-1) }.disabled(first)
            Button("Przesuń niżej", systemImage: "arrow.down") { onMove(1) }.disabled(last)
            Divider()
            Button("Usuń pozycję…", systemImage: "trash", role: .destructive) { onDelete() }
        }
    }

    private var layoutSummary: some View {
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
    }

    /// Przyciski układu i pola wariantów jak w `OfferItems` (te same blokady).
    private var layoutControls: some View {
        let layout = item.layout
        let compactBlocked = !layout.stage && (layout.blockedByElements || layout.showsVariantComparison || layout.hasAddons || layout.hasPackages)
        let pageBlocked = layout.showsVariantComparison || layout.hasPackages
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Układ w PDF").font(.caption).foregroundStyle(.secondary)
                layoutButton("compact", blocked: compactBlocked)
                layoutButton("default", blocked: pageBlocked)
                if !layout.stage { layoutButton("visual", blocked: pageBlocked) }
            }
            if layout.hasProductVariants {
                HStack(spacing: 14) {
                    Button("Edytuj ceny wariantów") { onEdit() }
                        .buttonStyle(.link).font(.caption)
                    Toggle("Pokaż warianty", isOn: Binding(get: { layout.showVariants }, set: { next in
                        Task {
                            await store.change(offerID, "itemPresentation", ["itemId": .string(item.id), "showVariants": .bool(next)],
                                               success: next ? "PDF pokaże porównanie wszystkich wariantów" : "PDF potraktuje wybrany wariant jak zwykły produkt")
                        }
                    }))
                    .disabled(layout.hasAddons)
                    Toggle("Ceny wariantów", isOn: Binding(get: { layout.showVariantPrices }, set: { next in
                        Task {
                            await store.change(offerID, "itemPresentation", ["itemId": .string(item.id), "showVariantPrices": .bool(next)],
                                               success: next ? "Ceny wariantów pojawią się w PDF" : "Ceny wariantów zostały ukryte w PDF")
                        }
                    }))
                    .disabled(variantsHidden)
                }
                .toggleStyle(.checkbox).font(.caption)
            }
        }
        .controlSize(.small)
    }

    private func layoutButton(_ key: String, blocked: Bool) -> some View {
        let selected = item.layout.print == key
        return Button(Self.layoutName(key, stage: item.layout.stage)) {
            guard !selected else { return }
            Task {
                await store.change(offerID, "itemPresentation", ["itemId": .string(item.id), "layout": .string(key)],
                                   success: key == "compact" ? "Produkt zostanie wydrukowany kompaktowo"
                                       : key == "visual" ? "Produkt otrzyma stronę z dużą grafiką" : "Produkt otrzyma osobną stronę")
            }
        }
        .buttonStyle(.bordered)
        .tint(selected ? theme.accent : nil)
        .fontWeight(selected ? .semibold : .regular)
        .disabled(blocked)
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
    /// Język dokumentu (jak przełącznik PL / EN na stronie oferty w CRM).
    @State private var language = "pl"
    @State private var english: OfferEnglishState?
    @State private var englishBusy = false
    @State private var englishError: String?
    @State private var job: OfferPdfJob?
    @State private var deletingPdf = false
    @State private var emailOpen = false
    @State private var linkOpen = false
    @State private var reasonOpen = false
    @State private var eventRoute: OfferEventRoute?
    @State private var loadingEvent = false
    @State private var reserveOpen = false
    @State private var preview: OfferPdfPreview?

    /// Jak przycisk rezerwacji w `OfferActionsPanel`: oferta z wydarzeniem w statusie szkic / wysłana / zaakceptowana.
    private var canReserve: Bool { detail.canManage && detail.offer.eventId != nil && ["draft", "sent", "accepted"].contains(detail.offer.status) }
    private var reserveLabel: String {
        if detail.offer.status == "accepted" { return "Aktualizuj rezerwację" }
        return detail.amendmentSource != nil ? "Zatwierdź zmianę i rezerwację" : "Zarezerwuj sprzęt"
    }

    private var contentKey: String { "\(detail.offer.updatedAt ?? "")|\(detail.offer.contentRevision ?? 0)" }
    private var file: OfferDetail.PdfFile {
        language == "en"
            ? detail.pdf.en ?? OfferDetail.PdfFile(exists: false, stale: false, fileName: "")
            : OfferDetail.PdfFile(exists: detail.pdf.exists, stale: detail.pdf.stale, fileName: detail.pdf.fileName)
    }
    private var code: String { language.uppercased() }
    private var canGenerate: Bool { detail.canManage && state.canWrite && (language == "pl" || english?.ready == true) && !englishBusy }

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
                if detail.canManage { revisionActions }
                if let previous = detail.amendmentSource, detail.offer.status != "accepted" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Edytujesz zmianę oferty. Poprzednia rezerwacja pozostaje aktywna do zatwierdzenia tej wersji.").font(.caption)
                        Button("Poprzednia oferta") { state.showOffer(previous) }.buttonStyle(.link).font(.caption)
                    }
                    .padding(8)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }
                if detail.canManage && detail.offer.status == "accepted" && detail.offer.eventId == nil && detail.offer.inquiryId != nil {
                    Button { Task { await openEventCreation() } } label: {
                        Label(loadingEvent ? "Wczytywanie…" : "Utwórz wydarzenie", systemImage: "calendar.badge.plus").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(loadingEvent || !state.canWrite)
                }
                if detail.canManage && (detail.offer.eventId == nil || detail.offer.inquiryId == nil) {
                    Button { linkOpen = true } label: {
                        Label(detail.offer.eventId == nil ? "Powiąż z wydarzeniem lub zapytaniem" : "Powiąż z zapytaniem", systemImage: "link")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .disabled(!state.canWrite)
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
                documents
                if canReserve {
                    Button { reserveOpen = true } label: {
                        Label(reserveLabel, systemImage: "lock").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!state.canWrite)
                }
            }
            .controlSize(.small)
        }
        .sheet(isPresented: $emailOpen) { OfferEmailSheet(store: store, offerID: detail.offer.id) }
        .sheet(isPresented: $linkOpen) { OfferLinkSheet(store: store, detail: detail) }
        .sheet(isPresented: $reasonOpen) { OfferRevisionReasonSheet(store: store, offerID: detail.offer.id) }
        .sheet(isPresented: $reserveOpen) { OfferReservationSheet(store: store, offerID: detail.offer.id) }
        .sheet(item: $preview) { file in OfferPdfViewer(file: file) }
        .sheet(item: $eventRoute) { route in
            OfferEventSheet(store: store, offerID: detail.offer.id, setup: route.setup)
        }
        .sheet(item: $job) { job in
            OfferPdfGenerateSheet(store: store, offerID: detail.offer.id, job: job) {
                english = nil
                Task { await prepareEnglish() }
            }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć pliki PDF tej oferty?", isPresented: $deletingPdf, titleVisibility: .visible) {
            Button("Usuń PDF", role: .destructive) {
                Task { await store.change(detail.offer.id, "pdfDelete", [:], pending: "Usuwanie PDF…", success: "Pliki PDF zostały usunięte") }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Oferta zostanie zachowana, zostaną usunięte tylko wygenerowane pliki PDF.")
        }
        .onChange(of: contentKey) { _, _ in
            // Treść oferty zmieniła się — wersja EN wymaga ponownego sprawdzenia (jak klucz w `useOfferLanguage`).
            english = nil
            if language == "en" { Task { await prepareEnglish() } }
        }
    }

    // MARK: Dokument PDF

    @ViewBuilder private var documents: some View {
        HStack(spacing: 8) {
            Text("Język dokumentu").font(.caption).foregroundStyle(.secondary)
            Picker("Język dokumentu", selection: Binding(get: { language }, set: { next in
                language = next
                if next == "en" && english == nil && !englishBusy { Task { await prepareEnglish() } }
            })) {
                Text("PL").tag("pl")
                Text("EN").tag("en")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Text("· kwoty w PLN").font(.caption).foregroundStyle(.secondary)
        }
        if language == "en" { englishStatus }
        if file.exists {
            if file.stale {
                Text("Zapisany PDF nie zawiera ostatnich zmian oferty. Możesz go obejrzeć lub pobrać. Przed wysłaniem wygeneruj aktualną wersję.")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                if language == "pl", let note = detail.pdf.venueNote {
                    Text(note).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
            }
            actionButton("Pokaż PDF (\(code))", "eye") {
                Task { if let file = await store.pdfPreview(detail.offer.id, language: language) { preview = file } }
            }
            actionButton("Pobierz PDF (\(code))", "arrow.down.doc") { Task { await store.downloadPdf(detail.offer.id, language: language) } }
            if detail.canManage {
                actionButton("Regeneruj PDF (\(code))", "arrow.clockwise") { generate() }.disabled(!canGenerate)
            }
            // Wysyłka tylko aktualnego polskiego PDF (jak `!offer.modified_after_generation` w CRM).
            if language == "pl" && detail.canManage && !file.stale {
                Button { emailOpen = true } label: {
                    Label("Wyślij ofertę", systemImage: "paperplane").frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(!state.canWrite)
            }
        } else {
            Text("Oferta nie ma jeszcze wygenerowanego PDF (\(code)).").font(.caption).foregroundStyle(.secondary)
            if detail.canManage {
                actionButton("Generuj PDF (\(code))", "doc.richtext") { generate() }.disabled(!canGenerate)
            }
        }
        if language == "pl" && detail.pdf.exists && detail.canManage {
            Button(role: .destructive) { deletingPdf = true } label: {
                Label("Usuń PDF", systemImage: "xmark.bin").frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(!state.canWrite)
        }
    }

    @ViewBuilder private var englishStatus: some View {
        if englishBusy {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Przygotowujemy angielską treść oferty (do 3 minut)…").font(.caption).foregroundStyle(.secondary)
            }
        } else if let englishError {
            VStack(alignment: .leading, spacing: 4) {
                Text(englishError).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                Button("Spróbuj ponownie") { Task { await prepareEnglish() } }.buttonStyle(.link).font(.caption)
            }
        } else if english?.ready == true {
            Label("Angielska treść oferty gotowa", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.green)
        }
    }

    // MARK: Aktualizacja zaakceptowanej oferty (`OfferDraftRevisionActions`)

    @ViewBuilder private var revisionActions: some View {
        if detail.offer.status == "accepted" {
            Button {
                Task {
                    await store.change(detail.offer.id, "draftRevision", ["action": .string("reopen")], pending: "Otwieranie szkicu…",
                                       success: "Oferta jest szkicem. Edytuj ją zwykłymi przyciskami, a potem zapisz aktualizację z uzasadnieniem.")
                }
            } label: {
                Label("Aktualizuj zaakceptowaną ofertę", systemImage: "pencil.and.outline").frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(!state.canWrite)
        } else if detail.offer.status == "draft", let revision = detail.draftRevision {
            let needsReason = revision.savedRevision != detail.offer.contentRevision
            VStack(alignment: .leading, spacing: 6) {
                Text("Edytujesz szkic wcześniej zaakceptowanej oferty. Poprzednie rezerwacje pozostają do zatwierdzenia nowego zakresu. "
                     + (needsReason ? "Po zmianach zapisz aktualizację z uzasadnieniem." : "Uzasadnienie aktualizacji zapisane."))
                    .font(.caption).fixedSize(horizontal: false, vertical: true)
                Button("Zapisz aktualizację") { reasonOpen = true }
                    .buttonStyle(.borderedProminent)
                    .disabled(!needsReason || !state.canWrite)
            }
            .padding(8)
            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    /// „Utwórz wydarzenie”: istniejące wydarzenie zapytania otwiera się od razu, inaczej formularz (`ConvertInquiryModal`).
    private func openEventCreation() async {
        guard !loadingEvent else { return }
        loadingEvent = true
        defer { loadingEvent = false }
        do {
            let setup = try await store.eventSetup(detail.offer.id)
            if let eventId = setup.eventId { state.showEvent(eventId) } else { eventRoute = OfferEventRoute(setup: setup) }
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć formularza wydarzenia")
        }
    }

    private func actionButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: symbol).frame(maxWidth: .infinity, alignment: .leading) }
    }

    private func generate() {
        guard canGenerate else { return }
        job = OfferPdfJob(language: language, signature: language == "en" ? english?.signature : nil)
    }

    /// Angielska treść oferty: zapisana albo przetłumaczona teraz (jak `useOfferLanguage`).
    private func prepareEnglish() async {
        guard !englishBusy else { return }
        englishBusy = true
        englishError = nil
        defer { englishBusy = false }
        do {
            var reply = try await store.english(detail.offer.id, action: "read")
            if !reply.ready { reply = try await store.english(detail.offer.id, action: "generate") }
            english = reply
            if !reply.ready { englishError = "Angielska treść nie jest jeszcze gotowa. Spróbuj ponownie za chwilę." }
        } catch {
            englishError = store.failureText(error, "Nie udało się przygotować angielskiej treści oferty.")
        }
    }

    private func openSource(_ kind: String, _ id: String) {
        if kind == "event" { state.showEvent(id) } else { state.showInquiry(id) }
    }

    /// Jak `handleStatusChange`: akceptacja oferty z zapytania — w zapytaniu; z wydarzeniem — przez okno rezerwacji sprzętu.
    private func change(_ next: String) async {
        guard next != detail.offer.status else { return }
        if next == "accepted" {
            if let inquiry = detail.offer.inquiryId, detail.offer.eventId == nil {
                state.notice = "Użyj akceptacji wariantu w zapytaniu."
                state.showInquiry(inquiry)
            } else if detail.offer.eventId != nil {
                reserveOpen = true
            } else {
                state.notice = "Użyj akceptacji wariantu w zapytaniu lub przycisku rezerwacji sprzętu."
            }
            return
        }
        _ = await store.setStatus(detail.offer.id, next)
    }
}

/// Okno „Utwórz wydarzenie z zapytania” z danymi formularza.
struct OfferEventRoute: Identifiable {
    let setup: OfferEventSetup
    let id = UUID()
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

/// Podgląd rabatu jak `calculateOfferDiscount` (kwota, procent albo cena docelowa netto; `nil` — wartość spoza zakresu).
struct OfferDiscountPreview {
    var amount: Double
    var percent: Double
    var net: Double
    var tax: Double
    var gross: Double

    static func make(listNet: Double, taxPercent: Double, mode: String, input: String) -> OfferDiscountPreview? {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        let value = trimmed.isEmpty ? 0 : Double(trimmed.replacingOccurrences(of: ",", with: "."))
        guard let value, value.isFinite, value >= 0, listNet.isFinite, listNet >= 0,
              mode == "percent" ? value <= 100 : value <= listNet else { return nil }
        func round(_ number: Double) -> Double { ((number + .ulpOfOne) * 100).rounded() / 100 }
        let discount = round(mode == "percent" ? listNet * value / 100 : mode == "target" ? listNet - value : value)
        let net = round(listNet - discount)
        let tax = round(net * taxPercent / 100)
        return OfferDiscountPreview(amount: discount, percent: listNet > 0 ? discount / listNet * 100 : 0, net: net, tax: tax, gross: round(net + tax))
    }
}

@MainActor struct OfferSummaryCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @State private var editing = false
    @State private var mode = "amount"
    @State private var value = ""
    @State private var saving = false
    @State private var savingDisplay = false

    /// Rabat całej oferty: zarządzający, oferta wyceniana z pozycji (jak `canEditDiscount`).
    private var canEditDiscount: Bool { detail.canEdit && !detail.summary.calculation && state.canWrite }
    private var base: OfferDetail.Discount { detail.summary.discount }
    private var preview: OfferDiscountPreview? {
        OfferDiscountPreview.make(listNet: base.listNet, taxPercent: base.taxPercent, mode: mode, input: value)
    }

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
                if let note = detail.summary.discountNote { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            if canEditDiscount {
                if editing { discountEditor } else {
                    Button(base.amount > 0 ? "Edytuj rabat" : "Dodaj rabat") {
                        mode = "amount"
                        value = OfferText.plainAmount(base.amount)
                        editing = true
                    }
                    .controlSize(.small)
                }
            }
            if !detail.summary.calculation { discountDisplayPicker }
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
        .onChange(of: detail.offer.id) { _, _ in editing = false }
    }

    /// Edytor rabatu (`OfferDetails`): kwota netto, procent albo cena docelowa netto całej oferty.
    private var discountEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rabat").font(.callout.weight(.semibold))
            Text(base.baseHint)
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            discountField("amount", "Rabat netto (zł)", preview?.amount)
            discountField("percent", "Rabat (%)", preview?.percent)
            discountField("target", "Cena docelowa netto (zł)", preview?.net)
            if let preview {
                Text("Po rabacie: \(OfferText.money(preview.net)) netto · VAT: \(OfferText.money(preview.tax)) · \(OfferText.money(preview.gross)) brutto")
                    .font(.caption).monospacedDigit()
            } else {
                Text("Podaj kwotę od 0 do wartości oferty lub rabat od 0 do 100%.").font(.caption).foregroundStyle(.red)
            }
            HStack {
                Button("Usuń rabat") { mode = "amount"; value = "0" }.disabled(saving)
                Spacer()
                Button("Anuluj") { editing = false }.disabled(saving)
                Button(saving ? "Zapisuję…" : "Zapisz rabat") { Task { await save() } }
                    .buttonStyle(.borderedProminent).disabled(saving || preview == nil)
            }
        }
        .controlSize(.small)
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func discountField(_ key: String, _ label: String, _ current: Double?) -> some View {
        HStack {
            Text(label).font(.caption).frame(width: 170, alignment: .leading)
            TextField("", text: Binding(get: { mode == key ? value : OfferText.plainAmount(current ?? 0) },
                                        set: { mode = key; value = $0 }))
                .textFieldStyle(.roundedBorder).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 140)
        }
    }

    private func save() async {
        guard preview != nil else { return }
        saving = true
        defer { saving = false }
        if await store.change(detail.offer.id, "discountSave", ["mode": .string(mode), "value": .string(value)], success: "Rabat zapisany") {
            editing = false
        }
    }

    private func signed(_ value: Double) -> String { value < 0 ? "−" + OfferText.amount(-value) : OfferText.amount(value) }

    /// Jak klient widzi rabat w PDF (`OfferDetails` — „Rabat w PDF dla klienta”): przy pozycjach, rabat łączny, ceny po rabacie.
    private var discountDisplayPicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Rabat w PDF dla klienta", selection: Binding(get: { base.display ?? "lines" }, set: { value in Task { await saveDisplay(value) } })) {
                ForEach(OfferDetail.Discount.displays, id: \.key) { option in Text(option.label).tag(option.key) }
            }
            .pickerStyle(.menu)
            .controlSize(.small)
            .disabled(!canEditDiscount || savingDisplay)
            Text(base.displayHint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func saveDisplay(_ value: String) async {
        guard value != (base.display ?? "lines"), !savingDisplay else { return }
        savingDisplay = true
        defer { savingDisplay = false }
        _ = await store.change(detail.offer.id, "discountDisplaySave", ["display": .string(value)], success: "Zapisano — wygeneruj PDF ponownie, żeby klient zobaczył zmianę")
    }
}

// MARK: Rabaty pozycji i rabat na ofertę (teksty jak w CRM — `OfferBasicInfo`, `OfferDetails`)

extension OfferDetail.Totals {
    var hasLineDiscounts: Bool { (lineDiscountAmount ?? 0) > 0 }
    /// „Rabaty pozycji: −… netto”.
    var lineDiscountLabel: String { "Rabaty pozycji: −\(OfferText.pln(lineDiscountAmount ?? 0)) netto" }
    /// „Rabat 10.00%: −… netto” — z dopiskiem „na ofertę”, gdy oferta ma też rabaty pozycji.
    var offerDiscountLabel: String {
        let percent = String(format: "%.2f", discountPercent)
        let scope = hasLineDiscounts ? " na ofertę" : ""
        return "Rabat \(percent)%\(scope): −\(OfferText.pln(discountAmount)) netto"
    }
}

extension OfferDetail.Discount {
    /// Rabat w PDF dla klienta (`offers.discount_display`).
    static let displays: [(key: String, label: String, hint: String)] = [
        ("lines", "Przy pozycjach", "Klient widzi rabat każdej pozycji i rabat na ofertę."),
        ("total", "Rabat łączny", "Pozycje w cenach przed rabatem, pod tabelą jeden rabat łączny."),
        ("none", "Ceny po rabacie", "Klient widzi tylko ceny po rabacie — bez kwoty rabatu."),
    ]
    var displayHint: String { Self.displays.first { $0.key == (display ?? "lines") }?.hint ?? "" }

    /// Podpowiedź edytora rabatu: podstawa (wartość po rabatach pozycji, z logistyką).
    var baseHint: String {
        let logistics = logisticsNet > 0 ? " — pozycje oferty wraz z logistyką" : ""
        let lines = lineDiscountNet ?? 0
        let afterLines = lines > 0 ? ", po rabatach pozycji (−\(OfferText.money(lines)))" : ""
        return "Podstawa rabatu: \(OfferText.money(listNet)) netto\(logistics)\(afterLines). Ustaw rabat kwotowy, procentowy albo docelową cenę całej oferty."
    }
}
