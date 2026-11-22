import SwiftUI

// MARK: „Edytuj event” (`EditEventModalNew`): nazwa, klient (okno „Edytuj klienta” jak w Szczegółach), kategoria, firma
// realizująca, termin z informacją o nietypowych dniach, lokalizacja z salami, budżet (z obszarem „kwoty”) i status. Zapis jak
// w CRM — jedna aktualizacja wydarzenia (`editEvent` w `src/lib/native/eventCreate.ts`, RLS jak w przeglądarce).

private struct EventEditSetup: Decodable {
    struct Fields: Decodable {
        var name: String
        var categoryId: String?
        var companyId: String?
        var start: String?
        var end: String?
        var location: String
        var locationId: String?
        var roomIds: [String]
        var stageRoomId: String?
        var status: String
        var budget: String
        var hadBudget: Bool
    }
    struct Client: Decodable {
        var type: String
        var organization: String?
        var contact: String?
    }
    var event: Fields
    var canEditBudget: Bool
    var client: Client
    var categories: [EventCreateSetup.Category]
    var companies: [EventCreateSetup.Company]
    var locations: [EventLocationOption]
}

@MainActor struct EventEditSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var setup: EventEditSetup?
    @State private var loadError: String?
    @State private var name = ""
    @State private var categoryID = ""
    @State private var companyID = ""
    @State private var start = Date()
    @State private var hasEnd = false
    @State private var end = Date()
    @State private var locationText = ""
    @State private var locationID: String?
    @State private var roomIDs: [String] = []
    @State private var stageRoomID: String?
    @State private var rooms: EventLocationRooms?
    @State private var budget = ""
    @State private var status = "inquiry"
    @State private var specialDays: EventSpecialDays?
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var saving = false
    @State private var editingClient = false
    @State private var addingLocation = false

    /// Statusy okna jak w CRM: etapy magazynu tylko jako bieżąca wartość (bez możliwości wyboru).
    private static let statuses = ["inquiry", "offer_to_send", "offer_sent", "offer_accepted", "in_progress", "completed", "cancelled", "invoiced"]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Edytuj event").font(.title2.bold())
                Spacer()
            }
            .padding(18)
            Divider()
            Group {
                if let setup { form(setup) }
                else if let loadError {
                    ContentUnavailableView {
                        Label("Nie można edytować eventu", systemImage: "calendar.badge.exclamationmark")
                    } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
                } else {
                    ProgressView("Ładowanie…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).lineLimit(3) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz zmiany") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || setup == nil || (locationID != nil && rooms == nil))
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 700, idealWidth: 760, minHeight: 720, idealHeight: 820)
        .task { await load() }
        .task(id: dateKey) { await loadSpecialDays() }
        .interactiveDismissDisabled(saving)
        .sheet(isPresented: $editingClient, onDismiss: { Task { await reloadClient() } }) {
            EventClientSheet(store: store, eventID: eventID).warehouseSheetStyle(state)
        }
        .sheet(isPresented: $addingLocation) {
            AddEventLocationSheet(store: store, eventID: eventID) { id in
                Task { await reloadLocations(select: id) }
            }
            .warehouseSheetStyle(state)
        }
    }

    private var dateKey: String { setup == nil ? "" : EventFormDates.day(start) + "|" + (hasEnd ? EventFormDates.day(end) : "") }

    private func form(_ setup: EventEditSetup) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                EventFormField("Nazwa eventu *", error: errors["name"]) {
                    TextField("Nazwa eventu", text: $name).textFieldStyle(.roundedBorder)
                }
                EventFormField("Klient") {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(setup.client.type == "individual" ? "Klient indywidualny" : "Klient biznesowy").font(.caption).foregroundStyle(.secondary)
                            Text([setup.client.organization, setup.client.contact].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? "Brak klienta")
                        }
                        Spacer()
                        Button("Zmień klienta…") { editingClient = true }
                    }
                    Text("Klient i osoby kontaktowe zapisują się od razu w oknie „Edytuj klienta”.").font(.caption).foregroundStyle(.secondary)
                }
                EventFormField("Kategoria", error: errors["category_id"]) {
                    Picker("Kategoria", selection: $categoryID) {
                        Text("Wybierz kategorię").tag("")
                        ForEach(setup.categories) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                }
                EventFormField("Firma realizująca", error: errors["my_company_id"]) {
                    Picker("Firma realizująca", selection: $companyID) {
                        if companyID.isEmpty || !setup.companies.contains(where: { $0.id == companyID }) { Text("—").tag(companyID) }
                        ForEach(setup.companies) { Text($0.name + ($0.nip.map { " · NIP \($0)" } ?? "")).tag($0.id) }
                    }
                    .labelsHidden()
                }
                HStack(alignment: .top, spacing: 14) {
                    EventFormField("Data rozpoczęcia *", error: errors["event_date"]) {
                        DatePicker("Data rozpoczęcia", selection: $start).labelsHidden()
                    }
                    EventFormField("Data zakończenia", error: errors["event_end_date"]) {
                        if hasEnd {
                            HStack {
                                DatePicker("Data zakończenia", selection: $end).labelsHidden()
                                Button { hasEnd = false } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Bez daty zakończenia")
                            }
                        } else {
                            Button("Dodaj datę zakończenia") { hasEnd = true; end = start.addingTimeInterval(6 * 3600) }
                        }
                    }
                }
                EventSpecialDaysNotice(days: specialDays)
                EventFormField("Lokalizacja *", error: errors["location"] ?? errors["location_id"]) {
                    if !locationText.isEmpty {
                        Label(locationText, systemImage: "mappin.circle.fill").font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                    }
                    EventLocationPicker(locations: setup.locations, selectedID: locationID, pick: { pickLocation($0) }, add: { addingLocation = true })
                    if locationID != nil && rooms == nil { ProgressView().controlSize(.small) }
                    EventRoomPicker(rooms: rooms, selected: $roomIDs, stage: $stageRoomID)
                    if let error = errors["location_room_ids"] ?? errors["stage_room_id"] { Text(error).font(.caption).foregroundStyle(.red) }
                }
                HStack(alignment: .top, spacing: 14) {
                    if setup.canEditBudget {
                        EventFormField("Budżet (PLN)", error: errors["budget"]) {
                            TextField("0.00", text: $budget).textFieldStyle(.roundedBorder)
                        }
                    }
                    EventFormField("Status", error: errors["status"]) {
                        Picker("Status", selection: $status) {
                            ForEach(Self.statuses, id: \.self) { Text(EventLabels.status($0)).tag($0) }
                            if ["in_preparation", "ready_for_live", "settled"].contains(setup.event.status) {
                                Text(EventLabels.status(setup.event.status) + " · status magazynu").tag(setup.event.status)
                            }
                        }
                        .labelsHidden()
                    }
                }
            }
            .padding(20)
            .disabled(saving)
        }
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.tabQuery(eventID, "details", "editSetup", as: EventEditSetup.self)
            apply(next)
            setup = next
            if let id = next.event.locationId { await loadRooms(id) }
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać danych eventu.")
        }
    }

    private func apply(_ next: EventEditSetup) {
        let fields = next.event
        name = fields.name
        categoryID = fields.categoryId ?? ""
        companyID = fields.companyId ?? ""
        start = fields.start.flatMap(MeetingDates.parse) ?? Date()
        if let endDate = fields.end.flatMap(MeetingDates.parse) { hasEnd = true; end = endDate } else { hasEnd = false; end = start }
        locationText = fields.location
        locationID = fields.locationId
        roomIDs = fields.roomIds
        stageRoomID = fields.stageRoomId
        budget = fields.budget
        status = fields.status
    }

    private func loadRooms(_ id: String) async {
        rooms = nil
        let loaded = (try? await store.tabQuery(eventID, "details", "rooms", ["locationId": id], as: EventLocationRooms.self))
            ?? EventLocationRooms(error: true, rooms: [])
        if locationID == id { rooms = loaded }
    }

    private func pickLocation(_ location: EventLocationOption) {
        let changed = locationID != location.id
        locationText = location.label
        locationID = location.id
        if changed {
            roomIDs = []
            stageRoomID = nil
            Task { await loadRooms(location.id) }
        }
    }

    private func reloadLocations(select id: String) async {
        guard let next = try? await store.tabQuery(eventID, "details", "editSetup", as: EventEditSetup.self) else { return }
        setup?.locations = next.locations
        if let location = next.locations.first(where: { $0.id == id }) { pickLocation(location) }
    }

    /// Po „Edytuj klienta” — klient w nagłówku okna (pozostałe pola bez zmian).
    private func reloadClient() async {
        guard let next = try? await store.tabQuery(eventID, "details", "editSetup", as: EventEditSetup.self) else { return }
        setup?.client = next.client
    }

    private func loadSpecialDays() async {
        guard setup != nil else { return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        specialDays = try? await state.events.specialDays(from: start, to: hasEnd ? end : nil)
    }

    /// „Zapisz zmiany” jak `handleSubmit` + `onSave` w CRM.
    private func save() async {
        problem = nil
        var local: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespaces).isEmpty { local["name"] = "Nazwa eventu jest wymagana" }
        if locationText.trimmingCharacters(in: .whitespaces).isEmpty { local["location"] = "Lokalizacja jest wymagana" }
        if hasEnd && end <= start { local["event_end_date"] = "Zakończenie musi być późniejsze niż rozpoczęcie eventu." }
        guard local.isEmpty else { errors = local; return }
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = [
            "name": .string(name), "category_id": .string(categoryID), "my_company_id": .string(companyID),
            "event_date": .string(MeetingDates.iso(start)), "event_end_date": hasEnd ? JSONValue.string(MeetingDates.iso(end)) : JSONValue.string(""),
            "location": .string(locationText), "location_id": .string(locationID ?? ""),
            "location_room_ids": .array(roomIDs.map { JSONValue.string($0) }), "stage_room_id": stageRoomID.map { JSONValue.string($0) } ?? JSONValue.null,
            "budget": .string(budget), "status": .string(status),
        ]
        do {
            try await store.tabAction(eventID, "details", "editEvent", body, reload: [], success: "Event zaktualizowany", pending: "Zapisywanie…")
            errors = [:]
            await store.load(eventID)
            await store.loadDetails(eventID)
            dismiss()
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            problem = failure.message
        } catch {
            problem = store.failureText(error, "Błąd podczas aktualizacji eventu")
        }
    }
}
