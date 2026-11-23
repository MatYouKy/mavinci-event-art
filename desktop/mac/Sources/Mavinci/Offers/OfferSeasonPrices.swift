import SwiftUI

// MARK: Cennik sezonowy oferty (`OfferSeasonPricePanel` w CRM, `src/lib/CRM/Offers/seasonPrices.ts`)
//
// Cena zależy od roku eventu: marka realizująca ma cenniki na sezony, a katalog kreatora i okna pozycji mają ceny z cennika
// marki eventu na sezon daty eventu (serwer podstawia je w katalogu). Pasek „Cennik: Wesela 2027” mówi, skąd są ceny;
// na stronie oferty dochodzi gwarancja ceny i „Przelicz według cennika…”: najpierw podgląd różnic (op=priceListPreview,
// nic nie zmienia), potem świadome zastosowanie (op=priceListApply) — zmienia się tylko cena bazowa pozycji z cennika,
// dodatki, ilości i rabaty zostają, a oferta zapamiętuje cennik.

/// Opis cennika z serwera (ten sam tekst co w CRM); `priceListId` — cennik, z którym „Przelicz” porówna ceny.
struct OfferPriceNotice: Codable, Hashable {
    var tone: String
    var title: String
    var detail: String
    var canReprice: Bool
    var priceListId: String?
}

/// Podgląd „Przelicz według cennika” — pozycje do zmiany, zgodne i pominięte.
struct OfferPriceListPreview: Decodable {
    struct PriceList: Decodable {
        var id: String
        var name: String
        var company: String?
        var season: String
    }
    struct Change: Decodable, Identifiable {
        var itemId: String
        var name: String
        var quantity: Double
        var days: Double
        var oldPrice: Double
        var newPrice: Double
        var oldSubtotal: Double
        var newSubtotal: Double
        var id: String { itemId }
    }
    struct Skipped: Decodable, Identifiable {
        var itemId: String
        var name: String
        var reason: String
        var id: String { itemId }
    }
    var priceList: PriceList?
    var changes: [Change]
    var unchanged: Int
    var skipped: [Skipped]
    var deltaNet: Double
    var linked: Bool
}

extension OffersStore {
    /// „Przelicz według cennika…” — różnice cen pozycji i cennika (nic nie zmienia).
    func priceListPreview(_ id: String, priceListID: String?) async throws -> OfferPriceListPreview {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = ["op": .string("priceListPreview"), "id": .string(id)]
        if let priceListID { body["priceListId"] = .string(priceListID) }
        return try JSONDecoder().decode(OfferPriceListPreview.self, from: try await api.post("/offers", body))
    }
}

/// Pasek „Cennik: …” (kreator, okno pozycji, strona oferty) z opcjonalną czynnością po prawej.
struct OfferPriceNoticeBanner: View {
    let notice: OfferPriceNotice
    var action: AnyView? = nil
    @Environment(\.crmTheme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: warning ? "exclamationmark.triangle.fill" : "tag")
                .foregroundStyle(warning ? Color.orange : theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(notice.title).font(.callout.weight(.semibold))
                Text(notice.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let action { action.controlSize(.small) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(border))
    }

    private var warning: Bool { notice.tone == "warning" }
    private var background: Color {
        warning ? Color.orange.opacity(0.1) : notice.tone == "info" ? theme.accent.opacity(0.08) : Color.primary.opacity(0.03)
    }
    private var border: Color {
        warning ? Color.orange.opacity(0.35) : notice.tone == "info" ? theme.accent.opacity(0.3) : Color.primary.opacity(0.08)
    }
}

/// Cennik oferty nad pozycjami i „Przelicz według cennika…” dla edytujących.
@MainActor struct OfferSeasonPriceBar: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    let notice: OfferPriceNotice
    @EnvironmentObject private var state: Workspace
    @State private var open = false

    var body: some View {
        let canReprice = notice.canReprice && notice.priceListId != nil && detail.canEdit && state.canWrite
        OfferPriceNoticeBanner(notice: notice, action: canReprice ? AnyView(
            Button { open = true } label: { Label("Przelicz według cennika…", systemImage: "arrow.triangle.2.circlepath") }
        ) : nil)
        .sheet(isPresented: $open) { OfferPriceListSheet(store: store, offerID: detail.offer.id, priceListID: notice.priceListId) }
    }
}

/// Podgląd różnic i zastosowanie cennika (jak okno „Przelicz według cennika” w CRM).
@MainActor struct OfferPriceListSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let priceListID: String?
    @Environment(\.dismiss) private var dismiss
    @State private var preview: OfferPriceListPreview?
    @State private var problem: String?
    @State private var applying = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Przelicz według cennika").font(.title3.weight(.semibold))
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            if let preview {
                content(preview)
            } else if let problem {
                Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            } else {
                ProgressView("Porównuję ceny pozycji z cennikiem…").frame(maxWidth: .infinity).padding(.vertical, 24)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(applying)
                Button(applyTitle) { Task { await apply() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(!canApply || applying)
            }
        }
        .padding(20)
        .frame(width: 700)
        .task { await load() }
    }

    private var subtitle: String {
        guard let list = preview?.priceList else { return "Porównanie cen pozycji z cennikiem sezonu" }
        return [list.name, list.company, "sezon \(list.season)"].compactMap { $0 }.joined(separator: " · ")
    }
    private var canApply: Bool {
        guard let preview, preview.priceList != nil else { return false }
        return !preview.changes.isEmpty || !preview.linked
    }
    private var applyTitle: String {
        if applying { return "Zapisywanie…" }
        return preview?.changes.isEmpty == true ? "Powiąż z cennikiem" : "Zastosuj ceny z cennika"
    }

    @ViewBuilder private func content(_ preview: OfferPriceListPreview) -> some View {
        Text("Zmienią się tylko pozycje poniżej — cena bazowa z cennika (dodatki, ilości i rabaty zostają). Po zapisie oferta pamięta ten cennik, a PDF trzeba wygenerować ponownie.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if preview.changes.isEmpty {
            Text(preview.linked
                 ? "Ceny pozycji są już zgodne z cennikiem."
                 : "Ceny pozycji są już zgodne z cennikiem — zapis tylko powiąże ofertę z tym cennikiem (gwarancja ceny).")
                .font(.callout)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        } else {
            ScrollView {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        Text("Pozycja")
                        Text("Ilość").gridColumnAlignment(.trailing)
                        Text("Cena netto").gridColumnAlignment(.trailing)
                        Text("Wartość netto").gridColumnAlignment(.trailing)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    Divider().gridCellUnsizedAxes(.horizontal)
                    ForEach(preview.changes) { change in
                        GridRow {
                            Text(change.name).lineLimit(2)
                            Text(quantity(change)).monospacedDigit().foregroundStyle(.secondary)
                            pair(change.oldPrice, change.newPrice)
                            pair(change.oldSubtotal, change.newSubtotal)
                        }
                        .font(.callout)
                    }
                }
                .padding(.vertical, 4)
            }
            .frame(maxHeight: 320)
        }
        HStack(spacing: 18) {
            Text("Do zmiany: \(preview.changes.count)")
            Text("Zgodne z cennikiem: \(preview.unchanged)")
            if !preview.changes.isEmpty {
                Text("Różnica netto (przed rabatem oferty): \(preview.deltaNet > 0 ? "+" : preview.deltaNet < 0 ? "−" : "")\(OfferText.money(abs(preview.deltaNet)))")
            }
        }
        .font(.caption).foregroundStyle(.secondary)
        if !preview.skipped.isEmpty {
            DisclosureGroup("Bez zmian (\(preview.skipped.count)) — ceny ustalane inaczej") {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(preview.skipped) { row in Text("\(row.name) — \(row.reason.lowercased())") }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            }
            .font(.caption)
        }
        if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
    }

    private func quantity(_ change: OfferPriceListPreview.Change) -> String {
        let base = OfferText.number(change.quantity)
        return change.days > 1 ? "\(base) × \(OfferText.number(change.days)) dni" : base
    }

    private func pair(_ old: Double, _ new: Double) -> some View {
        HStack(spacing: 4) {
            Text(OfferText.money(old)).strikethrough().foregroundStyle(.secondary)
            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
            Text(OfferText.money(new))
        }
        .monospacedDigit()
    }

    private func load() async {
        do {
            preview = try await store.priceListPreview(offerID, priceListID: priceListID)
            problem = nil
        } catch {
            problem = store.failureText(error, "Nie udało się porównać cen z cennikiem.")
        }
    }

    private func apply() async {
        guard let list = preview?.priceList else { return }
        applying = true
        defer { applying = false }
        let count = preview?.changes.count ?? 0
        let success = count > 0
            ? "Zmieniono ceny pozycji (\(count)) według cennika „\(list.name)”."
            : "Oferta jest wyceniona według cennika „\(list.name)”."
        if await store.change(offerID, "priceListApply", ["priceListId": .string(list.id)],
                              pending: "Przeliczanie oferty według cennika…", success: success) {
            dismiss()
        } else if let message = store.workspace?.error {
            problem = message
        }
    }
}
