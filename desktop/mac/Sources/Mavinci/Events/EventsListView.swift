import SwiftUI
import AppKit

// MARK: Wydarzenia — natywna lista narzędziowa (wzór: listy w Wodawo): jedna tabela z miniaturą-piktogramem kategorii, Lp.,
// sortowaniem w nagłówkach kolumn, statusem jako kropka z opisem, rozliczeniem z ostrzeżeniem tylko przy zaległościach,
// wyszukiwaniem i filtrem „Pokaż” nad tabelą oraz kartą zaznaczonego wydarzenia z boku (⌥⌘I). Dwuklik albo ↩ — karta
// wydarzenia. Dane i reguły jak `/crm/events` (`EventsPageClient`): wyszukiwanie bez polskich znaków, ukrywanie
// rozliczonych minionych, statusy albo etapy operacyjne, budżet z faktur. Kopia na dysku (`events-list`), synchronizacja co 60 s.

extension EventListItem {
    /// Klucze sortowania kolumn (wartości porównywalne).
    var sortDate: Date { start ?? .distantPast }
    var sortStatus: Int { EventLabels.statuses.firstIndex { $0.value == displayStatus } ?? 99 }
    var sortSettlement: Int {
        switch state {
        case "overdue": return 0
        case "late": return 1
        case "awaiting", "completed", "settlement": return 2
        case "settled": return 4
        default: return 3
        }
    }
    var statusLabel: String { operationalLabel.nonEmpty ?? EventLabels.status(displayStatus) }
}

extension EventLabels {
    /// Kolor kropki statusu: nowe — niebieski, oferta w toku — bursztyn, przygotowanie — zielony, realizacja — fiolet,
    /// po realizacji i rozliczone — szary.
    static func statusDot(_ value: String) -> Color {
        switch value {
        case "inquiry": return CrmTheme.rgb(0x60a5fa)
        case "offer_to_send", "offer_sent": return CrmTheme.rgb(0xfbbf24)
        case "offer_accepted", "in_preparation", "ready_for_live": return CrmTheme.rgb(0x34d399)
        case "in_progress": return CrmTheme.rgb(0xa78bfa)
        case "cancelled": return CrmTheme.rgb(0x6b7280)
        default: return Color.secondary
        }
    }

    /// Piktogram kategorii wydarzenia (miniatura wiersza).
    static func categorySymbol(_ name: String) -> String {
        let key = normalize(name)
        let rules: [(String, String)] = [
            ("wesel", "heart.fill"), ("slub", "heart.fill"), ("studniow", "graduationcap.fill"), ("bal", "graduationcap.fill"),
            ("dj", "music.note"), ("koncert", "music.mic"), ("wystep", "music.mic"), ("artyst", "music.mic"),
            ("festyn", "party.popper.fill"), ("event", "star.fill"), ("konferenc", "person.3.sequence.fill"), ("targ", "storefront.fill"),
            ("teambuild", "person.3.fill"), ("integrac", "person.3.fill"), ("naglos", "speaker.wave.3.fill"), ("oswietl", "lightbulb.fill"),
            ("multimed", "play.rectangle.fill"), ("dekorac", "sparkles"), ("dodatk", "plus.square.fill"), ("urodzin", "gift.fill"),
        ]
        return rules.first { key.contains($0.0) }?.1 ?? "calendar"
    }
}

/// Miniatura wiersza: piktogram kategorii na neutralnym tle.
struct EventListThumb: View {
    let item: EventListItem
    var size: CGFloat = 26
    var body: some View {
        Image(systemName: EventLabels.categorySymbol(item.categoryName))
            .font(.system(size: size * 0.5, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(width: size, height: size)
            .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: max(5, size * 0.22), style: .continuous))
            .help(item.categoryName.nonEmpty ?? "Bez kategorii")
    }
}

/// Kropka z opisem (status, rozliczenie, kategoria).
struct EventDotLabel: View {
    let label: String
    let color: Color
    var size: CGFloat = 7
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: size, height: size)
            Text(label).lineLimit(1)
        }
        .help(label)
    }
}

/// Rozliczenie: zaległa płatność — czerwona etykieta z wykrzyknikiem, do rozliczenia / oczekuje — kropka, rozliczone — szary opis.
struct EventSettlementCell: View {
    let item: EventListItem
    var body: some View {
        switch item.state {
        case "overdue", "late":
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.circle.fill")
                Text(item.stateLabel).lineLimit(1)
            }
            .font(.callout.weight(.semibold)).foregroundStyle(Color.white)
            .padding(.horizontal, 7).padding(.vertical, 1)
            .background(Capsule().fill(CrmTheme.rgb(0xdc2626)))
            .help(item.stateLabel)
        case "awaiting", "completed", "settlement":
            EventDotLabel(label: item.stateLabel, color: CrmTheme.rgb(0xfb923c))
        case "settled":
            Text(item.stateLabel).lineLimit(1).foregroundStyle(.secondary)
        default:
            Text("")
        }
    }
}

@MainActor struct EventsListView: View {
    @ObservedObject var store: EventsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("events.show") private var show = "active"
    @AppStorage("events.category") private var categoryFilter = "all"
    @AppStorage("events.inspector") private var inspectorShown = true
    @State private var sortOrder: [KeyPathComparator<EventListItem>] = [KeyPathComparator(\EventListItem.sortDate)]
    @State private var search = ""
    @State private var selectedID: String?
    @State private var statusFor: EventListItem?
    @State private var removing: EventListItem?

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private func isPast(_ item: EventListItem) -> Bool { (item.end.map { Calendar.current.startOfDay(for: $0) } ?? today) < today }
    private let settled: Set<String> = ["settled", "cancelled"]

    private var visible: [EventListItem] {
        let terms = EventLabels.normalize(search).split(separator: " ").map(String.init)
        let status: String? = show.hasPrefix("s:") ? String(show.dropFirst(2)) : nil
        let result = store.events.filter { item in
            guard item.matches(terms) else { return false }
            if let status, item.displayStatus != status { return false }
            if categoryFilter != "all" && item.categoryId != categoryFilter { return false }
            if show == "active" && isPast(item) && settled.contains(item.displayStatus) { return false }
            return true
        }
        return result.sorted(using: sortOrder)
    }
    private var hiddenSettled: Int { store.events.filter { isPast($0) && settled.contains($0.displayStatus) }.count }
    private var statusOptions: [InquiryOption] { store.operational ? EventLabels.operational : EventLabels.statuses }
    private var selected: EventListItem? { selectedID.flatMap { store.event($0) } }

    var body: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Wydarzenia")
        .inspector(isPresented: $inspectorShown) {
            Group {
                if let item = selected {
                    EventListInspector(item: item, canManage: store.canManage && !item.salesColleague, open: { open(item) },
                                       changeStatus: { statusFor = item }, remove: { removing = item })
                } else {
                    ContentUnavailableView("Wybierz wydarzenie z listy", systemImage: "calendar",
                                           description: Text("Karta pokaże termin, klienta, miejsce, status i rozliczenie. Dwuklik albo ↩ otwiera kartę wydarzenia."))
                }
            }
            .inspectorColumnWidth(min: 280, ideal: 340, max: 520)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { state.openCRM("/crm/event-categories") } label: { Label("Kategorie", systemImage: "tag") }.help("Kategorie wydarzeń (CRM)")
                if store.access?.canCreate == true {
                    Button { state.openCRM("/crm/events?new=1") } label: { Label("Nowy event", systemImage: "plus") }.help("Nowy event (kreator w CRM)")
                }
                Button { inspectorShown.toggle() } label: { Label("Karta", systemImage: "sidebar.trailing") }
                    .help("Pokaż lub ukryj kartę wydarzenia (⌥⌘I)").keyboardShortcut("i", modifiers: [.command, .option])
            }
        }
        .onChange(of: selectedID) { _, value in if value != nil { inspectorShown = true } }
        .sheet(item: $statusFor) { item in
            EventStatusSheet(store: store, item: item).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń wydarzenie", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let item = removing { Task { _ = await store.delete(item) } } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć wydarzenie „\(removing?.name ?? "")”? Tej operacji nie można cofnąć.") }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    // MARK: Nagłówek: tytuł z liczbą, wyszukiwanie, „Pokaż”, kategoria

    private var countText: String {
        let base = "\(visible.count) z \(store.events.count)"
        return show == "active" && hiddenSettled > 0 ? base + " · ukryto \(hiddenSettled) rozliczonych" : base
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Wydarzenia").font(.title2.weight(.semibold))
                Text(countText).foregroundStyle(.secondary)
                Spacer()
                if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja wydarzeń") }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    searchField
                    showPicker
                    categoryPicker
                }
                VStack(alignment: .leading, spacing: 8) {
                    searchField
                    HStack(spacing: 12) {
                        showPicker
                        categoryPicker
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
    }

    private var searchField: some View {
        TextField("Szukaj: nazwa, klient, miejsce", text: $search)
            .textFieldStyle(.roundedBorder).frame(minWidth: 200, idealWidth: 320, maxWidth: 380)
    }

    private func statusCount(_ value: String) -> Int { store.events.filter { $0.displayStatus == value }.count }

    private var showPicker: some View {
        Picker("Pokaż", selection: $show) {
            Text("Aktywne").tag("active")
            Text("Wszystkie").tag("all")
            Divider()
            ForEach(statusOptions) { option in Text("\(option.label) (\(statusCount(option.value)))").tag("s:" + option.value) }
        }
        .fixedSize()
        .help("Aktywne — bez minionych rozliczonych i anulowanych")
    }

    private var categoryPicker: some View {
        Picker("Kategoria", selection: $categoryFilter) {
            Text("Wszystkie").tag("all")
            Divider()
            ForEach(store.categories) { category in Text(category.name).tag(category.id) }
        }
        .fixedSize()
    }

    // MARK: Tabela

    @ViewBuilder private var content: some View {
        if store.events.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Wydarzenia", systemImage: "calendar")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.sync(force: true) } } }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            let list = visible
            Group {
                if store.operational { operationalTable(list) } else { fullTable(list) }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let item = store.event(id) { menu(item) }
            } primaryAction: { ids in
                if let id = ids.first, let item = store.event(id) { open(item) }
            }
            .overlay {
                if list.isEmpty {
                    ContentUnavailableView("Brak wyników", systemImage: "line.3.horizontal.decrease.circle",
                                           description: Text(search.isEmpty ? "Zmień filtr „Pokaż” albo kategorię." : "Żadne wydarzenie nie pasuje do wyszukiwania."))
                }
            }
        }
    }

    private func numbers(_ list: [EventListItem]) -> [String: Int] {
        Dictionary(list.enumerated().map { ($0.element.id, $0.offset + 1) }, uniquingKeysWith: { first, _ in first })
    }

    /// Lista z rozliczeniem i budżetem (sprzedaż, finanse, zarząd).
    private func fullTable(_ list: [EventListItem]) -> some View {
        let lp = numbers(list)
        return Table(list, selection: $selectedID, sortOrder: $sortOrder) {
            TableColumn("") { (item: EventListItem) in EventListThumb(item: item) }.width(34)
            TableColumn("Lp.") { (item: EventListItem) in numberCell(lp[item.id] ?? 0) }.width(36)
            TableColumn("Nazwa", value: \EventListItem.name) { item in nameCell(item) }.width(min: 120, ideal: 260)
            TableColumn("Termin", value: \EventListItem.sortDate) { item in dateCell(item) }.width(min: 90, ideal: 150)
            TableColumn("Klient", value: \EventListItem.clientLabel) { item in clientCell(item) }.width(min: 80, ideal: 170)
            TableColumn("Miejsce", value: \EventListItem.locationLabel) { item in placeCell(item) }.width(min: 80, ideal: 190)
            TableColumn("Kategoria", value: \EventListItem.categoryName) { item in categoryCell(item) }.width(min: 70, ideal: 120)
            TableColumn("Status", value: \EventListItem.sortStatus) { item in EventDotLabel(label: item.statusLabel, color: EventLabels.statusDot(item.displayStatus)) }
                .width(min: 90, ideal: 160)
            TableColumn("Rozliczenie", value: \EventListItem.sortSettlement) { item in EventSettlementCell(item: item) }.width(min: 90, ideal: 190)
            TableColumn("Budżet", value: \EventListItem.budgetSortValue) { item in budgetCell(item) }.width(min: 70, ideal: 110)
        }
    }

    /// Lista z etapami operacyjnymi (zespół realizacji — bez kwot i rozliczeń, jak w CRM).
    private func operationalTable(_ list: [EventListItem]) -> some View {
        let lp = numbers(list)
        return Table(list, selection: $selectedID, sortOrder: $sortOrder) {
            TableColumn("") { (item: EventListItem) in EventListThumb(item: item) }.width(34)
            TableColumn("Lp.") { (item: EventListItem) in numberCell(lp[item.id] ?? 0) }.width(36)
            TableColumn("Nazwa", value: \EventListItem.name) { item in nameCell(item) }.width(min: 120, ideal: 280)
            TableColumn("Termin", value: \EventListItem.sortDate) { item in dateCell(item) }.width(min: 90, ideal: 150)
            TableColumn("Klient", value: \EventListItem.clientLabel) { item in clientCell(item) }.width(min: 80, ideal: 170)
            TableColumn("Miejsce", value: \EventListItem.locationLabel) { item in placeCell(item) }.width(min: 80, ideal: 220)
            TableColumn("Kategoria", value: \EventListItem.categoryName) { item in categoryCell(item) }.width(min: 70, ideal: 130)
            TableColumn("Etap", value: \EventListItem.sortStatus) { item in EventDotLabel(label: item.statusLabel, color: EventLabels.statusDot(item.displayStatus)) }
                .width(min: 90, ideal: 180)
        }
    }

    // MARK: Komórki

    private func numberCell(_ number: Int) -> some View {
        Text(number > 0 ? String(number) : "").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func nameCell(_ item: EventListItem) -> some View {
        let past = isPast(item)
        return HStack(spacing: 5) {
            Text(item.name).fontWeight(.medium).lineLimit(1).foregroundStyle(past ? Color.secondary : Color.primary).help(item.name)
            if item.salesColleague {
                Image(systemName: "eye").font(.caption).foregroundStyle(.secondary)
                    .help(item.salesColleagueSeller.isEmpty ? "Sprzedaż kolegi — podgląd" : "Sprzedaż kolegi — sprzedał: \(item.salesColleagueSeller)")
            }
        }
    }

    private func dateCell(_ item: EventListItem) -> some View {
        Text(EventLabels.dateRange(item)).monospacedDigit().lineLimit(1).foregroundStyle(isPast(item) ? Color.secondary : Color.primary)
    }

    private func clientCell(_ item: EventListItem) -> some View {
        HStack(spacing: 5) {
            Image(systemName: item.isContactClient ? "person" : "building.2").font(.caption).foregroundStyle(.secondary).frame(width: 14)
            Text(item.clientLabel).lineLimit(1).help(item.clientLabel)
        }
    }

    private func placeCell(_ item: EventListItem) -> some View {
        Text(item.locationLabel).lineLimit(1).foregroundStyle(.secondary).help(item.locationLabel)
    }

    @ViewBuilder private func categoryCell(_ item: EventListItem) -> some View {
        if item.categoryName.isEmpty {
            Text("—").foregroundStyle(.tertiary)
        } else {
            EventDotLabel(label: item.categoryName, color: CrmTheme.hex(item.categoryColor) ?? Color.secondary, size: 6)
                .foregroundStyle(.secondary)
        }
    }

    private func budgetCell(_ item: EventListItem) -> some View {
        Text(item.budgetVisible ? item.budgetLabel : "").monospacedDigit().lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .trailing).help(item.budgetTitle)
    }

    // MARK: Czynności

    private func open(_ item: EventListItem) { state.showEvent(item.id) }

    @ViewBuilder private func menu(_ item: EventListItem) -> some View {
        Button("Otwórz", systemImage: "arrow.up.forward.app") { open(item) }
        if !item.salesColleague {
            if store.canManage { Button("Zmień status", systemImage: "flag") { statusFor = item } }
            if let maps = item.mapsURL { Button("Pokaż na mapie", systemImage: "map") { NSWorkspace.shared.open(maps) } }
            Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(item.id)") }
            Divider()
            Button("Kopiuj nazwę", systemImage: "doc.on.doc") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(item.name, forType: .string)
            }
            if store.canManage {
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = item }
            }
        }
    }
}

// MARK: Karta zaznaczonego wydarzenia (panel z boku)

@MainActor struct EventListInspector: View {
    let item: EventListItem
    let canManage: Bool
    let open: () -> Void
    let changeStatus: () -> Void
    let remove: () -> Void
    @EnvironmentObject private var state: Workspace

    private var created: String {
        item.createdAt.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy, HH:mm") } ?? "—"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    EventListThumb(item: item, size: 44)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.name).font(.title3.weight(.semibold)).textSelection(.enabled)
                        EventDotLabel(label: item.statusLabel, color: EventLabels.statusDot(item.displayStatus))
                            .font(.callout)
                    }
                }
                Button(action: open) { Label("Otwórz kartę wydarzenia", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                if item.salesColleague {
                    Label(item.salesColleagueSeller.isEmpty ? "Sprzedaż kolegi — podgląd tylko do odczytu" : "Sprzedaż kolegi — sprzedał: \(item.salesColleagueSeller)",
                          systemImage: "eye")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 9) {
                    field("Termin", EventLabels.dateRange(item), symbol: "calendar")
                    field("Klient", item.clientLabel, symbol: item.isContactClient ? "person" : "building.2")
                    field("Miejsce", item.locationLabel, symbol: "mappin.and.ellipse")
                    if !item.locationAddress.isEmpty { field("Adres", item.locationAddress, symbol: "signpost.right") }
                    field("Kategoria", item.categoryName.nonEmpty ?? "—", symbol: "tag")
                    if !item.myCompany.isEmpty { field("Realizuje", item.myCompany, symbol: "briefcase") }
                    if !item.stateLabel.isEmpty && !item.salesColleague {
                        GridRow {
                            Image(systemName: "banknote").foregroundStyle(.secondary).frame(width: 16)
                            Text("Rozliczenie").foregroundStyle(.secondary)
                            EventSettlementCell(item: item)
                        }
                    }
                    if item.budgetVisible { field("Budżet", item.budgetLabel, symbol: "creditcard") }
                    if !item.salesColleague { field("Utworzono", created, symbol: "clock") }
                }
                .font(.callout)
                if !item.description.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Opis").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(item.description).font(.callout).lineLimit(10).textSelection(.enabled)
                    }
                }
                if !item.salesColleague {
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        if canManage { Button { changeStatus() } label: { Label("Zmień status", systemImage: "flag") } }
                        if let maps = item.mapsURL { Button { NSWorkspace.shared.open(maps) } label: { Label("Pokaż na mapie", systemImage: "map") } }
                        Button { state.openCRM("/crm/events/\(item.id)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                        if canManage { Button(role: .destructive) { remove() } label: { Label("Usuń wydarzenie", systemImage: "trash") } }
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func field(_ title: String, _ value: String, symbol: String) -> some View {
        GridRow {
            Image(systemName: symbol).foregroundStyle(.secondary).frame(width: 16)
            Text(title).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// „Zmień status” jak modal w CRM (statusy wydarzenia, zapis `events.status`).
@MainActor struct EventStatusSheet: View {
    @ObservedObject var store: EventsStore
    let item: EventListItem
    @Environment(\.dismiss) private var dismiss
    @State private var status = "inquiry"
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zmień status").font(.title2.weight(.light))
            Text(item.name).foregroundStyle(.secondary)
            Picker("Status", selection: $status) { ForEach(EventLabels.statuses) { Text($0.label).tag($0.value) } }
                .pickerStyle(.radioGroup).labelsHidden()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") {
                    Task {
                        saving = true
                        let ok = await store.changeStatus(item, to: status)
                        saving = false
                        if ok { dismiss() }
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || status == item.status)
            }
        }
        .padding(20)
        .frame(width: 380)
        .onAppear { status = item.status }
    }
}
