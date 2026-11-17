import SwiftUI
import AppKit

// MARK: Terminy i monity — 1:1 z `FinanceDeadlinesPanel.tsx`: kafle spraw po terminie, ostrzeżenie o wyciągach, natywne tabele
// (ZUS i podatki, należności z przypomnieniami e-mail, faktury kosztowe do zapłaty z terminem dostawcy i białą listą VAT,
// przelewy ponad 15 000 zł), „Obowiązki działalności” i domyślne terminy dostawców. Kilka wybranych działalności — listy
// połączone, przy każdej pozycji nazwa działalności, czynności według uprawnień w jej działalności. Z prawej panel „Co z tym
// zrobić” (`FinanceDeadlinesGuide.swift`): co to za pozycja, skąd się wzięła, stan i przyciski do załatwienia jej.

@MainActor struct FinanceDeadlinesView: View {
    @ObservedObject var store: FinanceStore
    let scope: FinScope
    @EnvironmentObject private var state: Workspace
    @State private var showPaidObligations = false
    @State private var obligationSelection: String?
    @State private var receivableSelection: String?
    @State private var payableSelection: String?
    @State private var paymentSelection: String?
    @State private var obligationSort = [KeyPathComparator(\FinDeadlines.Obligation.dueDate)]
    @State private var receivableSort = [KeyPathComparator(\FinDeadlines.Receivable.dueDate)]
    @State private var payableSort = [KeyPathComparator(\FinDeadlines.Payable.sortDue)]
    @State private var paymentSort = [KeyPathComparator(\FinWhitelist.Payment.transactionDate, order: .reverse)]
    @State private var settingsCompany: FinCompany?
    @State private var dueEdit: FinDeadlines.Payable?
    @State private var reminder: FinDeadlines.Receivable?
    @State private var termsOpen = false
    @State private var removingTerm: FinDeadlines.SupplierTerm?
    @State private var paidTarget: FinDeadlinePaidTarget?
    @State private var declarationTarget: FinDeadlines.Obligation?
    /// Panel „Co z tym zrobić” obok tabeli (zapamiętany na tym Macu).
    @AppStorage("finance.deadlinesGuide") private var guideShown = true

    private static let red = CrmTheme.rgb(0xf87171)
    private static let amber = CrmTheme.rgb(0xfbbf24)

    /// Działalności, w których pracownik zarządza finansami (ustawienia obowiązków, terminy, zamknięcia).
    private var manageable: [FinCompany] { scope.companies.filter(\.canManage) }
    private func canManage(_ company: String?) -> Bool { scope.company(company)?.canManage ?? false }
    private func canRemind(_ company: String?) -> Bool { scope.company(company)?.canRemind ?? false }

    var body: some View {
        let model = FinDeadlinesModel(scope)
        return Group {
            if model.loaded {
                content(model)
            } else {
                ContentUnavailableView {
                    Label("Nie udało się wczytać terminów", systemImage: "exclamationmark.triangle")
                } description: { Text(model.failures.map(\.message).joined(separator: "\n")) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(item: $settingsCompany) { company in
            if let deadlines = scope.entries.first(where: { $0.company.id == company.id })?.state.deadlines {
                FinObligationSettingsSheet(store: store, company: company, deadlines: deadlines)
            }
        }
        .sheet(item: $dueEdit) { payable in
            FinDueDateSheet(store: store, payable: payable)
        }
        .sheet(item: $reminder) { receivable in
            FinanceReminderSheet(store: store, receivable: receivable)
        }
        .sheet(item: $paidTarget) { target in
            FinDeadlinePaidSheet(store: store, target: target)
        }
        .sheet(item: $declarationTarget) { item in
            if let company = item.company {
                DeclarationFormSheet(store: store.bank, companyID: company, declaration: nil,
                                     initial: DeclarationFormSheet.Initial(kind: item.kind, form: item.form, periodKind: item.periodKind,
                                                                           periodStart: item.periodStart, dueDate: item.dueDate)) { _ in
                    Task { await store.sync(force: true) }
                }
            }
        }
        .confirmationDialog("Usunąć domyślny termin dostawcy?", isPresented: Binding(get: { removingTerm != nil }, set: { if !$0 { removingTerm = nil } }), presenting: removingTerm) { term in
            Button("Usuń", role: .destructive) { removeTerm(term) }
            Button("Anuluj", role: .cancel) {}
        } message: { _ in
            Text("Terminy już wpisane w fakturach zostaną.")
        }
    }

    private func content(_ model: FinDeadlinesModel) -> some View {
        let today = model.today
        let overdueReceivables = model.receivables.filter { $0.daysOverdue > 0 }
        let overduePayables = model.payables.filter { ($0.dueDate ?? "9999") < today }
        let noDue = model.payables.filter { $0.dueDate == nil }.count
        return VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                tileButton(.obligations, FinTile(symbol: "building.columns", label: "ZUS i podatki po terminie",
                                                 value: "\(model.obligations.filter(\.overdue).count)",
                                                 warn: model.obligations.contains(where: \.overdue)))
                tileButton(.receivables, FinTile(symbol: "bell.badge", label: "Należności po terminie",
                                                 value: "\(overdueReceivables.count) · \(FinFormat.money(overdueReceivables.reduce(0) { $0 + $1.outstanding }))",
                                                 warn: !overdueReceivables.isEmpty))
                tileButton(.payables, FinTile(symbol: "exclamationmark.triangle", label: "Faktury kosztowe po terminie",
                                              value: "\(overduePayables.count) · \(FinFormat.money(overduePayables.reduce(0) { $0 + $1.amount }))",
                                              warn: !overduePayables.isEmpty))
                tileButton(.payables, FinTile(symbol: "calendar.badge.exclamationmark", label: "Faktury kosztowe bez terminu",
                                              value: "\(noDue)", warn: noDue > 0))
            }
            ForEach(model.failures) { failure in
                FinBanner(text: "\(failure.company.name): nie udało się wczytać terminów — \(failure.message)", tone: .bad)
            }
            if !model.statementGaps.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.statementGaps) { gap in
                            FinBanner(text: statementText(gap))
                        }
                    }
                    Button("Wczytaj wyciąg") { store.open(FinLink.section("external", "statements")) }
                        .fixedSize()
                        .help("Wyciągi — wgranie wyciągu za brakujący miesiąc")
                }
            }
            listPicker(model)
            actions(model)
            HStack(alignment: .top, spacing: 0) {
                Group {
                    switch store.list {
                    case .obligations: obligationsTable(model)
                    case .receivables: receivablesTable(model)
                    case .payables: payablesTable(model)
                    case .payments: paymentsTable(model)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if guideShown {
                    Divider()
                    FinDeadlinesGuidePanel(list: store.list, item: selectedItem(model), context: guideContext(model), footnote: footnote) { perform($0) }
                        .frame(width: 340)
                        .frame(maxHeight: .infinity)
                }
            }
            if !guideShown {
                Text(footnote).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(18)
    }

    // MARK: Panel „Co z tym zrobić”

    private func selectedItem(_ model: FinDeadlinesModel) -> FinDeadlineItem? {
        switch store.list {
        case .obligations:
            guard let id = obligationSelection, let item = visibleObligations(model).first(where: { $0.id == id }) else { return nil }
            return FinDeadlineItem.obligation(item)
        case .receivables:
            guard let item = selectedReceivable(model) else { return nil }
            return FinDeadlineItem.receivable(item)
        case .payables:
            guard let item = selectedPayable(model) else { return nil }
            return FinDeadlineItem.payable(item, model.checks[item.id])
        case .payments:
            guard let id = paymentSelection, let item = model.payments.first(where: { $0.id == id }) else { return nil }
            return FinDeadlineItem.payment(item)
        }
    }

    private func guideContext(_ model: FinDeadlinesModel) -> FinDeadlineContext {
        let ends = model.statementEnds
        return FinDeadlineContext(
            today: model.today,
            statementEnd: { company in ends[company ?? ""] },
            canManage: { company in canManage(company) },
            canSend: { item in canSend(item) },
            editable: { item in editable(item) },
            canWrite: state.canWrite,
            whitelistAvailable: model.whitelistAvailable
        )
    }

    /// Rok i miesiąc z daty „rrrr-MM-dd”.
    private static func yearMonth(_ day: String) -> (year: Int, month: Int)? {
        let parts = day.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2, (1...12).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    private func perform(_ action: FinDeadlineAction) {
        switch action {
        case .declaration(let item):
            declarationTarget = item
        case .reconcile(let company, let day):
            guard let company, let parts = Self.yearMonth(day) else { return }
            Task { await store.bank.openReconciliation(company: company, year: parts.year, month: parts.month) }
        case .statements(let company, let day):
            guard let company else { return }
            let parts = day.flatMap { Self.yearMonth($0) }
            store.bank.openStatements(company: company, year: parts?.year ?? Calendar.current.component(.year, from: Date()), month: parts?.month)
        case .declarations(let company, let periodStart, let kind):
            guard let company, let parts = Self.yearMonth(periodStart) else { return }
            store.bank.openDeclarations(company: company, year: parts.year, kind: kind)
        case .settings(let company):
            settingsCompany = scope.company(company)
        case .reminder(let item):
            reminder = item
        case .markPaid(let target):
            paidTarget = target
        case .invoice(let id):
            store.open("/crm/invoices/\(id)")
        case .ksef:
            store.open(FinLink.section("ksef", nil))
        case .dueDate(let item):
            dueEdit = item
        case .checkPayable(let item):
            Task { await store.checkWhitelist("payables", company: item.company, ids: [item.id], force: true) }
        case .checkPayment(let item):
            Task { await store.checkWhitelist("payments", company: item.company, ids: [item.bankTransactionId], force: true) }
        case .copy(let text):
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            state.succeed("Skopiowano numer rachunku.")
        }
    }

    private func statementText(_ gap: FinDeadlinesModel.StatementGap) -> String {
        let prefix = scope.multi ? "\(gap.company.name): " : ""
        if let end = gap.end {
            return prefix + "Wyciągi są wczytane do \(FinFormat.day(end)). Zapłat po tej dacie CRM nie widzi — obowiązki z późniejszym terminem mają stan „brak wyciągu”, a należności i zobowiązania mogą być już zapłacone."
        }
        return prefix + "Brak wczytanych wyciągów — CRM nie potwierdzi żadnej zapłaty ZUS i podatków."
    }

    private func tileButton(_ list: FinDeadlinesList, _ tile: FinTile) -> some View {
        Button { store.list = list } label: { tile.contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .help("Pokaż listę „\(list.label)”")
    }

    // MARK: Wybór listy i czynności (w osobnych wierszach — bez ściskania i zawijania napisów)

    private func listPicker(_ model: FinDeadlinesModel) -> some View {
        HStack {
            Picker("Lista", selection: $store.list) {
                ForEach(FinDeadlinesList.allCases) { item in
                    Text("\(item.label) (\(count(item, model)))").tag(item)
                }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Spacer(minLength: 8)
            Toggle(isOn: $guideShown) { Label("Co z tym zrobić?", systemImage: "lightbulb") }
                .toggleStyle(.button).fixedSize()
                .help("Panel z prawej: co to za pozycja, skąd się wzięła i jak ją załatwić (zaznacz pozycję na liście)")
        }
    }

    @ViewBuilder private func actions(_ model: FinDeadlinesModel) -> some View {
        HStack(spacing: 10) {
            switch store.list {
            case .obligations:
                Toggle("Pokaż zapłacone z ostatniego roku", isOn: $showPaidObligations).toggleStyle(.checkbox).fixedSize()
                Spacer(minLength: 8)
                Button("Deklaracje i kwoty") { store.open(FinLink.section("external", "declarations")) }
                    .fixedSize().help("Deklaracje ZUS i podatki — kwoty z deklaracji i pliki")
                settingsButton
            case .receivables:
                Spacer(minLength: 8)
                Button { if let item = selectedReceivable(model) { reminder = item } } label: { Label("Wyślij przypomnienie", systemImage: "envelope") }
                    .fixedSize()
                    .disabled(!(selectedReceivable(model).map { canSend($0) } ?? false) || !state.canWrite)
                    .help("Zaznacz fakturę na liście")
            case .payables:
                if !model.supplierTerms.isEmpty {
                    Button("Domyślne terminy dostawców (\(model.supplierTerms.count))") { termsOpen = true }
                        .fixedSize()
                        .popover(isPresented: $termsOpen, arrowEdge: .bottom) { supplierTerms(model) }
                }
                Spacer(minLength: 8)
                if let payable = selectedPayable(model), editable(payable) {
                    Button(payable.dueDate == nil ? "Ustaw termin…" : "Zmień termin…") { dueEdit = payable }.fixedSize().disabled(!state.canWrite)
                }
                if model.whitelistAvailable {
                    Button { Task { await store.checkWhitelist("payables") } } label: { Label("Sprawdź na białej liście", systemImage: "checkmark.shield") }
                        .fixedSize().disabled(!state.canWrite)
                        .help("Sprawdza NIP i rachunek z faktury w wykazie podatników VAT (API MF) na dziś — rób to w dniu zlecenia przelewu.")
                }
            case .payments:
                Spacer(minLength: 8)
                if !model.payments.isEmpty {
                    Button { Task { await store.checkWhitelist("payments") } } label: { Label("Sprawdź przelewy", systemImage: "checkmark.shield") }
                        .fixedSize().disabled(!state.canWrite)
                        .help("Sprawdza rachunek z wyciągu w wykazie podatników VAT na dzień przelewu (tylko niesprawdzone).")
                }
            }
        }
        .lineLimit(1)
    }

    /// „Obowiązki działalności” — przy kilku działalnościach wybór działalności.
    @ViewBuilder private var settingsButton: some View {
        if manageable.count == 1, let company = manageable.first {
            Button { settingsCompany = company } label: { Label("Obowiązki działalności", systemImage: "gearshape") }.fixedSize()
        } else if manageable.count > 1 {
            Menu {
                ForEach(manageable) { company in Button(company.name) { settingsCompany = company } }
            } label: {
                Label("Obowiązki działalności", systemImage: "gearshape")
            }
            .fixedSize()
        }
    }

    private func count(_ list: FinDeadlinesList, _ model: FinDeadlinesModel) -> Int {
        switch list {
        case .obligations: return visibleObligations(model).count
        case .receivables: return model.receivables.count
        case .payables: return model.payables.count
        case .payments: return model.payments.count
        }
    }

    private var footnote: String {
        switch store.list {
        case .obligations:
            return "Termin w sobotę, niedzielę lub święto przechodzi na następny dzień roboczy. Kwota pochodzi z deklaracji w „ZUS i podatki”, zapłata — z przelewu przypisanego do deklaracji w uzgodnieniu wyciągu. Terminy potwierdź z biurem rachunkowym. Przypomnienia przychodzą codziennie o 8:05 do osób z „Zarządzaniem finansami”."
        case .receivables:
            return "Przypomnienie idzie e-mailem z fakturą w załączniku, z adresu wybranego przy wysyłce; CRM zapisuje datę i adresata. Status zapłaty pochodzi z uzgodnienia wyciągów — przed wysłaniem sprawdź, czy wpłata nie przyszła po ostatnim wyciągu. Lista: nieopłacone faktury sprzedaży po terminie i z terminem w 14 dni."
        case .payables:
            return "Termin z faktury w KSeF ma pierwszeństwo — w CRM ustawia się go tylko fakturom bez terminu. Termin dostawcy (dni od wystawienia) uzupełnia jego pozostałe nieopłacone faktury i nowe, pobrane z KSeF. Biała lista: przy transakcji ponad 15 000 zł płać tylko na rachunek z wykazu, sprawdzony w dniu zlecenia przelewu (identyfikator zapytania MF to dowód)."
        case .payments:
            return "Przelew za transakcję ponad 15 000 zł na rachunek spoza wykazu: koszt nie jest kosztem podatkowym, a za VAT dostawcy odpowiada się solidarnie — chyba że w 7 dni od zlecenia przelewu złożysz zawiadomienie ZAW-NR do urzędu skarbowego. Skonsultuj z biurem rachunkowym. Lista: przelewy z ostatnich 90 dni dopasowane do faktur kosztowych (według wczytanych wyciągów)."
        }
    }

    /// Nazwa działalności dopisywana do opisu pozycji przy kilku działalnościach.
    private func companySuffix(_ id: String?) -> String {
        scope.label(id).map { " · \($0)" } ?? ""
    }

    // MARK: ZUS i podatki

    private func visibleObligations(_ model: FinDeadlinesModel) -> [FinDeadlines.Obligation] {
        if showPaidObligations { return model.obligations }
        return model.obligations.filter { !["paid", "paid_no_amount"].contains($0.status) || $0.dueDate >= model.today }
    }

    private func relative(_ due: String, today: String) -> String {
        let left = FinFormat.daysBetween(today, due)
        if left > 0 { return "za \(left) \(FinFormat.dayWord(left))" }
        if left == 0 { return "dziś" }
        return "\(-left) \(FinFormat.dayWord(left)) temu"
    }

    private func obligationsTable(_ model: FinDeadlinesModel) -> some View {
        let rows = visibleObligations(model).sorted(using: obligationSort)
        let today = model.today
        return Table(rows, selection: $obligationSelection, sortOrder: $obligationSort) {
            TableColumn("Obowiązek", value: \.label) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label).fontWeight(.medium).lineLimit(1)
                    if let setting = item.settingLabel { Text(setting).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                .padding(.vertical, 2)
            }
            .width(min: 220, ideal: 320)
            TableColumn("Termin", value: \.dueDate) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(FinFormat.day(item.dueDate)).monospacedDigit()
                    Text(relative(item.dueDate, today: today)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .width(min: 100, ideal: 120, max: 150)
            TableColumn("Kwota z deklaracji", value: \.sortAmount) { item in
                Text(item.amountDue.map { FinFormat.money($0) } ?? "brak kwoty")
                    .monospacedDigit().foregroundStyle(item.amountDue == nil ? Self.amber : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 120, ideal: 140, max: 170)
            TableColumn("Zapłacono", value: \.paid) { item in
                Text(item.paid > 0 ? FinFormat.money(item.paid) : "—").monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 130, max: 160)
            TableColumn("Stan") { item in
                FinChipView(chip: FinChip.obligation(item, today: today))
            }
            .width(min: 160, ideal: 240)
        }
        .contextMenu(forSelectionType: String.self) { _ in
            Button("Deklaracje i kwoty") { store.open(FinLink.section("external", "declarations")) }
            Button("Uzgadnianie wyciągu") { store.open(FinLink.section("external", "reconciliation")) }
        }
        .overlay {
            if !model.anySettingsEnabled {
                emptyState("Wybrane działalności nie mają ustawionych obowiązków ZUS i podatkowych." + (manageable.isEmpty ? " Ustawia je osoba z „Zarządzaniem finansami”." : " Włącz je w „Obowiązki działalności”."))
            } else if rows.isEmpty {
                emptyState("Wszystkie obowiązki z ostatniego roku są zapłacone.", symbol: "checkmark.circle")
            }
        }
    }

    private func emptyState(_ text: String, symbol: String = "tray") -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.title2).foregroundStyle(.secondary)
            Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 420)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .allowsHitTesting(false)
    }

    // MARK: Należności

    private func canSend(_ item: FinDeadlines.Receivable) -> Bool {
        canRemind(item.company) && item.source == "local" && item.invoiceId != nil
    }

    private func selectedReceivable(_ model: FinDeadlinesModel) -> FinDeadlines.Receivable? {
        receivableSelection.flatMap { id in model.receivables.first { $0.id == id } }
    }

    private func receivablesTable(_ model: FinDeadlinesModel) -> some View {
        let rows = model.receivables.sorted(using: receivableSort)
        let today = model.today
        return Table(rows, selection: $receivableSelection, sortOrder: $receivableSort) {
            TableColumn("Faktura", value: \.invoiceNumber) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.invoiceNumber).fontWeight(.medium).lineLimit(1)
                    Text("wystawiona \(FinFormat.day(item.issueDate))" + (item.inKsef ? " · KSeF" : "") + companySuffix(item.company))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .padding(.vertical, 2)
            }
            .width(min: 150, ideal: 200)
            TableColumn("Klient", value: \.sortBuyer) { item in
                Text(item.buyerName ?? "—").lineLimit(2)
            }
            .width(min: 160, ideal: 240)
            TableColumn("Termin", value: \.dueDate) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(FinFormat.day(item.dueDate)).monospacedDigit()
                    let late = Int(item.daysOverdue)
                    let left = FinFormat.daysBetween(today, item.dueDate)
                    Text(late > 0 ? "\(late) \(FinFormat.dayWord(late)) po terminie" : "za \(left) \(FinFormat.dayWord(left))")
                        .font(.caption).foregroundStyle(late > 0 ? Self.red : Color.secondary)
                }
            }
            .width(min: 110, ideal: 130, max: 160)
            TableColumn("Do zapłaty", value: \.outstanding) { item in
                Text(FinFormat.money(item.outstanding, item.currency)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 110, ideal: 130, max: 170)
            TableColumn("Monity", value: \.reminders) { item in
                if item.reminders > 0 {
                    Text("\(Int(item.reminders))× · ostatni \(FinFormat.day(item.lastReminderAt))").lineLimit(1)
                } else {
                    Text("brak").foregroundStyle(.secondary)
                }
            }
            .width(min: 110, ideal: 150, max: 200)
            TableColumn("") { item in
                if canSend(item) {
                    Button { reminder = item } label: { Label("Wyślij przypomnienie", systemImage: "envelope") }
                        .controlSize(.small).disabled(!state.canWrite)
                } else if item.source != "local" || item.invoiceId == nil {
                    Text("faktura spoza CRM — przypomnienie z poczty").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .width(min: 170, ideal: 200)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = model.receivables.first(where: { $0.id == id }) {
                if canSend(item) {
                    Button("Wyślij przypomnienie…") { reminder = item }.disabled(!state.canWrite)
                }
                if let invoiceID = item.invoiceId {
                    Button("Otwórz fakturę") { store.open("/crm/invoices/\(invoiceID)") }
                } else {
                    Button("Faktury KSeF") { store.open(FinLink.section("ksef", nil)) }
                }
            }
        } primaryAction: { ids in
            guard let id = ids.first, let item = model.receivables.first(where: { $0.id == id }) else { return }
            store.open(item.invoiceId.map { "/crm/invoices/\($0)" } ?? FinLink.section("ksef", nil))
        }
        .overlay {
            if rows.isEmpty { emptyState("Brak nieopłaconych faktur sprzedaży z terminem do 14 dni.", symbol: "checkmark.circle") }
        }
    }

    // MARK: Faktury kosztowe do zapłaty

    private func editable(_ payable: FinDeadlines.Payable) -> Bool {
        canManage(payable.company) && (payable.dueDate == nil || payable.dueSource != nil)
    }

    private func selectedPayable(_ model: FinDeadlinesModel) -> FinDeadlines.Payable? {
        payableSelection.flatMap { id in model.payables.first { $0.id == id } }
    }

    private func payablesTable(_ model: FinDeadlinesModel) -> some View {
        let rows = model.payables.sorted(using: payableSort)
        let today = model.today
        let checks = model.checks
        let showWhitelist = model.whitelistAvailable
        return Table(rows, selection: $payableSelection, sortOrder: $payableSort) {
            TableColumn("Dostawca", value: \.sortSeller) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.sellerName ?? "—").fontWeight(.medium).lineLimit(2)
                    if let nip = item.sellerNip { Text("NIP \(nip)").font(.caption).foregroundStyle(.secondary) }
                }
                .padding(.vertical, 2)
            }
            .width(min: 170, ideal: 230)
            TableColumn("Faktura", value: \.invoiceNumber) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.invoiceNumber).lineLimit(1)
                    Text("wystawiona \(FinFormat.day(item.issueDate))" + companySuffix(item.company)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .width(min: 130, ideal: 180)
            TableColumn("Termin", value: \.sortDue) { item in
                dueCell(item, today: today)
            }
            .width(min: 150, ideal: 180)
            TableColumn("Kwota", value: \.amount) { item in
                Text(FinFormat.money(item.amount, item.currency)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 120, max: 160)
            TableColumn("Rachunek", value: \.sortAccount) { item in
                Text(item.bankAccount ?? "—").font(.system(.caption, design: .monospaced)).lineLimit(1).textSelection(.enabled)
            }
            .width(min: 150, ideal: 220)
            TableColumn("Biała lista") { item in
                if showWhitelist, let check = checks[item.id] {
                    VStack(alignment: .leading, spacing: 2) {
                        FinChipView(chip: FinChip.whitelist(verdict: check.verdict, statusVat: check.statusVat, nip: check.nip, fresh: check.fresh, big: item.amount > 15000))
                            .help(check.requestId.map { "Identyfikator zapytania MF: \($0)" } ?? "")
                        if let date = check.checkDate {
                            Text("sprawdzono \(FinFormat.day(date))" + (check.requestId.map { " · \($0)" } ?? ""))
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            .width(min: 170, ideal: 230)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = model.payables.first(where: { $0.id == id }) {
                if editable(item) {
                    Button(item.dueDate == nil ? "Ustaw termin…" : "Zmień termin…") { dueEdit = item }.disabled(!state.canWrite)
                }
                if showWhitelist && item.sellerNip != nil {
                    Button("Sprawdź tę fakturę na białej liście") {
                        Task { await store.checkWhitelist("payables", company: item.company, ids: [item.id], force: true) }
                    }
                    .disabled(!state.canWrite)
                }
                if let account = item.bankAccount {
                    Button("Kopiuj numer rachunku") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(account, forType: .string)
                    }
                }
                Button("Faktury kosztowe KSeF") { store.open(FinLink.section("ksef", nil)) }
            }
        } primaryAction: { ids in
            guard let id = ids.first, let item = model.payables.first(where: { $0.id == id }), editable(item), state.canWrite else { return }
            dueEdit = item
        }
        .overlay {
            if rows.isEmpty { emptyState("Brak nieopłaconych faktur kosztowych z terminem do 14 dni.", symbol: "checkmark.circle") }
        }
    }

    private func dueCell(_ item: FinDeadlines.Payable, today: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let due = item.dueDate {
                Text(FinFormat.day(due)).monospacedDigit().foregroundStyle(due < today ? Self.red : Color.primary)
                Text(dueSourceText(item)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text("brak terminu w fakturze").foregroundStyle(Self.amber).lineLimit(1)
                if editable(item) {
                    Button("Ustaw termin") { dueEdit = item }.buttonStyle(.link).font(.caption).disabled(!state.canWrite)
                }
            }
        }
    }

    private func dueSourceText(_ item: FinDeadlines.Payable) -> String {
        var text = item.dueSource == "manual" ? "wpisany w CRM" : item.dueSource == "supplier_default" ? "termin dostawcy" : "z faktury"
        if let left = item.daysLeft.map({ Int($0) }) {
            if left < 0 { text += " · \(-left) \(FinFormat.dayWord(left)) po terminie" }
            else if left == 0 { text += " · dziś" }
            else { text += " · za \(left) \(FinFormat.dayWord(left))" }
        }
        return text
    }

    private func supplierTerms(_ model: FinDeadlinesModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Domyślne terminy dostawców").font(.headline)
            ForEach(model.supplierTerms) { term in
                HStack(spacing: 10) {
                    Text("\(term.sellerName ?? "Dostawca") · NIP \(term.sellerNip) · \(Int(term.days)) dni od wystawienia" + companySuffix(term.company))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if canManage(term.company) {
                        Button(role: .destructive) { termsOpen = false; removingTerm = term } label: { Label("Usuń", systemImage: "trash") }
                            .controlSize(.small).fixedSize().disabled(!state.canWrite)
                    }
                }
                .font(.callout)
            }
        }
        .padding(14)
        .frame(width: 540, alignment: .leading)
    }

    private func removeTerm(_ term: FinDeadlines.SupplierTerm) {
        guard let company = term.company else { return }
        Task {
            await store.run("Usuwanie terminu dostawcy…", "supplierTermDelete", ["companyId": .string(company), "nip": .string(term.sellerNip)])
        }
    }

    // MARK: Przelewy ponad 15 000 zł

    private func paymentsTable(_ model: FinDeadlinesModel) -> some View {
        let rows = model.payments.sorted(using: paymentSort)
        return Table(rows, selection: $paymentSelection, sortOrder: $paymentSort) {
            TableColumn("Data przelewu", value: \.transactionDate) { item in
                Text(FinFormat.day(item.transactionDate)).monospacedDigit()
            }
            .width(min: 100, ideal: 110, max: 130)
            TableColumn("Dostawca", value: \.sortSeller) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.sellerName ?? "—").lineLimit(2)
                    if let nip = item.nip { Text("NIP \(nip)").font(.caption).foregroundStyle(.secondary) }
                }
                .padding(.vertical, 2)
            }
            .width(min: 170, ideal: 230)
            TableColumn("Dokument", value: \.sortDocument) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.documentNumber ?? "—").lineLimit(1)
                    Text("wartość \(FinFormat.money(item.documentGross))" + companySuffix(item.company)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .width(min: 140, ideal: 190)
            TableColumn("Przelew", value: \.amount) { item in
                Text(FinFormat.money(item.amount)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 120, max: 160)
            TableColumn("Rachunek odbiorcy") { item in
                Text(item.account ?? "brak na wyciągu").font(.system(.caption, design: .monospaced)).lineLimit(1).textSelection(.enabled)
            }
            .width(min: 160, ideal: 230)
            TableColumn("Biała lista", value: \.sortVerdict) { item in
                VStack(alignment: .leading, spacing: 2) {
                    FinChipView(chip: FinChip.whitelist(verdict: item.verdict, statusVat: item.statusVat, nip: item.nip, fresh: true, big: true))
                    if let request = item.requestId { Text(request).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            .width(min: 180, ideal: 240)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = rows.first(where: { $0.id == id }), item.nip != nil {
                Button("Sprawdź ten przelew na białej liście") {
                    Task { await store.checkWhitelist("payments", company: item.company, ids: [item.bankTransactionId], force: true) }
                }
                .disabled(!state.canWrite)
            }
            Button("Uzgadnianie wyciągów") { store.open(FinLink.section("external", "reconciliation")) }
        }
        .overlay {
            if !model.whitelistAvailable {
                emptyState("Kontrola białej listy jest niedostępna — wymaga aktualizacji bazy (migracja kroku 4).")
            } else if rows.isEmpty {
                emptyState("Brak przelewów ponad 15 000 zł dopasowanych do faktur kosztowych w ostatnich 90 dniach (według wczytanych wyciągów).", symbol: "checkmark.circle")
            }
        }
    }
}

// MARK: Termin płatności faktury kosztowej

@MainActor struct FinDueDateSheet: View {
    @ObservedObject var store: FinanceStore
    let payable: FinDeadlines.Payable
    @Environment(\.dismiss) private var dismiss
    @State private var hasDate = true
    @State private var date = Date()
    @State private var remember = false
    @State private var problem: String?

    private var issue: Date? { payable.issueDate.flatMap { FinFormat.date($0) } }
    private var dayText: String { FinanceText.dayString(date) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(payable.dueDate == nil ? "Ustaw termin płatności" : "Zmień termin płatności", systemImage: "calendar").font(.title3.bold())
            VStack(alignment: .leading, spacing: 2) {
                Text(payable.sellerName ?? "Dostawca").fontWeight(.medium)
                Text("Faktura \(payable.invoiceNumber) · wystawiona \(FinFormat.day(payable.issueDate)) · \(FinFormat.money(payable.amount, payable.currency))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Form {
                Toggle("Termin płatności", isOn: $hasDate)
                if hasDate {
                    if let issue {
                        DatePicker("Data", selection: $date, in: issue..., displayedComponents: .date)
                    } else {
                        DatePicker("Data", selection: $date, displayedComponents: .date)
                    }
                }
                if payable.sellerNip != nil {
                    Toggle(isOn: $remember) {
                        Text("Zapamiętaj dla dostawcy" + (hasDate && payable.issueDate != nil ? " (\(FinFormat.daysBetween(payable.issueDate ?? dayText, dayText)) dni od wystawienia)" : ""))
                    }
                }
            }
            .formStyle(.grouped)
            Text("Termin z faktury w KSeF ma pierwszeństwo — w CRM ustawia się go tylko fakturom bez terminu. Termin dostawcy uzupełnia jego pozostałe nieopłacone faktury i nowe, pobrane z KSeF.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 520)
        .onAppear(perform: prepare)
        .alert("Nie zapisano terminu", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
    }

    /// Jak w CRM: „Zmień” — obecny termin; „Ustaw termin” — data z terminu dostawcy (dni od wystawienia), zapamiętanie przy NIP.
    private func prepare() {
        if let due = payable.dueDate, let value = FinFormat.date(due) {
            date = value
            remember = false
        } else {
            if let issue, let days = payable.supplierDays, let suggested = MeetingDates.calendar.date(byAdding: .day, value: Int(days), to: issue) {
                date = suggested
            } else if let issue, issue > Date() {
                date = issue
            }
            remember = payable.sellerNip != nil
        }
    }

    private func save() async {
        if remember && !hasDate { problem = "Podaj termin, żeby zapamiętać go dla dostawcy."; return }
        let body: [String: JSONValue] = [
            "invoiceId": .string(payable.id),
            "date": hasDate ? .string(dayText) : .null,
            "remember": .bool(remember),
        ]
        if await store.run("Zapisywanie terminu…", "paymentDue", body) { dismiss() }
    }
}

// MARK: Obowiązki działalności

@MainActor struct FinObligationSettingsSheet: View {
    @ObservedObject var store: FinanceStore
    let company: FinCompany
    let deadlines: FinDeadlines
    @Environment(\.dismiss) private var dismiss
    @State private var draft: [FinDeadlines.Setting] = []
    @State private var problem: String?

    /// Obowiązki proponowane w ustawieniach (spółka); działalność włącza te, które ją dotyczą.
    static let defaults: [FinDeadlines.Setting] = [
        FinDeadlines.Setting(kind: "zus", form: "DRA", periodKind: "month", enabled: false, dueDay: 15, dueMonthOffset: 1, label: "ZUS (DRA)"),
        FinDeadlines.Setting(kind: "pit", form: "PIT-4R", periodKind: "month", enabled: false, dueDay: 20, dueMonthOffset: 1, label: "Zaliczki PIT od wynagrodzeń (PIT-4R)"),
        FinDeadlines.Setting(kind: "cit", form: "CIT-8", periodKind: "month", enabled: false, dueDay: 20, dueMonthOffset: 1, label: "Zaliczka CIT"),
        FinDeadlines.Setting(kind: "vat", form: "VAT-7", periodKind: "month", enabled: false, dueDay: 25, dueMonthOffset: 1, label: "VAT i JPK_V7M"),
        FinDeadlines.Setting(kind: "cit", form: "CIT-8", periodKind: "year", enabled: false, dueDay: 31, dueMonthOffset: 3, label: "Zeznanie CIT-8 i dopłata podatku"),
    ]
    static let periodLabels = ["month": "co miesiąc", "quarter": "co kwartał", "year": "co rok"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Obowiązki działalności — \(company.name)", systemImage: "gearshape").font(.title3.bold())
            Text("Termin = wskazany dzień miesiąca, który przypada tyle miesięcy po ostatnim miesiącu okresu. Spółka: ZUS do 15., PIT-4R i zaliczka CIT do 20., VAT do 25. następnego miesiąca, CIT-8 do końca 3. miesiąca po roku. Jednoosobowa działalność płaci ZUS do 20. Zaliczki kwartalne lub uproszczone — ustal z biurem rachunkowym.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            FinanceListHeader(columns: [("Włączony", 70, .leading), ("Obowiązek", nil, .leading), ("Okres", 90, .leading), ("Dzień terminu", 110, .leading), ("Miesięcy po okresie", 140, .leading)])
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(draft.indices, id: \.self) { index in
                        settingRow(index)
                        Divider().opacity(0.4)
                    }
                }
            }
            .frame(minHeight: 220, maxHeight: 360)
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 760)
        .onAppear(perform: prepare)
        .alert("Nie zapisano ustawień", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
    }

    private func settingRow(_ index: Int) -> some View {
        HStack(spacing: 10) {
            Toggle("", isOn: $draft[index].enabled).labelsHidden().toggleStyle(.checkbox).frame(width: 70, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(draft[index].form).fontWeight(.medium)
                Text(draft[index].label ?? "").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(Self.periodLabels[draft[index].periodKind] ?? draft[index].periodKind).frame(width: 90, alignment: .leading)
            Stepper(value: $draft[index].dueDay, in: 1...31) {
                Text("\(draft[index].dueDay)").monospacedDigit()
            }
            .frame(width: 110, alignment: .leading)
            Stepper(value: $draft[index].dueMonthOffset, in: 0...12) {
                Text("\(draft[index].dueMonthOffset)").monospacedDigit()
            }
            .frame(width: 140, alignment: .leading)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
    }

    /// Jak `openSettings` w CRM: obowiązki domyślne z zapisanymi ustawieniami, dodatkowe zapisane na końcu, etykiety z domyślnych.
    private func prepare() {
        var current: [String: FinDeadlines.Setting] = [:]
        for setting in deadlines.settings { current[setting.key] = setting }
        var merged = Self.defaults.map { current[$0.key] ?? $0 }
        for setting in deadlines.settings where !merged.contains(where: { $0.key == setting.key }) { merged.append(setting) }
        draft = merged.map { setting in
            var next = setting
            if (next.label ?? "").isEmpty { next.label = Self.defaults.first { $0.key == setting.key }?.label }
            return next
        }
    }

    /// Zapis zmienionych pozycji (jak `saveSettings` w CRM): nowa wyłączona pozycja nie jest zapisywana.
    private func save() async {
        var known: [String: FinDeadlines.Setting] = [:]
        for setting in deadlines.settings { known[setting.key] = setting }
        var changed: [JSONValue] = []
        for setting in draft {
            let unchanged: Bool
            if let before = known[setting.key] {
                unchanged = before.enabled == setting.enabled && before.dueDay == setting.dueDay
                    && before.dueMonthOffset == setting.dueMonthOffset && (before.label ?? "") == (setting.label ?? "")
            } else {
                unchanged = !setting.enabled
            }
            if unchanged { continue }
            if setting.dueDay < 1 || setting.dueDay > 31 { problem = "\(setting.form): dzień terminu musi być od 1 do 31."; return }
            changed.append(.object([
                "kind": .string(setting.kind), "form": .string(setting.form), "periodKind": .string(setting.periodKind),
                "enabled": .bool(setting.enabled), "dueDay": .number(Double(setting.dueDay)),
                "dueMonthOffset": .number(Double(setting.dueMonthOffset)),
                "label": setting.label.map { JSONValue.string($0) } ?? .null,
            ]))
        }
        if changed.isEmpty {
            store.workspace?.succeed("Obowiązki działalności zapisane.")
            dismiss()
            return
        }
        if await store.run("Zapisywanie obowiązków…", "obligations", ["companyId": .string(company.id), "settings": .array(changed)]) { dismiss() }
    }
}
