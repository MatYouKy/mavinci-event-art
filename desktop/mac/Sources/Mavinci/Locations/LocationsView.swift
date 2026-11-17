import SwiftUI

// MARK: Lokalizacje — 1:1 z `/crm/locations`: „Dodaj lokalizację”, wyszukiwanie (nazwa, miasto, adres, osoba kontaktowa),
// filtr miasta, sortowanie (nazwa, miasto, data dodania; rosnąco / malejąco), widoki Siatka / Lista / Tabela oraz Mapa
// z pinezkami (tylko w aplikacji, `LocationsMapView`), edycja, usuwanie, Google Maps. Kliknięcie otwiera szczegóły obiektu
// z salami (`LocationDetailView`); dodawanie i edycja to ten sam
// pełny formularz (`LocationEditorView`).

enum LocationsViewMode: String, CaseIterable, Identifiable {
    case grid, list, table, map
    var id: String { rawValue }
    var label: String {
        switch self {
        case .grid: return "Siatka"
        case .list: return "Lista"
        case .table: return "Tabela"
        case .map: return "Mapa"
        }
    }
    var symbol: String {
        switch self {
        case .grid: return "square.grid.3x3"
        case .list: return "list.bullet"
        case .table: return "tablecells"
        case .map: return "map"
        }
    }
}

/// Czynności na lokalizacji z listy.
struct LocationRowActions {
    let open: (CrmLocation) -> Void
    let edit: (CrmLocation) -> Void
    let remove: (CrmLocation) -> Void
    let canManage: Bool
}

@MainActor struct LocationsView: View {
    @ObservedObject var store: LocationsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("locations.mode") private var mode: LocationsViewMode = .grid
    @State private var search = ""
    @State private var city = "all"
    @State private var sortField = "name"
    @State private var ascending = true
    @State private var removing: CrmLocation?
    @State private var selection: String?

    private var canManage: Bool { store.access?.canManage ?? false }
    private var cities: [String] {
        Array(Set((store.list?.locations ?? []).map(\.city).filter { !$0.isEmpty })).sorted { $0.localizedCompare($1) == .orderedAscending }
    }
    private var visible: [CrmLocation] {
        let filtered = (store.list?.locations ?? []).filter { $0.matches(search) && (city == "all" || $0.city == city) }
        return filtered.sorted { a, b in
            let order: ComparisonResult
            switch sortField {
            case "city": order = a.city.lowercased().compare(b.city.lowercased())
            case "created_at": order = (MeetingDates.parse(a.createdAt) ?? .distantPast).compare(MeetingDates.parse(b.createdAt) ?? .distantPast)
            default: order = a.name.lowercased().compare(b.name.lowercased())
            }
            return ascending ? order == .orderedAscending : order == .orderedDescending
        }
    }
    private var filtering: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || city != "all" }

    var body: some View {
        Group {
            if store.creating {
                LocationEditorView(store: store, locationID: nil).id("new-location")
            } else if let id = store.editingID {
                LocationEditorView(store: store, locationID: id).id("edit-\(id)")
            } else if let id = store.openedID {
                LocationDetailView(store: store, locationID: id).id(id)
            } else {
                list
            }
        }
        .task(id: state.employee?.id) { await store.load() }
    }

    private var actions: LocationRowActions {
        LocationRowActions(open: { store.openedID = $0.id }, edit: { store.editingID = $0.id }, remove: { removing = $0 }, canManage: canManage)
    }

    private var list: some View {
        listBody
        .navigationTitle("Lokalizacje")
        .navigationSubtitle(store.list.map { "Lokalizacji: \(visible.count) / \($0.locations.count)" } ?? "")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po nazwie, mieście, adresie...")
        .confirmationDialog("Usunąć lokalizację?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let location = removing {
                Button("Usuń", role: .destructive) { Task { await store.remove("Usuwanie lokalizacji…", id: location.id) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno chcesz usunąć tę lokalizację?") }
    }

    /// Mapa wypełnia okno pod paskiem filtrów; pozostałe widoki przewijają się razem z nagłówkiem.
    @ViewBuilder private var listBody: some View {
        if mode == .map, store.list != nil, !visible.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                header
                toolbar
                LocationsMapView(locations: visible, actions: actions)
            }
            .padding(16)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    toolbar
                    content
                }
                .padding(16)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Lokalizacje").font(.title2.weight(.light))
                Text("\(visible.count) \(visible.count == 1 ? "lokalizacja" : "lokalizacji")").foregroundStyle(.secondary)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            if canManage { WarehouseAddButton(title: "Dodaj lokalizację") { store.openedID = nil; store.creating = true } }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            Picker("Miasto", selection: $city) {
                Text("Wszystkie miasta").tag("all")
                ForEach(cities, id: \.self) { Text($0).tag($0) }
            }
            .frame(maxWidth: 260)
            Picker("Sortuj", selection: $sortField) {
                Text("Nazwa").tag("name")
                Text("Miasto").tag("city")
                Text("Data dodania").tag("created_at")
            }
            .fixedSize()
            Button { ascending.toggle() } label: { Image(systemName: ascending ? "arrow.up" : "arrow.down") }
                .help(ascending ? "Rosnąco" : "Malejąco")
            Spacer()
            Picker("Widok", selection: $mode) {
                ForEach(LocationsViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
    }

    @ViewBuilder private var content: some View {
        if store.list == nil, let error = store.listError {
            ContentUnavailableView {
                Label("Lokalizacje", systemImage: "mappin.and.ellipse")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
            .frame(maxWidth: .infinity)
        } else if store.list == nil {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
        } else if visible.isEmpty {
            ContentUnavailableView {
                Label(filtering ? "Brak lokalizacji pasujących do filtrów" : "Brak lokalizacji", systemImage: "mappin")
            } description: {
                Text(filtering ? "Zmień kryteria wyszukiwania albo wyczyść filtry." : "Dodane obiekty pojawią się tutaj.")
            } actions: {
                if filtering {
                    Button("Wyczyść filtry") { search = ""; city = "all" }
                } else if canManage {
                    Button("Dodaj pierwszą lokalizację") { store.creating = true }.buttonStyle(.borderedProminent)
                }
            }
            .frame(maxWidth: .infinity).padding(.top, 30)
        } else {
            switch mode {
            case .grid:
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(visible) { LocationCard(location: $0, actions: actions) }
                }
            case .list:
                LazyVStack(spacing: 8) {
                    ForEach(visible) { LocationLine(location: $0, actions: actions) }
                }
            case .table:
                table
            case .map:
                LocationsMapView(locations: visible, actions: actions).frame(height: 560)
            }
        }
    }

    private var table: some View {
        Table(visible, selection: $selection) {
            TableColumn("Nazwa") { (location: CrmLocation) in
                VStack(alignment: .leading, spacing: 1) {
                    Label(location.name, systemImage: "mappin").fontWeight(.medium)
                    Button("Szczegóły i sale →") { actions.open(location) }.buttonStyle(.link).font(.caption)
                }
            }
            .width(min: 180, ideal: 260)
            TableColumn("Adres") { (location: CrmLocation) in Text(location.address.nonEmpty ?? "-").foregroundStyle(.secondary) }
                .width(min: 120, ideal: 220)
            TableColumn("Miasto") { (location: CrmLocation) in Text(location.city.nonEmpty ?? "-") }
                .width(min: 80, ideal: 120)
            TableColumn("Kontakt") { (location: CrmLocation) in
                Text(location.contactName.nonEmpty ?? location.contactPhone.nonEmpty ?? "-").foregroundStyle(.secondary)
            }
            .width(min: 100, ideal: 160)
            TableColumn("NIP") { (location: CrmLocation) in Text(location.nip.nonEmpty ?? "-").foregroundStyle(.secondary) }
                .width(min: 70, ideal: 110)
            TableColumn("Akcje") { (location: CrmLocation) in LocationActionButtons(location: location, actions: actions) }
                .width(min: 90, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let location = visible.first(where: { $0.id == id }) { LocationMenu(location: location, actions: actions) }
        } primaryAction: { ids in
            if let id = ids.first, let location = visible.first(where: { $0.id == id }) { actions.open(location) }
        }
        .frame(minHeight: 420)
    }
}

/// Menu lokalizacji (kafelek, wiersz, tabela).
@MainActor struct LocationMenu: View {
    let location: CrmLocation
    let actions: LocationRowActions
    var body: some View {
        Button("Szczegóły i sale", systemImage: "info.circle") { actions.open(location) }
        if let url = URL(string: location.googleMapsUrl), !location.googleMapsUrl.isEmpty {
            Button("Zobacz na mapie", systemImage: "map") { NSWorkspace.shared.open(url) }
        }
        if actions.canManage {
            Button("Edytuj", systemImage: "pencil") { actions.edit(location) }
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { actions.remove(location) }
        }
    }
}

/// Przyciski: mapa, edycja, usuwanie.
@MainActor struct LocationActionButtons: View {
    let location: CrmLocation
    let actions: LocationRowActions
    var body: some View {
        HStack(spacing: 8) {
            if let url = URL(string: location.googleMapsUrl), !location.googleMapsUrl.isEmpty {
                Button { NSWorkspace.shared.open(url) } label: { Image(systemName: "arrow.up.right.square") }.help("Zobacz na mapie")
            }
            if actions.canManage {
                Button { actions.edit(location) } label: { Image(systemName: "pencil") }.help("Edytuj")
                Button { actions.remove(location) } label: { Image(systemName: "trash") }.foregroundStyle(.red).help("Usuń")
            }
        }
        .buttonStyle(.borderless)
    }
}

/// Kafelek (widok Siatka).
@MainActor struct LocationCard: View {
    let location: CrmLocation
    let actions: LocationRowActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "mappin").font(.title3).foregroundStyle(theme.accent)
                    .frame(width: 36, height: 36).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(location.name).font(.headline).lineLimit(2)
                    Button("Szczegóły i sale →") { actions.open(location) }.buttonStyle(.link).font(.caption)
                }
                Spacer()
                LocationActionButtons(location: location, actions: actions)
            }
            VStack(alignment: .leading, spacing: 4) {
                if !location.address.isEmpty { Label(location.address, systemImage: "building.2").lineLimit(1) }
                if !location.cityLine.isEmpty { Label(location.cityLine, systemImage: "mappin.circle").lineLimit(1) }
                if !location.contactName.isEmpty { Label(location.contactName, systemImage: "person").lineLimit(1) }
                if !location.contactPhone.isEmpty { Label(location.contactPhone, systemImage: "phone").lineLimit(1) }
                if let rooms = location.rooms, rooms > 0 { Label("Sale i przestrzenie: \(rooms)", systemImage: "square.split.2x2").lineLimit(1) }
            }
            .font(.callout).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onHover { hover = $0 }
        .onTapGesture { actions.open(location) }
        .contextMenu { LocationMenu(location: location, actions: actions) }
    }
}

/// Wiersz (widok Lista).
@MainActor struct LocationLine: View {
    let location: CrmLocation
    let actions: LocationRowActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin.and.ellipse").foregroundStyle(theme.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(location.name).font(.headline)
                    Button("Szczegóły i sale →") { actions.open(location) }.buttonStyle(.link).font(.caption)
                }
                Text([location.city, location.address].filter { !$0.isEmpty }.joined(separator: " · ")).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if !location.contactName.isEmpty { Label(location.contactName, systemImage: "person").font(.callout).foregroundStyle(.secondary) }
            if !location.contactPhone.isEmpty { Label(location.contactPhone, systemImage: "phone").font(.callout).foregroundStyle(.secondary) }
            LocationActionButtons(location: location, actions: actions)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onHover { hover = $0 }
        .onTapGesture { actions.open(location) }
        .contextMenu { LocationMenu(location: location, actions: actions) }
    }
}
