import SwiftUI
import Charts

// MARK: Centrum finansów — 1:1 z `FinanceCenterPanel.tsx`: kompletność danych, kafle (gotówka, należności, zobowiązania, VAT,
// rezerwa CIT), rachunki, zamknięcie poprzedniego miesiąca, wiekowanie należności i zobowiązań, ZUS i podatki (najbliższe
// 45 dni, szacunek VAT, CIT ze stawką), prognoza 13 tygodni (wykres salda i tygodnie z rozwijanymi pozycjami).
// Kilka wybranych działalności: gotówka, należności, zobowiązania, ZUS i podatki i prognoza są łączone (pozycje z nazwą
// działalności); VAT, CIT i zamknięcie miesiąca — osobno dla każdej działalności.

@MainActor struct FinanceCenterView: View {
    @ObservedObject var store: FinanceStore
    let scope: FinScope
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var openWeek: String?

    private static let green = CrmTheme.rgb(0x4ade80)
    private static let red = CrmTheme.rgb(0xf87171)
    private static let amber = CrmTheme.rgb(0xfbbf24)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                let parts = scope.centers
                if parts.isEmpty {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać Centrum finansów", systemImage: "exclamationmark.triangle")
                    } description: { Text(errorText) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                    }
                    .frame(maxWidth: .infinity, minHeight: 300)
                } else {
                    let model = FinCenterModel(parts, includeOverdueIn: store.includeOverdueIn, includeUnassigned: store.includeUnassigned)
                    ForEach(failedCompanies, id: \.self) { name in
                        FinBanner(text: "\(name): nie udało się wczytać Centrum finansów — pokazuję pozostałe działalności.", tone: .bad)
                    }
                    if !model.quality.isEmpty { quality(model) }
                    tiles(model, parts)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 440), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                        accounts(model)
                        checklist(parts)
                        agingCard(title: "Należności", symbol: "arrow.down.right.circle", aging: model.receivableAging,
                                  top: receivablesTop(model), topLabel: "Największe po terminie",
                                  emptyText: "Brak nieopłaconych faktur sprzedaży.", footer: receivablesFooter(model))
                        agingCard(title: "Zobowiązania", symbol: "arrow.up.right.circle", aging: model.payableAging,
                                  top: payablesTop(model), topLabel: "Do zapłaty w 14 dni i po terminie",
                                  emptyText: "Brak nieopłaconych faktur kosztowych.",
                                  footer: "Faktury kosztowe z KSeF (kwota po zapisanych płatnościach) i nieopłacone dokumenty spoza KSeF. Terminy uzupełnisz w „Terminy i monity”.")
                    }
                    taxes(model, parts)
                    forecast(model)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var failedCompanies: [String] {
        scope.entries.filter { $0.state.center == nil }.map(\.company.name)
    }

    private var errorText: String {
        let messages = scope.entries.compactMap { entry in entry.state.centerError.map { scope.multi ? "\(entry.company.name): \($0)" : $0 } }
        return messages.isEmpty ? "Brak danych." : messages.joined(separator: "\n")
    }

    // MARK: Kompletność danych

    private func quality(_ model: FinCenterModel) -> some View {
        FinCard("Kompletność danych — liczby poniżej są tak dobre, jak te dane", symbol: "exclamationmark.triangle") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(model.quality, id: \.id) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: item.level == "info" ? "info.circle" : "exclamationmark.triangle.fill")
                            .foregroundStyle(item.level == "error" ? Self.red : item.level == "warning" ? Self.amber : Color.secondary)
                        Text(item.text)
                            .foregroundStyle(item.level == "error" ? Self.red : item.level == "warning" ? Color.primary : Color.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        if item.key == "upo_missing", let company = item.company {
                            Button("Pobierz UPO") { Task { await store.fetchMissingUpo(company: company) } }
                                .controlSize(.small).fixedSize().disabled(!state.canWrite)
                                .help("Pobiera z KSeF do 10 brakujących UPO na jedno kliknięcie")
                        } else {
                            Button("Przejdź") { store.open(FinLink.section(item.tab, item.section)) }.controlSize(.small).fixedSize()
                        }
                    }
                    .font(.callout)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
        }
    }

    // MARK: Kafle

    private func tiles(_ model: FinCenterModel, _ parts: [FinCompanyCenter]) -> some View {
        let vats = parts.compactMap { part in FinCenterModel.vat(part.center).current.map { (part.company.name, $0) } }
        let vatValue: String = vats.isEmpty ? "—" : FinFormat.money(vats.reduce(0) { $0 + max($1.1.estimate, 0) })
        let vatHint: String = {
            guard let first = vats.first else { return "brak obowiązku VAT miesięcznego" }
            if vats.count == 1 && parts.count == 1 {
                let vat = first.1
                return vat.estimate < 0 ? "nadwyżka \(FinFormat.money(-vat.estimate)) — \(FinFormat.monthLabel(vat.periodStart))" : FinFormat.monthLabel(vat.periodStart)
            }
            return "\(FinFormat.monthLabel(first.1.periodStart)) · " + vats.map { "\($0.0) \(FinFormat.money(max($0.1.estimate, 0)))" }.joined(separator: ", ")
        }()
        let reserves = parts.compactMap { $0.center.cit.reserve }
        let citValue = reserves.isEmpty ? "—" : FinFormat.money(reserves.reduce(0, +))
        let citHint: String = {
            if parts.count == 1, let rate = parts[0].center.cit.rate { return "orientacyjnie, \(Int(rate))% od wyniku" }
            if parts.count == 1 { return "ustaw stawkę CIT w sekcji podatków" }
            let missing = parts.filter { $0.center.cit.rate == nil }.map(\.company.name)
            return missing.isEmpty ? "orientacyjnie, suma działalności" : "bez stawki CIT: " + missing.joined(separator: ", ")
        }()
        var cashHint = model.cashAsOf.map { "saldo z wyciągów na \(FinFormat.day($0))" } ?? "brak wyciągów"
        if !model.withoutStatements.isEmpty && parts.count > 1 { cashHint += " · bez wyciągów: " + model.withoutStatements.joined(separator: ", ") }
        let payableHint = "po terminie \(FinFormat.money(model.payableAging.overdue)) · bez terminu \(model.payableAging.sum(.noDue).count)"
        let year = Int(parts.first?.center.cit.year ?? 0)
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
            FinTile(symbol: "wallet.pass", label: "Gotówka na rachunkach", value: FinFormat.money(model.cashTotal), hint: cashHint,
                    warn: (model.cashDaysOld ?? 0) > 35 || (parts.count > 1 && !model.withoutStatements.isEmpty))
            FinTile(symbol: "arrow.down.right.circle", label: "Należności", value: FinFormat.money(model.receivableAging.total),
                    hint: "po terminie \(FinFormat.money(model.receivableAging.overdue))", warn: model.receivableAging.overdue > 0)
            FinTile(symbol: "arrow.up.right.circle", label: "Zobowiązania", value: FinFormat.money(model.payableAging.total),
                    hint: payableHint, warn: model.payableAging.overdue > 0)
            FinTile(symbol: "building.columns", label: "VAT — szacunek", value: vatValue, hint: vatHint)
            FinTile(symbol: "banknote", label: "Rezerwa CIT \(year)", value: citValue, hint: citHint)
        }
    }

    // MARK: Rachunki i zamknięcie miesiąca

    private func accounts(_ model: FinCenterModel) -> some View {
        var note = "Saldo końcowe ostatniego wyciągu każdego rachunku. Operacji po tej dacie CRM nie zna — prognoza zaczyna się od tego salda."
        if !model.withoutStatements.isEmpty && scope.multi {
            note += " Bez wyciągów (poza saldem): " + model.withoutStatements.joined(separator: ", ") + "."
        }
        return FinCard("Rachunki", symbol: "wallet.pass", note: note) {
            if model.accounts.isEmpty {
                Text("Brak wczytanych wyciągów.").foregroundStyle(.secondary).padding(14)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    FinanceListHeader(columns: [("Rachunek", nil, .leading), ("Saldo na dzień", 100, .leading), ("Saldo", 140, .trailing)])
                    ForEach(model.accounts) { account in
                        HStack(spacing: 10) {
                            Text(account.label).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(FinFormat.day(account.asOf)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).frame(width: 100, alignment: .leading)
                            Text(account.balance.map { FinFormat.money($0, account.currency) } ?? "brak salda").monospacedDigit().lineLimit(1)
                                .frame(width: 140, alignment: .trailing)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        Divider().opacity(0.4)
                    }
                }
                .padding(.horizontal, 6).padding(.vertical, 6)
            }
        } accessory: {
            Button("Wyciągi") { store.open(FinLink.section("external", "statements")) }.controlSize(.small).fixedSize()
                .help("Wczytywanie wyciągów — w CRM")
        }
    }

    private func checklistTitle(_ center: FinCenter) -> String {
        let month = Int(center.checklist.periodMonth)
        return (1...12).contains(month) ? "\(FinFormat.months[month - 1]) \(Int(center.checklist.periodYear))" : ""
    }

    private func checklist(_ parts: [FinCompanyCenter]) -> some View {
        let first = parts.first.map { checklistTitle($0.center) } ?? ""
        return FinCard(first.isEmpty ? "Zamknięcie miesiąca" : "Zamknięcie miesiąca: \(first)", symbol: "checkmark.circle") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(parts) { part in
                    if parts.count > 1 {
                        Text(part.company.name.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 2)
                    }
                    ForEach(part.center.checklist.items, id: \.key) { item in
                        checkRow(item)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func checkRow(_ item: FinCenter.CheckItem) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: item.done == true ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.done == nil ? Color.secondary.opacity(0.5) : item.done == true ? Self.green : Self.amber)
                (Text(item.label).foregroundColor(item.done == true ? Color.secondary : Color.primary)
                 + Text(item.detail.map { " — \($0)" } ?? "").foregroundColor(Color.secondary))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                if item.done == false {
                    Button("Przejdź") {
                        // „Miesiąc zamknięty” — Zamknięcie miesięcy; „Przekazany księgowej” — Przekazanie księgowej (w CRM obie w „Dla księgowej”).
                        if item.key == "locked" { store.part = .periods } else { store.open(FinLink.section(item.tab, item.section)) }
                    }
                    .controlSize(.small).fixedSize()
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            Divider().opacity(0.4)
        }
    }

    // MARK: Wiekowanie

    /// Największe należności po terminie (do 6).
    private func receivablesTop(_ model: FinCenterModel) -> [FinCenter.Item] {
        let late = model.receivables.filter { $0.overdueDays > 0 }
        return Array(late.sorted { $0.amount > $1.amount }.prefix(6))
    }

    /// Zobowiązania z terminem do 14 dni i po terminie, od najwcześniejszego (do 6).
    private func payablesTop(_ model: FinCenterModel) -> [FinCenter.Item] {
        let soon = model.payables.filter { item in
            guard let due = item.dueDate else { return false }
            return FinFormat.daysBetween(model.today, due) <= 14
        }
        return Array(soon.sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }.prefix(6))
    }

    private func receivablesFooter(_ model: FinCenterModel) -> String {
        if model.conflicts.isEmpty {
            return "Faktury CRM (bez pro form) i faktury sprzedaży wystawione tylko w KSeF; zapłata z uzgodnienia wyciągów."
        }
        let total = model.conflicts.reduce(0) { $0 + $1.amount }
        return "Poza sumą: \(model.conflicts.count) faktur CRM zapłaconych według KSeF (\(FinFormat.money(total))) — do wyjaśnienia."
    }

    private func agingCard(title: String, symbol: String, aging: FinAging, top: [FinCenter.Item], topLabel: String,
                           emptyText: String, footer: String) -> some View {
        let maxAmount = max(1, FinBucket.allCases.map { aging.sum($0).amount }.max() ?? 0)
        return FinCard(title, symbol: symbol, note: footer) {
            VStack(alignment: .leading, spacing: 0) {
                if aging.total <= 0 {
                    Text(emptyText).foregroundStyle(.secondary).padding(14)
                } else {
                    VStack(spacing: 6) {
                        ForEach(FinBucket.allCases) { bucket in
                            let sum = aging.sum(bucket)
                            HStack(spacing: 8) {
                                Text(bucket.label).foregroundStyle(.secondary).lineLimit(1).frame(width: 140, alignment: .leading)
                                FinBar(fraction: sum.amount / maxAmount,
                                       color: bucket.late ? Self.red.opacity(0.75) : bucket == .noDue ? Self.amber.opacity(0.65) : theme.accent.opacity(0.75))
                                Text(FinFormat.money(sum.amount)).monospacedDigit().lineLimit(1).frame(width: 120, alignment: .trailing)
                                Text("\(sum.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
                            }
                            .font(.callout)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
                if !top.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 5) {
                        Text(topLabel.uppercased()).font(.caption2).foregroundStyle(.secondary)
                        ForEach(Array(top.enumerated()), id: \.offset) { entry in
                            topRow(entry.element)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                }
            }
        } accessory: {
            Text(FinFormat.money(aging.total)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).fixedSize()
        }
    }

    private func topRow(_ item: FinCenter.Item) -> some View {
        let overdue = item.overdueDays
        let when = overdue > 0 ? "\(overdue) dni po terminie" : item.dueDate.map { "termin \(FinFormat.day($0))" } ?? "bez terminu"
        let who = [scope.label(item.company), item.counterparty].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                if let href = FinLink.item(item) {
                    Button(item.label ?? "—") { store.open(href) }.buttonStyle(.link).lineLimit(1)
                } else {
                    Text(item.label ?? "—").lineLimit(1)
                }
                if !who.isEmpty { Text(who).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(when).font(.caption).foregroundStyle(overdue > 0 ? Self.red : Color.secondary).lineLimit(1).fixedSize()
            Text(FinFormat.money(item.amount, item.currency)).monospacedDigit().lineLimit(1).fixedSize()
        }
        .font(.callout)
    }

    // MARK: ZUS i podatki

    private func taxes(_ model: FinCenterModel, _ parts: [FinCompanyCenter]) -> some View {
        FinCard("ZUS i podatki", symbol: "building.columns") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 20, alignment: .top)], alignment: .leading, spacing: 16) {
                upcoming(model)
                vatColumn(parts)
                citColumn(parts)
            }
            .padding(14)
        } accessory: {
            Button("Kalendarz obowiązków") { store.part = .deadlines; store.list = .obligations }.controlSize(.small).fixedSize()
        }
    }

    private func upcoming(_ model: FinCenterModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NAJBLIŻSZE 45 DNI").font(.caption2).foregroundStyle(.secondary)
            if model.upcomingObligations.isEmpty {
                Text("Brak niezapłaconych obowiązków w najbliższych 45 dniach.").foregroundStyle(.secondary).font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(model.upcomingObligations, id: \.key) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(FinFormat.dayMonth(item.dueDate)).monospacedDigit().foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
                        Text(item.label).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                        Text(item.amount.map { (item.estimated ? "~" : "") + FinFormat.money($0) } ?? "kwota nieznana")
                            .monospacedDigit().lineLimit(1).fixedSize()
                            .foregroundStyle(item.amount == nil ? Color.secondary : Color.primary)
                    }
                    .font(.callout)
                }
            }
            if !model.overdueObligations.isEmpty {
                Text("Po terminie lub bez potwierdzenia zapłaty: \(model.overdueObligations.count) — szczegóły w kalendarzu obowiązków.")
                    .font(.caption).foregroundStyle(Self.amber).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func vatColumn(_ parts: [FinCompanyCenter]) -> some View {
        let foreign = parts.reduce(0.0) { total, part in
            let vat = FinCenterModel.vat(part.center)
            return total + (vat.current?.foreignCount ?? 0) + (vat.previous?.foreignCount ?? 0)
        }
        return VStack(alignment: .leading, spacing: 8) {
            Text("VAT (SZACUNEK Z FAKTUR)").font(.caption2).foregroundStyle(.secondary)
            ForEach(parts) { part in
                VStack(alignment: .leading, spacing: 6) {
                    if parts.count > 1 { Text(part.company.name).font(.callout.weight(.semibold)) }
                    if part.center.vat == nil {
                        Text("Działalność nie ma włączonego VAT miesięcznego w obowiązkach.").foregroundStyle(.secondary).font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        let vat = FinCenterModel.vat(part.center)
                        ForEach([vat.previous, vat.current].compactMap { $0 }, id: \.periodStart) { month in vatRow(month) }
                    }
                }
            }
            Text("Według daty wystawienia faktur w PLN; nadwyżka naliczonego przechodzi na kolejny miesiąc. Kwotę deklaracji ustala biuro." + (foreign > 0 ? " Faktury w walutach obcych pominięte." : ""))
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Miesiąc VAT: do zapłaty (albo nadwyżka) w wierszu nazwy, pod spodem należny i naliczony oraz termin, deklaracja, zapłata.
    private func vatRow(_ month: FinCenter.VatMonth) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(FinFormat.monthLabel(month.periodStart)).lineLimit(1)
                Spacer(minLength: 8)
                if month.estimate < 0 {
                    Text("nadwyżka \(FinFormat.money(-month.estimate))").foregroundStyle(Self.green).lineLimit(1).fixedSize()
                } else {
                    Text("do zapłaty \(FinFormat.money(month.estimate))").fontWeight(.semibold).lineLimit(1).fixedSize()
                }
            }
            .font(.callout).monospacedDigit()
            Text("należny \(FinFormat.money(month.outputVat)) · naliczony \(FinFormat.money(month.inputVat))" + (month.carried > 0 ? " + nadwyżka \(FinFormat.money(month.carried))" : ""))
                .font(.caption).monospacedDigit().foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            let detail = vatDetail(month)
            if !detail.isEmpty {
                Text(detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func vatDetail(_ month: FinCenter.VatMonth) -> String {
        var parts: [String] = []
        if let due = month.dueDate { parts.append("termin \(FinFormat.day(due))") }
        if let declared = month.declared { parts.append("deklaracja \(FinFormat.money(declared))") }
        if month.paid > 0 { parts.append("zapłacono \(FinFormat.money(month.paid))") }
        return parts.joined(separator: " · ")
    }

    private func citColumn(_ parts: [FinCompanyCenter]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parts) { part in citBlock(part, showName: parts.count > 1) }
            Text("Bez wynagrodzeń, ZUS, amortyzacji i kosztów niestanowiących kosztu podatkowego — rezerwa jest ostrożna (raczej zawyżona). Kwotę zaliczki ustala biuro rachunkowe.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func citBlock(_ part: FinCompanyCenter, showName: Bool) -> some View {
        let center = part.center
        let cit = center.cit
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text((showName ? "\(part.company.name) — " : "") + "CIT \(Int(cit.year)) — orientacyjnie").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 6)
                if center.canManage {
                    Picker("Stawka CIT", selection: Binding(get: { Int(center.citRate ?? -1) }, set: { value in saveRate(part.company.id, value) })) {
                        Text("stawka: nie ustawiono").tag(-1)
                        Text("9% (mały podatnik)").tag(9)
                        Text("19%").tag(19)
                    }
                    .labelsHidden().controlSize(.small).fixedSize()
                    .disabled(!state.canWrite)
                }
            }
            citRow("Przychody netto z faktur", FinFormat.money(cit.revenueNet))
            citRow("Koszty netto z faktur", FinFormat.money(cit.costsNet))
            citRow("Wynik", FinFormat.money(cit.result), strong: true)
            citRow(cit.rate.map { "Podatek \(Int($0))%" } ?? "Podatek", cit.tax.map { FinFormat.money($0) } ?? "—")
            citRow("Zaliczki zapłacone w roku", FinFormat.money(cit.paid))
            citRow("Rezerwa", cit.reserve.map { FinFormat.money($0) } ?? "—", strong: true)
        }
    }

    private func citRow(_ label: String, _ value: String, strong: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 6)
            Text(value).monospacedDigit().fontWeight(strong ? .semibold : .regular).lineLimit(1).fixedSize()
        }
        .font(.callout)
    }

    private func saveRate(_ companyID: String, _ value: Int) {
        let rate: JSONValue = value < 0 ? .null : .number(Double(value))
        Task { await store.run("Zapisywanie stawki CIT…", "taxRate", ["companyId": .string(companyID), "rate": rate]) }
    }

    // MARK: Prognoza 13 tygodni

    private struct Point: Identifiable {
        let id: Int
        let label: String
        let balance: Double
    }

    private func forecast(_ model: FinCenterModel) -> some View {
        let points: [Point] = [Point(id: -1, label: "teraz", balance: model.start)]
            + model.weeks.map { week in Point(id: week.index, label: FinFormat.dayMonth(week.start), balance: model.balances[week.index]) }
        return FinCard("Prognoza 13 tygodni", symbol: "chart.line.uptrend.xyaxis") {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Licz zaległe wpływy (\(FinFormat.short(model.overdueInflows)))", isOn: $store.includeOverdueIn).lineLimit(1)
                    Toggle("Licz ZUS i podatki bez przypisanej zapłaty (\(FinFormat.short(model.overdueUnassigned)))", isOn: $store.includeUnassigned).lineLimit(1)
                }
                .toggleStyle(.checkbox).font(.callout)
                .padding(.horizontal, 14).padding(.top, 10)
                if let negative = model.firstNegative, model.weeks.indices.contains(negative) {
                    FinBanner(text: "Saldo spada poniżej zera w tygodniu od \(FinFormat.dayMonth(model.weeks[negative].start)) (najniżej \(FinFormat.money(model.lowestValue))).", tone: .bad)
                        .padding(.horizontal, 14).padding(.top, 10)
                } else {
                    let week = model.lowestIndex >= 0 && model.weeks.indices.contains(model.lowestIndex) ? " (tydzień od \(FinFormat.dayMonth(model.weeks[model.lowestIndex].start)))" : ""
                    Text("Najniższe saldo w horyzoncie: \(FinFormat.money(model.lowestValue))\(week).")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14).padding(.top, 10)
                }
                Chart {
                    ForEach(points) { point in
                        LineMark(x: .value("Tydzień", point.label), y: .value("Saldo", point.balance))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(theme.accent)
                        PointMark(x: .value("Tydzień", point.label), y: .value("Saldo", point.balance))
                            .foregroundStyle(point.balance < 0 ? Self.red : theme.accent)
                    }
                    RuleMark(y: .value("Zero", 0.0))
                        .foregroundStyle(Self.red.opacity(0.45))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                }
                .chartYAxis { AxisMarks { value in AxisGridLine(); AxisValueLabel { if let amount = value.as(Double.self) { Text(FinFormat.short(amount)) } } } }
                .frame(height: 170)
                .padding(.horizontal, 14).padding(.vertical, 10)
                Divider()
                forecastTable(model)
            }
        }
    }

    private func forecastTable(_ model: FinCenterModel) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            FinanceListHeader(columns: [("Tydzień", nil, .leading), ("Wpływy", 120, .trailing), ("Wydatki", 130, .trailing), ("", 100, .leading), ("Saldo na koniec", 130, .trailing)])
                .padding(.horizontal, 6)
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Saldo z wyciągów" + (model.cashAsOf.map { " na \(FinFormat.day($0))" } ?? "")).lineLimit(1)
                    if let old = model.cashDaysOld, old > 10 {
                        Text("sprzed \(Int(old)) dni; wpływy i wydatki od tej daty liczone z terminów.").font(.caption).foregroundStyle(Self.amber)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(minWidth: 160, maxWidth: .infinity, alignment: .leading)
                Text(FinFormat.money(model.opening)).monospacedDigit().lineLimit(1).frame(width: 130, alignment: .trailing)
            }
            .font(.callout)
            .padding(.horizontal, 14).padding(.vertical, 6)
            Divider().opacity(0.4)
            weekRow(key: "overdue", label: "Termin minął (również od ostatniego wyciągu)", inflows: model.overdueInflows,
                    outflows: model.overdueOutflows + model.overdueUnassigned,
                    inflowsNote: store.includeOverdueIn ? nil : "nieliczone",
                    outflowsNote: !store.includeUnassigned && model.overdueUnassigned > 0 ? "w tym \(FinFormat.short(model.overdueUnassigned)) nieliczone" : nil,
                    balance: model.start, flows: model.overdueFlows, maxFlow: model.maxFlow, bars: false)
            ForEach(model.weeks) { week in
                weekRow(key: "w\(week.index)", label: "\(FinFormat.dayMonth(week.start))–\(FinFormat.dayMonth(week.end))",
                        inflows: week.inflows, outflows: week.outflows, inflowsNote: nil, outflowsNote: nil,
                        balance: model.balances[week.index], flows: week.flows, maxFlow: model.maxFlow, bars: true)
            }
            weekRow(key: "undated", label: "Bez terminu (poza saldem)", inflows: model.undatedInflows, outflows: model.undatedOutflows,
                    inflowsNote: nil, outflowsNote: nil, balance: nil, flows: model.undatedFlows, maxFlow: model.maxFlow, bars: false)
            VStack(alignment: .leading, spacing: 4) {
                Text("Wpływy: należności, pro formy i harmonogramy płatności eventów bez faktury. Wydatki: faktury kosztowe, umowy stałe, wynagrodzenia z umów personelu (do 10. następnego miesiąca) oraz ZUS i podatki (kwota z deklaracji, bez niej — szacunek VAT albo ostatnia zapłata; „~” = szacunek). Tylko kwoty w PLN.")
                if scope.multi {
                    Text("Wybrane działalności razem: saldo to suma rachunków, a wpływy i wydatki — pozycje wszystkich wybranych działalności.")
                }
                if !model.unknownObligations.isEmpty {
                    Text("Bez kwoty (poza prognozą): " + model.unknownObligations.map { "\($0.label) (\(FinFormat.day($0.dueDate)))" }.joined(separator: ", ") + ".")
                }
                if !model.foreign.isEmpty {
                    Text("Poza prognozą: \(model.foreign.count) pozycji w walutach obcych.")
                }
            }
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
        }
    }

    private func weekRow(key: String, label: String, inflows: Double, outflows: Double, inflowsNote: String?, outflowsNote: String?,
                         balance: Double?, flows: [FinFlow], maxFlow: Double, bars: Bool) -> some View {
        let open = openWeek == key
        let sorted = flows.sorted { left, right in
            let leftDue = left.dueDate ?? ""
            let rightDue = right.dueDate ?? ""
            return leftDue == rightDue ? left.amount > right.amount : leftDue < rightDue
        }
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                guard !flows.isEmpty else { return }
                withAnimation(.easeInOut(duration: 0.15)) { openWeek = open ? nil : key }
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    HStack(spacing: 4) {
                        Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption2)
                            .foregroundStyle(.secondary).opacity(flows.isEmpty ? 0 : 1)
                        Text(label).lineLimit(2)
                        if !flows.isEmpty { Text("(\(flows.count))").font(.caption).foregroundStyle(.secondary).fixedSize() }
                    }
                    .frame(minWidth: 160, maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(inflows > 0 ? FinFormat.money(inflows) : "—").foregroundStyle(inflows > 0 ? Self.green : Color.secondary).lineLimit(1)
                        if let inflowsNote, inflows > 0 { Text(inflowsNote).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    .frame(width: 120, alignment: .trailing)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(outflows > 0 ? FinFormat.money(outflows) : "—").foregroundStyle(outflows > 0 ? Self.red : Color.secondary).lineLimit(1)
                        if let outflowsNote { Text(outflowsNote).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8) }
                    }
                    .frame(width: 130, alignment: .trailing)
                    VStack(spacing: 3) {
                        if bars {
                            FinBar(fraction: inflows / maxFlow, color: Self.green.opacity(0.6), height: 5)
                            FinBar(fraction: outflows / maxFlow, color: Self.red.opacity(0.6), height: 5)
                        }
                    }
                    .frame(width: 100)
                    Text(balance.map { FinFormat.money($0) } ?? "").fontWeight(.semibold).lineLimit(1)
                        .foregroundStyle((balance ?? 0) < 0 ? Self.red : Color.primary)
                        .frame(width: 130, alignment: .trailing)
                }
                .font(.callout).monospacedDigit()
                .padding(.horizontal, 14).padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(sorted) { flow in flowRow(flow) }
                    HStack {
                        Spacer()
                        Button("Terminy i monity →") { store.part = .deadlines }.buttonStyle(.link).font(.caption)
                    }
                }
                .padding(.leading, 34).padding(.trailing, 14).padding(.vertical, 6)
                .background(Color.primary.opacity(0.03))
            }
            Divider().opacity(0.4)
        }
    }

    private func flowRow(_ flow: FinFlow) -> some View {
        var details: [String] = []
        if let company = flow.companyName { details.append(company) }
        details.append(flow.kindLabel)
        if let counterparty = flow.counterparty, !counterparty.isEmpty { details.append(counterparty) }
        if flow.estimated { details.append("szacunek") }
        if flow.unassigned { details.append("bez przypisanej zapłaty") }
        return HStack(alignment: .top, spacing: 8) {
            Text(flow.dueDate.map { FinFormat.dayMonth($0) } ?? "—").font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                if let href = flow.href {
                    Button(flow.label) { store.open(href) }.buttonStyle(.link).lineLimit(1)
                } else {
                    Text(flow.label).lineLimit(1)
                }
                Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text((flow.incoming ? "+" : "−") + (flow.estimated ? "~" : "") + FinFormat.money(flow.amount))
                .monospacedDigit().lineLimit(1).fixedSize().foregroundStyle(flow.incoming ? Self.green : Self.red)
        }
        .font(.callout)
    }
}
