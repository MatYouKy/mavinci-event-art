import SwiftUI
import AppKit

// MARK: Karta wydarzenia — natywnie 1:1 z `/crm/events/[id]` (`EventDetailPageClient`): nagłówek, zakładki według dostępu z bazy
// (te same reguły co CRM), Przegląd i Szczegóły natywnie, karta imprezy PDF generowana lokalnie. Zakładki, które nie są jeszcze
// przeniesione, pokazują dane wydarzenia (widok danych) i otwierają się w CRM. Karta z kopii na dysku, odświeżana po zmianie skrótu.

@MainActor struct EventCardView: View {
    let eventID: String
    var initialTab: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab = "overview"
    @State private var preview: NativePreview?
    @State private var removing = false
    @State private var duplicating = false

    var body: some View {
        EventCardContent(store: state.eventCards, eventID: eventID, tab: $tab, preview: $preview, removing: $removing, duplicating: $duplicating)
            .task(id: eventID) {
                if let initialTab { tab = initialTab }
                await state.eventCards.load(eventID)
            }
            // Ponowne otwarcie tej samej karty z innej zakładki (powiadomienie, link) — przejście do wskazanej zakładki.
            .onChange(of: initialTab) { if let initialTab { tab = initialTab } }
            .onChange(of: state.refreshEventToken) { Task { await state.eventCards.load(eventID) } }
            .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }
}

@MainActor private struct EventCardContent: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @Binding var tab: String
    @Binding var preview: NativePreview?
    @Binding var removing: Bool
    @Binding var duplicating: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    private var cached: CachedEventCard? { store.card(eventID) }
    private var flags: EventCardFlags? { cached?.page.flags }

    var body: some View {
        Group {
            if let page = cached?.page {
                switch page.kind {
                case "full": full(page)
                case "salesColleague": EventSalesColleagueCard(page: page)
                default: EventRealizationWorkspace(store: store, eventID: eventID, page: page, tab: $tab)
                }
            } else if let error = store.errors[eventID] {
                ContentUnavailableView {
                    Label("Nie można otworzyć wydarzenia", systemImage: "calendar.badge.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.load(eventID) } }
                }
            } else {
                ProgressView("Pobieranie wydarzenia…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .navigationTitle(EventFields(raw: cached?.page.event ?? [:]).name.nonEmpty ?? cached?.page.realization?.object["name"]?.text.nonEmpty ?? "Wydarzenie")
        .toolbar { toolbar }
        .confirmationDialog("Czy na pewno chcesz usunąć to wydarzenie?", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { await deleteEvent() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Wydarzenie \"\(EventFields(raw: cached?.page.event ?? [:]).name)\" zostanie trwale usunięte wraz z całą historią, przypisaniami i plikami. Tej operacji nie można cofnąć.")
        }
        .confirmationDialog("Duplikuj wydarzenie", isPresented: $duplicating, titleVisibility: .visible) {
            Button("Duplikuj") { Task { await duplicateEvent() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Czy chcesz zduplikować wydarzenie \"\(EventFields(raw: cached?.page.event ?? [:]).name)\"? Zostaną skopiowane wszystkie dane podstawowe, ale NIE zostaną skopiowane: przypisani ludzie, pliki i dokumenty.")
        }
    }

    // MARK: Pasek narzędzi (akcje nagłówka CRM: Karta imprezy, Edytuj, Duplikuj, Usuń)
    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { state.eventRoute = nil } label: { Label("Wróć", systemImage: "chevron.left") }.help("Wróć do poprzedniego widoku")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if store.loading.contains(eventID) { ProgressView().controlSize(.small).help("Odświeżanie karty") }
            if cached?.page.canPrintCard == true || cached?.page.kind == "realization" {
                Button { Task { await printCard() } } label: { Label("Karta imprezy", systemImage: "printer") }
                    .help(ChromePdfEngine.available ? "Karta imprezy (PDF generowany na tym Macu)" : "Karta imprezy (PDF z serwera)")
            }
            Menu {
                if let flags {
                    if flags.canEventManage {
                        Button("Edytuj", systemImage: "square.and.pencil") { state.openCRM("/crm/events/\(eventID)") }
                            .help("Edycja nazwy, terminu, klienta i kontaktu — w CRM")
                        Button("Duplikuj", systemImage: "plus.square.on.square") { duplicating = true }
                    }
                    if flags.showDetailsAction && flags.canEventManage && flags.tabs.contains(where: { $0.id == "details" }) {
                        Button("Zmień status", systemImage: "flag") { tab = "details" }.help("Status eventu — Szczegóły → Akcje")
                    }
                    if flags.isAdmin {
                        Divider()
                        Button("Usuń", systemImage: "trash", role: .destructive) { removing = true }
                    }
                }
                Divider()
                Button("Odśwież", systemImage: "arrow.clockwise") { Task { await store.load(eventID) } }
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(eventID)?tab=\(tab)") }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
        }
    }

    // MARK: Karta pełna
    private func full(_ page: EventCardPage) -> some View {
        let event = EventFields(raw: page.event ?? [:])
        let tabs = page.flags?.tabs ?? []
        let selected = tabs.contains(where: { $0.id == tab }) ? tab : (tabs.first(where: { $0.id == "overview" })?.id ?? tabs.first?.id)
        return VStack(alignment: .leading, spacing: 0) {
            header(page, event)
            if event["seller_confirmation_required"] == "true" && page.flags?.canViewSellerCorrespondence == true && event.status != "cancelled" {
                sellerBanner(event)
            }
            if let selected {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(tabs) { item in
                            Button { tab = item.id } label: {
                                Label(item.label, systemImage: item.id == "agenda" && page.flags?.isWeddingEvent == true ? "heart" : item.symbol)
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
                tabContent(selected, page, event).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                // Bez żadnej zakładki (zakres nie obejmuje danych wydarzenia) — jak komunikat w CRM.
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "exclamationmark.shield").font(.title3).foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Brak dostępu do danych tego wydarzenia").font(.callout.weight(.medium))
                        Text("Twój zakres nie obejmuje danych tego wydarzenia. Jeśli to pomyłka, poproś administratora o dostęp.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                .padding(18)
                Spacer()
            }
        }
    }

    private func header(_ page: EventCardPage, _ event: EventFields) -> some View {
        let canViewClient = page.flags?.canViewClient == true
        let creator = event.object("creator")
        let author = [creator["name"]?.text ?? "", creator["surname"]?.text ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(event.name).font(.title2.weight(.light)).textSelection(.enabled)
                let colors = EventLabels.statusColors(event.status)
                Text(EventLabels.status(event.status)).font(.caption.weight(.medium))
                    .padding(.horizontal, 8).padding(.vertical, 3).background(colors.background, in: Capsule()).foregroundStyle(colors.text)
                if !event.categoryName.isEmpty { WarehouseBadge(text: event.categoryName, color: CrmTheme.hex(event.categoryColor) ?? theme.accent) }
                if let badge = page.equipmentBadge { equipmentBadge(badge, canOpen: page.flags?.tabs.contains(where: { $0.id == "equipment" }) == true) }
            }
            WrapLine(spacing: 14) {
                ForEach(Self.headerLines(page, event, canViewClient: canViewClient, author: author), id: \.text) { line in
                    Label(line.text, systemImage: line.symbol)
                }
            }
            .font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 4)
    }

    /// Wiersz pod nazwą: termin, miejsce, klient wg typu (firma / osoba prywatna), kontakt, autor — jak nagłówek CRM.
    static func headerLines(_ page: EventCardPage, _ event: EventFields, canViewClient: Bool, author: String) -> [(text: String, symbol: String)] {
        var lines: [(text: String, symbol: String)] = [(EventCardText.dateRange(event), "calendar")]
        if let location = EventCardText.location(page, event) { lines.append((location, "mappin")) }
        if canViewClient {
            let type = event["client_type"]
            if type == "business" {
                let org = event.organization
                let name = org["alias"]?.text.nonEmpty ?? org["name"]?.text.nonEmpty ?? "Brak klienta"
                lines.append((name, "building.2"))
                if let contact = page.contact { lines.append(("Kontakt: " + EventCardText.contactName(contact), "person")) }
            } else if type == "individual" {
                if let contact = page.contact {
                    lines.append(("Klient: " + EventCardText.contactName(contact), "person"))
                } else {
                    lines.append(("Brak klienta", "person"))
                }
            }
        }
        if !author.isEmpty { lines.append(("Autor: " + author, "person.crop.circle")) }
        return lines
    }

    private func equipmentBadge(_ badge: EventEquipmentBadge, canOpen: Bool) -> some View {
        let chip = EventStepRules.chip(badge.tone)
        return Button { if canOpen { tab = "equipment" } } label: {
            Label(badge.label, systemImage: "shippingbox").font(.caption.weight(.medium))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(chip.0, in: Capsule()).foregroundStyle(chip.1)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain).disabled(!canOpen)
        .help(canOpen ? "Otwórz zakładkę Sprzęt" : badge.label)
    }

    /// Wydarzenie z akceptacji oferty sprzedawcy — do przygotowania i osobnego potwierdzenia realizacji.
    private func sellerBanner(_ event: EventFields) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("OFERTA SPRZEDAWCY PRZYJĘTA — WYDARZENIE DO PRZYGOTOWANIA").font(.caption.weight(.medium)).foregroundStyle(CrmTheme.rgb(0xfde68a))
            Text("Wydarzenie zostało utworzone przy akceptacji oferty. Uzupełnij harmonogram, zespół, agendę i logistykę, a następnie osobno potwierdź realizację.")
                .font(.callout).foregroundStyle(.secondary)
            if event["seller_schedule_pending"] == "true" {
                Text("Godziny są do ustalenia. Godzina 00:00 w kalendarzu jest wyłącznie oznaczeniem daty, nie ustalonym początkiem wydarzenia.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfde68a))
            }
            Button("Przygotowanie i potwierdzenie realizacji") { tab = "seller-arrangements" }
                .buttonStyle(.borderless).foregroundStyle(theme.accent)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(CrmTheme.rgb(0xfcd34d).opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 18).padding(.vertical, 6)
    }

    @ViewBuilder private func tabContent(_ id: String, _ page: EventCardPage, _ event: EventFields) -> some View {
        switch id {
        case "overview": EventOverviewTab(store: store, eventID: eventID, page: page, navigate: { tab = $0 })
        case "details": EventDetailsTab(store: store, eventID: eventID, page: page)
        case "team": EventTeamTab(store: store, eventID: eventID, page: page)
        case "phases": EventPhasesTab(store: store, eventID: eventID)
        case "equipment": EventEquipmentTab(store: store, eventID: eventID)
        case "logistics": EventLogisticsTab(store: store, eventID: eventID)
        case "files": EventFilesTab(store: store, eventID: eventID)
        case "subcontractors": EventSubcontractorsTab(store: store, eventID: eventID)
        case "offer": EventOfferTab(store: store, eventID: eventID)
        case "history": EventHistoryTab(store: store, eventID: eventID)
        case "summary": EventSettlementTab(store: store, eventID: eventID)
        case "finances": EventFinancesTab(store: store, eventID: eventID, navigate: { tab = $0 })
        case "seller-arrangements": EventSellerTab(store: store, eventID: eventID, navigate: { tab = $0 })
        case "calculations": EventCalculationsTab(store: store, eventID: eventID)
        case "contract": EventContractTab(store: store, eventID: eventID)
        case "tasks": TasksBoardView(store: store.tasksStore(eventID), embedded: true).id("tasks-event-\(eventID)")
        case "agenda":
            if page.flags?.isWeddingEvent == true { EventWeddingCardTab(store: store, eventID: eventID) }
            else { EventAgendaTab(store: store, eventID: eventID) }
        case "mavinci-live":
            ContentUnavailableView {
                Label("Mavinci LIVE", systemImage: "play.rectangle")
            } description: { Text("Moduły Mavinci LIVE są obsługiwane w CRM w przeglądarce.") } actions: {
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(eventID)?tab=mavinci-live") }
            }
        default:
            LegacyEventTabView(eventID: eventID, tabID: id, wedding: page.flags?.isWeddingEvent == true).id("\(eventID)-\(id)")
        }
    }

    // MARK: Czynności
    private func printCard() async {
        await state.withPending(ChromePdfEngine.available ? "Generowanie karty imprezy…" : "Pobieranie karty imprezy…") {
            do {
                let url = try await state.printDocument(path: "/bridge/events/\(eventID)/card", fallbackName: "karta-imprezy.pdf")
                preview = NativePreview(name: url.lastPathComponent, data: try Data(contentsOf: url))
            } catch {
                state.error = store.failureText(error, "Nie udało się przygotować karty imprezy. Spróbuj ponownie.")
            }
        }
    }
    private func deleteEvent() async {
        guard let api = state.nativeAPI() else { return }
        var ok = false
        await state.withPending("Usuwanie…") {
            do { _ = try await api.post("/events", ["op": .string("delete"), "id": .string(eventID)]); ok = true; state.succeed("Wydarzenie zostało usunięte") }
            catch { state.error = store.failureText(error, "Nie udało się usunąć wydarzenia.") }
        }
        if ok { state.eventRoute = nil; Task { await state.events.sync(force: true) } }
    }
    private func duplicateEvent() async {
        do {
            let data = try await store.detailsRun(eventID, "duplicate", [:], success: "Wydarzenie zostało zduplikowane", pending: "Duplikowanie…")
            struct Reply: Decodable { let id: String }
            if let reply = try? JSONDecoder().decode(Reply.self, from: data) { state.showEvent(reply.id) }
        } catch {
            state.error = store.failureText(error, "Wystąpił błąd podczas duplikowania")
        }
    }
}

/// Teksty nagłówka i pól jak w CRM.
enum EventCardText {
    static func dateRange(_ event: EventFields) -> String {
        guard let start = event.start else { return "—" }
        let day = MeetingDates.format(start, "dd.MM.yyyy HH:mm")
        guard let end = event.end, end > start else { return day }
        if Calendar.current.isDate(start, inSameDayAs: end) { return "\(day)–\(MeetingDates.format(end, "HH:mm"))" }
        return "\(day) – \(MeetingDates.format(end, "dd.MM.yyyy HH:mm"))"
    }
    static func location(_ page: EventCardPage, _ event: EventFields) -> String? {
        if let location = page.location, let name = location["name"]?.text.nonEmpty {
            let city = location["city"]?.text ?? ""
            return city.isEmpty ? name : "\(name) — \(city)"
        }
        return event["location"].nonEmpty
    }
    static func client(_ page: EventCardPage, _ event: EventFields) -> String? {
        let org = event.organization
        if let label = org["alias"]?.text.nonEmpty ?? org["name"]?.text.nonEmpty { return label }
        if let contact = page.contact {
            let name = [contact["first_name"]?.text ?? "", contact["last_name"]?.text ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
            return name.nonEmpty ?? contact["full_name"]?.text.nonEmpty
        }
        return nil
    }
    static func contactName(_ contact: [String: JSONValue]) -> String {
        contact["full_name"]?.text.nonEmpty ?? "\(contact["first_name"]?.text ?? "") \(contact["last_name"]?.text ?? "")"
    }
    static func money(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.currency(code: "PLN").locale(Locale(identifier: "pl_PL")))
    }
}

/// Podgląd sprzedaży kolegi (`EventSalesColleagueView`): termin, miejsce, kategoria, status, klient, kto sprzedał i sprzedane
/// usługi (bez cen) — tylko odczyt, dane z `get_event_sales_overview`.
@MainActor struct EventSalesColleagueCard: View {
    let page: EventCardPage
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let overview = page.overview?.object ?? [:]
        let event = overview["event"]?.object ?? [:]
        let fallback = page.fallbackEvent?.object ?? [:]
        let name = event["name"]?.text.nonEmpty ?? fallback["name"]?.text.nonEmpty ?? "Wydarzenie"
        let start = event["event_date"]?.text.nonEmpty ?? fallback["event_date"]?.text.nonEmpty
        let end = event["event_end_date"]?.text.nonEmpty ?? fallback["event_end_date"]?.text.nonEmpty
        let place = page.locationName?.nonEmpty ?? event["location"]?.text.nonEmpty ?? fallback["location"]?.text.nonEmpty
        let status = event["status"]?.text.nonEmpty ?? fallback["status"]?.text.nonEmpty
        let soldBy = (overview["sold_by"]?.array ?? []).map(\.text).filter { !$0.isEmpty }
        let products = (overview["products"]?.array ?? []).map(\.object)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(name).font(.title2.weight(.light))
                    HStack(spacing: 14) {
                        Label(Self.dateRange(start, end), systemImage: "calendar")
                        if let place { Label(place, systemImage: "mappin") }
                        if let status { statusPill(status) }
                    }
                    .font(.callout).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Wydarzenie innego sprzedawcy").font(.headline)
                        if let status { statusPill(status) }
                    }
                    Text("Termin jest zajęty przez sprzedaż innego sprzedawcy. Szczegóły, kwoty i dokumenty prowadzi sprzedawca.")
                        .font(.callout).foregroundStyle(.secondary)
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 9) {
                        row("calendar", "Termin", Self.dateRange(start, end))
                        row("mappin", "Miejsce", place ?? "Brak lokalizacji")
                        row("tag", "Kategoria", event["category"]?.text.nonEmpty ?? "Bez kategorii")
                        row("person", "Klient", overview["client_name"]?.text.nonEmpty ?? "Nie podano")
                        row("person.badge.shield.checkmark", "Sprzedał(a)", soldBy.isEmpty ? "Nie ustalono" : soldBy.joined(separator: ", "))
                    }
                    Text("SPRZEDANE USŁUGI").font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(theme.accent).padding(.top, 6)
                    if products.isEmpty {
                        Text("Brak zaakceptowanej oferty z listą usług.").font(.callout).foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(products.enumerated()), id: \.offset) { _, product in
                            Text(Self.productLabel(product)).font(.callout)
                                .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                if let summary = page.accessSummary?.nonEmpty { Text(summary).font(.caption).foregroundStyle(.tertiary) }
            }
            .padding(18).frame(maxWidth: 900, alignment: .leading)
        }
    }

    private func statusPill(_ status: String) -> some View {
        let colors = EventLabels.statusColors(status)
        return Text(EventLabels.status(status)).font(.caption.weight(.medium))
            .padding(.horizontal, 8).padding(.vertical, 3).background(colors.background, in: Capsule()).foregroundStyle(colors.text)
    }
    private func row(_ symbol: String, _ label: String, _ value: String) -> some View {
        GridRow {
            Label(label, systemImage: symbol).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled)
        }
    }
    /// „pt., …” → „piątek, 14 listopada 2026, 18:00–23:00” (`formatDateRange` z dniem tygodnia w pełnej formie).
    static func dateRange(_ start: String?, _ end: String?) -> String {
        guard let from = start.flatMap(MeetingDates.parse) else { return "Termin nieustalony" }
        let day = MeetingDates.format(from, "EEEE, d MMMM yyyy")
        let time = { (date: Date) in MeetingDates.format(date, "HH:mm") }
        guard let to = end.flatMap(MeetingDates.parse) else { return "\(day), \(time(from))" }
        if MeetingDates.calendar.isDate(to, inSameDayAs: from) { return "\(day), \(time(from))–\(time(to))" }
        return "\(day), \(time(from)) – \(MeetingDates.format(to, "d MMMM")), \(time(to))"
    }
    /// „Taniec w Chmurach × 2 szt.” (`salesOverviewProductLabel`).
    static func productLabel(_ product: [String: JSONValue]) -> String {
        let name = product["name"]?.text ?? ""
        guard case .number(let quantity) = product["quantity"] ?? .null, quantity != 1 else { return name }
        let text = (quantity.rounded() == quantity ? String(Int(quantity)) : String(quantity)).replacingOccurrences(of: ".", with: ",")
        let unit = product["unit"]?.text.nonEmpty.map { " \($0)" } ?? ""
        return "\(name) × \(text)\(unit)"
    }
}
