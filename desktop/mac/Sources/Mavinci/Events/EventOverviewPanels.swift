import SwiftUI
import AppKit

// MARK: Przegląd: kontrola przed wydarzeniem (`EventPreflightPanel`), „Najważniejsze” (`EventKeyFactsCard`), kontakty na miejscu
// (`EventOnsiteContacts`) i wiadomość do magazynu (`WarehouseMessageModal`). Dane z kopii przeglądu na dysku.

@MainActor struct EventPreflightView: View {
    let preflight: EventPreflight
    let hideCommercial: Bool
    var onRefresh: () -> Void
    var onNavigate: (String) -> Void
    var canOpenTab: (String) -> Bool
    @State private var expanded = false

    private static let commercialCodes: Set<String> = ["contract", "payment_overdue", "payment_schedule", "deposit"]
    private static let commercialTabs: Set<String> = ["contract", "finances"]

    var body: some View {
        let issues = (preflight.issues ?? []).filter { !hideCommercial || (!Self.commercialCodes.contains($0.code) && !Self.commercialTabs.contains($0.tab)) }
        let critical = issues.filter { $0.severity == "critical" }.count
        let warnings = issues.count - critical
        let ready = hideCommercial ? issues.isEmpty : preflight.ready == true
        let summary = issues.isEmpty ? "Bez uwag" : [critical > 0 ? "pilne: \(critical)" : "", warnings > 0 ? "do sprawdzenia: \(warnings)" : ""].filter { !$0.isEmpty }.joined(separator: " · ")
        let tint = ready ? CrmTheme.rgb(0x22c55e).opacity(0.06) : critical > 0 ? CrmTheme.rgb(0xef4444).opacity(0.07) : CrmTheme.rgb(0xf59e0b).opacity(0.07)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: ready ? "checkmark.circle" : critical > 0 ? "exclamationmark.triangle" : "checkmark.shield")
                .font(.title3)
                .foregroundStyle(ready ? CrmTheme.rgb(0x4ade80) : critical > 0 ? CrmTheme.rgb(0xf87171) : CrmTheme.rgb(0xfcd34d))
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Button { expanded.toggle() } label: {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Kontrola przed wydarzeniem").font(.headline)
                                Text("\(daysText) · \(summary)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary).rotationEffect(.degrees(expanded ? 180 : 0))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Button(action: onRefresh) { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless).help("Odśwież kontrolę przed wydarzeniem")
                }
                if expanded {
                    if issues.isEmpty {
                        Text(hideCommercial ? "Zespół i zasoby są przygotowane. Brak nierozwiązanych konfliktów."
                             : "Formalności, płatności, zespół i zasoby są przygotowane. Brak nierozwiązanych konfliktów.")
                            .font(.callout).foregroundStyle(CrmTheme.rgb(0xbbf7d0))
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(CrmTheme.rgb(0x22c55e).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    } else {
                        ForEach(issues, id: \.code) { issue in issueRow(issue) }
                    }
                    if let conflicts = preflight.accepted_employee_conflicts, conflicts > 0 {
                        Button { onNavigate("team") } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "checkmark.shield").foregroundStyle(CrmTheme.rgb(0x93c5fd))
                                Text("Zaakceptowane nakładanie pracy między wydarzeniami: \(conflicts). Decyzje mają zapisane uzasadnienie i osobę akceptującą.")
                                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xdbeafe).opacity(0.75))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(CrmTheme.rgb(0xbfdbfe).opacity(0.35))
                            }
                            .padding(10).background(CrmTheme.rgb(0x3b82f6).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(tint, in: RoundedRectangle(cornerRadius: 12))
    }

    private var daysText: String {
        guard let date = preflight.event_date.flatMap(MeetingDates.parse) else { return "Termin nieznany" }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: Date()), to: calendar.startOfDay(for: date)).day ?? 0
        if days < 0 { return "\(abs(days)) dni po wydarzeniu" }
        return days == 0 ? "Wydarzenie jest dzisiaj" : "Do wydarzenia: \(days) dni"
    }

    @ViewBuilder private func issueRow(_ issue: EventPreflightIssue) -> some View {
        let content = HStack(spacing: 10) {
            Circle().fill(issue.severity == "critical" ? CrmTheme.rgb(0xf87171) : CrmTheme.rgb(0xfcd34d)).frame(width: 8, height: 8)
            Text(issue.label).font(.callout).foregroundStyle(Color.primary.opacity(0.8)).frame(maxWidth: .infinity, alignment: .leading)
            if canOpenTab(issue.tab) { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
        }
        .padding(10).background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
        if canOpenTab(issue.tab) {
            Button { onNavigate(issue.tab) } label: { content }.buttonStyle(.plain)
        } else {
            content
        }
    }
}

// MARK: Najważniejsze

@MainActor struct EventKeyFactsView: View {
    let eventID: String
    let page: EventCardPage
    let overview: EventCardOverview
    var onNavigate: (String) -> Void
    var canOpenTab: (String) -> Bool
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var messageMode: Bool?

    private struct Fact: Identifiable { let id: String; let symbol: String; let label: String; let tab: String?; let value: AnyView }

    private static let roleOrder: [String: [String]] = [
        "driver": ["date", "loading", "place", "vehicles", "onsite", "manager", "warehouse", "equipment"],
        "warehouse": ["loading", "date", "equipment", "warehouse", "vehicles", "place", "manager", "onsite"],
        "manager": ["date", "place", "onsite", "loading", "manager", "warehouse", "vehicles", "equipment"],
        "default": ["date", "place", "loading", "manager", "warehouse", "equipment", "vehicles", "onsite"],
    ]
    private static let roleDisplayOrder = ["admin", "seller", "office", "manager", "warehouse", "driver", "team"]
    private static let roleLabels: [String: String] = [
        "admin": "Administrator", "seller": "Sprzedawca / prowadzący", "office": "Biuro", "manager": "Kierownik realizacji",
        "warehouse": "Magazyn", "driver": "Kierowca", "team": "Zespół", "colleague": "Inny sprzedawca",
    ]
    static let operationalLabels: [String: String] = [
        "inquiry": "Nowe wydarzenie", "offer_accepted": "Do potwierdzenia", "in_preparation": "W przygotowaniu",
        "ready_for_live": "Gotowe do realizacji", "in_progress": "W trakcie realizacji", "completed": "Zrealizowane",
        "settled": "Zakończone", "cancelled": "Anulowane",
    ]

    private var event: EventFields { EventFields(raw: page.event ?? [:]) }
    private var roles: Set<String> { Set(page.flags?.roles ?? []) }

    var body: some View {
        let labels = Self.roleDisplayOrder.filter { roles.contains($0) }.compactMap { Self.roleLabels[$0] }
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Najważniejsze").font(.headline)
                if !labels.isEmpty { Text("Twoja rola: \(labels.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary) }
            }
            VStack(alignment: .leading, spacing: 2) {
                ForEach(facts) { fact in row(fact) }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .sheet(item: Binding(get: { messageMode.map { WarehouseMessageMode(request: $0) } }, set: { messageMode = $0?.request })) { mode in
            WarehouseMessageSheet(store: workspace.eventCards, eventID: eventID, request: mode.request).warehouseSheetStyle(workspace)
        }
    }

    private func row(_ fact: Fact) -> some View {
        let openable = fact.tab.map(canOpenTab) ?? false
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: fact.symbol).foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(fact.label).font(.caption).foregroundStyle(.secondary)
                fact.value.font(.callout)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if openable, let tab = fact.tab {
                Button { onNavigate(tab) } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.borderless).foregroundStyle(.tertiary).help("Otwórz zakładkę")
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 7)
    }

    private var primaryRole: String {
        if roles.contains("manager") { return "manager" }
        if roles.contains("driver") { return "driver" }
        if roles.contains("warehouse") { return "warehouse" }
        return "default"
    }

    private var facts: [Fact] {
        var items: [String: Fact] = [:]
        let f = overview.facts
        items["date"] = Fact(id: "date", symbol: "calendar", label: "Termin", tab: "details", value: AnyView(Text(dateRange).monospacedDigit()))
        if let loading = f.loadingAt.flatMap(MeetingDates.parse) {
            items["loading"] = Fact(id: "loading", symbol: "clock", label: "Załadunek", tab: "phases",
                                    value: AnyView(Text("\(MeetingDates.format(loading, "EEE, d MMMM")), \(MeetingDates.format(loading, "HH:mm"))")))
        }
        items["place"] = Fact(id: "place", symbol: "mappin", label: "Miejsce", tab: "details", value: AnyView(place))
        items["manager"] = Fact(id: "manager", symbol: "person.crop.circle.badge.checkmark", label: "Kierownik realizacji", tab: "team", value: AnyView(
            VStack(alignment: .leading, spacing: 1) {
                Text(f.managerName?.nonEmpty ?? "Nie wyznaczono")
                if let status = f.operationalStatus, let label = Self.operationalLabels[status] { Text(label).font(.caption).foregroundStyle(.secondary) }
            }
        ))
        if f.handoffKnown {
            let handoff = f.handoff
            let status: String
            if handoff?.ready_at != nil { status = "Gotowe do wydania" + (handoff?.ready_by_name?.nonEmpty.map { " · \($0)" } ?? "") }
            else if handoff?.accepted_at != nil { status = "W przygotowaniu · przyjął(a) \(handoff?.accepted_by_name?.nonEmpty ?? "magazyn")" }
            else { status = "Czeka na przyjęcie przez magazyn" }
            let canMessage = f.canContactWarehouse && !f.canPrepareWarehouse
            let accepted = handoff?.accepted_at != nil
            items["warehouse"] = Fact(id: "warehouse", symbol: "building.2", label: "Magazyn", tab: "equipment", value: AnyView(
                VStack(alignment: .leading, spacing: 6) {
                    Text(status)
                    if canMessage {
                        HStack(spacing: 6) {
                            if !accepted { smallButton("Poproś o przyjęcie", prominent: true) { messageMode = true } }
                            smallButton("Napisz do magazynu", prominent: false) { messageMode = false }
                        }
                    }
                }
            ))
        }
        if let count = overview.equipmentCount {
            let text: String
            if count == 0 { text = "Nie przypisano sprzętu" }
            else if count == 1 { text = "1 pozycja" }
            else if (2...4).contains(count % 10) && (count % 100 < 12 || count % 100 > 14) { text = "\(count) pozycje" }
            else { text = "\(count) pozycji" }
            items["equipment"] = Fact(id: "equipment", symbol: "shippingbox", label: "Sprzęt", tab: "equipment", value: AnyView(Text(text)))
        }
        if let vehicles = f.vehicles {
            items["vehicles"] = Fact(id: "vehicles", symbol: "truck.box", label: "Transport", tab: "logistics", value: AnyView(
                VStack(alignment: .leading, spacing: 2) {
                    if vehicles.isEmpty { Text("Brak zaplanowanych pojazdów") }
                    ForEach(vehicles) { vehicle in
                        Text(vehicle.label) + Text(" — " + Self.driverText(vehicle.driver)).foregroundColor(.secondary)
                    }
                }
            ))
        }
        if page.flags?.canViewOnsiteContact == true {
            let contacts = overview.onsite.contacts
            let primary = contacts.first { $0.is_primary == true } ?? contacts.first
            items["onsite"] = Fact(id: "onsite", symbol: "person", label: "Kontakt na miejscu", tab: "details", value: AnyView(
                VStack(alignment: .leading, spacing: 2) {
                    if let primary {
                        Text(primary.displayName)
                        if let role = primary.role?.nonEmpty { Text(role).font(.caption).foregroundStyle(.secondary) }
                        if let phone = primary.phone?.nonEmpty, let url = EventStepRules.telURL(phone) {
                            Button { NSWorkspace.shared.open(url) } label: { Label(phone, systemImage: "phone").font(.caption) }
                                .buttonStyle(.link)
                        }
                        if contacts.count > 1 { Text("Pozostałe kontakty: \(contacts.count - 1) (Szczegóły)").font(.caption).foregroundStyle(.tertiary) }
                    } else {
                        Text("Nie podano")
                    }
                }
            ))
        }
        return (Self.roleOrder[primaryRole] ?? []).compactMap { items[$0] }
    }

    static func driverText(_ driver: String?) -> String {
        guard let driver else { return "bez kierowcy" }
        return "kierowca: \(driver)"
    }

    private func smallButton(_ title: String, prominent: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                .foregroundStyle(theme.accent)
                .background(prominent ? theme.accent.opacity(0.15) : Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// „pt., 14 listopada 2026, 18:00–23:00” jak `formatDateRange` w CRM.
    private var dateRange: String {
        guard let from = event.start else { return "Termin nieustalony" }
        let day = MeetingDates.format(from, "EEE, d MMMM yyyy")
        if event.raw["seller_schedule_pending"]?.flag == true { return "\(day) · godziny do ustalenia" }
        let time = { (date: Date) in MeetingDates.format(date, "HH:mm") }
        guard let to = event.end else { return "\(day), \(time(from))" }
        if MeetingDates.calendar.isDate(to, inSameDayAs: from) { return "\(day), \(time(from))–\(time(to))" }
        return "\(day), \(time(from)) – \(MeetingDates.format(to, "d MMMM")), \(time(to))"
    }

    private var place: some View {
        let location = page.location ?? [:]
        let name = location["name"]?.text.nonEmpty ?? event["location"].nonEmpty
        let address = location["formatted_address"]?.text.nonEmpty
            ?? [location["address"]?.text ?? "", location["postal_code"]?.text ?? "", location["city"]?.text ?? ""].filter { !$0.isEmpty }.joined(separator: ", ").nonEmpty
        let maps = location["google_maps_url"]?.text.nonEmpty.flatMap { URL(string: $0) }
        return VStack(alignment: .leading, spacing: 1) {
            if let name {
                if let maps {
                    Button(name) { NSWorkspace.shared.open(maps) }.buttonStyle(.link).help("Otwórz w Mapach Google")
                } else {
                    Text(name)
                }
                if let address { Text(address).font(.caption).foregroundStyle(.secondary) }
            } else {
                Text("Brak lokalizacji")
            }
        }
    }
}

private struct WarehouseMessageMode: Identifiable { let request: Bool; var id: Bool { request } }

// MARK: Kontakty na miejscu

@MainActor struct EventOnsiteContactsList: View {
    let contacts: [EventOnsiteContact]
    var compact = false
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 8) {
            ForEach(Array(contacts.enumerated()), id: \.offset) { _, contact in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(contact.displayName).font(.callout)
                            if contact.is_primary == true { Text("główny kontakt").font(.caption).foregroundStyle(theme.accent) }
                        }
                        Text(contact.role?.nonEmpty ?? contact.sourceLabel).font(.caption).foregroundStyle(.secondary)
                        if !compact, let notes = contact.notes?.nonEmpty { Text(notes).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                    Spacer(minLength: 8)
                    if let phone = contact.phone?.nonEmpty, let url = EventStepRules.telURL(phone) {
                        Button { NSWorkspace.shared.open(url) } label: { Label(phone, systemImage: "phone").font(.caption) }
                            .buttonStyle(.borderless).foregroundStyle(theme.accent)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
                            .help("Zadzwoń: \(contact.displayName)")
                    } else {
                        Text("brak telefonu").font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, compact ? 6 : 8)
                .background(Color.primary.opacity(compact ? 0.03 : 0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

/// Sekcja „Kontakt na miejscu” w Szczegółach — dla osób bez danych klienta, z obszarem „kontakt na miejscu”.
@MainActor struct EventOnsiteContactsSection: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Kontakt na miejscu", systemImage: "person").font(.callout.weight(.medium))
            if let onsite = store.overview(eventID)?.onsite {
                if onsite.error == true {
                    HStack(spacing: 6) {
                        Text("Nie udało się wczytać kontaktu na miejscu.").foregroundStyle(.red)
                        Button("Spróbuj ponownie") { Task { await store.loadOverview(eventID) } }.buttonStyle(.link)
                    }
                    .font(.callout)
                } else if onsite.contacts.isEmpty {
                    Text("Nie podano kontaktu na miejscu.").font(.callout).foregroundStyle(.secondary)
                } else {
                    EventOnsiteContactsList(contacts: onsite.contacts)
                }
            } else {
                Text("Wczytywanie…").font(.callout).foregroundStyle(.secondary)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .task(id: eventID) { if store.overview(eventID) == nil { await store.loadOverview(eventID) } }
    }
}

// MARK: Wiadomość do magazynu

@MainActor struct WarehouseMessageSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let request: Bool
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var recipients: [Recipient] = []
    @State private var recipient = ""
    @State private var message = ""
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var requestID: String?

    struct Recipient: Codable, Identifiable { let id: String; let name: String }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(request ? "Poproś magazyn o podjęcie akcji" : "Napisz do magazynu").font(.title3.weight(.light))
            Text("Pracownik otrzyma powiadomienie z treścią i odnośnikiem do tego wydarzenia.").font(.callout).foregroundStyle(.secondary)
            Picker("Pracownik magazynu", selection: $recipient) {
                Text("Wybierz osobę").tag("")
                ForEach(recipients) { Text($0.name).tag($0.id) }
            }
            .disabled(loading || saving)
            .onChange(of: recipient) { requestID = nil }
            VStack(alignment: .leading, spacing: 4) {
                Text("Wiadomość").font(.callout)
                TextEditor(text: $message)
                    .frame(minHeight: 110).scrollContentBackground(.hidden).padding(6)
                    .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                    .disabled(loading || saving)
                    .onChange(of: message) {
                        if message.count > 4000 { message = String(message.prefix(4000)) }
                        requestID = nil
                    }
            }
            if loading { Text("Ładowanie pracowników…").font(.callout).foregroundStyle(.secondary) }
            if !loading && error == nil && recipients.isEmpty {
                Text("Brak dostępnych pracowników magazynu dla tego wydarzenia.").font(.callout).foregroundStyle(.secondary)
            }
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Wysyłanie…" : "Wyślij") { Task { await send() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(loading || saving || recipient.isEmpty || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 520)
        .task {
            if request { message = "Proszę o przyjęcie wydarzenia do przygotowania oraz sprawdzenie dostępności sprzętu i brakujących zasobów." }
            do {
                let data = try await store.rpc("get_event_warehouse_recipients", ["p_event_id": .string(eventID)])
                recipients = (try? JSONDecoder().decode([Recipient].self, from: data)) ?? []
            } catch {
                self.error = "Nie udało się pobrać pracowników magazynu. Zamknij okno i spróbuj ponownie."
            }
            loading = false
        }
    }

    private func send() async {
        let body = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !saving, !recipient.isEmpty, !body.isEmpty else { return }
        saving = true
        error = nil
        defer { saving = false }
        if requestID == nil { requestID = UUID().uuidString.lowercased() }
        do {
            _ = try await workspace.withPending("Wysyłanie…") {
                try await store.rpc("send_event_warehouse_message", [
                    "p_event_id": .string(eventID), "p_recipient": .string(recipient), "p_message": .string(body),
                    "p_request": .bool(request), "p_request_id": .string(requestID ?? ""),
                ])
            }
            workspace.succeed("Wiadomość trafiła do powiadomień wybranego pracownika magazynu")
            dismiss()
        } catch {
            self.error = "Nie udało się wysłać wiadomości. Sprawdź dostęp i spróbuj ponownie."
        }
    }
}
