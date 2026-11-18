import SwiftUI
import AppKit

// MARK: Lokalizacje magazynowe — 1:1 ze stroną `/crm/equipment/locations`: kafelki (nazwa, aktywna / nieaktywna, adres, dostęp,
// link do Google Maps, notatki), „Dodaj lokalizację”, edycja (nazwa, adres, URL Google Maps z testem współrzędnych, informacje
// o dostępie, notatki, aktywna) i usuwanie — z uprawnieniem do zarządzania magazynem. Serwer: `/bridge/native/v1/storage-locations`
// (`src/lib/native/storageLocations.ts`).

struct StorageLocation: Decodable, Identifiable {
    var id: String
    var name: String
    var address: String
    var accessInfo: String
    var googleMapsUrl: String
    var notes: String
    var isActive: Bool
}

enum GoogleMapsLink {
    enum Parsed { case coordinates(Double, Double), shortened, unknown }
    /// `parseGoogleMapsUrl` z CRM (`src/lib/gus.ts`): skrócone linki odrzucone, współrzędne z pierwszego pasującego wzorca.
    static func parse(_ url: String) -> Parsed {
        if url.contains("goo.gl") || url.contains("maps.app.goo.gl") { return .shortened }
        let patterns = [
            #"@(-?\d+\.\d+),(-?\d+\.\d+)"#, #"\?q=(-?\d+\.\d+),(-?\d+\.\d+)"#, #"place/[^/]+/@(-?\d+\.\d+),(-?\d+\.\d+)"#,
            #"ll=(-?\d+\.\d+),(-?\d+\.\d+)"#, #"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)"#,
        ]
        let range = NSRange(url.startIndex..., in: url)
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: url, range: range),
                  let first = Range(match.range(at: 1), in: url), let second = Range(match.range(at: 2), in: url),
                  let latitude = Double(url[first]), let longitude = Double(url[second]) else { continue }
            return .coordinates(latitude, longitude)
        }
        return .unknown
    }
}

@MainActor struct StorageLocationsSheet: View {
    var onChanged: () -> Void = {}
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var locations: [StorageLocation] = []
    @State private var canManage = false
    @State private var loading = true
    @State private var loadError: String?
    @State private var editing: StorageLocationDraft?
    @State private var removing: StorageLocation?
    @State private var working = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Lokalizacje magazynowe", systemImage: "mappin.and.ellipse").font(.title2.bold())
                    Text("Zarządzaj lokalizacjami przechowywania sprzętu").foregroundStyle(.secondary)
                }
                Spacer()
                if canManage {
                    Button { editing = StorageLocationDraft() } label: { Label("Dodaj lokalizację", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            content
        }
        .frame(minWidth: 720, idealWidth: 900, minHeight: 480, idealHeight: 660)
        .background(theme.page)
        .overlay { if working { PendingOverlay(text: "Usuwanie…") } }
        .task { await load() }
        .sheet(item: $editing) { draft in
            StorageLocationEditor(draft: draft) { await load(); onChanged() }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Czy na pewno chcesz usunąć tę lokalizację?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let location = removing { Task { await remove(location) } } }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text(removing?.name ?? "") }
    }

    @ViewBuilder private var content: some View {
        if loading && locations.isEmpty && loadError == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError, locations.isEmpty {
            ContentUnavailableView {
                Label("Nie udało się pobrać lokalizacji", systemImage: "wifi.exclamationmark")
            } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
        } else if locations.isEmpty {
            ContentUnavailableView {
                Label("Brak lokalizacji magazynowych", systemImage: "building.2")
            } actions: {
                if canManage { Button { editing = StorageLocationDraft() } label: { Label("Dodaj pierwszą lokalizację", systemImage: "plus") } }
            }
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 14)], spacing: 14) {
                    ForEach(locations) { location in card(location) }
                }
                .padding(20)
            }
        }
    }

    private func card(_ location: StorageLocation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "building.2").foregroundStyle(theme.accent)
                Text(location.name).font(.headline).lineLimit(2)
                Spacer()
                Image(systemName: location.isActive ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(location.isActive ? .green : .red)
                    .help(location.isActive ? "Lokalizacja aktywna" : "Lokalizacja nieaktywna")
            }
            if !location.address.isEmpty {
                Label(location.address, systemImage: "mappin").font(.callout).foregroundStyle(.secondary)
            }
            if !location.accessInfo.isEmpty {
                (Text("Dostęp: ").fontWeight(.medium) + Text(location.accessInfo)).font(.callout).foregroundStyle(.secondary)
            }
            if let url = URL(string: location.googleMapsUrl), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                Button { NSWorkspace.shared.open(url) } label: { Label("Otwórz w Google Maps", systemImage: "map") }
                    .buttonStyle(.link).font(.callout)
            }
            if !location.notes.isEmpty {
                Text(location.notes).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if canManage {
                HStack {
                    Button { editing = StorageLocationDraft(location) } label: { Label("Edytuj", systemImage: "pencil") }
                    Spacer()
                    Button(role: .destructive) { removing = location } label: { Image(systemName: "trash") }.help("Usuń")
                }
                .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(location.isActive ? Color.secondary.opacity(0.25) : Color.red.opacity(0.5)))
        .opacity(location.isActive ? 1 : 0.6)
        .contextMenu {
            if canManage {
                Button("Edytuj", systemImage: "pencil") { editing = StorageLocationDraft(location) }
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = location }
            }
        }
    }

    private func load() async {
        guard let api = state.nativeAPI() else { loadError = AppError.configuration.localizedDescription; loading = false; return }
        loading = true
        defer { loading = false }
        struct Reply: Decodable { var locations: [StorageLocation]; var canManage: Bool }
        do {
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/storage-locations", query: ["op": "list"]))
            locations = reply.locations
            canManage = reply.canManage
            loadError = nil
        } catch {
            loadError = StorageLocationEditor.message(error, "Błąd pobierania lokalizacji")
            if !locations.isEmpty { state.error = loadError }
        }
    }

    private func remove(_ location: StorageLocation) async {
        removing = nil
        guard state.canWrite, let api = state.nativeAPI() else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        working = true
        defer { working = false }
        do {
            let data = try await api.post("/storage-locations", ["op": .string("delete"), "id": .string(location.id)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            state.succeed(reply["message"]?.text.nonEmpty ?? "Lokalizacja usunięta")
            await load()
            onChanged()
        } catch {
            state.error = StorageLocationEditor.message(error, "Błąd usuwania lokalizacji")
        }
    }
}

struct StorageLocationDraft: Identifiable {
    var id = UUID()
    var locationID: String?
    var name = ""
    var address = ""
    var googleMapsUrl = ""
    var accessInfo = ""
    var notes = ""
    var isActive = true

    init() {}
    init(_ location: StorageLocation) {
        locationID = location.id
        name = location.name
        address = location.address
        googleMapsUrl = location.googleMapsUrl
        accessInfo = location.accessInfo
        notes = location.notes
        isActive = location.isActive
    }
}

@MainActor private struct StorageLocationEditor: View {
    @State var draft: StorageLocationDraft
    let onSaved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var saving = false

    /// Jak pole `type="url"` w CRM: pusty albo pełny adres ze schematem.
    private var urlValid: Bool {
        let value = draft.googleMapsUrl.trimmingCharacters(in: .whitespaces)
        return value.isEmpty || (URL(string: value)?.scheme?.isEmpty == false)
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(draft.locationID == nil ? "Nowa lokalizacja" : "Edytuj lokalizację").font(.title3.bold())
                .frame(maxWidth: .infinity, alignment: .leading).padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                TextField("Nazwa lokalizacji *", text: $draft.name, prompt: Text("np. Magazyn główny, Biuro, Sala eventowa"))
                TextField("Adres", text: $draft.address, prompt: Text("ul. Przykładowa 1, 00-000 Warszawa"))
                Section {
                    HStack {
                        TextField("URL Google Maps", text: $draft.googleMapsUrl, prompt: Text(verbatim: "https://maps.google.com/..."))
                        Button { test() } label: { Label("Test", systemImage: "mappin") }
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Otwórz miejsce w Google Maps, skopiuj PEŁNY URL z paska adresu (nie skrócony link!)")
                        if !urlValid { Text("Podaj pełny adres URL, np. https://maps.google.com/…").foregroundStyle(.red) }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                TextField("Informacje o dostępie", text: $draft.accessInfo, prompt: Text("np. wejście od podwórka, kod do bramy: 1234"), axis: .vertical)
                    .lineLimit(2...4)
                TextField("Notatki", text: $draft.notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(3...6)
                Toggle("Lokalizacja aktywna", isOn: $draft.isActive).toggleStyle(.checkbox)
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button { Task { await save() } } label: {
                    Label(saving ? "Zapisywanie..." : "Zapisz", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty || !urlValid)
            }
            .padding(16)
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 500, idealHeight: 600)
        .background(theme.page)
        .disabled(saving)
    }

    /// „Test” — jak `handleParseGoogleMaps` w CRM.
    private func test() {
        let url = draft.googleMapsUrl
        guard !url.isEmpty else { state.error = "Wprowadź URL Google Maps"; return }
        switch GoogleMapsLink.parse(url) {
        case .coordinates(let latitude, let longitude): state.succeed("Współrzędne: \(latitude), \(longitude)")
        case .shortened: state.error = "Skrócone linki nie są obsługiwane. Otwórz link w przeglądarce, skopiuj pełny URL z paska adresu i wklej tutaj."
        case .unknown: state.error = "Nie udało się odczytać współrzędnych. Sprawdź format linku."
        }
    }

    private func save() async {
        guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { state.error = "Nazwa lokalizacji jest wymagana"; return }
        guard state.canWrite, let api = state.nativeAPI() else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        let form: [String: JSONValue] = [
            "name": .string(draft.name), "address": .string(draft.address), "googleMapsUrl": .string(draft.googleMapsUrl),
            "accessInfo": .string(draft.accessInfo), "notes": .string(draft.notes), "isActive": .bool(draft.isActive),
        ]
        var body: [String: JSONValue] = ["op": .string("save"), "form": .object(form)]
        if let id = draft.locationID { body["id"] = .string(id) }
        do {
            let data = try await api.post("/storage-locations", body)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            state.succeed(reply["message"]?.text.nonEmpty ?? (draft.locationID == nil ? "Lokalizacja dodana" : "Lokalizacja zaktualizowana"))
            await onSaved()
            dismiss()
        } catch {
            state.error = Self.message(error, "Błąd zapisywania lokalizacji")
        }
    }

    static func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }
}
