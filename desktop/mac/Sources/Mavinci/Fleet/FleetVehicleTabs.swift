import SwiftUI

// MARK: Zakładki karty pojazdu: Tankowania, Serwis i naprawy (przeglądy, olej, rozrząd, naprawy — usuwa administrator),
// Ubezpieczenia (ostrzeżenie 60 dni przed końcem, usuwa administrator), Historia użytkowania (odbiory i zdania).

@MainActor struct FleetFuelTab: View {
    @ObservedObject var store: FleetStore
    let detail: FleetVehicleDetail
    let add: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        TeamCard(title: "Historia tankowań", action: detail.access.canManage ? ("Dodaj tankowanie", add) : nil) {
            if detail.fuel.isEmpty {
                empty("fuelpump", "Brak wpisów tankowania")
            } else {
                VStack(spacing: 8) { ForEach(detail.fuel) { entry($0) } }
            }
        }
    }

    private func entry(_ e: FleetFuelEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label(FleetFormat.day(e.date) + (e.time.isEmpty ? "" : ", \(e.time)"), systemImage: "calendar").fontWeight(.medium)
                if e.fullTank { FleetPill(text: "Pełny bak", color: CrmTheme.rgb(0x86efac)) }
                Spacer()
                if !e.filledBy.isEmpty { Text(e.filledBy).font(.caption).foregroundStyle(.secondary) }
                if let receipt = e.receiptUrl, let url = URL(string: receipt) {
                    Link(destination: url) { Label("Paragon", systemImage: "doc.text") }.font(.caption)
                }
            }
            HStack(alignment: .top, spacing: 20) {
                value("Stacja", e.location.nonEmpty ?? "-")
                value("Przebieg", FleetFormat.km(e.odometer))
                value("Litry", "\(FleetFormat.number(e.liters)) l")
                value("Cena za litr", FleetFormat.money(e.pricePerLiter))
                value("Koszt", FleetFormat.money(e.totalCost))
                if !e.fuelLabel.isEmpty && e.fuelType != "other" { value("Paliwo", e.fuelLabel) }
            }
            if let average = e.avgConsumption, average > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "waveform.path.ecg").foregroundStyle(theme.accent)
                    Text("Średnie zużycie:").foregroundStyle(.secondary)
                    Text("\(FleetFormat.number(average, digits: 1)) l/100km").fontWeight(.medium)
                    if let distance = e.distance, distance > 0 { Text("(\(Int(distance)) km)").foregroundStyle(.secondary) }
                }
                .font(.callout)
            }
            if !e.notes.isEmpty { Text(e.notes).font(.callout).foregroundStyle(.secondary) }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
    }

    private func value(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(text).fontWeight(.medium).monospacedDigit()
        }
    }
}

@MainActor struct FleetMaintenanceTab: View {
    @ObservedObject var store: FleetStore
    let detail: FleetVehicleDetail
    let add: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var removing: FleetMaintenance?

    var body: some View {
        TeamCard(title: "Historia serwisu i napraw", action: detail.access.canManage ? ("Dodaj wpis serwisowy", add) : nil) {
            if detail.maintenance.isEmpty {
                empty("wrench.and.screwdriver", "Brak wpisów serwisowych")
            } else {
                VStack(spacing: 8) { ForEach(detail.maintenance) { record($0) } }
            }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć ten wpis serwisowy?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let record = removing else { return }
                Task { await store.run("Usuwanie wpisu…", "maintenanceDelete", ["id": .string(record.id), "source": .string(record.source)], reload: detail.vehicle.id) }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Tej operacji nie można cofnąć.") }
    }

    private func record(_ r: FleetMaintenance) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(r.title).font(.headline.weight(.medium))
                        FleetPill(text: r.statusLabel, color: FleetTone.maintenance(r.status))
                    }
                    HStack(spacing: 14) {
                        Label(FleetFormat.day(r.date), systemImage: "calendar")
                        Label(FleetFormat.km(r.odometer), systemImage: "gauge.with.dots.needle.33percent")
                        if !r.performedBy.isEmpty { Label(r.performedBy, systemImage: "person") }
                        if !r.certificate.isEmpty { Label("Zaśw. \(r.certificate)", systemImage: "doc.text") }
                    }
                    .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(FleetFormat.money(r.total)).font(.headline.monospacedDigit())
                    if r.source != "periodic_inspections" {
                        Text("Robocizna: \(FleetFormat.money(r.labor))").font(.caption).foregroundStyle(.secondary)
                        Text("Części: \(FleetFormat.money(r.parts))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if detail.access.isAdmin {
                    Button(role: .destructive) { removing = r } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń wpis")
                }
            }
            if !r.description.isEmpty { Text(r.description).font(.callout) }
            if !r.items.isEmpty && !r.description.contains("Naprawione elementy") {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(r.items.enumerated()), id: \.offset) { _, item in
                        HStack {
                            Text("• " + item.description + (item.partNumber.isEmpty ? "" : " (\(item.partNumber))"))
                            Spacer()
                            Text(FleetFormat.money(item.cost)).monospacedDigit()
                        }
                        .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !r.provider.isEmpty { Text("Warsztat: \(r.provider)").font(.callout).foregroundStyle(.secondary) }
            if !r.nextDate.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "clock").foregroundStyle(CrmTheme.rgb(0x60a5fa))
                    Text(r.source == "maintenance_records" && r.status == "scheduled" ? "Planowana naprawa:" : "Następny serwis:").foregroundStyle(.secondary)
                    Text(FleetFormat.day(r.nextDate)).fontWeight(.medium)
                    if let mileage = r.nextMileage { Text("lub przy \(FleetFormat.km(Int(mileage)))").foregroundStyle(.secondary) }
                }
                .font(.callout)
            }
            if r.source == "periodic_inspections" && !r.validUntil.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").foregroundStyle(FleetTone.maintenance(r.status))
                    Text("Przegląd ważny do:").foregroundStyle(.secondary)
                    Text(FleetFormat.day(r.validUntil)).fontWeight(.medium)
                }
                .font(.callout)
            }
            if !r.notes.isEmpty { Text(r.notes).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
    }
}

@MainActor struct FleetInsuranceTab: View {
    @ObservedObject var store: FleetStore
    let detail: FleetVehicleDetail
    let add: () -> Void
    @State private var removing: FleetInsurance?

    private static let frequencies = ["annual": "roczna", "semi_annual": "półroczna", "quarterly": "kwartalna", "monthly": "miesięczna"]

    var body: some View {
        TeamCard(title: "Ubezpieczenia", action: detail.access.canManage ? ("Dodaj ubezpieczenie", add) : nil) {
            if detail.insurance.isEmpty {
                empty("shield", "Brak polis ubezpieczeniowych")
            } else {
                VStack(spacing: 8) { ForEach(detail.insurance) { policy($0) } }
            }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć to ubezpieczenie?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let policy = removing else { return }
                Task { await store.run("Usuwanie ubezpieczenia…", "insuranceDelete", ["id": .string(policy.id)], reload: detail.vehicle.id) }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Tej operacji nie można cofnąć.") }
    }

    private func policy(_ p: FleetInsurance) -> some View {
        let days = FleetFormat.daysUntil(p.end)
        let expiring = days.map { $0 > 0 && $0 <= 60 } ?? false
        let red = CrmTheme.rgb(0xf87171)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(p.typeLabel).font(.headline.weight(.medium))
                        FleetPill(text: p.statusLabel, color: FleetTone.insurance(p.status))
                        if expiring, let days {
                            Label("Wygasa za \(days) dni", systemImage: "exclamationmark.triangle").font(.caption.weight(.semibold)).foregroundStyle(red)
                        }
                    }
                    Text(p.company).foregroundStyle(.secondary)
                    Text("Polisa: \(p.number)").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(FleetFormat.money(p.premium)).font(.headline.monospacedDigit())
                    Text("składka \(Self.frequencies[p.frequency] ?? "roczna")").font(.caption).foregroundStyle(.secondary)
                }
                if detail.access.isAdmin {
                    Button(role: .destructive) { removing = p } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń ubezpieczenie")
                }
            }
            HStack(spacing: 20) {
                HStack(spacing: 4) { Text("Początek:").foregroundStyle(.secondary); Text(FleetFormat.day(p.start)) }
                HStack(spacing: 4) { Text("Koniec:").foregroundStyle(.secondary); Text(FleetFormat.day(p.end)).foregroundStyle(expiring ? red : Color.primary) }
                if p.deductible != nil { HStack(spacing: 4) { Text("Franszyza:").foregroundStyle(.secondary); Text(FleetFormat.money(p.deductible)) } }
                if p.sumInsured != nil { HStack(spacing: 4) { Text("Suma ubezp.:").foregroundStyle(.secondary); Text(FleetFormat.money(p.sumInsured)) } }
                if p.autoRenewal { Label("Auto-odnowienie", systemImage: "arrow.triangle.2.circlepath").foregroundStyle(.secondary) }
            }
            .font(.callout)
            if !p.notes.isEmpty { Text(p.notes).font(.callout).foregroundStyle(.secondary) }
        }
        .padding(12)
        .background(expiring ? red.opacity(0.06) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(expiring ? red.opacity(0.3) : Color.clear, lineWidth: 1))
    }
}

@MainActor struct FleetHistoryTab: View {
    let detail: FleetVehicleDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        TeamCard(title: "Historia odbiorów i zdań pojazdu") {
            if detail.handovers.isEmpty {
                empty("clock", "Brak historii użytkowania pojazdu")
            } else {
                VStack(spacing: 8) { ForEach(detail.handovers) { row($0) } }
            }
        }
    }

    private func row(_ h: FleetHandover) -> some View {
        let pickup = h.type == "pickup"
        let color = pickup ? CrmTheme.rgb(0x60a5fa) : CrmTheme.rgb(0x4ade80)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                FleetPill(text: pickup ? "Odbiór" : "Zdanie", color: color)
                if h.source == "ad_hoc" { FleetPill(text: "Wyjazd doraźny", color: theme.accent) }
                Spacer()
                Text(FleetFormat.km(h.odometer)).font(.headline.monospacedDigit())
            }
            HStack(spacing: 14) {
                Label(h.driver.nonEmpty ?? "-", systemImage: "person")
                if let at = h.at {
                    Label(FleetFormat.dateTime(at), systemImage: "calendar")
                }
            }
            .font(.callout).foregroundStyle(.secondary)
            if h.source == "ad_hoc" {
                Label("Cel: \(h.purpose.nonEmpty ?? "Wyjazd służbowy")", systemImage: "location.north").font(.callout)
            } else if !h.eventName.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "waveform.path.ecg")
                    if let eventID = h.eventId {
                        Button(h.eventName) { state.showEvent(eventID) }.buttonStyle(.link)
                    } else {
                        Text(h.eventName)
                    }
                }
                .font(.callout)
            }
            if !h.location.isEmpty { Label(h.location, systemImage: "mappin").font(.callout).foregroundStyle(.secondary) }
            if !h.notes.isEmpty { Text(h.notes).font(.callout).foregroundStyle(.secondary).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6)) }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
    }
}

/// Pusty stan zakładki (ikona i tekst jak w CRM).
@MainActor private func empty(_ symbol: String, _ text: String) -> some View {
    VStack(spacing: 8) {
        Image(systemName: symbol).font(.largeTitle).foregroundStyle(.tertiary)
        Text(text).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity).padding(.vertical, 28)
}
