import SwiftUI

// MARK: „Pakiety oferty” i „Logistyka oferty” (`OfferPackagesEditor`) — do trzech alternatyw z pozycji oferty (nazwa, opis,
// rekomendacja, pozycje, rabat), kolejność, widoczność pakietów w ofercie i wspólny koszt logistyki z opcjonalną dopłatą klienta.
// Każda zmiana to jeden zapis `save_offer_packages_and_logistics` z kontrolą wersji treści oferty.

/// Okno pakietu: podgląd, edycja albo nowy pakiet.
struct OfferPackageRoute: Identifiable {
    let package: OfferPackage
    let editing: Bool
    let creating: Bool
    var id: String { package.id + (editing ? ":edit" : ":view") }
}

@MainActor struct OfferPackagesCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferPackagesData?
    @State private var loadError: String?
    @State private var saving = false
    @State private var route: OfferPackageRoute?
    @State private var logisticsOpen = false
    @State private var deleting: OfferPackage?

    private var reloadKey: String { "\(detail.offer.updatedAt ?? "")|\(detail.offer.contentRevision ?? 0)|\(detail.items.map(\.id).joined(separator: ","))" }
    private var canEdit: Bool { detail.canEdit && data?.canEdit == true && state.canWrite }
    private var packages: [OfferPackage] { data?.packages ?? [] }

    var body: some View {
        let addButton: AnyView? = detail.canEdit && data?.canEdit == true
            ? AnyView(Button { route = OfferPackageRoute(package: .blank(), editing: true, creating: true) } label: { Label("Dodaj pakiet", systemImage: "plus") }
                .disabled(saving || data == nil || packages.count >= 3 || !state.canWrite))
            : nil
        OfferCard(title: "Pakiety oferty", subtitle: "Do trzech alternatyw z pozycji tej oferty. Każdy pakiet edytujesz oddzielnie.",
                  symbol: "square.stack.3d.up", trailing: addButton) {
            if let data {
                content(data)
            } else if let loadError {
                HStack {
                    Text(loadError).font(.callout).foregroundStyle(.red)
                    Spacer()
                    Button("Spróbuj ponownie") { Task { await load() } }.controlSize(.small)
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Wczytywanie…").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
        .task(id: reloadKey) { if route == nil && !logisticsOpen && !saving { await load() } }
        .sheet(item: $route) { route in
            OfferPackageSheet(package: route.package, positions: data?.positions ?? [], logistics: data?.logistics,
                              editing: route.editing, creating: route.creating, canEdit: canEdit) { draft in
                await commit(draft, creating: route.creating)
            }
        }
        .sheet(isPresented: $logisticsOpen) {
            if let data {
                OfferLogisticsSheet(logistics: data.logistics, editing: canEdit,
                                    travel: store.api.map { OfferTravelService(offerID: detail.offer.id, api: $0) }) { next in await save(nil, logistics: next) }
            }
        }
        .confirmationDialog("Usuń pakiet", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń pakiet", role: .destructive) {
                if let removed = deleting {
                    let enabled = packages.count > 1 && (data?.enabled ?? false)
                    Task { await report(save(packages.filter { $0.id != removed.id }, enabled: enabled)) }
                }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("Usunąć pakiet „\(deleting?.name ?? "")”? Pozycje oferty pozostaną dostępne.")
        }
    }

    @ViewBuilder private func content(_ data: OfferPackagesData) -> some View {
        if !data.packages.isEmpty {
            Toggle("Pokaż pakiety jako alternatywy w ofercie", isOn: Binding(get: { data.enabled }, set: { value in
                Task { await report(save(packages, enabled: value)) }
            }))
            .toggleStyle(.checkbox)
            .disabled(!canEdit || saving)
        }
        if data.packages.isEmpty {
            Text("Dodaj pierwszy pakiet, aby przygotować alternatywny zakres oferty.").font(.callout).foregroundStyle(.secondary)
        } else {
            VStack(spacing: 8) {
                ForEach(data.packages) { package in
                    let index = data.packages.firstIndex { $0.id == package.id } ?? 0
                    packageRow(package, index: index, count: data.packages.count)
                }
            }
        }
        logisticsRow(data.logistics)
    }

    private func packageRow(_ package: OfferPackage, index: Int, count: Int) -> some View {
        HStack(spacing: 10) {
            Text(String(format: "%02d", index + 1)).font(.callout.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(package.name.uppercased(with: Locale(identifier: "pl_PL"))).font(.callout.weight(.medium)).lineLimit(1)
                    if package.is_recommended {
                        Image(systemName: "star.fill").font(.caption).foregroundStyle(theme.accent).help("Rekomendowany")
                    }
                }
                Text("\(package.items.count) pozycji · \(package.description)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(OfferText.money(package.price_net)).font(.callout.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
                Text("netto / pakiet").font(.caption2).foregroundStyle(.secondary)
            }
            Menu {
                Button { route = OfferPackageRoute(package: package, editing: false, creating: false) } label: { Label("Podgląd", systemImage: "eye") }
                if canEdit {
                    Button { route = OfferPackageRoute(package: package.calculated(data?.positions ?? []), editing: true, creating: false) } label: {
                        Label("Edytuj", systemImage: "pencil")
                    }
                    Button { move(index, index - 1) } label: { Label("Przenieś wyżej", systemImage: "arrow.up") }.disabled(index == 0)
                    Button { move(index, index + 1) } label: { Label("Przenieś niżej", systemImage: "arrow.down") }.disabled(index == count - 1)
                    Divider()
                    Button(role: .destructive) { deleting = package } label: { Label("Usuń", systemImage: "trash") }
                }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .disabled(saving)
                .help("Czynności pakietu")
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func logisticsRow(_ logistics: OfferLogistics) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "truck.box").font(.title3).foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text("LOGISTYKA OFERTY").font(.callout.weight(.medium))
                Text("Koszt dla firmy: \(OfferText.money(logistics.cost ?? 0)) netto").font(.caption).foregroundStyle(.secondary)
                Text(logistics.enabled ? "Doliczana klientowi: \(OfferText.money(logistics.price ?? 0)) netto" : "Logistyka nie jest doliczana do oferty.")
                    .font(.caption).foregroundStyle(theme.accent)
            }
            Spacer()
            Button(canEdit ? "Ustaw logistykę" : "Podgląd") { logisticsOpen = true }
                .controlSize(.small)
                .disabled(saving)
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .padding(.top, 4)
    }

    // MARK: Zapis

    private func load() async {
        do {
            data = try await store.packages(detail.offer.id)
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać pakietów i logistyki.")
        }
    }

    /// Jeden zapis pakietów (`nil` — bez zmian) i logistyki (`nil` — bez zmian); zwraca komunikat błędu albo `nil`.
    private func save(_ next: [OfferPackage]?, enabled: Bool? = nil, logistics: OfferLogistics? = nil) async -> String? {
        guard let data else { return "Odśwież ofertę przed zapisaniem." }
        saving = true
        defer { saving = false }
        do {
            self.data = try await store.savePackages(detail.offer.id, revision: data.revision, packages: next,
                                                     enabled: enabled ?? data.enabled, logistics: logistics)
            return nil
        } catch {
            return store.failureText(error, "Nie udało się zapisać zmian.")
        }
    }

    private func report(_ problem: String?) {
        if let problem { state.error = problem }
    }

    /// „Zapisz pakiet” (`commitPackage`): przeliczona cena, jeden pakiet rekomendowany, pierwszy pakiet włącza pakiety w ofercie.
    private func commit(_ draft: OfferPackage, creating: Bool) async -> String? {
        let normalized = draft.calculated(data?.positions ?? [])
        var next = creating ? packages + [normalized] : packages.map { $0.id == normalized.id ? normalized : $0 }
        if normalized.is_recommended {
            next = next.map { item in
                var copy = item
                if copy.id != normalized.id { copy.is_recommended = false }
                return copy
            }
        }
        let enabled = creating && packages.isEmpty ? true : (data?.enabled ?? false)
        return await save(next, enabled: enabled)
    }

    private func move(_ from: Int, _ to: Int) {
        guard !saving, packages.indices.contains(from), packages.indices.contains(to) else { return }
        var next = packages
        next.swapAt(from, to)
        Task { await report(save(next)) }
    }
}

// MARK: Okno pakietu

@MainActor struct OfferPackageSheet: View {
    let positions: [OfferPackagePosition]
    let logistics: OfferLogistics?
    let creating: Bool
    let canEdit: Bool
    let onSave: (OfferPackage) async -> String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: OfferPackage
    @State private var editing: Bool
    @State private var query = ""
    @State private var catalog = false
    @State private var saving = false
    @State private var problem: String?

    init(package: OfferPackage, positions: [OfferPackagePosition], logistics: OfferLogistics?, editing: Bool, creating: Bool, canEdit: Bool,
         onSave: @escaping (OfferPackage) async -> String?) {
        self.positions = positions
        self.logistics = logistics
        self.creating = creating
        self.canEdit = canEdit
        self.onSave = onSave
        _draft = State(initialValue: package)
        _editing = State(initialValue: editing)
    }

    private var title: String { editing ? (creating ? "Dodaj pakiet oferty" : "Edytuj pakiet oferty") : "Podgląd pakietu" }

    private var available: [OfferPackagePosition] {
        let folded = query.lowercased(with: Locale(identifier: "pl_PL"))
        return positions.filter { position in
            !draft.items.contains { $0.offer_item_id == position.id }
                && (folded.isEmpty || position.name.lowercased(with: Locale(identifier: "pl_PL")).contains(folded))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.title3.weight(.semibold)).padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if editing {
                        ProductField(label: "Nazwa pakietu") {
                            TextField("", text: Binding(get: { draft.name }, set: { draft.name = String($0.prefix(120)) })).textFieldStyle(.roundedBorder)
                        }
                        ProductField(label: "Krótki opis") {
                            ProductTextArea(text: Binding(get: { draft.description }, set: { draft.description = String($0.prefix(1000)) }), lines: 3...6)
                        }
                        Button { draft.is_recommended.toggle() } label: {
                            Label("Rekomenduj (opcjonalnie)", systemImage: draft.is_recommended ? "star.fill" : "star")
                        }
                        .tint(draft.is_recommended ? theme.accent : nil)
                    } else {
                        Text(draft.name.uppercased(with: Locale(identifier: "pl_PL"))).font(.headline).foregroundStyle(theme.accent)
                        if !draft.description.isEmpty { Text(draft.description).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                    itemsSection
                    if editing { catalogSection }
                    priceBox
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
            }
            .frame(height: 520)
            .disabled(saving)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if editing {
                    Button(saving ? "Zapisywanie…" : "Zapisz pakiet") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
                } else if canEdit {
                    Button("Edytuj") {
                        draft = draft.calculated(positions)
                        editing = true
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(18)
        }
        .frame(width: 680)
        .background(theme.page)
    }

    private var itemsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("POZYCJE PAKIETU (\(draft.items.count))").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(Array(draft.items.enumerated()), id: \.offset) { pair in
                let item = pair.element
                let position = positions.first { $0.id == item.offer_item_id }
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(position?.name ?? "Pozycja usunięta z oferty").font(.callout)
                        Text("\(OfferText.number(item.quantity)) \(position?.unit ?? "") × \(OfferText.number(position?.days ?? 1)) dni · \(OfferText.money((position?.unit_price ?? 0) * (position?.days ?? 1) * item.quantity)) netto")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    Spacer()
                    if editing {
                        Button {
                            var next = draft
                            next.items.remove(at: pair.offset)
                            draft = next.calculated(positions)
                        } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless).foregroundStyle(.red)
                            .help("Usuń \(position?.name ?? "pozycję") z pakietu")
                    }
                }
                .padding(8)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var catalogSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { catalog.toggle() } label: { Label(catalog ? "Zamknij listę pozycji" : "Dodaj pozycje oferty", systemImage: catalog ? "xmark" : "plus") }
            if catalog {
                TextField("", text: $query, prompt: Text("Szukaj pozycji…")).textFieldStyle(.roundedBorder)
                VStack(spacing: 4) {
                    ForEach(available) { position in
                        Button {
                            var next = draft
                            next.items.append(OfferPackageItem(offer_item_id: position.id, product_id: position.product_id,
                                                               product_variant_id: position.product_variant_id, quantity: position.quantity))
                            draft = next.calculated(positions)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(position.name).font(.callout)
                                    Text("\(OfferText.number(position.quantity)) \(position.unit) × \(OfferText.number(position.days)) dni · \(OfferText.money(position.unit_price * position.quantity * position.days)) netto")
                                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                                }
                                Spacer()
                                Text("Dodaj").font(.caption).foregroundStyle(theme.accent)
                            }
                            .contentShape(Rectangle())
                            .padding(8)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                    if available.isEmpty {
                        Text("Brak dostępnych pozycji. Już dodane są ukryte.").font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
                    }
                }
                Text("Zakres, ilość i wariant pochodzą z pozycji oferty. Zmienisz je w jej edytorze.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var priceBox: some View {
        let logisticsPrice = logistics?.enabled == true ? (logistics?.price ?? 0) : 0
        return VStack(alignment: .leading, spacing: 8) {
            Text("Suma pozycji: \(OfferText.money(draft.list_price_net)) netto").font(.callout).foregroundStyle(.secondary).monospacedDigit()
            if editing {
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Rabat (%)") {
                        ProductNumberField(value: Binding(get: { Optional(draft.discount_percent) }, set: { value in
                            let percent = min(100, max(0, value ?? 0))
                            draft = draft.calculated(positions, discount: draft.list_price_net * percent / 100)
                        }), suffix: "%")
                    }
                    ProductField(label: "Rabat netto (zł)") {
                        ProductNumberField(value: Binding(get: { Optional(draft.discount_amount) }, set: { value in
                            draft = draft.calculated(positions, discount: value ?? 0)
                        }), suffix: "zł")
                    }
                }
            }
            Text("Cena pakietu: \(OfferText.money(draft.price_net)) netto").font(.title3.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
            Text("Dla klienta z logistyką: \(OfferText.money(draft.price_net + logisticsPrice)) netto").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            Text("Wewnętrzny koszt wspólnej logistyki: \(OfferText.money(logistics?.cost ?? 0)) netto — uwzględniany raz dla wybranego pakietu.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    private func save() async {
        problem = nil
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || draft.items.isEmpty || draft.items.contains(where: { item in !positions.contains { $0.id == item.offer_item_id } }) {
            problem = "Każdy pakiet musi mieć nazwę i co najmniej jedną dostępną pozycję tej oferty."
            return
        }
        saving = true
        let failure = await onSave(draft)
        saving = false
        if let failure { problem = failure } else { dismiss() }
    }
}
