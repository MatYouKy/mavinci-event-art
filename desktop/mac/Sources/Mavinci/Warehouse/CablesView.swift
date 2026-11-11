import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Przewody — 1:1 z `/crm/equipment/cables` (`CablesPageClient`), kartą `cables/[id]`, formularzem `cables/new`
// i kategoriami `cables/categories`: lista Lista / Kafelki / Tabela z wyszukiwaniem i filtrem przeznaczenia, niski stan,
// edycja (zmiana stanu przez `adjust_cable_stock` z wpisem w historii), historia stanu, usuwanie. Z kopii na dysku (`warehouse-cables`).

/// Formularz przewodu (liczby jako tekst — z przecinkiem lub kropką).
struct CableDraft: Equatable {
    var name = ""
    var lengthMeters = ""
    var connectorIn = ""
    var connectorOut = ""
    var cableCategoryId = ""
    var categoryId = ""
    var locationId = ""
    var stockQuantity = "0"
    var stockUnit = "piece"
    var trackingMode = "quantity"
    var minimumStock = "0"
    var directional = false
    var description = ""
    var thumbnailUrl = ""
    var purchaseDate: Date? = nil
    var purchasePrice = ""
    var currentValue = ""
    var notes = ""

    init() {}
    init(_ c: WarehouseCable) {
        let n = WarehouseLabels.number
        name = c.name; lengthMeters = n(c.lengthMeters); connectorIn = c.connectorIn ?? ""; connectorOut = c.connectorOut ?? ""
        cableCategoryId = c.cableCategoryId ?? ""; categoryId = c.categoryId ?? ""; locationId = c.locationId ?? ""
        stockQuantity = "\(c.stockQuantity)"; stockUnit = c.stockUnit; trackingMode = c.trackingMode; minimumStock = "\(c.minimumStock)"
        directional = c.directional; description = c.description; thumbnailUrl = c.thumbnailUrl ?? ""
        purchaseDate = DayDates.parse(c.purchaseDate); purchasePrice = n(c.purchasePrice); currentValue = n(c.currentValue); notes = c.notes
    }
    var unitLabel: String { stockUnit == "meter" ? "m" : "szt." }
    var json: [String: JSONValue] {
        let num = EquipmentDraft.number
        return [
            "name": .string(name), "lengthMeters": num(lengthMeters), "connectorIn": .string(connectorIn), "connectorOut": .string(connectorOut),
            "cableCategoryId": .string(cableCategoryId), "categoryId": .string(categoryId), "locationId": .string(locationId),
            "stockQuantity": num(stockQuantity), "stockUnit": .string(stockUnit), "trackingMode": .string(trackingMode),
            "minimumStock": num(minimumStock), "directional": .bool(directional), "description": .string(description),
            "thumbnailUrl": .string(thumbnailUrl), "purchaseDate": purchaseDate.map { JSONValue.string(DayDates.string($0)) } ?? JSONValue.null,
            "purchasePrice": num(purchasePrice), "currentValue": num(currentValue), "notes": .string(notes),
        ]
    }
}

extension WarehouseStore {
    /// Przeznaczenia do wyboru: tylko kategorie bez podkategorii, aktywne, z nazwą grupy („Audio / XLR”).
    var selectableCableCategories: [CableCategory] {
        cableCategories.filter { category in category.active && !cableCategories.contains { $0.parentId == category.id } }
    }
    func cableCategoryLabel(_ category: CableCategory) -> String {
        if let parent = cableCategory(category.parentId) { return "\(parent.name) / \(category.name)" }
        return category.name
    }
    var activeConnectors: [ConnectorOption] { connectors.filter { $0.active != false } }
}

@MainActor struct CablesView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("warehouse.cables.mode") private var mode: WarehouseViewMode = .list
    @State private var search = ""
    @State private var categoryFilter = "all"
    @State private var selectedID: String?
    @State private var adding = false
    @State private var removing: WarehouseCable?

    private var visible: [WarehouseCable] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.cables.filter { cable in
            guard cable.active else { return false }
            let names = [cable.name, store.connector(cable.connectorIn)?.name ?? "", store.connector(cable.connectorOut)?.name ?? "", store.cableCategory(cable.cableCategoryId)?.name ?? ""]
            let matches = q.isEmpty || names.contains { $0.lowercased().contains(q) }
            return matches && (categoryFilter == "all" || cable.cableCategoryId == categoryFilter)
        }
    }
    /// Przeznaczenia występujące na liście (jak `cableCategories` w CRM).
    private var usedCategories: [CableCategory] {
        let ids = Set(store.cables.compactMap(\.cableCategoryId))
        return store.cableCategories.filter { ids.contains($0.id) }
    }

    var body: some View {
        Group {
            if store.cableCategoriesShown {
                CableCategoriesView(store: store)
            } else if let id = store.openedCableID {
                if let cable = store.cable(id) {
                    CableCardView(store: store, cable: cable).id(id)
                } else if store.syncing || !store.loaded {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ContentUnavailableView {
                        Label("Nie znaleziono kabla", systemImage: "cable.connector")
                    } actions: { Button("Wróć do listy") { store.openedCableID = nil } }
                }
            } else {
                list
            }
        }
        .sheet(isPresented: $adding) { NewCableSheet(store: store).warehouseSheetStyle(state) }
        .confirmationDialog("Usuń przewód", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let cable = removing { Task { await store.run("Usuwanie…", "cableDelete", ["id": .string(cable.id)], success: "Przewód usunięty") } }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć przewód \"\(removing?.name ?? "")\"?") }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("Przeznaczenie", selection: $categoryFilter) {
                    Text("Wszystkie przeznaczenia").tag("all")
                    ForEach(usedCategories) { Text($0.name).tag($0.id) }
                }
                .labelsHidden().fixedSize()
                Text("\(visible.count) przewodów").font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja magazynu") }
                Picker("Widok przewodów", selection: $mode) { ForEach(WarehouseViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 9)
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Przewody")
        .navigationSubtitle("Magazyn")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj przewodów...")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.openHref("/crm/equipment") } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do magazynu")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage {
                    Button { store.cableCategoriesShown = true } label: { Label("Kategorie", systemImage: "folder") }.help("Kategorie przewodów")
                }
                if store.access?.canCreate == true {
                    Button { adding = true } label: { Label("Dodaj przewód", systemImage: "plus") }.help("Dodaj przewód")
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if store.cables.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Przewody", systemImage: "cable.connector")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.sync(force: true) } } }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView {
                Label("Brak przewodów", systemImage: "cable.connector")
            } actions: {
                if store.access?.canCreate == true && search.isEmpty { Button("Dodaj pierwszy przewód", systemImage: "plus") { adding = true } }
            }
        } else {
            switch mode {
            case .grid:
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 380), spacing: 12)], spacing: 12) {
                        ForEach(visible) { cable in tile(cable, large: true) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .list:
                ScrollView {
                    LazyVStack(spacing: 6) { ForEach(visible) { cable in tile(cable, large: false) } }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .table:
                table
            }
        }
    }

    @ViewBuilder private func menu(_ cable: WarehouseCable) -> some View {
        Button("Otwórz", systemImage: "eye") { store.openedCableID = cable.id }
        if store.canManage {
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { removing = cable }
        }
    }

    private func categoryBadge(_ cable: WarehouseCable) -> some View {
        Group {
            if let category = store.cableCategory(cable.cableCategoryId) {
                WarehouseBadge(text: category.name, color: CrmTheme.hex(category.color) ?? theme.accent)
            }
        }
    }

    private func tile(_ cable: WarehouseCable, large: Bool) -> some View {
        let layout = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        return layout {
            WarehouseThumb(url: cable.thumbnailUrl, size: large ? 140 : 56, symbol: "cable.connector").frame(maxWidth: large ? .infinity : nil)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(cable.name).fontWeight(.medium).lineLimit(2)
                    categoryBadge(cable)
                }
                HStack(spacing: 10) {
                    if let length = cable.lengthMeters { Text("Długość: \(WarehouseLabels.number(length))m") }
                    if let input = store.connector(cable.connectorIn) { Text("Wejście: \(input.name)") }
                    if let output = store.connector(cable.connectorOut) { Text("Wyjście: \(output.name)") }
                }
                .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text("Stan: \(cable.stockQuantity) \(cable.unitLabel)").font(.callout.weight(.medium).monospacedDigit()).foregroundStyle(theme.accent)
                    if cable.lowStock { WarehouseBadge(text: "Niski stan", color: CrmTheme.rgb(0xfbbf24)) }
                }
                let extra = [store.category(cable.categoryId).map { "Kategoria: \($0.name)" } ?? "", store.location(cable.locationId).map { "Lokalizacja: \($0.name)" } ?? ""].filter { !$0.isEmpty }
                if !extra.isEmpty { Text(extra.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
            }
            if !large { Spacer(minLength: 0) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            if store.canManage {
                Menu { menu(cable) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(8)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { store.openedCableID = cable.id }
        .contextMenu { menu(cable) }
    }

    private var table: some View {
        Table(visible, selection: $selectedID) {
            TableColumn("Przewód") { (c: WarehouseCable) in
                HStack(spacing: 8) {
                    WarehouseThumb(url: c.thumbnailUrl, size: 30, symbol: "cable.connector")
                    VStack(alignment: .leading, spacing: 0) {
                        Text(c.name).fontWeight(.medium).lineLimit(1)
                        if let category = store.category(c.categoryId) { Text(category.name).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }.width(min: 180, ideal: 260)
            TableColumn("Przeznaczenie") { (c: WarehouseCable) in Text(store.cableCategory(c.cableCategoryId)?.name ?? "—") }.width(min: 90, ideal: 140)
            TableColumn("Długość") { (c: WarehouseCable) in Text(c.lengthMeters.map { "\(WarehouseLabels.number($0)) m" } ?? "—").monospacedDigit() }.width(min: 60, ideal: 70)
            TableColumn("Wejście") { (c: WarehouseCable) in Text(store.connector(c.connectorIn)?.name ?? "—") }.width(min: 70, ideal: 110)
            TableColumn("Wyjście") { (c: WarehouseCable) in Text(store.connector(c.connectorOut)?.name ?? "—") }.width(min: 70, ideal: 110)
            TableColumn("Stan") { (c: WarehouseCable) in
                HStack(spacing: 4) {
                    Text("\(c.stockQuantity) \(c.unitLabel)").monospacedDigit()
                    if c.lowStock { Text("Niski stan").font(.caption2).foregroundStyle(CrmTheme.rgb(0xfbbf24)) }
                }
            }.width(min: 70, ideal: 110)
            TableColumn("Lokalizacja") { (c: WarehouseCable) in Text(store.location(c.locationId)?.name ?? "—").foregroundStyle(.secondary) }.width(min: 80, ideal: 120)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let cable = store.cable(id) { menu(cable) }
        } primaryAction: { ids in
            if let id = ids.first { store.openedCableID = id }
        }
    }
}

// MARK: Karta przewodu

@MainActor struct CableCardView: View {
    @ObservedObject var store: WarehouseStore
    let cable: WarehouseCable
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing = false
    @State private var draft = CableDraft()
    @State private var saving = false
    @State private var importing = false
    @State private var removing = false

    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if editing { CableFormFields(store: store, draft: $draft, importing: $importing, creating: false) } else { readOnly }
                movements
            }
            .padding(16)
        }
        .navigationTitle(cable.name)
        .navigationSubtitle("Przewód")
        .overlay { if saving { PendingOverlay(text: "Zapisywanie…") } }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { store.openedCableID = nil } label: { Label("Przewody", systemImage: "chevron.left") }.help("Wróć do listy przewodów")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage {
                    if editing {
                        Button("Anuluj") { editing = false }.disabled(saving)
                        Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz", systemImage: "checkmark") }
                            .buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving)
                    } else {
                        Button { draft = CableDraft(cable); editing = true } label: { Label("Edytuj", systemImage: "pencil") }.keyboardShortcut("e")
                        Menu {
                            Button("Usuń przewód", systemImage: "trash", role: .destructive) { removing = true }
                            Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/equipment/cables/\(cable.id)") }
                        } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                    }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await uploadThumb(url) } }
        }
        .confirmationDialog("Usuń przewód", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                Task {
                    let reply = await store.run("Usuwanie…", "cableDelete", ["id": .string(cable.id)], success: "Przewód usunięty")
                    if reply != nil { store.openedCableID = nil }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć przewód \"\(cable.name)\"?") }
        .task { await store.sync() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            WarehouseThumb(url: editing ? draft.thumbnailUrl.nonEmpty : cable.thumbnailUrl, size: 72, symbol: "cable.connector")
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    Text(cable.name).font(.title2.weight(.light))
                    Text("\(cable.stockQuantity) \(cable.unitLabel)").font(.title3).foregroundStyle(theme.accent).monospacedDigit()
                }
                if let length = cable.lengthMeters { Text("Długość: \(WarehouseLabels.number(length))m").font(.callout).foregroundStyle(.secondary) }
                HStack(spacing: 6) {
                    if let category = store.cableCategory(cable.cableCategoryId) { WarehouseBadge(text: category.name, color: CrmTheme.hex(category.color) ?? theme.accent) }
                    if cable.lowStock { WarehouseBadge(text: "Niski stan magazynowy", color: CrmTheme.rgb(0xfbbf24)) }
                    if cable.directional { WarehouseBadge(text: "Kierunkowy", color: CrmTheme.rgb(0x60a5fa)) }
                }
            }
            Spacer()
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "-" : value).textSelection(.enabled)
        }
    }
    private func connectorRow(_ label: String, _ id: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if let connector = store.connector(id) {
                    WarehouseThumb(url: connector.thumbnailUrl, size: 32, symbol: "powerplug")
                    Text(connector.name)
                } else { Text("-") }
            }
        }
    }

    private var readOnly: some View {
        VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Podstawowe informacje") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    row("Przeznaczenie techniczne", store.cableCategory(cable.cableCategoryId).map { store.cableCategoryLabel($0) } ?? "Nie przypisano")
                    row("Sposób ewidencji", cable.trackingMode == "individual" ? "Pojedyncze sztuki / bębny" : "Ilościowo")
                    row("Nazwa", cable.name)
                    row("Długość (m)", WarehouseLabels.number(cable.lengthMeters))
                    connectorRow("Złącze IN", cable.connectorIn)
                    connectorRow("Złącze OUT", cable.connectorOut)
                    row("Ilość w magazynie", "\(cable.stockQuantity) \(cable.unitLabel)")
                    row("Jednostka", cable.stockUnit == "meter" ? "Metry" : "Sztuki")
                    row("Minimalny zapas", "\(cable.minimumStock) \(cable.unitLabel)")
                    row("Lokalizacja", store.location(cable.locationId)?.name ?? "")
                    row("Kategoria magazynowa", store.categoryPath(cable.categoryId))
                    row("Przewód kierunkowy", cable.directional ? "Tak — końcówki IN i OUT nie są zamienne" : "Nie")
                }
                row("Opis", cable.description)
            }
            TeamCard(title: "Informacje o zakupie") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    row("Data zakupu", DayDates.display(cable.purchaseDate))
                    row("Cena zakupu", cable.purchasePrice.map { "\(WarehouseLabels.number($0)) zł" } ?? "")
                    row("Wartość bieżąca", cable.currentValue.map { "\(WarehouseLabels.number($0)) zł" } ?? "")
                }
                row("Notatki", cable.notes)
            }
        }
    }

    private var movements: some View {
        TeamCard(title: "Historia stanu") {
            Text("Ostatnie przyjęcia, korekty i rozchody magazynowe tego przewodu.").font(.callout).foregroundStyle(.secondary)
            if cable.movements.isEmpty {
                Text("Brak zarejestrowanych zmian stanu.").foregroundStyle(.secondary)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                    GridRow {
                        Text("Data")
                        Text("Zmiana")
                        Text("Stan po zmianie")
                        Text("Powód")
                        Text("Osoba")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    ForEach(cable.movements) { m in
                        GridRow {
                            Text(m.at.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy HH:mm") } ?? "—").monospacedDigit()
                            Text("\(m.delta > 0 ? "+" : "")\(m.delta) \(cable.unitLabel)").monospacedDigit()
                                .foregroundStyle(m.delta > 0 ? CrmTheme.rgb(0x4ade80) : m.delta < 0 ? CrmTheme.rgb(0xf87171) : Color.primary)
                            Text("\(m.balance) \(cable.unitLabel)").monospacedDigit()
                            Text(m.reason.isEmpty ? "—" : m.reason).lineLimit(2)
                            Text(m.author.isEmpty ? "System" : m.author)
                        }
                        .font(.callout)
                    }
                }
            }
        }
    }

    private func uploadThumb(_ url: URL) async {
        guard let jpeg = ImageJPEG.from(url, maxSide: 1200) else { state.error = "Plik musi być obrazem"; return }
        await state.withPending("Przesyłanie zdjęcia...") {
            do {
                draft.thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-thumbnails")
                state.succeed("Zdjęcie zostało przesłane")
            } catch { state.error = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
        }
    }

    private func save() async {
        guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { state.error = "Podaj nazwę przewodu"; return }
        saving = true
        defer { saving = false }
        let reply = await store.run("Zapisywanie…", "cableUpdate", ["id": .string(cable.id), "data": .object(draft.json)], success: "Zapisano zmiany")
        if reply != nil { editing = false }
    }
}

/// Pola formularza przewodu — wspólne dla karty (edycja) i nowego przewodu.
@MainActor struct CableFormFields: View {
    @ObservedObject var store: WarehouseStore
    @Binding var draft: CableDraft
    @Binding var importing: Bool
    let creating: Bool

    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Podstawowe informacje") {
                HStack(spacing: 12) {
                    WarehouseThumb(url: draft.thumbnailUrl.nonEmpty, size: 64, symbol: "cable.connector")
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Miniatura przewodu").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Wybierz zdjęcie…", systemImage: "photo") { importing = true }
                            if !draft.thumbnailUrl.isEmpty { Button("Usuń", role: .destructive) { draft.thumbnailUrl = "" } }
                        }
                    }
                }
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    field("Nazwa *") { TextField("", text: $draft.name, prompt: Text("np. XLR 5m")).textFieldStyle(.roundedBorder) }
                    field("Długość (m)") { TextField("", text: $draft.lengthMeters).textFieldStyle(.roundedBorder) }
                    field(creating ? "Przeznaczenie techniczne *" : "Przeznaczenie techniczne") {
                        Picker("", selection: $draft.cableCategoryId) {
                            Text(creating ? "Wybierz kategorię..." : "Wybierz kategorię").tag("")
                            if let current = store.cableCategory(draft.cableCategoryId), !store.selectableCableCategories.contains(current) {
                                Text("\(current.name) (obecne przypisanie)").tag(current.id)
                            }
                            ForEach(store.selectableCableCategories) { Text(store.cableCategoryLabel($0)).tag($0.id) }
                        }
                        .labelsHidden()
                        if store.cableCategories.isEmpty {
                            Text("Brak słownika przeznaczeń technicznych. Uruchom migrację kategorii przewodów.").font(.caption).foregroundStyle(.orange)
                        }
                    }
                    field("Sposób ewidencji") {
                        Picker("", selection: $draft.trackingMode) {
                            Text(creating ? "Ilościowo — bez numerów seryjnych" : "Ilościowo").tag("quantity")
                            Text(creating ? "Pojedyncze sztuki — dla drogich przewodów i bębnów" : "Pojedyncze sztuki / bębny").tag("individual")
                        }
                        .labelsHidden()
                    }
                    connectorField("Złącze IN", $draft.connectorIn, placeholder: "Wybierz złącze wejściowe")
                    connectorField("Złącze OUT", $draft.connectorOut, placeholder: "Wybierz złącze wyjściowe")
                    field(creating ? "Stan początkowy (\(draft.unitLabel)) *" : "Ilość w magazynie (\(draft.unitLabel))") {
                        TextField("", text: $draft.stockQuantity).textFieldStyle(.roundedBorder)
                    }
                    field(creating ? "Jednostka magazynowa" : "Jednostka") {
                        Picker("", selection: $draft.stockUnit) {
                            Text(creating ? "Sztuki — gotowe przewody" : "Sztuki").tag("piece")
                            Text(creating ? "Metry — przewód z rolki" : "Metry z rolki").tag("meter")
                        }
                        .labelsHidden()
                    }
                    field("Minimalny zapas") { TextField("", text: $draft.minimumStock).textFieldStyle(.roundedBorder) }
                    field("Lokalizacja") {
                        Picker("", selection: $draft.locationId) {
                            Text(creating ? "Brak" : "Wybierz lokalizację").tag("")
                            ForEach(store.locations) { Text($0.name).tag($0.id) }
                        }
                        .labelsHidden()
                    }
                    if creating {
                        field("Kategoria magazynowa") {
                            Picker("", selection: $draft.categoryId) {
                                Text("Brak").tag("")
                                ForEach(store.categoryTree) { c in Text(String(repeating: "   ", count: max(0, c.level - 1)) + c.name).tag(c.id) }
                            }
                            .labelsHidden()
                        }
                    }
                }
                Toggle("Przewód kierunkowy — końcówki IN i OUT nie są zamienne", isOn: $draft.directional)
                field("Opis") { TextField("", text: $draft.description, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder) }
            }
            TeamCard(title: "Informacje o zakupie") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    field("Data zakupu") { OptionalDateField(title: "Ustaw datę", date: $draft.purchaseDate) }
                    field("Cena zakupu (zł)") { TextField("", text: $draft.purchasePrice).textFieldStyle(.roundedBorder) }
                    field(creating ? "Aktualna wartość (zł)" : "Wartość bieżąca") { TextField("", text: $draft.currentValue).textFieldStyle(.roundedBorder) }
                }
                field("Notatki") {
                    TextField("", text: $draft.notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
                }
            }
        }
    }

    private func connectorField(_ label: String, _ selection: Binding<String>, placeholder: String) -> some View {
        field(label) {
            HStack(spacing: 8) {
                if let connector = store.connector(selection.wrappedValue) { WarehouseThumb(url: connector.thumbnailUrl, size: 28, symbol: "powerplug") }
                Picker("", selection: selection) {
                    Text(placeholder).tag("")
                    ForEach(store.connectors.filter { $0.active != false || $0.id == selection.wrappedValue }) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
            }
        }
    }
}

@MainActor struct NewCableSheet: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var draft = CableDraft()
    @State private var importing = false
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj przewód").font(.title2.weight(.light))
            ScrollView { CableFormFields(store: store, draft: $draft, importing: $importing, creating: true) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Dodaj przewód") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(minWidth: 760, minHeight: 680)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await uploadThumb(url) } }
        }
    }

    private func uploadThumb(_ url: URL) async {
        guard let jpeg = ImageJPEG.from(url, maxSide: 1200) else { state.error = "Plik musi być obrazem"; return }
        await state.withPending("Przesyłanie zdjęcia...") {
            do { draft.thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-thumbnails"); state.succeed("Zdjęcie zostało przesłane") }
            catch { state.error = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
        }
    }

    private func save() async {
        guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { state.error = "Podaj nazwę przewodu"; return }
        guard !draft.connectorIn.isEmpty, !draft.connectorOut.isEmpty else { state.error = "Wybierz typ złącz"; return }
        if !store.cableCategories.isEmpty && draft.cableCategoryId.isEmpty { state.error = "Wybierz przeznaczenie techniczne"; return }
        saving = true
        defer { saving = false }
        if let reply = await store.run("Dodawanie przewodu…", "cableCreate", ["data": .object(draft.json)], success: "Przewód dodany"),
           let id = reply["id"]?.text.nonEmpty {
            dismiss()
            store.openedCableID = id
        }
    }
}

// MARK: Kategorie przewodów

struct CableCategoryDraft: Identifiable {
    var id: String
    var existing: Bool
    var parentId: String
    var name: String
    var description: String
    var color: Color
    var order: String
    var active: Bool
}

@MainActor struct CableCategoriesView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var draft: CableCategoryDraft?

    private func matches(_ c: CableCategory) -> Bool {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || "\(c.name) \(c.description)".lowercased().contains(q)
    }
    private var roots: [CableCategory] {
        store.cableCategories.filter { root in root.parentId == nil && (matches(root) || store.cableCategories.contains { $0.parentId == root.id && matches($0) }) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Przeznaczenie techniczne wybierane podczas dodawania i edycji przewodów. Nieaktywne kategorie pozostają przy istniejących przewodach, ale nie są dostępne do nowych przypisań.")
                    .font(.callout).foregroundStyle(.secondary)
                if !store.canManage {
                    Text("Zarządzanie kategoriami wymaga uprawnień do zarządzania sprzętem.").foregroundStyle(.secondary)
                } else if roots.isEmpty {
                    Text("Brak kategorii pasujących do wyszukiwania.").foregroundStyle(.secondary)
                } else {
                    ForEach(roots) { parent in
                        VStack(alignment: .leading, spacing: 0) {
                            row(parent)
                            ForEach(store.cableCategories.filter { $0.parentId == parent.id && (matches(parent) || matches($0)) }) { child in
                                row(child).padding(.leading, 28).background(Color.primary.opacity(0.03))
                            }
                        }
                        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle("Kategorie przewodów")
        .navigationSubtitle("Przewody")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj kategorii…")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { store.cableCategoriesShown = false } label: { Label("Przewody", systemImage: "chevron.left") }.help("Wróć do przewodów")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage { Button { open(nil, parentId: "") } label: { Label("Dodaj kategorię", systemImage: "plus") } }
            }
        }
        .sheet(item: $draft) { item in
            CableCategorySheet(store: store, draft: item).warehouseSheetStyle(state)
        }
    }

    private func row(_ category: CableCategory) -> some View {
        HStack(spacing: 10) {
            Circle().fill(CrmTheme.hex(category.color) ?? theme.accent).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(category.name)
                    if !category.active { WarehouseBadge(text: "Nieaktywna") }
                }
                if !category.description.isEmpty { Text(category.description).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Text("Kolejność: \(category.order)").font(.caption).foregroundStyle(.tertiary)
            if store.canManage {
                if category.parentId == nil && category.active {
                    Button("Dodaj podkategorię") { open(nil, parentId: category.id) }.buttonStyle(.borderless)
                }
                Button { open(category, parentId: category.parentId ?? "") } label: { Label("Edytuj", systemImage: "pencil") }.buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func open(_ category: CableCategory?, parentId: String) {
        if let category {
            draft = CableCategoryDraft(id: category.id, existing: true, parentId: category.parentId ?? "", name: category.name, description: category.description,
                                       color: CrmTheme.hex(category.color) ?? theme.accent, order: "\(category.order)", active: category.active)
        } else {
            let siblings = store.cableCategories.filter { ($0.parentId ?? "") == parentId }
            let color = store.cableCategory(parentId).flatMap { CrmTheme.hex($0.color) } ?? CrmTheme.rgb(0xd3bb73)
            draft = CableCategoryDraft(id: UUID().uuidString.lowercased(), existing: false, parentId: parentId, name: "", description: "",
                                       color: color, order: "\(max(0, siblings.map(\.order).max() ?? 0) + 10)", active: true)
        }
    }
}

@MainActor struct CableCategorySheet: View {
    @ObservedObject var store: WarehouseStore
    @State var draft: CableCategoryDraft
    @Environment(\.dismiss) private var dismiss
    @State private var problem: String?
    @State private var saving = false

    private var hasChildren: Bool { store.cableCategories.contains { $0.parentId == draft.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(draft.existing ? "Edytuj kategorię przewodów" : "Dodaj kategorię przewodów").font(.title2.weight(.light))
            Form {
                TextField("Nazwa", text: $draft.name)
                Picker("Grupa nadrzędna", selection: $draft.parentId) {
                    Text("Brak — kategoria główna").tag("")
                    ForEach(store.cableCategories.filter { $0.parentId == nil && $0.id != draft.id && ($0.active || $0.id == draft.parentId) }) { row in
                        Text(row.name + (row.active ? "" : " (nieaktywna)")).tag(row.id)
                    }
                }
                .disabled(hasChildren)
                TextField("Opis", text: $draft.description, axis: .vertical).lineLimit(3...5)
                ColorPicker("Kolor", selection: $draft.color, supportsOpacity: false)
                TextField("Kolejność", text: $draft.order)
                Toggle("Aktywna — dostępna przy przypisywaniu przewodów", isOn: $draft.active)
            }
            .formStyle(.grouped)
            if let problem { Text(problem).font(.callout).foregroundStyle(.orange) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let data: [String: JSONValue] = [
            "id": .string(draft.id), "existing": .bool(draft.existing), "parentId": .string(draft.parentId), "name": .string(draft.name),
            "description": .string(draft.description), "color": .string(CrmTheme.hexString(draft.color)), "order": EquipmentDraft.number(draft.order),
            "active": .bool(draft.active),
        ]
        do {
            try await store.post("cableCategorySave", ["data": .object(data)])
            store.workspace?.succeed(draft.existing ? "Zapisano kategorię przewodów." : "Dodano kategorię przewodów.")
            Task { await store.sync(force: true) }
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać kategorii.")
        }
    }
}
