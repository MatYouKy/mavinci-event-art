import SwiftUI

// MARK: Uzgodnienie wyciągów (jak „Dokumenty i rozliczenia → Uzgodnienie wyciągów” w CRM, `BankReconciliationPanel`) —
// jedna lista operacji z obu wyciągów miesiąca (PDF i MT940) z lewej, a z prawej wszystko o wybranej operacji: rozliczenie,
// propozycja do zatwierdzenia i ręczne rozliczenie. Zamiast długiej strony z przyciskami przy każdej operacji — lista
// i panel jednej operacji. Zmiany: poziom „Zarządzanie finansami” działalności.

/// Okno otwarte z uzgodnienia.
enum ReconSheet: Identifiable {
    case picker(BankTx)
    case explain(BankTx, String)
    case declaration(BankTx)
    case contract(BankTx)
    case refund(BankTx)
    case details(String)
    var id: String {
        switch self {
        case .picker(let tx): return "picker:\(tx.id)"
        case .explain(let tx, let subtype): return "explain:\(tx.id):\(subtype)"
        case .declaration(let tx): return "declaration:\(tx.id)"
        case .contract(let tx): return "contract:\(tx.id)"
        case .refund(let tx): return "refund:\(tx.id)"
        case .details(let id): return "details:\(id)"
        }
    }
}

@MainActor struct FinanceReconciliationView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var mode = 0
    @State private var sheet: ReconSheet?
    @State private var preview: BankPreviewItem?
    @State private var showRules = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.periodsLoaded && store.companyPeriods.isEmpty {
                header(nil)
                Divider()
                ContentUnavailableView {
                    Label("Nie ma jeszcze wgranych wyciągów", systemImage: "building.columns")
                } description: {
                    Text("Wgraj wyciąg (PDF i MT940) w części „Wyciągi” — uzgodnienie uruchomi się po imporcie.")
                } actions: {
                    Button("Wgraj wyciąg") { finance.part = .statements }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let month = store.month {
                header(month)
                Divider()
                summary(month)
                Divider()
                if mode == 0 {
                    HStack(spacing: 0) {
                        ReconciliationList(store: store, month: month)
                            .frame(minWidth: 360, idealWidth: 460, maxWidth: 560)
                        Divider()
                        inspector(month)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    ReconciliationDocuments(month: month)
                }
            } else if let error = store.monthError {
                header(nil)
                Divider()
                ContentUnavailableView {
                    Label("Nie udało się wczytać uzgodnienia", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await reload() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie uzgodnienia…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: store.company?.id) {
            if !store.periodsLoaded { await store.loadPeriods() }
            if store.period?.companyId != store.company?.id { store.period = store.companyPeriods.first }
        }
        .task(id: store.period?.id) { await store.loadMonth() }
        .sheet(item: $sheet) { item in sheetView(item) }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    private func reload() async {
        await store.loadPeriods()
        await store.loadMonth(force: true)
    }

    // MARK: Nagłówek: działalność, miesiąc, czynności
    private func header(_ month: BankMonth?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                BankCompanyPicker(store: store)
                periodControl
                Picker("", selection: $mode) {
                    Text("Operacje").tag(0)
                    Text("Faktury bez płatności").tag(1)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                .help("Operacje z wyciągu albo strona faktur: opłacone ręcznie bez wyciągu, nieopłacone z terminem, robocze kopie")
                Spacer(minLength: 8)
                Button { showRules = true } label: { Image(systemName: "questionmark.circle") }
                    .buttonStyle(.borderless).help("Jak system uzgadnia wyciąg")
                    .popover(isPresented: $showRules, arrowEdge: .bottom) { BankRulesHelp() }
                Button { store.exportMissing() } label: { Label("Braki (CSV)", systemImage: "arrow.down.doc") }
                    .disabled(month == nil).fixedSize()
                    .help("Lista operacji bez dokumentu dla księgowej — plik CSV w Pobranych")
                Button { Task { await store.exportMatchedPdf() } } label: { Label("Dopasowane faktury (PDF)", systemImage: "doc.on.doc") }
                    .disabled(month == nil || store.busy != nil).fixedSize()
                    .help("Zestawienie płatności i wszystkie dokumenty przypisane w tym miesiącu w jednym PDF — np. do wiadomości dla księgowej (plik w Pobranych)")
                Button { Task { await reload() } } label: {
                    if store.monthLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
                }
                .disabled(store.monthLoading).fixedSize()
                if month?.canManage == true {
                    Button { Task { await store.runReconciliation() } } label: { Label("Uzgodnij automatycznie", systemImage: "wand.and.stars") }
                        .buttonStyle(.borderedProminent).fixedSize()
                        .help("Pewne dopasowania system robi sam, resztę proponuje do zatwierdzenia — każdą decyzję możesz cofnąć")
                }
            }
            .controlSize(.small)
            if let run = month?.lastRun {
                Text("Ostatnie uzgodnienie \(FinFormat.dateTime(run.at)): \(run.sentence)")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var periodControl: some View {
        let list = store.companyPeriods
        let index = store.period.flatMap { list.firstIndex(of: $0) }
        return HStack(spacing: 2) {
            Button { store.step(1) } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless).disabled(index == nil || index! >= list.count - 1).help("Wcześniejszy miesiąc")
            Menu {
                ForEach(list) { item in
                    Button(item.label) { store.period = item; store.selectedTx = nil }
                }
            } label: {
                Text(store.period?.label ?? "—").frame(minWidth: 120)
            }
            .menuStyle(.borderlessButton).fixedSize()
            Button { store.step(-1) } label: { Image(systemName: "chevron.right") }
                .buttonStyle(.borderless).disabled(index == nil || index! <= 0).help("Późniejszy miesiąc")
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
    }

    // MARK: Podsumowanie: źródła, stany, ZUS i umowy
    private func summary(_ month: BankMonth) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                ReconciliationSourceCard(kind: "regular", sources: month.sources)
                ReconciliationSourceCard(kind: "vat", sources: month.sources)
            }
            ReconciliationStatusBar(store: store, month: month)
            if !month.declarations.isEmpty || month.contracts.contains(where: { $0.status != "not_due" }) {
                ReconciliationObligations(month: month) { finance.part = .declarations }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: Panel operacji
    @ViewBuilder private func inspector(_ month: BankMonth) -> some View {
        if let id = store.selectedTx, let tx = month.transactions.first(where: { $0.id == id }) {
            ReconciliationInspector(store: store, month: month, tx: tx, open: { sheet = $0 }, preview: { source, documentId in
                Task { preview = await store.preview(source: source, id: documentId) }
            })
            .id(tx.id)
        } else {
            ContentUnavailableView {
                Label("Wybierz operację", systemImage: "list.bullet.rectangle")
            } description: {
                Text("Z lewej lista operacji miesiąca. Po wybraniu zobaczysz rozliczenie, propozycję i czynności dla tej operacji.")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private func sheetView(_ item: ReconSheet) -> some View {
        switch item {
        case .picker(let tx):
            BankDocumentPickerSheet(store: store, tx: tx)
        case .explain(let tx, let subtype):
            BankExplainSheet(store: store, tx: tx, initialSubtype: subtype)
        case .declaration(let tx):
            BankDeclarationLinkSheet(store: store, tx: tx)
        case .contract(let tx):
            BankContractLinkSheet(store: store, tx: tx)
        case .refund(let tx):
            BankRefundSheet(store: store, tx: tx)
        case .details(let id):
            BankTxDetailsSheet(store: store, transactionID: id)
        }
    }
}

// MARK: Wybór działalności ekranów banku

struct BankCompanyPicker: View {
    @ObservedObject var store: FinanceBankStore
    var body: some View {
        let companies = store.companies
        if companies.count > 1 {
            Picker("", selection: Binding(get: { store.company?.id ?? "" }, set: { store.selectCompany($0) })) {
                ForEach(companies) { company in Text(company.name).tag(company.id) }
            }
            .labelsHidden().fixedSize()
            .help("Działalność — wyciągi, uzgodnienie i deklaracje dotyczą jednego podatnika")
        } else if let company = companies.first {
            Text(company.name).font(.headline).lineLimit(1)
        }
    }
}

// MARK: Źródła: rachunek bieżący i VAT

private struct ReconciliationSourceCard: View {
    let kind: String
    let sources: [BankMonth.Source]
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let files = sources.filter { $0.kind == kind }
        let formats = files.compactMap(\.format)
        let both = formats.contains("PDF") && formats.contains("MT940")
        let unconfirmed = files.reduce(0) { $0 + $1.unconfirmed }
        let count = files.map(\.count).max() ?? 0
        let ok = both && unconfirmed == 0
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(kind == "vat" ? "Rachunek VAT" : "Rachunek bieżący").font(.callout.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                ForEach(formats, id: \.self) { format in
                    Text(format).font(.caption2.weight(.semibold)).padding(.horizontal, 5).padding(.vertical, 1)
                        .background(theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(theme.accent)
                }
            }
            Group {
                if files.isEmpty {
                    Text("Brak wyciągu za ten miesiąc.").foregroundStyle(.secondary)
                } else if both {
                    Text(unconfirmed > 0 ? "\(Int(unconfirmed)) operacji nie ma pary w drugim pliku — sprawdź wyciągi." : "\(Int(count)) operacji potwierdzonych w obu plikach.")
                        .foregroundStyle(ok ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xfcd34d))
                } else {
                    Text("Wgrany tylko \(formats.first ?? "—") — wgraj \(formats.first == "PDF" ? "MT940" : "PDF"), aby potwierdzić listę operacji.")
                        .foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
            }
            .font(.caption).lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.accent.opacity(0.10)))
    }
}

// MARK: Stany operacji (filtr)

private struct ReconciliationStatusBar: View {
    @ObservedObject var store: FinanceBankStore
    let month: BankMonth
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let counts = Dictionary(grouping: month.transactions, by: \.status)
        let todo = month.transactions.filter(\.isOpen).count
        HStack(spacing: 6) {
            Picker("", selection: Binding(get: { store.statusFilter == "all" ? "all" : store.statusFilter == "todo" ? "todo" : "" },
                                          set: { if !$0.isEmpty { store.statusFilter = $0 } })) {
                Text("Do zrobienia (\(todo))").tag("todo")
                Text("Wszystkie (\(month.transactions.count))").tag("all")
                if store.statusFilter != "todo" && store.statusFilter != "all" { Text(BankStatus.label(store.statusFilter)).tag("") }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(BankStatus.order, id: \.self) { status in
                        let items = counts[status] ?? []
                        let amount = items.reduce(0.0) { $0 + (status == "partial" ? $1.remaining : $1.amount) }
                        let active = store.statusFilter == status
                        Button { store.statusFilter = active ? "all" : status } label: {
                            HStack(spacing: 5) {
                                Circle().fill(BankStatus.color(status)).frame(width: 7, height: 7)
                                Text(BankStatus.label(status)).lineLimit(1)
                                Text("\(items.count)").monospacedDigit().fontWeight(.semibold)
                            }
                            .font(.caption)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(active ? theme.accent.opacity(0.18) : Color.primary.opacity(0.05), in: Capsule())
                            .overlay(Capsule().stroke(active ? theme.accent.opacity(0.6) : .clear))
                            .fixedSize()
                        }
                        .buttonStyle(.plain)
                        .help("\(BankStatus.label(status)): \(items.count) · \(FinFormat.money(amount))")
                        .opacity(items.isEmpty && !active ? 0.5 : 1)
                    }
                }
            }
            Picker("", selection: $store.accountFilter) {
                Text("Oba rachunki").tag("all")
                Text("Rachunek bieżący").tag("regular")
                Text("Rachunek VAT").tag("vat")
            }
            .labelsHidden().fixedSize()
            TextField("Szukaj: kontrahent, tytuł, kwota, numer", text: $store.search)
                .textFieldStyle(.roundedBorder).frame(minWidth: 160, idealWidth: 240, maxWidth: 280)
        }
        .controlSize(.small)
    }
}

// MARK: ZUS i podatki, umowy stałe miesiąca

private struct ReconciliationObligations: View {
    let month: BankMonth
    let openDeclarations: () -> Void
    @State private var expanded = false

    var body: some View {
        let contracts = month.contracts.filter { $0.status != "not_due" }
        let paidContracts = contracts.filter { $0.status == "paid" }.count
        let unpaidContracts = contracts.filter { $0.status == "missing" || $0.status == "overdue" }.count
        let declarationsAttention = month.declarations.filter { DeclarationStatus.attention.contains($0.status) }.count
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 4) {
                if !month.declarations.isEmpty {
                    Text("Deklaracje za poprzedni miesiąc i te, które mają przelew w tym wyciągu.").font(.caption2).foregroundStyle(.secondary)
                    ForEach(month.declarations) { d in
                        HStack(spacing: 8) {
                            Text(d.label).lineLimit(1)
                            Text(d.amountDue.map { FinFormat.money($0) } ?? "bez kwoty").foregroundStyle(.secondary)
                            Text("zapłacono \(FinFormat.money(d.paid))").foregroundStyle(.secondary)
                            Spacer(minLength: 4)
                            BankChip(text: DeclarationStatus.label(d.status), color: DeclarationStatus.color(d.status))
                        }
                        .font(.caption)
                    }
                    Button("Rejestr deklaracji →", action: openDeclarations).buttonStyle(.link).font(.caption)
                }
                if !contracts.isEmpty {
                    Text("Najem, leasing, abonamenty i raty z okresem zaczynającym się w tym miesiącu.").font(.caption2).foregroundStyle(.secondary).padding(.top, 4)
                    ForEach(contracts) { c in
                        HStack(spacing: 8) {
                            Text(c.title).lineLimit(1)
                            Text("\(c.periods.joined(separator: ", ")) · \(FinFormat.money(c.due, c.currency))").foregroundStyle(.secondary).lineLimit(1)
                            if c.missing > 0.009 && c.paidForPeriods > 0.009 {
                                Text("brakuje \(FinFormat.money(c.missing, c.currency))").foregroundStyle(CrmTheme.rgb(0xfcd34d))
                            }
                            Spacer(minLength: 4)
                            BankChip(text: ContractStatus.monthLabel(c.status), color: ContractStatus.monthColor(c.status))
                        }
                        .font(.caption)
                    }
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(spacing: 14) {
                if !month.declarations.isEmpty {
                    Label("ZUS i podatki: \(month.declarations.count)" + (declarationsAttention > 0 ? " · do sprawdzenia \(declarationsAttention)" : ""), systemImage: "building.columns")
                        .foregroundStyle(declarationsAttention > 0 ? CrmTheme.rgb(0xfcd34d) : Color.primary)
                }
                if !contracts.isEmpty {
                    Label("Umowy stałe: \(paidContracts) \(paidContracts == 1 ? "opłacona" : "opłacone"), \(unpaidContracts) bez płatności", systemImage: "calendar.badge.clock")
                        .foregroundStyle(unpaidContracts > 0 ? CrmTheme.rgb(0xfcd34d) : Color.primary)
                }
            }
            .font(.caption).lineLimit(1)
        }
    }
}

// MARK: Lista operacji

private struct ReconciliationList: View {
    @ObservedObject var store: FinanceBankStore
    let month: BankMonth

    private var visible: [BankTx] {
        let needle = store.search.trimmingCharacters(in: .whitespaces).lowercased()
        return month.transactions.filter { t in
            if store.statusFilter == "todo" && !t.isOpen { return false }
            if store.statusFilter != "todo" && store.statusFilter != "all" && t.status != store.statusFilter { return false }
            if store.accountFilter != "all" && t.accountKind != store.accountFilter { return false }
            return needle.isEmpty || t.searchText.contains(needle)
        }
    }

    var body: some View {
        let items = visible
        if items.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.circle").font(.largeTitle).foregroundStyle(CrmTheme.rgb(0x4ade80))
                Text(store.statusFilter == "todo" ? "Wszystkie operacje tego miesiąca są rozliczone lub wyjaśnione." : "Brak operacji dla wybranych filtrów.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
            .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: $store.selectedTx) {
                ForEach(items) { tx in
                    ReconciliationRow(tx: tx, year: month.year).tag(tx.id)
                }
            }
            .listStyle(.inset)
        }
    }
}

private struct ReconciliationRow: View {
    let tx: BankTx
    let year: Int

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(BankFormat.shortDate(tx.date, year: year)).monospacedDigit()
                if let booked = tx.bookedDate {
                    // Operacja z poprzedniego miesiąca zaksięgowana w tym — dlatego jest na wyciągu za ten miesiąc.
                    Text("księg. \(BankFormat.shortDate(booked, year: year))").font(.caption2).foregroundStyle(CrmTheme.rgb(0x7dd3fc))
                        .help("Operacja z \(FinFormat.day(tx.date)) — bank zaksięgował ją \(FinFormat.day(booked)), dlatego jest na wyciągu za ten miesiąc i tu się ją rozlicza.")
                }
                Text(tx.accountKind == "vat" ? "VAT" : "bieżący").font(.caption2).foregroundStyle(.tertiary)
            }
            .font(.caption).foregroundStyle(.secondary).frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(tx.displayName).font(.callout.weight(.medium)).lineLimit(1)
                Text(tx.title ?? "—").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 5) {
                    Circle().fill(BankStatus.color(tx.status)).frame(width: 6, height: 6)
                    Text(BankStatus.label(tx.status)).foregroundStyle(BankStatus.color(tx.status))
                    if tx.status == "partial" { Text("· pozostało \(FinFormat.money(tx.remaining, tx.currency))").foregroundStyle(.secondary) }
                    if tx.unconfirmed { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(CrmTheme.rgb(0xfcd34d)).help("Tej operacji nie ma w drugim pliku wyciągu.") }
                }
                .font(.caption2).lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(tx.signedAmount).font(.callout.weight(.medium)).monospacedDigit()
                .foregroundStyle(tx.credit ? CrmTheme.rgb(0x4ade80) : Color.primary).lineLimit(1).fixedSize()
        }
        .padding(.vertical, 3)
    }
}

// MARK: Strona faktur

private struct ReconciliationDocuments: View {
    let month: BankMonth
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                docs("Opłacone ręcznie, bez potwierdzenia w wyciągu",
                     hint: "Faktury oznaczone jako opłacone w tym miesiącu, których płatności nie ma na wyciągu. Sprawdź, czy zapłacono gotówką lub z innego rachunku.",
                     empty: "Każda ręcznie opłacona faktura ma potwierdzenie w wyciągu.",
                     rows: month.paidWithoutStatement.map { ($0, $0.manualPaid, "opłacona \(FinFormat.day($0.paymentDate)) · \($0.side == "issued" ? "sprzedaż" : "koszt")") })
                docs("Nieopłacone z terminem do końca miesiąca",
                     hint: "Faktury bez płatności z wyciągu i bez ręcznego oznaczenia, z terminem płatności w tym miesiącu lub wcześniej (do 6 miesięcy wstecz).",
                     empty: "Brak zaległych faktur.",
                     rows: month.unpaidDue.map { ($0, $0.open, "termin \(FinFormat.day($0.dueDate ?? $0.issueDate)) · \($0.side == "issued" ? "należność" : "zobowiązanie")") })
                docs("Robocze kopie faktur (pomijane)",
                     hint: "Wpisy KSeF bez numeru KSeF obok tej samej faktury z numerem. Nie są rozliczane i nie liczą się do należności — można je usunąć w zakładce KSeF.",
                     empty: "Brak roboczych kopii.",
                     rows: month.shadowDocuments.map { ($0, $0.due, "wystawiona \(FinFormat.day($0.issueDate))") })
            }
            .padding(16)
        }
    }

    private func docs(_ title: String, hint: String, empty: String, rows: [(BankMonth.DocRow, Double, String)]) -> some View {
        FinCard(title, symbol: "doc.text.magnifyingglass", note: hint) {
            if rows.isEmpty {
                Text(empty).font(.callout).foregroundStyle(CrmTheme.rgb(0x4ade80)).padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(row.0.sourceLabel) \(row.0.number ?? "bez numeru")").lineLimit(1)
                                Text([row.0.party, row.2].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Text(FinFormat.money(row.1, row.0.currency)).monospacedDigit()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        if index < rows.count - 1 { Divider().padding(.leading, 14) }
                    }
                }
            }
        } accessory: {
            Text("\(rows.count)").font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(.secondary)
        }
    }
}

// MARK: Etykieta stanu

struct BankChip: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption2.weight(.medium)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
            .fixedSize()
    }
}

// MARK: Jak system uzgadnia wyciąg

struct BankRulesHelp: View {
    private let rules: [(String, String)] = [
        ("Dwa wyciągi → jedna lista.", "Operacje z PDF i MT940 są parowane po saldzie (a gdy bank inaczej ułożył operacje z jednego dnia — po kwocie i dacie). Rozliczasz zawsze jedną operację."),
        ("Numer i kwota", "numer faktury w tytule i kwota równa kwocie do zapłaty: rozliczenie automatyczne. Kilka numerów, których suma równa się przelewowi — też automatycznie."),
        ("Opłacona ręcznie", "faktura oznaczona ręcznie jako opłacona i przelew z jej numerem i kwotą: ręczny wpis zamienia się w powiązanie z wyciągiem."),
        ("Płatność kartą w walucie", "wyciąg podaje kwotę oryginalną (np. 44,03 USD). Gdy w dokumentach spoza KSeF jest faktura w tej walucie na tę kwotę, od tego sprzedawcy i z daty płatności (±7 dni) — przypisanie automatyczne z kursem banku."),
        ("ZUS i podatki", "przelew do ZUS lub na mikrorachunek podatkowy z okresem w tytule („ZUS DRA 03.2026”, „N 26M03 PIT-4R”) trafia do deklaracji za ten okres. Gdy rok w tytule nie pasuje do daty przelewu — wybierasz okres."),
        ("Umowy stałe", "przelew na rachunek z umowy (najem, leasing, abonament, raty) z kwotą okresu przypisuje się sam do najwcześniejszego nieopłaconego okresu. Zgodny rachunek i inna kwota albo nazwa kontrahenta i kwota — propozycja do zatwierdzenia."),
        ("Zwrot płatności (bez faktury)", "operacja i operacja przeciwnego kierunku z tą samą pozostałą kwotą, datą ±45 dni i wspólną nazwą sklepu albo tym samym rachunkiem — propozycja pary do zatwierdzenia. Nigdy automatycznie."),
        ("Wypłaty", "przelew z kwotą zapisanej wypłaty, nazwiskiem lub rachunkiem odbiorcy i datą (±10 dni) łączy się z umową. Jeśli netto nie jest potwierdzone, zatwierdzenie propozycji je potwierdza."),
        ("Bez faktury", "opłaty bankowe i przelewy podatkowe bez symbolu deklaracji są wyjaśniane po tytule."),
        ("Propozycje", "zgodna kwota i kontrahent (NIP, rachunek znany z wcześniejszych płatności, nazwa), płatność częściowa lub zbiorcza: czekają na Twoje zatwierdzenie."),
        ("Ochrona przed podwójnym rozliczeniem", "operacja nie może być rozliczona ponad swoją kwotę, a faktura ponad należność. Robocze kopie faktur bez numeru KSeF są pomijane."),
        ("Twoja decyzja jest ostateczna", "odrzucona propozycja, cofnięte dopasowanie i cofnięte wyjaśnienie nie wracają przy kolejnym uzgodnieniu."),
    ]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Jak system uzgadnia wyciąg").font(.headline)
                ForEach(Array(rules.enumerated()), id: \.offset) { index, rule in
                    (Text("\(index + 1). \(rule.0) ").fontWeight(.semibold) + Text(rule.1))
                        .font(.callout).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
        }
        .frame(width: 460, height: 460)
    }
}
