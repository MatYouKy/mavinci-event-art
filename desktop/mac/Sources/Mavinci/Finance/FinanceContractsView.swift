import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Umowy stałe — najem, leasing, abonamenty (jak „Dokumenty i rozliczenia → Umowy stałe” w CRM, `RecurringContractsPanel`)
//
// Zobowiązania i należności płacone co miesiąc, kwartał lub rok bez faktury za każdy okres (np. najem garażu od osoby
// prywatnej, rata pożyczki, abonament). Z lewej lista umów działalności (aktywne / zakończone / wszystkie) z kratkami
// ostatnich okresów, z prawej wybrana umowa: okresy, przelewy z wyciągów (odpinanie, przejście do uzgodnienia) i pliki
// umowy i aneksów — podgląd, „Dodaj plik” i „Skanuj” (kilka stron w jeden PDF, `Scanner/DocumentScanner.swift`). Formularz
// (nowa umowa, edycja, „Nowa umowa z tej płatności” w uzgodnieniu) też ma „Skanuj umowę” i „Dodaj plik” — pliki wgrywają
// się po zapisaniu umowy. Serwer: `/bridge/native/v1/finance/bank` (op=recurring, saveContract, contractDelete,
// contractFile, contractFileRemove, undo, file&kind=contract). Zmiany: poziom „Zarządzanie finansami” działalności.

struct FinContractsReply: Decodable {
    var companyId: String
    var canManage: Bool
    var contracts: [FinContract]
}

struct FinContract: Decodable, Identifiable {
    struct Period: Decodable, Identifiable {
        var start: String
        var label: String
        var dueDate: String?
        var amount: Double
        var paid: Double
        var missing: Double
        var status: String
        var id: String { start }
    }
    struct Payment: Decodable, Identifiable {
        var id: String
        var transactionId: String
        var periodLabel: String
        var date: String
        var amount: Double
        var method: String
        var reasons: [String]
        var title: String?
        var counterparty: String?
        var statementYear: Int
        var statementMonth: Int
    }
    struct File: Decodable, Identifiable {
        var id: String
        var name: String
        var size: Double?
        var createdAt: String?
    }
    var id: String
    var companyId: String
    var kind: String
    var direction: String
    var title: String
    var counterparty: String
    var nip: String?
    var account: String?
    var amount: Double
    var currency: String
    var cycle: String
    var paymentDay: Int?
    var startDate: String
    var endDate: String?
    var paymentsFrom: String?
    var status: String
    var expectsInvoice: Bool
    var notes: String?
    var summary: String
    var overdue: Int
    var overdueAmount: Double
    var nextDueDate: String?
    var periods: [Period]
    var payments: [Payment]
    var files: [File]

    var ended: Bool { status == "ended" }
    /// Okresy w miesiącu (kwartał, rok przeliczone na miesiąc) — do sumy „miesięcznie”.
    var monthlyAmount: Double { amount / (cycle == "yearly" ? 12 : cycle == "quarterly" ? 3 : 1) }
}

/// Plik umowy czekający na zapis umowy (skan połączony w PDF albo plik z dysku).
struct ContractPendingFile: Identifiable {
    let id = UUID()
    let part: BankUploadPart
    let pages: Int?
}

enum RecurringContractText {
    static let maxFile = 20 * 1024 * 1024
    static let fileTypes = ["pdf", "doc", "docx", "odt", "zip", "png", "jpg", "jpeg", "webp", "heic"]
    static let scanIntro = "Połóż pierwszą stronę umowy na szybie i kliknij „Skanuj pierwszą stronę”, potem kolejną — „Dodaj stronę”. Strony możesz obejrzeć, przestawić albo usunąć; „Zakończ” łączy je w jeden PDF dopisany do plików umowy."

    static func kind(_ value: String) -> String { ContractStatus.kinds.first { $0.0 == value }?.1 ?? "Inna umowa" }
    static func direction(_ value: String) -> String { value == "income" ? "Przychód — otrzymujemy" : "Koszt — płacimy" }

    static func periodColor(_ status: String) -> Color {
        switch status {
        case "paid": return CrmTheme.rgb(0x86efac)
        case "overpaid": return CrmTheme.rgb(0x93c5fd)
        case "missing": return CrmTheme.rgb(0xfcd34d)
        case "overdue": return CrmTheme.rgb(0xfca5a5)
        default: return CrmTheme.rgb(0xcbd5e1)
        }
    }

    /// „<tytuł umowy> — skan RRRR-MM-DD.pdf” — nazwa w „Plikach umowy”.
    static func scanName(_ title: String) -> String {
        let cleaned = title.components(separatedBy: CharacterSet(charactersIn: "\\/:*?\"<>|")).joined(separator: " ")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let name = String(cleaned.prefix(80)).trimmingCharacters(in: .whitespaces)
        return "\(name.isEmpty ? "Umowa" : name) — skan \(FinanceText.dayString(Date())).pdf"
    }

    static func size(_ bytes: Int) -> String { DocumentScanner.size(bytes) }
}

// MARK: Dane

extension FinanceBankStore {
    var contractList: FinContractsReply? { company.flatMap { contractLists[$0.id] } }

    func loadContracts(force: Bool = false) async {
        guard let company else { return }
        if !force, contractLists[company.id] != nil { return }
        contractsLoading = true
        defer { contractsLoading = false }
        do {
            contractLists[company.id] = try await get(["op": "recurring", "company": company.id], as: FinContractsReply.self)
            contractsError = nil
        } catch {
            contractsError = failureText(error, "Nie udało się wczytać umów stałych.")
        }
    }

    /// Zmiana umowy (usunięcie, plik, odpięcie przelewu), potem świeża lista i uzgodnienie (stany umów w miesiącu).
    @discardableResult func contractAction(_ pending: String, _ op: String, _ body: [String: JSONValue]) async -> [String: JSONValue]? {
        guard let reply = await act(pending, op, body) else { return nil }
        contractLists = [:]
        await refreshReconciliation()
        await loadContracts(force: true)
        return reply
    }

    /// Plik umowy (skan albo plik z dysku) od razu do „Plików umowy”.
    func addContractFile(_ contractID: String, part: BankUploadPart, pending: String, success: String? = nil) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            let reply = try await withBusy(workspace, pending) {
                try await upload("contractFile", fields: ["contractId": contractID, "fileName": part.name], part: part, limit: RecurringContractText.maxFile)
            }
            if let success { workspace.succeed(success) } else { announce(reply) }
            contractLists = [:]
            await loadContracts(force: true)
        } catch {
            workspace.error = failureText(error, "Nie udało się wgrać pliku.")
        }
    }

    /// Zapis umowy, potem pliki czekające w formularzu (po zapisie — ścieżka pliku zależy od umowy). Błąd pliku nie cofa
    /// zapisanej umowy. Wynik: identyfikator umowy albo komunikat błędu zapisu (pokazywany w formularzu).
    func saveContract(_ body: [String: JSONValue], files: [ContractPendingFile]) async -> (id: String?, error: String?) {
        guard let workspace else { return (nil, "Brak połączenia z serwerem CRM.") }
        guard workspace.canWrite else { return (nil, "Zapis wymaga połączenia z serwerem CRM.") }
        let text = files.isEmpty ? "Zapisywanie umowy…" : files.count == 1 ? "Zapisywanie umowy i pliku…" : "Zapisywanie umowy i plików (\(files.count))…"
        var failures: [String] = []
        var saveError: String?
        let id: String? = await withBusy(workspace, text) {
            do {
                let reply = try await post("saveContract", body)
                guard let id = reply["id"]?.text.nonEmpty else { saveError = "Serwer nie potwierdził zapisu umowy."; return nil }
                for file in files {
                    do {
                        _ = try await upload("contractFile", fields: ["contractId": id, "fileName": file.part.name], part: file.part, limit: RecurringContractText.maxFile)
                    } catch {
                        failures.append(failureText(error, "Nie udało się wgrać pliku „\(file.part.name)”."))
                    }
                }
                return id
            } catch {
                saveError = failureText(error, "Nie udało się zapisać umowy.")
                return nil
            }
        }
        guard let id else { return (nil, saveError ?? "Nie udało się zapisać umowy.") }
        if failures.isEmpty {
            workspace.succeed(files.isEmpty ? "Umowa zapisana." : files.count == 1 ? "Umowa zapisana razem z plikiem." : "Umowa zapisana razem z plikami (\(files.count)).")
        } else {
            let what = files.count == 1 ? "pliku nie udało się wgrać" : "nie udało się wgrać plików: \(failures.count) z \(files.count)"
            workspace.notice = "Umowa zapisana, ale \(what) (\(failures[0])). Dodaj \(failures.count == 1 ? "go" : "je") w szczegółach umowy."
        }
        contractLists = [:]
        await refreshReconciliation()
        await loadContracts(force: true)
        return (id, nil)
    }
}

// MARK: Ekran „Umowy stałe”

@MainActor struct FinanceContractsView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @Environment(\.crmTheme) private var theme
    @State private var form: ContractFormTarget?
    @State private var preview: BankPreviewItem?

    private var visible: [FinContract] {
        (store.contractList?.contracts ?? []).filter { store.contractsStatus == "all" || $0.status == store.contractsStatus }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if let reply = store.contractList {
                totals(reply.contracts)
                Divider()
                if visible.isEmpty {
                    ContentUnavailableView {
                        Label(store.contractsStatus == "ended" ? "Brak zakończonych umów" : "Brak umów stałych", systemImage: "calendar.badge.clock")
                    } description: {
                        Text(store.contractsStatus == "ended" ? "Zakończone umowy z płatnościami zostają tu w historii." : "Dodaj umowę (np. najem garażu) albo utwórz ją z płatności w „Uzgodnieniu wyciągów”.")
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    HStack(spacing: 0) {
                        List(selection: $store.openContract) {
                            ForEach(visible) { c in row(c).tag(c.id) }
                        }
                        .listStyle(.inset)
                        .frame(minWidth: 340, idealWidth: 420, maxWidth: 500)
                        Divider()
                        Group {
                            if let id = store.openContract, let c = visible.first(where: { $0.id == id }) {
                                ContractDetail(store: store, finance: finance, contract: c, canManage: reply.canManage,
                                               edit: { form = .edit(c) }, preview: { preview = $0 })
                                    .id(c.id)
                            } else {
                                ContentUnavailableView("Wybierz umowę", systemImage: "calendar.badge.clock",
                                                       description: Text("Zobaczysz okresy, przelewy z wyciągów i pliki umowy."))
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            } else if let error = store.contractsError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać umów stałych", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadContracts(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie umów stałych…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: store.company?.id ?? "") { await store.loadContracts() }
        .sheet(item: $form) { target in
            if let company = store.company?.id {
                switch target {
                case .new:
                    ContractFormSheet(store: store, companyID: company, contract: nil, transaction: nil) { id in store.openContract = id }
                case .edit(let c):
                    ContractFormSheet(store: store, companyID: company, contract: c, transaction: nil) { _ in }
                }
            }
        }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    private var header: some View {
        HStack(spacing: 10) {
            BankCompanyPicker(store: store)
            Picker("", selection: $store.contractsStatus) {
                Text("Aktywne").tag("active")
                Text("Zakończone").tag("ended")
                Text("Wszystkie").tag("all")
            }
            .labelsHidden().fixedSize()
            Spacer()
            Button { Task { await store.loadContracts(force: true) } } label: {
                if store.contractsLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.contractsLoading).fixedSize()
            if store.contractList?.canManage == true {
                Button { form = .new } label: { Label("Dodaj umowę", systemImage: "plus") }.buttonStyle(.borderedProminent).fixedSize()
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func totals(_ contracts: [FinContract]) -> some View {
        let active = contracts.filter { !$0.ended }
        let monthlyCost = active.filter { $0.direction == "cost" && $0.currency == "PLN" }.reduce(0) { $0 + $1.monthlyAmount }
        let monthlyIncome = active.filter { $0.direction == "income" && $0.currency == "PLN" }.reduce(0) { $0 + $1.monthlyAmount }
        let overdue = contracts.reduce(0) { $0 + $1.overdue }
        let overdueAmount = contracts.reduce(0) { $0 + $1.overdueAmount }
        return HStack(spacing: 10) {
            FinTile(symbol: "calendar.badge.clock", label: "Aktywne umowy", value: "\(active.count)")
            FinTile(symbol: "arrow.up.right", label: "Miesięcznie (PLN) — koszty", value: FinFormat.money(monthlyCost),
                    hint: monthlyIncome > 0 ? "przychody \(FinFormat.money(monthlyIncome))" : "kwartał i rok przeliczone na miesiąc")
            FinTile(symbol: overdue > 0 ? "exclamationmark.triangle" : "checkmark.circle", label: "Po terminie",
                    value: overdue > 0 ? "\(overdue) \(overdue == 1 ? "okres" : "okresów")" : "Brak zaległości",
                    hint: overdue > 0 ? "brakuje \(FinFormat.money(overdueAmount))" : nil, warn: overdue > 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func row(_ c: FinContract) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(c.title).font(.callout.weight(.semibold)).lineLimit(1)
                BankChip(text: RecurringContractText.kind(c.kind), color: CrmTheme.rgb(0xcbd5e1))
                if c.direction == "income" { BankChip(text: "otrzymujemy", color: CrmTheme.rgb(0x86efac)) }
                if c.ended { BankChip(text: "zakończona \(FinFormat.day(c.endDate))", color: CrmTheme.rgb(0xcbd5e1)) }
                if c.expectsInvoice { BankChip(text: "z fakturami", color: theme.accent) }
                if !c.files.isEmpty { Label("\(c.files.count)", systemImage: "doc").font(.caption2).foregroundStyle(.secondary) }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(FinFormat.money(c.amount, c.currency)).font(.callout).monospacedDigit()
                    Text(ContractStatus.cycle(c.cycle)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(c.counterparty + (c.account.map { " · \(BankFormat.account($0))" } ?? "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(c.summary).font(.caption2).foregroundStyle(c.overdue > 0 ? CrmTheme.rgb(0xfca5a5) : Color.secondary).lineLimit(2)
            ContractPeriodStrip(periods: Array(c.periods.suffix(12)), currency: c.currency, compact: true)
        }
        .padding(.vertical, 4)
    }
}

enum ContractFormTarget: Identifiable {
    case new
    case edit(FinContract)
    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let c): return c.id
        }
    }
}

/// Okresy jako kolorowe kratki: opłacone / brak / po terminie / przyszłe (podpowiedź: należne, zapłacono, termin).
struct ContractPeriodStrip: View {
    let periods: [FinContract.Period]
    let currency: String
    var compact = false

    var body: some View {
        if !periods.isEmpty {
            if compact {
                HStack(spacing: 3) {
                    ForEach(periods) { p in
                        RoundedRectangle(cornerRadius: 2).fill(RecurringContractText.periodColor(p.status).opacity(0.55))
                            .frame(width: 11, height: 11).help(tip(p))
                    }
                }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 84, maximum: 110), spacing: 6)], alignment: .leading, spacing: 6) {
                    ForEach(periods) { p in
                        VStack(spacing: 1) {
                            Text(p.label).font(.caption2.weight(.semibold)).lineLimit(1)
                            Text(caption(p)).font(.caption2).lineLimit(1).opacity(0.85)
                        }
                        .padding(.horizontal, 6).padding(.vertical, 4)
                        .frame(maxWidth: .infinity)
                        .background(RecurringContractText.periodColor(p.status).opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(RecurringContractText.periodColor(p.status).opacity(0.4)))
                        .foregroundStyle(RecurringContractText.periodColor(p.status))
                        .help(tip(p))
                    }
                }
            }
        }
    }

    private func caption(_ p: FinContract.Period) -> String {
        switch p.status {
        case "paid", "overpaid": return FinFormat.money(p.paid, currency)
        case "invoice": return "faktury"
        default: return p.paid > 0.009 ? "brak \(FinFormat.money(p.missing, currency))" : ContractStatus.periodLabel(p.status).lowercased()
        }
    }

    private func tip(_ p: FinContract.Period) -> String {
        var text = "\(p.label) · \(ContractStatus.periodLabel(p.status))\nNależne \(FinFormat.money(p.amount, currency)), zapłacono \(FinFormat.money(p.paid, currency))"
        if p.missing > 0.009 { text += ", brakuje \(FinFormat.money(p.missing, currency))" }
        text += "\nTermin płatności \(FinFormat.day(p.dueDate))"
        return text
    }
}

// MARK: Umowa: okresy, przelewy, pliki

@MainActor private struct ContractDetail: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    let contract: FinContract
    let canManage: Bool
    let edit: () -> Void
    let preview: (BankPreviewItem) -> Void
    @State private var confirmDelete = false
    @State private var removeFile: FinContract.File?
    @State private var scanning = false

    private var c: FinContract { contract }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(c.title).font(.title3.weight(.semibold))
                        if c.ended { BankChip(text: "zakończona", color: CrmTheme.rgb(0xcbd5e1)) }
                        Spacer()
                        if canManage {
                            Button { edit() } label: { Label("Edytuj", systemImage: "pencil") }
                            Button(role: .destructive) { confirmDelete = true } label: { Label(c.payments.isEmpty ? "Usuń" : "Zakończ", systemImage: "trash") }
                                .disabled(c.ended && !c.payments.isEmpty)
                                .help(c.payments.isEmpty ? "Usuń umowę razem z plikami" : "Umowa z płatnościami zostanie zakończona, nie usunięta")
                        }
                    }
                    .controlSize(.small)
                    Text(c.summary).font(.callout)
                    Text(details).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                periods
                payments
                files
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .confirmationDialog(c.payments.isEmpty ? "Usunąć umowę „\(c.title)”?" : "Zakończyć umowę „\(c.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(c.payments.isEmpty ? "Usuń" : "Zakończ", role: .destructive) {
                Task {
                    if let reply = await store.contractAction(c.payments.isEmpty ? "Usuwanie umowy…" : "Kończenie umowy…", "contractDelete", ["id": .string(c.id)]),
                       reply["deleted"]?.flag == true {
                        store.openContract = nil
                    }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text(c.payments.isEmpty ? "Pliki umowy też zostaną usunięte." : "Umowa ma przypisane przelewy — zostanie zakończona i zostanie w historii z płatnościami.")
        }
        .confirmationDialog("Usunąć plik z umowy?", isPresented: Binding(get: { removeFile != nil }, set: { if !$0 { removeFile = nil } }), titleVisibility: .visible) {
            Button("Usuń plik", role: .destructive) {
                if let file = removeFile {
                    Task { await store.contractAction("Usuwanie pliku…", "contractFileRemove", ["contractId": .string(c.id), "id": .string(file.id)]) }
                }
                removeFile = nil
            }
            Button("Anuluj", role: .cancel) { removeFile = nil }
        } message: { Text(removeFile?.name ?? "") }
        .sheet(isPresented: $scanning) {
            DocumentScannerSheet(title: "Skanuj umowę", intro: RecurringContractText.scanIntro, maxBytes: RecurringContractText.maxFile) { data, pages in
                let part = BankUploadPart(data: data, name: RecurringContractText.scanName(c.title), mime: "application/pdf")
                Task { await store.addContractFile(c.id, part: part, pending: "Dodawanie skanu umowy…", success: "Skan umowy dodany (\(DocumentScanner.pagesLabel(pages))).") }
            }
        }
    }

    private var details: String {
        var parts = [RecurringContractText.direction(c.direction), RecurringContractText.kind(c.kind)]
        parts.append("od \(FinFormat.day(c.startDate))" + (c.endDate.map { " do \(FinFormat.day($0))" } ?? " (czas nieokreślony)"))
        if let from = c.paymentsFrom { parts.append("rozliczane od \(FinFormat.monthLabel(from))") }
        parts.append("\(FinFormat.money(c.amount, c.currency)) \(ContractStatus.cycle(c.cycle))" + (c.paymentDay.map { ", do \($0). dnia" } ?? ""))
        parts.append(c.counterparty)
        if let account = c.account { parts.append(BankFormat.account(account)) }
        if let nip = c.nip { parts.append("NIP \(nip)") }
        if let notes = c.notes, !notes.isEmpty { parts.append(notes) }
        return parts.joined(separator: " · ")
    }

    private var periods: some View {
        FinCard("Okresy", symbol: "calendar", note: c.expectsInvoice ? "Kontrahent wystawia faktury — płatności przypisuj do faktur (KSeF lub spoza KSeF). Okresy są tu tylko informacyjnie." : nil) {
            if c.periods.isEmpty {
                Text("Brak okresów do rozliczenia.").font(.callout).foregroundStyle(.secondary).padding(14)
            } else {
                ContractPeriodStrip(periods: c.periods, currency: c.currency).padding(14)
            }
        } accessory: {
            HStack(spacing: 8) {
                ForEach(["paid", "missing", "overdue", "upcoming"], id: \.self) { status in
                    HStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 2).fill(RecurringContractText.periodColor(status).opacity(0.55)).frame(width: 9, height: 9)
                        Text(ContractStatus.periodLabel(status)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var payments: some View {
        FinCard("Przelewy z wyciągów", symbol: "building.columns") {
            if c.payments.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Brak przypisanych przelewów. Przelew na rachunek z umowy z kwotą okresu przypisze się podczas uzgadniania wyciągu; inny przypiszesz w „Uzgodnieniu wyciągów” (Przypisz do umowy).")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Przejdź do uzgodnienia →") { finance.part = .reconciliation }.buttonStyle(.link)
                }
                .padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(c.payments.enumerated()), id: \.element.id) { index, p in
                        HStack(spacing: 10) {
                            BankChip(text: p.periodLabel, color: CrmTheme.rgb(0xd3bb73))
                            Text(FinFormat.day(p.date)).font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 78, alignment: .leading)
                            Text(p.title ?? p.counterparty ?? "przelew").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(FinFormat.money(p.amount, c.currency)).monospacedDigit()
                            Text(p.method).font(.caption).foregroundStyle(.secondary)
                            Button { openPeriod(p) } label: { Image(systemName: "arrow.left.arrow.right") }.buttonStyle(.borderless)
                                .help("Otwórz uzgodnienie wyciągu \(String(format: "%02d", p.statementMonth))/\(p.statementYear)")
                            if canManage {
                                Button {
                                    Task { await store.contractAction("Odpinanie przelewu…", "undo", ["transactionId": .string(p.transactionId), "kind": .string("contract"), "id": .string(p.id)]) }
                                } label: { Image(systemName: "arrow.uturn.backward.circle") }
                                .buttonStyle(.borderless).foregroundStyle(CrmTheme.rgb(0xfca5a5)).help("Odepnij przelew od umowy")
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .help(p.reasons.joined(separator: "\n"))
                        if index < c.payments.count - 1 { Divider().padding(.leading, 14) }
                    }
                }
            }
        }
    }

    private func openPeriod(_ payment: FinContract.Payment) {
        store.period = BankPeriod(companyId: c.companyId, year: payment.statementYear, month: payment.statementMonth)
        store.statusFilter = "all"
        store.selectedTx = payment.transactionId
        finance.part = .reconciliation
    }

    private var files: some View {
        FinCard("Pliki umowy i aneksów", symbol: "doc", note: c.files.isEmpty ? "Brak pliku — zeskanuj umowę (kilka stron połączy się w jeden PDF) albo dodaj plik." : nil) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(c.files.enumerated()), id: \.element.id) { index, file in
                    HStack(spacing: 8) {
                        Image(systemName: "doc").foregroundStyle(.secondary)
                        Text(file.name).lineLimit(1).truncationMode(.middle)
                        if let size = file.size { Text(RecurringContractText.size(Int(size))).font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        Button("Otwórz") {
                            Task { if let data = await store.file(kind: "contract", id: file.id), let item = store.show(data) { preview(item) } }
                        }
                        .controlSize(.small)
                        if canManage {
                            Button { removeFile = file } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Usuń plik")
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    if index < c.files.count - 1 { Divider().padding(.leading, 14) }
                }
            }
        } accessory: {
            if canManage {
                HStack(spacing: 6) {
                    Button { scanning = true } label: { Label("Skanuj", systemImage: "doc.viewfinder") }
                        .help("Skanuj umowę — kolejne strony łączą się w jeden PDF")
                    Button {
                        guard let url = FinanceBankStore.pickFile("Plik umowy", types: RecurringContractText.fileTypes) else { return }
                        do {
                            let part = try ContractFormSheet.part(url)
                            Task { await store.addContractFile(c.id, part: part, pending: "Dodawanie pliku umowy…") }
                        } catch {
                            store.workspace?.error = error.localizedDescription
                        }
                    } label: { Label("Dodaj plik", systemImage: "square.and.arrow.up") }
                }
                .controlSize(.small)
            }
        }
    }
}

// MARK: Formularz umowy (nowa, edycja, „Nowa umowa z tej płatności”)

@MainActor struct ContractFormSheet: View {
    @ObservedObject var store: FinanceBankStore
    let companyID: String
    let contract: FinContract?
    /// Operacja z wyciągu („Nowa umowa z tej płatności”) — dane początkowe i kierunek.
    let transaction: BankContractCandidates.Transaction?
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "rent"
    @State private var direction = "cost"
    @State private var title = ""
    @State private var counterparty = ""
    @State private var nip = ""
    @State private var account = ""
    @State private var amount = ""
    @State private var currency = "PLN"
    @State private var cycle = "monthly"
    @State private var paymentDay = ""
    @State private var start = Date()
    @State private var hasEnd = false
    @State private var end = Date()
    @State private var paymentsFrom = ""
    @State private var status = "active"
    @State private var expectsInvoice = false
    @State private var notes = ""
    @State private var files: [ContractPendingFile] = []
    @State private var scanning = false
    @State private var formError: String?
    @State private var confirmClose = false
    @State private var prepared = false

    private var heading: String { contract.map { "Umowa „\($0.title)”" } ?? "Nowa umowa stała" }
    private var subtitle: String? {
        if let transaction { return "Z płatności \(FinFormat.day(transaction.date)) · \(transaction.direction == "credit" ? "przychód — otrzymujemy" : "koszt — płacimy")" }
        return contract == nil ? "Najem, leasing, abonament, raty — kwota na okres i rachunek kontrahenta" : nil
    }

    var body: some View {
        BankSheetFrame(heading, symbol: contract == nil ? "calendar.badge.plus" : "calendar.badge.clock", subtitle: subtitle, busy: store.busy) {
            Form {
                Section {
                    Picker("Rodzaj", selection: $kind) { ForEach(ContractStatus.kinds, id: \.0) { Text($0.1).tag($0.0) } }
                    if transaction == nil {
                        Picker("Kierunek", selection: $direction) {
                            Text("Koszt — płacimy").tag("cost")
                            Text("Przychód — otrzymujemy").tag("income")
                        }
                    }
                    TextField("Tytuł", text: $title, prompt: Text("np. Najem garażu nr 6, ul. Marcina Kasprzaka 11"))
                    TextField("Kontrahent (nazwa lub imię i nazwisko)", text: $counterparty)
                    TextField("NIP (opcjonalnie, firma)", text: $nip, prompt: Text("bez PESEL"))
                    TextField("Rachunek kontrahenta", text: $account).font(.body.monospaced())
                    Text(accountWarning ?? "Przelew na ten rachunek z kwotą okresu przypisze się do umowy automatycznie.")
                        .font(.caption).foregroundStyle(accountWarning == nil ? Color.secondary : CrmTheme.rgb(0xfcd34d))
                }
                Section {
                    TextField("Kwota brutto na okres", text: $amount, prompt: Text("np. 450,00"))
                    Picker("Waluta", selection: $currency) { ForEach(Array(Set(["PLN", "EUR", "USD", "GBP", "CHF", currency])).sorted(), id: \.self) { Text($0).tag($0) } }
                    Picker("Cykl", selection: $cycle) { ForEach(ContractStatus.cycles, id: \.0) { Text($0.1).tag($0.0) } }
                    TextField("Dzień płatności (opcjonalnie)", text: $paymentDay, prompt: Text("np. 10 — puste: do końca miesiąca"))
                    DatePicker("Data początku", selection: $start, displayedComponents: .date)
                    Toggle("Data końca", isOn: $hasEnd)
                    if hasEnd { DatePicker("Koniec", selection: $end, in: start..., displayedComponents: .date) }
                    TextField("Rozliczaj płatności od (RRRR-MM, opcjonalnie)", text: $paymentsFrom)
                    Text("Dla umów zawartych dawno: wcześniejsze okresy nie będą pokazywane jako brak płatności.").font(.caption).foregroundStyle(.secondary)
                    if contract != nil {
                        Picker("Status", selection: $status) {
                            Text("Aktywna").tag("active")
                            Text("Zakończona").tag("ended")
                        }
                    }
                    Toggle("Kontrahent wystawia faktury za okresy", isOn: $expectsInvoice)
                    Text("Wtedy przelew rozliczasz z fakturą (KSeF lub spoza KSeF), a umowa tylko informuje — automat nie przypisuje do niej płatności.").font(.caption).foregroundStyle(.secondary)
                    TextField("Notatki", text: $notes, prompt: Text("np. umowa na czas nieokreślony, 1 miesiąc wypowiedzenia"), axis: .vertical).lineLimit(2...4)
                }
                Section(contract == nil ? "Skan lub plik umowy (opcjonalnie)" : "Dodaj skan lub plik (dopisze się do plików umowy)") {
                    ForEach(files) { file in
                        HStack(spacing: 8) {
                            Image(systemName: "doc").foregroundStyle(.secondary)
                            Text(file.pages.map { "Skan umowy · \(DocumentScanner.pagesLabel($0))" } ?? file.part.name).lineLimit(1).truncationMode(.middle)
                            Text(RecurringContractText.size(file.part.data.count)).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button { open(file) } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd")
                            Button { files.removeAll { $0.id == file.id } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Usuń z listy")
                        }
                    }
                    HStack(spacing: 8) {
                        Button { scanning = true } label: { Label("Skanuj umowę", systemImage: "doc.viewfinder") }
                        Button { addFiles() } label: { Label("Dodaj plik", systemImage: "square.and.arrow.up") }
                    }
                    Text("Umowa ma kilka stron? W skanerze „Dodaj stronę” skanuje kolejną, a „Zakończ” łączy wszystkie w jeden PDF. Pliki zapiszą się razem z umową (do 20 MB każdy).")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Text("Zmiana kwoty (np. waloryzacja czynszu) dotyczy wszystkich okresów. Jeśli od danego miesiąca kwota jest inna, zakończ umowę datą i dodaj nową od kolejnego okresu — historia płatności zostanie bez zmian.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
        } footer: {
            if let formError { Label(formError, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5)).lineLimit(3) }
            Spacer()
            Button("Anuluj", role: .cancel) { close() }.keyboardShortcut(.cancelAction)
            Button(transaction == nil ? "Zapisz" : "Zapisz i przypisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        }
        .frame(minWidth: 620, idealWidth: 660, minHeight: 680, idealHeight: 780)
        .onAppear(perform: prepare)
        .sheet(isPresented: $scanning) {
            DocumentScannerSheet(title: "Skanuj umowę", intro: RecurringContractText.scanIntro, maxBytes: RecurringContractText.maxFile) { data, pages in
                files.append(ContractPendingFile(part: BankUploadPart(data: data, name: "skan-umowy.pdf", mime: "application/pdf"), pages: pages))
            }
        }
        .confirmationDialog("Zamknąć bez zapisywania?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Zamknij", role: .destructive) { dismiss() }
            Button("Wróć do formularza", role: .cancel) {}
        } message: { Text("Zeskanowane i dodane pliki nie zostaną zapisane.") }
    }

    private var accountWarning: String? {
        let digits = account.filter(\.isNumber)
        return !digits.isEmpty && digits.count != 26 && currency == "PLN" ? "Polski rachunek ma 26 cyfr — sprawdź numer." : nil
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        if let c = contract {
            kind = c.kind; direction = c.direction; title = c.title; counterparty = c.counterparty
            nip = c.nip ?? ""; account = BankFormat.account(c.account); amount = BankFormat.plain(c.amount); currency = c.currency
            cycle = c.cycle; paymentDay = c.paymentDay.map(String.init) ?? ""
            start = FinFormat.date(c.startDate) ?? Date()
            if let endDate = c.endDate, let date = FinFormat.date(endDate) { hasEnd = true; end = date }
            paymentsFrom = c.paymentsFrom.map { String($0.prefix(7)) } ?? ""
            status = c.status; expectsInvoice = c.expectsInvoice; notes = c.notes ?? ""
        } else if let transaction {
            direction = transaction.direction == "credit" ? "income" : "cost"
            title = String((transaction.title ?? "").prefix(200))
            counterparty = String((transaction.counterparty ?? "").prefix(200))
            account = BankFormat.account(transaction.counterpartyAccount)
            amount = BankFormat.plain(transaction.remaining)
            currency = transaction.currency
            start = FinFormat.date(transaction.date) ?? Date()
        }
    }

    /// Plik z dysku do wysłania (sprawdzenie rozmiaru jak w magazynie umów).
    static func part(_ url: URL) throws -> BankUploadPart {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        guard data.count <= RecurringContractText.maxFile else { throw ScanFailure(message: "Plik „\(url.lastPathComponent)” jest większy niż 20 MB.") }
        return BankUploadPart(data: data, name: url.lastPathComponent, mime: FinanceBankStore.mime(url))
    }

    private func addFiles() {
        let panel = NSOpenPanel()
        panel.title = "Pliki umowy"
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = RecurringContractText.fileTypes.compactMap { UTType(filenameExtension: $0) }
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            do { files.append(ContractPendingFile(part: try Self.part(url), pages: nil)) } catch { formError = error.localizedDescription }
        }
    }

    private func open(_ file: ContractPendingFile) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mavinci-podglad-\(file.id.uuidString)-\(file.part.name)")
        do {
            try file.part.data.write(to: url, options: .atomic)
            NSWorkspace.shared.open(url)
        } catch {
            formError = "Nie udało się otworzyć podglądu pliku."
        }
    }

    private func close() {
        if files.isEmpty { dismiss() } else { confirmClose = true }
    }

    private func save() async {
        formError = nil
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.count >= 2 else { formError = "Podaj tytuł umowy."; return }
        guard counterparty.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else { formError = "Podaj nazwę kontrahenta."; return }
        guard (BankFormat.parse(amount) ?? 0) > 0 else { formError = "Podaj kwotę brutto na okres."; return }
        var body: [String: JSONValue] = [
            "companyId": .string(companyID), "kind": .string(kind), "direction": .string(direction),
            "title": .string(trimmedTitle), "counterparty": .string(counterparty), "nip": .string(nip), "account": .string(account),
            "amount": .string(amount), "currency": .string(currency), "cycle": .string(cycle), "paymentDay": .string(paymentDay),
            "startDate": .string(FinanceText.dayString(start)), "endDate": hasEnd ? .string(FinanceText.dayString(end)) : .null,
            "paymentsFrom": .string(paymentsFrom.trimmingCharacters(in: .whitespaces)), "expectsInvoice": .bool(expectsInvoice), "notes": .string(notes),
        ]
        if let contract {
            body["id"] = .string(contract.id)
            body["status"] = .string(status)
        }
        // Skan dostaje nazwę z tytułu umowy dopiero przy zapisie (tytuł mógł się zmienić po skanowaniu).
        let pending = files.map { file in
            file.pages == nil ? file : ContractPendingFile(part: BankUploadPart(data: file.part.data, name: RecurringContractText.scanName(trimmedTitle), mime: file.part.mime), pages: file.pages)
        }
        let result = await store.saveContract(body, files: pending)
        guard let id = result.id else { formError = result.error; return }
        files = []
        dismiss()
        onSaved(id)
    }
}
