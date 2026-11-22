import SwiftUI

// MARK: Umowa wydarzenia — pola i warunki, depozyt i wystawienie na Macu. Dane i zapis liczy silnik dokumentów tym samym
// kodem co zakładka „Umowa” w CRM (`eventContractData.ts`: `usedContractVariableKeys`, `contractConditionSettings`,
// `contractPreflightIssues`, „Zapisz”, „Zapisz depozyt”, `handleStatusChange`). Pola z formatowaniem (bloki stron, tabele)
// edytuje się w oknie z formatowaniem (`ContractHTMLEditor.swift`, jak `ContractVariableHtmlField` w CRM).

struct EventContractEditData: Decodable {
    struct Field: Decodable, Identifiable, Hashable {
        var key: String
        var label: String
        var value: String
        var html: Bool
        var long: Bool
        var id: String { key }
    }
    struct Option: Decodable, Identifiable, Hashable {
        var key: String
        var label: String
        var enabled: Bool
        var id: String { key }
    }
    struct Signer: Decodable, Identifiable, Hashable {
        var id: String
        var fullName: String
        var title: String
    }
    struct Party: Decodable {
        var html: String
        var signers: [Signer]
        var selected: [String]
    }
    struct Deposit: Decodable {
        var label: String
        var percent: String
        var amount: String
        var total: Double?
    }
    var canEdit: Bool
    var fields: [Field]
    /// Rodzaj klienta w warunkach szablonu: `firma` / `osoba`; `nil` — szablon nie ma tego warunku.
    var client: String?
    var clientKey: String
    var options: [Option]
    var party: Party?
    var deposit: Deposit?
    /// Style dokumentu umowy dla edytora pól z formatowaniem (starszy serwer CRM nie podaje).
    var cssText: String?
}

/// Uwaga przed wystawieniem (`ContractPreflightIssue`): `blocker` wymaga uzupełnienia albo świadomego potwierdzenia.
struct EventContractPreflightIssue: Decodable, Identifiable, Hashable {
    var key: String
    var label: String
    var severity: String
    var actionHref: String?
    var actionLabel: String?
    var id: String { key }
}

/// Czytelny tekst z HTML pola (podgląd bloków bez formatowania).
private func contractPlainText(_ html: String) -> String {
    var text = html.replacingOccurrences(of: #"<br\s*/?>|</p>|</li>|</div>"#, with: "\n", options: .regularExpression)
    text = text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
    for (entity, value) in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'")] {
        text = text.replacingOccurrences(of: entity, with: value)
    }
    return text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Liczba z pola depozytu jak `readContractDepositNumber` („30%”, „1 230,50 zł”).
private func depositNumber(_ value: String) -> Double {
    let cleaned = value.replacingOccurrences(of: #"\s"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: ",", with: ".")
        .replacingOccurrences(of: "zł", with: "").replacingOccurrences(of: "%", with: "")
    if cleaned.isEmpty { return 0 }
    return Double(cleaned) ?? .nan
}

/// Liczba jak `String(number)` w JavaScript (bez „.0”).
private func jsNumber(_ value: Double) -> String {
    value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
}

/// Polska normalizacja do wyszukiwania pól (`normalizeVariableSearch`).
private func searchKey(_ value: String) -> String {
    value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
        .trimmingCharacters(in: .whitespaces)
}

// MARK: Pola i warunki

@MainActor struct EventContractFieldsSheet: View {
    let eventID: String
    let canViewAmounts: Bool
    let hosts: [String]
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var data: EventContractEditData?
    @State private var loadError: String?
    @State private var values: [String: String] = [:]
    @State private var client = "osoba"
    @State private var options: [String: Bool] = [:]
    @State private var signers: Set<String> = []
    @State private var search = ""
    @State private var depositPercent = ""
    @State private var depositAmount = ""
    @State private var depositDirty = false
    @State private var working: String?
    @State private var problem: String?
    /// Pola z formatowaniem zmienione w oknie edycji (wartość HTML w `values`).
    @State private var htmlChanged: Set<String> = []
    @State private var htmlEditing: EventContractEditData.Field?

    private var fields: [EventContractEditData.Field] {
        let query = searchKey(search)
        return (data?.fields ?? []).filter { query.isEmpty || searchKey("\($0.label) \($0.key)").contains(query) }
    }

    /// Zmienione pola i warunki (tylko różnice — reszta zostaje jak w umowie).
    private func changes(_ data: EventContractEditData) -> [String: JSONValue] {
        var result: [String: JSONValue] = [:]
        for field in data.fields where !field.html {
            let value = values[field.key] ?? field.value
            if value != field.value { result[field.key] = .string(value) }
        }
        for field in data.fields where field.html && htmlChanged.contains(field.key) {
            if let value = values[field.key] { result[field.key] = .string(value) }
        }
        if let current = data.client, client != current { result[data.clientKey] = .string(client) }
        for option in data.options {
            let enabled = options[option.key] ?? option.enabled
            if enabled != option.enabled { result[option.key] = .string(enabled ? "tak" : "") }
        }
        return result
    }

    private func signersChanged(_ data: EventContractEditData) -> Bool {
        guard let party = data.party else { return false }
        return signers != Set(party.selected)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Pola i warunki umowy").font(.title2.bold())
                Text("Zmiany dotyczą tylko tej umowy. Pola pochodzą z danych eventu, klienta i oferty — po zapisaniu treść umowy składa się od nowa.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            if let data {
                form(data)
            } else if let loadError {
                ContentUnavailableView("Nie można edytować umowy", systemImage: "doc.badge.ellipsis", description: Text(loadError))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Składanie umowy z aktualnych danych…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                if let problem { Text(problem).foregroundStyle(.orange).lineLimit(3) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working != nil)
                Button(working == "fields" ? "Zapisywanie…" : "Zapisz") { Task { await saveFields() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(working != nil || data?.canEdit != true)
            }
            .padding(16)
        }
        .frame(width: 720, height: 760)
        .task { await load(keep: [:]) }
        .sheet(item: $htmlEditing) { field in
            ContractFieldHTMLSheet(field: field, html: values[field.key] ?? field.value, css: data?.cssText ?? "") { html in
                values[field.key] = html
                htmlChanged.insert(field.key)
            }
        }
        .overlay { if working != nil { PendingOverlay(text: working == "deposit" ? "Zapisywanie depozytu…" : "Zapisywanie danych umowy…") } }
    }

    @ViewBuilder private func form(_ data: EventContractEditData) -> some View {
        Form {
            if !data.canEdit {
                Section { Label("Umowa nie jest szkicem — pola i warunki są tylko do odczytu.", systemImage: "lock") }
            }
            if data.client != nil || !data.options.isEmpty {
                Section {
                    if data.client != nil {
                        Picker("Klient", selection: $client) {
                            Text("firma").tag("firma")
                            Text("osoba prywatna").tag("osoba")
                        }
                    }
                    ForEach(data.options) { option in
                        Toggle(option.label, isOn: Binding(get: { options[option.key] ?? option.enabled }, set: { options[option.key] = $0 }))
                    }
                } header: { Text("Warunki umowy") } footer: {
                    Text("Decydują, które akapity szablonu trafią do tej umowy.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let party = data.party {
                Section {
                    if party.signers.isEmpty {
                        Text("Brak osób uprawnionych w danych organizacji.").foregroundStyle(.secondary)
                    } else {
                        Toggle("Uwzględnij wszystkie osoby uprawnione", isOn: Binding(
                            get: { party.signers.allSatisfy { signers.contains($0.id) } },
                            set: { signers = $0 ? Set(party.signers.map(\.id)) : [] }))
                        ForEach(party.signers) { person in
                            Toggle(isOn: Binding(get: { signers.contains(person.id) }, set: { if $0 { signers.insert(person.id) } else { signers.remove(person.id) } })) {
                                Text(person.title.isEmpty ? person.fullName : "\(person.fullName) — \(person.title)")
                            }
                        }
                    }
                    Text(contractPlainText(party.html)).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } header: { Text("Dane klienta i osoby podpisujące umowę") } footer: {
                    Text("Wybór osoby ponownie składa blok z danych organizacji. Treść bloku poprawisz w edytorze umowy w CRM.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let deposit = data.deposit { depositSection(deposit, data) }
            Section {
                TextField("Szukaj pola", text: $search, prompt: Text("Szukaj pola, np. numer umowy"))
                if fields.isEmpty {
                    Text(search.isEmpty ? "Ten szablon nie zawiera pól przeznaczonych do ręcznej edycji." : "Nie znaleziono pola o takiej nazwie.")
                        .foregroundStyle(.secondary)
                }
                ForEach(fields) { field in fieldRow(field, data) }
            } header: { Text("Pola umowy (\(data.fields.count))") }
        }
        .formStyle(.grouped)
        .disabled(working != nil)
    }

    @ViewBuilder private func fieldRow(_ field: EventContractEditData.Field, _ data: EventContractEditData) -> some View {
        let binding = Binding(get: { values[field.key] ?? field.value }, set: { values[field.key] = $0 })
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(field.label).font(.callout.weight(.medium))
                Spacer()
                Text("{{\(field.key)}}").font(.caption2.monospaced()).foregroundStyle(.tertiary).textSelection(.enabled)
            }
            if field.html {
                let current = contractPlainText(values[field.key] ?? field.value)
                Text(current.isEmpty ? "—" : current)
                    .font(.callout).foregroundStyle(.secondary).textSelection(.enabled).lineLimit(8)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    if data.canEdit {
                        Button { htmlEditing = field } label: { Label("Edytuj z formatowaniem…", systemImage: "textformat") }
                            .controlSize(.small)
                    }
                    if htmlChanged.contains(field.key) {
                        Text("Zmienione — zapiszesz przyciskiem „Zapisz”.").font(.caption2).foregroundStyle(.orange)
                    } else {
                        Text("Pole z formatowaniem (blok tekstu, tabela).").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            } else if field.long {
                TextField(field.label, text: binding, axis: .vertical).lineLimit(3...8).labelsHidden().disabled(!data.canEdit)
            } else {
                TextField(field.label, text: binding).labelsHidden().disabled(!data.canEdit)
            }
        }
        .padding(.vertical, 2)
    }

    /// Zaliczka / depozyt: procent i kwota brutto przeliczane wzajemnie jak w CRM (`changeDeposit`).
    private func depositSection(_ deposit: EventContractEditData.Deposit, _ data: EventContractEditData) -> some View {
        let total = deposit.total ?? 0
        let percent = Binding(get: { depositPercent }, set: { value in
            depositDirty = true
            depositPercent = value
            let number = depositNumber(value)
            depositAmount = !value.trimmingCharacters(in: .whitespaces).isEmpty && number.isFinite ? jsNumber((total * number).rounded() / 100) : ""
        })
        let amount = Binding(get: { depositAmount }, set: { value in
            depositDirty = true
            depositAmount = value
            let number = depositNumber(value)
            depositPercent = !value.trimmingCharacters(in: .whitespaces).isEmpty && number.isFinite && total > 0 ? jsNumber((number / total * 10000).rounded() / 100) : ""
        })
        return Section {
            HStack(spacing: 10) {
                TextField("Procent", text: percent).frame(width: 90)
                Text("%")
                TextField("Kwota", text: amount).frame(width: 140)
                Text("zł brutto")
                Spacer()
                Button("Zapisz depozyt") { Task { await saveDeposit() } }
                    .disabled(!data.canEdit || !depositDirty || working != nil)
            }
            .disabled(!data.canEdit)
        } header: { Text("Zaliczka / depozyt") } footer: {
            Text("Obecnie: \(deposit.label). Procent od 0 do 100 albo kwota nieprzekraczająca wartości brutto umowy.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func load(keep: [String: String]) async {
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .state, canViewAmounts: canViewAmounts, hosts: hosts)
            guard let edit = result.edit else { throw NativeFailure(status: 0, message: "Serwer CRM nie podał pól umowy — zaktualizuj CRM.", fieldErrors: [:]) }
            data = edit
            values = keep
            htmlChanged = htmlChanged.intersection(Set(keep.keys))
            client = edit.client ?? "osoba"
            options = [:]
            signers = Set(edit.party?.selected ?? [])
            depositPercent = edit.deposit?.percent ?? ""
            depositAmount = edit.deposit?.amount ?? ""
            depositDirty = false
            loadError = nil
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func saveFields() async {
        guard let data else { return }
        let changed = changes(data)
        let signerChange = signersChanged(data)
        if changed.isEmpty && !signerChange {
            dismiss()
            return
        }
        working = "fields"; problem = nil
        defer { working = nil }
        var edit: [String: JSONValue] = ["values": .object(changed)]
        if data.party != nil { edit["signerIds"] = .array(signers.sorted().map { .string($0) }) }
        do {
            _ = try await state.eventContract(eventID: eventID, mode: .saveFields, canViewAmounts: canViewAmounts, hosts: hosts, extra: ["edit": .object(edit)])
            await saved()
            state.succeed("Dane umowy zostały zapisane")
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func saveDeposit() async {
        guard let data else { return }
        working = "deposit"; problem = nil
        defer { working = nil }
        // Niezapisane zmiany pól zostają w oknie po ponownym wczytaniu umowy.
        var keep: [String: String] = [:]
        for field in data.fields where !field.html { if let value = values[field.key], value != field.value { keep[field.key] = value } }
        for field in data.fields where field.html && htmlChanged.contains(field.key) { if let value = values[field.key] { keep[field.key] = value } }
        do {
            _ = try await state.eventContract(eventID: eventID, mode: .saveDeposit, canViewAmounts: canViewAmounts, hosts: hosts,
                                              extra: ["deposit": .object(["percent": .string(depositPercent), "amount": .string(depositAmount)])])
            await saved()
            state.succeed("Zapisano procent i kwotę depozytu.")
            await load(keep: keep)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: Wystawienie i zmiana statusu szkicu

struct EventContractStatusTarget: Identifiable {
    let status: String
    var id: String { status }
}

@MainActor struct EventContractStatusSheet: View {
    let eventID: String
    let target: String
    let canViewAmounts: Bool
    let hosts: [String]
    let isAdmin: Bool
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var issues: [EventContractPreflightIssue]?
    @State private var loadError: String?
    @State private var acknowledged: Set<String> = []
    @State private var working = false
    @State private var problem: String?

    /// Uwagi sprawdzamy przy finalizacji szkicu (`ensureContractPreflight`).
    private var finalizes: Bool { target != "draft" && target != "cancelled" }
    private var openBlockers: Int { (issues ?? []).filter { $0.severity == "blocker" && !acknowledged.contains($0.key) }.count }
    private var title: String { target == "issued" ? "Wystaw umowę" : "Zmień status na „\(ContractText.status(target))”" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.bold())
            Text("Status zmieni się na „\(ContractText.status(target))” z bieżącą datą i zostanie zapisana aktualna treść umowy (z szablonu, oferty i klauzul). Zmiana statusu nie wysyła wiadomości do klienta.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let issues {
                if !finalizes {
                    EmptyView()
                } else if issues.isEmpty {
                    Label("Brak uwag przed wystawieniem — dane umowy są kompletne.", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Uwagi do sprawdzenia", systemImage: "exclamationmark.shield").font(.headline).foregroundStyle(.orange)
                        Text("Aby wystawić finalną umowę mimo wskazanych braków, zaznacz zapoznanie się z odpowiednimi uwagami. Potwierdzenie nie uzupełnia danych i obowiązuje tylko dla tego wystawienia.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(issues) { issue in issueRow(issue) }
                        }
                    }
                    .frame(maxHeight: 340)
                }
            } else if let loadError {
                Label(loadError, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            } else {
                ProgressView("Składanie umowy i sprawdzanie danych…").frame(maxWidth: .infinity)
            }
            if let problem { Text(problem).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if finalizes && openBlockers > 0 {
                    Text("Do potwierdzenia: \(openBlockers)").font(.caption).foregroundStyle(.orange)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working)
                Button(working ? "Zapisywanie…" : (target == "issued" ? "Wystaw umowę" : "Zmień status")) { Task { await submit() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(working || issues == nil || (finalizes && openBlockers > 0))
            }
        }
        .padding(20).frame(width: 600)
        .task { await load() }
    }

    private func issueRow(_ issue: EventContractPreflightIssue) -> some View {
        let blocker = issue.severity == "blocker"
        return HStack(alignment: .top, spacing: 10) {
            Toggle(isOn: Binding(get: { acknowledged.contains(issue.key) }, set: { if $0 { acknowledged.insert(issue.key) } else { acknowledged.remove(issue.key) } })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(issue.label).fixedSize(horizontal: false, vertical: true)
                    Text(acknowledged.contains(issue.key)
                         ? "Potwierdzono — świadomie akceptuję tę uwagę przy wystawieniu finalnej umowy."
                         : blocker ? "Zapoznałem(-am) się z uwagą i świadomie akceptuję wystawienie umowy mimo tego braku." : "Ostrzeżenie — nie blokuje wystawienia.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox)
            Spacer(minLength: 6)
            if let href = issue.actionHref, let label = issue.actionLabel {
                Button(label) { open(href) }.controlSize(.small)
            }
        }
        .padding(10)
        .background((blocker ? Color.orange : Color.secondary).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    /// Odnośnik z uwagi: karta organizacji na Macu, inne miejsca (szablon, oferta) — w CRM.
    private func open(_ href: String) {
        if let match = href.range(of: #"^/crm/contacts/([0-9a-fA-F-]{36})"#, options: .regularExpression) {
            let id = String(href[match].dropFirst("/crm/contacts/".count))
            state.showContact(id)
        } else if let match = href.range(of: #"^/crm/offers/([0-9a-fA-F-]{36})"#, options: .regularExpression) {
            state.open(.offers, id: String(href[match].dropFirst("/crm/offers/".count)))
        } else {
            state.openCRM(href)
        }
    }

    private func load() async {
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .state, canViewAmounts: canViewAmounts, hosts: hosts)
            issues = result.preflight ?? []
            loadError = nil
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func submit() async {
        working = true; problem = nil
        defer { working = false }
        do {
            _ = try await state.eventContract(eventID: eventID, mode: .status, canViewAmounts: canViewAmounts, hosts: hosts,
                                              extra: ["status": .string(target), "acknowledged": .array(acknowledged.sorted().map { .string($0) }),
                                                      "isAdmin": .bool(isAdmin)])
            await saved()
            state.succeed("Status umowy został zaktualizowany")
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: Pole z formatowaniem

/// Edycja pola HTML umowy (blok tekstu, tabela) jak `ContractVariableHtmlField` w CRM: formatowanie z paska, wklejanie
/// jako zwykły tekst. „Zastosuj” przenosi treść do okna pól — zapis razem z pozostałymi polami.
@MainActor struct ContractFieldHTMLSheet: View {
    let field: EventContractEditData.Field
    let html: String
    let css: String
    let apply: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var editor: ContractHTMLEditorController
    @State private var problem: String?

    init(field: EventContractEditData.Field, html: String, css: String, apply: @escaping (String) -> Void) {
        self.field = field
        self.html = html
        self.css = css
        self.apply = apply
        _editor = StateObject(wrappedValue: ContractHTMLEditorController(mode: .field, html: html, css: css))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(field.label).font(.title3.bold())
                Spacer()
                Text("{{\(field.key)}}").font(.caption.monospaced()).foregroundStyle(.tertiary)
            }
            ContractHTMLEditorToolbar(controller: editor, paragraphs: false)
            ContractHTMLEditorView(controller: editor)
                .frame(minHeight: 260)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.15)))
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.orange) }
                else { Text("Zmiana dotyczy tylko tej umowy. Wklejony tekst trafia bez formatowania.").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zastosuj") { Task { await confirm() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(!editor.ready)
            }
        }
        .padding(18)
        .frame(width: 760, height: 520)
    }

    private func confirm() async {
        guard editor.dirty else {
            dismiss()
            return
        }
        do {
            apply(try await editor.currentHTML())
            dismiss()
        } catch {
            problem = "Nie udało się odczytać treści pola."
        }
    }
}
