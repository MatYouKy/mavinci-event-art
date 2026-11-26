import SwiftUI

// MARK: Rozliczenie wypożyczenia (sprzedaż) — 1:1 z `RentalSettlement.tsx`: netto / rabat / naliczenia / VAT / brutto, kaucja,
// naliczenia dla klienta (podpowiedź „Z rozbieżności”: uszkodzone i brakujące sztuki × wartość odtworzeniowa), kaucja (wpłata,
// zwrot, rozliczenie) i faktury z Finansów (dołącz po numerze, odłącz, wystaw nową — po wystawieniu dołącza się sama).

@MainActor struct ClientRentalSettlementSection: View {
    @ObservedObject var store: ClientRentalsStore
    let rental: ClientRentalDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    struct ChargeRow: Identifiable, Equatable {
        var id = UUID().uuidString
        var itemID: String?
        var kind: String
        var text: String
        var amount: String
    }

    @State private var charges: [ChargeRow] = []
    @State private var chargesDirty = false
    @State private var receivedOn = false
    @State private var received = Date()
    @State private var returned = ""
    @State private var settledOn = false
    @State private var settled = Date()
    @State private var invoiceQuery = ""
    @State private var invoiceHits: [ClientRentalInvoiceHit] = []
    @State private var invoiceKind = "rental"
    @State private var invoiceForm: InvoiceFormRequest?
    @State private var problem: String?
    @State private var busy = false

    private var sales: ClientRentalSales? { rental.sales }
    private var canManage: Bool { rental.access.salesManage && ![.settled, .cancelled].contains(rental.status) }
    private var chargesOpen: Bool { canManage && [.issued, .returned].contains(rental.status) }
    private var signature: String {
        (sales?.charges ?? []).map { "\($0.id ?? ""):\($0.kind):\($0.amount):\($0.itemId ?? ""):\($0.description)" }.joined(separator: "|")
    }
    private var depositSignature: String {
        "\(sales?.depositReceivedAt ?? "")|\(sales?.depositReturnedAmount.map { String($0) } ?? "")|\(sales?.depositSettledAt ?? "")"
    }

    var body: some View {
        if let sales {
            VStack(alignment: .leading, spacing: 14) {
                Text("Rozliczenie").font(.headline.weight(.regular)).textCase(.uppercase)
                if let problem { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                totalsView(sales)
                Divider().opacity(0.4)
                chargesView
                if sales.depositAmount > 0 {
                    Divider().opacity(0.4)
                    depositView(sales)
                }
                Divider().opacity(0.4)
                invoicesView(sales)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            .task(id: signature) {
                charges = sales.charges.map { ChargeRow(id: $0.id ?? UUID().uuidString, itemID: $0.itemId, kind: $0.kind, text: $0.description, amount: ClientRentalFormat.plain($0.amount)) }
                chargesDirty = false
            }
            .task(id: depositSignature) {
                receivedOn = sales.depositReceivedAt != nil
                received = ClientRentalFormat.date(sales.depositReceivedAt) ?? Date()
                returned = ClientRentalFormat.plain(sales.depositReturnedAmount)
                settledOn = sales.depositSettledAt != nil
                settled = ClientRentalFormat.date(sales.depositSettledAt) ?? Date()
            }
            .task(id: invoiceQuery) {
                let text = invoiceQuery.trimmingCharacters(in: .whitespaces)
                guard text.count >= 2 else { invoiceHits = []; return }
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                struct Reply: Decodable { var invoices: [ClientRentalInvoiceHit] }
                invoiceHits = (try? await store.query(["op": "invoices", "q": text], as: Reply.self).invoices) ?? []
            }
            .formWindow(item: $invoiceForm, kind: .invoice) { [store = self.store, rentalID = rental.id, kind = invoiceKind] request in
                InvoiceFormSheet(request: request) { id in
                    Task {
                        await store.run(["op": .string("invoice"), "id": .string(rentalID), "invoiceId": .string(id), "kind": .string(kind), "link": .bool(true)],
                                        success: "Dołączono fakturę do wypożyczenia", refreshList: false)
                    }
                }
            }
        }
    }

    private func amountRow(_ label: String, _ value: String, strong: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(strong ? Color.primary : Color.secondary).fontWeight(strong ? .medium : .regular)
            Spacer()
            Text(value).monospacedDigit().fontWeight(strong ? .medium : .regular).foregroundStyle(strong ? theme.accent : .primary).textSelection(.enabled)
        }
    }

    private func totalsView(_ sales: ClientRentalSales) -> some View {
        let totals = sales.totals
        let depositLeft = totals.deposit - (totals.depositReturned ?? 0)
        let depositText = ClientRentalFormat.money(totals.deposit) + (totals.depositReturned.map { " · zwrócono \(ClientRentalFormat.money($0))" } ?? "")
        return VStack(spacing: 4) {
            amountRow("Pozycje netto", ClientRentalFormat.money(totals.linesNet))
            if totals.discountAmount > 0 { amountRow("Rabat \(ClientRentalFormat.plain(sales.discountPercent))%", "−" + ClientRentalFormat.money(totals.discountAmount)) }
            amountRow("Naliczenia netto", ClientRentalFormat.money(totals.chargesNet))
            amountRow("Razem netto", ClientRentalFormat.money(totals.net))
            amountRow("VAT \(ClientRentalFormat.plain(sales.vatRate))%", ClientRentalFormat.money(totals.vat))
            amountRow("Razem brutto", ClientRentalFormat.money(totals.gross), strong: true)
            amountRow("Kaucja", depositText)
            if totals.depositReturned != nil && depositLeft > 0 { amountRow("Zatrzymano z kaucji", ClientRentalFormat.money(depositLeft)) }
        }
    }

    private var chargesView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Naliczenia dla klienta").font(.subheadline.weight(.medium)).foregroundStyle(.secondary).textCase(.uppercase)
                Spacer()
                if chargesOpen {
                    Button("Z rozbieżności") { suggest() }.controlSize(.small).disabled(busy)
                    Button {
                        chargesDirty = true
                        charges.append(ChargeRow(kind: "other", text: "", amount: ""))
                    } label: { Label("Naliczenie", systemImage: "plus") }.controlSize(.small).disabled(busy)
                }
            }
            if charges.isEmpty {
                Text(chargesOpen ? "Brak naliczeń. Po zwrocie z rozbieżnościami użyj „Z rozbieżności”." : "Brak naliczeń.").font(.callout).foregroundStyle(.secondary)
            }
            ForEach($charges) { $charge in
                HStack {
                    Picker("", selection: edited($charge.kind)) {
                        ForEach(ClientRentalCharge.kinds, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().frame(width: 150)
                    TextField("Opis", text: edited($charge.text)).textFieldStyle(.roundedBorder)
                    TextField("Netto zł", text: edited($charge.amount)).textFieldStyle(.roundedBorder).frame(width: 100)
                    if chargesOpen {
                        Button {
                            chargesDirty = true
                            charges.removeAll { $0.id == charge.id }
                        } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red).help("Usuń naliczenie")
                    }
                }
                .disabled(!chargesOpen)
            }
            if chargesOpen && chargesDirty {
                Button("Zapisz naliczenia") { Task { await saveCharges() } }.buttonStyle(.borderedProminent).controlSize(.small).disabled(busy)
            }
        }
    }

    private func depositView(_ sales: ClientRentalSales) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Kaucja \(ClientRentalFormat.money(sales.depositAmount))").font(.subheadline.weight(.medium)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Wpłacona", isOn: $receivedOn).toggleStyle(.checkbox)
                    if receivedOn { DatePicker("", selection: $received).labelsHidden() }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Zwrócono klientowi (zł)").font(.caption).foregroundStyle(.secondary)
                    TextField("", text: $returned).textFieldStyle(.roundedBorder).frame(width: 110)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Rozliczona", isOn: $settledOn).toggleStyle(.checkbox)
                    if settledOn { DatePicker("", selection: $settled).labelsHidden() }
                }
            }
            .disabled(!canManage)
            .environment(\.timeZone, ClientRentalFormat.zone).environment(\.locale, Locale(identifier: "pl_PL"))
            if canManage { Button("Zapisz kaucję") { Task { await saveDeposit() } }.controlSize(.small).disabled(busy) }
        }
    }

    private func invoicesView(_ sales: ClientRentalSales) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Faktury").font(.subheadline.weight(.medium)).foregroundStyle(.secondary).textCase(.uppercase)
            if sales.invoices.isEmpty { Text("Brak powiązanych faktur.").font(.callout).foregroundStyle(.secondary) }
            ForEach(sales.invoices) { invoice in
                HStack {
                    Button { state.showInvoice(invoice.invoiceId) } label: { Label(invoice.invoiceNumber, systemImage: "doc.text") }.buttonStyle(.link).linkCursor()
                    Spacer()
                    Text("\(invoiceKindLabel(invoice.kind)) · \(ClientRentalFormat.money(invoice.totalGross))")
                        .font(.caption).foregroundStyle(.secondary)
                    if canManage {
                        Button("Odłącz") { Task { await link(invoice.invoiceId, kind: invoice.kind, attach: false) } }.buttonStyle(.link).foregroundStyle(.red).disabled(busy)
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            if canManage && rental.status != .draft {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        TextField("Dołącz fakturę — wpisz numer…", text: $invoiceQuery).textFieldStyle(.roundedBorder)
                        ForEach(invoiceHits) { hit in
                            Button {
                                invoiceQuery = ""; invoiceHits = []
                                Task { await link(hit.id, kind: invoiceKind, attach: true) }
                            } label: {
                                HStack {
                                    Label(hit.invoiceNumber, systemImage: "link")
                                    Spacer()
                                    Text(ClientRentalFormat.money(hit.totalGross)).font(.caption).foregroundStyle(.secondary)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).padding(.vertical, 3).disabled(busy)
                        }
                    }
                    Picker("", selection: $invoiceKind) {
                        ForEach(ClientRentalInvoice.kinds, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().fixedSize()
                    Button { invoiceForm = .new(type: "vat", eventID: nil) } label: { Label("Wystaw fakturę", systemImage: "plus") }
                        .help("Po wystawieniu faktura zostanie dołączona do wypożyczenia")
                }
            }
        }
    }

    /// Zmiana pola naliczenia oznacza listę jako niezapisaną.
    private func edited<Value>(_ binding: Binding<Value>) -> Binding<Value> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = $0; chargesDirty = true })
    }

    private func invoiceKindLabel(_ kind: String) -> String {
        ClientRentalInvoice.kinds.first(where: { $0.0 == kind })?.1 ?? kind
    }

    /// Podpowiedź z rozbieżności: uszkodzone i brakujące sztuki × wartość odtworzeniowa (do poprawy przed zapisem).
    private func suggest() {
        var next: [ChargeRow] = []
        for item in rental.items {
            if item.returnedDamagedQty > 0 && !charges.contains(where: { $0.itemID == item.id && $0.kind == "damage" }) {
                let amount = (Double(item.returnedDamagedQty) * (item.replacementValue ?? 0) * 100).rounded() / 100
                next.append(ChargeRow(itemID: item.id, kind: "damage", text: "\(item.name) — uszkodzone \(item.returnedDamagedQty) \(item.unit)", amount: ClientRentalFormat.plain(amount)))
            }
            if item.returnedMissingQty > 0 && !charges.contains(where: { $0.itemID == item.id && $0.kind == "missing" }) {
                let amount = (Double(item.returnedMissingQty) * (item.replacementValue ?? 0) * 100).rounded() / 100
                next.append(ChargeRow(itemID: item.id, kind: "missing", text: "\(item.name) — brak \(item.returnedMissingQty) \(item.unit)", amount: ClientRentalFormat.plain(amount)))
            }
        }
        guard !next.isEmpty else { state.notice = "Brak rozbieżności bez naliczenia"; return }
        chargesDirty = true
        charges += next
    }

    private func saveCharges() async {
        problem = nil
        if charges.contains(where: { $0.text.trimmingCharacters(in: .whitespaces).isEmpty || (ClientRentalFormat.number($0.amount) ?? -1) < 0 }) {
            problem = "Każde naliczenie wymaga opisu i kwoty netto."
            return
        }
        let list: [JSONValue] = charges.map { charge in
            .object([
                "item_id": charge.itemID.map { .string($0) } ?? .null,
                "kind": .string(charge.kind),
                "description": .string(charge.text.trimmingCharacters(in: .whitespaces)),
                "amount": .number(ClientRentalFormat.number(charge.amount) ?? 0),
            ])
        }
        busy = true
        defer { busy = false }
        if await store.run(["op": .string("charges"), "id": .string(rental.id), "charges": .array(list)], success: "Zapisano naliczenia") != nil { chargesDirty = false }
    }

    private func saveDeposit() async {
        problem = nil
        if !returned.trimmingCharacters(in: .whitespaces).isEmpty && (ClientRentalFormat.number(returned) ?? -1) < 0 { problem = "Podaj kwotę zwrotu kaucji."; return }
        let data: [String: JSONValue] = [
            "deposit_received_at": receivedOn ? .string(ClientRentalFormat.string(received)) : .null,
            "deposit_returned_amount": ClientRentalFormat.number(returned).map { .number($0) } ?? .null,
            "deposit_settled_at": settledOn ? .string(ClientRentalFormat.string(settled)) : .null,
        ]
        busy = true
        defer { busy = false }
        if await store.run(["op": .string("save"), "id": .string(rental.id), "data": .object(data)], success: "Zapisano kaucję") != nil {
            await store.loadDetail(rental.id)
        }
    }

    private func link(_ invoiceID: String, kind: String, attach: Bool) async {
        busy = true
        defer { busy = false }
        await store.run(["op": .string("invoice"), "id": .string(rental.id), "invoiceId": .string(invoiceID), "kind": .string(kind), "link": .bool(attach)],
                        success: attach ? "Dołączono fakturę" : "Odłączono fakturę", refreshList: false)
    }
}
