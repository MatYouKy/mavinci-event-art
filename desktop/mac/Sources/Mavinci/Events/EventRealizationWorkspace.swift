import SwiftUI
import AppKit

// MARK: Przestrzeń realizacji (1:1 z `RealizationWorkspace`): widok ekipy i kierownika realizacji bez danych handlowych —
// Przegląd (kroki, zakres, lokalizacja z danymi technicznymi i salami, kontakt; kierownik realizacji), Timeline, Agenda,
// Sprzęt, Zespół (odpowiedzialności, telefon, SMS, e-mail), Logistyka, Podwykonawcy, Pliki. Dane z `get_realization_workspace`
// (kopia karty na dysku), materiały i pliki podpisywane na żądanie.

@MainActor struct EventRealizationWorkspace: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    @Binding var tab: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var responsibilities: [JSONValue] = []
    @State private var assetURLs: [String: String] = [:]
    @State private var assetsLoading = false
    @State private var fileError: String?
    @State private var preview: NativePreview?

    static let tabs: [(id: String, label: String, symbol: String)] = [
        ("overview", "Przegląd", "doc.text"), ("phases", "Timeline", "clock"), ("agenda", "Agenda", "list.clipboard"),
        ("equipment", "Sprzęt", "shippingbox"), ("team", "Zespół", "person.2"), ("logistics", "Logistyka", "truck.box"),
        ("subcontractors", "Podwykonawcy", "person.crop.circle.badge.checkmark"), ("files", "Pliki", "doc.text"),
    ]

    private var data: [String: JSONValue] { page.realization?.object ?? [:] }
    private var selected: String { Self.tabs.contains { $0.id == tab } ? tab : "overview" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text((data["name"]?.text ?? "Wydarzenie").uppercased()).font(.title2.weight(.light)).textSelection(.enabled)
                Text("\(Self.date(data["event_date"])) – \(Self.date(data["event_end_date"]))").font(.callout).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(Self.tabs, id: \.id) { item in
                        Button { tab = item.id } label: {
                            Label(item.label, systemImage: item.symbol)
                                .padding(.horizontal, 11).padding(.vertical, 7)
                                .foregroundStyle(selected == item.id ? theme.accent : Color.secondary)
                                .background(selected == item.id ? theme.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 7))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 6)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    content
                    if let fileError { Text(fileError).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
                }
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: eventID) {
            await store.loadOverview(eventID)
            await loadResponsibilities()
            await loadAssets()
        }
        .onChange(of: store.card(eventID)?.hash) { Task { await loadAssets() } }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task {
                await store.loadOverview(eventID)
                await loadResponsibilities()
            }
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    @ViewBuilder private var content: some View {
        switch selected {
        case "phases": list(data["phases"], empty: "Brak faz.") { phase in
            card(phase["name"]?.text ?? "") {
                Text("\(Self.date(phase["start"])) – \(Self.date(phase["end"]))")
                optionalText(phase["description"])
            }
        }
        case "equipment": list(data["equipment"], empty: "Brak przypisanego sprzętu.") { item in
            card(item["name"]?.text ?? "Sprzęt") {
                Text("Ilość: \(Self.number(item["quantity"]))")
                Text(item["loaded"]?.flag == true ? "Załadowane" : "Do załadunku")
                optionalText(item["notes"])
            }
        }
        case "agenda": agenda
        case "team": team
        case "logistics": list(data["vehicles"], empty: "Brak pojazdów.") { vehicle in
            card(vehicle["name"]?.text.nonEmpty ?? "Pojazd") {
                Text("Kierowca: \(vehicle["driver"]?.text.nonEmpty ?? "Nieprzypisany")")
                Text("Wyjazd: \(Self.date(vehicle["departure"]))")
                Text("Przyjazd: \(Self.date(vehicle["arrival"]))")
                Text("Powrót: \(Self.date(vehicle["return"]))")
                optionalText(vehicle["origin"])
                optionalText(vehicle["notes"])
            }
        }
        case "subcontractors": list(data["subcontractors"], empty: "Brak podwykonawców.") { item in
            card(item["name"]?.text ?? "") {
                Text([item["contact_name"]?.text ?? "", item["phone"]?.text ?? "", item["email"]?.text ?? ""].joined(separator: " · ")).textSelection(.enabled)
                optionalText(item["scope"])
                optionalText(item["deliverables"])
                optionalText(item["guidelines"])
                optionalText(item["notes"])
                Text("\(Self.date(item["start"])) – \(Self.date(item["end"]))")
            }
        }
        case "files": files
        default: overview
        }
    }

    // MARK: Przegląd
    private var overview: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 18) {
                overviewMain.frame(minWidth: 520, maxWidth: .infinity, alignment: .topLeading)
                RealizationPanelView(store: store, eventID: eventID).frame(width: 340, alignment: .topLeading)
            }
            VStack(alignment: .leading, spacing: 14) {
                overviewMain
                RealizationPanelView(store: store, eventID: eventID)
            }
        }
    }
    private var overviewMain: some View {
        let location = data["location"]?.object ?? [:]
        let contact = data["contact"]?.object ?? [:]
        let selectedRooms = (location["selected_rooms"]?.array ?? []).map(\.text)
        let rooms = (location["rooms"]?.array ?? []).map(\.object).filter { selectedRooms.contains($0["id"]?.text ?? "") }
        return VStack(alignment: .leading, spacing: 14) {
            if let steps = store.overview(eventID)?.steps {
                EventStepsPanelView(store: store, eventID: eventID, state: steps, onNavigate: { tab = $0 },
                                    canOpenTab: { id in Self.tabs.contains { $0.id == id } })
            }
            card("Zakres realizacji") {
                Text("\(Self.date(data["event_date"])) – \(Self.date(data["event_end_date"]))")
                Text(data["description"]?.text.nonEmpty.map(EventCardRichText.plain) ?? "Brak opisu realizacji").textSelection(.enabled)
            }
            card(location["name"]?.text.nonEmpty ?? "Lokalizacja") {
                let address = [location["address"]?.text ?? "", location["city"]?.text ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
                if !address.isEmpty { Text(address).textSelection(.enabled) }
                optionalText(location["notes"])
                LocationTechnicalView(value: location["technical_details"]?.object ?? [:], urls: assetURLs, loading: assetsLoading)
                let contactLine = [location["contact_name"]?.text ?? "", location["phone"]?.text ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
                if !contactLine.isEmpty { Text(contactLine).textSelection(.enabled) }
                ForEach(Array(rooms.enumerated()), id: \.offset) { _, room in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(Self.roomTitle(room, stage: location["stage_room_id"]?.text ?? ""))
                            .font(.callout.weight(.medium))
                        LocationTechnicalView(value: room["technical"]?.object ?? [:], urls: assetURLs, loading: assetsLoading)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            card("Kontakt na wydarzeniu") {
                optionalText(contact["name"])
                if let phone = contact["phone"]?.text.nonEmpty {
                    if let url = EventStepRules.telURL(phone) { Button(phone, systemImage: "phone") { NSWorkspace.shared.open(url) }.buttonStyle(.link) }
                    else { Text(phone) }
                }
                if let email = contact["email"]?.text.nonEmpty {
                    Button(email, systemImage: "envelope") { if let url = URL(string: "mailto:\(email)") { NSWorkspace.shared.open(url) } }.buttonStyle(.link)
                }
            }
        }
    }

    // MARK: Agenda
    private var agenda: some View {
        VStack(alignment: .leading, spacing: 14) {
            let items = (data["agenda"]?.array ?? []).map(\.object)
            if items.isEmpty { Text("Brak pozycji agendy.").foregroundStyle(.secondary) }
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                card("\(item["time"]?.text ?? "") \(item["title"]?.text ?? "")") { optionalText(item["description"]) }
            }
            ForEach(Array((data["agenda_notes"]?.array ?? []).map(\.object).enumerated()), id: \.offset) { _, note in
                card("Notatka do agendy") { optionalText(note["content"]) }
            }
        }
    }

    // MARK: Zespół (z rolami odpowiedzialności `get_event_responsibility_team`)
    private var members: [[String: JSONValue]] {
        var team = (data["team"]?.array ?? []).map(\.object)
        let extra = responsibilities.map(\.object)
        for index in team.indices {
            let match = extra.first { $0["employee_id"]?.text == team[index]["employee_id"]?.text }
            team[index]["responsibility_roles"] = match?["responsibility_roles"] ?? .array([])
        }
        for member in extra where !team.contains(where: { $0["employee_id"]?.text == member["employee_id"]?.text }) {
            let employee = member["employee"]?.object ?? [:]
            var row = member
            row["name"] = .string("\(employee["name"]?.text ?? "") \(employee["surname"]?.text ?? "")".trimmingCharacters(in: .whitespaces))
            row["phone"] = employee["phone_number"] ?? .null
            row["email"] = employee["email"] ?? .null
            team.append(row)
        }
        return team
    }
    private var team: some View {
        let list = members
        return VStack(alignment: .leading, spacing: 10) {
            Text("ZESPÓŁ WYDARZENIA").font(.title3.weight(.light))
            if list.isEmpty { Text("Brak osób przypisanych do wydarzenia.").font(.callout).foregroundStyle(.secondary) }
            ForEach(Array(list.enumerated()), id: \.offset) { _, member in memberRow(member) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }
    private func memberRow(_ member: [String: JSONValue]) -> some View {
        let phone = (member["phone"]?.text ?? "").filter { $0 == "+" || $0.isNumber }
        let email = member["email"]?.text.nonEmpty
        let roles = (member["responsibility_roles"]?.array ?? []).map(\.text).filter { !$0.isEmpty }
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(member["name"]?.text ?? "").font(.callout.weight(.medium))
                Text(roles.isEmpty ? EventRoleLabels.label(member["role"]?.text) : roles.joined(separator: " · ")).font(.callout).foregroundStyle(theme.accent)
                Text(member["status"]?.text == "accepted" ? "Udział potwierdzony" : "Oczekuje na potwierdzenie").font(.caption).foregroundStyle(.secondary)
                optionalText(member["responsibilities"])
                if let text = member["phone"]?.text.nonEmpty { Text(text).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                if phone.isEmpty && email == nil { Text("Brak danych kontaktowych.").font(.callout).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if !phone.isEmpty {
                    contactButton("Zadzwoń", "phone", "tel:\(phone)")
                    contactButton("SMS", "message", "sms:\(phone)")
                }
                if let email { contactButton("E-mail", "envelope", "mailto:\(email.addingPercentEncoding(withAllowedCharacters: .urlUserAllowed) ?? email)") }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 9))
    }
    private func contactButton(_ title: String, _ symbol: String, _ link: String) -> some View {
        Button { if let url = URL(string: link) { NSWorkspace.shared.open(url) } } label: {
            Label(title, systemImage: symbol).font(.callout).padding(.horizontal, 10).padding(.vertical, 6)
                .foregroundStyle(theme.accent).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Pliki
    private var files: some View {
        let items = (data["files"]?.array ?? []).map(\.object)
        return VStack(alignment: .leading, spacing: 8) {
            if items.isEmpty { Text("Brak plików operacyjnych.").foregroundStyle(.secondary) }
            ForEach(Array(items.enumerated()), id: \.offset) { _, file in
                Button { Task { await openFile(file) } } label: {
                    Label(file["name"]?.text.nonEmpty ?? "Plik", systemImage: "doc").foregroundStyle(theme.accent)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
    private func openFile(_ file: [String: JSONValue]) async {
        fileError = nil
        guard let fileID = file["id"]?.text.nonEmpty else { fileError = "Brak adresu pliku."; return }
        await state.withPending("Otwieranie pliku…") {
            do {
                let target = try await store.realizationFile(eventID, fileID: fileID)
                let (data, response) = try await URLSession.shared.data(from: target.url)
                let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
                if type.contains("pdf") || type.hasPrefix("image/") || target.name.lowercased().hasSuffix(".pdf") {
                    preview = NativePreview(name: target.name, data: data)
                } else {
                    NSWorkspace.shared.open(target.url)
                }
            } catch {
                fileError = (error as? NativeFailure)?.message ?? "Nie udało się otworzyć pliku."
            }
        }
    }

    // MARK: Pomocnicze
    private func list<Row: View>(_ value: JSONValue?, empty: String, @ViewBuilder row: @escaping ([String: JSONValue]) -> Row) -> some View {
        let items = (value?.array ?? []).map(\.object)
        return VStack(alignment: .leading, spacing: 14) {
            if items.isEmpty { Text(empty).foregroundStyle(.secondary) }
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
        }
    }
    private func card<Content: View>(_ title: String, @ViewBuilder _ body: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.title3.weight(.light))
            VStack(alignment: .leading, spacing: 4) { body() }.font(.callout).opacity(0.9)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }
    @ViewBuilder private func optionalText(_ value: JSONValue?) -> some View {
        if let text = value?.text.nonEmpty { Text(text).textSelection(.enabled) }
    }
    private func loadResponsibilities() async {
        guard let data = try? await store.rpc("get_event_responsibility_team", ["p_event_id": .string(eventID)]),
              let rows = try? JSONDecoder().decode([JSONValue].self, from: data) else { return }
        responsibilities = rows
    }
    private func loadAssets() async {
        assetsLoading = true
        assetURLs = await store.realizationAssetURLs(eventID)
        assetsLoading = false
    }

    /// „Sala A · Scena / DJ uwagi” jak lista sal w CRM.
    static func roomTitle(_ room: [String: JSONValue], stage: String) -> String {
        var title = room["name"]?.text ?? ""
        if let id = room["id"]?.text, !id.isEmpty, id == stage { title += " · Scena / DJ" }
        if let notes = room["notes"]?.text, !notes.isEmpty { title += " " + notes }
        return title
    }

    /// `new Date(v).toLocaleString('pl-PL')` albo „Termin nieustalony”.
    static func date(_ value: JSONValue?) -> String {
        guard let date = value?.text.nonEmpty.flatMap(MeetingDates.parse) else { return "Termin nieustalony" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm:ss")
    }
    static func number(_ value: JSONValue?) -> String {
        switch value {
        case .number(let number): return number.rounded() == number ? String(Int(number)) : number.formatted(.number.locale(Locale(identifier: "pl_PL")))
        case .string(let text): return text
        default: return ""
        }
    }
}

/// Role w zespole (`systemLabel(role, 'role', { preserveCustom: true })`).
enum EventRoleLabels {
    static let roles: [String: String] = [
        "admin": "Administrator", "administrator": "Administrator", "manager": "Menedżer", "event_manager": "Kierownik wydarzenia",
        "sales": "Sprzedaż", "salesperson": "Sprzedawca", "seller": "Sprzedawca", "sales_manager": "Kierownik sprzedaży",
        "logistics": "Logistyka", "technician": "Technik", "support": "Wsparcie", "freelancer": "Współpracownik",
        "dj": "DJ", "mc": "Konferansjer", "host": "Prowadzący", "assistant": "Asystent", "unassigned": "Nieprzypisany",
        "driver": "Kierowca", "coordinator": "Koordynator", "organizer": "Organizator", "owner": "Opiekun",
        "employee": "Pracownik", "staff": "Obsługa", "subcontractor": "Podwykonawca", "operator": "Operator",
        "sound_engineer": "Realizator dźwięku", "lighting_technician": "Technik oświetlenia",
        "sound_technician": "Technik dźwięku", "photographer": "Fotograf", "videographer": "Operator kamery",
        "instructor": "Instruktor", "animator": "Animator", "security": "Ochrona", "other": "Inna rola",
    ]
    static func label(_ value: String?) -> String {
        guard let text = value?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return "Nie określono" }
        return roles[text.lowercased()] ?? text
    }
}

// MARK: Kierownik realizacji (`RealizationPanel`): przejęcie i zakończenie realizacji z notatką (`advance_realization`).

@MainActor struct RealizationPanelView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: [String: JSONValue]?
    @State private var error: String?
    @State private var busy = false
    @State private var confirm = false
    @State private var notes = ""

    var body: some View {
        Group {
            if data != nil || error != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Kierownik realizacji").font(.headline)
                    let realization = data?["realization"]?.object ?? [:]
                    let status = data?["status"]?.text.nonEmpty
                    Text((realization["manager_name"]?.text.nonEmpty ?? "Nie wyznaczono kierownika")
                         + (status.map { " · \(EventKeyFactsView.operationalLabels[$0] ?? "Nowe wydarzenie")" } ?? "")).font(.callout)
                    let isManager = data?["is_manager"]?.flag == true
                    let started = realization["started_at"]?.text.nonEmpty
                    let completed = realization["completed_at"]?.text.nonEmpty
                    if isManager && started == nil && status == "ready_for_live" {
                        Button(busy ? "Zapisywanie…" : "Przejmij realizację") { Task { await run("start") } }
                            .buttonStyle(.borderedProminent).disabled(busy)
                    }
                    if let started { Text("Przejęto: \(EventRealizationWorkspace.date(.string(started)))").font(.callout) }
                    if isManager && started != nil && completed == nil && status != "cancelled" {
                        Button("Zrealizowane") { notes = "Wszystko OK."; error = nil; confirm = true }
                            .buttonStyle(.borderedProminent).disabled(busy)
                    }
                    if let completed {
                        Text("Zrealizowano: \(EventRealizationWorkspace.date(.string(completed)))"
                             + (realization["completion_notes"]?.text.nonEmpty.map { "\nUwagi: \($0)" } ?? "")).font(.callout).textSelection(.enabled)
                    }
                    if let error, !confirm { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .task(id: eventID) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .sheet(isPresented: $confirm) { summarySheet.warehouseSheetStyle(state) }
    }

    private var summarySheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Podsumowanie realizacji").font(.title3.weight(.light))
            Text("Jeśli realizacja przebiegła bez zastrzeżeń, zostaw „Wszystko OK.”. W przeciwnym razie opisz uwagi.").font(.callout).foregroundStyle(.secondary)
            Text("Notatka z realizacji").font(.callout)
            TextEditor(text: $notes).frame(minHeight: 110).scrollContentBackground(.hidden).padding(6)
                .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8)).disabled(busy)
                .onChange(of: notes) { if notes.count > 5000 { notes = String(notes.prefix(5000)) } }
            Text("\(notes.count)/5000").font(.caption).foregroundStyle(.tertiary).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Spacer()
                Button("Anuluj") { confirm = false }.keyboardShortcut(.cancelAction).disabled(busy)
                Button(busy ? "Zapisywanie…" : "Zapisz i oznacz jako zrealizowane") { Task { await run("complete") } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(busy || notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 480)
    }

    private func load() async {
        do {
            let reply = try await store.rpc("get_event_realization_assignment", ["p_event_id": .string(eventID)])
            // Brak przypisania (null) — panel się nie pokazuje, jak w CRM.
            if let value = try? JSONDecoder().decode(JSONValue.self, from: reply), case .object(let object) = value { data = object } else { data = nil }
            error = nil
        } catch {
            if !(error is URLError) { self.error = "Nie udało się odczytać kierownika realizacji." }
        }
    }

    private func run(_ action: String) async {
        let text = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, action != "complete" || !text.isEmpty else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await state.withPending("Zapisywanie…") {
                try await store.rpc("advance_realization", [
                    "p_event_id": .string(eventID), "p_action": .string(action), "p_notes": action == "complete" ? .string(text) : .null,
                ])
            }
            confirm = false
            await load()
            await store.loadOverview(eventID)
        } catch {
            self.error = (error as? NativeFailure)?.message ?? "Nie udało się zapisać."
        }
    }
}

// MARK: Dane techniczne lokalizacji i sal (`TechnicalDetailsView`, `LocationPowerDetailsView`) — tylko podgląd.

@MainActor struct LocationTechnicalView: View {
    let value: [String: JSONValue]
    let urls: [String: String]
    var loading = false
    @Environment(\.crmTheme) private var theme

    private static let dimensions: [(String, String, String)] = [
        ("length_m", "Długość", "m"), ("width_m", "Szerokość", "m"), ("height_m", "Wysokość użytkowa", "m"),
        ("area_m2", "Powierzchnia", "m²"), ("capacity", "Maksymalna liczba osób", "os."),
    ]
    private static let labels: [(String, String)] = [
        ("description", "Dodatkowe informacje"), ("restrictions", "Ograniczenia"), ("difficulties", "Utrudnienia logistyczne"),
    ]

    private func number(_ key: String) -> Double? { if case .number(let v) = value[key] ?? .null { return v }; return nil }
    private func flag(_ key: String) -> Bool? { if case .bool(let v) = value[key] ?? .null { return v }; return nil }
    private static func pl(_ value: Double) -> String { value.formatted(.number.locale(Locale(identifier: "pl_PL")).precision(.fractionLength(0...3))) }
    private var hasDimensions: Bool { Self.dimensions.contains { number($0.0) != nil } }
    private var hasPower: Bool {
        value["power_supply"]?.text.nonEmpty != nil || value["power_notes"]?.text.nonEmpty != nil || value["power_230v_notes"]?.text.nonEmpty != nil
            || !(value["power_400v_points"]?.array ?? []).isEmpty || number("power_kw") != nil || flag("power_230v") != nil || flag("power_400v") != nil
    }
    private var assets: [[String: JSONValue]] { (value["assets"]?.array ?? []).map(\.object) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if hasDimensions {
                heading("Wymiary i pojemność")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(Self.dimensions, id: \.0) { item in
                        if let v = number(item.0) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.1).font(.caption).foregroundStyle(.secondary)
                                Text("\(Self.pl(v)) \(item.2)")
                            }
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
            if hasPower { power }
            ForEach(Self.labels, id: \.0) { item in
                if let text = value[item.0]?.text.nonEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        heading(item.1)
                        Text(text).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
            }
            if !Self.labels.contains(where: { value[$0.0]?.text.nonEmpty != nil }) && !hasDimensions && !hasPower && assets.isEmpty {
                Text("Brak dodatkowych informacji i materiałów.").foregroundStyle(.tertiary)
            }
            ForEach(["plan", "photo"], id: \.self) { kind in
                let items = assets.filter { $0["kind"]?.text == kind }
                if !items.isEmpty {
                    heading(kind == "plan" ? "Rzuty i plany" : "Galeria")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 8) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, asset in assetTile(asset) }
                    }
                    if kind == "plan" && items.contains(where: { Self.isCad($0["path"]?.text ?? "") }) {
                        Text("Pliki CAD otworzysz w odpowiednim programie. Do szybkiego podglądu poproś również o wersję PDF lub zdjęcie rzutu.")
                            .font(.caption).foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .font(.callout)
    }

    private func heading(_ text: String) -> some View {
        Text(text.uppercased()).font(.callout.weight(.medium)).foregroundStyle(theme.accent)
    }
    static func isCad(_ path: String) -> Bool { path.range(of: #"\.(dxf|dwg)$"#, options: [.regularExpression, .caseInsensitive]) != nil }
    static func isImage(_ path: String) -> Bool { path.range(of: #"\.(jpg|png|webp)$"#, options: [.regularExpression, .caseInsensitive]) != nil }

    @ViewBuilder private func assetTile(_ asset: [String: JSONValue]) -> some View {
        let path = asset["path"]?.text ?? ""
        let name = asset["name"]?.text ?? "Plik"
        if let link = urls[path], let url = URL(string: link) {
            Button { NSWorkspace.shared.open(url) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    if Self.isImage(path) {
                        AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.05) }
                            .frame(height: 100).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    Text(name).foregroundStyle(theme.accent).lineLimit(2)
                    Text(Self.isCad(path) ? "Pobierz plik CAD · DXF/DWG" : Self.isImage(path) ? "Powiększ zdjęcie" : "Otwórz PDF")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            Text("\(name) — \(loading ? "wczytywanie…" : "plik niedostępny")").foregroundStyle(.secondary)
        }
    }

    // MARK: Prąd i przyłącza
    private var power: some View {
        let supply = value["power_supply"]?.text
        let points = (value["power_400v_points"]?.array ?? []).map(\.object)
        return VStack(alignment: .leading, spacing: 10) {
            heading("Prąd i przyłącza")
            Text(supply == "available" ? "Zasilanie dostępne" : supply == "unavailable" ? "Brak zasilania" : "Dostęp do zasilania niepotwierdzony")
            if supply != "unavailable" {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow {
                        labeled("Gniazda 230 V", flag("power_230v").map { $0 ? "Dostępne" : "Brak" } ?? "Do potwierdzenia")
                        labeled("Przyłącza 400 V (siła)", flag("power_400v").map { $0 ? "Dostępne" : "Brak" } ?? "Do potwierdzenia")
                    }
                    if let kw = number("power_kw") { GridRow { labeled("Dostępna moc łącznie", "\(Self.pl(kw)) kW") } }
                }
                if flag("power_230v") == true || value["power_230v_notes"]?.text.nonEmpty != nil {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("230 V — ROZMIESZCZENIE, FAZY I OBWODY").font(.caption).foregroundStyle(theme.accent)
                        Text(value["power_230v_notes"]?.text.nonEmpty ?? "Nie uzupełniono jeszcze opisu rozmieszczenia gniazd, faz i obwodów.")
                            .foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                if flag("power_400v") == true || !points.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("400 V — KONKRETNE PRZYŁĄCZA").font(.caption).foregroundStyle(theme.accent)
                        if points.isEmpty {
                            Text("Nie opisano jeszcze liczby, rodzaju i położenia przyłączy. Sama dostępność 400 V nie potwierdza możliwości wykorzystania przy scenie.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(Array(points.enumerated()), id: \.offset) { index, point in powerPoint(index, point) }
                    }
                }
            }
            if let notes = value["power_notes"]?.text.nonEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("POZOSTAŁE SZCZEGÓŁY ZASILANIA").font(.caption).foregroundStyle(theme.accent)
                    Text(notes).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    }
    private func labeled(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value)
        }
    }
    private func powerPoint(_ index: Int, _ point: [String: JSONValue]) -> some View {
        let quantity: String = { if case .number(let q) = point["quantity"] ?? .null { return "\(Self.pl(q)) szt." }; return "Do potwierdzenia" }()
        let rating: String = {
            switch point["rating_a"] ?? .null {
            case .string("other"): return "Inny — patrz opis złącza"
            case .number(let a): return "\(Int(a)) A"
            default: return "Do potwierdzenia"
            }
        }()
        let distance: String = { if case .number(let d) = point["distance_to_stage_m"] ?? .null { return "\(Self.pl(d)) m" }; return "Do potwierdzenia" }()
        return VStack(alignment: .leading, spacing: 6) {
            Text("Punkt / grupa przyłączy \(index + 1)").fontWeight(.medium)
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                GridRow {
                    labeled("Liczba gniazd", quantity)
                    labeled("Prąd znamionowy złącza", rating)
                }
                GridRow {
                    labeled("Rodzaj złącza / liczba pinów", point["connector"]?.text.nonEmpty ?? "Do potwierdzenia")
                    labeled("Odległość od typowego ustawienia sceny", distance)
                }
            }
            labeled("Miejsce", point["position"]?.text ?? "")
            if let notes = point["notes"]?.text.nonEmpty { labeled("Przydatność przy scenie i ograniczenia", notes) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
    }
}
