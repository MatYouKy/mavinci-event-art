import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Zestawy — 1:1 z `/crm/equipment/kits` (`KitsPageClient`): lista Kafelki / Lista / Tabela z wyszukiwaniem, podgląd zestawu
// (pozycje z dostępnością, checklista do druku), tworzenie i edycja (miniatura, kategoria główna, liczba kompletów z kontrolą stanów,
// pozycje: sprzęt i przewody z ilością i notatką), usuwanie. Wszystko z kopii na dysku (zbiór `warehouse-kits`).

struct KitEditorRequest: Identifiable {
    let id = UUID()
    let kit: WarehouseKit?
}

@MainActor struct KitsView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("warehouse.kits.mode") private var mode: WarehouseViewMode = .grid
    @State private var search = ""
    @State private var selectedID: String?
    @State private var editor: KitEditorRequest?
    @State private var removing: WarehouseKit?

    private var visible: [WarehouseKit] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.kits.filter { $0.active && (q.isEmpty || $0.name.lowercased().contains(q)) }
    }

    var body: some View {
        Group {
            if let id = store.openedKitID {
                if let kit = store.kit(id) {
                    KitDetailView(store: store, kit: kit, edit: { editor = KitEditorRequest(kit: kit) }, remove: { removing = kit }).id(id)
                } else if store.syncing || !store.loaded {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ContentUnavailableView {
                        Label("Nie znaleziono zestawu", systemImage: "square.stack.3d.up")
                    } actions: { Button("Wróć do listy") { store.openedKitID = nil } }
                }
            } else {
                list
            }
        }
        .sheet(item: $editor) { request in
            KitEditorSheet(store: store, kit: request.kit).warehouseSheetStyle(state)
        }
        .confirmationDialog("Usuń zestaw", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let kit = removing { Task { _ = await store.deleteKit(kit) } } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć ten zestaw? Ta operacja jest nieodwracalna.") }
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
                Text("\(visible.count) zestawów").font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja magazynu") }
                Picker("Widok", selection: $mode) { ForEach(WarehouseViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 9)
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Zestawy sprzętowe")
        .navigationSubtitle("Magazyn")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj zestawów...")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.openHref("/crm/equipment") } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do magazynu")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage {
                    Button { editor = KitEditorRequest(kit: nil) } label: { Label("Dodaj zestaw", systemImage: "plus") }.help("Dodaj zestaw")
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if store.kits.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Zestawy", systemImage: "square.stack.3d.up")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView(search.isEmpty ? "Brak zestawów" : "Nie znaleziono zestawów", systemImage: "square.stack.3d.up")
        } else {
            switch mode {
            case .grid:
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220, maximum: 320), spacing: 12)], spacing: 12) {
                        ForEach(visible) { kit in card(kit) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .list:
                ScrollView {
                    LazyVStack(spacing: 6) { ForEach(visible) { kit in row(kit) } }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .table:
                table
            }
        }
    }

    @ViewBuilder private func menu(_ kit: WarehouseKit) -> some View {
        Button("Otwórz zestaw", systemImage: "eye") { store.openedKitID = kit.id }
        Button("Drukuj checklistę", systemImage: "printer") { KitChecklist.print(kit: kit, store: store, printer: printerName) }
        if store.canManage {
            Button("Edytuj", systemImage: "pencil") { editor = KitEditorRequest(kit: kit) }
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { removing = kit }
        }
    }
    private var printerName: String {
        [state.employee?.name ?? "", state.employee?.surname ?? ""].filter { !$0.isEmpty }.joined(separator: " ").nonEmpty ?? "Nieznany użytkownik"
    }

    private func card(_ kit: WarehouseKit) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WarehouseThumb(url: kit.thumbnailUrl, size: 120, symbol: "square.stack.3d.up").frame(maxWidth: .infinity)
            Text(kit.name).font(.callout.weight(.semibold)).lineLimit(2)
            if let category = store.category(kit.categoryId) { Text(category.name).font(.caption).foregroundStyle(.secondary) }
            if !kit.description.isEmpty { Text(kit.description).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            HStack(spacing: 6) {
                Image(systemName: "shippingbox").foregroundStyle(theme.accent)
                Text("\(kit.items.count) pozycji")
                if kit.quantity > 1 { Text("• \(kit.quantity) szt.").foregroundStyle(theme.accent) }
            }
            .font(.caption)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            Menu { menu(kit) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(8)
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { store.openedKitID = kit.id }
        .contextMenu { menu(kit) }
    }

    private func row(_ kit: WarehouseKit) -> some View {
        HStack(spacing: 12) {
            WarehouseThumb(url: kit.thumbnailUrl, size: 44, symbol: "square.stack.3d.up")
            VStack(alignment: .leading, spacing: 2) {
                Text(kit.name).fontWeight(.medium).lineLimit(1)
                Text([store.category(kit.categoryId)?.name ?? "", kit.description].filter { !$0.isEmpty }.joined(separator: " • "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Text("\(kit.items.count) pozycji").font(.caption).foregroundStyle(.secondary)
            if kit.quantity > 1 { Text("\(kit.quantity) szt.").font(.callout.monospacedDigit()).foregroundStyle(theme.accent) }
            Menu { menu(kit) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { store.openedKitID = kit.id }
        .contextMenu { menu(kit) }
    }

    private var table: some View {
        Table(visible, selection: $selectedID) {
            TableColumn("Zestaw") { (kit: WarehouseKit) in
                HStack(spacing: 8) {
                    WarehouseThumb(url: kit.thumbnailUrl, size: 30, symbol: "square.stack.3d.up")
                    Text(kit.name).fontWeight(.medium).lineLimit(1)
                }
            }.width(min: 180, ideal: 260)
            TableColumn("Kategoria") { (kit: WarehouseKit) in Text(store.category(kit.categoryId)?.name ?? "—").foregroundStyle(.secondary) }.width(min: 90, ideal: 150)
            TableColumn("Opis") { (kit: WarehouseKit) in Text(kit.description.isEmpty ? "—" : kit.description).foregroundStyle(.secondary).lineLimit(1) }.width(min: 120, ideal: 260)
            TableColumn("Pozycji") { (kit: WarehouseKit) in Text("\(kit.items.count)").monospacedDigit() }.width(min: 50, ideal: 60)
            TableColumn("Ilość") { (kit: WarehouseKit) in Text(kit.quantity > 1 ? "\(kit.quantity)" : "—").monospacedDigit() }.width(min: 40, ideal: 50)
            TableColumn("Utworzono") { (kit: WarehouseKit) in
                Text(kit.createdAt.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "—").foregroundStyle(.secondary)
            }.width(min: 80, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let kit = store.kit(id) { menu(kit) }
        } primaryAction: { ids in
            if let id = ids.first { store.openedKitID = id }
        }
    }
}

// MARK: Podgląd zestawu

@MainActor struct KitDetailView: View {
    @ObservedObject var store: WarehouseStore
    let kit: WarehouseKit
    let edit: () -> Void
    let remove: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    if kit.thumbnailUrl?.isEmpty == false { WarehouseThumb(url: kit.thumbnailUrl, size: 110, symbol: "square.stack.3d.up") }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(kit.name).font(.title2.weight(.light))
                        if let category = store.category(kit.categoryId) { Text(category.name).foregroundStyle(theme.accent) }
                        if !kit.description.isEmpty { Text(kit.description).foregroundStyle(.secondary).textSelection(.enabled) }
                        if kit.quantity > 1 {
                            Label("\(kit.quantity) identycznych zestawów", systemImage: "shippingbox").foregroundStyle(theme.accent)
                        }
                        if let created = kit.createdAt.flatMap(MeetingDates.parse) {
                            Text("Utworzono: \(MeetingDates.format(created, "dd.MM.yyyy"))").font(.caption).foregroundStyle(.secondary)
                        }
                        if !kit.active { WarehouseBadge(text: "NIEAKTYWNY") }
                    }
                    Spacer()
                }
                TeamCard(title: "Pozycje w zestawie (\(kit.items.count))") {
                    if kit.items.isEmpty {
                        Text("Brak pozycji").foregroundStyle(.secondary)
                    } else {
                        VStack(spacing: 6) {
                            ForEach(Array(kit.items.enumerated()), id: \.element.id) { index, item in itemRow(index, item) }
                        }
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle(kit.name)
        .navigationSubtitle("Zestaw")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { store.openedKitID = nil } label: { Label("Zestawy", systemImage: "chevron.left") }.help("Wróć do listy zestawów")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { KitChecklist.print(kit: kit, store: store, printer: printerName) } label: { Label("Drukuj checklistę", systemImage: "printer") }
                    .help("Drukuj checklistę")
                if store.canManage {
                    Button { edit() } label: { Label("Edytuj", systemImage: "pencil") }.keyboardShortcut("e")
                    Menu {
                        Button("Usuń zestaw", systemImage: "trash", role: .destructive) { remove() }
                        Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/equipment/kits?edit=\(kit.id)") }
                    } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                }
            }
        }
        .task { await store.sync() }
    }

    private var printerName: String {
        [state.employee?.name ?? "", state.employee?.surname ?? ""].filter { !$0.isEmpty }.joined(separator: " ").nonEmpty ?? "Nieznany użytkownik"
    }

    private func itemRow(_ index: Int, _ item: KitItem) -> some View {
        let equipment = store.entry(item.equipmentId)
        let cable = store.cable(item.cableId)
        let name = equipment?.name ?? cable?.name ?? "Nieznany element"
        let available = equipment.map { $0.simpleQuantity ?? $0.unitsAvailable } ?? cable?.stockQuantity ?? 0
        return HStack(spacing: 10) {
            Text("\(index + 1).").font(.callout.monospacedDigit()).foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
            WarehouseThumb(url: equipment?.thumbnailUrl ?? cable?.thumbnailUrl, size: 34, symbol: cable != nil ? "cable.connector" : "shippingbox")
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(name).fontWeight(.medium)
                    if cable != nil { WarehouseBadge(text: "Przewód", color: CrmTheme.rgb(0x60a5fa)) }
                }
                if let equipment, !equipment.brand.isEmpty { Text("\(equipment.brand) \(equipment.model)").font(.caption).foregroundStyle(.secondary) }
                if let length = cable?.lengthMeters { Text("\(WarehouseLabels.number(length))m").font(.caption).foregroundStyle(.secondary) }
                if !item.notes.isEmpty { Text(item.notes).font(.caption).italic().foregroundStyle(.secondary) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(cable != nil ? "\(item.quantity) \(cable?.unitLabel ?? "szt.")" : "x\(item.quantity)").font(.title3.weight(.light).monospacedDigit()).foregroundStyle(theme.accent)
                Text("\(available) dostępnych").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture {
            if let id = item.equipmentId { state.showEquipment(id) } else if let id = item.cableId { state.showCable(id) }
        }
    }
}

// MARK: Checklista do druku

/// Checklista zestawu jak `handlePrintChecklist`: nazwa, data, kto drukował, tabela pozycji z polem do odhaczenia.
enum KitChecklist {
    @MainActor static func print(kit: WarehouseKit, store: WarehouseStore, printer: String) {
        func escape(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        let rows = kit.items.enumerated().map { index, item -> String in
            let equipment = store.entry(item.equipmentId)
            let cable = store.cable(item.cableId)
            let name = equipment?.name ?? cable?.name ?? "Nieznany sprzęt"
            let brandModel = equipment.map { [$0.brand, $0.model].filter { !$0.isEmpty }.joined(separator: " ") } ?? ""
            let notes = item.notes.isEmpty ? "" : " • \(escape(item.notes))"
            return "<tr><td class=\"c\">☐</td><td class=\"c n\">\(index + 1)</td><td><b>\(escape(name))</b>"
                + (brandModel.isEmpty ? "" : " <span class=\"m\">\(escape(brandModel))</span>")
                + (notes.isEmpty ? "" : "<i class=\"m\">\(notes)</i>")
                + "</td><td class=\"c\"><b>\(item.quantity)</b></td></tr>"
        }.joined()
        let date = Date().formatted(.dateTime.day().month(.wide).year().hour().minute().locale(Locale(identifier: "pl_PL")))
        let html = """
        <html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; }
        h1 { font-size: 18pt; font-weight: 600; margin: 0 0 4pt 0; }
        .info { font-size: 9pt; color: #555; margin-bottom: 12pt; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 9pt; color: #555; border-bottom: 1px solid #999; padding: 4pt; }
        td { border-bottom: 1px solid #e5e5e5; padding: 5pt 4pt; }
        .c { text-align: center; } .n { color: #999; } .m { color: #666; }
        </style></head><body>
        <h1>\(escape(kit.name))</h1>
        <div class="info">\(date)<br>Drukował: <b>\(escape(printer))</b></div>
        <table><thead><tr><th class="c">✓</th><th class="c">Lp.</th><th>Nazwa sprzętu</th><th class="c">Ilość</th></tr></thead>
        <tbody>\(rows)</tbody></table>
        </body></html>
        """
        guard let data = html.data(using: .utf8),
              let text = NSAttributedString(html: data, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else { return }
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.topMargin = 42; info.bottomMargin = 42; info.leftMargin = 42; info.rightMargin = 42
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isVerticallyCentered = false
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
        operation.jobTitle = "Checklista - \(kit.name)"
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
}

// MARK: Tworzenie i edycja zestawu

@MainActor struct KitEditorSheet: View {
    @ObservedObject var store: WarehouseStore
    let kit: WarehouseKit?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var thumbnailUrl = ""
    @State private var categoryId = ""
    @State private var quantity = 1
    @State private var items: [KitDraftItem] = []
    @State private var importing = false
    @State private var dropping = false
    @State private var saving = false

    private var preview: KitInventory.Result {
        KitInventory.check(kitID: kit?.id, quantity: quantity, items: items, kits: store.kits, entries: store.entries, cables: store.cables)
    }
    private var mainCategories: [WarehouseCategory] {
        store.categories.filter { $0.parentId == nil }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(kit == nil ? "Nowy zestaw" : "Edytuj zestaw").font(.title2.weight(.light))
            HStack(alignment: .top, spacing: 18) {
                form.frame(width: 330)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Pozycje w zestawie").font(.headline.weight(.medium))
                    positions
                    Text("Dodaj sprzęt lub przewody do zestawu").font(.callout).foregroundStyle(.secondary)
                    WarehouseProductPicker(store: store, kinds: ["equipment", "cable"], disabled: added) { product in add(product) }
                        .frame(minHeight: 220)
                }
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz zestaw") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(minWidth: 960, minHeight: 700)
        .onAppear(perform: load)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await upload(url) } }
        }
    }

    private var added: Set<String> {
        Set(items.map { item in item.equipmentId.map { "equipment:\($0)" } ?? "cable:\(item.cableId ?? "")" })
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(spacing: 6) {
                    if thumbnailUrl.isEmpty {
                        Image(systemName: "shippingbox").font(.largeTitle).foregroundStyle(.tertiary)
                        Text("Kliknij lub przeciągnij zdjęcie").font(.callout)
                        Text("Obsługiwane formaty: JPG, PNG, WEBP").font(.caption).foregroundStyle(.secondary)
                    } else {
                        WarehouseThumb(url: thumbnailUrl, size: 140, symbol: "square.stack.3d.up")
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 150)
                .background(dropping ? theme.accent.opacity(0.14) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
                .onTapGesture { importing = true }
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first(where: \.isFileURL) else { return false }
                    Task { await upload(url) }
                    return true
                } isTargeted: { dropping = $0 }
                if !thumbnailUrl.isEmpty { Button("Usuń zdjęcie", role: .destructive) { thumbnailUrl = "" }.controlSize(.small) }
                field("Nazwa zestawu *") { TextField("", text: $name, prompt: Text("np. Kablarka Standard 1")).textFieldStyle(.roundedBorder) }
                field("Opis") {
                    TextField("", text: $description, prompt: Text("Krótki opis zestawu..."), axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
                }
                field("Kategoria główna") {
                    Picker("", selection: $categoryId) {
                        Text("Brak kategorii").tag("")
                        ForEach(mainCategories) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                }
                field("Ilość zestawów") {
                    Stepper(value: $quantity, in: 1...max(1, max(preview.maxQuantity, quantity))) { Text("\(quantity)").font(.title3.monospacedDigit()) }
                }
                Text("Maksymalnie \(items.isEmpty ? "—" : "\(preview.maxQuantity)") kompletów ze sprawnych składników, po uwzględnieniu innych zestawów.")
                    .font(.caption).foregroundStyle(.secondary)
                if !preview.shortages.isEmpty {
                    Text(preview.shortages.joined(separator: " ")).font(.caption).foregroundStyle(.red)
                }
            }
        }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }

    private var positions: some View {
        ScrollView {
            VStack(spacing: 6) {
                if items.isEmpty {
                    Text("Brak pozycji — wybierz sprzęt lub przewody poniżej.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 16)
                }
                ForEach($items) { $item in
                    let equipment = store.entry(item.equipmentId)
                    let cable = store.cable(item.cableId)
                    HStack(spacing: 10) {
                        WarehouseThumb(url: equipment?.thumbnailUrl ?? cable?.thumbnailUrl, size: 34, symbol: cable != nil ? "cable.connector" : "shippingbox")
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(equipment?.name ?? cable?.name ?? "Nieznany element").fontWeight(.medium).lineLimit(1)
                                if cable != nil { WarehouseBadge(text: "Przewód", color: CrmTheme.rgb(0x60a5fa)) }
                            }
                            TextField("Notatka", text: $item.notes, prompt: Text("opcjonalne")).textFieldStyle(.roundedBorder).controlSize(.small)
                        }
                        Stepper(value: $item.quantity, in: 1...9999) { Text("Ilość \(item.quantity)").monospacedDigit() }.fixedSize()
                        Button(role: .destructive) { items.removeAll { $0.id == item.id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
                    }
                    .padding(8)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .frame(minHeight: 160, maxHeight: 260)
    }

    private func load() {
        guard let kit else { return }
        name = kit.name; description = kit.description; thumbnailUrl = kit.thumbnailUrl ?? ""; categoryId = kit.categoryId ?? ""
        quantity = max(1, kit.quantity)
        items = kit.items.map { KitDraftItem(equipmentId: $0.equipmentId, cableId: $0.cableId, quantity: $0.quantity, notes: $0.notes) }
    }

    private func add(_ product: WarehouseProduct) {
        if product.kind == "equipment" {
            if items.contains(where: { $0.equipmentId == product.targetId }) { state.notice = "Ten sprzęt jest już w zestawie"; return }
            items.append(KitDraftItem(equipmentId: product.targetId, cableId: nil, quantity: 1, notes: ""))
        } else {
            if items.contains(where: { $0.cableId == product.targetId }) { state.notice = "Ten przewód jest już w zestawie"; return }
            items.append(KitDraftItem(equipmentId: nil, cableId: product.targetId, quantity: 1, notes: ""))
        }
    }

    private func upload(_ url: URL) async {
        guard let jpeg = ImageJPEG.from(url, maxSide: 1200) else { state.notice = "Proszę upuścić plik obrazu"; return }
        await state.withPending("Przesyłanie...") {
            do {
                thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-kits")
                state.succeed("Zdjęcie zostało przesłane")
            } catch { state.error = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
        }
    }

    private func save() async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { state.notice = "Nazwa zestawu jest wymagana"; return }
        guard !items.isEmpty else { state.notice = "Dodaj przynajmniej jedną pozycję do zestawu"; return }
        saving = true
        defer { saving = false }
        let data: [String: JSONValue] = [
            "name": .string(name), "description": .string(description), "thumbnailUrl": .string(thumbnailUrl),
            "categoryId": .string(categoryId), "quantity": .number(Double(quantity)),
        ]
        if let id = await store.saveKit(id: kit?.id, data: data, items: items) {
            dismiss()
            store.openedKitID = id
        }
    }
}
