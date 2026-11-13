import SwiftUI

// MARK: Sekcje karty produktu — podgląd i edycja jak w `ProductDetailPage.tsx` (te same etykiety, podpowiedzi i przeliczenia).

extension ProductCardView {
    private func card<Viewer: View, Editor: View>(_ section: String, _ title: String, subtitle: String? = nil, _ detail: ProductDetail,
                                                  @ViewBuilder viewer: () -> Viewer, @ViewBuilder editor: () -> Editor) -> some View {
        ProductSectionCard(title, subtitle: subtitle, editing: editing == section, canEdit: detail.canEdit,
                           locked: editing != nil || !state.canWrite,
                           onEdit: { begin(section, detail) }, onCancel: { cancel() }, onSave: { save(section) },
                           viewer: viewer, editor: editor)
    }

    // MARK: Podstawowe informacje
    func basicSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        let personnel = ProductValue.flag(product, "is_personnel_service")
        return card("basic", "Podstawowe informacje", detail) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(detail.name.isEmpty ? "Nowy produkt" : detail.name).font(.title3.bold()).textSelection(.enabled)
                    Spacer()
                    Text(detail.active ? "Aktywny" : "Nieaktywny").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background((detail.active ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
                        .foregroundStyle(detail.active ? Color.green : Color.secondary)
                }
                Text(detail.categoryName ?? "Bez kategorii").font(.callout).foregroundStyle(.secondary)
                let description = ProductValue.text(product, "description")
                Text(description.isEmpty ? "Brak opisu produktu." : description)
                    .foregroundStyle(description.isEmpty ? .secondary : .primary).textSelection(.enabled)
                if personnel {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Usługa personelu — bez sprzętu").font(.callout.weight(.medium))
                        Text(detail.active ? "Dostępny w kalkulacji: Ludzie → Usługi personelu z katalogu."
                                           : "Aktywuj produkt, aby pojawił się w katalogu usług personelu kalkulacji.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        } editor: {
            VStack(alignment: .leading, spacing: 10) {
                ProductField(label: "Nazwa produktu") { TextField("", text: text("name")).textFieldStyle(.roundedBorder) }
                ProductField(label: "Kategoria") {
                    Picker("", selection: text("category_id")) {
                        Text("Bez kategorii").tag("")
                        ForEach(detail.categories) { item in Text(item.name).tag(item.id) }
                    }
                    .labelsHidden().fixedSize()
                }
                ProductField(label: "Opis produktu") { ProductTextArea(text: text("description"), lines: 4...10) }
                Toggle("Produkt aktywny", isOn: flag("is_active"))
                Toggle("Usługa personelu — bez sprzętu", isOn: flag("is_personnel_service"))
            }
        }
    }

    // MARK: Prezentacja w ofercie PDF
    private func pageVariantLabel(_ variant: String, _ detail: ProductDetail) -> String {
        let blocked = detail.facts.compactBlockReason != nil
        let effective = variant == "compact" && blocked ? "default"
            : detail.facts.stage && variant != "compact" ? "default" : (variant.isEmpty ? "default" : variant)
        if effective == "compact" { return "Kompaktowy" }
        if detail.facts.stage { return "Rozbudowany" }
        return effective == "visual" ? "Duża grafika" : "Osobna strona"
    }

    func presentationSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        let blocked = detail.facts.compactBlockReason
        return card("presentation", "Prezentacja w ofercie PDF", detail) {
            VStack(alignment: .leading, spacing: 12) {
                presentationText("Zdanie pod tytułem", ProductValue.text(product, "offer_short_description"), empty: "Brak zdania pod tytułem.")
                presentationText("Opis rozszerzony", ProductValue.text(product, "offer_description"), empty: "Brak opisu rozszerzonego.")
                DisclosureGroup("Pełny opis na stronie produktu") {
                    let full = ProductValue.text(product, "public_description")
                    Text(full.isEmpty ? "Brak osobnego opisu publicznego." : full)
                        .foregroundStyle(full.isEmpty ? .secondary : .primary).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                }
                .font(.callout)
                if let blocked {
                    Text("\(blocked) Opis kompaktowy nie jest używany.").font(.caption).foregroundStyle(.secondary)
                } else {
                    presentationText("Opis kompaktowy", ProductValue.text(product, "offer_compact_description"),
                                     empty: "Nie uzupełniono — używany jest skrócony opis rozszerzony.")
                }
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                    ProductFactRow(label: "Układ PDF", value: pageVariantLabel(ProductValue.text(product, "offer_page_variant"), detail))
                    ProductFactRow(label: "Czas usługi", value: ProductValue.number(product, "service_duration_hours").map { "\(ProductText.number($0)) godz." } ?? "Nie określono")
                    ProductFactRow(label: "Dodatkowa godzina netto", value: detail.facts.individualExtensionRates
                                   ? "Ustalana osobno dla elementu lub pakietu"
                                   : ProductValue.number(product, "extension_price_net_per_hour").map { "\(ProductText.number($0)) zł" } ?? "Nie określono")
                }
                .font(.callout)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Korzyści").font(.caption).foregroundStyle(.secondary)
                    let benefits = ProductValue.list(product, "offer_benefits")
                    if benefits.isEmpty {
                        Text("Brak wpisanych korzyści.").foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(benefits.enumerated()), id: \.offset) { _, benefit in
                            Label(benefit, systemImage: "checkmark").labelStyle(.titleAndIcon)
                        }
                    }
                }
                presentationText("Link „Zobacz więcej”", ProductValue.text(product, "product_page_url"), empty: "Nie ustawiono")
            }
        } editor: {
            presentationEditor(detail)
        }
    }

    private func presentationText(_ label: String, _ value: String, empty: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? empty : value).foregroundStyle(value.isEmpty ? .secondary : .primary).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func presentationEditor(_ detail: ProductDetail) -> some View {
        let blocked = detail.facts.compactBlockReason
        let stage = detail.facts.stage
        let compact = ProductValue.text(draft, "offer_compact_description")
        VStack(alignment: .leading, spacing: 10) {
            ProductField(label: "Lead — wspólne zdanie pod tytułem") {
                TextField("", text: text("offer_short_description", limit: 220), prompt: Text("Jedno zdanie wyjaśniające wartość produktu"))
                    .textFieldStyle(.roundedBorder)
            }
            ProductField(label: "Opis rozszerzony — osobna strona i duża grafika") {
                ProductTextArea(text: text("offer_description"), prompt: "Zakres, sposób realizacji i najważniejsze informacje dla klienta", lines: 4...12)
            }
            ProductField(label: "Pełny opis na publicznej stronie produktu",
                         help: "Widoczny na /produkty/[id]. Nie jest skracany do miejsca w PDF. Oddzielaj części pustą linią; tytuł części wpisz w pierwszym wierszu.") {
                ProductTextArea(text: text("public_description", limit: 16000), prompt: "Szczegółowy opis usługi, zakres, opcje i warunki realizacji", lines: 6...16)
            }
            ProductField(label: "Krótki opis do oferty kompaktowej",
                         help: blocked.map { "\($0) Krótki opis nie jest używany. Zachowamy go na wypadek zmiany konfiguracji." }
                            ?? "\(compact.count)/330 znaków. Tylko dla układu do 3 produktów na stronie; podgląd uwzględnia miejsce w szablonie.") {
                ProductTextArea(text: text("offer_compact_description", limit: 330), prompt: "Samodzielny, zwięzły opis produktu i najważniejszej korzyści", lines: 3...6)
                    .disabled(blocked != nil)
            }
            if blocked == nil && compact.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Uzupełnij osobny krótki opis. Do tego czasu wersja kompaktowa korzysta ze skróconego opisu rozszerzonego, tak jak dotychczas.")
                    .font(.caption).foregroundStyle(.orange)
            }
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Czas usługi (godziny)") { ProductNumberField(value: number("service_duration_hours"), prompt: "np. 6", nullable: true) }
                ProductField(label: "Każda dodatkowa godzina netto") {
                    ProductNumberField(value: number("extension_price_net_per_hour"), prompt: "np. 500", nullable: true, suffix: "zł")
                        .disabled(detail.facts.individualExtensionRates)
                }
            }
            Text(detail.facts.individualExtensionRates
                 ? "Wspólna stawka przedłużenia jest wyłączona. Ustaw ją osobno w elemencie, wariancie lub pakiecie. Dotychczasowa wartość pozostaje zachowana. Czas usługi nadal jest domyślny dla produktu."
                 : "Stawka dotyczy każdej dodatkowej godziny całej usługi. Pozostaw puste pole, jeśli nie chcesz podawać kosztu przedłużenia.")
                .font(.caption).foregroundStyle(.secondary)
            ProductField(label: "Korzyści (jedna w wierszu)") {
                ProductTextArea(text: text("offer_benefits"), prompt: "Czytelny obraz dla uczestników\nObsługa techniczna podczas wydarzenia", lines: 3...10)
            }
            ProductField(label: "Link „Zobacz więcej”", help: "W PDF pojawi się klikalny odnośnik do rozszerzonego opisu i galerii produktu.") {
                TextField("", text: text("product_page_url"), prompt: Text("https://mavinci.pl/uslugi/streaming lub https://www.eventrulers.pl/..."))
                    .textFieldStyle(.roundedBorder)
            }
            ProductField(label: "Wariant strony",
                         help: stage
                            ? "Kompaktowy zachowuje kartę ze zdjęciem i skróconym opisem, do trzech produktów na stronie. Rozbudowany zachowuje pełną stronę ze zdjęciem i opisem oraz pokazuje wybrane elementy i ilości w zakresie. Zdjęcia komponentów nie są dodawane."
                            : blocked ?? "Wariant kompaktowy grupuje kolejne produkty po maksymalnie trzy na jednej stronie PDF.") {
                Picker("", selection: Binding(get: {
                    let value = ProductValue.text(draft, "offer_page_variant")
                    if stage { return value == "compact" ? "compact" : "default" }
                    if value == "compact" && blocked != nil { return "default" }
                    return value.isEmpty ? "default" : value
                }, set: { draft["offer_page_variant"] = .string($0) })) {
                    Text(stage ? "Rozbudowany — pełna strona ze zdjęciem, opisem i zakresem" : "Domyślny").tag("default")
                    if blocked == nil { Text("Kompaktowy — do 3 produktów na stronie").tag("compact") }
                    if !stage { Text("Duża grafika").tag("visual") }
                }
                .labelsHidden().fixedSize()
            }
            Text("Zdjęcie do oferty zmienisz przyciskiem „Edytuj grafikę” na górze karty.").font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Ustawienia wyceny
    func pricingUnitsSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        return card("pricing_units", "Ustawienia wyceny", subtitle: "Jednostka rozliczenia i minimalna ilość produktu.", detail) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                ProductFactRow(label: "Jednostka", value: ProductValue.text(product, "unit").isEmpty ? "—" : ProductValue.text(product, "unit"))
                ProductFactRow(label: "Minimalna ilość", value: ProductText.number(ProductValue.number(product, "min_quantity") ?? 1))
                ProductFactRow(label: "Sposób wyliczania ilości", value: ProductText.quantitySources.first { $0.key == ProductValue.text(product, "quantity_source") }?.label
                               ?? "Ilość wpisywana ręcznie")
            }
            .font(.callout)
        } editor: {
            VStack(alignment: .leading, spacing: 10) {
                ProductField(label: "Sposób wyliczania ilości") {
                    Picker("", selection: Binding(get: { ProductValue.text(draft, "quantity_source").isEmpty ? "manual" : ProductValue.text(draft, "quantity_source") },
                                                  set: { draft["quantity_source"] = .string($0) })) {
                        ForEach(ProductText.quantitySources, id: \.key) { item in Text(item.label).tag(item.key) }
                    }
                    .labelsHidden().fixedSize()
                }
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Jednostka") { TextField("", text: text("unit", limit: 40)).textFieldStyle(.roundedBorder) }
                    ProductField(label: "Minimalna ilość") { ProductNumberField(value: amount("min_quantity")) }
                }
                Text("Jednostka pojawia się w kalkulacji, np. szt., godz. lub usługa. Domyślna minimalna ilość wynosi 1.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Ceny i koszty
    private func value(_ fields: [String: JSONValue], _ key: String, _ fallback: String? = nil) -> Double {
        ProductValue.number(fields, key) ?? fallback.flatMap { ProductValue.number(fields, $0) } ?? 0
    }

    func pricingSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        let packages = detail.packagePricing
        return card("pricing", "Ceny i koszty", subtitle: packages ? "Ceny i koszty poszczególnych pakietów oraz wspólna stawka VAT." : "Cena sprzedaży, koszty realizacji, transport i logistyka.", detail) {
            if packages {
                VStack(alignment: .leading, spacing: 6) {
                    Text("VAT: \(ProductText.number(value(product, "vat_rate")))%. Cena i koszty zależą od wybranego pakietu — zmienisz je przez menu pakietu → „Edytuj” (na razie w CRM). Koszty bazowe nie są dziedziczone przez pakiety.")
                        .font(.callout).foregroundStyle(.secondary)
                    ForEach(Array(detail.facts.packageNames.enumerated()), id: \.offset) { _, name in
                        Label(name, systemImage: "shippingbox").font(.callout)
                    }
                }
            } else {
                pricingFacts(detail)
            }
        } editor: {
            pricingEditor(packages: packages)
        }
    }

    private func pricingFacts(_ detail: ProductDetail) -> some View {
        let product = detail.product
        let net = value(product, "price_net")
        let cost = value(product, "cost_net")
        let transport = value(product, "transport_cost_net")
        let logistics = value(product, "logistics_cost_net")
        let staff = detail.facts.staffCostNet
        return Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
            ProductFactRow(label: "Cena sprzedaży", value: "\(ProductText.number(net)) zł netto / \(ProductText.number(value(product, "price_gross"))) zł brutto")
            ProductFactRow(label: "Pozostały koszt realizacji (bez obsady)", value: "\(ProductText.number(cost)) zł netto / \(ProductText.number(value(product, "cost_gross"))) zł brutto")
            ProductFactRow(label: "Transport", value: "\(ProductText.number(transport)) zł netto")
            ProductFactRow(label: "Logistyka", value: "\(ProductText.number(logistics)) zł netto")
            ProductFactRow(label: "VAT", value: "\(ProductText.number(value(product, "vat_rate")))%")
            ProductFactRow(label: "Obsada — koszt dla firmy", value: staff.map { "\(ProductText.number($0)) zł" } ?? "Uzupełnij rozliczenie obsady")
            ProductFactRow(label: "Marża po koszcie realizacji i obsady", value: staff.map { staff in
                net > 0 ? String(format: "%.1f%%", (net - cost - staff) / net * 100).replacingOccurrences(of: ".", with: ",") : "0%"
            } ?? "Nieustalona")
            ProductFactRow(label: "Cena z transportem i logistyką", value: "\(ProductText.number(net + transport + logistics)) zł netto")
            ProductFactRow(label: "Koszt łącznie z obsadą, transportem i logistyką",
                           value: staff.map { "\(ProductText.number(cost + $0 + transport + logistics)) zł" } ?? "Nieustalony — uzupełnij obsadę")
        }
        .font(.callout)
    }

    private func round2(_ value: Double) -> Double { ((value + .ulpOfOne) * 100).rounded() / 100 }
    private var vatMultiplier: Double { 1 + (ProductValue.number(draft, "vat_rate") ?? 0) / 100 }

    /// Pole netto lub brutto powiązane z drugim przez stawkę VAT (jak `ProductPricingPanel` w CRM).
    private func linked(_ key: String, _ pair: String, gross: Bool, fallback: String? = nil) -> Binding<Double?> {
        Binding(get: {
            if let value = ProductValue.number(draft, key) { return round2(value) }
            if gross, let net = ProductValue.number(draft, pair) ?? fallback.flatMap({ ProductValue.number(draft, $0) }) { return round2(net * vatMultiplier) }
            return round2(fallback.flatMap { ProductValue.number(draft, $0) } ?? 0)
        }, set: { next in
            let amount = next ?? 0
            draft[key] = .number(amount)
            draft[pair] = .number(round2(gross ? amount / vatMultiplier : amount * vatMultiplier))
        })
    }

    @ViewBuilder private func pricingEditor(packages: Bool) -> some View {
        let multiplierBinding = Binding<Double?>(get: { ProductValue.number(draft, "vat_rate") ?? 0 }, set: { next in
            let rate = next ?? 0
            let multiplier = 1 + rate / 100
            let net = value(draft, "price_net", "base_price")
            let cost = value(draft, "cost_net", "cost_price")
            draft["vat_rate"] = .number(rate)
            draft["price_gross"] = .number(round2(net * multiplier))
            draft["cost_gross"] = .number(round2(cost * multiplier))
            draft["transport_cost_gross"] = .number(round2(value(draft, "transport_cost_net") * multiplier))
            draft["logistics_cost_gross"] = .number(round2(value(draft, "logistics_cost_net") * multiplier))
        })
        VStack(alignment: .leading, spacing: 10) {
            ProductField(label: "Stawka VAT (%)") { ProductNumberField(value: multiplierBinding, suffix: "%").frame(maxWidth: 160) }
            if packages {
                Text("Ceny i koszty ustalisz oddzielnie w edycji każdego pakietu. Tutaj ustawiasz wspólną stawkę VAT.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Cena netto") { ProductNumberField(value: linked("price_net", "price_gross", gross: false, fallback: "base_price"), suffix: "zł") }
                    ProductField(label: "Cena brutto") { ProductNumberField(value: linked("price_gross", "price_net", gross: true, fallback: "base_price"), suffix: "zł") }
                }
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Koszt netto") { ProductNumberField(value: linked("cost_net", "cost_gross", gross: false, fallback: "cost_price"), suffix: "zł") }
                    ProductField(label: "Koszt brutto") { ProductNumberField(value: linked("cost_gross", "cost_net", gross: true, fallback: "cost_price"), suffix: "zł") }
                }
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Transport netto") { ProductNumberField(value: linked("transport_cost_net", "transport_cost_gross", gross: false), suffix: "zł") }
                    ProductField(label: "Logistyka netto") { ProductNumberField(value: linked("logistics_cost_net", "logistics_cost_gross", gross: false), suffix: "zł") }
                }
                pricingSummary
            }
        }
    }

    private var pricingSummary: some View {
        let net = value(draft, "price_net", "base_price")
        let cost = value(draft, "cost_net", "cost_price")
        let extra = value(draft, "transport_cost_net") + value(draft, "logistics_cost_net")
        let margin = net > 0 ? (net - cost) / net * 100 : 0
        return Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
            GridRow {
                Text("Marża:").foregroundStyle(.secondary)
                Text(String(format: "%.1f%%", margin).replacingOccurrences(of: ".", with: ",") + " (\(ProductText.number(net - cost)) zł netto)")
                    .foregroundStyle(margin >= 0 ? Color.green : Color.red)
            }
            ProductFactRow(label: "Całkowity koszt:", value: "\(ProductText.number(cost + extra)) zł netto")
            ProductFactRow(label: "Całkowita cena:", value: "\(ProductText.number(net + extra)) zł netto")
        }
        .font(.callout)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Warunki techniczne i logistyka
    func technicalSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        return card("technical", "Warunki techniczne i logistyka", subtitle: "Transport, montaż, demontaż i ograniczenia realizacji.", detail) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                ProductFactRow(label: "Pojazd", value: ProductValue.flag(product, "requires_vehicle") ? "Wymagany" : "Niewymagany")
                ProductFactRow(label: "Kierowca", value: ProductValue.flag(product, "requires_driver") ? "Wymagany" : "Niewymagany")
                ProductFactRow(label: "Montaż", value: "\(ProductText.number(value(product, "setup_time_hours"))) h")
                ProductFactRow(label: "Demontaż", value: "\(ProductText.number(value(product, "teardown_time_hours"))) h")
                ProductFactRow(label: "Maksymalna ilość", value: ProductValue.number(product, "max_quantity").map(ProductText.number) ?? "Bez limitu")
            }
            .font(.callout)
        } editor: {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Wymaga pojazdu", isOn: flag("requires_vehicle"))
                Toggle("Wymaga kierowcy", isOn: flag("requires_driver"))
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Montaż (h)") { ProductNumberField(value: amount("setup_time_hours")) }
                    ProductField(label: "Demontaż (h)") { ProductNumberField(value: amount("teardown_time_hours")) }
                    ProductField(label: "Maksymalna ilość") { ProductNumberField(value: number("max_quantity"), prompt: "Bez limitu", nullable: true) }
                }
            }
        }
    }

    // MARK: Podwykonawca
    func supplierSection(_ detail: ProductDetail) -> some View {
        let product = detail.product
        let organization = ProductValue.text(product, "subcontractor_id")
        return card("supplier", "Podwykonawca", subtitle: "Powiązanie produktu z zewnętrzną usługą.", detail) {
            VStack(alignment: .leading, spacing: 4) {
                Text(ProductValue.flag(product, "is_subcontractor_service") ? "Usługa realizowana przez podwykonawcę" : "Realizacja własna").font(.callout)
                if !organization.isEmpty {
                    Text(detail.subcontractors.first { $0.id == organization }?.name ?? "Podwykonawca spoza listy aktywnych")
                        .font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                }
                let serviceID = ProductValue.text(product, "subcontractor_service_catalog_id")
                if let service = detail.services.first(where: { $0.id == serviceID }) {
                    Text(service.label).font(.caption).foregroundStyle(.secondary)
                }
            }
        } editor: {
            supplierEditor(detail)
        }
    }

    @ViewBuilder private func supplierEditor(_ detail: ProductDetail) -> some View {
        let on = ProductValue.flag(draft, "is_subcontractor_service")
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Usługa od podwykonawcy", isOn: Binding(get: { on }, set: { checked in
                draft["is_subcontractor_service"] = .bool(checked)
                if !checked {
                    for key in ["subcontractor_id", "subcontractor_service_catalog_id", "subcontractor_settlement_method", "subcontractor_economic_cost"] {
                        draft[key] = .null
                    }
                    services = []
                }
            }))
            if on {
                ProductField(label: "Podwykonawca") {
                    Picker("", selection: Binding(get: { ProductValue.text(draft, "subcontractor_id") }, set: { next in
                        draft["subcontractor_id"] = next.isEmpty ? .null : .string(next)
                        services = []
                        guard !next.isEmpty else { return }
                        loadingServices = true
                        Task {
                            let list = await store.services(organization: next)
                            if ProductValue.text(draft, "subcontractor_id") == next { services = list }
                            loadingServices = false
                        }
                    })) {
                        Text("-- Wybierz podwykonawcę --").tag("")
                        ForEach(detail.subcontractors) { item in Text(item.name).tag(item.id) }
                    }
                    .labelsHidden().fixedSize()
                }
                if !ProductValue.text(draft, "subcontractor_id").isEmpty {
                    ProductField(label: "Usługa", help: "Wybór usługi ustawia cenę, koszt, VAT i sposób rozliczenia jak w CRM.") {
                        HStack {
                            Picker("", selection: Binding(get: { ProductValue.text(draft, "subcontractor_service_catalog_id") },
                                                          set: { applySupplierService($0) })) {
                                Text("-- Wybierz usługę --").tag("")
                                ForEach(services) { item in Text(item.label).tag(item.id) }
                            }
                            .labelsHidden()
                            if loadingServices { ProgressView().controlSize(.small) }
                        }
                    }
                }
            }
        }
    }

    /// Cena, koszt, VAT i rozliczenie z usługi podwykonawcy (`applySupplierService` w CRM).
    private func applySupplierService(_ serviceID: String) {
        guard let service = services.first(where: { $0.id == serviceID }) else {
            draft["subcontractor_service_catalog_id"] = serviceID.isEmpty ? .null : .string(serviceID)
            return
        }
        func positive(_ value: Double?) -> Double? { value.flatMap { $0 != 0 ? $0 : nil } }
        let equipment = service.isEquipment
        let cash = !equipment && service.settlementMethod == "cash_non_deductible"
        let gross = equipment ? (positive(service.dailyPriceGross) ?? positive(service.rentalPricePerDay) ?? 0)
                              : (positive(service.priceGross) ?? positive(service.unitPrice) ?? 0)
        let supplierVat = service.vatRate ?? 23
        let net = positive(equipment ? service.dailyPriceNet : service.priceNet) ?? gross / (1 + supplierVat / 100)
        let currentVat = ProductValue.number(draft, "vat_rate") ?? 23
        let vat = !equipment && service.settlementMethod != "invoice" ? (currentVat == 0 ? 23 : currentVat) : supplierVat
        let cost = service.economicCost ?? net
        draft["subcontractor_service_catalog_id"] = .string(serviceID)
        draft["base_price"] = .number(net)
        draft["price_net"] = .number(net)
        draft["price_gross"] = .number(round2(net * (1 + vat / 100)))
        draft["cost_net"] = .number(cost)
        draft["cost_gross"] = .number(cash ? cost : gross)
        draft["vat_rate"] = .number(vat)
        draft["subcontractor_settlement_method"] = equipment ? .null : .string(service.settlementMethod ?? "invoice")
        draft["subcontractor_economic_cost"] = equipment ? .null : .number(cost)
    }

    // MARK: Tagi
    func tagsSection(_ detail: ProductDetail) -> some View {
        let tags = ProductValue.list(detail.product, "tags")
        return card("tags", "Tagi i wyszukiwanie", subtitle: "Słowa ułatwiające odnalezienie produktu.", detail) {
            if tags.isEmpty {
                Text("Brak tagów.").foregroundStyle(.secondary)
            } else {
                ProductTagFlow(tags: tags)
            }
        } editor: {
            ProductField(label: "Tagi oddzielone przecinkami") { TextField("", text: text("tags")).textFieldStyle(.roundedBorder) }
        }
    }

    // MARK: Sekcje, które są jeszcze tylko w CRM
    func crmSections(_ detail: ProductDetail) -> some View {
        let items: [(String, String)] = [
            ("Warianty i elementy", detail.facts.variants > 0 ? "\(detail.facts.variants)" : "brak"),
            ("Pakiety sprzedaży", detail.facts.packages > 0 ? "\(detail.facts.packages)" : "wyłączone"),
            ("Dodatki i limity", detail.facts.addons > 0 ? "\(detail.facts.addons)" : "brak"),
            ("Przygotowanie i zamówienia", ""), ("Wymagania dodatkowe", ""), ("Powiązane usługi", ""), ("Kadrowanie zdjęć w ofercie", ""),
        ]
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pozostałe sekcje karty").font(.headline)
                    Text("Te części karty produktu dodamy na Macu w kolejnych etapach — do tego czasu zmienisz je w CRM.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { state.openCRM("/crm/offers/products/\(productID)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                    .controlSize(.small)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), alignment: .leading)], alignment: .leading, spacing: 6) {
                ForEach(items.indices, id: \.self) { index in
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.forward.square").foregroundStyle(.secondary)
                        Text(items[index].0)
                        if !items[index].1.isEmpty { Text("(\(items[index].1))").foregroundStyle(.secondary) }
                    }
                    .font(.callout)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }
}

/// Tagi produktu jako etykiety zawijane do szerokości karty.
struct ProductTagFlow: View {
    let tags: [String]
    var body: some View {
        ProductFlowLayout(spacing: 6) {
            ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                Text(tag).font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.primary.opacity(0.08), in: Capsule())
            }
        }
    }
}

/// Prosty układ „zawijany” (kolejne elementy w wierszu, nowy wiersz po przekroczeniu szerokości).
struct ProductFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += line + spacing; line = 0 }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
