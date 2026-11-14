import SwiftUI

// MARK: Szablony ofert, część F2 — „Rozmieść dane” (`TextFieldsEditorModal`): pola danych CRM na własnym tle PDF (przeciąganie,
// siatka i przyciąganie co 10 pt, „Kliknij aby umieścić”), właściwości pola (dane, położenie, rozmiar zdjęcia i kształt avatara,
// czcionka, kolor, wyrównanie, szerokość, interlinia), tabela wyceny na stronie wyceny (przeciąganie, zmiana rozmiaru, wygląd).
// Zapis `op=templateFieldsSave`.

@MainActor struct OfferTemplateFieldsEditor: View {
    @ObservedObject var store: OfferTemplatesStore
    let data: OfferTemplateEditorData
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var fields: [OfferTemplateField]
    @State private var table: OfferTemplateEditorData.Layout?
    @State private var tableConfig: OfferTableConfig
    @State private var selected: UUID?
    @State private var tableSelected = false
    @State private var showGrid = true
    @State private var snap = true
    @State private var clickMode = false
    @State private var pending = false
    @State private var showTableConfig = false
    @State private var page: NSImage?
    @State private var pageSize: CGSize
    @State private var pageError = false
    @State private var dragID: UUID?
    @State private var dragOffset: CGSize = .zero
    @State private var tableDrag: CGSize = .zero
    @State private var tableResize: CGSize = .zero
    @State private var saving = false

    private let grid: Double = 10
    private var isPricing: Bool { data.type == "pricing" }
    private var pageWidth: Double { Double(pageSize.width) }
    private var pageHeight: Double { Double(pageSize.height) }

    init(store: OfferTemplatesStore, data: OfferTemplateEditorData) {
        self.store = store
        self.data = data
        _fields = State(initialValue: data.fields.map { OfferTemplateField(raw: $0) })
        _table = State(initialValue: data.tableLayout)
        _tableConfig = State(initialValue: data.table)
        _pageSize = State(initialValue: CGSize(width: data.pdfWidth, height: data.pdfHeight))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                canvas
                Divider()
                ScrollView { sidePanel }.frame(width: 340)
            }
            Divider()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button { Task { await save() } } label: { Label(saving ? "Zapisywanie..." : "Zapisz konfigurację", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || !state.canWrite)
            }
            .padding(14)
        }
        .frame(minWidth: 1100, idealWidth: 1400, minHeight: 760, idealHeight: 980)
        .interactiveDismissDisabled(saving)
        .task { await loadPage() }
    }

    // MARK: Nagłówek

    private var header: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Konfiguracja pól tekstowych: \(data.name)").font(.title3)
                Text("PDF: \(Int(pageSize.width))x\(Int(pageSize.height))px | Pól: \(fields.count)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("Siatka", isOn: $showGrid).toggleStyle(.checkbox)
            Toggle("Przyciągaj", isOn: $snap).toggleStyle(.checkbox)
            Toggle("Kliknij aby umieścić", isOn: $clickMode).toggleStyle(.checkbox)
            Button { addField() } label: { Label(clickMode ? "Kliknij na PDF" : "Dodaj pole", systemImage: "plus") }
                .buttonStyle(.borderedProminent).tint(clickMode ? .green : theme.accent)
            if isPricing {
                Button { addTable() } label: { Label(table != nil ? "Tabela dodana" : "Dodaj tabelę", systemImage: "tablecells") }
                    .tint(.cyan)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    // MARK: Strona z polami

    private var canvas: some View {
        ScrollView([.horizontal, .vertical]) {
            ZStack(alignment: .topLeading) {
                Group {
                    if let page {
                        Image(nsImage: page).resizable().interpolation(.high)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "doc.text").font(.system(size: 48)).foregroundStyle(.tertiary)
                            Text(pageError ? "Nie udało się wczytać pliku PDF." : "Ładowanie PDF...").foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(width: pageSize.width, height: pageSize.height)
                .background(.white)
                .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
                if showGrid { gridOverlay }
                Color.clear.contentShape(Rectangle())
                    .frame(width: pageSize.width, height: pageSize.height)
                    .onTapGesture(coordinateSpace: .local) { location in place(at: location) }
                ForEach(fields) { field in fieldBox(field) }
                if isPricing, let table { tableBox(table) }
                if pending {
                    Text("Kliknij na PDF aby umieścić pole").font(.callout.weight(.medium)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Color.green, in: RoundedRectangle(cornerRadius: 8))
                        .frame(width: pageSize.width).offset(y: 16)
                        .allowsHitTesting(false)
                }
            }
            .frame(width: pageSize.width, height: pageSize.height, alignment: .topLeading)
            .padding(24)
        }
        .background(Color.black.opacity(0.35))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var gridOverlay: some View {
        Canvas { context, size in
            var path = Path()
            let width = Double(size.width)
            let height = Double(size.height)
            var x = 0.0
            while x <= width {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: height))
                x += grid
            }
            var y = 0.0
            while y <= height {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: width, y: y))
                y += grid
            }
            context.stroke(path, with: .color(Color(red: 0.83, green: 0.73, blue: 0.45).opacity(0.18)), lineWidth: 0.5)
        }
        .frame(width: pageSize.width, height: pageSize.height)
        .allowsHitTesting(false)
    }

    private func snapped(_ value: Double) -> Double { snap ? (value / grid).rounded() * grid : value }

    private func fieldSize(_ field: OfferTemplateField) -> CGSize {
        if field.isImage { return CGSize(width: field.number("width") ?? 100, height: field.number("height") ?? 100) }
        let size = field.number("font_size") ?? 12
        let width = field.number("max_width") ?? max(60, Double(field.label.count) * 6.5 + 16)
        return CGSize(width: width, height: size * 1.5)
    }

    private func fieldBox(_ field: OfferTemplateField) -> some View {
        let active = selected == field.id && !tableSelected
        let size = fieldSize(field)
        let round = field.circular || field.name.contains("avatar")
        let shape = RoundedRectangle(cornerRadius: round ? min(size.width, size.height) / 2 : 4)
        let moving = dragID == field.id
        let dx: Double = moving ? snapped(field.x + Double(dragOffset.width)) - field.x : 0
        let dy: Double = moving ? snapped(field.y + Double(dragOffset.height)) - field.y : 0
        return Text(field.label).font(.caption.weight(.medium)).opacity(0.75)
            .foregroundStyle(CrmTheme.hex(field.fontColor) ?? .black)
            .lineLimit(1)
            .frame(width: size.width, height: size.height)
            .background((active ? theme.accent : Color.blue).opacity(active ? 0.2 : 0.1), in: shape)
            .overlay(shape.stroke(active ? theme.accent : Color.blue.opacity(0.7), lineWidth: 2))
            .contentShape(shape)
            .offset(x: field.x + dx, y: field.y + dy)
            .onTapGesture { select(field.id) }
            .gesture(DragGesture(minimumDistance: 2)
                .onChanged { value in
                    if dragID != field.id { select(field.id) }
                    dragID = field.id
                    dragOffset = value.translation
                }
                .onEnded { value in
                    let x = snapped(max(0, min(field.x + Double(value.translation.width), pageWidth - 100)))
                    let y = snapped(max(0, min(field.y + Double(value.translation.height), pageHeight - 50)))
                    update(field.id) { item in
                        item.x = x
                        item.y = y
                    }
                    dragID = nil
                    dragOffset = .zero
                })
            .help("\(field.label) — X: \(Int(field.x)), Y: \(Int(field.y))")
    }

    private func tableBox(_ layout: OfferTemplateEditorData.Layout) -> some View {
        let x = snapped(max(0, min(layout.x + Double(tableDrag.width), pageWidth - layout.width)))
        let y = snapped(max(0, min(layout.y + Double(tableDrag.height), pageHeight - 50)))
        let width = snapped(max(200, layout.width + Double(tableResize.width)))
        let height = snapped(max(80, layout.height + Double(tableResize.height)))
        return VStack(spacing: 4) {
            Image(systemName: "tablecells").font(.title2).foregroundStyle(.cyan.opacity(0.75))
            Text("Tabela wyceny").font(.caption.weight(.medium)).foregroundStyle(.cyan)
            Text("\(Int(width)) x \(Int(height))px").font(.caption2).foregroundStyle(.cyan.opacity(0.6))
        }
        .frame(width: width, height: height)
        .background(Color.cyan.opacity(tableSelected ? 0.15 : 0.05), in: RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.cyan.opacity(tableSelected ? 1 : 0.6), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: "arrow.down.right").font(.caption.weight(.bold)).foregroundStyle(.cyan)
                .frame(width: 18, height: 18).contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        selectTable()
                        tableResize = value.translation
                    }
                    .onEnded { _ in
                        table?.width = width
                        table?.height = height
                        tableResize = .zero
                    })
                .help("Zmień rozmiar tabeli")
        }
        .contentShape(Rectangle())
        .offset(x: x, y: y)
        .onTapGesture { selectTable() }
        .gesture(DragGesture(minimumDistance: 2)
            .onChanged { value in
                selectTable()
                tableDrag = value.translation
            }
            .onEnded { _ in
                table?.x = x
                table?.y = y
                tableDrag = .zero
            })
    }

    // MARK: Panel boczny

    @ViewBuilder private var sidePanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            if tableSelected, let layout = table {
                tablePanel(layout)
            } else if let index = fields.firstIndex(where: { $0.id == selected }) {
                fieldPanel(index)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "character.cursor.ibeam").font(.system(size: 40)).foregroundStyle(.tertiary)
                    Text("Wybierz pole z PDF").foregroundStyle(.secondary)
                    Text("lub kliknij „Dodaj pole” aby utworzyć nowe").font(.caption).foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 24)
            }
            Divider()
            allFields
        }
        .padding(14)
    }

    private func tablePanel(_ layout: OfferTemplateEditorData.Layout) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Tabela wyceny").font(.headline).foregroundStyle(.cyan)
                Spacer()
                Button(role: .destructive) { removeTable() } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń tabelę")
            }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                GridRow {
                    tableNumber("X", \.x, minimum: nil)
                    tableNumber("Y", \.y, minimum: nil)
                }
                GridRow {
                    tableNumber("Szerokość", \.width, minimum: 200)
                    tableNumber("Wysokość", \.height, minimum: 80)
                }
            }
            hint("Przeciągnij tabelę na PDF lub edytuj wartości ręcznie. Użyj uchwytu w rogu do zmiany rozmiaru.", .cyan)
            Button { showTableConfig.toggle() } label: {
                Label(showTableConfig ? "Ukryj konfigurację tabeli" : "Konfiguruj wygląd tabeli", systemImage: "gearshape").frame(maxWidth: .infinity)
            }
            if showTableConfig {
                OfferTemplateTableEditor(store: store, templateID: data.id, initial: tableConfig, defaults: data.defaults, compact: true) { saved in
                    tableConfig = saved
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func tableNumber(_ label: String, _ key: WritableKeyPath<OfferTemplateEditorData.Layout, Double>, minimum: Double?) -> some View {
        ProductField(label: label) {
            ProductNumberField(value: Binding(get: { table.map { $0[keyPath: key].rounded() } }, set: { value in
                guard let value else { return }
                table?[keyPath: key] = minimum.map { max($0, value) } ?? value
            }))
        }
    }

    private func fieldPanel(_ index: Int) -> some View {
        let field = fields[index]
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Edycja pola").font(.headline)
                Spacer()
                Button(role: .destructive) { remove(field.id) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń pole")
            }
            ProductField(label: "Pole danych") {
                Picker("", selection: Binding(get: { field.name }, set: { choose($0, for: field.id) })) {
                    if !data.available.contains(where: { $0.value == field.name }) { Text(field.label).tag(field.name) }
                    ForEach(data.available) { item in Text(item.label).tag(item.value) }
                }
                .labelsHidden()
            }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                GridRow {
                    numberField("X", field.id, get: { $0.x.rounded() }, set: { item, value in item.x = value ?? item.x })
                    numberField("Y", field.id, get: { $0.y.rounded() }, set: { item, value in item.y = value ?? item.y })
                }
                if field.isImage {
                    GridRow {
                        numberField("Szerokość", field.id, get: { $0.number("width") ?? 100 }, set: { item, value in item.set("width", value ?? 100) })
                        numberField("Wysokość", field.id, get: { $0.number("height") ?? 100 }, set: { item, value in item.set("height", value ?? 100) })
                    }
                }
            }
            if field.isImage {
                VStack(alignment: .leading, spacing: 2) {
                    Toggle("Okrągły kształt (avatar)", isOn: Binding(get: { field.circular }, set: { value in update(field.id) { item in item.circular = value } }))
                        .toggleStyle(.checkbox)
                    Text("Zaznacz dla avatarów pracowników").font(.caption).foregroundStyle(.secondary).padding(.leading, 20)
                }
            } else {
                numberField("Rozmiar czcionki", field.id, get: { $0.number("font_size") ?? 12 }, set: { item, value in item.set("font_size", value ?? 12) })
                ProductField(label: "Kolor czcionki") {
                    HStack(spacing: 6) {
                        ColorPicker("", selection: Binding(get: { CrmTheme.hex(field.fontColor) ?? .black },
                                                           set: { color in update(field.id) { item in item.fontColor = CrmTheme.hexString(color) } }),
                                    supportsOpacity: false)
                            .labelsHidden()
                        TextField("", text: Binding(get: { field.fontColor }, set: { value in update(field.id) { item in item.fontColor = value } }))
                            .textFieldStyle(.roundedBorder)
                    }
                }
                ProductField(label: "Wyrównanie") {
                    Picker("", selection: Binding(get: { field.align }, set: { value in update(field.id) { item in item.align = value } })) {
                        Text("Lewo").tag("left")
                        Text("Środek").tag("center")
                        Text("Prawo").tag("right")
                    }
                    .labelsHidden()
                }
                numberField("Max. szerokość (opcjonalne)", field.id, prompt: "Auto", get: { $0.number("max_width") },
                            set: { item, value in item.set("max_width", value.flatMap { $0 > 0 ? $0 : nil }) })
                numberField("Interlinia (opcjonalne)", field.id, prompt: "Automatyczna", get: { $0.number("line_height") },
                            set: { item, value in item.set("line_height", value.flatMap { $0 > 0 ? $0 : nil }) })
            }
            hint("Przeciągnij pole na PDF lub edytuj wartości X/Y ręcznie", .blue)
        }
    }

    private func numberField(_ label: String, _ id: UUID, prompt: String = "", get: @escaping (OfferTemplateField) -> Double?,
                             set: @escaping (inout OfferTemplateField, Double?) -> Void) -> some View {
        ProductField(label: label) {
            ProductNumberField(value: Binding(get: { fields.first { $0.id == id }.flatMap(get) }, set: { value in
                update(id) { item in set(&item, value) }
            }), prompt: prompt, nullable: true)
        }
    }

    private func hint(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption).foregroundStyle(color)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private var allFields: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Wszystkie pola (\(fields.count + (isPricing && table != nil ? 1 : 0)))").font(.callout.weight(.medium))
            if isPricing, let table {
                Button { selectTable() } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Tabela wyceny", systemImage: "tablecells").font(.callout.weight(.medium))
                        Text("X: \(Int(table.x)), Y: \(Int(table.y)), \(Int(table.width))x\(Int(table.height))").font(.caption).opacity(0.7)
                    }
                    .foregroundStyle(.cyan)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.cyan.opacity(tableSelected ? 0.2 : 0.06), in: RoundedRectangle(cornerRadius: 6))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            ForEach(fields) { field in
                Button { select(field.id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(field.label).font(.callout.weight(.medium))
                        Text("X: \(Int(field.x)), Y: \(Int(field.y))").font(.caption).opacity(0.7)
                    }
                    .foregroundStyle(selected == field.id && !tableSelected ? theme.accent : Color.primary)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background((selected == field.id && !tableSelected ? theme.accent.opacity(0.2) : Color.primary.opacity(0.04)), in: RoundedRectangle(cornerRadius: 6))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Czynności

    private func select(_ id: UUID) {
        selected = id
        tableSelected = false
    }

    private func selectTable() {
        tableSelected = true
        selected = nil
    }

    private func update(_ id: UUID, _ change: (inout OfferTemplateField) -> Void) {
        guard let index = fields.firstIndex(where: { $0.id == id }) else { return }
        var field = fields[index]
        change(&field)
        fields[index] = field
    }

    private func remove(_ id: UUID) {
        fields.removeAll { $0.id == id }
        if selected == id { selected = nil }
    }

    /// Zmiana pola danych (jak w CRM: etykieta i typ z listy, zdjęcie 100×100, tekst 12 pt).
    private func choose(_ name: String, for id: UUID) {
        guard let item = data.available.first(where: { $0.value == name }) else { return }
        update(id) { field in
            field.raw["field_name"] = .string(item.value)
            field.raw["label"] = .string(item.label)
            field.raw["type"] = .string(item.type)
            if item.type == "image" {
                field.set("width", 100)
                field.set("height", 100)
            } else {
                field.set("font_size", 12)
            }
        }
    }

    private func newField(x: Double, y: Double) -> OfferTemplateField {
        OfferTemplateField(raw: [
            "field_name": .string("client_name"), "label": .string("Nazwa klienta"), "type": .string("text"),
            "x": .number(x), "y": .number(y), "font_size": .number(14), "font_color": .string("#000000"), "align": .string("left"),
        ])
    }

    private func addField() {
        if clickMode {
            pending = true
            state.notice = "Kliknij na PDF aby umieścić pole"
            return
        }
        let field = newField(x: snapped(50), y: snapped(50))
        fields.append(field)
        select(field.id)
    }

    private func place(at location: CGPoint) {
        guard pending else {
            selected = nil
            tableSelected = false
            return
        }
        let field = newField(x: snapped(Double(location.x)), y: snapped(Double(location.y)))
        fields.append(field)
        select(field.id)
        pending = false
        clickMode = false
    }

    private func addTable() {
        if table != nil {
            state.notice = "Tabela już istnieje - przesuń ją na PDF"
        } else {
            table = OfferTemplateEditorData.Layout(x: snapped(50), y: snapped(200), width: snapped(pageWidth - 100), height: snapped(200))
        }
        selectTable()
    }

    private func removeTable() {
        table = nil
        tableSelected = false
    }

    private func loadPage() async {
        guard page == nil, let address = data.pdfUrl else { pageError = data.pdfUrl == nil; return }
        if let result = await OfferTemplatesStore.backgroundPage(address) {
            page = result.image
            pageSize = result.size
        } else {
            pageError = true
            state.error = "Błąd ładowania PDF"
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.saveFields(data.id, fields: fields, table: isPricing ? table : nil, page: page != nil ? pageSize : nil) {
            dismiss()
        }
    }
}

/// Okno „Tabela wyceny” z listy szablonów (bez rozmieszczania na tle).
@MainActor struct OfferTemplateTableSheet: View {
    @ObservedObject var store: OfferTemplatesStore
    let data: OfferTemplateEditorData
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Konfiguracja tabeli wyceny: \(data.name)").font(.title3)
                    Text("Ustaw wygląd tabeli generowanej w PDF oferty").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(16)
            Divider()
            OfferTemplateTableEditor(store: store, templateID: data.id, initial: data.table, defaults: data.defaults) { _ in dismiss() }
                .padding(16)
        }
        .frame(minWidth: 1000, idealWidth: 1200, minHeight: 640, idealHeight: 760)
    }
}
