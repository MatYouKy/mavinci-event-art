import Foundation

// MARK: Oferty, część E — kreator nowej oferty (`OfferWizard` w CRM). Mac trzyma szkic kreatora (klient, dane podstawowe,
// pozycje), a wycenę, gotowość produktów do oferty i braki sprzętu liczy serwer (`op=wizardPreview`, te same funkcje co okna
// pozycji CRM). Produkty z konfiguratorem (scena, LED) dostają konfigurację z `op=modular` i panel konfiguratora w wierszu
// (`ModularConfigurator.swift`). Serwer: `src/lib/native/offerWizard.ts`.

struct OfferWizardEvent: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var date: String?
    var client: String
}

struct OfferWizardSetup: Decodable {
    struct Event: Decodable {
        var id: String
        var name: String
        var startsAt: String?
        var endsAt: String?
        var category: String?
    }
    struct Organization: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var nip: String
        var email: String
        var phone: String
    }
    struct Contact: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var email: String
        var phone: String
    }
    struct Category: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct Variant: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var priceNet: Double
        var priceGross: Double?
        var recommended: Bool
        var quantitySource: String?
        var description: String
    }
    struct Package: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var included: String
        var bonus: String
        var priceNet: Double
        var priceOnRequest: Bool
        var includeProductAddons: Bool
        var quoteOnly: Bool { priceOnRequest && priceNet <= 0 }
        var priceText: String { quoteOnly ? "Wycena indywidualna" : "\(OfferText.amount(priceNet)) zł netto" }
    }
    struct Product: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var categoryId: String?
        var category: String?
        var description: String
        var offerDescription: String
        var unit: String
        var basePrice: Double
        var vatRate: Double
        var imageUrl: String?
        var modular: Bool
        var quantitySource: String
        var packagesEnabled: Bool
        var variants: [Variant]
        var packages: [Package]
        /// Pełne pakiety do zmian tylko w tej ofercie (sprzęt i obsada, koszty).
        var packageOptions: [JSONValue]?
        var addons: [ProductAddonItem]
        var readiness: ProductListItem.Readiness

        static func == (lhs: Product, rhs: Product) -> Bool { lhs.id == rhs.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }
    var event: Event
    var clientType: String
    var organizationId: String
    var contactId: String
    var initialStep: Int
    var location: String
    var hasDescription: Bool
    var taxPercent: Double
    var organizations: [Organization]
    var contacts: [Contact]
    var categories: [Category]
    var products: [Product]
}

struct OfferWizardPreview: Decodable {
    struct Item: Decodable {
        var key: String
        var name: String
        var unit: String
        var quantity: Double
        var days: Double
        var baseUnitPrice: Double
        var unitPrice: Double
        var subtotal: Double
        var needsTables: Bool
        var audienceRequired: Bool
        var error: String?
        var readiness: ProductListItem.Readiness?
    }
    struct Pricing: Decodable {
        var listNet: Double
        var targetNet: Double
        var discountAmount: Double
        var discountPercent: Double
        var taxPercent: Double
        var taxAmount: Double
        var gross: Double
    }
    struct Conflict: Decodable, Identifiable {
        var key: String
        var name: String
        var required: Double
        var available: Double
        var reserved: Double
        var total: Double
        var shortage: Double
        var id: String { key }
    }
    var items: [Item]
    var needsTables: Bool
    var pricing: Pricing
    var conflicts: [Conflict]
    var conflictsChecked: Bool
}

/// Pozycja szkicu kreatora: produkt z katalogu (pakiet, wariant, dodatki w `draft`) albo pozycja własna.
struct OfferWizardItem: Identifiable, Equatable {
    let id: String
    var productId: String?
    var name: String
    var description: String
    var unit: String
    var draft: OfferItemDraft

    var json: JSONValue {
        .object([
            "key": .string(id), "productId": productId.map { JSONValue.string($0) } ?? .null, "name": .string(name),
            "description": .string(description), "unit": .string(unit), "draft": draft.json,
        ])
    }

    static func draft(quantity: Double, days: Double, price: Double) -> OfferItemDraft {
        OfferItemDraft(variantId: nil, packageId: "", quantity: quantity, quantitySource: "manual", days: days, unitPrice: price,
                       discountPercent: 0, addons: [], variantPrices: [:], showVariants: true, showVariantPrices: true, name: nil, vatRate: nil)
    }
}

extension OffersStore {
    func wizardEvents() async throws -> [OfferWizardEvent] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { var events: [OfferWizardEvent] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/offers?op=wizardEvents")).events
    }

    func wizardSetup(event: String) async throws -> OfferWizardSetup {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferWizardSetup.self, from: try await api.get("/offers?op=wizardSetup&event=\(event)"))
    }

    func wizardPreview(_ body: [String: JSONValue]) async throws -> OfferWizardPreview {
        guard let api else { throw AppError.configuration }
        var request = body
        request["op"] = .string("wizardPreview")
        return try JSONDecoder().decode(OfferWizardPreview.self, from: try await api.post("/offers", request))
    }

    func wizardContact(first: String, last: String, email: String, phone: String) async throws -> OfferWizardSetup.Contact {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var contact: OfferWizardSetup.Contact }
        let body: [String: JSONValue] = [
            "op": .string("wizardContact"), "firstName": .string(first), "lastName": .string(last), "email": .string(email), "phone": .string(phone),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/offers", body)).contact
    }

    /// „Utwórz ofertę”: zwraca identyfikator, komunikat i liczbę produktów niegotowych do oferty.
    func wizardCreate(_ body: [String: JSONValue]) async throws -> (id: String, message: String, notReady: Int) {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Utworzenie oferty wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var id: String; var message: String; var notReady: Int }
        var request = body
        request["op"] = .string("wizardCreate")
        let data = try await workspace.withPending("Tworzenie oferty…") { try await api.post("/offers", request, timeout: 120) }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        Task { await sync(force: true) }
        return (reply.id, reply.message, reply.notReady)
    }
}

/// Stan kreatora (jak `useOfferWizardLogic`): krok, klient, dane podstawowe, liczba osób, pozycje i cena docelowa.
@MainActor final class OfferWizardModel: ObservableObject {
    let eventID: String
    let store: OffersStore
    @Published private(set) var setup: OfferWizardSetup?
    @Published var loadError: String?
    @Published var step = 1
    @Published private(set) var initialStep = 1
    @Published var clientType = "business"
    @Published var organizationId = ""
    @Published var contactId = ""
    @Published var contacts: [OfferWizardSetup.Contact] = []
    @Published var offerNumber = ""
    @Published var validUntil: Date?
    @Published var location = ""
    @Published var goal = ""
    @Published var notes = ""
    @Published var guestCount: Double? { didSet { if guestCount != oldValue { schedulePreview() } } }
    @Published var guestsPerTable: Double? = 10 { didSet { if guestsPerTable != oldValue { schedulePreview() } } }
    @Published var tableCount: Double? { didSet { if tableCount != oldValue { schedulePreview() } } }
    @Published var items: [OfferWizardItem] = [] { didSet { if items != oldValue { schedulePreview() } } }
    @Published var targetNet: Double? { didSet { if targetNet != oldValue { schedulePreview() } } }
    @Published private(set) var preview: OfferWizardPreview?
    @Published private(set) var previewing = false
    @Published var previewError: String?
    @Published var creating = false
    /// Produkty modułowe, których konfiguracja jest właśnie pobierana po kliknięciu „Dodaj”.
    @Published private(set) var addingModular: Set<String> = []
    /// Konfiguratory pozycji modułowych — stan panelu zostaje po zwinięciu wiersza.
    private var configurators: [String: ModularConfiguratorModel] = [:]
    /// Po dodaniu produktu — ostrzeżenie o brakach sprzętu, gdy podgląd je pokaże (jak okno w CRM po `checkCartConflicts`).
    private var warnConflicts = false
    private var previewTask: Task<Void, Never>?
    private var revision = 0

    init(eventID: String, store: OffersStore) {
        self.eventID = eventID
        self.store = store
    }

    // MARK: Wczytanie

    func load() async {
        loadError = nil
        do {
            let next = try await store.wizardSetup(event: eventID)
            clientType = next.clientType
            organizationId = next.organizationId
            contactId = next.contactId
            contacts = next.contacts
            location = next.location
            initialStep = next.initialStep
            step = next.initialStep
            setup = next
            schedulePreview()
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać danych wydarzenia. Spróbuj ponownie, aby uzupełnić ofertę zapisanymi informacjami.")
        }
    }

    var canProceedFromClient: Bool {
        clientType == "business" ? !organizationId.isEmpty : clientType == "individual" ? !contactId.isEmpty : false
    }

    // MARK: Podgląd

    private var audienceJSON: JSONValue {
        .object([
            "guestCount": guestCount.map { JSONValue.number($0) } ?? .null,
            "guestsPerTable": .number(guestsPerTable ?? 10),
            "tableCount": tableCount.map { JSONValue.number($0) } ?? .null,
        ])
    }

    private var draftBody: [String: JSONValue] {
        ["eventId": .string(eventID), "audience": audienceJSON, "items": .array(items.map(\.json)),
         "targetNet": targetNet.map { JSONValue.number($0) } ?? .string("")]
    }

    func schedulePreview() {
        guard setup != nil else { return }
        previewTask?.cancel()
        revision += 1
        let current = revision
        previewTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self?.runPreview(current)
        }
    }

    private func runPreview(_ current: Int) async {
        previewing = true
        // Chwilowa niedostępność serwera (502/503/504, zerwane połączenie, np. przy restarcie CRM) — jedna ponowna próba
        // po 1,5 s, zanim pokażemy błąd. Błędy danych (4xx) od razu.
        for attempt in 0..<2 {
            do {
                let next = try await store.wizardPreview(draftBody)
                guard current == revision else { return }
                preview = next
                previewError = nil
                if warnConflicts, !next.conflicts.isEmpty {
                    store.workspace?.notice = "Uwaga: braki sprzętu w terminie eventu. Zobacz szczegóły poniżej."
                }
                warnConflicts = false
                break
            } catch {
                guard current == revision else { return }
                if attempt == 0, Self.isTransient(error) {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    guard current == revision, !Task.isCancelled else { return }
                    continue
                }
                previewError = store.failureText(error, "Nie udało się przeliczyć oferty.")
            }
        }
        if current == revision { previewing = false }
    }

    private static func isTransient(_ error: Error) -> Bool {
        if let failure = error as? NativeFailure { return [502, 503, 504].contains(failure.status) }
        if let url = error as? URLError {
            let codes: [URLError.Code] = [.timedOut, .networkConnectionLost, .cannotConnectToHost]
            return codes.contains(url.code)
        }
        return false
    }

    func evaluated(_ item: OfferWizardItem) -> OfferWizardPreview.Item? {
        preview?.items.first { $0.key == item.id }
    }

    func product(_ id: String?) -> OfferWizardSetup.Product? {
        guard let id else { return nil }
        return setup?.products.first { $0.id == id }
    }

    struct NotReady: Identifiable {
        let item: OfferWizardItem
        let product: OfferWizardSetup.Product
        var id: String { item.id }
    }

    /// Produkty niegotowe do oferty wśród pozycji (ostrzeżenie w katalogu i podsumowaniu).
    var notReadyItems: [NotReady] {
        items.compactMap { item in
            guard let product = product(item.productId), !product.readiness.ready else { return nil }
            return NotReady(item: item, product: product)
        }
    }

    // MARK: Pozycje (jak `useOfferWizardItems`)

    /// Dodanie produktu albo zmiana zakresu (pakiet / wariant) już dodanej pozycji — ilość, dni i rabat zostają.
    func add(_ product: OfferWizardSetup.Product, variant: OfferWizardSetup.Variant? = nil, package: OfferWizardSetup.Package? = nil) {
        if product.modular {
            Task { await addModular(product) }
            return
        }
        let selectedPackage = variant == nil ? (package ?? product.packages.first) : nil
        let base = selectedPackage?.priceNet ?? variant?.priceNet ?? product.basePrice
        var addons = product.addons
        if let selectedPackage, !selectedPackage.includeProductAddons { addons = [] }
        let source = selectedPackage != nil ? "manual" : (variant?.quantitySource ?? product.quantitySource)
        let name: String
        let description: String
        if let selectedPackage {
            name = "\(product.name) — \(selectedPackage.name)"
            description = [selectedPackage.included, selectedPackage.bonus].filter { !$0.isEmpty }.joined(separator: ". ")
        } else if let variant {
            name = "\(product.name) — \(variant.name)"
            description = variant.description
        } else {
            name = product.name
            description = product.description
        }
        let showVariants = selectedPackage != nil ? true : !product.packagesEnabled
        let isNew = !items.contains { $0.productId == product.id }
        if let index = items.firstIndex(where: { $0.productId == product.id }) {
            var item = items[index]
            if variant != nil || selectedPackage != nil {
                item.name = name
                item.description = description
                item.unit = product.unit
                item.draft.variantId = selectedPackage == nil ? variant?.id : nil
                item.draft.packageId = selectedPackage?.id ?? ""
                item.draft.unitPrice = base
                item.draft.addons = addons
                item.draft.quantitySource = source
                item.draft.showVariants = showVariants
                item.draft.showVariantPrices = selectedPackage == nil
                // Nowy zakres — pakiety jak w katalogu (zmiany sprzętu, obsady i kosztów dotyczyły poprzedniego wyboru).
                item.draft.packageOptions = nil
            } else {
                item.draft.quantity += 1
            }
            items[index] = item
        } else {
            var draft = OfferWizardItem.draft(quantity: 1, days: 1, price: base)
            draft.variantId = selectedPackage == nil ? variant?.id : nil
            draft.packageId = selectedPackage?.id ?? ""
            draft.addons = addons
            draft.quantitySource = source
            draft.showVariants = showVariants
            draft.showVariantPrices = selectedPackage == nil
            items.append(OfferWizardItem(id: "temp-\(UUID().uuidString.lowercased())", productId: product.id, name: name,
                                         description: description, unit: product.unit, draft: draft))
        }
        warnConflicts = true
        if isNew && !product.readiness.ready {
            store.workspace?.notice = "„\(product.name)” nie jest gotowy do oferty — \(product.readiness.summary.lowercased())."
        }
    }

    /// Produkt z konfiguratorem (jak `addProduct` z `configuration_schema`): konfiguracja z karty produktu z pobranym sprzętem,
    /// nazwa i opis z konfiguracji, cena z kalkulatora; ponowne dodanie zwiększa ilość.
    func addModular(_ product: OfferWizardSetup.Product) async {
        if let index = items.firstIndex(where: { $0.productId == product.id }) {
            items[index].draft.quantity += 1
            return
        }
        guard !addingModular.contains(product.id) else { return }
        addingModular.insert(product.id)
        defer { addingModular.remove(product.id) }
        do {
            let reply = try await store.configureModular(productID: product.id, snapshot: nil, edits: [], refresh: false, quantity: 1)
            guard !items.contains(where: { $0.productId == product.id }) else { return }
            var draft = OfferWizardItem.draft(quantity: 1, days: 1, price: reply.view.calculatorTotal ?? 0)
            draft.showVariants = false
            draft.showVariantPrices = false
            draft.modular = reply.snapshot
            draft.modularManual = false
            let id = "temp-\(UUID().uuidString.lowercased())"
            let configurator = ModularConfiguratorModel(store: store, snapshot: reply.snapshot, view: reply.view)
            bind(configurator, to: id)
            configurators[id] = configurator
            items.append(OfferWizardItem(id: id, productId: product.id, name: reply.view.title, description: reply.view.scopeText, unit: "zestaw", draft: draft))
            warnConflicts = true
            if !product.readiness.ready {
                store.workspace?.notice = "„\(product.name)” nie jest gotowy do oferty — \(product.readiness.summary.lowercased())."
            }
        } catch {
            store.workspace?.error = store.failureText(error, "Nie udało się pobrać konfiguracji produktu.")
        }
    }

    /// Konfigurator pozycji modułowej (tworzony przy pierwszym rozwinięciu wiersza).
    func configurator(_ itemID: String) -> ModularConfiguratorModel? {
        guard let item = items.first(where: { $0.id == itemID }), let snapshot = item.draft.modular else { return nil }
        if let existing = configurators[itemID] {
            existing.quantity = item.draft.quantity
            return existing
        }
        let configurator = ModularConfiguratorModel(store: store, snapshot: snapshot)
        configurator.quantity = item.draft.quantity
        bind(configurator, to: itemID)
        configurators[itemID] = configurator
        return configurator
    }

    /// Zmiana konfiguracji przepisuje nazwę i opis pozycji, a bez własnej ceny — także cenę z kalkulatora.
    private func bind(_ configurator: ModularConfiguratorModel, to itemID: String) {
        configurator.onChange = { [weak self] snapshot, view in
            self?.update(itemID) { item in
                item.draft.modular = snapshot
                item.draft.modularRevision += 1
                item.name = view.title
                item.description = view.scopeText
                if item.draft.modularManual != true { item.draft.unitPrice = view.calculatorTotal ?? 0 }
            }
        }
    }

    /// Cena z kalkulatora zamiast własnej (`ModularPriceHint` → „Użyj ceny z kalkulatora”).
    func useCalculatorPrice(_ itemID: String) {
        let total = configurators[itemID]?.view?.calculatorTotal
        update(itemID) { item in
            item.draft.modularManual = false
            if let total { item.draft.unitPrice = total }
        }
    }

    func update(_ id: String, _ change: (inout OfferWizardItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        var item = items[index]
        change(&item)
        items[index] = item
    }

    func remove(_ id: String) {
        items.removeAll { $0.id == id }
        configurators[id] = nil
    }

    /// „Dodaj pozycję” w ostatnim kroku.
    func addCustom(name: String, description: String, quantity: Double, days: Double, price: Double) {
        items.append(OfferWizardItem(id: "temp-\(UUID().uuidString.lowercased())", productId: nil, name: name, description: description,
                                     unit: "szt", draft: OfferWizardItem.draft(quantity: quantity, days: days, price: price)))
    }

    /// Zapis edycji w ostatnim kroku (`saveEditedItem`): cena jednostkowa z dodatkami → cena bazowa bez dodatków.
    func saveEdit(_ id: String, name: String, description: String, quantity: Double, days: Double, unitPrice: Double) {
        let current = items.first { $0.id == id }.flatMap(evaluated)
        let extras = current.map { $0.unitPrice - $0.baseUnitPrice } ?? 0
        update(id) { item in
            item.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Pozycja oferty" : name.trimmingCharacters(in: .whitespacesAndNewlines)
            item.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
            item.draft.quantity = quantity.isFinite ? max(1, quantity) : 1
            item.draft.days = max(1, min(3650, days.isFinite ? days.rounded(.towardZero) : 1))
            let price = unitPrice.isFinite ? max(0, unitPrice) : 0
            if item.draft.modular != nil {
                // Zestaw: zmieniona cena staje się własną ceną bazową (kalkulator jej nie nadpisze).
                if abs(price - (current?.unitPrice ?? item.draft.unitPrice)) > 0.004 {
                    item.draft.modularManual = true
                    item.draft.unitPrice = price
                }
            } else {
                item.draft.unitPrice = item.productId == nil ? price : price - extras
            }
        }
    }

    // MARK: Utworzenie

    var conflictCount: Int { preview?.conflicts.count ?? 0 }

    func create(acceptShortage: Bool) async -> (id: String, message: String, notReady: Int)? {
        guard !creating else { return nil }
        creating = true
        defer { creating = false }
        // Zmiany w konfiguratorach zestawów wysłane i przeliczone przed utworzeniem oferty.
        for configurator in configurators.values { await configurator.settle() }
        var body = draftBody
        body["clientType"] = .string(clientType)
        body["organizationId"] = .string(organizationId)
        body["contactId"] = .string(contactId)
        body["acceptShortage"] = .bool(acceptShortage)
        body["offer"] = .object([
            "offerNumber": .string(offerNumber),
            "validUntil": .string(validUntil.map { MeetingDates.format($0, "yyyy-MM-dd") } ?? ""),
            "notes": .string(notes),
            "location": .string(location),
            "goal": .string(goal),
        ])
        do {
            return try await store.wizardCreate(body)
        } catch {
            store.workspace?.error = "Błąd podczas tworzenia oferty: " + store.failureText(error, "nieznany błąd")
            schedulePreview()
            return nil
        }
    }
}
