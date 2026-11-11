import SwiftUI

// MARK: Kategorie magazynu — 1:1 z `/crm/equipment/categories`: kategorie główne i podkategorie z właściwościami specjalnymi
// (`special_properties`, np. `simple_quantity`, `requires_serial`), dodawanie, edycja i usuwanie (z podkategoriami).

struct CategoryEditorRequest: Identifiable {
    let id = UUID()
    let category: WarehouseCategory?
    let parentId: String?
}

@MainActor struct WarehouseCategoriesView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editor: CategoryEditorRequest?
    @State private var removing: WarehouseCategory?
    @State private var search = ""

    private var mains: [WarehouseCategory] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.categories.filter { $0.level == 1 || $0.parentId == nil }.sorted { $0.order < $1.order }.filter { main in
            q.isEmpty || main.name.lowercased().contains(q) || children(main).contains { $0.name.lowercased().contains(q) }
        }
    }
    private func children(_ parent: WarehouseCategory) -> [WarehouseCategory] {
        store.categories.filter { $0.parentId == parent.id }.sorted { $0.order < $1.order }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if mains.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "Brak kategorii" : "Nie znaleziono kategorii", systemImage: "folder")
                }
                ForEach(mains) { main in
                    VStack(alignment: .leading, spacing: 0) {
                        row(main, isMain: true)
                        ForEach(children(main)) { sub in
                            row(sub, isMain: false).padding(.leading, 28).background(Color.primary.opacity(0.03))
                        }
                    }
                    .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(16)
        }
        .navigationTitle("Zarządzanie kategoriami")
        .navigationSubtitle("Magazyn")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj kategorii…")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.openHref("/crm/equipment") } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do magazynu")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage {
                    Button { editor = CategoryEditorRequest(category: nil, parentId: nil) } label: { Label("Dodaj nową kategorię główną", systemImage: "plus") }
                }
            }
        }
        .sheet(item: $editor) { request in
            WarehouseCategorySheet(store: store, category: request.category, parentId: request.parentId).warehouseSheetStyle(state)
        }
        .confirmationDialog("Usuń kategorię", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let category = removing { Task { await store.run("Usuwanie…", "categoryDelete", ["id": .string(category.id)], success: "Usunięto kategorię") } }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            if let category = removing {
                Text(children(category).isEmpty ? "Czy na pewno chcesz usunąć \"\(category.name)\"?"
                     : "Czy na pewno chcesz usunąć kategorię \"\(category.name)\"? To usunie także wszystkie podkategorie i odłączy sprzęt.")
            }
        }
        .task(id: state.employee?.id) { await store.backgroundSync() }
    }

    private func row(_ category: WarehouseCategory, isMain: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isMain ? "folder.fill" : "folder").foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 4) {
                Text(category.name).font(isMain ? .title3.weight(.medium) : .body)
                if !category.description.isEmpty { Text(category.description).font(.caption).foregroundStyle(.secondary) }
                let active = (category.properties ?? []).filter(\.value)
                if !active.isEmpty {
                    HStack(spacing: 4) { ForEach(active, id: \.name) { WarehouseBadge(text: $0.name, color: theme.accent) } }
                }
            }
            Spacer()
            if store.canManage {
                if isMain {
                    Button { editor = CategoryEditorRequest(category: nil, parentId: category.id) } label: { Label("Dodaj podkategorię", systemImage: "plus") }
                        .buttonStyle(.borderless).labelStyle(.iconOnly).help("Dodaj podkategorię")
                }
                Button { editor = CategoryEditorRequest(category: category, parentId: category.parentId) } label: { Label("Edytuj", systemImage: "pencil") }
                    .buttonStyle(.borderless).labelStyle(.iconOnly).help("Edytuj")
                Button(role: .destructive) { removing = category } label: { Label("Usuń", systemImage: "trash") }
                    .buttonStyle(.borderless).labelStyle(.iconOnly).help("Usuń")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contextMenu {
            if store.canManage {
                if isMain { Button("Dodaj podkategorię", systemImage: "plus") { editor = CategoryEditorRequest(category: nil, parentId: category.id) } }
                Button("Edytuj", systemImage: "pencil") { editor = CategoryEditorRequest(category: category, parentId: category.parentId) }
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = category }
            }
        }
    }
}

@MainActor struct WarehouseCategorySheet: View {
    @ObservedObject var store: WarehouseStore
    let category: WarehouseCategory?
    let parentId: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var properties: [SpecialProperty] = []
    @State private var newProperty = ""
    @State private var saving = false

    private var title: String {
        if category != nil { return "Edytuj kategorię" }
        return parentId == nil ? "Nowa kategoria główna" : "Nowa podkategoria"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.weight(.light))
            if category == nil, let parent = store.category(parentId) { Text("w kategorii „\(parent.name)”").foregroundStyle(.secondary) }
            Form {
                TextField("Nazwa", text: $name, prompt: Text(parentId == nil ? "np. Dekoracje, Kostiumy..." : "Nazwa podkategorii"))
                TextField("Opis", text: $description, prompt: Text(parentId == nil ? "Krótki opis kategorii" : "Opis (opcjonalny)"), axis: .vertical).lineLimit(2...4)
                Section("Właściwości specjalne") {
                    ForEach($properties, id: \.name) { $property in
                        HStack {
                            Toggle(property.name, isOn: $property.value)
                            Spacer()
                            Button(role: .destructive) { properties.removeAll { $0.name == property.name } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless)
                        }
                    }
                    HStack {
                        TextField("", text: $newProperty, prompt: Text("Dodaj właściwość (np. simple_quantity, requires_serial)")).onSubmit(addProperty)
                        Button("Dodaj", systemImage: "plus", action: addProperty).disabled(newProperty.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 560, height: 520)
        .onAppear {
            if let category { name = category.name; description = category.description; properties = category.properties ?? [] }
        }
    }

    private func addProperty() {
        let clean = newProperty.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return }
        if !properties.contains(where: { $0.name == clean }) { properties.append(SpecialProperty(name: clean, value: true)) }
        newProperty = ""
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let reply = await store.run("Zapisywanie…", "categorySave", [
            "id": .string(category?.id ?? ""),
            "data": .object([
                "name": .string(name), "description": .string(description), "parentId": .string(parentId ?? ""),
                "properties": .array(properties.map { .object(["name": .string($0.name), "value": .bool($0.value)]) }),
            ]),
        ], success: category != nil ? "Zapisano zmiany" : parentId == nil ? "Dodano kategorię" : "Dodano podkategorię")
        if reply != nil { dismiss() }
    }
}
