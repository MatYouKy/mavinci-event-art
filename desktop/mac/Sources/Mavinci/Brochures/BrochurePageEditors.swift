import SwiftUI

// MARK: Panele edytora broszury: spis stron (nawigator), edycja wybranej strony i podgląd przewijany do wybranej strony.

/// Spis stron: „Ustawienia broszury”, potem wszystkie strony w kolejności PDF (przeciąganie, oko = widoczność, menu strony).
@MainActor struct BrochureNavigator: View {
    @ObservedObject var model: BrochureEditorModel
    let addService: () -> Void
    let remove: (BrochureItem) -> Void
    let removePage: (String) -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let rows = model.pageRows
        let visible = rows.filter(\.visible).count
        VStack(spacing: 0) {
            List(selection: Binding<String?>(get: { model.selectedPage }, set: { key in if let key { model.selectedPage = key } })) {
                Section {
                    Label("Ustawienia broszury", systemImage: "gearshape").tag("settings")
                    if model.data?.canViewResults == true {
                        Label("Wysyłki", systemImage: "paperplane").tag("deliveries")
                        Label("Demo i statystyki", systemImage: "chart.bar").tag("demo")
                    }
                }
                Section {
                    ForEach(rows) { row in
                        BrochureNavigatorRow(model: model, row: row)
                            .tag(row.key)
                            .contextMenu { menu(row, rows: rows) }
                    }
                    .onMove { source, destination in model.move(fromOffsets: source, toOffset: destination) }
                } header: {
                    Text("Strony · \(visible) w PDF")
                }
            }
            .listStyle(.sidebar)
            .onDeleteCommand {
                if let item = model.selectedItem, model.canEdit { remove(item) }
            }
            Divider()
            HStack(spacing: 14) {
                Button { addService() } label: { Label("Usługa", systemImage: "plus") }
                    .disabled(!model.canEdit)
                    .help("Dodaj stronę usługi z katalogu")
                Menu {
                    ForEach(model.data?.studio.presets ?? []) { preset in
                        Button(preset.label) { model.addPage(preset) }
                    }
                } label: { Label("Strona graficzna", systemImage: "paintbrush") }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .disabled(!model.canAddPage)
                    .help("Dodaj stronę graficzną — własną albo z szablonu")
                Spacer()
            }
            .buttonStyle(.borderless)
            .padding(10)
        }
    }

    @ViewBuilder private func menu(_ row: BrochurePageRow, rows: [BrochurePageRow]) -> some View {
        Button(row.visible ? "Ukryj w PDF" : "Pokaż w PDF") { model.toggle(row.key) }.disabled(!model.canEdit)
        Button("Przenieś wyżej") { model.move(row.key, by: -1) }.disabled(!model.canEdit || rows.first?.key == row.key)
        Button("Przenieś niżej") { model.move(row.key, by: 1) }.disabled(!model.canEdit || rows.last?.key == row.key)
        if row.kind == "product", let item = model.draft?.items.first(where: { "product:" + $0.id == row.key }) {
            Divider()
            Button("Usuń usługę z broszury…", role: .destructive) { remove(item) }.disabled(!model.canEdit)
        }
        if row.kind == "decorative" {
            Divider()
            Button("Powiel stronę") {
                model.selectedPage = row.key
                model.duplicatePage()
            }
            .disabled(!model.canAddPage)
            Button("Usuń stronę…", role: .destructive) { removePage(row.key) }.disabled(!model.canEdit)
        }
    }
}

/// Wiersz spisu stron: numer w PDF, miniatura, tytuł i rodzaj, znak problemu ze sprawdzenia, oko widoczności.
@MainActor struct BrochureNavigatorRow: View {
    @ObservedObject var model: BrochureEditorModel
    let row: BrochurePageRow
    @Environment(\.crmTheme) private var theme

    private var symbol: String {
        switch row.kind {
        case "cover": return "book.closed"
        case "intro": return "text.alignleft"
        case "closing": return "person.crop.rectangle"
        case "decorative": return "paintbrush"
        default: return "shippingbox"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(row.number.map({ value in String(format: "%02d", value) }) ?? "—")
                .font(.caption.monospacedDigit()).foregroundStyle(theme.accent).frame(width: 20, alignment: .trailing)
            thumbnail
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title).lineLimit(1)
                Text(row.subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if !model.issues(for: row.key).isEmpty {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).help("Strona wymaga poprawy")
            }
            Button { model.toggle(row.key) } label: { Image(systemName: row.visible ? "eye" : "eye.slash") }
                .buttonStyle(.borderless)
                .foregroundStyle(row.visible ? theme.accent : .secondary)
                .disabled(!model.canEdit)
                .help(row.visible ? "Ukryj w PDF" : "Pokaż w PDF")
        }
        .opacity(row.visible ? 1 : 0.55)
        .padding(.vertical, 2)
    }

    @ViewBuilder private var thumbnail: some View {
        if let key = row.imageKey, let address = model.imageUrls[key], let url = URL(string: address) {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.black.opacity(0.15) }
                .frame(width: 24, height: 32).clipShape(RoundedRectangle(cornerRadius: 3))
        } else {
            Image(systemName: symbol).font(.caption).foregroundStyle(.secondary)
                .frame(width: 24, height: 32).background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 3))
        }
    }
}

/// Edycja wybranej strony (albo ustawień broszury) — formularze w stylu ustawień systemowych.
@MainActor struct BrochurePageEditor: View {
    @ObservedObject var model: BrochureEditorModel
    let remove: (BrochureItem) -> Void
    let removePage: (String) -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Group {
            if model.selectedPage == "deliveries" && model.data != nil {
                // Historia wysyłek (część G3) — bez blokady edycji: przeglądanie i wysyłka przygotowanych wiadomości.
                BrochureDeliveriesPanel(model: model)
            } else if model.selectedPage == "demo" && model.draft != nil {
                // Demo i statystyki (część G4).
                BrochureDemoPanel(model: model)
            } else if let data = model.data, model.draft != nil {
                Form {
                    if let blocked = model.saveBlocked { Section { notice(blocked, symbol: "exclamationmark.circle", color: .orange) } }
                    if let error = model.validationError { Section { notice(error, symbol: "exclamationmark.triangle", color: .orange) } }
                    if model.selectedPage == "settings" {
                        settings(data)
                    } else {
                        pageHeader
                        switch model.selectedRow?.kind ?? "" {
                        case "cover": cover
                        case "intro": intro
                        case "closing": closing
                        case "product": product
                        case "decorative": decorative
                        default: EmptyView()
                        }
                    }
                }
                .formStyle(.grouped)
                .disabled(!model.canEdit)
            }
        }
    }

    private func notice(_ text: String, symbol: String, color: Color) -> some View {
        Label(text, systemImage: symbol).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
    }

    private func text(_ path: WritableKeyPath<BrochureDraft, String>) -> Binding<String> {
        Binding(get: { model.draft?[keyPath: path] ?? "" }, set: { value in model.draft?[keyPath: path] = value })
    }

    // MARK: Nagłówek strony — numer, widoczność, problemy ze sprawdzenia

    @ViewBuilder private var pageHeader: some View {
        if let row = model.selectedRow {
            let total = model.pageRows.filter { $0.visible }.count
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title).font(.title3.weight(.semibold)).lineLimit(2)
                        Text(row.number.map({ number in "Strona \(number) z \(total) · \(row.subtitle)" }) ?? "Ukryta — nie trafi do PDF")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("W PDF", isOn: Binding(get: { row.visible }, set: { _ in model.toggle(row.key) }))
                        .toggleStyle(.switch)
                        .help(row.visible ? "Strona trafi do PDF" : "Strona jest ukryta i nie trafi do PDF")
                }
                let issues = model.issues(for: row.key)
                if !issues.isEmpty {
                    ForEach(issues) { issue in
                        VStack(alignment: .leading, spacing: 2) {
                            Label("\(issue.element): \(issue.message)", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            Text(issue.remedy).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if model.issuesStale {
                        Text("Treść zmieniła się od sprawdzenia — użyj „Sprawdź” ponownie.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Ustawienia broszury

    @ViewBuilder private func settings(_ data: BrochureEditorData) -> some View {
        Section {
            TextField("Nazwa robocza", text: text(\.name), prompt: Text("Nazwa na liście broszur"))
            Picker("Odbiorca", selection: text(\.audienceType)) {
                ForEach(BrochureAudience.all) { audience in Text(audience.label).tag(audience.key) }
            }
            LabeledContent("Dla organizacji") {
                BrochureOrganizationPicker(organizations: data.organizations,
                                           selection: Binding(get: { model.draft?.organizationId }, set: { value in model.draft?.organizationId = value }),
                                           disabled: !model.canEdit)
                    .frame(maxWidth: 280)
            }
            Picker("Marka / działalność", selection: text(\.myCompanyId)) {
                ForEach(data.companies) { company in Text(company.name).tag(company.id) }
            }
            Picker("Opiekun", selection: Binding(get: { model.draft?.contactEmployeeId ?? "" }, set: { value in model.draft?.contactEmployeeId = value.isEmpty ? nil : value })) {
                Text("Bez wskazanego opiekuna").tag("")
                ForEach(data.employees) { person in Text(person.name).tag(person.id) }
            }
        } header: {
            Text("Broszura")
        } footer: {
            Text("Organizacja wstawia „Przygotowano dla …” i nazwę klienta w treściach. Opiekun pojawia się na stronie kontaktu.")
        }
        Section("Kolory") {
            colorRow("Kolor przewodni", path: \.brandColor, fallback: model.company?.secondaryColor ?? "#1c1f33")
            colorRow("Kolor akcentów", path: \.accentColor, fallback: model.company?.primaryColor ?? "#d3bb73")
            HStack {
                Button("Burgund i złoto Mavinci") {
                    model.draft?.composer.brandColor = "#650026"
                    model.draft?.composer.accentColor = "#d3bb73"
                }
                Button("Kolory z brandbooka marki") {
                    model.draft?.composer.brandColor = ""
                    model.draft?.composer.accentColor = ""
                }
                .disabled((model.draft?.composer.brandColor ?? "").isEmpty && (model.draft?.composer.accentColor ?? "").isEmpty)
            }
        }
        if model.outdatedPdf {
            Section {
                notice("Treść zmieniła się od wygenerowania PDF. Przed użyciem w kampanii utwórz nową wersję.", symbol: "doc.badge.clock", color: .orange)
            }
        }
    }

    private func colorRow(_ label: String, path: WritableKeyPath<BrochureComposer, String>, fallback: String) -> some View {
        ColorPicker(label, selection: Binding(
            get: { CrmTheme.hex(model.draft?.composer[keyPath: path]) ?? CrmTheme.hex(fallback) ?? .gray },
            set: { color in model.draft?.composer[keyPath: path] = CrmTheme.hexString(color) }
        ), supportsOpacity: false)
    }

    // MARK: Okładka, wprowadzenie, zakończenie

    @ViewBuilder private var cover: some View {
        let draft = model.draft
        let composerPath = draft?.composer.coverImagePath ?? ""
        let path = composerPath.isEmpty ? (draft?.coverImagePath ?? "") : composerPath
        let bucket = composerPath.isEmpty ? "offer-product-pages" : (draft?.composer.coverImageBucket ?? "offer-product-pages")
        Section("Treść okładki") {
            TextField("Tytuł", text: text(\.title), prompt: Text("Wymagany"), axis: .vertical).lineLimit(1...4)
            TextField("Podtytuł", text: text(\.subtitle), axis: .vertical).lineLimit(1...4)
        }
        Section {
            BrochureImageField(model: model, path: path, bucket: bucket, emptyLabel: "Automatycznie — zdjęcie pierwszej usługi",
                               clearLabel: "Użyj zdjęcia pierwszej usługi", assets: model.assets) { newPath, newBucket in
                model.setCover(path: newPath, bucket: newBucket)
            }
            if !model.assetNotice.isEmpty { Text(model.assetNotice).font(.caption).foregroundStyle(.secondary) }
            coverSlider("Kadr poziomo", path: \.coverX, range: 0...100)
            coverSlider("Kadr pionowo", path: \.coverY, range: 0...100)
            coverSlider("Przyciemnienie", path: \.coverOverlay, range: 0...95)
        } header: {
            Text("Zdjęcie okładki")
        }
    }

    private func coverSlider(_ label: String, path: WritableKeyPath<BrochureComposer, Double>, range: ClosedRange<Double>) -> some View {
        let title = "\(label) · \(Int(model.draft?.composer[keyPath: path] ?? 0))%"
        return LabeledContent(title) {
            Slider(value: Binding(get: { model.draft?.composer[keyPath: path] ?? range.lowerBound },
                                  set: { value in model.draft?.composer[keyPath: path] = value.rounded() }), in: range)
                .frame(maxWidth: 260)
        }
    }

    @ViewBuilder private var intro: some View {
        Section {
            TextField("", text: text(\.introduction), prompt: Text("Puste pole — standardowy tekst wprowadzenia Mavinci"), axis: .vertical)
                .lineLimit(6...16).labelsHidden()
        } header: {
            Text("Wprowadzenie")
        } footer: {
            Text("Tytuł tej strony zmienia się sam: „Dla …” z nazwą organizacji z ustawień broszury.")
        }
    }

    @ViewBuilder private var closing: some View {
        Section {
            TextField("", text: text(\.closingText), prompt: Text("Zachęta do kontaktu i następny krok"), axis: .vertical)
                .lineLimit(5...14).labelsHidden()
        } header: {
            Text("Zakończenie / CTA")
        } footer: {
            Text("Dane kontaktowe na tej stronie pochodzą od opiekuna wskazanego w ustawieniach broszury.")
        }
        Section {
            Button("Zmień opiekuna w ustawieniach broszury") { model.selectedPage = "settings" }
        }
    }

    // MARK: Strona usługi

    private func itemText(_ get: @escaping (BrochureItem) -> String, _ set: @escaping (inout BrochureItem, String) -> Void) -> Binding<String> {
        Binding(get: { model.selectedItem.map(get) ?? "" }, set: { value in model.updateSelectedItem { item in set(&item, value) } })
    }

    /// Nagłówek pola z informacją, czy treść pochodzi z katalogu, i przyciskiem powrotu do katalogu.
    private func inherited(_ label: String, custom: Bool, reset: @escaping () -> Void) -> some View {
        HStack {
            Text(label)
            Spacer()
            if custom {
                Button("Przywróć z katalogu") { reset() }.buttonStyle(.borderless).font(.caption)
            } else {
                Text("z katalogu").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var product: some View {
        if let item = model.selectedItem {
            Section("Układ strony") {
                Picker("", selection: itemText({ $0.layout }, { item, value in item.layout = value })) {
                    Text("Wizualny").tag("visual")
                    Text("Klasyczny").tag("classic")
                    Text("Kompaktowy").tag("compact")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            Section {
                BrochureImageField(model: model, path: item.imagePath, bucket: "offer-product-pages", emptyLabel: "Brak zdjęcia w katalogu",
                                   clearLabel: "Przywróć zdjęcie katalogowe",
                                   assets: model.assets.filter { $0.bucket == "offer-product-pages" }) { path, _ in
                    model.updateSelectedItem { current in current.customImagePath = path.isEmpty ? nil : path }
                }
                .id(item.id)
            } header: {
                inherited("Zdjęcie", custom: item.customImagePath != nil) { model.updateSelectedItem { current in current.customImagePath = nil } }
            } footer: {
                Text("Zmiana dotyczy tylko tej broszury — zdjęcie w katalogu usług zostaje bez zmian.")
            }
            Section {
                TextField("", text: itemText({ $0.customTitle ?? $0.base.title }, { item, value in item.customTitle = value }), axis: .vertical)
                    .lineLimit(1...3).labelsHidden()
            } header: {
                inherited("Tytuł", custom: item.customTitle != nil) { model.updateSelectedItem { current in current.customTitle = nil } }
            }
            Section {
                TextField("", text: itemText({ $0.customShort ?? $0.short }, { item, value in item.customShort = value }), axis: .vertical)
                    .lineLimit(2...6).labelsHidden()
            } header: {
                inherited("Lead", custom: item.customShort != nil) { model.updateSelectedItem { current in current.customShort = nil } }
            }
            Section {
                TextField("", text: itemText({ $0.customDescription ?? $0.description }, { item, value in item.customDescription = value }), axis: .vertical)
                    .lineLimit(6...18).labelsHidden()
            } header: {
                inherited("Opis", custom: item.customDescription != nil) { model.updateSelectedItem { current in current.customDescription = nil } }
            }
            Section {
                TextField("", text: itemText({ ($0.customBenefits ?? $0.benefits).joined(separator: "\n") },
                                             { item, value in item.customBenefits = value.components(separatedBy: "\n") }),
                          prompt: Text("Jedna korzyść w wierszu; pusta lista ukrywa korzyści"), axis: .vertical)
                    .lineLimit(4...12).labelsHidden()
            } header: {
                inherited("Korzyści", custom: item.customBenefits != nil) { model.updateSelectedItem { current in current.customBenefits = nil } }
            }
            Section {
                Button("Przywróć całą stronę z katalogu") { model.restoreCatalog() }
                    .disabled(item.customTitle == nil && item.customShort == nil && item.customDescription == nil && item.customBenefits == nil && item.customImagePath == nil)
                Button("Usuń usługę z broszury…", role: .destructive) { remove(item) }
            }
        }
    }

    // MARK: Strona graficzna — Studio stron (`BrochureStudio.swift`)

    private var decorative: some View {
        BrochureStudioSections(model: model, removePage: removePage)
    }
}

/// Podgląd wszystkich stron (ten sam układ i brandbook co PDF) przewijany do wybranej strony.
@MainActor struct BrochurePreviewPane: View {
    @ObservedObject var model: BrochureEditorModel
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("Podgląd", systemImage: "eye").font(.callout)
                if model.previewLoading { ProgressView().controlSize(.small) }
                Spacer()
                Text("\(model.previewPages) stron").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            GeometryReader { proxy in
                ZStack {
                    if model.previewHtml.isEmpty {
                        if let error = model.previewError {
                            Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
                        } else {
                            ProgressView("Przygotowywanie podglądu…")
                        }
                    } else {
                        BrochureWebPreview(html: model.previewHtml, zoom: max(0.2, (proxy.size.width - 8) / 794), background: theme.page,
                                           focus: ["settings", "deliveries", "demo"].contains(model.selectedPage) ? nil : model.selectedPage)
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
            if let error = model.previewError, !model.previewHtml.isEmpty {
                Divider()
                Text(error).font(.caption).foregroundStyle(.orange).padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
