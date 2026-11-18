import AppKit
import SwiftUI
import UniformTypeIdentifiers

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

// MARK: Import wyciągu (jak okno importu w CRM) — u góry okres i rachunek, poniżej strefa pliku na całą wysokość okna:
// przeciągnij i upuść albo kliknij, sprawdzenie rozszerzenia i rozmiaru. Format (PDF / MT940) wynika z rozszerzenia pliku —
// nie wybiera się go wcześniej.

@MainActor struct BankStatementImportSheet: View {
    @ObservedObject var store: FinanceBankStore
    let company: FinCompany
    @State var year: Int
    @State var month: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var accountType = "regular"
    @State private var file: URL?
    @State private var fileSize: Int?
    @State private var dropTargeted = false
    @State private var dropError: String?
    @State private var question: (title: String, text: String, confirm: String)?

    /// Limit pliku jak przy przesyłaniu (`importStatement`).
    private static let limit = 10 * 1024 * 1024
    private static let pdfTypes = ["pdf"]
    private static let mt940Types = ["txt", "sta", "mt940"]
    /// Rozpoznany format pliku (jak pole „Format” w CRM): PDF albo MT940.
    private static func detectFormat(_ url: URL) -> String? {
        let ext = url.pathExtension.lowercased()
        return pdfTypes.contains(ext) ? "PDF" : mt940Types.contains(ext) ? "MT940" : nil
    }

    init(store: FinanceBankStore, company: FinCompany, year: Int, month: Int) {
        self.store = store
        self.company = company
        _year = State(initialValue: year)
        _month = State(initialValue: month)
    }

    private var format: String? { file.flatMap(Self.detectFormat) }
    private var currentYear: Int { Calendar.current.component(.year, from: Date()) }

    var body: some View {
        BankSheetFrame("Wgraj wyciąg", symbol: "square.and.arrow.up", subtitle: company.name) {
            VStack(alignment: .leading, spacing: 14) {
                settings
                dropZone.frame(maxWidth: .infinity, maxHeight: .infinity)
                Text("PDF musi dotyczyć wybranego miesiąca (kontrola okresu i ciągłości salda). Numer rachunku z pliku jest sprawdzany z rachunkami działalności i zapisanymi wyciągami — import zatrzyma się, gdy wybrano niewłaściwe konto. Po imporcie: transfery między kontem bieżącym i VAT oraz uzgodnienie miesiąca.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } footer: {
            if let file {
                Label(file.lastPathComponent, systemImage: "doc").font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Importuj") { Task { await run(confirmed: false) } }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(file == nil)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 520, idealHeight: 600)
        .alert(question?.title ?? "Sprawdź numer rachunku", isPresented: Binding(get: { question != nil }, set: { if !$0 { question = nil } })) {
            Button("Anuluj import", role: .cancel) { question = nil }
            Button(question?.confirm ?? "Importuj") {
                question = nil
                Task { await run(confirmed: true) }
            }
        } message: { Text(question?.text ?? "") }
    }

    // MARK: Okres i rachunek
    private var settings: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
            GridRow {
                Text("Okres").foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                HStack(spacing: 8) {
                    Picker("", selection: $month) {
                        ForEach(1...12, id: \.self) { Text(FinFormat.monthsTitle[$0 - 1]).tag($0) }
                    }
                    .labelsHidden().fixedSize()
                    Picker("", selection: $year) {
                        ForEach(Array(max(2000, min(year, currentYear) - 5)...currentYear).reversed(), id: \.self) { Text(String($0)).tag($0) }
                    }
                    .labelsHidden().fixedSize()
                }
            }
            GridRow {
                Text("Rachunek").foregroundStyle(.secondary)
                Picker("", selection: $accountType) {
                    Text("Konto bieżące").tag("regular")
                    Text("Konto VAT").tag("vat")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Strefa pliku
    private var dropZone: some View {
        let accent = theme.accent
        let border: Color = dropTargeted ? accent : dropError != nil ? CrmTheme.rgb(0xf87171) : file != nil ? CrmTheme.rgb(0x4ade80).opacity(0.7) : Color.secondary.opacity(0.45)
        return ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(dropTargeted ? accent.opacity(0.10) : Color.primary.opacity(0.03))
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(border, style: StrokeStyle(lineWidth: dropTargeted ? 2.5 : 1.5, dash: file == nil || dropTargeted ? [7, 5] : []))
            if dropTargeted {
                VStack(spacing: 10) {
                    Image(systemName: "arrow.down.doc.fill").font(.system(size: 44)).foregroundStyle(accent)
                    Text("Upuść, aby dodać wyciąg").font(.title3.weight(.semibold))
                }
            } else if let file {
                selectedFile(file)
            } else {
                emptyState
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .onTapGesture { if file == nil { choose() } }
        .onDrop(of: [UTType.fileURL], isTargeted: $dropTargeted) { providers in
            guard !providers.isEmpty else { return false }
            if providers.count > 1 { dropError = "Upuść jeden plik — każdy wyciąg importujesz osobno." }
            guard let provider = providers.first else { return false }
            // Liczba plików przed wczytaniem — zamknięcie nie przechwytuje tablicy dostawców (nie jest Sendable).
            let multiple = providers.count > 1
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                Task { @MainActor in
                    if let url { accept(url, dropped: true, multiple: multiple) } else { dropError = "Nie udało się odczytać upuszczonego pliku." }
                }
            }
            return true
        }
        .animation(.easeOut(duration: 0.12), value: dropTargeted)
        .help(file == nil ? "Przeciągnij plik wyciągu albo kliknij, aby wybrać go z dysku" : "Przeciągnij inny plik, aby go zastąpić")
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.down.doc").font(.system(size: 42)).foregroundStyle(theme.accent.opacity(0.85))
            VStack(spacing: 4) {
                Text("Przeciągnij tutaj plik wyciągu").font(.title3.weight(.semibold))
                Text("albo kliknij, aby wybrać go z dysku").foregroundStyle(.secondary)
            }
            Button { choose() } label: { Label("Wybierz plik…", systemImage: "folder") }
            Text("PDF albo MT940 (.txt, .sta, .mt940) · do 10 MB — format rozpoznawany po rozszerzeniu")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let dropError {
                Label(dropError, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5))
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(24)
    }

    private func selectedFile(_ file: URL) -> some View {
        VStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Image(systemName: file.pathExtension.lowercased() == "pdf" ? "doc.richtext.fill" : "doc.plaintext.fill")
                    .font(.system(size: 46)).foregroundStyle(theme.accent)
                Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(CrmTheme.rgb(0x4ade80))
                    .background(Circle().fill(Color(nsColor: .windowBackgroundColor))).offset(x: 6, y: 4)
            }
            VStack(spacing: 3) {
                Text(file.lastPathComponent).font(.headline).lineLimit(2).multilineTextAlignment(.center).truncationMode(.middle)
                Text(fileDetails).font(.caption).foregroundStyle(.secondary)
                Text("\(FinFormat.monthsTitle[month - 1]) \(String(year)) · \(accountType == "vat" ? "konto VAT" : "konto bieżące")")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button { choose() } label: { Label("Zmień plik…", systemImage: "arrow.triangle.2.circlepath") }
                Button(role: .destructive) { clearFile() } label: { Label("Usuń", systemImage: "xmark") }
            }
            .controlSize(.small)
            if let dropError {
                Text(dropError).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).multilineTextAlignment(.center)
            }
        }
        .padding(24)
    }

    private var fileDetails: String {
        var parts = [format == "PDF" ? "Rozpoznano: wyciąg PDF" : "Rozpoznano: wyciąg MT940"]
        if let fileSize { parts.append(ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file)) }
        return parts.joined(separator: " · ")
    }

    // MARK: Wybór i kontrola pliku
    private func choose() {
        guard let url = FinanceBankStore.pickFile("Wyciąg bankowy (PDF albo MT940)", types: Self.pdfTypes + Self.mt940Types) else { return }
        accept(url, dropped: false, multiple: false)
    }

    /// Plik z okna wyboru albo upuszczony: folder i nieobsługiwany typ odrzucone, format według rozszerzenia, limit rozmiaru.
    private func accept(_ url: URL, dropped: Bool, multiple: Bool) {
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            dropError = "To jest folder — upuść pojedynczy plik wyciągu."
            return
        }
        guard Self.detectFormat(url) != nil else {
            dropError = "„\(url.lastPathComponent)” nie jest wyciągiem. Obsługiwane: PDF albo MT940 (.txt, .sta, .mt940)."
            return
        }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
        if let size, size > Self.limit {
            dropError = "Plik „\(url.lastPathComponent)” ma \(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)) — limit to 10 MB."
            return
        }
        if size == 0 {
            dropError = "Plik „\(url.lastPathComponent)” jest pusty."
            return
        }
        file = url
        fileSize = size
        dropError = multiple ? "Dodano pierwszy plik — każdy wyciąg importujesz osobno." : nil
    }

    private func clearFile() {
        file = nil
        fileSize = nil
        dropError = nil
    }

    private func run(confirmed: Bool) async {
        guard let file, let format else { return }
        let result = await store.importStatement(company: company.id, year: year, month: month, accountType: accountType, format: format, file: file, confirmed: confirmed)
        if let ask = result.question { question = ask; return }
        if result.done { dismiss() }
    }
}
