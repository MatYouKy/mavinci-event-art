import SwiftUI
import AppKit

// MARK: Logistyka (1:1 z `EventLogisticsPanel`): podsumowanie (pojazdy, dystans, koszt, zadania), transport z kierowcami,
// przyczepkami, konfliktami i odbiorem/zdaniem pojazdu, harmonogram logistyczny; okno pojazdu (`AddEventVehicleModal`)
// z kierowcami według uprawnień, konfliktami rezerwacji i kalkulatorem trasy i paliwa (`VehicleTravelCalculator`).

struct LogisticsTabData: Decodable {
    struct Person: Decodable, Hashable { var id: String; var name: String; var avatarUrl: String?; var avatar: AvatarCrop? }
    struct Vehicle: Decodable, Identifiable, Hashable {
        var id: String
        var vehicleId: String?
        var name: String?
        var registration: String?
        var fuelType: String?
        var thumbnail: String?
        var isExternal: Bool
        var externalCompany: String?
        var role: String
        var driverId: String?
        var driver: Person?
        var status: String
        var departure: String?
        var distance: Double
        var fuelCost: Double
        var tollCost: Double
        var rentalCost: Double
        var trailerRentalCost: Double
        var conflicts: Int
        var addedFromPhase: Bool
        var inUse: Bool
        var hasTrailer: Bool
        var trailerExternal: Bool
        var trailerName: String?
        var trailerRegistration: String?
        var externalTrailerName: String?
        var externalTrailerCompany: String?
        var externalTrailerReturnLocation: String?
        var title: String { isExternal ? (externalCompany?.nonEmpty ?? "Zewnętrzny") : (name?.nonEmpty ?? "Pojazd") }
    }
    struct Activity: Decodable, Identifiable, Hashable {
        var id: String
        var type: String
        var title: String
        var description: String?
        var start: String?
        var duration: Double?
        var responsible: String?
        var crew: Double
        var status: String
    }
    var canManage: Bool
    var employeeId: String
    var eventDate: String?
    var eventLocation: String
    var hasLocation: Bool
    var vehicles: [Vehicle]
    var timeline: [Activity]
}

enum LogisticsLabels {
    static func status(_ status: String) -> (String, Color) {
        switch status {
        case "planned": return ("Planowane", .blue)
        case "in_transit": return ("W drodze", .yellow)
        case "arrived": return ("Dotarło", .green)
        case "returning": return ("Powrót", .orange)
        case "completed": return ("Zakończone", .green)
        case "in_progress": return ("W trakcie", .yellow)
        case "delayed": return ("Opóźnione", .red)
        case "cancelled": return ("Anulowane", .red)
        default: return ("Oczekuje", .gray)
        }
    }
    static func role(_ role: String) -> String {
        role == "transport_equipment" ? "Transport sprzętu" : role == "transport_crew" ? "Transport ekipy" : "Wsparcie"
    }
    static func activity(_ type: String) -> (String, Color) {
        switch type {
        case "loading": return ("Załadunek", .blue)
        case "unloading": return ("Rozładunek", .purple)
        case "setup": return ("Montaż/Setup", .green)
        case "rehearsal": return ("Próba", .yellow)
        case "event": return ("Wydarzenie", .red)
        case "breakdown": return ("Demontaż", .orange)
        case "packing": return ("Pakowanie", .cyan)
        default: return (type.isEmpty ? "Zadanie" : type.replacingOccurrences(of: "_", with: " ").capitalized, .gray)
        }
    }
    static func time(_ iso: String?) -> String? {
        guard let iso, let date = MeetingDates.parse(iso) else { return nil }
        var calendar = MeetingDates.calendar
        calendar.timeZone = MeetingDates.zone
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
    static func money(_ value: Double) -> String { String(format: "%.0f", value) + " zł" }
}

@MainActor struct EventLogisticsTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var expanded = "vehicles"
    @State private var vehicleSheet: VehicleSheetRequest?
    @State private var handover: LogisticsTabData.Vehicle?
    @State private var deleting: LogisticsTabData.Vehicle?

    struct VehicleSheetRequest: Identifiable { let id = UUID(); var editingID: String? }

    private var data: LogisticsTabData? { store.tab(eventID, "logistics", as: LogisticsTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|logistics"] {
                ContentUnavailableView {
                    Label("Nie udało się odświeżyć logistyki.", systemImage: "truck.box")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "logistics") } } }
            } else {
                ProgressView("Ładowanie danych logistycznych...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "logistics") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "logistics") } }
        .sheet(item: $vehicleSheet) { request in
            if let data {
                EventVehicleSheet(store: store, eventID: eventID, editingID: request.editingID, eventDate: data.eventDate, eventLocation: data.eventLocation)
                    .warehouseSheetStyle(state)
            }
        }
        .sheet(item: $handover) { vehicle in VehicleHandoverSheet(store: store, eventID: eventID, vehicle: vehicle).warehouseSheetStyle(state) }
        .confirmationDialog("Usuń pojazd", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let vehicle = deleting { Task { await delete(vehicle) } } }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: { Text("Czy na pewno chcesz usunąć ten pojazd z wydarzenia?") }
    }

    private func content(_ data: LogisticsTabData) -> some View {
        let distance = data.vehicles.reduce(0) { $0 + $1.distance }
        let cost = data.vehicles.reduce(0) { $0 + $1.fuelCost + $1.tollCost }
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                EventArrangementsBanner(store: store, eventID: eventID, area: .logistics)
                if store.tabLoading.contains("\(eventID)|logistics") {
                    Text("Aktualizowanie danych logistycznych…").font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    summary("Pojazdy", "truck.box", "\(data.vehicles.count)")
                    summary("Dystans", "location.north.line", String(format: "%.0f km", distance))
                    summary("Koszt transportu", "dollarsign.circle", LogisticsLabels.money(cost))
                    summary("Zadania", "clock", "\(data.timeline.count)")
                }
                vehiclesSection(data)
                timelineSection(data)
            }
            .padding(18)
        }
    }

    private func summary(_ title: String, _ symbol: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Image(systemName: symbol).foregroundStyle(theme.accent)
            }
            Text(value).font(.title2.weight(.light).monospacedDigit())
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func sectionHeader(_ key: String, _ title: String, _ symbol: String, _ count: Int, add: (() -> Void)?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(theme.accent)
            Text(title).font(.headline)
            Text("(\(count))").foregroundStyle(.secondary)
            Spacer()
            if let add { Button { add() } label: { Label("Dodaj pojazd", systemImage: "plus") }.buttonStyle(.borderedProminent).controlSize(.small) }
            Button { expanded = expanded == key ? "" : key } label: { Image(systemName: expanded == key ? "chevron.up" : "chevron.down") }
                .buttonStyle(.borderless)
        }
    }

    private func vehiclesSection(_ data: LogisticsTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("vehicles", "Transport", "truck.box", data.vehicles.count, add: data.canManage ? { vehicleSheet = VehicleSheetRequest(editingID: nil) } : nil)
            if expanded == "vehicles" {
                if data.vehicles.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "truck.box").font(.largeTitle).foregroundStyle(.tertiary)
                        Text("Brak przypisanych pojazdów").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
                } else {
                    VStack(spacing: 0) {
                        FinanceListHeader(columns: [("", 36, .center), ("Pojazd", nil, .leading), ("Kierowca", 150, .leading), ("Wyjazd", 110, .leading),
                                                    ("Dystans", 64, .trailing), ("Koszt szac.", 96, .trailing), ("Status", 120, .leading), ("", 28, .center)])
                        ForEach(Array(data.vehicles.enumerated()), id: \.element.id) { item in vehicleRow(item.element, data, item.offset) }
                    }
                }
            }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    /// Wiersz pojazdu jak w natywnej tabeli: miniatura, pojazd (rola, przyczepka, oznaczenia w drugiej linii), kierowca, wyjazd, dystans,
    /// koszt i status (kropka); konflikt — czerwona etykieta. Edycja i usuwanie w „…” i pod prawym przyciskiem.
    private func vehicleRow(_ vehicle: LogisticsTabData.Vehicle, _ data: LogisticsTabData, _ index: Int) -> some View {
        let status = LogisticsLabels.status(vehicle.status)
        let total = vehicle.fuelCost + vehicle.tollCost + vehicle.rentalCost + vehicle.trailerRentalCost
        var tags: [String] = [LogisticsLabels.role(vehicle.role)]
        if vehicle.isExternal { tags.append("zewnętrzny") }
        if vehicle.addedFromPhase { tags.append("z fazy") }
        if vehicle.inUse { tags.append("w użytkowaniu") }
        if vehicle.hasTrailer {
            let trailerName: String = vehicle.trailerExternal ? (vehicle.externalTrailerName?.nonEmpty ?? "zewnętrzna") : (vehicle.trailerName?.nonEmpty ?? "-")
            tags.append("przyczepka: " + trailerName)
        }
        let subtitle = tags.joined(separator: " · ")
        return HStack(spacing: 10) {
            WarehouseThumb(url: vehicle.thumbnail, size: 30, symbol: "truck.box").frame(width: 36)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(vehicle.title).fontWeight(.medium).lineLimit(1)
                    if !vehicle.isExternal, let registration = vehicle.registration?.nonEmpty {
                        Text(registration).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(vehicle.hasTrailer ? trailerHelp(vehicle) : subtitle)
            driver(vehicle).lineLimit(1).frame(width: 150, alignment: .leading)
            Text(LogisticsLabels.time(vehicle.departure) ?? "—").monospacedDigit().foregroundStyle(.secondary).lineLimit(1).frame(width: 110, alignment: .leading)
            Text(String(format: "%.0f km", vehicle.distance)).monospacedDigit().foregroundStyle(.secondary).frame(width: 64, alignment: .trailing)
            Text(LogisticsLabels.money(total)).monospacedDigit().frame(width: 96, alignment: .trailing)
            Group {
                if vehicle.conflicts > 0 {
                    Label("Konflikt", systemImage: "exclamationmark.circle.fill").font(.caption.weight(.semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2).background(Color.red, in: Capsule())
                } else {
                    EventDotLabel(label: status.0, color: status.1)
                }
            }
            .frame(width: 120, alignment: .leading)
            Menu { vehicleMenu(vehicle, data) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().frame(width: 28)
        }
        .font(.callout)
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(index % 2 == 0 ? Color.primary.opacity(0.035) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if data.canManage { vehicleSheet = VehicleSheetRequest(editingID: vehicle.id) } }
        .contextMenu { vehicleMenu(vehicle, data) }
    }

    @ViewBuilder private func vehicleMenu(_ vehicle: LogisticsTabData.Vehicle, _ data: LogisticsTabData) -> some View {
        if vehicle.driverId == data.employeeId {
            Button(vehicle.inUse ? "Zdaj pojazd" : "Odbierz pojazd", systemImage: "gauge") { handover = vehicle }
            Divider()
        }
        if !vehicle.isExternal, let id = vehicle.vehicleId {
            Button("Karta pojazdu (w CRM)", systemImage: "arrow.up.right.square") { state.openCRM("/crm/fleet/\(id)") }
        }
        if data.canManage {
            Button("Edytuj pojazd", systemImage: "pencil") { vehicleSheet = VehicleSheetRequest(editingID: vehicle.id) }
            Divider()
            Button("Usuń pojazd", systemImage: "trash", role: .destructive) { deleting = vehicle }
        }
    }

    private func trailerHelp(_ vehicle: LogisticsTabData.Vehicle) -> String {
        if vehicle.trailerExternal {
            return ["Przyczepka zewnętrzna: " + (vehicle.externalTrailerName?.nonEmpty ?? "-"),
                    "Firma: " + (vehicle.externalTrailerCompany?.nonEmpty ?? "-"),
                    "Koszt wynajmu: " + LogisticsLabels.money(vehicle.trailerRentalCost),
                    "Miejsce zwrotu: " + (vehicle.externalTrailerReturnLocation?.nonEmpty ?? "-")].joined(separator: "\n")
        }
        return "Przyczepka: " + (vehicle.trailerName?.nonEmpty ?? "-") + " · " + (vehicle.trailerRegistration?.nonEmpty ?? "-")
    }

    private func detail<Value: View>(_ title: String, @ViewBuilder _ value: () -> Value) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            value().font(.callout)
        }
    }

    @ViewBuilder private func driver(_ vehicle: LogisticsTabData.Vehicle) -> some View {
        if vehicle.driverId != nil {
            HStack(spacing: 5) {
                EmployeeAvatarView(name: vehicle.driver?.name ?? "Przypisany pracownik", url: vehicle.driver?.avatarUrl, crop: vehicle.driver?.avatar, size: 18)
                Text(vehicle.driver?.name ?? "Przypisany pracownik")
            }
        } else {
            Text("Nie przypisano kierowcy").foregroundStyle(.secondary)
        }
    }

    private func trailer(_ vehicle: LogisticsTabData.Vehicle) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Przyczepka", systemImage: "shippingbox").font(.callout.weight(.medium))
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 4) {
                GridRow {
                    if vehicle.trailerExternal {
                        detail("Nazwa:") { Text(vehicle.externalTrailerName?.nonEmpty ?? "-") }
                        detail("Firma:") { Text(vehicle.externalTrailerCompany?.nonEmpty ?? "-") }
                        detail("Koszt wynajmu:") { Text(LogisticsLabels.money(vehicle.trailerRentalCost)) }
                        detail("Miejsce zwrotu:") { Text(vehicle.externalTrailerReturnLocation?.nonEmpty ?? "-") }
                    } else {
                        detail("Nazwa:") { Text(vehicle.trailerName?.nonEmpty ?? "-") }
                        detail("Rejestracja:") { Text(vehicle.trailerRegistration?.nonEmpty ?? "-") }
                    }
                }
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.semibold)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2).background(color.opacity(0.15), in: Capsule())
    }

    private func timelineSection(_ data: LogisticsTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("timeline", "Harmonogram logistyczny", "clock", data.timeline.count, add: nil)
            if expanded == "timeline" {
                if data.timeline.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "clock").font(.largeTitle).foregroundStyle(.tertiary)
                        Text("Brak zadań w harmonogramie").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
                } else {
                    VStack(spacing: 0) {
                        FinanceListHeader(columns: [("Start", 110, .leading), ("Zadanie", nil, .leading), ("Rodzaj", 120, .leading), ("Czas", 64, .trailing),
                                                    ("Odpowiedzialny", 150, .leading), ("Ekipa", 50, .trailing), ("Status", 120, .leading)])
                        ForEach(Array(data.timeline.enumerated()), id: \.element.id) { item in activityRow(item.element, item.offset) }
                    }
                }
            }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    /// Wiersz harmonogramu logistycznego jak w natywnej tabeli; opis w podpowiedzi.
    private func activityRow(_ activity: LogisticsTabData.Activity, _ index: Int) -> some View {
        let type = LogisticsLabels.activity(activity.type)
        let status = LogisticsLabels.status(activity.status)
        let duration: String = activity.duration.map { $0 > 0 ? "\(Int($0)) min" : "—" } ?? "—"
        return HStack(spacing: 10) {
            Text(LogisticsLabels.time(activity.start) ?? "—").monospacedDigit().foregroundStyle(.secondary).lineLimit(1).frame(width: 110, alignment: .leading)
            Text(activity.title).fontWeight(.medium).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                .help(activity.description?.nonEmpty ?? activity.title)
            EventDotLabel(label: type.0, color: type.1).frame(width: 120, alignment: .leading)
            Text(duration).monospacedDigit().foregroundStyle(.secondary).frame(width: 64, alignment: .trailing)
            Text(activity.responsible?.nonEmpty ?? "—").lineLimit(1).foregroundStyle(.secondary).frame(width: 150, alignment: .leading)
            Text("\(Int(activity.crew))").monospacedDigit().foregroundStyle(.secondary).frame(width: 50, alignment: .trailing)
            EventDotLabel(label: status.0, color: status.1).frame(width: 120, alignment: .leading)
        }
        .font(.callout)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(index % 2 == 0 ? Color.primary.opacity(0.035) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
    }

    private func delete(_ vehicle: LogisticsTabData.Vehicle) async {
        deleting = nil
        do {
            try await store.tabAction(eventID, "logistics", "deleteVehicle", ["rowId": .string(vehicle.id)], reload: ["logistics", "phases"],
                                      success: "Pojazd został usunięty", pending: "Usuwanie pojazdu…")
        } catch {
            state.error = store.failureText(error, "Błąd podczas usuwania pojazdu")
        }
    }
}

// MARK: Plan przejazdu (`travelPlan.ts`)

struct TravelLeg: Codable, Hashable {
    var baseMinutes: Int
    var bufferMinutes: Int
    var breakMinutes: Int
    var plannedMinutes: Int
    /// `planTravelLeg`: zapas 20% (min. 15 min, co 5 min), 15 min przerwy po każdych 2 h jazdy, całość do 15 min w górę.
    static func plan(seconds: Double) -> TravelLeg {
        let base = Int(ceil(seconds / 60))
        let buffer = max(15, Int(ceil(Double(base) * 0.2 / 5)) * 5)
        let breaks = ((base - 1) / 120) * 15
        return TravelLeg(baseMinutes: base, bufferMinutes: buffer, breakMinutes: breaks, plannedMinutes: 0).recalculated
    }
    var recalculated: TravelLeg {
        var copy = self
        copy.plannedMinutes = Int(ceil(Double(baseMinutes + bufferMinutes + breakMinutes) / 15)) * 15
        return copy
    }
}

struct TravelPlan: Codable, Hashable {
    var origin: String
    var destination: String
    var calculatedAt: String
    var outbound: TravelLeg
    var inbound: TravelLeg?
    var json: JSONValue {
        func leg(_ l: TravelLeg) -> JSONValue {
            .object(["baseMinutes": .number(Double(l.baseMinutes)), "bufferMinutes": .number(Double(l.bufferMinutes)),
                     "breakMinutes": .number(Double(l.breakMinutes)), "plannedMinutes": .number(Double(l.plannedMinutes))])
        }
        return .object(["origin": .string(origin), "destination": .string(destination), "calculatedAt": .string(calculatedAt),
                        "outbound": leg(outbound), "inbound": inbound.map(leg) ?? .null])
    }
}

private struct VehicleFormData: Decodable {
    struct Option: Decodable, Identifiable, Hashable {
        var id: String; var name: String; var registration: String; var brand: String; var model: String; var fuelType: String?; var towHitch: Bool
    }
    struct Editing: Decodable {
        var isExternal: Bool
        var vehicleId: String
        var externalCompany: String
        var externalVehicleName: String
        var externalRentalCost: String
        var role: String
        var driverId: String
        var departureLocation: String?
        var loadingMinutes: Int
        var unloadingMinutes: Int
        var preparationMinutes: Int
        var travelMinutes: Int
        var travelPlan: TravelPlan?
        var distance: String
        var fuelCost: String
        var tollCost: String
        var notes: String
        var hasTrailer: Bool
        var trailerId: String
        var trailerExternal: Bool
        var externalTrailerName: String
        var externalTrailerCompany: String
        var externalTrailerCost: String
        var externalTrailerReturnDate: String?
        var externalTrailerReturnLocation: String
        var externalTrailerNotes: String
        var pickup: String?
        var returnAt: String?
    }
    var vehicles: [Option]
    var trailers: [Option]
    var editing: Editing?
}

private struct DriversReply: Decodable {
    struct Driver: Decodable, Identifiable, Hashable { var id: String; var name: String }
    var state: String
    var drivers: [Driver]
    var message: String
}
private struct VehicleConflictsReply: Decodable {
    struct Conflict: Decodable, Hashable { var eventId: String; var name: String; var date: String?; var location: String }
    var conflicts: [Conflict]
}
private struct ConsumptionReply: Decodable { var value: Double?; var source: String?; var error: String? }
private struct FuelQuote: Decodable { var prices: [String: Double]; var source: String; var sourceUpdated: String; var fetchedAt: String }
private struct RouteReply: Decodable {
    struct Leg: Decodable { var distanceMeters: Double; var durationSeconds: Double; var startAddress: String?; var endAddress: String? }
    var outbound: Leg
    var inbound: Leg?
    var distanceKm: Double
    var travelMinutes: Double
    var destination: String
}

private let defaultTravelOrigin = "Marcina Kasprzaka 15/66, Olsztyn, Polska"
private struct FuelOption: Identifiable { let id: String; let label: String }
private let fuelTypes: [FuelOption] = [FuelOption(id: "benzyna95", label: "Benzyna 95"), FuelOption(id: "benzyna98", label: "Benzyna 98"),
                                       FuelOption(id: "diesel", label: "Olej napędowy"), FuelOption(id: "LPG", label: "LPG")]

@MainActor struct EventVehicleSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let editingID: String?
    let eventDate: String?
    let eventLocation: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    @State private var form: VehicleFormData?
    @State private var loadError: String?
    @State private var isExternal = false
    @State private var vehicleID = ""
    @State private var externalCompany = ""
    @State private var externalVehicleName = ""
    @State private var externalRentalCost = ""
    @State private var role = "transport_equipment"
    @State private var driverID = ""
    @State private var origin = defaultTravelOrigin
    @State private var loadingMinutes = 60
    @State private var unloadingMinutes = 60
    @State private var preparationMinutes = 30
    @State private var travelMinutes = 60
    @State private var travelPlan: TravelPlan?
    @State private var distance = ""
    @State private var fuelCost = ""
    @State private var tollCost = ""
    @State private var notes = ""
    @State private var hasTrailer = false
    @State private var trailerID = ""
    @State private var trailerExternal = false
    @State private var trailerName = ""
    @State private var trailerCompany = ""
    @State private var trailerCost = ""
    @State private var trailerReturn: Date?
    @State private var trailerReturnLocation = ""
    @State private var trailerNotes = ""
    @State private var pickup: String?
    @State private var returnAt: String?
    @State private var drivers: DriversReply?
    @State private var checkingDrivers = false
    @State private var conflicts: [VehicleConflictsReply.Conflict] = []
    @State private var checkingConflicts = false
    @State private var saving = false
    // Kalkulator trasy
    @State private var roundTrip = true
    @State private var fuelOverride: String?
    @State private var manualConsumption: String?
    @State private var manualPrice: [String: String] = [:]
    @State private var consumptionInfo: ConsumptionReply?
    @State private var quote: FuelQuote?
    @State private var quoteError = ""
    @State private var priceLoading = false
    @State private var priceRefresh = 0
    @State private var routeLoading = false
    @State private var routeError = ""
    @State private var route: RouteReply?

    private var selectedVehicle: VehicleFormData.Option? { form?.vehicles.first { $0.id == vehicleID } }
    private var towHitch: Bool { selectedVehicle?.towHitch == true }
    private var fuelType: String { fuelOverride ?? (isExternal ? nil : selectedVehicle?.fuelType) ?? "diesel" }
    private var isLiquidFuel: Bool { fuelTypes.contains { $0.id == fuelType } }
    private var consumption: String { manualConsumption ?? consumptionInfo?.value.map { EquipmentQty.text($0) } ?? "" }
    private var price: String { manualPrice[fuelType] ?? quote?.prices[fuelType].map { String($0) } ?? "" }
    private var cost: Double? {
        guard isLiquidFuel, let km = Double(distance.replacingOccurrences(of: ",", with: ".")) else { return nil }
        return Self.fuelCost(km, Double(consumption.replacingOccurrences(of: ",", with: ".")) ?? 0, Double(price.replacingOccurrences(of: ",", with: ".")) ?? 0)
    }
    private var completePeriod: Bool {
        guard let pickup, let returnAt, let a = MeetingDates.parse(pickup), let b = MeetingDates.parse(returnAt) else { return false }
        return b > a
    }

    /// `calculateFuelCost`.
    static func fuelCost(_ distance: Double, _ consumption: Double, _ price: Double) -> Double? {
        guard distance.isFinite, consumption.isFinite, price.isFinite, distance >= 0, consumption > 0, price > 0 else { return nil }
        return ((distance / 100) * consumption * price * 100).rounded() / 100
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label(editingID != nil ? "Edytuj pojazd" : "Dodaj pojazd do wydarzenia", systemImage: "truck.box").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(saving)
            }
            .padding(20)
            if form != nil {
                ScrollView { fields.padding(.horizontal, 20).padding(.bottom, 12) }
                HStack {
                    Spacer()
                    Button("Anuluj") { dismiss() }.disabled(saving)
                    Button(saving ? "Zapisywanie..." : editingID != nil ? "Zapisz pojazd" : "Dodaj pojazd") { Task { await save() } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                        .disabled(saving || checkingConflicts || checkingDrivers || routeLoading)
                }
                .padding(20)
            } else if let loadError {
                ContentUnavailableView("Błąd podczas ładowania danych pojazdu", systemImage: "truck.box", description: Text(loadError))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 720, height: 760)
        .task { await load() }
        .task(id: driverKey) { await checkDrivers() }
        .task(id: conflictKey) { await checkConflicts() }
        .task(id: vehicleID) { await loadConsumption() }
        .task(id: priceRefresh) { await loadQuote() }
        .onChange(of: towHitch) { _, has in if !has && !isExternal { hasTrailer = false; trailerID = ""; trailerExternal = false } }
    }

    // MARK: Pola formularza

    private var fields: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Typ pojazdu", selection: $isExternal) {
                Text("Pojazd z floty").tag(false)
                Text("Pojazd zewnętrzny (wypożyczony)").tag(true)
            }
            .pickerStyle(.radioGroup)
            if !isExternal {
                Picker("Wybierz pojazd *", selection: $vehicleID) {
                    Text("Wybierz pojazd...").tag("")
                    ForEach(form?.vehicles ?? []) { v in Text("\(v.name) (\(v.registration)) - \(v.brand) \(v.model)").tag(v.id) }
                }
            } else {
                TextField("Nazwa firmy wypożyczającej * (np. Rent-a-Car)", text: $externalCompany)
                TextField("Nazwa pojazdu * (np. Mercedes Sprinter)", text: $externalVehicleName)
                TextField("Koszt wypożyczenia (zł)", text: $externalRentalCost)
            }
            if !isExternal && !conflicts.isEmpty { conflictsBox }
            HStack(alignment: .top, spacing: 14) {
                Picker("Rola pojazdu *", selection: $role) {
                    Text("Transport sprzętu").tag("transport_equipment")
                    Text("Transport ekipy").tag("transport_crew")
                    Text("Wsparcie").tag("support")
                }
                driverPicker
            }
            if !isExternal && towHitch { trailerBox }
            HStack(spacing: 4) {
                Text("Tutaj obliczysz czas i koszt trasy. Godzinę rozpoczęcia dojazdu i powrotu ustawisz w Timeline — zakończenie wyliczy się z czasu jazdy, zapasu i przerw.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            travelCalculator
            HStack(spacing: 12) {
                labeled("Łączny dystans (km)") { TextField("0", text: $distance) }
                labeled("Koszt paliwa (zł)") { TextField("0.00", text: $fuelCost) }
                labeled("Koszt autostrad (zł)") { TextField("0.00", text: $tollCost) }
            }
            labeled("Notatki") {
                TextField("Dodatkowe informacje...", text: $notes, axis: .vertical).lineLimit(3...6)
            }
        }
        .textFieldStyle(.roundedBorder)
        .disabled(saving)
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var driverPicker: some View {
        let options = drivers?.drivers ?? []
        let waiting = isExternal || vehicleID.isEmpty || (hasTrailer && !trailerExternal && trailerID.isEmpty)
        let disabled = waiting || checkingDrivers || drivers?.state == "error" || options.isEmpty
        let placeholder: String = checkingDrivers ? "Sprawdzanie kierowców…" : drivers?.state == "error" ? "Nie udało się sprawdzić kierowców"
            : waiting ? "Uzupełnij dane do sprawdzenia" : options.isEmpty ? (drivers?.state == "preview" ? "Brak ważnych wymaganych kategorii" : "Brak dostępnych kierowców w terminie")
            : "Wyszukaj kierowcę…"
        return VStack(alignment: .leading, spacing: 4) {
            Text(!isExternal && !vehicleID.isEmpty ? "Kierowca (tylko z wymaganymi prawami jazdy)" : "Kierowca").font(.caption).foregroundStyle(.secondary)
            Picker("", selection: $driverID) {
                Text(placeholder).tag("")
                ForEach(options) { Text($0.name).tag($0.id) }
            }
            .labelsHidden().disabled(disabled)
            Text(waitingMessage ?? drivers?.message ?? "").font(.caption2).foregroundStyle(drivers?.state == "error" ? Color.red : Color.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var waitingMessage: String? {
        if isExternal { return "Kierowcę pojazdu zewnętrznego ustal z wypożyczalnią." }
        if hasTrailer && !trailerExternal && trailerID.isEmpty && !vehicleID.isEmpty { return "Wybierz przyczepę, aby uwzględnić również jej wymagane kategorie." }
        if vehicleID.isEmpty { return "Najpierw wybierz pojazd. Pokażemy pracowników z wymaganymi kategoriami." }
        return nil
    }

    private var conflictsBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("⚠️ Konflikty rezerwacji", systemImage: "exclamationmark.triangle").font(.callout.weight(.semibold)).foregroundStyle(.red)
            Text("Ten pojazd jest już zarezerwowany na inne wydarzenia w tym samym czasie:").font(.caption)
            ForEach(Array(conflicts.enumerated()), id: \.offset) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.element.name).font(.callout.weight(.medium))
                        if let date = item.element.date, let parsed = MeetingDates.parse(date) {
                            Text(parsed.formatted(date: .numeric, time: .shortened)).font(.caption)
                        }
                        if !item.element.location.isEmpty { Text(item.element.location).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button("Zobacz") { state.showEvent(item.element.eventId) }.controlSize(.small)
                }
            }
        }
        .padding(10).background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private var trailerBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Pojazd z przyczepką", isOn: $hasTrailer)
            if hasTrailer {
                Picker("", selection: $trailerExternal) {
                    Text("Własna przyczepka").tag(false)
                    Text("Przyczepka wynajęta").tag(true)
                }
                .pickerStyle(.radioGroup).labelsHidden()
                if !trailerExternal {
                    Picker("Wybierz przyczepkę", selection: $trailerID) {
                        Text("Wybierz przyczepkę...").tag("")
                        ForEach(form?.trailers ?? []) { t in Text(t.registration.isEmpty ? t.name : "\(t.name) (\(t.registration))").tag(t.id) }
                    }
                } else {
                    TextField("Nazwa przyczepki (np. Przyczepka 3.5t)", text: $trailerName)
                    TextField("Firma wypożyczająca (np. Rent-a-Trailer Sp. z o.o.)", text: $trailerCompany)
                    HStack {
                        TextField("Koszt wynajmu (PLN)", text: $trailerCost)
                        Toggle("Termin zwrotu", isOn: Binding(get: { trailerReturn != nil }, set: { trailerReturn = $0 ? (trailerReturn ?? Date()) : nil }))
                        if trailerReturn != nil {
                            DatePicker("", selection: Binding(get: { trailerReturn ?? Date() }, set: { trailerReturn = $0 })).labelsHidden()
                        }
                    }
                    TextField("Miejsce zwrotu (np. Warszawa, ul. Przykładowa 123)", text: $trailerReturnLocation)
                    TextField("Dodatkowe informacje", text: $trailerNotes, axis: .vertical).lineLimit(2...4)
                }
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Kalkulator trasy i paliwa (`VehicleTravelCalculator`)

    private var travelCalculator: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trasa i koszt paliwa").font(.headline)
            if let plan = travelPlan { planEditor(plan) }
            labeled("Miejsce startu") {
                TextField("", text: Binding(get: { origin }, set: { origin = $0; travelPlan = nil; route = nil })).disabled(routeLoading)
            }
            Text("Cel z zakładki Przegląd: " + (eventLocation.isEmpty ? "Brak lokalizacji — uzupełnij ją w Przeglądzie." : eventLocation))
                .font(.caption).foregroundStyle(.secondary)
            Toggle("Uwzględnij powrót do miejsca startu", isOn: Binding(get: { roundTrip }, set: { roundTrip = $0; travelPlan = nil; route = nil }))
                .disabled(routeLoading)
            HStack(alignment: .top, spacing: 12) {
                labeled("Paliwo") {
                    Picker("", selection: Binding(get: { fuelType }, set: { fuelOverride = $0 })) {
                        ForEach(fuelTypes) { Text($0.label).tag($0.id) }
                        Text("Elektryczny").tag("elektryczny")
                        Text("Inne").tag("other")
                        if !isLiquidFuel && !["elektryczny", "other"].contains(fuelType) { Text(fuelType).tag(fuelType) }
                    }
                    .labelsHidden()
                }
                labeled("Średnie spalanie (l/100 km)") {
                    TextField("Uzupełnij spalanie", text: Binding(get: { consumption }, set: { manualConsumption = $0 })).disabled(!isLiquidFuel || routeLoading)
                }
                labeled("Cena paliwa (zł/l)") {
                    TextField(priceLoading ? "Pobieranie…" : "Uzupełnij cenę", text: Binding(get: { isLiquidFuel ? price : "" }, set: { manualPrice[fuelType] = $0 }))
                        .disabled(!isLiquidFuel || routeLoading)
                }
            }
            if isLiquidFuel {
                Text(consumptionText).font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(priceText).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Pobierz cenę") { manualPrice[fuelType] = nil; priceRefresh += 1 }.disabled(priceLoading || routeLoading).controlSize(.small)
                }
                if !quoteError.isEmpty { Text(quoteError).font(.caption).foregroundStyle(.orange) }
            } else {
                Text("Dla tego napędu uzupełnij koszt energii lub paliwa ręcznie w polu kosztu poniżej.").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Button(routeLoading ? "Obliczanie trasy…" : "Oblicz trasę i koszt") { Task { await calculateRoute() } }
                    .disabled(routeLoading || origin.trimmingCharacters(in: .whitespaces).isEmpty)
                if let cost {
                    Button("Zastosuj koszt: " + String(format: "%.2f", cost) + " zł") { fuelCost = String(format: "%.2f", cost) }.disabled(routeLoading)
                }
            }
            .controlSize(.small)
            if !routeError.isEmpty { Text(routeError).font(.callout).foregroundStyle(.red) }
            if let route, Double(distance.replacingOccurrences(of: ",", with: ".")) == route.distanceKm { routeSummary(route) }
            Text("Koszt = łączny dystans × spalanie / 100 × cena litra. Po korekcie spalania lub ceny kliknij „Zastosuj koszt”. Dystans i koszt zapiszesz razem z pojazdem.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private var consumptionText: String {
        if manualConsumption != nil { return "Spalanie zapisane dla tej kalkulacji lub wpisane ręcznie." }
        if consumptionInfo?.source == "vehicle" { return "Średnie spalanie z karty auta. Możesz je skorygować dla tego przejazdu, np. przy jeździe z przyczepą." }
        if consumptionInfo?.value != nil { return "Spalanie z tankowań z ostatnich 90 dni, ważone przejechanym dystansem. Możesz je skorygować, np. dla jazdy z przyczepą." }
        if let error = consumptionInfo?.error { return error }
        return "Uzupełnij średnie spalanie na karcie auta lub wpisz je dla tego przejazdu."
    }
    private var priceText: String {
        if manualPrice[fuelType] != nil { return "Cena wpisana ręcznie." }
        if let quote, quote.prices[fuelType] != nil {
            let fetched = MeetingDates.parse(quote.fetchedAt).map { $0.formatted(date: .numeric, time: .shortened) } ?? quote.fetchedAt
            return "Średnia krajowa: AutoCentrum.pl. Aktualizacja źródła: \(quote.sourceUpdated) w chwili pobrania (\(fetched))."
        }
        return priceLoading ? "Pobieranie cen paliw…" : "Brak ceny dla wybranego paliwa — wpisz ją ręcznie."
    }

    private func planEditor(_ plan: TravelPlan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Czas do harmonogramu: jazda z Google Maps + zapas + przerwy. Zapas: 20%, minimum 15 min. Przerwy: 15 min po każdych 2 h jazdy. Możesz zmienić plan poniżej.")
                .font(.caption)
            legEditor("Dojazd", plan.outbound) { leg in var next = plan; next.outbound = leg; apply(next) }
            if let inbound = plan.inbound {
                legEditor("Powrót", inbound) { leg in var next = plan; next.inbound = leg; apply(next) }
            }
            Text("Plan to zapas organizacyjny, nie gwarancja czasu przejazdu. Po przeliczeniu zapisz pojazd: istniejące fazy Dojazd i Powrót oraz powiązane godziny Załadunku, Rozładunku i rezerwacji auta zostaną zaktualizowane. Montaż i realizacja pozostają bez zmian. Przy kilku pojazdach wspólne fazy uwzględniają najdłuższy czas trasy.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(10).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    private func legEditor(_ title: String, _ leg: TravelLeg, _ change: @escaping (TravelLeg) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(title): \(leg.plannedMinutes) min · jazda \(leg.baseMinutes) min").font(.callout.weight(.medium))
            HStack(spacing: 12) {
                labeled("Zapas (min)") {
                    TextField("", value: Binding(get: { leg.bufferMinutes }, set: { value in
                        guard (0...1440).contains(value) else { return }
                        var next = leg; next.bufferMinutes = value; change(next.recalculated)
                    }), format: .number).disabled(routeLoading)
                }
                labeled("Przerwy (min)") {
                    TextField("", value: Binding(get: { leg.breakMinutes }, set: { value in
                        guard (0...1440).contains(value) else { return }
                        var next = leg; next.breakMinutes = value; change(next.recalculated)
                    }), format: .number).disabled(routeLoading)
                }
            }
        }
    }

    private func apply(_ plan: TravelPlan) {
        travelPlan = plan
        travelMinutes = plan.outbound.plannedMinutes
    }

    private func routeSummary(_ route: RouteReply) -> some View {
        let outboundKm = String(format: "%.1f", route.outbound.distanceMeters / 1000)
        var line = "Dojazd: \(outboundKm) km · \(Int(route.travelMinutes)) min"
        if let inbound = route.inbound {
            line += " · Powrót: " + String(format: "%.1f", inbound.distanceMeters / 1000) + " km · \(Int(ceil(inbound.durationSeconds / 60))) min"
        }
        line += " · Łącznie: " + String(format: "%.1f", route.distanceKm) + " km"
        let start = route.outbound.startAddress ?? origin
        let end = route.outbound.endAddress ?? route.destination
        return VStack(alignment: .leading, spacing: 3) {
            Text("\(start) → \(end)").font(.caption)
            Text(line).font(.caption)
            Button("Google Maps — zobacz dojazd") {
                var components = URLComponents(string: "https://www.google.com/maps/dir/")
                components?.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "origin", value: start),
                                          URLQueryItem(name: "destination", value: end), URLQueryItem(name: "travelmode", value: "driving")]
                if let url = components?.url { NSWorkspace.shared.open(url) }
            }
            .buttonStyle(.link).font(.caption)
        }
        .padding(8).background(Color.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Dane

    private var driverKey: String {
        "\(vehicleID)|\(isExternal)|\(hasTrailer)|\(trailerID)|\(trailerExternal)|\(pickup ?? "")|\(returnAt ?? "")|\(form != nil)"
    }
    private var conflictKey: String { "\(vehicleID)|\(isExternal)|\(pickup ?? "")|\(returnAt ?? "")" }

    private func load() async {
        do {
            let reply = try await store.tabQuery(eventID, "logistics", "vehicleForm", editingID.map { ["editingId": $0] } ?? [:], as: VehicleFormData.self)
            if let e = reply.editing {
                isExternal = e.isExternal; vehicleID = e.vehicleId; externalCompany = e.externalCompany; externalVehicleName = e.externalVehicleName
                externalRentalCost = e.externalRentalCost; role = e.role; driverID = e.driverId; origin = e.departureLocation ?? defaultTravelOrigin
                loadingMinutes = e.loadingMinutes; unloadingMinutes = e.unloadingMinutes; preparationMinutes = e.preparationMinutes
                travelMinutes = e.travelMinutes; travelPlan = e.travelPlan; distance = e.distance; fuelCost = e.fuelCost; tollCost = e.tollCost
                notes = e.notes; hasTrailer = e.hasTrailer; trailerID = e.trailerId; trailerExternal = e.trailerExternal
                trailerName = e.externalTrailerName; trailerCompany = e.externalTrailerCompany; trailerCost = e.externalTrailerCost
                trailerReturn = e.externalTrailerReturnDate.flatMap { MeetingDates.parse($0) }
                trailerReturnLocation = e.externalTrailerReturnLocation; trailerNotes = e.externalTrailerNotes
                pickup = e.pickup; returnAt = e.returnAt
            }
            form = reply
        } catch {
            loadError = store.failureText(error, "Błąd podczas ładowania danych pojazdu")
        }
    }

    private func checkDrivers() async {
        guard form != nil else { return }
        drivers = nil
        if waitingMessage != nil {
            checkingDrivers = false
            if isExternal || vehicleID.isEmpty { driverID = "" }
            return
        }
        checkingDrivers = true
        defer { checkingDrivers = false }
        var params = ["vehicleId": vehicleID, "externalTrailer": hasTrailer && trailerExternal ? "1" : "0"]
        if hasTrailer && !trailerExternal { params["trailerId"] = trailerID }
        if completePeriod, let pickup, let returnAt {
            params["start"] = pickup; params["end"] = returnAt
            if let editingID { params["excludeId"] = editingID }
        }
        do {
            let reply = try await store.tabQuery(eventID, "logistics", "drivers", params, as: DriversReply.self)
            guard !Task.isCancelled else { return }
            drivers = reply
            if reply.state != "error", !driverID.isEmpty, !reply.drivers.contains(where: { $0.id == driverID }) { driverID = "" }
        } catch {
            guard !Task.isCancelled else { return }
            drivers = DriversReply(state: "error", drivers: [], message: "Nie udało się sprawdzić kierowców. Odśwież listę — nie jest to informacja o braku uprawnień.")
        }
    }

    private func checkConflicts() async {
        guard !isExternal, !vehicleID.isEmpty, completePeriod, let pickup, let returnAt else { conflicts = []; return }
        checkingConflicts = true
        defer { checkingConflicts = false }
        let reply = try? await store.tabQuery(eventID, "logistics", "availability", ["vehicleId": vehicleID, "start": pickup, "end": returnAt], as: VehicleConflictsReply.self)
        conflicts = reply?.conflicts ?? []
    }

    private func loadConsumption() async {
        guard !vehicleID.isEmpty else { consumptionInfo = nil; return }
        consumptionInfo = try? await store.tabQuery(eventID, "logistics", "consumption", ["vehicleId": vehicleID], as: ConsumptionReply.self)
    }

    private func loadQuote() async {
        priceLoading = true
        quoteError = ""
        defer { priceLoading = false }
        do {
            quote = try await store.tabQuery(eventID, "logistics", "fuel", as: FuelQuote.self)
        } catch {
            quote = nil
            quoteError = store.failureText(error, "Wpisz cenę paliwa ręcznie.")
        }
    }

    private func calculateRoute() async {
        guard !routeLoading else { return }
        routeLoading = true
        routeError = ""
        defer { routeLoading = false }
        do {
            let reply = try await store.tabQuery(eventID, "logistics", "route", ["origin": origin, "roundTrip": roundTrip ? "1" : "0"], as: RouteReply.self)
            let plan = TravelPlan(origin: origin, destination: reply.destination, calculatedAt: MeetingDates.iso(Date()),
                                  outbound: TravelLeg.plan(seconds: reply.outbound.durationSeconds),
                                  inbound: reply.inbound.map { TravelLeg.plan(seconds: $0.durationSeconds) })
            route = reply
            distance = EquipmentQty.text(reply.distanceKm).replacingOccurrences(of: ",", with: ".")
            apply(plan)
            if isLiquidFuel {
                let computed = Self.fuelCost(reply.distanceKm, Double(consumption.replacingOccurrences(of: ",", with: ".")) ?? 0, Double(price.replacingOccurrences(of: ",", with: ".")) ?? 0)
                fuelCost = computed.map { String(format: "%.2f", $0) } ?? ""
            } else {
                fuelCost = ""
            }
        } catch {
            routeError = store.failureText(error, "Nie udało się obliczyć trasy.")
        }
    }

    private func save() async {
        guard !saving else { return }
        if !driverID.isEmpty, !(drivers?.drivers.contains { $0.id == driverID } ?? false) {
            state.error = "Wybierz dostępnego kierowcę z wymaganymi uprawnieniami."
            return
        }
        if !isExternal && vehicleID.isEmpty { state.error = "Wybierz pojazd."; return }
        if isExternal && (externalCompany.trimmingCharacters(in: .whitespaces).isEmpty || externalVehicleName.trimmingCharacters(in: .whitespaces).isEmpty) {
            state.error = "Uzupełnij nazwę firmy i pojazdu."
            return
        }
        saving = true
        defer { saving = false }
        let optional: (String?) -> JSONValue = { value in value.map { JSONValue.string($0) } ?? .null }
        let form: [String: JSONValue] = [
            "isExternal": .bool(isExternal), "vehicleId": .string(vehicleID), "externalCompany": .string(externalCompany),
            "externalRentalCost": .string(externalRentalCost), "role": .string(role), "driverId": .string(driverID),
            "departureLocation": .string(origin), "loadingMinutes": .number(Double(loadingMinutes)), "unloadingMinutes": .number(Double(unloadingMinutes)),
            "preparationMinutes": .number(Double(preparationMinutes)), "travelMinutes": .number(Double(travelMinutes)),
            "travelPlan": travelPlan?.json ?? .null, "distance": .string(distance.replacingOccurrences(of: ",", with: ".")),
            "fuelCost": .string(fuelCost.replacingOccurrences(of: ",", with: ".")), "tollCost": .string(tollCost.replacingOccurrences(of: ",", with: ".")),
            "notes": .string(notes), "hasTrailer": .bool(hasTrailer && !isExternal), "trailerId": .string(trailerID), "trailerExternal": .bool(trailerExternal),
            "externalTrailerName": .string(trailerName), "externalTrailerCompany": .string(trailerCompany),
            "externalTrailerCost": .string(trailerCost.replacingOccurrences(of: ",", with: ".")),
            "externalTrailerReturnDate": optional(trailerReturn.map { MeetingDates.iso($0) }),
            "externalTrailerReturnLocation": .string(trailerReturnLocation), "externalTrailerNotes": .string(trailerNotes),
            "pickup": optional(pickup), "returnAt": optional(returnAt),
        ]
        var body: [String: JSONValue] = ["form": .object(form)]
        if let editingID { body["editingId"] = .string(editingID) }
        do {
            let reply = try await store.tabAction(eventID, "logistics", "saveVehicle", body, reload: ["logistics", "phases"], success: nil, pending: "Zapisywanie danych pojazdu…")
            struct Reply: Decodable { var message: String? }
            state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? (editingID != nil ? "Pojazd został zaktualizowany" : "Pojazd został dodany do wydarzenia"))
            dismiss()
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać pojazdu. Spróbuj ponownie.")
        }
    }
}

// MARK: Odbiór / zdanie pojazdu (`VehicleHandoverModal`)

@MainActor struct VehicleHandoverSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let vehicle: LogisticsTabData.Vehicle
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var odometer = ""
    @State private var notes = ""
    @State private var last: Double?
    @State private var loadingLast = true
    @State private var saving = false

    private struct Last: Decodable { var value: Double? }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(vehicle.inUse ? "Zdaj pojazd" : "Odbierz pojazd").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            Text(vehicle.title + (vehicle.registration.map { " (\($0))" } ?? "")).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Stan licznika (km)").font(.callout)
                    Spacer()
                    if loadingLast { Text("Ładowanie...").font(.caption).foregroundStyle(.secondary) }
                    else if let last { Text("Ostatni: \(Int(last)) km").font(.caption).foregroundStyle(.secondary) }
                }
                TextField("", text: $odometer).textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Uwagi").font(.callout)
                TextField("Opcjonalne uwagi...", text: $notes, axis: .vertical).lineLimit(3...5).textFieldStyle(.roundedBorder)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button(saving ? "Zapisywanie..." : vehicle.inUse ? "Zdaj pojazd" : "Odbierz pojazd") { Task { await submit() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20).frame(width: 440)
        .task {
            defer { loadingLast = false }
            guard let id = vehicle.vehicleId else { return }
            if let reply = try? await store.tabQuery(eventID, "logistics", "lastOdometer", ["vehicleId": id], as: Last.self), let value = reply.value {
                last = value
                odometer = String(Int(value))
            }
        }
    }

    private func submit() async {
        guard let mileage = Int(odometer.trimmingCharacters(in: .whitespaces)) else { state.error = "Podaj prawidłowy stan licznika"; return }
        if let last, Double(mileage) < last { state.error = "Stan licznika nie może być niższy niż \(Int(last)) km"; return }
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.tabAction(eventID, "logistics", "handover", ["rowId": .string(vehicle.id), "odometer": .string(String(mileage)), "notes": .string(notes)],
                                                  reload: ["logistics"], success: nil, pending: "Zapisywanie…")
            struct Reply: Decodable { var message: String? }
            state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? "Zapisano")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}
