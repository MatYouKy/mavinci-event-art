import SwiftUI

// MARK: Rozliczenie korekty „in minus” (jak okno CRM „Rozlicz korektę / zwrot”, `KsefCorrectionSettlementModal`) — faktura
// korygowana z XML korekty, jej płatność z wyciągu, zwrot korekty z wyciągu (obie operacje i obie faktury rozliczone) albo
// kompensata, gdy faktura korygowana nie była jeszcze opłacona. Serwer: `/bridge/native/v1/finance` (GET `ksefCorrection`,
// POST `ksefCorrectionLink`, `ksefCorrectionUnlink`, `ksefCorrectionOffset`, `ksefCorrectionOffsetUndo`; logika
// `src/lib/invoices/ksefCorrectionSettlement.ts` — ta sama co w CRM).

struct FinKsefCorrection: Decodable {
    struct Payment: Decodable, Identifiable {
        var id: String
        var amount: Double
        var date: String?
        var notes: String?
        var fromBank: Bool
        var offset: Bool
    }
    struct Tx: Decodable, Identifiable {
        var id: String
        var statementId: String
        var matchId: String?
        var date: String
        var amount: Double
        var direction: String
        var currency: String
        var remaining: Double
        var linkedAmount: Double?
        var linkAmount: Double
        var party: String?
        var title: String?
        var statementYear: Int?
        var statementMonth: Int?
        var explained: Bool
        var score: Int
        var reasons: [String]

        var credit: Bool { direction == "credit" }
        var signed: String { (credit ? "+" : "−") + FinFormat.money(amount, currency) }
    }
    struct Offset: Decodable {
        var amount: Double
        var date: String?
        var available: Double
        var blocked: String?
    }
    struct Document: Decodable, Identifiable {
        var id: String
        var number: String?
        var ksefNumber: String
        var side: String
        var issueDate: String?
        var party: String?
        var partyNip: String?
        var gross: Double
        var due: Double
        var paid: Double
        var open: Double
        var bankOpen: Double
        var bankLinked: Double
        var paymentStatus: String?
        var paymentDate: String?
        var currency: String
        var direction: String
        var linkBlocked: String?
        var payments: [Payment]
        var transactions: [Tx]
        var candidates: [Tx]
        var offset: Offset?

        var label: String { number ?? ksefNumber }
    }
    struct Reference: Decodable, Hashable {
        var number: String?
        var ksefNumber: String?
        var documentId: String?
    }
    var companyId: String
    var kind: String?
    var today: String
    var correction: Document
    var references: [Reference]
    var originals: [Document]
    var canManage: Bool
}

enum FinKsefCorrectionText {
    static func kind(_ value: String?) -> String {
        switch (value ?? "").uppercased() {
        case "KOR": return "Faktura korygująca"
        case "KOR_ZAL": return "Korekta faktury zaliczkowej"
        case "KOR_ROZ": return "Korekta faktury rozliczeniowej"
        default: return "Faktura"
        }
    }
    static func isCorrection(_ value: String?) -> Bool { ["KOR", "KOR_ZAL", "KOR_ROZ"].contains((value ?? "").uppercased()) }

    /// Stan rozliczenia po polsku (korekta „in minus” — „rozliczona”, faktura — „opłacona”), jak w oknie CRM.
    static func status(_ doc: FinKsefCorrection.Document) -> (label: String, color: Color) {
        let green = CrmTheme.rgb(0x4ade80)
        let yellow = CrmTheme.rgb(0xfacc15)
        let orange = CrmTheme.rgb(0xfb923c)
        let settled = doc.paymentStatus == "paid" || doc.open <= 0.009
        if doc.gross < 0 {
            if settled { return ("Korekta rozliczona", green) }
            if doc.paid > 0.009 { return ("Częściowo rozliczona (\(FinFormat.money(doc.paid, doc.currency)) / \(FinFormat.money(doc.due, doc.currency)))", yellow) }
            return ("Korekta do rozliczenia", orange)
        }
        if doc.paymentStatus == "paid" {
            let noLedger = doc.bankLinked <= 0.009 && doc.paid <= 0.009
            return (noLedger ? "Opłacona (oznaczenie bez operacji z wyciągu)" : "Opłacona", green)
        }
        if doc.paid > 0.009 { return ("Częściowo opłacona (\(FinFormat.money(doc.paid, doc.currency)) / \(FinFormat.money(doc.due, doc.currency)))", yellow) }
        if doc.paymentStatus == "overdue" { return ("Płatność po terminie", CrmTheme.rgb(0xf87171)) }
        return ("Nieopłacona", orange)
    }
}

@MainActor struct FinKsefCorrectionSheet: View {
    @ObservedObject var store: FinanceBankStore
    let companyID: String
    let invoiceID: String
    @Environment(\.dismiss) private var dismiss
    @State private var data: FinKsefCorrection?
    @State private var loadError: String?
    @State private var searches: [String: String] = [:]
    @State private var showAll: Set<String> = []
    @State private var offsetAmounts: [String: String] = [:]
    @State private var offsetDates: [String: Date] = [:]
    @State private var unlinking: UnlinkRequest?
    @State private var undoing: FinKsefCorrection.Document?

    struct UnlinkRequest: Identifiable {
        let doc: FinKsefCorrection.Document
        let tx: FinKsefCorrection.Tx
        var id: String { tx.id + ":" + (tx.matchId ?? "") }
    }

    private var title: String { "Rozliczenie korekty \(data?.correction.label ?? "")" }
    private var subtitle: String? {
        guard let data else { return nil }
        let correction = data.correction
        return "\(correction.party ?? "Bez kontrahenta") · \(FinKsefCorrectionText.kind(data.kind)) \(FinFormat.money(correction.gross, correction.currency)) · \(FinKsefCorrectionText.status(correction).label)"
    }

    var body: some View {
        BankSheetFrame(title, symbol: "arrow.uturn.backward.circle", subtitle: subtitle) {
            if let data {
                content(data)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać rozliczenia", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView("Wczytywanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            Spacer()
            Button("Zamknij", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 720, idealWidth: 820, minHeight: 560, idealHeight: 720)
        .task { await load() }
        .confirmationDialog("Odpiąć operację?", isPresented: Binding(get: { unlinking != nil }, set: { if !$0 { unlinking = nil } }),
                            titleVisibility: .visible, presenting: unlinking) { request in
            Button("Odepnij", role: .destructive) { Task { await unlink(request) } }
            Button("Anuluj", role: .cancel) {}
        } message: { request in
            Text("Operacja \(FinFormat.day(request.tx.date)) \(request.tx.signed) przestanie rozliczać fakturę \(request.doc.label). Automat nie przypisze jej ponownie do tej faktury.")
        }
        .confirmationDialog("Cofnąć kompensatę?", isPresented: Binding(get: { undoing != nil }, set: { if !$0 { undoing = nil } }),
                            titleVisibility: .visible, presenting: undoing) { original in
            Button("Cofnij kompensatę", role: .destructive) { Task { await undoOffset(original) } }
            Button("Anuluj", role: .cancel) {}
        } message: { original in
            Text("Wpłaty kompensaty zostaną usunięte z rejestru korekty \(data?.correction.label ?? "") i faktury \(original.label).")
        }
    }

    // MARK: Treść
    private func content(_ data: FinKsefCorrection) -> some View {
        let correction = data.correction
        let missing = data.references.filter { $0.documentId == nil }
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Korekta „in minus” rozlicza się zwrotem albo kompensatą. Powiąż płatność faktury korygowanej i zwrot z wyciągu — obie operacje i obie faktury będą rozliczone. Gdy faktura korygowana nie była jeszcze opłacona, rozlicz korektę kompensatą: zapłacisz tylko różnicę.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if correction.gross < 0 && correction.open <= 0.009 {
                    Label("Korekta jest rozliczona.", systemImage: "checkmark.circle.fill").foregroundStyle(CrmTheme.rgb(0x4ade80))
                }
                if !FinKsefCorrectionText.isCorrection(data.kind) && data.references.isEmpty {
                    Text("XML tej faktury nie wskazuje faktury korygowanej — możesz powiązać zwrot z wyciągu poniżej.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(missing, id: \.self) { reference in
                    Label(missingText(reference), systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(data.originals) { original in
                    GroupBox {
                        VStack(alignment: .leading, spacing: 10) {
                            header(original, label: "Faktura korygowana")
                            bankSection(original, title: "Płatność faktury z wyciągu",
                                        candidatesTitle: "\(original.direction == "credit" ? "Wpływy" : "Wypłaty") pasujące do faktury", canManage: data.canManage)
                            offsetSection(original, canManage: data.canManage)
                        }
                        .padding(6)
                    }
                }
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        header(correction, label: correction.gross < 0 ? "Korekta — zwrot" : "Korekta")
                        bankSection(correction, title: correction.direction == "credit" ? "Zwrot na konto z wyciągu" : "Zwrot dla kontrahenta z wyciągu",
                                    candidatesTitle: "\(correction.direction == "credit" ? "Wpływy" : "Wypłaty") pasujące do zwrotu", canManage: data.canManage)
                        if let manual = Self.manualPayments(correction) {
                            Text(manual).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(6)
                }
                if !data.canManage {
                    Text("Zmiany rozliczeń wymagają „Zarządzania finansami” w tej działalności.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(16)
        }
    }

    /// Wpłaty ręczne korekty (nie z wyciągu i nie z kompensaty) — zmienia się je w „Płatność i termin”.
    private static func manualPayments(_ doc: FinKsefCorrection.Document) -> String? {
        let manual = doc.payments.filter { !$0.fromBank && !$0.offset }
        guard !manual.isEmpty else { return nil }
        let list = manual.map { payment in "\(FinFormat.day(payment.date)) \(FinFormat.money(payment.amount, doc.currency))" }
        return "Wpłaty ręczne w rejestrze korekty: \(list.joined(separator: ", ")) (zmienisz je w „Płatność i termin”)."
    }

    private func missingText(_ reference: FinKsefCorrection.Reference) -> String {
        let ksef = reference.ksefNumber.map { " (KSeF \($0))" } ?? ""
        return "Faktury korygowanej \(reference.number ?? "")\(ksef) nie ma w KSeF tej działalności w CRM — zsynchronizuj KSeF za miesiąc jej wystawienia. Zwrot korekty możesz powiązać już teraz."
    }

    private func header(_ doc: FinKsefCorrection.Document, label: String) -> some View {
        let status = FinKsefCorrectionText.status(doc)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
                Text(doc.number ?? "bez numeru").font(.headline).textSelection(.enabled)
                Text("\(doc.ksefNumber) · wystawiona \(FinFormat.day(doc.issueDate))").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(FinFormat.money(doc.gross, doc.currency)).font(.headline).monospacedDigit()
                BankChip(text: status.label, color: status.color)
            }
        }
    }

    // MARK: Operacje z wyciągu
    private func bankSection(_ doc: FinKsefCorrection.Document, title: String, candidatesTitle: String, canManage: Bool) -> some View {
        let rows = visible(doc)
        let query = (searches[doc.id] ?? "").trimmingCharacters(in: .whitespaces)
        let strong = doc.candidates.filter { $0.score >= 3 }.count
        return VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
            if doc.transactions.isEmpty {
                Text("Brak powiązanej operacji z wyciągu.").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(doc.transactions) { tx in txRow(doc, tx, linked: true, canManage: canManage) }
            }
            if let blocked = doc.linkBlocked {
                Label(blocked, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                    .fixedSize(horizontal: false, vertical: true)
            } else if doc.bankOpen > 0.009 {
                Divider()
                HStack {
                    Text("\(candidatesTitle) · do powiązania \(FinFormat.money(doc.bankOpen, doc.currency))").font(.callout.weight(.medium))
                    Spacer()
                    if query.isEmpty && doc.candidates.count > strong {
                        Button(showAll.contains(doc.id) ? "Pokaż najlepiej pasujące" : "Pokaż wszystkie z okresu (\(doc.candidates.count))") {
                            if showAll.contains(doc.id) { showAll.remove(doc.id) } else { showAll.insert(doc.id) }
                        }
                        .buttonStyle(.link)
                    }
                }
                TextField("Szukaj: kontrahent, opis, kwota, data", text: Binding(get: { searches[doc.id] ?? "" }, set: { searches[doc.id] = $0 }))
                    .textFieldStyle(.roundedBorder)
                if rows.isEmpty {
                    Text(emptyText(doc, query: query)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(rows) { tx in txRow(doc, tx, linked: false, canManage: canManage) }
                }
            }
        }
    }

    private func emptyText(_ doc: FinKsefCorrection.Document, query: String) -> String {
        if !query.isEmpty { return "Brak operacji pasujących do wyszukiwania." }
        if !doc.candidates.isEmpty { return "Brak operacji z pasującą kwotą, numerem albo kontrahentem — pokaż wszystkie z okresu albo wyszukaj." }
        return "Brak nierozliczonych operacji w tym kierunku z okresu faktury. Zaimportuj wyciąg z miesiąca płatności."
    }

    private func fold(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespaces).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
    }

    /// Najlepiej pasujące (do 10), wszystkie z okresu (do 100) albo wyniki wyszukiwania (do 50) — jak w CRM.
    private func visible(_ doc: FinKsefCorrection.Document) -> [FinKsefCorrection.Tx] {
        let query = fold(searches[doc.id] ?? "")
        if !query.isEmpty {
            let found = doc.candidates.filter { tx in
                let haystack = [tx.party ?? "", tx.title ?? "", FinFormat.day(tx.date), BankFormat.plain(tx.amount), String(format: "%.2f", tx.amount)].joined(separator: " ")
                return fold(haystack).contains(query)
            }
            return Array(found.prefix(50))
        }
        if showAll.contains(doc.id) { return Array(doc.candidates.prefix(100)) }
        return Array(doc.candidates.filter { $0.score >= 3 }.prefix(10))
    }

    private func txRow(_ doc: FinKsefCorrection.Document, _ tx: FinKsefCorrection.Tx, linked: Bool, canManage: Bool) -> some View {
        let notes: String = Self.notes(tx, linked: linked)
        let amountColor: Color = tx.credit ? CrmTheme.rgb(0x4ade80) : Color.primary
        return HStack(alignment: .top, spacing: 10) {
            Text(FinFormat.day(tx.date)).monospacedDigit().foregroundStyle(.secondary).frame(width: 82, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(tx.party ?? "Bez nazwy").fontWeight(.medium).lineLimit(1)
                if let title = tx.title, title != tx.party {
                    Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
                if !notes.isEmpty {
                    Text(notes).font(.caption2).foregroundStyle(linked ? Color.secondary : CrmTheme.rgb(0x86efac))
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(tx.signed).monospacedDigit().foregroundStyle(amountColor)
                if linked, let part = tx.linkedAmount, part < tx.amount - 0.009 {
                    Text("z tego dla faktury \(FinFormat.money(part, tx.currency))").font(.caption2).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    if let year = tx.statementYear, let month = tx.statementMonth {
                        Button { openInReconciliation(tx, year: year, month: month) } label: { Image(systemName: "arrow.right.circle") }
                            .buttonStyle(.borderless).help("Pokaż operację w uzgodnieniu wyciągu")
                    }
                    if canManage && linked {
                        Button("Odepnij") { unlinking = UnlinkRequest(doc: doc, tx: tx) }
                    }
                    if canManage && !linked {
                        Button("Powiąż \(FinFormat.money(tx.linkAmount, tx.currency))") { Task { await link(doc, tx) } }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    /// Pozostała kwota operacji (gdy częściowo rozliczona) i powody dopasowania.
    private static func notes(_ tx: FinKsefCorrection.Tx, linked: Bool) -> String {
        var parts: [String] = []
        if !linked && tx.remaining < tx.amount - 0.009 { parts.append("do rozliczenia \(FinFormat.money(tx.remaining, tx.currency))") }
        parts.append(contentsOf: tx.reasons)
        return parts.joined(separator: " · ")
    }

    private static func offsetDone(_ state: FinKsefCorrection.Offset, currency: String) -> String {
        let when = state.date.map { " · \(FinFormat.day($0))" } ?? ""
        return "Rozliczono kompensatą \(FinFormat.money(state.amount, currency))\(when)"
    }

    // MARK: Kompensata
    @ViewBuilder private func offsetSection(_ doc: FinKsefCorrection.Document, canManage: Bool) -> some View {
        if let state = doc.offset, state.amount > 0.009 || state.available > 0.009 || state.blocked != nil {
            VStack(alignment: .leading, spacing: 8) {
                Divider()
                Label("Kompensata", systemImage: "scalemass").font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
                if state.amount > 0.009 {
                    HStack {
                        Text(Self.offsetDone(state, currency: doc.currency))
                        Spacer()
                        if canManage { Button("Cofnij kompensatę") { undoing = doc }.controlSize(.small) }
                    }
                }
                if state.available > 0.009 {
                    Text("Faktura korygowana nie jest jeszcze opłacona — korekta pomniejsza kwotę do zapłaty. Kompensata zapisze wpłatę w rejestrze obu faktur (bez operacji z wyciągu); resztę faktury korygowanej opłacisz jak zwykle.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if canManage {
                        HStack(spacing: 8) {
                            TextField("Kwota", text: Binding(get: { offsetAmounts[doc.id] ?? BankFormat.plain(state.available) }, set: { offsetAmounts[doc.id] = $0 }))
                                .textFieldStyle(.roundedBorder).frame(width: 110)
                            DatePicker("Data", selection: Binding(get: { offsetDates[doc.id] ?? Date() }, set: { offsetDates[doc.id] = $0 }), displayedComponents: .date)
                                .labelsHidden().fixedSize()
                            Button("Rozlicz kompensatą") { Task { await offset(doc) } }.buttonStyle(.borderedProminent)
                            Spacer()
                        }
                        .controlSize(.small)
                    }
                } else if let blocked = state.blocked {
                    Text(blocked).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: Czynności
    private func load() async {
        do {
            data = try await store.ksefCorrection(invoiceID)
            loadError = nil
        } catch {
            let text = store.failureText(error, "Nie udało się wczytać rozliczenia korekty.")
            if data == nil { loadError = text } else { store.workspace?.error = text }
        }
    }

    private func link(_ doc: FinKsefCorrection.Document, _ tx: FinKsefCorrection.Tx) async {
        guard let data else { return }
        let body: [String: JSONValue] = [
            "correctionId": .string(data.correction.id), "documentId": .string(doc.id), "transactionId": .string(tx.id), "amount": .number(tx.linkAmount),
        ]
        if await store.ksefAction("Powiązywanie operacji z wyciągu…", "ksefCorrectionLink", body, company: companyID) { await load() }
    }

    private func unlink(_ request: UnlinkRequest) async {
        guard let data, let matchID = request.tx.matchId else { return }
        let body: [String: JSONValue] = [
            "correctionId": .string(data.correction.id), "transactionId": .string(request.tx.id), "matchId": .string(matchID),
        ]
        if await store.ksefAction("Cofanie powiązania…", "ksefCorrectionUnlink", body, company: companyID) { await load() }
    }

    private func offset(_ doc: FinKsefCorrection.Document) async {
        guard let data, let state = doc.offset else { return }
        let value = BankFormat.parse(offsetAmounts[doc.id] ?? BankFormat.plain(state.available)) ?? 0
        guard value > 0 else { store.workspace?.error = "Kwota kompensaty musi być większa od zera."; return }
        guard value <= state.available + 0.005 else {
            store.workspace?.error = "Kwota kompensaty nie może przekroczyć \(FinFormat.money(state.available, doc.currency))."
            return
        }
        let body: [String: JSONValue] = [
            "correctionId": .string(data.correction.id), "originalId": .string(doc.id), "amount": .number(value),
            "date": .string(FinanceText.dayString(offsetDates[doc.id] ?? Date())),
        ]
        if await store.ksefAction("Zapisywanie kompensaty…", "ksefCorrectionOffset", body, company: companyID) {
            offsetAmounts[doc.id] = nil
            await load()
        }
    }

    private func undoOffset(_ original: FinKsefCorrection.Document) async {
        guard let data else { return }
        let body: [String: JSONValue] = ["correctionId": .string(data.correction.id), "originalId": .string(original.id)]
        if await store.ksefAction("Cofanie kompensaty…", "ksefCorrectionOffsetUndo", body, company: companyID) { await load() }
    }

    /// Operacja w „Uzgodnieniu wyciągów” (miesiąc wyciągu, zaznaczona operacja) — okno się zamyka.
    private func openInReconciliation(_ tx: FinKsefCorrection.Tx, year: Int, month: Int) {
        let company = data?.companyId ?? companyID
        dismiss()
        Task {
            await store.openReconciliation(company: company, year: year, month: month)
            store.selectedTx = tx.id
        }
    }
}
