import CoreLocation
import MapKit
import SwiftUI

// MARK: „Edytuj klienta” (`EditEventClientModal`) i „Dodaj nową lokalizację” (`AddLocationModal` + `GoogleMapsPicker`)
// — formularze Szczegółów wydarzenia. Zapisy i wyszukiwanie miejsc Google przez moduł `details` (te same tabele co CRM).

struct EventClientPerson: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var email: String?
    var phone: String?
    var position: String?
    var searchText: String { [name, email ?? "", phone ?? ""].joined(separator: " ").lowercased() }
}

private struct EventClientEditorData: Decodable {
    struct Organization: Decodable, Identifiable, Hashable { var id: String; var name: String; var alias: String? }
    struct Assigned: Decodable, Identifiable, Hashable {
        var id: String
        var contactId: String
        var primary: Bool
        var role: String
        var contact: EventClientPerson?
    }
    var clientType: String
    var organizationId: String?
    var contactPersonId: String?
    var organizations: [Organization]
    var individuals: [EventClientPerson]
    var persons: [Assigned]
}

private struct EventBusinessContacts: Decodable { var contacts: [EventClientPerson] }

@MainActor struct EventClientSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: EventClientEditorData?
    @State private var loadError: String?
    @State private var tab = "business"
    @State private var individualID = ""
    @State private var organizationID = ""
    @State private var individualQuery = ""
    @State private var organizationQuery = ""
    @State private var contactQuery = ""
    @State private var businessContacts: [EventClientPerson] = []
    @State private var newIndividual = false
    @State private var newPerson = false
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var position = ""
    @State private var role = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Edytuj klienta").font(.title2.weight(.light))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(saving)
            }
            .padding(20)
            Picker("", selection: $tab) {
                Label("Impreza indywidualna", systemImage: "person").tag("individual")
                Label("Business", systemImage: "building.2").tag("business")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize().padding(.horizontal, 20)
            if let data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if tab == "individual" { individual(data) } else { business(data) }
                    }
                    .padding(20)
                }
            } else if let loadError {
                ContentUnavailableView("Nie udało się wczytać klientów", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(loadError))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).padding(.horizontal, 20) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button(saving ? "Zapisywanie..." : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || data == nil)
            }
            .padding(20)
        }
        .frame(width: 640, height: 720)
        .task { await load() }
        .task(id: organizationID) { await loadBusinessContacts() }
    }

    // MARK: Klient indywidualny

    private func individual(_ data: EventClientEditorData) -> some View {
        let query = individualQuery.trimmingCharacters(in: .whitespaces).lowercased()
        let matches = data.individuals.filter { query.isEmpty || $0.searchText.contains(query) }
        return VStack(alignment: .leading, spacing: 10) {
            Text("Osoba kontaktowa / Klient indywidualny").font(.callout).foregroundStyle(.secondary)
            TextField("Szukaj klienta po nazwisku, e-mailu lub telefonie…", text: $individualQuery).textFieldStyle(.roundedBorder)
            pickList(matches.map { ($0.id, $0.name, [$0.email ?? "", $0.phone ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")) }, selected: individualID) { individualID = $0 }
            Button(newIndividual ? "Anuluj" : "Dodaj nowego klienta", systemImage: newIndividual ? "xmark" : "plus") { newIndividual.toggle(); resetForm() }
                .buttonStyle(.link).linkCursor()
            if newIndividual {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        TextField("Imię *", text: $first).textFieldStyle(.roundedBorder)
                        TextField("Nazwisko *", text: $last).textFieldStyle(.roundedBorder)
                    }
                    HStack {
                        TextField("Email", text: $email).textFieldStyle(.roundedBorder)
                        TextField("Telefon", text: $phone).textFieldStyle(.roundedBorder)
                    }
                    HStack {
                        Spacer()
                        Button("Dodaj klienta") { Task { await createIndividual() } }.disabled(saving)
                    }
                }
                .padding(12).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    // MARK: Firma

    private func business(_ data: EventClientEditorData) -> some View {
        let query = organizationQuery.trimmingCharacters(in: .whitespaces).lowercased()
        let organizations = data.organizations.filter { query.isEmpty || ($0.name + " " + ($0.alias ?? "")).lowercased().contains(query) }
        let assignedIDs = Set(data.persons.map(\.contactId))
        let contactNeedle = contactQuery.trimmingCharacters(in: .whitespaces).lowercased()
        let available = businessContacts.filter { !assignedIDs.contains($0.id) && (contactNeedle.isEmpty || $0.searchText.contains(contactNeedle)) }
        return VStack(alignment: .leading, spacing: 10) {
            Text("Organizacja").font(.callout).foregroundStyle(.secondary)
            TextField("Szukaj firmy po nazwie lub aliasie…", text: $organizationQuery).textFieldStyle(.roundedBorder)
            pickList(organizations.map { ($0.id, $0.alias?.nonEmpty ?? $0.name, $0.alias?.nonEmpty != nil ? $0.name : "") }, selected: organizationID) { organizationID = $0 }
            Text("Osoby kontaktowe").font(.headline).padding(.top, 6)
            if data.persons.isEmpty {
                Text("Brak przypisanych osób kontaktowych").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(data.persons) { assigned in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(assigned.contact?.name ?? "Kontakt")
                                if assigned.primary {
                                    Text("Główna").font(.caption).foregroundStyle(theme.accent)
                                        .padding(.horizontal, 6).padding(.vertical, 1).background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                                }
                            }
                            if let job = assigned.contact?.position?.nonEmpty { Label(job, systemImage: "briefcase").font(.caption).foregroundStyle(.secondary) }
                            if !assigned.role.isEmpty { Text("Rola: " + assigned.role).font(.caption).foregroundStyle(.tertiary) }
                        }
                        Spacer()
                        if !assigned.primary {
                            Button("Ustaw główną") { Task { await run("clientSetPrimary", ["id": .string(assigned.id)], "Główna osoba kontaktowa ustawiona") } }
                                .buttonStyle(.link).linkCursor().font(.caption)
                        }
                        Button(role: .destructive) { Task { await run("clientRemoveContact", ["id": .string(assigned.id)], "Osoba usunięta") } } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                    }
                    .padding(10).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            if !organizationID.isEmpty {
                Button(newPerson ? "Anuluj" : "Dodaj nową osobę", systemImage: newPerson ? "xmark" : "plus") { newPerson.toggle(); resetForm() }
                    .buttonStyle(.link).linkCursor()
                if newPerson {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            TextField("Imię *", text: $first).textFieldStyle(.roundedBorder)
                            TextField("Nazwisko *", text: $last).textFieldStyle(.roundedBorder)
                        }
                        TextField("Stanowisko (np. Dyrektor)", text: $position).textFieldStyle(.roundedBorder)
                        HStack {
                            TextField("Email", text: $email).textFieldStyle(.roundedBorder)
                            TextField("Telefon", text: $phone).textFieldStyle(.roundedBorder)
                        }
                        TextField("Rola w evencie (np. Decydent)", text: $role).textFieldStyle(.roundedBorder)
                        HStack {
                            Spacer()
                            Button("Dodaj osobę") { Task { await createPerson() } }.disabled(saving)
                        }
                    }
                    .padding(12).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                }
                if !businessContacts.isEmpty {
                    TextField("Szukaj osoby kontaktowej…", text: $contactQuery).textFieldStyle(.roundedBorder)
                    ForEach(available) { contact in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(contact.name)
                                let line = [contact.position ?? "", contact.email ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
                                if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            Button("Dodaj", systemImage: "plus") { Task { await run("clientAddContact", ["contactId": .string(contact.id)], "Osoba dodana do eventu") } }
                                .controlSize(.small)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private func pickList(_ rows: [(String, String, String)], selected: String, pick: @escaping (String) -> Void) -> some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(rows, id: \.0) { row in
                    Button { pick(row.0) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.1)
                                if !row.2.isEmpty { Text(row.2).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if row.0 == selected { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(row.0 == selected ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: 170)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Dane

    private func resetForm() {
        first = ""
        last = ""
        email = ""
        phone = ""
        position = ""
        role = ""
    }

    private func load() async {
        do {
            let reply = try await store.tabQuery(eventID, "details", "clientEditor", as: EventClientEditorData.self)
            if data == nil {
                tab = reply.clientType
                individualID = reply.clientType == "individual" ? reply.contactPersonId ?? "" : ""
                organizationID = reply.clientType == "business" ? reply.organizationId ?? "" : ""
            }
            data = reply
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać klientów.")
        }
    }

    private func loadBusinessContacts() async {
        guard !organizationID.isEmpty else { businessContacts = []; return }
        businessContacts = (try? await store.tabQuery(eventID, "details", "businessContacts", ["organizationId": organizationID], as: EventBusinessContacts.self))?.contacts ?? []
    }

    private func run(_ action: String, _ body: [String: JSONValue], _ success: String) async {
        error = nil
        do {
            try await store.tabAction(eventID, "details", action, body, reload: [], success: success, pending: "Zapisywanie…")
            await load()
        } catch {
            self.error = store.failureText(error, "Błąd")
        }
    }

    private func createIndividual() async {
        guard !first.trimmingCharacters(in: .whitespaces).isEmpty, !last.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Imię i nazwisko są wymagane"
            return
        }
        struct Reply: Decodable { var id: String }
        error = nil
        do {
            let reply = try await store.tabAction(eventID, "details", "clientCreateIndividual",
                                                  ["firstName": .string(first), "lastName": .string(last), "email": .string(email), "phone": .string(phone)],
                                                  reload: [], success: "Klient dodany", pending: "Zapisywanie…")
            if let created = try? JSONDecoder().decode(Reply.self, from: reply) { individualID = created.id }
            newIndividual = false
            resetForm()
            await load()
        } catch {
            self.error = store.failureText(error, "Błąd podczas dodawania klienta")
        }
    }

    private func createPerson() async {
        guard !organizationID.isEmpty else { error = "Wybierz najpierw organizację"; return }
        guard !first.trimmingCharacters(in: .whitespaces).isEmpty, !last.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Imię i nazwisko są wymagane"
            return
        }
        error = nil
        do {
            try await store.tabAction(eventID, "details", "clientCreateBusiness",
                                      ["organizationId": .string(organizationID), "firstName": .string(first), "lastName": .string(last), "email": .string(email),
                                       "phone": .string(phone), "position": .string(position), "role": .string(role)],
                                      reload: [], success: "Osoba kontaktowa dodana", pending: "Zapisywanie…")
            newPerson = false
            resetForm()
            await load()
            await loadBusinessContacts()
        } catch {
            self.error = store.failureText(error, "Błąd podczas dodawania osoby")
        }
    }

    private func save() async {
        error = nil
        var body: [String: JSONValue] = ["type": .string(tab)]
        if tab == "individual" {
            guard !individualID.isEmpty else { error = "Wybierz osobę kontaktową"; return }
            body["contactId"] = .string(individualID)
        } else {
            guard !organizationID.isEmpty else { error = "Wybierz organizację"; return }
            guard !(data?.persons.isEmpty ?? true) else { error = "Dodaj przynajmniej jedną osobę kontaktową"; return }
            body["organizationId"] = .string(organizationID)
        }
        saving = true
        defer { saving = false }
        do {
            try await store.tabAction(eventID, "details", "clientSave", body, reload: [], success: "Klient zapisany", pending: "Zapisywanie…")
            await store.loadDetails(eventID)
            dismiss()
        } catch {
            self.error = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}

// MARK: Nowa lokalizacja

private struct PlacePredictions: Decodable {
    struct Prediction: Decodable, Identifiable, Hashable { var placeId: String; var main: String; var secondary: String; var id: String { placeId } }
    var predictions: [Prediction]
}

private struct PlaceDetails: Decodable {
    var name: String
    var latitude: Double?
    var longitude: Double?
    var formattedAddress: String
    var placeId: String
    var googleMapsUrl: String
    var address: String
    var city: String
    var postalCode: String
    var country: String
}

private struct CreatedLocation: Decodable { struct Location: Decodable { var id: String }; var location: Location }

@MainActor struct AddEventLocationSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let onAdded: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var address = ""
    @State private var city = ""
    @State private var postalCode = ""
    @State private var country = "Polska"
    @State private var nip = ""
    @State private var contactName = ""
    @State private var contactPhone = ""
    @State private var contactEmail = ""
    @State private var notes = ""
    @State private var latitude: Double?
    @State private var longitude: Double?
    @State private var googleMapsUrl = ""
    @State private var placeId = ""
    @State private var formattedAddress = ""
    @State private var search = ""
    @State private var predictions: [PlacePredictions.Prediction] = []
    @State private var session = UUID().uuidString
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 53.7784, longitude: 20.4801),
                                                                             span: MKCoordinateSpan(latitudeDelta: 4, longitudeDelta: 4)))
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Dodaj nową lokalizację", systemImage: "mappin.and.ellipse").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(saving)
            }
            .padding(20)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    field("Nazwa *") { TextField("np. Hotel Marriott Warsaw", text: $name).textFieldStyle(.roundedBorder) }
                    HStack(spacing: 12) {
                        field("Adres") { TextField("ul. Przykładowa 1", text: $address).textFieldStyle(.roundedBorder) }
                        field("Miasto") { TextField("Warszawa", text: $city).textFieldStyle(.roundedBorder) }
                    }
                    HStack(spacing: 12) {
                        field("Kod pocztowy") { TextField("00-000", text: $postalCode).textFieldStyle(.roundedBorder) }
                        field("Kraj") { TextField("Polska", text: $country).textFieldStyle(.roundedBorder) }
                        field("NIP") { TextField("", text: $nip).textFieldStyle(.roundedBorder) }
                    }
                    HStack(spacing: 12) {
                        field("Osoba kontaktowa") { TextField("", text: $contactName).textFieldStyle(.roundedBorder) }
                        field("Telefon") { TextField("", text: $contactPhone).textFieldStyle(.roundedBorder) }
                        field("E-mail") { TextField("", text: $contactEmail).textFieldStyle(.roundedBorder) }
                    }
                    field("Notatki") { TextField("", text: $notes, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder) }
                    Text("LOKALIZACJA NA MAPIE").font(.caption.weight(.semibold)).foregroundStyle(theme.accent).padding(.top, 6)
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
                            if let latitude, let longitude {
                                Marker(name.isEmpty ? "Lokalizacja" : name, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
                            }
                        }
                        .onTapGesture { point in
                            if let coordinate = proxy.convert(point, from: .local) { Task { await pin(coordinate) } }
                        }
                    }
                    .frame(height: 260).clipShape(RoundedRectangle(cornerRadius: 10))
                    Text(formattedAddress.isEmpty ? "Wyszukaj miejsce albo kliknij na mapie, aby ustawić punkt." : formattedAddress)
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)
            }
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).padding(.horizontal, 20).padding(.top, 6) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button(saving ? "Zapisywanie..." : "Dodaj lokalizację") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
            .padding(20)
        }
        .frame(width: 680, height: 820)
        .task(id: search) { await lookup() }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Podpowiedzi Google (jak `GoogleMapsPicker`): po krótkiej przerwie w pisaniu.
    private func lookup() async {
        let input = search.trimmingCharacters(in: .whitespaces)
        guard input.count >= 3 else { predictions = []; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        do {
            predictions = try await store.tabQuery(eventID, "details", "placeSearch", ["input": input, "sessiontoken": session], as: PlacePredictions.self).predictions
        } catch {
            predictions = []
            self.error = store.failureText(error, "Nie udało się wyszukać miejsca.")
        }
    }

    private func choose(_ prediction: PlacePredictions.Prediction) async {
        do {
            let place = try await store.tabQuery(eventID, "details", "placeDetails", ["placeId": prediction.placeId, "sessiontoken": session], as: PlaceDetails.self)
            session = UUID().uuidString
            predictions = []
            if !place.name.isEmpty { name = place.name }
            if !place.address.isEmpty { address = place.address }
            if !place.city.isEmpty { city = place.city }
            if !place.postalCode.isEmpty { postalCode = place.postalCode }
            if !place.country.isEmpty { country = place.country }
            latitude = place.latitude
            longitude = place.longitude
            googleMapsUrl = place.googleMapsUrl
            placeId = place.placeId
            formattedAddress = place.formattedAddress
            if let lat = place.latitude, let lng = place.longitude {
                camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)))
            }
        } catch {
            self.error = store.failureText(error, "Nie udało się pobrać szczegółów miejsca.")
        }
    }

    /// Kliknięcie w mapę: punkt i adres z geokodowania (bez nazwy miejsca — jak w CRM).
    private func pin(_ coordinate: CLLocationCoordinate2D) async {
        latitude = coordinate.latitude
        longitude = coordinate.longitude
        placeId = ""
        googleMapsUrl = "https://www.google.com/maps?q=\(coordinate.latitude),\(coordinate.longitude)"
        formattedAddress = String(format: "%.6f, %.6f", coordinate.latitude, coordinate.longitude)
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude),
                                                                          preferredLocale: Locale(identifier: "pl_PL"))
        guard let mark = placemarks?.first else { return }
        let street = [mark.thoroughfare ?? "", mark.subThoroughfare ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        if !street.isEmpty { address = street }
        if let locality = mark.locality { city = locality }
        if let postal = mark.postalCode { postalCode = postal }
        if let land = mark.country { country = land }
        let parts = [street, [mark.postalCode ?? "", mark.locality ?? ""].filter { !$0.isEmpty }.joined(separator: " "), mark.country ?? ""].filter { !$0.isEmpty }
        if !parts.isEmpty { formattedAddress = parts.joined(separator: ", ") }
    }

    private func save() async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Nazwa lokalizacji jest wymagana"; return }
        saving = true
        error = nil
        defer { saving = false }
        var body: [String: JSONValue] = [
            "name": .string(name), "address": .string(address), "city": .string(city), "postalCode": .string(postalCode), "country": .string(country),
            "nip": .string(nip), "contactPersonName": .string(contactName), "contactPhone": .string(contactPhone), "contactEmail": .string(contactEmail),
            "notes": .string(notes), "googleMapsUrl": .string(googleMapsUrl), "placeId": .string(placeId), "formattedAddress": .string(formattedAddress),
        ]
        body["latitude"] = latitude.map { JSONValue.number($0) } ?? JSONValue.null
        body["longitude"] = longitude.map { JSONValue.number($0) } ?? JSONValue.null
        do {
            let reply = try await store.tabAction(eventID, "details", "locationCreate", body, reload: [], success: "Lokalizacja została dodana", pending: "Zapisywanie…")
            let created = try JSONDecoder().decode(CreatedLocation.self, from: reply)
            onAdded(created.location.id)
            dismiss()
        } catch {
            self.error = store.failureText(error, "Błąd podczas zapisywania lokalizacji")
        }
    }
}
