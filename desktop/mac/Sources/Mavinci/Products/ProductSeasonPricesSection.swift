import SwiftUI

// MARK: Karta produktu → „Ceny w cennikach sezonowych” (jak `ProductSeasonPrices` w CRM)
//
// Cena bazowa i ceny wariantów produktu w cennikach marek (aktywne, szkice, archiwum) z serwera (`/price-lists?op=product`);
// zmiany cen — ekran Oferty → Cenniki. Bez migracji cenników sekcja się nie pokazuje.

struct ProductSeasonPricesData: Decodable {
    struct Variant: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var catalogPrice: Double
        var price: Double
    }
    struct PriceList: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var company: String
        var season: String
        var status: String
        var statusLabel: String
        var basePrice: Double?
        var variants: [Variant]
    }
    var available: Bool
    var canManage: Bool
    var catalogBase: Double?
    var lists: [PriceList]
}

@MainActor struct ProductSeasonPricesSection: View {
    let productID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: ProductSeasonPricesData?
    @State private var failed = false

    var body: some View {
        Group {
            if let data, data.available {
                card(data)
            } else if data == nil && !failed {
                card(nil)
            }
        }
        .task(id: productID) { await load() }
    }

    private func card(_ data: ProductSeasonPricesData?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("Ceny w cennikach sezonowych", systemImage: "tag").font(.headline)
                Spacer()
                Button { state.openHref("/crm/offers?tab=pricelists") } label: { Label("Cenniki", systemImage: "arrow.up.forward.square") }
                    .controlSize(.small)
            }
            if let data {
                if data.lists.isEmpty {
                    Text("Produkt nie ma cen w cennikach sezonowych — oferty biorą cenę z katalogu.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Aktywny cennik marki podpowiada cenę w ofertach eventów z datą w swoim sezonie.\(data.catalogBase.map { " Cena z katalogu: \(OfferText.money($0)) netto." } ?? "")")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(data.lists) { list in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(list.name).font(.callout.weight(.medium))
                                Spacer()
                                Text(list.statusLabel).font(.caption2)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background((list.status == "active" ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
                            }
                            Text("\(list.company) · sezon \(list.season)").font(.caption).foregroundStyle(.secondary)
                            if let base = list.basePrice { row("Cena bazowa", OfferText.money(base)) }
                            ForEach(list.variants) { variant in
                                row(variant.name, "\(OfferText.money(variant.price)) (katalog \(OfferText.money(variant.catalogPrice)))")
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.callout)
    }

    private func load() async {
        guard let api = state.nativeAPI() else { failed = true; return }
        do {
            data = try JSONDecoder().decode(ProductSeasonPricesData.self, from: try await api.get("/price-lists?op=product&id=\(productID)"))
            failed = false
        } catch {
            // Starszy serwer albo brak dostępu — sekcja się nie pokazuje (karta produktu działa jak dotąd).
            failed = true
        }
    }
}
