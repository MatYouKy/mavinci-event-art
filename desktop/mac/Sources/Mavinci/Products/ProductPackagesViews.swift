import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Pakiety sprzedaży (`ProductSalesPackagesSection`, `ProductPackageResourcesEditor`, `ProductPackageCostsEditor`,
// `AudiencePricingEditor`) — do trzech pakietów na drugiej stronie oferty: zdjęcie, elementy, nazwa, opisy, cena (też
// z liczby osób i stołów), przedłużenie, sprzęt i obsada pakietu, koszty realizacji i marża.

@MainActor struct ProductPackagesSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @EnvironmentObject private var state: Workspace
    @State private var open: PackageForm?
    @State private var removing: ProductSalesPackageItem?

    struct PackageForm: Identifiable {
        let id = UUID()
        let item: ProductSalesPackageItem
        let creating: Bool
        let readOnly: Bool
    }

    private var items: [ProductSalesPackageItem] { extras.packages.items }
    private var editable: Bool { extras.canEdit && state.canWrite }

    var body: some View {
        ProductPanel(title: "Pakiety · druga strona oferty",
                     subtitle: "Pakiety mają własne ceny, koszty realizacji i zdjęcia. Dodaj maksymalnie 3 pakiety.") {
            if editable {
                Button { open = PackageForm(item: .blank(), creating: true, readOnly: false) } label: { Label("Dodaj pakiet", systemImage: "plus") }
                    .disabled(items.count >= 3)
            }
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("Dwie strony: elementy bez cen + wybór pakietu", isOn: Binding(get: { extras.packages.enabled }, set: { on in
                    save(items, enabled: on, success: "Zapisano ustawienia pakietów")
                }))
                .toggleStyle(.checkbox)
                .disabled(!editable || items.isEmpty)
                if items.isEmpty {
                    Text("Dodaj pakiet, aby przygotować drugą stronę oferty.").foregroundStyle(.secondary)
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HStack(spacing: 10) {
                        Text(String(format: "%02d", index + 1)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 22)
                        ProductThumb(path: item.image_path, url: item.image_url).frame(width: 64, height: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.callout.weight(.semibold))
                            Text(item.description.isEmpty ? item.included_label : item.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            Text(item.priceText).font(.caption.monospacedDigit())
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Menu {
                            Button("Podgląd", systemImage: "eye") { open = PackageForm(item: item, creating: false, readOnly: true) }
                            if editable {
                                Button("Edytuj", systemImage: "pencil") { open = PackageForm(item: item, creating: false, readOnly: false) }
                                Button("Przenieś wyżej", systemImage: "arrow.up") { move(index, index - 1) }.disabled(index == 0)
                                Button("Przenieś niżej", systemImage: "arrow.down") { move(index, index + 1) }.disabled(index == items.count - 1)
                                Divider()
                                Button("Usuń", systemImage: "trash", role: .destructive) { removing = item }
                            }
                        } label: { Image(systemName: "ellipsis.circle") }
                            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    }
                    .padding(8)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) { open = PackageForm(item: item, creating: false, readOnly: !editable) }
                }
            }
        }
        .sheet(item: $open) { form in
            ProductPackageSheet(store: store, productID: productID, extras: extras, initial: form.item, creating: form.creating, readOnly: form.readOnly)
        }
        .confirmationDialog("Usunąć pakiet „\(removing?.name ?? "")”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń pakiet", role: .destructive) {
                if let item = removing {
                    let next = items.filter { $0.id != item.id }
                    save(next, enabled: extras.packages.enabled && !next.isEmpty, success: "Pakiet usunięty")
                }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: {
            Text("Istniejące oferty zachowają jego zapisany zakres." + (items.count == 1 ? " Usunięcie ostatniego pakietu wyłączy drugą stronę pakietów." : ""))
        }
    }

    private func move(_ from: Int, _ to: Int) {
        guard to >= 0, to < items.count else { return }
        var next = items
        let item = next.remove(at: from)
        next.insert(item, at: to)
        save(next, enabled: extras.packages.enabled, success: "Zapisano kolejność pakietów")
    }

    private func save(_ list: [ProductSalesPackageItem], enabled: Bool, success: String) {
        Task {
            await store.changeExtras(productID, "packagesSave", ["packages": .array(list.map(\.json)), "enabled": .bool(enabled)], success: success)
        }
    }
}

// MARK: Pakiet — edycja i podgląd

@MainActor struct ProductPackageSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    let creating: Bool
    let readOnly: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductSalesPackageItem
    @State private var imageData: Data?
    @State private var image: NSImage?
    @State private var removeImage = false
    @State private var stored: NSImage?
    @State private var importing = false
    @State private var editingResources = false
    @State private var editingCosts = false
    @State private var elementSearch = ""
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, extras: ProductExtras, initial: ProductSalesPackageItem, creating: Bool, readOnly: Bool) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.extras = extras
        self.creating = creating
        self.readOnly = readOnly
        _draft = State(initialValue: initial)
        _stored = State(initialValue: ProductImageCache.shared.cached(initial.image_path))
    }

    private var preview: NSImage? { image ?? (removeImage ? nil : stored) }

    private func limited(_ key: WritableKeyPath<ProductSalesPackageItem, String>, _ limit: Int) -> Binding<String> {
        Binding(get: { draft[keyPath: key] }, set: { draft[keyPath: key] = String($0.prefix(limit)) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(readOnly ? "Podgląd pakietu" : creating ? "Dodaj pakiet" : "Edytuj pakiet").font(.title3.weight(.semibold))
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Zdjęcie pakietu").font(.caption).foregroundStyle(.secondary)
                        Color.primary.opacity(0.05)
                            .aspectRatio(177 / 160, contentMode: .fit)
                            .overlay {
                                if let preview { Image(nsImage: preview).resizable().scaledToFill() }
                                else {
                                    VStack(spacing: 4) {
                                        Image(systemName: "photo.badge.plus").font(.title2)
                                        Text("Przeciągnij zdjęcie tutaj").font(.caption)
                                    }
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .dropDestination(for: URL.self) { urls, _ in
                                guard !readOnly, let url = urls.first else { return false }
                                choose(url)
                                return true
                            }
                        if !readOnly {
                            HStack {
                                Button(preview == nil ? "Wybierz…" : "Zmień zdjęcie") { importing = true }
                                if preview != nil {
                                    Button("Usuń zdjęcie", role: .destructive) { image = nil; imageData = nil; removeImage = true }
                                }
                            }
                            .controlSize(.small)
                            Text("JPG, PNG lub WebP · maks. 10 MB · automatyczna kompresja. Zdjęcie dotyczy wyłącznie tego pakietu.")
                                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            TextField("", text: limited(\.image_alt, 200), prompt: Text("Opis zdjęcia")).textFieldStyle(.roundedBorder)
                        }
                        elements
                    }
                    .frame(width: 240)

                    VStack(alignment: .leading, spacing: 10) {
                        ProductField(label: "Nazwa", help: "\(draft.name.count)/42") {
                            TextField("", text: limited(\.name, 42)).textFieldStyle(.roundedBorder)
                        }
                        ProductField(label: "Krótki opis", help: "\(draft.description.count)/95") {
                            TextField("", text: limited(\.description, 95)).textFieldStyle(.roundedBorder)
                        }
                        ProductField(label: "Zakres widoczny dla klienta", help: "\(draft.included_label.count)/95") {
                            TextField("", text: limited(\.included_label, 95)).textFieldStyle(.roundedBorder)
                        }
                        ProductField(label: "Bonus w cenie", help: "\(draft.bonus.count)/65") {
                            TextField("", text: limited(\.bonus, 65)).textFieldStyle(.roundedBorder)
                        }
                        Toggle("Cena ustalana indywidualnie w ofercie", isOn: Binding(get: { draft.price_on_request == true }, set: { draft.price_on_request = $0 ? true : nil }))
                            .toggleStyle(.checkbox)
                        Toggle("Udostępnij dodatki produktu po wybraniu pakietu", isOn: Binding(get: { draft.include_product_addons == true }, set: { draft.include_product_addons = $0 ? true : nil }))
                            .toggleStyle(.checkbox)
                        audience
                        HStack(alignment: .top, spacing: 10) {
                            ProductField(label: "Pełna cena pakietu netto (zł)") {
                                ProductNumberField(value: Binding(get: { draft.price_net }, set: { draft.price_net = $0 ?? 0 }))
                                    .disabled(draft.audience_pricing != nil)
                            }
                            ProductField(label: "Dodatkowa godzina netto (zł) — opcjonalnie",
                                         help: "Przedłużenie całego pakietu. Puste pole ukrywa informację; stawka nie jest doliczana do ceny bazowej.") {
                                ProductNumberField(value: $draft.extension_price_net_per_hour, prompt: "Nie pokazuj stawki", nullable: true)
                            }
                        }
                        Text("W PDF bordowym tłem wyróżniamy wyłącznie pakiet wybrany w danej ofercie.").font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 8) {
                            Button { editingResources = true } label: {
                                Label("Sprzęt i obsada: " + (draft.resources.map { "\($0.equipment.count) poz. · \(ProductText.number($0.staff.reduce(0) { $0 + $1.quantity })) os." } ?? "nie określono"),
                                      systemImage: "shippingbox")
                            }
                            Button { editingCosts = true } label: {
                                Label("Koszty realizacji: " + (draft.costNet.map { ProductText.money($0) + " netto" } ?? "uzupełnij"), systemImage: "banknote")
                            }
                        }
                        .controlSize(.small)
                        costSummary
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 10)
                .disabled(readOnly || saving)
            }
            .frame(height: 560)
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button(readOnly ? "Zamknij" : "Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if !readOnly {
                    Button(saving ? "Zapisywanie…" : "Zapisz pakiet") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
                }
            }
            .padding(18)
        }
        .frame(width: 760)
        .background(theme.page)
        .task {
            guard stored == nil, let path = draft.image_path, let url = draft.image_url else { return }
            stored = await ProductImageCache.shared.image(path: path, url: url)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { choose(url) }
        }
        .sheet(isPresented: $editingResources) {
            ProductPackageResourcesSheet(store: store, productID: productID, packageName: draft.name, initial: draft.resources, readOnly: readOnly) { draft.resources = $0 }
        }
        .sheet(isPresented: $editingCosts) {
            ProductPackageCostsSheet(store: store, productID: productID, package: draft, readOnly: readOnly) { draft.cost_items = $0 }
        }
    }

    private var elements: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Elementy w pakiecie (\(draft.element_ids.count) / \(extras.variants.count))").font(.caption.weight(.semibold))
            if extras.variants.isEmpty {
                Text("Dodaj i zapisz elementy produktu, aby połączyć je w pakiet.").font(.caption).foregroundStyle(.secondary)
            } else {
                TextField("Szukaj elementu…", text: $elementSearch).textFieldStyle(.roundedBorder).controlSize(.small)
                let needle = SearchText.fold(elementSearch)
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(extras.variants.filter { needle.isEmpty || SearchText.fold($0.name).contains(needle) }) { element in
                            Toggle(element.name, isOn: Binding(get: { draft.element_ids.contains(element.id) }, set: { on in
                                if on { if !draft.element_ids.contains(element.id) { draft.element_ids.append(element.id) } }
                                else { draft.element_ids.removeAll { $0 == element.id } }
                            }))
                            .toggleStyle(.checkbox).font(.caption)
                        }
                    }
                }
                .frame(maxHeight: 160)
            }
        }
    }

    @ViewBuilder private var audience: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("Przeliczaj cenę z liczby osób i stołów", isOn: Binding(get: { draft.audience_pricing != nil }, set: { on in
                if on { setAudience(ProductAudiencePricing(fixed_net: 0, per_guest_net: 0, per_table_net: 0, reference_guests: 150)) }
                else { draft.audience_pricing = nil }
            }))
            .toggleStyle(.checkbox)
            if let pricing = draft.audience_pricing {
                HStack(alignment: .top, spacing: 8) {
                    ProductField(label: "Część stała netto") { ProductNumberField(value: audienceValue(\.fixed_net, pricing)) }
                    ProductField(label: "Netto za osobę") { ProductNumberField(value: audienceValue(\.per_guest_net, pricing)) }
                    ProductField(label: "Netto za stół") { ProductNumberField(value: audienceValue(\.per_table_net, pricing)) }
                    ProductField(label: "Osoby do ceny w katalogu") { ProductNumberField(value: audienceValue(\.reference_guests, pricing)) }
                }
                Text("W katalogu: średnio 10 osób przy stole. W ofercie obowiązuje zapisana liczba gości i ustawienie stołów. Cena = część stała + osoby × stawka + stoły × stawka.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func audienceValue(_ key: WritableKeyPath<ProductAudiencePricing, Double>, _ pricing: ProductAudiencePricing) -> Binding<Double?> {
        Binding(get: { draft.audience_pricing?[keyPath: key] ?? pricing[keyPath: key] }, set: { value in
            var next = draft.audience_pricing ?? pricing
            next[keyPath: key] = value ?? 0
            setAudience(next)
        })
    }

    private func setAudience(_ pricing: ProductAudiencePricing) {
        draft.audience_pricing = pricing
        if let price = pricing.referencePrice { draft.price_net = price }
    }

    private var costSummary: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let total = draft.costNet {
                Text("Koszt spółki / 1 pakiet: \(ProductText.money(total)) netto").fontWeight(.medium)
                if draft.unpricedStaff > 0 {
                    Text("Obsada bez określonej stawki: \(draft.unpricedStaff). Kalkulacja kosztów jest niepełna.").foregroundStyle(.orange)
                } else {
                    let margin = ((draft.price_net - total) * 100).rounded() / 100
                    Text("Marża: \(ProductText.money(margin))" + (draft.price_net > 0 ? " (\(ProductText.number((margin / draft.price_net * 1000).rounded() / 10))%)" : ""))
                }
            } else {
                Text("Koszty: \(draft.cost_items == nil ? "nieuzupełnione" : "uzupełnij pozycje kosztowe") · marża nieustalona").foregroundStyle(.secondary)
            }
        }
        .font(.caption)
    }

    private func choose(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let allowed = [UTType.jpeg, .png, .webP].contains { type?.conforms(to: $0) == true }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard allowed, size > 0, size <= 10 * 1024 * 1024, let encoded = ProductImageEncoder.encode(url) else {
            problem = "Wybierz JPG, PNG lub WebP o wielkości do 10 MB."
            return
        }
        imageData = encoded.data
        image = encoded.image
        removeImage = false
        problem = nil
    }

    private func save() async {
        var next = draft
        next.name = next.name.trimmingCharacters(in: .whitespacesAndNewlines)
        next.included_label = next.included_label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.name.isEmpty, !next.included_label.isEmpty else { problem = "Podaj nazwę i zakres każdego pakietu."; return }
        if removeImage { next.image_path = nil }
        let items = extras.packages.items
        let list = creating ? items + [next] : items.map { $0.id == next.id ? next : $0 }
        let enabled = !list.isEmpty && (extras.packages.enabled || (creating && items.isEmpty))
        var fields: [String: JSONValue] = ["packages": .array(list.map(\.json)), "enabled": .bool(enabled)]
        if let imageData { fields["images"] = .array([.object(["packageId": .string(next.id), "data": .string(imageData.base64EncodedString())])]) }
        problem = nil
        saving = true
        defer { saving = false }
        if await store.changeExtras(productID, "packagesSave", fields, success: creating ? "Pakiet dodany" : "Zapisano pakiet") {
            if imageData != nil, let image, let path = store.extras[productID]?.packages.items.first(where: { $0.id == next.id })?.image_path {
                ProductImageCache.shared.store(image, path: path)
            }
            dismiss()
        }
    }
}

// MARK: Sprzęt i obsada pakietu

@MainActor struct ProductPackageResourcesSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let packageName: String
    let readOnly: Bool
    let apply: (ProductPackageResourcesItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductPackageResourcesItem
    @State private var tab = "equipment"
    @State private var choosing = false
    @State private var search = ""
    @State private var problem: String?

    init(store: ProductsStore, productID: String, packageName: String, initial: ProductPackageResourcesItem?, readOnly: Bool,
         apply: @escaping (ProductPackageResourcesItem) -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.packageName = packageName
        self.readOnly = readOnly
        self.apply = apply
        _draft = State(initialValue: initial ?? ProductPackageResourcesItem(equipment: [], staff: []))
    }

    private var settings: ProductStaffSnapshot? { store.resources[productID]?.compensation }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sprzęt i obsada pakietu").font(.title3.weight(.semibold))
                Text(packageName.isEmpty ? "Nowy pakiet" : packageName).font(.caption).foregroundStyle(.secondary)
            }
            Text("Zakres na 1 pakiet. Sprzęt i obsada są niezależne od produktu bazowego oraz innych pakietów. Role określają wymagania — konkretne osoby przypiszesz do wydarzenia.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Picker("", selection: $tab) {
                Text("Sprzęt (\(draft.equipment.count))").tag("equipment")
                Text("Obsada (\(ProductText.number(draft.staff.reduce(0) { $0 + $1.quantity })))").tag("staff")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if tab == "equipment" { equipment } else { staff }
                }
                .disabled(readOnly)
            }
            .frame(height: 420)
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button(readOnly ? "Zamknij" : "Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                if !readOnly {
                    Button("Zastosuj zasoby") {
                        if let error = validate() { problem = error; return }
                        apply(draft)
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(18)
        .frame(width: 660)
        .background(theme.page)
        .task { if store.equipmentCatalog == nil { await store.loadEquipmentCatalog() } }
    }

    @ViewBuilder private var equipment: some View {
        if draft.equipment.isEmpty { Text("Brak przypisanego sprzętu.").foregroundStyle(.secondary) }
        ForEach($draft.equipment) { $row in
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.name).font(.callout.weight(.medium))
                    Text(row.equipment_kit_id != nil ? "Zestaw" : "Sprzęt").font(.caption2).foregroundStyle(.secondary)
                    TextField("", text: Binding(get: { row.notes }, set: { row.notes = String($0.prefix(500)) }), prompt: Text("Wymagania i uwagi"))
                        .textFieldStyle(.roundedBorder).controlSize(.small)
                }
                ProductField(label: "Ilość") { ProductNumberField(value: Binding(get: { row.quantity }, set: { row.quantity = $0 ?? 1 })).frame(width: 70) }
                Toggle("Opcjonalny", isOn: $row.is_optional).toggleStyle(.checkbox).padding(.top, 18)
                Button { draft.equipment.removeAll { $0.id == row.id } } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).padding(.top, 18).help("Usuń z pakietu")
            }
            .padding(8)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
        if !readOnly {
            Button { choosing.toggle() } label: { Label(choosing ? "Zamknij katalog" : "Dodaj sprzęt z katalogu", systemImage: "plus") }
                .controlSize(.small).disabled(draft.equipment.count >= 100)
            if choosing { catalog }
        }
    }

    private var catalog: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("Szukaj sprzętu lub zestawu…", text: $search).textFieldStyle(.roundedBorder)
            if let items = store.equipmentCatalog {
                let selected = Set(draft.equipment.map { ($0.equipment_kit_id != nil ? "kit:" : "item:") + ($0.equipment_kit_id ?? $0.equipment_item_id ?? "") })
                let needle = SearchText.fold(search)
                let available = items.filter { !selected.contains(($0.isKit ? "kit:" : "item:") + $0.id) && (needle.isEmpty || SearchText.fold($0.searchText).contains(needle)) }
                ForEach(available.prefix(60)) { item in
                    HStack {
                        WarehouseThumb(url: item.thumbnail, size: 28, symbol: item.isKit ? "shippingbox.fill" : "wrench.and.screwdriver")
                        VStack(alignment: .leading, spacing: 0) {
                            Text(item.name).font(.callout)
                            Text(item.isKit ? "Zestaw" : "Sprzęt").font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Dodaj") {
                            draft.equipment.append(ProductPackageEquipmentItem(id: UUID().uuidString.lowercased(), name: item.name,
                                                                               equipment_item_id: item.isKit ? nil : item.id, equipment_kit_id: item.isKit ? item.id : nil,
                                                                               quantity: 1, is_optional: false, notes: ""))
                        }
                        .controlSize(.small)
                    }
                }
                if available.isEmpty { Text("Brak kolejnych pasujących pozycji. Sprzęt dodany do pakietu jest ukryty w wynikach.").font(.caption).foregroundStyle(.secondary) }
            } else {
                ProgressView("Ładowanie katalogu…").controlSize(.small)
            }
        }
        .padding(8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private var staff: some View {
        if draft.staff.isEmpty { Text("Brak określonej obsady.").foregroundStyle(.secondary) }
        ForEach($draft.staff) { $row in
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 8) {
                    ProductField(label: "Rola") {
                        TextField("", text: Binding(get: { row.role }, set: { row.role = String($0.prefix(120)) }), prompt: Text("Np. krupier, technik, kierowca"))
                            .textFieldStyle(.roundedBorder)
                    }
                    ProductField(label: "Liczba osób") { ProductNumberField(value: Binding(get: { row.quantity }, set: { row.quantity = $0 ?? 1 })).frame(width: 70) }
                    ProductField(label: "Godziny / osobę") { ProductNumberField(value: $row.estimated_hours, nullable: true).frame(width: 80) }
                    Button { draft.staff.removeAll { $0.id == row.id } } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red).padding(.top, 18).help("Usuń rolę")
                }
                TextField("", text: Binding(get: { row.notes }, set: { row.notes = String($0.prefix(500)) }), prompt: Text("Wymagania i uwagi, np. uprawnienia, zadania"))
                    .textFieldStyle(.roundedBorder)
                Toggle("Opcjonalna obsada", isOn: $row.is_optional).toggleStyle(.checkbox)
                ProductCompensationFields(payment: $row.compensation, quantity: row.quantity, hours: row.estimated_hours, optional: row.is_optional, settings: settings)
            }
            .padding(8)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
        if !readOnly {
            Button {
                draft.staff.append(ProductPackageStaffItem(id: UUID().uuidString.lowercased(), role: "", quantity: 1, estimated_hours: nil, is_optional: false, notes: ""))
            } label: { Label("Dodaj rolę", systemImage: "plus") }
            .controlSize(.small).disabled(draft.staff.count >= 40)
        }
    }

    /// Najważniejsze sprawdzenia `validatePackageResources` przed zastosowaniem (pełna walidacja na serwerze przy zapisie pakietu).
    private func validate() -> String? {
        for row in draft.equipment where row.quantity < 1 || row.quantity > 10000 || row.quantity != row.quantity.rounded() {
            return "Podaj całkowitą ilość zasobu od 1 do 10 000."
        }
        for row in draft.staff {
            if row.role.trimmingCharacters(in: .whitespaces).isEmpty { return "Podaj nazwę roli (maks. 120 znaków)." }
            if row.quantity < 1 || row.quantity > 10000 || row.quantity != row.quantity.rounded() { return "Podaj całkowitą ilość zasobu od 1 do 10 000." }
            if let payment = row.compensation {
                if payment.hourly && (row.estimated_hours ?? 0) <= 0 { return "Podaj liczbę godzin dla rozliczenia godzinowego obsady." }
                if payment.settlement_method == "cash_non_deductible" && payment.compensation_snapshot?.valid != true {
                    return "Wczytaj parametry CIT i dywidendy z ustawień wynagrodzeń."
                }
                if (payment.rate ?? -1) < 0 { return "\(row.role): podaj nieujemną stawkę." }
            }
        }
        return nil
    }
}

/// Rozliczenie roli obsady (pakiet): sposób rozliczenia, naliczanie i stawka; koszt dla spółki.
struct ProductCompensationFields: View {
    @Binding var payment: ProductStaffCompensation?
    let quantity: Double
    let hours: Double?
    let optional: Bool
    let settings: ProductStaffSnapshot?
    @State private var basis = "per_service"
    @State private var method = "invoice"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                ProductField(label: "Sposób rozliczenia") {
                    Picker("", selection: Binding(get: { payment?.settlement_method ?? method }, set: { next in
                        method = next
                        guard var current = payment else { return }
                        current.settlement_method = next
                        current.compensation_snapshot = next == "cash_non_deductible" ? (current.compensation_snapshot ?? settings) : nil
                        payment = current
                    })) {
                        ForEach(ProductStaffCost.settlements, id: \.key) { Text($0.label).tag($0.key) }
                    }
                    .labelsHidden()
                }
                ProductField(label: "Naliczanie") {
                    Picker("", selection: Binding(get: { payment?.rate_basis ?? basis }, set: { next in
                        basis = next
                        if var current = payment { current.rate_basis = next; payment = current }
                    })) {
                        Text("Za realizację / osobę").tag("per_service")
                        Text("Za godzinę / osobę").tag("hourly")
                    }
                    .labelsHidden()
                }
                ProductField(label: (payment?.settlement_method ?? method) == "invoice" ? "Stawka netto (zł)" : "Kwota do wypłaty (zł)") {
                    ProductNumberField(value: Binding(get: { payment?.rate }, set: { next in
                        if var current = payment { current.rate = next; payment = current }
                        else if let next {
                            payment = ProductStaffCompensation(rate_basis: basis, rate: next, settlement_method: method,
                                                               compensation_snapshot: method == "cash_non_deductible" ? settings : nil)
                        }
                    }), prompt: "Podaj stawkę", nullable: true).frame(width: 100)
                }
            }
            if payment != nil {
                if payment?.settlement_method == "cash_non_deductible", payment?.compensation_snapshot?.valid != true, let settings, settings.valid {
                    Button("Zastosuj aktualne parametry CIT i dywidendy") { payment?.compensation_snapshot = settings }.buttonStyle(.link).font(.caption)
                }
                Button("Usuń ustaloną stawkę") { payment = nil }.buttonStyle(.link).font(.caption)
            }
            Text("Koszt dla spółki: " + (ProductStaffCost.companyCost(quantity: quantity, hours: hours, compensation: payment).map(ProductText.money)
                                         ?? "uzupełnij stawkę, czas i parametry rozliczenia")
                 + (optional ? " · obsada opcjonalna — koszt nie jest doliczany" : ""))
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

// MARK: Koszty realizacji pakietu

@MainActor struct ProductPackageCostsSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let package: ProductSalesPackageItem
    let readOnly: Bool
    let apply: ([ProductPackageCostItem]?) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var rows: [ProductPackageCostItem]
    @State private var problem: String?

    init(store: ProductsStore, productID: String, package: ProductSalesPackageItem, readOnly: Bool, apply: @escaping ([ProductPackageCostItem]?) -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.package = package
        self.readOnly = readOnly
        self.apply = apply
        _rows = State(initialValue: package.cost_items ?? [])
    }

    private var settings: ProductStaffSnapshot? { store.resources[productID]?.compensation }
    private var staffLines: [ProductPackageStaffItem] { (package.resources?.staff ?? []).filter { !$0.is_optional && $0.compensation != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Koszty realizacji pakietu").font(.title3.weight(.semibold))
                Text(package.name.isEmpty ? "Nowy pakiet" : package.name).font(.caption).foregroundStyle(.secondary)
            }
            Text("Wewnętrzna kalkulacja kosztu spółki na 1 pakiet. Koszty obsady ze stawek przy rolach są doliczane automatycznie. Tutaj dodaj pozostałe koszty, np. sprzęt, transport lub logistykę. Koszty nie zwiększają ceny sprzedaży i nie są drukowane w ofercie.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if !staffLines.isEmpty {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Obsada — naliczana automatycznie").font(.caption.weight(.semibold))
                            ForEach(staffLines) { row in
                                HStack {
                                    Text(row.role)
                                    Spacer()
                                    Text(ProductStaffCost.companyCost(quantity: row.quantity, hours: row.estimated_hours, compensation: row.compensation)
                                        .map(ProductText.money) ?? "uzupełnij parametry").monospacedDigit()
                                }
                                .font(.caption)
                            }
                            Text("Te stawki zmienisz w „Sprzęt i obsada”.").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(8)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                    ForEach($rows) { $row in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top, spacing: 8) {
                                ProductField(label: "Nazwa kosztu") {
                                    TextField("", text: Binding(get: { row.name }, set: { row.name = String($0.prefix(120)) }), prompt: Text("Np. obsługa krupierska"))
                                        .textFieldStyle(.roundedBorder)
                                }
                                Button { rows.removeAll { $0.id == row.id } } label: { Image(systemName: "trash") }
                                    .buttonStyle(.borderless).foregroundStyle(.red).padding(.top, 18)
                            }
                            HStack(alignment: .top, spacing: 8) {
                                ProductField(label: "Sposób rozliczenia") {
                                    Picker("", selection: Binding(get: { row.settlement_method ?? "invoice" }, set: { next in
                                        row.settlement_method = next
                                        row.compensation_snapshot = next == "cash_non_deductible" ? (settings ?? row.compensation_snapshot) : nil
                                    })) {
                                        ForEach(ProductStaffCost.settlements, id: \.key) { Text($0.label).tag($0.key) }
                                    }
                                    .labelsHidden()
                                }
                                ProductField(label: "Ilość") { ProductNumberField(value: Binding(get: { row.quantity }, set: { row.quantity = $0 ?? 0 })).frame(width: 80) }
                                ProductField(label: (row.settlement_method ?? "invoice") == "invoice" ? "Stawka netto (zł)" : "Kwota do wypłaty / szt. (zł)") {
                                    ProductNumberField(value: Binding(get: { row.unit_cost_net }, set: { row.unit_cost_net = $0 ?? 0 })).frame(width: 110)
                                }
                            }
                            Text("Koszt spółki: " + (ProductPackageCosts.line(row).map(ProductText.money) ?? "nieustalony")).font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(8)
                        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }
                    if !readOnly {
                        Button {
                            rows.append(ProductPackageCostItem(id: UUID().uuidString.lowercased(), name: "", quantity: 1, unit_cost_net: 0, settlement_method: "invoice", compensation_snapshot: nil))
                        } label: { Label("Dodaj koszt", systemImage: "plus") }
                        .controlSize(.small).disabled(rows.count >= 40)
                    }
                }
                .disabled(readOnly)
            }
            .frame(height: 400)
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                Spacer()
                Button(readOnly ? "Zamknij" : "Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                if !readOnly {
                    Button("Zastosuj koszty") {
                        if rows.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) { problem = "Podaj nazwę kosztu (maks. 120 znaków)."; return }
                        if rows.contains(where: { $0.quantity <= 0 }) { problem = "Podaj dodatnią ilość kosztu z maksymalnie dwoma miejscami po przecinku."; return }
                        if rows.contains(where: { $0.settlement_method == "cash_non_deductible" && $0.compensation_snapshot?.valid != true }) {
                            problem = "Wczytaj parametry CIT i dywidendy z ustawień wynagrodzeń."
                            return
                        }
                        apply(rows)
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(18)
        .frame(width: 620)
        .background(theme.page)
    }
}
