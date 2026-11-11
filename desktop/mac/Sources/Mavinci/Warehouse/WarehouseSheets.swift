import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Okna magazynu — nowy sprzęt, jednostka (dodawanie kilku sztuk naraz, edycja) i historia zdarzeń jednostki
// (`UnitsTab`, `UnitEventsModal` w CRM).

@MainActor struct NewEquipmentSheet: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var brand = ""
    @State private var model = ""
    @State private var categoryId = ""
    @State private var locationId = ""
    @State private var description = ""
    @State private var thumbnailUrl = ""
    @State private var units = 1
    @State private var importing = false
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Dodaj sprzęt").font(.title2.bold()); Spacer() }.padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                TextField("Nazwa *", text: $name)
                Picker("Kategoria", selection: $categoryId) {
                    Text("Brak").tag("")
                    ForEach(store.categoryTree) { c in Text(String(repeating: "   ", count: max(0, c.level - 1)) + c.name).tag(c.id) }
                }
                TextField("Marka", text: $brand)
                TextField("Model", text: $model)
                Picker("Lokalizacja magazynowa", selection: $locationId) {
                    Text("Nieokreślona").tag("")
                    ForEach(store.locations) { Text($0.name).tag($0.id) }
                }
                TextField("Opis", text: $description, axis: .vertical).lineLimit(2...6)
                HStack {
                    Text("Miniaturka")
                    Spacer()
                    if !thumbnailUrl.isEmpty { WarehouseThumb(url: thumbnailUrl, size: 36) }
                    Button(thumbnailUrl.isEmpty ? "Wybierz zdjęcie…" : "Zmień…") { importing = true }
                }
                Stepper(value: $units, in: 0...200) { Text("Jednostki do utworzenia: \(units)") }
                Text("Pozostałe dane (parametry, zakup, numery seryjne) uzupełnisz na karcie sprzętu.").font(.caption).foregroundStyle(.secondary)
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Dodaj") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
        .frame(width: 520, height: 560)
        .background(theme.page)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result, let jpeg = ImageJPEG.from(url, maxSide: 1200) else { return }
            Task {
                do { thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-thumbnails") }
                catch { problem = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
            }
        }
    }

    private func save() async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { problem = "Nazwa jest wymagana."; return }
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.post("create", ["data": .object([
                "name": .string(name), "brand": .string(brand), "model": .string(model), "categoryId": .string(categoryId),
                "locationId": .string(locationId), "description": .string(description), "thumbnailUrl": .string(thumbnailUrl), "units": .number(Double(units)),
            ])])
            await store.sync(force: true)
            state.succeed("Sprzęt dodany")
            if let id = reply["id"]?.text.nonEmpty { store.openedID = id }
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się dodać sprzętu.")
        }
    }
}

@MainActor struct UnitEditorSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    let unit: EquipmentUnit?
    let requiresSerial: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var serial = ""
    @State private var status = "available"
    @State private var locationId = ""
    @State private var notes = ""
    @State private var purchaseDate: Date?
    @State private var lastServiceDate: Date?
    @State private var repairDate: Date?
    @State private var thumbnailUrl = ""
    @State private var count = 1
    @State private var importing = false
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text(unit == nil ? "Dodaj nową jednostkę" : "Edytuj jednostkę").font(.title2.bold()); Spacer() }
                .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                TextField(requiresSerial ? "Numer seryjny *" : "Numer seryjny", text: $serial, prompt: Text("Pozostaw puste dla sprzętu bez numeru seryjnego"))
                Picker("Status", selection: $status) { ForEach(WarehouseLabels.unitStatuses) { Text($0.label).tag($0.value) } }
                Picker("Lokalizacja", selection: $locationId) {
                    Text("Brak lokalizacji").tag("")
                    ForEach(store.locations) { Text($0.name).tag($0.id) }
                }
                OptionalDateField(title: "Data zakupu", date: $purchaseDate)
                OptionalDateField(title: "Ostatni serwis", date: $lastServiceDate)
                if status == "damaged" || status == "in_service" { OptionalDateField(title: "Szacowana data naprawy", date: $repairDate) }
                TextField("Notatki o stanie", text: $notes, axis: .vertical).lineLimit(2...5)
                HStack {
                    Text("Zdjęcie")
                    Spacer()
                    if !thumbnailUrl.isEmpty { WarehouseThumb(url: thumbnailUrl, size: 36) }
                    Button(thumbnailUrl.isEmpty ? "Dodaj zdjęcie" : "Zmień…") { importing = true }
                }
                if unit == nil {
                    Stepper(value: $count, in: 1...200) { Text("Ilość sztuk: \(count)") }
                    if count > 1 && !serial.isEmpty { Text("Numery: \(serial) #1 … \(serial) #\(count)").font(.caption).foregroundStyle(.secondary) }
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
        .frame(width: 500, height: 560)
        .background(theme.page)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            guard let unit else { return }
            serial = unit.serial; status = unit.status; locationId = unit.locationId ?? ""; notes = unit.notes
            purchaseDate = DayDates.parse(unit.purchaseDate); lastServiceDate = DayDates.parse(unit.lastServiceDate); repairDate = DayDates.parse(unit.repairDate)
            thumbnailUrl = unit.thumbnailUrl ?? ""
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result, let jpeg = ImageJPEG.from(url, maxSide: 1200) else { return }
            Task {
                do { thumbnailUrl = try await store.uploadImage(jpeg, folder: "equipment-thumbnails") }
                catch { problem = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
            }
        }
    }

    private func save() async {
        if requiresSerial && serial.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Ta kategoria wymaga numeru seryjnego."; return }
        let day: (Date?) -> JSONValue = { date in date.map { JSONValue.string(DayDates.string($0)) } ?? JSONValue.null }
        var body: [String: JSONValue] = [
            "equipmentId": .string(equipmentID), "count": .number(Double(count)),
            "data": .object([
                "serial": .string(serial), "status": .string(status), "locationId": .string(locationId), "notes": .string(notes),
                "purchaseDate": day(purchaseDate), "lastServiceDate": day(lastServiceDate), "repairDate": day(repairDate), "thumbnailUrl": .string(thumbnailUrl),
            ]),
        ]
        if let unit { body["id"] = .string(unit.id) }
        saving = true
        defer { saving = false }
        do {
            try await store.post("unitSave", body)
            await store.loadDetail(equipmentID)
            Task { await store.sync(force: true) }
            state.succeed(unit != nil ? "Jednostka zaktualizowana pomyślnie" : count > 1 ? "Dodano \(count) jednostek pomyślnie" : "Jednostka dodana pomyślnie")
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać jednostki.")
        }
    }
}

@MainActor struct UnitEventsSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    let unit: EquipmentUnit
    let canEdit: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var events: [UnitEvent]?
    @State private var type = "note"
    @State private var text = ""
    @State private var imageUrl = ""
    @State private var importing = false
    @State private var confirmingSale = false
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Historia zdarzeń").font(.title2.bold())
                    Text(unit.serial.isEmpty ? "Bez numeru seryjnego" : unit.serial).foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text("Aktualny status:").foregroundStyle(.secondary)
                        Text(WarehouseLabels.unitStatus(unit.status)).foregroundStyle(WarehouseLabels.unitStatusColor(unit.status))
                    }.font(.callout)
                }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if canEdit {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Nowe zdarzenie").font(.headline)
                    Picker("Typ zdarzenia", selection: $type) { ForEach(WarehouseLabels.eventTypes) { Text($0.label).tag($0.value) } }
                    TextField("Opis zdarzenia", text: $text, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
                    HStack {
                        Button(imageUrl.isEmpty ? "Dodaj zdjęcie" : "Zmień zdjęcie", systemImage: "photo") { importing = true }
                        if !imageUrl.isEmpty { WarehouseThumb(url: imageUrl, size: 32) }
                        Spacer()
                        Button(saving ? "Dodawanie…" : "Dodaj") {
                            if type == "sold" { confirmingSale = true } else { Task { await add() } }
                        }
                        .buttonStyle(.borderedProminent).disabled(saving || text.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                }
                .padding(12)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let events {
                        if events.isEmpty { Text("Brak zdarzeń").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(20) }
                        ForEach(events) { event in eventRow(event) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(20)
                    }
                }
            }
        }
        .padding(22)
        .frame(width: 560, height: 620)
        .background(theme.page)
        .task { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result, let jpeg = ImageJPEG.from(url, maxSide: 1600) else { return }
            Task {
                do { imageUrl = try await store.uploadImage(jpeg, folder: "equipment-events") }
                catch { problem = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
            }
        }
        .confirmationDialog("Oznaczyć jako sprzedaną?", isPresented: $confirmingSale, titleVisibility: .visible) {
            Button("Sprzedana — usuń jednostkę", role: .destructive) { Task { await add() } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz oznaczyć tę jednostkę jako sprzedaną? Jednostka zostanie usunięta z systemu.") }
    }

    private func eventRow(_ e: UnitEvent) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(WarehouseLabels.eventColor(e.type)).frame(width: 8, height: 8).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(WarehouseLabels.eventType(e.type)).fontWeight(.medium).foregroundStyle(WarehouseLabels.eventColor(e.type))
                    Spacer()
                    Text([e.author, e.at.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy HH:mm") } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(e.description).font(.callout).textSelection(.enabled)
                if let url = e.imageUrl.flatMap({ URL(string: $0) }) { Link(destination: url) { Label("Zdjęcie", systemImage: "photo") }.font(.caption) }
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func load() async {
        do { events = try await store.unitEvents(unit.id) }
        catch { events = []; problem = store.failureText(error, "Nie udało się pobrać zdarzeń.") }
    }

    private func add() async {
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.post("unitEvent", ["unitId": .string(unit.id), "type": .string(type), "description": .string(text), "imageUrl": .string(imageUrl)])
            state.succeed(reply["message"]?.text.nonEmpty ?? "Zdarzenie dodane")
            await store.loadDetail(equipmentID)
            Task { await store.sync(force: true) }
            if type == "sold" { dismiss(); return }
            text = ""; imageUrl = ""; type = "note"
            await load()
        } catch {
            problem = store.failureText(error, "Nie udało się dodać zdarzenia.")
        }
    }
}
