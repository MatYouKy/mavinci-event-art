import SwiftUI

// MARK: Karta produktu, część C1 — przygotowanie i zamówienia (`ProductPreparationItems`), wymagania produktu
// (`ProductRequirementsSection`), powiązane usługi na stronie (`ProductRelatedServicesSection`) oraz dodatki i limity
// pakietu (`ProductAddonsSection`, `ProductAddonsEditor`).

/// Sekcje części C1 w głównej kolumnie karty (warianty, powiązane usługi, dodatki, wymagania).
@MainActor struct ProductExtrasBlock: View {
    @ObservedObject var store: ProductsStore
    let productID: String

    var body: some View {
        Group {
            if let extras = store.extras[productID] {
                VStack(spacing: 14) {
                    ProductRelatedSection(store: store, productID: productID, extras: extras)
                    ProductVariantsSection(store: store, productID: productID, extras: extras).id("product-section-variants")
                    ProductAddonsSection(store: store, productID: productID, extras: extras)
                    ProductRequirementsSection(store: store, productID: productID, extras: extras)
                }
            } else if let problem = store.extrasErrors[productID] {
                ProductPanel(title: "Warianty, dodatki i wymagania", subtitle: problem) {
                    Button("Spróbuj ponownie") { Task { await store.loadExtras(productID) } }
                } content: { EmptyView() }
            } else {
                ProductPanel(title: "Warianty, dodatki i wymagania", subtitle: nil) { EmptyView() } content: {
                    ProgressView("Wczytuję warianty, dodatki i wymagania…").controlSize(.small).frame(maxWidth: .infinity)
                }
            }
        }
        .task(id: productID) { await store.loadExtras(productID) }
    }
}

// MARK: Przygotowanie i zamówienia

@MainActor struct ProductPreparationSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    @EnvironmentObject private var state: Workspace
    @State private var form: PreparationForm?
    @State private var removing: ProductExtras.PreparationItem?

    struct PreparationForm: Identifiable {
        let id = UUID()
        var itemId: String?
        var kind = "order"
        var title = ""
        var details = ""
        var leadDays: Double? = 4
        var anchor = "event"
        var ownerRole = "warehouse"
        var supplier = ""
        var quantity: Double?
        var unit = ""
        var blocksReady = true
        var active = true
    }

    var body: some View {
        if let extras = store.extras[productID], extras.preparation.available {
            let preparation = extras.preparation
            let manage = preparation.canManage && state.canWrite
            ProductPanel(title: "Przygotowanie i zamówienia",
                         subtitle: "Co trzeba zamówić, sprawdzić lub potwierdzić przed każdym wydarzeniem z tą usługą. Kroki pojawią się na wydarzeniu po akceptacji oferty, z terminem i osobą odpowiedzialną.") {
                if manage {
                    Button { form = PreparationForm() } label: { Label("Dodaj krok", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
            } content: {
                VStack(alignment: .leading, spacing: 8) {
                    if !preparation.canManage {
                        Text("Podgląd. Konfigurację zmienia administrator albo osoba z uprawnieniem do zarządzania ofertami lub magazynem.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = preparation.error { Text(error).font(.caption).foregroundStyle(.orange) }
                    if preparation.items.isEmpty {
                        Text("Brak kroków przygotowania dla tej usługi.").foregroundStyle(.secondary)
                    }
                    ForEach(preparation.items) { item in row(item, manage: manage) }
                }
            }
            .sheet(item: $form) { draft in ProductPreparationSheet(store: store, productID: productID, initial: draft) }
            .confirmationDialog("Usunąć „\(removing?.title ?? "")”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Usuń", role: .destructive) {
                    if let item = removing {
                        Task { await store.changeExtras(productID, "preparationRemove", ["itemId": .string(item.id)], success: "Usunięto krok przygotowania.", english: false) }
                    }
                    removing = nil
                }
                Button("Anuluj", role: .cancel) { removing = nil }
            } message: {
                Text("Wydarzenia z tą usługą przestaną dostawać ten krok. Aby tylko wstrzymać krok, użyj „Wyłącz”.")
            }
        }
    }

    private func row(_ item: ProductExtras.PreparationItem, manage: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    badge(ProductPreparationText.kind(item.kind), color: .accentColor)
                    if !item.active { badge("Wyłączony", color: .secondary) }
                    if item.blocksReady { badge("wymagane przed gotowością magazynu", color: .orange) }
                }
                Text(item.title).font(.callout.weight(.semibold))
                Text(ProductPreparationText.preview(title: item.title, leadDays: item.leadDays, anchor: item.anchor, role: item.ownerRole))
                    .font(.caption).foregroundStyle(.secondary)
                let quantity = item.quantity.map { ProductText.number($0) + (item.unit.map { " \($0)" } ?? "") }
                if item.supplier != nil || quantity != nil {
                    Text([item.supplier.map { "Dostawca: \($0)" }, quantity.map { "Ilość: \($0) na sztukę usługi" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let details = item.details, !details.isEmpty { Text(details).font(.caption).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if manage {
                Menu {
                    Button("Edytuj", systemImage: "pencil") {
                        form = PreparationForm(itemId: item.id, kind: item.kind, title: item.title, details: item.details ?? "", leadDays: Double(item.leadDays),
                                               anchor: item.anchor, ownerRole: item.ownerRole, supplier: item.supplier ?? "", quantity: item.quantity,
                                               unit: item.unit ?? "", blocksReady: item.blocksReady, active: item.active)
                    }
                    Button(item.active ? "Wyłącz" : "Włącz", systemImage: "power") {
                        Task {
                            await store.changeExtras(productID, "preparationToggle", ["itemId": .string(item.id)],
                                                     success: item.active ? "Krok wyłączony — nie pojawi się w wydarzeniach (otwarte kroki z tej usługi zostaną zarchiwizowane)."
                                                        : "Krok włączony — pojawi się w bieżących wydarzeniach z tą usługą.", english: false)
                        }
                    }
                    Divider()
                    Button("Usuń", systemImage: "trash", role: .destructive) { removing = item }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
        }
        .padding(8)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        .opacity(item.active ? 1 : 0.65)
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 1)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}

@MainActor struct ProductPreparationSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var form: ProductPreparationSection.PreparationForm
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, initial: ProductPreparationSection.PreparationForm) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        _form = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(form.itemId == nil ? "Dodaj krok przygotowania" : "Edytuj krok przygotowania").font(.title3.weight(.semibold))
                Text("Krok powstanie na każdym wydarzeniu z tą usługą po akceptacji oferty.").font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "Rodzaj") {
                    Picker("", selection: $form.kind) { ForEach(ProductPreparationText.kinds, id: \.key) { Text($0.label).tag($0.key) } }.labelsHidden()
                }
                ProductField(label: "Kto odpowiada") {
                    Picker("", selection: $form.ownerRole) { ForEach(ProductPreparationText.roles, id: \.key) { Text($0.label).tag($0.key) } }.labelsHidden()
                }
            }
            ProductField(label: "Nazwa kroku *") {
                TextField("", text: Binding(get: { form.title }, set: { form.title = String($0.prefix(200)) }), prompt: Text("Np. Zamów suchy lód"))
                    .textFieldStyle(.roundedBorder)
            }
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "Ile dni wcześniej") { ProductNumberField(value: $form.leadDays, prompt: "4", nullable: true) }
                ProductField(label: "Licząc od") {
                    Picker("", selection: $form.anchor) { ForEach(ProductPreparationText.anchors, id: \.key) { Text($0.label).tag($0.key) } }.labelsHidden()
                }
            }
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "Dostawca") {
                    TextField("", text: Binding(get: { form.supplier }, set: { form.supplier = String($0.prefix(300)) }), prompt: Text("Np. Linde")).textFieldStyle(.roundedBorder)
                }
                ProductField(label: "Ilość na sztukę usługi") { ProductNumberField(value: $form.quantity, prompt: "Np. 10", nullable: true) }
                ProductField(label: "Jednostka") {
                    TextField("", text: Binding(get: { form.unit }, set: { form.unit = String($0.prefix(30)) }), prompt: Text("Np. kg")).textFieldStyle(.roundedBorder)
                }
            }
            Text("Ilość na wydarzeniu = ilość na sztukę × liczba sztuk usługi w zaakceptowanej ofercie.").font(.caption).foregroundStyle(.secondary)
            ProductField(label: "Opis / instrukcja (opcjonalnie)") {
                ProductTextArea(text: Binding(get: { form.details }, set: { form.details = String($0.prefix(2000)) }),
                                prompt: "Np. zamówienie telefonicznie, odbiór w magazynie dostawcy, termobox z magazynu", lines: 3...5)
            }
            Toggle("Wymagane przed gotowością magazynu", isOn: $form.blocksReady).toggleStyle(.checkbox)
            Text("Magazyn nie oznaczy „Gotowe do wydania”, dopóki ten krok nie zostanie zamknięty.").font(.caption).foregroundStyle(.secondary)
            if form.itemId != nil { Toggle("Aktywny — dodawaj ten krok do wydarzeń", isOn: $form.active).toggleStyle(.checkbox) }
            Text(ProductPreparationText.preview(title: form.title, leadDays: form.leadDays.flatMap { $0 == $0.rounded() ? Int($0) : nil },
                                                anchor: form.anchor, role: form.ownerRole))
                .font(.callout).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : form.itemId == nil ? "Dodaj krok" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(18)
        .frame(width: 600)
        .background(theme.page)
        .disabled(saving)
    }

    private func save() async {
        let title = form.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...200).contains(title.count) else { problem = "Podaj nazwę kroku (2–200 znaków)."; return }
        guard let days = form.leadDays, days == days.rounded(), (0...90).contains(days) else {
            problem = "Liczba dni wyprzedzenia musi być liczbą całkowitą od 0 do 90."
            return
        }
        if let quantity = form.quantity, quantity <= 0 { problem = "Ilość na sztukę usługi musi być liczbą większą od zera."; return }
        problem = nil
        saving = true
        defer { saving = false }
        var item: [String: JSONValue] = [
            "kind": .string(form.kind), "title": .string(title), "details": .string(form.details), "leadDays": .number(days),
            "anchor": .string(form.anchor), "ownerRole": .string(form.ownerRole), "supplier": .string(form.supplier),
            "quantity": form.quantity.map { JSONValue.number($0) } ?? .null, "unit": .string(form.unit),
            "blocksReady": .bool(form.blocksReady), "active": .bool(form.active),
        ]
        if let id = form.itemId { item["itemId"] = .string(id) }
        if await store.changeExtras(productID, "preparationSave", ["item": .object(item)],
                                    success: form.itemId == nil ? "Dodano krok przygotowania." : "Zapisano krok przygotowania.", english: false) {
            dismiss()
        }
    }
}

// MARK: Wymagania produktu

@MainActor struct ProductRequirementsSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @EnvironmentObject private var state: Workspace
    @State private var editing: ProductExtras.Requirement?
    @State private var removing: ProductExtras.Requirement?

    private var editable: Bool { extras.canEdit && state.canWrite }

    var body: some View {
        ProductPanel(title: "Wymagania produktu", subtitle: "Warunki, które klient lub obiekt musi zapewnić — trafiają do PDF oferty.") {
            if editable {
                Button {
                    let category = extras.requirementCategories.first { $0.value == "other" }
                    editing = ProductExtras.Requirement(id: UUID().uuidString.lowercased(), category: "other", title: category?.defaultTitle ?? "", description: "")
                } label: { Label("Dodaj wymaganie", systemImage: "plus") }
            }
        } content: {
            if extras.requirements.isEmpty {
                Text("Brak wymagań produktu.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(Array(extras.requirements.enumerated()), id: \.element.id) { index, item in
                        HStack(alignment: .top, spacing: 10) {
                            Text(String(format: "%02d", index + 1)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(item.title).font(.callout.weight(.semibold))
                                    Text(extras.requirementLabel(item.category)).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                                        .background(Color.primary.opacity(0.08), in: Capsule())
                                }
                                Text(item.description.isEmpty ? "Brak opisu warunków." : item.description).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if editable {
                                Menu {
                                    Button("Edytuj", systemImage: "pencil") { editing = item }
                                    Button("Przenieś wyżej", systemImage: "arrow.up") { move(index, index - 1) }.disabled(index == 0)
                                    Button("Przenieś niżej", systemImage: "arrow.down") { move(index, index + 1) }.disabled(index == extras.requirements.count - 1)
                                    Divider()
                                    Button("Usuń", systemImage: "trash", role: .destructive) { removing = item }
                                } label: { Image(systemName: "ellipsis.circle") }
                                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                            }
                        }
                        .padding(8)
                        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .sheet(item: $editing) { item in ProductRequirementSheet(store: store, productID: productID, extras: extras, requirement: item) }
        .confirmationDialog("Usunąć wymaganie „\(removing?.title ?? "")” z produktu?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń wymaganie", role: .destructive) {
                if let item = removing { save(extras.requirements.filter { $0.id != item.id }, success: "Zapisano wymagania produktu") }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: {
            Text("Wymaganie przestanie być pobierane z tego produktu do nowych PDF-ów.")
        }
    }

    private func move(_ from: Int, _ to: Int) {
        guard to >= 0, to < extras.requirements.count else { return }
        var next = extras.requirements
        let item = next.remove(at: from)
        next.insert(item, at: to)
        save(next, success: "Zapisano kolejność wymagań")
    }

    private func save(_ list: [ProductExtras.Requirement], success: String) {
        Task { await store.changeExtras(productID, "requirementsSave", ["requirements": .array(list.map(ProductRequirementSheet.json))], success: success) }
    }
}

@MainActor struct ProductRequirementSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductExtras.Requirement
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, extras: ProductExtras, requirement: ProductExtras.Requirement) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.extras = extras
        _draft = State(initialValue: requirement)
    }

    static func json(_ item: ProductExtras.Requirement) -> JSONValue {
        .object(["id": .string(item.id), "category": .string(item.category), "title": .string(item.title), "description": .string(item.description)])
    }

    private var existing: Bool { extras.requirements.contains { $0.id == draft.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(existing ? "Edytuj wymaganie" : "Dodaj wymaganie").font(.title3.weight(.semibold))
            ProductField(label: "Kategoria") {
                Picker("", selection: Binding(get: { draft.category }, set: { category in
                    let previous = extras.requirementCategories.first { $0.value == draft.category }?.defaultTitle
                    if draft.title.isEmpty || draft.title == previous {
                        draft.title = extras.requirementCategories.first { $0.value == category }?.defaultTitle ?? draft.title
                    }
                    draft.category = category
                })) {
                    ForEach(extras.requirementCategories, id: \.value) { Text($0.label).tag($0.value) }
                }
                .labelsHidden()
            }
            ProductField(label: "Nazwa wymagania") {
                TextField("", text: Binding(get: { draft.title }, set: { draft.title = String($0.prefix(200)) }), prompt: Text("Np. Pokój dwuosobowy"))
                    .textFieldStyle(.roundedBorder)
            }
            ProductField(label: "Warunki realizacji") {
                ProductTextArea(text: $draft.description, prompt: "Dla kogo, kiedy i na jakich warunkach należy zapewnić ten element?", lines: 4...8)
            }
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz wymaganie") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(18)
        .frame(width: 520)
        .background(theme.page)
    }

    private func save() async {
        var next = draft
        next.title = next.title.trimmingCharacters(in: .whitespacesAndNewlines)
        next.description = next.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.title.isEmpty, !next.description.isEmpty else { problem = "Podaj nazwę i warunki realizacji wymagania."; return }
        let list = existing ? extras.requirements.map { $0.id == next.id ? next : $0 } : extras.requirements + [next]
        saving = true
        defer { saving = false }
        if await store.changeExtras(productID, "requirementsSave", ["requirements": .array(list.map(Self.json))], success: "Zapisano wymagania produktu") {
            dismiss()
        }
    }
}

// MARK: Powiązane usługi na stronie

@MainActor struct ProductRelatedSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @EnvironmentObject private var state: Workspace
    @State private var draft: [String]?
    @State private var url = ""
    @State private var label = ""
    @State private var search = ""

    private var related: ProductExtras.Related { extras.related }

    var body: some View {
        ProductPanel(title: "Powiązane usługi na stronie",
                     subtitle: "Klient z oferty trafia na publiczną kartę produktu. Tutaj możesz dodać przejście do pełnej strony usługi — własnym adresem lub z katalogu.") {
            if extras.canEdit && state.canWrite {
                if draft != nil {
                    Button("Anuluj") { draft = nil; search = "" }
                    Button("Zapisz powiązania") { Task { await save() } }.buttonStyle(.borderedProminent)
                } else {
                    Button("Edytuj powiązania") { draft = related.ids; url = related.url ?? ""; label = related.label ?? "" }
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: 10) {
                if draft != nil {
                    ProductField(label: "Adres strony usługi (opcjonalny)",
                                 help: "Wklej pełny adres https://mavinci.pl/oferta/… lub https://mavinci.pl/uslugi/…, albo samą ścieżkę. Docelowa strona musi już istnieć.") {
                        TextField("", text: Binding(get: { url }, set: { url = String($0.prefix(2048)) }), prompt: Text("/uslugi/ekrany-led-do-konferencji-i-gal"))
                            .textFieldStyle(.roundedBorder)
                    }
                    ProductField(label: "Tekst przycisku (opcjonalny)",
                                 help: "Pusty adres oznacza brak dodatkowego przycisku. Powiązania z katalogu poniżej działają niezależnie.") {
                        TextField("", text: Binding(get: { label }, set: { label = String($0.prefix(120)) }), prompt: Text("Poznaj pełną usługę"))
                            .textFieldStyle(.roundedBorder)
                    }
                } else if let path = related.publicPath {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Własna strona usługi").font(.caption).foregroundStyle(.secondary)
                        Button { state.openCRM(path) } label: { Label(related.label ?? "Poznaj pełną usługę", systemImage: "arrow.up.right") }.buttonStyle(.link)
                        Text(path).font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Nie ustawiono własnego adresu strony usługi.").font(.callout).foregroundStyle(.secondary)
                }
                if let error = related.error { Text(error).font(.caption).foregroundStyle(.orange) }
                let selected = draft ?? related.ids
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(selected, id: \.self) { id in
                        let service = related.services.first { $0.id == id }
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(service?.title ?? "Usługa niedostępna w katalogu").font(.callout)
                                if let path = service?.path { Text(path).font(.caption).foregroundStyle(.secondary) }
                                if service == nil || service?.active == false {
                                    Text("To powiązanie nie będzie pokazywane publicznie.").font(.caption).foregroundStyle(.orange)
                                }
                            }
                            Spacer()
                            if draft != nil {
                                Button { draft = draft?.filter { $0 != id } } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
                            } else {
                                Image(systemName: "checkmark").foregroundStyle(.green)
                            }
                        }
                    }
                    if selected.isEmpty { Text("Brak powiązanych usług.").font(.callout).foregroundStyle(.secondary) }
                }
                if let current = draft {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Dodatkowe powiązania z katalogu usług").font(.caption.weight(.semibold))
                        TextField("Wyszukaj usługę, np. kasyno, streaming…", text: $search).textFieldStyle(.roundedBorder)
                        let needle = SearchText.fold(search)
                        let matches = related.services.filter { $0.active && (needle.isEmpty || SearchText.fold("\($0.title) \($0.path ?? "")").contains(needle)) }
                        ScrollView {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(matches) { service in
                                    Toggle(isOn: Binding(get: { current.contains(service.id) }, set: { on in
                                        if on { draft = (draft ?? []) + [service.id] } else { draft = draft?.filter { $0 != service.id } }
                                    })) {
                                        VStack(alignment: .leading, spacing: 0) {
                                            Text(service.title)
                                            if let path = service.path { Text(path).font(.caption).foregroundStyle(.secondary) }
                                        }
                                    }
                                    .toggleStyle(.checkbox)
                                }
                                if matches.isEmpty { Text("Brak pasujących usług.").foregroundStyle(.secondary) }
                            }
                        }
                        .frame(maxHeight: 220)
                    }
                }
            }
        }
    }

    private func save() async {
        guard let ids = draft else { return }
        if await store.changeExtras(productID, "relatedSave", [
            "ids": .array(Array(NSOrderedSet(array: ids)).compactMap { ($0 as? String).map { JSONValue.string($0) } }),
            "url": .string(url), "label": .string(label),
        ], success: "Zapisano sekcję produktu") {
            draft = nil
            search = ""
        }
    }
}

// MARK: Dodatki i limity pakietu

@MainActor struct ProductAddonsSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @EnvironmentObject private var state: Workspace
    @State private var editing: ProductAddonItem?
    @State private var removing: ProductAddonItem?

    private var editable: Bool { extras.canEdit && state.canWrite }

    var body: some View {
        ProductPanel(title: "Dodatki i limity pakietu", subtitle: "Domyślne limity i stawki. Nowa oferta otrzyma własną kopię tych ustawień.") {
            if editable {
                Button { editing = .blank() } label: { Label("Dodaj dodatek", systemImage: "plus") }.disabled(extras.addons.count >= 40)
            }
        } content: {
            if extras.addons.isEmpty {
                Text("Brak dodatków i limitów.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(Array(extras.addons.enumerated()), id: \.element.id) { index, addon in
                        HStack(alignment: .top, spacing: 10) {
                            Text(String(format: "%02d", index + 1)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(addon.name).font(.callout.weight(.semibold))
                                Text("\(ProductAddonItem.kindLabel(addon.kind)) · \(addon.rateText)").font(.caption).foregroundStyle(.secondary)
                                if !addon.description.isEmpty { Text(addon.description).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if editable {
                                Menu {
                                    Button("Edytuj", systemImage: "pencil") { editing = addon }
                                    Button("Przenieś wyżej", systemImage: "arrow.up") { move(index, index - 1) }.disabled(index == 0)
                                    Button("Przenieś niżej", systemImage: "arrow.down") { move(index, index + 1) }.disabled(index == extras.addons.count - 1)
                                    Divider()
                                    Button("Usuń", systemImage: "trash", role: .destructive) { removing = addon }
                                } label: { Image(systemName: "ellipsis.circle") }
                                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                            }
                        }
                        .padding(8)
                        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }
                    Text("PDF pokaże pakiet bazowy i wybrane dodatki z ceną jednostkową. Układ kompaktowy będzie niedostępny.")
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .sheet(item: $editing) { addon in ProductAddonSheet(store: store, productID: productID, extras: extras, addon: addon) }
        .confirmationDialog("Usunąć dodatek „\(removing?.name ?? "")” z produktu?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń dodatek", role: .destructive) {
                if let addon = removing { save(extras.addons.filter { $0.id != addon.id }, success: "Zapisano dodatki i limity pakietu") }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: {
            Text("Istniejące oferty zachowają swoje ustawienia.")
        }
    }

    private func move(_ from: Int, _ to: Int) {
        guard to >= 0, to < extras.addons.count else { return }
        var next = extras.addons
        let item = next.remove(at: from)
        next.insert(item, at: to)
        save(next, success: "Zapisano kolejność dodatków")
    }

    private func save(_ list: [ProductAddonItem], success: String) {
        Task { await store.changeExtras(productID, "addonsSave", ["addons": .array(list.map(\.json))], success: success) }
    }
}

@MainActor struct ProductAddonSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductAddonItem
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, extras: ProductExtras, addon: ProductAddonItem) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.extras = extras
        _draft = State(initialValue: addon)
    }

    private var existing: Bool { extras.addons.contains { $0.id == draft.id } }

    private func amount(_ key: WritableKeyPath<ProductAddonItem, Double>) -> Binding<Double?> {
        Binding(get: { draft[keyPath: key] }, set: { draft[keyPath: key] = $0 ?? 0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(existing ? "Edytuj dodatek" : "Dodaj dodatek").font(.title3.weight(.semibold)).padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ProductField(label: "Nazwa dodatku") {
                        TextField("", text: Binding(get: { draft.name }, set: { draft.name = String($0.prefix(120)) })).textFieldStyle(.roundedBorder)
                    }
                    HStack(alignment: .top, spacing: 10) {
                        ProductField(label: "Sposób naliczania") {
                            Picker("", selection: Binding(get: { draft.kind }, set: { kind in
                                draft.kind = kind
                                draft.enabled = false
                                if kind == "optional" { draft.quantity_source = "manual" }
                            })) {
                                ForEach(ProductAddonItem.kinds, id: \.key) { Text($0.label).tag($0.key) }
                            }
                            .labelsHidden()
                        }
                        ProductField(label: "Jednostka") {
                            TextField("", text: Binding(get: { draft.unit }, set: { draft.unit = String($0.prefix(20)) })).textFieldStyle(.roundedBorder).frame(width: 90)
                        }
                    }
                    if draft.kind != "optional" {
                        ProductField(label: "Sposób wyliczania ilości") {
                            Picker("", selection: Binding(get: { draft.quantity_source ?? "manual" }, set: { draft.quantity_source = $0 })) {
                                ForEach(ProductText.quantitySources, id: \.key) { Text($0.label).tag($0.key) }
                            }
                            .labelsHidden().fixedSize()
                        }
                    }
                    HStack(alignment: .top, spacing: 10) {
                        if draft.kind == "over_limit" {
                            ProductField(label: "W cenie pakietu") { ProductNumberField(value: amount(\.included_quantity)) }
                        }
                        if draft.kind != "optional" {
                            ProductField(label: draft.kind == "over_limit" ? "Łączna potrzebna ilość" : "Ilość") { ProductNumberField(value: amount(\.quantity)) }
                        }
                        ProductField(label: draft.kind == "optional" ? "Cena dodatku netto (zł)" : "Cena za dodatkową jednostkę netto (zł)") {
                            ProductNumberField(value: Binding(get: { draft.price_on_request == true && draft.unit_price == 0 ? nil : draft.unit_price },
                                                              set: { draft.unit_price = $0 ?? 0 }),
                                               prompt: draft.price_on_request == true ? "Do indywidualnej wyceny" : "", nullable: true)
                        }
                    }
                    if draft.kind == "optional" { Toggle("Domyślnie zaznaczony", isOn: $draft.enabled).toggleStyle(.checkbox) }
                    Toggle("Cena ustalana indywidualnie — wymagana po wybraniu dodatku", isOn: Binding(get: { draft.price_on_request == true },
                                                                                                    set: { draft.price_on_request = $0 ? true : nil }))
                        .toggleStyle(.checkbox)
                    if draft.onRequest {
                        Text(draft.payableQuantity > 0 ? "Wpisz uzgodnioną cenę, aby zapisać ofertę. Ta opcja nie jest bezpłatna."
                             : "Opcja do indywidualnej wyceny. Cenę uzupełnisz po jej wybraniu.")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    DisclosureGroup("Powiązana obsada i limit ilości") {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top, spacing: 10) {
                                ProductField(label: "Rola dodawana do obsady pakietu") {
                                    TextField("", text: Binding(get: { draft.staff_role ?? "" }, set: { draft.staff_role = $0.isEmpty ? nil : String($0.prefix(120)) }),
                                              prompt: Text("Opcjonalnie, np. operator kamery")).textFieldStyle(.roundedBorder)
                                }
                                ProductField(label: "Szacowany czas pracy osoby (h)") { ProductNumberField(value: $draft.staff_hours, nullable: true) }
                                ProductField(label: "Maksymalna ilość dodatku") { ProductNumberField(value: $draft.max_quantity, nullable: true) }
                            }
                            Text("Wybranie dodatku utworzy rolę w obsadzie wybranego pakietu. Stawkę kosztową ustalasz tam oddzielnie. Puste pole roli wyłącza powiązanie.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.top, 6)
                    }
                    ProductField(label: "Zakres / warunki widoczne w kalkulacji") {
                        ProductTextArea(text: Binding(get: { draft.description }, set: { draft.description = String($0.prefix(500)) }), lines: 2...4)
                    }
                    if !draft.onRequest {
                        Text((draft.kind == "over_limit" ? "W pakiecie: \(ProductText.number(draft.included_quantity)). Płatne ponad limit: " : "Płatna ilość: ")
                             + "\(ProductText.number(draft.payableQuantity)) × \(ProductText.number(draft.unit_price)) zł = \(ProductText.number(((draft.payableQuantity * draft.unit_price) * 100).rounded() / 100)) zł netto")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 10)
            }
            .frame(height: 480)
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz dodatek") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
            .padding(18)
        }
        .frame(width: 640)
        .background(theme.page)
        .disabled(saving)
    }

    private func save() async {
        var next = draft
        next.name = next.name.trimmingCharacters(in: .whitespacesAndNewlines)
        next.unit = next.unit.trimmingCharacters(in: .whitespacesAndNewlines)
        next.description = next.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.name.isEmpty, !next.unit.isEmpty else { problem = "Podaj nazwę (do 120 znaków), jednostkę i opis do 500 znaków."; return }
        let list = existing ? extras.addons.map { $0.id == next.id ? next : $0 } : extras.addons + [next]
        problem = nil
        saving = true
        defer { saving = false }
        if await store.changeExtras(productID, "addonsSave", ["addons": .array(list.map(\.json))], success: "Zapisano dodatki i limity pakietu") {
            dismiss()
        }
    }
}
