import SwiftUI

// MARK: Karta produktu, część B — zakres konfiguracji wariantu, sprzęt i zasoby (z wyborem z magazynu), Mavinci LIVE.
// Obsada: `ProductStaffViews.swift`, klauzule: `ProductClausesViews.swift`.

/// Sekcje części B na karcie produktu; dane w zakresie produktu bazowego albo wybranego wariantu.
@MainActor struct ProductResourcesBlock: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Group {
            if let resources = store.resources[productID] {
                VStack(spacing: 14) {
                    if !resources.variants.isEmpty { ProductScopeCard(store: store, productID: productID, resources: resources) }
                    if !resources.packages {
                        ProductEquipmentSection(store: store, productID: productID, resources: resources).id("product-section-equipment")
                        ProductStaffSection(store: store, productID: productID, resources: resources).id("product-section-staff")
                    }
                    ProductLiveSection(store: store, productID: productID, resources: resources)
                    ProductClausesSection(store: store, productID: productID, resources: resources).id("product-section-clauses")
                }
            } else if let problem = store.resourceErrors[productID] {
                ProductPanel(title: "Sprzęt, obsada i klauzule", subtitle: problem) {
                    Button("Spróbuj ponownie") { Task { await store.loadResources(productID) } }.controlSize(.small)
                } content: { EmptyView() }
            } else {
                ProductPanel(title: "Sprzęt, obsada i klauzule", subtitle: nil) { EmptyView() } content: {
                    ProgressView("Wczytuję sprzęt, obsadę i klauzule…").controlSize(.small).frame(maxWidth: .infinity)
                }
            }
        }
        .task(id: productID) { await store.loadResources(productID) }
    }
}

/// Karta sekcji z tytułem, podtytułem i przyciskami po prawej.
struct ProductPanel<Trailing: View, Content: View>: View {
    let title: String
    let subtitle: String?
    let trailing: Trailing
    let content: Content
    @Environment(\.crmTheme) private var theme

    init(title: String, subtitle: String?, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    if let subtitle, !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer()
                HStack(spacing: 6) { trailing }.controlSize(.small)
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }
}

/// „Dostosuj wariant” (wariant dziedziczy) albo „Dziedzicz bazowe” i dodawanie (zakres własny lub produkt bazowy).
struct ProductScopeButtons: View {
    let canEdit: Bool
    let variant: Bool
    let inherited: Bool
    let customize: () -> Void
    let inherit: () -> Void
    var addTitle: String? = nil
    var add: () -> Void = {}

    var body: some View {
        if canEdit {
            if variant && inherited {
                Button("Dostosuj wariant", action: customize)
                    .help("Skopiuj zakres produktu bazowego do wariantu i zmieniaj go osobno")
            } else {
                if variant {
                    Button(action: inherit) { Label("Dziedzicz bazowe", systemImage: "arrow.uturn.backward") }
                        .help("Usuń własny zakres wariantu i wróć do produktu bazowego")
                }
                if let addTitle {
                    Button(action: add) { Label(addTitle, systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
            }
        }
    }
}

// MARK: Zakres konfiguracji wariantu

@MainActor struct ProductScopeCard: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources

    var body: some View {
        ProductPanel(title: "Zakres konfiguracji wariantu", subtitle: "Wybierz produkt bazowy lub wariant dla sprzętu, obsady i klauzul.") {
            EmptyView()
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Picker("Konfigurowany zakres produktu", selection: Binding(get: { store.scope(productID) ?? "" }, set: { next in
                    store.setScope(productID, variant: next.isEmpty ? nil : next)
                })) {
                    Text("Produkt bazowy — główny zakres oferty").tag("")
                    ForEach(resources.variants) { variant in
                        Text("Wariant: \(variant.name)" + (variant.active ? "" : " (nieaktywny)")).tag(variant.id)
                    }
                }
                .fixedSize()
                if let name = resources.scope.variantName {
                    Text("Poniższe sekcje pokazują konfigurację wariantu „\(name)”. Sekcja bez własnych zmian dziedziczy dane produktu bazowego.")
                        .font(.caption).foregroundStyle(.secondary)
                    let inherited = resources.scope.inherited
                    HStack(spacing: 6) {
                        badge("Sprzęt", own: !inherited.equipment)
                        badge("Pracownicy", own: !inherited.staff)
                        badge("Mavinci Live", own: !inherited.mavinciLive)
                        badge("Klauzule", own: !inherited.contractClauses)
                    }
                } else {
                    Text("Poniższe sekcje tworzą główny zakres produktu używany bez wariantu oraz dziedziczony przez warianty.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func badge(_ label: String, own: Bool) -> some View {
        Text("\(label): \(own ? "własne" : "dziedziczone")").font(.caption2.weight(.medium))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background((own ? Color.orange : Color.secondary).opacity(0.15), in: Capsule())
            .foregroundStyle(own ? Color.orange : Color.secondary)
    }
}

// MARK: Sprzęt i zasoby

@MainActor struct ProductEquipmentSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    @EnvironmentObject private var state: Workspace
    @State private var adding = false
    @State private var expanded: Set<String> = []

    private var variantName: String? { resources.scope.variantName }
    private var inherited: Bool { resources.scope.inherited.equipment }
    private var editable: Bool { resources.canEdit && !inherited && state.canWrite }

    var body: some View {
        ProductPanel(title: (variantName.map { "Sprzęt wariantu: \($0)" } ?? "Bazowy sprzęt produktu") + " (\(resources.equipment.count))",
                     subtitle: variantName == nil ? "Zakres używany przez produkt bez wariantu oraz jako domyślny dla pustych wariantów."
                        : inherited ? "Zakres jest dziedziczony z produktu bazowego." : "Własny zakres wariantu zastępuje zakres bazowy.") {
            ProductScopeButtons(canEdit: resources.canEdit && state.canWrite, variant: variantName != nil, inherited: inherited,
                                customize: { variantAction("variantCustomize", success: "Wariant ma teraz własny sprzęt") },
                                inherit: { variantAction("variantInherit", success: "Przywrócono dziedziczenie z produktu bazowego") },
                                addTitle: "Dodaj sprzęt / pakiet", add: { adding = true })
        } content: {
            if resources.equipment.isEmpty {
                Text("Brak przypisanego sprzętu").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    let required = resources.equipment.filter { !$0.optional }
                    let optional = resources.equipment.filter(\.optional)
                    if !required.isEmpty { group("Wymagany sprzęt (\(required.count))", required) }
                    if !optional.isEmpty { group("Sprzęt opcjonalny (\(optional.count))", optional) }
                }
            }
        }
        .sheet(isPresented: $adding) { ProductEquipmentPicker(store: store, productID: productID, resources: resources) }
    }

    private func variantAction(_ op: String, success: String) {
        guard let variant = store.scope(productID) else { return }
        Task {
            await store.changeResources(productID, op, ["variantId": .string(variant), "section": .string("equipment")], success: success)
        }
    }

    private func group(_ title: String, _ rows: [ProductResources.Equipment]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 0) {
                    equipmentRow(row)
                    if row.isKit && expanded.contains(row.id) {
                        ForEach(Array(row.kitItems.enumerated()), id: \.offset) { _, item in
                            HStack(spacing: 6) {
                                Text("\(ProductText.number(item.quantity))×").monospacedDigit().foregroundStyle(.secondary)
                                Text(item.name)
                                if let detail = item.detail { Text("(\(detail))").foregroundStyle(.secondary) }
                            }
                            .font(.caption)
                            .padding(.leading, 70).padding(.vertical, 2)
                        }
                        if row.kitItems.isEmpty {
                            Text("Brak danych o zawartości.").font(.caption).foregroundStyle(.secondary).padding(.leading, 70)
                        }
                    }
                    Divider().opacity(0.5)
                }
            }
        }
    }

    private func equipmentRow(_ row: ProductResources.Equipment) -> some View {
        HStack(spacing: 10) {
            if row.isKit {
                Button {
                    if expanded.contains(row.id) { expanded.remove(row.id) } else { expanded.insert(row.id) }
                } label: {
                    Image(systemName: "chevron.right").rotationEffect(.degrees(expanded.contains(row.id) ? 90 : 0))
                }
                .buttonStyle(.plain).frame(width: 14)
                .help(expanded.contains(row.id) ? "Zwiń zawartość pakietu" : "Rozwiń zawartość pakietu")
            } else {
                Color.clear.frame(width: 14, height: 1)
            }
            WarehouseThumb(url: row.thumbnail, size: 36, symbol: row.isKit ? "shippingbox.fill" : "wrench.and.screwdriver")
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(row.name).lineLimit(1)
                    if row.isKit {
                        Text("ZESTAW").font(.caption2.weight(.bold)).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.purple.opacity(0.2), in: Capsule()).foregroundStyle(Color.purple)
                    }
                }
                if !row.subtitle.isEmpty { Text(row.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                if let notes = row.notes, !notes.isEmpty { Text(notes).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(row.category ?? "Bez kategorii").font(.caption).foregroundStyle(.secondary).lineLimit(1).frame(width: 110, alignment: .leading)
            Text(row.optional ? "Opcjonalny" : "Wymagany").font(.caption2.weight(.medium))
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background((row.optional ? Color.secondary : Color.orange).opacity(0.15), in: Capsule())
                .foregroundStyle(row.optional ? Color.secondary : Color.orange)
            availability(row).frame(width: 84, alignment: .trailing)
            quantity(row).frame(width: 70, alignment: .trailing)
            if editable && !row.isRental {
                Button {
                    Task { await store.changeResources(productID, "equipmentRemove", ["rowId": .string(row.id)], success: "Sprzęt usunięty") }
                } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless).foregroundStyle(.red)
                .help("Usuń sprzęt")
            } else {
                Color.clear.frame(width: 16, height: 1)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private func availability(_ row: ProductResources.Equipment) -> some View {
        if row.isKit {
            Text("Pakiet").font(.caption).foregroundStyle(.secondary)
        } else if let available = row.available {
            Text(available == 0 ? "Brak" : "\(ProductText.number(available)) dostępne").font(.caption).monospacedDigit()
                .foregroundStyle(available == 0 ? Color.red : available < 5 ? Color.yellow : Color.green)
                .help(row.isRental ? "Dostępne u podwykonawcy" : "Dostępne egzemplarze w magazynie")
        } else {
            Text("—").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func quantity(_ row: ProductResources.Equipment) -> some View {
        if editable && !row.isKit && !row.isRental {
            ProductQuantityButton(quantity: row.quantity, maximum: row.available) { next in
                Task { await store.changeResources(productID, "equipmentUpdate", ["rowId": .string(row.id), "quantity": .number(next)], success: "Zapisano ilość") }
            }
        } else {
            Text("\(ProductText.number(row.quantity)) szt.").monospacedDigit()
        }
    }
}

/// Ilość sprzętu: kliknięcie otwiera pole z zapisem (jak edycja ilości w wierszu sprzętu w CRM).
struct ProductQuantityButton: View {
    let quantity: Double
    let maximum: Double?
    let save: (Double) -> Void
    @State private var editing = false
    @State private var value: Double? = 1

    var body: some View {
        Button { value = quantity; editing = true } label: {
            Text("\(ProductText.number(quantity)) szt.").monospacedDigit().underline(true, pattern: .dot)
        }
        .buttonStyle(.plain)
        .help("Zmień ilość")
        .popover(isPresented: $editing, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Ilość").font(.caption).foregroundStyle(.secondary)
                HStack {
                    ProductNumberField(value: $value).frame(width: 80)
                    Stepper("", value: Binding(get: { value ?? 1 }, set: { value = max(1, $0) }), in: 1...10000).labelsHidden()
                }
                if let maximum, (value ?? 0) > maximum {
                    Text("W magazynie dostępne: \(ProductText.number(maximum)) szt.").font(.caption).foregroundStyle(.orange)
                }
                HStack {
                    Spacer()
                    Button("Anuluj") { editing = false }
                    Button("Zapisz") {
                        if let next = value, next >= 1, next == next.rounded() { save(next) }
                        editing = false
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled((value ?? 0) < 1 || value != value?.rounded())
                }
                .controlSize(.small)
            }
            .padding(12)
            .frame(width: 220)
        }
    }
}

// MARK: Dodaj sprzęt / zestaw (`AddEquipmentModal`)

@MainActor struct ProductEquipmentPicker: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var showItems = true
    @State private var showKits = true
    @State private var search = ""
    @State private var selected: String?
    @State private var quantity: Double? = 1
    @State private var optional = false
    @State private var notes = ""
    @State private var saving = false

    init(store: ProductsStore, productID: String, resources: ProductResources) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.resources = resources
    }

    /// Bez kabli i bez pozycji już dodanych do tego zakresu (ponowne dodanie zwiększa ilość — w CRM są ukryte).
    private var selectable: [ProductCatalogEquipment] {
        let items = Set(resources.equipment.filter { $0.mode == "item" }.map(\.targetId))
        let kits = Set(resources.equipment.filter(\.isKit).map(\.targetId))
        return (store.equipmentCatalog ?? []).filter { $0.isKit ? !kits.contains($0.id) : !items.contains($0.id) }
    }
    private var visible: [ProductCatalogEquipment] {
        let needle = SearchText.fold(search)
        return selectable.filter { entry in
            (entry.isKit ? showKits : showItems) && (needle.isEmpty || SearchText.fold(entry.searchText).contains(needle))
        }
        .sorted { first, second in
            if first.isKit != second.isKit { return !first.isKit }
            return first.name.localizedCompare(second.name) == .orderedAscending
        }
    }
    private var chosen: ProductCatalogEquipment? { selected.flatMap { id in selectable.first { $0.id == id } } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Dodaj sprzęt").font(.title3.weight(.semibold))
                Text(resources.scope.variantName.map { "Wariant: \($0)" } ?? "Zakres bazowy produktu").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            HStack(spacing: 14) {
                Toggle("Pojedynczy sprzęt (\(selectable.filter { !$0.isKit }.count))", isOn: $showItems)
                Toggle("Zestawy (\(selectable.filter(\.isKit).count))", isOn: $showKits)
                Spacer()
            }
            .toggleStyle(.checkbox)
            .padding(.horizontal, 18)
            TextField("Szukaj po nazwie, marce lub modelu...", text: $search)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 18).padding(.vertical, 8)
            Text("Wybierz sprzęt lub zestaw * (\(visible.count) wyników)").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 18)

            Group {
                if store.equipmentCatalog == nil {
                    ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if !showItems && !showKits {
                    Text("Zaznacz przynajmniej jeden typ sprzętu").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if visible.isEmpty {
                    Text("Brak wyników lub wszystkie elementy są już dodane").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            ForEach(visible) { entry in catalogRow(entry) }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 6)
                    }
                }
            }
            .frame(height: 300)

            Divider()
            VStack(alignment: .leading, spacing: 10) {
                if let kit = chosen, kit.isKit {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Zawartość zestawu:").font(.caption.weight(.semibold))
                        if kit.kitItems.isEmpty {
                            Text("Brak danych o zawartości.").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(Array(kit.kitItems.enumerated()), id: \.offset) { _, item in
                            Text("• \(ProductText.number(item.quantity))x \(item.name)" + (item.detail.map { " (\($0))" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                HStack(alignment: .top, spacing: 14) {
                    ProductField(label: "Ilość") { ProductNumberField(value: $quantity).frame(width: 90) }
                    Toggle("Opcjonalny (można usunąć z oferty)", isOn: $optional).toggleStyle(.checkbox).padding(.top, 18)
                }
                ProductField(label: "Notatki (opcjonalnie)") {
                    ProductTextArea(text: Binding(get: { notes }, set: { notes = String($0.prefix(500)) }), prompt: "Dodatkowe informacje...", lines: 2...4)
                }
            }
            .padding(18)

            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Dodawanie…" : (chosen?.isKit == true ? "Dodaj zestaw" : "Dodaj sprzęt")) { Task { await add() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(saving || chosen == nil || (quantity ?? 0) < 1 || quantity != quantity?.rounded())
            }
            .padding(.horizontal, 18).padding(.bottom, 16)
        }
        .frame(width: 640)
        .background(theme.page)
        .task { if store.equipmentCatalog == nil { await store.loadEquipmentCatalog() } }
    }

    private func catalogRow(_ entry: ProductCatalogEquipment) -> some View {
        let available = entry.available ?? 0
        let unavailable = !entry.isKit && available == 0
        let isSelected = selected == entry.id
        return Button { selected = entry.id } label: {
            HStack(spacing: 10) {
                WarehouseThumb(url: entry.thumbnail, size: 38, symbol: entry.isKit ? "shippingbox.fill" : "wrench.and.screwdriver")
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.name).lineLimit(1)
                    if !entry.isKit {
                        let detail = [[entry.brand, entry.model].compactMap { $0 }.joined(separator: " • "), entry.category ?? ""]
                            .filter { !$0.isEmpty }.joined(separator: " • ")
                        if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    if let description = entry.description, !description.isEmpty {
                        Text(description).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                if entry.isKit {
                    Text("ZESTAW").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.purple.opacity(0.2), in: Capsule()).foregroundStyle(Color.purple)
                } else {
                    Text(available == 0 ? "Brak" : "\(ProductText.number(available)) szt.").font(.caption.weight(.medium)).monospacedDigit()
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background((available == 0 ? Color.red : available < 5 ? Color.yellow : Color.green).opacity(0.18), in: Capsule())
                        .foregroundStyle(available == 0 ? Color.red : available < 5 ? Color.yellow : Color.green)
                }
            }
            .padding(8)
            .background(isSelected ? theme.accent.opacity(0.18) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSelected ? theme.accent : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(unavailable)
        .opacity(unavailable ? 0.5 : 1)
    }

    private func add() async {
        guard let entry = chosen, let amount = quantity else { return }
        saving = true
        defer { saving = false }
        let ok = await store.changeResources(productID, "equipmentAdd", [
            "mode": .string(entry.isKit ? "kit" : "item"), "targetId": .string(entry.id), "quantity": .number(amount),
            "optional": .bool(optional), "notes": .string(notes),
        ], pending: "Dodawanie…", success: entry.isKit ? "Zestaw dodany" : "Sprzęt dodany")
        if ok { dismiss() }
    }
}

// MARK: Mavinci LIVE

@MainActor struct ProductLiveSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    @EnvironmentObject private var state: Workspace

    private var variantName: String? { resources.scope.variantName }
    private var inherited: Bool { resources.scope.inherited.mavinciLive }
    private var editable: Bool { resources.canEdit && !inherited && state.canWrite }

    var body: some View {
        ProductPanel(title: "Mavinci LIVE — zawartość uruchamiana przez produkt",
                     subtitle: "Gdy ten produkt znajdzie się w ofercie wydarzenia, pojawi się zakładka Mavinci LIVE z wybranymi modułami. Brak wyboru oznacza, że produkt nie wymaga tej części realizacji.") {
            if variantName != nil {
                ProductScopeButtons(canEdit: resources.canEdit && state.canWrite, variant: true, inherited: inherited,
                                    customize: { variantAction("variantCustomize", success: "Wariant ma teraz własne moduły Mavinci LIVE") },
                                    inherit: { variantAction("variantInherit", success: "Przywrócono dziedziczenie z produktu bazowego") })
            }
        } content: {
            VStack(alignment: .leading, spacing: 6) {
                if let name = variantName {
                    Text("Wariant: \(name) — " + (inherited ? "moduły są dziedziczone z produktu bazowego." : "ten wariant ma własną listę modułów."))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if !resources.live.available {
                    Text("Zastosuj migracje Mavinci LIVE oraz 20260831100000_unify_offer_variant_configuration.sql, aby włączyć wariantowe przypisywanie zawartości.")
                        .font(.caption).foregroundStyle(.orange)
                } else if resources.live.modules.isEmpty {
                    Text("Brak aktywnych modułów Mavinci LIVE.").foregroundStyle(.secondary)
                } else {
                    ForEach(resources.live.modules) { module in
                        Button {
                            Task {
                                await store.changeResources(productID, "liveToggle", ["key": .string(module.key), "on": .bool(!module.selected)],
                                                            success: module.selected ? "Usunięto powiązanie z Mavinci LIVE"
                                                                : "Produkt będzie uruchamiał odpowiednią zawartość Mavinci LIVE")
                            }
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: module.selected ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(module.selected ? Color.accentColor : Color.secondary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(module.name).font(.callout.weight(.medium))
                                    Text(module.description ?? "Moduł zawartości Mavinci LIVE").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!editable)
                    }
                }
            }
        }
    }

    private func variantAction(_ op: String, success: String) {
        guard let variant = store.scope(productID) else { return }
        Task { await store.changeResources(productID, op, ["variantId": .string(variant), "section": .string("mavinci_live")], success: success) }
    }
}
