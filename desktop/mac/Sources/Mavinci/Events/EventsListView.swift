import SwiftUI
import AppKit

// MARK: Wydarzenia — lista 1:1 z `/crm/events` (`EventsPageClient`): wyszukiwanie (nazwa, opis, miejsce, klient — bez polskich znaków),
// filtry statusu (albo etapu operacyjnego) i kategorii, „Pokaż/Ukryj rozliczone”, sortowanie (data, nazwa, budżet, utworzenie),
// widoki Lista / Kafelki / Tabela, stan rozliczeń i płatności z pilnością, budżet z faktur, podgląd sprzedaży kolegów,
// „Zmień status” i usuwanie. Z kopii na dysku (`events-list`), synchronizacja co 60 s tylko zmienionych koszyków.

@MainActor struct EventsListView: View {
    @ObservedObject var store: EventsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("events.mode") private var mode: EventsViewMode = .list
    @AppStorage("events.sort") private var sort: EventsSortField = .date
    @AppStorage("events.ascending") private var ascending = true
    @AppStorage("events.showPast") private var showPast = false
    @State private var search = ""
    @State private var statusFilter = "all"
    @State private var categoryFilter = "all"
    @State private var selectedID: String?
    @State private var statusFor: EventListItem?
    @State private var removing: EventListItem?

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private func isPast(_ item: EventListItem) -> Bool { (item.end.map { Calendar.current.startOfDay(for: $0) } ?? today) < today }
    private let settled: Set<String> = ["settled", "cancelled"]

    private var visible: [EventListItem] {
        let terms = EventLabels.normalize(search).split(separator: " ").map(String.init)
        var result = store.events.filter { item in
            guard item.matches(terms) else { return false }
            if statusFilter != "all" && item.displayStatus != statusFilter { return false }
            if categoryFilter != "all" && item.categoryId != categoryFilter { return false }
            if !showPast && isPast(item) && settled.contains(item.displayStatus) { return false }
            return true
        }
        result.sort { a, b in
            let ordered: Bool
            switch sort {
            case .date: ordered = (a.start ?? .distantPast) < (b.start ?? .distantPast)
            case .created: ordered = (a.createdAt ?? "") < (b.createdAt ?? "")
            case .name: ordered = a.name.localizedStandardCompare(b.name) == .orderedAscending
            case .budget: ordered = a.budgetSortValue < b.budgetSortValue
            }
            return ascending ? ordered : !ordered
        }
        return result
    }
    private var hiddenSettled: Int { store.events.filter { isPast($0) && settled.contains($0.displayStatus) }.count }
    private var statusOptions: [InquiryOption] { store.operational ? EventLabels.operational : EventLabels.statuses }
    private var showBudget: Bool { store.events.contains(where: \.budgetVisible) }

    var body: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Wydarzenia")
        .navigationSubtitle("Znaleziono: \(visible.count) / \(store.events.count)" + (!showPast && hiddenSettled > 0 ? " (ukryto \(hiddenSettled) rozliczonych)" : ""))
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po nazwie, lokalizacji, kliencie...")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { state.openCRM("/crm/event-categories") } label: { Label("Kategorie", systemImage: "tag") }.help("Kategorie wydarzeń (CRM)")
                if store.access?.canCreate == true {
                    Button { state.openCRM("/crm/events?new=1") } label: { Label("Nowy event", systemImage: "plus") }.help("Nowy event (kreator w CRM)")
                }
            }
        }
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

    private var header: some View {
        HStack(spacing: 10) {
            Picker("Status", selection: $statusFilter) {
                Text("Wszystkie statusy").tag("all")
                ForEach(statusOptions) { Text($0.label).tag($0.value) }
            }
            .labelsHidden().fixedSize()
            Picker("Kategoria", selection: $categoryFilter) {
                Text("Wszystkie kategorie").tag("all")
                ForEach(store.categories) { Text($0.name).tag($0.id) }
            }
            .labelsHidden().fixedSize()
            Toggle(showPast ? "Ukryj rozliczone" : "Pokaż rozliczone", isOn: $showPast).toggleStyle(.button)
            Menu {
                Picker("Sortuj", selection: $sort) { ForEach(EventsSortField.allCases) { Text($0.label).tag($0) } }
                Divider()
                Picker("Kierunek", selection: $ascending) {
                    Text("Rosnąco").tag(true)
                    Text("Malejąco").tag(false)
                }
            } label: { Label(sort.label, systemImage: ascending ? "arrow.up" : "arrow.down") }
                .fixedSize()
            Spacer(minLength: 8)
            if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja wydarzeń") }
            Picker("Widok", selection: $mode) { ForEach(EventsViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    @ViewBuilder private var content: some View {
        if store.events.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Wydarzenia", systemImage: "calendar")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.sync(force: true) } } }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView("Brak wydarzeń", systemImage: "calendar", description: Text(search.isEmpty ? "Zmień filtry albo pokaż rozliczone." : "Nie znaleziono wydarzeń."))
        } else {
            switch mode {
            case .list:
                ScrollView {
                    LazyVStack(spacing: 6) { ForEach(visible) { row($0) } }.padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .grid:
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280, maximum: 420), spacing: 12)], spacing: 12) {
                        ForEach(visible) { card($0) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .table:
                table
            }
        }
    }

    // MARK: Czynności
    private func open(_ item: EventListItem) { state.showEvent(item.id) }
    @ViewBuilder private func menu(_ item: EventListItem) -> some View {
        Button("Otwórz", systemImage: "arrow.up.forward.app") { open(item) }
        if !item.salesColleague {
            if store.canManage { Button("Zmień status", systemImage: "flag") { statusFor = item } }
            if let maps = item.mapsURL { Button("Pokaż na mapie", systemImage: "map") { NSWorkspace.shared.open(maps) } }
            Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(item.id)") }
            if store.canManage {
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = item }
            }
        }
    }

    // MARK: Widoki
    /// Tło karty: pilne rozliczenia podświetlone kolorem (zamiast obramowania jak w CRM).
    private func fill(_ item: EventListItem) -> Color {
        if let urgency = item.urgency { return urgency.opacity(0.16) }
        return theme.card.opacity(theme == .light ? 1 : 0.9)
    }
    private func titleLine(_ item: EventListItem) -> some View {
        HStack(spacing: 6) {
            if item.overdue {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(CrmTheme.rgb(0xf87171)).help(item.stateLabel)
            }
            Text(item.name).fontWeight(.medium).lineLimit(1)
            if item.salesColleague {
                WarehouseBadge(text: item.salesColleagueSeller.isEmpty ? "Sprzedaż kolegi" : "Sprzedał: \(item.salesColleagueSeller)", color: CrmTheme.rgb(0x60a5fa))
            }
        }
    }
    private func subtitle(_ item: EventListItem) -> some View {
        HStack(spacing: 6) {
            Text(item.salesColleague ? "Podgląd sprzedaży — tylko do odczytu"
                 : item.createdAt.flatMap(MeetingDates.parse).map { "Utworzono: \(MeetingDates.format($0, "dd.MM.yyyy"))" } ?? "Utworzono: —")
            if !item.stateLabel.isEmpty {
                Text(item.stateLabel).padding(.horizontal, 5).padding(.vertical, 1).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(item.urgency ?? .secondary)
            }
        }
        .font(.caption2).foregroundStyle(.secondary)
    }
    private func categoryBadge(_ item: EventListItem) -> some View {
        Group {
            if !item.categoryName.isEmpty {
                WarehouseBadge(text: item.categoryName, color: CrmTheme.hex(item.categoryColor) ?? theme.accent)
            }
        }
    }

    private func row(_ item: EventListItem) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                titleLine(item)
                subtitle(item)
            }
            .frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            Label(item.clientLabel, systemImage: item.isContactClient ? "person" : "building.2").lineLimit(1).frame(width: 170, alignment: .leading)
            Text(EventLabels.dateRange(item)).monospacedDigit().lineLimit(1).frame(width: 150, alignment: .leading)
            Label(item.locationLabel, systemImage: "mappin").lineLimit(1).frame(width: 190, alignment: .leading)
            EventStatusPill(item: item).frame(width: 150, alignment: .leading)
            categoryBadge(item).frame(width: 110, alignment: .leading)
            if showBudget { Text(item.budgetLabel).monospacedDigit().lineLimit(1).frame(width: 110, alignment: .trailing).help(item.budgetTitle) }
            Menu { menu(item) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .font(.callout)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(fill(item), in: RoundedRectangle(cornerRadius: 10))
        .opacity(isPast(item) && item.urgency == nil ? 0.7 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { open(item) }
        .contextMenu { menu(item) }
    }

    private func card(_ item: EventListItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                titleLine(item)
                Spacer()
                Menu { menu(item) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
            if !item.stateLabel.isEmpty { Text(item.stateLabel).font(.caption).foregroundStyle(item.urgency ?? .secondary) }
            Label(EventLabels.dateRange(item), systemImage: "calendar").monospacedDigit()
            Label(item.locationLabel, systemImage: "mappin").lineLimit(1)
            Label(item.clientLabel, systemImage: item.isContactClient ? "person" : "building.2").lineLimit(1)
            HStack {
                EventStatusPill(item: item)
                categoryBadge(item)
                Spacer()
                if item.budgetVisible { Text(item.budgetLabel).font(.callout.weight(.medium)).monospacedDigit().foregroundStyle(theme.accent).help(item.budgetTitle) }
            }
        }
        .font(.callout)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(fill(item), in: RoundedRectangle(cornerRadius: 12))
        .opacity(isPast(item) && item.urgency == nil ? 0.7 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { open(item) }
        .contextMenu { menu(item) }
    }

    private var table: some View {
        Table(visible, selection: $selectedID) {
            TableColumn("Nazwa") { (item: EventListItem) in
                VStack(alignment: .leading, spacing: 2) {
                    titleLine(item)
                    subtitle(item)
                }
            }.width(min: 220, ideal: 360)
            TableColumn("Klient") { (item: EventListItem) in Text(item.clientLabel).lineLimit(1) }.width(min: 100, ideal: 170)
            TableColumn("Data") { (item: EventListItem) in Text(EventLabels.dateRange(item)).monospacedDigit() }.width(min: 90, ideal: 140)
            TableColumn("Lokalizacja") { (item: EventListItem) in Text(item.locationLabel).lineLimit(1) }.width(min: 100, ideal: 200)
            TableColumn("Status") { (item: EventListItem) in EventStatusPill(item: item) }.width(min: 110, ideal: 170)
            TableColumn("Kategoria") { (item: EventListItem) in categoryBadge(item) }.width(min: 80, ideal: 120)
            TableColumn("Budżet") { (item: EventListItem) in Text(item.budgetLabel).monospacedDigit().help(item.budgetTitle) }.width(min: 70, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = store.event(id) { menu(item) }
        } primaryAction: { ids in
            if let id = ids.first, let item = store.event(id) { open(item) }
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
