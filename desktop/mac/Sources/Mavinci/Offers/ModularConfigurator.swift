import SwiftUI

// MARK: Konfigurator produktów modułowych — scena (podest z magazynu) i ekran LED z sekcjami, a w starszych ofertach podest
// ze stawkami, LED z powierzchnią, nagłośnienie i mikrofony (`ModularProductConfigurator` w CRM). Mac trzyma kopię
// konfiguracji i wysyła zmiany jako operacje (`op=modular`); serwer liczy wszystko funkcjami CRM (pobranie sprzętu i cen
// rentalnych, dobór wariantów do wysokości, sekcje i skrętki LED, procesory, stan modułów) i zwraca gotowy widok.
// Serwer: `src/lib/native/modularConfigurator.ts`. Panel jest wspólny dla kreatora, okna pozycji i okna propozycji.

struct ModularView: Decodable, Equatable {
    struct Line: Decodable, Identifiable, Equatable {
        var key: String
        var name: String
        var quantity: String
        var rate: String
        var total: String
        var id: String { key }
    }
    struct Option: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
    }
    /// Grupa zależności w drzewie: `automatic` (dobrane do wysokości), `choice`, `optional`, `required`.
    struct Group: Decodable, Identifiable, Equatable {
        var key: String
        var kind: String
        var label: String
        var placeholder: String
        var options: [Option]
        var selected: String
        var enabled: Bool
        var children: [Node]
        var id: String { key }
    }
    struct Node: Decodable, Equatable {
        var id: String
        var path: String
        var name: String
        var detail: String
        var groups: [Group]
    }
    struct Root: Decodable, Identifiable, Equatable {
        var id: String
        var title: String
        var optional: Bool
        var optionalLabel: String
        var enabled: Bool
        var quantityEditable: Bool
        var quantity: Double?
        var tree: Node?
    }
    struct English: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var nameEn: String?
    }
    struct Preset: Decodable, Hashable {
        var width: Double
        var depth: Double
        var label: String
    }
    struct HeightOption: Decodable, Hashable {
        var height: Double
        var label: String
    }
    struct Stage: Decodable, Equatable {
        var width: Double?
        var depth: Double?
        var height: Double?
        var skirt: String
        var showSkirt: Bool
        var presets: [Preset]
        var heightOptions: [HeightOption]
        var heightMessage: String?
        var summary: String
    }
    struct Section: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var columns: Double?
        var rows: Double?
        var summary: String
    }
    struct Inventory: Decodable, Equatable {
        var text: String
        var warning: Bool
    }
    struct Recommendation: Decodable, Equatable {
        var id: String
        var name: String
    }
    struct Notice: Decodable, Identifiable, Equatable {
        var key: String
        var group: String
        var message: String
        var warning: Bool
        var recommendation: Recommendation?
        var id: String { key }
    }
    struct Led: Decodable, Equatable {
        var hasSections: Bool
        var canAdd: Bool
        var sections: [Section]
        var totals: String?
        var inventory: Inventory?
        var notices: [Notice]
    }
    struct Accessory: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var quantity: Double?
    }
    struct LegacyStage: Decodable, Equatable {
        var width: Double?
        var depth: Double?
        var height: Double?
        var skirt: String
        var carpet: Bool
        var stairs: Double?
        var presets: [Preset]
        var heights: [Double]
        var heightMissing: Bool
        var accessories: [Accessory]
    }
    struct Component: Decodable, Identifiable, Equatable {
        var id: String
        var name: String
        var editable: Bool
        var quantity: Double?
        var text: String
    }

    var profile: String
    var heading: String
    var title: String
    var scope: [String]
    var error: String?
    var loadError: String?
    var lines: [Line]
    var calculatorTotal: Double?
    var totalText: String
    var note: String?
    var roots: [Root]
    var english: [English]
    var loadedAt: String?
    var stage: Stage?
    var led: Led?
    var legacyStage: LegacyStage?
    var components: [Component]?
    var area: Double?
    var areaEditable: Bool

    /// Opis pozycji z zakresu konfiguracji (`modularScope(...).join('\n')` w CRM).
    var scopeText: String { scope.joined(separator: "\n") }
}

struct ModularReply: Decodable {
    var snapshot: JSONValue
    var view: ModularView
}

extension OffersStore {
    /// Konfiguracja po zmianach: nowa z produktu (`productID`) albo istniejąca (`snapshot`), `refresh` — ponowne pobranie
    /// sprzętu i cen rentalnych, `quantity` — liczba zestawów w ofercie (stan modułów LED).
    func configureModular(productID: String?, snapshot: JSONValue?, edits: [JSONValue], refresh: Bool, quantity: Double?) async throws -> ModularReply {
        guard let api else { throw AppError.configuration }
        var body: [String: JSONValue] = ["op": .string("modular"), "edits": .array(edits), "refresh": .bool(refresh)]
        if let snapshot { body["snapshot"] = snapshot } else if let productID { body["productId"] = .string(productID) }
        if let quantity, quantity.isFinite { body["quantity"] = .number(quantity) }
        return try JSONDecoder().decode(ModularReply.self, from: try await api.post("/offers", body, timeout: 60))
    }
}

/// Stan jednego konfiguratora: kopia konfiguracji, widok z serwera i kolejka zmian (pola liczbowe wysyłane po chwili
/// bez pisania, przyciski i wybory od razu; kolejne zmiany czekają na odpowiedź i idą razem).
@MainActor final class ModularConfiguratorModel: ObservableObject {
    let store: OffersStore
    private let productID: String?
    @Published private(set) var snapshot: JSONValue?
    @Published private(set) var view: ModularView?
    @Published private(set) var busy = false
    @Published private(set) var failure: String?
    /// Wartości wpisywane w pola, zanim serwer przeliczy konfigurację (pole nie wraca do starej wartości).
    @Published private var typedNumbers: [String: Double?] = [:]
    @Published private var typedTexts: [String: String] = [:]
    /// Liczba zestawów w ofercie — do porównania modułów LED ze stanem magazynu.
    var quantity: Double = 1
    /// Każda konfiguracja przeliczona przez serwer.
    var onChange: ((JSONValue, ModularView) -> Void)?
    private var pending: [JSONValue] = []
    private var refreshPending = false
    private var debounce: Task<Void, Never>?

    /// Nowa konfiguracja z karty produktu.
    init(store: OffersStore, productID: String) {
        self.store = store
        self.productID = productID
    }

    /// Zapisana konfiguracja (pozycja, propozycja) — opcjonalnie z gotowym widokiem.
    init(store: OffersStore, snapshot: JSONValue, view: ModularView? = nil) {
        self.store = store
        self.productID = nil
        self.snapshot = snapshot
        self.view = view
    }

    /// Pierwsze wczytanie widoku (pobiera też brakujący sprzęt).
    func start() {
        if view == nil && !busy { flush(force: true) }
    }

    func retry() {
        failure = nil
        flush(force: view == nil)
    }

    /// „Pobierz aktualny sprzęt i ceny rentalne”.
    func refresh() {
        refreshPending = true
        flush()
    }

    /// Ponowne przeliczenie bez zmian (np. „Odśwież stan” modułów LED).
    func reload() { edit("reload") }

    /// Przed zapisem: czekające zmiany idą od razu, a zapis czeka na ostatnie przeliczenie.
    func settle() async {
        if debounce != nil || !pending.isEmpty { flush() }
        while busy { try? await Task.sleep(nanoseconds: 100_000_000) }
    }

    func edit(_ op: String, _ fields: [String: JSONValue] = [:], typing: Bool = false) {
        var edit = fields
        edit["op"] = .string(op)
        pending.append(.object(edit))
        if typing {
            debounce?.cancel()
            debounce = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 450_000_000)
                guard !Task.isCancelled else { return }
                self?.flush()
            }
        } else {
            flush()
        }
    }

    static func number(_ value: Double?) -> JSONValue {
        guard let value, value.isFinite else { return .string("") }
        return .number(value)
    }

    /// Pole liczbowe: pokazuje wpisaną wartość do czasu odpowiedzi serwera, potem wartość z konfiguracji.
    func numberBinding(_ field: String, _ server: Double?, send: @escaping (Double?) -> Void) -> Binding<Double?> {
        Binding(get: { [weak self] in
            if let typed = self?.typedNumbers[field] { return typed }
            return server
        }, set: { [weak self] value in
            self?.typedNumbers[field] = .some(value)
            send(value)
        })
    }

    func textBinding(_ field: String, _ server: String, send: @escaping (String) -> Void) -> Binding<String> {
        Binding(get: { [weak self] in self?.typedTexts[field] ?? server }, set: { [weak self] value in
            self?.typedTexts[field] = value
            send(value)
        })
    }

    private func flush(force: Bool = false) {
        debounce?.cancel()
        debounce = nil
        guard !busy, snapshot != nil || productID != nil else { return }
        let edits = pending
        let refresh = refreshPending
        guard force || !edits.isEmpty || refresh else { return }
        pending = []
        refreshPending = false
        busy = true
        Task { [weak self] in
            guard let self else { return }
            do {
                let reply = try await store.configureModular(productID: productID, snapshot: snapshot, edits: edits, refresh: refresh, quantity: quantity)
                snapshot = reply.snapshot
                view = reply.view
                failure = nil
                busy = false
                if pending.isEmpty {
                    typedNumbers = [:]
                    typedTexts = [:]
                }
                onChange?(reply.snapshot, reply.view)
            } catch {
                // Zmiany wracają do kolejki — „Spróbuj ponownie” albo następna zmiana wyśle je jeszcze raz.
                failure = store.failureText(error, "Nie udało się przeliczyć konfiguracji.")
                pending = edits + pending
                refreshPending = refreshPending || refresh
                busy = false
                return
            }
            if !pending.isEmpty || refreshPending { flush() }
        }
    }
}

// MARK: Panel konfiguratora

@MainActor struct ModularConfiguratorPanel: View {
    @ObservedObject var model: ModularConfiguratorModel
    var disabled = false
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Group {
            if let view = model.view {
                content(view)
            } else if let failure = model.failure {
                HStack(spacing: 8) {
                    Text(failure).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    Button("Spróbuj ponownie") { model.retry() }.controlSize(.small)
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Pobieranie sprzętu, zależności i cen rentalnych…").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { model.start() }
    }

    private func content(_ view: ModularView) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(view.heading).font(.headline)
                Spacer()
                if model.busy { ProgressView().controlSize(.small).help("Przeliczanie…") }
            }
            Group {
                if let stage = view.stage { stageSection(stage) }
                if let legacy = view.legacyStage { legacySection(legacy) }
                if let led = view.led { ledSection(led) }
                if view.areaEditable {
                    ProductField(label: "Powierzchnia ekranu (m²)") {
                        ProductNumberField(value: model.numberBinding("area", view.area) { model.edit("area", ["value": ModularConfiguratorModel.number($0)], typing: true) },
                                           nullable: true, suffix: "m²").frame(width: 140)
                    }
                }
                if let components = view.components { componentRows(components) }
                ForEach(view.roots) { root in rootSection(root) }
            }
            Group {
                if let failure = model.failure {
                    HStack(spacing: 8) {
                        Text(failure).font(.caption).foregroundStyle(.red)
                        Button("Spróbuj ponownie") { model.retry() }.controlSize(.small)
                    }
                }
                if let loadError = view.loadError {
                    HStack(spacing: 8) {
                        Text(loadError).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                        Button("Spróbuj ponownie") { model.refresh() }.controlSize(.small)
                    }
                }
                if let loaded = view.loadedAt { equipmentFooter(view, loaded: loaded) }
            }
            if let error = view.error, error != view.loadError {
                Text(error).font(.callout).foregroundStyle(.orange)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if !view.lines.isEmpty { linesTable(view) }
            Text(view.totalText).font(.callout.weight(.semibold)).foregroundStyle(theme.accent)
                .frame(maxWidth: .infinity, alignment: .trailing)
            if let note = view.note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .disabled(disabled)
        .padding(14)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.15)))
    }

    // MARK: Podest z magazynu

    private func stageSection(_ stage: ModularView.Stage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ProductField(label: "Wysokość podestu (cm)",
                         help: "Najpierw wpisz wysokość. Nogi z uzupełnionymi zakresami dobierzemy automatycznie; liczbę sztuk i cenę wyliczymy z rozmiaru podestu.") {
                ProductNumberField(value: model.numberBinding("height", stage.height) { model.edit("height", ["value": ModularConfiguratorModel.number($0)], typing: true) },
                                   prompt: "Np. 60", nullable: true, suffix: "cm").frame(width: 140)
            }
            if let message = stage.heightMessage {
                VStack(alignment: .leading, spacing: 6) {
                    Text(message).font(.caption).foregroundStyle(theme.accent)
                    chips(stage.heightOptions.map { option -> (String, () -> Void) in
                        (option.label, { model.edit("height", ["value": .number(option.height)]) })
                    })
                }
            }
            chips(presetActions(stage.presets))
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Szerokość frontu (m)") {
                    ProductNumberField(value: model.numberBinding("width", stage.width) { model.edit("width", ["value": ModularConfiguratorModel.number($0)], typing: true) },
                                       nullable: true, suffix: "m").frame(width: 120)
                }
                ProductField(label: "Głębokość (m)") {
                    ProductNumberField(value: model.numberBinding("depth", stage.depth) { model.edit("depth", ["value": ModularConfiguratorModel.number($0)], typing: true) },
                                       nullable: true, suffix: "m").frame(width: 120)
                }
                if stage.showSkirt {
                    ProductField(label: "Zakres wysłony") {
                        Picker("", selection: Binding(get: { stage.skirt }, set: { model.edit("skirt", ["value": .string($0)]) })) {
                            Text("Front i dwa boki").tag("front_sides")
                            Text("Wszystkie cztery boki").tag("all")
                        }
                        .labelsHidden().fixedSize()
                    }
                }
            }
            StageDeckGrid(width: stage.width, depth: stage.depth) { width, depth in
                model.edit("size", ["width": .number(width), "depth": .number(depth)])
            }
            Text(stage.summary).font(.caption).foregroundStyle(theme.accent)
        }
    }

    // MARK: Podest ze stawkami (starsze oferty)

    private func legacySection(_ stage: ModularView.LegacyStage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            chips(presetActions(stage.presets))
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Szerokość frontu (m)") {
                    ProductNumberField(value: model.numberBinding("width", stage.width) { model.edit("width", ["value": ModularConfiguratorModel.number($0)], typing: true) }, nullable: true)
                        .frame(width: 100)
                }
                ProductField(label: "Głębokość (m)") {
                    ProductNumberField(value: model.numberBinding("depth", stage.depth) { model.edit("depth", ["value": ModularConfiguratorModel.number($0)], typing: true) }, nullable: true)
                        .frame(width: 100)
                }
                ProductField(label: "Wysokość podestu (cm)") {
                    ProductNumberField(value: model.numberBinding("height", stage.height) { model.edit("height", ["value": ModularConfiguratorModel.number($0)], typing: true) }, nullable: true)
                        .frame(width: 100)
                }
                ProductField(label: "Schody — liczba kompletów") {
                    ProductNumberField(value: model.numberBinding("stairs", stage.stairs) { model.edit("stairs", ["value": ModularConfiguratorModel.number($0)], typing: true) }, nullable: true)
                        .frame(width: 100)
                }
            }
            HStack(spacing: 16) {
                ProductField(label: "Wysłona") {
                    Picker("", selection: Binding(get: { stage.skirt }, set: { model.edit("skirt", ["value": .string($0)]) })) {
                        Text("Bez wysłony").tag("none")
                        Text("Front i dwa boki").tag("front_sides")
                        Text("Cztery strony").tag("all")
                    }
                    .labelsHidden().fixedSize()
                }
                Toggle("Pokrycie dywanem", isOn: Binding(get: { stage.carpet }, set: { model.edit("carpet", ["enabled": .bool($0)]) }))
                    .toggleStyle(.checkbox).padding(.top, 14)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Wpisz wysokość podestu — nogi i ich liczbę dobierzemy z zapisanych wariantów. Dostępne wysokości:")
                    .font(.caption).foregroundStyle(.secondary)
                chips(stage.heights.map { height -> (String, () -> Void) in
                    ("\(OfferText.number(height)) cm", { model.edit("height", ["value": .number(height)]) })
                })
                if stage.heightMissing {
                    Text("Brak nóg dla podanej wysokości. Wybierz jedną z dostępnych powyżej.").font(.caption).foregroundStyle(.orange)
                }
            }
            ForEach(stage.accessories) { accessory in
                HStack {
                    Text(accessory.name.isEmpty ? "Akcesorium" : accessory.name).frame(maxWidth: .infinity, alignment: .leading)
                    ProductNumberField(value: model.numberBinding("accessory:\(accessory.id)", accessory.quantity) {
                        model.edit("accessoryQuantity", ["id": .string(accessory.id), "value": ModularConfiguratorModel.number($0)], typing: true)
                    }, nullable: true, suffix: "szt.").frame(width: 120)
                }
                .font(.callout)
            }
            Text("Rozmiar dotyczy jednego podestu. Ilość zestawów i liczba dni w ofercie mnożą całą jego cenę. Stawki i akcesoria tej oferty (nazwy, ceny) zmienisz w CRM.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Ekran LED

    @ViewBuilder private func ledSection(_ led: ModularView.Led) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !led.hasSections {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Ta konfiguracja ma powierzchnię bez podziału na sekcje.").font(.callout)
                    Button("Utwórz układ z sekcji 50 × 50 cm") { model.edit("sectionsCreate") }.controlSize(.small)
                    Text("Rozpocznie od sekcji 1 × 1 m i przeliczy cenę według nowej powierzchni.").font(.caption).foregroundStyle(.secondary)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            ForEach(led.sections) { section in sectionEditor(section, removable: led.sections.count > 1) }
            if led.hasSections {
                Button { model.edit("sectionAdd") } label: { Label("Dodaj sekcję", systemImage: "plus") }
                    .controlSize(.small).disabled(!led.canAdd)
            }
            if let totals = led.totals { Text(totals).font(.callout) }
            if let inventory = led.inventory {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(inventory.text).font(.callout).foregroundStyle(inventory.warning ? Color.orange : Color.primary)
                        Spacer()
                        Button("Odśwież stan") { model.reload() }.buttonStyle(.link).font(.caption)
                    }
                    Text("Stan własnego sprzętu, bez odjęcia rezerwacji na termin eventu. Braki nie blokują konfiguracji. Informacja wewnętrzna.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background((inventory.warning ? Color.orange : Color.primary).opacity(inventory.warning ? 0.1 : 0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            ForEach(led.notices) { notice in
                VStack(alignment: .leading, spacing: 4) {
                    Text(notice.group).font(.callout.weight(.medium))
                    Text(notice.message).font(.callout).fixedSize(horizontal: false, vertical: true)
                    if let recommendation = notice.recommendation {
                        Button("Wybierz \(recommendation.name)") {
                            model.edit("choice", ["key": .string(notice.key), "linkId": .string(recommendation.id)])
                        }
                        .controlSize(.small)
                    }
                    if notice.warning {
                        Text("Informacja wewnętrzna. Możesz kontynuować konfigurację i uwzględnić rental.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(notice.warning ? Color.orange : Color.primary)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background((notice.warning ? Color.orange : Color.primary).opacity(notice.warning ? 0.1 : 0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func sectionEditor(_ section: ModularView.Section, removable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                ProductField(label: "Nazwa sekcji") {
                    TextField("", text: model.textBinding("section:\(section.id)", section.name) { name in
                        model.edit("sectionSet", ["id": .string(section.id), "name": .string(String(name.prefix(100)))], typing: true)
                    })
                    .textFieldStyle(.roundedBorder)
                }
                Button("Usuń", role: .destructive) { model.edit("sectionRemove", ["id": .string(section.id)]) }
                    .controlSize(.small).disabled(!removable)
            }
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Szerokość — kolumny") {
                    ProductNumberField(value: model.numberBinding("columns:\(section.id)", section.columns) {
                        model.edit("sectionSet", ["id": .string(section.id), "columns": ModularConfiguratorModel.number($0)], typing: true)
                    }, nullable: true).frame(width: 110)
                }
                ProductField(label: "Wysokość — wiersze") {
                    ProductNumberField(value: model.numberBinding("rows:\(section.id)", section.rows) {
                        model.edit("sectionSet", ["id": .string(section.id), "rows": ModularConfiguratorModel.number($0)], typing: true)
                    }, nullable: true).frame(width: 110)
                }
            }
            Text(section.summary).font(.caption).foregroundStyle(theme.accent)
            LedSectionGrid(columns: section.columns, rows: section.rows) { columns, rows in
                model.edit("sectionSet", ["id": .string(section.id), "columns": .number(Double(columns)), "rows": .number(Double(rows))])
            }
            Text("2 kafelki = 1 m. Kliknij pole siatki, aby wybrać układ; siatka rośnie razem z wyborem.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(10)
        .background(Color.black.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Składniki (nagłośnienie, mikrofony, LED z powierzchnią)

    private func componentRows(_ components: [ModularView.Component]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(components) { component in
                HStack {
                    Text(component.name).frame(maxWidth: .infinity, alignment: .leading)
                    if component.editable {
                        ProductNumberField(value: model.numberBinding("component:\(component.id)", component.quantity) {
                            model.edit("componentQuantity", ["id": .string(component.id), "value": ModularConfiguratorModel.number($0)], typing: true)
                        }, nullable: true, suffix: "szt.").frame(width: 120)
                    } else {
                        Text(component.text).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                .font(.callout)
            }
            Text("Modele, stawki i mnożnik zestawu w tej ofercie zmienisz w CRM.").font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Drzewo sprzętu

    private func rootSection(_ root: ModularView.Root) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(root.title).font(.callout.weight(.medium))
            if root.optional {
                Toggle(root.optionalLabel, isOn: Binding(get: { root.enabled }, set: { model.edit("rootEnabled", ["id": .string(root.id), "enabled": .bool($0)]) }))
                    .toggleStyle(.checkbox)
            }
            if root.quantityEditable {
                ProductField(label: "Ilość na cały zestaw") {
                    ProductNumberField(value: model.numberBinding("root:\(root.id)", root.quantity) {
                        model.edit("rootQuantity", ["id": .string(root.id), "value": ModularConfiguratorModel.number($0)], typing: true)
                    }, nullable: true).frame(width: 110)
                }
            }
            if let tree = root.tree { ModularNodeView(node: tree, model: model) }
        }
    }

    private func equipmentFooter(_ view: ModularView, loaded: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button { model.refresh() } label: { Label("Pobierz aktualny sprzęt i ceny rentalne", systemImage: "arrow.clockwise") }
                    .controlSize(.small)
                Text("Pobrano: \(Self.loadedText(loaded))").font(.caption).foregroundStyle(.secondary)
            }
            Text("Ponowne pobranie zmieni stawki i dostępne warianty w tej edycji. Zapisane oferty zachowują własną kopię.")
                .font(.caption).foregroundStyle(.secondary)
            if !view.english.isEmpty {
                DisclosureGroup("Nazwy angielskie do PDF") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(view.english) { item in
                            ProductField(label: item.name) {
                                TextField("", text: model.textBinding("en:\(item.id)", item.nameEn ?? "") { value in
                                    model.edit("english", ["id": .string(item.id), "value": .string(String(value.prefix(300)))], typing: true)
                                }, prompt: Text("Angielska nazwa wyposażenia"))
                                .textFieldStyle(.roundedBorder)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                .font(.callout).tint(theme.accent)
            }
        }
    }

    private func linesTable(_ view: ModularView) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 5) {
            GridRow {
                Text("Składniki")
                Text("Ilość")
                Text(view.profile == "warehouse_stage" ? "Stawka rentalna netto" : "Stawka netto").gridColumnAlignment(.trailing)
                Text("Razem netto").gridColumnAlignment(.trailing)
            }
            .font(.caption).foregroundStyle(.secondary)
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(view.lines) { line in
                GridRow {
                    Text(line.name).frame(maxWidth: .infinity, alignment: .leading)
                    Text(line.quantity).monospacedDigit()
                    Text(line.rate).monospacedDigit()
                    Text(line.total).monospacedDigit()
                }
                .font(.caption)
            }
        }
    }

    private func presetActions(_ presets: [ModularView.Preset]) -> [(String, () -> Void)] {
        presets.map { preset in (preset.label, { model.edit("size", ["width": .number(preset.width), "depth": .number(preset.depth)]) }) }
    }

    /// Przyciski szybkiego wyboru (wysokości, rozmiary).
    private func chips(_ items: [(String, () -> Void)]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Button(item.0, action: item.1)
                    .buttonStyle(.bordered).controlSize(.small).tint(theme.accent)
            }
        }
    }

    static func loadedText(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.dateFormat = "d.MM.yyyy, HH:mm"
        return formatter.string(from: date)
    }
}

/// Element drzewa sprzętu (`SelectionTree` w CRM): warianty do wyboru, dodatki opcjonalne, zależności wymagane.
@MainActor struct ModularNodeView: View {
    let node: ModularView.Node
    @ObservedObject var model: ModularConfiguratorModel
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(node.name) · \(node.detail)").font(.callout)
            ForEach(node.groups) { group in
                VStack(alignment: .leading, spacing: 6) {
                    control(group)
                    ForEach(group.children, id: \.path) { child in
                        ModularNodeView(node: child, model: model)
                    }
                }
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.08)).frame(width: 1) }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func control(_ group: ModularView.Group) -> some View {
        switch group.kind {
        case "automatic":
            Text(group.label).font(.caption).foregroundStyle(theme.accent)
        case "choice":
            ProductField(label: group.label) {
                Picker("", selection: Binding(get: { group.options.contains { $0.id == group.selected } ? group.selected : "" }, set: { id in
                    model.edit("choice", ["key": .string(group.key), "linkId": .string(id)])
                })) {
                    Text(group.placeholder).tag("")
                    ForEach(group.options) { option in Text(option.label).tag(option.id) }
                }
                .labelsHidden()
                .frame(maxWidth: 520, alignment: .leading)
            }
        case "optional":
            Toggle(group.label, isOn: Binding(get: { group.enabled }, set: { model.edit("enabled", ["key": .string(group.key), "enabled": .bool($0)]) }))
                .toggleStyle(.checkbox).font(.callout)
        default:
            Text(group.label).font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// „Cena z kalkulatora” i powrót do niej po wpisaniu własnej ceny (`ModularPriceHint` w CRM).
@MainActor struct ModularPriceHint: View {
    let calculatorTotal: Double?
    let manual: Bool
    var disabled = false
    let onReset: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(calculatorTotal.map { "Cena z kalkulatora: \(OfferText.amount($0)) zł netto / zestaw / dzień." } ?? "Uzupełnij kalkulator, aby wyświetlić cenę sugerowaną.")
            Text(manual ? "Własna cena bazowa. Zmiana składników nie nadpisze Twojej stawki. Rabat naliczymy od niej."
                        : "Możesz wpisać własną cenę bazową netto za dzień w polu ceny. Rabat naliczymy od wpisanej stawki.")
            if manual {
                Button("Użyj ceny z kalkulatora", action: onReset).controlSize(.small).disabled(disabled || calculatorTotal == nil)
            }
        }
        .font(.caption).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: Siatki wyboru rozmiaru

/// Siatka blatów 1 × 2 m (`StageModuleGrid`): kliknięcie wybiera prostokątny układ, obrót zmienia ułożenie blatów.
@MainActor struct StageDeckGrid: View {
    let width: Double?
    let depth: Double?
    let onChoose: (Double, Double) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var vertical = false
    @State private var hover: Cell?

    private struct Cell: Equatable { var column: Int; var row: Int }
    private let metre: CGFloat = 14

    private var cellWidth: Double { vertical ? 1 : 2 }
    private var cellDepth: Double { vertical ? 2 : 1 }
    private func count(_ value: Double?, _ size: Double) -> Int? {
        guard let value, value >= 1, (value / size).rounded() == value / size else { return nil }
        return Int(value / size)
    }
    private var columns: Int? { count(width, cellWidth) }
    private var rows: Int? { count(depth, cellDepth) }
    private var visibleColumns: Int { min(Int(100 / cellWidth), max(Int(12 / cellWidth), (columns ?? 0) + 1)) }
    private var visibleRows: Int { min(Int(100 / cellDepth), max(Int(6 / cellDepth), (rows ?? 0) + 1)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Siatka blatów 1 × 2 m — blat: \(Int(cellWidth)) m w poziomie × \(Int(cellDepth)) m w pionie").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Obróć układ o 90°") { hover = nil; vertical.toggle() }.controlSize(.small)
            }
            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(1...visibleRows, id: \.self) { row in
                        HStack(spacing: 2) {
                            ForEach(1...visibleColumns, id: \.self) { column in cell(column, row) }
                        }
                    }
                }
                .padding(4)
                .onHover { inside in if !inside { hover = nil } }
            }
            .frame(maxHeight: 220)
            Text(hint).font(.caption).foregroundStyle(.secondary)
        }
        .padding(10)
        .background(Color.black.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .onAppear { orient() }
        .onChange(of: width) { _, _ in orient() }
        .onChange(of: depth) { _, _ in orient() }
    }

    private func cell(_ column: Int, _ row: Int) -> some View {
        let target = hover ?? columns.flatMap { c in rows.map { Cell(column: c, row: $0) } }
        let active = target.map { column <= $0.column && row <= $0.row } ?? false
        return RoundedRectangle(cornerRadius: 2)
            .fill(active ? theme.accent.opacity(0.65) : Color.primary.opacity(0.08))
            .frame(width: CGFloat(cellWidth) * metre * 2 - 2, height: CGFloat(cellDepth) * metre * 2 - 2)
            .contentShape(Rectangle())
            .onHover { inside in if inside { hover = Cell(column: column, row: row) } }
            .onTapGesture {
                hover = nil
                onChoose(Double(column) * cellWidth, Double(row) * cellDepth)
            }
            .help("\(OfferText.number(Double(column) * cellWidth)) × \(OfferText.number(Double(row) * cellDepth)) m, \(column * row) blatów")
    }

    private var hint: String {
        if let hover {
            return "Wybierasz \(OfferText.number(Double(hover.column) * cellWidth)) × \(OfferText.number(Double(hover.row) * cellDepth)) m — \(hover.column * hover.row) blatów."
        }
        return "Kliknij pole siatki, aby wybrać prostokątny układ (front × głębokość). Siatka rośnie razem z wyborem."
    }

    /// Układ, w którym bieżący rozmiar da się ułożyć z blatów (jak efekt w `StageModuleGrid`).
    private func orient() {
        guard let width, let depth else { return }
        let horizontalFits = count(width, 2) != nil && count(depth, 1) != nil
        let verticalFits = count(width, 1) != nil && count(depth, 2) != nil
        if vertical && !verticalFits && horizontalFits { vertical = false }
        if !vertical && !horizontalFits && verticalFits { vertical = true }
    }
}

/// Siatka kafelków LED 50 × 50 cm (`LedSectionGrid`): kliknięcie wybiera liczbę kolumn i wierszy sekcji.
@MainActor struct LedSectionGrid: View {
    let columns: Double?
    let rows: Double?
    let onChoose: (Int, Int) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var hover: (column: Int, row: Int)?

    private let tile: CGFloat = 14
    private var selectedColumns: Int { columns.map { Int($0) } ?? 0 }
    private var selectedRows: Int { rows.map { Int($0) } ?? 0 }
    /// Parzysta liczba kafelków (pełne metry) z zapasem na powiększenie, do 200.
    private func visible(_ selected: Int, minimum: Int) -> Int { min(200, max(minimum, Int((Double(selected + 2) / 2).rounded(.up)) * 2)) }

    var body: some View {
        let visibleColumns = visible(selectedColumns, minimum: 12)
        let visibleRows = visible(selectedRows, minimum: 8)
        let target: (column: Int, row: Int) = hover ?? (column: selectedColumns, row: selectedRows)
        return ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(1...visibleRows, id: \.self) { row in
                    HStack(spacing: 2) {
                        ForEach(1...visibleColumns, id: \.self) { column in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(column <= target.column && row <= target.row ? theme.accent.opacity(0.65) : Color.primary.opacity(0.08))
                                .frame(width: tile, height: tile)
                                .contentShape(Rectangle())
                                .onHover { inside in if inside { hover = (column: column, row: row) } }
                                .onTapGesture {
                                    hover = nil
                                    onChoose(column, row)
                                }
                                .help("\(column) kolumn × \(row) wierszy, \(OfferText.number(Double(column) / 2)) × \(OfferText.number(Double(row) / 2)) m")
                        }
                    }
                }
            }
            .padding(4)
            .onHover { inside in if !inside { hover = nil } }
        }
        .frame(maxHeight: 240)
    }
}
