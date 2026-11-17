import SwiftUI
import MapKit

// MARK: Lokalizacje — widok „Mapa” (tylko w aplikacji): pinezki obiektów z zapisanym punktem (szerokość i długość geograficzna
// z formularza lokalizacji), te same filtry i wyszukiwanie co lista. Kliknięcie pinezki pokazuje kartę obiektu („Szczegóły
// i sale”, edycja, Google Maps); obiekty bez punktu są w menu pod mapą. Mapa płaska (bez rzeźby terenu — pinezki nie
// „pływają” przy ruchu), pinezki i kadr liczone tylko przy zmianie listy, nie przy każdym odświeżeniu widoku.

/// Pinezka obiektu z poprawnymi współrzędnymi.
struct LocationMapPin: Identifiable, Equatable {
    let id: String
    let name: String
    let coordinate: CLLocationCoordinate2D

    static func == (lhs: LocationMapPin, rhs: LocationMapPin) -> Bool {
        lhs.id == rhs.id && lhs.name == rhs.name
            && lhs.coordinate.latitude == rhs.coordinate.latitude && lhs.coordinate.longitude == rhs.coordinate.longitude
    }

    /// `nil` — brak punktu albo współrzędne poza zakresem (0, 0 traktujemy jak brak punktu).
    static func make(_ location: CrmLocation) -> LocationMapPin? {
        guard let latitude = location.latitude, let longitude = location.longitude,
              (-90...90).contains(latitude), (-180...180).contains(longitude), latitude != 0 || longitude != 0 else { return nil }
        return LocationMapPin(id: location.id, name: location.name, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
    }
}

@MainActor struct LocationsMapView: View {
    let locations: [CrmLocation]
    let actions: LocationRowActions
    @Environment(\.crmTheme) private var theme
    @State private var camera: MapCameraPosition = .automatic
    @State private var selected: String?
    /// Pinezki zapamiętane — przeliczane tylko, gdy zmienią się obiekty, nazwy albo współrzędne (`signature`).
    @State private var pins: [LocationMapPin] = []
    @AppStorage("locations.mapSatellite") private var satellite = false

    private var missing: [CrmLocation] { locations.filter { LocationMapPin.make($0) == nil } }
    /// Zmiana listy na mapie: identyfikator, nazwa i punkt każdego obiektu.
    private var signature: [String] {
        locations.map { "\($0.id)|\($0.name)|\($0.latitude ?? 0)|\($0.longitude ?? 0)" }
    }
    private var selectedLocation: CrmLocation? {
        guard let selected else { return nil }
        return locations.first { $0.id == selected }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            map
            footer
        }
        .onAppear { refresh(animated: false) }
        .onChange(of: signature) { _, _ in refresh(animated: true) }
    }

    /// Nowe pinezki i kadr obejmujący wszystkie (stały prostokąt zamiast `.automatic`, który dopasowywał się przy każdym
    /// przerysowaniu i poruszał mapą).
    private func refresh(animated: Bool) {
        let next: [LocationMapPin] = locations.compactMap(LocationMapPin.make)
        pins = next
        if let selected, !next.contains(where: { $0.id == selected }) { self.selected = nil }
        let position: MapCameraPosition = Self.fit(next)
        if animated { withAnimation { camera = position } } else { camera = position }
    }

    /// Prostokąt mapy obejmujący pinezki z marginesem (pojedynczy obiekt — okolica ok. 3 km).
    private static func fit(_ pins: [LocationMapPin]) -> MapCameraPosition {
        guard let first = pins.first else { return .automatic }
        var rect = MKMapRect(origin: MKMapPoint(first.coordinate), size: MKMapSize(width: 0, height: 0))
        for pin in pins.dropFirst() {
            let point = MKMapPoint(pin.coordinate)
            rect = rect.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
        }
        let minimum: Double = 3_000 * MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
        let padX: Double = max(rect.size.width * 0.15, minimum / 2)
        let padY: Double = max(rect.size.height * 0.15, minimum / 2)
        return .rect(rect.insetBy(dx: -padX, dy: -padY))
    }

    private var map: some View {
        Map(position: $camera, selection: $selected) {
            ForEach(pins) { pin in
                Marker(pin.name, systemImage: "mappin", coordinate: pin.coordinate)
                    .tint(theme.accent)
                    .tag(pin.id)
            }
        }
        .mapStyle(satellite ? .hybrid(elevation: .flat) : .standard(elevation: .flat))
        .mapControls {
            MapZoomStepper()
            MapCompass()
            MapScaleView()
        }
        .overlay(alignment: .topLeading) { selectionCard }
        .overlay { emptyNotice }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 360)
    }

    @ViewBuilder private var selectionCard: some View {
        if let location = selectedLocation {
            LocationMapCard(location: location, actions: actions) { selected = nil }
                .padding(12)
        }
    }

    @ViewBuilder private var emptyNotice: some View {
        if pins.isEmpty {
            ContentUnavailableView("Brak punktów na mapie", systemImage: "mappin.slash",
                                   description: Text("Żadna z widocznych lokalizacji nie ma zapisanego punktu. Ustaw go w formularzu lokalizacji (wyszukiwanie Google albo kliknięcie na mapie)."))
                .padding(24)
                .background(theme.card.opacity(0.92), in: RoundedRectangle(cornerRadius: 12))
                .padding(40)
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Label("Na mapie: \(pins.count) z \(locations.count)", systemImage: "mappin.and.ellipse").foregroundStyle(.secondary)
            if !missing.isEmpty {
                Menu {
                    ForEach(missing) { location in
                        Button(location.name) { actions.open(location) }
                    }
                } label: {
                    Label("Bez punktu na mapie: \(missing.count)", systemImage: "mappin.slash")
                }
                .menuStyle(.borderlessButton).fixedSize()
                .help("Lokalizacje bez zapisanych współrzędnych — kliknij, aby otworzyć szczegóły")
            }
            Spacer()
            Picker("Rodzaj mapy", selection: $satellite) {
                Text("Mapa").tag(false)
                Text("Satelita").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Button { withAnimation { camera = Self.fit(pins) } } label: { Label("Pokaż wszystkie", systemImage: "arrow.up.left.and.arrow.down.right") }
                .help("Dopasuj mapę do wszystkich pinezek")
                .disabled(pins.isEmpty)
        }
        .font(.callout)
    }
}

/// Karta wybranej pinezki: nazwa, adres, kontakt, sale i czynności jak na liście.
@MainActor struct LocationMapCard: View {
    let location: CrmLocation
    let actions: LocationRowActions
    let close: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "mappin").font(.title3).foregroundStyle(theme.accent)
                    .frame(width: 34, height: 34).background(theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(location.name).font(.headline).lineLimit(2)
                    if !location.cityLine.isEmpty { Text(location.cityLine).font(.callout).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 8)
                Button(action: close) { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Zamknij")
            }
            details
            HStack(spacing: 8) {
                Button("Szczegóły i sale") { actions.open(location) }.buttonStyle(.borderedProminent)
                if actions.canManage {
                    Button("Edytuj") { actions.edit(location) }
                }
                if let url = URL(string: location.googleMapsUrl), !location.googleMapsUrl.isEmpty {
                    Button("Google Maps") { NSWorkspace.shared.open(url) }
                }
            }
            .controlSize(.small)
        }
        .padding(14)
        .frame(width: 340, alignment: .leading)
        .background(theme.card.opacity(0.97), in: RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !location.address.isEmpty { Label(location.address, systemImage: "building.2").lineLimit(2) }
            if !location.contactName.isEmpty { Label(location.contactName, systemImage: "person").lineLimit(1) }
            if !location.contactPhone.isEmpty { Label(location.contactPhone, systemImage: "phone").lineLimit(1) }
            if let rooms = location.rooms, rooms > 0 { Label("Sale i przestrzenie: \(rooms)", systemImage: "square.split.2x2").lineLimit(1) }
        }
        .font(.callout).foregroundStyle(.secondary)
    }
}
