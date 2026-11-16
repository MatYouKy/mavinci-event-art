import SwiftUI

// MARK: Pakiety w pozycji oferty (`ProductPackagePicker` oraz edytory zasobów i kosztów w kreatorze CRM): cena, zakres i cena
// z liczby osób tylko w tej ofercie, a dla wybranego pakietu sprzęt i obsada (z rozliczeniem ról) oraz koszty realizacji
// z marżą. Okna sprzętu, obsady i kosztów są te same co w karcie produktu (`ProductPackagesViews.swift`). Serwer przenosi
// z Maca tylko te pola na zapisane pakiety pozycji (`optionsFor` w `src/lib/native/offerItems.ts`).

enum OfferPackageOptions {
    static func decode<T: Decodable>(_ value: JSONValue?, as type: T.Type) -> T? {
        guard let value, value != .null, let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func encode<T: Encodable>(_ value: T?) -> JSONValue {
        guard let value, let data = try? JSONEncoder().encode(value), let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return json
    }

    static func id(_ raw: JSONValue) -> String { raw.object["id"]?.text ?? "" }

    /// Pakiet w postaci okien karty produktu (nazwa, cena, cena z liczby osób, sprzęt i obsada, koszty).
    static func item(_ raw: JSONValue) -> ProductSalesPackageItem {
        let object = raw.object
        var item = ProductSalesPackageItem.blank()
        item.id = id(raw)
        item.name = object["name"]?.text ?? ""
        item.included_label = object["included_label"]?.text ?? ""
        if case .number(let price)? = object["price_net"] { item.price_net = price }
        if case .bool(let onRequest)? = object["price_on_request"] { item.price_on_request = onRequest }
        item.audience_pricing = decode(object["audience_pricing"], as: ProductAudiencePricing.self)
        item.resources = decode(object["resources"], as: ProductPackageResourcesItem.self)
        item.cost_items = decode(object["cost_items"], as: [ProductPackageCostItem].self)
        return item
    }

    /// Zapisane pole, którego Mac nie umie odczytać — wtedy nie pozwalamy go nadpisać.
    static func unreadable(_ raw: JSONValue, _ key: String, decoded: Bool) -> Bool {
        guard let value = raw.object[key], value != .null else { return false }
        return !decoded
    }

    static func set(_ options: [JSONValue], _ id: String, _ key: String, _ value: JSONValue) -> [JSONValue] {
        options.map { raw in
            guard Self.id(raw) == id else { return raw }
            var object = raw.object
            object[key] = value
            return .object(object)
        }
    }

    static func price(_ options: [JSONValue], _ id: String) -> Double? {
        guard let raw = options.first(where: { Self.id($0) == id }), case .number(let price)? = raw.object["price_net"] else { return nil }
        return price
    }
}

@MainActor struct OfferPackageOptionsEditor: View {
    @Binding var options: [JSONValue]
    let selectedID: String
    let productID: String?
    /// Cena sprzedaży jednego pakietu po rabacie pozycji (do marży).
    let salePriceNet: Double
    var catalogResources: [String: JSONValue] = [:]
    /// „Dostosuj ceny i zakres pakietów tylko w tej ofercie” (w kreatorze CRM tylko sprzęt, obsada i koszty).
    var adjustments = true
    var disabled = false
    /// Zmiana ceny wybranego pakietu — cena pozycji idzie za nią (jak `onChange` w `ProductPackagePicker`).
    var onSelectedPrice: ((Double) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var resourcesOpen = false
    @State private var costsOpen = false

    private var selectedRaw: JSONValue? { options.first { OfferPackageOptions.id($0) == selectedID } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let raw = selectedRaw { selected(raw) }
            if adjustments && !options.isEmpty {
                DisclosureGroup("Dostosuj ceny i zakres pakietów tylko w tej ofercie") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(options.indices, id: \.self) { index in adjustment(options[index]) }
                    }
                    .padding(.top, 6)
                }
                .font(.callout).tint(theme.accent)
            }
        }
        .disabled(disabled)
        .sheet(isPresented: $resourcesOpen) {
            if let raw = selectedRaw {
                let item = OfferPackageOptions.item(raw)
                ProductPackageResourcesSheet(store: state.products, productID: productID ?? "", packageName: item.name, initial: item.resources, readOnly: disabled) { resources in
                    options = OfferPackageOptions.set(options, selectedID, "resources", OfferPackageOptions.encode(resources))
                }
                .environment(\.crmTheme, theme)
                .task {
                    // Parametry CIT i dywidendy do rozliczenia gotówką — z ustawień wynagrodzeń (dane zasobów produktu).
                    if let productID, state.products.resources[productID] == nil { await state.products.loadResources(productID) }
                }
            }
        }
        .sheet(isPresented: $costsOpen) {
            if let raw = selectedRaw {
                ProductPackageCostsSheet(store: state.products, productID: productID ?? "", package: OfferPackageOptions.item(raw), readOnly: disabled) { rows in
                    options = OfferPackageOptions.set(options, selectedID, "cost_items", OfferPackageOptions.encode(rows))
                }
                .environment(\.crmTheme, theme)
                .task {
                    if let productID, state.products.resources[productID] == nil { await state.products.loadResources(productID) }
                }
            }
        }
    }

    // MARK: Wybrany pakiet — sprzęt, obsada, koszty

    private func selected(_ raw: JSONValue) -> some View {
        let item = OfferPackageOptions.item(raw)
        let resourcesUnreadable = OfferPackageOptions.unreadable(raw, "resources", decoded: item.resources != nil)
        let costsUnreadable = OfferPackageOptions.unreadable(raw, "cost_items", decoded: item.cost_items != nil)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Button { resourcesOpen = true } label: {
                    Label("Sprzęt i obsada: " + (item.resources.map { "\($0.equipment.count) poz. · \(ProductText.number($0.staff.reduce(0) { $0 + $1.quantity })) os." } ?? "nie określono"),
                          systemImage: "shippingbox")
                }
                .disabled(resourcesUnreadable)
                Button { costsOpen = true } label: {
                    Label("Koszty realizacji: " + (item.costNet.map { ProductText.money($0) + " netto" } ?? "uzupełnij"), systemImage: "banknote")
                }
                .disabled(costsUnreadable)
            }
            .controlSize(.small)
            if resourcesUnreadable || costsUnreadable {
                Text("Nie udało się odczytać sprzętu i obsady albo kosztów tego pakietu — zapisane dane zostają bez zmian.")
                    .font(.caption).foregroundStyle(.orange)
            }
            if item.resources == nil && !resourcesUnreadable {
                Text("Uzupełnij sprzęt i obsadę przed rezerwacją zasobów tego pakietu.").font(.caption).foregroundStyle(theme.accent)
                if let catalog = catalogResources[selectedID] {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Produkt ma już te dane. Możesz pobrać brakujące zasoby, sprawdzić je i zapisać pozycję. Stawki obsady wpłyną na wewnętrzny koszt realizacji.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Button("Pobierz sprzęt i obsadę z produktu") {
                            options = OfferPackageOptions.set(options, selectedID, "resources", catalog)
                        }
                        .controlSize(.small).buttonStyle(.borderedProminent)
                    }
                }
            }
            costSummary(item)
            Text("Koszty dotyczą wybranego pakietu tylko w tej ofercie. Marża uwzględnia rabat pozycji, przed rabatem całej oferty. Zmiany katalogu nie nadpiszą tej kalkulacji.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    private func costSummary(_ item: ProductSalesPackageItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let total = item.costNet {
                Text("Koszt spółki / 1 pakiet: \(ProductText.money(total)) netto").fontWeight(.medium)
                if item.unpricedStaff > 0 {
                    Text("Obsada bez określonej stawki: \(item.unpricedStaff). Kalkulacja kosztów jest niepełna.").foregroundStyle(.orange)
                } else {
                    let margin = ((salePriceNet - total) * 100).rounded() / 100
                    Text("Marża: \(ProductText.money(margin))" + (salePriceNet > 0 ? " (\(ProductText.number((margin / salePriceNet * 1000).rounded() / 10))%)" : ""))
                }
            } else {
                Text("Koszty: \(item.cost_items == nil ? "nieuzupełnione" : "uzupełnij pozycje kosztowe") · marża nieustalona").foregroundStyle(.secondary)
            }
        }
        .font(.caption)
    }

    // MARK: Ceny i zakres pakietów w tej ofercie

    private func adjustment(_ raw: JSONValue) -> some View {
        let item = OfferPackageOptions.item(raw)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "\(item.name) — netto") {
                    ProductNumberField(value: Binding(get: { item.price_net }, set: { setPrice(item.id, $0 ?? 0) }), suffix: "zł")
                        .frame(width: 140)
                        .disabled(item.audience_pricing != nil)
                }
                ProductField(label: "Zakres", help: "\(item.included_label.count)/95") {
                    TextField("", text: Binding(get: { item.included_label }, set: { value in
                        options = OfferPackageOptions.set(options, item.id, "included_label", .string(String(value.prefix(95))))
                    }))
                    .textFieldStyle(.roundedBorder)
                }
            }
            Toggle("Przeliczaj cenę z liczby osób i stołów", isOn: Binding(get: { item.audience_pricing != nil }, set: { on in
                setAudience(item.id, on ? ProductAudiencePricing(fixed_net: 0, per_guest_net: 0, per_table_net: 0, reference_guests: 150) : nil)
            }))
            .toggleStyle(.checkbox).font(.caption)
            if let pricing = item.audience_pricing {
                HStack(alignment: .top, spacing: 8) {
                    ProductField(label: "Część stała netto") { ProductNumberField(value: audienceValue(item.id, \.fixed_net, pricing)) }
                    ProductField(label: "Netto za osobę") { ProductNumberField(value: audienceValue(item.id, \.per_guest_net, pricing)) }
                    ProductField(label: "Netto za stół") { ProductNumberField(value: audienceValue(item.id, \.per_table_net, pricing)) }
                    ProductField(label: "Osoby do ceny w katalogu") { ProductNumberField(value: audienceValue(item.id, \.reference_guests, pricing)) }
                }
                Text("W ofercie obowiązuje zapisana liczba gości i ustawienie stołów. Cena = część stała + osoby × stawka + stoły × stawka.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func setPrice(_ id: String, _ price: Double) {
        options = OfferPackageOptions.set(options, id, "price_net", .number(price))
        if id == selectedID { onSelectedPrice?(price) }
    }

    private func audienceValue(_ id: String, _ key: WritableKeyPath<ProductAudiencePricing, Double>, _ pricing: ProductAudiencePricing) -> Binding<Double?> {
        Binding(get: { pricing[keyPath: key] }, set: { value in
            var next = pricing
            next[keyPath: key] = value ?? 0
            setAudience(id, next)
        })
    }

    /// Cena z liczby osób (`AudiencePricingEditor`): cena pakietu w katalogu liczona dla osób referencyjnych.
    private func setAudience(_ id: String, _ pricing: ProductAudiencePricing?) {
        options = OfferPackageOptions.set(options, id, "audience_pricing", OfferPackageOptions.encode(pricing))
        if let price = pricing?.referencePrice { setPrice(id, price) }
    }
}
