import SwiftUI

// MARK: Klauzule produktu (`StructuredProductContractClauses.tsx`) — wpisy z sekcją umowy, typem i nazwą roboczą; wspólne
// zasady (drukowane w umowie raz) albo własna treść z punktami 1. / 1.1 / 1.1.1, nagłówkiem „§n” i zmiennymi umowy.

@MainActor struct ProductClausesSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing = false
    @State private var entries: [ProductResources.Clause] = []
    @State private var selectedID: String?
    @State private var saving = false
    @StateObject private var controller = ClauseEditorController()

    private var meta: ProductResources.ClauseMeta { resources.clauseMeta }
    private var variantName: String? { resources.scope.variantName }
    private var inherited: Bool { resources.scope.inherited.contractClauses }
    private var canEdit: Bool { resources.canEdit && state.canWrite }
    private var active: ProductResources.Clause? { selectedID.flatMap { id in entries.first { $0.id == id } } }

    var body: some View {
        ProductPanel(title: "Klauzule produktu",
                     subtitle: variantName.map { "\($0): " + (inherited ? "dziedziczy klauzule bazowe" : "ma własne klauzule") }
                        ?? "Wspólne zasady pojawiają się w umowie raz; szczegóły pozostają przypisane do produktu") {
            if canEdit {
                if editing {
                    Button("Anuluj") { cancel() }.disabled(saving)
                    Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                        .buttonStyle(.borderedProminent).disabled(saving)
                } else {
                    if variantName != nil && !inherited {
                        Button(action: inherit) { Label("Dziedzicz bazowe", systemImage: "arrow.uturn.backward") }
                    }
                    Button { start() } label: { Label("Edytuj", systemImage: "pencil") }
                }
            }
        } content: {
            if editing { editor } else { preview }
        }
    }

    // MARK: Podgląd
    @ViewBuilder private var preview: some View {
        if resources.clauses.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Brak klauzul produktu").font(.callout.weight(.medium))
                Text("Dodaj osobno warunki, wymagania, obowiązki i ryzyka.").font(.caption).foregroundStyle(.secondary)
                if canEdit {
                    Button { start(addFirst: true) } label: { Label("Dodaj klauzulę", systemImage: "plus") }.controlSize(.small).padding(.top, 4)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(meta.categories, id: \.key) { category in
                    let items = resources.clauses.filter { $0.category == category.key }
                    if !items.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(category.label.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                            ForEach(items) { entry in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text(entry.title.isEmpty ? meta.topicLabel(entry.topic) : entry.title).font(.callout.weight(.semibold))
                                        Text(meta.topicLabel(entry.topic)).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                                            .background(Color.primary.opacity(0.08), in: Capsule())
                                        if entry.sharedKey != nil {
                                            Text("Wspólna zasada").font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                                                .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                                        }
                                    }
                                    ClausePreviewView(html: entry.content)
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Edycja
    private var editor: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Wpisy").font(.caption.weight(.semibold))
                        Text("Jedna klauzula = jedna zasada").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { add() } label: { Image(systemName: "plus") }.help("Dodaj klauzulę")
                }
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(entries) { entry in
                            Button { selectedID = entry.id } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(meta.categoryLabel(entry.category)).font(.caption2).foregroundStyle(theme.accent)
                                    Text(entry.title.isEmpty ? meta.topicLabel(entry.topic) : entry.title).font(.caption.weight(.medium)).lineLimit(2)
                                    Text(meta.topicLabel(entry.topic)).font(.caption2).foregroundStyle(.secondary)
                                }
                                .padding(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(selectedID == entry.id ? theme.accent.opacity(0.18) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        if entries.isEmpty {
                            Button("Dodaj pierwszą klauzulę") { add() }.controlSize(.small)
                        }
                    }
                }
                .frame(maxHeight: 420)
            }
            .frame(width: 200)

            if let entry = active { entryEditor(entry) } else {
                Button("Dodaj pierwszą klauzulę") { add() }.frame(maxWidth: .infinity)
            }
        }
        .controlSize(.small)
    }

    private func entryEditor(_ entry: ProductResources.Clause) -> some View {
        let shared = meta.shared(entry.sharedKey)
        return VStack(alignment: .leading, spacing: 8) {
            ProductField(label: "Treść klauzuli", help: shared == nil ? nil
                         : "Ta sama zasada zostanie wydrukowana tylko raz, również przy kilku produktach. Aby zmienić treść wyłącznie dla tej usługi, wybierz własną treść.") {
                Picker("", selection: Binding(get: { entry.sharedKey ?? "" }, set: { key in
                    update(entry.id) { clause in
                        if let shared = meta.shared(key) {
                            clause.sharedKey = shared.key
                            clause.category = shared.category
                            clause.topic = shared.topic
                            clause.title = shared.title
                            clause.content = shared.content
                        } else {
                            clause.sharedKey = nil
                        }
                    }
                })) {
                    Text("Własna treść dla tego produktu").tag("")
                    ForEach(meta.shared, id: \.key) { clause in Text("Wspólna zasada: \(clause.title)").tag(clause.key) }
                }
                .labelsHidden()
            }
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "Sekcja") {
                    Picker("", selection: Binding(get: { entry.category }, set: { category in
                        update(entry.id) { clause in
                            clause.category = category
                            clause.topic = meta.topics(category).first?.value ?? "technical"
                            clause.title = meta.topicLabel(clause.topic)
                        }
                    })) {
                        ForEach(meta.categories, id: \.key) { category in Text(category.label).tag(category.key) }
                    }
                    .labelsHidden()
                }
                .disabled(shared != nil)
                ProductField(label: "Typ kontrolowany w umowie") {
                    Picker("", selection: Binding(get: { entry.topic }, set: { topic in
                        update(entry.id) { clause in
                            clause.topic = topic
                            clause.title = meta.topicLabel(topic)
                        }
                    })) {
                        ForEach(meta.topics(entry.category), id: \.value) { topic in Text(topic.label).tag(topic.value) }
                    }
                    .labelsHidden()
                }
                .disabled(shared != nil)
            }
            ProductField(label: "Nazwa robocza") {
                TextField("", text: Binding(get: { entry.title }, set: { title in update(entry.id) { $0.title = String(title.prefix(200)) } }))
                    .textFieldStyle(.roundedBorder)
            }
            .disabled(shared != nil)
            HStack(spacing: 6) {
                HStack(spacing: 6) {
                Button("§n") { controller.insertParagraphHeading() }.help("Nagłówek paragrafu — numer nada umowa")
                Button("Tytuł") { controller.setKind(.title) }.help("Tytuł paragrafu (pogrubiony, wyśrodkowany)")
                Button("1. punkt główny") { controller.setKind(.point, level: 0) }
                Button("1.1 podpunkt") { controller.setKind(.point, level: 1) }
                Button("1.1.1 podpunkt") { controller.setKind(.point, level: 2) }
                Divider().frame(height: 16)
                Button { controller.toggleBold() } label: { Image(systemName: "bold") }.help("Pogrubienie (⌘B)")
                Button { controller.toggleItalic() } label: { Image(systemName: "italic") }.help("Kursywa (⌘I)")
                Button { controller.toggleUnderline() } label: { Image(systemName: "underline") }.help("Podkreślenie (⌘U)")
                Menu("Wstaw zmienną…") {
                    ForEach(meta.placeholders, id: \.value) { item in
                        Button("\(item.label) — \(item.value)") { controller.insertPlaceholder(item.value) }
                    }
                }
                .fixedSize()
                }
                .disabled(shared != nil)
                Spacer()
                Button(role: .destructive) { remove(entry.id) } label: { Label("Usuń", systemImage: "trash") }
            }
            ClauseEditorView(html: Binding(get: { entries.first { $0.id == entry.id }?.content ?? "" },
                                           set: { html in update(entry.id) { $0.content = html } }),
                             editable: shared == nil, controller: controller)
                .id(entry.id + (entry.sharedKey ?? ""))
                .frame(minHeight: 300)
            Text("Tab tworzy kolejny poziom numeracji, np. 1.1, a Shift+Tab wraca poziom wyżej. Wspólne obowiązki i wymagania wybieraj z listy wspólnych zasad. Własne wpisy powinny opisywać szczegóły usługi, np. napięcie, wymagane obciążenie, format pliku lub próbę techniczną.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Czynności
    private func update(_ id: String, _ change: (inout ProductResources.Clause) -> Void) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        change(&entries[index])
    }

    private func newEntry() -> ProductResources.Clause {
        let topic = meta.topics("requirements").first?.value ?? "technical"
        return ProductResources.Clause(id: UUID().uuidString.lowercased(), category: "requirements", topic: topic,
                                       title: meta.topicLabel(topic), content: "", sharedKey: nil)
    }

    private func start(addFirst: Bool = false) {
        entries = resources.clauses
        if entries.isEmpty { entries.append(newEntry()) }
        selectedID = entries.first?.id
        editing = true
    }

    private func add() {
        let entry = newEntry()
        entries.append(entry)
        selectedID = entry.id
    }

    private func remove(_ id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries.remove(at: index)
        selectedID = entries.indices.contains(max(0, index - 1)) ? entries[max(0, index - 1)].id : entries.first?.id
    }

    private func cancel() {
        editing = false
        entries = []
        selectedID = nil
    }

    private func inherit() {
        guard let variant = store.scope(productID) else { return }
        Task {
            await store.changeResources(productID, "variantInherit", ["variantId": .string(variant), "section": .string("contract_clauses")],
                                        success: "Przywrócono dziedziczenie z produktu bazowego")
        }
    }

    private func save() async {
        let payload: [JSONValue] = entries.compactMap { entry in
            if entry.sharedKey == nil && ClauseHTML.parse(entry.content).allSatisfy({ $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                return nil
            }
            var object: [String: JSONValue] = [
                "id": .string(entry.id), "category": .string(entry.category), "topic": .string(entry.topic),
                "title": .string(entry.title.trimmingCharacters(in: .whitespaces)), "content": .string(entry.content),
            ]
            if let key = entry.sharedKey { object["sharedKey"] = .string(key) }
            return .object(object)
        }
        saving = true
        defer { saving = false }
        if await store.changeResources(productID, "clausesSave", ["entries": .array(payload)], success: "Zapisano klauzule umowy") {
            cancel()
        }
    }
}
