import SwiftUI

// MARK: Indywidualny cennik sprzedawcy 1:1 ze stroną CRM `/crm/salespeople/[id]/pricing`: marka (z aktywnymi warunkami),
// wyszukiwanie, produkty z miniaturą i kategorią, przy każdej pozycji (cena podstawowa / wariant) stawka wewnętrzna, cena
// automatyczna (+20%), cena wynikowa, cena indywidualna netto, „Dostępny”, przywrócenie ceny automatycznej i „Warunki”
// (nocleg, koszt logistyki — tylko CRM, warunek logistyczny i wymagania widoczne dla sprzedawcy); „Zapisz cennik” zapisuje całą
// markę. Pod produktem „Ceny konfiguracji i rozszerzeń dla tego sprzedawcy” (`SellerComponentPrices`). Serwer:
// `/bridge/native/v1/sellers` (`pricing`, `priceList`, `priceSave`, `componentPrices`, `componentSave` — `src/lib/native/sellerPricing.ts`).

struct SellerPricingHeader: Decodable {
    struct Brand: Decodable, Identifiable, Hashable { let id: String; let name: String }
    let id: String
    let sellerName: String
    let contactId: String?
    let brands: [Brand]
    let message: String?
}

struct SellerPriceItem: Decodable, Identifiable, Equatable {
    let productId: String
    let variantId: String?
    let productName: String
    let variantName: String?
    let imagePath: String?
    let imageUrl: String?
    let unit: String?
    let categoryName: String?
    let directPrice: Double
    let defaultPrice: Double
    var price: Double?
    var available: Bool
    var requiresAccommodation: Bool
    var accommodationNote: String
    var logisticsCost: Double?
    var logisticsNote: String
    var requirements: String
    var id: String { productId + ":" + (variantId ?? "base") }
}

struct SellerPriceListData: Decodable {
    let blocked: String?
    let defaultMarkup: Double
    let items: [SellerPriceItem]
}

struct SellerComponentRates: Decodable {
    struct Rate: Decodable, Identifiable, Equatable { let key: String; let label: String; var price: Double?; var id: String { key } }
    let name: String
    let revision: String
    let configurable: Bool
    let led: Bool
    var rates: [Rate]
    let message: String?
}

@MainActor final class SellerPricingModel: ObservableObject {
    struct Message: Equatable { let id = UUID(); let error: Bool; let text: String }
    struct Product: Identifiable {
        let id: String
        let name: String
        let category: String
        var imagePath: String?
        var imageUrl: String?
        var entries: [SellerPriceItem]
    }

    weak var store: SellersStore?
    var partnerID = ""
    @Published private(set) var header: SellerPricingHeader?
    @Published var headerError: String?
    @Published var brandID = ""
    @Published private(set) var items: [SellerPriceItem] = []
    @Published private(set) var defaultMarkup: Double = 20
    @Published private(set) var pricesLoading = false
    @Published private(set) var saving = false
    @Published private(set) var dirty = false
    @Published private(set) var blocked = false
    @Published var message: Message?
    @Published var search = ""
    @Published var expanded: Set<String> = []

    private var api: NativeAPI? { store?.api }
    private func text(_ error: Error, _ fallback: String) -> String { store?.failureText(error, fallback) ?? fallback }

    func load() async {
        guard let api else { headerError = "Brak połączenia z serwerem CRM."; return }
        do {
            let value = try JSONDecoder().decode(SellerPricingHeader.self, from: try await api.get("/sellers", query: ["op": "pricing", "id": partnerID]))
            header = value
            headerError = nil
            if brandID.isEmpty || !value.brands.contains(where: { $0.id == brandID }) { brandID = value.brands.first?.id ?? "" }
            if let text = value.message { message = Message(error: true, text: text) }
        } catch {
            headerError = text(error, "Nie znaleziono sprzedawcy.")
        }
    }

    /// Pozycje wybranej marki (po każdej zmianie marki, jak w CRM).
    func loadPrices() async {
        let brand = brandID
        guard !brand.isEmpty, let api else { items = []; dirty = false; return }
        pricesLoading = true
        message = nil
        defer { if brand == brandID { pricesLoading = false } }
        do {
            let raw = try await api.get("/sellers", query: ["op": "priceList", "id": partnerID, "brand": brand])
            guard brand == brandID, !Task.isCancelled else { return }
            let value = try JSONDecoder().decode(SellerPriceListData.self, from: raw)
            if let reason = value.blocked {
                items = []
                dirty = false
                blocked = true
                message = Message(error: true, text: reason)
                return
            }
            blocked = false
            defaultMarkup = value.defaultMarkup
            items = value.items
            dirty = false
        } catch {
            guard brand == brandID, !Task.isCancelled else { return }
            items = []
            message = Message(error: true, text: text(error, "Nie udało się pobrać cennika."))
        }
    }

    /// Produkty z pozycjami po filtrze wyszukiwania (produkt, wariant, kategoria) — kolejność jak w CRM.
    var products: [Product] {
        let locale = Locale(identifier: "pl_PL")
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: locale)
        var order: [String] = []
        var map: [String: Product] = [:]
        for item in items {
            let searchable = "\(item.productName) \(item.variantName ?? "") \(item.categoryName ?? "")".lowercased(with: locale)
            if !query.isEmpty && !searchable.contains(query) { continue }
            if var product = map[item.productId] {
                if product.imageUrl == nil, let url = item.imageUrl { product.imageUrl = url; product.imagePath = item.imagePath }
                product.entries.append(item)
                map[item.productId] = product
            } else {
                order.append(item.productId)
                map[item.productId] = Product(id: item.productId, name: item.productName, category: item.categoryName ?? "Bez kategorii",
                                              imagePath: item.imagePath, imageUrl: item.imageUrl, entries: [item])
            }
        }
        return order.compactMap { map[$0] }
    }

    func update(_ key: String, _ change: (inout SellerPriceItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == key }) else { return }
        var item = items[index]
        change(&item)
        guard item != items[index] else { return }
        items[index] = item
        dirty = true
        message = nil
    }

    /// Pole pozycji po kluczu — bezpieczne przy zmianie marki (lista może się zmienić pod polem tekstowym).
    func field<T>(_ key: String, _ path: WritableKeyPath<SellerPriceItem, T>, fallback: T) -> Binding<T> {
        Binding(get: { self.items.first(where: { $0.id == key })?[keyPath: path] ?? fallback },
                set: { value in self.update(key) { $0[keyPath: path] = value } })
    }

    func toggle(_ key: String) {
        if expanded.contains(key) { expanded.remove(key) } else { expanded.insert(key) }
    }

    /// „Zapisz cennik” — cała lista marki (`save_sales_partner_price_list`).
    func save(workspace: Workspace) async {
        guard !brandID.isEmpty, let api, workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        message = nil
        defer { saving = false }
        let payload: [JSONValue] = items.map { item -> JSONValue in
            .object([
                "productId": .string(item.productId),
                "variantId": item.variantId.map { JSONValue.string($0) } ?? .null,
                "price": item.price.map { JSONValue.number($0) } ?? .null,
                "available": .bool(item.available),
                "requiresAccommodation": .bool(item.requiresAccommodation),
                "accommodationNote": .string(item.accommodationNote),
                "logisticsCost": item.logisticsCost.map { JSONValue.number($0) } ?? .null,
                "logisticsNote": .string(item.logisticsNote),
                "requirements": .string(item.requirements),
            ])
        }
        do {
            _ = try await workspace.withPending("Zapisywanie cennika…") {
                try await api.post("/sellers", ["op": .string("priceSave"), "id": .string(partnerID), "brand": .string(brandID), "items": .array(payload)], timeout: 90)
            }
        } catch {
            let failure = text(error, "Nie udało się zapisać cennika.")
            message = Message(error: true, text: failure)
            workspace.error = failure
            return
        }
        dirty = false
        message = Message(error: false, text: "Indywidualny cennik został zapisany.")
        workspace.succeed("Indywidualny cennik został zapisany.")
    }
}

@MainActor struct SellerPricingSheet: View {
    @ObservedObject var store: SellersStore
    let partnerID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = SellerPricingModel()
    @State private var closeAsk = false
    @State private var pendingBrand: String?

    var body: some View {
        VStack(spacing: 0) {
            header.padding(16)
            Divider()
            if let header = model.header {
                controls(header).padding(.horizontal, 16).padding(.vertical, 10)
                Divider()
                content(header)
            } else if let error = model.headerError {
                ContentUnavailableView {
                    Label("Nie można wczytać cennika", systemImage: "tag.slash")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await model.load() } } }
            } else {
                ProgressView("Ładowanie cennika…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 1060, height: 800)
        .task {
            model.store = store
            model.partnerID = partnerID
            await model.load()
        }
        .task(id: model.brandID) { await model.loadPrices() }
    }

    private var markup: String { SellerPricingFormat.number(model.defaultMarkup) }

    // MARK: Nagłówek

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "Cennik: \(model.header?.sellerName ?? "Sprzedawca")").font(.title2.weight(.light))
                Text(verbatim: "Każda pozycja bez własnej ceny otrzymuje automatycznie stawkę MAVINCI powiększoną o \(markup)%. Sprzedawca widzi tylko cenę wynikową.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("Nowi sprzedawcy oraz nowe produkty i warianty startują bez dostępu. Zaznacz „Dostępny” i zapisz cennik, aby udostępnić wybraną pozycję dla tej marki. Sama zmiana ceny nie przyznaje dostępu.")
                    .font(.caption).foregroundStyle(theme.accent.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button { Task { await model.save(workspace: state) } } label: {
                HStack(spacing: 6) {
                    if model.saving { ProgressView().controlSize(.small) } else { Image(systemName: "checkmark") }
                    Text("Zapisz cennik")
                }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command)
            .disabled(!model.dirty || model.saving || model.brandID.isEmpty || !state.canWrite)
            Button("Zamknij") { if model.dirty { closeAsk = true } else { dismiss() } }.keyboardShortcut(.cancelAction)
        }
        .confirmationDialog("Zamknąć bez zapisu?", isPresented: $closeAsk) {
            Button("Odrzuć zmiany", role: .destructive) { dismiss() }
            Button("Wróć", role: .cancel) {}
        } message: {
            Text("Masz niezapisane zmiany w cenniku.")
        }
    }

    private func controls(_ header: SellerPricingHeader) -> some View {
        HStack(spacing: 14) {
            Picker("Marka", selection: brandSelection) {
                ForEach(header.brands) { brand in Text(brand.name).tag(brand.id) }
            }
            .frame(maxWidth: 340).disabled(header.brands.isEmpty || model.saving)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Szukaj produktu, wariantu lub kategorii...", text: $model.search).textFieldStyle(.roundedBorder)
            }
        }
        .confirmationDialog("Zmienić markę?", isPresented: Binding(get: { pendingBrand != nil }, set: { if !$0 { pendingBrand = nil } })) {
            Button("Odrzuć zmiany i zmień markę", role: .destructive) {
                if let brand = pendingBrand { model.brandID = brand }
                pendingBrand = nil
            }
            Button("Wróć", role: .cancel) { pendingBrand = nil }
        } message: {
            Text("Niezapisane zmiany cennika tej marki zostaną odrzucone.")
        }
    }

    /// Zmiana marki przy niezapisanych zmianach — najpierw pytanie (CRM odrzuca je bez pytania).
    private var brandSelection: Binding<String> {
        Binding(get: { model.brandID }, set: { value in
            guard value != model.brandID else { return }
            if model.dirty { pendingBrand = value } else { model.brandID = value }
        })
    }

    // MARK: Lista produktów

    @ViewBuilder private func content(_ header: SellerPricingHeader) -> some View {
        let products = model.products
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let message = model.message {
                    Label(message.text, systemImage: message.error ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.callout).foregroundStyle(message.error ? Color.red : Color.green)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background((message.error ? Color.red : Color.green).opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
                if header.brands.isEmpty {
                    Text("Najpierw przypisz sprzedawcy co najmniej jedną markę w kartotece sprzedawców.")
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }
                if model.pricesLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    ForEach(products) { product in productSection(product) }
                    if !model.brandID.isEmpty && products.isEmpty && !model.blocked {
                        Text("Nie znaleziono produktów.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 40)
                    }
                }
            }
            .padding(16)
        }
    }

    private func productSection(_ product: SellerPricingModel.Product) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ProductThumb(path: product.imagePath, url: product.imageUrl, corner: 8).frame(width: 64, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.name).font(.callout.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    Text(product.category).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.primary.opacity(0.03))
            ForEach(product.entries) { item in
                Divider()
                row(item)
            }
            SellerComponentPricesView(store: store, partnerID: partnerID, brandID: model.brandID, productID: product.id)
                .id("\(partnerID):\(model.brandID):\(product.id)")
                .padding(14)
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ item: SellerPriceItem) -> some View {
        let key = item.id
        let open = model.expanded.contains(key)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.variantName ?? "Cena podstawowa produktu").font(.callout)
                    Text(verbatim: "Stawka wewnętrzna: \(SellerPricingFormat.money(item.directPrice)) · automatyczna +\(markup)%: \(SellerPricingFormat.money(item.defaultPrice))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .frame(minWidth: 200, maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    Text("CENA WYNIKOWA").font(.caption2).foregroundStyle(.secondary)
                    Text(verbatim: SellerPricingFormat.money(item.price ?? item.defaultPrice)).foregroundStyle(theme.accent).monospacedDigit()
                }
                .frame(width: 140, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    Text("CENA INDYWIDUALNA NETTO").font(.caption2).foregroundStyle(.secondary)
                    TextField("", value: model.field(key, \.price, fallback: nil), format: SellerPricingFormat.amountStyle,
                              prompt: Text(verbatim: SellerPricingFormat.plain(item.defaultPrice)))
                        .textFieldStyle(.roundedBorder).frame(width: 160)
                }
                Toggle("Dostępny", isOn: model.field(key, \.available, fallback: false)).toggleStyle(.checkbox)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
                Button { model.update(key) { $0.price = nil } } label: { Image(systemName: "arrow.counterclockwise") }
                    .buttonStyle(.borderless).help("Przywróć cenę automatyczną")
                Button { model.toggle(key) } label: {
                    HStack(spacing: 4) {
                        Text("Warunki")
                        Image(systemName: open ? "chevron.up" : "chevron.down")
                    }
                }
                .controlSize(.small)
            }
            if open { conditions(item) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .opacity(item.available ? 1 : 0.55)
    }

    private func conditions(_ item: SellerPriceItem) -> some View {
        let key = item.id
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                Toggle(isOn: model.field(key, \.requiresAccommodation, fallback: false)) {
                    Label("Wymagany nocleg", systemImage: "bed.double")
                }
                .toggleStyle(.checkbox)
                .frame(maxWidth: .infinity, alignment: .leading)
                labeled("Notatka o noclegu") {
                    TextField("Np. 1 pokój jednoosobowy, 2 noce", text: model.field(key, \.accommodationNote, fallback: "")).textFieldStyle(.roundedBorder)
                }
            }
            HStack(alignment: .top, spacing: 14) {
                labeled("Szacowany koszt logistyki — tylko CRM", symbol: "truck.box") {
                    TextField("", value: model.field(key, \.logisticsCost, fallback: nil), format: SellerPricingFormat.amountStyle, prompt: Text(verbatim: "0,00"))
                        .textFieldStyle(.roundedBorder)
                }
                labeled("Warunek logistyczny widoczny dla sprzedawcy") {
                    TextField("Np. transport wyceniany po podaniu adresu", text: model.field(key, \.logisticsNote, fallback: "")).textFieldStyle(.roundedBorder)
                }
            }
            labeled("Dodatkowe wymagania widoczne dla sprzedawcy") {
                TextField("Np. dostęp do obiektu 3 godziny przed wydarzeniem", text: model.field(key, \.requirements, fallback: ""), axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder)
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func labeled<Content: View>(_ title: String, symbol: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol) }
                Text(verbatim: title)
            }
            .font(.caption).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// „Ceny konfiguracji i rozszerzeń dla tego sprzedawcy” (`SellerComponentPrices`) — wczytanie po rozwinięciu, zapis z wersją.
@MainActor private struct SellerComponentPricesView: View {
    let store: SellersStore
    let partnerID: String
    let brandID: String
    let productID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var open = false
    @State private var data: SellerComponentRates?
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Dotyczą produktu podstawowego. Puste pole oznacza „do wyceny”, 0 oznacza składnik wliczony w cenę. Stawki magazynowe nie są automatycznie udostępniane sprzedawcy. Dostępność produktu włącz i zapisz w cenniku powyżej.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let message { Text(message).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                if busy { Label("Zapisywanie / pobieranie stawek…", systemImage: "hourglass").font(.callout).foregroundStyle(.secondary) }
                if let data {
                    if data.led {
                        Text("Dla ekranu LED ustaw jedną pełną stawkę za m² i dzień, uwzględniającą konstrukcję, procesor oraz realizatora. Sprzedawca wybiera tylko wymiary. Brak stawki blokuje zatwierdzenie wyceny; cen magazynowych ani wcześniejszych cen samych kabinetów nie używamy jako ceny pakietu.")
                            .font(.callout).foregroundStyle(theme.accent).fixedSize(horizontal: false, vertical: true)
                            .padding(10).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    }
                    ForEach(data.rates) { rate in
                        HStack(spacing: 12) {
                            Text(rate.label).fixedSize(horizontal: false, vertical: true)
                            Spacer()
                            TextField("", value: price(rate.key), format: SellerPricingFormat.amountStyle, prompt: Text("Do wyceny"))
                                .textFieldStyle(.roundedBorder).frame(width: 150).disabled(busy)
                        }
                    }
                    if data.rates.isEmpty {
                        Text("Produkt nie ma konfiguratora ani rozszerzeń. Używa ceny podstawowej lub wariantu.").font(.callout).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 10) {
                    Button("Wczytaj aktualne stawki") { Task { await load() } }.disabled(busy)
                    if let data, !data.rates.isEmpty {
                        Button("Zapisz stawki konfiguracji") { Task { await save() } }.disabled(busy || !state.canWrite)
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Text("Ceny konfiguracji i rozszerzeń dla tego sprzedawcy").foregroundStyle(theme.accent)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .onChange(of: open) { _, value in
            if value && data == nil && !busy { Task { await load() } }
        }
    }

    private func price(_ key: String) -> Binding<Double?> {
        Binding(get: { data?.rates.first(where: { $0.key == key })?.price },
                set: { value in
                    guard let index = data?.rates.firstIndex(where: { $0.key == key }) else { return }
                    data?.rates[index].price = value
                })
    }

    private func load() async {
        guard let api = store.api else { message = "Brak połączenia z serwerem CRM."; return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            data = try JSONDecoder().decode(SellerComponentRates.self, from: try await api.get("/sellers", query: [
                "op": "componentPrices", "id": partnerID, "brand": brandID, "product": productID,
            ]))
        } catch {
            message = store.failureText(error, "Nie udało się odczytać stawek.")
        }
    }

    private func save() async {
        guard let data, let api = store.api, state.canWrite else { message = "Zapis wymaga połączenia z serwerem CRM."; return }
        busy = true
        message = nil
        defer { busy = false }
        let raw: Data
        do {
            raw = try await api.post("/sellers", [
                "op": .string("componentSave"), "id": .string(partnerID), "brand": .string(brandID), "product": .string(productID),
                "revision": .string(data.revision),
                "rates": .array(data.rates.map { rate -> JSONValue in .object(["key": .string(rate.key), "price": rate.price.map { JSONValue.number($0) } ?? .null]) }),
            ])
        } catch {
            message = store.failureText(error, "Nie udało się zapisać stawek.")
            return
        }
        if let fresh = try? JSONDecoder().decode(SellerComponentRates.self, from: raw) {
            self.data = fresh
            message = fresh.message
        } else {
            message = "Stawki zapisane. Zapisane konfiguracje wcześniejszych ofert nie zostały przeliczone."
        }
    }
}

/// Kwoty jak w CRM (`Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })`) i pola liczbowe z dwoma miejscami.
enum SellerPricingFormat {
    private static let locale = Locale(identifier: "pl_PL")
    static let amountStyle = FloatingPointFormatStyle<Double>(locale: Locale(identifier: "pl_PL")).precision(.fractionLength(0...2))
    static func money(_ value: Double) -> String {
        value.formatted(.currency(code: "PLN").precision(.fractionLength(2)).locale(locale))
    }
    static func plain(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(2)).locale(locale))
    }
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
    }
}
