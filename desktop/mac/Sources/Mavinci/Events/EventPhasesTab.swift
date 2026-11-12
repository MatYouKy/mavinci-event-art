import SwiftUI
import AppKit

// MARK: Harmonogram (1:1 z `EventPhasesTimeline`): oś faz z przeciąganiem i zmianą długości (zmiany robocze → Zapisz / Odrzuć),
// nakładanie się faz, zakres agendy i „Teraz”, powiększenie (Całość / Godziny / 15 min), załadunek i rozładunek, terminy
// montażu i demontażu do umowy, czasy przejazdu z logistyki; zasoby (pracownicy, pojazdy, sprzęt) na osi z przesuwaniem,
// wyrównaniem do fazy i usuwaniem; panel zasobów fazy; dodawanie, edycja i usuwanie faz; przypisywanie ludzi i pojazdów.

@MainActor struct EventPhasesTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var zoom: TimelineZoom = .hours
    @State private var showWarehouse = true
    @State private var drafts: [String: (start: Date, end: Date)] = [:]
    @State private var resourceDraft: (id: String, kind: TimelineResource.Kind, start: Date, end: Date)?
    @State private var selected: PhasesTabData.Phase?
    @State private var panelOpen = false
    @State private var editing: PhasesTabData.Phase?
    @State private var addOpen = false
    @State private var assignFor: PhasesTabData.Phase?
    @State private var vehicleFor: PhasesTabData.Phase?
    @State private var deleting: PhasesTabData.Phase?
    @State private var rowHeight: CGFloat = 44
    @State private var applyingTravel = false
    @State private var importingContract = false

    private var data: PhasesTabData? { store.tab(eventID, "phases", as: PhasesTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|phases"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać harmonogramu", systemImage: "clock.badge.exclamationmark")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "phases") } } }
            } else {
                ProgressView("Ładowanie faz...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "phases") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "phases") } }
        .inspector(isPresented: $panelOpen) {
            if let phase = selected, let data {
                PhaseResourcesPanel(store: store, eventID: eventID, phase: phase, data: data,
                                    onAssign: { assignFor = phase }, onVehicle: { vehicleFor = phase }, onClose: { panelOpen = false; selected = nil })
                    .inspectorColumnWidth(min: 320, ideal: 380, max: 480)
            }
        }
        .sheet(isPresented: $addOpen) {
            if let data { AddPhaseSheet(store: store, eventID: eventID, data: data) { name in
                if ["załadunek", "rozładunek"].contains(name.trimmingCharacters(in: .whitespaces).lowercased()) { showWarehouse = true }
            }.warehouseSheetStyle(state) }
        }
        .sheet(item: $editing) { phase in EditPhaseSheet(store: store, eventID: eventID, phase: phase).warehouseSheetStyle(state) }
        .sheet(item: $assignFor) { phase in
            if let data { AddPhaseAssignmentSheet(store: store, eventID: eventID, phase: phase, phases: data.phases).warehouseSheetStyle(state) }
        }
        .sheet(item: $vehicleFor) { phase in
            if let data { AddPhaseVehicleSheet(store: store, eventID: eventID, phase: phase, phases: data.phases).warehouseSheetStyle(state) }
        }
        .confirmationDialog("Usuń fazę", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let phase = deleting { Task { await delete(phase) } } }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: { Text("Czy na pewno chcesz usunąć tę fazę? Wszystkie przypisania zostaną utracone.") }
    }

    // MARK: Dane pochodne
    private func display(_ data: PhasesTabData) -> [PhasesTabData.Phase] {
        data.phases.map { phase in
            guard let draft = drafts[phase.id] else { return phase }
            var copy = phase
            copy.start = MeetingDates.iso(draft.start)
            copy.end = MeetingDates.iso(draft.end)
            return copy
        }
    }
    /// Granice osi: fazy, rezerwacje pojazdów i termin wydarzenia ± 15 min.
    private func bounds(_ data: PhasesTabData) -> (Date, Date) {
        let eventStart = MeetingDates.parse(data.event.start) ?? Date()
        let eventEnd = MeetingDates.parse(data.event.end) ?? eventStart
        guard !data.phases.isEmpty else { return (eventStart, max(eventEnd, eventStart.addingTimeInterval(3600))) }
        let phases = display(data)
        var times: [Date] = phases.map(\.startDate) + phases.map(\.endDate) + [eventStart, eventEnd]
        times += data.phaseVehicles.flatMap { [$0.start, $0.end].compactMap { $0.flatMap(MeetingDates.parse) } }
        times += data.eventVehicles.flatMap { [$0.availableFrom, $0.availableUntil].compactMap { $0.flatMap(MeetingDates.parse) } }
        let start = times.min() ?? eventStart, end = times.max() ?? eventEnd
        return (start.addingTimeInterval(-900), end.addingTimeInterval(900))
    }
    /// Szerokość osi: „Całość” mieści się w oknie, „Godziny” 72 pkt / h, „15 min” 192 pkt / h (min. 1200).
    private func timelineScale(_ data: PhasesTabData, available: CGFloat) -> TimelineScale {
        let range = bounds(data)
        let hours = max(1, range.1.timeIntervalSince(range.0) / 3600)
        let width: CGFloat = zoom == .days ? max(600, available - 32) : max(1200, CGFloat(ceil(hours * (zoom == .hours ? 72 : 192))))
        return TimelineScale(start: range.0, end: range.1, width: width)
    }

    private func conflicts(_ phases: [PhasesTabData.Phase]) -> Set<String> {
        var result = Set<String>()
        for phase in phases where phases.contains(where: { $0.id != phase.id && phase.startDate < $0.endDate && phase.endDate > $0.startDate }) {
            result.insert(phase.id)
        }
        return result
    }

    // MARK: Widok
    private func content(_ data: PhasesTabData) -> some View {
        let phases = display(data)
        let conflictIDs = conflicts(phases)
        return VStack(alignment: .leading, spacing: 0) {
            header(data, phases: phases, conflicts: !conflictIDs.isEmpty)
            EventPhasesFlowBar(store: store, eventID: eventID, data: data, conflicts: conflictIDs.count,
                               addPhase: { addOpen = true }, applyTravel: { Task { await applyTravel() } })
                .padding(.horizontal, 16).padding(.bottom, 6)
            contractBox(data, phases: phases)
            EventArrangementsBanner(store: store, eventID: eventID, area: .timeline).padding(.horizontal, 18).padding(.vertical, 6)
            if data.phases.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "clock").font(.system(size: 48)).foregroundStyle(.tertiary)
                    Text("Brak faz o stałych terminach").font(.headline)
                    Text("Podziel wydarzenie na fazy (montaż, realizacja, demontaż)").font(.callout).foregroundStyle(.secondary)
                    Button { addOpen = true } label: { Label("Dodaj fazę", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
            } else {
                GeometryReader { geometry in
                    let scale = timelineScale(data, available: geometry.size.width)
                    let width = scale.width
                    ScrollView([.horizontal, .vertical]) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("FAZY GŁÓWNE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Spacer()
                                Label("Przeciągnij fazę, aby zmienić czas · krawędzie zmieniają długość · prawy klik — więcej", systemImage: "arrow.left.and.right")
                                    .font(.caption2).foregroundStyle(.tertiary)
                            }
                            .frame(width: width)
                            TimelineAxis(scale: scale, zoom: zoom, eventStart: MeetingDates.parse(data.event.start), eventEnd: MeetingDates.parse(data.event.end))
                            PhaseLane(scale: scale, zoom: zoom, phases: phases.filter { showWarehouse || !$0.isWarehouse }, conflicts: conflictIDs,
                                      selected: selected?.id,
                                      onSelect: { phase in selected = phase; panelOpen = true },
                                      onEdit: { editing = $0 }, onDelete: { deleting = $0 },
                                      onAssign: { assignFor = $0 }, onVehicle: { vehicleFor = $0 },
                                      onChange: { id, start, end in drafts[id] = (start, end) })
                            Rectangle().fill(theme.accent.opacity(0.3)).frame(width: width, height: 2).padding(.vertical, 8)
                            HStack {
                                Text("ZASOBY WYDARZENIA").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Spacer()
                                Text("Wysokość:").font(.caption).foregroundStyle(.secondary)
                                Picker("", selection: $rowHeight) { Text("S").tag(CGFloat(32)); Text("M").tag(CGFloat(44)); Text("L").tag(CGFloat(60)) }
                                    .pickerStyle(.segmented).labelsHidden().frame(width: 110)
                            }
                            .frame(width: width)
                            if let draft = resourceDraft {
                                HStack(spacing: 8) {
                                    Text("Zmieniony czas przypisania: \(TimelineText.short(MeetingDates.iso(draft.start))) – \(TimelineText.short(MeetingDates.iso(draft.end)))")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Button("Zapisz") { Task { await saveResourceDraft() } }.buttonStyle(.borderedProminent).controlSize(.small)
                                    Button("Odrzuć") { resourceDraft = nil; state.notice = "Zmiany odrzucone" }.controlSize(.small)
                                }
                            }
                            ResourceLanes(scale: scale, zoom: zoom, rows: resources(data, phases: phases), rowHeight: rowHeight, draft: resourceDraft,
                                          onChange: { id, kind, start, end in resourceDraft = (id, kind, start, end) },
                                          onAlign: { bar, kind in Task { await align(bar, kind) } },
                                          onDelete: { bar, kind in Task { await removeBar(bar, kind) } })
                        }
                        .padding(16)
                        // Przewijanie w dwóch osiach centruje mniejszą treść — oś czasu zawsze od lewego górnego rogu, bez pustego pasa nad fazami.
                        .frame(minWidth: geometry.size.width, minHeight: geometry.size.height, alignment: .topLeading)
                    }
                }
            }
        }
    }

    private func header(_ data: PhasesTabData, phases: [PhasesTabData.Phase], conflicts: Bool) -> some View {
        WrapLine(spacing: 10, lineSpacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "clock").foregroundStyle(theme.accent)
                Text("Fazy wydarzenia").font(.headline)
                Text("\(data.phases.count)").font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(theme.accent.opacity(0.2), in: Capsule()).foregroundStyle(theme.accent)
                if conflicts {
                    Label("Nakładające się fazy!", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(CrmTheme.rgb(0xf87171))
                        .padding(.horizontal, 8).padding(.vertical, 3).background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }
                if store.tabLoading.contains("\(eventID)|phases") { ProgressView().controlSize(.small) }
            }
            Toggle("Pokaż załadunek i rozładunek", isOn: $showWarehouse).toggleStyle(.checkbox).font(.caption)
            Button("Zastosuj czasy przejazdu z logistyki") { Task { await applyTravel() } }.disabled(applyingTravel).controlSize(.small)
            if !drafts.isEmpty {
                Button { Task { await saveDrafts() } } label: { Label("Zapisz zmiany", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                Button { drafts = [:]; state.notice = "Zmiany odrzucone" } label: { Label("Odrzuć", systemImage: "arrow.uturn.backward") }.controlSize(.small)
            }
            HStack(spacing: 2) {
                Button { stepZoom(-1) } label: { Image(systemName: "minus.magnifyingglass") }.disabled(zoom == .days).help("Oddal widok")
                Picker("", selection: $zoom) { ForEach(TimelineZoom.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented).labelsHidden().frame(width: 220)
                Button { stepZoom(1) } label: { Image(systemName: "plus.magnifyingglass") }.disabled(zoom == .quarter).help("Zbliż widok")
            }
            .buttonStyle(.borderless)
            if !phases.isEmpty {
                Button { assignFor = selected ?? phases.first } label: { Label("Dodaj do timeline", systemImage: "person.badge.plus") }.controlSize(.small)
            }
            Button { addOpen = true } label: { Label("Dodaj fazę", systemImage: "plus") }.buttonStyle(.borderedProminent).controlSize(.small)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func stepZoom(_ delta: Int) {
        let all = TimelineZoom.allCases
        guard let index = all.firstIndex(of: zoom) else { return }
        zoom = all[max(0, min(all.count - 1, index + delta))]
    }

    // MARK: Terminy do umowy (montaż, demontaż)
    private static func normalize(_ name: String) -> String {
        name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
            .replacingOccurrences(of: "ł", with: "l").trimmingCharacters(in: .whitespaces).lowercased()
    }
    private func contractBox(_ data: PhasesTabData, phases: [PhasesTabData.Phase]) -> some View {
        let items: [(key: String, label: String, legacy: String?)] = [("montaz", "Montaż", data.event.plannedSetupAt), ("demontaz", "Demontaż", data.event.plannedTeardownAt)]
        return VStack(alignment: .leading, spacing: 6) {
            Text("Terminy montażu i demontażu w umowie").font(.callout.weight(.medium))
            Text("Umowa pobiera początek najwcześniejszej fazy danego rodzaju. Zmieniaj godziny na osi i zapisz Timeline; wcześniej wystawione dokumenty zachowują swoją treść.")
                .font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 18) {
                ForEach(items, id: \.key) { item in
                    let phase = data.phases.sorted { $0.startDate < $1.startDate }.first { phase in
                        [phase.typeName ?? "", phase.name].contains { name in
                            let normalized = Self.normalize(name)
                            return normalized == item.key || normalized.hasPrefix("\(item.key) ")
                        }
                    }
                    let type = data.phaseTypes.first { Self.normalize($0.name) == item.key }
                    HStack(spacing: 8) {
                        if let phase {
                            Text("\(item.label): \(TimelineText.full(phase.start))")
                            Button("Edytuj fazę") { editing = phase }.buttonStyle(.link).linkCursor().font(.caption)
                        } else if let legacy = item.legacy {
                            Text("\(item.label): \(TimelineText.full(legacy)) — wcześniejszy termin umowy")
                            if let type, let hours = type.durationHours {
                                Button("Dodaj do Timeline (\(TimelineText.number(hours)) godz.)") { Task { await importContract(item.label, legacy, type, hours: hours, data: data) } }
                                    .buttonStyle(.link).linkCursor().font(.caption).disabled(importingContract)
                            } else {
                                Button("Dodaj fazę") { addOpen = true }.buttonStyle(.link).linkCursor().font(.caption)
                            }
                        } else {
                            Text("\(item.label): Brak fazy w Timeline")
                            Button("Dodaj fazę") { addOpen = true }.buttonStyle(.link).linkCursor().font(.caption)
                        }
                    }
                    .font(.callout)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.025))
    }

    // MARK: Zasoby (`ResourceTimeline`)
    private func resources(_ data: PhasesTabData, phases: [PhasesTabData.Phase]) -> [TimelineResource] {
        let byPhase = Dictionary(uniqueKeysWithValues: phases.map { ($0.id, $0) })
        var people: [String: PhasesTabData.Person] = [:]
        var order: [String] = []
        for person in data.team + data.assignments.compactMap(\.employee) where people[person.id] == nil {
            people[person.id] = person
            order.append(person.id)
        }
        let employees: [TimelineResource] = order.compactMap { id in
            guard let person = people[id] else { return nil }
            let bars = data.assignments.filter { $0.employeeId == id }.compactMap { a -> TimelineResource.Bar? in
                guard let phase = byPhase[a.phaseId] else { return nil }
                let start = (a.start ?? a.workStart).flatMap(MeetingDates.parse) ?? phase.startDate
                let end = (a.end ?? a.workEnd).flatMap(MeetingDates.parse) ?? phase.endDate
                return .init(id: a.id, phase: phase, start: start, end: end, quantity: nil, role: a.role, status: a.status, editable: true)
            }.sorted { $0.start < $1.start }
            return TimelineResource(id: id, kind: .employee, name: person.name, avatarUrl: person.avatarUrl, avatar: person.avatar, category: nil, bars: bars)
        }
        let vehicles: [TimelineResource] = data.eventVehicles.compactMap { vehicle in
            let found = data.phaseVehicles.filter { $0.vehicleId != nil && $0.vehicleId == vehicle.vehicleId }.compactMap { v -> (Date, Date, PhasesTabData.Phase)? in
                guard let phase = byPhase[v.phaseId] else { return nil }
                return (v.start.flatMap(MeetingDates.parse) ?? phase.startDate, v.end.flatMap(MeetingDates.parse) ?? phase.endDate, phase)
            }
            var bars: [TimelineResource.Bar] = []
            if let first = found.first, let from = found.map(\.0).min(), let to = found.map(\.1).max() {
                bars = [.init(id: "vehicle_continuous_\(vehicle.id)", phase: first.2, start: from, end: to, quantity: nil, role: nil, status: nil, editable: false)]
            } else if let from = vehicle.availableFrom.flatMap(MeetingDates.parse), let to = vehicle.availableUntil.flatMap(MeetingDates.parse), vehicle.vehicleId != nil {
                bars = [.init(id: "event_vehicle_\(vehicle.id)", phase: nil, start: from, end: to, quantity: nil, role: nil, status: nil, editable: false)]
            }
            guard !bars.isEmpty else { return nil }
            return TimelineResource(id: vehicle.vehicleId ?? vehicle.id, kind: .vehicle, name: vehicle.name, avatarUrl: nil, avatar: nil, category: nil, bars: bars)
        }
        var equipment: [TimelineResource] = []
        var seen = Set<String>()
        for item in data.eventEquipment where seen.insert(item.id).inserted {
            let bars = data.phaseEquipment.filter { $0.itemId == item.id }.compactMap { e -> TimelineResource.Bar? in
                guard let phase = byPhase[e.phaseId] else { return nil }
                return .init(id: e.id, phase: phase, start: e.start.flatMap(MeetingDates.parse) ?? phase.startDate, end: e.end.flatMap(MeetingDates.parse) ?? phase.endDate,
                             quantity: e.quantity, role: nil, status: nil, editable: true)
            }
            if !bars.isEmpty { equipment.append(TimelineResource(id: item.id, kind: .equipment, name: item.name, avatarUrl: nil, avatar: nil, category: item.category, bars: bars)) }
        }
        return employees + vehicles + equipment.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    // MARK: Czynności
    private func saveDrafts() async {
        do {
            for (id, range) in drafts {
                try await store.mutate(eventID, table: "event_phases", action: "update", rowID: id,
                                       data: ["start_time": .string(MeetingDates.iso(range.start)), "end_time": .string(MeetingDates.iso(range.end))],
                                       reload: "phases", success: nil)
            }
            drafts = [:]
            state.succeed("Zmiany zapisane pomyślnie")
        } catch {
            state.error = store.failureText(error, "Błąd podczas zapisywania zmian")
        }
    }
    private func delete(_ phase: PhasesTabData.Phase) async {
        deleting = nil
        do {
            try await store.mutate(eventID, table: "event_phases", action: "delete", rowID: phase.id, reload: "phases", success: "Faza usunięta", pending: "Usuwanie…")
            if selected?.id == phase.id { selected = nil; panelOpen = false }
            drafts[phase.id] = nil
        } catch {
            state.error = store.failureText(error, "Błąd podczas usuwania fazy")
        }
    }
    private func applyTravel() async {
        guard !applyingTravel else { return }
        applyingTravel = true
        defer { applyingTravel = false }
        do {
            let data = try await store.tabRun(eventID, "applyTravel", [:], reload: "phases", success: nil, pending: "Pobieranie czasów z logistyki…")
            struct Reply: Decodable { let drafts: [String: PhasesTabData.Range]; let message: String; let ok: Bool }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            for (id, range) in reply.drafts {
                if let start = MeetingDates.parse(range.start), let end = MeetingDates.parse(range.end) { drafts[id] = (start, end) }
            }
            if reply.ok { state.succeed(reply.message) } else { state.notice = reply.message }
        } catch {
            state.error = store.failureText(error, "Nie udało się zastosować czasów przejazdu.")
        }
    }
    private func importContract(_ label: String, _ legacy: String, _ type: PhasesTabData.PhaseType, hours: Double, data: PhasesTabData) async {
        guard !importingContract, let start = MeetingDates.parse(legacy), hours > 0 else {
            state.error = "Uzupełnij poprawny termin i domyślny czas trwania fazy."
            return
        }
        importingContract = true
        defer { importingContract = false }
        let order = (data.phases.compactMap(\.sequenceOrder).max() ?? 0) + 1
        do {
            try await store.mutate(eventID, table: "event_phases", action: "insert", data: [
                "phase_type_id": .string(type.id), "name": .string(label), "start_time": .string(MeetingDates.iso(start)),
                "end_time": .string(MeetingDates.iso(start.addingTimeInterval(hours * 3600))), "sequence_order": .number(max(0, order)),
            ], reload: "phases", success: "Termin dodano do Timeline. Umowa korzysta teraz z początku tej fazy.")
        } catch {
            state.error = store.failureText(error, "Nie udało się przenieść terminu na Timeline.")
        }
    }
    private static func table(_ kind: TimelineResource.Kind) -> String {
        switch kind { case .employee: return "event_phase_assignments"; case .vehicle: return "event_phase_vehicles"; case .equipment: return "event_phase_equipment" }
    }
    private static func timeFields(_ kind: TimelineResource.Kind, _ start: Date, _ end: Date) -> [String: JSONValue] {
        let from = JSONValue.string(MeetingDates.iso(start)), to = JSONValue.string(MeetingDates.iso(end))
        switch kind {
        // Pracownik: także godziny pracy w fazie (warunek w bazie), jak w CRM.
        case .employee: return ["assignment_start": from, "assignment_end": to, "phase_work_start": from, "phase_work_end": to]
        default: return ["assigned_start": from, "assigned_end": to]
        }
    }
    private func saveResourceDraft() async {
        guard let draft = resourceDraft else { return }
        do {
            try await store.mutate(eventID, table: Self.table(draft.kind), action: "update", rowID: draft.id, data: Self.timeFields(draft.kind, draft.start, draft.end),
                                   reload: "phases", success: "Zmiany zapisane pomyślnie")
            resourceDraft = nil
        } catch {
            state.error = "Błąd: " + store.failureText(error, "Nie udało się zaktualizować czasu")
        }
    }
    private func align(_ bar: TimelineResource.Bar, _ kind: TimelineResource.Kind) async {
        guard let phase = bar.phase else { state.error = "Brak informacji o fazie"; return }
        do {
            try await store.mutate(eventID, table: Self.table(kind), action: "update", rowID: bar.id, data: Self.timeFields(kind, phase.startDate, phase.endDate),
                                   reload: "phases", success: "Przypisanie wyrównane do fazy")
        } catch {
            state.error = store.failureText(error, "Błąd podczas wyrównywania do fazy")
        }
    }
    private func removeBar(_ bar: TimelineResource.Bar, _ kind: TimelineResource.Kind) async {
        do {
            try await store.mutate(eventID, table: Self.table(kind), action: "delete", rowID: bar.id, reload: "phases", success: "Przypisanie usunięte", pending: "Usuwanie…")
        } catch {
            state.error = store.failureText(error, "Nie udało się usunąć przypisania")
        }
    }
}

extension TimelineText {
    static func number(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : value.formatted(.number.locale(Locale(identifier: "pl_PL")).precision(.fractionLength(0...2)))
    }
}

// MARK: Oś czasu: podziałka, agenda, „Teraz”

@MainActor struct TimelineAxis: View {
    let scale: TimelineScale
    let zoom: TimelineZoom
    let eventStart: Date?
    let eventEnd: Date?
    @Environment(\.crmTheme) private var theme

    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.primary.opacity(0.04)).frame(width: scale.width, height: 34)
            if let eventStart, let eventEnd, eventEnd > eventStart {
                Rectangle().fill(theme.accent.opacity(0.12))
                    .frame(width: max(2, scale.x(eventEnd) - scale.x(eventStart)), height: 34)
                    .overlay(alignment: .topLeading) {
                        Text("Agenda").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.accent).padding(.leading, 6).padding(.top, 1)
                    }
                    .offset(x: scale.x(eventStart))
                    .help("Główne godziny wydarzenia (agenda dla klienta)")
            }
            ForEach(scale.markers(zoom), id: \.self) { marker in
                Rectangle().fill(Color.primary.opacity(0.15)).frame(width: 1, height: 34).offset(x: scale.x(marker))
                Text(scale.markerLabel(marker, zoom: zoom)).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    .fixedSize().offset(x: scale.x(marker) + 4, y: 12)
            }
            let now = Date()
            if now >= scale.start && now <= scale.end {
                Text("Teraz").font(.system(size: 10, weight: .bold)).foregroundStyle(.white).padding(.horizontal, 4)
                    .background(Color.red, in: RoundedRectangle(cornerRadius: 3)).fixedSize().offset(x: scale.x(now) - 16, y: 0)
            }
        }
        .frame(width: scale.width, height: 34, alignment: .topLeading)
    }
}

/// Linie podziałki i „Teraz” pod paskami (pas faz, wiersze zasobów).
@MainActor struct TimelineGrid: View {
    let scale: TimelineScale
    let zoom: TimelineZoom
    let height: CGFloat
    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(scale.markers(zoom), id: \.self) { marker in
                Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1, height: height).offset(x: scale.x(marker))
            }
            let now = Date()
            if now >= scale.start && now <= scale.end {
                Rectangle().fill(Color.red.opacity(0.7)).frame(width: 2, height: height).offset(x: scale.x(now))
            }
        }
        .frame(width: scale.width, height: height, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

// MARK: Pas faz z przeciąganiem (`PhaseTimelineView` + `useTimelineDrag`)

enum TimelineDragMode { case move, start, end }

/// Nowy zakres po przeciągnięciu: przyciąganie do siatki, granice osi, najkrótszy czas jak w CRM.
func timelineDragged(_ mode: TimelineDragMode, start: Date, end: Date, dx: CGFloat, scale: TimelineScale, zoom: TimelineZoom) -> (Date, Date) {
    let delta = scale.seconds(dx)
    let snap = zoom.snap
    func snapped(_ date: Date) -> Date { Date(timeIntervalSince1970: (date.timeIntervalSince1970 / snap).rounded() * snap) }
    func clamp(_ date: Date) -> Date { min(max(date, scale.start), scale.end) }
    switch mode {
    case .move:
        let newStart = snapped(clamp(start.addingTimeInterval(delta)))
        return (newStart, newStart.addingTimeInterval(end.timeIntervalSince(start)))
    case .start:
        let newStart = min(snapped(clamp(start.addingTimeInterval(delta))), end.addingTimeInterval(-snap))
        return (newStart, end)
    case .end:
        let newEnd = max(snapped(clamp(end.addingTimeInterval(delta))), start.addingTimeInterval(snap))
        return (start, newEnd)
    }
}

@MainActor struct PhaseLane: View {
    let scale: TimelineScale
    let zoom: TimelineZoom
    let phases: [PhasesTabData.Phase]
    let conflicts: Set<String>
    let selected: String?
    var onSelect: (PhasesTabData.Phase) -> Void
    var onEdit: (PhasesTabData.Phase) -> Void
    var onDelete: (PhasesTabData.Phase) -> Void
    var onAssign: (PhasesTabData.Phase) -> Void
    var onVehicle: (PhasesTabData.Phase) -> Void
    var onChange: (String, Date, Date) -> Void
    @State private var preview: (id: String, start: Date, end: Date)?
    @State private var hovered: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            TimelineGrid(scale: scale, zoom: zoom, height: 80)
            ForEach(Array(phases.enumerated()), id: \.element.id) { index, phase in bar(phase, index: index) }
        }
        .frame(width: scale.width, height: 80, alignment: .topLeading)
    }

    private func range(_ phase: PhasesTabData.Phase) -> (Date, Date) {
        if let preview, preview.id == phase.id { return (preview.start, preview.end) }
        return (phase.startDate, phase.endDate)
    }

    private func bar(_ phase: PhasesTabData.Phase, index: Int) -> some View {
        let (start, end) = range(phase)
        let x = max(0, scale.x(max(start, scale.start)))
        let width = max(12, min(scale.width - x, scale.x(min(end, scale.end)) - x))
        let color = CrmTheme.hex(phase.colorHex) ?? .blue
        let isSelected = selected == phase.id
        let others = phases.filter { $0.id != phase.id && start < $0.endDate && end > $0.startDate }
        return ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 8).fill(color.opacity(isSelected ? 0.3 : 0.15))
            Rectangle().fill(color).frame(width: 4)
            // Części nakładające się z innymi fazami.
            ForEach(others, id: \.id) { other in
                let from = max(start, other.startDate)
                let to = min(end, other.endDate)
                if to > from {
                    let total = max(1, end.timeIntervalSince(start))
                    Rectangle().fill(Color.red.opacity(0.18))
                        .frame(width: width * CGFloat(to.timeIntervalSince(from) / total))
                        .offset(x: width * CGFloat(from.timeIntervalSince(start) / total))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(phase.name).font(.callout.weight(.bold)).lineLimit(1)
                    if conflicts.contains(phase.id) { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(CrmTheme.rgb(0xf87171)).help("Faza nakłada się z inną fazą!") }
                }
                (Text("\(TimelineText.time(start, zoom: zoom)) - \(TimelineText.time(end, zoom: zoom))")
                 + Text("  (\(TimelineText.duration(start, end)))").foregroundColor(.secondary))
                    .font(.caption).lineLimit(1)
            }
            .padding(.leading, 12).padding(.trailing, 6)
            .allowsHitTesting(false)
            HStack(spacing: 0) {
                handle(phase, .start, color: color)
                Spacer(minLength: 0)
                handle(phase, .end, color: color)
            }
        }
        .frame(width: width, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(isSelected ? 0.35 : 0.15), radius: isSelected ? 6 : 2)
        .offset(x: x, y: 10)
        .zIndex(isSelected || preview?.id == phase.id ? 30 : hovered == phase.id ? 20 : Double(10 + index))
        .onHover { hovered = $0 ? phase.id : (hovered == phase.id ? nil : hovered) }
        .gesture(drag(phase, .move))
        .onTapGesture(count: 2) { onEdit(phase) }
        .onTapGesture { onSelect(phase) }
        .contextMenu {
            Button("Edytuj fazę", systemImage: "pencil") { onEdit(phase) }
            Button("Zasoby fazy", systemImage: "sidebar.right") { onSelect(phase) }
            Button("Przypisz pracownika", systemImage: "person.badge.plus") { onAssign(phase) }
            Button("Przypisz pojazd", systemImage: "car") { onVehicle(phase) }
            Divider()
            Button("Usuń fazę", systemImage: "trash", role: .destructive) { onDelete(phase) }
        }
        .help("\(phase.name)\n\(TimelineText.short(MeetingDates.iso(start))) – \(TimelineText.short(MeetingDates.iso(end)))\nPrzeciągnij, aby przesunąć. Prawy przycisk otwiera menu.")
    }

    private func handle(_ phase: PhasesTabData.Phase, _ mode: TimelineDragMode, color: Color) -> some View {
        Rectangle().fill(hovered == phase.id ? color.opacity(0.4) : Color.clear).frame(width: 8)
            .contentShape(Rectangle())
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            .gesture(drag(phase, mode))
    }

    private func drag(_ phase: PhasesTabData.Phase, _ mode: TimelineDragMode) -> some Gesture {
        DragGesture(minimumDistance: 3)
            .onChanged { value in
                let (start, end) = timelineDragged(mode, start: phase.startDate, end: phase.endDate, dx: value.translation.width, scale: scale, zoom: zoom)
                preview = (phase.id, start, end)
            }
            .onEnded { value in
                let (start, end) = timelineDragged(mode, start: phase.startDate, end: phase.endDate, dx: value.translation.width, scale: scale, zoom: zoom)
                preview = nil
                if start != phase.startDate || end != phase.endDate { onChange(phase.id, start, end) }
            }
    }
}

// MARK: Wiersze zasobów

@MainActor struct ResourceLanes: View {
    let scale: TimelineScale
    let zoom: TimelineZoom
    let rows: [TimelineResource]
    let rowHeight: CGFloat
    let draft: (id: String, kind: TimelineResource.Kind, start: Date, end: Date)?
    var onChange: (String, TimelineResource.Kind, Date, Date) -> Void
    var onAlign: (TimelineResource.Bar, TimelineResource.Kind) -> Void
    var onDelete: (TimelineResource.Bar, TimelineResource.Kind) -> Void
    @State private var preview: (id: String, start: Date, end: Date)?
    @State private var removing: (bar: TimelineResource.Bar, resource: TimelineResource)?

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(rows) { resource in row(resource) }
        }
        .confirmationDialog("Usunąć przypisanie?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Usuń", role: .destructive) { if let item = removing { onDelete(item.bar, item.resource.kind) }; removing = nil }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Czy na pewno chcesz usunąć przypisanie: \(removing?.resource.name ?? "")?") }
    }

    private func range(_ bar: TimelineResource.Bar) -> (Date, Date) {
        if let preview, preview.id == bar.id { return (preview.start, preview.end) }
        if let draft, draft.id == bar.id { return (draft.start, draft.end) }
        return (bar.start, bar.end)
    }

    private func row(_ resource: TimelineResource) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.primary.opacity(0.025)).frame(width: scale.width, height: rowHeight)
            TimelineGrid(scale: scale, zoom: zoom, height: rowHeight)
            if resource.bars.isEmpty && resource.kind == .employee {
                HStack(spacing: 8) {
                    EmployeeAvatarView(name: resource.name, url: resource.avatarUrl, crop: resource.avatar, size: min(28, rowHeight - 6))
                    Text(resource.name).font(.caption.weight(.medium))
                    Text("Bez ustalonych godzin").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.primary.opacity(0.08), in: Capsule())
                }
                .foregroundStyle(.secondary).padding(.leading, 12).frame(height: rowHeight)
            }
            if resource.kind == .employee {
                ForEach(Array(overlaps(resource).enumerated()), id: \.offset) { _, overlap in
                    Rectangle().fill(Color.red.opacity(0.25))
                        .frame(width: max(2, scale.x(overlap.1) - scale.x(overlap.0)), height: rowHeight).offset(x: scale.x(overlap.0))
                        .help("Konflikt: nakładające się przypisania")
                }
            }
            ForEach(resource.bars) { bar in barView(bar, resource) }
        }
        .frame(width: scale.width, height: rowHeight, alignment: .topLeading)
    }

    private func overlaps(_ resource: TimelineResource) -> [(Date, Date)] {
        var result: [(Date, Date)] = []
        let bars = resource.bars
        for i in bars.indices { for j in bars.indices where j > i {
            let from = max(bars[i].start, bars[j].start), to = min(bars[i].end, bars[j].end)
            if to > from { result.append((from, to)) }
        } }
        return result
    }

    private func barView(_ bar: TimelineResource.Bar, _ resource: TimelineResource) -> some View {
        let (start, end) = range(bar)
        let x = max(0, scale.x(max(start, scale.start)))
        let width = max(8, min(scale.width - x, scale.x(min(end, scale.end)) - x))
        let color = CrmTheme.hex(bar.phase?.colorHex ?? "#3b82f6") ?? .blue
        let label = [resource.name, bar.quantity.map { "× \(TimelineText.number($0))" }, "\(TimelineText.time(start, zoom: .hours))–\(TimelineText.time(end, zoom: .hours))"]
            .compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 6) {
            if resource.kind == .employee && rowHeight >= 40 {
                EmployeeAvatarView(name: resource.name, url: resource.avatarUrl, crop: resource.avatar, size: min(26, rowHeight - 12))
            } else if resource.kind != .employee {
                Image(systemName: resource.kind == .vehicle ? "car" : "shippingbox").font(.caption)
            }
            Text(label).font(.caption).lineLimit(1)
            if bar.status == "pending" { Image(systemName: "clock").font(.caption2).foregroundStyle(CrmTheme.rgb(0xfacc15)).help("Oczekuje na potwierdzenie") }
            if bar.status == "rejected" { Image(systemName: "xmark.circle").font(.caption2).foregroundStyle(CrmTheme.rgb(0xf87171)).help("Odrzucone") }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .frame(width: width, height: rowHeight - 6, alignment: .leading)
        .background(color.opacity(0.25), in: RoundedRectangle(cornerRadius: 6))
        .contentShape(RoundedRectangle(cornerRadius: 6))
        .offset(x: x, y: 3)
        .gesture(bar.editable ? drag(bar, resource.kind) : nil)
        .contextMenu {
            if bar.editable, let phase = bar.phase {
                Button("Wyrównaj do fazy — \(phase.name)", systemImage: "scope") { onAlign(bar, resource.kind) }
            }
            if bar.editable && resource.kind != .vehicle {
                Divider()
                Button("Usuń przypisanie", systemImage: "trash", role: .destructive) { removing = (bar, resource) }
            }
        }
        .help([resource.name, bar.phase.map { "Faza: \($0.name)" }, bar.role.map { "Rola: \(EventRoleLabels.label($0))" },
               "\(TimelineText.short(MeetingDates.iso(start))) – \(TimelineText.short(MeetingDates.iso(end)))"].compactMap { $0 }.joined(separator: "\n"))
    }

    private func drag(_ bar: TimelineResource.Bar, _ kind: TimelineResource.Kind) -> some Gesture {
        DragGesture(minimumDistance: 3)
            .onChanged { value in
                let (start, end) = timelineDragged(.move, start: bar.start, end: bar.end, dx: value.translation.width, scale: scale, zoom: zoom)
                preview = (bar.id, start, end)
            }
            .onEnded { value in
                let (start, end) = timelineDragged(.move, start: bar.start, end: bar.end, dx: value.translation.width, scale: scale, zoom: zoom)
                preview = nil
                if start != bar.start { onChange(bar.id, kind, start, end) }
            }
    }
}
