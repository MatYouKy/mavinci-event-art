import SwiftUI

// MARK: Koszty i wypłaty (jak zakładka CRM „Koszty i wypłaty”, `FinancialEntriesTab`) — ręczne zapisy wynagrodzeń, gotówki
// i kosztów, których nie ma w KSeF ani na fakturach (`financial_entries`). Tabela z sortowaniem, filtr rodzaju i statusu,
// wyszukiwanie, kafle sum; „Dodaj koszt lub wypłatę” i usuwanie — poziom „Zarządzanie finansami” działalności zapisu.

struct FinEntriesReply: Decodable {
    struct Company: Decodable, Identifiable { var id: String; var name: String; var canManage: Bool }
    struct Category: Decodable, Identifiable { var id: String; var code: String; var name: String; var color: String? }
    struct Employee: Decodable, Identifiable { var id: String; var name: String }
    struct Entry: Decodable, Identifiable {
        var id: String
        var title: String
        var amount: Double
        var recognitionDate: String
        var paymentDate: String?
        var status: String
        var paymentMethod: String
        var entryType: String
        var companyId: String?
        var companyName: String?
        var employeeName: String?
        var categoryName: String?
        var categoryColor: String?
        var notes: String?
        var canManage: Bool
    }
    var companies: [Company]
    var categories: [Category]
    var employees: [Employee]
    var entries: [Entry]
}

enum FinEntryText {
    static let types: [(String, String)] = [
        ("payroll", "Wynagrodzenie / wypłata"), ("contractor", "Podwykonawca"), ("purchase", "Zakup"),
        ("reimbursement", "Zwrot kosztów"), ("cash", "Inny koszt gotówkowy"), ("other", "Inny koszt"),
    ]
    static let methods: [(String, String)] = [
        ("transfer", "Przelew"), ("cash", "Gotówka do ręki"), ("card", "Karta"), ("blik", "BLIK"), ("compensation", "Kompensata"), ("other", "Inna"),
    ]
    static let statuses: [(String, String)] = [
        ("paid", "Zapłacono"), ("incurred", "Koszt poniesiony — do zapłaty"), ("planned", "Planowany (nie liczy się do wyniku)"),
    ]
    static func type(_ value: String) -> String { types.first { $0.0 == value }?.1 ?? value }
    static func method(_ value: String) -> String {
        switch value {
        case "cash": return "Gotówka"
        case "transfer": return "Przelew"
        default: return methods.first { $0.0 == value }?.1 ?? value
        }
    }
    static func status(_ value: String) -> String {
        switch value {
        case "paid": return "Zapłacono"
        case "planned": return "Planowany"
        default: return "Poniesiony, niezapłacony"
        }
    }
}

@MainActor struct FinanceEntriesView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var type = "all"
    @State private var status = "all"
    @State private var selection: String?
    @State private var sortOrder = [KeyPathComparator(\FinEntriesReply.Entry.recognitionDate, order: .reverse)]
    @State private var adding = false
    @State private var removing: FinEntriesReply.Entry?

    private var scopeIDs: Set<String> { Set(finance.scopeCompanies.map(\.id)) }

    private func visible(_ reply: FinEntriesReply) -> [FinEntriesReply.Entry] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return reply.entries.filter { entry in
            if let company = entry.companyId, !scopeIDs.contains(company) { return false }
            if type != "all" && entry.entryType != type { return false }
            if status != "all" && entry.status != status { return false }
            guard !needle.isEmpty else { return true }
            return [entry.title, entry.employeeName ?? "", entry.categoryName ?? "", entry.companyName ?? "", entry.notes ?? "", BankFormat.plain(entry.amount)]
                .joined(separator: " ").lowercased().contains(needle)
        }
        .sorted(using: sortOrder)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if let reply = store.entries {
                let rows = visible(reply)
                totals(rows)
                Divider()
                table(rows)
            } else if let error = store.entriesError {
                ContentUnavailableView {
                    Label("Nie udało się pobrać kosztów i wypłat", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadEntries(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie kosztów i wypłat…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await store.loadEntries() }
        .sheet(isPresented: $adding) {
            if let reply = store.entries {
                FinanceEntrySheet(store: store, reply: reply, companies: reply.companies.filter { $0.canManage && scopeIDs.contains($0.id) })
            }
        }
        .confirmationDialog("Usuń zapis finansowy", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let entry = removing { Task { await store.entryAction("Usuwanie zapisu…", "entryDelete", ["id": .string(entry.id)]) } }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Czy usunąć „\(removing?.title ?? "")”?") }
    }

    private var canAdd: Bool { store.entries?.companies.contains { $0.canManage && scopeIDs.contains($0.id) } ?? false }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Koszty i wypłaty").font(.headline)
                Text("Wynagrodzenia, gotówka i koszty, których nie ma w KSeF ani na fakturach.").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Picker("", selection: $type) {
                Text("Wszystkie rodzaje").tag("all")
                ForEach(FinEntryText.types, id: \.0) { Text($0.1).tag($0.0) }
            }
            .labelsHidden().fixedSize()
            Picker("", selection: $status) {
                Text("Każdy status").tag("all")
                Text("Zapłacono").tag("paid")
                Text("Do zapłaty").tag("incurred")
                Text("Planowane").tag("planned")
            }
            .labelsHidden().fixedSize()
            TextField("Szukaj", text: $search).textFieldStyle(.roundedBorder).frame(width: 180)
            Button { Task { await store.loadEntries(force: true) } } label: {
                if store.entriesLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.entriesLoading).fixedSize()
            if canAdd {
                Button { adding = true } label: { Label("Dodaj koszt lub wypłatę", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).fixedSize()
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func totals(_ rows: [FinEntriesReply.Entry]) -> some View {
        let sum = { (status: String) in rows.filter { $0.status == status }.reduce(0) { $0 + $1.amount } }
        return HStack(spacing: 10) {
            FinTile(symbol: "checkmark.circle", label: "Zapłacono", value: FinFormat.money(sum("paid")))
            FinTile(symbol: "clock", label: "Poniesione, do zapłaty", value: FinFormat.money(sum("incurred")), warn: sum("incurred") > 0)
            FinTile(symbol: "calendar", label: "Planowane (poza wynikiem)", value: FinFormat.money(sum("planned")))
            FinTile(symbol: "list.bullet", label: "Zapisów", value: "\(rows.count)", hint: "200 najnowszych według daty kosztu")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func table(_ rows: [FinEntriesReply.Entry]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sortOrder) {
            TableColumn("Data", value: \.recognitionDate) { entry in
                Text(FinFormat.day(entry.recognitionDate)).monospacedDigit()
            }
            .width(min: 84, ideal: 92, max: 110)
            TableColumn("Opis", value: \.title) { entry in
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.title).fontWeight(.medium).lineLimit(1)
                    if let employee = entry.employeeName { Label(employee, systemImage: "person").font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    else { Text(FinEntryText.type(entry.entryType)).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                .help(entry.notes ?? "")
            }
            .width(min: 200, ideal: 300)
            TableColumn("Kategoria") { entry in
                let color = CrmTheme.hex(entry.categoryColor) ?? CrmTheme.rgb(0x9ca3af)
                BankChip(text: entry.categoryName ?? "Bez kategorii", color: color)
            }
            .width(min: 110, ideal: 150)
            TableColumn("Działalność") { entry in
                Text(entry.companyName ?? "Nieprzypisana").foregroundStyle(entry.companyName == nil ? Color.secondary : Color.primary).lineLimit(1)
            }
            .width(min: 100, ideal: 150)
            TableColumn("Rozliczenie", value: \.status) { entry in
                VStack(alignment: .leading, spacing: 1) {
                    Text(FinEntryText.method(entry.paymentMethod)).lineLimit(1)
                    Text(FinEntryText.status(entry.status) + (entry.paymentDate.map { " · \(FinFormat.day($0))" } ?? ""))
                        .font(.caption).foregroundStyle(entry.status == "incurred" ? CrmTheme.rgb(0xfcd34d) : Color.secondary).lineLimit(1)
                }
            }
            .width(min: 140, ideal: 180)
            TableColumn("Kwota", value: \.amount) { entry in
                Text(FinFormat.money(entry.amount)).monospacedDigit().foregroundStyle(CrmTheme.rgb(0xfca5a5))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 120, max: 150)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let entry = rows.first(where: { $0.id == id }), entry.canManage {
                Button("Usuń…", role: .destructive) { removing = entry }
            }
        }
        .onDeleteCommand {
            if let id = selection, let entry = rows.first(where: { $0.id == id }), entry.canManage { removing = entry }
        }
        .overlay {
            if rows.isEmpty {
                Text(store.entries?.entries.isEmpty == true ? "Nie ma jeszcze ręcznie zapisanych kosztów ani wypłat." : "Brak zapisów dla wybranych filtrów.")
                    .foregroundStyle(.secondary).allowsHitTesting(false)
            }
        }
    }
}

// MARK: Nowy koszt lub wypłata

@MainActor private struct FinanceEntrySheet: View {
    @ObservedObject var store: FinanceBankStore
    let reply: FinEntriesReply
    let companies: [FinEntriesReply.Company]
    @Environment(\.dismiss) private var dismiss
    @State private var entryType = "payroll"
    @State private var companyID = ""
    @State private var employeeID = ""
    @State private var categoryID = ""
    @State private var title = ""
    @State private var amount = ""
    @State private var method = "transfer"
    @State private var recognition = Date()
    @State private var status = "paid"
    @State private var payment = Date()
    @State private var notes = ""
    @State private var prepared = false

    var body: some View {
        BankSheetFrame("Nowy koszt lub wypłata", symbol: "creditcard", subtitle: "Gotówka również trafia do faktycznych wydatków.") {
            Form {
                Picker("Rodzaj", selection: Binding(get: { entryType }, set: { next in
                    entryType = next
                    if next == "payroll", let personnel = reply.categories.first(where: { $0.code == "personnel" }) { categoryID = personnel.id }
                    if next != "payroll" { employeeID = "" }
                })) {
                    ForEach(FinEntryText.types, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Działalność", selection: $companyID) {
                    if companies.count != 1 { Text("Wybierz").tag("") }
                    ForEach(companies) { Text($0.name).tag($0.id) }
                }
                if entryType == "payroll" {
                    Picker("Pracownik", selection: $employeeID) {
                        Text("Wybierz").tag("")
                        ForEach(reply.employees) { Text($0.name).tag($0.id) }
                    }
                }
                Picker("Kategoria", selection: $categoryID) {
                    ForEach(reply.categories) { Text($0.name).tag($0.id) }
                }
                TextField("Opis", text: $title, prompt: Text(entryType == "payroll" ? "np. Wynagrodzenie za sierpień" : "Czego dotyczy koszt?"))
                TextField("Kwota brutto", text: $amount, prompt: Text("0,00"))
                Picker("Forma płatności", selection: $method) { ForEach(FinEntryText.methods, id: \.0) { Text($0.1).tag($0.0) } }
                DatePicker("Data kosztu", selection: $recognition, displayedComponents: .date)
                Picker("Status", selection: $status) { ForEach(FinEntryText.statuses, id: \.0) { Text($0.1).tag($0.0) } }
                if status == "paid" { DatePicker("Data zapłaty", selection: $payment, displayedComponents: .date) }
                TextField("Uwagi", text: $notes, axis: .vertical).lineLimit(2...5)
            }
            .formStyle(.grouped)
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 620, idealHeight: 680)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            if companies.count == 1 { companyID = companies[0].id }
            let preferred = reply.categories.first { $0.code == (entryType == "payroll" ? "personnel" : "other") }
            categoryID = preferred?.id ?? reply.categories.first?.id ?? ""
        }
    }

    private func save() async {
        let value = BankFormat.parse(amount) ?? 0
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !companyID.isEmpty, !categoryID.isEmpty, value > 0 else {
            store.workspace?.error = "Uzupełnij działalność, kategorię, opis i poprawną kwotę."
            return
        }
        if entryType == "payroll" && employeeID.isEmpty { store.workspace?.error = "Dla wypłaty wybierz pracownika."; return }
        let body: [String: JSONValue] = [
            "entryType": .string(entryType), "companyId": .string(companyID), "categoryId": .string(categoryID),
            "employeeId": .string(employeeID), "title": .string(title.trimmingCharacters(in: .whitespaces)), "amount": .string(amount),
            "paymentMethod": .string(method), "recognitionDate": .string(FinanceText.dayString(recognition)), "status": .string(status),
            "paymentDate": .string(FinanceText.dayString(payment)), "notes": .string(notes),
        ]
        if await store.entryAction("Zapisywanie kosztu…", "entrySave", body) { dismiss() }
    }
}
