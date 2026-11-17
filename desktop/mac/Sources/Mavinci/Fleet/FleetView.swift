import SwiftUI

// MARK: Flota Pojazdów — 1:1 z `/crm/fleet`: „Dodaj pojazd”, kafelki statystyk (wszystkie, aktywne, w serwisie, koszty roczne,
// średni przebieg), wyszukiwanie (nazwa, marka, model, rejestracja, VIN), filtr statusu i kategorii, widoki Kafelki / Lista /
// Timeline, szybkie tankowanie, szczegóły, edycja i usuwanie. Kliknięcie otwiera kartę pojazdu (`FleetVehicleView`).

enum FleetViewMode: String, CaseIterable, Identifiable {
    case cards, table, timeline
    var id: String { rawValue }
    var label: String { self == .cards ? "Kafelki" : self == .table ? "Lista" : "Timeline" }
    var symbol: String { self == .cards ? "square.grid.2x2" : self == .table ? "list.bullet" : "chart.line.uptrend.xyaxis" }
}

/// Czynności na pojeździe z listy (kafelek, wiersz tabeli).
struct FleetRowActions {
    let open: (FleetVehicleRow) -> Void
    let edit: (FleetVehicleRow) -> Void
    let fuel: (FleetVehicleRow) -> Void
    let remove: (FleetVehicleRow) -> Void
}

@MainActor struct FleetView: View {
    @ObservedObject var store: FleetStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("fleet.mode") private var mode: FleetViewMode = .cards
    @State private var search = ""
    @State private var status = "all"
    @State private var category = "all"
    @State private var fuelFor: FleetVehicleRow?
    @State private var removing: FleetVehicleRow?
    @State private var selection: String?

    private var canManage: Bool { store.access?.canManage ?? false }
    private var canCreate: Bool { store.access?.canCreate ?? false }

    /// Filtry jak `useFleetFilters`: „Dostępny” obejmuje też status `active`, kategoria „Przyczepa” — pojazdy typu przyczepa.
    private var visible: [FleetVehicleRow] {
        (store.list?.vehicles ?? []).filter { vehicle in
            guard vehicle.matches(search) else { return false }
            if status != "all" && !(vehicle.status == status || (status == "available" && ["active", "available"].contains(vehicle.status))
                                     || (status == "in_use" && vehicle.inUse)) { return false }
            if category != "all" && !(vehicle.category == category || (category == "trailer" && vehicle.vehicleType == "trailer")) { return false }
            return true
        }
    }

    var body: some View {
        Group {
            if let id = store.openedID {
                FleetVehicleView(store: store, vehicleID: id).id(id)
            } else if store.creating {
                FleetVehicleView(store: store, vehicleID: nil).id("new-vehicle")
            } else {
                list
            }
        }
        .sheet(item: $fuelFor) { vehicle in
            FleetFuelSheet(store: store, vehicleID: vehicle.id, vehicleName: vehicle.name, currentMileage: vehicle.mileage, quick: true)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć pojazd?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let vehicle = removing {
                Button("Usuń", role: .destructive) { Task { await store.remove("Usuwanie pojazdu…", id: vehicle.id) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Pojazd „\(removing?.name ?? "")” zostanie trwale usunięty wraz z całą historią.") }
        .task(id: state.employee?.id) { if store.list == nil { await store.load() } }
    }

    private var actions: FleetRowActions {
        FleetRowActions(
            open: { store.openedTab = nil; store.openedID = $0.id },
            edit: { store.openedTab = .overview; store.editRequested = true; store.openedID = $0.id },
            fuel: { fuelFor = $0 },
            remove: { removing = $0 }
        )
    }

    private var list: some View {
        Group {
            if mode == .timeline {
                // Oś czasu wypełnia ekran; filtry listy (szukaj, status, kategoria) zawężają też pojazdy na osi.
                VStack(alignment: .leading, spacing: 14) {
                    header
                    stats
                    filters
                    FleetTimelineView(store: store, vehicleID: nil, visibleIDs: store.list == nil ? nil : Set(visible.map(\.id)))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .padding(16)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        stats
                        filters
                        content
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle("Flota Pojazdów")
        .navigationSubtitle(store.list.map { "Pojazdów: \(visible.count) / \($0.vehicles.count)" } ?? "")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po nazwie, marce, modelu, rejestracji lub VIN…")
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Flota Pojazdów").font(.title2.weight(.light))
                Text("Zarządzaj pojazdami firmowymi, tankowaniami, przeglądami i ubezpieczeniami").foregroundStyle(.secondary)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            if canCreate {
                WarehouseAddButton(title: "Dodaj pojazd") {
                    store.openedID = nil
                    store.creating = true
                }
            }
        }
    }

    @ViewBuilder private var stats: some View {
        if let stats = store.list?.stats {
            HStack(spacing: 12) {
                tile("Wszystkie pojazdy", "\(stats.total)", "car")
                tile("Aktywne", "\(stats.active)", "checkmark.circle", color: CrmTheme.rgb(0x4ade80))
                tile("W serwisie", "\(stats.inService)", "wrench.and.screwdriver", color: CrmTheme.rgb(0xfb923c))
                tile("Koszty roczne", FleetFormat.thousands(stats.yearlyCost), "banknote")
                    .help("Tankowania i serwis z ostatnich 12 miesięcy")
                tile("Śr. przebieg", FleetFormat.km(stats.averageMileage), "gauge.with.dots.needle.33percent")
            }
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Flota", systemImage: "car")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
            .frame(maxWidth: .infinity)
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
        }
    }

    private func tile(_ title: String, _ value: String, _ symbol: String, color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Image(systemName: symbol).foregroundStyle(theme.accent)
            }
            Text(value).font(.title2.weight(.semibold).monospacedDigit()).foregroundStyle(color ?? Color.primary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private var filters: some View {
        HStack(spacing: 10) {
            Picker("Status", selection: $status) {
                Text("Wszystkie statusy").tag("all")
                ForEach(store.dictionaries?.filterStatuses ?? []) { Text($0.label).tag($0.value) }
            }
            .fixedSize()
            Picker("Kategoria", selection: $category) {
                Text("Wszystkie kategorie").tag("all")
                ForEach(store.dictionaries?.filterCategories ?? []) { Text($0.label).tag($0.value) }
            }
            .fixedSize()
            Spacer()
            Picker("Widok", selection: $mode) { ForEach(FleetViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .labelsHidden()
    }

    @ViewBuilder private var content: some View {
        if store.list != nil {
            if visible.isEmpty {
                ContentUnavailableView("Brak pojazdów", systemImage: "car",
                                       description: Text(!search.isEmpty || status != "all" || category != "all" ? "Nie znaleziono pojazdów spełniających kryteria" : "Dodaj pierwszy pojazd do floty"))
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if mode == .cards {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280, maximum: 420), spacing: 14)], spacing: 14) {
                    ForEach(visible) { vehicle in FleetVehicleTile(vehicle: vehicle, canManage: canManage, actions: actions) }
                }
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        Text("Pojazd").frame(maxWidth: .infinity, alignment: .leading)
                        Text("Rejestracja").frame(width: 120, alignment: .leading)
                        Text("Przebieg").frame(width: 110, alignment: .trailing)
                        Text("Przypisany").frame(width: 170, alignment: .leading)
                        Text("Status").frame(width: 150, alignment: .leading)
                        Text("Alerty").frame(width: 110, alignment: .leading)
                        Text("").frame(width: 40)
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    Divider()
                    ForEach(visible) { vehicle in
                        FleetVehicleLine(vehicle: vehicle, canManage: canManage, actions: actions)
                        Divider().opacity(0.4)
                    }
                }
                .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

// MARK: Kafelek pojazdu (galeria, dane, użytkowanie, alerty, szybkie tankowanie)

@MainActor struct FleetVehicleTile: View {
    let vehicle: FleetVehicleRow
    let canManage: Bool
    let actions: FleetRowActions
    @Environment(\.crmTheme) private var theme
    @State private var index = 0
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            gallery
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(vehicle.name).font(.headline).lineLimit(1)
                        Text(vehicle.subtitle).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: vehicle.vehicleType == "trailer" ? "rectangle.portrait.and.arrow.forward" : vehicle.category == "truck" ? "truck.box" : "car")
                        .foregroundStyle(theme.accent).help(vehicle.categoryLabel)
                }
                VStack(alignment: .leading, spacing: 4) {
                    row("Rejestracja:", vehicle.registration.nonEmpty ?? "-")
                    row("Przebieg:", FleetFormat.km(vehicle.mileage))
                    if let assigned = vehicle.assigned {
                        Label(assigned.name, systemImage: "person").font(.callout).foregroundStyle(.secondary)
                    }
                    if vehicle.inUse && !vehicle.inUseBy.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "waveform.path.ecg")
                            Text(vehicle.inUseBy).fontWeight(.medium)
                            if !vehicle.inUseEvent.isEmpty { Text("• \(vehicle.inUseEvent)").foregroundStyle(.secondary).lineLimit(1) }
                        }
                        .font(.caption).foregroundStyle(theme.accent)
                        .padding(6).frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                FleetAlertChips(alerts: vehicle.alerts)
                if canManage {
                    Button { actions.fuel(vehicle) } label: { Label("Dodaj tankowanie", systemImage: "fuelpump").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                }
                HStack(spacing: 8) {
                    Button { actions.open(vehicle) } label: { Label("Szczegóły", systemImage: "eye").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    if canManage {
                        Button { actions.edit(vehicle) } label: { Image(systemName: "pencil") }.buttonStyle(.bordered).help("Edytuj")
                        Button(role: .destructive) { actions.remove(vehicle) } label: { Image(systemName: "trash") }.buttonStyle(.bordered).help("Usuń")
                    }
                }
            }
            .padding(14)
        }
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(hover ? 0.35 : 0.1), lineWidth: 1))
        .onHover { hover = $0 }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture(count: 2) { actions.open(vehicle) }
        .contextMenu { FleetRowMenu(vehicle: vehicle, canManage: canManage, actions: actions) }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.medium).monospacedDigit()
        }
        .font(.callout)
    }

    private var gallery: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if vehicle.images.isEmpty {
                    ZStack {
                        Color.primary.opacity(0.05)
                        Image(systemName: vehicle.vehicleType == "trailer" ? "rectangle.portrait.and.arrow.forward" : "car").font(.system(size: 44)).foregroundStyle(theme.accent.opacity(0.4))
                    }
                } else {
                    CachedRemoteImage(url: vehicle.images[min(index, vehicle.images.count - 1)], crop: nil)
                }
            }
            .frame(height: 170).frame(maxWidth: .infinity).clipped()
            .contentShape(Rectangle())
            .onTapGesture { actions.open(vehicle) }
            FleetStatusBadge(status: vehicle.status, label: vehicle.statusLabel, inUse: vehicle.inUse).padding(10)
            if vehicle.images.count > 1 {
                HStack {
                    if index > 0 { arrow("chevron.left") { index -= 1 } }
                    Spacer()
                    if index < vehicle.images.count - 1 { arrow("chevron.right") { index += 1 } }
                }
                .padding(.horizontal, 8).frame(height: 170)
                HStack(spacing: 4) {
                    ForEach(0..<vehicle.images.count, id: \.self) { dot in
                        Circle().fill(dot == index ? Color.white : Color.white.opacity(0.45)).frame(width: 6, height: 6)
                    }
                }
                .frame(maxWidth: .infinity).padding(.top, 152)
            }
        }
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
    }

    private func arrow(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.caption.weight(.bold)).padding(7).background(.black.opacity(0.5), in: Circle()).foregroundStyle(.white)
        }
        .buttonStyle(.plain)
    }
}

/// Wiersz widoku „Lista” (kolumny jak tabela CRM).
@MainActor struct FleetVehicleLine: View {
    let vehicle: FleetVehicleRow
    let canManage: Bool
    let actions: FleetRowActions
    @State private var hover = false
    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                WarehouseThumb(url: vehicle.thumb, size: 40, symbol: "car")
                VStack(alignment: .leading, spacing: 1) {
                    Text(vehicle.name).fontWeight(.medium).lineLimit(1)
                    Text([vehicle.brand, vehicle.model].filter { !$0.isEmpty }.joined(separator: " ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(vehicle.registration.nonEmpty ?? "-").frame(width: 120, alignment: .leading)
            Text(FleetFormat.km(vehicle.mileage)).monospacedDigit().frame(width: 110, alignment: .trailing)
            Group {
                if vehicle.inUse, let driver = vehicle.driver {
                    HStack(spacing: 6) {
                        EmployeeAvatarView(name: driver.name, url: driver.avatarUrl, crop: driver.avatar, size: 24)
                        Text(driver.name).lineLimit(1)
                    }
                } else {
                    Text("—").foregroundStyle(.tertiary)
                }
            }
            .frame(width: 170, alignment: .leading)
            FleetStatusBadge(status: vehicle.status, label: vehicle.statusLabel, inUse: vehicle.inUse).frame(width: 150, alignment: .leading)
            FleetAlertChips(alerts: vehicle.alerts).frame(width: 110, alignment: .leading)
            Menu { FleetRowMenu(vehicle: vehicle, canManage: canManage, actions: actions) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 40)
        }
        .font(.callout)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(hover ? Color.primary.opacity(0.04) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture(count: 2) { actions.open(vehicle) }
        .contextMenu { FleetRowMenu(vehicle: vehicle, canManage: canManage, actions: actions) }
    }
}

@MainActor struct FleetRowMenu: View {
    let vehicle: FleetVehicleRow
    let canManage: Bool
    let actions: FleetRowActions
    var body: some View {
        Button("Szczegóły", systemImage: "eye") { actions.open(vehicle) }
        if canManage {
            Button("Dodaj tankowanie", systemImage: "fuelpump") { actions.fuel(vehicle) }
            Button("Edytuj", systemImage: "pencil") { actions.edit(vehicle) }
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { actions.remove(vehicle) }
        }
    }
}

/// Alerty przeglądu i ubezpieczenia (`upcoming_services`, `expiring_insurance`).
struct FleetAlertChips: View {
    let alerts: FleetVehicleRow.Alerts
    var body: some View {
        HStack(spacing: 6) {
            if alerts.inspection > 0 {
                Label("\(alerts.inspection) przegląd\(alerts.inspection > 1 ? "y" : "")", systemImage: "wrench.and.screwdriver")
                    .foregroundStyle(CrmTheme.rgb(0xfb923c))
            }
            if alerts.insurance > 0 {
                Label("Ubezp.", systemImage: "shield").foregroundStyle(CrmTheme.rgb(0xf87171))
            }
        }
        .font(.caption.weight(.medium))
    }
}
