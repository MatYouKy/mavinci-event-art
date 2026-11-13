import SwiftUI

// MARK: Karta produktu (`/crm/offers/products/[id]`, `ProductDetailPage.tsx`) — nagłówek z czynnościami (PL → EN, usunięcie),
// gotowość do oferty z „Nie dotyczy” i przejściem do braków, sekcje z podglądem i edycją jak `ProductDataSection` w CRM:
// podstawowe informacje, prezentacja w ofercie PDF z grafiką, ustawienia wyceny, ceny i koszty, warunki techniczne,
// podwykonawca i tagi. Pozostałe sekcje karty (warianty, pakiety, sprzęt, obsada, klauzule…) — na razie w CRM.

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

    var detail: ProductDetail? { store.details[productID] }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let detail {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            ProductHeroSection(store: store, detail: detail, editing: editing != nil) { imageSheet = true }
                                .id("product-section-hero")
                            ProductReadinessPanel(store: store, detail: detail) { check in show(check, proxy: proxy) }
                            ViewThatFits(in: .horizontal) {
                                HStack(alignment: .top, spacing: 14) {
                                    VStack(spacing: 14) { mainSections(detail) }.frame(minWidth: 560, maxWidth: .infinity)
                                    VStack(spacing: 14) { sideSections(detail) }.frame(width: 440)
                                }
                                VStack(spacing: 14) {
                                    mainSections(detail)
                                    sideSections(detail)
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: 1280, alignment: .leading)
                        .frame(maxWidth: .infinity)
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
                    .disabled(editing != nil || !state.canWrite)
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

    // MARK: Układ sekcji (lewa kolumna — treść oferty, prawa — ustawienia jak szuflady w CRM)
    @ViewBuilder func mainSections(_ detail: ProductDetail) -> some View {
        basicSection(detail).id("product-section-basic")
        presentationSection(detail).id("product-section-presentation")
        ProductResourcesBlock(store: store, productID: productID)
        crmSections(detail)
    }

    @ViewBuilder func sideSections(_ detail: ProductDetail) -> some View {
        if !detail.packagePricing { pricingUnitsSection(detail) }
        pricingSection(detail).id("product-section-pricing")
        technicalSection(detail)
        supplierSection(detail)
        tagsSection(detail)
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
            }
        }
    }

    /// „Uzupełnij” / „Pokaż” przy braku: sekcja na Macu (z edycją) albo karta w CRM dla sekcji, których tu jeszcze nie ma.
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
        case "product-section-equipment", "product-section-staff", "product-section-clauses":
            // Sekcje części B — gdy produkt ma pakiety, sprzęt i obsada są w pakietach (na razie w CRM).
            if let resources = store.resources[productID], !(resources.packages && check.anchor != "product-section-clauses") {
                withAnimation { proxy.scrollTo(check.anchor, anchor: .top) }
            } else {
                state.openCRM("/crm/offers/products/\(productID)")
            }
        default:
            state.openCRM("/crm/offers/products/\(productID)")
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
