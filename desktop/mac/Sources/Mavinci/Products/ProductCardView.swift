import SwiftUI

// MARK: Karta produktu (`/crm/offers/products/[id]`, `ProductDetailPage.tsx`) — nagłówek z czynnościami (PL → EN, usunięcie),
// gotowość do oferty z „Nie dotyczy” i przejściem do braków, sekcje z podglądem i edycją jak `ProductDataSection` w CRM:
// podstawowe informacje, prezentacja w ofercie PDF z grafiką i propozycją AI, kadrowanie zdjęć, warianty, pakiety, dodatki,
// wymagania, sprzęt, obsada, klauzule, wersja angielska, ustawienia wyceny, ceny i koszty, warunki techniczne, przygotowanie,
// podwykonawca i tagi.

/// Pola sekcji karty — te same listy co `fields` sekcji w CRM i `SECTION_FIELDS` na serwerze.
enum ProductSectionFields {
    static let basic = ["name", "category_id", "description", "is_active", "is_personnel_service"]
    static let presentation = ["offer_short_description", "offer_description", "public_description", "offer_compact_description",
                               "service_duration_hours", "extension_price_net_per_hour", "offer_benefits", "product_page_url", "offer_page_variant"]
    static let pricingUnits = ["unit", "min_quantity", "quantity_source"]
    static let pricing = ["vat_rate", "price_net", "price_gross", "cost_net", "cost_gross", "transport_cost_net", "transport_cost_gross",
                          "logistics_cost_net", "logistics_cost_gross"]
    static let technical = ["requires_vehicle", "requires_driver", "setup_time_hours", "teardown_time_hours", "max_quantity"]
    static let supplier = ["is_subcontractor_service", "subcontractor_id", "subcontractor_service_catalog_id", "subcontractor_settlement_method",
                           "subcontractor_economic_cost", "vat_rate", "price_net", "price_gross", "cost_net", "cost_gross", "transport_cost_net",
                           "transport_cost_gross", "logistics_cost_net", "logistics_cost_gross", "base_price"]
    static let tags = ["tags"]

    static func fields(_ section: String) -> [String] {
        switch section {
        case "basic": return basic
        case "presentation": return presentation
        case "pricing_units": return pricingUnits
        case "pricing": return pricing
        case "technical": return technical
        case "supplier": return supplier
        case "tags": return tags
        default: return []
        }
    }
}

@MainActor struct ProductCardView: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    @EnvironmentObject var state: Workspace
    @Environment(\.crmTheme) var theme
    /// Sekcja w edycji (jedna naraz, jak blokada pozostałych sekcji w CRM) i jej robocza kopia pól.
    @State var editing: String?
    @State var draft: [String: JSONValue] = [:]
    @State var services: [ProductSupplierService] = []
    @State var loadingServices = false
    @State var imageSheet = false
    @State var deleting = false
    /// Robocza propozycja AI dla prezentacji (część C2b) — wypełnia formularz dopiero po „Zastosuj”.
    @State var offerAI: ProductOfferAIDraft?
    @State var offerAIBusy = false

    var detail: ProductDetail? { store.details[productID] }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let detail {
                // Jak karta wydarzenia: treść produktu po lewej, kolumna boczna po prawej (gotowość do oferty, wycena i ceny,
                // warunki techniczne, przygotowanie, podwykonawca, tagi); w wąskim oknie wszystko jedno pod drugim.
                GeometryReader { geometry in
                    ScrollViewReader { proxy in
                        ScrollView {
                            layout(detail, width: geometry.size.width) { check in show(check, proxy: proxy) }
                                .padding(16)
                                .frame(maxWidth: 1600, alignment: .leading)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            } else if let problem = store.detailErrors[productID] {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć produktu", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(productID) } }
                    Button("Wróć do katalogu") { store.openedID = nil }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie produktu…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(detail?.name ?? store.product(productID)?.name ?? "Produkt")
        .task(id: productID) { await store.loadDetail(productID) }
        .onChange(of: detail?.product["subcontractor_id"]) { _, _ in
            if editing != "supplier" { services = detail?.services ?? [] }
        }
        .onAppear { services = detail?.services ?? [] }
        .sheet(isPresented: $imageSheet) {
            if let detail { ProductImageSheet(store: store, detail: detail) }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć produkt „\(detail?.name ?? "")”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Usuń produkt", role: .destructive) { Task { _ = await store.delete(productID) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Ta operacja jest nieodwracalna.")
        }
    }

    // MARK: Nagłówek
    private var header: some View {
        HStack(spacing: 10) {
            Button { store.openedID = nil } label: { Label("Katalog", systemImage: "chevron.left") }
                .help("Wróć do katalogu produktów")
            VStack(alignment: .leading, spacing: 1) {
                Text(detail?.name ?? store.product(productID)?.name ?? "Produkt").font(.headline).lineLimit(1)
                if let category = detail?.categoryName ?? store.product(productID)?.category {
                    Text(category).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let detail, !detail.active {
                Text("Nieaktywny").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.15), in: Capsule()).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await store.loadDetail(productID) } } label: { Image(systemName: "arrow.clockwise") }
                .help("Odśwież kartę produktu")
                .disabled(editing != nil)
            if detail?.canEdit == true {
                Button { Task { await store.translate(productID) } } label: { Label("Przetłumacz PL → EN", systemImage: "character.book.closed") }
                    .disabled(editing != nil || !state.canWrite || (store.englishBusy[productID] ?? 0) > 0)
            }
            Menu {
                Button { state.openCRM("/crm/offers/products/\(productID)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                if detail?.canEdit == true {
                    Divider()
                    Button(role: .destructive) { deleting = true } label: { Label("Usuń…", systemImage: "trash") }
                }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .help("Więcej czynności")
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    // MARK: Układ sekcji
    @ViewBuilder func layout(_ detail: ProductDetail, width: CGFloat, show: @escaping (ProductDetail.Check) -> Void) -> some View {
        let readiness = ProductReadinessPanel(store: store, detail: detail, show: show)
        if width >= 980 {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 14) { mainSections(detail, pairs: width >= 1420) }
                    .frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 14) {
                    readiness
                    sideSections(detail)
                }
                .frame(width: width >= 1400 ? 420 : 380)
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                readiness
                mainSections(detail, pairs: false)
                sideSections(detail)
            }
        }
    }

    /// Treść produktu: zdjęcie i nazwa, informacje, prezentacja w PDF, zdjęcia, warianty, pakiety, dodatki, powiązane usługi,
    /// wymagania, sprzęt, obsada, Mavinci LIVE, klauzule i wersja angielska. Bardzo szerokie okno — dodatki z powiązanymi
    /// usługami i sprzęt z obsadą obok siebie.
    @ViewBuilder func mainSections(_ detail: ProductDetail, pairs: Bool) -> some View {
        ProductHeroSection(store: store, detail: detail, editing: editing != nil) { imageSheet = true }
            .id("product-section-hero")
        basicSection(detail).id("product-section-basic")
        presentationSection(detail).id("product-section-presentation")
        ProductImageCropsSection(store: store, productID: productID, detail: detail, locked: editing != nil || !state.canWrite)
        extrasSections(pairs: pairs)
        resourcesSections(pairs: pairs)
        ProductEnglishSection(store: store, productID: productID, canEdit: detail.canEdit, locked: editing != nil || !state.canWrite,
                              revision: ProductValue.text(detail.product, "updated_at"))
    }

    /// Kolumna boczna (po gotowości do oferty): wycena, ceny i koszty, warunki techniczne, przygotowanie, podwykonawca, tagi.
    @ViewBuilder func sideSections(_ detail: ProductDetail) -> some View {
        if !detail.packagePricing { pricingUnitsSection(detail) }
        pricingSection(detail).id("product-section-pricing")
        technicalSection(detail)
        ProductPreparationSection(store: store, productID: productID)
        supplierSection(detail)
        tagsSection(detail)
    }

    /// Warianty, pakiety, dodatki, powiązane usługi, wymagania (dane `op=extras`); do wczytania — blok z postępem lub błędem.
    @ViewBuilder func extrasSections(pairs: Bool) -> some View {
        if let extras = store.extras[productID] {
            ProductVariantsSection(store: store, productID: productID, extras: extras).id("product-section-variants")
            ProductPackagesSection(store: store, productID: productID, extras: extras).id("product-section-packages")
            ProductPair(wide: pairs) {
                ProductAddonsSection(store: store, productID: productID, extras: extras)
            } right: {
                ProductRelatedSection(store: store, productID: productID, extras: extras)
            }
            ProductRequirementsSection(store: store, productID: productID, extras: extras)
        } else {
            ProductExtrasBlock(store: store, productID: productID).id("product-section-packages")
        }
    }

    /// Zakres wariantów, sprzęt, obsada, Mavinci LIVE i klauzule (dane `op=resources`).
    @ViewBuilder func resourcesSections(pairs: Bool) -> some View {
        if let resources = store.resources[productID] {
            if !resources.variants.isEmpty { ProductScopeCard(store: store, productID: productID, resources: resources) }
            if !resources.packages {
                ProductPair(wide: pairs) {
                    ProductEquipmentSection(store: store, productID: productID, resources: resources).id("product-section-equipment")
                } right: {
                    ProductStaffSection(store: store, productID: productID, resources: resources).id("product-section-staff")
                }
            }
            ProductLiveSection(store: store, productID: productID, resources: resources)
            ProductClausesSection(store: store, productID: productID, resources: resources).id("product-section-clauses")
        } else {
            ProductResourcesBlock(store: store, productID: productID).id("product-section-resources")
        }
    }

    // MARK: Edycja sekcji
    func begin(_ section: String, _ detail: ProductDetail) {
        guard detail.canEdit, editing == nil else { return }
        var next = detail.product
        // Korzyści (jedna w wierszu) i tagi (po przecinku) edytowane jako tekst — lista powstaje przy zapisie.
        if section == "presentation" { next["offer_benefits"] = .string(ProductValue.list(detail.product, "offer_benefits").joined(separator: "\n")) }
        if section == "tags" { next["tags"] = .string(ProductValue.list(detail.product, "tags").joined(separator: ", ")) }
        draft = next
        if section == "supplier" { services = detail.services }
        editing = section
    }

    func cancel() {
        editing = nil
        draft = [:]
        offerAI = nil
        services = detail?.services ?? []
    }

    func save(_ section: String) {
        var patch: [String: JSONValue] = [:]
        for key in ProductSectionFields.fields(section) { patch[key] = draft[key] ?? .null }
        if section == "presentation" {
            patch["offer_benefits"] = .array(ProductValue.text(draft, "offer_benefits").split(separator: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { JSONValue.string($0) })
        }
        if section == "tags" {
            patch["tags"] = .array(ProductValue.text(draft, "tags").split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { JSONValue.string($0) })
        }
        Task {
            if await store.saveSection(productID, section: section, patch: patch) {
                editing = nil
                draft = [:]
                offerAI = nil
            }
        }
    }

    /// „Uzupełnij” / „Pokaż” przy braku: przewinięcie do sekcji na Macu (z edycją). Przy pakietach sprzęt i obsada są w pakiecie
    /// (menu pakietu → „Edytuj” → „Sprzęt i obsada”), więc braki prowadzą do sekcji „Pakiety”.
    func show(_ check: ProductDetail.Check, proxy: ScrollViewProxy) {
        guard let detail else { return }
        switch check.anchor {
        case "product-section-pricing":
            withAnimation { proxy.scrollTo("product-section-pricing", anchor: .top) }
            begin("pricing", detail)
        case "product-section-presentation":
            withAnimation { proxy.scrollTo("product-section-presentation", anchor: .top) }
            if check.key == "image" {
                withAnimation { proxy.scrollTo("product-section-hero", anchor: .top) }
                if detail.canEdit && editing == nil { imageSheet = true }
            } else {
                begin("presentation", detail)
            }
        case "product-section-packages":
            withAnimation { proxy.scrollTo("product-section-packages", anchor: .top) }
        case "product-section-equipment", "product-section-staff":
            if store.resources[productID]?.packages ?? detail.packagePricing {
                withAnimation { proxy.scrollTo("product-section-packages", anchor: .top) }
                state.notice = "Sprzęt i obsadę uzupełnisz w pakiecie: menu pakietu → „Edytuj” → „Sprzęt i obsada”."
            } else {
                withAnimation { proxy.scrollTo(store.resources[productID] == nil ? "product-section-resources" : check.anchor, anchor: .top) }
            }
        case "product-section-clauses":
            withAnimation { proxy.scrollTo(store.resources[productID] == nil ? "product-section-resources" : check.anchor, anchor: .top) }
        default:
            withAnimation { proxy.scrollTo(check.anchor, anchor: .top) }
        }
    }

    // MARK: Wiązania pól roboczej kopii
    func text(_ key: String, limit: Int? = nil) -> Binding<String> {
        Binding(get: { ProductValue.text(draft, key) }, set: { value in
            draft[key] = .string(limit.map { String(value.prefix($0)) } ?? value)
        })
    }
    func flag(_ key: String) -> Binding<Bool> {
        Binding(get: { ProductValue.flag(draft, key) }, set: { draft[key] = .bool($0) })
    }
    /// Liczba; pusta — `null` (np. „Bez limitu”, „Nie określono”).
    func number(_ key: String) -> Binding<Double?> {
        Binding(get: { ProductValue.number(draft, key) }, set: { draft[key] = $0.map { JSONValue.number($0) } ?? .null })
    }
    /// Liczba wymagana — puste pole to 0.
    func amount(_ key: String) -> Binding<Double?> {
        Binding(get: { ProductValue.number(draft, key) ?? 0 }, set: { draft[key] = .number($0 ?? 0) })
    }
}

// MARK: Para sekcji

/// Dwie powiązane sekcje obok siebie (szerokie okno, po połowie szerokości) albo jedna pod drugą.
struct ProductPair<Left: View, Right: View>: View {
    let wide: Bool
    @ViewBuilder var left: Left
    @ViewBuilder var right: Right

    var body: some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 14) { left }.frame(maxWidth: .infinity, alignment: .top)
                VStack(spacing: 14) { right }.frame(maxWidth: .infinity, alignment: .top)
            }
        } else {
            VStack(spacing: 14) {
                left
                right
            }
        }
    }
}

// MARK: Sekcja karty (podgląd / edycja)

@MainActor struct ProductSectionCard<Viewer: View, Editor: View>: View {
    let title: String
    let subtitle: String?
    let editing: Bool
    let canEdit: Bool
    let locked: Bool
    let onEdit: () -> Void
    let onCancel: () -> Void
    let onSave: () -> Void
    let viewer: Viewer
    let editor: Editor
    @Environment(\.crmTheme) private var theme

    init(_ title: String, subtitle: String? = nil, editing: Bool, canEdit: Bool, locked: Bool,
         onEdit: @escaping () -> Void, onCancel: @escaping () -> Void, onSave: @escaping () -> Void,
         @ViewBuilder viewer: () -> Viewer, @ViewBuilder editor: () -> Editor) {
        self.title = title
        self.subtitle = subtitle
        self.editing = editing
        self.canEdit = canEdit
        self.locked = locked
        self.onEdit = onEdit
        self.onCancel = onCancel
        self.onSave = onSave
        self.viewer = viewer()
        self.editor = editor()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if editing {
                    Button("Anuluj", action: onCancel).keyboardShortcut(.cancelAction)
                    Button("Zapisz", action: onSave).buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command)
                } else if canEdit {
                    Button(action: onEdit) { Label("Edytuj", systemImage: "pencil") }
                        .disabled(locked)
                        .help(locked ? "Najpierw zapisz albo anuluj zmiany w innej sekcji." : "Edytuj sekcję")
                }
            }
            .controlSize(.small)
            if editing { editor } else { viewer }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(editing ? theme.accent.opacity(0.6) : Color.primary.opacity(0.08)))
    }
}

/// Pole formularza karty: etykieta nad kontrolką i opcjonalna podpowiedź pod nią.
struct ProductField<Content: View>: View {
    let label: String
    var help: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content
            if let help, !help.isEmpty { Text(help).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Wiersz podglądu sekcji: etykieta i wartość.
struct ProductFactRow: View {
    let label: String
    let value: String
    var body: some View {
        GridRow {
            Text(label).foregroundStyle(.secondary).gridColumnAlignment(.leading)
            Text(value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Pole liczby po polsku (przecinek): wartość zmienia się przy każdym znaku, więc powiązane pola (netto ↔ brutto) od razu
/// się przeliczają; bez fokusu pokazuje bieżącą wartość.
struct ProductNumberField: View {
    @Binding var value: Double?
    var prompt: String = ""
    var nullable = false
    var suffix: String? = nil
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            TextField("", text: $text, prompt: Text(prompt))
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .focused($focused)
                .onAppear { text = Self.format(value) }
                .onChange(of: value) { _, next in if !focused { text = Self.format(next) } }
                .onChange(of: focused) { _, now in if !now { text = Self.format(value) } }
                .onChange(of: text) { _, next in
                    guard focused else { return }
                    if next.trimmingCharacters(in: .whitespaces).isEmpty { value = nullable ? nil : 0; return }
                    if let parsed = ProductText.parse(next) { value = parsed }
                }
            if let suffix { Text(suffix).foregroundStyle(.secondary) }
        }
    }

    static func format(_ value: Double?) -> String { value.map(ProductText.plain) ?? "" }
}

/// Wiele wierszy tekstu w polu z ramką.
struct ProductTextArea: View {
    @Binding var text: String
    var prompt: String = ""
    var lines: ClosedRange<Int> = 3...10
    var body: some View {
        TextField("", text: $text, prompt: Text(prompt), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(lines)
    }
}
