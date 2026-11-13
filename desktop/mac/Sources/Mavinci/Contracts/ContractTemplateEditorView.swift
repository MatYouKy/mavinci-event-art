import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Edytor szablonu umowy na Macu — kartka A4 w stylach dokumentu jak edytor CRM. Wstążka: narzędzia główne zawsze
// widoczne (galeria stylów, punkty 1. / 1.1, pogrubienie…, wyrównanie), pod nimi „Wstaw” (pola umowy, „§n”, miejsca na
// klauzule, obrazy i logotypy) i „Układ” (czcionka dokumentu, logo w nagłówku, stopka). Zapis w tym samym formacie co CRM
// (⌘S). Warunki, opcje umowy i tabele — w kolejnym etapie („Edytuj w CRM”). Niezapisana treść zostaje w edytorze przy
// przejściu do innej części aplikacji.

struct ContractTemplateDocumentPayload: Decodable {
    struct FieldGroup: Decodable { let label: String; let items: [Field] }
    struct Field: Decodable { let key: String; let label: String }
    struct Slot: Decodable { let name: String; let label: String }
    struct BrandLogo: Decodable, Hashable { let url: String; let label: String; let companyName: String }
    struct Font: Decodable, Hashable { let label: String; let value: String }
    struct FooterTemplate: Decodable, Hashable {
        let id: String
        let name: String
        var isDefault: Bool?
        let companyName: String
        let tagline: String
        let website: String
        let email: String
        let phone: String
        let logoUrl: String
        let logoScale: Double
    }
    let id: String
    let name: String
    let updatedAt: String?
    let format: String
    let html: String
    let documentStyles: ContractDocumentStyles
    let options: [ContractOptionItem]
    let fieldGroups: [FieldGroup]
    let slots: [Slot]
    let canEdit: Bool
    let layout: ContractPageLayout?
    let brandLogos: [BrandLogo]?
    let fonts: [Font]?
    let footerTemplates: [FooterTemplate]?
    let categories: [String]?
    let conditionFields: [Field]?

    var fieldLabels: [String: String] {
        Dictionary(fieldGroups.flatMap { group in group.items.map { ($0.key, $0.label) } }, uniquingKeysWith: { first, _ in first })
    }
    var slotLabels: [String: String] { Dictionary(slots.map { ($0.name, $0.label) }, uniquingKeysWith: { first, _ in first }) }
}

/// Liczby z treści do paska edytora (punkty, pola, warunki, miejsca na klauzule).
struct ContractDocumentStats {
    var paragraphs = 0
    var fields = Set<String>()
    var conditions = 0
    var slots = 0

    init(_ document: ContractDocument) {
        visit(document.blocks)
    }

    private mutating func visit(_ blocks: [ContractBlock]) {
        for block in blocks {
            switch block {
            case .paragraph(let paragraph):
                paragraphs += 1
                if paragraph.attributes[ContractHTMLParser.condition] != nil { conditions += 1 }
                collectFields(paragraph.plainText)
            case .list(let list):
                for item in list.items {
                    if item.attributes[ContractHTMLParser.condition] != nil { conditions += 1 }
                    visit(item.blocks)
                }
            case .table(let table):
                for row in table.rows { for cell in row.cells { visit(cell.blocks) } }
            case .slot:
                slots += 1
            case .image:
                break
            case .section(_, _, let children):
                conditions += 1
                visit(children)
            case .rule:
                break
            }
        }
    }

    private mutating func collectFields(_ text: String) {
        guard let expression = try? NSRegularExpression(pattern: #"\{\{\s*([A-Za-z0-9_]+)\s*\}\}"#) else { return }
        let source = text as NSString
        for match in expression.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            fields.insert(source.substring(with: match.range(at: 1)))
        }
    }
}

/// Wczytanie szablonu do edytora (sesja edycji zostaje w `ContractsStore` do zamknięcia edytora).
@MainActor struct ContractTemplateEditorView: View {
    @ObservedObject var store: ContractsStore
    let templateID: String
    @State private var loadError: String?

    var body: some View {
        Group {
            if let session = store.editorSession, session.templateID == templateID {
                ContractTemplateEditorScreen(store: store, controller: session)
            } else if let loadError {
                VStack(spacing: 0) {
                    backBar
                    ContentUnavailableView {
                        Label("Nie udało się wczytać szablonu", systemImage: "doc.richtext")
                    } description: { Text(loadError) } actions: {
                        Button("Spróbuj ponownie") { Task { await load() } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                VStack(spacing: 0) {
                    backBar
                    ProgressView("Wczytywanie szablonu…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .task(id: templateID) { await load() }
    }

    private var backBar: some View {
        HStack {
            Button { store.editingTemplateID = nil } label: { Label("Szablony umów", systemImage: "chevron.left") }
                .buttonStyle(.borderless)
            Spacer()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .crmBar()
    }

    private func load() async {
        if store.editorSession?.templateID == templateID { return }
        loadError = nil
        do {
            let payload = try await store.templateDocument(templateID)
            guard store.editingTemplateID == templateID else { return }
            store.editorSession = ContractEditorController(templateID: templateID, payload: payload)
        } catch {
            if Task.isCancelled || error is CancellationError { return }
            loadError = store.failureText(error, "Nie udało się wczytać szablonu.")
        }
    }
}

@MainActor struct ContractTemplateEditorScreen: View {
    @ObservedObject var store: ContractsStore
    @ObservedObject var controller: ContractEditorController
    @EnvironmentObject private var state: Workspace
    @State private var zoom: CGFloat = 1
    @State private var tab = "insert"
    @State private var confirmLeave = false
    @State private var confirmReload = false
    @State private var editingFooter = false
    @State private var conditionRequest: ContractConditionRequest?
    @State private var editingOptions = false

    private var name: String { store.template(controller.templateID)?.name ?? controller.payload.name }
    private var word: Bool { controller.payload.format == "word" }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if word && controller.editable {
                ribbon
                Divider()
            }
            content
        }
        .navigationTitle(name)
        .confirmationDialog("Zapisać zmiany w szablonie „\(name)”?", isPresented: $confirmLeave) {
            Button("Zapisz") { Task { if await save() { close() } } }
            Button("Odrzuć zmiany", role: .destructive) { close() }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Treść ma niezapisane zmiany.")
        }
        .sheet(isPresented: $editingFooter) {
            ContractFooterEditorSheet(store: store, controller: controller)
        }
        .sheet(item: $conditionRequest) { request in
            ContractConditionSheet(request: request, options: controller.options, categories: controller.payload.categories ?? [],
                                   fields: controller.payload.conditionFields ?? [], fieldLabels: conditionFieldLabels,
                                   onApply: { expression, options in
                                       controller.saveOptions(options)
                                       controller.setCondition(expression)
                                   },
                                   onRemove: request.initial == nil ? nil : { controller.removeCondition() })
        }
        .sheet(isPresented: $editingOptions) {
            ContractOptionsSheet(options: controller.options, usage: controller.optionUsage()) { controller.saveOptions($0) }
        }
        .confirmationDialog("Wczytać szablon ponownie?", isPresented: $confirmReload) {
            Button("Wczytaj ponownie", role: .destructive) { reload() }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Niezapisane zmiany zostaną utracone.")
        }
    }

    // MARK: Pasek

    private var header: some View {
        HStack(spacing: 10) {
            Button { leave() } label: { Label("Szablony umów", systemImage: "chevron.left") }
                .buttonStyle(.borderless)
            Divider().frame(height: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.headline).lineLimit(1)
                Text(subtitle).font(.caption).foregroundStyle(controller.dirty ? Color.orange : Color.secondary).lineLimit(1)
            }
            Spacer()
            if word {
                HStack(spacing: 4) {
                    Button { zoom = max(0.5, zoom - 0.1) } label: { Image(systemName: "minus.magnifyingglass") }
                        .help("Pomniejsz")
                    Text("\(Int((zoom * 100).rounded())) %").font(.caption.monospacedDigit()).frame(width: 44)
                    Button { zoom = min(2.5, zoom + 0.1) } label: { Image(systemName: "plus.magnifyingglass") }
                        .help("Powiększ")
                    Button("100 %") { zoom = 1 }.help("Rozmiar jak w CRM w przeglądarce")
                }
                .buttonStyle(.borderless)
            }
            Menu {
                Button("Edytuj w CRM (scalanie szablonów)") {
                    state.openCRM("/crm/contract-templates/\(controller.templateID)/edit-wysiwyg")
                }
                Divider()
                Button("Wczytaj ponownie z serwera") { if controller.dirty { confirmReload = true } else { reload() } }
            } label: {
                Label("Więcej", systemImage: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            if controller.editable {
                Button { Task { await save() } } label: {
                    Label(controller.saving ? "Zapisywanie…" : "Zapisz", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!controller.dirty || controller.saving)
                .keyboardShortcut("s", modifiers: .command)
                .help("Zapisz treść szablonu (⌘S)")
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .crmBar()
    }

    private var subtitle: String {
        guard word else { return "Starszy format" }
        var parts: [String] = []
        if controller.dirty { parts.append("Niezapisane zmiany") } else if !controller.editable { parts.append("Tylko podgląd") }
        let stats = controller.stats
        if !stats.fields.isEmpty { parts.append("pola: \(stats.fields.count)") }
        if stats.conditions > 0 { parts.append("warunki: \(stats.conditions)") }
        if stats.slots > 0 { parts.append("miejsca na klauzule: \(stats.slots)") }
        return parts.isEmpty ? "Zapisano" : parts.joined(separator: " · ")
    }

    // MARK: Wstążka

    private struct StyleOption: Identifiable {
        let id: String
        let label: String
        let shortcut: String
    }

    private static let styleOrder: [StyleOption] = [
        StyleOption(id: "title", label: "Tytuł", shortcut: ""),
        StyleOption(id: "heading", label: "Nagłówek sekcji", shortcut: "⌘⌥1"),
        StyleOption(id: "point", label: "Punkt", shortcut: "⌘⌥2"),
        StyleOption(id: "subpoint", label: "Podpunkt", shortcut: "⌘⌥3"),
        StyleOption(id: "subsubpoint", label: "Podpunkt 2. st.", shortcut: "⌘⌥4"),
        StyleOption(id: "body", label: "Zwykły", shortcut: "⌘⌥0"),
    ]

    private var ribbon: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) { homeRow }.padding(.vertical, 1)
            }
            HStack(spacing: 12) {
                Picker("", selection: $tab) {
                    Text("Wstaw").tag("insert")
                    Text("Warunki").tag("conditions")
                    Text("Układ").tag("layout")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                Divider().frame(height: 22)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        switch tab {
                        case "layout": layoutRow
                        case "conditions": conditionsRow
                        default: insertRow
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .crmBar()
    }

    @ViewBuilder private var homeRow: some View {
        HStack(spacing: 2) {
            Button { controller.undoChange() } label: { Image(systemName: "arrow.uturn.backward") }
                .help("Cofnij (⌘Z)").disabled(!controller.canUndo)
            Button { controller.redoChange() } label: { Image(systemName: "arrow.uturn.forward") }
                .help("Ponów (⌘⇧Z)").disabled(!controller.canRedo)
        }
        .buttonStyle(.borderless)
        Divider().frame(height: 22)
        HStack(spacing: 4) {
            ForEach(Self.styleOrder) { style in
                ContractStyleChip(title: style.label, selected: controller.styleID == style.id) { controller.applyStyle(style.id) }
                    .help(style.shortcut.isEmpty ? "Styl: \(style.label)" : "Styl: \(style.label) (\(style.shortcut))")
            }
        }
        .disabled(controller.inCell)
        Divider().frame(height: 22)
        HStack(spacing: 2) {
            markToggle("bold", \.bold, help: "Pogrubienie (⌘B)")
            markToggle("italic", \.italic, help: "Kursywa (⌘I)")
            markToggle("underline", \.underline, help: "Podkreślenie (⌘U)")
            markToggle("strikethrough", \.strike, help: "Przekreślenie (⌘⇧X)")
        }
        Divider().frame(height: 22)
        Picker("Wyrównanie", selection: Binding(get: { controller.alignment }, set: { controller.setAlignment($0) })) {
            Image(systemName: "text.alignleft").help("Do lewej").tag("left")
            Image(systemName: "text.aligncenter").help("Do środka").tag("center")
            Image(systemName: "text.alignright").help("Do prawej").tag("right")
            Image(systemName: "text.justify").help("Wyjustuj").tag("justify")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        Divider().frame(height: 22)
        HStack(spacing: 2) {
            Button { controller.outdent() } label: { Image(systemName: "decrease.indent") }
                .help("Zmniejsz poziom punktu (⇧Tab)")
            Button { controller.indent() } label: { Image(systemName: "increase.indent") }
                .help("Zwiększ poziom punktu (Tab)")
        }
        .buttonStyle(.borderless)
        .disabled(!controller.inItem)
    }

    private func markToggle(_ symbol: String, _ mark: WritableKeyPath<ContractInlineMarks, Bool>, help: String) -> some View {
        Toggle(isOn: Binding(get: { controller.marks[keyPath: mark] }, set: { _ in controller.toggle(mark) })) {
            Image(systemName: symbol)
        }
        .toggleStyle(.button)
        .help(help)
    }

    @ViewBuilder private var insertRow: some View {
        Menu {
            ForEach(controller.payload.fieldGroups, id: \.label) { group in
                Section(group.label) {
                    ForEach(group.items, id: \.key) { field in
                        Button(field.label) { controller.insertField("{{\(field.key)}}") }
                    }
                }
            }
        } label: {
            Label("Pole umowy", systemImage: "curlybraces")
        }
        .fixedSize()
        .help("Wstaw pole uzupełniane przy tworzeniu umowy (np. imię i nazwisko klienta)")
        Button { controller.insertField("§n") } label: { Label("Numer paragrafu „§n”", systemImage: "number") }
            .help("Przy zapisie „§n” zamienia się na kolejne numery: § 1, § 2…")
        Menu {
            ForEach(controller.payload.slots, id: \.name) { slot in
                Button(slot.label) { controller.insertSlot(slot.name, label: slot.label) }
            }
        } label: {
            Label("Miejsce na klauzule", systemImage: "text.badge.plus")
        }
        .fixedSize()
        .help("Miejsce, w które generator umowy wstawi klauzule produktów z wybranej kategorii")
        Menu {
            Button("Tabela 2 × 2") { controller.insertTable(signatures: false) }
            Button("Miejsca na podpisy stron") { controller.insertTable(signatures: true) }
        } label: {
            Label("Tabela", systemImage: "tablecells")
        }
        .fixedSize()
        .disabled(controller.inCell)
        .help("Tabela albo gotowe miejsca na podpisy Zamawiającego i Wykonawcy")
        if controller.inCell {
            HStack(spacing: 2) {
                Button("+ wiersz") { controller.tableRow(add: true) }.help("Wiersz poniżej")
                Button("+ kolumna") { controller.tableColumn(add: true) }.help("Kolumna z prawej")
                Button("− wiersz") { controller.tableRow(add: false) }.help("Usuń wiersz")
                Button("− kolumna") { controller.tableColumn(add: false) }.help("Usuń kolumnę")
                Button("Usuń tabelę", role: .destructive) { controller.deleteTable() }
            }
            .buttonStyle(.bordered)
        }
        Menu {
            let logos = controller.payload.brandLogos ?? []
            if !logos.isEmpty {
                Section("Logo firmy") {
                    ForEach(logos, id: \.self) { logo in
                        Button("\(logo.companyName) — \(logo.label)") { controller.insertImage(logo.url, width: 35) }
                    }
                }
            }
            Button("Obraz z pliku…") { Task { await insertImageFromFile() } }
        } label: {
            Label("Obraz", systemImage: "photo")
        }
        .fixedSize()
        .help("Wstaw logo z brandbooka albo obraz z pliku (PNG, JPG, GIF, WebP, do 2 MB)")
        if let image = controller.selectedImage {
            Divider().frame(height: 22)
            Text("Obraz").font(.caption).foregroundStyle(.secondary)
            Slider(value: Binding(get: { image.width }, set: { controller.updateImage(width: $0.rounded()) }), in: 10...100)
                .frame(width: 140)
                .help("Szerokość obrazu (% szerokości tekstu)")
            Text("\(Int(image.width)) %").font(.caption.monospacedDigit()).frame(width: 40)
            Picker("Wyrównanie obrazu", selection: Binding(get: { image.align }, set: { controller.updateImage(alignment: $0) })) {
                Image(systemName: "align.horizontal.left").help("Do lewej").tag("left")
                Image(systemName: "align.horizontal.center").help("Do środka").tag("center")
                Image(systemName: "align.horizontal.right").help("Do prawej").tag("right")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
        }
    }

    // MARK: Warunki (warunek akapitu / punktu / sekcji, opcje umowy, „Pokaż jako”)

    private var conditionFieldLabels: [String: String] {
        var labels = controller.payload.fieldLabels
        for field in controller.payload.conditionFields ?? [] { labels[field.key] = field.label }
        return labels
    }

    @ViewBuilder private var conditionsRow: some View {
        HStack(spacing: 4) {
            Button { conditionRequest = ContractConditionRequest(initial: nil, scope: controller.conditionScope(editing: false)) } label: {
                Label("Dodaj warunek", systemImage: "line.3.horizontal.decrease.circle")
            }
            .help("Warunek dla akapitu, punktu listy albo zaznaczonych akapitów (sekcja)")
            Button("Zmień") { conditionRequest = ContractConditionRequest(initial: controller.conditionAtCursor, scope: controller.conditionScope(editing: true)) }
                .disabled(controller.conditionAtCursor == nil)
            Button { controller.removeCondition() } label: { Label("Usuń", systemImage: "trash") }
                .disabled(controller.conditionAtCursor == nil)
                .help("Usuń warunek (treść zostaje)")
        }
        .buttonStyle(.bordered)
        if let condition = controller.conditionAtCursor {
            Text(ContractConditionText.describe(condition, options: controller.options, fieldLabels: conditionFieldLabels))
                .font(.caption).foregroundStyle(ContractColorsUI.condition).lineLimit(1)
        }
        Divider().frame(height: 22)
        Button { editingOptions = true } label: { Label("Opcje (\(controller.options.count))", systemImage: "checklist") }
            .buttonStyle(.bordered)
            .help("Opcje włączane przy każdej umowie (np. nocleg)")
        Divider().frame(height: 22)
        Toggle(isOn: Binding(get: { controller.simulation != nil }, set: { on in
            controller.simulation = on ? ContractSimulation(client: "osoba", category: controller.payload.categories?.first ?? "", options: [:]) : nil
        })) {
            Label("Pokaż jako", systemImage: "eye")
        }
        .toggleStyle(.button)
        .help("Przygasza treść, której nie będzie w umowie dla wybranego klienta, wydarzenia i opcji")
        if let simulation = controller.simulation {
            Picker("Klient", selection: Binding(get: { simulation.client }, set: { controller.simulation?.client = $0 })) {
                Text("Osoba prywatna").tag("osoba")
                Text("Firma").tag("firma")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Picker("Rodzaj wydarzenia", selection: Binding(get: { simulation.category }, set: { controller.simulation?.category = $0 })) {
                Text("Bez kategorii").tag("")
                ForEach(controller.payload.categories ?? [], id: \.self) { name in Text(name).tag(name) }
            }
            .labelsHidden()
            .fixedSize()
            ForEach(controller.options, id: \.key) { option in
                Toggle(option.label, isOn: Binding(get: { simulation.options[option.key] ?? option.defaultOn },
                                                   set: { controller.simulation?.options[option.key] = $0 }))
                    .toggleStyle(.checkbox)
            }
        }
    }

    // MARK: Układ (czcionka dokumentu, logo w nagłówku, stopka)

    private static let logoPositions: [(label: String, value: Double)] = [("Lewo", 0), ("Środek", 50), ("Prawo", 100)]

    @ViewBuilder private var layoutRow: some View {
        let layout = controller.pageLayout
        Menu {
            ForEach(controller.payload.fonts ?? [], id: \.self) { font in
                Button(font.label) { controller.setDocumentFont(font.value) }
            }
        } label: {
            Label(fontName(controller.documentFont), systemImage: "textformat")
        }
        .fixedSize()
        .help("Czcionka dokumentu — we wszystkich stylach")
        Divider().frame(height: 22)
        Text("Logo w nagłówku").font(.caption).foregroundStyle(.secondary)
        Menu {
            Button("Event Rulers (domyślne)") { controller.updateLayout { $0.selectedLogo = ContractPageLayout.defaultLogo } }
            ForEach(controller.payload.brandLogos ?? [], id: \.self) { logo in
                Button("\(logo.companyName) — \(logo.label)") { controller.updateLayout { $0.selectedLogo = logo.url } }
            }
        } label: {
            Text(logoName(layout.selectedLogo)).lineLimit(1)
        }
        .fixedSize()
        Slider(value: Binding(get: { layout.logoScale }, set: { value in controller.updateLayout { $0.logoScale = value.rounded() } }), in: 20...150)
            .frame(width: 110)
            .help("Rozmiar logo")
        Picker("Położenie logo", selection: Binding<Double>(get: { layout.logoPositionX <= 33 ? 0.0 : layout.logoPositionX >= 67 ? 100.0 : 50.0 },
                                                     set: { value in controller.updateLayout { $0.logoPositionX = value } })) {
            ForEach(Self.logoPositions, id: \.value) { position in Text(position.label).tag(position.value) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        Divider().frame(height: 22)
        Text("Stopka").font(.caption).foregroundStyle(.secondary)
        Picker("Stopka", selection: Binding(get: { layout.selectedFooter }, set: { value in controller.updateLayout { $0.selectedFooter = value } })) {
            Text("Pełna").tag("default")
            Text("Minimalna").tag("minimal")
            Text("Bez stopki").tag("none")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        if layout.selectedFooter != "none", !controller.footerTemplates.isEmpty {
            Menu {
                Button("Dane z szablonu umowy") { controller.selectFooterTemplate(nil) }
                ForEach(controller.footerTemplates, id: \.id) { footer in
                    Button(footer.name) { controller.selectFooterTemplate(footer.id) }
                }
            } label: {
                Text(controller.footerTemplates.first { $0.id == layout.selectedFooterTemplateId }?.name ?? "Dane z szablonu umowy").lineLimit(1)
            }
            .fixedSize()
            .help("Dane firmy w stopce z zapisanego szablonu stopki")
        }
        Button { editingFooter = true } label: { Label("Edytuj stopkę…", systemImage: "rectangle.bottomthird.inset.filled") }
            .help("Dane firmy, logo i rozmiar logo w stopce; zapis jako szablon stopki")
    }

    private func fontName(_ family: String) -> String {
        if let font = (controller.payload.fonts ?? []).first(where: { $0.value == family }) { return font.label }
        return family.split(separator: ",").first.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) } ?? family
    }

    private func logoName(_ url: String) -> String {
        if url == ContractPageLayout.defaultLogo { return "Event Rulers (domyślne)" }
        if let logo = (controller.payload.brandLogos ?? []).first(where: { $0.url == url }) { return "\(logo.companyName) — \(logo.label)" }
        return "Własne logo"
    }

    /// Obraz z dysku: wybór pliku, wysyłka do CRM, wstawienie w rozmiarze naturalnym (najwyżej szerokość tekstu).
    private func insertImageFromFile() async {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Wybierz obraz do szablonu umowy (PNG, JPG, GIF, WebP, do 2 MB)"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let data = try? Data(contentsOf: url), let image = NSImage(data: data) else {
            state.error = "Nie udało się odczytać obrazu."
            return
        }
        guard data.count <= 2_000_000 else {
            state.error = "Obraz może mieć najwyżej 2 MB — zmniejsz go i spróbuj ponownie."
            return
        }
        guard let address = await store.uploadTemplateImage(data) else { return }
        ContractImageStore.shared.put(image, for: address)
        let width = min(100, max(10, Double(ContractImageStore.cssWidth(image) / ContractPage.contentWidth * 100).rounded()))
        controller.insertImage(address, width: width)
    }

    // MARK: Treść

    @ViewBuilder private var content: some View {
        if !word {
            ContentUnavailableView {
                Label("Szablon w starszym formacie", systemImage: "doc.badge.gearshape")
            } description: {
                Text("Edytor na Macu działa na szablonach w formacie edytora jak Word. Przekształć szablon w CRM (baner „Przekształć szablon” w edytorze) — potem otworzysz go tutaj.")
            } actions: {
                Button("Przekształć w CRM") { state.openCRM("/crm/contract-templates/\(controller.templateID)/edit-wysiwyg") }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContractSheetView(controller: controller, magnification: zoom * ContractPage.browserScale,
                              pageLayout: controller.pageLayout, fontFamily: controller.documentFont)
        }
    }

    // MARK: Czynności

    @discardableResult private func save() async -> Bool {
        guard controller.editable, controller.dirty, !controller.saving else { return !controller.dirty }
        let html = controller.html()
        let revision = controller.revision
        controller.saving = true
        defer { controller.saving = false }
        let settings = controller.settingsPayload()
        guard let updated = await store.saveTemplateContent(controller.templateID, html: html, updatedAt: controller.updatedAt,
                                                            layout: settings.layout, documentStyles: settings.styles,
                                                            options: controller.optionsPayload) else { return false }
        controller.markSaved(updatedAt: updated, html: html, revision: revision)
        return true
    }

    private func leave() {
        if controller.dirty { confirmLeave = true } else { close() }
    }

    private func close() {
        store.editorSession = nil
        store.editingTemplateID = nil
    }

    private func reload() {
        let id = controller.templateID
        store.editorSession = nil
        store.editingTemplateID = nil
        Task { @MainActor in store.editingTemplateID = id }
    }
}

/// Styl z galerii stylów (zaznaczony — styl akapitu pod kursorem).
private struct ContractStyleChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 5).fill(selected ? Color.accentColor.opacity(0.22) : Color.primary.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(selected ? Color.accentColor.opacity(0.7) : Color.clear, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
