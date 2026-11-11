import SwiftUI
import AppKit

// MARK: Szczegóły (`EventsDetailsTab` + kolumna `EventDetailsAction` i „Budżet” z `EventDetailPageClient`): firma realizująca,
// termin, lokalizacja z salami, klient albo kontakt na miejscu, opis, notatki; akcje (kategoria, oferty, status, potwierdzenie
// e-mail, checklista sprzętu) i budżet. Dane z kopii karty na dysku, zapisy tokenem pracownika (RLS jak w CRM).

@MainActor struct EventDetailsTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editingDates = false
    @State private var start = Date()
    @State private var end = Date()
    @State private var hasEnd = true
    @State private var dateError: String?
    @State private var editingDescription = false
    @State private var description = ""
    @State private var editingNotes = false
    @State private var notes = ""
    @State private var companyOpen = false
    @State private var locationOpen = false
    @State private var clientOpen = false
    @State private var editingRooms = false

    private var event: EventFields { EventFields(raw: page.event ?? [:]) }
    private var flags: EventCardFlags? { page.flags }
    private var canEdit: Bool { flags?.canEditDetails == true }
    private var details: EventCardDetails? { store.details(eventID) }
    private var canSeeFullDetails: Bool { flags?.isAdmin == true || flags?.isCreator == true || flags?.hasLimitedAccess != true }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) {
                        left.frame(minWidth: 520, maxWidth: .infinity, alignment: .topLeading)
                        if hasRight { right.frame(width: 360, alignment: .topLeading) }
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        left
                        if hasRight { right }
                    }
                }
                if let summary = flags?.accessSummary?.nonEmpty { Text(summary).font(.caption).foregroundStyle(.tertiary) }
            }
            .padding(18).frame(maxWidth: 1240, alignment: .leading)
        }
        .task(id: eventID) { await store.loadDetails(eventID) }
        .onChange(of: store.card(eventID)?.hash) { Task { await store.loadDetails(eventID) } }
        .sheet(isPresented: $companyOpen) {
            EventCompanySheet(store: store, eventID: eventID, current: event["my_company_id"]).warehouseSheetStyle(state)
        }
        .sheet(isPresented: $clientOpen) {
            EventClientSheet(store: store, eventID: eventID).warehouseSheetStyle(state)
        }
        .sheet(isPresented: $locationOpen) {
            EventLocationSheet(store: store, eventID: eventID, currentID: event["location_id"], currentLabel: page.location?["name"]?.text ?? "")
                .warehouseSheetStyle(state)
        }
    }

    private var hasRight: Bool { flags?.showDetailsAction == true || flags?.canViewValues == true }

    private var left: some View {
        VStack(alignment: .leading, spacing: 16) {
            basics
            if (flags?.canViewBilling == true || flags?.canViewFinanceValues == true) && event.raw.keys.contains("billing_arrangement") {
                TeamCard(title: "Rozliczenie i prowizje") {
                    Text("Sposób rozliczenia (płatnik, numer zamówienia), plan płatności i prowizje są jeszcze obsługiwane w CRM.")
                        .font(.callout).foregroundStyle(.secondary)
                    Button("Otwórz Szczegóły w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(eventID)?tab=details") }
                }
            }
            textCard("Opis wydarzenia", text: event["description"], editing: $editingDescription, draft: $description, field: "description")
            textCard("Notatki", text: event["notes"], editing: $editingNotes, draft: $notes, field: "notes")
        }
    }

    @ViewBuilder private var right: some View {
        VStack(alignment: .leading, spacing: 16) {
            if flags?.showDetailsAction == true { EventDetailsActionCard(store: store, eventID: eventID, page: page) }
            if flags?.canViewValues == true { budget }
        }
    }

    // MARK: Informacje podstawowe
    private var basics: some View {
        TeamCard(title: "Informacje podstawowe") {
            company
            dates
            location
            clientSection
        }
    }

    /// Termin: podgląd albo edycja (jak `saveDates` w CRM).
    @ViewBuilder private var dates: some View {
        if editingDates && canEdit {
            dateEditor
        } else {
            labeled("Data rozpoczęcia", "calendar", startText, edit: dateEditAction)
            if let end = event.end {
                labeled("Data zakończenia", "clock", MeetingDates.format(end, "EEEE, d MMMM yyyy HH:mm"))
            }
        }
    }
    private var startText: String {
        guard let start = event.start else { return "—" }
        return MeetingDates.format(start, "EEEE, d MMMM yyyy HH:mm")
    }
    private var dateEditAction: (() -> Void)? {
        guard canEdit else { return nil }
        return { beginDates() }
    }

    /// Klient (obszar „klient”) albo sam kontakt na miejscu (obszar „kontakt na miejscu”).
    @ViewBuilder private var clientSection: some View {
        if canSeeFullDetails && flags?.canViewClient != true && flags?.canViewOnsiteContact == true {
            EventOnsiteContactsSection(store: store, eventID: eventID)
        }
        if canSeeFullDetails && flags?.canViewClient == true {
            client
        }
    }

    private var company: some View {
        let info = details?.company
        let name = info?.legal_name?.nonEmpty ?? info?.name?.nonEmpty ?? event.company["legal_name"]?.text.nonEmpty ?? event.company["name"]?.text.nonEmpty
        let logo = info?.logo_url?.nonEmpty ?? event.company["logo_url"]?.text.nonEmpty
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "building.2").foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("Firma realizująca").font(.caption).foregroundStyle(.secondary)
                    if canEdit { editButton { companyOpen = true } }
                }
                HStack(spacing: 10) {
                    if let logo { WarehouseThumb(url: logo, size: 32, symbol: "building") }
                    Text(name ?? "Brak przypisanej firmy")
                }
            }
        }
    }

    private func editButton(_ title: String = "Edytuj", _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: "pencil").font(.caption) }.buttonStyle(.borderless).foregroundStyle(theme.accent)
    }

    private func labeled(_ label: String, _ symbol: String, _ value: String, edit: (() -> Void)? = nil) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(label).font(.caption).foregroundStyle(.secondary)
                    if let edit { editButton("Edytuj", edit) }
                }
                Text(value).textSelection(.enabled)
            }
        }
    }

    // MARK: Termin
    private var dateEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            DatePicker("Data rozpoczęcia", selection: $start)
            Toggle("Data zakończenia (opcjonalnie)", isOn: $hasEnd)
            if hasEnd { DatePicker("Data zakończenia", selection: $end) }
            if let dateError { Text(dateError).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Button("Zapisz termin") { Task { await saveDates() } }.buttonStyle(.borderedProminent)
                Button("Anuluj") { editingDates = false; dateError = nil }
            }
        }
        .environment(\.timeZone, MeetingDates.zone)
        .environment(\.locale, Locale(identifier: "pl_PL"))
        .padding(12).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 9))
    }
    private func beginDates() {
        start = event.start ?? Date()
        end = event.end ?? start.addingTimeInterval(3600 * 4)
        hasEnd = event.end != nil
        dateError = nil
        editingDates = true
    }
    private func saveDates() async {
        if hasEnd && end <= start { dateError = "Zakończenie musi być późniejsze niż rozpoczęcie wydarzenia."; return }
        let changes: [String: JSONValue] = [
            "event_date": .string(MeetingDates.iso(start)),
            "event_end_date": hasEnd ? .string(MeetingDates.iso(end)) : .null,
        ]
        if await store.update(eventID, changes) { editingDates = false } else { dateError = "Nie udało się zapisać terminu. Spróbuj ponownie." }
    }

    // MARK: Lokalizacja i sale
    private var location: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin").foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("Lokalizacja").font(.caption).foregroundStyle(.secondary)
                    if canEdit { editButton { locationOpen = true } }
                }
                if let location = page.location, let name = location["name"]?.text.nonEmpty {
                    HStack(spacing: 8) {
                        Button(name) {
                            if let id = location["id"]?.text.nonEmpty { state.openCRM("/crm/locations/\(id)") }
                        }
                        .buttonStyle(.link).help("Otwórz lokalizację w CRM")
                        if canEdit && !event["location_id"].isEmpty && !editingRooms { editButton("Edytuj sale") { editingRooms = true } }
                    }
                    if let address = location["formatted_address"]?.text.nonEmpty { Text(address).font(.caption).foregroundStyle(.secondary) }
                    if let maps = location["google_maps_url"]?.text.nonEmpty.flatMap({ URL(string: $0) }) {
                        Button("Zobacz na mapie", systemImage: "arrow.up.right.square") { NSWorkspace.shared.open(maps) }.buttonStyle(.link).font(.caption)
                    }
                } else {
                    Text("Brak lokalizacji")
                }
                if !event["location_id"].isEmpty {
                    EventRoomsView(store: store, eventID: eventID, rooms: details?.rooms, canEdit: canEdit, editing: $editingRooms)
                }
            }
        }
    }

    // MARK: Klient
    private var client: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Informacje o kliencie").font(.callout.weight(.medium))
                if flags?.canEventManage == true {
                    editButton("Edytuj") { clientOpen = true }.help("Zmiana klienta i osób kontaktowych")
                }
            }
            let org = event.organization
            let contact = page.contact
            if event["client_type"] == "business" {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "building.2").foregroundStyle(theme.accent).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        if let id = org["id"]?.text.nonEmpty {
                            Button(org["alias"]?.text.nonEmpty ?? org["name"]?.text ?? "Klient") { state.open(.contacts, id: id) }.buttonStyle(.link)
                        } else {
                            Text("Brak klienta")
                        }
                        if let email = org["email"]?.text.nonEmpty { mailLink(email) }
                    }
                }
                if let contact { contactBlock(contact, label: "Osoba kontaktowa") }
            } else {
                if let contact { contactBlock(contact, label: "Klient") } else {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "person").foregroundStyle(theme.accent).frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Klient").font(.caption).foregroundStyle(.secondary)
                            Text("Brak klienta")
                        }
                    }
                }
            }
        }
    }
    private func contactBlock(_ contact: [String: JSONValue], label: String) -> some View {
        let name = contact["full_name"]?.text.nonEmpty ?? [contact["first_name"]?.text ?? "", contact["last_name"]?.text ?? ""].joined(separator: " ")
        let phone = contact["business_phone"]?.text.nonEmpty ?? contact["phone"]?.text.nonEmpty
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person").foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                if let id = contact["id"]?.text.nonEmpty {
                    Button(name) { state.open(.contacts, id: id) }.buttonStyle(.link)
                } else {
                    Text(name)
                }
                if let email = contact["email"]?.text.nonEmpty { mailLink(email) }
                if let phone, let url = URL(string: "tel:\(phone.replacingOccurrences(of: " ", with: ""))") {
                    Button(phone, systemImage: "phone") { NSWorkspace.shared.open(url) }.buttonStyle(.link).font(.callout)
                }
            }
        }
    }
    private func mailLink(_ email: String) -> some View {
        Button(email, systemImage: "envelope") { if let url = URL(string: "mailto:\(email)") { NSWorkspace.shared.open(url) } }
            .buttonStyle(.link).font(.callout)
    }

    // MARK: Budżet
    private var budget: some View {
        let data = page.budget
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Budżet").font(.title3.weight(.light))
                Spacer()
                Text(data?.source ?? "Źródło: wydarzenie").font(.caption).foregroundStyle(.tertiary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Przychód planowany").font(.caption).foregroundStyle(.secondary)
                Text(Self.whole(data?.planned ?? 0)).font(.title2.weight(.light)).foregroundStyle(theme.accent)
                if let offer = data?.offer { offerBreakdown(offer) }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Przychód faktyczny").font(.caption).foregroundStyle(.secondary)
                Text(Self.whole(data?.actual ?? 0)).font(.title2.weight(.light))
            }
            if let data, data.planned > 0, data.actual > 0 {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Realizacja").font(.caption).foregroundStyle(.secondary)
                    Text(String(format: "%.1f%%", data.actual / data.planned * 100)).font(.title3.weight(.light))
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }
    private func offerBreakdown(_ offer: EventBudget.Offer) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Button((offer.accepted ? "Zaakceptowana oferta " : "Wstępny plan z oferty ") + offer.number) { state.openCRM("/crm/offers/\(offer.id)") }
                .buttonStyle(.link)
            if offer.discountAmount > 0 {
                Text("Przed rabatem netto: \(Self.money(offer.listNet))")
                Text("Rabat: −\(Self.money(offer.discountAmount))").foregroundStyle(theme.accent)
            }
            Text("Netto\(offer.discountAmount > 0 ? " po rabacie" : ""): \(Self.money(offer.net))")
            Text("VAT (\(Self.vatLabel(offer))): \(Self.money(offer.taxAmount))")
            Text("Brutto: \(Self.money(offer.gross))")
            if let logistics = offer.logisticsPriceNet { Text("W cenie przed rabatem: logistyka \(Self.money(logistics)) netto.") }
            Text("Koszty zapisane w ofercie: \(Self.costText(offer.costNet))").padding(.top, 8)
            if let profit = offer.profitNet {
                (Text("Wynik po zapisanych kosztach: ") + Text("\(Self.money(profit)) netto").foregroundColor(profit < 0 ? CrmTheme.rgb(0xfca5a5) : theme.accent))
            }
            if offer.logisticsCostMissing {
                Text("Koszt logistyki nie został jeszcze określony — koszty mogą być niepełne.").foregroundStyle(CrmTheme.rgb(0xfde68a))
            }
        }
        .font(.caption).foregroundStyle(.secondary).padding(.top, 6)
    }
    /// „12 300 zł” (`toLocaleString('pl-PL')` + „ zł”).
    static func whole(_ value: Double) -> String {
        "\(value.formatted(.number.locale(Locale(identifier: "pl_PL")).precision(.fractionLength(0...3)))) zł"
    }
    /// „12 300,00 zł” (dwa miejsca po przecinku).
    static func money(_ value: Double) -> String {
        "\(value.formatted(.number.locale(Locale(identifier: "pl_PL")).precision(.fractionLength(2...3)))) zł"
    }
    static func vatLabel(_ offer: EventBudget.Offer) -> String {
        offer.hasMixedVatRates ? "wg stawek pozycji" : "\(percent(offer.taxPercent ?? 0))%"
    }
    static func costText(_ cost: Double?) -> String {
        guard let cost else { return "Nie określono" }
        return "\(money(cost)) netto"
    }
    static func percent(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : value.formatted(.number.locale(Locale(identifier: "pl_PL")))
    }

    // MARK: Opis i notatki
    private func editAction(text: String, editing: Binding<Bool>, draft: Binding<String>) -> (String, () -> Void)? {
        guard canEdit && !editing.wrappedValue else { return nil }
        return ("Edytuj", {
            draft.wrappedValue = text
            editing.wrappedValue = true
        })
    }
    private func textCard(_ title: String, text: String, editing: Binding<Bool>, draft: Binding<String>, field: String) -> some View {
        TeamCard(title: title, action: editAction(text: text, editing: editing, draft: draft)) {
            if editing.wrappedValue {
                TextEditor(text: draft).font(.body).frame(minHeight: 140).scrollContentBackground(.hidden)
                    .padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                HStack {
                    Button("Anuluj") { editing.wrappedValue = false }
                    Button("Zapisz") {
                        Task { if await store.update(eventID, [field: .string(draft.wrappedValue)]) { editing.wrappedValue = false } }
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else if text.isEmpty {
                Text(field == "description" ? "Brak opisu" : "Brak notatek").foregroundStyle(.secondary)
            } else {
                Text(EventCardRichText.plain(text)).textSelection(.enabled)
            }
        }
    }
}

// MARK: Sale wydarzenia (`EventRooms`)

@MainActor struct EventRoomsView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let rooms: EventCardDetails.Rooms?
    let canEdit: Bool
    @Binding var editing: Bool
    @Environment(\.crmTheme) private var theme
    @EnvironmentObject private var state: Workspace
    @State private var selected: [String] = []
    @State private var stage = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        if let rooms {
            if rooms.error {
                Text("Nie udało się pobrać sal wydarzenia.").font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5))
            } else if canEdit && editing {
                editor(rooms)
            } else if !rooms.selected.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    let names = rooms.rooms.filter { rooms.selected.contains($0.id) }.map(\.name).joined(separator: ", ")
                    Text("Sale: \(names.nonEmpty ?? "Nie znaleziono zapisanych sal")").font(.callout)
                    if let stageID = rooms.stage {
                        let stageName = rooms.rooms.first(where: { $0.id == stageID })?.name ?? "Nie znaleziono zapisanej sali"
                        Text("Scena / DJ: \(stageName)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else if !rooms.rooms.isEmpty {
                Text("Sala: nie wskazano").font(.caption).foregroundStyle(.secondary)
            }
        } else {
            Text("Ładowanie sal…").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func editor(_ rooms: EventCardDetails.Rooms) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Zaznacz wszystkie używane sale, także połączone. Wskaż jedną salę ze sceną lub stanowiskiem DJ-a.")
                .font(.caption).foregroundStyle(.secondary)
            if rooms.rooms.isEmpty { Text("Ten obiekt nie ma jeszcze zapisanych sal.").font(.callout).foregroundStyle(.secondary) }
            ForEach(rooms.rooms) { room in
                VStack(alignment: .leading, spacing: 2) {
                    Toggle(room.name, isOn: Binding(get: { selected.contains(room.id) }, set: { on in
                        if on { selected.append(room.id) } else {
                            selected.removeAll { $0 == room.id }
                            if stage == room.id { stage = "" }
                        }
                    }))
                    .toggleStyle(.checkbox)
                    if selected.contains(room.id), let notes = room.notes?.nonEmpty {
                        Text(notes).font(.caption).foregroundStyle(.secondary).padding(.leading, 20)
                    }
                }
            }
            if !selected.isEmpty {
                Picker("Scena / DJ", selection: $stage) {
                    Text("Do ustalenia").tag("")
                    ForEach(rooms.rooms.filter { selected.contains($0.id) }) { Text($0.name).tag($0.id) }
                }
                .frame(maxWidth: 320)
            }
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack(spacing: 10) {
                Button(saving ? "Zapisywanie…" : "Zapisz sale wydarzenia") { Task { await save(rooms) } }.buttonStyle(.borderedProminent).disabled(saving)
                Button("Anuluj") { reset(rooms); error = nil; editing = false }.disabled(saving)
                Button("Zarządzaj salami obiektu") { state.openCRM("/crm/locations/\(rooms.locationId)") }.buttonStyle(.link).font(.caption)
            }
        }
        .padding(12).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 9))
        .onAppear { reset(rooms) }
    }

    private func reset(_ rooms: EventCardDetails.Rooms) {
        selected = rooms.selected
        stage = rooms.stage ?? ""
    }

    private func save(_ rooms: EventCardDetails.Rooms) async {
        guard !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await store.detailsRun(eventID, "rooms", [
                "locationId": .string(rooms.locationId), "ids": .array(selected.map { JSONValue.string($0) }),
                "stage": stage.isEmpty ? .null : .string(stage),
                "originalIds": .array(rooms.selected.map { JSONValue.string($0) }),
                "originalStage": rooms.stage.map { JSONValue.string($0) } ?? .null,
            ], success: "Sale zapisane. Jeśli wytyczne były już wysłane, wyślij je ponownie z nowym miejscem realizacji.")
            editing = false
        } catch {
            self.error = store.failureText(error, "Nie udało się zapisać sal.")
        }
    }
}

// MARK: Firma realizująca (`EditRealizationCompanyModal`)

@MainActor struct EventCompanySheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let current: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var selected = ""
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Firma realizująca").font(.title3.weight(.light))
            ScrollView {
                VStack(spacing: 8) {
                    if loading && store.companies == nil {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                    } else if (store.companies ?? []).isEmpty {
                        Text("Brak aktywnych firm.").foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 80)
                    } else {
                        ForEach(store.companies ?? []) { company in
                            Button { selected = company.id } label: {
                                HStack(spacing: 12) {
                                    if let logo = company.logo_url?.nonEmpty { WarehouseThumb(url: logo, size: 40, symbol: "building") }
                                    else { Image(systemName: "building.2").frame(width: 40, height: 40).foregroundStyle(theme.accent) }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(company.legal_name?.nonEmpty ?? company.name).font(.callout.weight(.medium))
                                        Text(company.nip?.nonEmpty.map { "NIP: \($0)" } ?? company.email ?? "").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if selected == company.id { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
                                }
                                .padding(10)
                                .background(selected == company.id ? theme.accent.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .frame(maxHeight: 380)
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie..." : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(selected.isEmpty || saving)
            }
        }
        .padding(20).frame(width: 480)
        .task {
            selected = current
            do { try await store.loadCompanies(eventID) } catch { self.error = store.failureText(error, "Nie udało się pobrać firm.") }
            loading = false
        }
    }

    private func save() async {
        guard !selected.isEmpty, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            try await store.detailsRun(eventID, "company", ["companyId": .string(selected)], success: "Zmieniono firmę realizującą")
            dismiss()
        } catch {
            self.error = store.failureText(error, "Nie udało się zapisać firmy realizującej.")
        }
    }
}

// MARK: Lokalizacja (`LocationSelector` + `saveLocation`)

@MainActor struct EventLocationSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let currentID: String
    let currentLabel: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var query = ""
    @State private var selected: EventLocationOption?
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var adding = false

    var body: some View {
        let filtered = (store.locations ?? []).filter { $0.matches(query) }
        VStack(alignment: .leading, spacing: 12) {
            Text("Lokalizacja wydarzenia").font(.title3.weight(.light))
            TextField("Wybierz lub wyszukaj lokalizację...", text: $query).textFieldStyle(.roundedBorder)
            HStack {
                Text("Twoje lokalizacje (\(filtered.count))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Dodaj nową", systemImage: "plus") { adding = true }.buttonStyle(.link).font(.caption)
                    .help("Nowa lokalizacja (wyszukiwanie w Mapach Google)")
            }
            ScrollView {
                LazyVStack(spacing: 4) {
                    if loading && store.locations == nil {
                        ProgressView("Ładowanie lokalizacji...").frame(maxWidth: .infinity, minHeight: 80)
                    } else if filtered.isEmpty {
                        Text(query.isEmpty ? "Brak zapisanych lokalizacji" : "Nie znaleziono lokalizacji \"\(query)\" w Twojej liście")
                            .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 60)
                    }
                    ForEach(filtered) { location in
                        Button { selected = location; error = nil } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "mappin").foregroundStyle(theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(location.name).font(.callout.weight(.medium))
                                    let line = [location.address ?? "", [location.city ?? "", location.postal_code ?? ""].filter { !$0.isEmpty }.joined(separator: " ")]
                                        .filter { !$0.isEmpty }.joined(separator: ", ")
                                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                                    if let formatted = location.formatted_address?.nonEmpty { Text(formatted).font(.caption).foregroundStyle(.tertiary) }
                                }
                                Spacer()
                                if (selected?.id ?? currentID) == location.id { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
                            }
                            .padding(8)
                            .background((selected?.id ?? currentID) == location.id ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 340)
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz lokalizację") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 560)
        .task {
            do { try await store.loadLocations(eventID) } catch { self.error = store.failureText(error, "Nie udało się pobrać lokalizacji.") }
            loading = false
        }
        .sheet(isPresented: $adding) {
            AddEventLocationSheet(store: store, eventID: eventID) { id in
                Task {
                    try? await store.loadLocations(eventID)
                    selected = store.locations?.first { $0.id == id }
                    error = nil
                }
            }
        }
    }

    private func save() async {
        guard let location = selected ?? store.locations?.first(where: { $0.id == currentID }) else { error = "Wybierz lokalizację z listy."; return }
        saving = true
        defer { saving = false }
        var changes: [String: JSONValue] = ["location_id": .string(location.id), "location": .string(location.label)]
        if location.id != currentID {
            changes["location_room_ids"] = .array([])
            changes["stage_room_id"] = .null
        }
        if await store.update(eventID, changes) {
            await store.loadDetails(eventID)
            dismiss()
        } else {
            error = "Nie udało się zapisać lokalizacji."
        }
    }
}
