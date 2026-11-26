import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Okna karty wypożyczenia — 1:1 z CRM (`src/components/crm/rental/*`): dane wypożyczenia, pozycje z katalogiem magazynu,
// protokół wydania / odbioru (ze zdjęciami), rozbieżność po zwrocie (egzemplarze), dostawa i odbiór (pojazd, kierowca, konflikty),
// powód anulowania. Zapisy — `ClientRentalsStore.run` (`/bridge/native/v1/rental`).

private func clientRentalError(_ text: String?) -> some View {
    Group {
        if let text { Label(text, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
    }
}

/// Tekst bez białych znaków na brzegach albo `null`, gdy pusty.
private func clientRentalOptional(_ value: String) -> JSONValue {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? .null : .string(text)
}

/// Konflikt terminu (sprzętu albo pojazdu): „Event: nazwa · od – do · N szt.”.
private func clientRentalConflictText(_ conflict: ClientRentalConflict, openEnd: String, quantity: Bool) -> String {
    var text = conflict.type == "event" ? "Event: " : "Wypożyczenie: "
    text += conflict.name + " · " + ClientRentalFormat.dateTime(conflict.startsAt)
    if let end = conflict.endsAt { text += " – " + ClientRentalFormat.dateTime(end) } else { text += openEnd }
    if quantity, let qty = conflict.qty { text += " · \(qty) szt." }
    return text
}

// MARK: Dane wypożyczenia

@MainActor struct ClientRentalFormSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail?
    let saved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var client: ClientRentalClientHit?
    @State private var clientName = ""
    @State private var query = ""
    @State private var hits: [ClientRentalClientHit] = []
    @State private var title = ""
    @State private var startsAt = Date()
    @State private var endsAt = Date()
    @State private var recipientName = ""
    @State private var recipientPhone = ""
    @State private var delivery = false
    @State private var address = ""
    @State private var sellerID = ""
    @State private var companyID = ""
    @State private var deposit = "0"
    @State private var discount = "0"
    @State private var vat = "23"
    @State private var salesNote = ""
    @State private var warehouseNote = ""
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false

    private var issued: Bool { rental.map { [.issued, .returned].contains($0.status) } ?? false }
    private var returned: Bool { rental?.status == .returned }
    private var saveTitle: String { saving ? "Zapisywanie…" : rental == nil ? "Utwórz wypożyczenie" : "Zapisz" }
    private var canSeller: Bool { store.access.admin || store.access.salesAll || (rental?.access.admin ?? false) || (rental?.access.salesAll ?? false) }

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text(rental == nil ? "Nowe wypożyczenie" : "Dane wypożyczenia").font(.title2.bold()); Spacer() }
                .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section("Klient") {
                    if let client {
                        HStack {
                            Image(systemName: client.kind == "organization" ? "building.2" : "person")
                            Text(client.name)
                            Spacer()
                            Button("Zmień") { self.client = nil }
                        }
                    } else {
                        TextField("Szukaj w bazie", text: $query, prompt: Text("Organizacja lub osoba (min. 2 znaki)"))
                        ForEach(hits) { hit in
                            Button { client = hit; query = ""; hits = [] } label: {
                                Label(hit.name, systemImage: hit.kind == "organization" ? "building.2" : "person")
                            }
                            .buttonStyle(.link)
                        }
                        TextField("Klient spoza bazy", text: $clientName, prompt: Text("Nazwa klienta"))
                    }
                    TextField("Nazwa wypożyczenia", text: $title, prompt: Text("Np. Dekoracje — wesele 12.12"))
                }
                Section("Termin") {
                    DatePicker("Wydanie", selection: $startsAt).disabled(issued)
                    DatePicker("Planowany zwrot", selection: $endsAt).disabled(returned)
                }
                .environment(\.timeZone, ClientRentalFormat.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                Section("Odbierający i przekazanie") {
                    TextField("Odbierający", text: $recipientName, prompt: Text("Imię i nazwisko"))
                    TextField("Telefon", text: $recipientPhone)
                    Picker("Przekazanie", selection: $delivery) {
                        Text("Odbiór własny").tag(false)
                        Text("Dostawa").tag(true)
                    }
                    .pickerStyle(.segmented).disabled(issued)
                    if delivery { TextField("Adres dostawy", text: $address, axis: .vertical).lineLimit(1...3) }
                }
                Section("Sprzedaż") {
                    if let options = store.options, options.companies.count > 1 {
                        Picker("Firma", selection: $companyID) {
                            Text("Domyślna").tag("")
                            ForEach(options.companies) { Text($0.name).tag($0.id) }
                        }
                    }
                    if canSeller, let options = store.options, !options.employees.isEmpty {
                        Picker("Opiekun", selection: $sellerID) {
                            Text("Nie wybrano").tag("")
                            ForEach(options.employees) { Text($0.name).tag($0.id) }
                        }
                    }
                    TextField("Kaucja (zł)", text: $deposit)
                    TextField("Rabat na całość (%)", text: $discount)
                    TextField("VAT (%)", text: $vat)
                    TextField("Uwagi sprzedaży (widzi tylko sprzedaż)", text: $salesNote, axis: .vertical).lineLimit(1...4)
                    TextField("Uwagi dla magazynu", text: $warehouseNote, axis: .vertical).lineLimit(1...4)
                }
                if let problem { Section { clientRentalError(problem) } }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saveTitle) { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
            .padding(16)
        }
        .frame(width: 560, height: 680)
        .task {
            guard !prepared else { return }
            prepared = true
            await store.loadOptions()
            prepare()
        }
        .task(id: query) {
            let text = query.trimmingCharacters(in: .whitespaces)
            guard text.count >= 2 else { hits = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            struct Reply: Decodable { var clients: [ClientRentalClientHit] }
            hits = (try? await store.query(["op": "clients", "q": text], as: Reply.self).clients) ?? []
        }
    }

    private func prepare() {
        if let rental {
            if let id = rental.organizationId { client = ClientRentalClientHit(kind: "organization", id: id, name: rental.organizationName ?? rental.clientName) }
            else if let id = rental.contactId { client = ClientRentalClientHit(kind: "contact", id: id, name: rental.contactName ?? rental.clientName) }
            else { clientName = rental.clientName }
            title = rental.title
            startsAt = ClientRentalFormat.date(rental.startsAt) ?? Date()
            endsAt = ClientRentalFormat.date(rental.endsAt) ?? Date()
            recipientName = rental.recipientName ?? ""
            recipientPhone = rental.recipientPhone ?? ""
            delivery = rental.handover == "delivery"
            address = rental.deliveryAddress ?? ""
            sellerID = rental.sellerId ?? ""
            companyID = rental.myCompanyId ?? ""
            if let sales = rental.sales {
                deposit = ClientRentalFormat.plain(sales.depositAmount)
                discount = ClientRentalFormat.plain(sales.discountPercent)
                vat = ClientRentalFormat.plain(sales.vatRate)
                salesNote = sales.salesNote ?? ""
            }
            warehouseNote = rental.warehouseNote ?? ""
        } else {
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = ClientRentalFormat.zone
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date())) ?? Date()
            startsAt = calendar.date(bySettingHour: 10, minute: 0, second: 0, of: tomorrow) ?? tomorrow
            endsAt = calendar.date(byAdding: .day, value: 2, to: calendar.date(bySettingHour: 12, minute: 0, second: 0, of: tomorrow) ?? tomorrow) ?? tomorrow
            sellerID = store.access.employeeId ?? ""
        }
    }

    private func save() async {
        problem = nil
        let name = clientName.trimmingCharacters(in: .whitespaces)
        guard client != nil || !name.isEmpty else { problem = "Wskaż klienta z bazy albo wpisz nazwę klienta."; return }
        guard endsAt > startsAt else { problem = "Zwrot musi być po wydaniu."; return }
        if delivery && address.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Podaj adres dostawy."; return }
        var data: [String: JSONValue] = [:]
        data["title"] = .string(title.trimmingCharacters(in: .whitespaces))
        data["organization_id"] = client?.kind == "organization" ? clientRentalOptional(client?.id ?? "") : .null
        data["contact_id"] = client?.kind == "contact" ? clientRentalOptional(client?.id ?? "") : .null
        data["client_name"] = .string(client?.name ?? name)
        data["recipient_name"] = clientRentalOptional(recipientName)
        data["recipient_phone"] = clientRentalOptional(recipientPhone)
        data["sales_note"] = clientRentalOptional(salesNote)
        data["warehouse_note"] = clientRentalOptional(warehouseNote)
        data["deposit_amount"] = .number(ClientRentalFormat.number(deposit) ?? 0)
        data["discount_percent"] = .number(ClientRentalFormat.number(discount) ?? 0)
        data["vat_rate"] = .number(ClientRentalFormat.number(vat) ?? 23)
        data["delivery_address"] = delivery ? clientRentalOptional(address) : .null
        if !issued {
            data["starts_at"] = .string(ClientRentalFormat.string(startsAt))
            data["handover"] = .string(delivery ? "delivery" : "pickup")
        }
        if !returned { data["ends_at"] = .string(ClientRentalFormat.string(endsAt)) }
        if !companyID.isEmpty { data["my_company_id"] = .string(companyID) }
        if canSeller && !sellerID.isEmpty { data["seller_id"] = .string(sellerID) }
        saving = true
        defer { saving = false }
        var body: [String: JSONValue] = ["op": .string("save"), "data": .object(data)]
        if let rental { body["id"] = .string(rental.id) }
        guard let reply = await store.run(body, success: rental == nil ? "Utworzono wypożyczenie" : "Zapisano zmiany wypożyczenia") else { return }
        let id = reply["id"]?.text ?? rental?.id ?? ""
        dismiss()
        if !id.isEmpty { saved(id) }
    }
}

// MARK: Pozycje — katalog magazynu i wybrane pozycje (jak `RentalItemsModal` w CRM)

@MainActor struct ClientRentalItemsSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail
    /// Otwórz na katalogu (zaraz po utworzeniu wypożyczenia).
    var startInCatalog = false
    @Environment(\.dismiss) private var dismiss

    enum Tab: Hashable { case catalog, lines }

    struct Line: Identifiable, Equatable {
        var id = UUID().uuidString
        var itemID: String?
        var kind = "equipment"
        var equipmentID: String?
        var kitID: String?
        var kitName: String?
        var name = ""
        var quantity = "1"
        var priceMode = "per_day"
        var price = ""
        var days = ""
        var discount = "0"
        var replacement = ""
        var note = ""
        var issued = 0
        var settled = 0
    }

    private struct ItemGroup: Identifiable {
        var path: String
        var items: [ClientRentalCatalogItem]
        var id: String { path }
    }

    @State private var lines: [Line] = []
    @State private var tab: Tab = .lines
    @State private var catalog: ClientRentalCatalog?
    @State private var catalogLoading = false
    @State private var catalogProblem: String?
    @State private var search = ""
    @State private var categoryID = ""
    @State private var hideBusy = false
    /// Odświeża pola ilości w katalogu po zmianie (wartość przycięta do wolnych sztuk).
    @State private var stepperRefresh = 0
    @State private var availability: [String: ClientRentalAvailability] = [:]
    @State private var checking = false
    @State private var saving = false
    @State private var problem: String?
    @State private var prepared = false

    private func count(_ text: String) -> Int { max(0, Int(ClientRentalFormat.number(text) ?? 0)) }
    private var kits: [ClientRentalCatalogKit] { catalog?.kits ?? [] }
    private var itemsByID: [String: ClientRentalCatalogItem] {
        Dictionary((catalog?.items ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
    private func isDirect(_ line: Line, _ id: String) -> Bool { line.kind == "equipment" && line.equipmentID == id && line.kitID == nil }
    private func isNewKit(_ line: Line, _ id: String) -> Bool { line.kind == "equipment" && line.kitID == id && line.equipmentID == nil }
    /// Sztuki sprzętu zajęte przez pozycje (zestawy jeszcze nierozpisane — wg składu z katalogu); `skip` pomija pozycje.
    private func demand(_ source: [Line], skip: ((Line) -> Bool)? = nil) -> [String: Int] {
        let rows = source.filter { !(skip?($0) ?? false) }.map {
            ClientRentalDemandLine(kind: $0.kind, equipmentID: $0.equipmentID, kitID: $0.kitID, quantity: count($0.quantity), settled: $0.settled)
        }
        return ClientRentalCatalogLogic.demand(rows, kits: kits)
    }
    private var demandKey: String { demand(lines).sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: ",") }
    private var shortage: Bool { availability.values.contains { $0.shortage > 0 } }
    private var blocking: Bool { rental.status != .draft && shortage }
    private var total: Double {
        lines.reduce(0) { sum, line in
            sum + ClientRentalFormat.lineNet(price: ClientRentalFormat.number(line.price), quantity: count(line.quantity), mode: line.priceMode,
                                             days: ClientRentalFormat.number(line.days), defaultDays: rental.defaultDays, discount: ClientRentalFormat.number(line.discount))
        }
    }
    private var equipmentPieces: Int { lines.filter { $0.kind == "equipment" }.reduce(0) { $0 + count($1.quantity) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pozycje wypożyczenia").font(.title2.weight(.light)).textCase(.uppercase)
                    Text("\(rental.number) · \(ClientRentalFormat.dateTime(rental.startsAt)) – \(ClientRentalFormat.dateTime(rental.endsAt)) · \(ClientRentalFormat.plain(rental.defaultDays)) dób")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Picker("Widok", selection: $tab) {
                Text("Katalog magazynu").tag(Tab.catalog)
                Text("Wybrane pozycje (\(lines.count))").tag(Tab.lines)
            }
            .pickerStyle(.segmented).labelsHidden()
            if blocking {
                Label("Wypożyczenie jest zarezerwowane — zmniejsz ilości brakującego sprzętu albo zmień termin, aby zapisać.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            if tab == .catalog { catalogView } else { linesView }
            clientRentalError(problem)
            HStack {
                Text("Razem netto (przed rabatem na całość): \(ClientRentalFormat.money(total))").foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie…" : "Zapisz pozycje") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || blocking)
            }
        }
        .padding(20)
        .frame(width: 1040, height: 700)
        .task {
            guard !prepared else { return }
            prepared = true
            lines = rental.items.map { item in
                Line(itemID: item.id, kind: item.kind, equipmentID: item.equipmentId, kitID: item.kitId, kitName: item.kitName, name: item.name,
                     quantity: String(item.quantity), priceMode: item.priceMode ?? "per_day", price: ClientRentalFormat.plain(item.unitPrice),
                     days: ClientRentalFormat.plain(item.days), discount: ClientRentalFormat.plain(item.discountPercent ?? 0),
                     replacement: ClientRentalFormat.plain(item.replacementValue), note: item.note ?? "", issued: item.issuedQty, settled: item.settled)
            }
            tab = startInCatalog || rental.items.isEmpty ? .catalog : .lines
            await loadCatalog()
        }
        .task(id: demandKey) {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await check()
        }
    }

    // MARK: Katalog

    private var catalogView: some View {
        let paths = ClientRentalCatalogLogic.paths(catalog?.categories ?? [])
        let scope = categoryID.isEmpty ? nil : ClientRentalCatalogLogic.scope(catalog?.categories ?? [], categoryID)
        let byID = itemsByID
        let used = demand(lines)
        let groups = itemGroups(paths: paths, scope: scope)
        let shownKits = visibleKits(scope: scope)
        return VStack(alignment: .leading, spacing: 8) {
            if let catalog {
                Text("Wolne sztuki liczone dla czasu, w którym sprzęt jest poza magazynem: \(ClientRentalFormat.dateTime(catalog.window.startsAt)) – \(ClientRentalFormat.dateTime(catalog.window.endsAt))\(windowWider(catalog) ? " (z dostawą, odbiorem albo wcześniejszym wydaniem)" : ""). Uwzględnia eventy i inne wypożyczenia — bez pozycji tego wypożyczenia.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                TextField("Szukaj sprzętu, dekoracji, zestawu, marki…", text: $search).textFieldStyle(.roundedBorder)
                Picker("Kategoria", selection: $categoryID) {
                    Text("Wszystkie kategorie").tag("")
                    ForEach(ClientRentalCatalogLogic.tree(catalog?.categories ?? [])) { node in
                        Text(String(repeating: "   ", count: node.depth) + (node.depth > 0 ? "› " : "") + node.category.name).tag(node.id)
                    }
                }
                .frame(width: 260)
                Toggle("Ukryj zajęte", isOn: $hideBusy).toggleStyle(.checkbox)
                Button { Task { await loadCatalog() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                    .disabled(catalogLoading).help("Odśwież dostępność")
            }
            if equipmentPieces > 0 {
                Text("Wybrano \(lines.filter { $0.kind == "equipment" }.count) pozycji sprzętu (\(equipmentPieces) szt.) — ceny, doby i rabaty ustawisz w „Wybrane pozycje”.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            clientRentalError(catalogProblem)
            if catalog == nil {
                if catalogLoading { ProgressView("Wczytywanie katalogu magazynu…").frame(maxWidth: .infinity, maxHeight: .infinity) } else { Spacer() }
            } else if groups.isEmpty && shownKits.isEmpty {
                Text("Brak sprzętu dla wybranych filtrów.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    if !shownKits.isEmpty {
                        Section("Zestawy") {
                            ForEach(shownKits) { kit in kitRow(kit, byID: byID) }
                        }
                    }
                    ForEach(groups) { group in
                        Section(group.path) {
                            ForEach(group.items) { item in itemRow(item, used: used) }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func itemGroups(paths: [String: String], scope: Set<String>?) -> [ItemGroup] {
        guard let catalog else { return [] }
        let filtered = catalog.items.filter { item in
            let inScope = scope.map { set in item.categoryId.map { set.contains($0) } ?? false } ?? true
            return inScope
                && ClientRentalCatalogLogic.matches(search, [item.name, item.brand, item.model, item.categoryId.flatMap { paths[$0] }])
                && (!hideBusy || item.available > 0 || lines.contains { isDirect($0, item.id) })
        }
        let grouped = Dictionary(grouping: filtered) { item in item.categoryId.flatMap { paths[$0] } ?? "Bez kategorii" }
        return grouped.keys.sorted { $0.localizedStandardCompare($1) == .orderedAscending }.map { key in
            ItemGroup(path: key, items: (grouped[key] ?? []).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending })
        }
    }

    private func visibleKits(scope: Set<String>?) -> [ClientRentalCatalogKit] {
        kits.filter { kit in
            let inScope = scope.map { set in kit.categoryId.map { set.contains($0) } ?? false } ?? true
            var fields: [String?] = [kit.name]
            fields += kit.components.map { part -> String? in part.name }
            return inScope
                && ClientRentalCatalogLogic.matches(search, fields)
                && (!hideBusy || kit.available > 0 || lines.contains { isNewKit($0, kit.id) })
        }
    }

    private func windowWider(_ catalog: ClientRentalCatalog) -> Bool {
        guard let start = ClientRentalFormat.date(catalog.window.startsAt), let end = ClientRentalFormat.date(catalog.window.endsAt),
              let rentalStart = ClientRentalFormat.date(rental.startsAt), let rentalEnd = ClientRentalFormat.date(rental.endsAt) else { return false }
        return start < rentalStart || end > rentalEnd
    }

    private func thumbnail(_ url: String?, symbol: String) -> some View {
        AsyncImage(url: url.flatMap { URL(string: $0) }) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Image(systemName: symbol).foregroundStyle(.secondary)
            }
        }
        .frame(width: 36, height: 36)
        .background(Color.primary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func itemRow(_ item: ClientRentalCatalogItem, used: [String: Int]) -> some View {
        let selected = lines.filter { isDirect($0, item.id) }.reduce(0) { $0 + count($1.quantity) }
        let directUse = lines.filter { isDirect($0, item.id) }.reduce(0) { $0 + max(0, count($1.quantity) - $1.settled) }
        let total = used[item.id] ?? 0
        let inKits = max(0, total - directUse)
        let over = total - item.available
        let price = item.price.map { "\(ClientRentalFormat.money($0))/doba" } ?? ""
        let detail = [item.detail, price].filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(spacing: 10) {
            thumbnail(item.thumbnailUrl, symbol: "shippingbox")
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name).lineLimit(1)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(item.available > 0 ? "Dostępne \(item.available) z \(item.stock)" : "Zajęte w terminie (stan \(item.stock))")
                    .font(.caption).foregroundStyle(item.available > 0 ? Color.green : Color.orange)
                if inKits > 0 { Text("w zestawach: \(inKits)").font(.caption2).foregroundStyle(.secondary) }
                if over > 0 { Text("Brakuje \(over)").font(.caption2).foregroundStyle(.orange) }
            }
            stepper(selected, canAdd: item.available - total > 0, label: item.name) { setEquipment(item, $0) }
        }
        .padding(.vertical, 2)
        .opacity(item.available == 0 && selected == 0 ? 0.6 : 1)
    }

    private func kitRow(_ kit: ClientRentalCatalogKit, byID: [String: ClientRentalCatalogItem]) -> some View {
        let selected = lines.filter { isNewKit($0, kit.id) }.reduce(0) { $0 + count($1.quantity) }
        let free = ClientRentalCatalogLogic.kitFree(kit, items: byID, demand: demand(lines, skip: { isNewKit($0, kit.id) }))
        return HStack(spacing: 10) {
            thumbnail(kit.thumbnailUrl, symbol: "square.stack.3d.up")
            VStack(alignment: .leading, spacing: 1) {
                Text(kit.name).lineLimit(1)
                Text(kit.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(kit.available > 0 ? "Kompletów: \(kit.available)" : "Zajęte w terminie")
                .font(.caption).foregroundStyle(kit.available > 0 ? Color.green : Color.orange)
            stepper(selected, canAdd: selected < free, label: kit.name) { setKit(kit, $0) }
        }
        .padding(.vertical, 2)
        .opacity(kit.available == 0 && selected == 0 ? 0.6 : 1)
    }

    private func stepper(_ value: Int, canAdd: Bool, label: String, change: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 4) {
            Button { change(value - 1) } label: { Image(systemName: "minus") }.disabled(value <= 0).help("Mniej")
            TextField("0", value: Binding(get: { value }, set: { change($0) }), format: .number)
                .textFieldStyle(.roundedBorder).multilineTextAlignment(.center).frame(width: 46)
                .id("\(label)-\(value)-\(stepperRefresh)")
            Button { change(value + 1) } label: { Image(systemName: "plus") }.disabled(!canAdd).help("Więcej")
        }
        .controlSize(.small)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Ilość: \(label)")
    }

    /// Ilość sprzętu w pozycjach bez zestawu: najwyżej wolne w oknie (minus inne pozycje), najmniej tyle, ile wydano.
    private func setEquipment(_ item: ClientRentalCatalogItem, _ wanted: Int) {
        defer { stepperRefresh += 1 }
        let direct = lines.filter { isDirect($0, item.id) }
        let selected = direct.reduce(0) { $0 + count($1.quantity) }
        let minimum = direct.reduce(0) { $0 + $1.issued }
        let others = demand(lines, skip: { isDirect($0, item.id) })[item.id] ?? 0
        let settled = direct.reduce(0) { $0 + $1.settled }
        let maximum = item.available - others + settled
        var target = max(0, wanted)
        if target > selected { target = max(selected, min(target, maximum)) }
        target = max(target, minimum)
        guard target != selected else { return }
        if target > selected {
            if let index = lines.firstIndex(where: { isDirect($0, item.id) }) {
                lines[index].quantity = String(count(lines[index].quantity) + target - selected)
            } else {
                lines.append(Line(equipmentID: item.id, name: item.name, quantity: String(target), price: item.price.map { ClientRentalFormat.plain($0) } ?? ""))
            }
            return
        }
        var remaining = selected - target
        for index in lines.indices.reversed() where remaining > 0 && isDirect(lines[index], item.id) {
            let take = min(remaining, count(lines[index].quantity) - lines[index].issued)
            guard take > 0 else { continue }
            lines[index].quantity = String(count(lines[index].quantity) - take)
            remaining -= take
        }
        lines.removeAll { isDirect($0, item.id) && count($0.quantity) == 0 && $0.issued == 0 }
    }

    /// Zestawy dodane teraz (rozpiszą się na składniki przy zapisie): najwyżej tyle kompletów, ile pozwalają wolne składniki.
    private func setKit(_ kit: ClientRentalCatalogKit, _ wanted: Int) {
        defer { stepperRefresh += 1 }
        let selected = lines.filter { isNewKit($0, kit.id) }.reduce(0) { $0 + count($1.quantity) }
        let free = ClientRentalCatalogLogic.kitFree(kit, items: itemsByID, demand: demand(lines, skip: { isNewKit($0, kit.id) }))
        var target = max(0, wanted)
        if target > selected { target = max(selected, min(target, free)) }
        guard target != selected else { return }
        if target == 0 {
            lines.removeAll { isNewKit($0, kit.id) }
            return
        }
        if let index = lines.firstIndex(where: { isNewKit($0, kit.id) }) {
            lines[index].quantity = String(target)
            let keep = lines[index].id
            lines.removeAll { isNewKit($0, kit.id) && $0.id != keep }
        } else {
            lines.append(Line(kitID: kit.id, kitName: kit.name, name: "Zestaw: \(kit.name)", quantity: String(target), price: "0"))
        }
    }

    private func loadCatalog() async {
        catalogLoading = true
        catalogProblem = nil
        defer { catalogLoading = false }
        struct Reply: Decodable { var catalog: ClientRentalCatalog }
        do {
            catalog = try await store.query(["op": "stock", "start": rental.startsAt, "end": rental.endsAt, "id": rental.id], as: Reply.self).catalog
        } catch {
            catalogProblem = store.failureText(error, "Nie udało się pobrać katalogu magazynu.")
        }
    }

    // MARK: Wybrane pozycje

    private var linesView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button { tab = .catalog } label: { Label("Dodaj z katalogu", systemImage: "shippingbox") }
                Button { lines.append(Line(kind: "service", priceMode: "flat", price: "0")) } label: { Label("Dodaj usługę", systemImage: "wrench.and.screwdriver") }
                Button(checking ? "Sprawdzanie…" : "Sprawdź dostępność") { Task { await check() } }.disabled(checking || demand(lines).isEmpty)
                Spacer()
            }
            if lines.isEmpty {
                Text("Wybierz sprzęt z katalogu magazynu albo dodaj usługę.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        HStack {
                            Text("Pozycja").frame(maxWidth: .infinity, alignment: .leading)
                            Text("Ilość").frame(width: 60)
                            Text("Cena").frame(width: 80)
                            Text("Za").frame(width: 90)
                            Text("Doby").frame(width: 55)
                            Text("Rabat %").frame(width: 60)
                            Text("Wart. odtw.").frame(width: 80)
                            Text("Netto").frame(width: 90, alignment: .trailing)
                            Spacer().frame(width: 24)
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        ForEach($lines) { $line in row($line) }
                    }
                }
            }
            Text("Dostępność: stan sprawny minus największa liczba sztuk zajętych naraz przez eventy i inne wypożyczenia, od wyjazdu sprzętu (wydanie albo dostawa) do powrotu (zwrot albo odbiór). Pusta cena — cena za dobę z katalogu magazynu.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func row(_ line: Binding<Line>) -> some View {
        let value = line.wrappedValue
        let state = value.equipmentID.flatMap { availability[$0] }
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    if value.kind == "service" {
                        TextField("Nazwa usługi (np. transport)", text: line.name).textFieldStyle(.roundedBorder)
                    } else {
                        Text(value.name).fontWeight(.medium)
                        if let kit = value.kitName { Text(value.equipmentID == nil ? "Zestaw zostanie rozpisany na składniki po zapisie" : "Z zestawu: \(kit)").font(.caption).foregroundStyle(.secondary) }
                        if value.issued > 0 { Text("Wydano \(value.issued)").font(.caption).foregroundStyle(.orange) }
                        if let state {
                            if state.shortage > 0 {
                                Text("Brakuje \(state.shortage) (dostępne \(state.available) z \(state.stock))").font(.caption).foregroundStyle(.orange)
                                ForEach(state.conflicts, id: \.self) { conflict in
                                    Text(clientRentalConflictText(conflict, openEnd: " – do zwrotu", quantity: true))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            } else {
                                Text("Dostępne \(state.available) z \(state.stock)").font(.caption).foregroundStyle(.green)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                TextField("", text: line.quantity).textFieldStyle(.roundedBorder).frame(width: 60)
                TextField("z katalogu", text: line.price).textFieldStyle(.roundedBorder).frame(width: 80)
                Picker("", selection: line.priceMode) { Text("dobę").tag("per_day"); Text("całość").tag("flat") }.labelsHidden().frame(width: 90)
                TextField(ClientRentalFormat.plain(rental.defaultDays), text: line.days).textFieldStyle(.roundedBorder).frame(width: 55).disabled(value.priceMode == "flat")
                TextField("", text: line.discount).textFieldStyle(.roundedBorder).frame(width: 60)
                Group {
                    if value.kind == "equipment" { TextField("z katalogu", text: line.replacement).textFieldStyle(.roundedBorder) } else { Text("—").foregroundStyle(.secondary) }
                }
                .frame(width: 80)
                Text(ClientRentalFormat.money(ClientRentalFormat.lineNet(price: ClientRentalFormat.number(value.price), quantity: count(value.quantity), mode: value.priceMode,
                                                                         days: ClientRentalFormat.number(value.days), defaultDays: rental.defaultDays, discount: ClientRentalFormat.number(value.discount))))
                    .monospacedDigit().frame(width: 90, alignment: .trailing)
                Button { lines.removeAll { $0.id == value.id } } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).disabled(value.issued > 0).frame(width: 24)
                    .help(value.issued > 0 ? "Pozycja została wydana" : "Usuń pozycję")
            }
            TextField("Uwagi do pozycji", text: line.note).textFieldStyle(.roundedBorder).font(.caption)
        }
        .padding(8).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func check() async {
        let items = demand(lines).map { ["equipment_id": $0.key, "quantity": $0.value] as [String: Any] }
        guard !items.isEmpty else { availability = [:]; return }
        checking = true
        defer { checking = false }
        guard let data = try? JSONSerialization.data(withJSONObject: items), let json = String(data: data, encoding: .utf8) else { return }
        struct Reply: Decodable { var availability: [ClientRentalAvailability] }
        do {
            let reply = try await store.query(["op": "availability", "start": rental.startsAt, "end": rental.endsAt, "items": json, "exclude": rental.id], as: Reply.self)
            availability = Dictionary(reply.availability.map { ($0.equipmentId, $0) }, uniquingKeysWith: { first, _ in first })
        } catch {
            problem = store.failureText(error, "Nie udało się sprawdzić dostępności.")
        }
    }

    private func save() async {
        problem = nil
        if lines.contains(where: { $0.kind == "service" && $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) { tab = .lines; problem = "Podaj nazwę każdej usługi."; return }
        if lines.contains(where: { count($0.quantity) < 1 }) { tab = .lines; problem = "Ilość każdej pozycji musi być większa od zera."; return }
        if lines.contains(where: { $0.itemID != nil && count($0.quantity) < $0.issued }) { tab = .lines; problem = "Ilość nie może być mniejsza niż już wydana."; return }
        func optionalNumber(_ text: String) -> JSONValue { ClientRentalFormat.number(text).map { .number($0) } ?? .null }
        let items: [JSONValue] = lines.map { line in
            var item: [String: JSONValue] = [
                "kind": .string(line.kind),
                "quantity": .number(Double(count(line.quantity))),
                "price_mode": .string(line.priceMode),
                "unit_price": optionalNumber(line.price),
                "days": optionalNumber(line.days),
                "discount_percent": .number(ClientRentalFormat.number(line.discount) ?? 0),
                "note": clientRentalOptional(line.note),
            ]
            if let id = line.itemID { item["id"] = .string(id) }
            if let equipment = line.equipmentID { item["equipment_id"] = .string(equipment) }
            if let kit = line.kitID { item["kit_id"] = .string(kit) }
            if line.kind == "service" { item["name"] = .string(line.name.trimmingCharacters(in: .whitespaces)) }
            // Nowa usługa — jednostka „usł.” jak w CRM (baza domyślnie wpisuje „szt.”).
            if line.kind == "service" && line.itemID == nil { item["unit"] = .string("usł.") }
            else if line.equipmentID != nil { item["name"] = .string(line.name) }
            if line.kind == "equipment" { item["replacement_value"] = optionalNumber(line.replacement) }
            return .object(item)
        }
        saving = true
        defer { saving = false }
        if await store.run(["op": .string("items"), "id": .string(rental.id), "items": .array(items)], success: "Zapisano pozycje wypożyczenia") != nil { dismiss() }
    }
}

// MARK: Protokół wydania / odbioru

@MainActor struct ClientRentalProtocolSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail
    let issue: Bool
    let saved: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    struct ProtocolRow: Identifiable {
        var id: String
        var name: String
        var unit: String
        var max: Int
        var qty: String
        var damaged = "0"
        var missing = "0"
        var note = ""
        var photos: [String] = []
    }

    @State private var rows: [ProtocolRow] = []
    @State private var person = ""
    @State private var note = ""
    @State private var photoFor: String?
    @State private var importing = false
    @State private var uploading = false
    @State private var saving = false
    @State private var problem: String?
    @State private var prepared = false

    private func count(_ text: String) -> Int { max(0, Int(ClientRentalFormat.number(text) ?? 0)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(issue ? "Protokół wydania" : "Protokół odbioru").font(.title2.bold())
            Text("\(rental.number) · \(rental.clientName)\(issue ? "" : " · wpisz, co wróciło sprawne, uszkodzone i czego brakuje")").foregroundStyle(.secondary)
            if rows.isEmpty {
                ContentUnavailableView(issue ? "Cały sprzęt został już wydany" : "U klienta nie ma już sprzętu z tego wypożyczenia", systemImage: "shippingbox")
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach($rows) { $row in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(row.name).fontWeight(.medium)
                                        Text(issue ? "Do wydania: \(row.max) \(row.unit)" : "U klienta: \(row.max) \(row.unit)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    LabeledContent(issue ? "Wydaję" : "Sprawne") { TextField("", text: $row.qty).textFieldStyle(.roundedBorder).frame(width: 60) }
                                    if !issue {
                                        LabeledContent("Uszkodzone") { TextField("", text: $row.damaged).textFieldStyle(.roundedBorder).frame(width: 60) }
                                        LabeledContent("Brak") { TextField("", text: $row.missing).textFieldStyle(.roundedBorder).frame(width: 60) }
                                    }
                                }
                                HStack {
                                    TextField(issue ? "Uwagi (wymagane przy wydaniu mniejszej ilości)" : "Opis uszkodzeń lub braku", text: $row.note).textFieldStyle(.roundedBorder)
                                    Button { photoFor = row.id; importing = true } label: { Label(uploading && photoFor == row.id ? "Przesyłanie…" : "Zdjęcia (\(row.photos.count))", systemImage: "camera") }
                                        .disabled(uploading)
                                    if !row.photos.isEmpty { Button("Usuń zdjęcia") { $row.photos.wrappedValue = [] }.buttonStyle(.link) }
                                }
                            }
                            .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
            HStack {
                TextField(issue ? "Odbiera (imię i nazwisko)" : "Zwraca (imię i nazwisko)", text: $person).textFieldStyle(.roundedBorder)
                TextField("Uwagi do protokołu", text: $note).textFieldStyle(.roundedBorder)
            }
            clientRentalError(problem)
            HStack {
                Text("Po zapisie pobierzesz PDF do podpisu; skan podpisanego protokołu dodasz na karcie.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie…" : issue ? "Zapisz wydanie" : "Zapisz odbiór") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || uploading || rows.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 820, height: 600)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result, let target = photoFor else { return }
            Task { await addPhotos(urls, to: target) }
        }
        .task {
            guard !prepared else { return }
            prepared = true
            person = rental.recipientName ?? ""
            rows = rental.equipment.compactMap { item in
                let max = issue ? item.quantity - item.issuedQty : item.outQty
                return max > 0 ? ProtocolRow(id: item.id, name: item.name, unit: item.unit, max: max, qty: String(max)) : nil
            }
        }
    }

    private func addPhotos(_ urls: [URL], to rowID: String) async {
        uploading = true
        defer { uploading = false; photoFor = nil }
        do {
            var paths: [String] = []
            for url in urls.prefix(10) {
                let reply = try await store.upload(url, rentalID: rental.id, area: "warehouse", kind: "photo", protocolPhoto: true)
                if let path = reply["path"]?.text, !path.isEmpty { paths.append(path) }
            }
            if let index = rows.firstIndex(where: { $0.id == rowID }) { rows[index].photos = Array((rows[index].photos + paths).prefix(10)) }
        } catch {
            problem = store.failureText(error, "Nie udało się przesłać zdjęcia.")
        }
    }

    private func save() async {
        problem = nil
        guard person.trimmingCharacters(in: .whitespaces).count >= 2 else { problem = issue ? "Podaj, kto odbiera sprzęt." : "Podaj, kto zwraca sprzęt."; return }
        var problems: [String] = []
        for row in rows {
            let qty = count(row.qty), damaged = issue ? 0 : count(row.damaged), missing = issue ? 0 : count(row.missing)
            if qty + damaged + missing > row.max { problems.append("„\(row.name)”: najwyżej \(row.max) \(row.unit)") }
            let described = row.note.trimmingCharacters(in: .whitespaces).count >= 3
            if issue && qty > 0 && qty < row.max && !described { problems.append("„\(row.name)”: opisz brak przy wydaniu") }
            if !issue && damaged + missing > 0 && !described { problems.append("„\(row.name)”: opisz uszkodzenia lub brak") }
        }
        guard problems.isEmpty else { problem = problems.joined(separator: "; "); return }
        let lines: [JSONValue] = rows.compactMap { row in
            let qty = count(row.qty), damaged = count(row.damaged), missing = count(row.missing)
            let note = clientRentalOptional(row.note)
            let photos = JSONValue.array(row.photos.map { .string($0) })
            if issue {
                return qty > 0 ? .object(["item_id": .string(row.id), "qty": .number(Double(qty)), "note": note, "photos": photos]) : nil
            }
            return qty + damaged + missing > 0
                ? .object(["item_id": .string(row.id), "ok": .number(Double(qty)), "damaged": .number(Double(damaged)), "missing": .number(Double(missing)), "note": note, "photos": photos])
                : nil
        }
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = [
            "op": .string(issue ? "issue" : "return"), "id": .string(rental.id), "lines": .array(lines),
            "person": .string(person.trimmingCharacters(in: .whitespaces)),
            "note": clientRentalOptional(note),
        ]
        guard let reply = await store.run(body, success: issue ? "Zapisano protokół wydania" : "Zapisano protokół odbioru") else { return }
        dismiss()
        if let id = reply["protocolId"]?.text, !id.isEmpty { saved(id) }
    }
}

// MARK: Rozbieżność po zwrocie

@MainActor struct ClientRentalResolveSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail
    let item: ClientRentalItem
    @Environment(\.dismiss) private var dismiss
    @State private var action = ""
    @State private var qty = ""
    @State private var note = ""
    @State private var units: [ClientRentalUnit] = []
    @State private var selected: Set<String> = []
    @State private var saving = false
    @State private var problem: String?

    private var actions: [(String, String)] {
        var list: [(String, String)] = []
        if item.openDamaged > 0 {
            list.append(("damaged_back", "Uszkodzone: sprawne — wraca na stan"))
            if item.hasUnits { list.append(("damaged_service", "Uszkodzone: do serwisu")) }
            list.append(("damaged_write_off", "Uszkodzone: spisz ze stanu"))
        }
        if item.openMissing > 0 {
            list.append(("missing_back", "Brak: oddane później"))
            list.append(("missing_write_off", "Brak: spisz ze stanu"))
        }
        return list
    }
    private var pending: Int { action.hasPrefix("damaged") ? item.openDamaged : item.openMissing }
    private var unitsHint: String {
        let effect = action == "damaged_service" ? "dostaną status „Uszkodzony”, wrócą na stan po naprawie w Magazynie" : "dostaną status „Wycofany”"
        return "Egzemplarze (\(selected.count) z \(amount)) — " + effect
    }
    private func unitDetail(_ unit: ClientRentalUnit) -> String {
        [Self.unitStatus[unit.status] ?? unit.status, unit.location ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private var needsUnits: Bool { item.hasUnits && (action == "damaged_service" || action.hasSuffix("write_off")) }
    private var needsNote: Bool { action == "damaged_service" || action.hasSuffix("write_off") }
    private var amount: Int { max(0, Int(ClientRentalFormat.number(qty) ?? 0)) }
    private static let unitStatus = ["available": "Dostępny", "reserved": "Zarezerwowany", "in_use": "W użyciu", "damaged": "Uszkodzony", "in_service": "W serwisie", "retired": "Wycofany"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Rozbieżność po zwrocie").font(.title2.bold())
            Text("\(rental.number) · \(item.name) · uszkodzone: \(item.openDamaged), brak: \(item.openMissing)").foregroundStyle(.secondary)
            Picker("Decyzja", selection: $action) {
                ForEach(actions, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.radioGroup)
            LabeledContent("Ilość (do rozstrzygnięcia: \(pending) \(item.unit))") { TextField("", text: $qty).textFieldStyle(.roundedBorder).frame(width: 80) }
            if needsUnits {
                Text(unitsHint)
                    .font(.caption).foregroundStyle(.secondary)
                List(units) { unit in
                    Toggle(isOn: Binding(get: { selected.contains(unit.id) }, set: { if $0 { selected.insert(unit.id) } else { selected.remove(unit.id) } })) {
                        HStack {
                            Text(unit.serial ?? "Bez numeru")
                            Spacer()
                            Text(unitDetail(unit)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                }
                .frame(minHeight: 140)
            }
            TextField(needsNote ? "Opis (wymagany)" : "Opis", text: $note, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            clientRentalError(problem)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || action.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 560)
        .task {
            if action.isEmpty { action = actions.first?.0 ?? "" }
            qty = String(pending)
            if item.hasUnits {
                struct Reply: Decodable { var units: [ClientRentalUnit] }
                units = ((try? await store.query(["op": "units", "item": item.id], as: Reply.self).units) ?? []).filter { ["available", "reserved", "in_use"].contains($0.status) }
            }
        }
        .onChange(of: action) { _, _ in qty = String(pending); selected = [] }
    }

    private func save() async {
        problem = nil
        guard amount >= 1 && amount <= pending else { problem = "Podaj ilość od 1 do \(pending)."; return }
        if needsUnits && selected.count != amount { problem = "Zaznacz \(amount) egzemplarz(e/y)."; return }
        if needsNote && note.trimmingCharacters(in: .whitespaces).count < 3 { problem = "Opisz decyzję (stan, przyczyna)."; return }
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = [
            "op": .string("resolve"), "id": .string(rental.id), "item": .string(item.id), "action": .string(action), "qty": .number(Double(amount)),
            "units": needsUnits ? .array(selected.sorted().map { .string($0) }) : .null,
            "note": clientRentalOptional(note),
        ]
        if await store.run(body, success: "Zapisano rozstrzygnięcie") != nil { dismiss() }
    }
}

// MARK: Dostawa i odbiór

@MainActor struct ClientRentalTripsSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail
    @Environment(\.dismiss) private var dismiss

    struct Trip: Equatable {
        var enabled = false
        var vehicle = ""
        var driver = ""
        var start = Date()
        var end = Date()
        var note = ""
        var conflicts: [ClientRentalConflict] = []
    }

    @State private var delivery = Trip()
    @State private var collection = Trip()
    @State private var saving = false
    @State private var problem: String?
    @State private var prepared = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dostawa i odbiór").font(.title2.bold())
            Text("\(rental.number)\(rental.deliveryAddress.map { " · \($0)" } ?? "")").foregroundStyle(.secondary)
            Form {
                tripSection("Dostawa do klienta", trip: $delivery)
                tripSection("Odbiór od klienta", trip: $collection)
            }
            .formStyle(.grouped)
            .environment(\.timeZone, ClientRentalFormat.zone).environment(\.locale, Locale(identifier: "pl_PL"))
            Text("Pojazd zarezerwowanego lub wydanego wypożyczenia jest zajęty w tych godzinach — eventy go nie dostaną.").font(.caption).foregroundStyle(.secondary)
            clientRentalError(problem)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(width: 600, height: 640)
        .task {
            guard !prepared else { return }
            prepared = true
            await store.loadOptions()
            delivery = initial("delivery")
            collection = initial("collection")
        }
        .task(id: key(delivery)) { delivery.conflicts = await conflicts(delivery) }
        .task(id: key(collection)) { collection.conflicts = await conflicts(collection) }
    }

    private func key(_ trip: Trip) -> String { "\(trip.enabled)|\(trip.vehicle)|\(trip.start.timeIntervalSince1970)|\(trip.end.timeIntervalSince1970)" }

    private func initial(_ kind: String) -> Trip {
        let anchor = ClientRentalFormat.date(kind == "delivery" ? rental.startsAt : rental.endsAt) ?? Date()
        if let saved = rental.trips.first(where: { $0.kind == kind }) {
            return Trip(enabled: true, vehicle: saved.vehicleId ?? "", driver: saved.driverId ?? "", start: ClientRentalFormat.date(saved.startsAt) ?? anchor,
                        end: ClientRentalFormat.date(saved.endsAt) ?? anchor, note: saved.note ?? "")
        }
        let start = kind == "delivery" ? anchor.addingTimeInterval(-7200) : anchor
        return Trip(enabled: rental.handover == "delivery", start: start, end: start.addingTimeInterval(7200))
    }

    @ViewBuilder private func tripSection(_ title: String, trip: Binding<Trip>) -> some View {
        Section {
            Toggle(title, isOn: trip.enabled)
            if trip.wrappedValue.enabled {
                Picker("Pojazd", selection: trip.vehicle) {
                    Text("Bez pojazdu z floty").tag("")
                    ForEach(store.options?.vehicles ?? []) { Text($0.name).tag($0.id) }
                }
                Picker("Kierowca", selection: trip.driver) {
                    Text("Nie wybrano").tag("")
                    ForEach(store.options?.employees ?? []) { Text($0.name).tag($0.id) }
                }
                DatePicker("Od", selection: trip.start)
                DatePicker("Do", selection: trip.end)
                TextField("Uwagi", text: trip.note)
                if !trip.wrappedValue.conflicts.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Pojazd jest zajęty w tym czasie", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        ForEach(trip.wrappedValue.conflicts, id: \.self) { conflict in
                            Text(clientRentalConflictText(conflict, openEnd: "", quantity: false))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if (store.options?.vehicles ?? []).isEmpty { Text("Lista pojazdów wymaga dostępu do Floty.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    /// Zajętość pojazdu w godzinach przejazdu (eventy i inne wypożyczenia; to wypożyczenie pomijane).
    private func conflicts(_ trip: Trip) async -> [ClientRentalConflict] {
        guard trip.enabled, !trip.vehicle.isEmpty, trip.end > trip.start else { return [] }
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled else { return trip.conflicts }
        struct Reply: Decodable { var conflicts: [ClientRentalConflict] }
        return (try? await store.query(["op": "conflicts", "vehicle": trip.vehicle, "start": ClientRentalFormat.string(trip.start),
                                         "end": ClientRentalFormat.string(trip.end), "exclude": rental.id], as: Reply.self).conflicts) ?? []
    }

    private func save() async {
        problem = nil
        var trips: [JSONValue] = []
        for (kind, trip) in [("delivery", delivery), ("collection", collection)] where trip.enabled {
            guard trip.end > trip.start else { problem = "\(kind == "delivery" ? "Dostawa" : "Odbiór"): koniec musi być po początku."; return }
            var entry: [String: JSONValue] = [:]
            entry["kind"] = .string(kind)
            entry["vehicle_id"] = clientRentalOptional(trip.vehicle)
            entry["driver_id"] = clientRentalOptional(trip.driver)
            entry["starts_at"] = .string(ClientRentalFormat.string(trip.start))
            entry["ends_at"] = .string(ClientRentalFormat.string(trip.end))
            entry["note"] = clientRentalOptional(trip.note)
            trips.append(.object(entry))
        }
        saving = true
        defer { saving = false }
        if await store.run(["op": .string("trips"), "id": .string(rental.id), "trips": .array(trips)], success: "Zapisano dostawę i odbiór", refreshList: false) != nil { dismiss() }
    }
}

// MARK: Powód anulowania

@MainActor struct ClientRentalReasonSheet: View {
    @ObservedObject var store: ClientRentalsStore
    let rentalID: String
    let status: ClientRentalStatus
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Anuluj wypożyczenie").font(.title2.bold())
            Text("Sprzęt wróci do dostępnych, a magazyn dostanie powiadomienie z powodem.").foregroundStyle(.secondary)
            TextField("Powód anulowania", text: $reason, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Wróć") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie…" : "Anuluj wypożyczenie", role: .destructive) {
                    Task {
                        saving = true
                        defer { saving = false }
                        let body: [String: JSONValue] = ["op": .string("status"), "id": .string(rentalID), "status": .string(status.rawValue),
                                                         "note": .string(reason.trimmingCharacters(in: .whitespaces))]
                        if await store.run(body, success: "Anulowano wypożyczenie") != nil { dismiss() }
                    }
                }
                .disabled(saving || reason.trimmingCharacters(in: .whitespaces).count < 3)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
