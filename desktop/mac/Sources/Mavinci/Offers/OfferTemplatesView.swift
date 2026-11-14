import SwiftUI
import UniformTypeIdentifiers

// MARK: Szablony ofert — „Projekt oferty PDF” (`OfferPageTemplatesEditor`): kategorie (przypisanie do kategorii wydarzeń,
// zdjęcie hero, wygląd), pięć etapów dokumentu z szablonami stron, własne tło PDF, „Wróć do Mavinci”, nowy szablon i usuwanie.
// Rozmieszczanie pól na tle i tabela wyceny — w następnej części (na razie w CRM).

@MainActor struct OfferTemplatesView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @StateObject private var store = OfferTemplatesStore()
    @State private var expanded: Set<String> = []
    @State private var categoryRoute: CategoryRoute?
    @State private var createRoute: CreateRoute?
    @State private var deleting: OfferTemplatesState.Template?
    @State private var removingBackground: OfferTemplatesState.Template?
    @State private var uploadTarget: OfferTemplatesState.Template?
    @State private var importing = false

    /// Okno kategorii: nowa (`category == nil`) albo edycja.
    struct CategoryRoute: Identifiable {
        let category: OfferTemplatesState.Category?
        let id = UUID()
    }
    struct CreateRoute: Identifiable {
        let categoryID: String
        let type: String
        let id = UUID()
    }

    var body: some View {
        Group {
            if let data = store.state {
                content(data)
            } else if let error = store.loadError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać szablonów", systemImage: "doc.richtext")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.load() } } }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Szablony ofert")
        .task {
            store.workspace = state
            if store.state == nil {
                await store.load()
                if let first = store.state?.categories.first(where: \.isDefault) { expanded.insert(first.id) }
            }
        }
        .sheet(item: $categoryRoute) { route in
            OfferTemplateCategorySheet(store: store, category: route.category)
        }
        .sheet(item: $createRoute) { route in
            OfferTemplateCreateSheet(store: store, categoryID: route.categoryID, type: route.type)
        }
        .confirmationDialog("Usunąć szablon?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let template = deleting {
                Button("Usuń", role: .destructive) { Task { await store.deleteTemplate(template.id) } }
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("Czy na pewno chcesz usunąć szablon \"\(deleting?.name ?? "")\"? Ta operacja jest nieodwracalna.")
        }
        .confirmationDialog("Usunąć plik PDF?", isPresented: Binding(get: { removingBackground != nil }, set: { if !$0 { removingBackground = nil } }), titleVisibility: .visible) {
            if let template = removingBackground {
                Button("Usuń", role: .destructive) { Task { await store.deleteBackground(template.id) } }
            }
            Button("Anuluj", role: .cancel) { removingBackground = nil }
        } message: {
            Text("Czy na pewno chcesz usunąć plik PDF z tego szablonu?")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            guard let template = uploadTarget, case .success(let url) = result else { return }
            Task { await store.uploadBackground(template.id, url: url) }
        }
    }

    // MARK: Lista

    private func content(_ data: OfferTemplatesState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(data)
                steps
                if data.categories.isEmpty {
                    ContentUnavailableView {
                        Label("Brak kategorii szablonów", systemImage: "tag")
                    } actions: {
                        if data.canEditCategories {
                            Button { categoryRoute = CategoryRoute(category: nil) } label: { Label("Utwórz pierwszą kategorię", systemImage: "plus") }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(.vertical, 40)
                } else {
                    ForEach(data.categories) { category in categoryCard(category, data) }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func header(_ data: OfferTemplatesState) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Projekt oferty PDF").font(.title2)
                Text("Jeden spójny proces dla każdej kategorii wydarzenia").foregroundStyle(.secondary)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            Button { Task { await store.load() } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież szablony")
            if data.canEditCategories {
                Button { categoryRoute = CategoryRoute(category: nil) } label: { Label("Nowa kategoria", systemImage: "tag") }
            }
            if data.canEditTemplates {
                Button {
                    if let category = data.categories.first(where: \.isDefault) ?? data.categories.first {
                        createRoute = CreateRoute(categoryID: category.id, type: "cover")
                    } else {
                        state.error = "Najpierw utwórz kategorię"
                    }
                } label: { Label("Nowy szablon", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private struct Step: Identifiable {
        let id: String
        let title: String
        let detail: String
    }

    private var steps: some View {
        let items = [
            Step(id: "1", title: "Wybierz kategorię", detail: "Np. konferencja, wesele lub nagłośnienie."),
            Step(id: "2", title: "Użyj projektu Mavinci", detail: "Gotowy układ działa od razu. Własny PDF jest opcjonalnym tłem."),
            Step(id: "3", title: "Dodaj pola CRM", detail: "Po wgraniu własnego tła rozmieść dane i tabelę wyceny."),
        ]
        return HStack(alignment: .top, spacing: 16) {
            ForEach(items) { item in
                HStack(alignment: .top, spacing: 10) {
                    Text(item.id).font(.callout.weight(.semibold)).foregroundStyle(.white)
                        .frame(width: 28, height: 28).background(Self.burgundy, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).font(.callout.weight(.medium))
                        Text(item.detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(Self.burgundy.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Self.burgundy.opacity(0.4)))
    }

    static let burgundy = CrmTheme.rgb(0x7f1734)

    // MARK: Kategoria

    private func categoryCard(_ category: OfferTemplatesState.Category, _ data: OfferTemplatesState) -> some View {
        let open = expanded.contains(category.id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                if open { expanded.remove(category.id) } else { expanded.insert(category.id) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "tag.fill").foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(CrmTheme.hex(category.color) ?? theme.accent, in: RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(category.name).font(.headline)
                            if category.isDefault { badge("Domyślna", theme.accent) }
                        }
                        if !category.description.isEmpty { Text(category.description).font(.callout).foregroundStyle(.secondary) }
                        HStack(spacing: 6) {
                            badge(category.heroPath != nil ? "Zdjęcie hero: gotowe" : "Zdjęcie hero: do uzupełnienia", category.heroPath != nil ? .green : .orange)
                            badge("5 etapów dokumentu", Self.burgundy)
                        }
                    }
                    Spacer()
                    if data.canEditCategories {
                        Button { categoryRoute = CategoryRoute(category: category) } label: {
                            Label(category.heroPath != nil ? "Zmień hero" : "Wgraj hero", systemImage: "photo")
                        }
                        .help(category.heroPath != nil ? "Zmień zdjęcie hero" : "Wgraj zdjęcie hero")
                        Button { categoryRoute = CategoryRoute(category: category) } label: { Image(systemName: "pencil") }
                            .help("Edytuj kategorię")
                    }
                    Image(systemName: open ? "chevron.down" : "chevron.right").foregroundStyle(.secondary)
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Divider()
                VStack(alignment: .leading, spacing: 14) {
                    summary(category, data)
                    ForEach(OfferTemplateKind.all) { kind in kindSection(kind, category, data) }
                }
                .padding(14)
            }
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.12)))
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
    }

    private func summary(_ category: OfferTemplatesState.Category, _ data: OfferTemplatesState) -> some View {
        let assigned = !category.eventCategories.isEmpty || category.isDefault
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("1. PRZYPISANIE").font(.caption2).foregroundStyle(.tertiary)
                Text(!category.eventCategories.isEmpty ? category.eventCategories.joined(separator: ", ")
                     : category.isDefault ? "Zestaw domyślny" : "Nieprzypisana do kategorii wydarzenia")
                    .font(.callout).foregroundStyle(assigned ? .green : .orange)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text("2. ZDJĘCIE HERO").font(.caption2).foregroundStyle(.tertiary)
                Text(category.heroPath != nil ? "Gotowe" : "Brak zdjęcia dla okładki").font(.callout)
                    .foregroundStyle(category.heroPath != nil ? .green : .orange)
                if data.canEditCategories {
                    Button { categoryRoute = CategoryRoute(category: category) } label: {
                        Label(category.heroPath != nil ? "Zmień zdjęcie" : "Wgraj zdjęcie", systemImage: "square.and.arrow.up")
                    }
                    .controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text("3. STRONY DOKUMENTU").font(.caption2).foregroundStyle(.tertiary)
                Text("Gotowy układ Mavinci + opcjonalne tła").font(.callout).foregroundStyle(.green)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func kindSection(_ kind: OfferTemplateKind.Kind, _ category: OfferTemplatesState.Category, _ data: OfferTemplatesState) -> some View {
        let templates = data.templates.filter { $0.categoryId == category.id && $0.type == kind.key }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: kind.symbol).foregroundStyle(theme.accent)
                Text(kind.label).font(.callout.weight(.medium))
                badge("\(templates.count)", theme.accent)
                Spacer()
                if data.canEditTemplates {
                    Button("+ Dodaj") { createRoute = CreateRoute(categoryID: category.id, type: kind.key) }.controlSize(.small)
                }
            }
            if templates.isEmpty {
                Text("Używany jest gotowy układ Mavinci. Dodaj wpis tylko wtedy, gdy chcesz go zastąpić własnym tłem PDF.")
                    .font(.caption).italic().foregroundStyle(.secondary).padding(.leading, 26)
            } else {
                ForEach(templates) { template in templateRow(template, data).padding(.leading, 26) }
            }
        }
    }

    private func templateRow(_ template: OfferTemplatesState.Template, _ data: OfferTemplatesState) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(template.name).font(.callout.weight(.medium))
                    if template.isDefault { badge("Domyślny", theme.accent) }
                    if template.type == "product" { badge(template.variantKey, Self.burgundy) }
                    if !template.isActive { badge("Nieaktywny", .gray) }
                }
                if !template.description.isEmpty { Text(template.description).font(.caption).foregroundStyle(.secondary) }
                if template.pdfPath != nil {
                    Label("Własne tło PDF", systemImage: "doc.text").font(.caption).foregroundStyle(.green)
                } else {
                    Label("Gotowy układ Mavinci", systemImage: "square.3.layers.3d").font(.caption).foregroundStyle(Self.burgundy)
                }
            }
            Spacer()
            if data.canEditTemplates {
                Button { uploadTarget = template; importing = true } label: {
                    Label(template.pdfPath != nil ? "Zmień tło" : "Własne tło", systemImage: "square.and.arrow.up")
                }
                .help("Opcjonalnie wgraj własne tło PDF")
                if template.pdfPath != nil {
                    Button { state.openCRM("/crm/offers?tab=templates") } label: { Label("Rozmieść dane", systemImage: "character.cursor.ibeam") }
                        .help("Rozmieszczanie pól na tle PDF — na razie w CRM")
                    Button(role: .destructive) { removingBackground = template } label: { Label("Wróć do Mavinci", systemImage: "trash") }
                        .help("Usuń własne tło i wróć do gotowego układu Mavinci")
                }
            }
            if template.type == "pricing" && data.canEditTemplates {
                Button { state.openCRM("/crm/offers?tab=templates") } label: { Label("Tabela wyceny", systemImage: "tablecells") }
                    .help("Wygląd tabeli wyceny — na razie w CRM")
            }
            if data.canDeleteTemplates {
                Button(role: .destructive) { deleting = template } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).help("Usuń")
            }
        }
        .controlSize(.small)
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.1)))
    }
}

// MARK: Nowy szablon

@MainActor struct OfferTemplateCreateSheet: View {
    @ObservedObject var store: OfferTemplatesStore
    @Environment(\.dismiss) private var dismiss
    @State private var categoryID: String
    @State private var type: String
    @State private var name = ""
    @State private var description = ""
    @State private var variant = "default"
    @State private var isDefault = false
    @State private var isActive = true
    @State private var saving = false

    init(store: OfferTemplatesStore, categoryID: String, type: String) {
        self.store = store
        _categoryID = State(initialValue: categoryID)
        _type = State(initialValue: type)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Nowy szablon").font(.title3.weight(.semibold)).padding(20)
            Divider()
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    ProductField(label: "Kategoria") {
                        Picker("", selection: $categoryID) {
                            ForEach(store.state?.categories ?? []) { category in Text(category.name).tag(category.id) }
                        }
                        .labelsHidden()
                    }
                    ProductField(label: "Etap dokumentu") {
                        Picker("", selection: $type) {
                            ForEach(OfferTemplateKind.all) { kind in Text(kind.label).tag(kind.key) }
                        }
                        .labelsHidden()
                    }
                }
                ProductField(label: "Nazwa szablonu *") {
                    TextField("", text: $name, prompt: Text("np. Szablon standardowy")).textFieldStyle(.roundedBorder)
                }
                ProductField(label: "Opis") {
                    ProductTextArea(text: $description, prompt: "Opcjonalny opis szablonu...", lines: 3...5)
                }
                if type == "product" {
                    ProductField(label: "Wariant karty produktu", help: "Produkty kompaktowe są automatycznie grupowane po maksymalnie trzy na stronie.") {
                        Picker("", selection: $variant) {
                            ForEach(OfferTemplateKind.variants, id: \.key) { item in Text(item.label).tag(item.key) }
                        }
                        .labelsHidden()
                    }
                }
                Toggle("Ustaw jako domyślny", isOn: $isDefault).toggleStyle(.checkbox)
                Toggle("Aktywny", isOn: $isActive).toggleStyle(.checkbox)
            }
            .padding(20)
            Divider()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Tworzenie..." : "Utwórz szablon") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 560)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.createTemplate(category: categoryID, type: type, name: name, description: description, variant: variant,
                                      isDefault: isDefault, isActive: isActive) {
            dismiss()
        }
    }
}
