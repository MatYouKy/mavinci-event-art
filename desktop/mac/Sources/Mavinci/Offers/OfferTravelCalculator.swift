import SwiftUI
import AppKit

// MARK: Kalkulator trasy i paliwa w logistyce oferty (`OfferLogisticsRoute` + `VehicleTravelCalculator` w CRM): miejsce startu,
// cel z wydarzenia lub oferty albo z katalogu lokalizacji (wyszukiwanie), trasa Google Maps tam i z powrotem, średnia krajowa
// cena paliwa (AutoCentrum) albo cena wpisana ręcznie, spalanie; „Oblicz trasę i koszt” i „Zastosuj koszt” przenoszą dystans,
// cenę i spalanie do wiersza „Paliwo”. Serwer: `GET /bridge/native/v1/offers?op=travel` (`src/lib/native/offerTravel.ts`).

/// Odczyty kalkulatora trasy jednej oferty.
struct OfferTravelService {
    let offerID: String
    let api: NativeAPI

    func decode<T: Decodable>(_ action: String, _ params: [String: String] = [:], as type: T.Type) async throws -> T {
        var query = params
        query["op"] = "travel"
        query["id"] = offerID
        query["action"] = action
        return try JSONDecoder().decode(T.self, from: try await api.get("/offers", query: query))
    }

    static func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return fallback
    }
}

struct OfferTravelPlace: Decodable, Equatable {
    var label: String
    var locationId: String?
    var source: String
}

private struct OfferTravelContext: Decodable {
    var origin: String
    var destination: OfferTravelPlace?
}

private struct OfferTravelLocations: Decodable {
    struct Location: Decodable, Identifiable {
        var id: String
        var name: String?
        var formatted_address: String?
        var address: String?
        var city: String?
        var postal_code: String?
    }
    var locations: [Location]
}

@MainActor struct OfferTravelCalculator: View {
    let service: OfferTravelService
    /// Zapisana trasa wiersza (albo całego szacunku) — `route || value.route`.
    let route: JSONValue?
    /// Zapisana wycena paliwa wiersza (albo ręczna z ceny i spalania).
    let fuel: JSONValue?
    /// Dystans wiersza (km na auto).
    let distance: Double?
    @Binding var busy: Bool
    /// (trasa, wycena paliwa, dystans) — jak `onApply` w `OfferLogisticsRoute`.
    let apply: (JSONValue?, JSONValue?, Double?) -> Void
    @Environment(\.crmTheme) private var theme

    static let defaultOrigin = "Marcina Kasprzaka 15, Olsztyn, Polska"
    private static let fuelTypes: [(id: String, label: String)] = [
        ("benzyna95", "Benzyna 95"), ("benzyna98", "Benzyna 98"), ("diesel", "Olej napędowy"), ("LPG", "LPG"),
    ]
    private static let sourceLabels = ["event": "Z wydarzenia", "offer": "Ze szczegółów oferty", "catalog": "Z katalogu lokalizacji"]

    @State private var prepared = false
    @State private var destination: OfferTravelPlace?
    @State private var override: OfferTravelPlace?
    @State private var loading = true
    @State private var error = ""
    @State private var reload = 0
    @State private var searchOpen = false
    @State private var query = ""
    @State private var locations: [OfferTravelLocations.Location] = []
    @State private var searching = false
    @State private var searchError = ""
    @State private var origin = OfferTravelCalculator.defaultOrigin
    @State private var roundTrip = true
    @State private var initialFuelType: String?
    @State private var fuelOverride: String?
    @State private var manualPrices: [String: String] = [:]
    @State private var manualConsumption: String?
    @State private var quote: JSONValue?
    @State private var fuelError = ""
    @State private var priceLoading = false
    @State private var priceRefresh = 0
    @State private var routeLoading = false
    @State private var routeError = ""
    @State private var shown: JSONValue?

    private var selected: OfferTravelPlace? { override ?? destination }
    private var target: String { loading ? "" : selected?.label ?? "" }
    private var fuelType: String { fuelOverride ?? initialFuelType ?? "diesel" }
    private var isLiquid: Bool { Self.fuelTypes.contains { $0.id == fuelType } }
    private var isElectric: Bool { fuelType == "elektryczny" }
    private var canEstimate: Bool { isLiquid || isElectric }
    private var quotedPrice: Double? {
        if case .number(let value)? = quote?.object["prices"]?.object[fuelType] { return value }
        return nil
    }
    private var price: String { manualPrices[fuelType] ?? (isElectric ? "" : quotedPrice.map { CalculationMath.plain($0, max: 3) } ?? "") }
    private var consumption: String { manualConsumption ?? "" }
    private var cost: Double? {
        guard canEstimate, let distance else { return nil }
        return CalculationMath.fuelCost(distance, CalculationMath.parse(consumption) ?? 0, CalculationMath.parse(price) ?? 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Group {
                Text(isElectric ? "Trasa i koszt energii" : "Trasa i koszt paliwa").font(.headline)
                field("Miejsce startu") {
                    TextField("Miejsce startu", text: Binding(get: { origin }, set: { origin = String($0.prefix(500)); shown = nil }))
                        .textFieldStyle(.roundedBorder).labelsHidden().disabled(routeLoading)
                }
                Text("Cel realizacji: " + (target.isEmpty ? "Brak lokalizacji — uzupełnij ją w Przeglądzie." : target))
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                destinationControls
                Toggle("Uwzględnij powrót do miejsca startu", isOn: Binding(get: { roundTrip }, set: { roundTrip = $0; shown = nil }))
                    .toggleStyle(.checkbox).disabled(routeLoading)
            }
            HStack(alignment: .top, spacing: 12) {
                field("Paliwo") {
                    Picker("Paliwo", selection: Binding(get: { fuelType }, set: { fuelOverride = $0 })) {
                        ForEach(Self.fuelTypes, id: \.id) { option in Text(option.label).tag(option.id) }
                        if !isLiquid { Text(fuelType).tag(fuelType) }
                    }
                    .labelsHidden().disabled(routeLoading)
                }
                field(isElectric ? "Zużycie energii (kWh/100 km)" : "Średnie spalanie (l/100 km)") {
                    TextField(isElectric ? "np. 27" : "Uzupełnij spalanie", text: Binding(get: { consumption }, set: { manualConsumption = $0 }))
                        .textFieldStyle(.roundedBorder).labelsHidden().disabled(!canEstimate || routeLoading)
                }
                field(isElectric ? "Cena prądu (zł/kWh)" : "Cena paliwa (zł/l)") {
                    TextField(isElectric ? "np. 1,10" : priceLoading ? "Pobieranie…" : "Uzupełnij cenę",
                              text: Binding(get: { canEstimate ? price : "" }, set: { manualPrices[fuelType] = $0 }))
                        .textFieldStyle(.roundedBorder).labelsHidden().disabled(!canEstimate || routeLoading)
                }
            }
            if isLiquid {
                Text(manualConsumption != nil ? "Spalanie zapisane dla tej kalkulacji lub wpisane ręcznie."
                     : "Uzupełnij średnie spalanie na karcie auta lub wpisz je dla tego przejazdu.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    priceNote
                    Spacer()
                    Button("Pobierz cenę") {
                        manualPrices[fuelType] = nil
                        priceRefresh += 1
                    }
                    .controlSize(.small).disabled(priceLoading || routeLoading)
                }
                if !fuelError.isEmpty { Text(fuelError).font(.caption).foregroundStyle(.orange) }
            } else if isElectric {
                Text((manualConsumption != nil ? "Zużycie energii wpisane dla tego przejazdu." : "Uzupełnij zużycie energii (kWh/100 km) na karcie auta lub wpisz je dla tego przejazdu.")
                     + " " + (manualPrices[fuelType] != nil ? "Cena prądu wpisana ręcznie." : "Uzupełnij cenę prądu (zł/kWh) na karcie auta lub wpisz ją dla tego przejazdu."))
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Dla tego napędu uzupełnij koszt energii lub paliwa ręcznie w polu kosztu poniżej.").font(.caption).foregroundStyle(.secondary)
            }
            Group {
                HStack(spacing: 8) {
                    Button(routeLoading ? "Obliczanie trasy…" : "Oblicz trasę i koszt") { Task { await calculateRoute() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(routeLoading || origin.trimmingCharacters(in: .whitespaces).isEmpty || target.trimmingCharacters(in: .whitespaces).isEmpty)
                    if let cost {
                        Button("Zastosuj koszt: " + String(format: "%.2f", cost) + " zł") { apply(route, fuelSnapshot(), nil) }.disabled(routeLoading)
                    }
                }
                .controlSize(.small)
                if !routeError.isEmpty { Text(routeError).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                if let shown, case .number(let km)? = shown.object["distanceKm"], distance == km { routeSummary(shown, km) }
                Text((isElectric ? "Koszt = łączny dystans × zużycie kWh / 100 × cena kWh. Po korekcie zużycia lub ceny kliknij „Zastosuj koszt”."
                      : "Koszt = łączny dystans × spalanie / 100 × cena litra. Po korekcie spalania lub ceny kliknij „Zastosuj koszt”.")
                     + " Dystans i koszt zapiszesz przyciskiem „Zapisz logistykę”. Cena AutoCentrum jest ceną brutto; do szacunku przyjmujemy pełny wydatek na paliwo.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let saved = OfferLogisticsMath.routeText(route) {
                    Text("Ostatnie obliczenie: \(saved). Po zmianie celu przelicz trasę ponownie.").font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .disabled(loading)
        .onAppear { prepare() }
        .onDisappear { busy = false }
        .task(id: reload) { await loadDestination() }
        .task(id: priceRefresh) { await loadQuote() }
        .task(id: searchOpen ? query : nil) { await search() }
        .onChange(of: selected) { _, _ in
            shown = nil
            routeError = ""
        }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Wybór celu: miejsce z wydarzenia / oferty albo zapisana lokalizacja z katalogu (do 20 wyników).
    @ViewBuilder private var destinationControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let selected { Text(Self.sourceLabels[selected.source] ?? "Miejsce realizacji").font(.caption).foregroundStyle(.secondary) }
            HStack(spacing: 8) {
                Button(searchOpen ? "Zamknij lokalizacje" : "Wybierz z naszych lokalizacji") { searchOpen.toggle() }.disabled(routeLoading)
                if override != nil {
                    Button("Użyj miejsca z wydarzenia / oferty") { override = nil }.disabled(routeLoading)
                }
            }
            .controlSize(.small)
            if searchOpen {
                TextField("Nazwa, miasto lub adres…", text: $query).textFieldStyle(.roundedBorder).disabled(routeLoading)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        if searching {
                            Text("Wyszukiwanie…").font(.caption).foregroundStyle(.secondary)
                        } else {
                            ForEach(locations) { location in
                                Button { pick(location) } label: {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(location.name ?? "").font(.callout)
                                        Text(location.formatted_address?.nonEmpty
                                             ?? [location.address ?? "", location.postal_code ?? "", location.city ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    .padding(6).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6)).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain).disabled(routeLoading)
                            }
                            if locations.isEmpty && searchError.isEmpty {
                                Text("Brak wyników. Spróbuj innej nazwy lub miasta.").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if !searchError.isEmpty { Text(searchError).font(.caption).foregroundStyle(.red) }
                    }
                }
                .frame(maxHeight: 176)
                Text("Do 20 wyników. Wybór dotyczy tej kalkulacji i nie zmienia wydarzenia.").font(.caption2).foregroundStyle(.tertiary)
            }
            if !error.isEmpty {
                HStack(spacing: 6) {
                    Text(error).font(.caption).foregroundStyle(.red)
                    Button("Odśwież miejsce realizacji") { reload += 1 }.buttonStyle(.link).font(.caption).disabled(routeLoading)
                }
            }
        }
    }

    @ViewBuilder private var priceNote: some View {
        if manualPrices[fuelType] != nil {
            Text("Cena wpisana ręcznie.").font(.caption).foregroundStyle(.secondary)
        } else if quotedPrice != nil, let quote {
            let updated = quote.object["sourceUpdated"]?.text ?? ""
            let fetchedRaw = quote.object["fetchedAt"]?.text ?? ""
            let fetched = MeetingDates.parse(fetchedRaw).map { MeetingDates.format($0, "dd.MM.yyyy, HH:mm:ss") } ?? fetchedRaw
            HStack(spacing: 4) {
                Text("Średnia krajowa:")
                if let url = URL(string: quote.object["source"]?.text ?? "") {
                    Link("AutoCentrum.pl", destination: url)
                } else {
                    Text("AutoCentrum.pl")
                }
                Text(". Aktualizacja źródła: \(updated) w chwili pobrania (\(fetched)).")
            }
            .font(.caption).foregroundStyle(.secondary)
        } else {
            Text(priceLoading ? "Pobieranie cen paliw…" : "Brak ceny dla wybranego paliwa — wpisz ją ręcznie.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func routeSummary(_ route: JSONValue, _ km: Double) -> some View {
        let fields = route.object
        let outbound = fields["outbound"]?.object ?? [:]
        let inbound = fields["inbound"]?.object ?? [:]
        let start = outbound["startAddress"]?.text ?? ""
        let end = outbound["endAddress"]?.text ?? ""
        let minutes = Int(fields["travelMinutes"]?.number ?? 0)
        var line = "Dojazd: " + String(format: "%.1f", (outbound["distanceMeters"]?.number ?? 0) / 1000) + " km · \(minutes) min"
        if !inbound.isEmpty {
            line += " · Powrót: " + String(format: "%.1f", (inbound["distanceMeters"]?.number ?? 0) / 1000) + " km · "
                + "\(Int(ceil((inbound["durationSeconds"]?.number ?? 0) / 60))) min"
        }
        line += " · Łącznie: " + String(format: "%.1f", km) + " km"
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
        .foregroundStyle(.secondary)
    }

    // MARK: Stan

    /// Stan początkowy z zapisanej trasy i wyceny paliwa (jak `useState` w `OfferLogisticsRoute` i kalkulatorze).
    private func prepare() {
        guard !prepared else { return }
        prepared = true
        let saved = route?.object ?? [:]
        origin = saved["origin"]?.text.nonEmpty ?? Self.defaultOrigin
        if saved["source"]?.text == "catalog", let id = saved["location_id"]?.text, !id.isEmpty {
            override = OfferTravelPlace(label: saved["destination"]?.text ?? "", locationId: id, source: "catalog")
        }
        roundTrip = saved["round_trip"] != JSONValue.bool(false)
        let estimate = fuel?.object ?? [:]
        let type = estimate["fuel_type"]?.text.nonEmpty ?? "diesel"
        initialFuelType = type
        if case .number(let value)? = estimate["price"], estimate["price_source"]?.text != "autocentrum" {
            manualPrices[type] = CalculationMath.plain(value, max: 3)
        }
        if case .number(let value)? = estimate["consumption"] { manualConsumption = CalculationMath.plain(value) }
        if let savedQuote = estimate["quote"], !savedQuote.object.isEmpty { quote = savedQuote }
    }

    private func pick(_ location: OfferTravelLocations.Location) {
        let address = location.formatted_address?.nonEmpty ?? [location.address ?? "", location.city ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
        override = OfferTravelPlace(label: [location.name ?? "", address].filter { !$0.isEmpty }.joined(separator: " — "), locationId: location.id, source: "catalog")
        error = ""
        searchOpen = false
    }

    private func fuelSnapshot() -> JSONValue {
        let manual = manualPrices[fuelType] != nil
        let priceValue = CalculationMath.parse(price) ?? 0
        let consumptionValue = CalculationMath.parse(consumption) ?? 0
        return .object([
            "fuel_type": .string(fuelType),
            "price": priceValue > 0 ? JSONValue.number(priceValue) : JSONValue.null,
            "consumption": consumptionValue > 0 ? JSONValue.number(consumptionValue) : JSONValue.null,
            "price_source": .string(manual ? "manual" : isElectric ? "vehicle" : "autocentrum"),
            "quote": manual || isElectric ? JSONValue.null : (quote ?? JSONValue.null),
        ])
    }

    private func loadDestination() async {
        loading = true
        error = ""
        defer { loading = false }
        do {
            let reply = try await service.decode("destination", as: OfferTravelContext.self)
            destination = reply.destination
            if reply.destination == nil && override == nil { searchOpen = true }
        } catch {
            self.error = OfferTravelService.message(error, "Nie udało się pobrać trasy.")
            searchOpen = true
        }
    }

    private func loadQuote() async {
        priceLoading = true
        fuelError = ""
        defer { priceLoading = false }
        do {
            quote = try await service.decode("fuel", as: JSONValue.self)
        } catch {
            quote = nil
            fuelError = OfferTravelService.message(error, "Wpisz cenę paliwa ręcznie.")
        }
    }

    /// Wyszukiwanie lokalizacji po 250 ms od ostatniej zmiany.
    private func search() async {
        guard searchOpen else { return }
        searching = true
        searchError = ""
        locations = []
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        do {
            let reply = try await service.decode("search", ["query": query], as: OfferTravelLocations.self)
            guard !Task.isCancelled else { return }
            locations = reply.locations
        } catch {
            if !Task.isCancelled { searchError = OfferTravelService.message(error, "Nie udało się wyszukać lokalizacji.") }
        }
        if !Task.isCancelled { searching = false }
    }

    /// „Oblicz trasę i koszt”: trasa Google Maps do wybranego celu i zapis dystansu, ceny i spalania w wierszu.
    private func calculateRoute() async {
        guard !routeLoading else { return }
        routeLoading = true
        busy = true
        routeError = ""
        defer {
            routeLoading = false
            busy = false
        }
        var params: [String: String] = ["origin": origin, "roundTrip": roundTrip ? "1" : "0"]
        if let id = override?.locationId { params["locationId"] = id }
        do {
            let reply = try await service.decode("route", params, as: JSONValue.self)
            let fields = reply.object
            guard case .number(let km)? = fields["distanceKm"] else { throw AppError.invalidResponse }
            let outbound = fields["outbound"]?.object ?? [:]
            let inbound = fields["inbound"]?.object ?? [:]
            let seconds = (outbound["durationSeconds"]?.number ?? 0) + (inbound["durationSeconds"]?.number ?? 0)
            let source = fields["source"]?.text ?? ""
            let snapshot: JSONValue = .object([
                "origin": .string(origin),
                "destination": .string(fields["destination"]?.text ?? ""),
                "location_id": (fields["location_id"]?.text.nonEmpty).map { JSONValue.string($0) } ?? JSONValue.null,
                "source": .string(source == "catalog" ? "catalog" : source == "offer" ? "offer" : "event"),
                "distance_km": .number(km),
                "travel_minutes": .number(ceil(seconds / 60)),
                "outbound_km": .number(((outbound["distanceMeters"]?.number ?? 0) / 100).rounded() / 10),
                "inbound_km": .number(((inbound["distanceMeters"]?.number ?? 0) / 100).rounded() / 10),
                "round_trip": .bool(!inbound.isEmpty),
                "resolved_destination": .string(outbound["endAddress"]?.text ?? ""),
                "calculated_at": .string(fields["calculated_at"]?.text.nonEmpty ?? MeetingDates.iso(Date())),
            ])
            shown = reply
            apply(snapshot, fuelSnapshot(), km)
        } catch {
            routeError = OfferTravelService.message(error, "Nie udało się obliczyć trasy.")
        }
    }
}
