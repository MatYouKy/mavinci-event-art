import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Edycja informacji technicznych obiektu albo sali (`TechnicalDetailsEditor` + `LocationPowerDetailsFields`):
// rodzaj, nazwa i wskazówki wejścia (sala), wymiary i pojemność, prąd i przyłącza (230 V, lista przyłączy 400 V),
// opisy oraz materiały (rzuty i plany, zdjęcia — do 20 MB, najwyżej 30; przesyłane przy zapisie).

private struct PendingMaterial: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    let kind: String
}

@MainActor struct LocationTechnicalEditorSheet: View {
    @ObservedObject var store: LocationsStore
    let locationID: String
    /// Sala (istniejąca albo nowa z nadanym identyfikatorem); `nil` — informacje techniczne całego obiektu.
    let roomID: String?
    let room: CrmLocationRoom?
    let initial: [String: JSONValue]
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: CrmTechnicalDraft
    @State private var name: String
    @State private var notes: String
    @State private var kind: String
    @State private var pending: [PendingMaterial] = []
    @State private var uploaded: [URL: CrmLocationAsset] = [:]
    @State private var busy = false
    @State private var problem: String?
    @State private var supplyChange: String?
    @State private var dropping400 = false

    init(store: LocationsStore, locationID: String, roomID: String?, room: CrmLocationRoom?, initial: [String: JSONValue]) {
        self.store = store
        self.locationID = locationID
        self.roomID = roomID
        self.room = room
        self.initial = initial
        _draft = State(initialValue: CrmTechnicalDraft(initial))
        _name = State(initialValue: room?.name ?? "")
        _notes = State(initialValue: room?.notes ?? "")
        _kind = State(initialValue: room?.kind ?? "indoor")
    }

    private var isRoom: Bool { roomID != nil }
    private var title: String { isRoom ? (room == nil ? "Nowa przestrzeń" : "Edytuj przestrzeń") : "Informacje techniczne obiektu" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: isRoom ? "square.split.2x2" : "bolt").font(.title2).foregroundStyle(theme.accent)
                Text(title).font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(busy)
            }
            .padding(18)
            Form {
                if isRoom { roomSection }
                dimensionsSection
                powerSection
                textsSection
                materialsSection
            }
            .formStyle(.grouped)
            .disabled(busy)
            if let problem { Text(problem).font(.callout).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 18).padding(.top, 6) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(busy)
                Button(busy ? "Zapisywanie…" : "Zapisz") { save() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy)
            }
            .padding(18)
        }
        .frame(width: 780, height: 860)
        .background(theme.page)
        .confirmationDialog("Oznaczyć brak zasilania?", isPresented: Binding(get: { supplyChange != nil }, set: { if !$0 { supplyChange = nil } }), titleVisibility: .visible) {
            Button("Oznacz brak zasilania", role: .destructive) { applySupply("unavailable") }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Ta zmiana usunie z formularza szczegółowy opis 230 V oraz listę przyłączy 400 V. Pozostałe uwagi zostaną zachowane. Zmiana trafi do bazy dopiero po zapisaniu formularza.")
        }
        .confirmationDialog("Usunąć opisane przyłącza 400 V?", isPresented: $dropping400, titleVisibility: .visible) {
            Button("Usuń listę i oznacz brak", role: .destructive) { draft.power400 = false; draft.points = [] }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Oznaczenie „Brak” usunie z formularza listę przyłączy 400 V. Zmiana trafi do bazy dopiero po zapisaniu formularza.") }
    }

    // MARK: Sekcje

    private var roomSection: some View {
        Section("Przestrzeń") {
            Picker("Rodzaj przestrzeni", selection: $kind) {
                Text("Sala / wnętrze").tag("indoor")
                Text("Teren na zewnątrz").tag("outdoor")
            }
            TextField("Nazwa sali *", text: Binding(get: { name }, set: { name = String($0.prefix(150)) }))
            TextField("Wskazówki wejścia / piętro", text: Binding(get: { notes }, set: { notes = String($0.prefix(1000)) }))
        }
    }

    private var dimensionsSection: some View {
        Section {
            ForEach(CrmTechnicalDraft.dimensions, id: \.key) { item in
                TextField("\(item.label) (\(item.unit))", text: Binding(get: { draft.numbers[item.key] ?? "" }, set: { draft.numbers[item.key] = $0 }),
                          prompt: Text("Nie podano"))
            }
        } header: {
            Text("Wymiary i pojemność")
        } footer: {
            Text("Pola są opcjonalne. Wpisz dane z dokumentacji obiektu; pozostaw puste, jeśli wymagają potwierdzenia. Powierzchnia nie jest wyliczana automatycznie — sala może mieć nieregularny kształt. Układ i liczbę miejsc dla konkretnej aranżacji opisz w dodatkowych informacjach.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func socketBinding(_ value: Binding<Bool?>, is400: Bool) -> Binding<String> {
        Binding(get: { value.wrappedValue.map { $0 ? "yes" : "no" } ?? "" }, set: { choice in
            let next: Bool? = choice.isEmpty ? nil : choice == "yes"
            if is400 && next == false && !draft.points.isEmpty { dropping400 = true; return }
            value.wrappedValue = next
            if is400 && next == false { draft.points = [] }
        })
    }

    private func applySupply(_ supply: String) {
        draft.powerSupply = supply
        if supply == "unavailable" {
            draft.power230 = nil; draft.power400 = nil; draft.powerKw = ""; draft.power230Notes = ""; draft.points = []
        }
    }

    private var powerSection: some View {
        Section {
            Picker("Dostęp do zasilania", selection: Binding(get: { draft.powerSupply }, set: { supply in
                if supply == "unavailable" && (!draft.points.isEmpty || !draft.power230Notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    supplyChange = supply
                } else {
                    applySupply(supply)
                }
            })) {
                Text("Do potwierdzenia").tag("")
                Text("Zasilanie dostępne").tag("available")
                Text("Brak zasilania").tag("unavailable")
            }
            if !draft.unavailable {
                Picker("Gniazda 230 V", selection: socketBinding($draft.power230, is400: false)) {
                    Text("Do potwierdzenia").tag("")
                    Text("Dostępne").tag("yes")
                    Text("Brak").tag("no")
                }
                Picker("Przyłącza 400 V (siła)", selection: socketBinding($draft.power400, is400: true)) {
                    Text("Do potwierdzenia").tag("")
                    Text("Dostępne").tag("yes")
                    Text("Brak").tag("no")
                }
                TextField("Dostępna moc łącznie (kW)", text: $draft.powerKw, prompt: Text("Do potwierdzenia"))
                if draft.shows230Notes {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("230 V — liczba gniazd, rozmieszczenie, fazy i obwody")
                        TextField("", text: $draft.power230Notes, prompt: Text("Opisz np. gniazda przy typowym miejscu sceny, które są na różnych fazach lub osobnych obwodach, gniazda po obu stronach sali, ich rozstaw oraz współdzielenie z urządzeniami hotelu."), axis: .vertical)
                            .lineLimit(3...6).labelsHidden()
                        Text("Podaj konkretne miejsca. Informacje o fazach i obwodach wpisuj osobno, zgodnie z danymi obsługi technicznej.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if draft.shows400 { points400 }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Pozostałe szczegóły zasilania")
                TextField("", text: $draft.powerNotes, prompt: Text("Wspólne ograniczenia zasilania, dostęp do rozdzielni, kontakt do technika i dodatkowe ustalenia"), axis: .vertical)
                    .lineLimit(2...5).labelsHidden()
            }
        } header: {
            Text("Prąd i przyłącza")
        } footer: {
            Text("Parametry wpisz po potwierdzeniu przez obsługę techniczną obiektu. Nie przeliczamy liczby gniazd ani amperażu złączy na dostępną moc.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var points400: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("400 V — lista przyłączy").fontWeight(.semibold)
            Text("Każdy typ i miejsce dodaj osobno. Identyczne gniazda w tym samym miejscu możesz połączyć w grupę. Nieznane parametry pozostaw do potwierdzenia.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(draft.points) { item in
                let index = draft.points.firstIndex(where: { $0.id == item.id }) ?? 0
                let point = pointBinding(item.id)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Punkt / grupa przyłączy \(index + 1)").font(.callout.weight(.semibold))
                        Spacer()
                        Button("Usuń ten punkt", role: .destructive) { draft.points.removeAll { $0.id == item.id } }.buttonStyle(.link)
                    }
                    HStack(spacing: 10) {
                        TextField("Liczba gniazd (szt.)", text: point.quantity, prompt: Text("Do potwierdzenia"))
                        Picker("Prąd znamionowy złącza", selection: point.rating) {
                            Text("Do potwierdzenia").tag("")
                            Text("16 A").tag("16")
                            Text("32 A").tag("32")
                            Text("63 A").tag("63")
                            Text("Inny — opisz złącze").tag("other")
                        }
                    }
                    TextField(item.rating == "other" ? "Rodzaj złącza / liczba pinów *" : "Rodzaj złącza / liczba pinów", text: point.connector,
                              prompt: Text(item.rating == "other" ? "Podaj amperaż i rodzaj złącza" : "Np. CEE, 5-pin — do potwierdzenia"))
                    TextField("Miejsce przyłącza *", text: point.position,
                              prompt: Text("Np. przeciwległa ściana względem typowego miejsca sceny, przy drzwiach technicznych"), axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Odległość od typowego ustawienia sceny (m)", text: point.distance, prompt: Text("Do potwierdzenia"))
                    TextField("Przydatność przy scenie i ograniczenia", text: point.notes,
                              prompt: Text("Np. daleko od zwyczajowego ustawienia sceny, utrudniona trasa przewodów, dostęp po uzgodnieniu z technikiem"), axis: .vertical)
                        .lineLimit(1...3)
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            if draft.points.isEmpty { Text("Nie opisano jeszcze żadnego przyłącza 400 V.").font(.callout).foregroundStyle(.secondary) }
            HStack {
                Button("+ Dodaj punkt / grupę przyłączy 400 V") { draft.points.append(CrmPowerPointDraft()) }.disabled(draft.points.count >= 20)
                Text("Do 20 punktów lub grup przyłączy.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// Pole punktu 400 V po identyfikatorze (lista może się zmieniać w trakcie edycji).
    private func pointBinding(_ id: String) -> Binding<CrmPowerPointDraft> {
        Binding(get: { draft.points.first { $0.id == id } ?? CrmPowerPointDraft(id: id) },
                set: { value in if let index = draft.points.firstIndex(where: { $0.id == id }) { draft.points[index] = value } })
    }

    private var textsSection: some View {
        Section("Opisy") {
            ForEach(CrmTechnicalDraft.texts, id: \.key) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.label)
                    TextField("", text: Binding(get: { draft.texts[item.key] ?? "" }, set: { draft.texts[item.key] = String($0.prefix(4000)) }),
                              prompt: Text(item.prompt), axis: .vertical)
                        .lineLimit(2...6).labelsHidden()
                }
            }
        }
    }

    private var materialsSection: some View {
        Section {
            HStack {
                Button("Dodaj rzuty i plany…", systemImage: "doc.badge.plus") { pick("plan") }
                Button("Dodaj zdjęcia…", systemImage: "photo.badge.plus") { pick("photo") }
            }
            ForEach(draft.assets) { asset in
                HStack {
                    Image(systemName: asset.kind == "photo" ? "photo" : "doc")
                    Text(asset.name).lineLimit(1)
                    Text(asset.kind == "photo" ? "Galeria" : "Rzut / plan").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Usuń z listy") { draft.assets.removeAll { $0.path == asset.path } }.buttonStyle(.link)
                }
            }
            ForEach(pending) { item in
                HStack {
                    Image(systemName: item.kind == "photo" ? "photo" : "doc").foregroundStyle(theme.accent)
                    Text("\(item.url.lastPathComponent) (nowy)").lineLimit(1)
                    Text(item.kind == "photo" ? "Galeria" : "Rzut / plan").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Usuń") { pending.removeAll { $0.id == item.id } }.buttonStyle(.link)
                }
            }
        } header: {
            Text("Materiały")
        } footer: {
            Text("Do 20 MB na plik, maksymalnie 30 materiałów. Pliki zostaną przesłane przy zapisie. Plany CAD są udostępniane do pobrania — dodaj też PDF lub obraz rzutu do szybkiego podglądu. Zdjęcia mogą przedstawiać pustą salę i przykładowe aranżacje.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Pliki i zapis

    private func pick(_ kind: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        var types: [UTType] = [.jpeg, .png, .webP]
        if kind == "plan" {
            types.append(.pdf)
            types.append(contentsOf: ["dxf", "dwg"].compactMap { UTType(filenameExtension: $0) })
        }
        panel.allowedContentTypes = types
        panel.message = kind == "plan" ? "PDF, DXF, DWG, JPG, PNG, WEBP · do 20 MB" : "JPG, PNG, WEBP · do 20 MB"
        guard panel.runModal() == .OK else { return }
        let allowed: Set<String> = kind == "plan" ? ["jpg", "jpeg", "png", "webp", "pdf", "dxf", "dwg"] : ["jpg", "jpeg", "png", "webp"]
        var added: [PendingMaterial] = []
        for url in panel.urls {
            guard allowed.contains(url.pathExtension.lowercased()) else {
                problem = kind == "plan" ? "Dodaj JPG, PNG lub WebP, a dla rzutu także PDF, DXF lub DWG." : "Dodaj zdjęcia w formacie JPG, PNG lub WebP."
                return
            }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size > 0, size <= 20 * 1024 * 1024, url.lastPathComponent.count <= 255 else {
                problem = "Plik musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków."
                return
            }
            added.append(PendingMaterial(url: url, kind: kind))
        }
        guard draft.assets.count + pending.count + added.count <= 30 else { problem = "Możesz dodać maksymalnie 30 materiałów."; return }
        problem = nil
        pending.append(contentsOf: added)
    }

    private func save() {
        guard !busy else { return }
        if isRoom && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Uzupełnij nazwę sali."; return }
        if let message = draft.problem(pendingFiles: pending.count) { problem = message; return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        problem = nil
        busy = true
        Task {
            defer { busy = false }
            var added: [CrmLocationAsset] = []
            do {
                for (index, item) in pending.enumerated() {
                    // Plik przesłany przy wcześniejszej próbie zapisu nie jest wysyłany ponownie.
                    if let cached = uploaded[item.url] { added.append(CrmLocationAsset(path: cached.path, name: cached.name, kind: item.kind)); continue }
                    let label = pending.count > 1 ? "Przesyłanie \(index + 1)/\(pending.count)…" : "Przesyłanie…"
                    let asset = try await state.withPending(label) { try await store.uploadMaterial(locationID: locationID, kind: item.kind, file: item.url) }
                    uploaded[item.url] = asset
                    added.append(asset)
                }
            } catch {
                problem = store.failureText(error, "Nie udało się przesłać pliku.")
                return
            }
            let details = draft.json(adding: added)
            let reply: [String: JSONValue]?
            if let roomID {
                var body: [String: JSONValue] = [
                    "id": .string(locationID),
                    "room": .object(["id": .string(roomID), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
                                     "notes": .string(notes.trimmingCharacters(in: .whitespacesAndNewlines)), "kind": .string(kind), "technical": .object(details)]),
                ]
                if let room { body["previous"] = room.json }
                reply = await store.run("Zapisywanie przestrzeni…", "roomSave", body, reload: locationID)
            } else {
                reply = await store.run("Zapisywanie informacji…", "technical", ["id": .string(locationID), "details": .object(details), "previous": .object(initial)], reload: locationID)
            }
            if reply != nil { dismiss() }
        }
    }
}
