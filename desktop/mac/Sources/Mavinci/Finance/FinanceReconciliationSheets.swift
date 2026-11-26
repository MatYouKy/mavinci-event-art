import AppKit
import SwiftUI

// MARK: Okna uzgodnienia (jak w CRM): wybór dokumentu do płatności, wyjaśnienie bez faktury, przypisanie do deklaracji,
// do umowy stałej (z nową umową z płatności), para „płatność + zwrot”, szczegóły operacji i podgląd dokumentu.

/// Ramka okna: tytuł, opis operacji, treść i przyciski na dole.
struct BankSheetFrame<Content: View, Footer: View>: View {
    let title: String
    let symbol: String
    let subtitle: String?
    /// Trwająca czynność (`FinanceBankStore.busy`, np. import wyciągu) — wskaźnik postępu nad arkuszem i zablokowane przyciski.
    /// Wskaźnik okna głównego (`Workspace.pending`) jest pod arkuszem, więc bez tego nie było widać, że coś się dzieje.
    let busy: String?
    let content: () -> Content
    let footer: () -> Footer

    init(_ title: String, symbol: String, subtitle: String? = nil, busy: String? = nil, @ViewBuilder content: @escaping () -> Content, @ViewBuilder footer: @escaping () -> Footer) {
        self.title = title
        self.symbol = symbol
        self.subtitle = subtitle
        self.busy = busy
        self.content = content
        self.footer = footer
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Label(title, systemImage: symbol).font(.title3.bold())
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 18).padding(.bottom, 10)
            Divider()
            content().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            HStack { footer() }.padding(14).crmBar()
        }
        .disabled(busy != nil)
        .overlay { if let busy { PendingOverlay(text: busy) } }
        .interactiveDismissDisabled(busy != nil)
    }
}

private func txSubtitle(_ tx: BankTx, remaining: Bool = true) -> String {
    var parts = [FinFormat.day(tx.date), tx.signedAmount]
    if remaining && tx.remaining < tx.amount - 0.009 { parts.append("do rozliczenia \(FinFormat.money(tx.remaining, tx.currency))") }
    parts.append(tx.displayName)
    if let title = tx.title { parts.append(title) }
    return parts.joined(separator: " · ")
}

// MARK: Wybór dokumentu do płatności (`BankTransactionDocumentPickerModal`)

@MainActor struct BankDocumentPickerSheet: View {
    @ObservedObject var store: FinanceBankStore
    let tx: BankTx
    @Environment(\.dismiss) private var dismiss
    @State private var data: BankPicker?
    @State private var loadError: String?
    @State private var search = ""
    @State private var source = "all"
    @State private var payment = "all"
    @State private var useFrom = false
    @State private var useTo = false
    @State private var from = Date()
    @State private var to = Date()
    @State private var exception: BankPicker.Document?
    @State private var exceptionNote = ""
    @State private var exceptionConfirmed = false
    @State private var preview: BankPreviewItem?

    private var visible: [BankPicker.Document] {
        guard let data else { return [] }
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        let numeric = BankFormat.parse(needle)
        let fromText = FinanceText.dayString(from)
        let toText = FinanceText.dayString(to)
        let remaining = data.transaction.remaining
        return data.documents
            .filter { source == "all" || $0.source == source }
            .filter { payment == "all" || (payment == "paid" ? $0.paid : !$0.paid) }
            .filter { !useFrom || ($0.issueDate.map { $0 >= fromText } ?? false) }
            .filter { !useTo || ($0.issueDate.map { $0 <= toText } ?? false) }
            .filter { doc in
                guard !needle.isEmpty else { return true }
                let text = [doc.number, doc.counterparty ?? "", doc.issueDate ?? "", doc.kindLabel].joined(separator: " ").lowercased()
                if text.contains(needle) { return true }
                guard let numeric else { return false }
                return abs(doc.gross - numeric) <= 0.01 || abs(doc.outstanding - numeric) <= 0.01
            }
            .sorted { left, right in
                let l = abs((left.outstanding != 0 ? left.outstanding : left.gross) - remaining)
                let r = abs((right.outstanding != 0 ? right.outstanding : right.gross) - remaining)
                if l != r { return l < r }
                return (left.issueDate ?? "") > (right.issueDate ?? "")
            }
    }

    var body: some View {
        BankSheetFrame("Dopasuj dokument do płatności", symbol: "doc.text.magnifyingglass",
                       subtitle: data.map { "\(FinFormat.day($0.transaction.date)) · \(FinFormat.money($0.transaction.remaining, $0.transaction.currency)) do rozliczenia · \($0.transaction.counterparty ?? "bez kontrahenta")" } ?? txSubtitle(tx), busy: store.busy) {
            if let data {
                VStack(spacing: 0) {
                    filters.padding(.horizontal, 16).padding(.vertical, 8)
                    Divider()
                    if let exception { exceptionPanel(exception, data: data) } else { list(data) }
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać dokumentów", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
            } else {
                ProgressView("Pobieranie dokumentów…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Text("Filtry działają od razu — stan pod paskiem filtrów. Kolejność: najbliższa kwota do rozliczenia, potem najnowsze. Mniejsza kwota niż do zapłaty — płatność częściowa (np. rata).")
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 900, idealWidth: 1000, minHeight: 620, idealHeight: 720)
        .task { await load() }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    private func load() async {
        loadError = nil
        do {
            let reply = try await store.get(["op": "picker", "transaction": tx.id, "allocated": String(tx.allocated)], as: BankPicker.self)
            // Zakres dat po włączeniu „od” / „do”: trzy miesiące przed płatnością do dnia płatności (faktura zwykle jest wcześniej).
            if !useFrom, !useTo, let paid = FinanceText.dayDate(reply.transaction.date) {
                to = paid
                from = Calendar.current.date(byAdding: .month, value: -3, to: paid) ?? paid
            }
            data = reply
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać dokumentów.")
        }
    }

    private static let sources: [(String, String)] = [("all", "Wszystkie typy"), ("ksef", "KSeF"), ("invoice", "CRM"), ("external", "Spoza KSeF"), ("personnel", "Kadrowe")]
    private static let payments: [(String, String)] = [("all", "Wszystkie statusy"), ("paid", "Opłacone"), ("unpaid", "Nieopłacone / częściowe")]

    /// Włączone filtry (wiersz stanu pod paskiem — `FinFilterSummary`); × wyłącza jeden filtr.
    private var chips: [FinFilterChip] {
        var result: [FinFilterChip] = []
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { result.append(FinFilterChip(label: "Szukaj: „\(needle)”") { search = "" }) }
        if source != "all", let label = Self.sources.first(where: { $0.0 == source })?.1 {
            result.append(FinFilterChip(label: "Typ: \(label)") { source = "all" })
        }
        if payment != "all", let label = Self.payments.first(where: { $0.0 == payment })?.1 {
            result.append(FinFilterChip(label: "Status: \(label)") { payment = "all" })
        }
        if useFrom { result.append(FinFilterChip(label: "Wystawione od \(FinFormat.day(FinanceText.dayString(from)))") { useFrom = false }) }
        if useTo { result.append(FinFilterChip(label: "Wystawione do \(FinFormat.day(FinanceText.dayString(to)))") { useTo = false }) }
        return result
    }

    private func clearFilters() {
        search = ""; source = "all"; payment = "all"; useFrom = false; useTo = false
    }

    private var filters: some View {
        let all = data?.documents ?? []
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("Szukaj po numerze, kontrahencie lub kwocie…", text: $search).textFieldStyle(.roundedBorder)
                    .finFilterActive(!search.trimmingCharacters(in: .whitespaces).isEmpty)
                Picker("", selection: $source) {
                    // Liczba dokumentów każdego typu — widać, ile zostanie po wyborze.
                    ForEach(Self.sources, id: \.0) { item in
                        let count = item.0 == "all" ? all.count : all.filter { $0.source == item.0 }.count
                        Text("\(item.1) (\(count))").tag(item.0)
                    }
                }
                .labelsHidden().fixedSize().finFilterActive(source != "all")
                Picker("", selection: $payment) {
                    ForEach(Self.payments, id: \.0) { Text($0.1).tag($0.0) }
                }
                .labelsHidden().fixedSize().finFilterActive(payment != "all")
                HStack(spacing: 4) {
                    Toggle("od", isOn: $useFrom).toggleStyle(.checkbox).fixedSize()
                    if useFrom { DatePicker("", selection: $from, displayedComponents: .date).labelsHidden().fixedSize() }
                }
                .finFilterActive(useFrom)
                HStack(spacing: 4) {
                    Toggle("do", isOn: $useTo).toggleStyle(.checkbox).fixedSize()
                    if useTo { DatePicker("", selection: $to, displayedComponents: .date).labelsHidden().fixedSize() }
                }
                .finFilterActive(useTo)
            }
            .controlSize(.small)
            FinFilterSummary(shown: visible.count, total: all.count, forms: ("dokument", "dokumenty", "dokumentów"), chips: chips) { clearFilters() }
        }
    }

    private func list(_ data: BankPicker) -> some View {
        let items = visible
        return Group {
            if items.isEmpty {
                ContentUnavailableView {
                    Label("Brak dokumentów dla wybranych filtrów", systemImage: "doc.text.magnifyingglass")
                } description: {
                    Text(chips.isEmpty ? "Nie ma dokumentów, które można dopasować do tej płatności." : "Włączone filtry: \(chips.map(\.label).joined(separator: ", ")).")
                } actions: {
                    if !chips.isEmpty { Button("Wyczyść filtry") { clearFilters() } }
                }
            } else {
                List(items, id: \.key) { doc in row(doc, data: data) }.listStyle(.inset)
            }
        }
    }

    private func status(_ doc: BankPicker.Document) -> (String, Color) {
        if doc.source == "personnel" { return (doc.paid ? "już dopasowana" : "Netto na konto", doc.paid ? Color.secondary : CrmTheme.rgb(0x93c5fd)) }
        if doc.paid { return ("Opłacona", CrmTheme.rgb(0x86efac)) }
        if doc.partiallyPaid { return ("Częściowo opłacona", CrmTheme.rgb(0x93c5fd)) }
        return ("Nieopłacona", CrmTheme.rgb(0xfcd34d))
    }

    private func row(_ doc: BankPicker.Document, data: BankPicker) -> some View {
        let state = status(doc)
        let otherCurrency = doc.currency.uppercased() != data.transaction.currency.uppercased()
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(doc.kindLabel).font(.caption2).padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 4))
                    Text(doc.number.isEmpty ? "bez numeru" : doc.number).font(.callout.weight(.medium)).lineLimit(1)
                }
                Text(doc.counterparty ?? "—").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text("wystawiona \(FinFormat.day(doc.issueDate))" + (doc.dueDate.map { " · termin \(FinFormat.day($0))" } ?? ""))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 2) {
                Text(FinFormat.money(doc.gross, doc.currency)).monospacedDigit()
                if doc.outstanding > 0.009 && abs(doc.outstanding - doc.gross) > 0.009 {
                    Text("do zapłaty \(FinFormat.money(doc.outstanding, doc.currency))").font(.caption).foregroundStyle(.secondary)
                }
                if otherCurrency { Text("inna waluta").font(.caption2).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
            }
            .frame(width: 170, alignment: .trailing)
            Text(state.0).font(.caption).foregroundStyle(state.1).frame(width: 120, alignment: .leading)
            VStack(alignment: .trailing, spacing: 3) {
                if data.canManage { action(doc) }
                if doc.previewable {
                    Button("Podgląd") { Task { preview = await store.preview(source: doc.source, id: doc.id) } }.buttonStyle(.link).font(.caption)
                }
            }
            .frame(width: 170, alignment: .trailing)
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder private func action(_ doc: BankPicker.Document) -> some View {
        if doc.cashException {
            VStack(alignment: .trailing, spacing: 2) {
                Text("Na dokumencie: gotówka").font(.caption2).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                Button("Potwierdź wyjątek") { exception = doc; exceptionNote = ""; exceptionConfirmed = false }.controlSize(.small)
            }
        } else if let blocking = doc.blocking {
            Text(blocking).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.trailing).lineLimit(3)
        } else {
            Button(doc.plannedPartial ? "Dopasuj część" : "Dopasuj") { Task { await match(doc, note: nil) } }
                .buttonStyle(.borderedProminent).controlSize(.small)
                .help(doc.plannedPartial
                      ? "Płatność rozliczy \(FinFormat.money(doc.plannedAmount, doc.currency)); po dopasowaniu zostanie \(FinFormat.money(doc.plannedLeft, doc.currency))."
                      : "Dopasuj dokument do tej płatności")
        }
    }

    private func exceptionPanel(_ doc: BankPicker.Document, data: BankPicker) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Label("Potwierdź rzeczywisty sposób zapłaty", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                Text("Faktura KSeF wskazuje gotówkę. Potwierdź wyjątek tylko jeśli sprawdziłeś, że wybrana płatność z wyciągu rzeczywiście dotyczy tego dokumentu, np. zakupu przez Allegro. Zgodna kwota sama w sobie nie wystarcza.")
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(doc.number) · \(doc.counterparty ?? "—") · \(FinFormat.money(doc.gross, doc.currency))\(data.transaction.title.map { " · \($0)" } ?? "")")
                    .font(.callout.weight(.medium))
                Text("Zapiszemy uzasadnienie przy powiązaniu. Nie zmienimy oryginalnej faktury ani jej XML. Wcześniejsze oznaczenie „Opłacona” zostanie powiązane z wyciągiem bez podwójnego naliczenia zapłaty.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("Uzasadnienie powiązania *").font(.caption)
                TextEditor(text: $exceptionNote).font(.body).frame(minHeight: 80).padding(4)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                Text("Wyjaśnij, skąd wiesz, że ta płatność dotyczy faktury (np. numer zamówienia lub potwierdzenie Allegro).").font(.caption2).foregroundStyle(.secondary)
                Toggle("Sprawdziłem powiązanie. To ta sama zapłata, a nie dodatkowa płatność gotówką.", isOn: $exceptionConfirmed).toggleStyle(.checkbox)
                HStack {
                    Button("Anuluj wyjątek") { exception = nil }
                    Spacer()
                    Button("Potwierdź wyjątek i dopasuj") { Task { await match(doc, note: exceptionNote) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!exceptionConfirmed || exceptionNote.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                }
            }
            .padding(18)
        }
    }

    private func match(_ doc: BankPicker.Document, note: String?) async {
        var body: [String: JSONValue] = [
            "transactionId": .string(tx.id), "source": .string(doc.source), "documentId": .string(doc.id), "allocated": .number(tx.allocated),
        ]
        if let note { body["cashNote"] = .string(note.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if await store.reconcileAction("Dopasowywanie dokumentu…", "match", body) { dismiss() }
    }
}

// MARK: Wyjaśnienie bez faktury (`BankTransactionAccountingModal`)

@MainActor struct BankExplainSheet: View {
    @ObservedObject var store: FinanceBankStore
    let tx: BankTx
    let initialSubtype: String
    @Environment(\.dismiss) private var dismiss
    @State private var setup: BankExplainSetup?
    @State private var loadError: String?
    @State private var subtype = ""
    @State private var note = ""
    @State private var file: URL?
    @State private var counterpart: String?

    private var action: BankExplainSetup.Action? { setup?.actions.first { $0.subtype == subtype } }
    private var isVatTransfer: Bool { subtype == "automatic_vat_transfer" }
    private var resolved: Bool {
        guard let action else { return false }
        if isVatTransfer { return counterpart != nil }
        if action.alwaysPending { return false }
        if action.resolvesWithoutDocument { return true }
        return action.requiresDocument ? file != nil : false
    }

    var body: some View {
        BankSheetFrame("Wyjaśnij płatność", symbol: "arrow.left.arrow.right", subtitle: "\(FinFormat.money(tx.amount, tx.currency)) · \(tx.displayName)", busy: store.busy) {
            if let setup {
                form(setup)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć wyjaśnienia", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button(isVatTransfer ? "Połącz operacje" : "Zapisz wyjaśnienie") { Task { await save() } }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(setup == nil || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (isVatTransfer && counterpart == nil))
        }
        .frame(minWidth: 640, idealWidth: 700, minHeight: 600, idealHeight: 700)
        .task { await load() }
    }

    private func load() async {
        loadError = nil
        do {
            let reply = try await store.get(["op": "explain", "transaction": tx.id], as: BankExplainSetup.self)
            let initial = reply.actions.first { $0.subtype == initialSubtype } ?? reply.actions.last
            subtype = initial?.subtype ?? ""
            note = reply.note?.nonEmpty ?? initial?.defaultNote ?? ""
            setup = reply
        } catch {
            loadError = store.failureText(error, "Nie udało się otworzyć wyjaśnienia.")
        }
    }

    private func form(_ setup: BankExplainSetup) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Rodzaj operacji").font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: Binding(get: { subtype }, set: { next in
                        subtype = next
                        note = setup.actions.first { $0.subtype == next }?.defaultNote ?? ""
                        file = nil
                        counterpart = nil
                    })) {
                        ForEach(setup.actions) { item in Text(item.label).tag(item.subtype) }
                    }
                    .labelsHidden()
                }
                if subtype == "owner_deposit" || subtype == "owner_withdrawal" {
                    FinBanner(text: "W działalności jednoosobowej wystarczy opis. W spółce (np. sp. z o.o.) wpłata lub wypłata wspólnika wymaga podstawy — umowy pożyczki, dopłaty do kapitału albo rozliczenia zaliczki — wpisz ją w opisie dla księgowości.")
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Opis księgowy").font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $note).font(.body).frame(minHeight: 90).padding(4)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                }
                if isVatTransfer || subtype == "vat7_payment" { vatPanel(setup) }
                if subtype == "payroll_payment" {
                    FinBanner(text: "Sprawdź sposób wypłaty na liście płac. Jeżeli widnieje „GOT”, dokument opisuje gotówkę; „ROR” oznacza przelew na rachunek.")
                }
                if let action = action, action.requiresDocument {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Dokument źródłowy — \(action.documentLabel ?? "dokument")").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button { file = FinanceBankStore.pickFile("Dokument źródłowy", types: ["pdf", "jpg", "jpeg", "png", "webp"]) ?? file } label: {
                                Label(file?.lastPathComponent ?? "Wybierz plik (PDF, JPG, PNG, WEBP, do 15 MB)", systemImage: "paperclip")
                            }
                            if file != nil { Button("Usuń") { file = nil }.buttonStyle(.borderless) }
                        }
                    }
                }
                Text(statusText).font(.caption).fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(resolved ? CrmTheme.rgb(0x86efac) : CrmTheme.rgb(0xfcd34d))
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background((resolved ? CrmTheme.rgb(0x22c55e) : CrmTheme.rgb(0xf59e0b)).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            .padding(18)
        }
    }

    private var statusText: String {
        if isVatTransfer {
            return counterpart != nil ? "Po zapisaniu obie operacje zostaną połączone i uznane za wyjaśnione bez dokumentu." : "Wybierz odpowiadającą operację z drugiego rachunku, aby zamknąć obie strony transferu."
        }
        if resolved { return "Po zapisaniu pozycja zostanie uznana za wyjaśnioną bez faktury i zniknie z listy do rozliczenia." }
        if action?.alwaysPending == true { return "Pozycja pozostanie na liście do czasu pozyskania właściwej faktury." }
        return "Bez dokumentu pozycja pozostanie na liście do kontroli."
    }

    private func vatPanel(_ setup: BankExplainSetup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(isVatTransfer ? "Połącz obie strony transferu" : "Sprawdź drugą stronę operacji", systemImage: "arrow.left.arrow.right").font(.headline)
            Text(isVatTransfer
                 ? "Pokazujemy operacje tej samej działalności, o tej samej kwocie i walucie, przeciwnym kierunku oraz dacie oddalonej maksymalnie o 7 dni."
                 : "Jeśli to automatyczne przeksięgowanie, wybierz przeciwną operację z rachunku VAT lub bieżącego. Klasyfikacja zmieni się na transfer własny bez dokumentu.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let statement = setup.statement {
                Text("Bieżąca operacja · \(statement.accountType == "vat" ? "Rachunek VAT" : "Rachunek bieżący")\(statement.accountSuffix.map { " \($0)" } ?? "") · \(tx.signedAmount) · \(FinFormat.day(tx.date))\(statement.fileName.map { " · \($0)" } ?? "")")
                    .font(.caption)
            }
            if let error = setup.vatCandidatesError {
                Text(error).font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5))
            } else if setup.vatCandidates.isEmpty {
                Text(subtype == "vat7_payment"
                     ? "Ten wariant służy płatności podatku do urzędu. Jeśli jest to automatyczne przeksięgowanie pomiędzy rachunkiem bieżącym i VAT, wybierz „Automatyczny transfer: rachunek bieżący ↔ VAT” — wtedy dokument nie będzie wymagany."
                     : "Brak pasującej operacji na drugim rachunku.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
            } else {
                if subtype == "vat7_payment" {
                    Text("To prawdopodobnie transfer między własnymi rachunkami. Wybierz pasującą operację poniżej. Zostanie ona połączona z bieżącą płatnością jako transfer własny, bez deklaracji i bez innego dokumentu.")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0x7dd3fc)).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(setup.vatCandidates) { candidate in
                    let selected = counterpart == candidate.id
                    Button {
                        if subtype != "automatic_vat_transfer" {
                            subtype = "automatic_vat_transfer"
                            note = setup.actions.first { $0.subtype == "automatic_vat_transfer" }?.defaultNote ?? "Automatyczny transfer pomiędzy rachunkiem bieżącym a rachunkiem VAT."
                        }
                        counterpart = candidate.id
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(candidate.accountType == "vat" ? "Rachunek VAT" : "Rachunek bieżący")\(candidate.accountSuffix.map { " \($0)" } ?? "") · \(candidate.direction == "credit" ? "+" : "−")\(FinFormat.money(candidate.amount, candidate.currency))")
                                    .font(.callout)
                                Text("\(FinFormat.day(candidate.date))\(candidate.dayDistance > 0 ? " · różnica \(candidate.dayDistance) dni" : " · ten sam dzień") · \(candidate.counterparty ?? "Operacja bez opisu")")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                if let file = candidate.fileName { Text("Źródło: \(file)").font(.caption2).foregroundStyle(.tertiary) }
                            }
                            Spacer()
                        }
                        .padding(8)
                        .background(selected ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(12)
        .background(CrmTheme.rgb(0x38bdf8).opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func save() async {
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { store.workspace?.notice = "Dodaj krótki opis księgowy."; return }
        if let file, !isVatTransfer {
            guard let workspace = store.workspace else { return }
            guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
            do {
                let reply = try await workspace.withPending("Zapisywanie wyjaśnienia z dokumentem…") {
                    try await store.upload("explainFile", fields: ["transactionId": tx.id, "subtype": subtype, "note": text], file: file, limit: 15 * 1024 * 1024)
                }
                store.announce(reply)
                await store.loadMonth(force: true)
                dismiss()
            } catch {
                workspace.error = store.failureText(error, "Nie udało się zapisać wyjaśnienia.")
            }
            return
        }
        var body: [String: JSONValue] = ["transactionId": .string(tx.id), "subtype": .string(subtype), "note": .string(text)]
        if let counterpart { body["counterpartId"] = .string(counterpart) }
        if await store.reconcileAction("Zapisywanie wyjaśnienia…", "explain", body) { dismiss() }
    }
}

// MARK: Przypisanie przelewu do deklaracji (`DeclarationLinkModal`)

@MainActor struct BankDeclarationLinkSheet: View {
    @ObservedObject var store: FinanceBankStore
    let tx: BankTx
    @Environment(\.dismiss) private var dismiss
    @State private var reply: FinDeclarationsReply?
    @State private var loadError: String?
    @State private var creating = false

    private var year: Int { Int(tx.date.prefix(4)) ?? Calendar.current.component(.year, from: Date()) }
    private var companyID: String? { store.period?.companyId ?? store.company?.id }

    var body: some View {
        BankSheetFrame("Przypisz przelew do deklaracji", symbol: "building.columns",
                       subtitle: "\(FinFormat.day(tx.date)) · \(FinFormat.money(tx.remaining, tx.currency)) · \(tx.title ?? "")", busy: store.busy) {
            if let reply {
                if reply.declarations.isEmpty {
                    ContentUnavailableView("Brak deklaracji w \(year - 1)–\(year)", systemImage: "building.columns", description: Text("Dodaj nową poniżej."))
                } else {
                    List(reply.declarations) { d in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.label).font(.callout.weight(.medium))
                                Text("\(d.amountDue.map { "do zapłaty \(FinFormat.money($0))" } ?? "bez kwoty") · zapłacono \(FinFormat.money(d.paid))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            BankChip(text: DeclarationStatus.label(d.status), color: DeclarationStatus.color(d.status))
                            Button { Task { await link(d.id) } } label: { Label("Przypisz", systemImage: "link") }.controlSize(.small)
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.inset)
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać deklaracji", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView("Wczytywanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Button { creating = true } label: { Label("Nowa deklaracja", systemImage: "plus") }.disabled(companyID == nil)
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 620, idealWidth: 660, minHeight: 480, idealHeight: 560)
        .task { await load() }
        .sheet(isPresented: $creating) {
            if let companyID {
                DeclarationFormSheet(store: store, companyID: companyID, declaration: nil, initial: DeclarationFormSheet.Initial(kind: "zus", form: "DRA", periodKind: "month", periodStart: previousMonth)) { id in
                    Task { await link(id) }
                }
            }
        }
    }

    private var previousMonth: String {
        let parts = tx.date.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2 else { return "" }
        let month = parts[1] == 1 ? 12 : parts[1] - 1
        let year = parts[1] == 1 ? parts[0] - 1 : parts[0]
        return String(format: "%04d-%02d-01", year, month)
    }

    private func load() async {
        guard let companyID else { return }
        loadError = nil
        do {
            reply = try await store.get(["op": "declarations", "company": companyID, "years": "\(year),\(year - 1)"], as: FinDeclarationsReply.self)
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać deklaracji.")
        }
    }

    private func link(_ declarationID: String) async {
        let body: [String: JSONValue] = ["transactionId": .string(tx.id), "declarationId": .string(declarationID), "amount": .number(tx.remaining)]
        if await store.reconcileAction("Przypisywanie przelewu…", "linkDeclaration", body) { dismiss() }
    }
}

// MARK: Przypisanie do umowy stałej (`RecurringContractLinkModal`)

@MainActor struct BankContractLinkSheet: View {
    @ObservedObject var store: FinanceBankStore
    let tx: BankTx
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: BankContractCandidates?
    @State private var loadError: String?
    @State private var selected: String?
    @State private var period = ""
    @State private var amount = ""
    @State private var creating = false

    var body: some View {
        BankSheetFrame("Przypisz do umowy stałej", symbol: "calendar.badge.clock", subtitle: subtitle, busy: store.busy) {
            if let data {
                if data.contracts.isEmpty {
                    ContentUnavailableView("Brak umów \(tx.credit ? "przychodowych" : "kosztowych") w \(tx.currency)", systemImage: "calendar.badge.clock",
                                           description: Text("Utwórz umowę z tej płatności poniżej."))
                } else {
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(data.contracts) { contract in card(contract, best: data.bestId == contract.id) }
                        }
                        .padding(14)
                    }
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać umów stałych", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView("Wczytywanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Button { creating = true } label: { Label("Nowa umowa z tej płatności", systemImage: "plus") }.disabled(data == nil)
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 700, idealWidth: 760, minHeight: 540, idealHeight: 640)
        .task { await load() }
        .sheet(isPresented: $creating) {
            if let data {
                ContractFormSheet(store: store, companyID: data.companyId, contract: nil, transaction: data.transaction) { id in
                    Task { await link(id, period: nil, amount: nil) }
                }
            }
        }
    }

    private var subtitle: String {
        var text = "\(FinFormat.day(tx.date)) · \(tx.credit ? "wpływ" : "wydatek") \(FinFormat.money(tx.remaining, tx.currency))"
        if tx.remaining < tx.amount - 0.009 { text += " (z \(FinFormat.money(tx.amount, tx.currency)))" }
        text += " · \(tx.counterparty ?? "bez nazwy")"
        if let account = tx.counterpartyAccount?.nonEmpty { text += " · \(BankFormat.account(account))" }
        if let title = tx.title { text += "\n\(title)" }
        return text
    }

    private func load() async {
        loadError = nil
        do {
            let reply = try await store.get(["op": "contracts", "transaction": tx.id, "remaining": String(tx.remaining)], as: BankContractCandidates.self)
            data = reply
            if selected == nil, let best = reply.contracts.first(where: { $0.id == reply.bestId }) { choose(best) }
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać umów stałych.")
        }
    }

    private func choose(_ contract: BankContractCandidates.Contract) {
        selected = contract.id
        period = contract.suggestedPeriod ?? ""
        amount = BankFormat.plain(contract.suggestedAmount)
    }

    private func card(_ c: BankContractCandidates.Contract, best: Bool) -> some View {
        let isSelected = selected == c.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if best { Image(systemName: "sparkles").foregroundStyle(theme.accent) }
                Text(c.title).font(.callout.weight(.semibold))
                Text(c.counterparty).font(.caption).foregroundStyle(.secondary)
                if c.ended { BankChip(text: "zakończona", color: CrmTheme.rgb(0xcbd5e1)) }
                Spacer()
                if c.expectsInvoice {
                    Text("rozliczana fakturami — przypisz do faktury").font(.caption).foregroundStyle(.secondary)
                } else if !isSelected {
                    Button { choose(c) } label: { Label("Wybierz", systemImage: "checkmark") }.controlSize(.small)
                }
            }
            HStack(spacing: 6) {
                Text("\(FinFormat.money(c.amount, c.currency)) \(ContractStatus.cycle(c.cycle))").font(.caption).foregroundStyle(.secondary)
                if c.evidence.account { BankChip(text: "rachunek jak w umowie", color: CrmTheme.rgb(0x86efac)) }
                if c.evidence.name { BankChip(text: "nazwa kontrahenta", color: CrmTheme.rgb(0x86efac)) }
                if c.evidence.amount { BankChip(text: "kwota okresu", color: CrmTheme.rgb(0x86efac)) }
                if best { Text("najlepiej pasuje").font(.caption).foregroundStyle(theme.accent) }
            }
            if isSelected && !c.expectsInvoice {
                Divider()
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Okres").font(.caption).foregroundStyle(.secondary)
                        Picker("", selection: Binding(get: { period }, set: { next in
                            period = next
                            if let p = c.periods.first(where: { $0.start == next }) {
                                amount = BankFormat.plain(((min(tx.remaining, p.missing > 0.009 ? p.missing : tx.remaining)) * 100).rounded() / 100)
                            }
                        })) {
                            Text("Najwcześniejszy nieopłacony (automatycznie)").tag("")
                            ForEach(c.periods) { p in
                                Text("\(p.label) — \(ContractStatus.periodLabel(p.status).lowercased())\(p.paid > 0.009 ? ", zapłacono \(FinFormat.money(p.paid, c.currency))" : "")").tag(p.start)
                            }
                        }
                        .labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kwota").font(.caption).foregroundStyle(.secondary)
                        TextField("", text: $amount).textFieldStyle(.roundedBorder).frame(width: 120)
                    }
                    Button { Task { await link(c.id, period: period.isEmpty ? nil : period, amount: amount) } } label: { Label("Przypisz", systemImage: "link") }
                        .buttonStyle(.borderedProminent)
                }
                if !period.isEmpty, let value = BankFormat.parse(amount), abs(value - c.amount) > 0.01 {
                    Text("Kwota różni się od kwoty okresu (\(FinFormat.money(c.amount, c.currency))). Resztę przelewu możesz przypisać do kolejnego okresu.")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
            }
        }
        .padding(10)
        .background(isSelected ? theme.accent.opacity(0.08) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSelected ? theme.accent.opacity(0.4) : .clear))
        .opacity(c.expectsInvoice ? 0.6 : 1)
    }

    private func link(_ contractID: String, period: String?, amount: String?) async {
        var body: [String: JSONValue] = ["transactionId": .string(tx.id), "contractId": .string(contractID)]
        body["periodStart"] = period.map { JSONValue.string($0) } ?? JSONValue.null
        body["amount"] = amount.map { JSONValue.string($0) } ?? JSONValue.null
        if await store.reconcileAction("Przypisywanie przelewu do umowy…", "linkContract", body) { dismiss() }
    }
}

// MARK: Para „płatność + zwrot” (`BankRefundPairModal`)

@MainActor struct BankRefundSheet: View {
    @ObservedObject var store: FinanceBankStore
    let tx: BankTx
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: BankRefundCandidates?
    @State private var loadError: String?
    @State private var search = ""
    @State private var selected: String?
    @State private var amount = ""
    @State private var details: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        BankSheetFrame("Powiąż ze zwrotem", symbol: "arrow.uturn.backward", subtitle: txSubtitle(tx), busy: store.busy) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Gdy sklep lub kontrahent zwrócił pieniądze (albo my zwróciliśmy klientowi) i nie ma faktury, wybierz drugą operację. Obie zostaną rozliczone parą „płatność + zwrot” — dowodem jest wyciąg. Przy zwrocie częściowym wpisz kwotę zwrotu: reszta płatności nadal będzie czekać na fakturę.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                TextField("Szukaj: sklep, kontrahent, opis, kwota, data", text: $search).textFieldStyle(.roundedBorder)
                    .onChange(of: search) { _, _ in
                        searchTask?.cancel()
                        searchTask = Task {
                            try? await Task.sleep(for: .milliseconds(300))
                            guard !Task.isCancelled else { return }
                            await load()
                        }
                    }
                if let data {
                    if data.candidates.isEmpty {
                        ContentUnavailableView("Brak operacji do powiązania", systemImage: "arrow.uturn.backward",
                                               description: Text("Szukamy operacji przeciwnego kierunku z pozostałą kwotą, ±90 dni, z tej samej działalności."))
                    } else {
                        ScrollView {
                            VStack(spacing: 6) {
                                ForEach(data.candidates) { candidate in card(candidate, data: data) }
                                if data.truncated {
                                    Text("Pokazano \(data.candidates.count) z \(data.total) — zawęź wyszukiwanie.").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } else if let loadError {
                    Text(loadError).foregroundStyle(CrmTheme.rgb(0xfca5a5))
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding(14)
        } footer: {
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 760, idealWidth: 820, minHeight: 560, idealHeight: 660)
        .task { await load() }
        .sheet(isPresented: Binding(get: { details != nil }, set: { if !$0 { details = nil } })) {
            if let details { BankTxDetailsSheet(store: store, transactionID: details) }
        }
    }

    private func load() async {
        do {
            let reply = try await store.get(["op": "refunds", "transaction": tx.id, "search": search.trimmingCharacters(in: .whitespaces)], as: BankRefundCandidates.self)
            data = reply
            loadError = nil
            if selected == nil, let best = reply.candidates.first(where: { $0.sameAmount && (!$0.words.isEmpty || $0.sameAccount) && !$0.blocked }) {
                selected = best.id
                amount = BankFormat.plain((best.suggestedAmount * 100).rounded() / 100)
            }
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać operacji do powiązania.")
        }
    }

    private func card(_ c: BankRefundCandidates.Candidate, data: BankRefundCandidates) -> some View {
        let isSelected = selected == c.id
        let best = c.sameAmount && (!c.words.isEmpty || c.sameAccount) && !c.blocked
        let ownRemaining = data.transaction.remaining
        let value = BankFormat.parse(amount) ?? c.suggestedAmount
        let ownIsPayment = c.role == "refund"
        let paymentLeft = max((ownIsPayment ? ownRemaining : c.remaining) - value, 0)
        let tooMuch = value > min(ownRemaining, c.remaining) + 0.009
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if best { Image(systemName: "sparkles").foregroundStyle(theme.accent) }
                Text(c.role == "refund" ? "Zwrot" : "Zwrócona płatność").font(.caption).foregroundStyle(.secondary)
                Text("\(c.direction == "credit" ? "+" : "−")\(FinFormat.money(c.amount, c.currency))").font(.callout.weight(.semibold)).monospacedDigit()
                Text(FinFormat.day(c.date)).font(.caption)
                Text(c.dayDiff == 0 ? "ten sam dzień" : "\(c.dayDiff) dni").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { details = c.id } label: { Image(systemName: "info.circle") }.buttonStyle(.borderless).help("Szczegóły płatności")
                if data.canManage && !isSelected {
                    Button("Wybierz") { selected = c.id; amount = BankFormat.plain((c.suggestedAmount * 100).rounded() / 100) }.controlSize(.small)
                }
            }
            Text([c.counterparty, c.title].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            HStack(spacing: 6) {
                if c.sameAmount { BankChip(text: "ta sama kwota", color: CrmTheme.rgb(0x86efac)) }
                if c.sameAccount { BankChip(text: "ten sam rachunek", color: CrmTheme.rgb(0x86efac)) }
                if !c.words.isEmpty { BankChip(text: "wspólne: \(c.words.joined(separator: ", "))", color: CrmTheme.rgb(0x86efac)) }
                if c.remaining < c.amount - 0.009 { BankChip(text: "pozostało \(FinFormat.money(c.remaining, c.currency))", color: CrmTheme.rgb(0x93c5fd)) }
                if c.blocked { BankChip(text: "odrzucona wcześniej — tylko ręcznie", color: CrmTheme.rgb(0xfcd34d)) }
                if c.explained { BankChip(text: "wyjaśniona", color: CrmTheme.rgb(0x5eead4)) }
                if c.statementYear != store.period?.year || c.statementMonth != store.period?.month {
                    Text("wyciąg \(String(format: "%02d", c.statementMonth))/\(c.statementYear)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let evidence = c.evidence { Text("Dowód: \(evidence)").font(.caption2).foregroundStyle(.secondary) }
            if isSelected && data.canManage {
                Divider()
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kwota pary").font(.caption).foregroundStyle(.secondary)
                        TextField("", text: $amount).textFieldStyle(.roundedBorder).frame(width: 130)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        if tooMuch {
                            Text("Kwota większa niż pozostało do rozliczenia.").foregroundStyle(CrmTheme.rgb(0xfca5a5))
                        } else if paymentLeft > 0.009 {
                            Text("Z płatności zostanie \(FinFormat.money(paymentLeft, c.currency)) do rozliczenia fakturą.").foregroundStyle(.secondary)
                        } else {
                            Text("Obie operacje zostaną rozliczone w całości.").foregroundStyle(.secondary)
                        }
                    }
                    .font(.caption)
                    Spacer()
                    Button { Task { await link(c) } } label: { Label("Powiąż", systemImage: "link") }
                        .buttonStyle(.borderedProminent).disabled(tooMuch)
                }
            }
        }
        .padding(10)
        .background(isSelected ? theme.accent.opacity(0.08) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSelected ? theme.accent.opacity(0.4) : .clear))
    }

    private func link(_ candidate: BankRefundCandidates.Candidate) async {
        let text = amount.trimmingCharacters(in: .whitespaces)
        let body: [String: JSONValue] = ["transactionId": .string(tx.id), "otherId": .string(candidate.id), "amount": text.isEmpty ? .null : .string(text)]
        if await store.reconcileAction("Powiązywanie płatności ze zwrotem…", "linkRefund", body) { dismiss() }
    }
}

// MARK: Szczegóły operacji (`BankTransactionDetailsModal`)

@MainActor struct BankTxDetailsSheet: View {
    @ObservedObject var store: FinanceBankStore
    let transactionID: String
    @Environment(\.dismiss) private var dismiss
    @State private var details: BankTxDetails?
    @State private var loadError: String?
    @State private var preview: BankPreviewItem?

    var body: some View {
        BankSheetFrame("Szczegóły płatności", symbol: "info.circle", busy: store.busy) {
            if let d = details {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(d.counterparty ?? "Bez nazwy kontrahenta").font(.title3.weight(.semibold)).textSelection(.enabled)
                            Spacer()
                            Text("\(d.direction == "credit" ? "+" : "−")\(FinFormat.money(d.amount, d.currency))").font(.title3.weight(.semibold)).monospacedDigit()
                        }
                        grid([
                            ("Data operacji", FinFormat.day(d.date)),
                            ("Data księgowania", FinFormat.day(d.postingDate)),
                            ("Rachunek kontrahenta", d.counterpartyAccount.map { BankFormat.account($0) } ?? "—"),
                            ("Tytuł", d.title ?? "—"),
                            ("Numer referencyjny", d.reference ?? "—"),
                            ("Opis z wyciągu", d.rawDescription ?? "—"),
                            ("Kontrahent (surowy zapis)", d.rawCounterparty ?? "—"),
                            ("Wyciąg", "\(d.statement.fileName ?? "—") · \(d.statement.format) · \(d.statement.accountType == "vat" ? "rachunek VAT" : "rachunek bieżący")\(d.statement.account.map { " \(BankFormat.account($0))" } ?? "") · \(String(format: "%02d", d.statement.month))/\(d.statement.year)"),
                            ("Saldo potwierdzone w pliku", d.sourceVerified ? "tak" : "nie"),
                        ])
                        if d.explanation != nil || d.accountingNote != nil {
                            grid([
                                ("Wyjaśnienie", (d.explanation ?? "—") + (d.reviewStatus == "explained" ? " · wyjaśniona" : d.reviewStatus == "pending" ? " · do kontroli" : "")),
                                ("Opis księgowy", d.accountingNote ?? "—"),
                            ])
                        }
                        if let paired = d.paired {
                            VStack(alignment: .leading, spacing: 4) {
                                Label("Druga strona transferu VAT", systemImage: "arrow.left.arrow.right").font(.headline)
                                Text("\(paired.accountType == "vat" ? "Rachunek VAT" : "Rachunek bieżący")\(paired.accountSuffix.map { " \($0)" } ?? "") · \(paired.direction == "credit" ? "+" : "−")\(FinFormat.money(paired.amount, paired.currency)) · \(FinFormat.day(paired.date))")
                                Text([paired.counterparty, paired.fileName].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if !d.supporting.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("Dokumenty wyjaśnienia", systemImage: "paperclip").font(.headline)
                                ForEach(d.supporting) { doc in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(doc.title).font(.callout)
                                            Text([doc.type, doc.fileName, doc.notes].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                        }
                                        Spacer()
                                        if doc.hasFile {
                                            Button("Otwórz") {
                                                Task { if let file = await store.file(kind: "supporting", id: doc.id) { preview = store.show(file) } }
                                            }
                                            .controlSize(.small)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(18)
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać operacji", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView("Wczytywanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 640, idealWidth: 700, minHeight: 560, idealHeight: 660)
        .task { await load() }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    private func load() async {
        loadError = nil
        do {
            details = try await store.get(["op": "details", "transaction": transactionID], as: BankTxDetails.self)
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać aktualnej transakcji.")
        }
    }

    private func grid(_ rows: [(String, String)]) -> some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    Text(row.0).font(.caption).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                    Text(row.1).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Podgląd dokumentu: PDF / obraz / faktura KSeF

@MainActor struct BankPreviewSheet: View {
    let item: BankPreviewItem
    @ObservedObject var store: FinanceBankStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch item {
        case .file(let file):
            if file.mime == "application/pdf" {
                OfferPdfViewer(file: OfferPdfPreview(data: file.data, name: file.name))
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text(file.name).font(.headline).lineLimit(1)
                        Spacer()
                        Button { store.save(file) } label: { Label("Pobierz", systemImage: "arrow.down.doc") }
                        Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.borderedProminent)
                    }
                    .padding(12)
                    Divider()
                    if let image = NSImage(data: file.data) {
                        ScrollView([.horizontal, .vertical]) { Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: 1000) }
                    } else {
                        ContentUnavailableView("Nie udało się odczytać obrazu", systemImage: "photo")
                    }
                }
                .frame(minWidth: 700, idealWidth: 900, minHeight: 600, idealHeight: 800)
            }
        case .ksef(let invoice):
            KsefPreviewSheet(invoice: invoice)
        }
    }
}

@MainActor struct KsefPreviewSheet: View {
    let invoice: KsefPreview
    @Environment(\.dismiss) private var dismiss

    /// Forma płatności z XML (kod `FormaPlatnosci` 1–7 albo opis) — jak wizualizacja faktury w CRM.
    private static let paymentMethods: [String: String] = [
        "1": "Gotówka", "2": "Karta", "3": "Bon", "4": "Czek", "5": "Kredyt", "6": "Przelew", "7": "Płatność mobilna",
        "cash": "Gotówka", "card": "Karta", "transfer": "Przelew", "bank_transfer": "Przelew",
    ]
    private var paymentMethod: String {
        guard let raw = invoice.paymentMethod?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return "—" }
        return Self.paymentMethods[raw.lowercased()] ?? raw
    }
    private var paymentStatus: String {
        guard let raw = invoice.paymentStatus, !raw.isEmpty else { return "—" }
        return FinInvoiceText.payment(raw) ?? raw
    }
    /// Kolumna „Brutto” pozycji — tylko gdy XML podaje wartości brutto pozycji (faktura w cenach netto ich nie ma).
    private var showsLineGross: Bool { invoice.items.contains { $0.gross != nil } }
    /// Kwota do przelewu: „Do zapłaty” z XML, a bez niej brutto.
    private var amountDue: Double? { invoice.toPay ?? invoice.gross }

    var body: some View {
        BankSheetFrame("Faktura \(invoice.number ?? "KSeF")", symbol: "doc.richtext",
                       subtitle: "Wizualizacja faktury z zapisanego XML KSeF. To nie jest oryginalny plik PDF. Tekst można zaznaczyć, a ikona kopiowania przy wartości zapisuje ją w schowku.") {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 14) {
                        party("Sprzedawca", invoice.seller)
                        party("Nabywca", invoice.buyer)
                    }
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 6) {
                        GridRow { label("Numer faktury"); copyable(invoice.number, copy: invoice.number, name: "Numer faktury") }
                        GridRow { label("Numer KSeF"); copyable(invoice.ksefNumber, copy: invoice.ksefNumber, name: "Numer KSeF") }
                        GridRow { label("Data wystawienia"); Text(FinFormat.day(invoice.issueDate)) }
                        GridRow { label("Termin płatności"); Text(FinFormat.day(invoice.dueDate)) }
                        GridRow { label("Sposób płatności"); Text(paymentMethod) }
                        GridRow {
                            label("Rachunek")
                            copyable(invoice.bankAccount.map { BankFormat.account($0) }, copy: invoice.bankAccount.map { $0.filter { !$0.isWhitespace } },
                                     name: "Numer rachunku")
                        }
                        GridRow { label("Stan płatności"); Text(paymentStatus) }
                        if let amountDue {
                            GridRow {
                                label(invoice.toPay != nil ? "Do zapłaty" : "Kwota brutto")
                                copyable(FinFormat.money(amountDue, invoice.currency), copy: BankFormat.plain(amountDue), name: "Kwota do zapłaty")
                            }
                        }
                        // Kwota VAT do przelewu podzielonego (split payment): brutto + VAT.
                        if let vat = invoice.vat {
                            GridRow { label("Kwota VAT"); copyable(FinFormat.money(vat, invoice.currency), copy: BankFormat.plain(vat), name: "Kwota VAT") }
                        }
                    }
                    .font(.callout)
                    if !invoice.items.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack {
                                Text("Pozycja").frame(maxWidth: .infinity, alignment: .leading)
                                Text("Ilość").frame(width: 70, alignment: .trailing)
                                Text("Cena netto").frame(width: 100, alignment: .trailing)
                                Text("VAT").frame(width: 50, alignment: .trailing)
                                Text("Netto").frame(width: 100, alignment: .trailing)
                                if showsLineGross { Text("Brutto").frame(width: 100, alignment: .trailing) }
                            }
                            .font(.caption).foregroundStyle(.secondary).padding(.vertical, 4)
                            Divider()
                            ForEach(invoice.items) { item in
                                HStack(alignment: .top) {
                                    Text(item.name).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                                    Text(item.quantity.map { "\(BankFormat.plain($0)) \(item.unit ?? "")" } ?? "—").frame(width: 70, alignment: .trailing)
                                    Text(item.unitPrice.map { FinFormat.money($0, invoice.currency) } ?? "—").frame(width: 100, alignment: .trailing)
                                    Text(item.vatRate.map { $0.hasSuffix("%") || Double($0) == nil ? $0 : "\($0)%" } ?? "—").frame(width: 50, alignment: .trailing)
                                    Text(item.net.map { FinFormat.money($0, invoice.currency) } ?? "—").frame(width: 100, alignment: .trailing)
                                    if showsLineGross {
                                        Text(item.gross.map { FinFormat.money($0, invoice.currency) } ?? "—").frame(width: 100, alignment: .trailing)
                                    }
                                }
                                .font(.callout).monospacedDigit().padding(.vertical, 4)
                                Divider()
                            }
                        }
                    }
                    HStack(spacing: 24) {
                        Spacer()
                        total("Netto", invoice.net)
                        total("VAT", invoice.vat)
                        total("Brutto", invoice.gross)
                        if let toPay = invoice.toPay, abs(toPay - (invoice.gross ?? toPay)) > 0.009 { total("Do zapłaty", toPay) }
                    }
                }
                .padding(18)
                // Każdy tekst podglądu da się zaznaczyć i skopiować (⌘C).
                .textSelection(.enabled)
            }
        } footer: {
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.borderedProminent)
        }
        .frame(minWidth: 760, idealWidth: 860, minHeight: 600, idealHeight: 760)
    }

    private func label(_ text: String) -> some View { Text(text).foregroundStyle(.secondary) }

    /// Wartość z ikoną „Kopiuj” (kopiowana wartość może różnić się od pokazanej — np. rachunek bez spacji, kwota bez waluty).
    private func copyable(_ shown: String?, copy: String?, name: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(shown?.isEmpty == false ? shown ?? "—" : "—").fixedSize(horizontal: false, vertical: true)
            if let copy, !copy.isEmpty { CopyValueButton(label: name, value: copy) }
        }
    }

    private func party(_ title: String, _ party: KsefPreview.Party) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(party.name ?? "—").font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                if let name = party.name, !name.isEmpty { CopyValueButton(label: "\(title) — nazwa", value: name) }
            }
            if let nip = party.nip, !nip.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("NIP \(nip)").font(.caption)
                    CopyValueButton(label: "\(title) — NIP", value: nip.filter { !$0.isWhitespace && $0 != "-" })
                }
            }
            if let address = party.address { Text(address).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func total(_ label: String, _ value: Double?) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.map { FinFormat.money($0, invoice.currency) } ?? "—").font(.headline).monospacedDigit()
        }
    }
}
