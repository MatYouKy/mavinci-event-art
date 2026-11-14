import SwiftUI

// MARK: „Logistyka oferty” (`OfferPackagesEditor` + `OfferLogisticsEstimateEditor`) — wewnętrzny koszt wspólny dla całej
// realizacji: kwota ręczna albo kalkulator szacunkowy (paliwo, czas ekipy, wyżywienie, nocleg, inne, rezerwa, założenia)
// i opcjonalna osobna dopłata klienta z opisem. Trasę z mapy i bieżące ceny paliw liczy kalkulator w CRM — tu dystans,
// spalanie i cenę paliwa wpisuje się ręcznie (zapisana trasa zostaje).

@MainActor struct OfferLogisticsSheet: View {
    let editing: Bool
    let onSave: (OfferLogistics) async -> String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var value: OfferLogistics
    /// Szacunek sprzed przełączenia na kwotę ręczną (powrót bez utraty wierszy).
    @State private var previous: OfferLogisticsEstimate?
    @State private var saving = false
    @State private var problem: String?

    init(logistics: OfferLogistics, editing: Bool, onSave: @escaping (OfferLogistics) async -> String?) {
        self.editing = editing
        self.onSave = onSave
        _value = State(initialValue: logistics)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Logistyka oferty").font(.title3.weight(.semibold)).padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Koszt wspólny dla całej realizacji. Nie powtarzaj tutaj kosztów już zapisanych w produktach lub ich pakietach.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if editing {
                        Picker("Sposób szacowania kosztu", selection: Binding(get: { value.estimate != nil }, set: { switchMode($0) })) {
                            Text("Kalkulator szacunkowy").tag(true)
                            Text("Kwota ręczna").tag(false)
                        }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                    }
                    if let estimate = value.estimate {
                        estimateEditor(estimate)
                    } else if editing {
                        ProductField(label: "Wewnętrzny koszt logistyki netto (zł) — wymagany") {
                            ProductNumberField(value: $value.cost, prompt: "Wpisz koszt lub 0", nullable: true, suffix: "zł").frame(width: 220)
                        }
                    } else {
                        Text("Koszt dla firmy: \(manualCost)").font(.callout)
                    }
                    Text("Założenia i koszt są wewnętrzne. Zapisz logistykę, aby zachować zmiany. Osobna dopłata klienta jest ustawiana poniżej.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Divider()
                    clientSection
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
            }
            .frame(height: 600)
            .disabled(saving)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button(editing ? "Anuluj" : "Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if editing {
                    Button(saving ? "Zapisywanie…" : "Zapisz logistykę") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
                }
            }
            .padding(18)
        }
        .frame(width: 720)
        .background(theme.page)
    }

    private var manualCost: String {
        guard let cost = value.cost else { return "Nie oszacowano" }
        return "\(OfferText.money(cost)) netto"
    }

    // MARK: Dopłata klienta

    @ViewBuilder private var clientSection: some View {
        if editing {
            Toggle("Dolicz logistykę jako osobną pozycję dla klienta", isOn: $value.enabled).toggleStyle(.checkbox)
            if value.enabled {
                ProductField(label: "Cena logistyki dla klienta netto (zł)") {
                    ProductNumberField(value: $value.price, nullable: true, suffix: "zł").frame(width: 220)
                }
                ProductField(label: "Opis widoczny w ofercie") {
                    ProductTextArea(text: Binding(get: { value.description }, set: { value.description = String($0.prefix(1000)) }), lines: 2...4)
                }
            } else {
                Text("Klient zobaczy wyłącznie ceny pozycji lub pakietów. Uwzględnij w nich logistykę samodzielnie — system nie podniesie ich automatycznie.")
                    .font(.callout).foregroundStyle(theme.accent)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
        } else {
            Text(value.enabled ? "Osobna dopłata klienta: \(OfferText.money(value.price ?? 0)) netto" : "Bez osobnej dopłaty klienta").font(.callout)
            if value.enabled && !value.description.isEmpty {
                Text(value.description).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }

    // MARK: Kalkulator szacunkowy

    @ViewBuilder private func estimateEditor(_ estimate: OfferLogisticsEstimate) -> some View {
        let summary = OfferLogisticsMath.summary(estimate)
        Text("Szacunek na potrzeby oferty. Wpisuj koszty dla firmy. Dystans i czas uwzględniają wybrany zakres przejazdu; kalkulator nie ustala wynagrodzeń ani diet pracowniczych.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        ForEach(estimate.rows) { row in rowView(row) }
        if editing {
            HStack(spacing: 6) {
                ForEach(OfferLogisticsMath.kinds, id: \.key) { kind in
                    Button {
                        mutate { estimate in
                            let row = OfferLogisticsMath.newRow(kind.key, route: estimate.route)
                            estimate.rows.append(row)
                        }
                    } label: { Label(kind.label, systemImage: "plus") }
                        .disabled(estimate.rows.count >= 30)
                }
            }
            .controlSize(.small)
            ProductField(label: "Rezerwa na nieprzewidziane wydatki (%)") {
                ProductNumberField(value: Binding(get: { value.estimate?.reserve_percent }, set: { next in mutate { $0.reserve_percent = next } }),
                                   nullable: true, suffix: "%").frame(width: 160)
            }
            ProductField(label: "Założenia szacunku") {
                ProductTextArea(text: Binding(get: { value.estimate?.notes ?? "" }, set: { next in mutate { $0.notes = String(next.prefix(2000)) } }),
                                prompt: "Np. 2 osoby, nocleg bez śniadania, obiad zapewnia klient…", lines: 2...5)
            }
        } else if !estimate.notes.isEmpty {
            Text(estimate.notes).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
        }
        VStack(alignment: .leading, spacing: 6) {
            if let total = summary.total {
                Text("Koszty: \(OfferText.money(summary.subtotal)) · Rezerwa (\(OfferText.number(estimate.reserve_percent ?? 0))%): \(OfferText.money(summary.reserve))")
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                Text("Szacunkowy koszt dla firmy: \(OfferText.money(total))").font(.title3.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
            } else {
                Text(summary.error).font(.callout).foregroundStyle(theme.accent).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }

    private func rowView(_ row: OfferLogisticsRow) -> some View {
        let id = row.id
        let cost = OfferLogisticsMath.cost(row)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(OfferLogisticsMath.kindLabel(row.kind)).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                Spacer()
                Text(cost.map(OfferText.money) ?? "Do uzupełnienia").font(.callout).foregroundStyle(theme.accent).monospacedDigit()
                if editing {
                    Button { mutate { estimate in estimate.rows.removeAll { $0.id == id } } } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red)
                        .help("Usuń koszt: \(row.name)")
                }
            }
            if editing {
                ProductField(label: "Nazwa / założenie") {
                    TextField("", text: Binding(get: { value.estimate?.rows.first(where: { $0.id == id })?.name ?? "" },
                                                set: { next in patch(id) { $0.name = String(next.prefix(120)) } }))
                        .textFieldStyle(.roundedBorder)
                }
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 10) {
                    number(row, \.quantity, Self.quantityLabel(row.kind))
                    number(row, \.units, Self.unitsLabel(row.kind))
                    if row.kind == "fuel" { number(row, \.consumption, "Spalanie (l/100 km)") }
                    number(row, \.rate, Self.rateLabel(row.kind))
                    if row.kind == "travel" { number(row, \.included_hours, "Godziny już w cenie pakietu / osobę") }
                }
                if row.kind == "fuel" {
                    if let route = OfferLogisticsMath.routeText(row.route ?? value.estimate?.route) {
                        Text("Ostatnie obliczenie: \(route).").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Koszt kalkulatora dotyczy jednego auta. Powyżej mnożymy go przez liczbę aut. Parking, opłaty i wynajem dodaj jako inny koszt. Trasę z mapy i aktualną cenę paliwa wyliczysz kalkulatorem w CRM.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if row.kind == "travel" {
                    Text("Koszt = osoby × (czas podróży − godziny już w pakiecie) × stawka. Kierowców i pasażerów możesz dodać oddzielnie.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if row.kind == "meals" {
                    Text("Uwzględnij tylko posiłki i napoje, które finansujesz. W założeniach zapisz wyżywienie zapewniane przez klienta.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text(row.name).font(.callout)
                Text(readOnlyLine(row)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func number(_ row: OfferLogisticsRow, _ key: WritableKeyPath<OfferLogisticsRow, Double?>, _ label: String) -> some View {
        let id = row.id
        return ProductField(label: label) {
            ProductNumberField(value: Binding(get: { value.estimate?.rows.first(where: { $0.id == id })?[keyPath: key] },
                                              set: { next in
                                                  patch(id) { item in
                                                      item[keyPath: key] = next
                                                      // Cena i spalanie wpisane ręcznie — jak ręczna wycena w kalkulatorze CRM.
                                                      if item.kind == "fuel" && (key == \OfferLogisticsRow.rate || key == \OfferLogisticsRow.consumption) {
                                                          item.fuel_estimate = Self.manualFuel(item)
                                                      }
                                                  }
                                              }),
                               prompt: "Uzupełnij", nullable: true)
        }
    }

    private func readOnlyLine(_ row: OfferLogisticsRow) -> String {
        let show = { (value: Double?) in value.map(OfferText.number) ?? "—" }
        var line = "\(Self.quantityLabel(row.kind)): \(show(row.quantity)) · \(Self.unitsLabel(row.kind)): \(show(row.units)) · \(Self.rateLabel(row.kind)): \(show(row.rate))"
        if row.kind == "fuel" { line += " · Spalanie: \(show(row.consumption)) l/100 km" }
        if row.kind == "travel" { line += " · Godziny już w pakiecie: \(show(row.included_hours)) h/os." }
        return line
    }

    static func quantityLabel(_ kind: String) -> String {
        switch kind {
        case "fuel": return "Liczba aut"
        case "travel", "meals": return "Liczba osób"
        case "accommodation": return "Liczba pokoi"
        default: return "Ilość"
        }
    }

    static func unitsLabel(_ kind: String) -> String {
        switch kind {
        case "fuel": return "Dystans / auto (km)"
        case "travel": return "Podróż / osobę (h)"
        case "meals": return "Liczba dni"
        case "accommodation": return "Liczba nocy"
        default: return "Mnożnik"
        }
    }

    static func rateLabel(_ kind: String) -> String {
        switch kind {
        case "fuel": return "Cena paliwa (zł/l)"
        case "travel": return "Koszt dla firmy (zł/h/os.)"
        case "meals": return "Budżet netto (zł/os./dzień)"
        case "accommodation": return "Koszt netto (zł/pokój/noc)"
        default: return "Koszt jednostkowy netto (zł)"
        }
    }

    /// Wycena paliwa wpisana ręcznie (rodzaj paliwa z kalkulatora zostaje).
    static func manualFuel(_ row: OfferLogisticsRow) -> JSONValue {
        let type = row.fuel_estimate?.object["fuel_type"]?.text ?? ""
        return .object([
            "fuel_type": .string(type.isEmpty ? "diesel" : type),
            "price": row.rate.map { JSONValue.number($0) } ?? .null,
            "consumption": row.consumption.map { JSONValue.number($0) } ?? .null,
            "price_source": .string("manual"),
            "quote": .null,
        ])
    }

    // MARK: Zmiany

    private func mutate(_ change: (inout OfferLogisticsEstimate) -> Void) {
        guard var estimate = value.estimate else { return }
        change(&estimate)
        value.estimate = estimate
    }

    private func patch(_ id: String, _ change: (inout OfferLogisticsRow) -> Void) {
        mutate { estimate in
            if let index = estimate.rows.firstIndex(where: { $0.id == id }) { change(&estimate.rows[index]) }
        }
    }

    /// Kalkulator ↔ kwota ręczna; kwota ręczna startuje od ostatniej sumy szacunku (jak w CRM).
    private func switchMode(_ calculator: Bool) {
        if calculator {
            guard value.estimate == nil else { return }
            value.estimate = previous ?? .empty()
        } else if let estimate = value.estimate {
            previous = estimate
            value.cost = OfferLogisticsMath.summary(estimate).total
            value.estimate = nil
        }
    }

    private static func validMoney(_ number: Double?) -> Bool {
        guard let number, number.isFinite, number >= 0, number <= 99999999.99 else { return false }
        return abs(number * 100 - (number * 100).rounded()) < 0.00001
    }

    private func save() async {
        problem = nil
        var next = value
        if let estimate = next.estimate {
            let summary = OfferLogisticsMath.summary(estimate)
            guard let total = summary.total, summary.error.isEmpty else {
                problem = summary.error
                return
            }
            next.cost = total
        }
        guard Self.validMoney(next.cost), Self.validMoney(next.price) else {
            problem = "Podaj nieujemny koszt i cenę z maksymalnie dwoma miejscami po przecinku. Wpisz 0, jeśli koszt nie występuje."
            return
        }
        next.description = next.description.trimmingCharacters(in: .whitespacesAndNewlines)
        saving = true
        let failure = await onSave(next)
        saving = false
        if let failure { problem = failure } else { dismiss() }
    }
}
