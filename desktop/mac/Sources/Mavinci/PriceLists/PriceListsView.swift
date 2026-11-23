import SwiftUI

// MARK: Cenniki sezonowe — lista cenników według marek i edytor cen (jak „Oferty → Cenniki” w CRM), „Do sprawdzenia” pod listą

@MainActor struct PriceListsView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @StateObject private var store = PriceListsStore()
    @State private var creating = false
    @State private var duplicating = false
    @State private var settingsOpen = false
    @State private var percentMode: PriceListPercentSheet.Mode?
    @State private var deleting = false
    @State private var activatingEmpty = false

    var body: some View {
        Group {
            if let data = store.state {
                HStack(spacing: 0) {
                    sidebar(data).frame(width: 290)
                    Divider()
                    editorPane(data).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let error = store.loadError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać cenników", systemImage: "tag")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.load() } } }
            } else {
                ProgressView("Ładowanie cenników…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Cenniki")
        .task {
            store.workspace = state
            if store.state == nil { await store.load() }
        }
        .sheet(isPresented: $creating) { if let data = store.state { PriceListCreateSheet(store: store, data: data) } }
        .sheet(isPresented: $duplicating) { if let list = store.selected { PriceListDuplicateSheet(store: store, source: list) } }
        .sheet(isPresented: $settingsOpen) { if let list = store.selected { PriceListSettingsSheet(store: store, list: list) } }
        .sheet(item: $percentMode) { mode in
            if let list = store.selected, let data = store.state { PriceListPercentSheet(store: store, list: list, categories: data.categories, mode: mode) }
        }
        .confirmationDialog("Usunąć cennik „\(store.selected?.name ?? "")”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Usuń cennik", role: .destructive) {
                if let id = store.selectedID { Task { await store.changeList("delete", ["id": .string(id)], pending: "Usuwanie cennika…") } }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Usunięte zostaną też wszystkie ceny tego cennika. Tej operacji nie można cofnąć.")
        }
        .confirmationDialog("Aktywować pusty cennik?", isPresented: $activatingEmpty, titleVisibility: .visible) {
            Button("Aktywuj") { setStatus("active") }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Cennik nie ma jeszcze cen — oferty eventów z tego sezonu dostaną ceny z katalogu.")
        }
    }

    // MARK: Lista cenników

    private func sidebar(_ data: PriceListsState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Cenniki sezonowe", systemImage: "tag").font(.headline)
                Spacer()
                if store.loading { ProgressView().controlSize(.small) }
                Button { Task { await store.load() } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież cenniki")
                if data.canManage {
                    Button { creating = true } label: { Image(systemName: "plus") }.help("Nowy cennik")
                }
            }
            .buttonStyle(.borderless)
            .padding(12)
            Text("Cena oferty zależy od marki i roku eventu. Aktywny cennik podpowiada ceny ofert eventów z datą w sezonie; zapisane oferty trzymają swoje ceny.")
                .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.bottom, 8)
                .fixedSize(horizontal: false, vertical: true)
            if data.lists.isEmpty {
                Text(data.canManage ? "Nie ma jeszcze cenników. Utwórz pierwszy — np. „Wesela \(String(Calendar.current.component(.year, from: Date()) + 1))” dla Event Rulers — z cenami z katalogu." : "Nie ma jeszcze cenników.")
                    .font(.callout).foregroundStyle(.secondary).padding(12)
                Spacer()
            } else {
                List(selection: Binding(get: { store.selectedID }, set: { id in Task { await store.select(id) } })) {
                    ForEach(groups(data)) { group in
                        Section(group.name) {
                            ForEach(group.lists) { list in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack {
                                        Text(list.name).lineLimit(1)
                                        Spacer()
                                        statusBadge(list.status, list.statusLabel)
                                    }
                                    Text("\(list.season) · \(list.entryCount) cen\(list.offerCount > 0 ? " · ofert: \(list.offerCount)" : "")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 2)
                                .tag(Optional(list.id))
                            }
                        }
                    }
                    if let attention = data.attention, !attention.isEmpty { attentionSection(attention) }
                }
                .listStyle(.sidebar)
            }
        }
    }

    /// „Do sprawdzenia”: lata z eventami marki bez aktywnego cennika i oferty w toku do przeliczenia (otwierane na ekranie Ofert).
    private func attentionSection(_ attention: PriceListsState.Attention) -> some View {
        Section {
            ForEach(attention.missing) { gap in
                Label {
                    Text(gap.text).font(.caption).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                }
            }
            ForEach(attention.offers) { offer in
                Button { state.showOffer(offer.id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(offer.title).lineLimit(1)
                            Spacer()
                            Image(systemName: "arrow.up.forward.square").foregroundStyle(.secondary)
                        }
                        Text(offer.text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Otwórz ofertę")
            }
            Text(attention.hint).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("Do sprawdzenia (\(attention.offers.count + attention.missing.count))")
        }
    }

    private struct CompanyGroup: Identifiable {
        let name: String
        let lists: [PriceListsState.PriceList]
        var id: String { name }
    }

    private func groups(_ data: PriceListsState) -> [CompanyGroup] {
        var order: [String] = []
        var byCompany: [String: [PriceListsState.PriceList]] = [:]
        for list in data.lists {
            if byCompany[list.company] == nil { order.append(list.company) }
            byCompany[list.company, default: []].append(list)
        }
        return order.sorted { $0.localizedStandardCompare($1) == .orderedAscending }.map { CompanyGroup(name: $0, lists: byCompany[$0] ?? []) }
    }

    private func statusBadge(_ status: String, _ label: String) -> some View {
        Text(label)
            .font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background((status == "active" ? Color.green : Color.secondary).opacity(0.15), in: Capsule())
            .foregroundStyle(status == "active" ? Color.green : Color.secondary)
    }

    // MARK: Edytor

    @ViewBuilder private func editorPane(_ data: PriceListsState) -> some View {
        if let list = store.selected {
            VStack(alignment: .leading, spacing: 0) {
                editorHeader(list, canManage: data.canManage)
                Divider()
                if let editor = store.editor, editor.list.id == list.id {
                    PriceListTable(store: store, editor: editor, categories: data.categories, canManage: data.canManage,
                                   onFill: { percentMode = .fill }, onPercent: { percentMode = .percent })
                        .id(editor.list.id)
                } else if let error = store.editorError {
                    ContentUnavailableView {
                        Label("Nie udało się pobrać cen", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadEditor(list.id) } } }
                } else {
                    ProgressView("Wczytywanie cen…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            ContentUnavailableView("Wybierz cennik", systemImage: "tag", description: Text(data.canManage ? "Wybierz cennik z listy albo utwórz nowy." : "Wybierz cennik z listy."))
        }
    }

    private func editorHeader(_ list: PriceListsState.PriceList, canManage: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(list.company).font(.caption).foregroundStyle(.secondary)
                Text(list.name).font(.title2)
                Text("Sezon \(list.season) · \(list.statusLabel)\(list.offerCount > 0 ? " · użyty w ofertach: \(list.offerCount)" : "")")
                    .font(.callout).foregroundStyle(.secondary)
                if !list.notes.isEmpty { Text(list.notes).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer()
            if canManage {
                HStack(spacing: 8) {
                    if list.status != "active" {
                        Button {
                            if list.entryCount > 0 { setStatus("active") } else { activatingEmpty = true }
                        } label: { Label("Aktywuj", systemImage: "checkmark.circle") }
                    }
                    if list.status == "active" { Button { setStatus("archived") } label: { Label("Do archiwum", systemImage: "archivebox") } }
                    if list.status == "archived" { Button { setStatus("draft") } label: { Label("Przywróć jako szkic", systemImage: "arrow.uturn.backward") } }
                    Menu {
                        Button("Ustawienia (nazwa, sezon, notatki)…") { settingsOpen = true }
                        Button("Kopiuj na kolejny sezon…") { duplicating = true }
                        if list.offerCount == 0 {
                            Divider()
                            Button("Usuń cennik…", role: .destructive) { deleting = true }
                        }
                    } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                    .fixedSize()
                }
                .controlSize(.small)
            }
        }
        .padding(16)
    }

    private func setStatus(_ status: String) {
        guard let id = store.selectedID else { return }
        Task { await store.changeList("update", ["id": .string(id), "status": .string(status)], pending: "Zapisywanie statusu…") }
    }
}

// MARK: Tabela cen

@MainActor struct PriceListTable: View {
    @ObservedObject var store: PriceListsStore
    let editor: PriceListEditorData
    let categories: [PriceListsState.Category]
    let canManage: Bool
    let onFill: () -> Void
    let onPercent: () -> Void
    @State private var search = ""
    @State private var category = "all"
    @State private var onlyInList = false
    /// Wpisane ceny (zatwierdzone po wyjściu z pola albo Enter); `generation` odtwarza pola po zapisie lub odrzuceniu.
    @State private var edits: [String: String] = [:]
    @State private var generation = 0

    private var rows: [PriceListEditorData.Row] {
        let needle = SearchText.fold(search)
        return editor.rows.filter { row in
            (category == "all" || (row.categoryIds ?? [row.categoryId].compactMap { $0 }).contains(category))
                && (!onlyInList || row.entryId != nil || edits[row.key] != nil)
                && (needle.isEmpty || SearchText.fold(row.productName + " " + row.label).contains(needle))
        }
    }

    private var changes: (valid: [(row: PriceListEditorData.Row, price: Double?)], invalid: Int) {
        var valid: [(row: PriceListEditorData.Row, price: Double?)] = []
        var invalid = 0
        for row in editor.rows {
            guard let raw = edits[row.key] else { continue }
            guard let parsed = Self.parse(raw) else { invalid += 1; continue }
            if parsed.value != row.price { valid.append((row, parsed.value)) }
        }
        return (valid, invalid)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("", text: $search, prompt: Text("Szukaj produktu lub wariantu…")).textFieldStyle(.roundedBorder).frame(maxWidth: 260)
                Picker("", selection: $category) {
                    Text("Wszystkie kategorie").tag("all")
                    ForEach(categories) { row in Text(row.name).tag(row.id) }
                }
                .labelsHidden().frame(maxWidth: 200)
                Toggle("Tylko pozycje w cenniku", isOn: $onlyInList).toggleStyle(.checkbox)
                Spacer()
                if canManage {
                    Button { onFill() } label: { Label("Uzupełnij z katalogu…", systemImage: "wand.and.stars") }
                    Button { onPercent() } label: { Label("Zmień ceny o %…", systemImage: "percent") }
                        .disabled(!editor.rows.contains { $0.entryId != nil })
                }
            }
            .controlSize(.small)
            .padding(.horizontal, 16).padding(.vertical, 10)
            Table(rows) {
                TableColumn("Produkt / wariant") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.productName).lineLimit(1)
                        HStack(spacing: 6) {
                            Text(row.label).font(.caption).foregroundStyle(.secondary)
                            if row.inactive { Text("nieaktywny w katalogu").font(.caption2).foregroundStyle(.orange) }
                        }
                    }
                    .opacity(row.inactive ? 0.6 : 1)
                }
                .width(min: 220, ideal: 320)
                TableColumn("Kategoria") { row in Text(row.category ?? "—").foregroundStyle(.secondary).lineLimit(1) }
                    .width(min: 90, ideal: 140)
                TableColumn("Cena katalogowa netto") { row in
                    Text(OfferText.money(row.catalogPrice)).monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 120, ideal: 140)
                TableColumn("Cena w cenniku netto") { row in
                    PriceListPriceCell(initial: edits[row.key] ?? row.price.map(Self.format) ?? "", original: row.price, disabled: !canManage) { text in
                        if let parsed = Self.parse(text), parsed.value == row.price { edits[row.key] = nil } else { edits[row.key] = text }
                    }
                    .id("\(row.key)-\(row.price ?? -1)-\(generation)")
                }
                .width(min: 130, ideal: 150)
                TableColumn("Różnica") { row in
                    let value = edits[row.key].flatMap { Self.parse($0)?.value } ?? row.price
                    let diff = value.flatMap { price in row.catalogPrice > 0 ? (price / row.catalogPrice - 1) * 100 : nil }
                    Text(diff.map { "\($0 > 0 ? "+" : "")\(String(format: "%.1f", $0).replacingOccurrences(of: ".", with: ","))%" } ?? "—")
                        .monospacedDigit()
                        .foregroundStyle(diff == nil ? Color.secondary : (diff ?? 0) > 0 ? Color.orange : (diff ?? 0) < 0 ? Color.green : Color.secondary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 70, ideal: 80)
            }
            let pending = changes
            if canManage && (!pending.valid.isEmpty || pending.invalid > 0) {
                Divider()
                HStack {
                    Text("\(pending.invalid > 0 ? "Nieprawidłowe ceny: \(pending.invalid). " : "")Zmiany do zapisu: \(pending.valid.count) (puste pole usuwa produkt z cennika).")
                        .font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Button("Odrzuć") { edits = [:]; generation += 1 }
                    Button("Zapisz ceny") { Task { await save(pending.valid) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(pending.invalid > 0 || pending.valid.isEmpty)
                }
                .controlSize(.small)
                .padding(.horizontal, 16).padding(.vertical, 10)
            }
        }
    }

    private func save(_ valid: [(row: PriceListEditorData.Row, price: Double?)]) async {
        let changes: [JSONValue] = valid.map { change in
            .object([
                "productId": .string(change.row.productId),
                "variantId": change.row.variantId.map(JSONValue.string) ?? .null,
                "price": change.price.map(JSONValue.number) ?? .null,
            ])
        }
        if await store.changePrices("prices", ["id": .string(editor.list.id), "changes": .array(changes)], pending: "Zapisywanie cen…") {
            edits = [:]
            generation += 1
        }
    }

    /// Wpisana cena: `value == nil` — puste pole (usuń z cennika); `nil` — nieprawidłowa wartość.
    static func parse(_ text: String) -> (value: Double?, ok: Bool)? {
        let cleaned = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        if cleaned.isEmpty { return (nil, true) }
        guard cleaned.range(of: #"^\d+(\.\d{0,2})?$"#, options: .regularExpression) != nil, let value = Double(cleaned), value <= 999_999_999.99 else { return nil }
        return ((value * 100).rounded() / 100, true)
    }

    static func format(_ value: Double) -> String { String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",") }
}

/// Pole ceny w tabeli — własny stan tekstu (pisanie nie przelicza całej tabeli), zatwierdzenie Enterem albo wyjściem z pola.
@MainActor struct PriceListPriceCell: View {
    let initial: String
    let original: Double?
    let disabled: Bool
    let commit: (String) -> Void
    @State private var text: String
    @FocusState private var focused: Bool

    init(initial: String, original: Double?, disabled: Bool, commit: @escaping (String) -> Void) {
        self.initial = initial
        self.original = original
        self.disabled = disabled
        self.commit = commit
        _text = State(initialValue: initial)
    }

    var body: some View {
        let invalid = PriceListTable.parse(text) == nil
        TextField("", text: $text, prompt: Text("—"))
            .textFieldStyle(.roundedBorder)
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
            .focused($focused)
            .disabled(disabled)
            .onSubmit { commit(text) }
            .onChange(of: focused) { _, isFocused in if !isFocused { commit(text) } }
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(invalid ? Color.red.opacity(0.7) : Color.clear))
    }
}
