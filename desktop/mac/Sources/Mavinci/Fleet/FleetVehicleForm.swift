import SwiftUI

// MARK: Formularz pojazdu — ten sam przy dodawaniu i edycji (`/crm/fleet/new`, `/crm/fleet/[id]/edit`): dane podstawowe,
// dane techniczne (samochód) albo wymiary i ładowność (przyczepa), przebieg, koszty i wartość (z leasingiem), lokalizacja,
// dodatkowe informacje. Liczby jako tekst (przecinek albo kropka) — walidację robi serwer jak CRM.

struct FleetVehicleDraft: Equatable {
    var vehicleType = "car"
    var name = ""
    var brand = ""
    var model = ""
    var registration = ""
    var vin = ""
    var year = String(Calendar.current.component(.year, from: Date()))
    var color = ""
    var engineType = ""
    var engineCapacity = ""
    var powerHp = ""
    var powerKw = ""
    var fuelType = "diesel"
    var averageConsumption = ""
    var energyPrice = ""
    var transmission = "manualna"
    var driveType = ""
    var seats = ""
    var maxLoad = ""
    var cargoLength = ""
    var cargoWidth = ""
    var cargoHeight = ""
    var totalLength = ""
    var totalWidth = ""
    var totalHeight = ""
    var weight = ""
    var status = "available"
    var ownership = "owned"
    var category = "van"
    var towHitch = false
    var purchasePrice = ""
    var purchaseDate: Date? = nil
    var currentValue = ""
    var leasingCompany = ""
    var leasingMonthly = ""
    var leasingEnd: Date? = nil
    var initialMileage = ""
    var mileage = ""
    var currentLocation = ""
    var parkingLocation = ""
    var garageLocation = ""
    var description = ""
    var notes = ""

    init() {}
    init(_ v: FleetVehicleInfo) {
        vehicleType = v.vehicleType; name = v.name; brand = v.brand; model = v.model; registration = v.registration; vin = v.vin
        year = v.year.map { String($0) } ?? ""; color = v.color; engineType = v.engineType; engineCapacity = FleetFormat.field(v.engineCapacity)
        powerHp = FleetFormat.field(v.powerHp); powerKw = FleetFormat.field(v.powerKw); fuelType = v.fuelType.nonEmpty ?? "diesel"
        averageConsumption = FleetFormat.field(v.averageConsumption); energyPrice = FleetFormat.field(v.energyPrice); transmission = v.transmission.nonEmpty ?? "manualna"
        driveType = v.driveType; seats = FleetFormat.field(v.seats); maxLoad = FleetFormat.field(v.maxLoad)
        cargoLength = FleetFormat.field(v.cargoLength); cargoWidth = FleetFormat.field(v.cargoWidth); cargoHeight = FleetFormat.field(v.cargoHeight)
        totalLength = FleetFormat.field(v.totalLength); totalWidth = FleetFormat.field(v.totalWidth); totalHeight = FleetFormat.field(v.totalHeight); weight = FleetFormat.field(v.weight)
        // Edycja w CRM pokazuje `active` jako „Dostępny”.
        status = v.status == "active" ? "available" : (v.status.nonEmpty ?? "available")
        ownership = v.ownership.nonEmpty ?? "owned"; category = v.category.nonEmpty ?? (v.isTrailer ? "plandeka" : "van"); towHitch = v.towHitch
        purchasePrice = FleetFormat.field(v.purchasePrice); purchaseDate = DayDates.parse(v.purchaseDate); currentValue = FleetFormat.field(v.currentValue)
        leasingCompany = v.leasingCompany; leasingMonthly = FleetFormat.field(v.leasingMonthly); leasingEnd = DayDates.parse(v.leasingEnd)
        initialMileage = FleetFormat.field(v.initialMileage); mileage = String(v.mileage)
        currentLocation = v.currentLocation; parkingLocation = v.parkingLocation; garageLocation = v.garageLocation
        description = v.description; notes = v.notes
    }

    var isTrailer: Bool { vehicleType == "trailer" }
    var missingRequired: Bool { [name, brand, model].contains { $0.trimmingCharacters(in: .whitespaces).isEmpty } }

    var json: [String: JSONValue] {
        let day: (Date?) -> JSONValue = { date in date.map { JSONValue.string(DayDates.string($0)) } ?? JSONValue.null }
        return [
            "vehicleType": .string(vehicleType), "name": .string(name), "brand": .string(brand), "model": .string(model),
            "registration": .string(registration), "vin": .string(vin), "year": .string(year), "color": .string(color),
            "engineType": .string(engineType), "engineCapacity": .string(engineCapacity), "powerHp": .string(powerHp), "powerKw": .string(powerKw),
            "fuelType": .string(fuelType), "averageConsumption": .string(averageConsumption), "energyPrice": .string(energyPrice),
            "transmission": .string(transmission), "driveType": .string(driveType), "seats": .string(seats), "maxLoad": .string(maxLoad),
            "cargoLength": .string(cargoLength), "cargoWidth": .string(cargoWidth), "cargoHeight": .string(cargoHeight),
            "totalLength": .string(totalLength), "totalWidth": .string(totalWidth), "totalHeight": .string(totalHeight), "weight": .string(weight),
            "status": .string(status), "ownership": .string(ownership), "category": .string(category), "towHitch": .bool(towHitch),
            "purchasePrice": .string(purchasePrice), "purchaseDate": day(purchaseDate), "currentValue": .string(currentValue),
            "leasingCompany": .string(leasingCompany), "leasingMonthly": .string(leasingMonthly), "leasingEnd": day(leasingEnd),
            "initialMileage": .string(initialMileage), "mileage": .string(mileage), "currentLocation": .string(currentLocation),
            "parkingLocation": .string(parkingLocation), "garageLocation": .string(garageLocation), "description": .string(description),
            "notes": .string(notes),
        ]
    }
}

@MainActor struct FleetVehicleForm: View {
    @Binding var draft: FleetVehicleDraft
    let dictionaries: FleetDictionaries?
    let isNew: Bool
    /// Bieżący status spoza listy formularza (np. „Brak ważnego OC” ustawiany przez alerty) — zostaje do wyboru.
    var currentStatus: FleetOption? = nil

    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }
    private var threeColumns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .topLeading), count: 3) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Dane podstawowe") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    if isNew {
                        picker("Typ pojazdu *", Binding(get: { draft.vehicleType }, set: { value in
                            draft.vehicleType = value
                            draft.category = value == "trailer" ? "plandeka" : "van"
                        }), [FleetOption(value: "car", label: "Samochód"), FleetOption(value: "trailer", label: "Przyczepa")])
                    }
                    Group {
                        input(draft.isTrailer ? "Nazwa przyczepy *" : "Nazwa pojazdu *", $draft.name, prompt: "np. Bus Eventowy Główny")
                        input("Marka *", $draft.brand, prompt: "np. Mercedes-Benz")
                        input("Model *", $draft.model, prompt: "np. Sprinter 519 CDI")
                        input("Numer rejestracyjny", $draft.registration, prompt: "np. KR 12345")
                    }
                    Group {
                        input("VIN", $draft.vin, prompt: "17-znakowy numer VIN")
                        input("Rok produkcji", $draft.year)
                        input("Kolor", $draft.color, prompt: "np. Biały")
                    }
                    picker("Kategoria", $draft.category, (draft.isTrailer ? dictionaries?.trailerCategories : dictionaries?.carCategories) ?? [])
                    picker("Status", $draft.status, statuses)
                    picker("Typ własności", $draft.ownership, dictionaries?.ownership ?? [])
                }
            }
            if draft.isTrailer {
                TeamCard(title: "Wymiary i ładowność") {
                    Text("Wymiary części załadunkowej").font(.callout.weight(.medium))
                    LazyVGrid(columns: threeColumns, alignment: .leading, spacing: 12) {
                        input("Długość (cm)", $draft.cargoLength, prompt: "np. 600")
                        input("Szerokość (cm)", $draft.cargoWidth, prompt: "np. 240")
                        input("Wysokość (cm)", $draft.cargoHeight, prompt: "np. 280")
                    }
                    Text("Wymiary całkowite (bezwzględne)").font(.callout.weight(.medium))
                    LazyVGrid(columns: threeColumns, alignment: .leading, spacing: 12) {
                        input("Długość całkowita (cm)", $draft.totalLength, prompt: "np. 720")
                        input("Szerokość całkowita (cm)", $draft.totalWidth, prompt: "np. 255")
                        input("Wysokość całkowita (cm)", $draft.totalHeight, prompt: "np. 300")
                    }
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        input("Maks. ładowność (kg)", $draft.maxLoad, prompt: "np. 1500")
                        input("Waga własna (kg)", $draft.weight, prompt: "np. 750")
                    }
                }
            } else {
                TeamCard(title: "Dane techniczne") {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        Group {
                            input("Typ silnika", $draft.engineType, prompt: "np. diesel")
                            input("Pojemność (cm³)", $draft.engineCapacity, prompt: "np. 2143")
                            input("Moc (KM)", $draft.powerHp, prompt: "np. 190")
                            input("Moc (kW)", $draft.powerKw, prompt: "np. 140")
                        }
                        picker("Typ paliwa", $draft.fuelType, dictionaries?.fuelTypes ?? [])
                        VStack(alignment: .leading, spacing: 3) {
                            input(draft.fuelType == "elektryczny" ? "Średnie zużycie energii (kWh/100 km)" : "Średnie spalanie (l/100 km)",
                                  $draft.averageConsumption, prompt: draft.fuelType == "elektryczny" ? "np. 27" : "np. 9,5")
                            Text(draft.fuelType == "elektryczny" ? "Kalkulator trasy liczy z niego koszt energii." : "Kalkulator trasy liczy z niego koszt paliwa.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if draft.fuelType == "elektryczny" {
                            VStack(alignment: .leading, spacing: 3) {
                                input("Cena prądu (zł/kWh)", $draft.energyPrice, prompt: "np. 1,10")
                                Text("Cena brutto za kWh przy ładowaniu (np. z rachunku). Kalkulator trasy liczy z niej koszt przejazdu.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Group {
                            picker("Skrzynia biegów", $draft.transmission, dictionaries?.transmissions ?? [])
                            input("Napęd", $draft.driveType, prompt: "np. przedni, tylny, 4x4")
                            input("Liczba miejsc", $draft.seats, prompt: "np. 9")
                            input("Maks. ładowność (kg)", $draft.maxLoad, prompt: "np. 1500")
                        }
                        picker("Posiada Hak", Binding(get: { draft.towHitch ? "true" : "false" }, set: { draft.towHitch = $0 == "true" }),
                               [FleetOption(value: "true", label: "Tak"), FleetOption(value: "false", label: "Nie")])
                    }
                }
                TeamCard(title: "Przebieg") {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        input("Przebieg początkowy (km)", $draft.initialMileage, prompt: "0")
                        input("Przebieg aktualny (km)", $draft.mileage, prompt: "0")
                    }
                }
            }
            TeamCard(title: "Koszty i wartość") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    input("Cena zakupu (zł)", $draft.purchasePrice, prompt: "0")
                    OptionalDateField(title: "Data zakupu", date: $draft.purchaseDate)
                    input("Wartość bieżąca (zł)", $draft.currentValue, prompt: "0")
                    if draft.ownership == "leased" {
                        input("Firma leasingowa", $draft.leasingCompany)
                        input("Rata leasingowa (zł/mies.)", $draft.leasingMonthly, prompt: "0")
                        OptionalDateField(title: "Koniec leasingu", date: $draft.leasingEnd)
                    }
                }
            }
            TeamCard(title: "Lokalizacja") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    input("Aktualna lokalizacja", $draft.currentLocation, prompt: "np. Magazyn Kraków")
                    input("Miejsce parkowania", $draft.parkingLocation, prompt: "np. Parking A, miejsce 12")
                    input("Garaż/Baza", $draft.garageLocation, prompt: "np. Baza główna")
                }
            }
            TeamCard(title: "Dodatkowe informacje") {
                input("Opis", $draft.description, prompt: "Krótki opis pojazdu...", vertical: true)
                input("Notatki", $draft.notes, prompt: "Dodatkowe notatki, uwagi...", vertical: true)
            }
        }
    }

    private var statuses: [FleetOption] {
        var all = dictionaries?.statuses ?? []
        if let currentStatus, !all.contains(where: { $0.value == currentStatus.value }) { all.append(currentStatus) }
        return all
    }

    private func input(_ label: String, _ text: Binding<String>, prompt: String? = nil, vertical: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            if vertical {
                TextField("", text: text, prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            } else {
                TextField("", text: text, prompt: prompt.map { Text($0) }).textFieldStyle(.roundedBorder)
            }
        }
    }

    private func picker(_ label: String, _ selection: Binding<String>, _ options: [FleetOption]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Picker(label, selection: selection) {
                ForEach(options) { Text($0.label).tag($0.value) }
                // Wartość spoza słownika (dane z CRM) — pokazujemy ją, żeby zapis jej nie zmienił.
                if !selection.wrappedValue.isEmpty && !options.contains(where: { $0.value == selection.wrappedValue }) {
                    Text(selection.wrappedValue).tag(selection.wrappedValue)
                }
            }
            .labelsHidden()
        }
    }
}
