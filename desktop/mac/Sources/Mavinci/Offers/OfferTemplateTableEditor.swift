import SwiftUI

// MARK: Szablony ofert, część F2 — „Tabela wyceny” (`PricingTableConfigEditor`): położenie i marginesy, kolory, obramowanie,
// typografia, widoczne kolumny i ich szerokości z podglądem na przykładowych pozycjach. Zapis `op=templateTableSave`
// (położenie tabeli na tle zostaje).

/// Wygląd tabeli wyceny (`PricingTableConfig`) — nazwy pól jak w bazie.
struct OfferTableConfig: Codable, Equatable {
    var start_y: Double
    var margin_left: Double
    var margin_right: Double
    var header_color: String
    var header_text_color: String
    var row_bg_color: String
    var row_odd_bg_color: String
    var text_color: String
    var border_color: String
    var border_width: Double
    var show_borders: Bool
    var show_horizontal_borders: Bool
    var show_vertical_borders: Bool
    var show_outer_border: Bool
    var header_font_size: Double
    var body_font_size: Double
    var row_height: Double
    var header_height: Double
    var summary_color: String
    var summary_label_color: String
    var show_unit_price_net: Bool
    var show_value_net: Bool
    var show_value_gross: Bool
    var show_vat_column: Bool
    var show_description: Bool
    var vat_rate: Double
    var col_lp_width: Double
    var col_name_width: Double
    var col_qty_width: Double
    var col_unit_width: Double
    var col_unit_price_width: Double
    var col_vat_width: Double
    var col_value_net_width: Double
    var col_value_gross_width: Double
    var summary_separator_thickness: Double
    var table_width: Double

    var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .object([:]) }
        return value
    }

    var visibleColumns: Int {
        4 + [show_unit_price_net, show_vat_column, show_value_net, show_value_gross].filter { $0 }.count
    }
}

@MainActor struct OfferTemplateTableEditor: View {
    @ObservedObject var store: OfferTemplatesStore
    let templateID: String
    let defaults: OfferTableConfig
    /// W edytorze pól (wąski panel) — sekcje nad podglądem.
    var compact = false
    let onSaved: (OfferTableConfig) -> Void
    @EnvironmentObject private var state: Workspace
    @State private var config: OfferTableConfig
    @State private var saving = false

    init(store: OfferTemplatesStore, templateID: String, initial: OfferTableConfig, defaults: OfferTableConfig, compact: Bool = false,
         onSaved: @escaping (OfferTableConfig) -> Void) {
        self.store = store
        self.templateID = templateID
        self.defaults = defaults
        self.compact = compact
        self.onSaved = onSaved
        _config = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if compact {
                settings
                ScrollView(.horizontal) { preview }
            } else {
                HStack(alignment: .top, spacing: 16) {
                    ScrollView { settings }.frame(width: 320)
                    ScrollView([.horizontal, .vertical]) { preview }
                }
            }
            HStack {
                Button { reset() } label: { Label(compact ? "Domyślne" : "Reset", systemImage: "arrow.counterclockwise") }
                Spacer()
                Button { Task { await save() } } label: { Label(saving ? "Zapisywanie..." : "Zapisz tabelę", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || !state.canWrite)
            }
        }
    }

    // MARK: Ustawienia

    private var settings: some View {
        VStack(alignment: .leading, spacing: 10) {
            section("Pozycja i marginesy", open: true) {
                grid {
                    number("Pozycja Y", \.start_y, suffix: "px")
                    number("Margines lewy", \.margin_left, suffix: "px")
                    number("Margines prawy", \.margin_right, suffix: "px")
                    number("VAT domyślny", \.vat_rate, suffix: "%")
                }
                number("Szerokość tabeli (0 = auto)", \.table_width, suffix: "px")
                Text("Ustaw 0, aby tabela wypełniała szerokość strony minus marginesy.").font(.caption2).foregroundStyle(.secondary)
            }
            section("Kolory", open: true) {
                grid {
                    color("Tło nagłówka", \.header_color)
                    color("Tekst nagłówka", \.header_text_color)
                    color("Tło wierszy (parzyste)", \.row_bg_color)
                    color("Tło wierszy (nieparzyste)", \.row_odd_bg_color)
                    color("Kolor tekstu", \.text_color)
                    color("Kolor sumy", \.summary_color)
                    color("Kolor etykiet sumy", \.summary_label_color)
                }
            }
            section("Obramowanie", open: false) {
                Toggle("Włącz obramowanie", isOn: $config.show_borders)
                if config.show_borders {
                    color("Kolor obramowania", \.border_color)
                    number("Grubość obramowania", \.border_width, suffix: "px")
                    Toggle("Linie poziome", isOn: $config.show_horizontal_borders)
                    Toggle("Linie pionowe", isOn: $config.show_vertical_borders)
                    Toggle("Obramowanie zewnętrzne", isOn: $config.show_outer_border)
                }
            }
            section("Typografia i wymiary", open: false) {
                grid {
                    number("Czcionka nagłówka", \.header_font_size, suffix: "px")
                    number("Czcionka treści", \.body_font_size, suffix: "px")
                    number("Wys. nagłówka", \.header_height, suffix: "px")
                    number("Wys. wiersza", \.row_height, suffix: "px")
                    number("Grub. separatora sumy", \.summary_separator_thickness, suffix: "px")
                }
            }
            section("Widoczne kolumny", open: true) {
                Toggle("Cena jedn. netto", isOn: $config.show_unit_price_net)
                Toggle("Stawka VAT", isOn: $config.show_vat_column)
                Toggle("Wartość netto", isOn: $config.show_value_net)
                Toggle("Wartość brutto", isOn: $config.show_value_gross)
                Toggle("Opis pozycji", isOn: $config.show_description)
            }
            section("Szerokości kolumn (px)", open: false) {
                grid {
                    number("Lp.", \.col_lp_width)
                    number("Ilość", \.col_qty_width)
                    number("Jednostka", \.col_unit_width)
                    if config.show_unit_price_net { number("Cena jedn.", \.col_unit_price_width) }
                    if config.show_vat_column { number("VAT", \.col_vat_width) }
                    if config.show_value_net { number("Wart. netto", \.col_value_net_width) }
                    if config.show_value_gross { number("Wart. brutto", \.col_value_gross_width) }
                }
                Text("Kolumna „Nazwa” wypełnia pozostałą szerokość automatycznie.").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .toggleStyle(.switch)
        .controlSize(.small)
    }

    private func section<Content: View>(_ title: String, open: Bool, @ViewBuilder content: @escaping () -> Content) -> some View {
        OfferTableSection(title: title, initiallyOpen: open, content: content)
    }

    private func grid<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 8) { content() }
    }

    private func number(_ label: String, _ key: WritableKeyPath<OfferTableConfig, Double>, suffix: String? = nil) -> some View {
        ProductField(label: label) {
            ProductNumberField(value: Binding(get: { Optional(config[keyPath: key]) }, set: { value in config[keyPath: key] = value ?? 0 }), suffix: suffix)
        }
    }

    private func color(_ label: String, _ key: WritableKeyPath<OfferTableConfig, String>) -> some View {
        ProductField(label: label) {
            HStack(spacing: 6) {
                ColorPicker("", selection: Binding(get: { CrmTheme.hex(config[keyPath: key]) ?? .gray }, set: { config[keyPath: key] = CrmTheme.hexString($0) }),
                            supportsOpacity: false)
                    .labelsHidden()
                TextField("", text: Binding(get: { config[keyPath: key] }, set: { config[keyPath: key] = $0 })).textFieldStyle(.roundedBorder)
            }
        }
    }

    // MARK: Podgląd

    private struct Column {
        let label: String
        let width: Double
        let align: Alignment
    }

    private var columns: [Column] {
        var list = [Column(label: "Lp.", width: config.col_lp_width, align: .leading), Column(label: "Nazwa pozycji", width: 0, align: .leading),
                    Column(label: "Ilość", width: config.col_qty_width, align: .center), Column(label: "Jedn.", width: config.col_unit_width, align: .center)]
        if config.show_unit_price_net { list.append(Column(label: "Cena jedn. netto", width: config.col_unit_price_width, align: .trailing)) }
        if config.show_vat_column { list.append(Column(label: "VAT", width: config.col_vat_width, align: .center)) }
        if config.show_value_net { list.append(Column(label: "Wartość netto", width: config.col_value_net_width, align: .trailing)) }
        if config.show_value_gross { list.append(Column(label: "Wartość brutto", width: config.col_value_gross_width, align: .trailing)) }
        return list
    }

    private static let samples: [(name: String, detail: String, quantity: Double, unit: String, price: Double)] = [
        ("DJ Standard", "Profesjonalny DJ z nagłośnieniem", 1, "szt", 1000),
        ("Nagłośnienie BOSE L1", "System line array z mikrofonami", 2, "szt", 500),
        ("Oświetlenie LED", "Komplet 12 reflektorów LED RGBW", 1, "kpl", 800),
        ("Fotobudka lustrzana", "Z personalizowanymi wydrukami", 1, "szt", 600),
    ]

    private func paint(_ hex: String) -> Color { CrmTheme.hex(hex) ?? .gray }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Podgląd tabeli").font(.caption.weight(.medium)).foregroundStyle(.gray)
                Spacer()
                Text("Y: \(Int(config.start_y))px | Marginesy: \(Int(config.margin_left))-\(Int(config.margin_right))px | Kolumny: \(config.visibleColumns)"
                     + (config.table_width > 0 ? " | Szer: \(Int(config.table_width))px" : ""))
                    .font(.caption2).foregroundStyle(.gray)
            }
            VStack(spacing: 0) {
                row(columns.map { $0.label }, header: true)
                    .frame(height: config.header_height)
                    .background(paint(config.header_color))
                ForEach(Array(Self.samples.enumerated()), id: \.offset) { index, item in
                    let net = item.quantity * item.price
                    let cells = sampleCells(index, item, net)
                    row(cells, header: false)
                        .frame(minHeight: config.row_height)
                        .background(index % 2 == 0 ? paint(config.row_bg_color) : paint(config.row_odd_bg_color))
                        .overlay(alignment: .bottom) {
                            if config.show_borders && config.show_horizontal_borders {
                                Rectangle().fill(paint(config.border_color)).frame(height: config.border_width)
                            }
                        }
                }
                summary
            }
            .frame(minWidth: 500)
            .overlay {
                if config.show_borders && config.show_outer_border {
                    Rectangle().stroke(paint(config.border_color), lineWidth: config.border_width)
                }
            }
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 8))
    }

    private func sampleCells(_ index: Int, _ item: (name: String, detail: String, quantity: Double, unit: String, price: Double), _ net: Double) -> [String] {
        var cells = ["\(index + 1).", config.show_description ? "\(item.name)\n\(item.detail)" : item.name, OfferText.number(item.quantity), item.unit]
        if config.show_unit_price_net { cells.append(String(format: "%.2f", item.price)) }
        if config.show_vat_column { cells.append("\(OfferText.number(config.vat_rate))%") }
        if config.show_value_net { cells.append(String(format: "%.2f", net)) }
        if config.show_value_gross { cells.append(String(format: "%.2f", net * (1 + config.vat_rate / 100))) }
        return cells
    }

    private func row(_ cells: [String], header: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                let value = index < cells.count ? cells[index] : ""
                cell(value, header: header, nameColumn: column.width == 0)
                    .frame(width: column.width > 0 ? column.width : nil, alignment: column.align)
                    .frame(maxWidth: column.width > 0 ? nil : .infinity, alignment: column.align)
                    .padding(.horizontal, 6)
                    .overlay(alignment: .trailing) {
                        if config.show_borders && config.show_vertical_borders && index < columns.count - 1 {
                            Rectangle().fill(paint(config.border_color)).frame(width: config.border_width)
                        }
                    }
            }
        }
    }

    @ViewBuilder private func cell(_ value: String, header: Bool, nameColumn: Bool) -> some View {
        if header {
            Text(value).font(.system(size: config.header_font_size, weight: .semibold)).foregroundStyle(paint(config.header_text_color)).lineLimit(1)
        } else if nameColumn && config.show_description {
            let parts = value.components(separatedBy: "\n")
            VStack(alignment: .leading, spacing: 1) {
                Text(parts.first ?? "").font(.system(size: config.body_font_size))
                Text(parts.count > 1 ? parts[1] : "").font(.system(size: max(config.body_font_size - 2, 7))).opacity(0.6)
            }
            .foregroundStyle(paint(config.text_color))
            .padding(.vertical, 3)
        } else {
            Text(value).font(.system(size: config.body_font_size)).foregroundStyle(paint(config.text_color)).lineLimit(1)
        }
    }

    private var summary: some View {
        HStack(spacing: 16) {
            Spacer()
            if config.show_value_net { total("SUMA NETTO:", "2 900.00 PLN") }
            if config.show_value_gross { total("SUMA BRUTTO:", "3 567.00 PLN") }
        }
        .padding(.horizontal, 6).padding(.vertical, 10)
        .overlay(alignment: .top) { Rectangle().fill(paint(config.summary_color)).frame(height: config.summary_separator_thickness) }
    }

    private func total(_ label: String, _ value: String) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label).font(.system(size: max(config.body_font_size - 1, 6))).foregroundStyle(paint(config.summary_label_color))
            Text(value).font(.system(size: config.body_font_size, weight: .bold)).foregroundStyle(paint(config.summary_color))
        }
    }

    // MARK: Czynności

    private func reset() {
        config = defaults
        state.notice = "Przywrócono domyślne ustawienia"
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if let saved = await store.saveTable(templateID, config: config) {
            config = saved
            onSaved(saved)
        }
    }
}

/// Zwijana sekcja ustawień tabeli (`Section` w CRM).
private struct OfferTableSection<Content: View>: View {
    let title: String
    let content: () -> Content
    @State private var open: Bool

    init(title: String, initiallyOpen: Bool, content: @escaping () -> Content) {
        self.title = title
        self.content = content
        _open = State(initialValue: initiallyOpen)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 8) { content() }.padding(.top, 6)
        } label: {
            Text(title).font(.callout.weight(.medium))
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
