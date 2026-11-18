import SwiftUI
import Charts

// MARK: Zakładka „Prowizje” na karcie pracownika — cały dorobek pracownika ze wszystkich wydarzeń w jednym miejscu: sumy
// (zarobione, wypłacone, do wypłaty, prognoza, do potrącenia — jak `CommissionEarningsChart` w CRM), wykres miesięczny, warunki
// „Prowizja od sprzedaży”, rejestr naliczeń (Do rozliczenia / Wszystkie / Historia wypłat — jak `CommissionSettlementsPanel`)
// i rozliczenie przy wypłacie wynagrodzenia (`CommissionPayrollSheet`). Zapisy — osoby z „Zarządzaniem finansami”.

enum CommissionListMode: String, CaseIterable, Identifiable {
    case open, all, history
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return "Do rozliczenia"
        case .all: return "Wszystkie naliczenia"
        case .history: return "Historia wypłat"
        }
    }
}

private struct CommissionTile: Identifiable {
    let label: String
    let cents: Int
    let detail: String
    let color: Color
    var id: String { label }
}

private struct CommissionChartPoint: Identifiable {
    let month: String
    let series: String
    let value: Double
    var id: String { month + "|" + series }
}

private struct CommissionHistoryEntry: Identifiable {
    let row: EmployeeCommission
    let payment: EmployeeCommissionPayment
    var id: String { row.id + ":" + payment.id }
}

@MainActor struct EmployeeCommissionsView<Store: CommissionAccountHost>: View {
    @ObservedObject var store: Store
    let employeeID: String
    let employeeName: String
    /// Pracownik albo sprzedawca z kartoteki (`SellerDetailView`) — inne opisy, bez warunków pracownika.
    var kind: CommissionAccountKind = .employee
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("employee.commissions.mode") private var modeRaw = CommissionListMode.open.rawValue
    @State private var brand = ""
    @State private var query = ""
    @State private var year = ""
    @State private var payout: EmployeeCommission?
    @State private var deduction: EmployeeCommission?
    @State private var approving: EmployeeCommission?
    @State private var payroll = false
    @State private var editingTerms = false
    @State private var reloading = false

    private var account: EmployeeCommissionAccount? { store.commissionAccount(employeeID) }
    private var mode: CommissionListMode { CommissionListMode(rawValue: modeRaw) ?? .open }
    private let green = CrmTheme.rgb(0x6ee7b7)
    private let red = CrmTheme.rgb(0xfda4af)
    private let violet = CrmTheme.rgb(0xc4b5fd)

    var body: some View {
        Group {
            if let account {
                if account.hidden {
                    TeamCard(title: "Prowizje", symbol: "percent") {
                        Text(account.message ?? "Nie masz dostępu do rozliczeń prowizji tej osoby.").foregroundStyle(.secondary)
                    }
                } else {
                    content(account)
                }
            } else if let error = store.commissionError(employeeID) {
                TeamCard(title: "Prowizje", symbol: "percent") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(error).foregroundStyle(.secondary)
                        Text("Saldo nie jest pokazywane jako zero — odśwież dane.").font(.caption).foregroundStyle(.secondary)
                        Button("Spróbuj ponownie", systemImage: "arrow.clockwise") { Task { await reload() } }
                    }
                }
            } else {
                ProgressView("Wczytuję prowizje…").frame(maxWidth: .infinity).padding(40)
            }
        }
        .task(id: employeeID) { await reload() }
        .sheet(item: $payout, onDismiss: { Task { await reload() } }) { row in
            CommissionPayoutSheet(store: store, employeeID: employeeID, row: row)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $deduction, onDismiss: { Task { await reload() } }) { row in
            CommissionDeductionSheet(store: store, employeeID: employeeID, deduction: row,
                                     targets: CommissionPayrollPlan.deductionTargets(account?.commissions ?? [], for: row))
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $payroll, onDismiss: { Task { await reload() } }) {
            if let account {
                CommissionPayrollSheet(store: store, employeeID: employeeID, employeeName: employeeName, account: account)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(isPresented: $editingTerms, onDismiss: { Task { await reload() } }) {
            if let terms = account?.terms {
                CommissionTermsSheet(store: store, employeeID: employeeID, employeeName: employeeName, terms: terms)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .confirmationDialog("Zatwierdzić prowizję do wypłaty?", isPresented: Binding(get: { approving != nil }, set: { if !$0 { approving = nil } }),
                            titleVisibility: .visible) {
            if let row = approving {
                Button("Zatwierdź \(CommissionText.money(row.amount))") { Task { await approve(row) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            if let row = approving {
                Text(verbatim: "\(row.eventName) · \(row.beneficiaryName). Zatwierdzona prowizja staje się należnością do wypłaty — wypłatę zapisz dopiero po jej faktycznym wykonaniu.")
            }
        }
    }

    private func reload() async {
        reloading = true
        await store.loadCommissions(employeeID)
        reloading = false
    }

    private func approve(_ row: EmployeeCommission) async {
        await state.withPending("Zatwierdzanie prowizji…") {
            do {
                let reply = try await store.commissionPost("commissionApprove", employeeID, [
                    "commissionId": .string(row.id), "expectedAmount": .number(Double(CommissionText.cents(row.amount)) / 100),
                ], as: CommissionWriteReply.self)
                state.succeed(reply.duplicate == true ? "Prowizja była już zatwierdzona." : "Prowizja zatwierdzona. Wypłatę zapisz dopiero po jej faktycznym wykonaniu.")
            } catch {
                state.error = store.failureText(error, "Nie udało się zatwierdzić prowizji. Odśwież jej status przed ponowieniem.")
            }
        }
        await reload()
    }

    // MARK: Układ

    private func content(_ account: EmployeeCommissionAccount) -> some View {
        let rows = account.commissions.filter { brand.isEmpty || $0.companyId == brand }
        let stats = brand.isEmpty ? account.stats?.all : account.stats?.companies.first(where: { $0.id == brand })?.stats
        return VStack(alignment: .leading, spacing: 16) {
            summaryCard(account, rows: rows, stats: stats)
            if kind == .employee {
                HStack(alignment: .top, spacing: 16) {
                    chartCard(stats)
                    termsCard(account).frame(width: 340)
                }
            } else {
                chartCard(stats)
            }
            listCard(rows)
        }
    }

    private func intro(_ account: EmployeeCommissionAccount) -> String {
        if kind == .partner {
            return "Wszystkie prowizje i narzuty sprzedawcy ze wszystkich wydarzeń: prowizje liczone przez podsumowanie (polecenie, kontakt rozliczeniowy, oferty z portalu, wskazanie w podsumowaniu), narzuty z ofert z narzutem w naszej fakturze i wpisy ręczne — także zapisane na jego kontakt. Planowana kwota to prognoza — do wypłaty staje się po zatwierdzeniu podsumowania wydarzenia. Każda wypłata trafia do rejestru, więc tej samej należności nie zapłacisz dwa razy."
        }
        return account.own
            ? "Twoje prowizje ze wszystkich wydarzeń: udział w sprzedaży (z podsumowania wydarzenia) i wpisy ręczne. Planowana prowizja to prognoza — do wypłaty staje się po zatwierdzeniu podsumowania wydarzenia, a wypłatę zapisuje osoba rozliczająca."
            : "Wszystkie prowizje pracownika ze wszystkich wydarzeń: udział w sprzedaży (z podsumowania wydarzenia), wpisy ręczne i prowizje z jego profilu sprzedawcy. Planowana prowizja to prognoza — do wypłaty staje się po zatwierdzeniu podsumowania wydarzenia. Kwoty dla osoby, bez kosztów spółki."
    }

    private func summaryCard(_ account: EmployeeCommissionAccount, rows: [EmployeeCommission], stats: EmployeeCommissionStats?) -> some View {
        let payable = rows.filter(\.payable)
        let payableCents = payable.reduce(0) { $0 + $1.remainingCents }
        let payrollCents = payable.filter { $0.paymentMethod == "payroll" }.reduce(0) { $0 + $1.remainingCents }
        let companies = account.stats?.companies ?? []
        return TeamCard(title: kind == .partner ? "Prowizje i narzuty" : account.own ? "Moje prowizje" : "Prowizje", symbol: "percent") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    Text(intro(account)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if companies.count > 1 {
                        Picker("Marka", selection: $brand) {
                            Text("Wszystkie marki").tag("")
                            ForEach(companies) { Text($0.name).tag($0.id) }
                        }
                        .frame(width: 240)
                    }
                    Button { Task { await reload() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(reloading)
                }
                if let stats {
                    tiles(stats)
                } else {
                    Text("Nie udało się policzyć sum — odśwież dane.").font(.callout).foregroundStyle(.secondary)
                }
                if account.canManage && payableCents > 0 {
                    HStack(spacing: 12) {
                        Image(systemName: "banknote").font(.title3).foregroundStyle(theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: "Do wypłaty teraz: \(CommissionText.money(cents: payableCents))").fontWeight(.medium)
                            Text(verbatim: payrollCents > 0
                                 ? "W tym z wynagrodzeniem (lista płac): \(CommissionText.money(cents: payrollCents)). Rozlicz razem z wypłatą — potrącenia nadpłat odejmą się automatycznie."
                                 : "Zatwierdzone należności z kwotą do wypłaty: \(payable.count). Rozlicz je jednym zapisem — potrącenia nadpłat odejmą się automatycznie.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Button { payroll = true } label: { Label(kind == .partner ? "Rozlicz wypłatę…" : "Rozlicz przy wypłacie…", systemImage: "checkmark.circle") }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding(12)
                    .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
                if let stats { warnings(stats) }
            }
        }
    }

    private func tiles(_ s: EmployeeCommissionStats) -> some View {
        var items = [
            CommissionTile(label: "Zarobione / zatwierdzone", cents: s.earnedCents, detail: "Nominalne prowizje za wydarzenia", color: theme.accent),
            CommissionTile(label: "Wypłacone", cents: s.paidCents, detail: "Przelewy i wypłaty, także częściowe (bez potrąceń)", color: green),
            CommissionTile(label: "Pozostało do wypłaty", cents: s.outstandingCents, detail: "Tylko zatwierdzone, po odjęciu wypłat i potrąceń", color: violet),
            CommissionTile(label: "Planowane (prognoza)", cents: s.plannedCents, detail: "Jeszcze niezatwierdzone — poza saldem", color: Color.primary.opacity(0.75)),
        ]
        if s.toOffsetCents > 0 {
            items.append(CommissionTile(label: "Do potrącenia", cents: s.toOffsetCents, detail: "Nadpłaty do odjęcia z kolejnych prowizji tej osoby", color: red))
        }
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 10, alignment: .top)], alignment: .leading, spacing: 10) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.label).font(.caption).foregroundStyle(.secondary)
                    Text(verbatim: CommissionText.money(cents: item.cents)).font(.title3.weight(.medium)).monospacedDigit().foregroundStyle(item.color)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Text(item.detail).font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    /// Uwagi pod sumami jak w `CommissionEarningsChart` (oczekujące, bez dat, rozbieżności, wypłaty anulowanych, nadpłaty).
    private func warningNotes(_ s: EmployeeCommissionStats) -> [String] {
        var notes: [String] = []
        if s.waitingCount > 0 {
            notes.append("Oczekujące na zaakceptowaną ofertę: \(s.waitingCount). Bez ustalonej podstawy nie powiększają zarobków ani kwoty do wypłaty.")
        }
        var undated: [String] = []
        if s.undatedEarnedCents > 0 { undated.append(CommissionText.money(cents: s.undatedEarnedCents) + " prowizji bez daty wydarzenia") }
        if s.undatedPaidCents > 0 { undated.append(CommissionText.money(cents: s.undatedPaidCents) + " wypłat bez potwierdzonej daty płatności") }
        if !undated.isEmpty {
            notes.append("W sumach, lecz poza wykresem: " + undated.joined(separator: " oraz ") + ". Brakujących dat nie zastępujemy datą utworzenia wpisu.")
        }
        if s.paymentDetailsMismatchCents > 0 {
            notes.append("Saldo wypłat różni się od szczegółowych wpisów o " + CommissionText.money(cents: s.paymentDetailsMismatchCents) + ". Historia rozliczeń wymaga uzupełnienia lub sprawdzenia.")
        }
        if s.cancelledPaidCents > 0 {
            notes.append("Historia wypłat zawiera " + CommissionText.money(cents: s.cancelledPaidCents) + " związane z anulowanymi prowizjami. Anulowanie nie usuwa wykonanej wypłaty; te kwoty nie zwiększają zarobków ani salda do wypłaty.")
        }
        if s.overpaidCents > 0 {
            notes.append("Wypłaty przekraczające zatwierdzone prowizje: " + CommissionText.money(cents: s.overpaidCents) + ". Sprawdź rozliczenia.")
        }
        return notes
    }

    @ViewBuilder private func warnings(_ s: EmployeeCommissionStats) -> some View {
        let notes = warningNotes(s)
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(notes, id: \.self) { note in
                    Label { Text(verbatim: note).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "exclamationmark.triangle") }
                        .font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    // MARK: Wykres

    private func chartCard(_ stats: EmployeeCommissionStats?) -> some View {
        let months = stats?.months ?? []
        let years = Array(Set(months.map { String($0.month.prefix(4)) })).sorted(by: >)
        let selected = (year == "all" || years.contains(year)) ? year : (years.first ?? "")
        let points = chartPoints(months, year: selected)
        return TeamCard(title: "Zarobki i wypłaty miesięcznie", symbol: "chart.bar") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Text("Zarobione według daty wydarzenia; wypłacone według faktycznej daty płatności. Zmiana roku nie zmienia sum powyżej.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if !years.isEmpty {
                        Picker("Rok", selection: Binding(get: { selected }, set: { year = $0 })) {
                            ForEach(years, id: \.self) { Text($0).tag($0) }
                            Text("Cała historia").tag("all")
                        }
                        .frame(width: 180)
                    }
                }
                if points.allSatisfy({ $0.value == 0 }) {
                    Text("Brak zatwierdzonych prowizji lub wypłat z przypisaną datą.").foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    Chart(points) { point in
                        BarMark(x: .value("Miesiąc", point.month), y: .value("Kwota", point.value))
                            .foregroundStyle(by: .value("Rodzaj", point.series))
                            .position(by: .value("Rodzaj", point.series))
                    }
                    .chartForegroundStyleScale(["Zarobione": theme.accent, "Wypłacone": CrmTheme.rgb(0x34d399)])
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine()
                            AxisValueLabel {
                                if let amount = value.as(Double.self) {
                                    Text(verbatim: amount.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "pl_PL"))))
                                }
                            }
                        }
                    }
                    .chartLegend(position: .bottom)
                    .frame(height: 230)
                }
            }
        }
    }

    /// Rok: 12 miesięcy (puste — zero), „all” — miesiące z zapisami (jak `getCommissionMonthsForYear` w CRM).
    private func chartPoints(_ months: [EmployeeCommissionMonth], year selected: String) -> [CommissionChartPoint] {
        var shown: [EmployeeCommissionMonth] = []
        if selected == "all" {
            shown = months
        } else if !selected.isEmpty {
            for index in 1...12 {
                let key = selected + "-" + (index < 10 ? "0\(index)" : "\(index)")
                shown.append(months.first(where: { $0.month == key }) ?? EmployeeCommissionMonth(month: key, earnedCents: 0, paidCents: 0))
            }
        }
        var points: [CommissionChartPoint] = []
        for month in shown {
            let label = CommissionText.month(month.month)
            points.append(CommissionChartPoint(month: label, series: "Zarobione", value: Double(month.earnedCents) / 100))
            points.append(CommissionChartPoint(month: label, series: "Wypłacone", value: Double(month.paidCents) / 100))
        }
        return points
    }

    // MARK: Warunki

    private func termsCard(_ account: EmployeeCommissionAccount) -> some View {
        TeamCard(title: "Prowizja od sprzedaży", symbol: "person.badge.shield.checkmark") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Procent od zysku netto wydarzeń, w których pracownik jest sprzedawcą wydarzenia (domyślnie autor zaakceptowanej oferty; udziały ustala się w podsumowaniu). Wyższa stawka, gdy w dniu akceptacji oferty był opiekunem klienta.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let t = account.terms {
                    termRow("Status", t.enabled ? "Włączona" : "Wyłączona", color: t.enabled ? green : Color.secondary)
                    termRow("Stawka", CommissionText.percent(t.standardRate) + " zysku netto" + (t.customStandardRate == nil && t.defaultStandardRate != nil ? " (globalna)" : ""))
                    termRow("Klient własny", CommissionText.percent(t.ownClientRate) + " zysku netto" + (t.customOwnClientRate == nil && t.defaultOwnClientRate != nil ? " (globalna)" : ""))
                    termRow("Sposób wypłaty", CommissionText.method(t.paymentMethod))
                    if t.paymentMethod == "payroll", let rate = t.employerSocialRate {
                        termRow("Składki pracodawcy", CommissionText.percent(rate) + " — koszt firmy")
                    }
                    if !t.enabled {
                        Text("Prowizja się nie nalicza, nawet gdy pracownik jest sprzedawcą wydarzenia — sama rola w zespole nie wystarczy, potrzebne jest włączenie tutaj.")
                            .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    }
                    if t.editable {
                        Button("Zmień warunki…", systemImage: "slider.horizontal.3") { editingTerms = true }
                    } else if account.own {
                        Text("Warunki ustawia administrator.").font(.caption2).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Warunki widzi administrator i sam pracownik.").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func termRow(_ label: String, _ value: String, color: Color = .primary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(verbatim: value).foregroundStyle(color).multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    // MARK: Rejestr

    private func listCard(_ rows: [EmployeeCommission]) -> some View {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matches: (EmployeeCommission) -> Bool = { row in
            needle.isEmpty || [row.eventName, row.beneficiaryName, row.companyName ?? "", row.day].joined(separator: " ").lowercased().contains(needle)
        }
        let open = rows.filter { $0.isOpen && matches($0) }
        let all = rows.filter(matches)
        let history = rows.flatMap { row in row.payments.map { CommissionHistoryEntry(row: row, payment: $0) } }
            .filter { entry in matches(entry.row) || [entry.payment.reference ?? "", entry.payment.note ?? ""].joined(separator: " ").lowercased().contains(needle) }
            .sorted { a, b in
                (a.payment.paymentDate ?? "", a.payment.recordedAt ?? "", b.payment.id) > (b.payment.paymentDate ?? "", b.payment.recordedAt ?? "", a.payment.id)
            }
        let counts: [CommissionListMode: Int] = [.open: open.count, .all: all.count, .history: history.count]
        let list = mode == .open ? open : all
        return TeamCard(title: "Naliczenia i wypłaty", symbol: "list.bullet.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Picker("Widok", selection: $modeRaw) {
                        ForEach(CommissionListMode.allCases) { item in Text(verbatim: "\(item.label) (\(counts[item] ?? 0))").tag(item.rawValue) }
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                    Spacer(minLength: 8)
                    TextField("", text: $query, prompt: Text(mode == .history ? "Wydarzenie, opis lub numer wypłaty…" : "Wydarzenie lub beneficjent…"))
                        .textFieldStyle(.roundedBorder).frame(width: 260)
                }
                switch mode {
                case .history:
                    if history.isEmpty { emptyList(needle.isEmpty ? "Brak zapisanych wypłat." : "Brak wyników dla tego wyszukiwania.") }
                    LazyVStack(spacing: 8) { ForEach(history) { historyRow($0) } }
                case .open, .all:
                    if list.isEmpty {
                        emptyList(!needle.isEmpty ? "Brak wyników dla tego wyszukiwania." : mode == .open ? "Brak nierozliczonych prowizji w tym zakresie." : "Brak naliczeń w tym zakresie.")
                    }
                    LazyVStack(spacing: 8) { ForEach(list) { commissionRow($0) } }
                }
            }
        }
    }

    private func emptyList(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 24)
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(verbatim: text).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(color)
    }

    private func commissionRow(_ row: EmployeeCommission) -> some View {
        let chip = CommissionText.chip(row, accent: theme.accent)
        let dateLine = [row.day.isEmpty ? "Bez daty wydarzenia" : row.day, row.companyName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Button { state.showEvent(row.eventId) } label: {
                    Text(verbatim: row.eventName.isEmpty ? "Wydarzenie" : row.eventName).fontWeight(.medium).multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain).linkCursor().help("Otwórz wydarzenie")
                Text(verbatim: dateLine).font(.caption).foregroundStyle(.secondary)
                if !row.beneficiaryName.isEmpty && row.beneficiaryName != employeeName {
                    Text(verbatim: row.beneficiaryName).font(.caption).foregroundStyle(.secondary)
                }
                details(row)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 4) {
                Text(verbatim: chip.label).font(.caption.weight(.medium)).padding(.horizontal, 7).padding(.vertical, 2)
                    .background(chip.color.opacity(0.15), in: Capsule()).foregroundStyle(chip.color)
                Text(verbatim: CommissionText.method(row.paymentMethod)).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
            }
            .frame(width: 150, alignment: .trailing)
            amounts(row).frame(width: 160, alignment: .trailing)
            action(row).frame(width: 180, alignment: .trailing)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func details(_ row: EmployeeCommission) -> some View {
        let kind = CommissionText.kind(row.entryKind)
        let source = CommissionText.source(row.source)
        if kind != nil || source != nil {
            HStack(spacing: 5) {
                if let kind { tag(kind, row.isDeduction ? red : green) }
                if let source { tag(source, Color.secondary) }
            }
        }
        if let text = row.baseDescription, !text.isEmpty {
            Text(verbatim: text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        if kind == nil, let line = rateLine(row) {
            Text(verbatim: line).font(.caption).foregroundStyle(.secondary)
        }
        if let reason = row.rateReason, !reason.isEmpty {
            Text(verbatim: reason).font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        if let due = row.dueDate, !due.isEmpty {
            Text(verbatim: "Termin rozliczenia: " + CommissionText.day(due)).font(.caption).foregroundStyle(.secondary)
        }
        if row.automatic {
            Button("Wyliczenie: rozliczenie wydarzenia") { state.showEvent(row.eventId, cardTab: "summary") }
                .buttonStyle(.link).linkCursor().font(.caption)
        }
    }

    /// „5% od 3 400,00 zł · udział 50%” — stawka i podstawa (bez dopłat i potrąceń).
    private func rateLine(_ row: EmployeeCommission) -> String? {
        guard let rate = row.rate, rate > 0, let base = row.baseAmount else { return nil }
        var line = CommissionText.percent(rate) + " od " + CommissionText.money(base)
        if let share = row.sharePercent, share != 100 { line += " · udział " + CommissionText.percent(share) }
        return line
    }

    private func amounts(_ row: EmployeeCommission) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(verbatim: row.waiting ? "Nieustalone" : (row.isDeduction ? "−" : "") + CommissionText.money(row.amount))
                .fontWeight(.medium).monospacedDigit().foregroundStyle(row.isDeduction ? red : Color.primary)
            if row.isDeduction {
                if row.offsetAmount > 0 || row.paidAmount > 0 {
                    Text(verbatim: "potrącono " + CommissionText.money(row.offsetAmount > 0 ? row.offsetAmount : row.paidAmount)).font(.caption).foregroundStyle(.secondary)
                }
                if row.toOffset > 0 {
                    Text(verbatim: "do potrącenia " + CommissionText.money(row.toOffset)).font(.caption).foregroundStyle(red)
                }
            } else {
                if row.paidAmount > 0 {
                    Text(verbatim: "wypłacone " + CommissionText.money(row.paidAmount)).font(.caption).foregroundStyle(green).monospacedDigit()
                }
                if row.offsetAmount > 0 {
                    Text(verbatim: "w tym potrącono " + CommissionText.money(row.offsetAmount)).font(.caption2).foregroundStyle(.secondary)
                }
                if !row.waiting && row.remainingAmount > 0 {
                    Text(verbatim: "pozostało " + CommissionText.money(row.remainingAmount)).font(.caption).foregroundStyle(theme.accent).monospacedDigit()
                }
            }
        }
    }

    /// Akcja wiersza jak `CommissionRowAction` w CRM: zatwierdzenie (tylko wpisy ręczne), wypłata, potrącenie z innej prowizji.
    @ViewBuilder private func action(_ row: EmployeeCommission) -> some View {
        if row.isDeduction {
            if row.canManage && row.status == "approved" && row.toOffset > 0 {
                Button("Potrąć z prowizji…", systemImage: "scissors") { deduction = row }
            } else {
                Text(row.status == "paid" ? "Potrącone" : "—").font(.caption).foregroundStyle(.tertiary)
            }
        } else if row.status == "planned" && row.automatic {
            Text(CommissionText.automaticHint).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        } else if row.canManage && !row.waiting && row.amount > 0 && row.status == "planned" {
            Button("Zatwierdź do wypłaty") { approving = row }
        } else if row.canManage && !row.waiting && row.status == "approved" && row.remainingAmount > 0 {
            Button("Zapisz wypłatę…") { payout = row }
        } else {
            Text(row.waiting ? "Ustal podstawę w wydarzeniu" : row.status == "paid" ? "Rozliczona" : "—").font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func historyRow(_ entry: CommissionHistoryEntry) -> some View {
        let payment = entry.payment
        let row = entry.row
        let offset = payment.isOffset || payment.source == "offset"
        let date = payment.paymentDate.map { CommissionText.day($0) } ?? ""
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: (date.isEmpty ? "Data nie została zapisana" : date) + " · " + (row.eventName.isEmpty ? "Wydarzenie" : row.eventName)).fontWeight(.medium)
                Text(verbatim: [row.beneficiaryName, row.companyName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                if let reference = payment.reference, !reference.isEmpty {
                    Text(verbatim: "Numer przelewu / dokumentu: " + reference).font(.caption).textSelection(.enabled)
                }
                if let note = payment.note, !note.isEmpty {
                    Text(verbatim: note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if payment.source == "legacy" {
                    Text(verbatim: "Historyczne oznaczenie „wypłacona”." + (payment.paymentDate != nil ? " Data pochodzi z wcześniejszego zapisu statusu, nie z potwierdzenia bankowego." : " Nie uzupełniamy brakującej daty domyślnie.") + " Brak osobnego zapisu przelewu.")
                        .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: CommissionText.money(payment.amount)).fontWeight(.semibold).monospacedDigit().foregroundStyle(offset ? Color.secondary : green)
                if offset { Text("potrącenie, bez przelewu").font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
