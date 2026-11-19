import Foundation

// MARK: Lokalizacje — odpowiedzi `/bridge/native/v1/locations` (`src/lib/native/locations.ts`) i szkic informacji
// technicznych obiektu / sali (`TechnicalDetailsEditor` + `LocationPowerDetailsFields` z CRM).

struct CrmLocationAccess: Decodable, Hashable {
    var canManage: Bool
}

struct CrmLocation: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var address: String
    var city: String
    var postalCode: String
    var country: String
    var nip: String
    var contactName: String
    var contactPhone: String
    var contactEmail: String
    var notes: String
    var latitude: Double?
    var longitude: Double?
    var googleMapsUrl: String
    var placeId: String
    var formattedAddress: String
    var createdAt: String
    var updatedAt: String
    /// Liczba sal (tylko lista).
    var rooms: Int?

    /// „10-001 Olsztyn”.
    var cityLine: String { [postalCode, city].filter { !$0.isEmpty }.joined(separator: " ") }
    /// Wyszukiwanie jak w CRM: nazwa, miasto, adres, osoba kontaktowa.
    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return true }
        return [name, city, address, contactName].contains { $0.localizedCaseInsensitiveContains(q) }
    }
}

struct CrmLocationList: Decodable {
    var access: CrmLocationAccess
    var locations: [CrmLocation]
}

/// Sala lub przestrzeń zewnętrzna obiektu (`locations.rooms`).
struct CrmLocationRoom: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var kind: String
    var notes: String
    var technical: [String: JSONValue]
    var isOutdoor: Bool { kind == "outdoor" }
    var assetCount: Int { technical["assets"]?.array.count ?? 0 }
    /// Wersja sali do kontroli zmian przy zapisie.
    var json: JSONValue {
        .object(["id": .string(id), "name": .string(name), "kind": .string(kind), "notes": .string(notes), "technical": .object(technical)])
    }
}

struct CrmLocationDetail: Decodable {
    var access: CrmLocationAccess
    var location: CrmLocation
    var rooms: [CrmLocationRoom]
    var technical: [String: JSONValue]
    var urls: [String: String]
    /// „Tło ofert” (`locations.offer_background_path`) z podpisanym adresem podglądu; `nil` — brak tła.
    var offerBackground: CrmLocationBackground?
    /// `false` — baza bez migracji „Tła ofert”; starszy serwer CRM nie przysyła pola (`nil`).
    var offerBackgroundReady: Bool?
}

/// „Tło ofert” obiektu: zdjęcie z `location-materials` na okładkę ofert wydarzeń w tym miejscu.
struct CrmLocationBackground: Decodable, Equatable {
    var path: String
    var url: String?
}

/// Zdjęcie z galerii obiektu lub sali — do wyboru jako „Tło ofert”.
struct CrmLocationPhoto: Identifiable {
    var place: String
    var asset: CrmLocationAsset
    var id: String { asset.path }
}

extension CrmLocationDetail {
    /// Zdjęcia obiektu i sal bez powtórzeń (rzuty i pliki CAD pomijamy) — jak „Wybierz z galerii obiektu” w CRM.
    var galleryPhotos: [CrmLocationPhoto] {
        var photos: [CrmLocationPhoto] = []
        let prefix = location.id.lowercased() + "/"
        var sources: [(place: String, technical: [String: JSONValue])] = [(place: "Obiekt", technical: technical)]
        for room in rooms { sources.append((place: room.name.nonEmpty ?? "Sala", technical: room.technical)) }
        for source in sources {
            for value in source.technical["assets"]?.array ?? [] {
                guard let asset = CrmLocationAsset(value), asset.kind == "photo", asset.path.hasPrefix(prefix),
                      [".jpg", ".png", ".webp"].contains(where: { asset.path.hasSuffix($0) }),
                      !photos.contains(where: { $0.asset.path == asset.path }) else { continue }
                photos.append(CrmLocationPhoto(place: source.place, asset: asset))
            }
        }
        return photos
    }
}

struct CrmPlacePrediction: Decodable, Identifiable, Hashable {
    var placeId: String
    var main: String
    var secondary: String
    var id: String { placeId }
}

struct CrmPlaceDetails: Decodable {
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

/// Materiał obiektu lub sali (`location-materials`): rzut / plan albo zdjęcie.
struct CrmLocationAsset: Identifiable, Equatable {
    var path: String
    var name: String
    var kind: String
    var id: String { path }
    init(path: String, name: String, kind: String) { self.path = path; self.name = name; self.kind = kind }
    init?(_ value: JSONValue) {
        let object = value.object
        guard let path = object["path"]?.text.nonEmpty else { return nil }
        self.init(path: path, name: object["name"]?.text ?? "Plik", kind: object["kind"]?.text == "photo" ? "photo" : "plan")
    }
    var json: JSONValue { .object(["path": .string(path), "name": .string(name), "kind": .string(kind)]) }
}

/// Punkt / grupa przyłączy 400 V w formularzu.
struct CrmPowerPointDraft: Identifiable, Equatable {
    var id = UUID().uuidString.lowercased()
    var quantity = ""
    var rating = ""
    var connector = ""
    var position = ""
    var distance = ""
    var notes = ""
}

/// Szkic informacji technicznych — te same pola i ograniczenia co formularz CRM i walidacja w bazie.
struct CrmTechnicalDraft: Equatable {
    static let dimensions: [(key: String, label: String, unit: String)] = [
        ("length_m", "Długość", "m"), ("width_m", "Szerokość", "m"), ("height_m", "Wysokość użytkowa", "m"),
        ("area_m2", "Powierzchnia", "m²"), ("capacity", "Maksymalna liczba osób", "os."),
    ]
    static let texts: [(key: String, label: String, prompt: String)] = [
        ("description", "Dodatkowe informacje", "Np. wyposażenie, układy stołów, liczba miejsc, możliwość zaciemnienia i dostęp do internetu"),
        ("restrictions", "Ograniczenia", "Np. limit głośności, zakaz dymu, godziny dostępu"),
        ("difficulties", "Utrudnienia logistyczne", "Np. schody, brak windy, szerokość drzwi, odległość od rozładunku"),
    ]
    private static let managed: Set<String> = [
        "description", "restrictions", "difficulties", "length_m", "width_m", "height_m", "area_m2", "capacity", "power_supply",
        "power_230v", "power_230v_notes", "power_400v", "power_400v_points", "power_kw", "power_notes", "assets",
    ]

    var base: [String: JSONValue]
    var texts: [String: String] = [:]
    var numbers: [String: String] = [:]
    var powerSupply = ""
    var power230: Bool?
    var power400: Bool?
    var power230Notes = ""
    var powerKw = ""
    var powerNotes = ""
    var points: [CrmPowerPointDraft] = []
    var assets: [CrmLocationAsset] = []

    init(_ json: [String: JSONValue]) {
        base = json
        for item in Self.texts { texts[item.key] = json[item.key]?.text ?? "" }
        for item in Self.dimensions { numbers[item.key] = Self.format(json[item.key]) }
        powerSupply = ["available", "unavailable"].contains(json["power_supply"]?.text ?? "") ? json["power_supply"]!.text : ""
        if case .bool(let value) = json["power_230v"] ?? .null { power230 = value }
        if case .bool(let value) = json["power_400v"] ?? .null { power400 = value }
        power230Notes = json["power_230v_notes"]?.text ?? ""
        powerKw = Self.format(json["power_kw"])
        powerNotes = json["power_notes"]?.text ?? ""
        points = (json["power_400v_points"]?.array ?? []).map { value in
            let point = value.object
            let rating: String
            switch point["rating_a"] ?? .null {
            case .number(let amps): rating = String(Int(amps))
            case .string(let other): rating = other == "other" ? "other" : ""
            default: rating = ""
            }
            return CrmPowerPointDraft(id: point["id"]?.text.nonEmpty ?? UUID().uuidString.lowercased(), quantity: Self.format(point["quantity"]),
                                      rating: rating, connector: point["connector"]?.text ?? "", position: point["position"]?.text ?? "",
                                      distance: Self.format(point["distance_to_stage_m"]), notes: point["notes"]?.text ?? "")
        }
        assets = (json["assets"]?.array ?? []).compactMap { CrmLocationAsset($0) }
    }

    private static let formatter: NumberFormatter = {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.usesGroupingSeparator = false; f.maximumFractionDigits = 3; return f
    }()
    static func format(_ value: JSONValue?) -> String {
        guard case .number(let number) = value ?? .null else { return "" }
        return formatter.string(from: NSNumber(value: number)) ?? String(number)
    }
    static func parse(_ text: String) -> Double? {
        let value = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        return value.isEmpty ? nil : Double(value)
    }

    var unavailable: Bool { powerSupply == "unavailable" }
    var shows230Notes: Bool { power230 == true || !power230Notes.isEmpty }
    var shows400: Bool { power400 == true || !points.isEmpty }

    /// Komunikat jak w bazie / formularzu CRM albo `nil`, gdy można zapisać.
    func problem(pendingFiles: Int) -> String? {
        for item in Self.dimensions {
            let raw = numbers[item.key] ?? ""
            guard !raw.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            guard let value = Self.parse(raw), value > 0, value <= 100_000 else {
                return "\(item.label): wpisz liczbę większą od zera i nie większą niż 100000."
            }
            if item.key == "capacity" && value != value.rounded() { return "Liczba osób musi być liczbą całkowitą." }
        }
        if !unavailable && !powerKw.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let value = Self.parse(powerKw), value > 0, value <= 100_000 else { return "Dostępna moc: wpisz liczbę większą od zera i nie większą niż 100000." }
        }
        for item in Self.texts where (texts[item.key] ?? "").count > 4000 { return "\(item.label): najwyżej 4000 znaków." }
        if powerNotes.count > 4000 || power230Notes.count > 4000 { return "Opisy zasilania mogą mieć do 4000 znaków." }
        if !unavailable && power400 != false {
            if points.count > 20 { return "Możesz opisać maksymalnie 20 punktów lub grup przyłączy 400 V." }
            for (index, point) in points.enumerated() {
                let label = "Punkt / grupa przyłączy \(index + 1)"
                let position = point.position.trimmingCharacters(in: .whitespacesAndNewlines)
                if position.isEmpty || position.count > 1000 { return "\(label): podaj miejsce przyłącza 400 V (do 1000 znaków)." }
                if point.connector.count > 200 { return "\(label): opis złącza może mieć do 200 znaków." }
                if point.notes.count > 2000 { return "\(label): uwagi mogą mieć do 2000 znaków." }
                if point.rating == "other" && point.connector.trimmingCharacters(in: .whitespaces).isEmpty {
                    return "\(label): dla innego złącza podaj amperaż i rodzaj w opisie."
                }
                if !point.quantity.trimmingCharacters(in: .whitespaces).isEmpty {
                    guard let value = Self.parse(point.quantity), value >= 1, value <= 1000, value == value.rounded() else {
                        return "\(label): liczba gniazd musi być liczbą całkowitą od 1 do 1000."
                    }
                }
                if !point.distance.trimmingCharacters(in: .whitespaces).isEmpty {
                    guard let value = Self.parse(point.distance), value >= 0, value <= 10_000 else {
                        return "\(label): odległość od sceny musi mieścić się w zakresie od 0 do 10000 metrów."
                    }
                }
            }
        }
        if assets.count + pendingFiles > 30 { return "Możesz dodać maksymalnie 30 materiałów." }
        return nil
    }

    /// JSON do zapisu: pola formularza, pozostałe klucze bez zmian.
    func json(adding added: [CrmLocationAsset] = []) -> [String: JSONValue] {
        var out = base.filter { !Self.managed.contains($0.key) }
        for item in Self.texts {
            let value = texts[item.key] ?? ""
            if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out[item.key] = .string(value) }
        }
        for item in Self.dimensions { if let value = Self.parse(numbers[item.key] ?? "") { out[item.key] = .number(value) } }
        if !powerSupply.isEmpty { out["power_supply"] = .string(powerSupply) }
        if !powerNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out["power_notes"] = .string(powerNotes) }
        if unavailable {
            out["power_400v_points"] = .array([])
        } else {
            if let power230 { out["power_230v"] = .bool(power230) }
            if let power400 { out["power_400v"] = .bool(power400) }
            if let kw = Self.parse(powerKw) { out["power_kw"] = .number(kw) }
            if !power230Notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out["power_230v_notes"] = .string(power230Notes) }
            out["power_400v_points"] = .array(power400 == false ? [] : points.map { point in
                var item: [String: JSONValue] = ["id": .string(point.id), "position": .string(point.position.trimmingCharacters(in: .whitespacesAndNewlines))]
                if let quantity = Self.parse(point.quantity) { item["quantity"] = .number(quantity) }
                if point.rating == "other" { item["rating_a"] = .string("other") } else if let amps = Double(point.rating) { item["rating_a"] = .number(amps) }
                if !point.connector.trimmingCharacters(in: .whitespaces).isEmpty { item["connector"] = .string(point.connector.trimmingCharacters(in: .whitespaces)) }
                if let distance = Self.parse(point.distance) { item["distance_to_stage_m"] = .number(distance) }
                if !point.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { item["notes"] = .string(point.notes) }
                return .object(item)
            })
        }
        let all = assets + added
        if !all.isEmpty || base["assets"] != nil { out["assets"] = .array(all.map(\.json)) }
        return out
    }
}
