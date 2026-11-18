import SwiftUI

// MARK: Faktury — rejestr sprzedaży (jak zakładka CRM „Lokalne faktury” i karta faktury): faktury, pro formy i szkice
// wybranych działalności z filtrami, sortowaniem i sumami; z prawej karta wybranej faktury (strony, daty, kwoty, zapłata,
// KSeF, pozycje, powiązane dokumenty) z czynnościami: podgląd PDF, „Oznacz jako wysłaną”, „Oznacz jako opłaconą” (data
// pełnej zapłaty), anulowanie i usunięcie szkicu / pro formy, „Generuj / Regeneruj PDF” (zapis w plikach), pobranie
// zapisanego PDF, „Wyślij email” (`FinanceReminderSheet` w trybie faktury), „Wyślij do KSeF” (postęp wysyłki,
// `InvoiceKsefSendSheet`) i UPO, „Faktura z pro formy” (`ProformaConvertSheet`), „Edytuj…” (`InvoiceEditSheet`). Wystawianie faktury VAT, pro formy, zaliczkowej, kolejnej zaliczki i korekty — natywnie
// (`InvoiceFormSheet`, jak `/crm/invoices/new`); faktura końcowa — `FinalInvoiceSheet` (jak `FinalInvoiceWizardModal`:
// z nagłówka listy bez kontekstu, z karty zaliczki dla jej zamówienia). Serwer: `/bridge/native/v1/finance` (`invoices`,
// `invoice`, `invoiceStatus`, `invoiceCancel`, `invoiceDelete`, `invoicePdf`, `invoicePdfFile`, `invoiceUpo`, `invoiceForm`…,
// `invoiceCreate`, `final…`) i trasa CRM `/bridge/ksef/invoices/send`.

struct FinInvoiceActions: Decodable {
    var paymentStatus: String
    var paymentBase: Double
    var canMarkPaid: Bool
    var canMarkSent: Bool
    var canCancel: Bool
    var needsNotDelivered: Bool
    var canDelete: Bool
    var deletable: Bool
    // Karta faktury (opcjonalne — starszy serwer CRM ich nie wysyła).
    var canEdit: Bool?
    var canEmail: Bool?
    var canSendKsef: Bool?
    var ksefResend: Bool?
    var canUpo: Bool?
    var canConvertProforma: Bool?
}

struct FinInvoice: Decodable, Identifiable {
    struct BankPayment: Decodable { var amount: Double; var currency: String; var latestPaymentDate: String; var matchCount: Int }
    var id: String
    var number: String
    var type: String
    var status: String
    var rawStatus: String
    var paymentStatus: String?
    var correctionKind: String?
    var proforma: Bool
    var isFinal: Bool
    var issueDate: String?
    var saleDate: String?
    var dueDate: String?
    var paidDate: String?
    var buyerName: String
    var buyerNip: String?
    var net: Double
    var vat: Double
    var gross: Double
    var paidAmount: Double
    var currency: String
    var companyId: String?
    var companyName: String?
    var eventName: String?
    var organizationName: String?
    var ksefStatus: String?
    var ksefReference: String?
    var hasPdf: Bool
    var pdfGeneratedAt: String?
    var createdAt: String?
    var bankPayment: BankPayment?
    var actions: FinInvoiceActions?

    // Klucze sortowania tabeli.
    var sortIssue: String { issueDate ?? "" }
    var sortDue: String { dueDate ?? "" }
}

struct FinInvoicesReply: Decodable {
    struct Company: Decodable, Identifiable { var id: String; var name: String; var isDefault: Bool; var canIssue: Bool; var canManage: Bool }
    var companies: [Company]
    var salesView: Bool
    var financeView: Bool
    var paymentsError: String?
    var invoices: [FinInvoice]
}

struct FinInvoiceDetail: Decodable {
    struct Party: Decodable { var name: String?; var nip: String?; var address: String?; var email: String?; var privatePerson: Bool? }
    struct Item: Decodable, Identifiable {
        var id: String
        var name: String
        var description: String?
        var unit: String?
        var quantity: Double?
        var priceNet: Double?
        var vatRate: String?
        var net: Double?
        var vat: Double?
        var gross: Double?
    }
    struct Related: Decodable, Identifiable {
        var id: String
        var number: String
        var type: String
        var status: String
        var issueDate: String?
        var gross: Double
        var relation: String
    }
    var invoice: FinInvoice
    var actions: FinInvoiceActions
    /// Odbiorca KSeF / dane sprzed korekty zapisane na fakturze są nieczytelne (blokuje „Generuj PDF”, jak w CRM).
    var recipientError: String?
    var proformaConvertedTo: String?
    var seller: Party
    var buyer: Party
    var paymentMethod: String?
    var bankAccount: String?
    var issuePlace: String?
    var notes: String?
    var ksefError: String?
    var ksefSentAt: String?
    var cancellationReason: String?
    var correctionReason: String?
    var correctedNumber: String?
    var remainingGross: Double?
    var items: [Item]
    var related: [Related]
}

enum FinInvoiceText {
    static func type(_ value: String) -> String {
        switch value {
        case "vat": return "Faktura VAT"
        case "proforma": return "Faktura Proforma"
        case "advance": return "Zaliczkowa"
        case "final": return "Końcowa"
        case "corrective": return "Korygująca"
        default: return value
        }
    }
    static let statuses: [(String, String)] = [
        ("draft", "Szkic"), ("proforma", "Proforma"), ("issued", "Wystawiona"), ("sent", "Wysłana"), ("paid", "Opłacona"),
        ("overdue", "Przeterminowana"), ("cancelled", "Anulowana"),
    ]
    static func status(_ value: String) -> String { statuses.first { $0.0 == value }?.1 ?? "Szkic" }
    static func statusColor(_ value: String) -> Color {
        switch value {
        case "proforma": return CrmTheme.rgb(0x67e8f9)
        case "issued": return CrmTheme.rgb(0x60a5fa)
        case "sent": return CrmTheme.rgb(0xc084fc)
        case "paid": return CrmTheme.rgb(0x4ade80)
        case "overdue": return CrmTheme.rgb(0xf87171)
        default: return CrmTheme.rgb(0x9ca3af)
        }
    }
    static func payment(_ value: String?) -> String? {
        switch value {
        case "unpaid": return "Nieopłacona"
        case "partially_paid": return "Częściowo opłacona"
        case "paid": return "Opłacona"
        case "overdue": return "Po terminie"
        case "refund_due": return "Do zwrotu"
        case "partially_refunded": return "Zwrócona częściowo"
        case "refunded": return "Zwrócona"
        case "not_applicable": return "Nie dotyczy"
        default: return nil
        }
    }
    static func ksef(_ value: String?) -> String? {
        guard let value = value?.lowercased(), !value.isEmpty else { return nil }
        switch value {
        case "accepted": return "Zaakceptowana"
        case "rejected": return "Odrzucona"
        case "sent": return "Wysłana"
        case "pending": return "W trakcie wysyłki"
        case "error": return "Błąd wysyłki"
        case "draft": return "Szkic"
        case "not_sent": return "Niewysłana"
        default: return "Status do sprawdzenia"
        }
    }
    static func bankPayment(_ payment: FinInvoice.BankPayment) -> String {
        "Z wyciągu (KSeF): \(FinFormat.money(payment.amount, payment.currency)) · \(payment.matchCount > 1 ? "ostatnia płatność " : "")\(FinFormat.day(payment.latestPaymentDate))"
    }
}

@MainActor struct FinanceInvoicesView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @EnvironmentObject private var state: Workspace
    @State private var search = ""
    @State private var type = "all"
    @State private var status = "all"
    @State private var sortOrder = [KeyPathComparator(\FinInvoice.sortIssue, order: .reverse)]
    @State private var invoiceForm: InvoiceFormRequest?
    @State private var finalInvoice: FinalInvoiceRequest?

    private var scopeIDs: Set<String> { Set(finance.scopeCompanies.map(\.id)) }

    private func visible(_ reply: FinInvoicesReply) -> [FinInvoice] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return reply.invoices.filter { invoice in
            guard let company = invoice.companyId, scopeIDs.contains(company) else { return false }
            if type != "all" && invoice.type != type { return false }
            if status != "all" && invoice.status != status && invoice.rawStatus != status { return false }
            guard !needle.isEmpty else { return true }
            return invoice.number.lowercased().contains(needle) || invoice.buyerName.lowercased().contains(needle)
                || (invoice.buyerNip ?? "").contains(needle)
        }
        .sorted(using: sortOrder)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if let reply = store.invoices {
                let rows = visible(reply)
                if let warning = reply.paymentsError { FinBanner(text: warning).padding(.horizontal, 16).padding(.top, 8) }
                totals(rows)
                Divider()
                HStack(spacing: 0) {
                    table(rows)
                        .frame(minWidth: 520, idealWidth: 700)
                    Divider()
                    Group {
                        if let id = store.selectedInvoice {
                            FinanceInvoiceCard(store: store, invoiceID: id).id(id)
                        } else {
                            ContentUnavailableView("Wybierz fakturę", systemImage: "doc.text",
                                                   description: Text("Zobaczysz dane faktury, pozycje, zapłatę, KSeF i czynności."))
                        }
                    }
                    .frame(minWidth: 380, idealWidth: 460, maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let error = store.invoicesError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać faktur", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadInvoices(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie faktur…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await store.loadInvoices() }
        .sheet(item: $invoiceForm) { request in
            InvoiceFormSheet(request: request)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $finalInvoice) { request in
            // „Faktura końcowa” (jak `FinalInvoiceWizardModal`): po wystawieniu — karta nowej faktury.
            FinalInvoiceSheet(advanceID: request.advanceID, eventID: request.eventID, organizationID: request.organizationID) { newID in
                store.selectedInvoice = newID
                Task { await store.loadInvoices(force: true) }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private var canIssue: Bool { store.invoices?.companies.contains { $0.canIssue && scopeIDs.contains($0.id) } ?? false }

    private var header: some View {
        HStack(spacing: 10) {
            TextField("Szukaj: numer, nabywca, NIP", text: $search).textFieldStyle(.roundedBorder).frame(minWidth: 180, idealWidth: 240, maxWidth: 280)
            Picker("", selection: $type) {
                Text("Wszystkie typy").tag("all")
                ForEach(["vat", "proforma", "advance", "final", "corrective"], id: \.self) { Text(FinInvoiceText.type($0)).tag($0) }
            }
            .labelsHidden().fixedSize()
            Picker("", selection: $status) {
                Text("Wszystkie statusy").tag("all")
                ForEach(FinInvoiceText.statuses, id: \.0) { Text($0.1).tag($0.0) }
            }
            .labelsHidden().fixedSize()
            Spacer()
            Button { Task { await store.loadInvoices(force: true) } } label: {
                if store.invoicesLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.invoicesLoading).fixedSize()
            if canIssue {
                Menu {
                    Button("Faktura VAT") { invoiceForm = .new(type: "vat", eventID: nil) }
                    Button("Proforma") { invoiceForm = .new(type: "proforma", eventID: nil) }
                    Button("Faktura zaliczkowa") { invoiceForm = .new(type: "advance", eventID: nil) }
                    Button("Faktura korygująca") { invoiceForm = .new(type: "corrective", eventID: nil) }
                    Divider()
                    Button("Faktura końcowa…") { finalInvoice = FinalInvoiceRequest() }
                } label: { Label("Wystaw fakturę", systemImage: "plus") }
                .fixedSize()
                .help("Wystaw fakturę VAT, proformę, zaliczkową, korektę albo fakturę końcową")
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    /// Sumy jak w CRM — bez pro form i zaliczek.
    private func totals(_ rows: [FinInvoice]) -> some View {
        let summary = rows.filter { $0.type != "proforma" && $0.type != "advance" }
        let net = summary.reduce(0) { $0 + $1.net }
        let gross = summary.reduce(0) { $0 + $1.gross }
        let paid = summary.filter { $0.rawStatus == "paid" }.reduce(0) { $0 + $1.gross }
        return HStack(spacing: 10) {
            FinTile(symbol: "doc.text", label: "Faktury", value: "\(rows.count)")
            FinTile(symbol: "sum", label: "Suma netto", value: FinFormat.money(net), hint: "bez pro form i zaliczek")
            FinTile(symbol: "banknote", label: "Suma brutto", value: FinFormat.money(gross))
            FinTile(symbol: "checkmark.circle", label: "Opłacone (brutto)", value: FinFormat.money(paid))
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func table(_ rows: [FinInvoice]) -> some View {
        Table(rows, selection: $store.selectedInvoice, sortOrder: $sortOrder) {
            TableColumn("Numer", value: \.number) { invoice in
                VStack(alignment: .leading, spacing: 1) {
                    Text(invoice.number.isEmpty ? "bez numeru" : invoice.number).fontWeight(.medium).lineLimit(1)
                    Text(FinInvoiceText.type(invoice.type)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .width(min: 120, ideal: 150)
            TableColumn("Wystawiona", value: \.sortIssue) { invoice in
                Text(FinFormat.day(invoice.issueDate)).monospacedDigit()
            }
            .width(min: 84, ideal: 92, max: 110)
            TableColumn("Termin", value: \.sortDue) { invoice in
                Text(FinFormat.day(invoice.dueDate)).monospacedDigit().foregroundStyle(.secondary)
            }
            .width(min: 84, ideal: 92, max: 110)
            TableColumn("Nabywca", value: \.buyerName) { invoice in
                VStack(alignment: .leading, spacing: 1) {
                    Text(invoice.buyerName).lineLimit(1)
                    if let event = invoice.eventName { Text(event).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            .width(min: 150, ideal: 220)
            TableColumn("Brutto", value: \.gross) { invoice in
                Text(FinFormat.money(invoice.gross, invoice.currency)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 96, ideal: 116, max: 140)
            TableColumn("Status", value: \.status) { invoice in
                HStack(spacing: 5) {
                    Circle().fill(FinInvoiceText.statusColor(invoice.status)).frame(width: 7, height: 7)
                    Text(FinInvoiceText.status(invoice.status)).foregroundStyle(FinInvoiceText.statusColor(invoice.status)).lineLimit(1)
                }
            }
            .width(min: 96, ideal: 116)
        }
        .overlay {
            if rows.isEmpty {
                Text("Brak faktur dla wybranych filtrów.").foregroundStyle(.secondary).allowsHitTesting(false)
            }
        }
    }
}

// MARK: Karta faktury

@MainActor private struct FinanceInvoiceCard: View {
    @ObservedObject var store: FinanceBankStore
    let invoiceID: String
    @EnvironmentObject private var state: Workspace
    @State private var detail: FinInvoiceDetail?
    @State private var loadError: String?
    @State private var preview: BankPreviewItem?
    @State private var markingPaid = false
    @State private var cancelling = false
    @State private var confirmDelete = false
    @State private var invoiceForm: InvoiceFormRequest?
    @State private var emailing = false
    @State private var confirmKsef = false
    @State private var sendingKsef = false
    @State private var convertingProforma = false
    @State private var editing = false
    @State private var finalInvoice: FinalInvoiceRequest?

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć faktury", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await load() }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
        .sheet(isPresented: $markingPaid) { if let detail { InvoicePaidSheet(store: store, detail: detail) { Task { await load() } } } }
        .sheet(isPresented: $cancelling) { if let detail { InvoiceCancelSheet(store: store, detail: detail) { Task { await load() } } } }
        .sheet(item: $invoiceForm) { request in
            InvoiceFormSheet(request: request)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $emailing) {
            if let detail {
                // „Wyślij email” z karty (jak `SendInvoiceEmailModal` w trybie faktury).
                FinanceReminderSheet(store: state.finance, invoiceID: detail.invoice.id, buyerName: detail.invoice.buyerName, mode: .invoice) {
                    store.invoiceEmailsSent[detail.invoice.id, default: 0] += 1
                    Task { await load() }
                }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(isPresented: $sendingKsef) {
            if let detail {
                InvoiceKsefSendSheet(invoiceID: detail.invoice.id, invoiceNumber: detail.invoice.number) { _ in
                    // Jak w CRM: świeża karta, potem PDF z numerem i kodem KSeF.
                    Task {
                        await load()
                        await store.loadInvoices(force: true)
                        await store.generateInvoicePdf(detail.invoice.id, regenerate: detail.invoice.hasPdf)
                        await load()
                    }
                }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(isPresented: $convertingProforma) {
            if let detail {
                // „Faktura z pro formy” (jak `ConvertProformaModal`): po wystawieniu — karta nowej faktury.
                ProformaConvertSheet(proformaID: detail.invoice.id, proformaNumber: detail.invoice.number) { newID in
                    store.selectedInvoice = newID
                    Task { await store.loadInvoices(force: true) }
                }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: $finalInvoice) { request in
            // „Faktura końcowa” z karty zaliczki (jak `FinalInvoiceWizardModal` z `initialAdvanceInvoiceId`): po wystawieniu —
            // karta nowej faktury.
            FinalInvoiceSheet(advanceID: request.advanceID) { newID in
                store.selectedInvoice = newID
                Task { await store.loadInvoices(force: true) }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $editing) {
            // „Edytuj” (jak `/crm/invoices/[id]/edit`): szkic i pro forma; wystawiony dokument — przejście do korekty.
            InvoiceEditSheet(invoiceID: invoiceID) {
                Task {
                    await load()
                    await store.loadInvoices(force: true)
                }
            } onCorrect: {
                Task {
                    // Następne okno dopiero po zamknięciu edytora.
                    try? await Task.sleep(for: .milliseconds(400))
                    invoiceForm = .corrective(relatedID: invoiceID)
                }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .alert("Czy na pewno chcesz wysłać tę fakturę do KSeF?", isPresented: $confirmKsef) {
            Button("Anuluj", role: .cancel) {}
            Button("Wyślij do KSeF") { sendingKsef = true }
        } message: { Text("Tej operacji nie można cofnąć.") }
        .confirmationDialog("Usunąć fakturę \(detail?.invoice.number ?? "")?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                Task {
                    if await store.invoiceAction("Usuwanie faktury…", "invoiceDelete", ["id": .string(invoiceID)]) { store.selectedInvoice = nil }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Usunąć można tylko szkic i pro formę; numeracja zostanie uporządkowana. Tej operacji nie można cofnąć.") }
    }

    private func load() async {
        loadError = nil
        do {
            detail = try await store.invoiceDetail(invoiceID)
        } catch {
            loadError = store.failureText(error, "Nie udało się otworzyć faktury.")
        }
    }

    private func content(_ d: FinInvoiceDetail) -> some View {
        let invoice = d.invoice
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(invoice.number.isEmpty ? "Faktura bez numeru" : invoice.number).font(.title3.weight(.semibold)).textSelection(.enabled)
                        BankChip(text: FinInvoiceText.status(invoice.status), color: FinInvoiceText.statusColor(invoice.status))
                        Spacer()
                        Text(FinFormat.money(invoice.gross, invoice.currency)).font(.title3.weight(.semibold)).monospacedDigit()
                    }
                    Text([FinInvoiceText.type(invoice.type), invoice.companyName, invoice.eventName].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                actions(d)
                HStack(alignment: .top, spacing: 10) {
                    party("Sprzedawca", d.seller)
                    party("Nabywca", d.buyer)
                }
                facts(d)
                if let converted = d.proformaConvertedTo {
                    Button { store.selectedInvoice = converted } label: { Label("Zobacz wystawioną fakturę", systemImage: "arrow.right.circle") }
                        .buttonStyle(.link)
                }
                if !d.items.isEmpty { items(d) }
                if !d.related.isEmpty { related(d) }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func actions(_ d: FinInvoiceDetail) -> some View {
        let invoice = d.invoice
        let emailsSent = store.invoiceEmailsSent[invoice.id] ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            // Dokument PDF i e-mail (jak przyciski karty faktury w CRM).
            HStack(spacing: 8) {
                Button {
                    Task {
                        // Zapisany PDF — ten sam plik co w dokumentach; bez zapisu — wydruk z bieżących danych faktury.
                        if invoice.hasPdf {
                            if let file = await store.storedInvoicePdf(invoice.id) { preview = .file(file) }
                        } else {
                            preview = await store.preview(source: "invoice", id: invoice.id)
                        }
                    }
                } label: { Label("Podgląd PDF", systemImage: "doc.richtext") }
                .help(invoice.hasPdf ? "Zapisany PDF faktury — podgląd, druk i zapis" : "Wydruk z bieżących danych faktury (PDF nie jest jeszcze zapisany)")
                Button {
                    Task { if await store.generateInvoicePdf(invoice.id, regenerate: invoice.hasPdf) { await load() } }
                } label: {
                    Label(invoice.hasPdf ? "Regeneruj PDF" : "Generuj PDF", systemImage: invoice.hasPdf ? "arrow.clockwise" : "arrow.down.doc")
                }
                .help("Wydruk z aktualnych danych faktury zapisany w plikach (faktura wydarzenia — w folderze „Faktury” wydarzenia)")
                if d.actions.canEmail ?? (invoice.rawStatus != "cancelled") {
                    Button { emailing = true } label: {
                        Label(emailsSent > 0 ? "Wyślij email ponownie" : "Wyślij email", systemImage: "envelope")
                    }
                }
            }
            HStack(spacing: 8) {
                if d.actions.canSendKsef == true {
                    Button { confirmKsef = true } label: {
                        Label(d.actions.ksefResend == true ? "Wyślij ponownie do KSeF" : "Wyślij do KSeF", systemImage: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                if d.actions.canMarkSent {
                    Button { Task { if await store.invoiceAction("Zmiana statusu…", "invoiceStatus", ["id": .string(invoice.id), "status": .string("sent")]) { await load() } } } label: {
                        Label("Oznacz jako wysłaną", systemImage: "paperplane")
                    }
                }
                if d.actions.canMarkPaid {
                    Button { markingPaid = true } label: { Label("Oznacz jako opłaconą…", systemImage: "checkmark.circle") }
                }
                Menu {
                    if d.actions.canEdit ?? (invoice.rawStatus != "cancelled") {
                        Button("Edytuj…") { editing = true }
                            .help("Edycja szkicu i pro formy; wystawiony dokument zmienia się korektą.")
                    }
                    if invoice.hasPdf {
                        Button("Pobierz PDF") { Task { if let file = await store.storedInvoicePdf(invoice.id) { store.save(file) } } }
                    }
                    if d.actions.canUpo == true {
                        Button("Pobierz UPO (XML)") { Task { await store.downloadInvoiceUpo(invoice.id) } }
                            .help("UPO — urzędowe poświadczenie odbioru z KSeF")
                    }
                    Divider()
                    // Dokumenty powiązane jak na karcie faktury w CRM: tylko do wystawionego dokumentu (nie pro formy).
                    let canCreateRelated = !invoice.proforma && ["issued", "sent", "paid", "overdue"].contains(invoice.rawStatus)
                    if canCreateRelated && invoice.type == "advance" {
                        Button("Kolejna faktura zaliczkowa") { invoiceForm = .nextAdvance(sourceID: invoice.id) }
                            .help("Nowa zaliczka dla tego samego zamówienia, z osobną kwotą i wpłatą.")
                        Button("Faktura końcowa…") { finalInvoice = FinalInvoiceRequest(advanceID: invoice.id) }
                            .help("Faktura na całe zamówienie, rozliczająca nierozliczone zaliczki.")
                    }
                    if canCreateRelated && ["vat", "advance", "final"].contains(invoice.type) {
                        Button("Faktura korygująca") { invoiceForm = .corrective(relatedID: invoice.id) }
                            .help("Utwórz osobny dokument korygujący tę fakturę.")
                    }
                    if d.actions.canConvertProforma == true {
                        Button("Faktura z pro formy…") { convertingProforma = true }
                            .help("Utwórz fakturę VAT lub zaliczkową na podstawie tej pro formy.")
                    }
                    Button("Otwórz kartę faktury w CRM") { state.openCRM("/crm/invoices/\(invoice.id)") }
                    if d.actions.canCancel || d.actions.canDelete { Divider() }
                    if d.actions.canCancel { Button("Anuluj fakturę…") { cancelling = true } }
                    if d.actions.canDelete { Button("Usuń szkic / pro formę…", role: .destructive) { confirmDelete = true } }
                } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                .fixedSize()
            }
        }
        .controlSize(.small)
    }

    private func party(_ title: String, _ party: FinInvoiceDetail.Party) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(party.name ?? "—").font(.callout.weight(.semibold)).textSelection(.enabled)
            if let nip = party.nip { Text("NIP \(nip)").font(.caption).textSelection(.enabled) }
            if party.privatePerson == true { Text("osoba prywatna").font(.caption2).foregroundStyle(.secondary) }
            if let address = party.address { Text(address).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            if let email = party.email { Text(email).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func facts(_ d: FinInvoiceDetail) -> some View {
        let invoice = d.invoice
        var rows: [(String, String)] = [
            ("Wystawiona", FinFormat.day(invoice.issueDate) + (d.issuePlace.map { ", \($0)" } ?? "")),
            ("Data sprzedaży", FinFormat.day(invoice.saleDate)),
            ("Termin płatności", FinFormat.day(invoice.dueDate)),
            ("Netto · VAT · brutto", "\(FinFormat.money(invoice.net, invoice.currency)) · \(FinFormat.money(invoice.vat, invoice.currency)) · \(FinFormat.money(invoice.gross, invoice.currency))"),
        ]
        if let remaining = d.remainingGross { rows.append(("Do zapłaty po zaliczkach", FinFormat.money(remaining, invoice.currency))) }
        rows.append(("Płatność", [FinInvoiceText.payment(d.actions.paymentStatus), d.paymentMethod, invoice.paidDate.map { "zapłacono \(FinFormat.day($0))" }].compactMap { $0 }.joined(separator: " · ")))
        if let payment = invoice.bankPayment { rows.append(("Wyciąg", FinInvoiceText.bankPayment(payment))) }
        if let account = d.bankAccount { rows.append(("Rachunek", BankFormat.account(account))) }
        if let ksef = FinInvoiceText.ksef(invoice.ksefStatus) {
            rows.append(("KSeF", ksef + (invoice.ksefReference.map { " · \($0)" } ?? "") + (d.ksefSentAt.map { " · wysłano \(FinFormat.dateTime($0))" } ?? "")))
        }
        if invoice.proforma { rows.append(("KSeF", "Pro forma nie jest wysyłana do KSeF.")) }
        if let error = d.ksefError { rows.append(("Błąd KSeF", error)) }
        if let error = d.recipientError { rows.append(("Odbiorca KSeF", error)) }
        rows.append(("PDF", invoice.hasPdf ? "zapisany w plikach" + (invoice.pdfGeneratedAt.map { " · \(FinFormat.dateTime($0))" } ?? "") : "nie wygenerowano"))
        let emailsSent = store.invoiceEmailsSent[invoice.id] ?? 0
        if emailsSent > 0 { rows.append(("E-mail", "Wysłano e-mail: \(emailsSent)×")) }
        if let reason = d.correctionReason { rows.append(("Powód korekty", reason + (d.correctedNumber.map { " (do \($0))" } ?? ""))) }
        if let reason = d.cancellationReason { rows.append(("Powód anulowania", reason)) }
        if let notes = d.notes { rows.append(("Uwagi", notes)) }
        return Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 5) {
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

    private func items(_ d: FinInvoiceDetail) -> some View {
        FinCard("Pozycje", symbol: "list.bullet") {
            VStack(spacing: 0) {
                ForEach(Array(d.items.enumerated()), id: \.element.id) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.name).font(.callout).fixedSize(horizontal: false, vertical: true)
                            Text([item.quantity.map { "\(BankFormat.plain($0)) \(item.unit ?? "")" }, item.priceNet.map { "× \(FinFormat.money($0, d.invoice.currency)) netto" }, item.vatRate.map { "VAT \($0)" }]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Text(item.gross.map { FinFormat.money($0, d.invoice.currency) } ?? "—").font(.callout).monospacedDigit()
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    if index < d.items.count - 1 { Divider().padding(.leading, 14) }
                }
            }
        }
    }

    private func related(_ d: FinInvoiceDetail) -> some View {
        FinCard("Powiązane dokumenty", symbol: "link") {
            VStack(spacing: 0) {
                ForEach(d.related) { r in
                    Button { store.selectedInvoice = r.id } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.number).font(.callout.weight(.medium))
                                Text("\(FinInvoiceText.type(r.type)) · \(r.relation) · \(FinFormat.day(r.issueDate))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(FinFormat.money(r.gross)).monospacedDigit()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: Oznacz jako opłaconą — data pełnej zapłaty (jak potwierdzenie na karcie faktury w CRM)

@MainActor private struct InvoicePaidSheet: View {
    @ObservedObject var store: FinanceBankStore
    let detail: FinInvoiceDetail
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        BankSheetFrame("Potwierdź pełną zapłatę", symbol: "checkmark.circle", subtitle: "Faktura \(detail.invoice.number) · \(detail.invoice.buyerName)") {
            Form {
                LabeledContent("Łączna potwierdzona zapłata", value: FinFormat.money(detail.actions.paymentBase, detail.invoice.currency))
                if detail.invoice.isFinal { Text("To kwota po odjęciu rozliczonych zaliczek.").font(.caption).foregroundStyle(.secondary) }
                if let payment = detail.invoice.bankPayment { Text(FinInvoiceText.bankPayment(payment)).font(.caption) }
                DatePicker("Data pełnej zapłaty", selection: $date, in: ...Date(), displayedComponents: .date)
                Text("Potwierdź po sprawdzeniu wpłaty. To ręczne potwierdzenie pełnego rozliczenia, nie dopasowanie do wyciągu.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Oznacz jako opłaconą") {
                Task {
                    let body: [String: JSONValue] = ["id": .string(detail.invoice.id), "status": .string("paid"), "paidDate": .string(FinanceText.dayString(date))]
                    if await store.invoiceAction("Potwierdzanie zapłaty…", "invoiceStatus", body) { dismiss(); done() }
                }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        }
        .frame(minWidth: 480, idealWidth: 520, minHeight: 360, idealHeight: 400)
    }
}

// MARK: Anulowanie faktury (`cancel_local_invoice`)

@MainActor private struct InvoiceCancelSheet: View {
    @ObservedObject var store: FinanceBankStore
    let detail: FinInvoiceDetail
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var notDelivered = false

    var body: some View {
        BankSheetFrame("Anulowanie faktury", symbol: "xmark.circle", subtitle: "Faktura \(detail.invoice.number) · \(detail.invoice.buyerName)") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Numer zostaje w ewidencji, faktura dostaje status „anulowana” i nie wchodzi do rozliczeń ani raportów. Anulowanej faktury nie przywraca się. Jeśli faktura trafiła do nabywcy — nie anuluj jej, wystaw korektę.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("Powód anulowania").font(.caption)
                TextEditor(text: $reason).font(.body).frame(minHeight: 80).padding(4)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                if detail.actions.needsNotDelivered {
                    Toggle("Potwierdzam, że faktura nie trafiła do nabywcy (nie została wysłana ani przekazana).", isOn: $notDelivered).toggleStyle(.checkbox)
                }
            }
            .padding(18)
        } footer: {
            Spacer()
            Button("Wróć", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Anuluj fakturę", role: .destructive) {
                Task {
                    let body: [String: JSONValue] = ["id": .string(detail.invoice.id), "reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines)), "notDelivered": .bool(notDelivered)]
                    if await store.invoiceAction("Anulowanie faktury…", "invoiceCancel", body) { dismiss(); done() }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 5 || (detail.actions.needsNotDelivered && !notDelivered))
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 380, idealHeight: 420)
    }
}
