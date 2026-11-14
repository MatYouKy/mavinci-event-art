import SwiftUI

// MARK: Studio stron (`BrochureDecorativePagesEditor`, `BrochurePageCanvas`), część G2 — strony graficzne broszury: nowa strona
// (własna lub z szablonu), powielanie, usuwanie, układ, treść, ikony, punkty, przycisk, zdjęcie, efekty zdjęcia i płótno
// rozmieszczenia bloków (przeciąganie, narożnik, strzałki, pola liczbowe) z wyglądem strony.

/// Bloki strony na płótnie (`text`, `image`, `details`).
enum BrochureBlocks {
    static let labels = ["text": "Tekst", "image": "Zdjęcie", "details": "Punkty i przycisk"]
    static let pointLayouts: Set<String> = ["features", "features-photo", "process", "timeline", "showcase", "signature"]

    static func blocks(for layout: String) -> [String] {
        if layout == "artwork" { return ["image"] }
        if ["features", "process", "timeline"].contains(layout) { return ["text", "details"] }
        if layout == "statement" { return ["text"] }
        if ["showcase", "signature", "features-photo"].contains(layout) { return ["image", "text", "details"] }
        return ["image", "text"]
    }
}

extension BrochurePageDesign {
    func rect(_ block: String) -> BrochureRect {
        block == "image" ? image : block == "details" ? details : text
    }
    mutating func setRect(_ block: String, _ rect: BrochureRect) {
        switch block {
        case "image": image = rect
        case "details": details = rect
        default: text = rect
        }
    }
}

extension BrochureEditorModel {
    var selectedPageIndex: Int? {
        guard selectedPage.hasPrefix("decorative:"), let draft else { return nil }
        let pageID = String(selectedPage.dropFirst(11))
        return draft.pages.firstIndex(where: { $0.object["id"]?.text == pageID })
    }

    var selectedPageRaw: [String: JSONValue]? {
        guard let index = selectedPageIndex, let draft else { return nil }
        return draft.pages[index].object
    }

    /// Wygląd zapisany przy stronie (uzupełniony domyślnym dla układu) albo `nil` — strona w dawnym, stałym układzie.
    func design(of raw: [String: JSONValue]) -> BrochurePageDesign? {
        guard let studio = data?.studio, case .object(let fields) = raw["design"] ?? .null else { return nil }
        return BrochurePageDesign.normalized(fields, base: studio.design(for: raw["layout"]?.text ?? "photo"))
    }

    func updatePage(_ change: (inout [String: JSONValue]) -> Void) {
        guard canEdit, let index = selectedPageIndex else { return }
        var raw = draft!.pages[index].object
        change(&raw)
        draft!.pages[index] = .object(raw)
    }

    func setPageText(_ key: String, _ value: String, limit: Int) {
        updatePage { raw in raw[key] = .string(String(value.prefix(limit))) }
    }

    func setDesign(_ design: BrochurePageDesign) {
        updatePage { raw in raw["design"] = design.json }
    }

    /// Zmiana układu przywraca rozmieszczenie szablonu tego układu (jak w CRM).
    func setLayout(_ layout: String) {
        guard let studio = data?.studio else { return }
        updatePage { raw in
            raw["layout"] = .string(layout)
            raw["design"] = studio.design(for: layout).json
        }
    }

    /// „Włącz edycję rozmieszczenia” i „Przywróć rozmieszczenie szablonu”.
    func resetDesign() {
        guard let studio = data?.studio, let layout = selectedPageRaw?["layout"]?.text else { return }
        setDesign(studio.design(for: layout))
    }

    /// Zdjęcie strony; przy „Korzyści” zdjęcie zmienia układ na „Zdjęcie nad kafelkami” (i z powrotem bez zdjęcia).
    func setPageImage(path: String, bucket: String) {
        guard let studio = data?.studio, let raw = selectedPageRaw else { return }
        let current = raw["layout"]?.text ?? "photo"
        let layout = current == "features" && !path.isEmpty ? "features-photo" : current == "features-photo" && path.isEmpty ? "features" : current
        updatePage { page in
            page["imagePath"] = .string(path)
            page["imageBucket"] = .string(bucket)
            if layout != current {
                let defaults = studio.design(for: layout)
                var next = design(of: page) ?? studio.design(for: current)
                next.text = defaults.text
                next.image = defaults.image
                next.details = defaults.details
                next.fontSize = defaults.fontSize
                next.showBrand = false
                next.overlay = 0
                page["layout"] = .string(layout)
                page["design"] = next.json
            }
        }
    }

    // MARK: Punkty

    func points(_ raw: [String: JSONValue]) -> [String] { (raw["points"]?.array ?? []).map(\.text) }
    func pointIcons(_ raw: [String: JSONValue]) -> [String] { (raw["pointIcons"]?.array ?? []).map(\.text) }

    func setPoint(_ index: Int, _ value: String) {
        updatePage { raw in
            var list = (raw["points"]?.array ?? []).map(\.text)
            guard index < list.count else { return }
            list[index] = String(value.prefix(240))
            raw["points"] = .array(list.map { JSONValue.string($0) })
        }
    }

    func setPointIcon(_ index: Int, _ icon: String) {
        updatePage { raw in
            var icons = (raw["pointIcons"]?.array ?? []).map(\.text)
            while icons.count <= index { icons.append("") }
            icons[index] = icon
            raw["pointIcons"] = .array(icons.prefix(6).map { JSONValue.string($0) })
        }
    }

    func addPoint() {
        updatePage { raw in
            var list = (raw["points"]?.array ?? []).map(\.text)
            guard list.count < 6 else { return }
            list.append("")
            raw["points"] = .array(list.map { JSONValue.string($0) })
        }
    }

    func removePoint(_ index: Int) {
        updatePage { raw in
            var list = (raw["points"]?.array ?? []).map(\.text)
            var icons = (raw["pointIcons"]?.array ?? []).map(\.text)
            guard index < list.count else { return }
            list.remove(at: index)
            if index < icons.count { icons.remove(at: index) }
            raw["points"] = .array(list.map { JSONValue.string($0) })
            raw["pointIcons"] = .array(icons.map { JSONValue.string($0) })
        }
    }

    // MARK: Dodawanie, powielanie i usuwanie stron

    var canAddPage: Bool { canEdit && (draft?.pages.count ?? 0) < (data?.studio.maxPages ?? 40) }

    /// Nowa strona (własna lub z szablonu) trafia przed zakończenie i zostaje wybrana.
    func addPage(_ preset: BrochureStudio.Preset) {
        guard canAddPage else { return }
        var raw = preset.page.object
        let pageID = UUID().uuidString.lowercased()
        raw["id"] = .string(pageID)
        draft!.pages.append(.object(raw))
        syncOrder()
        selectedPage = "decorative:" + pageID
    }

    func duplicatePage() {
        guard canAddPage, var raw = selectedPageRaw else { return }
        let pageID = UUID().uuidString.lowercased()
        raw["id"] = .string(pageID)
        draft!.pages.append(.object(raw))
        syncOrder()
        selectedPage = "decorative:" + pageID
    }

    func deletePage(_ key: String) {
        guard canEdit, draft != nil, key.hasPrefix("decorative:") else { return }
        let pageID = String(key.dropFirst(11))
        let keys = pageRows.map(\.key)
        let position = keys.firstIndex(of: key) ?? 0
        draft!.pages.removeAll(where: { $0.object["id"]?.text == pageID })
        syncOrder()
        if selectedPage == key {
            let remaining = pageRows.map(\.key)
            selectedPage = remaining.isEmpty ? "settings" : remaining[min(position, remaining.count - 1)]
        }
    }

    /// Kolejność stron po zmianie listy stron graficznych (jak `updateDecorations` w CRM).
    private func syncOrder() {
        guard let draft else { return }
        self.draft!.composer.pageOrder = BrochureComposition.ordered(
            itemIDs: draft.items.map(\.id),
            pages: draft.pageInfos.map { page in BrochureComposition.Page(id: page.id, afterItemId: page.afterItemId, visible: true) },
            order: draft.composer.pageOrder
        )
    }
}

/// Edycja strony graficznej w środkowym panelu (sekcje formularza).
@MainActor struct BrochureStudioSections: View {
    @ObservedObject var model: BrochureEditorModel
    let removePage: (String) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var block = "text"

    var body: some View {
        if let raw = model.selectedPageRaw, let studio = model.data?.studio {
            let layout = raw["layout"]?.text ?? "photo"
            let design = model.design(of: raw)
            Section {
                Picker("Układ strony", selection: Binding(get: { layout }, set: { value in model.setLayout(value) })) {
                    ForEach(studio.layouts) { entry in Text(entry.label).tag(entry.key) }
                }
                HStack {
                    Button { model.duplicatePage() } label: { Label("Powiel stronę", systemImage: "plus.square.on.square") }
                        .disabled(!model.canAddPage)
                    Button(role: .destructive) { removePage(model.selectedPage) } label: { Label("Usuń stronę…", systemImage: "trash") }
                }
            } header: {
                Text("Strona graficzna")
            }
            if layout != "artwork" { content(raw, layout: layout, studio: studio) }
            if BrochureBlocks.pointLayouts.contains(layout) { pointsSection(raw, studio: studio) }
            if layout == "features" || studio.requiresImage(layout) { imageSection(raw, layout: layout) }
            if layout == "signature", let design { effects(design) }
            if let design {
                arrangement(design, layout: layout)
                appearance(raw, design: design, layout: layout, studio: studio)
            } else {
                Section {
                    Text("Ta strona zachowuje dotychczasowy układ widoczny w podglądzie broszury. Aby ją swobodnie rozmieścić, włącz nowy układ.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Włącz edycję rozmieszczenia") { model.resetDesign() }
                } header: {
                    Text("Rozmieszczenie")
                }
            }
        }
    }

    private func text(_ raw: [String: JSONValue], _ key: String, limit: Int) -> Binding<String> {
        Binding(get: { model.selectedPageRaw?[key]?.text ?? "" }, set: { value in model.setPageText(key, value, limit: limit) })
    }

    // MARK: Treść

    @ViewBuilder private func content(_ raw: [String: JSONValue], layout: String, studio: BrochureStudio) -> some View {
        Section {
            TextField("Nazwa działu", text: text(raw, "eyebrow", limit: 80), prompt: Text("np. Sprawdź, jak działa"))
            Picker("Ikona nagłówka", selection: Binding(get: { model.selectedPageRaw?["icon"]?.text ?? "" }, set: { value in
                model.updatePage { page in
                    if value.isEmpty { page.removeValue(forKey: "icon") } else { page["icon"] = .string(value) }
                }
            })) {
                Text("Bez ikony").tag("")
                ForEach(studio.icons) { icon in Text(icon.label).tag(icon.key) }
            }
            TextField("Hasło / tytuł", text: text(raw, "slogan", limit: 120), axis: .vertical)
                .lineLimit(layout == "signature" ? 2...4 : 1...3)
            TextField("Treść", text: text(raw, "caption", limit: 600), axis: .vertical)
                .lineLimit(3...8)
        } header: {
            Text("Treść")
        } footer: {
            Text(layout == "signature"
                 ? "W haśle nowa linia rozpoczyna nowy wiersz; ostatni wiersz dostaje złoty akcent. Wpisz {{klient}}, aby wstawić nazwę organizacji wybranej w ustawieniach broszury."
                 : "Wpisz {{klient}}, aby wstawić nazwę organizacji wybranej w ustawieniach broszury — zmiana odbiorcy podmieni ją w podglądzie i PDF.")
        }
    }

    // MARK: Punkty i przycisk

    @ViewBuilder private func pointsSection(_ raw: [String: JSONValue], studio: BrochureStudio) -> some View {
        let list = model.points(raw)
        let icons = model.pointIcons(raw)
        Section {
            ForEach(Array(list.enumerated()), id: \.offset) { entry in
                HStack(spacing: 8) {
                    Picker("", selection: Binding(get: { entry.offset < icons.count ? icons[entry.offset] : "" }, set: { value in model.setPointIcon(entry.offset, value) })) {
                        Text("Numer").tag("")
                        ForEach(studio.icons) { icon in Text(icon.label).tag(icon.key) }
                    }
                    .labelsHidden()
                    .frame(width: 150)
                    TextField("", text: Binding(get: { entry.element }, set: { value in model.setPoint(entry.offset, value) }),
                              prompt: Text("Nagłówek | opis"), axis: .vertical)
                        .lineLimit(1...3)
                        .labelsHidden()
                    Button { model.removePoint(entry.offset) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                        .help("Usuń punkt")
                }
            }
            Button { model.addPoint() } label: { Label("Dodaj punkt", systemImage: "plus") }
                .disabled(list.count >= 6)
        } header: {
            Text("Punkty (do 6)")
        } footer: {
            Text("Format: nagłówek | opis. Bez ikony punkt ma numer.")
        }
        Section {
            TextField("Tekst przycisku", text: text(raw, "linkLabel", limit: 80))
            TextField("Adres przycisku", text: text(raw, "linkUrl", limit: 1000), prompt: Text("https://…"))
            TextField("Zachęta pod przyciskiem", text: text(raw, "linkHint", limit: 160), prompt: Text("opcjonalnie"))
        } header: {
            Text("Przycisk")
        } footer: {
            Text("Treść szablonu jest propozycją. Dopasuj ją do zakresu udostępnionego temu klientowi.")
        }
    }

    // MARK: Zdjęcie i efekty

    @ViewBuilder private func imageSection(_ raw: [String: JSONValue], layout: String) -> some View {
        let path = raw["imagePath"]?.text ?? ""
        let bucket = raw["imageBucket"]?.text.isEmpty == false ? raw["imageBucket"]!.text : "offer-product-pages"
        Section {
            BrochureImageField(model: model, path: path, bucket: bucket, emptyLabel: "Bez zdjęcia", clearLabel: "Usuń zdjęcie",
                               assets: model.assets) { newPath, newBucket in
                model.setPageImage(path: newPath, bucket: newBucket)
            }
            .id(model.selectedPage)
        } header: {
            Text("Zdjęcie lub grafika")
        } footer: {
            if ["features", "features-photo"].contains(layout) {
                Text("Opcjonalne zdjęcie między nagłówkiem a kafelkami. Po dodaniu zdjęcia kafelki przesuną się niżej; przy wymianie zdjęcia układ i kadr zostają.")
            }
        }
    }

    private func effects(_ design: BrochurePageDesign) -> some View {
        Section {
            slider("Tonacja koloru marki", value: design.imageTint ?? 0, range: 0...100) { value in
                var next = design
                next.imageTint = value
                model.setDesign(next)
            }
            slider("Cień gradientowy", value: design.imageFade ?? 0, range: 0...100) { value in
                var next = design
                next.imageFade = value
                model.setDesign(next)
            }
        } header: {
            Text("Efekty zdjęcia")
        } footer: {
            Text("Tonacja nadaje zdjęciu odcień marki. Gradient miękko przyciemnia brzegi, najmocniej u dołu. Ustaw 0%, aby wyłączyć dany efekt.")
        }
    }

    private func slider(_ label: String, value: Double, range: ClosedRange<Double>, set: @escaping (Double) -> Void) -> some View {
        let title = "\(label) · \(Int(value))"
        return LabeledContent(title) {
            Slider(value: Binding(get: { value }, set: { next in set(next.rounded()) }), in: range).frame(maxWidth: 260)
        }
    }

    // MARK: Rozmieszczenie i wygląd

    @ViewBuilder private func arrangement(_ design: BrochurePageDesign, layout: String) -> some View {
        let blocks = BrochureBlocks.blocks(for: layout)
        let current = blocks.contains(block) ? block : (blocks.first ?? "text")
        let rect = design.rect(current)
        Section {
            BrochurePageCanvasView(model: model, design: design, blocks: blocks, selected: Binding(get: { current }, set: { value in block = value }))
                .frame(maxWidth: .infinity)
            if blocks.count > 1 {
                Picker("Pole", selection: Binding(get: { current }, set: { value in block = value })) {
                    ForEach(blocks, id: \.self) { entry in Text(BrochureBlocks.labels[entry] ?? entry).tag(entry) }
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: 10) {
                number("Poziom", rect.x) { value in update(design, current) { rect in rect.x = value } }
                number("Pion", rect.y) { value in update(design, current) { rect in rect.y = value } }
                number("Szerokość", rect.width) { value in update(design, current) { rect in rect.width = value } }
                number("Wysokość", rect.height) { value in update(design, current) { rect in rect.height = value } }
            }
        } header: {
            Text("Rozmieszczenie")
        } footer: {
            Text("Przeciągnij pole lub jego narożnik. Strzałki przesuwają zaznaczone pole (Shift — o 5%). Wartości w procentach strony.")
        }
    }

    private func update(_ design: BrochurePageDesign, _ block: String, _ change: (inout BrochureRect) -> Void) {
        var rect = design.rect(block)
        change(&rect)
        var next = design
        next.setRect(block, rect.normalized())
        model.setDesign(next)
    }

    private func number(_ label: String, _ value: Double, set: @escaping (Double) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(label) %").font(.caption2).foregroundStyle(.secondary)
            TextField("", value: Binding(get: { value.rounded() }, set: { next in set(next) }), format: .number.precision(.fractionLength(0)))
                .textFieldStyle(.roundedBorder)
                .labelsHidden()
        }
    }

    @ViewBuilder private func appearance(_ raw: [String: JSONValue], design: BrochurePageDesign, layout: String, studio: BrochureStudio) -> some View {
        Section {
            Picker("Motyw graficzny", selection: Binding(get: { design.ornament ?? "none" }, set: { value in
                var next = design
                next.ornament = value
                model.setDesign(next)
            })) {
                Text("Bez motywu").tag("none")
                Text("Łuki").tag("arc")
                Text("Siatka punktów").tag("grid")
            }
            Picker("Tło", selection: Binding(get: { design.theme }, set: { value in
                var next = design
                next.theme = value
                model.setDesign(next)
            })) {
                Text("Jasne").tag("light")
                Text("Kolor marki").tag("dark")
            }
            Picker("Wyrównanie tekstu", selection: Binding(get: { design.align }, set: { value in
                var next = design
                next.align = value
                model.setDesign(next)
            })) {
                Text("Do lewej").tag("left")
                Text("Na środku").tag("center")
                Text("Do prawej").tag("right")
            }
            .pickerStyle(.segmented)
            slider("Wielkość hasła", value: design.fontSize, range: 20...64) { value in
                var next = design
                next.fontSize = value
                model.setDesign(next)
            }
            Toggle("Pokaż logo \(model.company?.name ?? "marki")", isOn: Binding(get: { design.showBrand }, set: { value in
                var next = design
                next.showBrand = value
                model.setDesign(next)
            }))
            if studio.requiresImage(layout) {
                Picker("Dopasowanie zdjęcia", selection: Binding(get: { design.imageFit }, set: { value in
                    var next = design
                    next.imageFit = value
                    model.setDesign(next)
                })) {
                    Text("Wypełnij pole").tag("cover")
                    Text("Pokaż całą grafikę").tag("contain")
                }
                slider("Przyciemnienie", value: design.overlay, range: 0...90) { value in
                    var next = design
                    next.overlay = value
                    model.setDesign(next)
                }
                slider("Kadr poziomo", value: design.imageX, range: 0...100) { value in
                    var next = design
                    next.imageX = value
                    model.setDesign(next)
                }
                slider("Kadr pionowo", value: raw["imagePosition"]?.number ?? 50, range: 0...100) { value in
                    model.updatePage { page in page["imagePosition"] = .number(value) }
                }
            }
            Button("Przywróć rozmieszczenie szablonu") { model.resetDesign() }
        } header: {
            Text("Wygląd strony")
        }
    }
}

/// Płótno rozmieszczenia: podgląd strony z polami do przeciągania, narożnikiem zmiany rozmiaru i strzałkami klawiatury.
@MainActor struct BrochurePageCanvasView: View {
    @ObservedObject var model: BrochureEditorModel
    let design: BrochurePageDesign
    let blocks: [String]
    @Binding var selected: String
    @Environment(\.crmTheme) private var theme
    @State private var dragging: String?
    @State private var start: BrochureRect?
    @State private var live: BrochureRect?
    @FocusState private var focused: Bool

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack(alignment: .topLeading) {
                Color.white
                if !model.canvasHtml.isEmpty {
                    BrochureWebPreview(html: model.canvasHtml, zoom: max(0.1, size.width / 794), background: .white, focus: nil)
                        .allowsHitTesting(false)
                } else {
                    ProgressView().controlSize(.small).frame(width: size.width, height: size.height)
                }
                ForEach(blocks, id: \.self) { block in box(block, size: size) }
            }
            .frame(width: size.width, height: size.height)
        }
        .aspectRatio(210.0 / 297.0, contentMode: .fit)
        .frame(maxWidth: 440)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
        .focusable()
        .focused($focused)
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            let step: Double = press.modifiers.contains(.shift) ? 5 : 1
            var rect = design.rect(selected)
            if press.key == .leftArrow { rect.x -= step }
            if press.key == .rightArrow { rect.x += step }
            if press.key == .upArrow { rect.y -= step }
            if press.key == .downArrow { rect.y += step }
            commit(selected, rect.normalized())
            return .handled
        }
        .disabled(!model.canEdit)
    }

    private func rect(_ block: String) -> BrochureRect {
        if dragging == block, let live { return live }
        return design.rect(block)
    }

    private func box(_ block: String, size: CGSize) -> some View {
        let frame = rect(block)
        let active = selected == block
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(active ? theme.accent.opacity(0.10) : Color.clear)
                .overlay(Rectangle().strokeBorder(active ? theme.accent : Color.gray.opacity(0.7), style: StrokeStyle(lineWidth: active ? 2 : 1, dash: [5, 3])))
            Text(BrochureBlocks.labels[block] ?? block)
                .font(.caption2).foregroundStyle(.white)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(Color.black.opacity(0.65))
        }
        .frame(width: max(8, frame.width / 100 * size.width), height: max(8, frame.height / 100 * size.height))
        .overlay(alignment: .bottomTrailing) {
            Rectangle().fill(theme.accent).frame(width: 12, height: 12)
                .highPriorityGesture(DragGesture(minimumDistance: 1)
                    .onChanged { value in drag(block, value: value, size: size, resize: true) }
                    .onEnded { _ in end(block) })
                .help("Zmień rozmiar: \(BrochureBlocks.labels[block] ?? block)")
        }
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 1)
            .onChanged { value in drag(block, value: value, size: size, resize: false) }
            .onEnded { _ in end(block) })
        .onTapGesture {
            selected = block
            focused = true
        }
        .offset(x: frame.x / 100 * size.width, y: frame.y / 100 * size.height)
        .help("Przesuń: \(BrochureBlocks.labels[block] ?? block)")
    }

    private func drag(_ block: String, value: DragGesture.Value, size: CGSize, resize: Bool) {
        guard model.canEdit, size.width > 0, size.height > 0 else { return }
        if dragging != block {
            dragging = block
            start = design.rect(block)
            selected = block
            focused = true
        }
        guard let start else { return }
        let dx = Double(value.translation.width / size.width) * 100
        let dy = Double(value.translation.height / size.height) * 100
        if resize {
            live = BrochureRect(x: start.x, y: start.y,
                                width: max(12, min(100 - start.x, start.width + dx)),
                                height: max(8, min(100 - start.y, start.height + dy)))
        } else {
            live = BrochureRect(x: start.x + dx, y: start.y + dy, width: start.width, height: start.height).normalized()
        }
    }

    private func end(_ block: String) {
        if let live { commit(block, live) }
        dragging = nil
        start = nil
        live = nil
    }

    private func commit(_ block: String, _ rect: BrochureRect) {
        var next = design
        next.setRect(block, rect)
        model.setDesign(next)
    }
}
