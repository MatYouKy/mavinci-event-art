import SwiftUI

// MARK: Flota (`/crm/fleet`) — dane z `/bridge/native/v1/fleet` (`src/lib/native/fleet.ts`): lista jak `getFleetVehicles`,
// karta jak `getVehicleDetail` z panelami (właściwości, prawo jazdy, galeria), oś czasu `get_vehicle_timeline`.
// Etykiety (statusy, kategorie, paliwa) liczy serwer — te same co formularze CRM.

struct FleetOption: Decodable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct FleetDictionaries: Decodable {
    let statuses: [FleetOption]
    let filterStatuses: [FleetOption]
    let filterCategories: [FleetOption]
    let carCategories: [FleetOption]
    let trailerCategories: [FleetOption]
    let fuelTypes: [FleetOption]
    let transmissions: [FleetOption]
    let ownership: [FleetOption]
}

struct FleetAccess: Decodable {
    let canView: Bool
    let canManage: Bool
    let canCreate: Bool
    let isAdmin: Bool
    let employeeId: String
}

struct FleetPerson: Decodable, Hashable {
    let id: String
    let name: String
    let avatarUrl: String?
    let avatar: AvatarCrop?
}

struct FleetVehicleRow: Decodable, Identifiable, Hashable {
    struct Alerts: Decodable, Hashable { let inspection: Int; let insurance: Int }
    let id: String
    let name: String
    let brand: String
    let model: String
    let year: Int?
    let registration: String
    let vin: String
    let status: String
    let statusLabel: String
    let category: String
    let categoryLabel: String
    let vehicleType: String
    let fuelType: String
    let mileage: Int
    let thumb: String?
    let images: [String]
    let assigned: FleetPerson?
    let inUse: Bool
    let inUseBy: String
    let inUseEvent: String
    let inUseEventId: String?
    let driver: FleetPerson?
    let alerts: Alerts
    let yearlyCost: Double
    let createdAt: String?

    var subtitle: String { [brand, model].filter { !$0.isEmpty }.joined(separator: " ") + (year.map { " (\($0))" } ?? "") }
    func matches(_ search: String) -> Bool {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return true }
        return [name, brand, model, registration, vin].contains { $0.lowercased().contains(needle) }
    }
}

struct FleetStats: Decodable {
    let total: Int
    let active: Int
    let inService: Int
    let yearlyCost: Double
    let averageMileage: Int
}

struct FleetListState: Decodable {
    let access: FleetAccess
    let dictionaries: FleetDictionaries
    let stats: FleetStats
    let vehicles: [FleetVehicleRow]
}

// MARK: Karta pojazdu

struct FleetVehicleInfo: Decodable, Hashable {
    let id: String
    let vehicleType: String
    let name: String
    let brand: String
    let model: String
    let registration: String
    let vin: String
    let year: Int?
    let color: String
    let engineType: String
    let engineCapacity: Int?
    let powerHp: Int?
    let powerKw: Int?
    let fuelType: String
    let fuelLabel: String
    let averageConsumption: Double?
    let energyPrice: Double?
    let transmission: String
    let transmissionLabel: String
    let driveType: String
    let seats: Int?
    let maxLoad: Int?
    let cargoLength: Int?
    let cargoWidth: Int?
    let cargoHeight: Int?
    let totalLength: Int?
    let totalWidth: Int?
    let totalHeight: Int?
    let weight: Int?
    let status: String
    let statusLabel: String
    let ownership: String
    let ownershipLabel: String
    let category: String
    let categoryLabel: String
    let towHitch: Bool
    let purchasePrice: Double?
    let purchaseDate: String
    let currentValue: Double?
    let leasingCompany: String
    let leasingMonthly: Double?
    let leasingEnd: String
    let initialMileage: Int?
    let mileage: Int
    let currentLocation: String
    let parkingLocation: String
    let garageLocation: String
    let description: String
    let notes: String
    let thumb: String?
    let createdAt: String?

    var isTrailer: Bool { vehicleType == "trailer" }
    var electric: Bool { fuelType == "elektryczny" }
}

struct FleetUsage: Decodable, Hashable {
    let inUse: Bool
    let source: String?
    let by: String
    let driverId: String?
    let eventVehicleId: String?
    let event: String
    let eventId: String?
    let purpose: String
    let pickupAt: String?
    let canEnd: Bool
}

struct FleetAlert: Decodable, Hashable, Identifiable {
    let id: String
    let type: String
    let title: String
    let message: String
    let blocking: Bool
    let priority: String
    let dueDate: String
}

struct FleetFuelEntry: Decodable, Hashable, Identifiable {
    let id: String
    let date: String
    let time: String
    let location: String
    let odometer: Int
    let fuelType: String
    let fuelLabel: String
    let liters: Double
    let pricePerLiter: Double
    let totalCost: Double
    let avgConsumption: Double?
    let distance: Double?
    let fullTank: Bool
    let paymentMethod: String
    let receiptNumber: String
    let receiptUrl: String?
    let notes: String
    let filledBy: String
}

struct FleetMaintenance: Decodable, Hashable, Identifiable {
    struct Item: Decodable, Hashable { let description: String; let partNumber: String; let cost: Double }
    let id: String
    let source: String
    let kind: String
    let date: String
    let odometer: Int
    let title: String
    let description: String
    let provider: String
    let labor: Double
    let parts: Double
    let total: Double
    let status: String
    let statusLabel: String
    let nextDate: String
    let nextMileage: Double?
    let validUntil: String
    let notes: String
    let performedBy: String
    let items: [Item]
    let certificate: String
}

struct FleetInsurance: Decodable, Hashable, Identifiable {
    let id: String
    let type: String
    let typeLabel: String
    let company: String
    let number: String
    let start: String
    let end: String
    let issued: String
    let premium: Double
    let frequency: String
    let deductible: Double?
    let sumInsured: Double?
    let status: String
    let statusLabel: String
    let autoRenewal: Bool
    let notes: String
}

struct FleetHandover: Decodable, Hashable, Identifiable {
    let id: String
    let type: String
    let odometer: Int
    let at: String?
    let notes: String
    let eventId: String?
    let eventName: String
    let eventDate: String?
    let location: String
    let driver: String
    let driverEmail: String
    let source: String
    let purpose: String
}

struct FleetAttributeType: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let description: String
    let dataType: String
    let unit: String
    let options: [String]
    let category: String
    let categoryLabel: String
}

struct FleetAttribute: Decodable, Hashable, Identifiable {
    let id: String
    let value: String
    let display: String
    let notes: String
    let type: FleetAttributeType
}

struct FleetLicense: Decodable, Hashable, Identifiable {
    let id: String
    let categoryId: String
    let code: String
    let name: String
    let required: Bool
    let notes: String
    let order: Int
}

struct FleetLicenseCategory: Decodable, Hashable, Identifiable {
    let id: String
    let code: String
    let name: String
    let description: String
    let order: Int
}

struct FleetImage: Decodable, Hashable, Identifiable {
    let id: String
    let url: String
    let title: String
    let description: String
    let primary: Bool
    let order: Int
    let createdAt: String?
}

struct FleetEmployee: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct FleetTotals: Decodable, Hashable {
    let fuelCost: Double
    let maintenanceCost: Double
    let insuranceCost: Double
    let avgConsumption: Double
}

struct FleetVehicleDetail: Decodable {
    let access: FleetAccess
    let dictionaries: FleetDictionaries
    let vehicle: FleetVehicleInfo
    let usage: FleetUsage
    let alerts: [FleetAlert]
    let fuel: [FleetFuelEntry]
    let maintenance: [FleetMaintenance]
    let insurance: [FleetInsurance]
    let handovers: [FleetHandover]
    let attributes: [FleetAttribute]
    let attributeTypes: [FleetAttributeType]
    let licenses: [FleetLicense]
    let licenseCategories: [FleetLicenseCategory]
    let images: [FleetImage]
    let employees: [FleetEmployee]
    let totals: FleetTotals
}

// MARK: Oś czasu

struct FleetTimelineEntry: Decodable, Hashable, Identifiable {
    let id: String
    let type: String
    let start: String
    let end: String
    let title: String
    let description: String
    let status: String
    let color: String
    let relatedId: String?
    let eventName: String
    let driver: String
    let location: String
}

struct FleetTimelineVehicle: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let subtitle: String
    let registration: String
    let status: String
    let vehicleType: String
    let entries: [FleetTimelineEntry]
}

struct FleetTimelineData: Decodable {
    let vehicles: [FleetTimelineVehicle]
}

/// Zakładki karty pojazdu (`/crm/fleet/[id]`).
enum FleetVehicleTab: String, CaseIterable, Identifiable {
    case overview, timeline, fuel, maintenance, insurance, history, gallery
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: return "Informacje"
        case .timeline: return "Timeline"
        case .fuel: return "Tankowania"
        case .maintenance: return "Serwis i naprawy"
        case .insurance: return "Ubezpieczenia"
        case .history: return "Historia użytkowania"
        case .gallery: return "Galeria"
        }
    }
    var symbol: String {
        switch self {
        case .overview: return "car"
        case .timeline: return "chart.line.uptrend.xyaxis"
        case .fuel: return "fuelpump"
        case .maintenance: return "wrench.and.screwdriver"
        case .insurance: return "shield"
        case .history: return "clock"
        case .gallery: return "photo.on.rectangle"
        }
    }
}

/// Formatowanie jak w CRM (`toLocaleString('pl-PL')`, „zł”, daty „dd.MM.yyyy”).
enum FleetFormat {
    private static let integer: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.maximumFractionDigits = 0; return f
    }()
    private static let decimal: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.minimumFractionDigits = 0; f.maximumFractionDigits = 2; return f
    }()
    static func km(_ value: Int) -> String { (integer.string(from: NSNumber(value: value)) ?? "\(value)") + " km" }
    static func number(_ value: Double?, digits: Int = 2) -> String {
        guard let value else { return "" }
        decimal.maximumFractionDigits = digits
        return decimal.string(from: NSNumber(value: value)) ?? "\(value)"
    }
    /// `formatCurrency` z karty pojazdu: brak kwoty — „-”.
    static func money(_ value: Double?) -> String {
        guard let value, value != 0 else { return "-" }
        return String(format: "%.2f zł", value).replacingOccurrences(of: ".", with: ",")
    }
    /// „12.3k zł” jak kafelki kosztów.
    static func thousands(_ value: Double) -> String { String(format: "%.1fk zł", value / 1000).replacingOccurrences(of: ".", with: ",") }
    static func day(_ value: String) -> String { value.isEmpty ? "-" : (DayDates.display(value).nonEmpty ?? value) }
    static func dateTime(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
    static func time(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "" }
        return MeetingDates.format(date, "HH:mm")
    }
    /// Dni do daty (jak `getDaysUntil`): zaokrąglone w górę.
    static func daysUntil(_ value: String) -> Int? {
        guard let date = DayDates.parse(value) else { return nil }
        return Int((date.timeIntervalSinceNow / 86_400).rounded(.up))
    }
    /// Liczba z pola tekstowego (przecinek albo kropka).
    static func parse(_ text: String) -> Double? {
        let value = text.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "").trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : Double(value)
    }
    private static let plain: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0; f.maximumFractionDigits = 4; return f
    }()
    /// Liczba do pola formularza — bez separatora tysięcy, z przecinkiem.
    static func field(_ value: Double?) -> String { value.flatMap { plain.string(from: NSNumber(value: $0)) } ?? "" }
    static func field(_ value: Int?) -> String { value.map { "\($0)" } ?? "" }
}

/// Kolory statusów jak `getStatusBadge` w CRM.
enum FleetTone {
    static func status(_ status: String, inUse: Bool) -> Color {
        if inUse { return CrmTheme.rgb(0xf3e7b1) }
        switch status {
        case "active", "available": return CrmTheme.rgb(0x86efac)
        case "in_use": return CrmTheme.rgb(0xf3e7b1)
        case "in_service", "under_repair": return CrmTheme.rgb(0xfdba74)
        case "no_insurance", "no_inspection", "scrapped": return CrmTheme.rgb(0xfca5a5)
        case "sold": return CrmTheme.rgb(0x93c5fd)
        default: return Color.secondary
        }
    }
    static func maintenance(_ status: String) -> Color {
        switch status {
        case "active", "completed": return CrmTheme.rgb(0x86efac)
        case "scheduled": return CrmTheme.rgb(0x93c5fd)
        case "in_progress": return CrmTheme.rgb(0xfdba74)
        case "expired", "failed": return CrmTheme.rgb(0xfca5a5)
        default: return Color.secondary
        }
    }
    static func insurance(_ status: String) -> Color {
        switch status {
        case "active": return CrmTheme.rgb(0x86efac)
        case "expired", "cancelled": return CrmTheme.rgb(0xfca5a5)
        case "scheduled": return CrmTheme.rgb(0x93c5fd)
        default: return Color.secondary
        }
    }
    /// Kolor wpisu osi czasu z bazy (`#3b82f6`).
    static func hex(_ value: String, fallback: Color) -> Color {
        var hex = value.trimmingCharacters(in: .whitespaces)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, hex.allSatisfy(\.isHexDigit), let number = Int(hex, radix: 16) else { return fallback }
        return CrmTheme.rgb(number)
    }
}

/// Plakietka statusu (`getStatusBadge`) — „W użytkowaniu” ma pierwszeństwo.
struct FleetStatusBadge: View {
    let status: String
    let label: String
    var inUse = false
    var body: some View {
        let color = FleetTone.status(status, inUse: inUse)
        HStack(spacing: 4) {
            if inUse { Image(systemName: "waveform.path.ecg").font(.caption2) }
            Text(inUse ? "W użytkowaniu" : label)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(color.opacity(0.45), lineWidth: 1))
        .foregroundStyle(color)
    }
}

/// Plakietka statusu wpisu (serwis, polisa).
struct FleetPill: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(color.opacity(0.35), lineWidth: 1))
            .foregroundStyle(color)
    }
}
