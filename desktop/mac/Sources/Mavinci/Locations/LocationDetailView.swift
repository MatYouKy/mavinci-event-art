import SwiftUI
import MapKit

// MARK: Szczegóły obiektu — 1:1 z `/crm/locations/[id]`: nazwa i adres, „Edytuj”, szczegóły (adres, miasto, kraj,
// współrzędne, Google Maps, kontakt), notatki, mapa, informacje (utworzono, zaktualizowano, Google Place ID),
// „Sale i przestrzenie zewnętrzne” (`LocationRooms`) i „Informacje techniczne obiektu” (`LocationTechnicalDetails`).

/// Sala do edycji w arkuszu: istniejąca albo nowa (identyfikator nadany od razu — ponowienie zapisu nie dubluje sali).
struct LocationRoomTarget: Identifiable {
    let id: String
    let room: CrmLocationRoom?
}

@MainActor struct LocationDetailView: View {
    @ObservedObject var store: LocationsStore
    let locationID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editingTechnical = false
    @State private var editingRoom: LocationRoomTarget?
    @State private var removingRoom: CrmLocationRoom?

    private var detail: CrmLocationDetail? { store.details[locationID] }
    private var canManage: Bool { detail?.access.canManage ?? false }

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if let error = store.detailErrors[locationID] {
                ContentUnavailableView {
                    Label("Lokalizacja", systemImage: "mappin.slash")
                } description: {
                    Text(error)
                } actions: {
                    Button("Wróć") { store.openedID = nil }
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(locationID) } }
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .navigationTitle(detail?.location.name ?? "Lokalizacja")
        .navigationSubtitle(detail?.location.formattedAddress ?? "")
        .task(id: "\(locationID)|\(state.employee?.id ?? "")") { await store.loadDetail(locationID) }
        .sheet(isPresented: $editingTechnical) {
            if let detail {
                LocationTechnicalEditorSheet(store: store, locationID: locationID, roomID: nil, room: nil, initial: detail.technical)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: $editingRoom) { target in
            LocationTechnicalEditorSheet(store: store, locationID: locationID, roomID: target.id, room: target.room, initial: target.room?.technical ?? [:])
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń salę", isPresented: Binding(get: { removingRoom != nil }, set: { if !$0 { removingRoom = nil } }), titleVisibility: .visible) {
            if let room = removingRoom {
                Button("Usuń salę", role: .destructive) {
                    Task { await store.run("Usuwanie sali…", "roomDelete", ["id": .string(locationID), "roomId": .string(room.id)], reload: locationID) }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy usunąć salę „\(removingRoom?.name ?? "")”? Sali przypisanej do wydarzenia nie można usunąć.") }
    }

    private func content(_ detail: CrmLocationDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(detail.location)
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 16) {
                        details(detail.location)
                        if !detail.location.notes.isEmpty {
                            LocationPanel(title: "Notatki", symbol: "note.text") {
                                Text(detail.location.notes).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    VStack(alignment: .leading, spacing: 16) {
                        if let latitude = detail.location.latitude, let longitude = detail.location.longitude {
                            LocationPanel(title: "Mapa", symbol: "map") {
                                Map(initialPosition: .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                                                                                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)))) {
                                    Marker(detail.location.name, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
                                }
                                .frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 8))
                                .id("\(latitude),\(longitude)")
                            }
                        }
                        info(detail.location)
                    }
                    .frame(width: 360)
                }
                rooms(detail)
                technical(detail)
            }
            .padding(16)
        }
    }

    private func header(_ location: CrmLocation) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Button { store.openedID = nil } label: { Image(systemName: "chevron.left") }.help("Wróć do listy lokalizacji")
            VStack(alignment: .leading, spacing: 2) {
                Text(location.name).font(.title.weight(.light))
                if !location.formattedAddress.isEmpty { Text(location.formattedAddress).foregroundStyle(.secondary).textSelection(.enabled) }
            }
            Spacer()
            if let url = URL(string: location.googleMapsUrl), !location.googleMapsUrl.isEmpty {
                Button("Otwórz w Google Maps", systemImage: "arrow.up.right.square") { NSWorkspace.shared.open(url) }
            }
            if canManage {
                Button("Edytuj", systemImage: "pencil") { store.editingID = location.id }.buttonStyle(.borderedProminent)
            }
        }
    }

    private func row(_ symbol: String, _ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(value).textSelection(.enabled)
            }
        }
    }

    private func details(_ location: CrmLocation) -> some View {
        LocationPanel(title: "Szczegóły", symbol: "info.circle") {
            VStack(alignment: .leading, spacing: 10) {
                if !location.address.isEmpty { row("building.2", "Adres", location.address) }
                if !location.city.isEmpty { row("mappin", "Miasto", location.cityLine) }
                if !location.country.isEmpty { row("globe", "Kraj", location.country) }
                if let latitude = location.latitude, let longitude = location.longitude {
                    row("location", "Współrzędne", String(format: "%.6f, %.6f", latitude, longitude))
                }
                if !location.nip.isEmpty { row("number", "NIP", location.nip) }
                if !location.contactName.isEmpty { row("person", "Osoba kontaktowa", location.contactName) }
                if !location.contactPhone.isEmpty { row("phone", "Telefon", location.contactPhone) }
                if !location.contactEmail.isEmpty { row("envelope", "E-mail", location.contactEmail) }
                if let url = URL(string: location.googleMapsUrl), !location.googleMapsUrl.isEmpty {
                    Button { NSWorkspace.shared.open(url) } label: { Label("Otwórz w Google Maps", systemImage: "arrow.up.right.square") }.buttonStyle(.link)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func info(_ location: CrmLocation) -> some View {
        LocationPanel(title: "Informacje", symbol: "clock") {
            VStack(alignment: .leading, spacing: 10) {
                if let created = MeetingDates.parse(location.createdAt) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Utworzono").font(.caption).foregroundStyle(.secondary)
                        Text(MeetingDates.format(created, "dd MMMM yyyy, HH:mm"))
                    }
                }
                if location.updatedAt != location.createdAt, let updated = MeetingDates.parse(location.updatedAt) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Zaktualizowano").font(.caption).foregroundStyle(.secondary)
                        Text(MeetingDates.format(updated, "dd MMMM yyyy, HH:mm"))
                    }
                }
                if !location.placeId.isEmpty {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Google Place ID").font(.caption).foregroundStyle(.secondary)
                        Text(location.placeId).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func rooms(_ detail: CrmLocationDetail) -> some View {
        LocationPanel(title: "Sale i przestrzenie zewnętrzne", symbol: "square.split.2x2") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Dodaj sale oraz tereny na zewnątrz, np. ogród lub miejsce teambuildingu. Ta sama baza jest dostępna w wydarzeniach i ofertach sprzedawcy hotelowego.")
                    .font(.callout).foregroundStyle(.secondary)
                if detail.rooms.isEmpty {
                    Text("Nie dodano jeszcze pomieszczeń.").foregroundStyle(.secondary).padding(.vertical, 8)
                } else {
                    HStack {
                        Text("Przestrzeń").frame(maxWidth: .infinity, alignment: .leading)
                        Text("Wejście / piętro").frame(width: 220, alignment: .leading)
                        Text("Materiały").frame(width: 80, alignment: .leading)
                        if canManage { Color.clear.frame(width: 30, height: 1) }
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(detail.rooms) { room in roomRow(room, urls: detail.urls) }
                }
            }
        } trailing: {
            if canManage {
                Button("Dodaj przestrzeń", systemImage: "plus") { editingRoom = LocationRoomTarget(id: UUID().uuidString.lowercased(), room: nil) }
                    .buttonStyle(.borderedProminent).controlSize(.small).disabled(detail.rooms.count >= 100)
            }
        }
    }

    private func roomRow(_ room: CrmLocationRoom, urls: [String: String]) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(room.name).fontWeight(.semibold)
                if room.isOutdoor { Text("Teren na zewnątrz").font(.caption).foregroundStyle(.secondary) }
                DisclosureGroup("Szczegóły i materiały") {
                    LocationTechnicalView(value: room.technical, urls: urls).padding(.top, 6)
                }
                .font(.callout)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(room.notes.nonEmpty ?? "—").foregroundStyle(.secondary).frame(width: 220, alignment: .leading)
            Text("\(room.assetCount)").frame(width: 80, alignment: .leading)
            if canManage {
                Menu {
                    Button("Edytuj", systemImage: "pencil") { editingRoom = LocationRoomTarget(id: room.id, room: room) }
                    Button("Usuń", systemImage: "trash", role: .destructive) { removingRoom = room }
                } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 30)
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    private func technical(_ detail: CrmLocationDetail) -> some View {
        LocationPanel(title: "Informacje techniczne obiektu", symbol: "bolt") {
            LocationTechnicalView(value: detail.technical, urls: detail.urls).frame(maxWidth: .infinity, alignment: .leading)
        } trailing: {
            if canManage {
                Button("Edytuj informacje i materiały", systemImage: "pencil") { editingTechnical = true }.controlSize(.small)
            }
        }
    }
}

/// Karta sekcji z tytułem, ikoną i opcjonalnym przyciskiem po prawej.
@MainActor struct LocationPanel<Content: View, Trailing: View>: View {
    let title: String
    let symbol: String
    let content: Content
    let trailing: Trailing
    @Environment(\.crmTheme) private var theme

    init(title: String, symbol: String, @ViewBuilder content: () -> Content, @ViewBuilder trailing: () -> Trailing) {
        self.title = title; self.symbol = symbol; self.content = content(); self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                Text(title).font(.title3.weight(.light))
                Spacer()
                trailing
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

extension LocationPanel where Trailing == EmptyView {
    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.init(title: title, symbol: symbol, content: content, trailing: { EmptyView() })
    }
}
