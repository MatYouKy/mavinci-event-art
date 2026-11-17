import SwiftUI
import Charts

// MARK: Centrum finansów — 1:1 z `FinanceCenterPanel.tsx`: kompletność danych, kafle (gotówka, należności, zobowiązania, VAT,
// rezerwa CIT), rachunki, zamknięcie poprzedniego miesiąca, wiekowanie należności i zobowiązań, ZUS i podatki (najbliższe
// 45 dni, szacunek VAT, CIT ze stawką), prognoza 13 tygodni (wykres salda i tygodnie z rozwijanymi pozycjami).

@MainActor struct FinanceCenterView: View {
    @ObservedObject var store: FinanceStore
    let data: FinState
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var openWeek: String?

    private static let green = CrmTheme.rgb(0x4ade80)
    private static let red = CrmTheme.rgb(0xf87171)
    private static let amber = CrmTheme.rgb(0xfbbf24)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let center = data.center {
                    let model = FinCenterModel(center, includeOverdueIn: store.includeOverdueIn, includeUnassigned: store.includeUnassigned)
                    if !center.quality.isEmpty { quality(center) }
                    tiles(center, model)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 440), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                        accounts(center)
                        checklist(center)
                        agingCard(title: "Należności", symbol: "arrow.down.right.circle", aging: model.receivableAging,
                                  top: receivablesTop(model), topLabel: "Największe po terminie",
                                  emptyText: "Brak nieopłaconych faktur sprzedaży.", footer: receivablesFooter(model))
                        agingCard(title: "Zobowiązania", symbol: "arrow.up.right.circle", aging: model.payableAging,
                                  top: payablesTop(model), topLabel: "Do zapłaty w 14 dni i po terminie",
                                  emptyText: "Brak nieopłaconych faktur kosztowych.",
                                  footer: "Faktury kosztowe z KSeF (kwota po zapisanych płatnościach) i nieopłacone dokumenty spoza KSeF. Terminy uzupełnisz w „Terminy i monity”.")
                    }
                    taxes(center, model)
                    forecast(center, model)
                } else {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać Centrum finansów", systemImage: "exclamationmark.triangle")
                    } description: { Text(data.centerError ?? "Brak danych.") } actions: {
                        Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                    }
                    .frame(maxWidth: .infinity, minHeight: 300)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Kompletność danych

    private func quality(_ center: FinCenter) -> some View {
        FinCard("Kompletność danych — liczby poniżej są tak dobre, jak te dane", symbol: "exclamationmark.triangle") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(center.quality, id: \.key) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: item.level == "info" ? "info.circle" : "exclamationmark.triangle.fill")
                            .foregroundStyle(item.level == "error" ? Self.red : item.level == "warning" ? Self.amber : Color.secondary)
                        Text(item.text)
                            .foregroundStyle(item.level == "error" ? Self.red : item.level == "warning" ? Color.primary : Color.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        if item.key == "upo_missing" {
                            Button("Pobierz UPO") { Task { await store.fetchMissingUpo() } }
                                .controlSize(.small).disabled(!state.canWrite)
                                .help("Pobiera z KSeF do 10 brakujących UPO na jedno kliknięcie")
                        } else {
                            Button("Przejdź") { store.open(FinLink.section(item.tab, item.section)) }.controlSize(.small)
                        }
                    }
                    .font(.callout)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
        }
    }

    // MARK: Kafle

    private func tiles(_ center: FinCenter, _ model: FinCenterModel) -> some View {
        let vat = model.vatCurrent
        let vatHint: String = {
            guard let vat else { return "brak obowiązku VAT miesięcznego" }
            return vat.estimate < 0 ? "nadwyżka \(FinFormat.money(-vat.estimate)) — \(FinFormat.monthLabel(vat.periodStart))" : FinFormat.monthLabel(vat.periodStart)
        }()
        let cashHint = center.cash.asOf.map { "saldo z wyciągów na \(FinFormat.day($0))" } ?? "brak wyciągów"
        let payableHint = "po terminie \(FinFormat.money(model.payableAging.overdue)) · bez terminu \(model.payableAging.sum(.noDue).count)"
        let citHint = center.cit.rate.map { "orientacyjnie, \(Int($0))% od wyniku" } ?? "ustaw stawkę CIT w sekcji podatków"
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
            FinTile(symbol: "wallet.pass", label: "Gotówka na rachunkach", value: FinFormat.money(center.cash.total), hint: cashHint,
                    warn: (center.cash.daysOld ?? 0) > 35)
            FinTile(symbol: "arrow.down.right.circle", label: "Należności", value: FinFormat.money(model.receivableAging.total),
                    hint: "po terminie \(FinFormat.money(model.receivableAging.overdue))", warn: model.receivableAging.overdue > 0)
            FinTile(symbol: "arrow.up.right.circle", label: "Zobowiązania", value: FinFormat.money(model.payableAging.total),
                    hint: payableHint, warn: model.payableAging.overdue > 0)
            FinTile(symbol: "building.columns", label: "VAT — szacunek", value: vat.map { FinFormat.money(max($0.estimate, 0)) } ?? "—", hint: vatHint)
            FinTile(symbol: "banknote", label: "Rezerwa CIT \(Int(center.cit.year))", value: center.cit.reserve.map { FinFormat.money($0) } ?? "—", hint: citHint)
        }
    }

    // MARK: Rachunki i zamknięcie miesiąca

    private func accounts(_ center: FinCenter) -> some View {
        FinCard("Rachunki", symbol: "wallet.pass",
                note: "Saldo końcowe ostatniego wyciągu każdego rachunku. Operacji po tej dacie CRM nie zna — prognoza zaczyna się od tego salda.") {
            if center.cash.accounts.isEmpty {
                Text("Brak wczytanych wyciągów.").foregroundStyle(.secondary).padding(14)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    FinanceListHeader(columns: [("Rachunek", nil, .leading), ("Saldo na dzień", 110, .leading), ("Saldo", 150, .trailing)])
                    ForEach(center.cash.accounts) { account in
                        HStack(spacing: 10) {
                            Text(account.label).frame(maxWidth: .infinity, alignment: .leading)
                            Text(FinFormat.day(account.asOf)).monospacedDigit().foregroundStyle(.secondary).frame(width: 110, alignment: .leading)
                            Text(account.balance.map { FinFormat.money($0, account.currency) } ?? "brak salda").monospacedDigit()
                                .frame(width: 150, alignment: .trailing)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        Divider().opacity(0.4)
                    }
                }
                .padding(.horizontal, 6).padding(.vertical, 6)
            }
        } accessory: {
            Button("Wyciągi") { store.open(FinLink.section("external", "statements")) }.controlSize(.small)
                .help("Wczytywanie wyciągów — w CRM")
        }
    }

    private func checklist(_ center: FinCenter) -> some View {
        let month = Int(center.checklist.periodMonth)
        let title = (1...12).contains(month) ? "Zamknięcie miesiąca: \(FinFormat.months[month - 1]) \(Int(center.checklist.periodYear))" : "Zamknięcie miesiąca"
        return FinCard(title, symbol: "checkmark.circle") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(center.checklist.items, id: \.key) { item in
                    HStack(spacing: 8) {
                        Image(systemName: item.done == true ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(item.done == nil ? Color.secondary.opacity(0.5) : item.done == true ? Self.green : Self.amber)
                        (Text(item.label).foregroundColor(item.done == true ? Color.secondary : Color.primary)
                         + Text(item.detail.map { " — \($0)" } ?? "").foregroundColor(Color.secondary))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        if item.done == false {
                            Button("Przejdź") { store.open(FinLink.section(item.tab, item.section)) }.controlSize(.small)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    Divider().opacity(0.4)
                }
            }
            .padding(.vertical, 4)
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
                                Text(bucket.label).foregroundStyle(.secondary).frame(width: 150, alignment: .leading)
                                FinBar(fraction: sum.amount / maxAmount,
                                       color: bucket.late ? Self.red.opacity(0.75) : bucket == .noDue ? Self.amber.opacity(0.65) : theme.accent.opacity(0.75))
                                Text(FinFormat.money(sum.amount)).monospacedDigit().frame(width: 130, alignment: .trailing)
                                Text("\(sum.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
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
            Text(FinFormat.money(aging.total)).monospacedDigit().foregroundStyle(.secondary)
        }
    }

    private func topRow(_ item: FinCenter.Item) -> some View {
        let overdue = item.overdueDays
        let when = overdue > 0 ? "\(overdue) dni po terminie" : item.dueDate.map { "termin \(FinFormat.day($0))" } ?? "bez terminu"
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let href = FinLink.item(item) {
                Button(item.label ?? "—") { store.open(href) }.buttonStyle(.link).lineLimit(1)
            } else {
                Text(item.label ?? "—").lineLimit(1)
            }
            Text(item.counterparty ?? "").foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 6)
            Text(when).font(.caption).foregroundStyle(overdue > 0 ? Self.red : Color.secondary)
            Text(FinFormat.money(item.amount, item.currency)).monospacedDigit().frame(width: 130, alignment: .trailing)
        }
        .font(.callout)
    }

    // MARK: ZUS i podatki

    private func taxes(_ center: FinCenter, _ model: FinCenterModel) -> some View {
        FinCard("ZUS i podatki", symbol: "building.columns") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 18, alignment: .top)], alignment: .leading, spacing: 14) {
                upcoming(model)
                vat(center, model)
                cit(center)
            }
            .padding(14)
        } accessory: {
            Button("Kalendarz obowiązków") { store.part = .deadlines; store.list = .obligations }.controlSize(.small)
        }
    }

    private func upcoming(_ model: FinCenterModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NAJBLIŻSZE 45 DNI").font(.caption2).foregroundStyle(.secondary)
            if model.upcomingObligations.isEmpty {
                Text("Brak niezapłaconych obowiązków w najbliższych 45 dniach.").foregroundStyle(.secondary).font(.callout)
            } else {
                ForEach(model.upcomingObligations, id: \.key) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(FinFormat.dayMonth(item.dueDate)).monospacedDigit().foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
                        Text(item.label).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 6)
                        Text(item.amount.map { (item.estimated ? "~" : "") + FinFormat.money($0) } ?? "kwota nieznana")
                            .monospacedDigit().foregroundStyle(item.amount == nil ? Color.secondary : Color.primary)
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

    private func vat(_ center: FinCenter, _ model: FinCenterModel) -> some View {
        let months = [model.vatPrevious, model.vatCurrent].compactMap { $0 }
        let foreign = (model.vatCurrent?.foreignCount ?? 0) + (model.vatPrevious?.foreignCount ?? 0)
        return VStack(alignment: .leading, spacing: 6) {
            Text("VAT (SZACUNEK Z FAKTUR)").font(.caption2).foregroundStyle(.secondary)
            if center.vat == nil {
                Text("Działalność nie ma włączonego VAT miesięcznego w obowiązkach.").foregroundStyle(.secondary).font(.callout)
            } else {
                FinanceListHeader(columns: [("Miesiąc", nil, .leading), ("Należny", 90, .trailing), ("Naliczony", 90, .trailing), ("Do zapłaty", 100, .trailing)])
                ForEach(months, id: \.periodStart) { month in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(FinFormat.monthLabel(month.periodStart))
                            Text(vatDetail(month)).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(FinFormat.money(month.outputVat)).frame(width: 90, alignment: .trailing)
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(FinFormat.money(month.inputVat))
                            if month.carried > 0 { Text("+ nadwyżka \(FinFormat.money(month.carried))").font(.caption2).foregroundStyle(.secondary) }
                        }
                        .frame(width: 90, alignment: .trailing)
                        Group {
                            if month.estimate < 0 {
                                Text("nadwyżka \(FinFormat.money(-month.estimate))").foregroundStyle(Self.green)
                            } else {
                                Text(FinFormat.money(month.estimate)).fontWeight(.semibold)
                            }
                        }
                        .frame(width: 100, alignment: .trailing)
                    }
                    .font(.callout).monospacedDigit()
                    .padding(.horizontal, 8)
                }
            }
            Text("Według daty wystawienia faktur w PLN; nadwyżka naliczonego przechodzi na kolejny miesiąc. Kwotę deklaracji ustala biuro." + (foreign > 0 ? " Faktury w walutach obcych pominięte." : ""))
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func vatDetail(_ month: FinCenter.VatMonth) -> String {
        var parts: [String] = []
        if let due = month.dueDate { parts.append("termin \(FinFormat.day(due))") }
        if let declared = month.declared { parts.append("deklaracja \(FinFormat.money(declared))") }
        if month.paid > 0 { parts.append("zapłacono \(FinFormat.money(month.paid))") }
        return parts.joined(separator: " · ")
    }

    private func cit(_ center: FinCenter) -> some View {
        let cit = center.cit
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("CIT \(Int(cit.year)) — ORIENTACYJNIE").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                if center.canManage {
                    Picker("Stawka CIT", selection: Binding(get: { Int(center.citRate ?? -1) }, set: { value in saveRate(value) })) {
                        Text("stawka: nie ustawiono").tag(-1)
                        Text("9% (mały podatnik)").tag(9)
                        Text("19%").tag(19)
                    }
                    .labelsHidden().controlSize(.small).frame(maxWidth: 190)
                    .disabled(!state.canWrite)
                }
            }
            citRow("Przychody netto z faktur", FinFormat.money(cit.revenueNet))
            citRow("Koszty netto z faktur", FinFormat.money(cit.costsNet))
            citRow("Wynik", FinFormat.money(cit.result), strong: true)
            citRow(cit.rate.map { "Podatek \(Int($0))%" } ?? "Podatek", cit.tax.map { FinFormat.money($0) } ?? "—")
            citRow("Zaliczki zapłacone w roku", FinFormat.money(cit.paid))
            citRow("Rezerwa", cit.reserve.map { FinFormat.money($0) } ?? "—", strong: true)
            Text("Bez wynagrodzeń, ZUS, amortyzacji i kosztów niestanowiących kosztu podatkowego — rezerwa jest ostrożna (raczej zawyżona). Kwotę zaliczki ustala biuro rachunkowe.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func citRow(_ label: String, _ value: String, strong: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit().fontWeight(strong ? .semibold : .regular)
        }
        .font(.callout)
    }

    private func saveRate(_ value: Int) {
        guard let company = store.company else { return }
        let rate: JSONValue = value < 0 ? .null : .number(Double(value))
        Task { await store.run("Zapisywanie stawki CIT…", "taxRate", ["companyId": .string(company.id), "rate": rate]) }
    }

    // MARK: Prognoza 13 tygodni

    private struct Point: Identifiable {
        let id: Int
        let label: String
        let balance: Double
    }

    private func forecast(_ center: FinCenter, _ model: FinCenterModel) -> some View {
        let points: [Point] = [Point(id: -1, label: "teraz", balance: model.start)]
            + model.weeks.map { week in Point(id: week.index, label: FinFormat.dayMonth(week.start), balance: model.balances[week.index]) }
        return FinCard("Prognoza 13 tygodni", symbol: "chart.line.uptrend.xyaxis") {
            VStack(alignment: .leading, spacing: 0) {
                if let negative = model.firstNegative, model.weeks.indices.contains(negative) {
                    FinBanner(text: "Saldo spada poniżej zera w tygodniu od \(FinFormat.dayMonth(model.weeks[negative].start)) (najniżej \(FinFormat.money(model.lowestValue))).", tone: .bad)
                        .padding(.horizontal, 14).padding(.top, 10)
                } else {
                    let week = model.lowestIndex >= 0 && model.weeks.indices.contains(model.lowestIndex) ? " (tydzień od \(FinFormat.dayMonth(model.weeks[model.lowestIndex].start)))" : ""
                    Text("Najniższe saldo w horyzoncie: \(FinFormat.money(model.lowestValue))\(week).")
                        .font(.callout).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.top, 10)
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
                forecastTable(center, model)
            }
        } accessory: {
            HStack(spacing: 14) {
                Toggle("Licz zaległe wpływy (\(FinFormat.short(model.overdueInflows)))", isOn: $store.includeOverdueIn)
                Toggle("Licz ZUS i podatki bez przypisanej zapłaty (\(FinFormat.short(model.overdueUnassigned)))", isOn: $store.includeUnassigned)
            }
            .toggleStyle(.checkbox).font(.caption)
        }
    }

    private func forecastTable(_ center: FinCenter, _ model: FinCenterModel) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            FinanceListHeader(columns: [("Tydzień", nil, .leading), ("Wpływy", 130, .trailing), ("Wydatki", 150, .trailing), ("", 150, .leading), ("Saldo na koniec", 140, .trailing)])
                .padding(.horizontal, 6)
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Saldo z wyciągów" + (center.cash.asOf.map { " na \(FinFormat.day($0))" } ?? ""))
                    if let old = center.cash.daysOld, old > 10 {
                        Text("sprzed \(Int(old)) dni; wpływy i wydatki od tej daty liczone z terminów.").font(.caption).foregroundStyle(Self.amber)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(FinFormat.money(model.opening)).monospacedDigit().frame(width: 140, alignment: .trailing)
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
                Text("Wpływy: należności, pro formy i harmonogramy płatności wydarzeń bez faktury. Wydatki: faktury kosztowe, umowy stałe, wynagrodzenia z umów personelu (do 10. następnego miesiąca) oraz ZUS i podatki (kwota z deklaracji, bez niej — szacunek VAT albo ostatnia zapłata; „~” = szacunek). Tylko kwoty w PLN.")
                if !model.unknownObligations.isEmpty {
                    Text("Bez kwoty (poza prognozą): " + model.unknownObligations.map { "\($0.label) (\(FinFormat.day($0.dueDate)))" }.joined(separator: ", ") + ".")
                }
                if !model.foreign.isEmpty {
                    Text("Poza prognozą: \(model.foreign.count) pozycji w walutach obcych.")
                }
            }
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
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
                        Text(label)
                        if !flows.isEmpty { Text("(\(flows.count))").font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(inflows > 0 ? FinFormat.money(inflows) : "—").foregroundStyle(inflows > 0 ? Self.green : Color.secondary)
                        if let inflowsNote, inflows > 0 { Text(inflowsNote).font(.caption2).foregroundStyle(.secondary) }
                    }
                    .frame(width: 130, alignment: .trailing)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(outflows > 0 ? FinFormat.money(outflows) : "—").foregroundStyle(outflows > 0 ? Self.red : Color.secondary)
                        if let outflowsNote { Text(outflowsNote).font(.caption2).foregroundStyle(.secondary) }
                    }
                    .frame(width: 150, alignment: .trailing)
                    VStack(spacing: 3) {
                        if bars {
                            FinBar(fraction: inflows / maxFlow, color: Self.green.opacity(0.6), height: 5)
                            FinBar(fraction: outflows / maxFlow, color: Self.red.opacity(0.6), height: 5)
                        }
                    }
                    .frame(width: 150)
                    Text(balance.map { FinFormat.money($0) } ?? "").fontWeight(.semibold)
                        .foregroundStyle((balance ?? 0) < 0 ? Self.red : Color.primary)
                        .frame(width: 140, alignment: .trailing)
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
        var details = [flow.kindLabel]
        if let counterparty = flow.counterparty, !counterparty.isEmpty { details.append(counterparty) }
        if flow.estimated { details.append("szacunek") }
        if flow.unassigned { details.append("bez przypisanej zapłaty") }
        return HStack(alignment: .top, spacing: 8) {
            Text(flow.dueDate.map { FinFormat.dayMonth($0) } ?? "—").font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                if let href = flow.href {
                    Button(flow.label) { store.open(href) }.buttonStyle(.link)
                } else {
                    Text(flow.label)
                }
                Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text((flow.incoming ? "+" : "−") + (flow.estimated ? "~" : "") + FinFormat.money(flow.amount))
                .monospacedDigit().foregroundStyle(flow.incoming ? Self.green : Self.red)
        }
        .font(.callout)
    }
}
