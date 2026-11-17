import SwiftUI

// MARK: Karta pojazdu — 1:1 z `/crm/fleet/[id]`: nagłówek ze statusem i aktualnym użytkowaniem („Zakończ użytkowanie”), alerty,
// kafelki (przebieg, średnie zużycie, koszt paliwa, koszt serwisu), zakładki Informacje (z właściwościami i wymaganym prawem
// jazdy), Timeline, Tankowania, Serwis i naprawy, Ubezpieczenia, Historia użytkowania, Galeria. Edycja i dodawanie pojazdu
// to ten sam formularz na tej karcie (`FleetVehicleForm`) — bez osobnych stron i okien.

@MainActor struct FleetVehicleView: View {
    @ObservedObject var store: FleetStore
    /// `nil` — nowy pojazd.
    let vehicleID: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab: FleetVehicleTab = .overview
    @State private var editing = false
    @State private var draft = FleetVehicleDraft()
    @State private var initialDraft = FleetVehicleDraft()
    @State private var saving = false
    @State private var removing = false
    @State private var discarding = false
    /// Porzucenie zmian z przycisku „Flota” wraca też do listy (z „Anuluj” — zostaje na karcie).
    @State private var exitAfterDiscard = false
    @State private var pendingImages: [URL] = []
    @State private var sheet: FleetSheet?
    @State private var removingAttribute: FleetAttribute?
    @State private var removingLicense: FleetLicense?

    private var isNew: Bool { vehicleID == nil }
    private var detail: FleetVehicleDetail? { vehicleID.flatMap { store.details[$0] } }
    private var access: FleetAccess? { detail?.access ?? store.access }
    private var canManage: Bool { access?.canManage ?? false }
    private var canCreate: Bool { access?.canCreate ?? false }
    private var dirty: Bool { draft != initialDraft || !pendingImages.isEmpty }

    var body: some View {
        dialogs(page)
    }

    /// Karta nowego pojazdu, karta istniejącego, błąd albo ładowanie.
    @ViewBuilder private var pageContent: some View {
        if isNew {
            newVehicleForm
        } else if let d = detail {
            vehicleCard(d)
        } else if let error = loadError {
            ContentUnavailableView {
                Label("Nie znaleziono pojazdu", systemImage: "car")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { retry() }
                Button("Wróć do listy") { store.openedID = nil }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var newVehicleForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(newVehicleTitle).font(.title2.weight(.light))
                    Text("Uzupełnij dane — te same pola co przy edycji pojazdu. Pola z * są wymagane.").foregroundStyle(.secondary)
                }
                FleetVehicleForm(draft: $draft, dictionaries: store.dictionaries, isNew: true)
                PendingGalleryCard(urls: $pendingImages)
            }
            .padding(16)
        }
    }

    private func vehicleCard(_ d: FleetVehicleDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(d)
                if editing {
                    FleetVehicleForm(draft: $draft, dictionaries: d.dictionaries, isNew: false, currentStatus: currentStatus(d))
                } else {
                    alerts(d)
                    tiles(d)
                    tabBar(d)
                    content(d)
                }
            }
            .padding(16)
        }
    }

    private var page: some View {
        pageContent
            .navigationTitle(pageTitle)
            .navigationSubtitle(pageSubtitle)
            .toolbar { toolbar }
            .overlay { if saving { PendingOverlay(text: savingText) } }
            .task(id: vehicleID ?? "new") { await prepare() }
            .sheet(item: $sheet) { sheet in sheetView(sheet).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent) }
    }

    private func dialogs<Content: View>(_ content: Content) -> some View {
        content
            .confirmationDialog("Usunąć pojazd?", isPresented: $removing, titleVisibility: .visible) {
                Button("Usuń", role: .destructive) { deleteVehicle() }
                Button("Anuluj", role: .cancel) {}
            } message: { Text(removeVehicleMessage) }
            .confirmationDialog(discardTitle, isPresented: $discarding, titleVisibility: .visible) {
                Button("Porzuć", role: .destructive) { leave(force: true) }
                Button("Wróć do formularza", role: .cancel) {}
            } message: { Text("Wpisane dane nie zostaną zapisane.") }
            .confirmationDialog("Usunąć właściwość?", isPresented: removingAttributeShown, titleVisibility: .visible) {
                if let attribute = removingAttribute {
                    Button("Usuń", role: .destructive) { deleteAttribute(attribute) }
                    Button("Anuluj", role: .cancel) {}
                }
            } message: { Text("Czy na pewno chcesz usunąć tę właściwość?") }
            .confirmationDialog("Usunąć wymaganie?", isPresented: removingLicenseShown, titleVisibility: .visible) {
                if let license = removingLicense {
                    Button("Usuń", role: .destructive) { deleteLicense(license) }
                    Button("Anuluj", role: .cancel) {}
                }
            } message: { Text("Czy na pewno chcesz usunąć to wymaganie?") }
    }

    // MARK: Teksty i akcje karty (wydzielone — krótsze wyrażenia dla kompilatora)

    private var loadError: String? {
        guard let vehicleID else { return nil }
        return store.detailErrors[vehicleID]
    }

    private var newVehicleTitle: String {
        if let name = draft.name.trimmingCharacters(in: .whitespaces).nonEmpty { return name }
        return draft.isTrailer ? "Nowa przyczepa" : "Nowy pojazd"
    }

    private var pageTitle: String {
        if isNew { return draft.isTrailer ? "Nowa przyczepa" : "Nowy pojazd" }
        return detail?.vehicle.name ?? "Pojazd"
    }

    private var pageSubtitle: String {
        if isNew { return "Dodawanie pojazdu" }
        if editing { return "Edycja pojazdu" }
        guard let vehicle = detail?.vehicle else { return "" }
        let parts: [String] = [vehicle.brand, vehicle.model].filter { !$0.isEmpty }
        return parts.joined(separator: " ")
    }

    private var savingText: String { isNew ? "Dodawanie pojazdu…" : "Zapisywanie…" }
    private var discardTitle: String { isNew ? "Porzucić nowy pojazd?" : "Porzucić zmiany?" }
    private var removeVehicleMessage: String {
        let name: String = detail?.vehicle.name ?? ""
        return "Pojazd „\(name)” zostanie trwale usunięty wraz z całą historią."
    }

    private var removingAttributeShown: Binding<Bool> {
        Binding(get: { removingAttribute != nil }, set: { shown in if !shown { removingAttribute = nil } })
    }

    private var removingLicenseShown: Binding<Bool> {
        Binding(get: { removingLicense != nil }, set: { shown in if !shown { removingLicense = nil } })
    }

    private func currentStatus(_ d: FleetVehicleDetail) -> FleetOption {
        FleetOption(value: d.vehicle.status, label: d.vehicle.statusLabel)
    }

    private func retry() {
        guard let vehicleID else { return }
        Task { await store.loadDetail(vehicleID) }
    }

    private func prepare() async {
        guard let vehicleID else {
            draft = FleetVehicleDraft()
            initialDraft = draft
            if store.list == nil { await store.load() }
            return
        }
        if let requested = store.openedTab {
            tab = requested
            store.openedTab = nil
        }
        await store.loadDetail(vehicleID)
        if store.editRequested {
            store.editRequested = false
            if let d = detail, canManage { startEditing(d) }
        }
    }

    private func deleteVehicle() {
        guard let vehicleID else { return }
        Task { await store.remove("Usuwanie pojazdu…", id: vehicleID) }
    }

    private func deleteAttribute(_ attribute: FleetAttribute) {
        guard let vehicleID else { return }
        let body: [String: JSONValue] = ["id": .string(attribute.id)]
        Task { await store.run("Usuwanie…", "attributeDelete", body, reload: vehicleID) }
    }

    private func deleteLicense(_ license: FleetLicense) {
        guard let vehicleID else { return }
        let body: [String: JSONValue] = ["id": .string(license.id)]
        Task { await store.run("Usuwanie…", "licenseDelete", body, reload: vehicleID) }
    }

    // MARK: Pasek narzędzi i zapis

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { leave(force: false) } label: { Label("Flota", systemImage: "chevron.left") }.help("Powrót do listy").disabled(saving)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if isNew {
                Button("Anuluj") { leave(force: false) }.disabled(saving)
                Button { Task { await save() } } label: { Label(saving ? "Dodawanie…" : draft.isTrailer ? "Dodaj przyczepę" : "Dodaj pojazd", systemImage: "checkmark") }
                    .labelStyle(.titleAndIcon).buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving || !canCreate)
            } else if let d = detail {
                if editing {
                    Button("Anuluj") { exitAfterDiscard = false; if dirty { discarding = true } else { editing = false } }.disabled(saving)
                    Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz zmiany", systemImage: "checkmark") }
                        .labelStyle(.titleAndIcon).buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving)
                } else {
                    if canManage {
                        Button { startEditing(d) } label: { Label("Edytuj", systemImage: "pencil") }.labelStyle(.titleAndIcon).buttonStyle(.borderedProminent).keyboardShortcut("e")
                    }
                    Menu {
                        Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/fleet/\(d.vehicle.id)") }
                        Button("Odśwież", systemImage: "arrow.clockwise") { Task { await store.loadDetail(d.vehicle.id) } }
                        if canManage {
                            Divider()
                            Button("Usuń pojazd", systemImage: "trash", role: .destructive) { removing = true }
                        }
                    } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                }
            }
        }
    }

    private func startEditing(_ d: FleetVehicleDetail) {
        draft = FleetVehicleDraft(d.vehicle)
        initialDraft = draft
        editing = true
    }

    private func leave(force: Bool) {
        if isNew {
            if !force && dirty { discarding = true; return }
            store.creating = false
        } else if editing {
            if !force {
                exitAfterDiscard = true
                if dirty { discarding = true; return }
            }
            editing = false
            if exitAfterDiscard { store.openedID = nil }
        } else {
            store.openedID = nil
        }
    }

    private func save() async {
        guard !draft.missingRequired else { state.error = "Wypełnij wymagane pola: Nazwa, Marka, Model"; return }
        saving = true
        do {
            var body: [String: JSONValue] = ["data": .object(draft.json)]
            if let vehicleID { body["id"] = .string(vehicleID) }
            let reply = try await store.post("save", body)
            saving = false
            let message = reply["message"]?.text.nonEmpty
            if let vehicleID {
                editing = false
                state.succeed(message ?? "Pojazd został zaktualizowany pomyślnie")
                await store.loadDetail(vehicleID)
                Task { await store.load() }
            } else if let id = reply["id"]?.text.nonEmpty {
                if !pendingImages.isEmpty { await store.uploadImages(pendingImages, vehicleID: id) }
                state.succeed(message ?? "Pojazd został dodany pomyślnie")
                store.creating = false
                store.openedTab = nil
                store.openedID = id
                Task { await store.load() }
            }
        } catch {
            saving = false
            state.error = store.failureText(error, isNew ? "Błąd podczas dodawania pojazdu" : "Błąd podczas aktualizacji pojazdu")
        }
    }

    // MARK: Nagłówek, alerty, kafelki

    private func header(_ d: FleetVehicleDetail) -> some View {
        let v = d.vehicle
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                WarehouseThumb(url: v.thumb, size: 56, symbol: v.isTrailer ? "rectangle.portrait.and.arrow.forward" : "car")
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 10) {
                        Text(v.name).font(.title2.weight(.light))
                        FleetStatusBadge(status: v.status, label: v.statusLabel, inUse: d.usage.inUse)
                    }
                    Text([v.brand, v.model].filter { !$0.isEmpty }.joined(separator: " ") + (v.year.map { " (\($0))" } ?? "")).foregroundStyle(.secondary)
                }
                Spacer()
            }
            if d.usage.inUse && !d.usage.by.isEmpty && !editing {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Image(systemName: "person")
                            Text("Użytkowany przez: \(d.usage.by)")
                            if !d.usage.event.isEmpty {
                                Text("•").foregroundStyle(.secondary)
                                if let eventID = d.usage.eventId {
                                    Button(d.usage.event) { state.showEvent(eventID) }.buttonStyle(.link)
                                } else {
                                    Text(d.usage.event).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .foregroundStyle(theme.accent)
                        if let pickup = d.usage.pickupAt, !FleetFormat.dateTime(pickup).isEmpty {
                            Label("Odbiór: \(FleetFormat.dateTime(pickup))", systemImage: "clock").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if d.usage.canEnd {
                        Button(role: .destructive) { sheet = .endUsage } label: { Label("Zakończ użytkowanie", systemImage: "xmark") }
                            .buttonStyle(.bordered).help("Zakończ użytkowanie pojazdu")
                    }
                }
                .padding(12)
                .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.accent.opacity(0.3), lineWidth: 1))
            }
        }
    }

    @ViewBuilder private func alerts(_ d: FleetVehicleDetail) -> some View {
        if !d.alerts.isEmpty {
            VStack(spacing: 8) {
                ForEach(d.alerts) { alert in
                    let color = alert.blocking ? CrmTheme.rgb(0xf87171) : CrmTheme.rgb(0xfb923c)
                    HStack(spacing: 12) {
                        Image(systemName: alert.type == "insurance" ? "shield" : "exclamationmark.triangle").foregroundStyle(color)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(alert.title).fontWeight(.medium).foregroundStyle(color)
                            Text(alert.message).font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(color.opacity(0.25), lineWidth: 1))
                }
            }
        }
    }

    private func tiles(_ d: FleetVehicleDetail) -> some View {
        HStack(spacing: 12) {
            if !d.vehicle.isTrailer {
                tile("Przebieg", FleetFormat.km(d.vehicle.mileage), "gauge.with.dots.needle.33percent")
                tile("Śr. zużycie", d.totals.avgConsumption > 0 ? "\(FleetFormat.number(d.totals.avgConsumption, digits: 1)) l/100km" : "-", "waveform.path.ecg")
                tile("Koszt paliwa", FleetFormat.thousands(d.totals.fuelCost), "fuelpump")
            }
            tile("Koszt serwisu", FleetFormat.thousands(d.totals.maintenanceCost), "wrench.and.screwdriver")
        }
    }

    private func tile(_ title: String, _ value: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Image(systemName: symbol).foregroundStyle(theme.accent)
            }
            Text(value).font(.title2.weight(.semibold).monospacedDigit())
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Zakładki

    private func tabs(_ d: FleetVehicleDetail) -> [FleetVehicleTab] {
        FleetVehicleTab.allCases.filter { !(d.vehicle.isTrailer && $0 == .fuel) }
    }

    private func tabBar(_ d: FleetVehicleDetail) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(tabs(d)) { item in
                    Button { tab = item } label: {
                        Label(item.label, systemImage: item.symbol)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .foregroundStyle(tab == item ? theme.accent : Color.secondary)
                            .overlay(alignment: .bottom) { if tab == item { Rectangle().fill(theme.accent).frame(height: 2) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func content(_ d: FleetVehicleDetail) -> some View {
        let shown: FleetVehicleTab = tab == .fuel && d.vehicle.isTrailer ? .overview : tab
        switch shown {
        case .overview: overview(d)
        case .timeline: FleetTimelineView(store: store, vehicleID: d.vehicle.id, visibleIDs: nil).frame(minHeight: 420)
        case .fuel: FleetFuelTab(store: store, detail: d, add: { sheet = .fuel })
        case .maintenance: FleetMaintenanceTab(store: store, detail: d, add: { sheet = .maintenance })
        case .insurance: FleetInsuranceTab(store: store, detail: d, add: { sheet = .insurance })
        case .history: FleetHistoryTab(detail: d)
        case .gallery: FleetGalleryTab(store: store, detail: d)
        }
    }

    // MARK: Informacje

    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "-" : value).textSelection(.enabled)
        }
    }

    private func overview(_ d: FleetVehicleDetail) -> some View {
        let v = d.vehicle
        return VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Dane podstawowe") {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    field("Marka i model", [v.brand, v.model].filter { !$0.isEmpty }.joined(separator: " "))
                    field("Rok produkcji", v.year.map { String($0) } ?? "")
                    field("Numer rejestracyjny", v.registration)
                    field("VIN", v.vin)
                    field("Kolor", v.color)
                    field("Kategoria", v.categoryLabel)
                    if !v.isTrailer {
                        field("Typ paliwa", v.fuelLabel)
                        field(v.electric ? "Zużycie energii do kalkulacji" : "Średnie spalanie do kalkulacji",
                              v.averageConsumption.map { "\(FleetFormat.number($0)) \(v.electric ? "kWh/100 km" : "l/100 km")" } ?? "Nie podano")
                        if v.electric {
                            field("Cena prądu do kalkulacji", v.energyPrice.map { "\(FleetFormat.number($0, digits: 4)) zł/kWh" } ?? "Nie podano")
                        }
                        field("Skrzynia biegów", v.transmissionLabel)
                        field("Moc", v.powerHp.map { "\($0) KM" } ?? "")
                        field("Pojemność silnika", v.engineCapacity.map { "\($0) cm³" } ?? "")
                    } else {
                        field("Wymiary załadunkowe", dims(v.cargoLength, v.cargoWidth, v.cargoHeight))
                        field("Wymiary całkowite", dims(v.totalLength, v.totalWidth, v.totalHeight))
                        field("Maks. ładowność", v.maxLoad.map { "\($0) kg" } ?? "")
                    }
                    field("Typ własności", v.ownershipLabel)
                    field("Data zakupu", v.purchaseDate.isEmpty ? "" : FleetFormat.day(v.purchaseDate))
                    field("Posiada Hak", v.towHitch ? "Tak" : "Nie")
                }
            }
            attributesPanel(d)
            licensesPanel(d)
            if v.purchasePrice != nil || v.currentValue != nil || !v.leasingCompany.isEmpty || !v.currentLocation.isEmpty || !v.parkingLocation.isEmpty || !v.garageLocation.isEmpty {
                TeamCard(title: "Koszty i lokalizacja") {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                        if v.purchasePrice != nil { field("Cena zakupu", FleetFormat.money(v.purchasePrice)) }
                        if v.currentValue != nil { field("Wartość bieżąca", FleetFormat.money(v.currentValue)) }
                        if v.ownership == "leased" {
                            field("Firma leasingowa", v.leasingCompany)
                            field("Rata leasingowa", v.leasingMonthly.map { FleetFormat.money($0) + "/mies." } ?? "")
                            field("Koniec leasingu", v.leasingEnd.isEmpty ? "" : FleetFormat.day(v.leasingEnd))
                        }
                        if !v.currentLocation.isEmpty { field("Aktualna lokalizacja", v.currentLocation) }
                        if !v.parkingLocation.isEmpty { field("Miejsce parkowania", v.parkingLocation) }
                        if !v.garageLocation.isEmpty { field("Garaż/Baza", v.garageLocation) }
                    }
                }
            }
            if !v.description.isEmpty || !v.notes.isEmpty {
                TeamCard(title: "Dodatkowe informacje") {
                    if !v.description.isEmpty { field("Opis", v.description) }
                    if !v.notes.isEmpty { field("Notatki", v.notes) }
                }
            }
        }
    }

    private func dims(_ a: Int?, _ b: Int?, _ c: Int?) -> String {
        guard a != nil || b != nil || c != nil else { return "" }
        return [a, b, c].map { $0.map(String.init) ?? "-" }.joined(separator: " × ") + " cm"
    }

    /// Właściwości pojazdu (`VehicleAttributesPanel`).
    private func attributesPanel(_ d: FleetVehicleDetail) -> some View {
        TeamCard(title: "Właściwości pojazdu", symbol: "gearshape", action: addAction("Dodaj właściwość", .attribute)) {
            if d.attributes.isEmpty {
                Text("Brak właściwości. Dodaj właściwości aby określić cechy pojazdu.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(d.attributes) { attribute in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(attribute.type.name).fontWeight(.medium)
                                    if !attribute.type.categoryLabel.isEmpty {
                                        FleetPill(text: attribute.type.categoryLabel, color: attributeColor(attribute.type.category))
                                    }
                                    if attribute.type.category == "license_requirement" {
                                        FleetPill(text: "Wymaga certyfikatu", color: CrmTheme.rgb(0xfb923c))
                                    }
                                }
                                Text(attribute.display).foregroundStyle(theme.accent)
                                if !attribute.type.description.isEmpty { Text(attribute.type.description).font(.caption).foregroundStyle(.secondary) }
                                if !attribute.notes.isEmpty { Text(attribute.notes).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if canManage {
                                Button(role: .destructive) { removingAttribute = attribute } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
                            }
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    private func addAction(_ title: String, _ target: FleetSheet) -> (String, () -> Void)? {
        guard canManage else { return nil }
        return (title, { sheet = target })
    }

    private func attributeColor(_ category: String) -> Color {
        switch category {
        case "equipment": return CrmTheme.rgb(0x60a5fa)
        case "capacity": return CrmTheme.rgb(0x4ade80)
        case "license_requirement": return CrmTheme.rgb(0xfb923c)
        case "technical": return CrmTheme.rgb(0xc084fc)
        default: return .secondary
        }
    }

    /// Wymagane kategorie prawa jazdy (`VehicleLicenseRequirementsPanel`).
    private func licensesPanel(_ d: FleetVehicleDetail) -> some View {
        TeamCard(title: "Wymagane kategorie prawa jazdy", symbol: "shield", action: addAction("Dodaj", .license)) {
            if d.licenses.isEmpty {
                Text("Brak wymagań dotyczących prawa jazdy").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(d.licenses) { license in
                        HStack(spacing: 10) {
                            Text(license.code).font(.callout.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 3)
                                .background(theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 6)).foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(license.name)
                                    if license.required { Image(systemName: "checkmark").foregroundStyle(CrmTheme.rgb(0x4ade80)).help("Wymagane") }
                                }
                                if !license.notes.isEmpty { Text(license.notes).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if canManage {
                                Button(role: .destructive) { removingLicense = license } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
                            }
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    // MARK: Okna

    @ViewBuilder private func sheetView(_ sheet: FleetSheet) -> some View {
        if let d = detail {
            switch sheet {
            case .fuel:
                FleetFuelSheet(store: store, vehicleID: d.vehicle.id, vehicleName: d.vehicle.name, currentMileage: d.vehicle.mileage, quick: false)
            case .maintenance:
                FleetMaintenanceSheet(store: store, vehicleID: d.vehicle.id, vehicleName: d.vehicle.name, currentMileage: d.vehicle.mileage, employees: d.employees)
            case .insurance:
                FleetInsuranceSheet(store: store, vehicleID: d.vehicle.id, vehicleName: d.vehicle.name)
            case .endUsage:
                FleetEndUsageSheet(store: store, detail: d)
            case .attribute:
                FleetAttributeSheet(store: store, vehicleID: d.vehicle.id, types: d.attributeTypes.filter { type in !d.attributes.contains { $0.type.id == type.id } })
            case .license:
                FleetLicenseSheet(store: store, vehicleID: d.vehicle.id, categories: d.licenseCategories.filter { category in !d.licenses.contains { $0.categoryId == category.id } })
            }
        }
    }
}

/// Okna karty pojazdu (jak modale CRM).
enum FleetSheet: String, Identifiable {
    case fuel, maintenance, insurance, endUsage, attribute, license
    var id: String { rawValue }
}
