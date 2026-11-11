import SwiftUI
import AppKit

// MARK: Harmonogram — panel zasobów fazy (`PhaseResourcesPanel`), nowa faza (`AddPhaseModal`), edycja (`EditPhaseModal`),
// przypisanie pracownika (`AddPhaseAssignmentModal`, konflikty obsady) i pojazdu (`AddPhaseVehicleModal`).

private let phaseRoleLabels: [String: String] = ["technician": "Technik", "assistant": "Asystent", "specialist": "Specjalista", "coordinator": "Koordynator", "driver": "Kierowca"]
private func phaseRoleLabel(_ role: String) -> String { phaseRoleLabels[role] ?? EventRoleLabels.label(role) }

@MainActor struct PhaseResourcesPanel: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let phase: PhasesTabData.Phase
    let data: PhasesTabData
    var onAssign: () -> Void
    var onVehicle: () -> Void
    var onClose: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab = "employees"
    @State private var removing: (id: String, table: String, question: String)?

    private var assignments: [PhasesTabData.Assignment] { data.assignments.filter { $0.phaseId == phase.id } }
    private var vehicles: [PhasesTabData.PhaseVehicle] { data.phaseVehicles.filter { $0.phaseId == phase.id } }
    private var employees: [PhasesTabData.Person] {
        var seen = Set<String>()
        return (data.team + assignments.compactMap(\.employee)).filter { seen.insert($0.id).inserted }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(phase.name).font(.headline)
                    Text("\(TimelineText.short(phase.start)) - \(TimelineText.short(phase.end))").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { onClose() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            }
            .padding(14)
            .background((CrmTheme.hex(phase.colorHex) ?? .blue).opacity(0.08))
            Picker("", selection: $tab) {
                Text("Pracownicy (\(employees.count))").tag("employees")
                Text("Sprzęt (\(data.eventEquipment.count))").tag("equipment")
                Text("Pojazdy (\(vehicles.count))").tag("vehicles")
            }
            .pickerStyle(.segmented).labelsHidden().padding(10)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch tab {
                    case "equipment": equipmentList
                    case "vehicles": vehicleList
                    default: employeeList
                    }
                }
            }
            Text("Pokazuje zasoby przypisane do wydarzenia w czasie trwania tej fazy").font(.caption2).foregroundStyle(.tertiary).padding(10)
        }
        .confirmationDialog(removing?.question ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let item = removing { Task { await remove(item.id, item.table) } } }
            Button("Anuluj", role: .cancel) { removing = nil }
        }
    }

    private func addButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label("Przypisz do fazy", systemImage: "plus").frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent).padding(12)
    }

    private var employeeList: some View {
        VStack(alignment: .leading, spacing: 0) {
            addButton(onAssign)
            if employees.isEmpty { empty("person", "Brak pracowników w wydarzeniu") }
            ForEach(employees, id: \.id) { employee in
                let assignment = assignments.first { $0.employeeId == employee.id }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        EmployeeAvatarView(name: employee.name, url: employee.avatarUrl, crop: employee.avatar, size: 36)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(employee.name).font(.callout.weight(.medium))
                                if let assignment { statusIcon(assignment.status) }
                            }
                            if let assignment { Text(statusLabel(assignment.status)).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if let assignment {
                            Button { removing = (assignment.id, "event_phase_assignments", "Czy na pewno chcesz usunąć tego pracownika z fazy?") } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless).foregroundStyle(CrmTheme.rgb(0xf87171)).help("Usuń z fazy")
                        }
                    }
                    if let assignment { details(assignment) }
                }
                .padding(12)
                Divider().opacity(0.3)
            }
        }
    }

    @ViewBuilder private func details(_ a: PhasesTabData.Assignment) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            (Text("Przypisanie: ").fontWeight(.medium) + Text("\(TimelineText.short(a.start)) - \(TimelineText.short(a.end))"))
            if a.workStart != nil && a.workEnd != nil {
                (Text("Praca: ").fontWeight(.medium) + Text("\(TimelineText.short(a.workStart)) - \(TimelineText.short(a.workEnd))"))
                Text("Czas pracy: \(TimelineText.hoursMinutes(a.workStart, a.workEnd))").foregroundStyle(theme.accent)
            }
            if a.workStart == nil { Text("Przypisany do całej fazy").foregroundStyle(.secondary) }
            if let role = a.role?.nonEmpty {
                Text(phaseRoleLabel(role)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(theme.accent.opacity(0.2), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(theme.accent)
            }
            ForEach(a.acceptedConflicts, id: \.id) { conflict in
                VStack(alignment: .leading, spacing: 2) {
                    Label("Zaakceptowane nakładanie pracy", systemImage: "checkmark.shield").fontWeight(.medium).foregroundStyle(CrmTheme.rgb(0xbfdbfe))
                    Text(conflict.reason)
                    Text([conflict.by, TimelineText.full(conflict.acceptedAt)].compactMap { $0 }.joined(separator: " · ")).font(.caption2).foregroundStyle(.tertiary)
                }
                .padding(8).background(CrmTheme.rgb(0x3b82f6).opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .font(.caption).foregroundStyle(Color.primary.opacity(0.75))
    }

    private var equipmentList: some View {
        VStack(alignment: .leading, spacing: 0) {
            if data.eventEquipment.isEmpty { empty("shippingbox", "Brak sprzętu w tej fazie") }
            ForEach(Array(data.eventEquipment.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 10) {
                    Image(systemName: "shippingbox").foregroundStyle(theme.accent).frame(width: 32, height: 32).background(theme.accent.opacity(0.2), in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.name).font(.callout.weight(.medium))
                        Text("\(item.kind) • Ilość: \(TimelineText.number(item.quantity ?? 1))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                Divider().opacity(0.3)
            }
        }
    }

    private var vehicleList: some View {
        VStack(alignment: .leading, spacing: 0) {
            addButton(onVehicle)
            if vehicles.isEmpty { empty("car", "Brak pojazdów w tej fazie") }
            ForEach(vehicles) { vehicle in
                HStack(spacing: 10) {
                    Image(systemName: "car").foregroundStyle(theme.accent).frame(width: 32, height: 32).background(theme.accent.opacity(0.2), in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(vehicle.name).font(.callout.weight(.medium))
                        Text("\(TimelineText.short(vehicle.start)) - \(TimelineText.short(vehicle.end))").font(.caption).foregroundStyle(.secondary)
                        if let driver = vehicle.driver?.nonEmpty { Text("Kierowca: \(driver)").font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button { removing = (vehicle.id, "event_phase_vehicles", "Czy na pewno chcesz usunąć ten pojazd z fazy?") } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(CrmTheme.rgb(0xf87171)).help("Usuń pojazd z fazy")
                }
                .padding(12)
                Divider().opacity(0.3)
            }
        }
    }

    private func empty(_ symbol: String, _ text: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 36)).foregroundStyle(.tertiary)
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(28)
    }
    private func statusIcon(_ status: String) -> some View {
        switch status {
        case "accepted": return Image(systemName: "checkmark.circle").foregroundStyle(CrmTheme.rgb(0x4ade80))
        case "rejected": return Image(systemName: "xmark.circle").foregroundStyle(CrmTheme.rgb(0xf87171))
        default: return Image(systemName: "exclamationmark.circle").foregroundStyle(CrmTheme.rgb(0xfacc15))
        }
    }
    private func statusLabel(_ status: String) -> String { status == "accepted" ? "Zaakceptowane" : status == "rejected" ? "Odrzucone" : "Oczekuje" }

    private func remove(_ id: String, _ table: String) async {
        removing = nil
        do {
            try await store.mutate(eventID, table: table, action: "delete", rowID: id, reload: "phases",
                                   success: table == "event_phase_vehicles" ? "Pojazd usunięty z fazy" : "Pracownik usunięty z fazy", pending: "Usuwanie…")
        } catch {
            state.error = store.failureText(error, table == "event_phase_vehicles" ? "Nie udało się usunąć pojazdu z fazy" : "Nie udało się usunąć pracownika z fazy")
        }
    }
}

// MARK: Nowa faza

@MainActor struct AddPhaseSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: PhasesTabData
    var onCreated: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var typeID = ""
    @State private var name = ""
    @State private var description = ""
    @State private var automaticTravel = true
    @State private var timesSet = false
    @State private var start = Date()
    @State private var end = Date()
    @State private var endManual = false
    @State private var error: String?
    @State private var saving = false

    private var types: [PhasesTabData.PhaseType] { data.phaseTypes.sorted { $0.rank < $1.rank } }
    private var type: PhasesTabData.PhaseType? { data.phaseTypes.first { $0.id == typeID } }
    private var isTravel: Bool { [2.0, 6.0].contains(type?.rank ?? 0) }
    private var flexible: Bool { isTravel && automaticTravel && type?.durationHours == nil }
    private func typeLabel(_ type: PhasesTabData.PhaseType) -> String {
        let detail = [2.0, 6.0].contains(type.rank) ? "z logistyki" : type.durationHours.map { TimelineText.hours(Int(($0 * 60).rounded())) } ?? "oblicz trasę w logistyce"
        return "\(type.name) — \(detail)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj nową fazę").font(.title3.weight(.light))
            if let error {
                Label(error, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(CrmTheme.rgb(0xf87171))
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            Form {
                Picker("Typ fazy", selection: $typeID) {
                    Text("Wybierz typ fazy").tag("")
                    ForEach(types) { Text(typeLabel($0)).tag($0.id) }
                }
                .onChange(of: typeID) { oldValue, newValue in selectType(newValue, previous: oldValue) }
                TextField("Nazwa fazy", text: $name, prompt: Text(type?.name ?? "Wprowadź nazwę"))
                TextField("Opis (opcjonalnie)", text: $description, axis: .vertical).lineLimit(2...4)
                if isTravel {
                    Toggle("Pobierz czas trwania z logistyki", isOn: $automaticTravel).onChange(of: automaticTravel) { error = nil; recalculateEnd() }
                }
                if flexible {
                    Text("Możesz zapisać fazę bez godzin. Po obliczeniu trasy i zapisaniu pojazdu w Logistyce kliknij „Zastosuj czasy przejazdu z logistyki”. Faza pojawi się na osi, gdzie ustawisz jej rozpoczęcie.")
                        .font(.callout).foregroundStyle(Color.accentColor)
                } else if type != nil {
                    Text("Podpowiedź uwzględnia kolejność faz, zapisane terminy i domyślne czasy trwania brakujących faz. Możesz zmienić godziny przed zapisem.")
                        .font(.caption).foregroundStyle(.secondary)
                    if !timesSet {
                        Text("Brak wyliczonej trasy dla tej części harmonogramu. W Logistyce oblicz trasę i zapisz pojazd albo wpisz godziny ręcznie.")
                            .font(.callout).foregroundStyle(Color.accentColor)
                        Button("Wpisz godziny ręcznie") { start = MeetingDates.parse(data.event.start) ?? Date(); timesSet = true; recalculateEnd() }
                    }
                    if [6.0, 7.0].contains(type?.rank ?? 0) {
                        Text("Powrót zaczyna się po demontażu, a rozładunek po powrocie. Czasy aktualizują się automatycznie po zapisaniu trasy w logistyce lub zmianie demontażu.")
                            .font(.callout).foregroundStyle(Color.accentColor)
                    }
                    if isTravel, let hours = type?.durationHours, (type?.rank == 2 ? data.travel.outbound : data.travel.inbound) != nil {
                        Text("Planowany czas przejazdu: \(TimelineText.hours(Int((hours * 60).rounded()))), z zapasem i przerwami. Przy kilku pojazdach uwzględniamy najdłuższy przejazd.")
                            .font(.caption).foregroundStyle(Color.accentColor)
                    }
                    if timesSet {
                        DatePicker("Rozpoczęcie", selection: $start).onChange(of: start) { if !endManual { recalculateEnd() } }
                        HStack {
                            DatePicker("Zakończenie", selection: Binding(get: { end }, set: { end = $0; endManual = true }))
                                .disabled(automaticTravel && isTravel)
                            if let hours = type?.durationHours {
                                Button("Ustaw +" + TimelineText.hours(Int((hours * 60).rounded()), minutesInParentheses: false)) { endManual = false; recalculateEnd() }.buttonStyle(.link)
                            }
                        }
                        Label("Czas trwania: \(durationText)", systemImage: "clock").foregroundStyle(CrmTheme.rgb(0x60a5fa))
                    }
                }
            }
            .formStyle(.grouped)
            .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Tworzenie..." : "Utwórz fazę") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 540)
    }

    private var durationText: String {
        TimelineText.hours(Int((end.timeIntervalSince(start) / 60).rounded()))
    }
    private func selectType(_ id: String, previous: String) {
        automaticTravel = true
        guard let type = data.phaseTypes.first(where: { $0.id == id }) else { return }
        let previousName = data.phaseTypes.first { $0.id == previous }?.name
        if name.isEmpty || name == previousName { name = type.name }
        if let suggestion = data.suggestions[id] ?? nil, let from = MeetingDates.parse(suggestion.start), let to = MeetingDates.parse(suggestion.end) {
            start = from; end = to; timesSet = true
        } else {
            timesSet = false
        }
        endManual = false
        error = nil
    }
    private func recalculateEnd() {
        guard let hours = type?.durationHours, hours > 0 else { return }
        end = start.addingTimeInterval(hours * 3600)
    }

    private func save() async {
        error = nil
        guard let type else { error = "Wybierz typ fazy"; return }
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { error = "Podaj nazwę fazy"; return }
        let key = type.rank == 2 ? "outbound" : "inbound"
        saving = true
        defer { saving = false }
        if flexible {
            do {
                try await store.rpcRun(eventID, "save_flexible_travel_phase", [
                    "p_event_id": .string(eventID), "p_key": .string(key), "p_name": .string(title),
                    "p_description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
                ], reload: "phases", success: "Faza oczekuje na estymację trasy. Po jej zapisaniu zastosuj czasy w Timeline.")
                onCreated(type.name)
                dismiss()
            } catch { self.error = store.failureText(error, "Nie udało się zapisać fazy elastycznej") }
            return
        }
        guard timesSet else { error = "Podaj czas rozpoczęcia i zakończenia"; return }
        let finalEnd = isTravel && automaticTravel ? (type.durationHours.map { start.addingTimeInterval($0 * 3600) } ?? end) : end
        guard finalEnd > start else { error = "Czas zakończenia musi być późniejszy niż rozpoczęcie"; return }
        let overlap = data.phases.contains { (start >= $0.startDate && start < $0.endDate) || (finalEnd > $0.startDate && finalEnd <= $0.endDate) || (start <= $0.startDate && finalEnd >= $0.endDate) }
        guard !overlap else { error = "Ta faza nakłada się z istniejącą fazą. Zmień czas."; return }
        do {
            var fields: [String: JSONValue] = [
                "phase_type_id": .string(type.id), "name": .string(name), "start_time": .string(MeetingDates.iso(start)),
                "end_time": .string(MeetingDates.iso(finalEnd)), "sequence_order": .number(Double(data.phases.count + 1)),
            ]
            if !description.isEmpty { fields["description"] = .string(description) }
            try await store.mutate(eventID, table: "event_phases", action: "insert", data: fields, reload: "phases", success: "Faza została utworzona")
            if isTravel && automaticTravel {
                do {
                    _ = try await store.rpc("save_flexible_travel_phase", ["p_event_id": .string(eventID), "p_key": .string(key), "p_name": .null, "p_description": .string("")])
                } catch {
                    state.notice = "Faza jest na osi. Nie udało się usunąć jej wcześniejszego wpisu oczekującego."
                }
            }
            onCreated(type.name)
            dismiss()
        } catch {
            self.error = store.failureText(error, "Błąd podczas tworzenia fazy")
        }
    }
}

// MARK: Edycja fazy (nazwa, opis, kolor)

@MainActor struct EditPhaseSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let phase: PhasesTabData.Phase
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var description = ""
    @State private var color = "#3b82f6"
    @State private var custom = ""
    @State private var saving = false

    private static let presets: [(String, String)] = [
        ("Niebieski", "#3b82f6"), ("Zielony", "#10b981"), ("Żółty", "#f59e0b"), ("Czerwony", "#ef4444"), ("Fioletowy", "#8b5cf6"),
        ("Różowy", "#ec4899"), ("Złoty", "#d3bb73"), ("Pomarańczowy", "#f97316"), ("Turkusowy", "#14b8a6"), ("Indygo", "#6366f1"),
    ]
    private var finalColor: String { custom.nonEmpty ?? color }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Edytuj fazę", systemImage: "paintpalette").font(.title3.weight(.light))
            VStack(alignment: .leading, spacing: 4) {
                Text("Nazwa fazy").font(.callout)
                TextField("np. Załadunek, Realizacja, Rozładunek", text: $name).textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Opis (opcjonalny)").font(.callout)
                TextField("Dodatkowe informacje o fazie", text: $description, axis: .vertical).lineLimit(3...5).textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Kolor fazy").font(.callout)
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(40), spacing: 8), count: 5), spacing: 8) {
                    ForEach(Self.presets, id: \.1) { preset in
                        Button { color = preset.1; custom = "" } label: {
                            RoundedRectangle(cornerRadius: 8).fill(CrmTheme.hex(preset.1) ?? .blue).frame(width: 40, height: 32)
                                .scaleEffect(color == preset.1 && custom.isEmpty ? 1.12 : 1)
                                .shadow(color: color == preset.1 && custom.isEmpty ? theme.accent : .clear, radius: 3)
                        }
                        .buttonStyle(.plain).help(preset.0)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Własny kolor (opcjonalnie)").font(.callout)
                HStack {
                    ColorPicker("", selection: Binding(get: { CrmTheme.hex(finalColor) ?? .blue }, set: { custom = CrmTheme.hexString($0) })).labelsHidden()
                    TextField("#3b82f6", text: Binding(get: { finalColor }, set: { custom = $0 })).textFieldStyle(.roundedBorder).frame(width: 120)
                }
            }
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8).fill((CrmTheme.hex(finalColor) ?? .blue).opacity(0.2)).frame(height: 44)
                    .overlay(alignment: .leading) { Rectangle().fill(CrmTheme.hex(finalColor) ?? .blue).frame(width: 4) }
                    .overlay { Text(name.nonEmpty ?? "Podgląd").font(.callout.weight(.semibold)) }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie..." : "Zapisz zmiany") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 440)
        .onAppear {
            name = phase.name
            description = phase.description ?? ""
            color = phase.colorHex
            custom = ""
        }
    }

    private func save() async {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { state.error = "Podaj nazwę fazy"; return }
        saving = true
        defer { saving = false }
        var fields: [String: JSONValue] = ["name": .string(title), "color": .string(finalColor)]
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { fields["description"] = .string(text) }
        do {
            try await store.mutate(eventID, table: "event_phases", action: "update", rowID: phase.id, data: fields, reload: "phases", success: "Faza zaktualizowana")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas aktualizacji fazy")
        }
    }
}

// MARK: Pracownik na timeline (konflikty obsady i akceptacja z uzasadnieniem)

struct PhaseEmployeeOptions: Decodable {
    struct Employee: Decodable, Identifiable, Hashable { var id: String; var name: String; var surname: String; var email: String?; var avatarUrl: String?; var avatar: AvatarCrop?; var inTeam: Bool }
    struct Assigned: Decodable, Hashable { var phaseId: String; var employeeId: String }
    var employees: [Employee]
    var assigned: [Assigned]
}

struct PhaseConflictRow: Decodable, Hashable {
    var conflict_type: String
    var conflict_id: String
    var phase_name: String?
    var event_name: String?
    var assignment_start: String?
    var assignment_end: String?
    var conflict_status: String?
    var conflict_details: [String: JSONValue]?
    var requestedPhase: String?
    static func == (a: Self, b: Self) -> Bool { a.conflict_type == b.conflict_type && a.conflict_id == b.conflict_id && a.requestedPhase == b.requestedPhase }
    func hash(into hasher: inout Hasher) { hasher.combine(conflict_type); hasher.combine(conflict_id); hasher.combine(requestedPhase) }
}

@MainActor struct AddPhaseAssignmentSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let phase: PhasesTabData.Phase
    let phases: [PhasesTabData.Phase]
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var options: PhaseEmployeeOptions?
    @State private var search = ""
    @State private var employee: PhaseEmployeeOptions.Employee?
    @State private var selected: Set<String> = []
    @State private var allPhases = false
    @State private var role = "technician"
    @State private var conflicts: [PhaseConflictRow] = []
    @State private var checking = false
    @State private var accept = false
    @State private var reason = ""
    @State private var saving = false

    private static let roles: [(String, String)] = [("technician", "Technik"), ("dj", "DJ"), ("konferansjer", "Konferansjer"), ("assistant", "Asystent"),
                                                    ("specialist", "Specjalista"), ("coordinator", "Koordynator"), ("driver", "Kierowca")]
    private var existing: Set<String> {
        guard let employee else { return [] }
        return Set((options?.assigned ?? []).filter { $0.employeeId == employee.id }.map(\.phaseId))
    }
    private var toAssign: [PhasesTabData.Phase] { phases.filter { !existing.contains($0.id) && (allPhases || selected.contains($0.id)) } }
    private var absence: [PhaseConflictRow] { conflicts.filter { $0.conflict_type == "absence" } }
    private var realization: [PhaseConflictRow] { conflicts.filter { $0.conflict_type == "phase" } }
    private var filtered: [PhaseEmployeeOptions.Employee] {
        let sorted = (options?.employees ?? []).sorted { ($0.inTeam ? 0 : 1, "\($0.name) \($0.surname)") < ($1.inTeam ? 0 : 1, "\($1.name) \($1.surname)") }
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return sorted }
        return sorted.filter { "\($0.name) \($0.surname)".lowercased().contains(query) || ($0.email ?? "").lowercased().contains(query) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "person.badge.plus").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Dodaj pracownika do timeline").font(.title3.weight(.light))
                    Text("Wybierz osobę i etapy, w których ma pracować").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if options == nil { ProgressView().frame(maxWidth: .infinity, minHeight: 120) }
                    else if let employee { selectedView(employee) }
                    else { picker }
                }
            }
            .frame(height: 480)
            if employee != nil {
                HStack {
                    Spacer()
                    Button("Anuluj") { dismiss() }
                    Button(submitLabel) { Task { await submit() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || checking)
                }
            }
        }
        .padding(20).frame(width: 600)
        .task {
            do { options = try await store.fetch(eventID, "phaseOptions", ["kind": "employees"], as: PhaseEmployeeOptions.self) }
            catch { state.error = store.failureText(error, "Nie udało się pobrać listy pracowników.") }
        }
        .task(id: conflictKey) { await loadConflicts() }
    }

    private var submitLabel: String {
        if saving { return "Przypisywanie..." }
        if checking { return "Sprawdzanie dostępności..." }
        if !realization.isEmpty && accept { return "Przypisz i zaakceptuj konflikt" }
        return "Przypisz do \(toAssign.count) \(toAssign.count == 1 ? "etapu" : "etapów")"
    }
    private var conflictKey: String { "\(employee?.id ?? "")|\(toAssign.map(\.id).sorted().joined(separator: ","))" }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(  "Wybierz pracownika", systemImage: "magnifyingglass").font(.callout.weight(.semibold))
                Spacer()
                let count = options?.employees.count ?? 0
                Text("\(count) \(count == 1 ? "pracownik" : "pracowników") w systemie").font(.caption).foregroundStyle(.secondary)
            }
            TextField("Wyszukaj pracownika po nazwisku lub e-mailu...", text: $search).textFieldStyle(.roundedBorder)
            if !search.isEmpty { Text("Znaleziono: \(filtered.count) \(filtered.count == 1 ? "pracownik" : "pracowników")").font(.caption).foregroundStyle(.secondary) }
            if filtered.isEmpty { Text("Nie znaleziono pracowników pasujących do wyszukiwania").foregroundStyle(.secondary).padding() }
            ForEach(filtered) { person in
                Button { choose(person) } label: {
                    HStack(spacing: 10) {
                        EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 34)
                        Text("\(person.name) \(person.surname)")
                        if person.inTeam {
                            Text("Zespół wydarzenia").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                                .background(CrmTheme.rgb(0x10b981).opacity(0.15), in: Capsule()).foregroundStyle(CrmTheme.rgb(0x6ee7b7))
                        }
                        Spacer()
                    }
                    .padding(8).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func choose(_ person: PhaseEmployeeOptions.Employee) {
        employee = person
        allPhases = false
        let assigned = Set((options?.assigned ?? []).filter { $0.employeeId == person.id }.map(\.phaseId))
        if let preferred = !assigned.contains(phase.id) ? phase.id : phases.first(where: { !assigned.contains($0.id) })?.id { selected = [preferred] } else { selected = [] }
    }

    private func selectedView(_ person: PhaseEmployeeOptions.Employee) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Wybrany pracownik").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 40)
                    Text("\(person.name) \(person.surname)").font(.callout.weight(.medium))
                    Spacer()
                    Button("Zmień") { employee = nil; conflicts = [] }.buttonStyle(.link)
                }
            }
            .padding(10).background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
            if !person.inTeam {
                Text("Ta osoba nie jest jeszcze w zespole wydarzenia. Przy zapisie otrzyma dostęp do eventu i zostanie dodana do wybranych etapów timeline.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0x93c5fd))
            }
            if checking { Text("Sprawdzam faktyczną obecność pracownika w wybranych etapach…").font(.caption).foregroundStyle(.secondary) }
            if !checking && !conflicts.isEmpty { conflictBox }
            Picker("Rola", selection: $role) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }
            if !phases.isEmpty {
                Label("Wybierz etapy timeline", systemImage: "calendar").font(.callout.weight(.semibold))
                Toggle(isOn: $allPhases) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Przypisz do wszystkich etapów timeline").fontWeight(.medium)
                        Text("Utworzy brakujące wpisy w \(phases.filter { !existing.contains($0.id) }.count) etapach").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox).padding(10).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                if !allPhases {
                    ForEach(phases) { item in
                        let done = existing.contains(item.id)
                        Toggle(isOn: Binding(get: { selected.contains(item.id) || done }, set: { on in if on { selected.insert(item.id) } else { selected.remove(item.id) } })) {
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(item.name)
                                    if done {
                                        Text("Już przypisany").font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                                            .background(CrmTheme.rgb(0x10b981).opacity(0.15), in: Capsule()).foregroundStyle(CrmTheme.rgb(0x6ee7b7))
                                    }
                                }
                                Text("\(TimelineText.full(item.start)) - \(TimelineText.full(item.end))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .toggleStyle(.checkbox).disabled(done)
                        .padding(8).background(selected.contains(item.id) ? theme.accent.opacity(0.1) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    private var conflictBox: some View {
        let blocked = !absence.isEmpty
        return VStack(alignment: .leading, spacing: 8) {
            Label(blocked ? "Nieobecność blokuje przypisanie do realizacji"
                  : "Nakładająca się praca na \(realization.count) \(realization.count == 1 ? "etapie" : "etapach")", systemImage: "exclamationmark.triangle")
                .font(.callout.weight(.semibold)).foregroundStyle(blocked ? CrmTheme.rgb(0xfca5a5) : CrmTheme.rgb(0xfde68a))
            Text("Konflikt wynika wyłącznie z godzin pracy na timeline. Autor, sprzedawca i osoby mające sam dostęp do innych wydarzeń nie są tutaj uwzględniane.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(conflicts, id: \.self) { conflict in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(conflict.conflict_type == "absence" ? "Nieobecność" : "Inna realizacja").font(.caption.weight(.semibold))
                        if let requested = conflict.requestedPhase { Text("Dotyczy: \(requested)").font(.caption2).foregroundStyle(.secondary) }
                        Spacer()
                        if let status = conflict.conflict_status, let label = ["approved": "Zatwierdzona", "pending": "Oczekuje", "accepted": "Zaakceptowana"][status] {
                            Text(label).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Text((conflict.event_name ?? "") + (conflict.phase_name.map { " — \($0)" } ?? "")).font(.caption)
                    Text("\(Self.date(conflict.assignment_start)) – \(Self.date(conflict.assignment_end))").font(.caption).foregroundStyle(.secondary)
                    if let role = conflict.conflict_details?["role"]?.text.nonEmpty { Text("Rola na drugiej realizacji: \(role)").font(.caption).foregroundStyle(.secondary) }
                }
                .padding(8).background((conflict.conflict_type == "absence" ? Color.red : Color.orange).opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
            }
            if !realization.isEmpty && absence.isEmpty {
                Toggle(isOn: $accept) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Akceptuję nakładanie się pracy").fontWeight(.medium)
                        Text("Potwierdzam, że przejazd, godziny obecności i zakres koordynacji zostały sprawdzone. Decyzja będzie widoczna w kontroli wydarzenia.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                if accept {
                    Text("Uzasadnienie i sposób podziału pracy").font(.caption.weight(.medium)).foregroundStyle(theme.accent)
                    TextField("Np. koordynuje oba wydarzenia, a na miejscu jest w godz. 18:00–20:00; pozostały czas przejmuje lider techniczny.", text: $reason, axis: .vertical)
                        .lineLimit(3...5).textFieldStyle(.roundedBorder)
                    Text("Minimum 10 znaków").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(12).background((blocked ? Color.red : Color.orange).opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    /// „14.11.2026, 18:00” (`toLocaleString` z rokiem, bez sekund).
    static func date(_ value: String?) -> String {
        guard let date = value.flatMap(MeetingDates.parse) else { return "—" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }

    private func loadConflicts() async {
        accept = false
        reason = ""
        guard let employee, !toAssign.isEmpty else { conflicts = []; checking = false; return }
        checking = true
        defer { checking = false }
        var unique: [String: PhaseConflictRow] = [:]
        do {
            for item in toAssign {
                let reply = try await store.rpc("get_employee_realization_conflicts", [
                    "p_employee_id": .string(employee.id), "p_event_id": .string(eventID), "p_phase_id": .string(item.id),
                ])
                for var row in (try? JSONDecoder().decode([PhaseConflictRow].self, from: reply)) ?? [] {
                    row.requestedPhase = item.name
                    unique["\(item.id):\(row.conflict_type):\(row.conflict_id)"] = row
                }
            }
            if Task.isCancelled { return }
            conflicts = Array(unique.values)
        } catch {
            if Task.isCancelled { return }
            conflicts = []
            state.error = "Nie udało się sprawdzić konfliktów obsady realizacyjnej"
        }
    }

    private func submit() async {
        guard let employee else { state.notice = "Wybierz pracownika"; return }
        guard !toAssign.isEmpty else { state.notice = "Wybierz co najmniej jeden etap timeline"; return }
        guard !checking else { state.notice = "Poczekaj na zakończenie sprawdzania dostępności"; return }
        guard absence.isEmpty else { state.error = "Pracownik ma nieobecność w godzinach wybranego etapu. Najpierw wyjaśnij nieobecność."; return }
        if !realization.isEmpty && !accept { state.notice = "Potwierdź świadomą akceptację konfliktu realizacyjnego"; return }
        if !realization.isEmpty && reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 { state.notice = "Opisz sposób rozdzielenia pracy (minimum 10 znaków)"; return }
        saving = true
        defer { saving = false }
        let accepted = !realization.isEmpty && accept
        do {
            let reply = try await store.rpcRun(eventID, "assign_event_employee_to_phases_with_conflict_decision", [
                "p_event_id": .string(eventID), "p_employee_id": .string(employee.id), "p_phase_ids": .array(toAssign.map { .string($0.id) }),
                "p_role": .string(role), "p_accept_conflicts": .bool(accepted),
                "p_conflict_reason": accepted ? .string(reason.trimmingCharacters(in: .whitespacesAndNewlines)) : .null,
            ], reload: "phases", success: nil)
            let count = (try? JSONDecoder().decode(Double.self, from: reply)).map { Int($0) } ?? toAssign.count
            state.succeed(accepted ? "Pracownik przypisany. Konflikt zaakceptowany i zapisany z uzasadnieniem."
                          : allPhases ? "Pracownik przypisany do wszystkich etapów timeline (\(count))"
                          : "Pracownik przypisany do \(count) \(count == 1 ? "etapu" : "etapów") timeline")
            Task { await store.loadTeam(eventID) }
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas przypisywania pracownika")
        }
    }
}

// MARK: Pojazd w fazach (rezerwacja z buforem, kierowca, cel, kolizje)

struct PhaseVehicleOptions: Decodable {
    struct Vehicle: Decodable, Identifiable, Hashable { var id: String; var name: String?; var brand: String?; var model: String?; var registration: String?; var status: String?; var assignedTo: String? }
    struct Person: Decodable, Identifiable, Hashable { var id: String; var name: String }
    struct Assigned: Decodable, Hashable { var phaseId: String; var vehicleId: String }
    var vehicles: [Vehicle]
    var employees: [Person]
    var assigned: [Assigned]
}

@MainActor struct AddPhaseVehicleSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let phase: PhasesTabData.Phase
    let phases: [PhasesTabData.Phase]
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var options: PhaseVehicleOptions?
    @State private var search = ""
    @State private var vehicleID = ""
    @State private var driverID = ""
    @State private var selected: Set<String> = []
    @State private var purpose = "Transport sprzętu"
    @State private var notes = ""
    @State private var before = 0
    @State private var after = 0
    @State private var conflicts: [Conflict] = []
    @State private var checking = false
    @State private var saving = false

    struct Conflict: Decodable, Hashable { var id: String; var label: String; var start: String; var end: String }
    private static let blocked: Set<String> = ["inactive", "in_service", "under_repair", "sold", "scrapped"]
    private static let purposes = ["Transport sprzętu", "Transport ekipy", "Transport gości lub klienta", "Obsługa techniczna", "Inne"]

    private var existing: Set<String> { Set((options?.assigned ?? []).filter { $0.vehicleId == vehicleID }.map(\.phaseId)) }
    private var chosen: [PhasesTabData.Phase] { phases.filter { selected.contains($0.id) } }
    private var window: (Date, Date)? {
        guard let from = chosen.map(\.startDate).min(), let to = chosen.map(\.endDate).max() else { return nil }
        return (from.addingTimeInterval(-Double(max(0, before)) * 60), to.addingTimeInterval(Double(max(0, after)) * 60))
    }
    private var filtered: [PhaseVehicleOptions.Vehicle] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return (options?.vehicles ?? []).filter { vehicle in
            query.isEmpty || [vehicle.name, vehicle.brand, vehicle.model, vehicle.registration].compactMap { $0 }.contains { $0.lowercased().contains(query) }
        }.sorted { a, b in
            let blockedA = Self.blocked.contains(a.status ?? "") ? 1 : 0, blockedB = Self.blocked.contains(b.status ?? "") ? 1 : 0
            if blockedA != blockedB { return blockedA < blockedB }
            return (a.name ?? a.registration ?? "").localizedCompare(b.name ?? b.registration ?? "") == .orderedAscending
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Przypisz pojazd do fazy").font(.title3.weight(.light))
                    Text("\(phase.name) · możesz zaznaczyć również kolejne fazy").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Szukaj po nazwie, modelu lub rejestracji…", text: $search).textFieldStyle(.roundedBorder)
                    ScrollView {
                        VStack(spacing: 6) {
                            if options == nil { Text("Ładowanie floty…").foregroundStyle(.secondary).padding(30) }
                            else if filtered.isEmpty { Text("Brak pasujących pojazdów").foregroundStyle(.secondary).padding(30) }
                            ForEach(filtered) { vehicle in vehicleRow(vehicle) }
                        }
                    }
                }
                .frame(width: 300)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("FAZY WYDARZENIA").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                        ForEach(phases) { item in
                            let done = existing.contains(item.id)
                            Toggle(isOn: Binding(get: { selected.contains(item.id) || done }, set: { on in if on { selected.insert(item.id) } else { selected.remove(item.id) } })) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.name)
                                    Text("\(TimelineText.short(item.start)) – \(TimelineText.short(item.end))").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.checkbox).disabled(done).opacity(done ? 0.5 : 1)
                        }
                        HStack {
                            Stepper("Bufor przed fazą (min): \(before)", value: $before, in: 0...1440, step: 15)
                        }
                        Stepper("Bufor po fazie (min): \(after)", value: $after, in: 0...1440, step: 15)
                        Picker("Kierowca (opcjonalnie)", selection: $driverID) {
                            Text("Bez przypisanego kierowcy").tag("")
                            ForEach(options?.employees ?? []) { Text($0.name).tag($0.id) }
                        }
                        Picker("Cel użycia", selection: $purpose) { ForEach(Self.purposes, id: \.self) { Text($0).tag($0) } }
                        Text("Notatki").font(.caption).foregroundStyle(.secondary)
                        TextField("Trasa, miejsce odbioru, załadunek, dodatkowe ustalenia…", text: $notes, axis: .vertical).lineLimit(3...5).textFieldStyle(.roundedBorder)
                        if let window {
                            Label("Łączny zakres rezerwacji: \(TimelineText.short(MeetingDates.iso(window.0))) – \(TimelineText.short(MeetingDates.iso(window.1)))", systemImage: "clock")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if checking || !conflicts.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(checking ? "Sprawdzanie dostępności…" : "Pojazd koliduje z innym wydarzeniem", systemImage: "exclamationmark.triangle")
                                    .font(.callout).foregroundStyle(conflicts.isEmpty ? theme.accent : CrmTheme.rgb(0xf87171))
                                ForEach(conflicts, id: \.id) { conflict in
                                    Text("\(conflict.label): \(TimelineText.short(conflict.start)) – \(TimelineText.short(conflict.end))").font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5))
                                }
                            }
                            .padding(10).background((conflicts.isEmpty ? Color.primary : Color.red).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
            .frame(height: 440)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }
                Button(saving ? "Przypisywanie…" : "Przypisz do \(chosen.count) faz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(saving || checking || vehicleID.isEmpty || chosen.isEmpty || !conflicts.isEmpty)
            }
        }
        .padding(20).frame(width: 720)
        .onAppear { selected = [phase.id] }
        .task {
            do { options = try await store.fetch(eventID, "phaseOptions", ["kind": "vehicles"], as: PhaseVehicleOptions.self) }
            catch { state.error = store.failureText(error, "Nie udało się pobrać floty.") }
        }
        .task(id: "\(vehicleID)|\(chosen.map(\.id).sorted().joined(separator: ","))|\(before)|\(after)") { await checkConflicts() }
    }

    private func vehicleRow(_ vehicle: PhaseVehicleOptions.Vehicle) -> some View {
        let isBlocked = Self.blocked.contains(vehicle.status ?? "")
        let isSelected = vehicleID == vehicle.id
        return Button { choose(vehicle) } label: {
            HStack(spacing: 10) {
                Image(systemName: "car").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(Self.title(vehicle)).font(.callout.weight(.medium)).lineLimit(1)
                    Text([vehicle.brand, vehicle.model, vehicle.registration].compactMap { $0?.nonEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(isBlocked ? "Niedostępny" : "Dostępny").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                    .background((isBlocked ? Color.red : Color.green).opacity(0.15), in: Capsule())
                    .foregroundStyle(isBlocked ? CrmTheme.rgb(0xfca5a5) : CrmTheme.rgb(0x6ee7b7))
                if isSelected { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
            }
            .padding(8).background(isSelected ? theme.accent.opacity(0.1) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(isBlocked).opacity(isBlocked ? 0.4 : 1)
    }

    static func title(_ vehicle: PhaseVehicleOptions.Vehicle) -> String {
        if let name = vehicle.name?.nonEmpty { return name }
        let model = [vehicle.brand ?? "", vehicle.model ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        return model.isEmpty ? "Pojazd" : model
    }

    private func choose(_ vehicle: PhaseVehicleOptions.Vehicle) {
        vehicleID = vehicle.id
        driverID = vehicle.assignedTo ?? ""
        conflicts = []
        let assigned = existing
        var next = selected.subtracting(assigned)
        if next.isEmpty, let first = phases.first(where: { !assigned.contains($0.id) }) { next.insert(first.id) }
        selected = next
    }

    private func checkConflicts() async {
        guard !vehicleID.isEmpty, let window else { conflicts = []; return }
        checking = true
        defer { checking = false }
        struct Reply: Decodable { let conflicts: [Conflict] }
        let reply = try? await store.fetch(eventID, "vehicleConflicts", ["vehicleId": vehicleID, "start": MeetingDates.iso(window.0), "end": MeetingDates.iso(window.1)], as: Reply.self)
        if Task.isCancelled { return }
        conflicts = reply?.conflicts ?? []
    }

    private func save() async {
        guard !vehicleID.isEmpty else { state.notice = "Wybierz pojazd"; return }
        guard !chosen.isEmpty else { state.notice = "Wybierz co najmniej jedną fazę"; return }
        guard conflicts.isEmpty else { state.error = "Pojazd jest zajęty w wybranym terminie"; return }
        saving = true
        defer { saving = false }
        do {
            try await store.rpcRun(eventID, "assign_event_vehicle_to_phases", [
                "p_event_id": .string(eventID), "p_vehicle_id": .string(vehicleID), "p_phase_ids": .array(chosen.map { .string($0.id) }),
                "p_driver_id": driverID.isEmpty ? .null : .string(driverID), "p_buffer_before_minutes": .number(Double(max(0, before))),
                "p_buffer_after_minutes": .number(Double(max(0, after))), "p_purpose": purpose.isEmpty ? .null : .string(purpose),
                "p_notes": notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(notes.trimmingCharacters(in: .whitespacesAndNewlines)),
            ], reload: "phases", success: chosen.count == 1 ? "Pojazd przypisano do fazy" : "Pojazd przypisano do \(chosen.count) faz")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Nie udało się przypisać pojazdu")
        }
    }
}
