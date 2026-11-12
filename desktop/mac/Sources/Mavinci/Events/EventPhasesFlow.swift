import SwiftUI

// MARK: Przygotowanie harmonogramu krok po kroku (pasek nad osią faz): ① fazy z umowy i ustaleń sprzedawcy, ② zespół na fazach,
// ③ auta z Logistyki, ④ kontrola, ⑤ wysyłka timeline'u zespołowi. Każdy krok ma stan (kropka) i czynność; zapisy przez te same
// operacje co ręcznie: `event_phases` (insert), `assign_event_employee_to_phases_with_conflict_decision`, „Zastosuj czasy
// przejazdu”, zaproszenie z harmonogramem (`teamInvite`, `timeline_update`).

@MainActor struct EventPhasesFlowBar: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: PhasesTabData
    let conflicts: Int
    let addPhase: () -> Void
    let applyTravel: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventPhases.flowOpen") private var open = true
    @State private var confirmPhases = false
    @State private var confirmTeam = false
    @State private var confirmSend = false
    @State private var busy = false
    @State private var helpFor: Int?

    private var arrangements: EventArrangementsData.Offer? { store.tab(eventID, "arrangements", as: EventArrangementsData.self)?.offers.first }
    private var team: EventTeam? { store.team(eventID) }

    // MARK: Krok 1 — fazy montażu, realizacji i demontażu

    private struct PlannedPhase { var type: PhasesTabData.PhaseType; var name: String; var start: Date; var end: Date }

    private static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL")).replacingOccurrences(of: "ł", with: "l").lowercased()
    }

    private func phaseType(_ match: (String) -> Bool) -> PhasesTabData.PhaseType? {
        data.phaseTypes.sorted { $0.rank < $1.rank }.first { match(Self.normalize($0.name)) }
    }

    private func exists(_ type: PhasesTabData.PhaseType) -> Bool {
        data.phases.contains { $0.typeId == type.id || Self.normalize($0.typeName ?? $0.name) == Self.normalize(type.name) }
    }

    /// Godziny z ustaleń sprzedawcy („2026-11-13T09:00”, czas polski).
    private static func local(_ value: String?) -> Date? {
        guard let value, value.count >= 16 else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Europe/Warsaw")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.date(from: String(value.prefix(16)))
    }

    /// Brakujące fazy główne: montaż od terminu z ustaleń / umowy do startu wydarzenia, realizacja w terminie wydarzenia,
    /// demontaż od końca (albo terminu demontażu) przez domyślny czas typu fazy.
    private var planned: [PlannedPhase] {
        guard let start = MeetingDates.parse(data.event.start), let end = MeetingDates.parse(data.event.end), end > start else { return [] }
        let setup = Self.local(arrangements?.setupAt) ?? data.event.plannedSetupAt.flatMap(MeetingDates.parse)
        let teardown = Self.local(arrangements?.teardownAt) ?? data.event.plannedTeardownAt.flatMap(MeetingDates.parse)
        var result: [PlannedPhase] = []
        if let montage = phaseType({ $0.contains("montaz") && !$0.contains("demontaz") }), !exists(montage) {
            let hours = montage.durationHours ?? 4
            let from = setup.flatMap { $0 < start ? $0 : nil } ?? start.addingTimeInterval(-hours * 3600)
            result.append(PlannedPhase(type: montage, name: montage.name, start: from, end: start))
        }
        if let main = phaseType({ $0.contains("realizac") || $0.contains("wydarzen") }), !exists(main) {
            result.append(PlannedPhase(type: main, name: main.name, start: start, end: end))
        }
        if let teardownType = phaseType({ $0.contains("demontaz") }), !exists(teardownType) {
            let from = teardown.flatMap { $0 > end ? $0 : nil } ?? end
            result.append(PlannedPhase(type: teardownType, name: teardownType.name, start: from, end: from.addingTimeInterval((teardownType.durationHours ?? 3) * 3600)))
        }
        return result.filter { plan in !data.phases.contains { plan.start < $0.endDate && plan.end > $0.startDate } }
    }

    private static func range(_ start: Date, _ end: Date) -> String {
        MeetingDates.format(start, "dd.MM HH:mm") + " – " + MeetingDates.format(end, Calendar.current.isDate(start, inSameDayAs: end) ? "HH:mm" : "dd.MM HH:mm")
    }

    private func createPhases() async {
        busy = true
        defer { busy = false }
        var order = data.phases.count
        var created = 0
        for plan in planned {
            order += 1
            do {
                try await store.mutate(eventID, table: "event_phases", action: "insert", data: [
                    "phase_type_id": .string(plan.type.id), "name": .string(plan.name), "start_time": .string(MeetingDates.iso(plan.start)),
                    "end_time": .string(MeetingDates.iso(plan.end)), "sequence_order": .number(Double(order)),
                ], reload: "phases", success: nil, pending: "Tworzenie faz…")
                created += 1
            } catch {
                state.error = store.failureText(error, "Nie udało się utworzyć fazy „\(plan.name)”.")
                break
            }
        }
        if created > 0 { state.succeed(created == 1 ? "Utworzono fazę" : "Utworzono fazy: \(created)") }
    }

    // MARK: Krok 2 — zespół na fazach

    private var withoutHours: [PhasesTabData.Person] {
        let assigned = Set(data.assignments.map(\.employeeId))
        return data.team.filter { !assigned.contains($0.id) }
    }

    /// Fazy pracy zespołu (bez załadunku i rozładunku, które robi magazyn).
    private var workPhases: [PhasesTabData.Phase] {
        let work = data.phases.filter { !$0.isWarehouse }
        return work.isEmpty ? data.phases : work
    }

    private func assignTeam() async {
        busy = true
        defer { busy = false }
        let people = withoutHours
        let phases = workPhases.map { JSONValue.string($0.id) }
        var failed: [String] = []
        for person in people {
            do {
                try await store.rpcRun(eventID, "assign_event_employee_to_phases_with_conflict_decision", [
                    "p_event_id": .string(eventID), "p_employee_id": .string(person.id), "p_phase_ids": .array(phases),
                    "p_role": .string(""), "p_accept_conflicts": .bool(false), "p_conflict_reason": .null,
                ], reload: "phases", success: nil, pending: "Przypisywanie zespołu do faz…")
            } catch {
                failed.append(person.name)
            }
        }
        Task { await store.loadTeam(eventID) }
        if failed.isEmpty {
            state.succeed("Zespół przypisany do faz (\(people.count))")
        } else {
            state.error = "Nie przypisano: " + failed.joined(separator: ", ") + " — prawdopodobnie konflikt z innym wydarzeniem lub nieobecność. Przypisz te osoby ręcznie („Dodaj do timeline”)."
        }
    }

    // MARK: Krok 3 — auta

    private var vehiclesWithoutPhase: [PhasesTabData.EventVehicle] {
        data.eventVehicles.filter { vehicle in !data.phaseVehicles.contains { $0.vehicleId != nil && $0.vehicleId == vehicle.vehicleId } }
    }

    // MARK: Krok 5 — wysyłka

    private var recipients: [EventTeamMember] {
        let assigned = Set(data.assignments.map(\.employeeId))
        return (team?.members ?? []).filter { $0.hasEmployee && $0.status != "rejected" && assigned.contains($0.employeeId) }
    }

    private func sendTimeline() async {
        busy = true
        defer { busy = false }
        var sent = 0
        var failed: [String] = []
        for member in recipients {
            do {
                try await store.teamRun(eventID, "teamInvite", [
                    "assignmentId": .string(member.id), "includePhases": .bool(true), "mode": .string("timeline_update"),
                ], success: nil, pending: "Wysyłanie timeline'u…")
                sent += 1
            } catch {
                failed.append(member.name)
            }
        }
        if failed.isEmpty { state.succeed("Timeline wysłany do zespołu (\(sent))") }
        else { state.error = "Nie wysłano do: " + failed.joined(separator: ", ") }
    }

    // MARK: Widok

    private struct Step {
        var number: Int
        var title: String
        var status: String
        var color: Color
    }

    /// Opis etapu pod przyciskiem „?”: co robi i po co.
    static let help: [Int: String] = [
        1: "Fazy dzielą wydarzenie na etapy pracy: montaż, realizację i demontaż (oraz załadunek, dojazd, powrót i rozładunek).\n\n„Utwórz z umowy i ustaleń” bierze godziny montażu i demontażu z ustaleń sprzedawcy albo z umowy, a realizację z terminu wydarzenia. Brakujący czas uzupełnia domyślną długością typu fazy. Przed zapisem pokazuje godziny do potwierdzenia, a fazy możesz potem przesuwać na osi.\n\nPo co: z faz wynikają godziny pracy zespołu, wyjazdy aut i terminy montażu i demontażu w umowie.",
        2: "Każda osoba z zakładki Zespół powinna mieć godziny pracy, czyli przypisanie do faz.\n\n„Dopasuj do faz” przypisuje osoby bez godzin do wszystkich faz pracy — bez załadunku i rozładunku, które robi magazyn. Osoby z konfliktem z innym wydarzeniem albo nieobecnością są pomijane: przypisz je ręcznie przyciskiem „Dodaj do timeline”, gdzie widać konflikt i można go świadomie zaakceptować.\n\nPo co: godziny trafiają do zaproszeń, timeline'u wysyłanego zespołowi i do rozliczenia ekipy.",
        3: "Auta dodajesz w zakładce Logistyka (pojazd, kierowca, trasa). Tutaj widzisz, czy każde auto jest przypięte do faz.\n\n„Czasy przejazdu” przenosi wyliczone w Logistyce czasy dojazdu i powrotu do faz przejazdu.\n\nPo co: wyjazd aut i praca kierowców wynikają z faz, a konflikty pojazdów widać na osi.",
        4: "Kontrola zbiera, co trzeba poprawić przed wysłaniem harmonogramu: nakładające się fazy (czerwone — do poprawy), osoby bez godzin i auta bez fazy (żółte — warto uzupełnić).\n\nGdy wszystkie kropki są zielone, harmonogram jest spójny i można go wysłać.",
        5: "„Wyślij zespołowi” wysyła każdej osobie przypisanej do faz e-mail z aktualnym harmonogramem — tak jak „Wyślij aktualny timeline” w zakładce Zespół.\n\nPrzycisk jest zablokowany, dopóki fazy się nakładają. Wysyłaj po każdej istotnej zmianie godzin, żeby zespół miał aktualny plan.",
    ]

    var body: some View {
        let plans = planned
        let missingPeople = withoutHours
        let freeVehicles = vehiclesWithoutPhase
        let issues = conflicts + missingPeople.count + freeVehicles.count
        let green = CrmTheme.rgb(0x4ade80)
        let yellow = CrmTheme.rgb(0xfacc15)
        let red = CrmTheme.rgb(0xf87171)
        let ready: Bool = issues == 0 && plans.isEmpty
        let summaryText: String = ready ? "gotowe" : "do zrobienia: \(issues + (plans.isEmpty ? 0 : 1))"
        let phasesStatus: String = plans.isEmpty ? "\(data.phases.count) faz · główne są" : "brakuje: " + plans.map(\.name).joined(separator: ", ")
        let phasesColor: Color = plans.isEmpty ? (data.phases.isEmpty ? red : green) : yellow
        let teamStatus: String = data.team.isEmpty ? "brak osób w zespole" : (missingPeople.isEmpty ? "wszyscy mają godziny" : "\(missingPeople.count) bez godzin")
        let teamColor: Color = data.team.isEmpty ? Color.secondary : (missingPeople.isEmpty ? green : yellow)
        let carsStatus: String = data.eventVehicles.isEmpty ? "brak aut w Logistyce"
            : (freeVehicles.isEmpty ? "\(data.eventVehicles.count) aut na fazach" : "\(freeVehicles.count) bez fazy")
        let carsColor: Color = data.eventVehicles.isEmpty ? Color.secondary : (freeVehicles.isEmpty ? green : yellow)
        let problems: [String] = Self.problems(conflicts: conflicts, people: missingPeople.count, cars: freeVehicles.count)
        let checkStatus: String = problems.isEmpty ? "bez konfliktów i braków" : problems.joined(separator: " · ")
        let checkColor: Color = conflicts > 0 ? red : (problems.isEmpty ? green : yellow)
        let sendStatus: String = recipients.isEmpty ? "brak osób na fazach" : "\(recipients.count) osób dostanie timeline"
        let sendColor: Color = recipients.isEmpty ? Color.secondary : theme.accent
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(.easeInOut(duration: 0.15)) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption.weight(.semibold)).frame(width: 12)
                    Text("Przygotowanie harmonogramu").font(.callout.weight(.semibold))
                    EventDotLabel(label: summaryText, color: ready ? green : yellow).font(.caption)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                    card(Step(number: 1, title: "Fazy", status: phasesStatus, color: phasesColor)) {
                        if !plans.isEmpty {
                            Button("Utwórz z umowy i ustaleń") { confirmPhases = true }.disabled(busy)
                        }
                        Button("Dodaj fazę", action: addPhase)
                    }
                    card(Step(number: 2, title: "Zespół na fazach", status: teamStatus, color: teamColor)) {
                        if !missingPeople.isEmpty && !data.phases.isEmpty {
                            Button("Dopasuj do faz") { confirmTeam = true }.disabled(busy)
                        }
                    }
                    card(Step(number: 3, title: "Auta", status: carsStatus, color: carsColor)) {
                        Button("Czasy przejazdu", action: applyTravel).disabled(busy).help("Zastosuj czasy przejazdu z logistyki")
                        Button("Logistyka") { state.showEvent(eventID, cardTab: "logistics") }
                    }
                    card(Step(number: 4, title: "Kontrola", status: checkStatus, color: checkColor)) {
                        EmptyView()
                    }
                    card(Step(number: 5, title: "Wysyłka", status: sendStatus, color: sendColor)) {
                        if !recipients.isEmpty {
                            Button("Wyślij zespołowi") { confirmSend = true }.disabled(busy || conflicts > 0)
                                .help(conflicts > 0 ? "Najpierw usuń nakładanie się faz" : "Wyślij aktualny harmonogram każdej osobie przypisanej do faz")
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
        .task(id: eventID) {
            await store.loadTab(eventID, "arrangements")
            await store.loadTeam(eventID)
        }
        .confirmationDialog("Utworzyć brakujące fazy?", isPresented: $confirmPhases, titleVisibility: .visible) {
            Button("Utwórz") { Task { await createPhases() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(plans.map { $0.name + ": " + Self.range($0.start, $0.end) }.joined(separator: "\n")
                 + "\n\nGodziny z ustaleń sprzedawcy i terminów wydarzenia — możesz je potem przesunąć na osi.")
        }
        .confirmationDialog("Przypisać osoby bez godzin do faz?", isPresented: $confirmTeam, titleVisibility: .visible) {
            Button("Przypisz") { Task { await assignTeam() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(missingPeople.map(\.name).joined(separator: ", ") + "\n\nFazy: " + workPhases.map(\.name).joined(separator: ", ")
                 + ". Osoby z konfliktem lub nieobecnością pominę — przypiszesz je ręcznie.")
        }
        .confirmationDialog("Wysłać aktualny timeline zespołowi?", isPresented: $confirmSend, titleVisibility: .visible) {
            Button("Wyślij (\(recipients.count))") { Task { await sendTimeline() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(recipients.map(\.name).joined(separator: ", "))
        }
    }

    private static func problems(conflicts: Int, people: Int, cars: Int) -> [String] {
        var result: [String] = []
        if conflicts > 0 { result.append("\(conflicts) nakładających się faz") }
        if people > 0 { result.append("\(people) osób bez godzin") }
        if cars > 0 { result.append("\(cars) aut bez fazy") }
        return result
    }

    private func card<Actions: View>(_ step: Step, @ViewBuilder actions: () -> Actions) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("\(step.number)").font(.caption.weight(.bold)).foregroundStyle(.black)
                    .frame(width: 18, height: 18).background(step.color, in: Circle())
                Text(step.title).font(.callout.weight(.semibold))
                Spacer(minLength: 4)
                Button { helpFor = step.number } label: { Image(systemName: "questionmark.circle") }
                    .buttonStyle(.borderless).foregroundStyle(.secondary).help("Co robi ten etap i po co")
                    .popover(isPresented: Binding(get: { helpFor == step.number }, set: { if !$0 { helpFor = nil } }), arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(step.number). \(step.title)").font(.headline)
                            Text(Self.help[step.number] ?? "").font(.callout).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(14).frame(width: 340, alignment: .leading)
                    }
            }
            Text(step.status).font(.caption).foregroundStyle(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) { actions() }.controlSize(.small)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
