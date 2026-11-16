import SwiftUI

// MARK: „Zobacz, co warto dobrać do takiego wydarzenia” (`OfferRecommendationsEditor`) — propozycje dodatkowe z indywidualnymi
// cenami, poza wyceną i rezerwacją sprzętu. Jak pozycje oferty: „Dodaj produkt”, kolejność, układ w PDF, edycja i usuwanie
// zapisują się od razu (`save_offer_recommendations` ze sprawdzeniem, że nikt w międzyczasie nie zmienił propozycji).
// Propozycje z konfiguratorem (scena, LED) zmienia się w oknie edycji panelem konfiguratora (`ModularConfigurator.swift`).

@MainActor struct OfferRecommendationsCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferRecommendationsData?
    @State private var loadError: String?
    @State private var saving = false
    @State private var adding = false
    @State private var editItem: OfferRecommendationView?
    @State private var deleting: OfferRecommendationView?
    @State private var dropTarget: String?

    private var reloadKey: String {
        "\(detail.offer.updatedAt ?? "")|\(detail.offer.contentRevision ?? 0)|\(detail.items.map(\.id).joined(separator: ","))"
    }
    private var items: [OfferRecommendationView] { data?.items ?? [] }
    private var mayEdit: Bool { detail.canEdit && data?.canEdit == true }
    private var canEdit: Bool { mayEdit && !saving && state.canWrite }
    private var vatRate: Double { data?.vatRate ?? detail.vatRate }

    var body: some View {
        let addButton: AnyView? = mayEdit
            ? AnyView(Button { adding = true } label: { Label("Dodaj produkt", systemImage: "plus") }.disabled(!canEdit))
            : nil
        OfferCard(title: "Zobacz, co warto dobrać do takiego wydarzenia",
                  subtitle: "Proponowane produkty z indywidualnymi cenami. Poza wyceną i rezerwacją sprzętu; w PDF po kalkulacji i pakietach.",
                  symbol: "sparkles", trailing: addButton) {
            if let loadError, data == nil {
                HStack {
                    Text(loadError).font(.callout).foregroundStyle(.red)
                    Spacer()
                    Button("Spróbuj ponownie") { Task { await load() } }.controlSize(.small)
                }
            } else if data == nil {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Wczytywanie…").font(.callout).foregroundStyle(.secondary)
                }
            } else if items.isEmpty {
                Text("Wybierz produkty warte zaproponowania klientowi, np. telewizor, oświetlenie lub podest. Pusta sekcja nie pojawi się w PDF.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 10) {
                    ForEach(items) { item in
                        let index = items.firstIndex { $0.id == item.id } ?? 0
                        row(item, index: index)
                            .offerDropTarget(id: item.id, enabled: canEdit, targeted: $dropTarget) { dragged in reorder(dragged, onto: item.id) }
                    }
                }
            }
        }
        .task(id: reloadKey) { if !saving && editItem == nil && !adding { await load() } }
        .sheet(isPresented: $adding) {
            OfferItemSheet(store: store, offerID: detail.offer.id, itemID: nil, recommendationExclude: items.map(\.productID),
                           onRecommendation: { item in await add(item) })
        }
        .sheet(item: $editItem) { item in
            OfferRecommendationSheet(store: store, offerID: detail.offer.id, item: item, vatRate: vatRate, canEdit: mayEdit && state.canWrite) { patch in
                await persist(items, editID: item.id, patch: patch, success: "Propozycja zapisana poza wyceną")
            }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć tę propozycję?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Usuń propozycję", role: .destructive) {
                if let removed = deleting {
                    Task { await report(persist(items.filter { $0.id != removed.id }, success: "Propozycja usunięta")) }
                }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("„\(deleting?.name ?? "")” zniknie z sekcji propozycji w ofercie.")
        }
    }

    private func row(_ item: OfferRecommendationView, index: Int) -> some View {
        let gross = item.net * (1 + vatRate / 100)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                if canEdit && items.count > 1 {
                    OfferDragHandle(id: item.id, label: item.name)
                }
                ProductThumb(path: item.imagePath, url: item.imageUrl).frame(width: 64, height: 84)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name).font(.callout.weight(.semibold)).lineLimit(1).textSelection(.enabled)
                    if !item.description.isEmpty {
                        Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    HStack(spacing: 12) {
                        Text("Ilość: \(OfferText.number(item.quantity)) \(item.unit) × \(OfferText.number(item.days)) dni")
                        Text("Cena netto: \(OfferText.money(item.unitPrice))")
                        Text("Cena brutto (VAT \(OfferText.number(vatRate))%): \(OfferText.money(item.unitPrice * (1 + vatRate / 100)))")
                    }
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    HStack(spacing: 8) {
                        Text("UKŁAD W PDF").font(.caption2).foregroundStyle(.tertiary)
                        Picker("Układ w PDF", selection: Binding(get: { item.layout }, set: { layout in setLayout(item.id, layout) })) {
                            ForEach(OfferRecommendationView.layouts, id: \.key) { layout in Text(layout.label).tag(layout.key) }
                        }
                        .pickerStyle(.segmented).labelsHidden().fixedSize().controlSize(.small)
                        .disabled(!canEdit)
                        Text("Poza wyceną").font(.caption).foregroundStyle(theme.accent)
                    }
                    .padding(.top, 2)
                }
                Spacer(minLength: 8)
                Menu {
                    Button { state.showProduct(item.productID) } label: { Label("Otwórz produkt", systemImage: "shippingbox") }
                    Button { state.openCRM("/produkty/\(item.productID)") } label: { Label("Strona produktu", systemImage: "safari") }
                    if mayEdit {
                        Divider()
                        Button { editItem = item } label: { Label("Edytuj", systemImage: "pencil") }.disabled(!canEdit)
                        Button { move(index, index - 1) } label: { Label("Przenieś wyżej", systemImage: "arrow.up") }.disabled(!canEdit || index == 0)
                        Button { move(index, index + 1) } label: { Label("Przenieś niżej", systemImage: "arrow.down") }
                            .disabled(!canEdit || index == items.count - 1)
                        Button(role: .destructive) { deleting = item } label: { Label("Usuń", systemImage: "trash") }.disabled(!canEdit)
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help("Czynności propozycji")
            }
            Divider()
            HStack(alignment: .bottom) {
                Text("Wartość netto: \(OfferText.money(item.net))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("BRUTTO · VAT \(OfferText.number(vatRate))%").font(.caption2).foregroundStyle(.tertiary)
                    Text(OfferText.money(gross)).font(.title3.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
                }
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Zmiany (zapisywane od razu)

    private func setLayout(_ id: String, _ layout: String) {
        guard canEdit, let index = items.firstIndex(where: { $0.id == id }), items[index].layout != layout else { return }
        var next = items
        next[index] = next[index].with(layout: layout)
        Task { await report(persist(next, success: "Układ propozycji w PDF zapisany")) }
    }

    private func move(_ from: Int, _ to: Int) {
        guard canEdit, items.indices.contains(from), items.indices.contains(to) else { return }
        var next = items
        next.swapAt(from, to)
        Task { await report(persist(next, success: "Kolejność propozycji zapisana")) }
    }

    /// Upuszczenie przeciągniętej propozycji na innej — nowa kolejność zapisana od razu.
    private func reorder(_ dragged: String, onto target: String) -> Bool {
        guard canEdit, let order = OfferReorder.order(items.map(\.id), moving: dragged, onto: target) else { return false }
        let next = order.compactMap { id in items.first { $0.id == id } }
        Task { await report(persist(next, success: "Kolejność propozycji zapisana")) }
        return true
    }

    /// Propozycja z okna dodawania (jak `onAddRecommendation`) — zapisana od razu.
    private func add(_ item: OfferRecommendationView) async -> String? {
        if items.contains(where: { $0.productID == item.productID }) { return "Ten produkt jest już na liście propozycji." }
        return await persist(items + [item], success: "Propozycja dodana poza wyceną")
    }

    private func report(_ problem: String?) {
        if let problem { state.error = problem }
    }

    // MARK: Wczytanie i zapis

    private func load() async {
        do {
            data = try await store.recommendations(detail.offer.id)
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać propozycji.")
        }
    }

    /// Zapis listy (i zmian jednej propozycji z okna edycji); zwraca komunikat błędu albo `nil`. Po konflikcie — świeża lista.
    private func persist(_ next: [OfferRecommendationView], editID: String? = nil, patch: [String: JSONValue] = [:], success: String) async -> String? {
        guard let data else { return "Odśwież ofertę przed zapisaniem." }
        saving = true
        defer { saving = false }
        do {
            self.data = try await store.saveRecommendations(detail.offer.id, hash: data.hash, items: next, editID: editID, patch: patch, success: success)
            return nil
        } catch {
            let message = store.failureText(error, "Nie udało się zapisać propozycji")
            await load()
            return message
        }
    }
}

// MARK: Okno „Edytuj propozycję”

@MainActor struct OfferRecommendationSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let item: OfferRecommendationView
    let vatRate: Double
    let canEdit: Bool
    let onSave: ([String: JSONValue]) async -> String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name: String
    @State private var description: String
    @State private var days: Double?
    @State private var quantity: Double?
    @State private var basePrice: Double?
    @State private var discount: Double?
    @State private var addons: [ProductAddonItem]
    @State private var preview: OfferRecommendationPreview?
    @State private var saving = false
    @State private var problem: String?
    /// Zestaw (scena, LED): konfigurator, konfiguracja po zmianach i własna cena zamiast ceny z kalkulatora.
    @State private var configurator: ModularConfiguratorModel?
    @State private var modularSnapshot: JSONValue?
    @State private var modularRevision = 0
    @State private var manual: Bool

    init(store: OffersStore, offerID: String, item: OfferRecommendationView, vatRate: Double, canEdit: Bool,
         onSave: @escaping ([String: JSONValue]) async -> String?) {
        self.store = store
        self.offerID = offerID
        self.item = item
        self.vatRate = vatRate
        self.canEdit = canEdit
        self.onSave = onSave
        _name = State(initialValue: item.name)
        _description = State(initialValue: item.description)
        _days = State(initialValue: item.days)
        _quantity = State(initialValue: item.quantity)
        _basePrice = State(initialValue: item.basePrice)
        _discount = State(initialValue: item.discountPercent)
        _addons = State(initialValue: item.addons)
        _manual = State(initialValue: item.modularManual == true)
    }

    private static func value(_ number: Double?) -> JSONValue {
        guard let number, number.isFinite else { return .null }
        return .number(number)
    }

    /// Tylko zmienione pola (jak `updateDraft`): opis oznacza własny opis, cena bazowa i dodatki odtwarzają konfigurację.
    private var patch: [String: JSONValue] {
        var patch: [String: JSONValue] = [:]
        if name != item.name { patch["name"] = .string(name) }
        if description != item.description { patch["description"] = .string(description) }
        if days != item.days { patch["days"] = Self.value(days) }
        if quantity != item.quantity { patch["quantity"] = Self.value(quantity) }
        if item.modular {
            if modularRevision > 0, let modularSnapshot { patch["modular"] = modularSnapshot }
            if manual != (item.modularManual == true) { patch["modularManual"] = .bool(manual) }
            if manual && basePrice != item.basePrice { patch["basePrice"] = Self.value(basePrice) }
            if discount != item.discountPercent { patch["discountPercent"] = Self.value(discount) }
        } else {
            if basePrice != item.basePrice { patch["basePrice"] = Self.value(basePrice) }
            if item.configured && discount != item.discountPercent { patch["discountPercent"] = Self.value(discount) }
            if item.configured && addons != item.addons { patch["addons"] = .array(addons.map(\.json)) }
        }
        return patch
    }

    private var previewKey: String {
        var key = patch
        if key["modular"] != nil { key["modular"] = .number(Double(modularRevision)) }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(JSONValue.object(key)) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Zmiana zestawu (jak `onChange` konfiguratora w oknie edycji CRM): nazwa i opis z konfiguracji.
    private func applyConfiguration(_ snapshot: JSONValue, _ view: ModularView) {
        modularSnapshot = snapshot
        modularRevision += 1
        name = String(view.title.prefix(160))
        description = String(view.scopeText.prefix(5000))
    }

    /// Cena bazowa zestawu: własna albo z kalkulatora (po ostatnim podglądzie).
    private var modularPrice: Binding<Double?> {
        Binding(get: { manual ? basePrice : (preview?.item.basePrice ?? item.basePrice) }, set: { value in
            manual = true
            basePrice = value
        })
    }

    private var shown: OfferRecommendationView { preview?.item ?? item }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Edytuj propozycję").font(.title3.weight(.semibold))
                Text("Pozycja poza wyceną — nie zmienia sumy oferty.").font(.callout).foregroundStyle(theme.accent)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if item.modular, let configurator {
                        ModularConfiguratorPanel(model: configurator, disabled: !canEdit || saving)
                        ModularPriceHint(calculatorTotal: configurator.view?.calculatorTotal, manual: manual, disabled: !canEdit || saving) {
                            manual = false
                            basePrice = configurator.view?.calculatorTotal ?? basePrice
                        }
                    }
                    ProductField(label: "Nazwa proponowanego produktu") {
                        TextField("", text: Binding(get: { name }, set: { name = String($0.prefix(160)) })).textFieldStyle(.roundedBorder)
                    }
                    ProductField(label: "Opis proponowanego produktu") {
                        ProductTextArea(text: Binding(get: { description }, set: { description = String($0.prefix(5000)) }),
                                        prompt: "Dlaczego warto wybrać ten produkt?", lines: item.layout == "full_page" ? 6...12 : 2...6)
                    }
                    HStack(alignment: .top, spacing: 12) {
                        ProductField(label: "Liczba dni") { ProductNumberField(value: $days, nullable: true).frame(width: 90) }
                        ProductField(label: "Ilość (\(item.unit))") { ProductNumberField(value: $quantity, nullable: true).frame(width: 100) }
                        if item.modular {
                            ProductField(label: "Cena bazowa netto") { ProductNumberField(value: modularPrice, nullable: true, suffix: "zł").frame(width: 150) }
                            ProductField(label: "Rabat (%)") { ProductNumberField(value: $discount, nullable: true, suffix: "%").frame(width: 100) }
                        } else {
                            ProductField(label: item.configured ? "Cena bazowa netto" : "Cena jednostkowa netto") {
                                ProductNumberField(value: $basePrice, nullable: true, suffix: "zł").frame(width: 150)
                            }
                            if item.configured {
                                ProductField(label: "Rabat (%)") { ProductNumberField(value: $discount, nullable: true, suffix: "%").frame(width: 100) }
                            }
                        }
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(OfferText.money(shown.net)) netto").font(.callout.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
                            Text("\(OfferText.money(shown.net * (1 + vatRate / 100))) brutto").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.top, 16)
                    }
                    if item.configured && !item.modular {
                        DisclosureGroup("Zakres i dodatki (\(addons.count))") {
                            VStack(alignment: .leading, spacing: 10) {
                                OfferAddonRows(addons: $addons)
                                Button { addons.append(ProductAddonItem.blank()) } label: { Label("Dodaj indywidualny dodatek", systemImage: "plus") }
                                    .controlSize(.small)
                                    .disabled(addons.count >= 40)
                            }
                            .padding(.top, 6)
                        }
                    }
                    if let error = preview?.error { Text(error).font(.callout).foregroundStyle(.red) }
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
                .disabled(!canEdit || saving)
            }
            .frame(height: 520)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(saving || !canEdit)
            }
            .padding(18)
        }
        .frame(width: item.modular ? 900 : 760)
        .background(theme.page)
        .onAppear {
            guard item.modular, configurator == nil, let snapshot = item.modularSnapshot else { return }
            let next = ModularConfiguratorModel(store: store, snapshot: snapshot)
            next.quantity = item.quantity
            next.onChange = { snapshot, view in applyConfiguration(snapshot, view) }
            configurator = next
        }
        .task(id: previewKey) {
            if patch.isEmpty {
                preview = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(300))
            if Task.isCancelled { return }
            preview = try? await store.previewRecommendation(offerID, item: item, patch: patch)
        }
    }

    private func save() async {
        problem = nil
        saving = true
        await configurator?.settle()
        let failure = await onSave(patch)
        saving = false
        if let failure { problem = failure } else { dismiss() }
    }
}
