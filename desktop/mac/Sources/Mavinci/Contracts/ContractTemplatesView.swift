import SwiftUI

// MARK: Szablony umów (`/crm/contract-templates`) — tabela szablonów, obok karta z podsumowaniem treści (format, strony, pola,
// warunki, opcje, kategorie wydarzeń i umowy, które z niego korzystają) i czynności jak w CRM: nowy szablon, nazwa i opis,
// aktywny / nieaktywny, duplikat, usunięcie. Edytor treści na Macu — kolejny etap; do tego czasu „Edytuj treść” otwiera CRM.

@MainActor struct ContractTemplatesView: View {
    @ObservedObject var store: ContractsStore
    @EnvironmentObject private var state: Workspace
    @State private var search = ""
    @State private var filter = "all"
    @State private var sheetID: String?
    @State private var editing: ContractTemplateForm?
    @State private var sortOrder = [KeyPathComparator(\ContractTemplateItem.name)]

    private var rows: [ContractTemplateItem] {
        let needle = SearchText.fold(search)
        return store.templates.filter { item in
            if !needle.isEmpty && !SearchText.fold(item.searchText).contains(needle) { return false }
            switch filter {
            case "active": return item.active
            case "inactive": return !item.active
            default: return true
            }
        }.sorted(using: sortOrder)
    }

    var body: some View {
        GeometryReader { outer in
            let wide = outer.size.width >= 1050
            VStack(spacing: 0) {
                toolbar
                if let problem = store.loadError { MessageBar(text: problem, warning: true) { store.loadError = nil } }
                HStack(alignment: .top, spacing: 0) {
                    table
                    if wide, let item = store.template(store.selectedTemplateID) {
                        Divider()
                        ContractTemplateDetailPane(store: store, item: item, edit: { editing = ContractTemplateForm(item) }).frame(width: 380).id(item.id)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .onChange(of: store.selectedTemplateID) { _, next in if !wide, next != nil { sheetID = next } }
        }
        .navigationTitle("Szablony umów")
        .sheet(item: Binding(get: { sheetID.map(IdentifiedID.init) }, set: { sheetID = $0?.id })) { selected in
            if let item = store.template(selected.id) {
                VStack(spacing: 0) {
                    ContractTemplateDetailPane(store: store, item: item, edit: { sheetID = nil; editing = ContractTemplateForm(item) })
                    HStack { Spacer(); Button("Zamknij") { sheetID = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                }
                .frame(minWidth: 440, minHeight: 520)
            }
        }
        .sheet(item: $editing) { form in ContractTemplateFormSheet(store: store, form: form) }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            TextField("Szukaj szablonu", text: $search).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
            Picker("Pokaż", selection: $filter) {
                Text("Wszystkie (\(store.templates.count))").tag("all")
                Text("Aktywne (\(store.templates.filter(\.active).count))").tag("active")
                Text("Nieaktywne (\(store.templates.filter { !$0.active }.count))").tag("inactive")
            }
            .labelsHidden().fixedSize()
            Spacer()
            if store.syncing { ProgressView().controlSize(.small) }
            Button { state.openHref("/crm/contracts") } label: { Label("Umowy", systemImage: "signature") }
            if store.canCreate {
                Button { editing = ContractTemplateForm() } label: { Label("Nowy szablon", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .disabled(!state.canWrite)
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    private var table: some View {
        Table(rows, selection: $store.selectedTemplateID, sortOrder: $sortOrder) {
            TableColumn("Szablon", value: \.name) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).lineLimit(1)
                    if let description = item.description, !description.isEmpty {
                        Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }.padding(.vertical, 3)
            }.width(min: 220, ideal: 340)
            TableColumn("Format", value: \.format) { item in
                Text(item.formatText).foregroundStyle(item.format == "word" ? Color.primary : Color.secondary)
            }.width(min: 110, ideal: 130, max: 160)
            TableColumn("Kategorie wydarzeń", value: \.categoriesText) { item in
                Text(item.categoriesText).lineLimit(1).foregroundStyle(item.categories.isEmpty ? .secondary : .primary)
            }.width(min: 140, ideal: 220)
            TableColumn("Umowy", value: \.contracts) { item in
                Text(item.contracts == 0 ? "—" : "\(item.contracts)").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 50, ideal: 60, max: 80)
            TableColumn("Status", value: \.activeText) { item in
                Text(item.activeText).foregroundStyle(item.active ? Color.green : Color.secondary)
            }.width(min: 80, ideal: 95, max: 120)
            TableColumn("Zmieniono", value: \.sortUpdated) { item in
                Text(ContractText.day(item.updatedAt ?? item.createdAt)).monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 95, max: 120)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = store.template(id) {
                Button("Edytuj treść w CRM") { state.openCRM(editorHref(item)) }
                if store.canManage { Button("Zmień nazwę i opis…") { editing = ContractTemplateForm(item) } }
            }
        } primaryAction: { ids in
            guard let id = ids.first, let item = store.template(id) else { return }
            state.openCRM(editorHref(item))
        }
        .overlay {
            if rows.isEmpty {
                if !store.loaded { ProgressView("Ładowanie szablonów…") }
                else { ContentUnavailableView(store.templates.isEmpty ? "Brak szablonów umów" : "Brak szablonów w tym widoku", systemImage: "doc.richtext") }
            }
        }
    }

    private func editorHref(_ item: ContractTemplateItem) -> String { "/crm/contract-templates/\(item.id)/edit-wysiwyg" }
}

// MARK: Karta szablonu

@MainActor struct ContractTemplateDetailPane: View {
    @ObservedObject var store: ContractsStore
    let item: ContractTemplateItem
    let edit: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var deleting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(item.activeText).font(.caption.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background((item.active ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
                            .foregroundStyle(item.active ? Color.green : Color.secondary)
                        Text(item.formatText).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                    Text(item.name).font(.title3.bold()).textSelection(.enabled)
                    if let description = item.description, !description.isEmpty {
                        Text(description).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                actions
                summary
                if item.format != "word" {
                    Label("Starszy format — w edytorze CRM przekształcisz go do edytora jak Word (style, warunki, scalanie wariantów).", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .confirmationDialog("Usunąć szablon „\(item.name)”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Usuń szablon", role: .destructive) {
                Task {
                    if await store.run("Usuwanie szablonu…", ["op": .string("templateDelete"), "id": .string(item.id)], success: "Szablon usunięty") != nil {
                        store.selectedTemplateID = nil
                    }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(item.contracts > 0 || !item.categories.isEmpty
                 ? "Szablon jest używany (umowy: \(item.contracts), kategorie: \(item.categories.count)). Zamiast usuwać, możesz go wyłączyć."
                 : "Tej operacji nie można cofnąć.")
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button { state.openCRM("/crm/contract-templates/\(item.id)/edit-wysiwyg") } label: { Label("Edytuj treść w CRM", systemImage: "safari") }
                .buttonStyle(.borderedProminent)
                .help("Edytor treści szablonu na Macu powstaje w kolejnym etapie.")
            Menu {
                if store.canManage {
                    Button { edit() } label: { Label("Zmień nazwę i opis…", systemImage: "pencil") }
                    Button {
                        Task {
                            await store.run(item.active ? "Wyłączanie…" : "Włączanie…",
                                            ["op": .string("templateActive"), "id": .string(item.id), "active": .bool(!item.active)],
                                            success: item.active ? "Szablon jest nieaktywny" : "Szablon jest aktywny")
                        }
                    } label: { Label(item.active ? "Wyłącz (nieaktywny)" : "Włącz (aktywny)", systemImage: item.active ? "pause.circle" : "play.circle") }
                }
                if store.canCreate {
                    Button {
                        Task {
                            if let reply = await store.run("Duplikowanie szablonu…", ["op": .string("templateDuplicate"), "id": .string(item.id)], success: "Utworzono kopię szablonu"),
                               case .string(let id)? = reply["id"] {
                                store.selectedTemplateID = id
                            }
                        }
                    } label: { Label("Duplikuj", systemImage: "plus.square.on.square") }
                }
                if store.canManage {
                    Divider()
                    Button(role: .destructive) { deleting = true } label: { Label("Usuń…", systemImage: "trash") }
                }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .disabled(!state.canWrite || (!store.canManage && !store.canCreate))
                .help("Więcej czynności")
            Spacer()
        }
    }

    private var summary: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
            row("Kategorie wydarzeń", item.categoriesText)
            row("Umowy z szablonu", item.contracts == 0 ? "—" : "\(item.contracts)")
            row("Strony", item.pages == 0 ? "—" : "\(item.pages)")
            row("Pola umowy", item.fields == 0 ? "—" : "\(item.fields)")
            row("Sekcje warunkowe", item.conditions == 0 ? "—" : "\(item.conditions)")
            row("Opcje umowy", item.options.isEmpty ? "—" : item.options.joined(separator: ", "))
            row("Zmieniono", ContractText.date(item.updatedAt ?? item.createdAt))
        }
        .font(.callout)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: Nowy szablon / nazwa i opis

struct ContractTemplateForm: Identifiable {
    let id: String
    let templateID: String?
    var name: String
    var description: String
    init() { id = UUID().uuidString; templateID = nil; name = ""; description = "" }
    init(_ item: ContractTemplateItem) { id = item.id; templateID = item.id; name = item.name; description = item.description ?? "" }
}

@MainActor struct ContractTemplateFormSheet: View {
    @ObservedObject var store: ContractsStore
    @State var form: ContractTemplateForm
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    private var valid: Bool { !form.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(form.templateID == nil ? "Nowy szablon umowy" : "Nazwa i opis szablonu").font(.title3.bold())
            Form {
                TextField("Nazwa", text: $form.name)
                TextField("Opis", text: $form.description, axis: .vertical).lineLimit(3...6)
            }
            .formStyle(.grouped)
            if form.templateID == nil {
                Text("Nowy szablon powstaje w edytorze jak Word (style dokumentu, warunki). Treść uzupełnisz w edytorze.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(form.templateID == nil ? "Utwórz" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!valid || saving || !state.canWrite)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let name = form.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = form.description.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = form.templateID {
            let body: [String: JSONValue] = ["op": .string("templateSave"), "id": .string(id), "name": .string(name), "description": .string(description)]
            if await store.run("Zapisywanie…", body, success: "Zapisano szablon") != nil { dismiss() }
        } else {
            let body: [String: JSONValue] = ["op": .string("templateCreate"), "name": .string(name), "description": .string(description)]
            if let reply = await store.run("Tworzenie szablonu…", body, success: "Szablon utworzony") {
                if case .string(let id)? = reply["id"] { store.selectedTemplateID = id }
                dismiss()
            }
        }
    }
}
