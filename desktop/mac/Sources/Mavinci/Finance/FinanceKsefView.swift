import SwiftUI

// MARK: KSeF (jak zakładka CRM „KSeF”, `KSeFIntegrationPanel`) — faktury pobrane z KSeF wybranej działalności (wystawione
// i otrzymane), stan konfiguracji i automatycznej synchronizacji, synchronizacja za zakres dat, rejestr wpłat (pełna
// zapłata, wpłaty częściowe, termin), uwagi do płatności, dziennik synchronizacji i podgląd faktury z XML. Konfiguracja
// KSeF (certyfikat, token) — w CRM. Korekta „in minus” (zwrot): „Rozlicz korektę / zwrot…” (`FinKsefCorrectionSheet`).
// Serwer: `/bridge/native/v1/finance` (`ksef`, `ksefInvoices`, `ksef…`) i trasy CRM `/bridge/ksef/auth/token`,
// `/bridge/ksef/invoices/issued|received` z tokenem pracownika.

struct FinKsefCompany: Decodable, Identifiable {
    var companyId: String
    var name: String
    var isDefault: Bool
    var canManage: Bool
    var nip: String?
    var test: Bool
    var lastAuthenticatedAt: String?
    var accessValidUntil: String?
    var autoSync: Bool
    var autoSyncLastAttemptAt: String?
    var autoSyncLastSuccessAt: String?
    var autoSyncLastError: String?
    var id: String { companyId }
}

struct FinKsefCompaniesReply: Decodable { var companies: [FinKsefCompany]; var isAdmin: Bool }

struct FinKsefInvoice: Decodable, Identifiable {
    struct Payment: Decodable, Identifiable { var id: String; var amount: Double; var date: String?; var notes: String?; var fromBank: Bool }
    var id: String
    var localInvoiceId: String?
    var number: String?
    var ksefNumber: String
    var side: String
    var issueDate: String?
    var dueDate: String?
    var dueSource: String?
    var paymentStatus: String?
    var paymentDate: String?
    var paymentMethod: String?
    var bankAccount: String?
    var sellerName: String?
    var sellerNip: String?
    var buyerName: String?
    var buyerNip: String?
    var net: Double
    var vat: Double
    var gross: Double
    var toPay: Double?
    var currency: String
    var note: String?
    var payments: [Payment]
    var paid: Double
    var statusWithoutLedger: Bool
    var manualReviewNote: String?

    var due: Double { abs(toPay ?? gross) }
    /// Korekta „in minus” (ujemna kwota do zapłaty) — rozliczana zwrotem albo kompensatą.
    var negative: Bool { (toPay ?? gross) < 0 }
    var remaining: Double { max(due - paid, 0) }
    var party: String { (side == "issued" ? buyerName : sellerName) ?? "—" }
    var needsReview: Bool { statusWithoutLedger || manualReviewNote != nil }
    /// Opis uwagi do płatności (jak znacznik w tabeli KSeF w CRM).
    var reviewText: String? {
        if let note = manualReviewNote { return note.isEmpty ? "Ręczne dopasowanie płatności wymaga wyjaśnienia" : note }
        return statusWithoutLedger ? "Status płatności bez wpisu w rejestrze wpłat — sprawdź wpłaty" : nil
    }
    var sortIssue: String { issueDate ?? "" }
    var sortParty: String { party }
    var sortStatus: String { paymentStatus ?? "" }
}

struct FinKsefInvoicesReply: Decodable {
    struct Log: Decodable, Identifiable { var id: String; var startedAt: String?; var finishedAt: String?; var status: String?; var kind: String?; var count: Double?; var error: String? }
    var companyId: String
    var canManage: Bool
    var isAdmin: Bool
    var today: String
    var invoices: [FinKsefInvoice]
    var logs: [Log]
}

enum FinKsefText {
    /// Rodzaj wpisu dziennika synchronizacji (`ksef_sync_log.sync_type`).
    static func kind(_ value: String?) -> String {
        switch value {
        case "issued": return "Wystawione"
        case "received": return "Otrzymane"
        case "manual": return "Ręczna"
        default: return value ?? "—"
        }
    }
    /// Forma płatności z XML KSeF (kod FormaPlatnosci) — jak `PAYMENT_METHOD_LABELS` w CRM.
    static func method(_ code: String) -> String {
        ["1": "Gotówka", "2": "Karta płatnicza", "3": "Bon/Kupon", "4": "Czek", "5": "Kredyt kupiecki", "6": "Przelew", "7": "Inne"][code] ?? code
    }
    struct PaymentState { let paid: Bool; let label: String; let color: Color }
    /// Stan zapłaty jak `getPaymentStatus` w zakładce KSeF CRM; wpłaty z rejestru mają pierwszeństwo przed zapisanym statusem.
    /// Korekta „in minus” — „rozliczona” / „do rozliczenia” zamiast „opłacona” / „nieopłacona”.
    static func payment(_ invoice: FinKsefInvoice, today: String) -> PaymentState {
        let green = CrmTheme.rgb(0x4ade80)
        let negative = invoice.negative
        if invoice.paymentStatus == "paid" || (invoice.paid > 0 && invoice.remaining <= 0.009) {
            let date = invoice.paymentDate ?? invoice.payments.compactMap(\.date).max()
            let base = negative ? "Korekta rozliczona" : "Opłacona"
            return PaymentState(paid: true, label: date.map { "\(base) \(FinFormat.day($0))" } ?? base, color: green)
        }
        if invoice.paymentStatus == "partially_paid" || invoice.paid > 0.009 {
            let base = negative ? "Częściowo rozliczona" : "Częściowo opłacona"
            let label = "\(base) (\(FinFormat.money(invoice.paid, invoice.currency)) / \(FinFormat.money(invoice.due, invoice.currency)))"
            return PaymentState(paid: false, label: label, color: CrmTheme.rgb(0xfacc15))
        }
        if let due = invoice.dueDate, due < today || invoice.paymentStatus == "overdue" {
            return PaymentState(paid: false, label: negative ? "Korekta po terminie" : "Płatność po terminie", color: CrmTheme.rgb(0xf87171))
        }
        return PaymentState(paid: false, label: negative ? "Korekta do rozliczenia" : "Nieopłacona", color: CrmTheme.rgb(0xfb923c))
    }
}

@MainActor struct FinanceKsefView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @EnvironmentObject private var state: Workspace
    @State private var side = "issued"
    @State private var search = ""
    @State private var payment = "all"
    @State private var selection: String?
    @State private var sortOrder = [KeyPathComparator(\FinKsefInvoice.sortIssue, order: .reverse)]
    @State private var syncFrom = Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: Date())) ?? Date()
    @State private var syncTo = Date()
    @State private var showLogs = false
    @State private var preview: BankPreviewItem?
    @State private var editing: FinKsefInvoice?
    @State private var removing: FinKsefInvoice?
    @State private var correction: FinKsefInvoice?

    private var companies: [FinKsefCompany] {
        let scope = Set(finance.scopeCompanies.map(\.id))
        return (store.ksefCompanies?.companies ?? []).filter { scope.contains($0.companyId) }
    }
    private var company: FinKsefCompany? { companies.first { $0.companyId == store.ksefCompanyID } ?? companies.first }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.ksefCompanies == nil {
                if let error = store.ksefError {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać KSeF", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadKsefCompanies(force: true) } } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Ładowanie KSeF…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let company {
                header(company)
                Divider()
                if let reply = store.ksefLists[company.companyId] {
                    content(reply, company: company)
                } else if let error = store.ksefListError {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać faktur KSeF", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadKsefInvoices(company.companyId, force: true) } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Ładowanie faktur KSeF…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ContentUnavailableView {
                    Label("Brak konfiguracji KSeF", systemImage: "doc.badge.gearshape")
                } description: {
                    Text("Żadna z wybranych działalności nie ma aktywnej konfiguracji KSeF albo dostępu do faktur. Konfigurację (certyfikat, token) ustawia się w CRM.")
                } actions: {
                    Button("Konfiguracja KSeF w CRM") { state.openCRM("/crm/invoices?tab=ksef") }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await store.loadKsefCompanies() }
        .task(id: company?.companyId) { if let id = company?.companyId { await store.loadKsefInvoices(id) } }
        .onChange(of: company?.companyId) { selection = nil }
        .onChange(of: side) { selection = nil }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
        .sheet(item: $editing) { invoice in
            if let company { FinKsefPaymentSheet(store: store, companyID: company.companyId, invoice: invoice) }
        }
        .sheet(item: $correction) { invoice in
            if let company { FinKsefCorrectionSheet(store: store, companyID: company.companyId, invoiceID: invoice.id) }
        }
        .confirmationDialog("Usunąć fakturę z lokalnej bazy?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń z lokalnej bazy", role: .destructive) {
                if let invoice = removing, let company { Task { await store.ksefAction("Usuwanie faktury…", "ksefDelete", ["id": .string(invoice.id)], company: company.companyId) } }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Faktura \(removing?.number ?? removing?.ksefNumber ?? "") zniknie z CRM. Nie usuwa to faktury z KSeF.") }
    }

    // MARK: Nagłówek: działalność, konfiguracja, synchronizacja
    private func header(_ company: FinKsefCompany) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if companies.count > 1 {
                    Picker("", selection: Binding(get: { company.companyId }, set: { store.ksefCompanyID = $0 })) {
                        ForEach(companies) { Text($0.name).tag($0.companyId) }
                    }
                    .labelsHidden().fixedSize()
                } else {
                    Text(company.name).font(.headline)
                }
                if company.test { BankChip(text: "środowisko testowe", color: CrmTheme.rgb(0xfcd34d)) }
                Spacer()
                if company.canManage {
                    DatePicker("Od", selection: $syncFrom, displayedComponents: .date).fixedSize()
                    DatePicker("Do", selection: $syncTo, in: syncFrom..., displayedComponents: .date).fixedSize()
                    Button { Task { await store.syncKsef(company: company.companyId, from: syncFrom, to: syncTo) } } label: {
                        Label("Synchronizuj z KSeF", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.borderedProminent).fixedSize()
                    .help("Pobiera faktury wystawione i otrzymane z KSeF za wybrany zakres dat")
                }
                Button { Task { await store.loadKsefInvoices(company.companyId, force: true) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.fixedSize()
                Button { showLogs = true } label: { Image(systemName: "list.bullet.rectangle") }.buttonStyle(.borderless).help("Dziennik synchronizacji")
                    .popover(isPresented: $showLogs, arrowEdge: .bottom) { logs(company) }
                if company.canManage {
                    Button { state.openCRM("/crm/invoices?tab=ksef") } label: { Image(systemName: "gearshape") }
                        .buttonStyle(.borderless).help("Konfiguracja KSeF (certyfikat, token, automatyczna synchronizacja) — w CRM")
                }
            }
            .controlSize(.small)
            Text(configLine(company)).font(.caption).foregroundStyle(company.autoSyncLastError == nil ? Color.secondary : CrmTheme.rgb(0xfca5a5)).lineLimit(2)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func configLine(_ company: FinKsefCompany) -> String {
        var parts: [String] = []
        if let nip = company.nip { parts.append("NIP \(nip)") }
        if let auth = company.lastAuthenticatedAt { parts.append("ostatnie logowanie do KSeF \(FinFormat.dateTime(auth))") }
        if company.autoSync {
            parts.append("automatyczna synchronizacja: " + (company.autoSyncLastSuccessAt.map { "ostatnio \(FinFormat.dateTime($0))" } ?? "jeszcze bez udanej"))
        } else {
            parts.append("automatyczna synchronizacja wyłączona")
        }
        if let error = company.autoSyncLastError { parts.append("błąd: \(error)") }
        return parts.joined(separator: " · ")
    }

    private func logs(_ company: FinKsefCompany) -> some View {
        let entries = store.ksefLists[company.companyId]?.logs ?? []
        return ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Dziennik synchronizacji").font(.headline)
                if entries.isEmpty { Text("Brak wpisów.").foregroundStyle(.secondary) }
                ForEach(entries) { log in
                    let success = log.status == "success"
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: success ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .foregroundStyle(success ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Synchronizacja: \(FinKsefText.kind(log.kind))").font(.callout.weight(.medium))
                            Text(FinFormat.dateTime(log.startedAt)).font(.caption).foregroundStyle(.secondary)
                            if let error = log.error {
                                Text(error).font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5)).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 8)
                        if let count = log.count { Text("\(Int(count)) faktur").font(.callout).monospacedDigit() }
                    }
                    Divider()
                }
            }
            .padding(14)
        }
        .frame(width: 460, height: 380)
    }

    // MARK: Lista faktur
    private func visible(_ reply: FinKsefInvoicesReply) -> [FinKsefInvoice] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return reply.invoices.filter { invoice in
            guard invoice.side == side else { return false }
            let paid = FinKsefText.payment(invoice, today: reply.today).paid
            if payment == "unpaid" && paid { return false }
            if payment == "paid" && !paid { return false }
            if payment == "review" && !invoice.needsReview { return false }
            guard !needle.isEmpty else { return true }
            return [invoice.number ?? "", invoice.ksefNumber, invoice.party, invoice.side == "issued" ? (invoice.buyerNip ?? "") : (invoice.sellerNip ?? ""), BankFormat.plain(invoice.gross)]
                .joined(separator: " ").lowercased().contains(needle)
        }
        .sorted(using: sortOrder)
    }

    private func content(_ reply: FinKsefInvoicesReply, company: FinKsefCompany) -> some View {
        let rows = visible(reply)
        let sideRows = reply.invoices.filter { $0.side == side }
        let issuedCount = reply.invoices.filter { $0.side == "issued" }.count
        let receivedCount = reply.invoices.count - issuedCount
        let gross = sideRows.reduce(0.0) { total, invoice in total + invoice.gross }
        let open = sideRows.reduce(0.0) { total, invoice in total + invoice.remaining }
        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("", selection: $side) {
                    Text("Wystawione (\(issuedCount))").tag("issued")
                    Text("Otrzymane (\(receivedCount))").tag("received")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Picker("", selection: $payment) {
                    Text("Wszystkie").tag("all")
                    Text("Nieopłacone").tag("unpaid")
                    Text("Opłacone").tag("paid")
                    Text("Z uwagą do płatności").tag("review")
                }
                .labelsHidden().fixedSize()
                TextField("Szukaj: numer, kontrahent, NIP, kwota", text: $search).textFieldStyle(.roundedBorder)
                Spacer(minLength: 0)
                Text("Brutto: \(FinFormat.money(gross)) · do zapłaty: \(FinFormat.money(open))")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).fixedSize()
            }
            .controlSize(.small)
            .padding(.horizontal, 16).padding(.vertical, 8)
            Divider()
            Table(rows, selection: $selection, sortOrder: $sortOrder) {
                TableColumn("Numer", value: \.ksefNumber) { invoice in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(invoice.number ?? "bez numeru").fontWeight(.medium).lineLimit(1)
                        Text(invoice.ksefNumber).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }
                }
                .width(min: 150, ideal: 200)
                TableColumn("Data", value: \.sortIssue) { invoice in Text(FinFormat.day(invoice.issueDate)).monospacedDigit() }
                    .width(min: 84, ideal: 92, max: 110)
                TableColumn(side == "issued" ? "Nabywca" : "Sprzedawca", value: \.sortParty) { invoice in
                    Text(invoice.party).lineLimit(1)
                }
                .width(min: 150, ideal: 220)
                TableColumn("Brutto", value: \.gross) { invoice in
                    Text(FinFormat.money(invoice.gross, invoice.currency)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 96, ideal: 116, max: 140)
                TableColumn("Płatność", value: \.sortStatus) { invoice in
                    let status = FinKsefText.payment(invoice, today: reply.today)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Circle().fill(status.color).frame(width: 7, height: 7)
                            Text(status.label).foregroundStyle(status.color).lineLimit(1)
                            if let review = invoice.reviewText {
                                Image(systemName: "exclamationmark.bubble").foregroundStyle(CrmTheme.rgb(0xfcd34d)).help(review)
                            }
                        }
                        Text(invoice.dueDate.map { "termin \(FinFormat.day($0))" } ?? "bez terminu").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .width(min: 150, ideal: 230)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let invoice = reply.invoices.first(where: { $0.id == id }) { menu(invoice, reply: reply, company: company) }
            } primaryAction: { ids in
                if let id = ids.first { Task { preview = await store.preview(source: "ksef", id: id) } }
            }
            .overlay {
                if rows.isEmpty { Text("Brak faktur dla wybranych filtrów.").foregroundStyle(.secondary).allowsHitTesting(false) }
            }
            if let id = selection, let invoice = reply.invoices.first(where: { $0.id == id }) {
                Divider()
                summary(invoice, reply: reply, company: company)
            }
        }
    }

    @ViewBuilder private func menu(_ invoice: FinKsefInvoice, reply: FinKsefInvoicesReply, company: FinKsefCompany) -> some View {
        Button("Podgląd faktury") { Task { preview = await store.preview(source: "ksef", id: invoice.id) } }
        if let local = invoice.localInvoiceId { Button("Faktura w rejestrze sprzedaży") { store.selectedInvoice = local; finance.part = .invoices } }
        if invoice.negative { Button("Rozlicz korektę / zwrot…") { correction = invoice } }
        if reply.canManage {
            Divider()
            if invoice.remaining > 0.009 {
                Button(invoice.negative ? "Oznacz jako rozliczoną" : "Oznacz jako opłaconą") {
                    Task { await store.ksefAction("Zapisywanie wpłaty…", "ksefPaid", ["id": .string(invoice.id)], company: company.companyId) }
                }
            }
            if invoice.payments.contains(where: { !$0.fromBank }) {
                Button("Oznacz jako nieopłaconą") { Task { await store.ksefAction("Usuwanie ręcznych wpłat…", "ksefUnpaid", ["id": .string(invoice.id)], company: company.companyId) } }
            }
            Button("Płatność i termin…") { editing = invoice }
            if invoice.manualReviewNote != nil {
                Button("Oznacz uwagę jako wyjaśnioną") { Task { await store.ksefAction("Zamykanie uwagi…", "ksefReviewResolve", ["id": .string(invoice.id)], company: company.companyId) } }
            }
        }
        if reply.isAdmin {
            Divider()
            Button("Usuń z lokalnej bazy…", role: .destructive) { removing = invoice }
        }
    }

    private func summary(_ invoice: FinKsefInvoice, reply: FinKsefInvoicesReply, company: FinKsefCompany) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(invoice.number ?? "bez numeru") · \(invoice.party)").font(.callout.weight(.semibold)).lineLimit(1)
                Text("Netto \(FinFormat.money(invoice.net, invoice.currency)) · VAT \(FinFormat.money(invoice.vat, invoice.currency)) · do zapłaty \(FinFormat.money(invoice.due, invoice.currency)) · wpłacono \(FinFormat.money(invoice.paid, invoice.currency))")
                    .font(.caption).foregroundStyle(.secondary)
                let terms = [invoice.paymentMethod.map { "forma płatności: \(FinKsefText.method($0))" }, invoice.bankAccount.map { "rachunek \($0)" }, invoice.note].compactMap { $0 }
                if !terms.isEmpty {
                    Text(terms.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
                if !invoice.payments.isEmpty {
                    Text(invoice.payments.map { "\(FinFormat.day($0.date)) \(FinFormat.money($0.amount, invoice.currency))\($0.fromBank ? " (wyciąg)" : "")" }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                if let review = invoice.reviewText { Text("Uwaga: \(review)").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
            }
            Spacer()
            Button { Task { preview = await store.preview(source: "ksef", id: invoice.id) } } label: { Label("Podgląd", systemImage: "doc.richtext") }
            if invoice.negative {
                Button { correction = invoice } label: { Label("Rozlicz korektę…", systemImage: "arrow.uturn.backward.circle") }
                    .help("Zwrot z wyciągu, płatność faktury korygowanej albo kompensata")
            }
            if reply.canManage { Button { editing = invoice } label: { Label("Płatność…", systemImage: "creditcard") } }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 8)
    }
}

// MARK: Płatność i termin (jak okno edycji płatności w zakładce KSeF CRM)

@MainActor private struct FinKsefPaymentSheet: View {
    @ObservedObject var store: FinanceBankStore
    let companyID: String
    let invoice: FinKsefInvoice
    @Environment(\.dismiss) private var dismiss
    @State private var hasDue = false
    @State private var due = Date()
    @State private var hasPaid = false
    @State private var paidDate = Date()
    @State private var amount = ""
    @State private var date = Date()
    @State private var notes = ""
    @State private var prepared = false

    private var current: FinKsefInvoice { store.ksefLists[companyID]?.invoices.first { $0.id == invoice.id } ?? invoice }

    var body: some View {
        BankSheetFrame("Płatność faktury \(current.number ?? current.ksefNumber)", symbol: "creditcard",
                       subtitle: "\(current.party) · do zapłaty \(FinFormat.money(current.due, current.currency)) · wpłacono \(FinFormat.money(current.paid, current.currency))", busy: store.busy) {
            Form {
                Section("Wpłaty") {
                    if current.payments.isEmpty { Text("Brak wpłat w rejestrze.").foregroundStyle(.secondary) }
                    ForEach(current.payments) { payment in
                        HStack {
                            Text(FinFormat.day(payment.date)).monospacedDigit()
                            Text(FinFormat.money(payment.amount, current.currency)).monospacedDigit()
                            if let notes = payment.notes { Text(notes).foregroundStyle(.secondary).lineLimit(1) }
                            Spacer()
                            if payment.fromBank {
                                Text("z wyciągu").font(.caption).foregroundStyle(.secondary)
                            } else {
                                Button { Task { await store.ksefAction("Usuwanie wpłaty…", "ksefPaymentRemove", ["paymentId": .string(payment.id)], company: companyID) } } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                    HStack {
                        TextField("Kwota", text: $amount, prompt: Text("Kwota")).frame(width: 110)
                        DatePicker("Data wpłaty", selection: $date, displayedComponents: .date)
                        TextField("Uwagi", text: $notes, prompt: Text("Uwagi (opcjonalnie)"))
                        Button("Dodaj wpłatę") {
                            Task {
                                let value = BankFormat.parse(amount) ?? 0
                                let body: [String: JSONValue] = ["id": .string(invoice.id), "amount": .string(String(value)), "date": .string(FinanceText.dayString(date)), "notes": .string(notes)]
                                if await store.ksefAction("Dodawanie wpłaty…", "ksefPaymentAdd", body, company: companyID) { amount = ""; notes = "" }
                            }
                        }
                        .disabled((BankFormat.parse(amount) ?? 0) <= 0)
                    }
                    .labelsHidden()
                }
                Section("Termin i pełna zapłata") {
                    Toggle("Termin płatności", isOn: $hasDue)
                    if hasDue { DatePicker("Termin", selection: $due, displayedComponents: .date) }
                    if current.payments.isEmpty {
                        Toggle("Zapłacono w całości", isOn: $hasPaid)
                        if hasPaid { DatePicker("Data zapłaty", selection: $paidDate, displayedComponents: .date) }
                        Text("Bez wpłat: data zapłaty zapisze pełną wpłatę; bez daty faktura będzie nieopłacona albo po terminie.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
        } footer: {
            Spacer()
            Button("Zamknij", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Zapisz") {
                Task {
                    let body: [String: JSONValue] = [
                        "id": .string(invoice.id), "dueDate": .string(hasDue ? FinanceText.dayString(due) : ""),
                        "paymentDate": .string(current.payments.isEmpty && hasPaid ? FinanceText.dayString(paidDate) : ""),
                    ]
                    if await store.ksefAction("Zapisywanie płatności…", "ksefPaymentSave", body, company: companyID) { dismiss() }
                }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        }
        .frame(minWidth: 600, idealWidth: 660, minHeight: 520, idealHeight: 600)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            if let value = invoice.dueDate.flatMap({ FinFormat.date($0) }) { hasDue = true; due = value }
            if let value = invoice.paymentDate.flatMap({ FinFormat.date($0) }) { hasPaid = true; paidDate = value }
            amount = invoice.remaining > 0.009 ? BankFormat.plain(invoice.remaining) : ""
        }
    }
}
