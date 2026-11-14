import SwiftUI
import WebKit
import UniformTypeIdentifiers

// MARK: Elementy i okna edytora broszury: pole zdjęcia z biblioteką miniatur i przeciąganiem pliku, katalog usług,
// „Generuj PDF” z wyborem odbiorcy (`BrochureClientPicker`), lista problemów ze sprawdzenia, wybór organizacji
// i podgląd stron (WebKit).

/// Zdjęcie strony: miniatura, „Wybierz z biblioteki…”, „Z dysku…”, upuszczenie pliku na miniaturę, przywrócenie domyślnego.
@MainActor struct BrochureImageField: View {
    @ObservedObject var model: BrochureEditorModel
    let path: String
    let bucket: String
    let emptyLabel: String
    let clearLabel: String
    let assets: [BrochureAsset]
    let onChange: (String, String) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var gallery = false
    @State private var importing = false
    @State private var targeted = false

    private var key: String { path.isEmpty ? "" : BrochureAsset.key(bucket, path) }
    private var previewURL: URL? {
        if let address = model.imageUrls[key] { return URL(string: address) }
        return path.hasPrefix("https://") || path.hasPrefix("http://") ? URL(string: path) : nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            thumbnail
                .frame(width: 150, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(targeted ? theme.accent : Color.secondary.opacity(0.25), lineWidth: targeted ? 2 : 1))
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first, model.canEdit else { return false }
                    upload(url)
                    return true
                } isTargeted: { value in targeted = value }
                .help("Upuść tu plik JPG, PNG lub WebP")
            VStack(alignment: .leading, spacing: 6) {
                Button { gallery = true } label: { Label("Wybierz z biblioteki…", systemImage: "photo.on.rectangle") }
                Button { importing = true } label: {
                    Label(model.busy == "upload" ? "Wgrywanie…" : "Z dysku…", systemImage: "square.and.arrow.up")
                }
                if !path.isEmpty {
                    Button(clearLabel) { onChange("", "offer-product-pages") }.buttonStyle(.borderless).font(.caption)
                }
                Text("JPG, PNG lub WebP do 10 MB — możesz też przeciągnąć plik na miniaturę.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .disabled(!model.canEdit)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            guard case .success(let url) = result else { return }
            upload(url)
        }
        .sheet(isPresented: $gallery) {
            BrochureGallerySheet(model: model, assets: assets, selectedKey: key, emptyLabel: emptyLabel) { newPath, newBucket in
                onChange(newPath, newBucket)
            }
        }
    }

    @ViewBuilder private var thumbnail: some View {
        if let previewURL {
            AsyncImage(url: previewURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black.opacity(0.12))
            }
        } else {
            VStack(spacing: 4) {
                Image(systemName: path.isEmpty ? "photo" : "hourglass").font(.title3)
                Text(path.isEmpty ? emptyLabel : "Wczytywanie…").font(.caption2).multilineTextAlignment(.center)
            }
            .foregroundStyle(.secondary)
            .padding(6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.12))
        }
    }

    private func upload(_ url: URL) {
        Task {
            if let uploaded = await model.upload(url) { onChange(uploaded.path, uploaded.bucket) }
        }
    }
}

/// Grupa źródeł w bibliotece zdjęć.
struct BrochureAssetGroup: Identifiable {
    let key: String
    let label: String
    var id: String { key }
    static let all: [BrochureAssetGroup] = [
        BrochureAssetGroup(key: "all", label: "Wszystkie"),
        BrochureAssetGroup(key: "service", label: "Usługi"),
        BrochureAssetGroup(key: "offer", label: "Oferty"),
        BrochureAssetGroup(key: "portfolio", label: "Portfolio"),
        BrochureAssetGroup(key: "hotel", label: "Hotel"),
        BrochureAssetGroup(key: "brochure", label: "Ta broszura"),
    ]
}

/// Biblioteka zdjęć z miniaturami: filtr źródła, wyszukiwanie po nazwie, wybór kliknięciem.
@MainActor struct BrochureGallerySheet: View {
    @ObservedObject var model: BrochureEditorModel
    let assets: [BrochureAsset]
    let selectedKey: String
    let emptyLabel: String
    let choose: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var group = "all"
    @State private var query = ""

    private var groups: [BrochureAssetGroup] {
        BrochureAssetGroup.all.filter { entry in entry.key == "all" || assets.contains(where: { $0.group == entry.key }) }
    }
    private var filtered: [BrochureAsset] {
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        return assets.filter { asset in
            (group == "all" || asset.group == group) && (term.isEmpty || asset.label.lowercased().contains(term))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("Biblioteka zdjęć").font(.title3.weight(.semibold))
                Spacer()
                TextField("", text: $query, prompt: Text("Szukaj po nazwie…")).textFieldStyle(.roundedBorder).frame(width: 240)
            }
            .padding([.horizontal, .top], 16)
            Picker("", selection: $group) {
                ForEach(groups) { entry in Text(entry.label).tag(entry.key) }
            }
            .pickerStyle(.segmented).labelsHidden()
            .padding(.horizontal, 16).padding(.vertical, 10)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                    tile(title: emptyLabel, selected: selectedKey.isEmpty) {
                        Image(systemName: "nosign").font(.title2).foregroundStyle(.secondary)
                    } action: {
                        choose("", "offer-product-pages")
                    }
                    ForEach(filtered) { asset in
                        tile(title: asset.label, selected: asset.key == selectedKey) {
                            if let address = model.imageUrls[asset.key], let url = URL(string: address) {
                                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { ProgressView().controlSize(.small) }
                            } else {
                                ProgressView().controlSize(.small)
                            }
                        } action: {
                            choose(asset.path, asset.bucket)
                        }
                    }
                }
                .padding(16)
            }
            Divider()
            HStack {
                Text("\(filtered.count) zdjęć").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(12)
        }
        .frame(width: 780, height: 580)
        .task { await model.sign(assets.map { asset in (bucket: asset.bucket, path: asset.path) }) }
    }

    private func tile<Thumb: View>(title: String, selected: Bool, @ViewBuilder thumb: () -> Thumb, action: @escaping () -> Void) -> some View {
        Button {
            action()
            dismiss()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                thumb()
                    .frame(maxWidth: .infinity)
                    .frame(height: 100)
                    .background(Color.black.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                Text(title).font(.caption).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(6)
            .background(selected ? theme.accent.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(selected ? theme.accent : Color.clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// „Dodaj usługę” — katalog usług i wariantów z wyszukiwaniem; dodana strona trafia przed zakończenie i zostaje wybrana.
@MainActor struct BrochureCatalogSheet: View {
    @ObservedObject var model: BrochureEditorModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var query = ""

    var body: some View {
        let products = model.data?.products ?? []
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        let filtered = term.isEmpty ? products : products.filter { "\($0.name) \($0.category ?? "")".lowercased().contains(term) }
        let items = model.draft?.items ?? []
        let addedVariants = Set(items.compactMap(\.variantId))
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("Dodaj usługę z katalogu").font(.title3.weight(.semibold))
                Spacer()
                TextField("", text: $query, prompt: Text("Szukaj usługi…")).textFieldStyle(.roundedBorder).frame(width: 240)
            }
            .padding(16)
            Divider()
            List(filtered) { product in
                row(product, baseAdded: items.contains(where: { $0.productId == product.id && $0.variantId == nil }), addedVariants: addedVariants)
            }
            .listStyle(.inset)
            Divider()
            HStack {
                Text("Treść strony pochodzi z katalogu — zmienisz ją tylko dla tej broszury.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Gotowe") { dismiss() }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            }
            .padding(12)
        }
        .frame(width: 620, height: 620)
    }

    private func row(_ product: BrochureEditorData.Product, baseAdded: Bool, addedVariants: Set<String>) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let address = product.imageUrl, let url = URL(string: address) {
                    AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.black.opacity(0.15) }
                } else {
                    Image(systemName: "photo").foregroundStyle(.tertiary).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black.opacity(0.15))
                }
            }
            .frame(width: 72, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                Text(product.name).font(.callout.weight(.medium))
                Text(product.category ?? "Bez kategorii").font(.caption).foregroundStyle(.secondary)
                if !product.variants.isEmpty {
                    ProductFlowLayout(spacing: 6) {
                        ForEach(product.variants) { variant in
                            let added = addedVariants.contains(variant.id)
                            Button { Task { await model.add(product: product, variant: variant) } } label: {
                                Label(variant.name, systemImage: added ? "checkmark" : "plus").font(.caption)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .disabled(!model.canEdit || added)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            if baseAdded {
                Label("W broszurze", systemImage: "checkmark").font(.caption).foregroundStyle(theme.accent)
            } else {
                Button { Task { await model.add(product: product, variant: nil) } } label: { Label("Dodaj", systemImage: "plus") }
                    .disabled(!model.canEdit)
            }
        }
        .padding(.vertical, 4)
    }
}

/// „Generuj PDF”: wersja ogólna albo dla klienta (kontakt lub organizacja) i e-mail odbiorcy; po wygenerowaniu — „Pokaż PDF”.
@MainActor struct BrochurePdfSheet: View {
    @ObservedObject var model: BrochureEditorModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var forClient: Bool
    @State private var result: BrochurePdfResult?

    init(model: BrochureEditorModel) {
        self.model = model
        _forClient = State(initialValue: model.recipient != nil)
    }

    private var working: Bool { model.busy == "pdf" }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Generuj PDF").font(.title3.weight(.semibold))
            if let result { done(result) } else { form }
        }
        .padding(20)
        .frame(width: 540)
        .interactiveDismissDisabled(working)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("", selection: $forClient) {
                Text("Wersja ogólna").tag(false)
                Text("Dla klienta").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden()
            .onChange(of: forClient) { _, client in if !client { model.recipient = nil } }
            if forClient {
                BrochureClientPickerView(model: model)
            } else {
                Text("Wersja ogólna zastępuje dotychczasowy PDF broszury — z niej powstają kampanie.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ProductField(label: "E-mail odbiorcy tej wersji — opcjonalnie") {
                TextField("", text: $model.recipientEmail, prompt: Text("np. sprzedaz@hotel.pl")).textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Generowanie zapisuje osobny PDF, ale nie wysyła wiadomości. Plik przypisany do klienta zostaje w jego kartotece i nie zastępuje wersji ogólnej.")
                if model.draft?.sellerDemo == true {
                    Text("Link demo w PDF będzie przypisany do Ciebie i podanego e-maila (ukrytego w zaszyfrowanym linku).")
                }
            }
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                if working {
                    ProgressView().controlSize(.small)
                    Text("Generowanie — do 3 minut…").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working)
                Button { Task { await generate() } } label: { Label(forClient ? "Generuj PDF dla klienta" : "Generuj PDF", systemImage: "doc.richtext") }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(working || !model.canGenerate || (forClient && model.recipient == nil))
            }
        }
    }

    private func generate() async {
        if let generated = await model.generate(validateOnly: false) {
            result = generated
        } else if !(model.issues ?? []).isEmpty {
            // Problemy są oznaczone w spisie stron — okno zamyka się, żeby można było je od razu poprawić.
            dismiss()
        }
    }

    private func done(_ result: BrochurePdfResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(result.version.map({ version in "Zapisano PDF v\(version)" }) ?? "Zapisano PDF", systemImage: "checkmark.circle.fill")
                .font(.headline).foregroundStyle(.green)
            Text(model.recipient != nil
                 ? "PDF jest w zakładce Broszury klienta. Wersja ogólna pozostała bez zmian. Nie wysłano wiadomości."
                 : "Nowa wersja ogólna broszury jest gotowa. Nie wysłano wiadomości.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
                if result.downloadURL != nil {
                    Button {
                        let generated = result
                        dismiss()
                        Task { await model.openGenerated(generated) }
                    } label: { Label("Pokaż PDF", systemImage: "doc.richtext") }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                }
            }
        }
    }
}

/// „Powiąż tę wersję PDF z klientem”: kontakt (z obecną organizacją) albo organizacja z bazy CRM.
@MainActor struct BrochureClientPickerView: View {
    @ObservedObject var model: BrochureEditorModel
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var mode = "contact"
    @State private var query = ""
    @State private var results: [BrochureClientResult] = []
    @State private var organizations: [BrochureClientResult.Organization] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let value = model.recipient { selected(value) } else { search }
            if let error { Text(error).font(.caption).foregroundStyle(.orange) }
        }
        .disabled(!model.canEdit)
        .task(id: "\(mode)|\(query)|\(model.recipient == nil)") { await find() }
    }

    private func find() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        results = []
        error = nil
        loading = false
        guard model.recipient == nil, term.count >= 2 else { return }
        loading = true
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        do {
            let found = try await model.store.clients(mode: mode, query: term)
            guard !Task.isCancelled else { return }
            results = found
        } catch {
            if !Task.isCancelled { self.error = "Nie udało się wyszukać klientów. Zmień zapytanie, aby spróbować ponownie." }
        }
        if !Task.isCancelled { loading = false }
    }

    private var search: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("", selection: $mode) {
                    Text("Kontakt").tag("contact")
                    Text("Organizacja").tag("organization")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                .onChange(of: mode) { _, _ in query = "" }
                TextField("", text: $query, prompt: Text(mode == "contact" ? "Imię, nazwisko lub e-mail" : "Nazwa organizacji lub e-mail"))
                    .textFieldStyle(.roundedBorder)
            }
            if loading {
                Text("Wyszukiwanie klientów…").font(.caption).foregroundStyle(.secondary)
            } else if query.trimmingCharacters(in: .whitespaces).count >= 2 && error == nil && results.isEmpty {
                Text("Brak pasujących klientów.").font(.caption).foregroundStyle(.secondary)
            } else if query.trimmingCharacters(in: .whitespaces).count < 2 {
                Text("Wpisz co najmniej 2 znaki.").font(.caption).foregroundStyle(.secondary)
            }
            if !results.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(results) { row in
                            Button { choose(row) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.name)
                                    Text(details(row)).font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 6).padding(.horizontal, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 200)
                .background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func details(_ row: BrochureClientResult) -> String {
        let email = row.email.isEmpty ? "Brak e-maila — nadal możesz podpiąć PDF" : row.email
        let names = row.organizations.map { $0.name }.joined(separator: ", ")
        return row.organizations.isEmpty ? email : "\(email) · \(names)"
    }

    private func choose(_ row: BrochureClientResult) {
        let contact = mode == "contact"
        let organization: BrochureClientResult.Organization? = contact
            ? (row.organizations.count == 1 ? row.organizations.first : nil)
            : BrochureClientResult.Organization(id: row.id, name: row.name)
        organizations = row.organizations
        query = ""
        results = []
        model.recipient = BrochureClient(contactId: contact ? row.id : nil, organizationId: organization?.id, name: row.name, organizationName: organization?.name)
        model.recipientEmail = row.email
    }

    private func selected(_ value: BrochureClient) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(value.name, systemImage: value.contactId != nil ? "person.crop.circle" : "building.2").font(.headline)
                Spacer()
                Button("Zmień klienta") {
                    model.recipient = nil
                    model.recipientEmail = ""
                    organizations = []
                }
                .buttonStyle(.borderless)
            }
            if value.contactId != nil && !organizations.isEmpty {
                Picker("Organizacja", selection: Binding(get: { value.organizationId ?? "" }, set: { next in
                    let organization = organizations.first(where: { $0.id == next })
                    model.recipient = BrochureClient(contactId: value.contactId, organizationId: organization?.id, name: value.name, organizationName: organization?.name)
                })) {
                    Text("Tylko kontakt — bez organizacji").tag("")
                    ForEach(organizations) { organization in Text(organization.name).tag(organization.id) }
                }
            }
            HStack {
                Text("Po wygenerowaniu plik pojawi się przy \(value.contactId != nil && value.organizationId != nil ? "kontakcie oraz organizacji" : value.contactId != nil ? "tym kontakcie" : "tej organizacji").")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Broszury klienta w CRM") { state.openCRM("/crm/contacts/\(value.contactId ?? value.organizationId ?? "")?tab=brochures") }
                    .buttonStyle(.borderless).font(.caption)
            }
        }
        .padding(10)
        .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Lista problemów ze sprawdzenia broszury (okienko z paska narzędzi) — kliknięcie przenosi do strony.
@MainActor struct BrochureIssuesList: View {
    @ObservedObject var model: BrochureEditorModel
    let issues: [BrochureIssue]
    let done: () -> Void
    @EnvironmentObject private var state: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Do poprawy przed PDF (\(issues.count))").font(.headline)
            if model.issuesStale {
                Text("Treść zmieniła się od sprawdzenia — wynik może być nieaktualny.").font(.caption).foregroundStyle(.orange)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(issues) { issue in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(issue.label).font(.callout.weight(.medium))
                            if let file = issue.fileName { Text("Plik: \(file)").font(.caption).foregroundStyle(.secondary) }
                            Text(issue.message).font(.callout).foregroundStyle(.orange)
                            Text(issue.remedy).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            action(issue).padding(.top, 2)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .padding(14)
    }

    @ViewBuilder private func action(_ issue: BrochureIssue) -> some View {
        if ["logo", "font"].contains(issue.field) {
            Button { state.openCRM(editorURL(issue)) } label: { Label("Otwórz brandbook marki", systemImage: "arrow.up.forward.square") }
        } else {
            Button("Przejdź do strony") { go(issue) }
        }
    }

    private func go(_ issue: BrochureIssue) {
        if model.pageRows.contains(where: { $0.key == issue.pageKey }) {
            model.selectedPage = issue.pageKey
            done()
        } else {
            state.snack = Snack(kind: .info, text: "Ta strona została usunięta. Sprawdź broszurę ponownie.")
        }
    }

    /// Adres poprawy jak `brochureIssueEditorUrl` w CRM.
    private func editorURL(_ issue: BrochureIssue) -> String {
        if let company = issue.companyId, ["logo", "font"].contains(issue.field), UUID(uuidString: company) != nil {
            return "/crm/settings/my-companies/\(company)/brandbook"
        }
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#:"))
        let page = issue.pageKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        let field = issue.field.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return "/crm/brochures/\(model.id)?page=\(page)&field=\(field)#brochure-page-studio"
    }
}

/// Organizacja broszury — wybór z wyszukiwaniem (lista aktywnych organizacji CRM).
@MainActor struct BrochureOrganizationPicker: View {
    let organizations: [BrochureEditorData.Option]
    @Binding var selection: String?
    let disabled: Bool
    @State private var open = false
    @State private var query = ""

    private var filtered: [BrochureEditorData.Option] {
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        let list = term.isEmpty ? organizations : organizations.filter { $0.name.lowercased().contains(term) }
        return Array(list.prefix(300))
    }

    var body: some View {
        Button { open = true } label: {
            HStack {
                Text(organizations.first(where: { $0.id == selection })?.name ?? "Broszura ogólna").lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption)
            }
            .frame(maxWidth: .infinity)
        }
        .disabled(disabled)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("", text: $query, prompt: Text("Szukaj organizacji…")).textFieldStyle(.roundedBorder)
                List {
                    Button("Broszura ogólna — bez organizacji") { pick(nil) }.buttonStyle(.plain)
                    ForEach(filtered) { organization in
                        Button(organization.name) { pick(organization.id) }.buttonStyle(.plain)
                    }
                }
                .listStyle(.plain)
            }
            .padding(12)
            .frame(width: 340, height: 380)
        }
    }

    private func pick(_ id: String?) {
        selection = id
        open = false
        query = ""
    }
}

/// Podgląd stron broszury: HTML z serwera (ten sam układ co PDF) bez skryptów strony. Po odświeżeniu treści zostaje miejsce
/// przewinięcia; zmiana wybranej strony przewija do niej (`data-page-key`).
struct BrochureWebPreview: NSViewRepresentable {
    let html: String
    let zoom: CGFloat
    let background: Color
    let focus: String?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let coordinator = context.coordinator
        view.underPageBackgroundColor = NSColor(background)
        if abs(view.pageZoom - zoom) > 0.001 { view.pageZoom = max(0.1, zoom) }
        let focusChanged = coordinator.focus != focus
        coordinator.focus = focus
        if coordinator.html != html {
            coordinator.html = html
            coordinator.pendingFocus = focusChanged || coordinator.firstLoad
            coordinator.firstLoad = false
            coordinator.update(view, html: html)
        } else if focusChanged {
            coordinator.scrollToFocus(view)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var html: String?
        var focus: String?
        var scroll: Double = 0
        var pendingFocus = false
        var firstLoad = true
        /// Dokument wczytany — kolejne zmiany podmieniają tylko zmienione strony, bez przeładowania całego podglądu.
        private var loaded = false

        /// Podmiana w miejscu (jak przy pisaniu): style, gdy się zmieniły, i tylko te strony, których treść się zmieniła —
        /// przewinięcie i wczytane zdjęcia zostają. Inna kolejność stron przebudowuje treść, a błąd — wczytuje całość.
        private static let patch = """
        const signed = /https?:\\/\\/[^"'\\s)]+?\\?token=[^"'\\s)&]+/g;
        const strip = (value) => value.replace(/\\?token=[^"'\\s)&]+/g, '');
        const known = new Map();
        for (const match of document.documentElement.innerHTML.matchAll(signed)) known.set(strip(match[0]), match[0]);
        const reuse = (markup) => markup.replace(signed, (url) => known.get(strip(url)) || url);
        const next = new DOMParser().parseFromString(html, 'text/html');
        if (!document.body || !next.body) return 'reload';
        if (strip(next.head.innerHTML) !== strip(document.head.innerHTML)) document.head.innerHTML = reuse(next.head.innerHTML);
        const before = Array.from(document.body.querySelectorAll(':scope > [data-page-key]'));
        const after = Array.from(next.body.querySelectorAll(':scope > [data-page-key]'));
        const same = before.length === after.length && before.length === document.body.children.length
          && after.length === next.body.children.length
          && before.every((page, index) => page.getAttribute('data-page-key') === after[index].getAttribute('data-page-key'));
        if (!same) {
          document.body.innerHTML = reuse(next.body.innerHTML);
          return 'body';
        }
        let changed = 0;
        after.forEach((page, index) => {
          if (strip(page.outerHTML) === strip(before[index].outerHTML)) return;
          before[index].outerHTML = reuse(page.outerHTML);
          changed += 1;
        });
        return 'pages:' + changed;
        """

        func update(_ view: WKWebView, html: String) {
            guard loaded else {
                load(view, html: html)
                return
            }
            view.callAsyncJavaScript(Self.patch, arguments: ["html": html], in: nil, in: .defaultClient) { [weak self] result in
                guard let self, self.html == html else { return }
                switch result {
                case .success(let value) where (value as? String) != "reload":
                    if self.pendingFocus {
                        self.pendingFocus = false
                        self.scrollToFocus(view)
                    }
                default:
                    self.load(view, html: html)
                }
            }
        }

        private func load(_ view: WKWebView, html: String) {
            loaded = false
            view.evaluateJavaScript("window.scrollY") { [weak self] value, _ in
                guard let self else { return }
                self.scroll = (value as? Double) ?? 0
                view.loadHTMLString(html, baseURL: nil)
            }
        }

        func scrollToFocus(_ view: WKWebView) {
            guard let focus, focus.range(of: #"^[A-Za-z0-9:_-]+$"#, options: .regularExpression) != nil else { return }
            view.evaluateJavaScript("document.querySelector('[data-page-key=\"\(focus)\"]')?.scrollIntoView({block:'start'})", completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            if pendingFocus {
                pendingFocus = false
                scrollToFocus(webView)
            } else if scroll > 0 {
                webView.evaluateJavaScript("window.scrollTo(0, \(scroll))", completionHandler: nil)
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Podgląd nie nawiguje: linki na stronach (np. demo) działają w gotowym PDF.
            decisionHandler(action.navigationType == .other ? .allow : .cancel)
        }
    }
}
