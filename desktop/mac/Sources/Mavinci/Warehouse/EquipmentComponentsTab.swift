import SwiftUI
import AppKit

// MARK: Karta sprzętu — Skład zestawu (1:1 z `ComponentsTab` i `ComponentEditDialog`): komponenty wliczone, elementy opcjonalne,
// elementy wymagane / zalecane / opcjonalne (sprzęt, zestawy, przewody) z grupami alternatyw. Wszystko z kopii na dysku.

extension View {
    /// Arkusz magazynu z motywem i obszarem roboczym.
    @MainActor func warehouseSheetStyle(_ state: Workspace) -> some View {
        environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
    }
}

/// Plakietka (typ, stan, rodzaj pozycji) — tło zamiast obramowania.
struct WarehouseBadge: View {
    let text: String
    var color: Color = .secondary
    var body: some View {
        Text(text).font(.caption2.weight(.medium)).lineLimit(1)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(color)
    }
}

struct ComponentEditRequest: Identifiable {
    let id = UUID()
    let component: EquipmentComponent?
    let compatible: CompatibleItem?
}

private struct CompatGroup {
    let key: String
    let name: String
    let items: [CompatibleItem]
}

@MainActor struct EquipmentComponentsTab: View {
    @ObservedObject var store: WarehouseStore
    let detail: EquipmentDetail
    let editing: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var adding = false
    @State private var addingCompatible = false
    @State private var editRequest: ComponentEditRequest?
    @State private var shownComponent: EquipmentComponent?
    @State private var removing: ComponentEditRequest?

    private func action(_ title: String, _ run: @escaping () -> Void) -> (String, () -> Void)? { editing ? (title, run) : nil }

    private var groups: [CompatGroup] {
        var order: [String] = []
        var map: [String: [CompatibleItem]] = [:]
        for item in detail.compatible {
            let key = item.group.isEmpty ? "single_\(item.id)" : item.group
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(item)
        }
        return order.map { key in CompatGroup(key: key, name: map[key]?.first?.group ?? "", items: map[key] ?? []) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Skład zestawu", action: action("Dodaj komponent") { adding = true }) {
                let included = detail.components.filter { !$0.optional }
                if included.isEmpty {
                    empty("shippingbox", "Brak komponentów w zestawie")
                } else {
                    VStack(spacing: 8) { ForEach(included) { componentRow($0) } }
                }
            }
            TeamCard(title: "Elementy wymagane i powiązane", action: action("Dodaj pasujący produkt") { addingCompatible = true }) {
                Text("Sprzęt, zestawy i przewody wymagane, zalecane lub opcjonalne dla tego produktu").font(.callout).foregroundStyle(.secondary)
                let optional = detail.components.filter(\.optional)
                if optional.isEmpty && detail.compatible.isEmpty {
                    empty("link", "Brak wymaganych i powiązanych elementów")
                } else {
                    VStack(spacing: 8) {
                        ForEach(optional) { componentRow($0) }
                        ForEach(groups, id: \.key) { groupView($0) }
                    }
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddComponentSheet(store: store, equipmentID: detail.id).warehouseSheetStyle(state)
        }
        .sheet(isPresented: $addingCompatible) {
            AddCompatibleSheet(store: store, detail: detail).warehouseSheetStyle(state)
        }
        .sheet(item: $editRequest) { request in
            ComponentEditSheet(store: store, equipmentID: detail.id, component: request.component, compatible: request.compatible).warehouseSheetStyle(state)
        }
        .sheet(item: $shownComponent) { component in
            ComponentDetailSheet(component: component).warehouseSheetStyle(state)
        }
        .confirmationDialog("Usuń element", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let request = removing else { return }
                Task {
                    if let component = request.component {
                        await store.run("Usuwanie…", "componentDelete", ["id": .string(component.id)], success: "Komponent usunięty", reload: detail.id)
                    } else if let item = request.compatible {
                        await store.run("Usuwanie…", "compatibleDelete", ["id": .string(item.id)], success: "Usunięto", reload: detail.id)
                    }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Czy na pewno chcesz usunąć „\(removing?.component?.name ?? removing?.compatible?.name ?? "")”?")
        }
    }

    private func empty(_ symbol: String, _ text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(.tertiary)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 24)
    }

    private func rowActions(_ request: ComponentEditRequest) -> some View {
        HStack(spacing: 2) {
            Button { editRequest = request } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj element")
            Button(role: .destructive) { removing = request } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
        }
    }

    private func componentRow(_ c: EquipmentComponent) -> some View {
        HStack(alignment: .top, spacing: 12) {
            WarehouseThumb(url: c.thumbnailUrl, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(c.name).fontWeight(.medium)
                    if c.equipmentId != nil { WarehouseBadge(text: "Z magazynu", color: CrmTheme.rgb(0x60a5fa)) }
                    else if c.integral { WarehouseBadge(text: "Integralny", color: theme.accent) }
                    if c.optional { WarehouseBadge(text: "Opcjonalny", color: CrmTheme.rgb(0x4ade80)) }
                }
                if !c.description.isEmpty { Text(c.description).font(.callout).foregroundStyle(.secondary) }
                ForEach(Array(c.specs.prefix(2)), id: \.self) { spec in
                    Text("\(spec.key): \(spec.value)").font(.caption).foregroundStyle(.secondary)
                }
                if c.specs.count > 2 {
                    Text("+\(c.specs.count - 2) więcej parametrów (kliknij aby zobaczyć)").font(.caption).foregroundStyle(theme.accent)
                }
            }
            Spacer(minLength: 8)
            Text("x\(c.quantity)").font(.title3.weight(.light).monospacedDigit()).foregroundStyle(theme.accent)
            if editing { rowActions(ComponentEditRequest(component: c, compatible: nil)) }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture { shownComponent = c }
    }

    @ViewBuilder private func groupView(_ group: CompatGroup) -> some View {
        if !group.name.isEmpty {
            let required = group.items.first?.type == "required"
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text("Grupa: \(group.name)").font(.headline.weight(.medium))
                    if required { WarehouseBadge(text: "Wybierz JEDEN", color: CrmTheme.rgb(0xf87171)) }
                }
                if required {
                    Text("Użytkownik musi wybrać jeden z poniższych komponentów alternatywnych").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(group.items) { compatibleRow($0) }
            }
            .padding(10)
            .background((required ? CrmTheme.rgb(0xf87171) : theme.accent).opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        } else {
            ForEach(group.items) { compatibleRow($0) }
        }
    }

    private func compatibleRow(_ item: CompatibleItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            WarehouseThumb(url: item.thumbnailUrl, size: 52, symbol: item.kind == "cable" ? "cable.connector" : item.kind == "kit" ? "square.stack.3d.up" : "shippingbox")
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(item.name).fontWeight(.medium)
                    if item.kind == "kit" { WarehouseBadge(text: "ZESTAW", color: CrmTheme.rgb(0xc084fc)) }
                    if item.kind == "cable" { WarehouseBadge(text: "PRZEWÓD", color: CrmTheme.rgb(0x60a5fa)) }
                    WarehouseBadge(text: "\(WarehouseLabels.number(item.quantity)) \(item.unit) \(WarehouseLabels.quantityMode(item.mode))")
                    WarehouseBadge(text: WarehouseLabels.compatibilityType(item.type), color: WarehouseLabels.compatibilityColor(item.type))
                    if item.kind != "kit", let available = item.available {
                        WarehouseBadge(text: "\(WarehouseLabels.number(available)) \(item.unit) dostępne",
                                       color: available > 0 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
                    }
                }
                let subtitle = [item.brand, item.model].filter { !$0.isEmpty }.joined(separator: " ")
                if !subtitle.isEmpty { Text(subtitle).font(.callout).foregroundStyle(.secondary) }
                if let length = item.lengthMeters { Text("\(WarehouseLabels.number(length)) m").font(.caption).foregroundStyle(.secondary) }
                if !item.kitItems.isEmpty {
                    let more = item.kitItems.count > 3 ? " +\(item.kitItems.count - 3) więcej..." : ""
                    Text("Zawiera: " + item.kitItems.prefix(3).joined(separator: ", ") + more).font(.caption).foregroundStyle(.secondary)
                }
                if !item.notes.isEmpty { Text(item.notes).font(.caption).italic().foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            if editing { rowActions(ComponentEditRequest(component: nil, compatible: item)) }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture { open(item) }
        .help("Otwórz")
    }

    private func open(_ item: CompatibleItem) {
        switch item.kind {
        case "kit": state.showKit(item.targetId)
        case "cable": state.showCable(item.targetId)
        default: state.showEquipment(item.targetId)
        }
    }
}

// MARK: Szczegóły komponentu

@MainActor struct ComponentDetailSheet: View {
    let component: EquipmentComponent
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                WarehouseThumb(url: component.thumbnailUrl, size: 120)
                VStack(alignment: .leading, spacing: 6) {
                    Text(component.name).font(.title2.weight(.light))
                    HStack(spacing: 6) {
                        if component.equipmentId != nil { WarehouseBadge(text: "Z magazynu", color: CrmTheme.rgb(0x60a5fa)) }
                        else if component.integral { WarehouseBadge(text: "Integralny", color: theme.accent) }
                        if component.optional { WarehouseBadge(text: "Opcjonalny", color: CrmTheme.rgb(0x4ade80)) }
                    }
                    Text("Ilość: \(component.quantity)").foregroundStyle(.secondary)
                }
            }
            if !component.description.isEmpty { Text(component.description).textSelection(.enabled) }
            if !component.specs.isEmpty {
                Text("Parametry techniczne").font(.headline.weight(.medium))
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                    ForEach(component.specs, id: \.self) { spec in
                        GridRow {
                            Text(spec.key).foregroundStyle(.secondary)
                            Text(spec.value).textSelection(.enabled)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            HStack {
                if let id = component.equipmentId {
                    Button("Otwórz kartę sprzętu", systemImage: "shippingbox") { dismiss(); state.showEquipment(id) }
                }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(minWidth: 480, minHeight: 320)
    }
}

// MARK: Dodawanie komponentu

@MainActor struct AddComponentSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var fromWarehouse = true
    @State private var selected: WarehouseEntry?
    @State private var search = ""
    @State private var name = ""
    @State private var quantity = 1
    @State private var description = ""
    @State private var optional = false
    @State private var thumbnailUrl = ""
    @State private var specs: [SpecPair] = []
    @State private var specKey = ""
    @State private var specValue = ""
    @State private var importing = false
    @State private var saving = false

    private var equipment: [WarehouseEntry] {
        store.entries.filter { !$0.isKit && $0.id != equipmentID && $0.matches(search) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    private var valid: Bool { quantity >= 1 && (fromWarehouse ? selected != nil : !name.trimmingCharacters(in: .whitespaces).isEmpty) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Dodaj komponent").font(.title2.weight(.light))
            Picker("", selection: $fromWarehouse) {
                Text("Z magazynu").tag(true)
                Text("Własna nazwa").tag(false)
            }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
            if fromWarehouse {
                TextField("Szukaj sprzętu…", text: $search).textFieldStyle(.roundedBorder)
                List(equipment, selection: Binding(get: { selected?.id }, set: { id in selected = equipment.first { $0.id == id } })) { entry in
                    HStack(spacing: 10) {
                        WarehouseThumb(url: entry.thumbnailUrl, size: 34)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.name)
                            let subtitle = [entry.brand, entry.model, store.categoryPath(entry.categoryId)].filter { !$0.isEmpty }.joined(separator: " · ")
                            if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        Text(entry.stockLabel).font(.caption.monospacedDigit()).foregroundStyle(entry.stockColor)
                    }
                    .tag(entry.id)
                }
                .frame(minHeight: 220)
            } else {
                TextField("Nazwa komponentu", text: $name).textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 12) {
                Stepper("Ilość: \(quantity)", value: $quantity, in: 1...9999)
                TextField("Opis (opcjonalnie)", text: $description).textFieldStyle(.roundedBorder)
            }
            Toggle("Komponent opcjonalny (nie wliczony domyślnie w zestaw)", isOn: $optional)
            if !fromWarehouse { integralDetails }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Dodawanie…" : "Dodaj") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!valid || saving)
            }
        }
        .padding(20)
        .frame(minWidth: 620, minHeight: fromWarehouse ? 560 : 460)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await uploadThumb(url) } }
        }
    }

    private var integralDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Komponent integralny - Szczegóły").font(.headline.weight(.medium))
            HStack(spacing: 12) {
                if !thumbnailUrl.isEmpty { WarehouseThumb(url: thumbnailUrl, size: 64) }
                Button(thumbnailUrl.isEmpty ? "Dodaj zdjęcie" : "Zmień zdjęcie", systemImage: "photo") { importing = true }
                if !thumbnailUrl.isEmpty { Button("Usuń", role: .destructive) { thumbnailUrl = "" } }
                Text("Zdjęcie komponentu (opcjonalne)").font(.caption).foregroundStyle(.secondary)
            }
            Text("Parametry techniczne").font(.caption).foregroundStyle(.secondary)
            ForEach(specs, id: \.self) { spec in
                HStack {
                    Text(spec.key).foregroundStyle(.secondary)
                    Text(spec.value)
                    Spacer()
                    Button(role: .destructive) { specs.removeAll { $0 == spec } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless)
                }
            }
            HStack {
                TextField("Nazwa parametru (np. Moc)", text: $specKey).textFieldStyle(.roundedBorder)
                TextField("Wartość (np. 500W)", text: $specValue).textFieldStyle(.roundedBorder)
                Button("Dodaj", systemImage: "plus") {
                    let key = specKey.trimmingCharacters(in: .whitespaces), value = specValue.trimmingCharacters(in: .whitespaces)
                    guard !key.isEmpty, !value.isEmpty else { return }
                    specs.removeAll { $0.key == key }
                    specs.append(SpecPair(key: key, value: value))
                    specKey = ""; specValue = ""
                }
                .disabled(specKey.trimmingCharacters(in: .whitespaces).isEmpty || specValue.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func uploadThumb(_ url: URL) async {
        guard let jpeg = ImageJPEG.from(url, maxSide: 1200) else { state.error = "Plik musi być obrazem"; return }
        await state.withPending("Przesyłanie...") {
            do { thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-images") }
            catch { state.error = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let data: [String: JSONValue] = [
            "componentEquipmentId": .string(fromWarehouse ? selected?.id ?? "" : ""), "name": .string(name), "quantity": .number(Double(quantity)),
            "description": .string(description), "optional": .bool(optional), "thumbnailUrl": .string(thumbnailUrl),
            "specs": .array(specs.map { .object(["key": .string($0.key), "value": .string($0.value)]) }),
        ]
        let reply = await store.run("Dodawanie komponentu…", "componentAdd", ["equipmentId": .string(equipmentID), "data": .object(data)],
                                    success: "Komponent dodany pomyślnie", reload: equipmentID)
        if reply != nil { dismiss() }
    }
}

// MARK: Edycja elementu zestawu

@MainActor struct ComponentEditSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    let component: EquipmentComponent?
    let compatible: CompatibleItem?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var quantity = ""
    @State private var description = ""
    @State private var optional = false
    @State private var type = "optional"
    @State private var mode = "per_item"
    @State private var group = ""
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edytuj element zestawu").font(.title2.weight(.light))
            if let compatible { Text(compatible.name).foregroundStyle(.secondary) }
            Form {
                if component != nil { TextField("Nazwa", text: $name) }
                TextField("Ilość", text: $quantity)
                if compatible != nil {
                    Picker("Typ powiązania", selection: $type) { ForEach(WarehouseLabels.compatibilityTypes) { Text($0.label).tag($0.value) } }
                    Picker("Sposób przeliczania", selection: $mode) { ForEach(WarehouseLabels.quantityModes) { Text($0.label).tag($0.value) } }
                    VStack(alignment: .leading, spacing: 2) {
                        TextField("Grupa alternatyw", text: $group, prompt: Text("Bez grupy"))
                        Text("Ta sama nazwa grupy łączy elementy, spośród których wybierasz jeden.").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Toggle("Opcjonalny", isOn: $optional)
                }
                TextField(compatible != nil ? "Notatki" : "Opis", text: $description, axis: .vertical).lineLimit(3...6)
            }
            .formStyle(.grouped)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(minWidth: 480, minHeight: 360)
        .onAppear {
            if let component {
                name = component.name; quantity = "\(component.quantity)"; description = component.description; optional = component.optional
            } else if let compatible {
                quantity = WarehouseLabels.number(compatible.quantity); type = compatible.type; mode = compatible.mode
                group = compatible.group; description = compatible.notes
            }
        }
    }

    private func save() async {
        guard let amount = Int(quantity.trimmingCharacters(in: .whitespaces)), amount >= 1 else {
            problem = "Wpisz poprawną ilość — liczbę całkowitą większą od zera."; return
        }
        if component != nil && name.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Podaj nazwę komponentu."; return }
        problem = nil
        saving = true
        defer { saving = false }
        let reply: [String: JSONValue]?
        if let component {
            reply = await store.run("Zapisywanie…", "componentUpdate", ["id": .string(component.id), "data": .object([
                "name": .string(name), "quantity": .number(Double(amount)), "description": .string(description), "optional": .bool(optional),
            ])], success: "Zmiany elementu zostały zapisane", reload: equipmentID)
        } else if let compatible {
            reply = await store.run("Zapisywanie…", "compatibleUpdate", ["id": .string(compatible.id), "data": .object([
                "quantity": .number(Double(amount)), "type": .string(type), "mode": .string(mode), "group": .string(group), "notes": .string(description),
            ])], success: "Zmiany elementu zostały zapisane", reload: equipmentID)
        } else { reply = nil }
        if reply != nil { dismiss() }
    }
}

// MARK: Dodawanie pasującego produktu

/// Produkt do wyboru (sprzęt, zestaw, przewód) z kopii magazynu.
struct WarehouseProduct: Identifiable, Hashable {
    let kind: String
    let targetId: String
    let name: String
    let subtitle: String
    let thumbnailUrl: String?
    let stock: String
    var id: String { "\(kind):\(targetId)" }
}

extension WarehouseStore {
    /// Lista produktów do wyboru jak w CRM (`fetchAvailableEquipment`): sprzęt (bez `excluding`), zestawy i przewody.
    func products(kinds: Set<String>, excluding: String? = nil, query: String) -> [WarehouseProduct] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        func hit(_ values: [String]) -> Bool { q.isEmpty || values.contains { $0.lowercased().contains(q) } }
        var result: [WarehouseProduct] = []
        if kinds.contains("equipment") {
            for entry in entries where !entry.isKit && entry.active && entry.id != excluding && hit([entry.name, entry.brand, entry.model, categoryPath(entry.categoryId)]) {
                result.append(WarehouseProduct(kind: "equipment", targetId: entry.id, name: entry.name,
                                               subtitle: [[entry.brand, entry.model].filter { !$0.isEmpty }.joined(separator: " "), categoryPath(entry.categoryId)].filter { !$0.isEmpty }.joined(separator: " · "),
                                               thumbnailUrl: entry.thumbnailUrl, stock: entry.simpleQuantity.map { "\($0) szt." } ?? "\(entry.unitsAvailable)/\(entry.unitsTotal) szt."))
            }
        }
        if kinds.contains("kit") {
            for kit in kits where kit.active && hit([kit.name, kit.description]) {
                result.append(WarehouseProduct(kind: "kit", targetId: kit.id, name: kit.name, subtitle: "Zestaw · \(kit.items.count) pozycji",
                                               thumbnailUrl: kit.thumbnailUrl, stock: kit.quantity > 1 ? "\(kit.quantity) kpl." : ""))
            }
        }
        if kinds.contains("cable") {
            for cable in cables where cable.active && hit([cable.name, cable.description, categoryPath(cable.categoryId)]) {
                let length = cable.lengthMeters.map { "\(WarehouseLabels.number($0)) m" } ?? ""
                result.append(WarehouseProduct(kind: "cable", targetId: cable.id, name: cable.name,
                                               subtitle: ["Przewód", length, categoryPath(cable.categoryId)].filter { !$0.isEmpty }.joined(separator: " · "),
                                               thumbnailUrl: cable.thumbnailUrl, stock: "\(cable.stockQuantity) \(cable.unitLabel)"))
            }
        }
        return result.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

/// Wyszukiwarka produktów z filtrem typu (Wszystko / Sprzęt / Zestawy / Przewody) — kliknięcie wybiera.
@MainActor struct WarehouseProductPicker: View {
    @ObservedObject var store: WarehouseStore
    var kinds: [String] = ["equipment", "kit", "cable"]
    var excluding: String?
    var disabled: Set<String> = []
    let pick: (WarehouseProduct) -> Void
    @State private var filter = "all"
    @State private var search = ""

    private var products: [WarehouseProduct] {
        store.products(kinds: filter == "all" ? Set(kinds) : [filter], excluding: excluding, query: search)
    }
    private func label(_ kind: String) -> String { ["equipment": "Sprzęt", "kit": "Zestawy", "cable": "Przewody"][kind] ?? kind }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if kinds.count > 1 {
                    Picker("Typ produktu", selection: $filter) {
                        Text("Wszystko").tag("all")
                        ForEach(kinds, id: \.self) { Text(label($0)).tag($0) }
                    }
                    .pickerStyle(.segmented).frame(maxWidth: 380)
                }
                TextField("Szukaj produktu po nazwie, modelu, marce...", text: $search).textFieldStyle(.roundedBorder)
            }
            List(products) { product in
                Button { pick(product) } label: {
                    HStack(spacing: 10) {
                        WarehouseThumb(url: product.thumbnailUrl, size: 36,
                                       symbol: product.kind == "cable" ? "cable.connector" : product.kind == "kit" ? "square.stack.3d.up" : "shippingbox")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(product.name)
                            if !product.subtitle.isEmpty { Text(product.subtitle).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if !product.stock.isEmpty { Text(product.stock).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                        Image(systemName: disabled.contains(product.id) ? "checkmark.circle.fill" : "plus.circle").foregroundStyle(.tint)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(disabled.contains(product.id))
            }
            .overlay { if products.isEmpty { Text("Nie znaleziono produktów").foregroundStyle(.secondary) } }
        }
    }
}

@MainActor struct AddCompatibleSheet: View {
    @ObservedObject var store: WarehouseStore
    let detail: EquipmentDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var type = "optional"
    @State private var quantity = 1
    @State private var mode = "per_item"
    @State private var groupMode = "__none__"
    @State private var newGroup = ""
    @State private var notes = ""
    @State private var adding = false

    private var existingGroups: [String] {
        var seen: [String] = []
        for item in detail.compatible where item.type == type && !item.group.isEmpty && !seen.contains(item.group) { seen.append(item.group) }
        return seen
    }
    private var group: String {
        groupMode == "__none__" ? "" : groupMode == "__new__" ? newGroup.trimmingCharacters(in: .whitespaces) : groupMode
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Dodaj pasujący produkt").font(.title2.weight(.light))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    Picker("Typ kompatybilności", selection: $type) {
                        Text("Opcjonalny").tag("optional")
                        Text("Zalecany").tag("recommended")
                        Text("Wymagany").tag("required")
                    }
                    Stepper("Wymagana liczba: \(quantity)", value: $quantity, in: 1...9999)
                }
                GridRow {
                    Picker("Sposób przeliczania", selection: $mode) {
                        Text("Na każdą sztukę sprzętu").tag("per_item")
                        Text("Stała liczba dla całego eventu").tag("fixed")
                    }
                    TextField("Notatki (opcjonalne)", text: $notes, prompt: Text("np. Do montażu podestu scenicznego")).textFieldStyle(.roundedBorder)
                }
            }
            .onChange(of: type) { groupMode = "__none__"; newGroup = "" }
            if type != "optional" {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Sposób spełnienia \(type == "required" ? "wymagania" : "zalecenia")").font(.callout.weight(.medium))
                    Text("Bez grupy każda pozycja jest liczona osobno. Pozycje w tej samej grupie są alternatywami — wystarczy wybrać jedną z nich.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: $groupMode) {
                        Text("Osobne — ten komponent musi być dodany niezależnie").tag("__none__")
                        ForEach(existingGroups, id: \.self) { Text("Grupa „\($0)” — jedna z alternatyw").tag($0) }
                        Text("+ Utwórz nową grupę alternatyw").tag("__new__")
                    }
                    .labelsHidden()
                    if groupMode == "__new__" {
                        TextField("Nazwa nowej grupy, np. procesor albo rama", text: $newGroup).textFieldStyle(.roundedBorder)
                    }
                    Text(groupMode == "__none__" ? "Ta pozycja pozostanie samodzielnym wymaganiem."
                         : group.isEmpty ? "Wpisz nazwę nowej grupy przed wybraniem produktu." : "Pozycja trafi do grupy „\(group)”.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            WarehouseProductPicker(store: store, excluding: detail.id) { product in Task { await add(product) } }
                .disabled(adding)
        }
        .padding(20)
        .frame(minWidth: 720, minHeight: 640)
    }

    private func add(_ product: WarehouseProduct) async {
        if groupMode == "__new__" && group.isEmpty { state.error = "Wpisz nazwę nowej grupy przed wybraniem produktu."; return }
        adding = true
        defer { adding = false }
        let data: [String: JSONValue] = [
            "kind": .string(product.kind), "targetId": .string(product.targetId), "type": .string(type), "group": .string(type == "optional" ? "" : group),
            "quantity": .number(Double(quantity)), "mode": .string(mode), "notes": .string(notes),
        ]
        let reply = await store.run("Dodawanie…", "compatibleAdd", ["equipmentId": .string(detail.id), "data": .object(data)],
                                    success: "Dodano „\(product.name)”", reload: detail.id)
        if reply != nil { dismiss() }
    }
}
