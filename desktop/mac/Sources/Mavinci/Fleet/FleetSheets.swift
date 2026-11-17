import SwiftUI
import UniformTypeIdentifiers

// MARK: Okna floty — te same formularze co modale CRM: tankowanie (`AddFuelEntryModal`, szybkie `QuickFuelModal` z paragonem),
// wpis serwisowy (`AddMaintenanceModal`: kontrola techniczna, olej z częściami, rozrząd, inne naprawy), polisa
// (`AddInsuranceModal`), zdanie pojazdu (`VehicleHandoverModal`), właściwość (`VehicleAttributesPanel`) i wymaganie prawa jazdy.

/// Wspólny układ okna floty: tytuł z pojazdem, formularz, błąd i przyciski.
@MainActor struct FleetSheetFrame<Content: View>: View {
    let title: String
    let subtitle: String
    let symbol: String
    let submitTitle: String
    let busy: Bool
    let canSubmit: Bool
    let problem: String?
    var width: CGFloat = 600
    var height: CGFloat = 640
    let submit: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.title3.weight(.semibold))
                    if !subtitle.isEmpty { Text(subtitle).font(.callout).foregroundStyle(.secondary) }
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(busy)
            }
            .padding(18)
            Form { content() }.formStyle(.grouped).disabled(busy)
            if let problem { Text(problem).font(.callout).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 18).padding(.top, 6) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(busy)
                Button(busy ? "Zapisywanie…" : submitTitle, action: submit).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy || !canSubmit)
            }
            .padding(18)
        }
        .frame(width: width, height: height)
        .background(theme.page)
    }
}

private func fleetDay(_ date: Date) -> JSONValue { .string(DayDates.string(date)) }
private func addingYear(_ date: Date) -> Date { Calendar.current.date(byAdding: .year, value: 1, to: date) ?? date }

// MARK: Tankowanie

@MainActor struct FleetFuelSheet: View {
    @ObservedObject var store: FleetStore
    let vehicleID: String
    let vehicleName: String
    let currentMileage: Int
    let quick: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var time = Date()
    @State private var location = ""
    @State private var odometer = ""
    @State private var fuelType = "diesel"
    @State private var liters = ""
    @State private var price = ""
    @State private var payment = ""
    @State private var otherPayment = ""
    @State private var receiptNumber = ""
    @State private var fullTank = true
    @State private var notes = ""
    @State private var receipt: URL?
    @State private var picking = false
    @State private var busy = false
    @State private var problem: String?

    private var total: Double { (FleetFormat.parse(liters) ?? 0) * (FleetFormat.parse(price) ?? 0) }
    private var valid: Bool {
        (FleetFormat.parse(liters) ?? 0) > 0 && (FleetFormat.parse(price) ?? 0) > 0 && FleetFormat.parse(odometer) != nil
            && (!quick || payment != "other" || !otherPayment.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        FleetSheetFrame(title: quick ? "Szybkie tankowanie" : "Dodaj tankowanie", subtitle: vehicleName, symbol: "fuelpump",
                        submitTitle: "Dodaj tankowanie", busy: busy, canSubmit: valid, problem: problem, height: quick ? 600 : 680) { submit() } content: {
            Section {
                DatePicker("Data *", selection: $date, displayedComponents: .date)
                DatePicker("Godzina", selection: $time, displayedComponents: .hourAndMinute)
                if !quick { TextField("Stacja paliw", text: $location, prompt: Text("np. Orlen - Kraków Balice")) }
                TextField("Przebieg (km) *", text: $odometer, prompt: Text("np. 125000"))
                if let value = FleetFormat.parse(odometer), Int(value) < currentMileage {
                    Label("Uwaga: Przebieg niższy niż obecny (\(FleetFormat.km(currentMileage)))", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                }
            }
            Section {
                if !quick {
                    Picker("Typ paliwa *", selection: $fuelType) {
                        Text("Benzyna 95").tag("benzyna95"); Text("Benzyna 98").tag("benzyna98"); Text("Diesel").tag("diesel")
                        Text("LPG").tag("LPG"); Text("Elektryczny").tag("elektryczny"); Text("Inne").tag("other")
                    }
                }
                TextField(quick ? "Ilość (litry) *" : "Litry *", text: $liters, prompt: Text(quick ? "np. 45,50" : "np. 65,5"))
                TextField("Cena za litr (zł) *", text: $price, prompt: Text(quick ? "np. 6,59" : "np. 6,89"))
                LabeledContent("Koszt całkowity") { Text(String(format: "%.2f zł", total).replacingOccurrences(of: ".", with: ",")).font(.headline.monospacedDigit()) }
            }
            Section {
                if quick {
                    Picker("Metoda płatności", selection: $payment) {
                        Text("Karta firmowa").tag("company_card")
                        Text("Inna metoda płatności").tag("other")
                    }
                    .pickerStyle(.radioGroup)
                    if payment == "other" {
                        TextField("Metoda płatności *", text: $otherPayment, prompt: Text("Podaj metodę płatności (np. gotówka, prywatna karta)"))
                    }
                    LabeledContent("Paragon/Faktura (opcjonalnie)") {
                        HStack {
                            if let receipt { Text(receipt.lastPathComponent).lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary) }
                            Button(receipt == nil ? "Wybierz plik…" : "Zmień…") { picking = true }
                            if receipt != nil { Button("Usuń", role: .destructive) { receipt = nil } }
                        }
                    }
                } else {
                    Picker("Metoda płatności", selection: $payment) {
                        Text("Wybierz...").tag("")
                        Text("Gotówka").tag("gotowka"); Text("Karta").tag("karta"); Text("Karta paliwowa").tag("karta_paliwowa"); Text("Przelew").tag("przelew")
                    }
                    TextField("Numer paragonu", text: $receiptNumber, prompt: Text("np. 123456789"))
                    Toggle("Pełny bak (zaznacz aby obliczyć średnie zużycie)", isOn: $fullTank)
                    TextField("Notatki", text: $notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(2...4)
                }
            }
        }
        .onAppear {
            if odometer.isEmpty { odometer = String(currentMileage) }
            if quick && payment.isEmpty { payment = "company_card" }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.image, .pdf]) { result in
            if case .success(let url) = result { receipt = url }
        }
    }

    private func submit() {
        guard valid else { problem = quick ? "Wypełnij wszystkie wymagane pola" : "Wypełnij wymagane pola"; return }
        Task {
            busy = true
            defer { busy = false }
            var receiptURL = ""
            if quick, let receipt {
                do {
                    let reply = try await state.withPending("Przesyłanie paragonu…") { try await store.upload("receipt", vehicleID: vehicleID, file: receipt) }
                    receiptURL = reply["url"]?.text ?? ""
                } catch {
                    problem = store.failureText(error, "Nie udało się przesłać paragonu.")
                    return
                }
            }
            let data: [String: JSONValue] = [
                "mode": .string(quick ? "quick" : "full"), "date": fleetDay(date), "time": .string(MeetingDates.format(time, "HH:mm")),
                "location": .string(location), "odometer": .string(odometer), "fuelType": .string(fuelType), "liters": .string(liters),
                "pricePerLiter": .string(price), "paymentMethod": .string(payment), "otherPayment": .string(otherPayment),
                "receiptNumber": .string(receiptNumber), "receiptUrl": .string(receiptURL), "fullTank": .bool(fullTank), "notes": .string(notes),
            ]
            if await store.run("Dodawanie tankowania…", "fuelAdd", ["vehicleId": .string(vehicleID), "data": .object(data)], reload: vehicleID) != nil {
                dismiss()
            }
        }
    }
}

// MARK: Wpis serwisowy

@MainActor struct FleetMaintenanceSheet: View {
    @ObservedObject var store: FleetStore
    let vehicleID: String
    let vehicleName: String
    let currentMileage: Int
    let employees: [FleetEmployee]
    @Environment(\.dismiss) private var dismiss

    struct Part: Identifiable { let id = UUID(); var type = "oil"; var name = ""; var number = ""; var quantity = "1"; var unit = "l"; var cost = "" }
    struct Item: Identifiable { let id = UUID(); var description = ""; var partNumber = ""; var cost = "" }

    @State private var kind = "inspection"
    @State private var date = Date()
    @State private var validUntil = addingYear(Date())
    @State private var odometer = ""
    @State private var certificate = ""
    @State private var performedBy = ""
    @State private var provider = ""
    @State private var cost = ""
    @State private var labor = ""
    @State private var partsCost = ""
    @State private var nextMileage = ""
    @State private var notes = ""
    @State private var parts: [Part] = [Part()]
    @State private var title = ""
    @State private var status = "completed"
    @State private var severity = "medium"
    @State private var details = ""
    @State private var planned: Date? = nil
    @State private var items: [Item] = [Item()]
    @State private var busy = false
    @State private var problem: String?

    private var valid: Bool {
        guard FleetFormat.parse(odometer) != nil else { return false }
        switch kind {
        case "inspection": return validUntil >= Calendar.current.startOfDay(for: date)
        case "oil_change": return parts.allSatisfy { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
        case "timing_belt": return FleetFormat.parse(nextMileage) != nil
        default: return !title.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    var body: some View {
        FleetSheetFrame(title: "Dodaj wpis serwisowy", subtitle: vehicleName, symbol: "wrench.and.screwdriver", submitTitle: "Dodaj wpis",
                        busy: busy, canSubmit: valid, problem: problem, width: 680, height: 720) { submit() } content: {
            Section {
                Picker("Typ serwisu *", selection: $kind) {
                    Text("Kontrola techniczna").tag("inspection")
                    Text("Wymiana oleju i filtrów").tag("oil_change")
                    Text("Wymiana rozrządu").tag("timing_belt")
                    Text("Inne naprawy").tag("repair")
                }
            }
            switch kind {
            case "inspection": inspection
            case "oil_change": oil
            case "timing_belt": timing
            default: repair
            }
            Section { TextField("Notatki", text: $notes, axis: .vertical).lineLimit(2...4) }
        }
        .onAppear { if odometer.isEmpty { odometer = String(currentMileage) } }
    }

    @ViewBuilder private var inspection: some View {
        Section("Kontrola techniczna") {
            DatePicker("Data przeglądu *", selection: Binding(get: { date }, set: { date = $0; validUntil = addingYear($0) }), displayedComponents: .date)
            DatePicker("Ważny do / kolejny przegląd *", selection: $validUntil, in: Calendar.current.startOfDay(for: date)..., displayedComponents: .date)
            TextField("Przebieg (km) *", text: $odometer)
            TextField("Numer zaświadczenia", text: $certificate)
            Picker("Wykonane przez", selection: $performedBy) {
                Text("-- Wybierz pracownika --").tag("")
                ForEach(employees) { Text($0.name).tag($0.id) }
            }
            TextField("Stacja kontroli", text: $provider)
            TextField("Koszt (zł)", text: $cost)
        }
    }

    @ViewBuilder private var oil: some View {
        Section {
            DatePicker("Data wymiany *", selection: $date, displayedComponents: .date)
            TextField("Przebieg (km) *", text: $odometer)
            Text("Następna wymiana za 12000 km lub 1 rok").font(.caption).foregroundStyle(.secondary)
        }
        Section {
            ForEach($parts) { $part in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Picker("Rodzaj", selection: $part.type) {
                            Text("Olej").tag("oil"); Text("Filtr oleju").tag("oil_filter"); Text("Filtr powietrza").tag("air_filter")
                            Text("Filtr kabiny").tag("cabin_filter"); Text("Filtr paliwa").tag("fuel_filter"); Text("Inne").tag("other")
                        }
                        .labelsHidden().frame(width: 150)
                        TextField("Nazwa części", text: $part.name).textFieldStyle(.roundedBorder)
                        TextField("Nr części", text: $part.number).textFieldStyle(.roundedBorder).frame(width: 110)
                    }
                    HStack {
                        TextField("Ilość", text: $part.quantity).textFieldStyle(.roundedBorder).frame(width: 70)
                        TextField("Jedn.", text: $part.unit).textFieldStyle(.roundedBorder).frame(width: 60)
                        TextField("Koszt", text: $part.cost).textFieldStyle(.roundedBorder).frame(width: 100)
                        Spacer()
                        if parts.count > 1 {
                            Button(role: .destructive) { parts.removeAll { $0.id == part.id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
                        }
                    }
                }
            }
            Button("Dodaj część", systemImage: "plus") { parts.append(Part(type: "other", unit: "szt")) }
        } header: { Text("Użyte części") }
        Section {
            TextField("Warsztat", text: $provider)
            TextField("Robocizna (zł)", text: $labor)
        }
    }

    @ViewBuilder private var timing: some View {
        Section("Wymiana rozrządu") {
            DatePicker("Data wymiany *", selection: $date, displayedComponents: .date)
            TextField("Przebieg (km) *", text: $odometer)
            TextField("Następna wymiana po km *", text: $nextMileage, prompt: Text("np. 180000"))
            TextField("Warsztat", text: $provider)
            TextField("Robocizna (zł)", text: $labor)
            TextField("Części (zł)", text: $partsCost)
        }
    }

    @ViewBuilder private var repair: some View {
        Section("Inne naprawy") {
            TextField("Tytuł naprawy *", text: $title, prompt: Text("np. Naprawa układu hamulcowego"))
            Picker("Status", selection: $status) {
                Text("Zaplanowana").tag("scheduled"); Text("W trakcie").tag("in_progress"); Text("Zakończona").tag("completed"); Text("Anulowana").tag("cancelled")
            }
            Picker("Poziom wagi", selection: $severity) {
                Text("Niski").tag("low"); Text("Średni").tag("medium"); Text("Wysoki (blokuje pojazd)").tag("high")
            }
            TextField("Opis", text: $details, axis: .vertical).lineLimit(2...4)
            if status == "scheduled" {
                OptionalDateField(title: "Szacowana data naprawy", date: $planned)
            }
            DatePicker("Data", selection: $date, displayedComponents: .date)
            TextField("Przebieg (km) *", text: $odometer)
            TextField("Warsztat", text: $provider)
            TextField("Robocizna (zł)", text: $labor)
        }
        if status == "completed" {
            Section {
                ForEach($items) { $item in
                    HStack {
                        TextField("Co było naprawiane", text: $item.description).textFieldStyle(.roundedBorder)
                        TextField("Numer części", text: $item.partNumber).textFieldStyle(.roundedBorder).frame(width: 120)
                        TextField("Koszt części (zł)", text: $item.cost).textFieldStyle(.roundedBorder).frame(width: 120)
                        if items.count > 1 {
                            Button(role: .destructive) { items.removeAll { $0.id == item.id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
                        }
                    }
                }
                Button("Dodaj element", systemImage: "plus") { items.append(Item()) }
            } header: { Text("Naprawione elementy") }
        }
    }

    private func submit() {
        guard valid else { problem = "Uzupełnij wymagane pola."; return }
        var data: [String: JSONValue] = [
            "date": fleetDay(date), "odometer": .string(odometer), "provider": .string(provider), "notes": .string(notes), "labor": .string(labor),
        ]
        switch kind {
        case "inspection":
            data["validUntil"] = fleetDay(validUntil); data["certificate"] = .string(certificate); data["performedBy"] = .string(performedBy)
            data["cost"] = .string(cost)
        case "oil_change":
            data["parts"] = .array(parts.map { .object(["type": .string($0.type), "name": .string($0.name), "number": .string($0.number),
                                                         "quantity": .string($0.quantity), "unit": .string($0.unit), "cost": .string($0.cost)]) })
        case "timing_belt":
            data["nextMileage"] = .string(nextMileage); data["partsCost"] = .string(partsCost)
        default:
            data["title"] = .string(title); data["status"] = .string(status); data["severity"] = .string(severity); data["description"] = .string(details)
            data["plannedDate"] = planned.map(fleetDay) ?? .null
            data["items"] = .array(items.map { .object(["description": .string($0.description), "partNumber": .string($0.partNumber), "cost": .string($0.cost)]) })
        }
        Task {
            busy = true
            defer { busy = false }
            if await store.run("Dodawanie wpisu…", "maintenanceAdd", ["vehicleId": .string(vehicleID), "kind": .string(kind), "data": .object(data)], reload: vehicleID) != nil {
                dismiss()
            }
        }
    }
}

// MARK: Ubezpieczenie

@MainActor struct FleetInsuranceSheet: View {
    @ObservedObject var store: FleetStore
    let vehicleID: String
    let vehicleName: String
    @Environment(\.dismiss) private var dismiss
    @State private var type = "oc"
    @State private var status = "active"
    @State private var company = ""
    @State private var number = ""
    @State private var start = Date()
    @State private var end = addingYear(Date())
    @State private var issued: Date? = nil
    @State private var premium = ""
    @State private var frequency = "annual"
    @State private var deductible = ""
    @State private var sumInsured = ""
    @State private var autoRenewal = false
    @State private var notes = ""
    @State private var busy = false
    @State private var problem: String?

    private var valid: Bool {
        !company.trimmingCharacters(in: .whitespaces).isEmpty && !number.trimmingCharacters(in: .whitespaces).isEmpty
            && FleetFormat.parse(premium) != nil && end >= Calendar.current.startOfDay(for: start)
    }

    var body: some View {
        FleetSheetFrame(title: "Dodaj ubezpieczenie", subtitle: vehicleName, symbol: "shield", submitTitle: "Dodaj polisę",
                        busy: busy, canSubmit: valid, problem: problem, height: 700) { submit() } content: {
            Section {
                Picker("Typ ubezpieczenia *", selection: $type) {
                    Text("OC").tag("oc"); Text("OC + AC").tag("oc_ac"); Text("AC").tag("ac"); Text("NNW").tag("nnw"); Text("Assistance").tag("assistance"); Text("GAP").tag("gap"); Text("Inne").tag("other")
                }
                Picker("Status", selection: $status) { Text("Aktywne").tag("active"); Text("Wygasłe").tag("expired"); Text("Anulowane").tag("cancelled") }
                TextField("Ubezpieczyciel *", text: $company, prompt: Text("np. PZU"))
                TextField("Numer polisy *", text: $number, prompt: Text("np. OC/2024/123456"))
            }
            Section {
                DatePicker("Data początkowa *", selection: $start, displayedComponents: .date)
                DatePicker("Data końcowa *", selection: $end, in: Calendar.current.startOfDay(for: start)..., displayedComponents: .date)
                OptionalDateField(title: "Data wystawienia", date: $issued)
            }
            Section {
                TextField("Składka (zł) *", text: $premium, prompt: Text("np. 1200"))
                Picker("Częstotliwość płatności", selection: $frequency) {
                    Text("Roczna").tag("annual"); Text("Półroczna").tag("semi_annual"); Text("Kwartalna").tag("quarterly"); Text("Miesięczna").tag("monthly")
                }
                TextField("Franszyza (zł)", text: $deductible, prompt: Text("np. 300"))
                TextField("Suma ubezpieczenia (zł)", text: $sumInsured, prompt: Text("np. 150000"))
                Toggle("Automatyczne odnawianie", isOn: $autoRenewal)
                TextField("Notatki", text: $notes, prompt: Text("Dodatkowe informacje o zakresie ochrony..."), axis: .vertical).lineLimit(2...4)
            }
        }
    }

    private func submit() {
        guard valid else { problem = "Wypełnij wymagane pola"; return }
        let data: [String: JSONValue] = [
            "type": .string(type), "status": .string(status), "company": .string(company), "number": .string(number), "start": fleetDay(start),
            "end": fleetDay(end), "issued": issued.map(fleetDay) ?? .null, "premium": .string(premium), "frequency": .string(frequency),
            "deductible": .string(deductible), "sumInsured": .string(sumInsured), "autoRenewal": .bool(autoRenewal), "notes": .string(notes),
        ]
        Task {
            busy = true
            defer { busy = false }
            if await store.run("Dodawanie polisy…", "insuranceAdd", ["vehicleId": .string(vehicleID), "data": .object(data)], reload: vehicleID) != nil {
                dismiss()
            }
        }
    }
}

// MARK: Zdanie pojazdu („Zakończ użytkowanie”)

@MainActor struct FleetEndUsageSheet: View {
    @ObservedObject var store: FleetStore
    let detail: FleetVehicleDetail
    @Environment(\.dismiss) private var dismiss
    @State private var odometer = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var problem: String?

    private var last: Int { detail.vehicle.mileage }
    private var valid: Bool { (FleetFormat.parse(odometer).map { Int($0) >= last }) ?? false }

    var body: some View {
        FleetSheetFrame(title: "Zdaj pojazd", subtitle: detail.vehicle.name + (detail.vehicle.registration.isEmpty ? "" : " (\(detail.vehicle.registration))"),
                        symbol: "key", submitTitle: "Zapisz", busy: busy, canSubmit: valid, problem: problem, width: 520, height: 470) { submit() } content: {
            if detail.usage.source == "ad_hoc" && !detail.usage.purpose.isEmpty {
                Section("Cel wyjazdu") { Text(detail.usage.purpose) }
            } else if !detail.usage.event.isEmpty {
                Section("Wydarzenie") { Text(detail.usage.event) }
            }
            Section {
                TextField("Stan licznika (km)", text: $odometer, prompt: Text("np. 125000"))
                Text("Ostatni: \(FleetFormat.km(last))").font(.caption).foregroundStyle(.secondary)
                TextField("Uwagi (opcjonalnie)", text: $notes, prompt: Text("np. Stan techniczny, uszkodzenia, tankowanie..."), axis: .vertical).lineLimit(3...5)
            }
        }
        .onAppear { if odometer.isEmpty { odometer = String(last) } }
    }

    private func submit() {
        guard let value = FleetFormat.parse(odometer) else { problem = "Podaj prawidłowy stan licznika"; return }
        guard Int(value) >= last else { problem = "Stan licznika nie może być niższy niż \(last) km"; return }
        Task {
            busy = true
            defer { busy = false }
            let data: [String: JSONValue] = ["odometer": .string(odometer), "notes": .string(notes)]
            if await store.run("Zapisywanie…", "endUsage", ["vehicleId": .string(detail.vehicle.id), "data": .object(data)], reload: detail.vehicle.id) != nil {
                dismiss()
            }
        }
    }
}

// MARK: Właściwość pojazdu

@MainActor struct FleetAttributeSheet: View {
    @ObservedObject var store: FleetStore
    let vehicleID: String
    let types: [FleetAttributeType]
    @Environment(\.dismiss) private var dismiss
    @State private var typeID = ""
    @State private var value = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var problem: String?

    private var type: FleetAttributeType? { types.first { $0.id == typeID } }

    var body: some View {
        FleetSheetFrame(title: "Dodaj właściwość", subtitle: "", symbol: "gearshape", submitTitle: "Dodaj", busy: busy,
                        canSubmit: type != nil && !value.trimmingCharacters(in: .whitespaces).isEmpty, problem: problem, width: 520, height: 440) { submit() } content: {
            Section {
                Picker("Typ właściwości *", selection: Binding(get: { typeID }, set: { typeID = $0; value = "" })) {
                    Text("Wybierz...").tag("")
                    ForEach(types) { t in Text(t.description.isEmpty ? t.name : "\(t.name) - \(t.description)").tag(t.id) }
                }
                if types.isEmpty { Text("Wszystkie dostępne właściwości są już dodane.").foregroundStyle(.secondary) }
                if let type {
                    switch type.dataType {
                    case "boolean":
                        Picker("Wartość *", selection: $value) { Text("Wybierz...").tag(""); Text("Tak").tag("true"); Text("Nie").tag("false") }
                    case "select":
                        Picker("Wartość *", selection: $value) {
                            Text("Wybierz...").tag("")
                            ForEach(type.options, id: \.self) { Text($0).tag($0) }
                        }
                    case "number":
                        HStack {
                            TextField("Wartość *", text: $value, prompt: Text("Wartość"))
                            if !type.unit.isEmpty { Text(type.unit).foregroundStyle(.secondary) }
                        }
                    default:
                        TextField("Wartość *", text: $value, prompt: Text("Wartość"))
                    }
                    TextField("Notatki", text: $notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(2...4)
                }
            }
        }
    }

    private func submit() {
        if type?.dataType == "number" && FleetFormat.parse(value) == nil { problem = "Podaj liczbę."; return }
        let stored = type?.dataType == "number" ? value.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces) : value
        Task {
            busy = true
            defer { busy = false }
            let data: [String: JSONValue] = ["typeId": .string(typeID), "value": .string(stored), "notes": .string(notes)]
            if await store.run("Dodawanie właściwości…", "attributeAdd", ["vehicleId": .string(vehicleID), "data": .object(data)], reload: vehicleID) != nil {
                dismiss()
            }
        }
    }
}

// MARK: Wymagana kategoria prawa jazdy

@MainActor struct FleetLicenseSheet: View {
    @ObservedObject var store: FleetStore
    let vehicleID: String
    let categories: [FleetLicenseCategory]
    @Environment(\.dismiss) private var dismiss
    @State private var categoryID = ""
    @State private var required = true
    @State private var notes = ""
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        FleetSheetFrame(title: "Dodaj wymaganie prawa jazdy", subtitle: "", symbol: "shield", submitTitle: "Dodaj", busy: busy,
                        canSubmit: !categoryID.isEmpty, problem: problem, width: 520, height: 420) { submit() } content: {
            Section {
                Picker("Kategoria prawa jazdy", selection: $categoryID) {
                    Text("Wybierz kategorię").tag("")
                    ForEach(categories) { Text("\($0.code) - \($0.name)").tag($0.id) }
                }
                if categories.isEmpty { Text("Wszystkie kategorie są już dodane.").foregroundStyle(.secondary) }
                Toggle("Wymagane", isOn: $required)
                TextField("Notatki (opcjonalnie)", text: $notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(2...4)
            }
        }
    }

    private func submit() {
        Task {
            busy = true
            defer { busy = false }
            let data: [String: JSONValue] = ["categoryId": .string(categoryID), "required": .bool(required), "notes": .string(notes)]
            if await store.run("Dodawanie wymagania…", "licenseAdd", ["vehicleId": .string(vehicleID), "data": .object(data)], reload: vehicleID) != nil {
                dismiss()
            }
        }
    }
}
