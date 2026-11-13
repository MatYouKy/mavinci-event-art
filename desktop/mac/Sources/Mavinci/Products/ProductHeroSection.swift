import SwiftUI

// MARK: Góra karty produktu — zdjęcie główne do oferty (w kadrze jak w PDF; kliknięcie powiększa całe zdjęcie,
// „Edytuj grafikę” otwiera zdjęcie, opis i kadr) obok najważniejszych danych: nazwa, status, kategoria, lead, ceny,
// marża, jednostka, VAT, czas usługi i tagi.

@MainActor struct ProductHeroSection: View {
    @ObservedObject var store: ProductsStore
    let detail: ProductDetail
    let editing: Bool
    let editImage: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var zoomed = false

    init(store: ProductsStore, detail: ProductDetail, editing: Bool, editImage: @escaping () -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.detail = detail
        self.editing = editing
        self.editImage = editImage
    }

    private var product: [String: JSONValue] { detail.product }
    private var path: String { ProductValue.text(product, "offer_image_path") }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 18) {
                picture.frame(width: 400)
                facts.frame(minWidth: 320, maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 14) {
                picture.frame(maxWidth: 480)
                facts
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }

    // MARK: Zdjęcie
    private var picture: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { if !path.isEmpty { zoomed = true } } label: {
                ProductStoredImage(path: path, url: detail.imageUrl,
                                   x: ProductValue.number(product, "offer_image_position_x") ?? 50,
                                   y: ProductValue.number(product, "offer_image_position_y") ?? 25,
                                   zoom: ProductValue.number(product, "offer_image_zoom") ?? 1)
                    .overlay(alignment: .bottomTrailing) {
                        if !path.isEmpty {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption.weight(.semibold)).padding(6)
                                .background(Color.black.opacity(0.45), in: Circle()).foregroundStyle(.white).padding(8)
                        }
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(path.isEmpty ? "Produkt nie ma jeszcze zdjęcia do oferty" : "Kliknij, aby zobaczyć całe zdjęcie")
            .popover(isPresented: $zoomed, arrowEdge: .trailing) {
                ProductLargeImage(path: path, url: detail.imageUrl).frame(width: 760, height: 570).padding(10)
            }
            HStack(spacing: 8) {
                if detail.canEdit {
                    Button(action: editImage) { Label(path.isEmpty ? "Dodaj zdjęcie" : "Edytuj grafikę", systemImage: "photo") }
                        .disabled(editing || !state.canWrite)
                }
                Spacer()
                if !path.isEmpty {
                    Text(frameText).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .controlSize(.small)
            let alt = ProductValue.text(product, "offer_image_alt")
            if !alt.isEmpty {
                Text(alt).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            } else if path.isEmpty {
                Text("Zdjęcie trafia do oferty PDF i na kartę produktu.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var frameText: String {
        let x = Int((ProductValue.number(product, "offer_image_position_x") ?? 50).rounded())
        let y = Int((ProductValue.number(product, "offer_image_position_y") ?? 25).rounded())
        let zoom = Int(((ProductValue.number(product, "offer_image_zoom") ?? 1) * 100).rounded())
        return "Kadr: \(x)% · \(y)% · \(zoom)%"
    }

    // MARK: Dane
    private var facts: some View {
        let item = store.product(detail.id)
        let lead = ProductValue.text(product, "offer_short_description")
        let description = ProductValue.text(product, "description")
        let tags = ProductValue.list(product, "tags")
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(detail.name.isEmpty ? "Produkt bez nazwy" : detail.name).font(.title2.bold()).textSelection(.enabled)
                Text(detail.active ? "Aktywny" : "Nieaktywny").font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background((detail.active ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
                    .foregroundStyle(detail.active ? Color.green : Color.secondary)
            }
            Text(detail.categoryName ?? "Bez kategorii").font(.callout).foregroundStyle(.secondary)
            if !lead.isEmpty {
                Text(lead).font(.body.italic()).textSelection(.enabled)
            }
            if !description.isEmpty {
                Text(description).font(.callout).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled)
            }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 6) {
                if detail.packagePricing {
                    ProductFactRow(label: "Cena", value: "w pakietach (\(detail.facts.packages))")
                } else {
                    let net = item?.priceNet ?? ProductValue.number(product, "price_net") ?? 0
                    let gross = item?.priceGross ?? ProductValue.number(product, "price_gross") ?? 0
                    let from = item?.fromVariant == true ? "od " : ""
                    ProductFactRow(label: "Cena netto", value: from + ProductText.money(net))
                    ProductFactRow(label: "Cena brutto", value: from + ProductText.money(gross))
                    GridRow {
                        Text("Marża").foregroundStyle(.secondary)
                        ProductMarginText(margin: item?.margin).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                ProductFactRow(label: "Jednostka", value: unitText)
                ProductFactRow(label: "VAT", value: "\(ProductText.number(ProductValue.number(product, "vat_rate") ?? 23))%")
                if let hours = ProductValue.number(product, "service_duration_hours") {
                    ProductFactRow(label: "Czas usługi", value: "\(ProductText.number(hours)) godz.")
                }
                if detail.facts.variants > 0 {
                    ProductFactRow(label: "Warianty", value: "\(detail.facts.variants)")
                }
                if ProductValue.flag(product, "is_subcontractor_service") {
                    ProductFactRow(label: "Realizacja", value: "Podwykonawca")
                } else if ProductValue.flag(product, "is_personnel_service") {
                    ProductFactRow(label: "Rodzaj", value: "Usługa personelu — bez sprzętu")
                }
            }
            .font(.callout)
            if !tags.isEmpty { ProductTagFlow(tags: tags) }
        }
    }

    private var unitText: String {
        let unit = ProductValue.text(product, "unit")
        let minimum = ProductValue.number(product, "min_quantity") ?? 1
        let name = unit.isEmpty ? "szt." : unit
        return minimum > 1 ? "\(name), min. \(ProductText.number(minimum))" : name
    }
}
