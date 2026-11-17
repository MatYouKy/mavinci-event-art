import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Arkusz bazy danych — 1:1 z `/crm/databases/[id]`: nazwa (zmiana nazwy), „Eksportuj CSV”, „Pobierz PDF”, „Drukuj”,
// „Usuń bazę” (administrator), tabela z numeracją wierszy, edycją komórek w miejscu (Enter / kliknięcie obok zapisuje,
// Esc anuluje), kolumny: dodawanie z typem, zmiana nazwy, usuwanie, szerokość (przeciąganie krawędzi), kolejność
// (przeciąganie uchwytu), rekordy: dodawanie i usuwanie. Arkusz zajmuje całe okno (pasek boczny chowa się na czas pracy
// z bazą i wraca po wyjściu), a tabela wypełnia szerokość jak w CRM (`w-full`); „Pełny ekran” przełącza pełny ekran okna.

private struct CellRef: Hashable {
    let record: String
    let column: String
}

@MainActor struct CustomDatabaseView: View {
    @ObservedObject var store: CustomDatabasesStore
    let databaseID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var renaming = false
    @State private var nameDraft = ""
    @State private var editing: CellRef?
    @State private var draft = ""
    @State private var draftDate: Date?
    @FocusState private var focusedCell: CellRef?
    @State private var editingColumn: String?
    @State private var columnDraft = ""
    @State private var addingColumn = false
    @State private var newColumnName = ""
    @State private var newColumnType = CustomDatabaseType.text
    @State private var widths: [String: Double] = [:]
    @State private var resizeStart: [String: Double] = [:]
    /// Skala tabeli z chwili rozpoczęcia przeciągania krawędzi kolumny (ruch kursora → zapisana szerokość).
    @State private var resizeScale: [String: CGFloat] = [:]
    /// Szerokość obszaru tabeli — wolne miejsce rozdzielane między kolumny.
    @State private var availableWidth: CGFloat = 0
    /// Stan paska bocznego sprzed otwarcia arkusza (przywracany po wyjściu).
    @State private var previousSidebar: NavigationSplitViewVisibility?
    @State private var removingRecord: CustomDatabaseRecord?
    @State private var removingColumn: CustomDatabaseColumn?
    @State private var removingDatabase = false

    private var detail: CustomDatabaseDetail? { store.details[databaseID] }
    private var canManage: Bool { detail?.access.canManage ?? false }
    private var isAdmin: Bool { detail?.access.isAdmin ?? false }
    private let indexWidth: CGFloat = 50
    private let actionsWidth: CGFloat = 56
    private let addColumnWidth: CGFloat = 120

    /// Szerokość zapisana w bazie (podczas przeciągania — lokalna, zanim zapis wróci z serwera).
    private func storedWidth(_ column: CustomDatabaseColumn) -> Double { widths[column.id] ?? column.width }

    /// Tabela na całą szerokość jak w CRM (`<table className="w-full">`): wolne miejsce rozdzielane proporcjonalnie
    /// do zapisanych szerokości kolumn; gdy kolumny są szersze niż okno — przewijanie w poziomie (skala 1).
    private var scale: CGFloat {
        guard let columns = detail?.columns, !columns.isEmpty, availableWidth > 0 else { return 1 }
        let stored: Double = columns.reduce(0) { $0 + storedWidth($1) }
        let fixed: CGFloat = indexWidth + (canManage ? addColumnWidth + actionsWidth : 0)
        let free: CGFloat = availableWidth - fixed - 2
        guard stored > 0, free > CGFloat(stored) else { return 1 }
        return free / CGFloat(stored)
    }

    private func width(_ column: CustomDatabaseColumn) -> CGFloat { CGFloat(storedWidth(column)) * scale }

    var body: some View {
        dialogs(page)
    }

    @ViewBuilder private var pageContent: some View {
        if let detail {
            sheet(detail)
        } else if let error = store.detailErrors[databaseID] {
            ContentUnavailableView {
                Label("Nie znaleziono bazy danych", systemImage: "cylinder.split.1x2")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.loadDetail(databaseID) } }
                Button("Powrót do listy") { store.openedID = nil }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var page: some View {
        pageContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .navigationTitle(detail?.database.name ?? "Baza danych")
            .navigationSubtitle(pageSubtitle)
            .task(id: loadKey) { await store.loadDetail(databaseID) }
            .onAppear { enterFullWindow() }
            .onDisappear { leaveFullWindow() }
    }

    /// Arkusz na całe okno: chowa pasek boczny (przycisk paska w oknie przywraca go w każdej chwili).
    private func enterFullWindow() {
        if previousSidebar == nil { previousSidebar = state.sidebarVisibility }
        guard state.sidebarVisibility != .detailOnly else { return }
        withAnimation(.easeInOut(duration: 0.2)) { state.sidebarVisibility = .detailOnly }
    }

    /// Po wyjściu z arkusza pasek boczny wraca do stanu sprzed otwarcia.
    private func leaveFullWindow() {
        let previous: NavigationSplitViewVisibility = previousSidebar ?? .all
        previousSidebar = nil
        guard state.sidebarVisibility != previous else { return }
        withAnimation(.easeInOut(duration: 0.2)) { state.sidebarVisibility = previous }
    }

    private func dialogs<Content: View>(_ content: Content) -> some View {
        content
            .confirmationDialog("Usunąć rekord?", isPresented: removingRecordShown, titleVisibility: .visible) {
                if let record = removingRecord {
                    Button("Usuń", role: .destructive) { deleteRecord(record) }
                    Button("Anuluj", role: .cancel) {}
                }
            } message: { Text("Czy na pewno chcesz usunąć ten rekord?") }
            .confirmationDialog("Usunąć kolumnę?", isPresented: removingColumnShown, titleVisibility: .visible) {
                if let column = removingColumn {
                    Button("Usuń", role: .destructive) { deleteColumn(column) }
                    Button("Anuluj", role: .cancel) {}
                }
            } message: { Text(removeColumnMessage) }
            .confirmationDialog("Usunąć bazę danych?", isPresented: $removingDatabase, titleVisibility: .visible) {
                Button("Usuń", role: .destructive) { deleteDatabase() }
                Button("Anuluj", role: .cancel) {}
            } message: { Text(removeDatabaseMessage) }
    }

    // MARK: Teksty i akcje okien potwierdzeń (wydzielone — krótsze wyrażenia dla kompilatora)

    private var pageSubtitle: String {
        guard let detail else { return "" }
        return "Rekordów: \(detail.records.count) · Kolumn: \(detail.columns.count)"
    }

    private var loadKey: String { "\(databaseID)|\(state.employee?.id ?? "")" }

    private var removeColumnMessage: String {
        let name: String = removingColumn?.name ?? ""
        return "Czy na pewno chcesz usunąć kolumnę „\(name)”? Wszystkie dane w tej kolumnie zostaną utracone."
    }

    private var removeDatabaseMessage: String {
        let name: String = detail?.database.name ?? ""
        return "Czy na pewno chcesz usunąć całą bazę danych „\(name)”? Ta operacja jest nieodwracalna."
    }

    private var removingRecordShown: Binding<Bool> {
        Binding(get: { removingRecord != nil }, set: { shown in if !shown { removingRecord = nil } })
    }

    private var removingColumnShown: Binding<Bool> {
        Binding(get: { removingColumn != nil }, set: { shown in if !shown { removingColumn = nil } })
    }

    private func deleteRecord(_ record: CustomDatabaseRecord) {
        let body: [String: JSONValue] = ["id": .string(record.id)]
        Task { await store.run("Usuwanie rekordu…", "recordDelete", body, reload: databaseID) }
    }

    private func deleteColumn(_ column: CustomDatabaseColumn) {
        let body: [String: JSONValue] = ["id": .string(column.id)]
        Task { await store.run("Usuwanie kolumny…", "columnDelete", body, reload: databaseID) }
    }

    private func deleteDatabase() {
        Task { await store.remove("Usuwanie bazy danych…", id: databaseID) }
    }

    private func sheet(_ detail: CustomDatabaseDetail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(detail)
                .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
            Divider()
            if detail.columns.isEmpty && !canManage {
                ContentUnavailableView("Brak kolumn", systemImage: "tablecells", description: Text("Ta baza nie ma jeszcze kolumn."))
            } else {
                grid(detail)
            }
            Divider()
            footer(detail).padding(.horizontal, 16).padding(.vertical, 10)
        }
    }

    // MARK: Nagłówek i akcje

    private func header(_ detail: CustomDatabaseDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button { store.openedID = nil } label: { Image(systemName: "chevron.left") }.help("Powrót do listy baz")
                if renaming {
                    TextField("Nazwa bazy", text: $nameDraft).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
                        .onSubmit { rename() }.onExitCommand { renaming = false }
                    Button { rename() } label: { Image(systemName: "checkmark") }.help("Zapisz")
                        .disabled(nameDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button { renaming = false } label: { Image(systemName: "xmark") }.help("Anuluj")
                } else {
                    Text(detail.database.name).font(.title2.weight(.light)).lineLimit(1)
                }
                Spacer()
                if canManage && !renaming {
                    Button("Zmień nazwę", systemImage: "pencil") { nameDraft = detail.database.name; renaming = true }
                }
                Button("Eksportuj CSV", systemImage: "doc.text") { exportCSV(detail) }
                Button("Pobierz PDF", systemImage: "arrow.down.doc") { exportPDF(detail) }.buttonStyle(.borderedProminent)
                Button("Drukuj", systemImage: "printer") { printSheet(detail) }
                Button("Pełny ekran", systemImage: "arrow.up.left.and.arrow.down.right") { NSApp.keyWindow?.toggleFullScreen(nil) }
                    .help("Przełącz pełny ekran okna (⌃⌘F)")
                if isAdmin {
                    Button("Usuń bazę", systemImage: "trash", role: .destructive) { removingDatabase = true }
                }
            }
            if !detail.database.description.isEmpty {
                Text(detail.database.description).foregroundStyle(.secondary).padding(.leading, 34)
            }
        }
    }

    private func footer(_ detail: CustomDatabaseDetail) -> some View {
        HStack(spacing: 12) {
            if canManage {
                Button {
                    commit()
                    Task { await store.run("Dodawanie rekordu…", "recordAdd", ["databaseId": .string(databaseID)], reload: databaseID) }
                } label: { Label("Dodaj rekord", systemImage: "plus") }
                    .disabled(detail.columns.isEmpty)
            }
            if detail.columns.isEmpty {
                Text("Brak kolumn. Dodaj pierwszą kolumnę aby rozpocząć.").foregroundStyle(.secondary)
            } else if detail.records.isEmpty {
                Text("Brak rekordów. Dodaj pierwszy rekord aby rozpocząć.").foregroundStyle(.secondary)
            }
            Spacer()
            Text("Rekordów: \(detail.records.count) · Kolumn: \(detail.columns.count)").font(.callout).foregroundStyle(.secondary)
        }
    }

    // MARK: Tabela

    private func grid(_ detail: CustomDatabaseDetail) -> some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(Array(detail.records.enumerated()), id: \.element.id) { index, record in
                        row(record, index: index, columns: detail.columns)
                    }
                } header: {
                    headerRow(detail.columns)
                }
            }
            .padding(.bottom, 12)
        }
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear { availableWidth = proxy.size.width }
                    .onChange(of: proxy.size.width) { _, value in availableWidth = value }
            }
        }
    }

    private func headerRow(_ columns: [CustomDatabaseColumn]) -> some View {
        HStack(spacing: 0) {
            Text("#").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: indexWidth, height: 36)
            ForEach(columns) { column in headerCell(column, columns: columns) }
            if canManage {
                addColumnCell
                Text("Akcje").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: actionsWidth, height: 36)
            }
        }
        .background(theme.card)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 1) }
    }

    private func headerCell(_ column: CustomDatabaseColumn, columns: [CustomDatabaseColumn]) -> some View {
        HStack(spacing: 4) {
            if editingColumn == column.id {
                TextField("Nazwa kolumny", text: $columnDraft).textFieldStyle(.roundedBorder)
                    .onSubmit { renameColumn(column) }.onExitCommand { editingColumn = nil }
                Button { renameColumn(column) } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless)
                Button { editingColumn = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            } else {
                if canManage {
                    Image(systemName: "line.3.horizontal").font(.caption).foregroundStyle(.secondary)
                        .help("Przeciągnij, aby zmienić kolejność")
                        .draggable(column.id) { Text(column.name).padding(6).background(theme.card) }
                }
                Text(column.name).font(.callout.weight(.semibold)).lineLimit(1)
                Text("(\(column.kind.label))").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if canManage {
                    Menu {
                        Button("Zmień nazwę", systemImage: "pencil") { columnDraft = column.name; editingColumn = column.id }
                        if let index = columns.firstIndex(of: column) {
                            Button("Przesuń w lewo", systemImage: "arrow.left") { move(column, to: index - 1, columns: columns) }.disabled(index == 0)
                            Button("Przesuń w prawo", systemImage: "arrow.right") { move(column, to: index + 1, columns: columns) }.disabled(index == columns.count - 1)
                        }
                        Divider()
                        Button("Usuń kolumnę", systemImage: "trash", role: .destructive) { removingColumn = column }
                    } label: { Image(systemName: "ellipsis") }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                }
            }
        }
        .padding(.horizontal, 8)
        .frame(width: width(column), height: 36)
        .overlay(alignment: .trailing) {
            ZStack(alignment: .trailing) {
                Rectangle().fill(Color.primary.opacity(0.12)).frame(width: 1)
                if canManage {
                    Color.clear.frame(width: 8).contentShape(Rectangle())
                        .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
                        .gesture(DragGesture(minimumDistance: 1)
                            .onChanged { value in resize(column, by: value.translation.width) }
                            .onEnded { _ in
                                resizeStart[column.id] = nil
                                resizeScale[column.id] = nil
                                let final = widths[column.id] ?? column.width
                                Task { await store.setWidth(databaseID, column: column.id, width: final) }
                            })
                }
            }
        }
        .dropDestination(for: String.self) { items, _ in
            guard canManage, let dragged = items.first, dragged != column.id,
                  let target = columns.firstIndex(of: column), let source = columns.first(where: { $0.id == dragged }) else { return false }
            move(source, to: target, columns: columns)
            return true
        }
    }

    /// Przeciąganie krawędzi nagłówka: ruch kursora przeliczony skalą z początku przeciągania (najmniej 100 pkt zapisu).
    private func resize(_ column: CustomDatabaseColumn, by translation: CGFloat) {
        let start: Double = resizeStart[column.id] ?? storedWidth(column)
        let factor: CGFloat = resizeScale[column.id] ?? scale
        resizeStart[column.id] = start
        resizeScale[column.id] = factor
        widths[column.id] = max(100, start + Double(translation / max(factor, 0.01)))
    }

    private var addColumnCell: some View {
        Button { addingColumn = true } label: { Label("Kolumna", systemImage: "plus") }
            .buttonStyle(.borderless)
            .frame(width: addColumnWidth, height: 36)
            .popover(isPresented: $addingColumn, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Nowa kolumna").font(.headline)
                    TextField("Nazwa kolumny", text: $newColumnName).textFieldStyle(.roundedBorder).onSubmit { addColumn() }
                    Picker("Typ", selection: $newColumnType) {
                        ForEach(CustomDatabaseType.allCases) { Text($0.label).tag($0) }
                    }
                    HStack {
                        Spacer()
                        Button("Anuluj") { addingColumn = false; newColumnName = ""; newColumnType = .text }
                        Button("Dodaj") { addColumn() }.buttonStyle(.borderedProminent)
                            .disabled(newColumnName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .padding(16)
                .frame(width: 300)
            }
    }

    private func row(_ record: CustomDatabaseRecord, index: Int, columns: [CustomDatabaseColumn]) -> some View {
        HStack(spacing: 0) {
            Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: indexWidth)
            ForEach(columns) { column in
                cell(record, column)
                    .frame(width: width(column), height: 32, alignment: .leading)
                    .overlay(alignment: .trailing) { Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1) }
            }
            if canManage {
                Color.clear.frame(width: addColumnWidth, height: 32)
                Button { commit(); removingRecord = record } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń rekord")
                    .frame(width: actionsWidth)
            }
        }
        .background(index % 2 == 1 ? Color.primary.opacity(0.025) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1) }
    }

    @ViewBuilder private func cell(_ record: CustomDatabaseRecord, _ column: CustomDatabaseColumn) -> some View {
        let value = record.value(column)
        if column.kind == .boolean && canManage {
            Toggle("", isOn: Binding(get: { CustomDatabaseValue.flag(value) }, set: { flag in
                commit()
                Task { await store.setCell(databaseID, record: record.id, column: column.id, value: .bool(flag)) }
            }))
            .toggleStyle(.checkbox).labelsHidden().padding(.horizontal, 8)
        } else if editing == CellRef(record: record.id, column: column.id) {
            editor(column, ref: CellRef(record: record.id, column: column.id)).padding(.horizontal, 4)
        } else {
            Text(CustomDatabaseValue.display(value, column))
                .lineLimit(1).truncationMode(.tail)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .help(CustomDatabaseValue.display(value, column))
                .onTapGesture { if canManage { startEditing(record, column) } }
        }
    }

    @ViewBuilder private func editor(_ column: CustomDatabaseColumn, ref: CellRef) -> some View {
        if column.kind == .date {
            HStack(spacing: 4) {
                DatePicker("", selection: Binding(get: { draftDate ?? DayDates.today }, set: { draftDate = $0 }), displayedComponents: .date)
                    .labelsHidden().datePickerStyle(.field)
                Button { commit() } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless).help("Zapisz")
                Button { draftDate = nil; commit() } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Wyczyść")
            }
            .onExitCommand { editing = nil }
        } else {
            TextField("", text: $draft)
                .textFieldStyle(.roundedBorder)
                .focused($focusedCell, equals: ref)
                .onSubmit { commit() }
                .onExitCommand { editing = nil }
                .onAppear { DispatchQueue.main.async { focusedCell = ref } }
                // Kliknięcie w inne pole zapisuje komórkę (jak `onBlur` w CRM); przejście do innej komórki zapisuje w `startEditing`.
                .onChange(of: focusedCell) { old, new in if old == ref, new != ref, editing == ref { commit() } }
        }
    }

    // MARK: Edycja

    private func startEditing(_ record: CustomDatabaseRecord, _ column: CustomDatabaseColumn) {
        let ref = CellRef(record: record.id, column: column.id)
        guard editing != ref else { return }
        commit()
        let raw = CustomDatabaseValue.raw(record.value(column))
        draft = raw
        draftDate = column.kind == .date ? DayDates.parse(raw) : nil
        editing = ref
    }

    /// Zapis edytowanej komórki (Enter, kliknięcie poza nią, przejście do innej); bez zmiany — nic nie wysyła.
    private func commit() {
        guard let ref = editing, let detail else { return }
        editing = nil
        guard let column = detail.columns.first(where: { $0.id == ref.column }),
              let record = detail.records.first(where: { $0.id == ref.record }) else { return }
        let value: JSONValue
        switch column.kind {
        case .date:
            value = .string(draftDate.map { DayDates.string($0) } ?? "")
        case .number:
            let text = draft.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")
            guard text.isEmpty || Double(text) != nil else {
                state.error = "Wpisz liczbę w kolumnie „\(column.name)”."
                return
            }
            value = .string(text)
        default:
            value = .string(draft)
        }
        if CustomDatabaseValue.raw(record.value(column)) == CustomDatabaseValue.raw(value) { return }
        Task { await store.setCell(databaseID, record: record.id, column: column.id, value: value) }
    }

    private func rename() {
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { state.error = "Wprowadź nazwę bazy danych"; return }
        Task {
            if await store.run("Zapisywanie nazwy…", "rename", ["id": .string(databaseID), "name": .string(name)], reload: databaseID) != nil {
                renaming = false
            }
        }
    }

    private func renameColumn(_ column: CustomDatabaseColumn) {
        let name = columnDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { state.error = "Wprowadź nazwę kolumny"; return }
        Task {
            if await store.run("Zapisywanie kolumny…", "columnUpdate", ["id": .string(column.id), "name": .string(name)], reload: databaseID) != nil {
                editingColumn = nil
            }
        }
    }

    private func addColumn() {
        let name = newColumnName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { state.error = "Wprowadź nazwę kolumny"; return }
        let type = newColumnType
        Task {
            if await store.run("Dodawanie kolumny…", "columnAdd", ["databaseId": .string(databaseID), "name": .string(name), "type": .string(type.rawValue)], reload: databaseID) != nil {
                addingColumn = false; newColumnName = ""; newColumnType = .text
            }
        }
    }

    private func move(_ column: CustomDatabaseColumn, to target: Int, columns: [CustomDatabaseColumn]) {
        guard let source = columns.firstIndex(of: column), target >= 0, target < columns.count, source != target else { return }
        var order = columns
        order.remove(at: source)
        order.insert(column, at: target)
        Task { await store.run("Zmiana kolejności…", "columnsReorder", ["databaseId": .string(databaseID), "ids": .array(order.map { .string($0.id) })], reload: databaseID) }
    }

    // MARK: Eksport

    private func safeName(_ detail: CustomDatabaseDetail) -> String {
        let cleaned = detail.database.name.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: #"[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_-]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return cleaned.isEmpty ? "baza-danych" : cleaned
    }

    private func exportCSV(_ detail: CustomDatabaseDetail) {
        guard !detail.columns.isEmpty else { state.error = "Brak kolumn do eksportu"; return }
        let quote = { (value: String) in "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        var lines = [detail.columns.map { quote($0.name) }.joined(separator: ",")]
        for record in detail.records {
            lines.append(detail.columns.map { quote(CustomDatabaseValue.export(record.value($0), $0)) }.joined(separator: ","))
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(detail.database.name.isEmpty ? "database" : detail.database.name).csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            try Data(("\u{FEFF}" + lines.joined(separator: "\n")).utf8).write(to: target, options: .atomic)
            state.succeed("Eksportowano do CSV")
        } catch { state.error = "Nie udało się zapisać pliku CSV." }
    }

    private func printableHTML(_ detail: CustomDatabaseDetail) -> String {
        func escape(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        let head = detail.columns.map { "<th>\(escape($0.name))</th>" }.joined()
        let rows = detail.records.enumerated().map { index, record in
            "<tr><td>\(index + 1)</td>" + detail.columns.map { "<td>\(escape(CustomDatabaseValue.export(record.value($0), $0)))</td>" }.joined() + "</tr>"
        }.joined()
        let description = detail.database.description.isEmpty ? "" : "<p class=\"d\">\(escape(detail.database.description))</p>"
        return """
        <html><head><meta charset="utf-8"><style>
        body { font-family: Helvetica, Arial, sans-serif; color: #222; font-size: 10pt; }
        h1 { font-size: 18pt; margin: 0 0 4pt 0; } .d { color: #555; margin: 0 0 10pt 0; }
        table { border-collapse: collapse; width: 100%; }
        th { border: 1px solid #bbb; padding: 4pt; text-align: left; background: #eee; }
        td { border: 1px solid #ccc; padding: 4pt; }
        </style></head><body>
        <h1>\(escape(detail.database.name.isEmpty ? "Baza danych" : detail.database.name))</h1>\(description)
        <table><thead><tr><th>#</th>\(head)</tr></thead><tbody>\(rows)</tbody></table>
        </body></html>
        """
    }

    /// Wydruk tabeli (poziomo przy więcej niż 5 kolumnach — jak w CRM); `saveTo` — zapis do PDF bez okna drukowania.
    private func operation(_ detail: CustomDatabaseDetail, saveTo url: URL?) -> NSPrintOperation? {
        guard let data = printableHTML(detail).data(using: .utf8),
              let text = NSAttributedString(html: data, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else { return nil }
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.orientation = detail.columns.count > 5 ? .landscape : .portrait
        info.topMargin = 28; info.bottomMargin = 28; info.leftMargin = 28; info.rightMargin = 28
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isVerticallyCentered = false
        if let url {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL.rawValue] = url
        }
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 200))
        view.isVerticallyResizable = true
        view.textContainer?.widthTracksTextView = true
        view.textStorage?.setAttributedString(text)
        if let container = view.textContainer, let layout = view.layoutManager {
            layout.ensureLayout(for: container)
            view.setFrameSize(NSSize(width: width, height: max(200, layout.usedRect(for: container).height + 20)))
        }
        let operation = NSPrintOperation(view: view, printInfo: info)
        operation.jobTitle = detail.database.name
        operation.showsPrintPanel = url == nil
        operation.showsProgressPanel = url == nil
        return operation
    }

    private func exportPDF(_ detail: CustomDatabaseDetail) {
        guard !detail.columns.isEmpty else { state.error = "Brak kolumn do pobrania"; return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(safeName(detail)).pdf"
        panel.allowedContentTypes = [.pdf]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let target = panel.url else { return }
        guard let operation = operation(detail, saveTo: target) else { state.error = "Nie udało się pobrać pliku PDF"; return }
        if operation.run() { state.succeed("Pobrano plik PDF") } else { state.error = "Nie udało się pobrać pliku PDF" }
    }

    private func printSheet(_ detail: CustomDatabaseDetail) {
        guard let operation = operation(detail, saveTo: nil) else { state.error = "Nie udało się przygotować wydruku."; return }
        operation.run()
    }
}
