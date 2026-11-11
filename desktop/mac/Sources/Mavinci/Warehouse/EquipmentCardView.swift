import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Karta sprzętu — 1:1 z `/crm/equipment/[id]`: nagłówek (nazwa, dostępne / wszystkie, marka i model), zakładki Podstawowe,
// Parametry techniczne (z prądem i wtykami), Informacje zakupowe (z amortyzacją), Skład zestawu, Jednostki (sztuki, statusy,
// zdarzenia), Galeria, Pliki i Historia zmian; edycja (`equipment_manage`) z zapisem historii i usuwaniem. Karta z kopii na dysku
// (zbiór `warehouse-details`) — otwiera się od razu, synchronizacja w tle.

/// Formularz edycji karty (liczby jako tekst — wpisywane z przecinkiem lub kropką).
struct EquipmentDraft: Equatable {
    var name = ""
    var brand = ""
    var model = ""
    var description = ""
    var notes = ""
    var thumbnailUrl = ""
    var manualUrl = ""
    var categoryId = ""
    var locationId = ""
    var weight = ""
    var length = ""
    var width = ""
    var height = ""
    var cableLength = ""
    var connectorIn = ""
    var connectorOut = ""
    var cableStock = ""
    var purchaseDate: Date? = nil
    var purchasePrice = ""
    var currentValue = ""
    var depreciationRate = "10"
    var rentalPrice = ""
    var warrantyUntil: Date? = nil
    var serialNumber = ""
    var barcode = ""
    var watts = ""
    var amps = ""
    var volts = "230"
    var phase = "single_phase"
    var inputConnectorId = ""
    var outputConnectorId = ""
    var powerNotes = ""
    var requiresPreCheck = false
    var preCheckInstructions = ""

    init() {}
    init(_ d: EquipmentDetail) {
        let n = WarehouseLabels.number
        name = d.name; brand = d.brand; model = d.model; description = d.description; notes = d.notes
        thumbnailUrl = d.thumbnailUrl ?? ""; manualUrl = d.manualUrl; categoryId = d.categoryId ?? ""; locationId = d.locationId ?? ""
        weight = n(d.weightKg); length = n(d.dimensions?.length); width = n(d.dimensions?.width); height = n(d.dimensions?.height)
        cableLength = n(d.cable?.lengthMeters); connectorIn = d.cable?.connectorIn ?? ""; connectorOut = d.cable?.connectorOut ?? ""
        cableStock = "\(d.cableStockQuantity)"
        purchaseDate = DayDates.parse(d.purchaseDate); purchasePrice = n(d.purchasePrice); currentValue = n(d.currentValue)
        depreciationRate = d.depreciationRate.map { n($0) } ?? "10"; rentalPrice = n(d.rentalPricePerDay); warrantyUntil = DayDates.parse(d.warrantyUntil)
        serialNumber = d.serialNumber; barcode = d.barcode
        watts = n(d.power.watts); amps = n(d.power.amps); volts = n(d.power.volts ?? 230); phase = d.power.phase
        inputConnectorId = d.power.inputConnectorId ?? ""; outputConnectorId = d.power.outputConnectorId ?? ""; powerNotes = d.power.notes
        requiresPreCheck = d.requiresPreCheck; preCheckInstructions = d.preCheckInstructions
    }
    static func number(_ text: String) -> JSONValue {
        let value = text.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "").trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, let parsed = Double(value) else { return .null }
        return .number(parsed)
    }
    var json: [String: JSONValue] {
        let num = EquipmentDraft.number
        let day: (Date?) -> JSONValue = { date in date.map { JSONValue.string(DayDates.string($0)) } ?? JSONValue.null }
        return [
            "name": .string(name), "brand": .string(brand), "model": .string(model), "description": .string(description), "notes": .string(notes),
            "thumbnailUrl": .string(thumbnailUrl), "manualUrl": .string(manualUrl), "categoryId": .string(categoryId), "locationId": .string(locationId),
            "weightKg": num(weight), "dimensions": .object(["length": num(length), "width": num(width), "height": num(height)]),
            "cable": .object(["lengthMeters": num(cableLength), "connectorIn": .string(connectorIn), "connectorOut": .string(connectorOut)]),
            "cableStockQuantity": num(cableStock), "purchaseDate": day(purchaseDate), "purchasePrice": num(purchasePrice),
            "currentValue": num(currentValue), "depreciationRate": num(depreciationRate), "rentalPricePerDay": num(rentalPrice),
            "warrantyUntil": day(warrantyUntil), "serialNumber": .string(serialNumber), "barcode": .string(barcode),
            "power": .object(["watts": num(watts), "amps": num(amps), "volts": num(volts), "phase": .string(phase),
                              "inputConnectorId": .string(inputConnectorId), "outputConnectorId": .string(outputConnectorId), "notes": .string(powerNotes)]),
            "requiresPreCheck": .bool(requiresPreCheck), "preCheckInstructions": .string(preCheckInstructions),
        ]
    }
}

struct UnitEditorRequest: Identifiable {
    let id = UUID()
    let unit: EquipmentUnit?
}

@MainActor struct EquipmentCardView: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab: EquipmentCardTab = .details
    @State private var editing = false
    @State private var draft = EquipmentDraft()
    @State private var saving = false
    @State private var removing = false
    @State private var importingThumb = false
    @State private var unitEditor: UnitEditorRequest?
    @State private var eventsFor: EquipmentUnit?
    @State private var removingUnits: [String] = []
    @State private var selectedUnits: Set<String> = []
    @State private var quantity = 0

    private var detail: EquipmentDetail? { store.details[equipmentID] }
    private var canEdit: Bool { store.canManage }

    var body: some View {
        Group {
            if let d = detail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header(d)
                        tabBar(d)
                        content(d)
                    }
                    .padding(16)
                }
            } else if let error = store.detailError {
                ContentUnavailableView {
                    Label("Sprzęt", systemImage: "shippingbox")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(equipmentID) } }
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(detail?.name ?? "Sprzęt")
        .navigationSubtitle([detail?.brand ?? "", detail?.model ?? ""].filter { !$0.isEmpty }.joined(separator: " "))
        .toolbar { toolbar }
        .overlay { if saving { PendingOverlay(text: "Zapisywanie…") } }
        .task(id: equipmentID) {
            if let d = detail { quantity = d.cableStockQuantity }
            await store.openDetail(equipmentID)
            if let d = detail { quantity = d.cableStockQuantity }
        }
        .fileImporter(isPresented: $importingThumb, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await uploadThumb(url) } }
        }
        .sheet(item: $unitEditor) { request in
            UnitEditorSheet(store: store, equipmentID: equipmentID, unit: request.unit, requiresSerial: detail?.flags.requiresSerial ?? false)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $eventsFor) { unit in
            UnitEventsSheet(store: store, equipmentID: equipmentID, unit: unit, canEdit: canEdit)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń sprzęt", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń sprzęt", role: .destructive) {
                Task {
                    if let entry = store.entry(equipmentID) { _ = await store.delete(entry) }
                    else { await store.run("Usuwanie…", "delete", ["id": .string(equipmentID), "kind": .string("item")], success: "Sprzęt został usunięty"); store.openedID = nil }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć sprzęt „\(detail?.name ?? "")”? Ta operacja jest nieodwracalna.") }
        .confirmationDialog(removingUnits.count > 1 ? "Usuń \(removingUnits.count) jednostek" : "Usuń jednostkę",
                            isPresented: Binding(get: { !removingUnits.isEmpty }, set: { if !$0 { removingUnits = [] } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                let ids = removingUnits
                Task {
                    await store.run("Usuwanie jednostek…", "unitDelete", ["ids": .array(ids.map { .string($0) })], success: ids.count > 1 ? "Usunięto \(ids.count) jednostek" : "Jednostka usunięta", reload: equipmentID)
                    selectedUnits.subtract(ids)
                }
            }
            Button("Anuluj", role: .cancel) {}
        }
    }

    // MARK: Pasek narzędzi
    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { store.openedID = nil } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do listy sprzętu")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if let d = detail, canEdit {
                if editing {
                    Button(role: .destructive) { removing = true } label: { Label("Usuń", systemImage: "trash") }.disabled(saving)
                    Button("Anuluj") { editing = false; draft = EquipmentDraft(d) }.disabled(saving)
                    Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz", systemImage: "checkmark") }
                        .buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving)
                } else {
                    Button { draft = EquipmentDraft(d); editing = true } label: { Label("Edytuj", systemImage: "pencil") }.keyboardShortcut("e")
                }
            }
            Menu {
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/equipment/\(equipmentID)") }
                Button("Odśwież", systemImage: "arrow.clockwise") { Task { await store.loadDetail(equipmentID) } }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
        }
    }

    private func save() async {
        guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { state.error = "Nazwa jest wymagana."; return }
        saving = true
        defer { saving = false }
        do {
            try await store.post("update", ["id": .string(equipmentID), "data": .object(draft.json)])
            await store.loadDetail(equipmentID)
            Task { await store.sync(force: true) }
            editing = false
            state.succeed("Zmiany zostały zapisane")
        } catch {
            state.error = store.failureText(error, "Błąd podczas zapisywania")
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

    // MARK: Nagłówek i zakładki
    private func header(_ d: EquipmentDetail) -> some View {
        HStack(spacing: 14) {
            WarehouseThumb(url: editing ? draft.thumbnailUrl.nonEmpty : d.thumbnailUrl, size: 64)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(d.name).font(.title2.weight(.light))
                    Text(d.simpleStock ? "\(d.unitsCount) szt." : "\(d.availableUnits)/\(d.units.count)")
                        .font(.callout.weight(.medium).monospacedDigit()).padding(.horizontal, 8).padding(.vertical, 2)
                        .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                    if !d.active { Text("NIEAKTYWNY").font(.caption2.weight(.bold)).foregroundStyle(.secondary) }
                }
                let subtitle = [d.brand, d.model].filter { !$0.isEmpty }.joined(separator: " ")
                if !subtitle.isEmpty { Text(subtitle).foregroundStyle(.secondary) }
                let path = store.categoryPath(d.categoryId)
                if !path.isEmpty { Label(path, systemImage: "folder").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
        }
    }

    private func tabs(_ d: EquipmentDetail) -> [EquipmentCardTab] {
        EquipmentCardTab.allCases.filter { !(d.cable != nil && $0 == .components) }
    }
    private func tabLabel(_ t: EquipmentCardTab, _ d: EquipmentDetail) -> String {
        switch t {
        case .components: return "\(t.label) (\(d.counts.components))"
        case .units: return "\(t.label) (\(d.unitsCount))"
        case .gallery: return "\(t.label) (\(d.counts.images))"
        case .files: return "\(t.label) (\(d.counts.files))"
        default: return t.label
        }
    }
    private func tabBar(_ d: EquipmentDetail) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(tabs(d)) { item in
                    Button { tab = item } label: {
                        Label(tabLabel(item, d), systemImage: item.symbol)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .foregroundStyle(tab == item ? theme.accent : Color.secondary)
                            .overlay(alignment: .bottom) { if tab == item { Rectangle().fill(theme.accent).frame(height: 2) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func content(_ d: EquipmentDetail) -> some View {
        switch tab {
        case .details: detailsTab(d)
        case .technical: technicalTab(d)
        case .purchase: purchaseTab(d)
        case .units: unitsTab(d)
        case .history: historyTab(d)
        case .components: EquipmentComponentsTab(store: store, detail: d, editing: editing && canEdit)
        case .gallery: EquipmentGalleryTab(store: store, detail: d)
        case .files: EquipmentFilesTab(store: store, detail: d)
        }
    }

    // MARK: Pola
    @ViewBuilder private func row(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "-" : value).textSelection(.enabled)
        }
    }
    private func input(_ label: String, _ text: Binding<String>, prompt: String? = nil, vertical: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            if vertical {
                TextField("", text: text, prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            } else {
                TextField("", text: text, prompt: prompt.map { Text($0) }).textFieldStyle(.roundedBorder)
            }
        }
    }
    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }

    // MARK: Podstawowe
    private func detailsTab(_ d: EquipmentDetail) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Podstawowe informacje") {
                if editing {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        input("Nazwa", $draft.name)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Kategoria").font(.caption).foregroundStyle(.secondary)
                            Picker("Kategoria", selection: $draft.categoryId) {
                                Text("Brak").tag("")
                                ForEach(store.categoryTree) { c in Text(String(repeating: "   ", count: max(0, c.level - 1)) + c.name).tag(c.id) }
                            }.labelsHidden()
                        }
                        input("Marka", $draft.brand)
                        input("Model", $draft.model)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Lokalizacja magazynowa").font(.caption).foregroundStyle(.secondary)
                            Picker("Lokalizacja", selection: $draft.locationId) {
                                Text("Nieokreślona").tag("")
                                ForEach(store.locations) { Text($0.name).tag($0.id) }
                            }.labelsHidden()
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Miniaturka").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Button("Wybierz zdjęcie…", systemImage: "photo") { importingThumb = true }
                                if !draft.thumbnailUrl.isEmpty { Button("Usuń", role: .destructive) { draft.thumbnailUrl = "" } }
                            }
                        }
                    }
                    input("Opis", $draft.description, vertical: true)
                    input("Notatki", $draft.notes, vertical: true)
                } else {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        row("Nazwa", d.name)
                        row("Kategoria", store.categoryPath(d.categoryId))
                        row("Marka", d.brand)
                        row("Model", d.model)
                        row("Lokalizacja magazynowa", store.locations.first { $0.id == d.locationId }?.name ?? "Nieokreślona")
                    }
                    row("Opis", d.description)
                    row("Notatki", d.notes)
                }
            }
            if d.preCheckAvailable {
                TeamCard(title: "Sprawdzenie przed wydaniem") {
                    if editing {
                        Toggle("Tak — sprawdzić stan przed każdym wydaniem.", isOn: $draft.requiresPreCheck)
                        Text("Każde wydarzenie z tym sprzętem dostanie krok dla magazynu.").font(.caption).foregroundStyle(.secondary)
                        if draft.requiresPreCheck { input("Instrukcja sprawdzenia", $draft.preCheckInstructions, vertical: true) }
                    } else {
                        Text(d.requiresPreCheck ? "Tak — sprawdzić stan przed każdym wydaniem." : "Nie wymaga sprawdzenia przed wydaniem.")
                        if d.requiresPreCheck { Text(d.preCheckInstructions.isEmpty ? "Brak instrukcji sprawdzenia." : d.preCheckInstructions).foregroundStyle(.secondary) }
                    }
                }
            }
        }
    }

    // MARK: Parametry techniczne
    private func connectorName(_ id: String?) -> String { store.connectors.first { $0.id == id }?.name ?? "-" }
    private func connectorPicker(_ label: String, _ selection: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Picker(label, selection: selection) {
                Text(placeholder).tag("")
                ForEach(store.connectors.filter { $0.active != false || $0.id == selection.wrappedValue }) { Text($0.name).tag($0.id) }
            }.labelsHidden()
        }
    }
    private func technicalTab(_ d: EquipmentDetail) -> some View {
        let cable = d.cable != nil
        return TeamCard(title: "Parametry techniczne") {
            if editing {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    if cable {
                        input("Długość (m)", $draft.cableLength)
                        connectorPicker("Wtyk wejściowy", Binding(get: { store.connectors.first { $0.name == draft.connectorIn }?.id ?? "" },
                                                                   set: { id in draft.connectorIn = store.connectors.first { $0.id == id }?.name ?? "" }), placeholder: "Wybierz wtyk")
                        connectorPicker("Wtyk wyjściowy", Binding(get: { store.connectors.first { $0.name == draft.connectorOut }?.id ?? "" },
                                                                   set: { id in draft.connectorOut = store.connectors.first { $0.id == id }?.name ?? "" }), placeholder: "Wybierz wtyk")
                    } else {
                        input("Waga (kg)", $draft.weight)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Wymiary (cm)").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                TextField("", text: $draft.length, prompt: Text("Długość")).textFieldStyle(.roundedBorder)
                                TextField("", text: $draft.width, prompt: Text("Szerokość")).textFieldStyle(.roundedBorder)
                                TextField("", text: $draft.height, prompt: Text("Wysokość")).textFieldStyle(.roundedBorder)
                            }
                        }
                        input("Numer seryjny", $draft.serialNumber)
                        input("Kod kreskowy", $draft.barcode)
                        input("Instrukcja obsługi (URL)", $draft.manualUrl, prompt: "https://")
                    }
                }
            } else {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    if cable {
                        row("Długość (m)", d.cable?.lengthMeters.map { "\(WarehouseLabels.number($0)) m" } ?? "")
                        row("Wtyk wejściowy", d.cable?.connectorIn ?? "")
                        row("Wtyk wyjściowy", d.cable?.connectorOut ?? "")
                    } else {
                        row("Waga (kg)", d.weightKg.map { "\(WarehouseLabels.number($0)) kg" } ?? "")
                        row("Wymiary (cm)", d.dimensions.map { "\(WarehouseLabels.number($0.length).nonEmpty ?? "-") × \(WarehouseLabels.number($0.width).nonEmpty ?? "-") × \(WarehouseLabels.number($0.height).nonEmpty ?? "-") cm" } ?? "")
                        row("Numer seryjny", d.serialNumber)
                        row("Kod kreskowy", d.barcode)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Instrukcja obsługi").font(.caption).foregroundStyle(.secondary)
                            if let url = URL(string: d.manualUrl), !d.manualUrl.isEmpty { Link(destination: url) { Label("Otwórz instrukcję", systemImage: "doc.text") } }
                            else { Text("-") }
                        }
                    }
                }
            }
            Divider().padding(.vertical, 4)
            Text("Specyfikacja prądowa").font(.headline.weight(.regular))
            if editing {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    input("Pobór mocy (W)", $draft.watts, prompt: "np. 750")
                    input("Prąd (A)", $draft.amps, prompt: "np. 3.2")
                    input("Napięcie (V)", $draft.volts, prompt: "230")
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Typ zasilania").font(.caption).foregroundStyle(.secondary)
                        Picker("Typ zasilania", selection: $draft.phase) { Text("1-fazowe").tag("single_phase"); Text("3-fazowe").tag("three_phase") }
                            .pickerStyle(.segmented).labelsHidden()
                    }
                    connectorPicker("Wejście zasilania", $draft.inputConnectorId, placeholder: "Wybierz wtyk wejściowy")
                    connectorPicker("Wyjście zasilania", $draft.outputConnectorId, placeholder: "Wybierz wtyk wyjściowy")
                }
                input("Uwagi do zasilania", $draft.powerNotes, vertical: true)
            } else {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    row("Pobór mocy (W)", d.power.watts.map { "\(WarehouseLabels.number($0)) W" } ?? "")
                    row("Prąd (A)", d.power.amps.map { "\(WarehouseLabels.number($0)) A" } ?? "")
                    row("Napięcie (V)", d.power.volts.map { "\(WarehouseLabels.number($0)) V" } ?? "")
                    row("Typ zasilania", d.power.phase == "three_phase" ? "3-fazowe" : "1-fazowe")
                    row("Wejście zasilania", d.power.inputConnectorId == nil ? "" : connectorName(d.power.inputConnectorId))
                    row("Wyjście zasilania", d.power.outputConnectorId == nil ? "" : connectorName(d.power.outputConnectorId))
                }
                row("Uwagi do zasilania", d.power.notes)
            }
        }
    }

    // MARK: Informacje zakupowe
    private func purchaseTab(_ d: EquipmentDetail) -> some View {
        let price = editing ? (Double(draft.purchasePrice.replacingOccurrences(of: ",", with: ".")) ?? nil) : d.purchasePrice
        let date = editing ? draft.purchaseDate.map(DayDates.string) ?? "" : d.purchaseDate
        let rate = editing ? Double(draft.depreciationRate.replacingOccurrences(of: ",", with: ".")) : d.depreciationRate
        let current = EquipmentDetail.depreciated(price: price, date: date, rate: rate)
        return VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Informacje zakupowe") {
                if editing {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        OptionalDateField(title: "Data zakupu", date: $draft.purchaseDate)
                        OptionalDateField(title: "Gwarancja do", date: $draft.warrantyUntil)
                        input("Cena zakupu (zł)", $draft.purchasePrice)
                        input("Cena wynajmu za dzień (zł)", $draft.rentalPrice)
                        input("Stawka amortyzacji (% rocznie)", $draft.depreciationRate)
                    }
                } else {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        row("Data zakupu", DayDates.display(d.purchaseDate))
                        row("Gwarancja do", DayDates.display(d.warrantyUntil))
                        row("Cena zakupu (zł)", d.purchasePrice.map { WarehouseLabels.money($0) } ?? "")
                        row("Cena wynajmu za dzień (zł)", d.rentalPricePerDay.map { WarehouseLabels.money($0) } ?? "")
                        row("Stawka amortyzacji", d.depreciationRate.map { "\(WarehouseLabels.number($0))%" } ?? "10% (domyślnie)")
                    }
                }
            }
            TeamCard(title: "Amortyzacja") {
                if let price, let current {
                    HStack(spacing: 24) {
                        row("Cena zakupu", WarehouseLabels.money(price))
                        row("Łączna amortyzacja", WarehouseLabels.money(price - current))
                        row("Wartość bieżąca", WarehouseLabels.money(current))
                    }
                } else {
                    Text("Podaj cenę i datę zakupu, aby wyliczyć wartość bieżącą.").foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Jednostki
    @ViewBuilder private func unitsTab(_ d: EquipmentDetail) -> some View {
        if d.simpleStock {
            TeamCard(title: "Ilość na stanie (szt.)") {
                if canEdit && !d.flags.readOnly {
                    HStack {
                        Stepper(value: $quantity, in: 0...100_000) { Text("\(quantity) szt.").font(.title3.monospacedDigit()) }
                        Spacer()
                        Button("Zapisz") {
                            Task { await store.run("Zapisywanie ilości…", "cableQuantity", ["equipmentId": .string(equipmentID), "quantity": .number(Double(quantity))], success: "Ilość zapisana", reload: equipmentID) }
                        }.buttonStyle(.borderedProminent).disabled(quantity == d.cableStockQuantity)
                    }
                } else {
                    Text("\(d.cableStockQuantity) szt.").font(.title3.monospacedDigit())
                }
            }
        } else {
            let editable = canEdit && !d.flags.readOnly && !d.flags.disableUnits
            TeamCard(title: "Zarządzanie jednostkami") {
                HStack(spacing: 14) {
                    stat("Dostępne", d.units.filter { $0.status == "available" }.count, CrmTheme.rgb(0x4ade80))
                    stat("Uszkodzone", d.units.filter { $0.status == "damaged" }.count, CrmTheme.rgb(0xf87171))
                    stat("Serwis", d.units.filter { $0.status == "in_service" }.count, CrmTheme.rgb(0xfb923c))
                    stat("Wycofane", d.units.filter { $0.status == "retired" }.count, .secondary)
                    Spacer()
                    if editable && !selectedUnits.isEmpty {
                        Button("Duplikuj zaznaczone (\(selectedUnits.count))") {
                            let ids = Array(selectedUnits)
                            Task { await store.run("Duplikowanie…", "unitDuplicate", ["ids": .array(ids.map { .string($0) })], success: "Zduplikowano \(ids.count) jednostek", reload: equipmentID); selectedUnits = [] }
                        }
                        Button("Usuń zaznaczone (\(selectedUnits.count))", role: .destructive) { removingUnits = Array(selectedUnits) }
                    }
                    if editable { Button { unitEditor = UnitEditorRequest(unit: nil) } label: { Label("Dodaj jednostkę", systemImage: "plus") }.buttonStyle(.borderedProminent) }
                }
                if d.units.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "shippingbox").font(.system(size: 32)).foregroundStyle(.tertiary)
                        Text("Brak jednostek").foregroundStyle(.secondary)
                        if editable { Button("Dodaj pierwszą jednostkę sprzętu") { unitEditor = UnitEditorRequest(unit: nil) } }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
                }
                ForEach(d.units) { unit in unitRow(unit, editable: editable, hideEvents: d.flags.hideEvents) }
            }
        }
    }

    private func stat(_ label: String, _ value: Int, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(value)").font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func unitRow(_ u: EquipmentUnit, editable: Bool, hideEvents: Bool) -> some View {
        let color = WarehouseLabels.unitStatusColor(u.status)
        return HStack(alignment: .top, spacing: 12) {
            if editable {
                Toggle("", isOn: Binding(get: { selectedUnits.contains(u.id) }, set: { on in if on { selectedUnits.insert(u.id) } else { selectedUnits.remove(u.id) } }))
                    .toggleStyle(.checkbox).labelsHidden()
            }
            WarehouseThumb(url: u.thumbnailUrl, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(u.serial.isEmpty ? "Brak numeru seryjnego" : u.serial).fontWeight(.medium).foregroundStyle(u.serial.isEmpty ? Color.secondary : Color.primary)
                    Text(WarehouseLabels.unitStatus(u.status)).font(.caption.weight(.medium)).padding(.horizontal, 7).padding(.vertical, 2)
                        .background(color.opacity(0.18), in: Capsule()).foregroundStyle(color)
                }
                HStack(spacing: 14) {
                    Text("Lokalizacja: \(u.locationName.isEmpty ? "Brak lokalizacji" : u.locationName)")
                    if !u.purchaseDate.isEmpty { Text("Zakup: \(DayDates.display(u.purchaseDate))") }
                    if !u.lastServiceDate.isEmpty { Text("Ostatni serwis: \(DayDates.display(u.lastServiceDate))") }
                    if u.status == "damaged" && !u.repairDate.isEmpty { Text("Naprawa do: \(DayDates.display(u.repairDate))") }
                }
                .font(.caption).foregroundStyle(.secondary)
                if !u.notes.isEmpty { Text("Notatki: \(u.notes)").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Menu {
                if !hideEvents { Button("Historia zdarzeń", systemImage: "clock") { eventsFor = u } }
                if editable {
                    Button("Edytuj", systemImage: "pencil") { unitEditor = UnitEditorRequest(unit: u) }
                    Button("Duplikuj jednostkę", systemImage: "doc.on.doc") {
                        Task { await store.run("Duplikowanie…", "unitDuplicate", ["id": .string(u.id)], success: "Jednostka zduplikowana", reload: equipmentID) }
                    }
                    Divider()
                    Button("Usuń", systemImage: "trash", role: .destructive) { removingUnits = [u.id] }
                }
            } label: { Image(systemName: "ellipsis") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Historia
    private func historyTab(_ d: EquipmentDetail) -> some View {
        TeamCard(title: "Historia zmian") {
            if d.history.isEmpty { Text("Brak historii zmian").foregroundStyle(.secondary) }
            ForEach(d.history) { h in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(WarehouseLabels.field(h.field)).fontWeight(.medium)
                        Spacer()
                        Text([h.author, h.at.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy HH:mm") } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 1) { Text("Było:").font(.caption).foregroundStyle(.secondary); Text(h.oldValue.isEmpty ? "—" : h.oldValue).font(.callout).lineLimit(4) }
                        VStack(alignment: .leading, spacing: 1) { Text("Jest:").font(.caption).foregroundStyle(.secondary); Text(h.newValue.isEmpty ? "—" : h.newValue).font(.callout).lineLimit(4) }
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}
