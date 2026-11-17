import SwiftUI

// MARK: ZUS i podatki — deklaracje (jak „Dokumenty i rozliczenia → ZUS i podatki” w CRM, `FinanceDeclarationsPanel`):
// rejestr zobowiązań za okres (DRA, PIT-4R, VAT-7, CIT-8) z kwotą z deklaracji, plikami (PDF/XML z Płatnika, PUE,
// e-Deklaracji), rozbiciem na pracowników i przelewami z wyciągów (przypisywanymi przy uzgadnianiu). Z lewej lista
// deklaracji roku, z prawej wybrana deklaracja. Zmiany: poziom „Zarządzanie finansami” działalności.

@MainActor struct FinanceDeclarationsView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @Environment(\.crmTheme) private var theme
    @State private var form: DeclarationFormTarget?
    @State private var preview: BankPreviewItem?

    private var currentYear: Int { Calendar.current.component(.year, from: Date()) }

    private var visible: [FinDeclaration] {
        (store.declarationList?.declarations ?? []).filter { store.declarationKind == "all" || $0.kind == store.declarationKind }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if let reply = store.declarationList {
                totals(visible)
                Divider()
                if visible.isEmpty {
                    ContentUnavailableView {
                        Label("Brak deklaracji w \(String(store.declarationsYear)) r.", systemImage: "building.columns")
                    } description: {
                        Text("Pojawią się same po uzgodnieniu wyciągu z przelewami do ZUS lub urzędu skarbowego — możesz też dodać je ręcznie.")
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    HStack(spacing: 0) {
                        List(selection: $store.openDeclaration) {
                            ForEach(visible) { d in row(d).tag(d.id) }
                        }
                        .listStyle(.inset)
                        .frame(minWidth: 320, idealWidth: 400, maxWidth: 480)
                        Divider()
                        Group {
                            if let id = store.openDeclaration, let d = visible.first(where: { $0.id == id }) {
                                DeclarationDetail(store: store, finance: finance, declaration: d, canManage: reply.canManage,
                                                  edit: { form = .edit(d) }, preview: { preview = $0 })
                                    .id(d.id)
                            } else {
                                ContentUnavailableView("Wybierz deklarację", systemImage: "doc.plaintext",
                                                       description: Text("Zobaczysz przelewy z wyciągów, pliki i rozbicie na pracowników."))
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            } else if let error = store.declarationsError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać deklaracji", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDeclarations(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie deklaracji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(store.company?.id ?? ""):\(store.declarationsYear)") { await store.loadDeclarations() }
        .sheet(item: $form) { target in
            if let company = store.company?.id {
                switch target {
                case .new:
                    DeclarationFormSheet(store: store, companyID: company, declaration: nil, initial: nil) { id in store.openDeclaration = id }
                case .edit(let d):
                    DeclarationFormSheet(store: store, companyID: company, declaration: d, initial: nil) { _ in }
                }
            }
        }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    private var header: some View {
        HStack(spacing: 10) {
            BankCompanyPicker(store: store)
            Picker("", selection: Binding(get: { store.declarationsYear }, set: { store.declarationsYear = $0; store.openDeclaration = nil })) {
                ForEach((0..<5).map { currentYear + 1 - $0 }, id: \.self) { Text(String($0)).tag($0) }
            }
            .labelsHidden().fixedSize()
            Picker("", selection: $store.declarationKind) {
                Text("Wszystkie rodzaje").tag("all")
                ForEach(DeclarationKinds.all, id: \.0) { Text($0.1).tag($0.0) }
            }
            .labelsHidden().fixedSize()
            Spacer()
            Button { Task { await store.loadDeclarations(force: true) } } label: {
                if store.declarationsLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.declarationsLoading).fixedSize()
            if store.declarationList?.canManage == true {
                Button { form = .new } label: { Label("Dodaj deklarację", systemImage: "plus") }.buttonStyle(.borderedProminent).fixedSize()
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func totals(_ items: [FinDeclaration]) -> some View {
        let due = items.reduce(0) { $0 + ($1.amountDue ?? 0) }
        let paid = items.reduce(0) { $0 + $1.paid }
        let attention = items.filter { DeclarationStatus.attention.contains($0.status) }.count
        return HStack(spacing: 10) {
            FinTile(symbol: "doc.plaintext", label: "Do zapłaty wg deklaracji", value: FinFormat.money(due))
            FinTile(symbol: "building.columns", label: "Zapłacono z wyciągów", value: FinFormat.money(paid))
            FinTile(symbol: attention > 0 ? "exclamationmark.triangle" : "checkmark.circle", label: "Do sprawdzenia",
                    value: attention > 0 ? "\(attention)" : "Wszystko zgodne",
                    hint: attention > 0 ? "brak kwoty, niedopłata, nadpłata, brak przelewu" : nil, warn: attention > 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func row(_ d: FinDeclaration) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(d.label).font(.callout.weight(.semibold)).lineLimit(1)
                if d.createdFrom == "payment" { BankChip(text: "z przelewu", color: CrmTheme.rgb(0xfcd34d)) }
                if !d.files.isEmpty { Label("\(d.files.count)", systemImage: "doc").font(.caption2).foregroundStyle(.secondary) }
                Spacer(minLength: 4)
                Text(d.amountDue.map { FinFormat.money($0) } ?? "kwota —").font(.callout).monospacedDigit()
            }
            HStack(spacing: 6) {
                Circle().fill(DeclarationStatus.color(d.status)).frame(width: 6, height: 6)
                Text(DeclarationStatus.label(d.status)).foregroundStyle(DeclarationStatus.color(d.status))
                Text("· \(DeclarationKinds.label(d.kind))").foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 4)
                Text("zapłacono \(FinFormat.money(d.paid))").foregroundStyle(.secondary)
            }
            .font(.caption2)
        }
        .padding(.vertical, 3)
    }
}

enum DeclarationFormTarget: Identifiable {
    case new
    case edit(FinDeclaration)
    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let d): return d.id
        }
    }
}

// MARK: Deklaracja: przelewy, pliki, rozbicie na pracowników

@MainActor private struct DeclarationDetail: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    let declaration: FinDeclaration
    let canManage: Bool
    let edit: () -> Void
    let preview: (BankPreviewItem) -> Void
    @State private var line: DeclarationLineTarget?
    @State private var confirmDelete = false
    @State private var removeFile: FinDeclaration.File?

    private var d: FinDeclaration { declaration }
    private var showZus: Bool { d.kind == "zus" }
    private var showPit: Bool { d.kind == "pit" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(d.label).font(.title3.weight(.semibold))
                        BankChip(text: DeclarationStatus.label(d.status), color: DeclarationStatus.color(d.status))
                        Spacer()
                        if canManage {
                            Button { edit() } label: { Label("Kwota i dane", systemImage: "pencil") }
                            Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń", systemImage: "trash") }
                                .disabled(!d.payments.isEmpty).help(d.payments.isEmpty ? "Usuń deklarację z rejestru" : "Najpierw odepnij przelewy")
                        }
                    }
                    .controlSize(.small)
                    Text(DeclarationStatus.sentence(status: d.status, amountDue: d.amountDue, paid: d.paid)).font(.callout)
                    Text(["Okres: \(FinFormat.day(d.periodStart)) – \(FinFormat.day(d.periodEnd))", d.dueDate.map { "termin płatności \(FinFormat.day($0))" }, d.notes]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                payments
                files
                if showZus || showPit || !d.lines.isEmpty { lines }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $line) { target in DeclarationLineSheet(store: store, declaration: d, target: target, showZus: showZus, showPit: showPit) }
        .confirmationDialog("Usunąć \(d.label) z rejestru?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                Task {
                    if await store.declarationAction("Usuwanie deklaracji…", "declarationDelete", ["id": .string(d.id)]) != nil { store.openDeclaration = nil }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Pliki deklaracji też zostaną usunięte.") }
        .confirmationDialog("Usunąć plik z deklaracji?", isPresented: Binding(get: { removeFile != nil }, set: { if !$0 { removeFile = nil } }), titleVisibility: .visible) {
            Button("Usuń plik", role: .destructive) {
                if let file = removeFile {
                    Task { await store.declarationAction("Usuwanie pliku…", "declarationFileRemove", ["declarationId": .string(d.id), "id": .string(file.id)]) }
                }
                removeFile = nil
            }
            Button("Anuluj", role: .cancel) { removeFile = nil }
        } message: { Text(removeFile?.name ?? "") }
    }

    private var payments: some View {
        FinCard("Przelewy z wyciągów", symbol: "building.columns") {
            if d.payments.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Brak przypisanych przelewów. Przelew z okresem w tytule przypisze się podczas uzgadniania wyciągu; inny możesz przypisać ręcznie w „Uzgodnieniu wyciągów” (Przypisz do deklaracji).")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Przejdź do uzgodnienia →") { finance.part = .reconciliation }.buttonStyle(.link)
                }
                .padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(d.payments.enumerated()), id: \.element.id) { index, p in
                        HStack(spacing: 10) {
                            Text(FinFormat.day(p.date)).font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 78, alignment: .leading)
                            Text(p.title ?? "przelew").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(FinFormat.money(p.amount)).monospacedDigit()
                            Text(p.method).font(.caption).foregroundStyle(.secondary)
                            Button { openPeriod(p) } label: { Image(systemName: "arrow.left.arrow.right") }.buttonStyle(.borderless)
                                .help("Otwórz uzgodnienie wyciągu \(String(format: "%02d", p.statementMonth))/\(p.statementYear)")
                            if canManage {
                                Button {
                                    Task { await store.declarationAction("Odpinanie przelewu…", "undo", ["transactionId": .string(p.transactionId), "kind": .string("declaration"), "id": .string(p.id)]) }
                                } label: { Image(systemName: "arrow.uturn.backward.circle") }
                                .buttonStyle(.borderless).foregroundStyle(CrmTheme.rgb(0xfca5a5)).help("Odepnij przelew")
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .help(p.reasons.joined(separator: "\n"))
                        if index < d.payments.count - 1 { Divider().padding(.leading, 14) }
                    }
                }
            }
        }
    }

    private func openPeriod(_ payment: FinDeclaration.Payment) {
        store.period = BankPeriod(companyId: d.companyId, year: payment.statementYear, month: payment.statementMonth)
        store.statusFilter = "all"
        store.selectedTx = payment.transactionId
        finance.part = .reconciliation
    }

    private var files: some View {
        FinCard("Pliki deklaracji", symbol: "doc", note: d.files.isEmpty ? "Brak pliku — dodaj PDF lub XML deklaracji (np. DRA z raportami RCA)." : nil) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(d.files.enumerated()), id: \.element.id) { index, file in
                    HStack(spacing: 8) {
                        Image(systemName: "doc").foregroundStyle(.secondary)
                        Text(file.name).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("Otwórz") {
                            Task { if let data = await store.file(kind: "declaration", id: file.id), let item = store.show(data) { preview(item) } }
                        }
                        .controlSize(.small)
                        if canManage {
                            Button { removeFile = file } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).help("Usuń plik")
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    if index < d.files.count - 1 { Divider().padding(.leading, 14) }
                }
            }
        } accessory: {
            if canManage {
                Button {
                    if let url = FinanceBankStore.pickFile("Plik deklaracji", types: ["pdf", "xml", "kdu", "zip", "png", "jpg", "jpeg", "webp"]) {
                        Task { await store.addDeclarationFile(d, file: url) }
                    }
                } label: { Label("Dodaj plik", systemImage: "square.and.arrow.up") }
                .controlSize(.small)
            }
        }
    }

    private var lines: some View {
        let diff = d.amountDue.map { ((d.linesTotal - $0) * 100).rounded() / 100 }
        return FinCard(showZus ? "Rozbicie na pracowników (z raportów RCA)" : "Rozbicie na pracowników (zaliczki PIT)", symbol: "person.2") {
            VStack(alignment: .leading, spacing: 0) {
                if d.lines.isEmpty {
                    Text("Brak rozbicia. Użyj „Dodaj osoby z umów” i wpisz kwoty z raportów RCA (lub z listy płac).")
                        .font(.callout).foregroundStyle(.secondary).padding(14)
                } else {
                    HStack {
                        Text("Osoba / umowa").frame(maxWidth: .infinity, alignment: .leading)
                        if showZus {
                            Text("Społ. ubezp.").frame(width: 90, alignment: .trailing)
                            Text("Społ. płatnik").frame(width: 90, alignment: .trailing)
                            Text("Zdrowotna").frame(width: 90, alignment: .trailing)
                            Text("FP / FS / FGŚP").frame(width: 90, alignment: .trailing)
                        }
                        if showPit { Text("Zaliczka PIT").frame(width: 90, alignment: .trailing) }
                        Text("Razem").frame(width: 100, alignment: .trailing)
                        Color.clear.frame(width: canManage ? 46 : 0)
                    }
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.vertical, 6)
                    Divider()
                    ForEach(d.lines) { l in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(l.personName).lineLimit(1)
                                if let number = l.contractNumber { Text(number).font(.caption2).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if showZus {
                                amount(l.socialInsured); amount(l.socialPayer); amount(l.health); amount(l.funds)
                            }
                            if showPit { amount(l.pit) }
                            Text(FinFormat.money(l.amount)).monospacedDigit().frame(width: 100, alignment: .trailing)
                            if canManage {
                                HStack(spacing: 4) {
                                    Button { line = .edit(l) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                                    Button {
                                        Task { await store.declarationAction("Usuwanie pozycji…", "lineDelete", ["declarationId": .string(d.id), "id": .string(l.id)]) }
                                    } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
                                }
                                .frame(width: 46)
                            }
                        }
                        .font(.callout).padding(.horizontal, 14).padding(.vertical, 5)
                        Divider().padding(.leading, 14)
                    }
                    HStack {
                        Text("Suma pozycji").foregroundStyle(.secondary)
                        Spacer()
                        Text(FinFormat.money(d.linesTotal)).monospacedDigit().fontWeight(.semibold)
                        Text(diff == nil ? "brak kwoty deklaracji" : abs(diff ?? 0) <= 0.01 ? "zgodne z deklaracją" : "różnica \(FinFormat.money(diff ?? 0))")
                            .font(.caption)
                            .foregroundStyle(diff == nil ? Color.secondary : abs(diff ?? 0) <= 0.01 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xfcd34d))
                            .frame(width: 170, alignment: .trailing)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                }
            }
        } accessory: {
            if canManage {
                HStack(spacing: 6) {
                    Button { Task { await store.declarationAction("Dodawanie osób z umów…", "linesPrefill", ["declarationId": .string(d.id)]) } } label: {
                        Label("Dodaj osoby z umów", systemImage: "person.2.badge.plus")
                    }
                    Button { line = .new } label: { Label("Pozycja", systemImage: "plus") }
                }
                .controlSize(.small)
            }
        }
    }

    private func amount(_ value: Double) -> some View {
        Text(FinFormat.money(value)).monospacedDigit().foregroundStyle(.secondary).frame(width: 90, alignment: .trailing)
    }
}

enum DeclarationLineTarget: Identifiable {
    case new
    case edit(FinDeclaration.Line)
    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let line): return line.id
        }
    }
}

// MARK: Pozycja rozbicia (osoba i składki / zaliczka)

@MainActor private struct DeclarationLineSheet: View {
    @ObservedObject var store: FinanceBankStore
    let declaration: FinDeclaration
    let target: DeclarationLineTarget
    let showZus: Bool
    let showPit: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var person = ""
    @State private var socialInsured = ""
    @State private var socialPayer = ""
    @State private var health = ""
    @State private var funds = ""
    @State private var pit = ""
    @State private var prepared = false

    private var existing: FinDeclaration.Line? { if case .edit(let line) = target { return line }; return nil }
    private var total: Double {
        var sum = 0.0
        if showZus { sum += [socialInsured, socialPayer, health, funds].compactMap { BankFormat.parse($0) }.reduce(0, +) }
        if showPit { sum += BankFormat.parse(pit) ?? 0 }
        return sum
    }

    var body: some View {
        BankSheetFrame(existing == nil ? "Nowa pozycja" : "Pozycja: \(existing?.personName ?? "")", symbol: "person.crop.circle", subtitle: declaration.label) {
            Form {
                TextField("Imię i nazwisko", text: $person)
                if showZus {
                    TextField("Społ. ubezpieczony", text: $socialInsured, prompt: Text("0,00"))
                    TextField("Społ. płatnik", text: $socialPayer, prompt: Text("0,00"))
                    TextField("Zdrowotna", text: $health, prompt: Text("0,00"))
                    TextField("FP / FS / FGŚP", text: $funds, prompt: Text("0,00"))
                }
                if showPit { TextField("Zaliczka PIT", text: $pit, prompt: Text("0,00")) }
                LabeledContent("Razem", value: FinFormat.money(total))
            }
            .formStyle(.grouped)
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(person.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .frame(minWidth: 460, idealWidth: 500, minHeight: 360, idealHeight: 420)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            guard let line = existing else { return }
            person = line.personName
            socialInsured = BankFormat.plain(line.socialInsured)
            socialPayer = BankFormat.plain(line.socialPayer)
            health = BankFormat.plain(line.health)
            funds = BankFormat.plain(line.funds)
            pit = BankFormat.plain(line.pit)
        }
    }

    private func save() async {
        var body: [String: JSONValue] = [
            "declarationId": .string(declaration.id), "personName": .string(person.trimmingCharacters(in: .whitespaces)),
            "socialInsured": .string(socialInsured), "socialPayer": .string(socialPayer), "health": .string(health),
            "funds": .string(funds), "pit": .string(pit),
        ]
        if let line = existing {
            body["id"] = .string(line.id)
            if let contract = line.contractId { body["contractId"] = .string(contract) }
            if let notes = line.notes { body["notes"] = .string(notes) }
        }
        if await store.declarationAction("Zapisywanie pozycji…", "lineSave", body) != nil { dismiss() }
    }
}

// MARK: Deklaracja — nowa albo kwota i dane (`DeclarationFormModal`)

@MainActor struct DeclarationFormSheet: View {
    struct Initial { var kind: String; var form: String; var periodKind: String; var periodStart: String; var dueDate: String? = nil }

    @ObservedObject var store: FinanceBankStore
    let companyID: String
    let declaration: FinDeclaration?
    let initial: Initial?
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "zus"
    @State private var formSymbol = "DRA"
    @State private var periodKind = "month"
    @State private var monthDate = Date()
    @State private var quarter = 1
    @State private var year = Calendar.current.component(.year, from: Date())
    @State private var amount = ""
    @State private var hasDue = false
    @State private var due = Date()
    @State private var notes = ""
    @State private var prepared = false

    var body: some View {
        BankSheetFrame(declaration.map { "Deklaracja \($0.label)" } ?? "Nowa deklaracja", symbol: "doc.plaintext") {
            Form {
                HStack {
                    TextField("Symbol", text: Binding(get: { formSymbol }, set: { pick($0) }))
                    Menu("Typowe") {
                        ForEach(DeclarationKinds.forms, id: \.form) { item in
                            Button("\(item.form) — \(item.hint)") { pick(item.form) }
                        }
                    }
                    .fixedSize()
                }
                Picker("Rodzaj", selection: $kind) { ForEach(DeclarationKinds.all, id: \.0) { Text($0.1).tag($0.0) } }
                Picker("Okres", selection: $periodKind) {
                    Text("Miesiąc").tag("month")
                    Text("Kwartał").tag("quarter")
                    Text("Rok").tag("year")
                }
                .pickerStyle(.segmented)
                switch periodKind {
                case "quarter":
                    HStack {
                        Picker("Kwartał", selection: $quarter) { ForEach(1...4, id: \.self) { Text("Q\($0)").tag($0) } }
                        Stepper(value: $year, in: 2000...2100) { Text(String(year)) }
                    }
                case "year":
                    Stepper(value: $year, in: 2000...2100) { Text("Rok: \(String(year))") }
                default:
                    DatePicker("Miesiąc", selection: $monthDate, displayedComponents: .date)
                }
                TextField("Kwota do zapłaty z deklaracji (zł)", text: $amount, prompt: Text("np. 2829,86"))
                Toggle("Termin płatności", isOn: $hasDue)
                if hasDue { DatePicker("Termin", selection: $due, displayedComponents: .date) }
                TextField("Notatka", text: $notes, prompt: Text("np. korekta 02, złożona przez PUE"))
                Text("Kwotę przepisz z deklaracji (DRA: „kwota do zapłaty”; PIT-4R / VAT-7 / CIT-8: podatek do wpłaty). Na tej podstawie system pokaże niedopłatę albo nadpłatę względem przelewów z wyciągów.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
        } footer: {
            Spacer()
            Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Zapisz") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(formSymbol.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 560, idealHeight: 620)
        .onAppear(perform: prepare)
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        let calendar = Calendar.current
        // Domyślnie poprzedni miesiąc (jak w CRM).
        let lastMonth = calendar.date(byAdding: .month, value: -1, to: Date()) ?? Date()
        var start = FinanceText.dayString(lastMonth)
        if let declaration {
            kind = declaration.kind
            formSymbol = declaration.form
            periodKind = declaration.periodKind
            start = declaration.periodStart
            amount = declaration.amountDue.map { BankFormat.plain($0) } ?? ""
            if let date = declaration.dueDate.flatMap({ FinFormat.date($0) }) { hasDue = true; due = date }
            notes = declaration.notes ?? ""
        } else if let initial {
            kind = initial.kind
            formSymbol = initial.form
            periodKind = initial.periodKind
            if !initial.periodStart.isEmpty { start = initial.periodStart }
            if let date = initial.dueDate.flatMap({ FinFormat.date($0) }) { hasDue = true; due = date }
        }
        let parts = start.prefix(10).split(separator: "-").compactMap { Int($0) }
        if parts.count >= 2 {
            year = parts[0]
            quarter = (parts[1] - 1) / 3 + 1
            monthDate = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) ?? lastMonth
        }
    }

    /// Symbol z listy typowych ustawia rodzaj i okres (jak `pickForm`).
    private func pick(_ value: String) {
        formSymbol = value
        if let preset = DeclarationKinds.forms.first(where: { $0.form == value.uppercased().trimmingCharacters(in: .whitespaces) }) {
            kind = preset.kind
            periodKind = preset.period
        }
    }

    private var periodStart: String {
        switch periodKind {
        case "year": return String(format: "%04d-01-01", year)
        case "quarter": return String(format: "%04d-%02d-01", year, (quarter - 1) * 3 + 1)
        default:
            let parts = Calendar.current.dateComponents([.year, .month], from: monthDate)
            return String(format: "%04d-%02d-01", parts.year ?? year, parts.month ?? 1)
        }
    }

    private func save() async {
        var body: [String: JSONValue] = [
            "companyId": .string(companyID), "kind": .string(kind), "form": .string(formSymbol.trimmingCharacters(in: .whitespaces)),
            "periodKind": .string(periodKind), "periodStart": .string(periodStart), "amountDue": .string(amount.trimmingCharacters(in: .whitespaces)),
            "dueDate": hasDue ? .string(FinanceText.dayString(due)) : .null, "notes": .string(notes),
        ]
        if let declaration { body["id"] = .string(declaration.id) }
        guard let reply = await store.declarationAction("Zapisywanie deklaracji…", "declarationSave", body), let id = reply["id"]?.text.nonEmpty else { return }
        dismiss()
        onSaved(id)
    }
}
