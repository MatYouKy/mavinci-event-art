import SwiftUI

// MARK: Broszury — lista (`/crm/brochures`): aktywne i archiwum, wyszukiwanie, „Szablon Hotele · 24 strony”, „Pusta broszura”,
// zmiana nazwy, archiwizacja i przywracanie. Edytor — `BrochureEditorView.swift`.

@MainActor struct BrochuresView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @StateObject private var store = BrochuresStore()
    /// Broszura do otwarcia z innego ekranu („Otwórz broszurę bazową” w karcie klienta).
    @ObservedObject private var router = BrochureRouter.shared
    @State private var archived = false
    @State private var query = ""
    @State private var opened: String?
    @State private var management: BrochureManagementRoute?

    var body: some View {
        Group {
            if let opened {
                BrochureEditorView(store: store, id: opened) {
                    self.opened = nil
                    Task { await store.load() }
                }
                .id(opened)
            } else if let data = store.state {
                list(data).navigationTitle("Broszury")
            } else if let error = store.loadError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać broszur", systemImage: "book")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.load() } } }
                .navigationTitle("Broszury")
            } else {
                ProgressView("Ładowanie broszur…").frame(maxWidth: .infinity, maxHeight: .infinity).navigationTitle("Broszury")
            }
        }
        .task {
            store.workspace = state
            consumeRoute()
            if store.state == nil { await store.load() }
        }
        .onChange(of: router.pending) { _, _ in consumeRoute() }
        .sheet(item: $management) { route in
            BrochureManagementSheet(store: store, route: route) { _ in }
        }
    }

    private func consumeRoute() {
        guard let id = router.pending else { return }
        router.pending = nil
        opened = id
    }

    private func filtered(_ data: BrochureListState) -> [BrochureListState.Brochure] {
        let visible = data.brochures.filter { ($0.status == "archived") == archived }
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !term.isEmpty else { return visible }
        return visible.filter { "\($0.name) \($0.title) \($0.organization ?? "")".lowercased().contains(term) }
    }

    private func list(_ data: BrochureListState) -> some View {
        let rows = filtered(data)
        let archivedCount = data.brochures.filter { $0.status == "archived" }.count
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                Picker("Widok broszur", selection: $archived) {
                    Text("Aktywne (\(data.brochures.count - archivedCount))").tag(false)
                    Text("Archiwum (\(archivedCount))").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                if archived {
                    Text("Broszury usunięte z aktywnej listy. Zapisane PDF-y klientów pozostają dostępne; przywrócisz je z menu broszury.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                if rows.isEmpty {
                    empty(canManage: data.canManage)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 16)], spacing: 16) {
                        ForEach(rows) { brochure in card(brochure, canManage: data.canManage) }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .searchable(text: $query, placement: .toolbar, prompt: "Szukaj broszury lub hotelu")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                    .help("Odśwież listę broszur")
                if data.canManage {
                    Menu {
                        Button { Task { await create(hotelTemplate: false) } } label: { Label("Pusta broszura", systemImage: "doc") }
                        Button { Task { await create(hotelTemplate: true) } } label: { Label("Z szablonu Hotele · 24 strony", systemImage: "building.2") }
                    } label: { Label("Nowa broszura", systemImage: "plus") }
                        .help("Nowa broszura — pusta albo z szablonu dla hoteli")
                        .disabled(!state.canWrite)
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("MATERIAŁY SPRZEDAŻOWE", systemImage: "book").font(.caption).foregroundStyle(theme.accent)
                Text("Broszury").font(.largeTitle.weight(.light))
                Text("Zacznij od szablonu dla hoteli lub pustej broszury (przycisk „Nowa broszura” u góry). W edytorze zmienisz treść, zdjęcia i kolejność stron, a następnie wygenerujesz PDF.")
                    .font(.callout).foregroundStyle(.secondary).frame(maxWidth: 640, alignment: .leading)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
        }
    }

    private func create(hotelTemplate: Bool) async {
        if let id = await store.create(hotelTemplate: hotelTemplate) { opened = id }
    }

    private func empty(canManage: Bool) -> some View {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        return ContentUnavailableView {
            Label(searching ? "Brak wyników" : archived ? "Archiwum jest puste" : "Brak broszur", systemImage: "doc.badge.plus")
        } description: {
            Text(searching ? "Zmień wyszukiwaną nazwę." : archived ? "Tutaj znajdziesz broszury usunięte z aktywnej listy." : "Utwórz pierwszą prezentację usług dla hoteli.")
        } actions: {
            if canManage && !searching && !archived {
                Button { Task { await create(hotelTemplate: true) } } label: { Label("Z szablonu Hotele · 24 strony", systemImage: "building.2") }
                    .buttonStyle(.borderedProminent)
                Button { Task { await create(hotelTemplate: false) } } label: { Label("Pusta broszura", systemImage: "doc") }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 50)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func badge(_ brochure: BrochureListState.Brochure) -> (text: String, color: Color) {
        if archived { return ("Archiwum", .secondary) }
        if brochure.pdfVersion > 0 && !brochure.modified { return ("PDF v\(brochure.pdfVersion)", .green) }
        return (brochure.pdfVersion > 0 ? "Wymaga aktualizacji" : "Szkic", .orange)
    }

    private func card(_ brochure: BrochureListState.Brochure, canManage: Bool) -> some View {
        let status = badge(brochure)
        return Button { opened = brochure.id } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: "doc.text").font(.title2).foregroundStyle(theme.accent)
                        .padding(10).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    Spacer()
                    Text(status.text).font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                        .foregroundStyle(status.color).background(status.color.opacity(0.14), in: Capsule())
                        .padding(.trailing, canManage ? 30 : 0)
                }
                Text(brochure.name).font(.headline).lineLimit(2)
                Text(brochure.title).font(.callout).foregroundStyle(.secondary).lineLimit(2).frame(minHeight: 34, alignment: .top)
                Divider()
                HStack(spacing: 12) {
                    Text(BrochureAudience.group(brochure.audienceType))
                    Text("\(brochure.pageCount) stron")
                    if let organization = brochure.organization {
                        Label(organization, systemImage: "building.2").foregroundStyle(theme.accent).lineLimit(1)
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Otwórz") { opened = brochure.id }
            if canManage {
                Divider()
                if archived {
                    Button("Przywróć broszurę…") { route(brochure, "restore") }
                } else {
                    Button("Zmień nazwę…") { route(brochure, "rename") }
                    Button("Usuń broszurę…", role: .destructive) { route(brochure, "remove") }
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            if canManage {
                Menu {
                    if archived {
                        Button { route(brochure, "restore") } label: { Label("Przywróć broszurę", systemImage: "arrow.uturn.backward") }
                    } else {
                        Button { route(brochure, "rename") } label: { Label("Zmień nazwę", systemImage: "pencil") }
                        Button(role: .destructive) { route(brochure, "remove") } label: { Label("Usuń broszurę", systemImage: "trash") }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .padding(14)
                    .disabled(management != nil || !state.canWrite)
            }
        }
    }

    private func route(_ brochure: BrochureListState.Brochure, _ action: String) {
        management = BrochureManagementRoute(action: action, brochureID: brochure.id, name: brochure.name, updatedAt: brochure.updatedAt)
    }
}

/// Okno „Zmień nazwę broszury”, „Usuń broszurę” (archiwum) albo „Przywróć broszurę”.
struct BrochureManagementRoute: Identifiable {
    let action: String
    let brochureID: String
    let name: String
    let updatedAt: String
    var unsavedChanges = false
    let id = UUID()
}

@MainActor struct BrochureManagementSheet: View {
    let store: BrochuresStore
    let route: BrochureManagementRoute
    let done: (BrochureRecord) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name: String
    @State private var saving = false
    @State private var error: String?

    init(store: BrochuresStore, route: BrochureManagementRoute, done: @escaping (BrochureRecord) -> Void) {
        self.store = store
        self.route = route
        self.done = done
        _name = State(initialValue: route.name)
    }

    private var title: String {
        route.action == "rename" ? "Zmień nazwę broszury" : route.action == "remove" ? "Usuń broszurę" : "Przywróć broszurę"
    }
    private var submitLabel: String {
        if saving { return "Zapisywanie…" }
        return route.action == "rename" ? "Zapisz nazwę" : route.action == "remove" ? "Usuń z listy — do archiwum" : "Przywróć broszurę"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.title3.weight(.semibold))
            if route.action == "rename" {
                ProductField(label: "Nazwa robocza broszury") {
                    TextField("", text: $name).textFieldStyle(.roundedBorder).disabled(saving)
                        .onChange(of: name) { _, _ in error = nil }
                }
                Text("To nazwa na liście i w edytorze. Tytuł okładki oraz nazwy i treść już zapisanych PDF-ów nie zmienią się.")
                    .font(.callout).foregroundStyle(.secondary)
                if route.unsavedChanges {
                    Text("Zapiszemy tylko nazwę. Pozostałe niezapisane zmiany pozostaną w edytorze.").font(.callout).foregroundStyle(.orange)
                }
            } else {
                Text(route.name).font(.headline)
                Text(route.action == "remove"
                     ? "Broszura zniknie z aktywnej listy i trafi do archiwum. Możesz ją później przywrócić. Zapisane wersje PDF przypisane klientom, powiązania i historia wysyłek pozostaną bez zmian."
                     : "Broszura wróci na aktywną listę. Ponownie będzie można ją edytować i generować kolejne wersje PDF.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if route.action == "remove" {
                    Text("Archiwizacja wyłącza nowe wejścia do demo tej broszury. Nie wycofuje wcześniej wysłanych plików ani nie zatrzymuje zaplanowanych wysyłek.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if route.unsavedChanges {
                        Text("Niezapisane zmiany w edytorze nie zostaną zachowane.").font(.callout).foregroundStyle(.orange)
                    }
                }
            }
            if let error {
                Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(submitLabel) { Task { await submit() } }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .tint(route.action == "remove" ? .red : theme.accent)
                    .disabled(saving || (route.action == "rename" && name.trimmingCharacters(in: .whitespaces).isEmpty))
            }
        }
        .padding(20)
        .frame(width: 480)
        .interactiveDismissDisabled(saving)
    }

    private func submit() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if route.action == "rename" && (trimmed.isEmpty || trimmed.count > 200) {
            error = "Wpisz nazwę broszury — od 1 do 200 znaków."
            return
        }
        saving = true
        defer { saving = false }
        do {
            let record = try await store.manage(id: route.brochureID, action: route.action, name: trimmed, updatedAt: route.updatedAt)
            done(record)
            dismiss()
        } catch {
            self.error = store.failureText(error, "Nie udało się potwierdzić zmiany. Odśwież widok, aby sprawdzić aktualny stan broszury.")
        }
    }
}
