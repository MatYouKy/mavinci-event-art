import SwiftUI
import AppKit

/// Nowe spotkanie i edycja — pola jak w CRM (`NewMeetingModal`, `/crm/calendar/meeting/[id]`): rodzaj (firmowe / prywatne),
/// status, termin, cykl, miejsce, kolor, uczestnicy (pracownicy i kontakty), trzy przypomnienia i notatki.
@MainActor struct MeetingEditorSheet: View {
    @ObservedObject var store: MeetingsStore
    let request: MeetingEditorRequest
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    struct Guest: Hashable, Identifiable {
        var employeeId: String?
        var contactId: String?
        var name: String
        var id: String { employeeId.map { "e:\($0)" } ?? "c:\(contactId ?? "")" }
    }
    struct Reminder { var on: Bool; var minutes: Int }

    @State private var title = ""
    @State private var isPrivate = false
    @State private var status: MeetingStatus = .confirmed
    @State private var allDay = false
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var recurrence = 0
    @State private var scope = "single"
    @State private var locationText = ""
    @State private var locationId: String?
    @State private var places: [MeetingPlace] = []
    @State private var color = CrmTheme.rgb(0xd3bb73)
    @State private var guests: [Guest] = []
    @State private var contactQuery = ""
    @State private var contactResults: [MeetingPerson] = []
    @State private var alerts = [Reminder(on: true, minutes: 1440), Reminder(on: true, minutes: 120), Reminder(on: true, minutes: 30)]
    @State private var notes = ""
    @State private var saving = false
    @State private var problem: String?
    @State private var prepared = false
    /// Po wczytaniu pól: od tej chwili przesunięcie początku przesuwa koniec.
    @State private var ready = false
    /// Nazwa wybranej lokalizacji z bazy — zmiana tekstu odpina wybór.
    @State private var pickedPlace = ""

    private var editing: Meeting? { request.meeting }
    private var calendar: Calendar { MeetingDates.calendar }
    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && end >= start }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(editing == nil ? "Nowe spotkanie" : "Edytuj spotkanie").font(.title2.bold())
                Spacer()
            }.padding([.horizontal, .top], 20).padding(.bottom, 6)

            Form {
                Section {
                    TextField("Tytuł", text: $title, prompt: Text("np. Spotkanie z klientem"))
                    Picker("Rodzaj", selection: $isPrivate) {
                        Label("Firmowe", systemImage: "building.2").tag(false)
                        Label("Prywatne", systemImage: "lock").tag(true)
                    }.pickerStyle(.segmented)
                    Text(isPrivate ? "Widzisz je tylko Ty i zaproszeni uczestnicy — także administrator go nie zobaczy."
                         : "Widoczne w planie firmy dla osób z dostępem do kalendarza.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("Status", selection: $status) {
                        ForEach(MeetingStatus.allCases.filter { editing != nil || $0 != .cancelled }) { Text($0.label).tag($0) }
                    }.pickerStyle(.segmented)
                }

                Section("Termin") {
                    Toggle("Cały dzień", isOn: $allDay)
                    DatePicker("Początek", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                        .onChange(of: start) { old, new in
                            // Przesunięcie początku przesuwa koniec (zachowuje długość), jak w kalendarzach.
                            guard ready else { return }
                            end = max(new, end.addingTimeInterval(new.timeIntervalSince(old)))
                        }
                    DatePicker("Koniec", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    if let editing, editing.seriesId != nil {
                        Picker("Zakres zmian", selection: $scope) {
                            Text("Tylko to spotkanie").tag("single")
                            Text("To i kolejne spotkania").tag("future")
                        }
                        .onChange(of: scope) { _, _ in recurrence = editing.recurrenceDays }
                    }
                    Picker("Powtarzanie", selection: $recurrence) {
                        ForEach(meetingRecurrenceOptions) { Text($0.label).tag($0.value) }
                    }
                    .disabled(editing?.seriesId != nil && scope == "single")
                    if recurrence > 0 {
                        Text("\(meetingRecurrenceLabel(recurrence)) o \(MeetingDates.time(start)) (czas polski) — kolejne terminy pojawią się w planie automatycznie.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .environment(\.timeZone, MeetingDates.zone)

                Section("Miejsce") {
                    TextField("Lokalizacja", text: $locationText, prompt: Text("Wybierz lub wpisz lokalizację"))
                        .onChange(of: locationText) { _, text in if text != pickedPlace { locationId = nil } }
                    ForEach(places) { place in
                        Button {
                            pickedPlace = place.name; locationId = place.id; places = []
                            locationText = place.name
                        } label: {
                            HStack {
                                Image(systemName: "mappin.and.ellipse").foregroundStyle(theme.accent)
                                VStack(alignment: .leading) {
                                    Text(place.name)
                                    if let detail = place.detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    ColorPicker("Kolor", selection: $color, supportsOpacity: false)
                }

                Section("Uczestnicy") {
                    ForEach(guests) { guest in
                        HStack {
                            Image(systemName: guest.employeeId != nil ? "person" : "person.crop.rectangle").foregroundStyle(.secondary)
                            Text(guest.name)
                            Text(guest.employeeId != nil ? "Pracownik" : "Kontakt").font(.caption).foregroundStyle(.secondary)
                            if let editing, let id = guest.employeeId, let row = editing.participants.first(where: { $0.employeeId == id }), id != editing.createdBy {
                                let response = MeetingResponse(raw: row.response)
                                Text(response.label).font(.caption).foregroundStyle(response.color)
                            }
                            Spacer()
                            if guest.employeeId == nil || guest.employeeId != ownerId {
                                Button { guests.removeAll { $0.id == guest.id } } label: { Image(systemName: "minus.circle.fill") }
                                    .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń uczestnika")
                            } else {
                                Text("Organizator").font(.caption).foregroundStyle(theme.accent)
                            }
                        }
                    }
                    Menu {
                        ForEach(store.employees.filter { e in !guests.contains { $0.employeeId == e.id } }) { employee in
                            Button(employee.nickname?.isEmpty == false ? "\(employee.name) (\(employee.nickname!))" : employee.name) {
                                guests.append(Guest(employeeId: employee.id, contactId: nil, name: employee.label))
                            }
                        }
                    } label: {
                        Label("Dodaj pracownika", systemImage: "person.badge.plus")
                    }
                    .disabled(store.employees.isEmpty)
                    TextField("Dodaj kontakt", text: $contactQuery, prompt: Text("Wpisz imię lub nazwę kontaktu"))
                    ForEach(contactResults.filter { c in !guests.contains { $0.contactId == c.id } }) { contact in
                        Button {
                            guests.append(Guest(employeeId: nil, contactId: contact.id, name: contact.name))
                            contactQuery = ""; contactResults = []
                        } label: {
                            Label(contact.name, systemImage: "plus.circle").frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    if editing != nil && !guests.isEmpty {
                        Text("Zmiana terminu poprosi uczestników o ponowną odpowiedź.").font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Przypomnienia") {
                    alertRow("Alert 1", detail: "Wczesne przypomnienie o zaplanowanym spotkaniu.", index: 0)
                    alertRow("Alert 2", detail: "Dodatkowe przypomnienie bliżej rozpoczęcia.", index: 1)
                    alertRow("Alert krytyczny", detail: "Pilne przypomnienie tuż przed spotkaniem.", index: 2)
                }

                Section("Notatki") {
                    TextEditor(text: $notes).frame(minHeight: 90).font(.body)
                }

                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)

            HStack {
                if !valid && end < start { Text("Koniec nie może być przed początkiem.").font(.caption).foregroundStyle(.red) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(editing == nil ? "Utwórz spotkanie" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(!valid || saving)
            }.padding(16)
        }
        .frame(minWidth: 600, idealWidth: 640, minHeight: 640, idealHeight: 760)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: editing == nil ? "Tworzenie spotkania…" : "Zapisywanie spotkania…") } }
        .task {
            guard !prepared else { return }
            prepared = true
            prepare()
            DispatchQueue.main.async { ready = true }
            await store.loadEmployees()
        }
        .task(id: locationText) {
            guard locationId == nil, locationText.count >= 2 else { places = []; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let found = await store.searchLocations(locationText)
            if !Task.isCancelled && locationId == nil { places = Array(found.prefix(6)) }
        }
        .task(id: contactQuery) {
            guard contactQuery.count >= 2 else { contactResults = []; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let found = await store.searchContacts(contactQuery)
            if !Task.isCancelled { contactResults = Array(found.prefix(8)) }
        }
    }

    private var ownerId: String? { editing?.createdBy ?? store.employeeId }

    private func alertRow(_ label: String, detail: String, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: $alerts[index].on) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(index == 2 ? CrmTheme.rgb(0xf87171) : theme.text)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }.toggleStyle(.switch)
            if alerts[index].on {
                Picker("Czas przed rozpoczęciem", selection: $alerts[index].minutes) {
                    ForEach(meetingAlertOptions) { Text($0.label).tag($0.value) }
                }
            }
        }
    }

    private func prepare() {
        if let m = editing {
            title = m.title; isPrivate = m.isPrivate; status = m.meetingStatus; allDay = m.allDay
            start = m.startDate; end = m.endDate; recurrence = m.recurrenceDays
            locationText = m.locationText.isEmpty ? m.locationName : m.locationText
            if m.locationId != nil { pickedPlace = locationText; locationId = m.locationId }
            color = m.tint; notes = m.notes
            guests = m.participants.map { Guest(employeeId: $0.employeeId, contactId: $0.contactId, name: $0.name) }
            alerts = [Reminder(on: m.alert1 != nil, minutes: m.alert1 ?? 60), Reminder(on: m.alert2 != nil, minutes: m.alert2 ?? 120),
                      Reminder(on: m.alertCritical != nil, minutes: m.alertCritical ?? 30)]
        } else {
            let base = request.start ?? defaultStart()
            start = base
            end = request.end.flatMap { $0 > base ? $0 : nil } ?? base.addingTimeInterval(3600)
        }
    }
    /// Domyślny termin nowego spotkania: najbliższa pełna godzina.
    private func defaultStart() -> Date {
        let now = Date()
        let hour = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return calendar.date(byAdding: .hour, value: 1, to: hour) ?? now
    }

    private func hex(_ color: Color) -> String {
        guard let rgb = NSColor(color).usingColorSpace(.sRGB) else { return "#d3bb73" }
        let r = Int((rgb.redComponent * 255).rounded()), g = Int((rgb.greenComponent * 255).rounded()), b = Int((rgb.blueComponent * 255).rounded())
        return String(format: "#%02x%02x%02x", max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    }

    private func save() async {
        guard valid, !saving else { return }
        problem = nil
        let from: Date
        let to: Date
        if allDay {
            from = calendar.startOfDay(for: start)
            let last = calendar.startOfDay(for: max(end, start))
            to = calendar.date(byAdding: .second, value: 86_399, to: last) ?? last
        } else {
            from = start; to = max(end, start)
        }
        func minutes(_ alert: Reminder) -> JSONValue { alert.on ? .number(Double(alert.minutes)) : .null }
        let trimmedLocation = locationText.trimmingCharacters(in: .whitespacesAndNewlines)
        var data: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "datetime_start": .string(MeetingDates.iso(from)),
            "datetime_end": .string(MeetingDates.iso(to)),
            "is_all_day": .bool(allDay),
            "is_private": .bool(isPrivate),
            "status": .string(status.rawValue),
            "color": .string(hex(color)),
            "notes": notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(notes.trimmingCharacters(in: .whitespacesAndNewlines)),
            "location_text": trimmedLocation.isEmpty ? .null : .string(trimmedLocation),
            "location_id": locationId.map { JSONValue.string($0) } ?? JSONValue.null,
            "alert_1_minutes": minutes(alerts[0]),
            "alert_2_minutes": minutes(alerts[1]),
            "alert_critical_minutes": minutes(alerts[2]),
        ]
        if editing != nil { data["updated_at"] = .string(MeetingDates.iso(Date())) }
        let participants: [JSONValue] = guests.compactMap { guest in
            if let e = guest.employeeId { return .object(["employee_id": .string(e)]) }
            if let c = guest.contactId { return .object(["contact_id": .string(c)]) }
            return nil
        }
        let days = editing?.seriesId != nil && scope == "single" ? (editing?.recurrenceDays ?? 0) : recurrence
        saving = true
        defer { saving = false }
        do {
            let id = try await store.save(id: editing?.id, data: data, participants: participants, recurrenceDays: days,
                                          scope: editing == nil ? "single" : scope)
            state.succeed(editing == nil ? "Spotkanie zostało utworzone" : "Spotkanie zostało zaktualizowane")
            if let id { store.focusID = id }
            dismiss()
        } catch let failure as NativeFailure {
            problem = failure.message
        } catch {
            problem = error is URLError ? "Brak połączenia z serwerem CRM. Spróbuj ponownie." : "Nie udało się zapisać spotkania."
        }
    }
}
