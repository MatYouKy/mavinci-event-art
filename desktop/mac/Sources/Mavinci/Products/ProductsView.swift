import SwiftUI

// MARK: Katalog produktów (`/crm/offers?tab=catalog`, `CatalogTab.tsx`) — wyszukiwanie po nazwie, opisie i tagach, kategoria,
// widok kafelków / listy / tabeli, gotowość do oferty (liczniki, filtr „Do uzupełnienia” / „Gotowe”, braki według grup)
// i nowy produkt. Dwuklik otwiera kartę produktu (`ProductCardView`).

@MainActor struct ProductsView: View {
    @ObservedObject var store: ProductsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("productsCatalogViewMode") private var mode = "table"
    @State private var search = ""
    @State private var category = "all"
    @State private var readiness = "all"
    @State private var group: String?
    @State private var creating = false
    @State private var deleting: ProductListItem?
    @State private var sortOrder = [KeyPathComparator(\ProductListItem.order)]

    var body: some View {
        if let id = store.openedID {
            ProductCardView(store: store, productID: id).id(id)
        } else {
            catalog
        }
    }

    // MARK: Filtry (jak `OfferPage` + `CatalogTab`)
    /// Produkty po wyszukiwaniu i kategorii — od nich liczone są liczniki gotowości.
    private var base: [ProductListItem] {
        let needle = SearchText.fold(search)
        return store.products.filter { item in
            if category != "all" && item.categoryId != category { return false }
            return needle.isEmpty || SearchText.fold(item.searchText).contains(needle)
        }
    }
    private var activeProducts: [ProductListItem] { base.filter(\.active) }
    private var readyCount: Int { activeProducts.filter(\.readiness.ready).count }
    private func missingCount(_ key: String) -> Int {
        activeProducts.filter { item in item.readiness.groups.contains { $0.key == key && !$0.ok } }.count
    }
    private var groups: [ProductReadinessGroup] { store.products.first?.readiness.groups ?? [] }

    private var rows: [ProductListItem] {
        base.filter { item in
            if readiness == "ready" { return item.active && item.readiness.ready }
            if readiness == "missing" && (!item.active || item.readiness.ready) { return false }
            if let group { return item.active && item.readiness.groups.contains { $0.key == group && !$0.ok } }
            return true
        }.sorted(using: sortOrder)
    }

    private var catalog: some View {
        VStack(spacing: 0) {
            toolbar
            if let problem = store.loadError { MessageBar(text: problem, warning: true) { store.loadError = nil } }
            if !store.products.isEmpty { readinessBar }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Katalog produktów")
        .sheet(isPresented: $creating) { ProductCreateSheet(store: store) }
        .confirmationDialog("Usunąć produkt „\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń produkt", role: .destructive) {
                if let item = deleting { Task { _ = await store.delete(item.id) } }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("Ta operacja jest nieodwracalna.")
        }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            TextField("Szukaj produktu po nazwie, opisie lub tagu...", text: $search)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 320)
            Picker("Kategoria", selection: $category) {
                Text("Wszystkie kategorie").tag("all")
                ForEach(store.categories) { item in Text(item.name).tag(item.id) }
            }
            .labelsHidden().fixedSize()
            Picker("Widok", selection: $mode) {
                Image(systemName: "square.grid.3x3").help("Widok kafelków").tag("grid")
                Image(systemName: "list.bullet").help("Widok listy").tag("list")
                Image(systemName: "tablecells").help("Widok tabeli").tag("table")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Spacer()
            if store.syncing { ProgressView().controlSize(.small) }
            Button { state.openHref("/crm/offers") } label: { Label("Oferty", systemImage: "doc.text") }
            if store.canEdit {
                Button { creating = true } label: { Label("Nowy produkt", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .disabled(!state.canWrite)
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    private var readinessBar: some View {
        HStack(spacing: 10) {
            (Text("Gotowe do oferty: ") + Text("\(readyCount)").bold() + Text(" z \(activeProducts.count) aktywnych"))
                .font(.callout)
            Picker("Gotowość", selection: Binding(get: { readiness }, set: { next in
                readiness = next
                if next == "ready" { group = nil }
            })) {
                Text("Wszystkie").tag("all")
                Text("Do uzupełnienia (\(activeProducts.count - readyCount))").tag("missing")
                Text("Gotowe (\(readyCount))").tag("ready")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Divider().frame(height: 16)
            Text("Braki:").font(.callout).foregroundStyle(.secondary)
            ForEach(groups, id: \.key) { item in
                let count = missingCount(item.key)
                let on = group == item.key
                Button {
                    group = on ? nil : item.key
                    if !on { readiness = "missing" }
                } label: {
                    Text("\(item.short) \(count)")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background((on ? Color.orange : Color.primary).opacity(on ? 0.25 : 0.07), in: Capsule())
                        .foregroundStyle(on ? Color.orange : (count > 0 ? Color.primary : Color.secondary))
                }
                .buttonStyle(.plain)
                .disabled(count == 0 && !on)
                .help("Produkty z brakami: \(item.label.lowercased())")
            }
            Spacer()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 7)
        .background(theme.card.opacity(0.35))
    }

    @ViewBuilder private var content: some View {
        if store.products.isEmpty {
            if !store.loaded { ProgressView("Ładowanie katalogu…") }
            else { ContentUnavailableView("Brak produktów w katalogu", systemImage: "shippingbox") }
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label(readiness == "ready" ? "Żaden produkt w tym widoku nie jest jeszcze gotowy do oferty." : "Brak produktów z takimi brakami.",
                      systemImage: "shippingbox")
            } actions: {
                Button("Pokaż wszystkie") { readiness = "all"; group = nil; search = ""; category = "all" }
            }
        } else if mode == "grid" {
            grid
        } else if mode == "list" {
            list
        } else {
            table
        }
    }

    // MARK: Widoki
    private var table: some View {
        Table(rows, selection: $store.selectedID, sortOrder: $sortOrder) {
            TableColumn("Zdjęcie") { (item: ProductListItem) in
                ProductThumbButton(item: item).frame(width: 64, height: 44).padding(.vertical, 2)
            }.width(72)
            TableColumn("Produkt", value: \ProductListItem.name) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).lineLimit(1)
                    if !item.description.isEmpty {
                        Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .help(item.name)
            }.width(min: 200, ideal: 300)
            TableColumn("Kategoria", value: \ProductListItem.sortCategory) { item in
                Text(item.category ?? "—").lineLimit(1).foregroundStyle(item.category == nil ? .secondary : .primary)
            }.width(min: 90, ideal: 140)
            TableColumn("Warianty", value: \ProductListItem.variants) { item in
                Text(item.variants == 0 ? "—" : "\(item.variants)").monospacedDigit()
            }.width(min: 50, ideal: 60, max: 80)
            TableColumn("Netto", value: \ProductListItem.priceNet) { item in
                Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceNet)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 90, ideal: 120)
            TableColumn("Brutto", value: \ProductListItem.priceGross) { item in
                Text(ProductText.money(item.priceGross)).monospacedDigit().foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 90, ideal: 120)
            TableColumn("Marża", value: \ProductListItem.sortMargin) { item in
                ProductMarginText(margin: item.margin).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 50, ideal: 60, max: 80)
            TableColumn("Gotowość do oferty", value: \ProductListItem.sortReadiness) { item in
                ProductReadinessInline(readiness: item.readiness)
            }.width(min: 150, ideal: 220)
            TableColumn("Status", value: \ProductListItem.activeText) { item in
                Text(item.activeText).foregroundStyle(item.active ? Color.green : Color.secondary)
            }.width(min: 70, ideal: 85, max: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = store.product(id) { menu(item) }
        } primaryAction: { ids in
            guard let id = ids.first, store.product(id) != nil else { return }
            store.openedID = id
        }
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 380), spacing: 14)], spacing: 14) {
                ForEach(rows) { item in
                    ProductGridCard(item: item, selected: store.selectedID == item.id)
                        .onTapGesture(count: 2) { store.selectedID = item.id; store.openedID = item.id }
                        .onTapGesture { store.selectedID = item.id }
                        .contextMenu { menu(item) }
                }
            }
            .padding(16)
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(rows) { item in
                    ProductListRow(item: item, selected: store.selectedID == item.id)
                        .onTapGesture(count: 2) { store.selectedID = item.id; store.openedID = item.id }
                        .onTapGesture { store.selectedID = item.id }
                        .contextMenu { menu(item) }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder private func menu(_ item: ProductListItem) -> some View {
        Button("Otwórz kartę produktu", systemImage: "doc.text.magnifyingglass") { store.openedID = item.id }
        Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/offers/products/\(item.id)") }
        if store.canEdit {
            Divider()
            Button("Usuń…", systemImage: "trash", role: .destructive) { deleting = item }
        }
    }
}

// MARK: Elementy katalogu

/// Zdjęcie produktu do oferty (miniatura) albo ikona — wypełnia ramkę, którą nadaje widok nadrzędny.
@MainActor struct ProductThumb: View {
    let path: String?
    let url: String?
    var corner: CGFloat = 6
    @Environment(\.crmTheme) private var theme
    @State private var image: NSImage?

    init(path: String?, url: String?, corner: CGFloat = 6) {
        self.path = path
        self.url = url
        self.corner = corner
        _image = State(initialValue: ProductImageCache.shared.cached(path))
    }

    var body: some View {
        Color.primary.opacity(0.05)
            .overlay {
                if let image {
                    Image(nsImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: "shippingbox").foregroundStyle(theme.accent.opacity(0.7))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: corner))
            .task(id: path) {
                guard let path, let url else { image = nil; return }
                image = await ProductImageCache.shared.image(path: path, url: url)
            }
    }
}

/// Miniatura w katalogu: kliknięcie pokazuje powiększone zdjęcie z ceną i opisem (jak podgląd miniatury w katalogu CRM);
/// dwuklik w wiersz lub kafelek otwiera kartę produktu.
@MainActor struct ProductThumbButton: View {
    let item: ProductListItem
    var corner: CGFloat = 6
    @State private var showing = false

    var body: some View {
        Button { showing.toggle() } label: {
            ProductThumb(path: item.imagePath, url: item.imageUrl, corner: corner).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Kliknij, aby powiększyć zdjęcie")
        .popover(isPresented: $showing, arrowEdge: .trailing) { ProductPreviewPopover(item: item) }
    }
}

/// Podgląd produktu z katalogu: powiększone zdjęcie, nazwa, kategoria, opis i ceny.
@MainActor struct ProductPreviewPopover: View {
    let item: ProductListItem
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ProductLargeImage(path: item.imagePath, url: item.imageUrl).frame(width: 520, height: 390)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).font(.headline)
                Text(item.categoryText).font(.caption).foregroundStyle(.secondary)
            }
            if !item.description.isEmpty {
                Text(item.description).font(.callout).foregroundStyle(.secondary).lineLimit(4).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Cena netto").font(.caption2).foregroundStyle(.secondary)
                    Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceNet)).font(.callout.weight(.semibold)).monospacedDigit()
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Cena brutto").font(.caption2).foregroundStyle(.secondary)
                    Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceGross)).font(.callout).monospacedDigit()
                }
                Spacer()
                ProductReadinessInline(readiness: item.readiness)
            }
        }
        .padding(14)
        .frame(width: 548)
    }
}

/// Całe zdjęcie produktu (bez przycinania) na ciemnym tle — podgląd w powiększeniu.
@MainActor struct ProductLargeImage: View {
    let path: String?
    let url: String?
    @State private var image: NSImage?

    init(path: String?, url: String?) {
        self.path = path
        self.url = url
        _image = State(initialValue: ProductImageCache.shared.cached(path))
    }

    var body: some View {
        Color.black.opacity(0.85)
            .overlay {
                if let image {
                    Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
                } else if path?.isEmpty == false {
                    ProgressView().controlSize(.small)
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "photo").font(.system(size: 32))
                        Text("Brak zdjęcia do oferty").font(.callout)
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .task(id: path) {
                guard let path, !path.isEmpty, let url else { image = nil; return }
                image = await ProductImageCache.shared.image(path: path, url: url)
            }
    }
}

/// Cztery kropki gotowości (zielona — gotowe, bursztynowa — braki) i krótki opis braków.
struct ProductReadinessInline: View {
    let readiness: ProductListItem.Readiness
    var body: some View {
        HStack(spacing: 6) {
            ProductReadinessDots(groups: readiness.groups.map { (label: $0.label, ok: $0.ok) })
            Text(readiness.summary).font(.caption).lineLimit(1)
                .foregroundStyle(readiness.ready ? Color.green : Color.orange)
        }
        .help(readiness.ready ? "Gotowy do oferty" : "Do uzupełnienia: " + readiness.groups.filter { !$0.ok }.map(\.label).joined(separator: ", "))
    }
}

struct ProductReadinessDots: View {
    let groups: [(label: String, ok: Bool)]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                Circle().fill(group.ok ? Color.green : Color.orange).frame(width: 7, height: 7)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(groups.allSatisfy { $0.ok } ? "Gotowy do oferty" : "Do uzupełnienia")
    }
}

struct ProductMarginText: View {
    let margin: Double?
    var body: some View {
        Text(ProductText.margin(margin)).monospacedDigit()
            .foregroundStyle(margin == nil ? Color.secondary : (margin! >= 0 ? Color.green : Color.red))
            .help(margin == nil ? ProductText.marginUnknown : "")
    }
}

@MainActor private struct ProductGridCard: View {
    let item: ProductListItem
    let selected: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProductThumbButton(item: item, corner: 0)
                .aspectRatio(16 / 9, contentMode: .fit)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).font(.headline).lineLimit(2)
                        Text(item.categoryText).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(item.activeText).font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background((item.active ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
                        .foregroundStyle(item.active ? Color.green : Color.secondary)
                }
                if !item.description.isEmpty {
                    Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                HStack {
                    VStack(alignment: .leading) {
                        Text("Netto").font(.caption2).foregroundStyle(.secondary)
                        Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceNet)).font(.callout.weight(.semibold)).monospacedDigit()
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("Brutto").font(.caption2).foregroundStyle(.secondary)
                        Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceGross)).font(.callout).monospacedDigit()
                    }
                }
                HStack {
                    Text(item.unitText).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    HStack(spacing: 3) {
                        Text("Marża").foregroundStyle(.secondary)
                        ProductMarginText(margin: item.margin)
                    }
                    .font(.caption)
                }
                ProductReadinessInline(readiness: item.readiness)
            }
            .padding(12)
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? theme.accent : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1))
        .opacity(item.active ? 1 : 0.7)
        .contentShape(Rectangle())
    }
}

@MainActor private struct ProductListRow: View {
    let item: ProductListItem
    let selected: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(spacing: 12) {
            ProductThumbButton(item: item).frame(width: 96, height: 64)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.name).font(.headline).lineLimit(1)
                    if !item.active {
                        Text("Nieaktywny").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.15), in: Capsule()).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 6) {
                    Text(item.categoryText)
                    if !item.description.isEmpty {
                        Text("·")
                        Text(item.description).lineLimit(1)
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ProductReadinessInline(readiness: item.readiness).frame(width: 200, alignment: .leading)
            Text(item.unitText).font(.caption).foregroundStyle(.secondary).frame(width: 80, alignment: .trailing)
            VStack(alignment: .trailing) {
                Text("Netto").font(.caption2).foregroundStyle(.secondary)
                Text((item.fromVariant ? "od " : "") + ProductText.money(item.priceNet)).monospacedDigit()
            }.frame(width: 120, alignment: .trailing)
            VStack(alignment: .trailing) {
                Text("Brutto").font(.caption2).foregroundStyle(.secondary)
                Text(ProductText.money(item.priceGross)).monospacedDigit().foregroundStyle(.secondary)
            }.frame(width: 110, alignment: .trailing)
            ProductMarginText(margin: item.margin).frame(width: 50, alignment: .trailing)
        }
        .padding(10)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? theme.accent : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1))
        .opacity(item.active ? 1 : 0.7)
        .contentShape(Rectangle())
    }
}

// MARK: Nowy produkt

@MainActor struct ProductCreateSheet: View {
    @ObservedObject var store: ProductsStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var category = ""
    @State private var saving = false

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Nazwa produktu", text: $name)
                    Picker("Kategoria", selection: $category) {
                        Text("Bez kategorii").tag("")
                        ForEach(store.categories) { item in Text(item.name).tag(item.id) }
                    }
                } header: {
                    Text("Nowy produkt")
                } footer: {
                    Text("Ceny, opisy, zdjęcie, sprzęt i obsadę uzupełnisz na karcie produktu.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Dodawanie…" : "Dodaj produkt") {
                    Task {
                        saving = true
                        defer { saving = false }
                        if let id = await store.create(name: name.trimmingCharacters(in: .whitespacesAndNewlines), categoryID: category.isEmpty ? nil : category) {
                            store.selectedID = id
                            store.openedID = id
                            dismiss()
                        }
                    }
                }
                .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 460, height: 300)
        .background(theme.page)
    }
}
