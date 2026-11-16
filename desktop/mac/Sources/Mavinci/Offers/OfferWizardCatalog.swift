import SwiftUI

// MARK: Oferty, część E — kreator: „Katalog produktów” (`OfferStep3`) i „Pozycje i podsumowanie” (`OfferStep4`), braki sprzętu
// w terminie (`EquipmentConflictsSummary`) i ostrzeżenia o produktach niegotowych do oferty (`productReadiness`).

// MARK: Krok 3 — katalog

@MainActor struct OfferWizardCatalogStep: View {
    @ObservedObject var model: OfferWizardModel
    @Environment(\.crmTheme) private var theme
    @AppStorage("offerWizardCatalogView") private var viewMode = "list"
    @State private var search = ""
    @State private var category = "all"
    /// Pakiety albo elementy (warianty) dla produktów z pakietami.
    @State private var modes: [String: String] = [:]
    /// Wybór zakresu w widoku tabeli.
    @State private var choices: [String: String] = [:]

    struct Choice: Identifiable {
        let id: String
        let name: String
        let priceNet: Double
        let priceGross: Double?
        let scope: String
        let bonus: String
        let quoteOnly: Bool
        let variant: OfferWizardSetup.Variant?
        let package: OfferWizardSetup.Package?
        var priceText: String { quoteOnly ? "Wycena indywidualna" : "\(OfferText.amount(priceNet)) zł netto" }
    }

    private var products: [OfferWizardSetup.Product] { model.setup?.products ?? [] }
    private var filtered: [OfferWizardSetup.Product] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return products.filter { product in
            let inCategory = category == "all" || product.categoryId == category
            let matches = query.isEmpty || product.name.lowercased().contains(query) || product.description.lowercased().contains(query)
            return inCategory && matches
        }
    }
    private var added: Set<String> { Set(model.items.compactMap(\.productId)) }
    private var available: [OfferWizardSetup.Product] { filtered.filter { !added.contains($0.id) } }
    private var addedItems: [OfferWizardItem] { model.items.filter { $0.productId != nil && model.product($0.productId) != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Wybierz produkty z katalogu").font(.headline)
                Spacer()
                Label("\(model.items.count) pozycji w ofercie", systemImage: "cart").font(.callout).foregroundStyle(.secondary)
            }
            OfferWizardAudienceFields(model: model)
            HStack(alignment: .top, spacing: 14) {
                catalog
                addedPanel
            }
            .frame(maxHeight: .infinity)
        }
    }

    // MARK: Dostępne produkty

    private var catalog: some View {
        VStack(spacing: 0) {
            panelHeader("Dostępne produkty", symbol: "shippingbox", count: available.count)
            VStack(spacing: 8) {
                TextField("", text: $search, prompt: Text("Szukaj produktu do dodania...")).textFieldStyle(.roundedBorder)
                HStack {
                    Picker("", selection: $category) {
                        Text("Wszystkie kategorie").tag("all")
                        ForEach(model.setup?.categories ?? []) { item in Text(item.name).tag(item.id) }
                    }
                    .labelsHidden()
                    Picker("", selection: $viewMode) {
                        Image(systemName: "list.bullet").help("Widok listy").tag("list")
                        Image(systemName: "tablecells").help("Widok tabeli").tag("table")
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
            }
            .padding(10)
            Divider()
            ScrollView {
                if available.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "shippingbox").font(.largeTitle).foregroundStyle(.tertiary)
                        Text(filtered.isEmpty ? "Brak produktów spełniających wybrane kryteria." : "Wszystkie pasujące produkty są już dodane do oferty.")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 50)
                } else if viewMode == "table" {
                    LazyVStack(spacing: 0) {
                        ForEach(available) { product in
                            tableRow(product)
                            Divider()
                        }
                    }
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(available) { product in card(product) }
                    }
                    .padding(10)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.2)))
    }

    private func panelHeader(_ title: String, symbol: String, count: Int) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(theme.accent)
            Text(title).font(.callout.weight(.medium))
            Spacer()
            Text("\(count)").font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
                .background(theme.accent.opacity(0.12), in: Capsule()).foregroundStyle(theme.accent)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider() }
    }

    private func mode(_ product: OfferWizardSetup.Product) -> String {
        product.packages.isEmpty ? "elements" : modes[product.id] ?? "packages"
    }

    private func choiceList(_ product: OfferWizardSetup.Product) -> [Choice] {
        if mode(product) == "packages" {
            return product.packages.map { item in
                Choice(id: item.id, name: item.name, priceNet: item.priceNet, priceGross: nil, scope: item.included, bonus: item.bonus,
                       quoteOnly: item.quoteOnly, variant: nil, package: item)
            }
        }
        return product.variants.map { item in
            Choice(id: item.id, name: item.name, priceNet: item.priceNet, priceGross: item.priceGross, scope: "", bonus: "",
                   quoteOnly: false, variant: item, package: nil)
        }
    }

    private func selectedChoice(_ product: OfferWizardSetup.Product) -> Choice? {
        let list = choiceList(product)
        return list.first { $0.id == choices[product.id] } ?? list.first { $0.variant?.recommended == true } ?? list.first
    }

    private func priceLabel(_ product: OfferWizardSetup.Product) -> String {
        let list = choiceList(product)
        guard let lowest = list.min(by: { $0.priceNet < $1.priceNet }) else { return "\(OfferText.amount(product.basePrice)) zł netto" }
        return lowest.quoteOnly ? "Wycena indywidualna" : "od \(OfferText.amount(lowest.priceNet)) zł netto"
    }

    private func addChoice(_ product: OfferWizardSetup.Product, _ choice: Choice?) {
        model.add(product, variant: choice?.variant, package: choice?.package)
    }

    @ViewBuilder private func modePicker(_ product: OfferWizardSetup.Product) -> some View {
        if !product.packages.isEmpty {
            Picker("", selection: Binding(get: { mode(product) }, set: { modes[product.id] = $0 })) {
                Text("Pakiety").tag("packages")
                Text("Elementy").tag("elements")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            .disabled(product.variants.isEmpty)
            .help(product.variants.isEmpty ? "Produkt nie ma elementów do wyceny osobno." : "Sposób wyceny")
        }
    }

    private func card(_ product: OfferWizardSetup.Product) -> some View {
        let list = choiceList(product)
        let packageMode = mode(product) == "packages"
        return HStack(alignment: .top, spacing: 12) {
            OfferWizardThumbnail(product: product, size: CGSize(width: 112, height: 80), price: priceLabel(product))
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(product.name).font(.callout.weight(.medium))
                        if let name = product.category { Text(name).font(.caption).foregroundStyle(theme.accent) }
                    }
                    Spacer()
                    Text(priceLabel(product)).font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                }
                if !product.description.isEmpty {
                    Text(product.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                ProductReadinessInline(readiness: product.readiness)
                if product.modular {
                    Text("Produkt z konfiguratorem (scena, LED) — dodasz go do oferty w CRM.").font(.caption).foregroundStyle(.secondary)
                } else {
                    modePicker(product)
                    if list.isEmpty {
                        Button("Dodaj do oferty") { addChoice(product, nil) }.buttonStyle(.borderedProminent).controlSize(.small)
                    } else {
                        if packageMode {
                            VStack(spacing: 6) { ForEach(list) { choice in choiceButton(product, choice, wide: true) } }
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 6)], alignment: .leading, spacing: 6) {
                                ForEach(list) { choice in choiceButton(product, choice, wide: false) }
                            }
                        }
                        if !product.packages.isEmpty {
                            Text(packageMode ? "Pełne ceny pakietów. Kliknij pakiet, aby dodać go do oferty."
                                             : "Ceny elementów. Skonfigurowane dodatki, np. logistykę, zobaczysz po dodaniu.")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.12)))
    }

    private func choiceButton(_ product: OfferWizardSetup.Product, _ choice: Choice, wide: Bool) -> some View {
        Button { addChoice(product, choice) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(choice.name).font(.callout.weight(.medium)).foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Text(choice.priceText).font(.callout).foregroundStyle(theme.accent)
                }
                if !choice.scope.isEmpty { Text(choice.scope).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading) }
                if !choice.bonus.isEmpty { Text(choice.bonus).font(.caption).foregroundStyle(theme.accent) }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .frame(maxWidth: wide ? .infinity : nil, alignment: .leading)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Dodaj do oferty")
    }

    private func tableRow(_ product: OfferWizardSetup.Product) -> some View {
        let list = choiceList(product)
        let selected = selectedChoice(product)
        return HStack(spacing: 10) {
            OfferWizardThumbnail(product: product, size: CGSize(width: 48, height: 40), price: selected?.priceText ?? priceLabel(product))
            VStack(alignment: .leading, spacing: 2) {
                Text(product.name).font(.callout.weight(.medium)).lineLimit(1)
                HStack(spacing: 6) {
                    ProductReadinessDots(groups: product.readiness.groups.map { (label: $0.label, ok: $0.ok) })
                    Text(product.category ?? "—").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(product.readiness.summary)
            Text(selected?.priceText ?? "\(OfferText.amount(product.basePrice)) zł").font(.caption.weight(.medium))
                .foregroundStyle(theme.accent).frame(width: 120, alignment: .trailing)
            if product.modular {
                Text("W CRM").font(.caption).foregroundStyle(.secondary).frame(width: 220, alignment: .trailing)
            } else {
                HStack(spacing: 6) {
                    modePicker(product)
                    if !list.isEmpty {
                        Picker("", selection: Binding(get: { selected?.id ?? "" }, set: { choices[product.id] = $0 })) {
                            ForEach(list) { choice in Text(choice.name).tag(choice.id) }
                        }
                        .labelsHidden().frame(maxWidth: 160)
                    }
                    Button("Dodaj") { addChoice(product, selected) }.buttonStyle(.borderedProminent).controlSize(.small)
                }
                .frame(width: 220, alignment: .trailing)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
    }

    // MARK: Dodane produkty

    private var addedPanel: some View {
        VStack(spacing: 0) {
            panelHeader("Dodane produkty", symbol: "checkmark.circle", count: addedItems.count)
            ScrollView {
                if addedItems.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "cart").font(.largeTitle).foregroundStyle(.tertiary)
                        Text("Dodane produkty pojawią się tutaj.").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 50)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(addedItems) { item in
                            OfferWizardAddedRow(model: model, itemID: item.id)
                            Divider()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.2)))
    }
}

/// Miniatura produktu; kliknięcie pokazuje większy podgląd z opisem i cenami (jak dymek w katalogu CRM).
@MainActor struct OfferWizardThumbnail: View {
    let product: OfferWizardSetup.Product
    let size: CGSize
    let price: String
    @Environment(\.crmTheme) private var theme
    @State private var open = false

    var body: some View {
        Button { open = true } label: { image.frame(width: size.width, height: size.height).clipShape(RoundedRectangle(cornerRadius: 6)) }
            .buttonStyle(.plain)
            .help("Podgląd produktu")
            .popover(isPresented: $open, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    image.frame(width: 300, height: 170).clipShape(RoundedRectangle(cornerRadius: 8))
                    Text(product.name).font(.headline)
                    if let name = product.category { Text(name).font(.caption).foregroundStyle(theme.accent) }
                    if !product.offerDescription.isEmpty {
                        ScrollView { Text(product.offerDescription).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                            .frame(maxHeight: 140)
                    }
                    Divider()
                    Text("Cena netto: \(price)").font(.caption)
                    ProductReadinessInline(readiness: product.readiness)
                }
                .padding(14)
                .frame(width: 328)
            }
    }

    @ViewBuilder private var image: some View {
        if let address = product.imageUrl, let url = URL(string: address) {
            AsyncImage(url: url) { phase in
                if let picture = phase.image { picture.resizable().scaledToFill() } else { placeholder }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        Image(systemName: "shippingbox").foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.primary.opacity(0.06))
    }
}

/// Dodany produkt: ilość × dni, cena, wartość, ustawienia PDF, usuwanie i „Konfiguruj zakres i dodatki”.
@MainActor struct OfferWizardAddedRow: View {
    @ObservedObject var model: OfferWizardModel
    let itemID: String
    @Environment(\.crmTheme) private var theme
    @State private var expanded = false

    private var item: OfferWizardItem? { model.items.first { $0.id == itemID } }

    var body: some View {
        if let item, let product = model.product(item.productId) {
            content(item, product)
        }
    }

    private func binding<T>(_ key: WritableKeyPath<OfferItemDraft, T>, _ fallback: T) -> Binding<T> {
        Binding(get: { item?.draft[keyPath: key] ?? fallback }, set: { value in model.update(itemID) { entry in entry.draft[keyPath: key] = value } })
    }

    private func content(_ item: OfferWizardItem, _ product: OfferWizardSetup.Product) -> some View {
        let evaluated = model.evaluated(item)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(.callout.weight(.medium)).lineLimit(2)
                    if !product.readiness.ready {
                        Label("Niegotowy do oferty — \(product.readiness.summary.lowercased())", systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange).lineLimit(2)
                            .help("Niegotowy do oferty — \(product.readiness.summary.lowercased())")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 4) {
                    Text("\(OfferText.number(evaluated?.quantity ?? item.draft.quantity)) \(evaluated?.unit ?? item.unit) ×")
                    ProductNumberField(value: Binding(get: { Optional(item.draft.days) }, set: { value in
                        model.update(itemID) { entry in entry.draft.days = value ?? 1 }
                    })).frame(width: 52)
                    Text("dni")
                }
                .font(.caption).foregroundStyle(.secondary)
                // Cena bazowa netto / dzień edytowana wprost w wierszu — to samo pole co w „Konfiguruj zakres i dodatki”.
                VStack(alignment: .trailing, spacing: 1) {
                    ProductNumberField(value: Binding(get: { Optional(item.draft.unitPrice) }, set: { value in
                        model.update(itemID) { entry in entry.draft.unitPrice = max(0, value ?? 0) }
                    }), suffix: "zł")
                    .help("Cena bazowa netto za dzień, bez dodatków")
                    if let evaluated, evaluated.unitPrice - evaluated.baseUnitPrice > 0.004 {
                        Text("z dodatkami \(OfferText.amount(evaluated.unitPrice)) zł").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
                .frame(width: 120, alignment: .trailing)
                // Bez przeliczenia z serwera nie pokazujemy 0,00 zł — wartość pojawi się po przeliczeniu.
                Text(Self.subtotalText(evaluated)).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                    .frame(width: 100, alignment: .trailing)
                    .help(evaluated == nil ? "Wartość pojawi się po przeliczeniu oferty" : "")
                Button(role: .destructive) { model.remove(itemID) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).help("Usuń z oferty")
            }
            pdfSettings(item, product)
            if let error = evaluated?.error { Text(error).font(.caption).foregroundStyle(.red) }
            DisclosureGroup(isExpanded: $expanded) {
                configuration(item, product).padding(.top, 6)
            } label: {
                Text(configureLabel(item)).font(.caption).foregroundStyle(theme.accent)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }

    @ViewBuilder private func pdfSettings(_ item: OfferWizardItem, _ product: OfferWizardSetup.Product) -> some View {
        if !item.draft.packageId.isEmpty {
            Text("Elementy bez cen + pakiety").font(.caption2).foregroundStyle(theme.accent)
        } else if !item.draft.addons.isEmpty {
            Text("Wybrany zakres + kalkulacja dodatków").font(.caption2).foregroundStyle(.secondary)
        } else if !product.variants.isEmpty {
            HStack(spacing: 12) {
                Toggle("Warianty", isOn: binding(\.showVariants, true)).toggleStyle(.checkbox)
                Toggle("Ceny wariantów", isOn: binding(\.showVariantPrices, true)).toggleStyle(.checkbox)
                    .disabled(!item.draft.showVariants)
            }
            .font(.caption)
        }
    }

    @ViewBuilder private func configuration(_ item: OfferWizardItem, _ product: OfferWizardSetup.Product) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !product.packages.isEmpty {
                ProductField(label: "Wybrany zakres", help: "Zmiana zakresu przywróci jego cenę katalogową i dodatki. Ilość oraz rabat pozostaną zachowane.") {
                    Picker("", selection: Binding(get: { scopeTag(item) }, set: { tag in changeScope(product, tag) })) {
                        if scopeTag(item).isEmpty { Text("Wybierz zakres").tag("") }
                        Section("Pakiety") {
                            ForEach(product.packages) { option in Text(packageLabel(option)).tag("package:\(option.id)") }
                        }
                        if !product.variants.isEmpty {
                            Section("Elementy") {
                                ForEach(product.variants) { variant in
                                    Text("\(variant.name) · \(OfferText.amount(variant.priceNet)) zł netto + dodatki").tag("element:\(variant.id)")
                                }
                            }
                        }
                    }
                    .labelsHidden()
                }
            }
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Liczba dni") {
                    ProductNumberField(value: Binding(get: { Optional(item.draft.days) }, set: { value in
                        model.update(itemID) { entry in entry.draft.days = value ?? 1 }
                    })).frame(width: 90)
                }
                ProductField(label: "Cena bazowa netto / dzień") {
                    ProductNumberField(value: Binding(get: { Optional(item.draft.unitPrice) }, set: { value in
                        model.update(itemID) { entry in entry.draft.unitPrice = value ?? 0 }
                    }), suffix: "zł").frame(width: 160)
                }
            }
            OfferAddonRows(addons: binding(\.addons, []))
            Button { model.update(itemID) { entry in entry.draft.addons.append(ProductAddonItem.blank()) } } label: {
                Label("Dodaj indywidualny dodatek", systemImage: "plus")
            }
            .controlSize(.small)
            .disabled(item.draft.addons.count >= 40)
            if !item.draft.packageId.isEmpty {
                Text("Sprzęt i obsadę pakietu oraz jego koszty w tej ofercie zmienisz po utworzeniu oferty — w CRM.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    static func subtotalText(_ evaluated: OfferWizardPreview.Item?) -> String {
        guard let evaluated else { return "—" }
        return "\(OfferText.amount(evaluated.subtotal)) zł"
    }

    private func configureLabel(_ item: OfferWizardItem) -> String {
        item.draft.addons.isEmpty ? "Konfiguruj zakres i dodatki" : "Konfiguruj zakres i dodatki (\(item.draft.addons.count))"
    }

    private func packageLabel(_ option: OfferWizardSetup.Package) -> String {
        option.quoteOnly ? "\(option.name) · wycena indywidualna" : "\(option.name) · \(option.priceText)"
    }

    private func scopeTag(_ item: OfferWizardItem) -> String {
        if !item.draft.packageId.isEmpty { return "package:\(item.draft.packageId)" }
        if let variant = item.draft.variantId { return "element:\(variant)" }
        return ""
    }

    private func changeScope(_ product: OfferWizardSetup.Product, _ tag: String) {
        let parts = tag.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return }
        if parts[0] == "package", let option = product.packages.first(where: { $0.id == parts[1] }) {
            model.add(product, package: option)
        } else if let variant = product.variants.first(where: { $0.id == parts[1] }) {
            model.add(product, variant: variant)
        }
    }
}

// MARK: Produkty niegotowe do oferty

@MainActor struct OfferWizardReadinessNotice: View {
    @ObservedObject var model: OfferWizardModel

    var body: some View {
        let rows = model.notReadyItems
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label("Produkty niegotowe do oferty (\(rows.count))", systemImage: "exclamationmark.triangle")
                    .font(.callout.weight(.medium)).foregroundStyle(.orange)
                Text("Brakujące dane mogą dać niepełny PDF, zaniżone koszty i marżę albo umowę bez klauzul. Ofertę możesz utworzyć, ale przed wysłaniem uzupełnij produkty w katalogu.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                ForEach(rows) { row in
                    HStack(spacing: 6) {
                        ProductReadinessDots(groups: row.product.readiness.groups.map { (label: $0.label, ok: $0.ok) })
                        Text("\(row.product.name) — \(row.product.readiness.summary)").font(.caption)
                    }
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.orange.opacity(0.3)))
        }
    }
}

// MARK: Braki sprzętu w terminie

@MainActor struct OfferWizardConflicts: View {
    @ObservedObject var model: OfferWizardModel

    private func conflictText(_ conflict: OfferWizardPreview.Conflict) -> Text {
        let details = " szt. (wymagane: \(OfferText.number(conflict.required)), dostępne: \(OfferText.number(conflict.available)), "
            + "zarezerw.: \(OfferText.number(conflict.reserved)), magazyn: \(OfferText.number(conflict.total)))"
        let name = Text(conflict.name).bold().foregroundColor(.primary)
        let lead = Text(" — brakuje ").foregroundColor(.secondary)
        let count = Text(OfferText.number(conflict.shortage)).bold().foregroundColor(.red)
        return name + lead + count + Text(details).foregroundColor(.secondary)
    }

    var body: some View {
        if let preview = model.preview {
            if !preview.conflicts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Label("Braki sprzętu w terminie (\(preview.conflicts.count))", systemImage: "exclamationmark.triangle")
                            .font(.callout.weight(.medium))
                        if model.previewing { Text("Sprawdzam...").font(.caption).opacity(0.7) }
                    }
                    .foregroundStyle(.red)
                    ForEach(preview.conflicts) { conflict in
                        conflictText(conflict).font(.caption)
                    }
                    Text("Zamiennik albo akceptację braku wybierzesz przy rezerwacji sprzętu („Zarezerwuj sprzęt” na stronie oferty).")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.red.opacity(0.25)))
            } else if !preview.conflictsChecked {
                Text("Nie udało się sprawdzić dostępności sprzętu w terminie wydarzenia.").font(.caption).foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        if let error = model.previewError {
            HStack(spacing: 8) {
                Text(error).font(.caption).foregroundStyle(.red)
                Button("Przelicz ponownie") { model.schedulePreview() }
                    .controlSize(.small)
                    .disabled(model.previewing)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: Krok 4 — pozycje i podsumowanie

@MainActor struct OfferWizardItemsStep: View {
    @ObservedObject var model: OfferWizardModel
    @Environment(\.crmTheme) private var theme
    @State private var customOpen = false
    @State private var customName = ""
    @State private var customDescription = ""
    @State private var customQuantity: Double? = 1
    @State private var customDays: Double? = 1
    @State private var customPrice: Double? = 0
    @State private var editing: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Pozycje oferty").font(.headline)
                Spacer()
                Button { customOpen = true } label: { Label("Dodaj pozycję", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
            OfferWizardReadinessNotice(model: model)
            if customOpen { customForm }
            if model.items.isEmpty {
                Text("Brak pozycji w ofercie. Dodaj pierwszą pozycję.").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(30)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundStyle(theme.accent.opacity(0.3)))
            } else {
                ForEach(model.items) { item in
                    OfferWizardItemCard(model: model, itemID: item.id, editing: $editing)
                }
                OfferWizardTotals(model: model)
            }
        }
    }

    private var customForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nowa pozycja").font(.callout.weight(.medium))
            ProductField(label: "Liczba dni") { ProductNumberField(value: $customDays).frame(width: 100) }
            TextField("", text: $customName, prompt: Text("Nazwa")).textFieldStyle(.roundedBorder)
            TextField("", text: $customDescription, prompt: Text("Opis")).textFieldStyle(.roundedBorder)
            HStack(spacing: 12) {
                ProductField(label: "Ilość") { ProductNumberField(value: $customQuantity) }
                ProductField(label: "Cena jednostkowa") { ProductNumberField(value: $customPrice, suffix: "zł") }
            }
            HStack {
                Button("Dodaj") {
                    model.addCustom(name: customName.trimmingCharacters(in: .whitespacesAndNewlines), description: customDescription,
                                    quantity: customQuantity ?? 0, days: customDays ?? 1, price: customPrice ?? 0)
                    customName = ""
                    customDescription = ""
                    customQuantity = 1
                    customDays = 1
                    customPrice = 0
                    customOpen = false
                }
                .buttonStyle(.borderedProminent)
                .disabled(customName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Anuluj") { customOpen = false }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.2)))
    }
}

/// Pozycja w podsumowaniu: podgląd albo edycja nazwy, opisu, ilości, dni i ceny (`OfferStep4`).
@MainActor struct OfferWizardItemCard: View {
    @ObservedObject var model: OfferWizardModel
    let itemID: String
    @Binding var editing: String?
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var description = ""
    @State private var quantity: Double? = 1
    @State private var days: Double? = 1
    @State private var price: Double? = 0

    private var item: OfferWizardItem? { model.items.first { $0.id == itemID } }

    var body: some View {
        if let item { card(item) }
    }

    private func card(_ item: OfferWizardItem) -> some View {
        let evaluated = model.evaluated(item)
        let isEditing = editing == itemID
        let product = model.product(item.productId)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                if isEditing { form } else {
                    Text(item.name).font(.callout.weight(.medium))
                    if !item.description.isEmpty { Text(item.description).font(.caption).foregroundStyle(.secondary) }
                    Text("Ilość: \(OfferText.number(evaluated?.quantity ?? item.draft.quantity)) × \(OfferText.number(evaluated?.days ?? item.draft.days)) dni × \(OfferText.amount(evaluated?.unitPrice ?? item.draft.unitPrice)) zł netto")
                        .font(.caption)
                    Text("Netto: \(OfferWizardAddedRow.subtotalText(evaluated))").font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                }
                if let product, !product.readiness.ready {
                    Label("Niegotowy do oferty — \(product.readiness.summary.lowercased())", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if let error = evaluated?.error { Text(error).font(.caption).foregroundStyle(.red) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                if isEditing {
                    Button { save() } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless).foregroundStyle(.green).help("Zakończ edycję")
                    Button { editing = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Anuluj")
                } else {
                    Button { start(item, evaluated) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless)
                        .foregroundStyle(theme.accent).help("Edytuj pozycję")
                    Button(role: .destructive) { model.remove(itemID) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń pozycję")
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.2)))
    }

    private var form: some View {
        let net = (quantity ?? 0) * (days ?? 1) * (price ?? 0)
        let vat = net * 0.23
        return VStack(alignment: .leading, spacing: 8) {
            TextField("", text: $name, prompt: Text("Nazwa")).textFieldStyle(.roundedBorder)
            TextField("", text: $description, prompt: Text("Opis")).textFieldStyle(.roundedBorder)
            HStack(spacing: 10) {
                ProductField(label: "Ilość") { ProductNumberField(value: $quantity) }
                ProductField(label: "Liczba dni") { ProductNumberField(value: $days) }
                ProductField(label: "Cena jednostkowa netto") { ProductNumberField(value: $price, suffix: "zł") }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Netto: \(OfferText.amount(net)) zł")
                Text("VAT: \(OfferText.amount(vat)) zł")
                Text("Brutto: \(OfferText.amount(net + vat)) zł").fontWeight(.semibold).foregroundStyle(theme.accent)
            }
            .font(.caption)
            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func start(_ item: OfferWizardItem, _ evaluated: OfferWizardPreview.Item?) {
        name = item.name
        description = item.description
        quantity = evaluated?.quantity ?? item.draft.quantity
        days = item.draft.days
        price = evaluated?.unitPrice ?? item.draft.unitPrice
        editing = itemID
    }

    private func save() {
        model.saveEdit(itemID, name: name, description: description, quantity: quantity ?? 1, days: days ?? 1, unitPrice: price ?? 0)
        editing = nil
    }
}

/// Podsumowanie: wartość pozycji, rabat, po rabacie, VAT, brutto oraz cena docelowa / rabat kwotowy / procentowy.
@MainActor struct OfferWizardTotals: View {
    @ObservedObject var model: OfferWizardModel
    @Environment(\.crmTheme) private var theme

    private var pricing: OfferWizardPreview.Pricing? { model.preview?.pricing }

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(spacing: 8) {
                line("Wartość pozycji netto", "\(OfferText.amount(pricing?.listNet ?? 0)) zł").foregroundStyle(.secondary)
                if let pricing, pricing.discountAmount > 0 {
                    line("Rabat \(OfferText.amount(pricing.discountPercent))%", "− \(OfferText.amount(pricing.discountAmount)) zł")
                        .foregroundStyle(.green).fontWeight(.medium)
                }
                Divider()
                HStack {
                    Text("Po rabacie netto").font(.headline)
                    Spacer()
                    Text("\(OfferText.amount(pricing?.targetNet ?? 0)) zł").font(.title2.weight(.bold)).foregroundStyle(theme.accent)
                }
                line("VAT \(OfferText.number(pricing?.taxPercent ?? 23))%", "\(OfferText.amount(pricing?.taxAmount ?? 0)) zł").foregroundStyle(.secondary)
                line("Wartość brutto", "\(OfferText.amount(pricing?.gross ?? 0)) zł").fontWeight(.semibold)
            }
            .font(.callout)
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 10) {
                ProductField(label: "Docelowa cena oferty netto") {
                    ProductNumberField(value: $model.targetNet, prompt: OfferText.amount(pricing?.listNet ?? 0), nullable: true, suffix: "zł")
                }
                HStack(spacing: 8) {
                    ProductField(label: "Rabat netto") {
                        ProductNumberField(value: Binding(get: { discountAmount }, set: { setAmount($0) }), prompt: "0,00", nullable: true, suffix: "zł")
                    }
                    ProductField(label: "Rabat procentowy") {
                        ProductNumberField(value: Binding(get: { discountPercent }, set: { setPercent($0) }), prompt: "0,00", nullable: true, suffix: "%")
                    }
                }
                Text("Możesz wpisać cenę końcową, kwotę rabatu albo procent. Pozostałe wartości przeliczą się automatycznie.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 300)
        }
        .padding(16)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.2)))
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).monospacedDigit() }
    }

    private var listNet: Double { pricing?.listNet ?? 0 }
    private var discountAmount: Double? { (pricing?.discountAmount ?? 0) > 0 ? ((pricing!.discountAmount * 100).rounded() / 100) : nil }
    private var discountPercent: Double? { (pricing?.discountPercent ?? 0) > 0 ? ((pricing!.discountPercent * 100).rounded() / 100) : nil }

    private func setAmount(_ value: Double?) {
        guard let value else { model.targetNet = nil; return }
        model.targetNet = ((listNet - min(listNet, max(0, value))) * 100).rounded() / 100
    }

    private func setPercent(_ value: Double?) {
        guard let value else { model.targetNet = nil; return }
        model.targetNet = ((listNet * (1 - min(100, max(0, value)) / 100)) * 100).rounded() / 100
    }
}
