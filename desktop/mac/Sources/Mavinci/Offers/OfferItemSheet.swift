import SwiftUI

// MARK: „Dodaj pozycję do oferty” i „Edytuj pozycję” (`AddOfferItemModal`, `EditOfferItemModal`): katalog produktów
// (bez już dodanych), pakiet albo wycena elementów, wariant, ceny wariantów w tej ofercie, ilość (ręcznie, z liczby osób
// lub stołów), dni, cena, rabat, dodatki, widoczność wariantów w PDF, stawka VAT i uczestnicy oferty. Wycenę podglądu
// liczy serwer tymi samymi funkcjami co CRM. Produkty z konfiguratorem (scena, LED): panel konfiguratora (`ModularConfigurator`),
// cena z kalkulatora albo własna, a w edycji także „Przejdź na konfigurator” dla wcześniejszej wyceny. Z `onRecommendation` okno
// działa jak „Dodaj proponowany produkt” (`onAddRecommendation`): katalog bez produktów oferty i propozycji, rabat wliczony
// w cenę, a gotowa propozycja od razu zapisuje się w sekcji propozycji.

@MainActor struct OfferItemSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    /// `nil` — dodawanie pozycji; identyfikator — edycja.
    let itemID: String?
    /// Propozycje dodatkowe: produkty już na liście w tej edycji (ukryte w katalogu).
    var recommendationExclude: [String] = []
    /// Dodanie i zapis propozycji w sekcji propozycji; zwraca komunikat błędu albo `nil`.
    var onRecommendation: ((OfferRecommendationView) async -> String?)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    @State private var catalog: OfferItemCatalog?
    @State private var editor: OfferItemEditorData?
    @State private var loadError: String?
    @State private var search = ""
    @State private var productID: String?
    @State private var draft: OfferItemDraft?
    @State private var preview: OfferItemPreview?
    @State private var previewError: String?
    @State private var audience = OfferAudience()
    @State private var guests = ""
    @State private var perTable = "10"
    @State private var tables = ""
    @State private var audienceBusy = false
    @State private var audienceProblem: String?
    @State private var saving = false
    @State private var problem: String?
    @State private var confirmMove = false
    /// Konfigurator zestawu (scena, LED) dla wybranego produktu albo edytowanej pozycji.
    @State private var configurator: ModularConfiguratorModel?

    private var editing: Bool { itemID != nil }
    private var proposalMode: Bool { onRecommendation != nil }
    private var product: OfferCatalogProduct? { productID.flatMap { id in catalog?.products.first { $0.id == id } } }

    // Dane wyboru wspólne dla dodawania i edycji.
    private var variants: [OfferItemVariant] { editor?.variants ?? product?.variants ?? [] }
    private var packages: [OfferItemPackage] { editor?.packages ?? product?.packages ?? [] }
    private var productAddons: [ProductAddonItem] { editor?.productAddons ?? product?.productAddons ?? [] }
    private var productName: String { editor?.productName ?? product?.name ?? "" }
    private var allowIndividual: Bool { editor?.allowIndividual ?? !(product?.variants.isEmpty ?? true) }
    /// Pozycja z konfiguratorem: zapisana konfiguracja, produkt modułowy z katalogu albo przejście na konfigurator.
    /// Pakiety pozycji z poprawkami z tej oferty (bez poprawek — zapisane w pozycji, propozycji albo produkcie).
    private var baseOptions: [JSONValue] { editor?.packageOptions ?? product?.packageOptions ?? [] }
    private var packageOptions: Binding<[JSONValue]> {
        Binding(get: { draft?.packageOptions ?? baseOptions }, set: { draft?.packageOptions = $0 })
    }
    private var modular: Bool { configurator != nil || draft?.modular != nil || (editing ? editor?.modular == true : product?.modular == true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(editing ? "Edytuj pozycję" : proposalMode ? "Dodaj proponowany produkt" : "Dodaj pozycję do oferty").font(.title3.weight(.semibold))
                    if editing, let name = draft?.name { Text(name).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(height: 400)
            } else if catalog == nil && editor == nil {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity).frame(height: 400)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    if !editing {
                        productList.frame(width: 320)
                        Divider()
                    }
                    ScrollView { details.padding(16) }
                        .frame(maxWidth: .infinity)
                }
                .frame(height: 620)
            }

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : editing ? "Zapisz zmiany" : proposalMode ? "Dodaj propozycję" : "Dodaj pozycję") {
                    if proposalMode { Task { await addRecommendation() } }
                    else if !editing, product?.proposal != nil { confirmMove = true }
                    else { Task { await save(move: false) } }
                }
                .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                .disabled(saving || draft == nil || (modular && draft?.modular == nil) || preview?.error != nil || (!modular && audienceDirty))
            }
            .padding(18)
        }
        .frame(width: editing ? 760 : 1060)
        .background(theme.page)
        .task { await load() }
        .task(id: previewKey) {
            guard draft != nil else { return }
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            await refreshPreview()
        }
        .confirmationDialog("Przenieść produkt do oferty?", isPresented: $confirmMove, titleVisibility: .visible) {
            Button("Przenieś") { Task { await save(move: true) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("„\(product?.name ?? "")” jest już w sekcji „Zobacz, co warto dobrać do takiego wydarzenia”. Przenieść go do głównej listy? Zniknie z propozycji i będzie uwzględniony w wycenie.")
        }
    }

    // MARK: Katalog (dodawanie)
    private var productList: some View {
        let needle = SearchText.fold(search)
        let rows = (catalog?.products ?? []).filter { needle.isEmpty || SearchText.fold($0.name + " " + $0.description).contains(needle) }
        return VStack(alignment: .leading, spacing: 8) {
            TextField("", text: $search, prompt: Text("Nazwa produktu...")).textFieldStyle(.roundedBorder)
            List(rows, selection: Binding(get: { productID }, set: { choose($0) })) { item in
                HStack(spacing: 8) {
                    ProductThumb(path: item.imagePath, url: item.imageUrl).frame(width: 48, height: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).lineLimit(1)
                        HStack(spacing: 4) {
                            if let category = item.category { Text(category) }
                            Text("· \(item.priceText)")
                        }
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        if item.proposal != nil {
                            Text("W propozycjach dodatkowych").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent)
                        }
                    }
                }
            }
            .listStyle(.bordered(alternatesRowBackgrounds: true))
            if rows.isEmpty {
                Text(proposalMode ? "Brak pasujących propozycji. Produkty obecne w głównej ofercie są ukryte." : "Brak produktów do dodania")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
    }

    private func choose(_ id: String?) {
        productID = id
        problem = nil
        preview = nil
        configurator = nil
        guard let id, let item = catalog?.products.first(where: { $0.id == id }) else { draft = nil; return }
        draft = item.initial
        // Produkt modułowy: zapisana konfiguracja z propozycji albo nowa z karty produktu (z pobranym sprzętem).
        if item.modular { startConfigurator(snapshot: item.initial.modular, productID: id) }
    }

    // MARK: Konfigurator zestawu
    private func startConfigurator(snapshot: JSONValue?, productID: String?) {
        let next: ModularConfiguratorModel
        if let snapshot { next = ModularConfiguratorModel(store: store, snapshot: snapshot) }
        else if let productID { next = ModularConfiguratorModel(store: store, productID: productID) }
        else { return }
        next.quantity = draft?.quantity ?? 1
        next.onChange = { snapshot, view in applyConfiguration(snapshot, view) }
        configurator = next
    }

    /// Zmiana konfiguracji (jak `onChange` konfiguratora w oknach CRM): nazwa z konfiguracji, cena z kalkulatora bez własnej
    /// ceny; pierwsza konfiguracja czyści pakiet, wariant i dodatki (przejście na konfigurator — ilość 1).
    private func applyConfiguration(_ snapshot: JSONValue, _ view: ModularView) {
        guard var next = draft else { return }
        if next.modular == nil {
            next.packageId = ""
            next.variantId = nil
            next.variantPrices = [:]
            next.addons = []
            next.quantitySource = "manual"
            next.showVariants = false
            next.showVariantPrices = false
            if next.modularManual == nil { next.modularManual = false }
            if editing { next.quantity = 1 }
        }
        next.modular = snapshot
        next.modularRevision += 1
        if editing { next.name = view.title }
        if next.modularManual != true { next.unitPrice = view.calculatorTotal ?? 0 }
        draft = next
    }

    private func useCalculatorPrice() {
        draft?.modularManual = false
        if let total = configurator?.view?.calculatorTotal { draft?.unitPrice = total }
    }

    @ViewBuilder private var modularDetails: some View {
        VStack(alignment: .leading, spacing: 14) {
            if editing { nameField }
            if let configurator {
                ModularConfiguratorPanel(model: configurator, disabled: saving)
                ModularPriceHint(calculatorTotal: configurator.view?.calculatorTotal, manual: draft?.modularManual == true, disabled: saving) {
                    useCalculatorPrice()
                }
            }
            GroupBox("Szczegóły pozycji") {
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Liczba dni") {
                        ProductNumberField(value: Binding(get: { draft?.days ?? 1 }, set: { draft?.days = $0 ?? 0 })).frame(width: 100)
                    }
                    ProductField(label: "Ilość") {
                        ProductNumberField(value: Binding(get: { draft?.quantity ?? 1 }, set: { value in
                            draft?.quantity = value ?? 0
                            configurator?.quantity = value ?? 1
                        })).frame(width: 100)
                    }
                    ProductField(label: "Cena bazowa netto / dzień") {
                        ProductNumberField(value: Binding(get: {
                            draft?.modularManual == true ? (draft?.unitPrice ?? 0) : (preview?.unitPrice ?? draft?.unitPrice ?? 0)
                        }, set: { price in
                            draft?.modularManual = true
                            draft?.unitPrice = price ?? 0
                        }), suffix: "zł")
                        .frame(width: 150)
                    }
                    ProductField(label: editing ? "Rabat %" : "Rabat (%)") {
                        ProductNumberField(value: Binding(get: { draft?.discountPercent ?? 0 }, set: { draft?.discountPercent = $0 ?? 0 }), suffix: "%").frame(width: 100)
                    }
                    if editing {
                        ProductField(label: "Stawka VAT") {
                            Picker("", selection: Binding(get: { draft?.vatRate ?? 23 }, set: { draft?.vatRate = $0 })) {
                                ForEach([0.0, 5, 8, 23], id: \.self) { rate in Text("\(Int(rate))%").tag(rate) }
                            }
                            .labelsHidden().fixedSize()
                        }
                    }
                }
                .padding(6)
            }
            summary
        }
        .disabled(saving)
    }

    // MARK: Szczegóły pozycji
    @ViewBuilder private var details: some View {
        if !editing && product == nil {
            ContentUnavailableView("Wybierz produkt z listy", systemImage: "shippingbox").frame(maxWidth: .infinity).padding(.top, 120)
        } else if modular, draft != nil {
            modularDetails
        } else if draft != nil {
            VStack(alignment: .leading, spacing: 14) {
                if editing { nameField }
                if editing, editor?.canUseConfigurator == true {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Ta pozycja zachowuje wcześniejszą wycenę. Możesz świadomie zastąpić ją konfiguracją według obecnego cennika produktu.")
                            .font(.callout).fixedSize(horizontal: false, vertical: true)
                        Button("Przejdź na konfigurator — przelicz tę pozycję") { startConfigurator(snapshot: nil, productID: editor?.productId) }
                            .controlSize(.small)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }
                audienceBox
                if !packages.isEmpty { packagePicker }
                if draft?.packageId.isEmpty == true && !variants.isEmpty { variantPicker }
                numbers
                addonsEditor
                summary
            }
            .disabled(saving)
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 4) {
            ProductField(label: "Nazwa pozycji w tej ofercie") {
                TextField("", text: Binding(get: { draft?.name ?? "" }, set: { draft?.name = $0 })).textFieldStyle(.roundedBorder)
            }
            if let base = editor?.productName, base != draft?.name { Text("Produkt bazowy: \(base)").font(.caption).foregroundStyle(.secondary) }
            if let description = editor?.productDescription { Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
        }
    }

    // MARK: Uczestnicy oferty (`InlineOfferAudience`)
    private var audienceDirty: Bool {
        guests != (audience.guest_count.map { String(Int($0)) } ?? "")
            || perTable != String(Int(audience.guests_per_table ?? 10))
            || tables != (audience.table_count.map { String(Int($0)) } ?? "")
    }

    private var audienceBox: some View {
        GroupBox("Uczestnicy oferty") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Uzupełnij tutaj dane do wyceny. Zapis dotyczy całej oferty i przelicza jej powiązane pozycje.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(alignment: .bottom, spacing: 10) {
                    ProductField(label: preview?.audienceRequired == true ? "Liczba osób — wymagana do wyceny" : "Liczba osób — opcjonalnie") {
                        TextField("", text: $guests, prompt: Text("Nie ustalono")).textFieldStyle(.roundedBorder).frame(width: 120)
                    }
                    if preview?.needsTables == true {
                        ProductField(label: "Średnio osób przy stole") {
                            TextField("", text: $perTable, prompt: Text("10")).textFieldStyle(.roundedBorder).frame(width: 90)
                        }
                        ProductField(label: "Liczba stołów — opcjonalnie") {
                            TextField("", text: $tables, prompt: Text("Oblicz automatycznie")).textFieldStyle(.roundedBorder).frame(width: 140)
                        }
                    }
                    Button(audienceBusy ? "Zapisuję i przeliczam…" : "Zapisz liczbę osób i przelicz") { Task { await saveAudience() } }
                        .controlSize(.small).disabled(audienceBusy || !audienceDirty)
                }
                if audienceDirty { Text("Zapisz liczbę osób, aby przeliczyć wycenę.").font(.caption).foregroundStyle(.orange) }
                if let audienceProblem { Text(audienceProblem).font(.caption).foregroundStyle(.red) }
            }
            .padding(6)
        }
    }

    // MARK: Pakiety i warianty
    private var packagePicker: some View {
        GroupBox("Wybierz pakiet do kalkulacji") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Cena pakietu obejmuje jego zakres. Przy wycenie indywidualnej wpisz cenę w ustawieniach pozycji. Dostępne dodatki wybierzesz osobno poniżej.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 8)], spacing: 8) {
                    ForEach(packages) { option in
                        let selected = draft?.packageId == option.id
                        Button { selectPackage(option) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.name).font(.callout.weight(.semibold))
                                if !option.included.isEmpty { Text(option.included).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                                Text(priceText(option)).font(.caption.weight(.medium))
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background((selected ? theme.accent : Color.primary).opacity(selected ? 0.18 : 0.05), in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.clear))
                        }
                        .buttonStyle(.plain)
                    }
                }
                if allowIndividual {
                    Button("Wycena pojedynczych elementów zamiast pakietu") { selectIndividual() }
                        .buttonStyle(.link).font(.caption)
                        .disabled(draft?.packageId.isEmpty == true)
                }
                if editing, preview?.packageResourcesMissing == true, let name = packages.first(where: { $0.id == draft?.packageId })?.name {
                    Text("Pakiet „\(name)” w tej ofercie nie ma zapisanej konfiguracji sprzętu i obsady. Jest ona wymagana przed akceptacją.")
                        .font(.caption).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }
                OfferPackageOptionsEditor(options: packageOptions, selectedID: draft?.packageId ?? "", productID: editor?.productId ?? productID,
                                          salePriceNet: (draft?.unitPrice ?? 0) * (1 - (draft?.discountPercent ?? 0) / 100),
                                          catalogResources: editor?.catalogResources ?? [:], disabled: saving) { price in
                    draft?.unitPrice = price
                }
            }
            .padding(6)
        }
    }

    /// Cena pakietu po zmianach w tej ofercie (bez zmian — z katalogu).
    private func priceText(_ option: OfferItemPackage) -> String {
        guard let price = OfferPackageOptions.price(packageOptions.wrappedValue, option.id) else { return option.priceText }
        return option.priceOnRequest && price <= 0 ? "Wycena indywidualna" : "\(OfferText.number(price)) zł netto"
    }

    private var variantPicker: some View {
        GroupBox("Wariant produktu") {
            VStack(alignment: .leading, spacing: 8) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 8)], spacing: 8) {
                    ForEach(variants) { variant in
                        let selected = draft?.variantId == variant.id
                        Button { selectVariant(variant) } label: {
                            HStack {
                                Text(variant.name).font(.callout.weight(selected ? .semibold : .regular)).lineLimit(1)
                                Spacer()
                                Text(OfferText.pln(draft?.variantPrices[variant.id] ?? variant.priceNet)).font(.caption).monospacedDigit()
                            }
                            .padding(8)
                            .background((selected ? theme.accent : Color.primary).opacity(selected ? 0.18 : 0.05), in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.clear))
                        }
                        .buttonStyle(.plain)
                    }
                }
                if !proposalMode { variantOptions }
            }
            .toggleStyle(.checkbox)
            .padding(6)
        }
    }

    /// Widoczność wariantów w PDF i ceny wariantów w tej ofercie (bez propozycji dodatkowych, jak w CRM).
    @ViewBuilder private var variantOptions: some View {
        let hasAddons = !(draft?.addons.isEmpty ?? true)
        Toggle(isOn: Binding(get: { hasAddons ? false : (draft?.showVariants ?? true) }, set: { draft?.showVariants = $0 })) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Pokaż wszystkie warianty w PDF")
                Text(hasAddons ? "Przy dodatkach pokazujemy wybrany wariant i jego szczegółową kalkulację" : "Po wyłączeniu drukowany jest tylko wybrany wariant")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .disabled(hasAddons)
        Toggle(isOn: Binding(get: { draft?.showVariantPrices ?? true }, set: { draft?.showVariantPrices = $0 })) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Pokaż ceny wariantów w PDF")
                Text("Cena netto i brutto VAT 23% przy każdym wariancie").font(.caption).foregroundStyle(.secondary)
            }
        }
        .disabled(!(draft?.showVariants ?? true) || hasAddons)
        DisclosureGroup("Ceny wariantów w tej ofercie") {
            VStack(alignment: .leading, spacing: 6) {
                Text("Kwoty netto za sztukę, przed rabatem. Ceny katalogowe pozostają bez zmian.").font(.caption).foregroundStyle(.secondary)
                ForEach(variants) { variant in
                    HStack {
                        Text(variant.name).frame(maxWidth: .infinity, alignment: .leading)
                        ProductNumberField(value: Binding(get: { draft?.variantPrices[variant.id] ?? variant.priceNet }, set: { price in
                            let next = price ?? 0
                            draft?.variantPrices[variant.id] = next
                            if draft?.variantId == variant.id { draft?.unitPrice = next }
                        }), suffix: "zł").frame(width: 160)
                    }
                }
            }
            .padding(.top, 4)
        }
        .font(.callout)
    }

    private func selectVariant(_ variant: OfferItemVariant) {
        guard var next = draft else { return }
        next.variantId = variant.id
        next.quantitySource = variant.quantitySource
        next.unitPrice = next.variantPrices[variant.id] ?? variant.priceNet
        if editing { next.name = "\(productName) — \(variant.name)" }
        draft = next
    }

    /// Wybór pakietu (jak `handleSelectPackage`): ilość 1, cena pakietu, dodatki pakietu.
    private func selectPackage(_ option: OfferItemPackage) {
        guard var next = draft else { return }
        next.packageId = option.id
        next.quantity = 1
        next.quantitySource = "manual"
        next.variantId = nil
        next.unitPrice = OfferPackageOptions.price(packageOptions.wrappedValue, option.id) ?? option.priceNet
        next.addons = option.includeProductAddons ? productAddons : []
        if editing { next.name = "\(productName) — \(option.name)" }
        draft = next
    }

    /// „Wycena pojedynczych elementów zamiast pakietu”: pierwszy wariant albo cena produktu i dodatki produktu.
    private func selectIndividual() {
        guard var next = draft else { return }
        let variant = variants.first
        next.packageId = ""
        next.variantId = variant?.id
        next.quantitySource = variant?.quantitySource ?? editor?.productQuantitySource ?? product?.quantitySource ?? "manual"
        next.unitPrice = variant?.priceNet ?? editor?.productBasePrice ?? product?.basePrice ?? 0
        next.addons = productAddons
        if editing { next.name = variant.map { "\(productName) — \($0.name)" } ?? productName }
        draft = next
    }

    // MARK: Ilość, dni, cena, rabat
    private var numbers: some View {
        let packageSelected = draft?.packageId.isEmpty == false
        let manualQuantity = draft?.quantitySource == "manual" || packageSelected
        let audiencePriced = preview?.packageAudiencePricing == true
        return GroupBox("Szczegóły pozycji") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Liczba dni") {
                        ProductNumberField(value: Binding(get: { draft?.days ?? 1 }, set: { draft?.days = $0 ?? 0 })).frame(width: 100)
                    }
                    ProductField(label: "Ilość") {
                        ProductNumberField(value: Binding(get: { manualQuantity ? (draft?.quantity ?? 1) : (preview?.quantity ?? draft?.quantity ?? 1) },
                                                          set: { draft?.quantity = $0 ?? 0 }))
                            .frame(width: 100).disabled(!manualQuantity)
                    }
                    ProductField(label: (draft?.addons.isEmpty ?? true) ? "Cena jednostkowa netto / dzień" : "Cena bazowa netto / dzień") {
                        ProductNumberField(value: Binding(get: { audiencePriced ? (preview?.unitPrice ?? 0) : (draft?.unitPrice ?? 0) }, set: { price in
                            let next = price ?? 0
                            draft?.unitPrice = next
                            if let variant = draft?.variantId { draft?.variantPrices[variant] = next }
                        }), suffix: "zł")
                        .frame(width: 150).disabled(audiencePriced)
                    }
                    ProductField(label: editing ? "Rabat %" : "Rabat (%)") {
                        ProductNumberField(value: Binding(get: { draft?.discountPercent ?? 0 }, set: { draft?.discountPercent = $0 ?? 0 }), suffix: "%").frame(width: 100)
                    }
                    if editing {
                        ProductField(label: "Stawka VAT") {
                            Picker("", selection: Binding(get: { draft?.vatRate ?? 23 }, set: { draft?.vatRate = $0 })) {
                                ForEach([0.0, 5, 8, 23], id: \.self) { rate in Text("\(Int(rate))%").tag(rate) }
                            }
                            .labelsHidden().fixedSize()
                        }
                    }
                }
                if !packageSelected {
                    ProductField(label: "Sposób wyliczania ilości") {
                        Picker("", selection: Binding(get: { draft?.quantitySource ?? "manual" }, set: { draft?.quantitySource = $0 })) {
                            ForEach(ProductText.quantitySources, id: \.key) { source in Text(source.label).tag(source.key) }
                        }
                        .labelsHidden().fixedSize()
                    }
                }
                if let note = preview?.audienceNote { Text(note).font(.caption).foregroundStyle(.secondary) }
                if audiencePriced {
                    Text(editing ? "Cena obliczana automatycznie. Stawki zmienisz w ustawieniach pakietu."
                                 : "Cena pakietu obliczona z liczby gości i stołów. Stawki zmienisz w ustawieniach pakietu.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(6)
        }
    }

    // MARK: Dodatki (`ProductAddonsEditor` w ofercie)
    private var addonsEditor: some View {
        GroupBox("Skonfiguruj zakres i dodatki") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Ustawienia dotyczą tylko tej oferty. Ilości dodatków odnoszą się do jednego pakietu; liczba pakietów mnoży cały zakres. Dodatki korzystają ze stawki VAT oferty.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                OfferAddonRows(addons: Binding(get: { draft?.addons ?? [] }, set: { draft?.addons = $0 }))
                HStack {
                    Button { draft?.addons.append(ProductAddonItem.blank()) } label: { Label("Dodaj indywidualny dodatek", systemImage: "plus") }
                        .disabled((draft?.addons.count ?? 0) >= 40)
                    if editor?.canLoadProductAddons == true && (draft?.addons.isEmpty ?? true) {
                        Button("Wczytaj obecne dodatki produktu do tej oferty") { draft?.addons = productAddons }
                    }
                    Spacer()
                    let total = (draft?.addons ?? []).reduce(0.0) { $0 + ($1.onRequest ? 0 : $1.payableQuantity * $1.unit_price) }
                    Text("Dodatki: \(OfferText.number(total)) zł netto / pakiet").font(.caption).foregroundStyle(.secondary)
                }
                .controlSize(.small)
                if !(draft?.addons.isEmpty ?? true) {
                    Text("PDF pokaże pakiet bazowy i wybrane dodatki z ceną jednostkową. Układ kompaktowy będzie niedostępny.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(6)
        }
    }

    // MARK: Podsumowanie
    private var summary: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let preview {
                row("Wartość netto przed rabatem:", OfferText.pln(preview.subtotal))
                if (draft?.discountPercent ?? 0) > 0 { row("Rabat:", "−" + OfferText.pln(preview.discountAmount)) }
                row("Razem netto:", OfferText.pln(preview.total), bold: true)
                if editing {
                    row("VAT (\(OfferText.number(draft?.vatRate ?? 23))%):", OfferText.pln(preview.vat))
                    row("Razem brutto:", OfferText.pln(preview.gross), bold: true)
                }
                if let error = preview.error { Text(error).font(.callout).foregroundStyle(.red).padding(.top, 4) }
            } else if let previewError {
                Text(previewError).font(.callout).foregroundStyle(.red)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
    }

    private func row(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit().fontWeight(bold ? .semibold : .regular)
        }
        .font(.callout)
    }

    // MARK: Wczytanie, podgląd, zapis
    /// Zmiana szkicu albo liczby osób odświeża podgląd wyceny.
    private var previewKey: String {
        guard let draft else { return "" }
        return (productID ?? "") + draft.signature + "|\(audience.guest_count ?? -1)|\(audience.guests_per_table ?? -1)|\(audience.table_count ?? -1)"
    }

    private func load() async {
        loadError = nil
        do {
            if let itemID {
                let data = try await store.itemEditor(offerID, item: itemID)
                editor = data
                draft = data.draft
                setAudience(data.audience)
                if let snapshot = data.draft.modular { startConfigurator(snapshot: snapshot, productID: nil) }
            } else {
                let data = try await store.itemCatalog(offerID, recommendationExclude: proposalMode ? recommendationExclude : nil)
                catalog = data
                setAudience(data.audience)
            }
        } catch {
            loadError = store.failureText(error, "Błąd podczas ładowania produktów")
        }
    }

    private func setAudience(_ next: OfferAudience) {
        audience = next
        guests = next.guest_count.map { String(Int($0)) } ?? ""
        perTable = String(Int(next.guests_per_table ?? 10))
        tables = next.table_count.map { String(Int($0)) } ?? ""
    }

    private func refreshPreview() async {
        guard let draft, editing || productID != nil else { return }
        if modular && draft.modular == nil { return }
        do {
            preview = try await store.previewItem(offerID, productID: editing ? nil : productID, itemID: itemID, draft: draft, recommendation: proposalMode)
            previewError = nil
        } catch {
            preview = nil
            previewError = store.failureText(error, "Nie udało się przeliczyć pozycji.")
        }
    }

    private func saveAudience() async {
        let trimmed = guests.trimmingCharacters(in: .whitespaces)
        if preview?.audienceRequired == true && trimmed.isEmpty { audienceProblem = "Wpisz liczbę osób, aby obliczyć cenę tego pakietu."; return }
        guard trimmed.isEmpty || Int(trimmed) != nil, let capacity = Int(perTable.trimmingCharacters(in: .whitespaces)),
              tables.trimmingCharacters(in: .whitespaces).isEmpty || Int(tables.trimmingCharacters(in: .whitespaces)) != nil else {
            audienceProblem = "Podaj całkowitą liczbę osób i stołów oraz od 1 do 100 osób przy stole."
            return
        }
        audienceBusy = true
        audienceProblem = nil
        defer { audienceBusy = false }
        do {
            let next = try await store.saveAudience(offerID, guests: Int(trimmed).map(Double.init), perTable: Double(capacity),
                                                    tables: Int(tables.trimmingCharacters(in: .whitespaces)).map(Double.init), expected: audience)
            setAudience(next)
            store.workspace?.succeed("Zapisano dane uczestników. Cena została przeliczona.")
        } catch {
            audienceProblem = store.failureText(error, "Nie udało się zapisać liczby osób.")
            await reloadAudience()
        }
    }

    /// Aktualna liczba osób po konflikcie zapisu (ktoś zmienił ją w innym oknie).
    private func reloadAudience() async {
        if let itemID, let data = try? await store.itemEditor(offerID, item: itemID) { setAudience(data.audience) }
        else if itemID == nil, let data = try? await store.itemCatalog(offerID, recommendationExclude: proposalMode ? recommendationExclude : nil) {
            setAudience(data.audience)
        }
    }

    /// „Dodaj propozycję”: serwer buduje propozycję jak CRM, sekcja dopisuje ją do listy i zapisuje.
    /// Zapis po ostatnim przeliczeniu konfiguracji (zmiany wysyłane po chwili bez pisania).
    private func settleConfigurator() async {
        await configurator?.settle()
    }

    private func addRecommendation() async {
        saving = true
        defer { saving = false }
        await settleConfigurator()
        guard let draft, let productID, let onRecommendation else { problem = "Wybierz produkt"; return }
        problem = nil
        do {
            let item = try await store.buildRecommendation(offerID, productID: productID, draft: draft, exclude: recommendationExclude)
            if let failure = await onRecommendation(item) {
                problem = failure
                return
            }
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas dodawania pozycji")
        }
    }

    private func save(move: Bool) async {
        saving = true
        defer { saving = false }
        await settleConfigurator()
        guard let draft else { return }
        problem = nil
        let ok: Bool
        if let itemID {
            ok = await store.change(offerID, "itemUpdate", ["itemId": .string(itemID), "draft": draft.json], success: "Pozycja zaktualizowana")
        } else if let productID {
            ok = await store.change(offerID, "itemAdd", ["productId": .string(productID), "draft": draft.json, "moveRecommendation": .bool(move)],
                                    success: "Pozycja dodana do oferty")
        } else {
            problem = "Wybierz produkt"
            return
        }
        if ok { dismiss() } else if let message = store.workspace?.error { problem = message }
    }
}
