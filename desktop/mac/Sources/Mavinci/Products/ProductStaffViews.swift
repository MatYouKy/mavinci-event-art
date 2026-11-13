import SwiftUI

// MARK: Obsada i personel na karcie produktu (`ProductStaffSection`, `AddStaffModal`, `PackageStaffCompensationFields`):
// role z liczbą osób, czasem i rozliczeniem (faktura, gotówka z dokumentem, gotówka z zysku z CIT i dywidendą), koszt dla
// firmy, wymagane umiejętności ze sprzętu oraz dziedziczenie w wariancie.

@MainActor struct ProductStaffSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    @EnvironmentObject private var state: Workspace
    @State private var form: ProductStaffForm?
    @State private var removing: ProductResources.StaffRow?

    private var variantName: String? { resources.scope.variantName }
    private var inherited: Bool { resources.scope.inherited.staff }
    private var editable: Bool { resources.canEdit && !inherited && state.canWrite }

    var body: some View {
        ProductPanel(title: "Wymagani pracownicy",
                     subtitle: variantName.map { inherited ? "\($0) dziedziczy personel produktu bazowego" : "Własny personel wariantu: \($0)" }
                        ?? "Role, liczba osób i koszty, również za realizację oraz przy wypłacie gotówką.") {
            if !resources.staff.requiredSkills.isEmpty {
                Label("\(resources.staff.requiredSkills.count) wymaganych umiejętności", systemImage: "exclamationmark.circle")
                    .font(.caption).foregroundStyle(.orange)
            }
            ProductScopeButtons(canEdit: resources.canEdit && state.canWrite, variant: variantName != nil, inherited: inherited,
                                customize: { variantAction("variantCustomize", success: "Wariant ma teraz własną obsadę") },
                                inherit: { variantAction("variantInherit", success: "Przywrócono dziedziczenie z produktu bazowego") },
                                addTitle: "Dodaj rolę", add: { form = ProductStaffForm(row: nil, readOnly: false, settings: resources.compensation) })
        } content: {
            VStack(alignment: .leading, spacing: 10) {
                if !resources.staff.requiredSkills.isEmpty { skills }
                if resources.staff.rows.isEmpty {
                    Text("Brak wymagań kadrowych").foregroundStyle(.secondary)
                } else {
                    ForEach(resources.staff.rows) { row in staffRow(row) }
                    HStack {
                        Text("Obsada — koszt dla firmy").foregroundStyle(.secondary)
                        Spacer()
                        Text(resources.staff.costNet.map { "\(ProductText.number($0)) zł" } ?? "Uzupełnij rozliczenie obsady")
                            .fontWeight(.semibold).foregroundStyle(resources.staff.costNet == nil ? Color.orange : Color.primary)
                    }
                    .font(.callout)
                    .padding(.top, 4)
                }
            }
        }
        .sheet(item: $form) { form in ProductStaffSheet(store: store, productID: productID, resources: resources, form: form) }
        .confirmationDialog("Usunąć rolę „\(removing?.roleLabel ?? "")”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Usuń rolę", role: .destructive) {
                if let row = removing {
                    Task { await store.changeResources(productID, "staffRemove", ["rowId": .string(row.id)], success: "Rola usunięta") }
                }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        }
    }

    private func variantAction(_ op: String, success: String) {
        guard let variant = store.scope(productID) else { return }
        Task { await store.changeResources(productID, op, ["variantId": .string(variant), "section": .string("staff")], success: success) }
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Sprzęt wymaga specjalnych umiejętności", systemImage: "exclamationmark.triangle.fill").font(.callout.weight(.semibold)).foregroundStyle(.orange)
            Text("Wybierz pracowników, którzy posiadają poniższe umiejętności:").font(.caption).foregroundStyle(.secondary)
            ForEach(resources.staff.requiredSkills) { skill in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(skill.name).font(.callout.weight(.medium))
                        if !skill.minimum.isEmpty { Text("min. \(skill.minimum)").font(.caption).foregroundStyle(.secondary) }
                        if let category = skill.category {
                            Text(category).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Color.orange.opacity(0.15), in: Capsule())
                        }
                    }
                    if let description = skill.description, !description.isEmpty { Text(description).font(.caption).foregroundStyle(.secondary) }
                    if !skill.equipment.isEmpty { Text("Wymagane przez: \(skill.equipment.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func staffRow(_ row: ProductResources.StaffRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.fill").foregroundStyle(.secondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.roleLabel).font(.callout.weight(.medium))
                Text(row.notes?.isEmpty == false ? row.notes! : "—").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 8) {
                    Text("Ilość: \(ProductText.number(row.quantity))")
                    if row.compensation == nil, let rate = row.hourlyRate { Text("\(ProductText.number(rate)) zł/h") }
                    if row.compensation == nil, let hours = row.estimatedHours { Text("~\(ProductText.number(hours))h") }
                    if row.optional {
                        Text("Opcjonalny").padding(.horizontal, 5).padding(.vertical, 1).background(Color.secondary.opacity(0.15), in: Capsule())
                    }
                    Text(row.cost.map { "\(ProductText.number($0)) zł kosztu" } ?? "Koszt nieustalony")
                        .foregroundStyle(row.cost == nil ? Color.orange : Color.primary)
                    if let compensation = row.compensation {
                        Text(ProductStaffCost.settlementLabel(compensation.settlement_method)).foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
            }
            Spacer()
            Menu {
                Button("Podgląd", systemImage: "eye") { form = ProductStaffForm(row: row, readOnly: true, settings: resources.compensation) }
                if editable {
                    Button("Edytuj", systemImage: "pencil") { form = ProductStaffForm(row: row, readOnly: false, settings: resources.compensation) }
                    Divider()
                    Button("Usuń", systemImage: "trash", role: .destructive) { removing = row }
                }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(8)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Dane formularza roli (nowa, edycja albo podgląd).
struct ProductStaffForm: Identifiable {
    let id = UUID()
    let row: ProductResources.StaffRow?
    let readOnly: Bool
    let settings: ProductStaffSnapshot?
}

@MainActor struct ProductStaffSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let resources: ProductResources
    let form: ProductStaffForm
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var role: String
    @State private var quantity: Double?
    @State private var hours: Double?
    @State private var optional: Bool
    @State private var notes: String
    @State private var payment: ProductStaffCompensation?
    /// Pola stawki, gdy rozliczenie nie jest jeszcze ustalone (jak domyślne wartości w CRM).
    @State private var basis = "per_service"
    @State private var method = "invoice"
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, resources: ProductResources, form: ProductStaffForm) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.resources = resources
        self.form = form
        let row = form.row
        _role = State(initialValue: row?.role ?? "")
        _quantity = State(initialValue: row?.quantity ?? 1)
        _hours = State(initialValue: row?.estimatedHours)
        _optional = State(initialValue: row?.optional ?? false)
        _notes = State(initialValue: row?.notes ?? "")
        var initial = row?.compensation
        if initial == nil, let rate = row?.hourlyRate {
            initial = ProductStaffCompensation(rate_basis: "hourly", rate: rate,
                                               settlement_method: row?.paymentType == "cash_no_receipt" ? "cash_non_deductible" : "invoice",
                                               compensation_snapshot: nil)
        }
        if initial?.settlement_method == "cash_non_deductible", initial?.compensation_snapshot?.valid != true, let settings = form.settings {
            initial?.compensation_snapshot = settings
        }
        _payment = State(initialValue: initial)
        _basis = State(initialValue: initial?.rate_basis ?? "per_service")
        _method = State(initialValue: initial?.settlement_method ?? "invoice")
    }

    private var readOnly: Bool { form.readOnly }
    private var payout: Double? { ProductStaffCost.payout(quantity: quantity ?? 0, hours: hours, compensation: payment) }
    private var total: Double? { ProductStaffCost.companyCost(quantity: quantity ?? 0, hours: hours, compensation: payment) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(readOnly ? "Podgląd obsady" : form.row == nil ? "Dodaj rolę i koszt" : "Edytuj rolę i koszt").font(.title3.weight(.semibold))
                Text(resources.scope.variantName ?? "Produkt bazowy").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ProductField(label: "Nazwa roli") {
                        TextField("", text: Binding(get: { role }, set: { role = String($0.prefix(120)) }), prompt: Text("Np. Prowadzący"))
                            .textFieldStyle(.roundedBorder)
                    }
                    HStack(alignment: .top, spacing: 12) {
                        ProductField(label: "Liczba osób") { ProductNumberField(value: $quantity) }
                        ProductField(label: "Godziny / osobę") { ProductNumberField(value: $hours, nullable: true) }
                    }
                    compensation
                    ProductField(label: "Notatki") {
                        ProductTextArea(text: Binding(get: { notes }, set: { notes = String($0.prefix(500)) }), lines: 2...4)
                    }
                    Toggle("Opcjonalna obsada — bez doliczania kosztu", isOn: $optional).toggleStyle(.checkbox)
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
                .disabled(readOnly || saving)
            }
            .frame(height: 470)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button(readOnly ? "Zamknij" : "Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if !readOnly {
                    Button(saving ? "Zapisywanie…" : "Zapisz rolę i koszt") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
                }
            }
            .padding(18)
        }
        .frame(width: 560)
        .background(theme.page)
    }

    // MARK: Rozliczenie (`PackageStaffCompensationFields`, zakres produktu)
    @ViewBuilder private var compensation: some View {
        if readOnly {
            if let payment, let rate = payment.rate {
                Text("\(ProductStaffCost.settlementLabel(payment.settlement_method)) · \(ProductText.money(rate)) \(payment.hourly ? "/ godzinę / osobę" : "/ realizację / osobę")")
                    .font(.callout)
            } else {
                Text("Nie określono rozliczenia obsady.").font(.callout).foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ProductField(label: "Sposób rozliczenia") {
                    Picker("", selection: Binding(get: { payment?.settlement_method ?? method }, set: { next in
                        method = next
                        guard var current = payment else { return }
                        current.settlement_method = next
                        current.compensation_snapshot = next == "cash_non_deductible" ? (current.compensation_snapshot ?? form.settings) : nil
                        payment = current
                    })) {
                        ForEach(ProductStaffCost.settlements, id: \.key) { item in Text(item.label).tag(item.key) }
                    }
                    .labelsHidden()
                }
                HStack(alignment: .top, spacing: 12) {
                    ProductField(label: "Naliczanie") {
                        Picker("", selection: Binding(get: { payment?.rate_basis ?? basis }, set: { next in
                            basis = next
                            if var current = payment { current.rate_basis = next; payment = current }
                        })) {
                            Text("Za realizację / osobę").tag("per_service")
                            Text("Za godzinę / osobę").tag("hourly")
                        }
                        .labelsHidden()
                    }
                    ProductField(label: (payment?.settlement_method ?? method) == "invoice" ? "Stawka netto (zł)" : "Kwota do wypłaty (zł)") {
                        ProductNumberField(value: Binding(get: { payment?.rate }, set: { next in
                            if var current = payment {
                                current.rate = next
                                payment = current
                            } else if let next {
                                payment = ProductStaffCompensation(rate_basis: basis, rate: next, settlement_method: method,
                                                                   compensation_snapshot: method == "cash_non_deductible" ? form.settings : nil)
                            }
                        }), prompt: "Podaj stawkę", nullable: true)
                    }
                }
                if payment == nil {
                    Text("Wpisz stawkę, aby uwzględnić koszt pracy. Domyślnie wybrana jest faktura; przy wypłacie gotówką zmień sposób rozliczenia.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Button("Usuń ustaloną stawkę") { payment = nil }.buttonStyle(.link).font(.caption)
                }
                if let payment, payment.settlement_method == "cash_non_deductible" { cashParameters(payment) }
                summary
            }
            .padding(10)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder private func cashParameters(_ payment: ProductStaffCompensation) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let snapshot = payment.compensation_snapshot, snapshot.valid {
                Text("Zapisane parametry: CIT \(ProductText.number(snapshot.cit_rate ?? 0))% · dywidenda \(ProductText.number(snapshot.dividend_rate ?? 0))%.")
                    .font(.caption)
            } else {
                Text("Do obliczenia kosztu potrzebne są parametry z ustawień rozliczeń.").font(.caption).foregroundStyle(.orange)
            }
            if let settings = form.settings, settings.valid,
               payment.compensation_snapshot?.valid != true
                || settings.cit_rate != payment.compensation_snapshot?.cit_rate
                || settings.dividend_rate != payment.compensation_snapshot?.dividend_rate {
                Button("Zastosuj aktualne parametry CIT i dywidendy") {
                    var current = payment
                    current.compensation_snapshot = settings
                    self.payment = current
                }
                .buttonStyle(.link).font(.caption)
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let payment, let payout {
                Text("\(payment.settlement_method == "invoice" ? "Łączna wartość netto" : "Łącznie do wypłaty"): \(ProductText.money(payout)) · \(ProductText.number(quantity ?? 0)) os.\(payment.hourly ? " × \(hours.map(ProductText.number) ?? "—") h" : "")")
            }
            if payment?.settlement_method == "cash_non_deductible", let total, let payout {
                Text("Dodatkowy koszt finansowania według ustawień: \(ProductText.money(total - payout))")
            }
            Text("Koszt dla spółki: \(total.map(ProductText.money) ?? "uzupełnij stawkę, czas i parametry rozliczenia")").fontWeight(.medium)
            Text(optional ? "Obsada opcjonalna — koszt nie jest doliczany." : "Koszt obsady doliczany osobno do produktu i nowych pozycji oferty. Nie wpisuj go ponownie w koszcie bazowym.")
                .foregroundStyle(.secondary)
        }
        .font(.caption)
    }

    private func save() async {
        let name = role.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { problem = "Podaj nazwę roli (maks. 120 znaków)."; return }
        guard let count = quantity, count >= 1, count == count.rounded() else { problem = "Podaj całkowitą ilość zasobu od 1 do 10 000."; return }
        if let payment, payment.hourly, (hours ?? 0) <= 0 { problem = "Podaj liczbę godzin dla rozliczenia godzinowego obsady."; return }
        if let payment, payment.settlement_method == "cash_non_deductible", payment.compensation_snapshot?.valid != true {
            problem = "Wczytaj parametry CIT i dywidendy z ustawień wynagrodzeń."
            return
        }
        problem = nil
        saving = true
        defer { saving = false }
        var fields: [String: JSONValue] = [
            "role": .string(name), "quantity": .number(count), "estimatedHours": hours.map { JSONValue.number($0) } ?? .null,
            "optional": .bool(optional), "notes": .string(notes), "compensation": payment?.json ?? .null,
        ]
        if let row = form.row { fields["rowId"] = .string(row.id) }
        if await store.changeResources(productID, "staffSave", fields, success: form.row == nil ? "Rola dodana" : "Zapisano rolę i koszt") {
            dismiss()
        }
    }
}
