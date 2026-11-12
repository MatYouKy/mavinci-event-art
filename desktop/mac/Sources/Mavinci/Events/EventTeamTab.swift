import SwiftUI
import AppKit

// MARK: Zespół (1:1 z zakładką „Zespół” w CRM: `TeamMembersList`, `AddEventEmployeeModal`, usuwanie z karty): osoby z przypisań
// i z odpowiedzialności, status zaproszenia, kierownik realizacji (mianowanie / odebranie), zaproszenie i aktualny timeline
// e-mailem, rola i obowiązki, uprawnienia w wydarzeniu, usuwanie; dodawanie osoby. Zespół na dysku (osobny skrót).

private let teamPermissions: [(key: String, title: String, detail: String)] = [
    ("can_edit_event", "Edycja wydarzenia", "Może edytować podstawowe informacje o wydarzeniu"),
    ("can_edit_agenda", "Edycja agendy", "Może edytować fazy wydarzenia"),
    ("can_edit_phases", "Edycja harmonogramu", "Może edytować harmonogram wydarzenia"),
    ("can_edit_tasks", "Zarządzanie zadaniami", "Może tworzyć, edytować i usuwać zadania"),
    ("can_edit_files", "Zarządzanie plikami", "Może dodawać i usuwać pliki"),
    ("can_edit_equipment", "Zarządzanie sprzętem", "Może dodawać i usuwać sprzęt"),
    ("can_invite_members", "Zapraszanie członków", "Może zapraszać innych pracowników do zespołu"),
    ("can_view_budget", "Widok budżetu", "Może przeglądać informacje finansowe"),
]

@MainActor struct EventTeamTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing: EventTeamMember?
    @State private var selectedID: String?
    @State private var editRole = ""
    @State private var editResponsibilities = ""
    @State private var permissionsFor: EventTeamMember?
    @State private var removing: EventTeamMember?
    @State private var addOpen = false
    @State private var leaderBusy = false

    private var canManageTeam: Bool { page.flags?.canManageTeam == true }
    private var team: EventTeam? { store.team(eventID) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Zespół").font(.title2.weight(.semibold))
                if let team { Text("\(team.members.filter(\.hasEmployee).count) os.").foregroundStyle(.secondary) }
                if leaderBusy { Text("Zapisywanie roli kierownika…").font(.callout).foregroundStyle(theme.accent) }
                Spacer()
                if store.teamLoading.contains(eventID) { ProgressView().controlSize(.small) }
                if canManageTeam {
                    Button { addOpen = true } label: { Label("Dodaj osobę", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
            }
            .padding(.horizontal, 18).padding(.top, 12)
            EventArrangementsBanner(store: store, eventID: eventID, area: .team).padding(.horizontal, 18)
            if let transport = team?.transport, !transport.vehicles.isEmpty {
                transportSummary(transport).padding(.horizontal, 18)
            }
            if let team {
                if team.leadershipError {
                    HStack(spacing: 4) {
                        Text("Nie udało się odczytać kierownika realizacji. Spróbuj ponownie.")
                        Button("Ponów odczyt") { Task { await store.loadTeam(eventID) } }.buttonStyle(.link).linkCursor()
                    }
                    .font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).padding(.horizontal, 18)
                }
                memberTable(team)
            } else {
                ProgressView("Wczytywanie zespołu…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTeam(eventID) }
        .onChange(of: store.card(eventID)?.hash) { Task { await store.loadTeam(eventID) } }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTeam(eventID) } }
        .sheet(item: $permissionsFor) { member in
            EventTeamPermissionsSheet(store: store, eventID: eventID, member: member).warehouseSheetStyle(state)
        }
        .sheet(isPresented: $addOpen) {
            EventTeamAddSheet(store: store, eventID: eventID, assigned: Set(team?.members.map(\.employeeId) ?? [])).warehouseSheetStyle(state)
        }
        .sheet(item: $editing) { member in roleEditor(member).warehouseSheetStyle(state) }
        .confirmationDialog("Czy na pewno chcesz usunąć tego pracownika z eventu?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let member = removing { Task { await remove(member) } } }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text(removing?.name ?? "") }
    }

    // MARK: Lista zespołu (natywna tabela: zdjęcie, Lp., osoba, rola, zakres, status, zaproszenie, czynności)

    private func roleText(_ member: EventTeamMember) -> String {
        let roles = Self.uniqueRoles(member.responsibilityRoles)
        let roleLabel = member.role?.nonEmpty.map { EventRoleLabels.label($0) } ?? ""
        let shown = roles.contains { Self.normalize($0) == Self.normalize(roleLabel) }
        let all: [String] = roles + (roleLabel.isEmpty || shown ? [] : [roleLabel])
        return all.joined(separator: " · ")
    }

    private func status(_ value: String) -> (String, Color) {
        value == "accepted" ? ("Zaakceptowano", CrmTheme.rgb(0x4ade80)) : value == "rejected" ? ("Odrzucono", CrmTheme.rgb(0xf87171)) : ("Oczekuje", CrmTheme.rgb(0xfacc15))
    }

    private func invitationText(_ member: EventTeamMember) -> String {
        if member.automatic { return "Z odpowiedzialności" }
        if member.status != "pending" { return "—" }
        return member.invitationEmailSent ? "Wysłane" : "Nie wysłano"
    }

    @ViewBuilder private func memberTable(_ team: EventTeam) -> some View {
        let members = team.members.filter(\.hasEmployee)
        let lp = Dictionary(members.enumerated().map { ($0.element.id, $0.offset + 1) }, uniquingKeysWith: { first, _ in first })
        if team.members.isEmpty {
            ContentUnavailableView("Brak przypisanych pracowników", systemImage: "person.2",
                                   description: Text(canManageTeam ? "Dodaj osoby przyciskiem „Dodaj osobę”." : "Do wydarzenia nie przypisano jeszcze nikogo."))
        } else {
            Table(members, selection: $selectedID) {
                TableColumn("") { (member: EventTeamMember) in
                    EmployeeAvatarView(name: member.name, url: member.avatarUrl, crop: member.avatar, size: 26)
                }.width(34)
                TableColumn("Lp.") { (member: EventTeamMember) in
                    Text("\(lp[member.id] ?? 0)").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
                }.width(36)
                TableColumn("Osoba") { (member: EventTeamMember) in
                    HStack(spacing: 6) {
                        Text(member.name).fontWeight(.medium).lineLimit(1)
                        if team.managerID == member.employeeId && !member.employeeId.isEmpty {
                            Image(systemName: "crown.fill").font(.caption).foregroundStyle(theme.accent).help("Kierownik realizacji")
                        }
                    }
                }.width(min: 140, ideal: 220)
                TableColumn("Rola") { (member: EventTeamMember) in
                    Text(roleText(member)).lineLimit(1).foregroundStyle(.secondary).help(roleText(member))
                }.width(min: 90, ideal: 200)
                TableColumn("Zakres obowiązków") { (member: EventTeamMember) in
                    Text(member.responsibilities ?? "").lineLimit(1).foregroundStyle(.secondary).help(member.responsibilities ?? "")
                }.width(min: 90, ideal: 260)
                TableColumn("Transport") { (member: EventTeamMember) in
                    let text = transportText(member, team)
                    Text(text.label).lineLimit(1).foregroundStyle(text.driver ? theme.accent : text.assigned ? Color.primary : Color.secondary)
                        .help(text.label)
                }.width(min: 80, ideal: 150)
                TableColumn("Status") { (member: EventTeamMember) in
                    EventDotLabel(label: status(member.status).0, color: status(member.status).1)
                }.width(min: 90, ideal: 130)
                TableColumn("Zaproszenie") { (member: EventTeamMember) in
                    Text(invitationText(member)).foregroundStyle(.secondary).lineLimit(1)
                }.width(min: 80, ideal: 130)
                TableColumn("") { (member: EventTeamMember) in actionsMenu(member, team) }.width(30)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let member = members.first(where: { $0.id == id }) { menuItems(member, team) }
            } primaryAction: { ids in
                if let id = ids.first, let member = members.first(where: { $0.id == id }), !member.employeeId.isEmpty { state.showEmployee(member.employeeId) }
            }
        }
    }

    private func editable(_ member: EventTeamMember, _ team: EventTeam) -> Bool {
        !member.automatic && (canManageTeam || team.canManageLeader)
    }

    @ViewBuilder private func actionsMenu(_ member: EventTeamMember, _ team: EventTeam) -> some View {
        if editable(member, team) || !member.employeeId.isEmpty {
            Menu { menuItems(member, team) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
        }
    }

    @ViewBuilder private func menuItems(_ member: EventTeamMember, _ team: EventTeam) -> some View {
        if !member.employeeId.isEmpty {
            Button("Karta pracownika", systemImage: "person.text.rectangle") { state.showEmployee(member.employeeId) }
        }
        if editable(member, team) {
            let isLeader = team.managerID == member.employeeId && !member.employeeId.isEmpty
            Divider()
            ForEach(actionList(member, team, isLeader: isLeader), id: \.title) { action in
                Button(action.title, systemImage: action.symbol, role: action.destructive ? .destructive : nil, action: action.run)
                    .disabled(action.disabled)
            }
            if canManageTeam, let transport = team.transport, !transport.vehicles.isEmpty, member.status != "rejected" {
                Divider()
                transportMenu(member, transport)
            }
        }
    }

    // MARK: Transport — którym autem jedzie osoba; kierowca jest przypisany w logistyce

    private func transportText(_ member: EventTeamMember, _ team: EventTeam) -> (label: String, driver: Bool, assigned: Bool) {
        let vehicles = team.transport?.vehicles ?? []
        if let driven = vehicles.first(where: { $0.driverId == member.employeeId && !member.employeeId.isEmpty }) {
            return ("Kierowca · " + driven.name, true, true)
        }
        if let id = member.transportVehicleId, let vehicle = vehicles.first(where: { $0.id == id }) { return (vehicle.name, false, true) }
        return (vehicles.isEmpty ? "—" : "Bez auta", false, false)
    }

    @ViewBuilder private func transportMenu(_ member: EventTeamMember, _ transport: EventTeamTransport) -> some View {
        if let driven = transport.vehicles.first(where: { $0.driverId == member.employeeId && !member.employeeId.isEmpty }) {
            Button("Kierowca: \(driven.name) — zmiana w logistyce", systemImage: "steeringwheel") {}.disabled(true)
        } else {
            Menu {
                Picker("Jedzie autem", selection: Binding(
                    get: { member.transportVehicleId ?? "" },
                    set: { id in Task { await setTransport(member, id.isEmpty ? nil : id) } }
                )) {
                    Text("Bez auta (dojazd własny)").tag("")
                    ForEach(transport.vehicles) { vehicle in
                        Text(vehicle.label + (vehicle.seats.map { vehicle.people >= $0 && member.transportVehicleId != vehicle.id ? " — brak miejsc" : "" } ?? ""))
                            .tag(vehicle.id)
                    }
                }
                .pickerStyle(.inline).labelsHidden()
            } label: {
                Label("Jedzie autem", systemImage: "car")
            }
        }
    }

    /// Obsada aut i ostrzeżenia: za mało miejsc w aucie albo w całej flocie wydarzenia.
    private func transportSummary(_ transport: EventTeamTransport) -> some View {
        let warning = !transport.warnings.isEmpty
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: warning ? "exclamationmark.triangle.fill" : "car.2.fill")
                    .foregroundStyle(warning ? Color.orange : theme.accent)
                Text(transport.vehicles.map { $0.name + " \($0.people)/\($0.seats.map(String.init) ?? "?")" }.joined(separator: " · "))
                    .font(.callout).lineLimit(1)
                Spacer(minLength: 8)
                if transport.withoutVehicle > 0 {
                    Text("Bez auta: \(transport.withoutVehicle) os.").font(.callout).foregroundStyle(.secondary)
                }
            }
            ForEach(transport.warnings, id: \.self) { text in
                Text(text).font(.caption).foregroundStyle(.orange)
            }
            if canManageTeam && transport.withoutVehicle > 0 && !warning {
                Text("Przypisz auto w menu ⋯ przy osobie (kierowcę ustawiasz w logistyce).").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background((warning ? Color.orange : Color.primary).opacity(warning ? 0.10 : 0.04), in: RoundedRectangle(cornerRadius: 9))
    }

    private func setTransport(_ member: EventTeamMember, _ vehicleID: String?) async {
        guard vehicleID != member.transportVehicleId else { return }
        do {
            try await store.teamRun(eventID, "teamTransport", [
                "assignmentId": .string(member.id),
                "eventVehicleId": vehicleID.map { JSONValue.string($0) } ?? .null,
            ], success: vehicleID == nil ? "Bez auta — dojazd własny" : "Zapisano transport")
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać transportu.")
        }
    }

    /// „Edytuj rolę i obowiązki” — okno zamiast rozwijanego wiersza.
    private func roleEditor(_ member: EventTeamMember) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                EmployeeAvatarView(name: member.name, url: member.avatarUrl, crop: member.avatar, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Rola i obowiązki").font(.title3.weight(.semibold))
                    Text(member.name).foregroundStyle(.secondary)
                }
            }
            Text("Rola").font(.caption).foregroundStyle(.secondary)
            TextField("np. Lead Audio, Technician...", text: $editRole).textFieldStyle(.roundedBorder)
            Text("Zakres odpowiedzialności").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $editResponsibilities).frame(minHeight: 90).scrollContentBackground(.hidden).padding(4)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                .overlay(alignment: .topLeading) {
                    if editResponsibilities.isEmpty { Text("Opisz zakres obowiązków...").foregroundStyle(.tertiary).padding(8).allowsHitTesting(false) }
                }
            HStack {
                Spacer()
                Button("Anuluj") { editing = nil }.keyboardShortcut(.cancelAction)
                Button("Zapisz") { Task { await saveEdit(member) } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20).frame(width: 460)
    }

    private struct MemberAction { let title: String; let symbol: String; var destructive = false; var disabled = false; let run: () -> Void }

    private func actionList(_ member: EventTeamMember, _ team: EventTeam, isLeader: Bool) -> [MemberAction] {
        var list: [MemberAction] = []
        if team.canManageLeader && (isLeader || member.status == "accepted") {
            list.append(MemberAction(title: isLeader ? "Odbierz uprawnienia kierownika" : "Mianuj kierownikiem realizacji",
                                     symbol: isLeader ? "person.badge.minus" : "person.badge.shield.checkmark", destructive: isLeader,
                                     disabled: leaderBusy || !team.canChangeLeader, run: { Task { await changeLeader(member, revoke: isLeader) } }))
        }
        if canManageTeam && member.status == "pending" && !member.invitationEmailSent {
            list.append(MemberAction(title: "Wyślij zaproszenie", symbol: "paperplane", run: { Task { await invite(member, timeline: false) } }))
        }
        if canManageTeam && member.status != "rejected" {
            list.append(MemberAction(title: "Wyślij aktualny timeline", symbol: "envelope", run: { Task { await invite(member, timeline: true) } }))
        }
        if canManageTeam {
            list.append(MemberAction(title: "Edytuj rolę i obowiązki", symbol: "pencil", run: {
                editRole = member.role ?? ""
                editResponsibilities = member.responsibilities ?? ""
                editing = member
            }))
            list.append(MemberAction(title: "Uprawnienia w wydarzeniu", symbol: "person", run: { permissionsFor = member }))
            list.append(MemberAction(title: "Usuń z zespołu", symbol: "trash", destructive: true, run: { removing = member }))
        }
        return list
    }

    private func statusBadge(_ status: String) -> some View {
        let (text, color): (String, Color) = status == "accepted" ? ("Zaakceptowano", CrmTheme.rgb(0x4ade80))
            : status == "rejected" ? ("Odrzucono", CrmTheme.rgb(0xf87171)) : ("Oczekuje", CrmTheme.rgb(0xfacc15))
        return Text(text).font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.2), in: Capsule()).foregroundStyle(color)
    }

    static func normalize(_ label: String) -> String {
        label.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).lowercased()
    }
    static func uniqueRoles(_ roles: [String]) -> [String] {
        var seen = Set<String>()
        return roles.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty && seen.insert(normalize($0)).inserted }
    }

    // MARK: Czynności
    private func changeLeader(_ member: EventTeamMember, revoke: Bool) async {
        guard !leaderBusy else { return }
        leaderBusy = true
        defer { leaderBusy = false }
        do {
            _ = try await state.withPending("Zapisywanie…") {
                try await store.rpc(revoke ? "revoke_realization_manager" : "appoint_realization_manager",
                                    ["p_event_id": .string(eventID), "p_employee_id": .string(member.employeeId)])
            }
            state.succeed(revoke ? "Odebrano rolę kierownika realizacji." : "Wyznaczono kierownika realizacji.")
            await store.loadTeam(eventID)
            Task { await store.loadOverview(eventID) }
        } catch {
            state.error = (error as? NativeFailure)?.message.nonEmpty ?? "Nie udało się zmienić kierownika realizacji."
        }
    }
    private func invite(_ member: EventTeamMember, timeline: Bool) async {
        do {
            let data = try await store.teamRun(eventID, "teamInvite", [
                "assignmentId": .string(member.id), "includePhases": .bool(timeline), "mode": .string(timeline ? "timeline_update" : "invitation"),
            ], success: nil, pending: "Wysyłanie…")
            struct Reply: Decodable { let skipped: Bool? }
            if (try? JSONDecoder().decode(Reply.self, from: data))?.skipped == true {
                state.notice = "Zaproszenie nie jest potrzebne — nie wysłano wiadomości."
            } else {
                state.succeed(timeline ? "Uzupełniony harmonogram został wysłany" : "Zaproszenie zostało wysłane")
            }
        } catch {
            state.error = store.failureText(error, "Błąd podczas wysyłania zaproszenia")
        }
    }
    private func saveEdit(_ member: EventTeamMember) async {
        do {
            try await store.teamRun(eventID, "teamUpdate", ["assignmentId": .string(member.id), "role": .string(editRole), "responsibilities": .string(editResponsibilities)],
                                    success: "Zapisano rolę i obowiązki")
            editing = nil
        } catch {
            state.error = store.failureText(error, "Błąd podczas aktualizacji")
        }
    }
    private func remove(_ member: EventTeamMember) async {
        removing = nil
        do {
            try await store.teamRun(eventID, "teamRemove", ["assignmentId": .string(member.id)], success: "Pracownik został usunięty z eventu", pending: "Usuwanie…")
        } catch {
            state.error = store.failureText(error, "Błąd podczas usuwania pracownika")
        }
    }
}

/// „Zarządzaj uprawnieniami” osoby w wydarzeniu.
@MainActor struct EventTeamPermissionsSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let member: EventTeamMember
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var form: [String: Bool] = [:]
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Zarządzaj uprawnieniami").font(.title3.weight(.light))
                Text(member.name).font(.callout).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(teamPermissions, id: \.key) { item in
                    Toggle(isOn: Binding(get: { form[item.key] == true }, set: { form[item.key] = $0 })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title).font(.callout.weight(.medium))
                            Text(item.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 440)
        .onAppear { form = member.permissions }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await store.teamRun(eventID, "teamPermissions", [
                "assignmentId": .string(member.id),
                "permissions": .object(Dictionary(uniqueKeysWithValues: teamPermissions.map { ($0.key, JSONValue.bool(form[$0.key] == true)) })),
            ], success: "Uprawnienia zostały zapisane")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas aktualizacji uprawnień")
        }
    }
}

/// „Dodaj osobę do zespołu” (`AddEventEmployeeModal`).
@MainActor struct EventTeamAddSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let assigned: Set<String>
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var candidates: EventTeamCandidates?
    @State private var loading = true
    @State private var employeeID = ""
    @State private var role = ""
    @State private var responsibilities = ""
    @State private var permissionsOpen = false
    @State private var permissions: [String: Bool] = [:]
    @State private var sendInvitation = true
    @State private var includePhases = false
    @State private var submitting = false

    private var available: [EventTeamCandidates.Employee] { (candidates?.employees ?? []).filter { !assigned.contains($0.id) } }
    private var phases: [EventTeamCandidates.Phase] { employeeID.isEmpty ? [] : candidates?.phases[employeeID] ?? [] }
    private var anyPermission: Bool { permissions.values.contains(true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj osobę do zespołu").font(.title3.weight(.light))
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    field("Pracownik") {
                        Picker("Pracownik", selection: $employeeID) {
                            Text(loading ? "Ładowanie..." : available.isEmpty ? "Wszyscy aktywni pracownicy są już w zespole" : "Wybierz pracownika...").tag("")
                            ForEach(available) { employee in
                                Text("\(employee.name) \(employee.surname)" + (employee.occupation?.nonEmpty.map { " - \($0)" } ?? "")).tag(employee.id)
                            }
                        }
                        .labelsHidden().disabled(loading)
                        Text("Dodanie do zespołu od razu nadaje dostęp do wydarzenia. Timeline możesz uzupełnić później.").font(.caption).foregroundStyle(.tertiary)
                    }
                    if !phases.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Przypisane fazy").font(.callout.weight(.medium))
                            ForEach(phases, id: \.phaseId) { phase in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(phase.name).font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                                    Text("Praca: \(Self.short(phase.workStart)) - \(Self.short(phase.workEnd))").font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                            }
                        }
                        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
                    }
                    field("Rola w evencie") { TextField("np. Lead Audio, Technician...", text: $role).textFieldStyle(.roundedBorder) }
                    field("Zakres odpowiedzialności") {
                        TextEditor(text: $responsibilities).frame(minHeight: 70).scrollContentBackground(.hidden).padding(4)
                            .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 7))
                            .overlay(alignment: .topLeading) {
                                if responsibilities.isEmpty { Text("Opisz zakres obowiązków...").foregroundStyle(.tertiary).padding(8).allowsHitTesting(false) }
                            }
                    }
                    // Zakres widoczności wynika z roli pracownika (ustawienia pracownika) — bez wyboru przy dodawaniu.
                    Label("Co ta osoba widzi w wydarzeniu, wynika z jej roli w ustawieniach pracownika. Poniżej możesz dodatkowo nadać uprawnienia do edycji w tym wydarzeniu.",
                          systemImage: "person.badge.shield.checkmark")
                        .font(.caption).foregroundStyle(.secondary)
                    Divider()
                    Toggle("Nadaj uprawnienia współpracownika", isOn: Binding(get: { permissionsOpen || anyPermission }, set: { on in
                        permissionsOpen = on
                        if !on { permissions = [:] }
                    }))
                    .toggleStyle(.checkbox).fontWeight(.medium)
                    if permissionsOpen || anyPermission {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Zaznacz uprawnienia które chcesz nadać:").font(.caption).foregroundStyle(.secondary)
                            ForEach(Self.addLabels, id: \.0) { item in
                                Toggle(item.1, isOn: Binding(get: { permissions[item.0] == true }, set: { permissions[item.0] = $0 })).toggleStyle(.checkbox)
                            }
                        }
                        .padding(10).padding(.leading, 14)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(isOn: $sendInvitation) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Wyślij teraz zaproszenie e-mailem").font(.callout.weight(.medium))
                                Text("Pracownik może zostać dodany do zespołu również bez wysyłania wiadomości.").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .toggleStyle(.checkbox)
                        if sendInvitation {
                            Toggle(isOn: $includePhases) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Dołącz aktualnie przypisane fazy timeline").font(.callout.weight(.medium))
                                    Text(phases.isEmpty ? "Brak przypisanych faz — zaproszenie zostanie wysłane bez harmonogramu. Możesz dosłać go później z listy zespołu."
                                         : "W wiadomości pojawi się \(phases.count) przypisanych faz.").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.checkbox).padding(.leading, 18)
                        }
                    }
                    .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
                }
            }
            .frame(maxHeight: 520)
            HStack {
                Button(submitting ? "Dodawanie..." : "Dodaj do wydarzenia") { Task { await submit() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(submitting)
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(submitting)
                Spacer()
            }
        }
        .padding(20).frame(width: 520)
        .task {
            do {
                let result = try await store.teamCandidates(eventID)
                candidates = result
                if result.phasesError == true { state.error = "Błąd podczas pobierania pracowników z faz" }
            } catch {
                state.error = store.failureText(error, "Nie udało się pobrać listy pracowników.")
            }
            loading = false
        }
    }

    private static let addLabels: [(String, String)] = [
        ("can_edit_event", "Edycja wydarzenia (nazwa, data, lokalizacja)"), ("can_edit_phases", "Edycja faz i timeline"),
        ("can_edit_agenda", "Edycja agendy"), ("can_edit_tasks", "Zarządzanie zadaniami"), ("can_edit_files", "Zarządzanie plikami"),
        ("can_edit_equipment", "Zarządzanie sprzętem"), ("can_invite_members", "Zapraszanie członków zespołu"), ("can_view_budget", "Widok budżetu"),
    ]

    /// „14.11, 18:00” (`toLocaleString('pl-PL', { day, month, hour, minute: '2-digit' })`).
    static func short(_ value: String?) -> String {
        guard let date = value.flatMap(MeetingDates.parse) else { return "—" }
        return MeetingDates.format(date, "dd.MM, HH:mm")
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.callout).foregroundStyle(.secondary)
            content()
        }
    }

    private func submit() async {
        guard !employeeID.isEmpty else { state.notice = "Wybierz pracownika"; return }
        submitting = true
        defer { submitting = false }
        do {
            try await store.teamRun(eventID, "teamAdd", [
                "employeeId": .string(employeeID), "role": .string(role), "responsibilities": .string(responsibilities),
                "permissions": .object(Dictionary(uniqueKeysWithValues: Self.addLabels.map { ($0.0, JSONValue.bool(permissions[$0.0] == true)) })),
                "sendInvitation": .bool(sendInvitation), "includePhases": .bool(includePhases),
            ], success: "Pracownik dodany do zespołu", pending: "Dodawanie…")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas dodawania pracownika")
        }
    }
}
