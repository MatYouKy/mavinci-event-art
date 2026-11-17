import SwiftUI
import MapKit

// MARK: Formularz lokalizacji — ten sam przy dodawaniu i edycji (`LocationModal` z CRM): nazwa, adres, miasto, kod, kraj,
// NIP i kontakt, notatki, wyszukiwanie miejsc Google (podpowiedzi i szczegóły przez serwer CRM) oraz punkt na mapie
// (kliknięcie — adres z geokodowania). Edycja: „Usuń” i przejście do szczegółów z salami.

private struct LocationFields: Equatable {
    var name = "", address = "", city = "", postalCode = "", country = "Polska", nip = ""
    var contactName = "", contactPhone = "", contactEmail = "", notes = ""
    var latitude: Double?
    var longitude: Double?
    var googleMapsUrl = "", placeId = "", formattedAddress = ""

    init() {}
    init(_ location: CrmLocation) {
        name = location.name; address = location.address; city = location.city; postalCode = location.postalCode
        country = location.country.nonEmpty ?? "Polska"; nip = location.nip; contactName = location.contactName
        contactPhone = location.contactPhone; contactEmail = location.contactEmail; notes = location.notes
        latitude = location.latitude; longitude = location.longitude; googleMapsUrl = location.googleMapsUrl
        placeId = location.placeId; formattedAddress = location.formattedAddress
    }

    var body: [String: JSONValue] {
        [
            "name": .string(name), "address": .string(address), "city": .string(city), "postalCode": .string(postalCode),
            "country": .string(country), "nip": .string(nip), "contactName": .string(contactName), "contactPhone": .string(contactPhone),
            "contactEmail": .string(contactEmail), "notes": .string(notes), "googleMapsUrl": .string(googleMapsUrl),
            "placeId": .string(placeId), "formattedAddress": .string(formattedAddress),
            "latitude": latitude.map { .number($0) } ?? .null, "longitude": longitude.map { .number($0) } ?? .null,
        ]
    }
}

@MainActor struct LocationEditorView: View {
    @ObservedObject var store: LocationsStore
    let locationID: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var fields = LocationFields()
    @State private var original = LocationFields()
    @State private var loaded: Bool
    @State private var search = ""
    @State private var predictions: [CrmPlacePrediction] = []
    @State private var session = UUID().uuidString
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 53.7784, longitude: 20.4801),
                                                                             span: MKCoordinateSpan(latitudeDelta: 4, longitudeDelta: 4)))
    @State private var saving = false
    @State private var problem: String?
    @State private var leaving = false
    @State private var removing = false

    init(store: LocationsStore, locationID: String?) {
        self.store = store
        self.locationID = locationID
        _loaded = State(initialValue: locationID == nil)
    }

    private var isEdit: Bool { locationID != nil }
    private var canManage: Bool { store.access?.canManage ?? false }
    private var dirty: Bool { fields != original }

    var body: some View {
        VStack(spacing: 0) {
            header.padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
            if !loaded {
                if let error = locationID.flatMap({ store.detailErrors[$0] }) {
                    ContentUnavailableView("Lokalizacja", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                HStack(alignment: .top, spacing: 0) {
                    ScrollView { form.padding(18) }
                        .frame(minWidth: 380, idealWidth: 470, maxWidth: 540)
                    Divider()
                    mapPanel.padding(18).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .navigationTitle(isEdit ? "Edytuj lokalizację" : "Dodaj lokalizację")
        .navigationSubtitle(fields.name)
        .task(id: locationID) { await loadExisting() }
        .task(id: search) { await lookup() }
        .confirmationDialog("Porzucić zmiany?", isPresented: $leaving, titleVisibility: .visible) {
            Button("Porzuć zmiany", role: .destructive) { close() }
            Button("Wróć do formularza", role: .cancel) {}
        } message: { Text("Wprowadzone dane nie zostały zapisane.") }
        .confirmationDialog("Usunąć lokalizację?", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { await remove() } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć tę lokalizację?") }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button { leave() } label: { Image(systemName: "chevron.left") }.help("Wróć").disabled(saving)
            Label(isEdit ? "Edytuj lokalizację" : "Dodaj lokalizację", systemImage: "mappin.and.ellipse").font(.title2.weight(.light))
            Spacer()
            if isEdit && canManage {
                Button(role: .destructive) { removing = true } label: { Label("Usuń", systemImage: "trash") }.disabled(saving)
            }
            Button("Anuluj") { leave() }.disabled(saving)
            Button(saving ? "Zapisuję..." : isEdit ? "Zapisz zmiany" : "Dodaj lokalizację") { Task { await save() } }
                .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command).disabled(saving || !loaded || !canManage)
        }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let id = locationID {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Salami i pomieszczeniami zarządzasz w szczegółach obiektu.")
                    Button("Szczegóły i sale →") { close(openDetail: id) }.buttonStyle(.link)
                    Text("Przed przejściem zapisz ewentualne zmiany adresu.").font(.caption).foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            field("Nazwa lokalizacji *") { TextField("np. Hotel Marriott Warsaw", text: $fields.name).textFieldStyle(.roundedBorder) }
            field("Adres") { TextField("ul. Przykładowa 1", text: $fields.address).textFieldStyle(.roundedBorder) }
            HStack(spacing: 12) {
                field("Miasto") { TextField("Warszawa", text: $fields.city).textFieldStyle(.roundedBorder) }
                field("Kod pocztowy") { TextField("00-000", text: $fields.postalCode).textFieldStyle(.roundedBorder) }.frame(width: 120)
            }
            HStack(spacing: 12) {
                field("Kraj") { TextField("Polska", text: $fields.country).textFieldStyle(.roundedBorder) }
                field("NIP") { TextField("", text: $fields.nip).textFieldStyle(.roundedBorder) }
            }
            field("Osoba kontaktowa") { TextField("", text: $fields.contactName).textFieldStyle(.roundedBorder) }
            HStack(spacing: 12) {
                field("Telefon") { TextField("", text: $fields.contactPhone).textFieldStyle(.roundedBorder) }
                field("E-mail") { TextField("", text: $fields.contactEmail).textFieldStyle(.roundedBorder) }
            }
            field("Notatki") {
                TextField("Dodatkowe informacje...", text: $fields.notes, axis: .vertical).lineLimit(4...8).textFieldStyle(.roundedBorder)
            }
            if !fields.googleMapsUrl.isEmpty || fields.latitude != nil {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Wybrana lokalizacja").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                    Text(fields.formattedAddress.nonEmpty ?? "Punkt na mapie").font(.callout)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var mapPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("LOKALIZACJA NA MAPIE").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
            TextField("Wyszukaj miejsce w Mapach Google…", text: $search).textFieldStyle(.roundedBorder)
            if !predictions.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(predictions) { prediction in
                        Button { Task { await choose(prediction) } } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(prediction.main)
                                if !prediction.secondary.isEmpty { Text(prediction.secondary).font(.caption).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            MapReader { proxy in
                Map(position: $camera) {
                    if let latitude = fields.latitude, let longitude = fields.longitude {
                        Marker(fields.name.isEmpty ? "Lokalizacja" : fields.name, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
                    }
                }
                .onTapGesture { point in
                    if let coordinate = proxy.convert(point, from: .local) { Task { await pin(coordinate) } }
                }
            }
            .frame(minHeight: 320, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            HStack {
                Text(fields.formattedAddress.isEmpty ? "Wyszukaj miejsce albo kliknij na mapie, aby ustawić punkt." : fields.formattedAddress)
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                if fields.latitude != nil {
                    Button("Usuń punkt z mapy") {
                        fields.latitude = nil; fields.longitude = nil; fields.googleMapsUrl = ""; fields.placeId = ""; fields.formattedAddress = ""
                    }
                    .buttonStyle(.link).font(.caption)
                }
            }
        }
    }

    private func center(_ latitude: Double?, _ longitude: Double?) {
        guard let latitude, let longitude else { return }
        camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude), span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)))
    }

    private func loadExisting() async {
        guard let id = locationID else { return }
        if store.details[id] == nil { await store.loadDetail(id) }
        guard let detail = store.details[id] else { return }
        fields = LocationFields(detail.location)
        original = fields
        center(fields.latitude, fields.longitude)
        loaded = true
    }

    /// Podpowiedzi Google (jak `GoogleMapsPicker`): po krótkiej przerwie w pisaniu.
    private func lookup() async {
        let input = search.trimmingCharacters(in: .whitespaces)
        guard input.count >= 3 else { predictions = []; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        do {
            predictions = try await store.placeSearch(input, session: session)
        } catch {
            predictions = []
            problem = store.failureText(error, "Nie udało się wyszukać miejsca.")
        }
    }

    /// Wybrane miejsce uzupełnia formularz (jak `onLocationSelect` w CRM — także nazwę, gdy Google ją zna).
    private func choose(_ prediction: CrmPlacePrediction) async {
        do {
            let place = try await store.placeDetails(prediction.placeId, session: session)
            session = UUID().uuidString
            predictions = []
            if !place.name.isEmpty { fields.name = place.name }
            if !place.address.isEmpty { fields.address = place.address }
            if !place.city.isEmpty { fields.city = place.city }
            if !place.postalCode.isEmpty { fields.postalCode = place.postalCode }
            if !place.country.isEmpty { fields.country = place.country }
            fields.latitude = place.latitude
            fields.longitude = place.longitude
            if !place.googleMapsUrl.isEmpty { fields.googleMapsUrl = place.googleMapsUrl }
            fields.placeId = place.placeId
            if !place.formattedAddress.isEmpty { fields.formattedAddress = place.formattedAddress }
            center(place.latitude, place.longitude)
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać szczegółów miejsca.")
        }
    }

    /// Kliknięcie w mapę: punkt i adres z geokodowania (bez nazwy miejsca).
    private func pin(_ coordinate: CLLocationCoordinate2D) async {
        fields.latitude = coordinate.latitude
        fields.longitude = coordinate.longitude
        fields.placeId = ""
        fields.googleMapsUrl = "https://www.google.com/maps?q=\(coordinate.latitude),\(coordinate.longitude)"
        fields.formattedAddress = String(format: "%.6f, %.6f", coordinate.latitude, coordinate.longitude)
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude),
                                                                          preferredLocale: Locale(identifier: "pl_PL"))
        guard let mark = placemarks?.first else { return }
        let street = [mark.thoroughfare ?? "", mark.subThoroughfare ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        if !street.isEmpty { fields.address = street }
        if let locality = mark.locality { fields.city = locality }
        if let postal = mark.postalCode { fields.postalCode = postal }
        if let land = mark.country { fields.country = land }
        let parts = [street, [mark.postalCode ?? "", mark.locality ?? ""].filter { !$0.isEmpty }.joined(separator: " "), mark.country ?? ""].filter { !$0.isEmpty }
        if !parts.isEmpty { fields.formattedAddress = parts.joined(separator: ", ") }
    }

    private func leave() {
        if dirty { leaving = true } else { close() }
    }

    /// Zamknięcie formularza: powrót tam, skąd go otwarto (lista albo szczegóły), albo do wskazanych szczegółów.
    private func close(openDetail id: String? = nil) {
        store.creating = false
        store.editingID = nil
        if let id { store.openedID = id }
    }

    private func save() async {
        guard !fields.name.trimmingCharacters(in: .whitespaces).isEmpty else { problem = "Nazwa lokalizacji jest wymagana"; return }
        problem = nil
        saving = true
        defer { saving = false }
        var body = fields.body
        if let locationID { body["id"] = .string(locationID) }
        guard let reply = await store.run("Zapisywanie lokalizacji…", "save", body, reload: locationID),
              let id = reply["id"]?.text.nonEmpty else { return }
        original = fields
        // Nowy obiekt — od razu szczegóły (sale, informacje techniczne); edycja — powrót tam, skąd ją otwarto.
        close(openDetail: isEdit ? nil : id)
    }

    private func remove() async {
        guard let id = locationID else { return }
        if await store.remove("Usuwanie lokalizacji…", id: id) {
            store.openedID = nil
            close()
        }
    }
}
