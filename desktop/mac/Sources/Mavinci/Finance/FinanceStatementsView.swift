import SwiftUI

// MARK: Wyciągi bankowe (jak „Dokumenty i rozliczenia → Wyciągi i płatności” w CRM) — rok w miesiącach: z lewej każdy
// miesiąc z kompletem plików (rachunek bieżący i VAT, PDF i MT940), z prawej pliki wybranego miesiąca: podgląd, pobranie,
// zmiana nazwy, usunięcie (z kontrolą powiązań) i import nowego wyciągu. Import uruchamia uzgodnienie miesiąca.

@MainActor struct FinanceStatementsView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var preview: BankPreviewItem?
    @State private var renaming: BankStatementFile?
    @State private var newName = ""
    @State private var removing: (file: BankStatementFile, question: String)?

    private var currentYear: Int { Calendar.current.component(.year, from: Date()) }
    private var currentMonth: Int { Calendar.current.component(.month, from: Date()) }
    private var months: [Int] {
        let last = store.statementsYear == currentYear ? currentMonth : 12
        return Array((1...max(1, last)).reversed())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if let list = store.statementList {
                HStack(spacing: 0) {
                    List(selection: Binding(get: { store.statementMonth ?? months.first }, set: { store.statementMonth = $0 })) {
                        ForEach(months, id: \.self) { month in
                            monthRow(month, files: list.statements.filter { $0.month == month }).tag(month)
                        }
                    }
                    .listStyle(.inset)
                    .frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
                    Divider()
                    detail(list)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let error = store.statementsError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać wyciągów", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadStatements(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie wyciągów…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(store.company?.id ?? ""):\(store.statementsYear)") { await store.loadStatements() }
        .sheet(isPresented: $importing) {
            if let company = store.company {
                BankStatementImportSheet(store: store, company: company, year: store.statementsYear, month: store.statementMonth ?? months.first ?? currentMonth)
            }
        }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
        .alert("Zmień nazwę pliku", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Nazwa pliku", text: $newName)
            Button("Anuluj", role: .cancel) { renaming = nil }
            Button("Zapisz") {
                if let file = renaming {
                    let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { await store.renameStatement(file, to: name) }
                }
                renaming = nil
            }
        } message: { Text("Nazwa widoczna na liście wyciągów (plik w magazynie się nie zmienia).") }
        .confirmationDialog("Usuń ten plik wyciągu", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń ten plik", role: .destructive) {
                if let file = removing?.file { Task { await store.deleteStatement(file) } }
                removing = nil
            }
            Button("Zachowaj plik", role: .cancel) { removing = nil }
        } message: { Text(removing?.question ?? "") }
    }

    // MARK: Nagłówek
    private var header: some View {
        HStack(spacing: 10) {
            BankCompanyPicker(store: store)
            HStack(spacing: 2) {
                Button { store.statementsYear -= 1; store.statementMonth = nil } label: { Image(systemName: "chevron.left") }.buttonStyle(.borderless)
                Text(String(store.statementsYear)).font(.headline).monospacedDigit().frame(minWidth: 50)
                Button { store.statementsYear += 1; store.statementMonth = nil } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.borderless).disabled(store.statementsYear >= currentYear)
            }
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
            Spacer()
            Button { Task { await store.loadStatements(force: true) } } label: {
                if store.statementsLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.statementsLoading).fixedSize()
            if store.statementList?.canManage == true {
                Button { importing = true } label: { Label("Wgraj wyciąg", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderedProminent).fixedSize()
                    .help("PDF albo MT940 rachunku bieżącego lub VAT — po imporcie system uzgodni miesiąc")
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: Miesiąc na liście
    private func monthRow(_ month: Int, files: [BankStatementFile]) -> some View {
        HStack(spacing: 10) {
            Text(FinFormat.monthsTitle[month - 1]).font(.callout.weight(.medium)).frame(width: 96, alignment: .leading)
            accountBadges("bieżący", files.filter { $0.accountType == "regular" })
            accountBadges("VAT", files.filter { $0.accountType == "vat" })
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
    }

    private func accountBadges(_ label: String, _ files: [BankStatementFile]) -> some View {
        let formats = Set(files.map(\.format))
        let complete = formats.contains("PDF") && formats.contains("MT940")
        let problem = files.contains { $0.validation != "valid" || !$0.processed }
        let color: Color = files.isEmpty ? Color.secondary : problem ? CrmTheme.rgb(0xfca5a5) : complete ? CrmTheme.rgb(0x86efac) : CrmTheme.rgb(0xfcd34d)
        return HStack(spacing: 4) {
            Image(systemName: files.isEmpty ? "circle.dashed" : problem ? "exclamationmark.circle.fill" : complete ? "checkmark.circle.fill" : "circle.lefthalf.filled")
                .foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(files.isEmpty ? Color.secondary : Color.primary)
        }
        .help(files.isEmpty ? "Rachunek \(label): brak wyciągu" : "Rachunek \(label): \(formats.sorted().joined(separator: " + "))" + (complete ? " — lista operacji potwierdzona" : " — wgraj drugi format, aby potwierdzić listę operacji"))
        .frame(width: 92, alignment: .leading)
    }

    // MARK: Pliki miesiąca
    @ViewBuilder private func detail(_ list: BankStatementsReply) -> some View {
        let month = store.statementMonth ?? months.first ?? currentMonth
        let files = list.statements.filter { $0.month == month }
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("\(FinFormat.monthsTitle[month - 1]) \(String(list.year))").font(.title3.weight(.semibold))
                    Spacer()
                    if files.contains(where: { $0.processed && $0.validation == "valid" }) {
                        Button { openReconciliation(month: month, year: list.year) } label: { Label("Uzgodnienie miesiąca", systemImage: "arrow.left.arrow.right") }
                            .controlSize(.small)
                    }
                }
                accountCard("Rachunek bieżący", files.filter { $0.accountType == "regular" }, canManage: list.canManage)
                accountCard("Rachunek VAT", files.filter { $0.accountType == "vat" }, canManage: list.canManage)
                Text("Wgraj oba formaty tego samego rachunku (PDF i MT940): operacje z obu plików są parowane po saldzie i tworzą jedną potwierdzoną listę do uzgodnienia. Nową wersję pliku wgrywasz po usunięciu starej — drugi format i pliki innego rachunku zostają.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
        }
    }

    private func openReconciliation(month: Int, year: Int) {
        guard let company = store.company?.id else { return }
        store.period = BankPeriod(companyId: company, year: year, month: month)
        store.selectedTx = nil
        finance.part = .reconciliation
    }

    private func accountCard(_ title: String, _ files: [BankStatementFile], canManage: Bool) -> some View {
        FinCard(title, symbol: "building.columns") {
            if files.isEmpty {
                Text("Brak wyciągu za ten miesiąc.").font(.callout).foregroundStyle(.secondary).padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                        fileRow(file, canManage: canManage)
                        if index < files.count - 1 { Divider().padding(.leading, 14) }
                    }
                }
            }
        }
    }

    private func fileRow(_ file: BankStatementFile, canManage: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(file.format).font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                .background(theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.fileName).font(.callout.weight(.medium)).lineLimit(1).truncationMode(.middle)
                Text([file.account.map { BankFormat.account($0) }, "\(Int(file.count)) operacji", file.createdAt.map { "dodano \(FinFormat.dateTime($0))" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if let opening = file.opening, let closing = file.closing {
                    Text("Saldo: \(FinFormat.money(opening, file.currency)) → \(FinFormat.money(closing, file.currency))").font(.caption).foregroundStyle(.secondary)
                }
                if file.validation != "valid" || !file.processed {
                    Text(file.validationMessage ?? (file.processed ? "Plik wymaga sprawdzenia." : "Import nie został zakończony — usuń plik i wgraj go ponownie."))
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5)).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 6)
            if file.hasFile {
                Button { Task { if let data = await store.file(kind: "statement", id: file.id) { preview = store.show(data) } } } label: { Image(systemName: "eye") }
                    .buttonStyle(.borderless).help(file.format == "PDF" ? "Pokaż plik" : "Pobierz plik do Pobranych")
            }
            if canManage {
                Menu {
                    if file.hasFile {
                        Button("Pobierz do Pobranych") { Task { if let data = await store.file(kind: "statement", id: file.id) { store.save(data) } } }
                    }
                    Button("Zmień nazwę…") { newName = file.fileName; renaming = file }
                    Divider()
                    Button("Usuń ten plik…", role: .destructive) {
                        Task { if let question = await store.checkRemoval(file) { removing = (file, question) } }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).fixedSize()
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}

// MARK: Import wyciągu (jak okno importu w CRM)

@MainActor struct BankStatementImportSheet: View {
    @ObservedObject var store: FinanceBankStore
    let company: FinCompany
    @State var year: Int
    @State var month: Int
    @Environment(\.dismiss) private var dismiss
    @State private var accountType = "regular"
    @State private var format = "PDF"
    @State private var file: URL?
    @State private var question: (title: String, text: String, confirm: String)?

    init(store: FinanceBankStore, company: FinCompany, year: Int, month: Int) {
        self.store = store
        self.company = company
        _year = State(initialValue: year)
        _month = State(initialValue: month)
    }

    var body: some View {
        BankSheetFrame("Wgraj wyciąg", symbol: "square.and.arrow.up", subtitle: company.name) {
            Form {
                Picker("Miesiąc", selection: $month) {
                    ForEach(1...12, id: \.self) { Text(FinFormat.monthsTitle[$0 - 1]).tag($0) }
                }
                Stepper(value: $year, in: 2000...Calendar.current.component(.year, from: Date())) { Text("Rok: \(String(year))") }
                Picker("Rachunek, którego dotyczy wyciąg", selection: $accountType) {
                    Text("Konto bieżące").tag("regular")
                    Text("Konto VAT").tag("vat")
                }
                .pickerStyle(.segmented)
                Picker("Format pliku", selection: $format) {
                    Text("PDF").tag("PDF")
                    Text("MT940 (TXT, STA)").tag("MT940")
                }
                .pickerStyle(.segmented)
                .onChange(of: format) { _, _ in file = nil }
                LabeledContent("Plik") {
                    Button { file = FinanceBankStore.pickFile("Wyciąg \(format)", types: format == "PDF" ? ["pdf"] : ["txt", "sta", "mt940"]) ?? file } label: {
                        Label(file?.lastPathComponent ?? "Wybierz plik…", systemImage: "doc")
                    }
                }
            }
            .formStyle(.grouped)
            Text("PDF musi dotyczyć wybranego miesiąca (kontrola okresu i ciągłości salda). Numer rachunku z pliku jest sprawdzany z rachunkami działalności i zapisanymi wyciągami — import zatrzyma się, gdy wybrano niewłaściwe konto. Po imporcie: transfery między kontem bieżącym i VAT oraz uzgodnienie miesiąca.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 20).padding(.bottom, 12)
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Importuj") { Task { await run(confirmed: false) } }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(file == nil)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 460, idealHeight: 520)
        .alert(question?.title ?? "Sprawdź numer rachunku", isPresented: Binding(get: { question != nil }, set: { if !$0 { question = nil } })) {
            Button("Anuluj import", role: .cancel) { question = nil }
            Button(question?.confirm ?? "Importuj") {
                question = nil
                Task { await run(confirmed: true) }
            }
        } message: { Text(question?.text ?? "") }
    }

    private func run(confirmed: Bool) async {
        guard let file else { return }
        let result = await store.importStatement(company: company.id, year: year, month: month, accountType: accountType, format: format, file: file, confirmed: confirmed)
        if let ask = result.question { question = ask; return }
        if result.done { dismiss() }
    }
}
