import SwiftUI

// MARK: Przekształcanie i scalanie szablonów umów na Macu — „Przekształć szablon” (`ContractTemplateConvertBanner`)
// i „Scal z innym szablonem” (`ContractMergeDialog`) z CRM. Oba mierzą układ dokumentu (style akapitów, podział na strony),
// więc liczy je ten sam kod CRM w Chrome na Macu: strona `/native-engine/contracts` w przeglądarce w tle
// (`ChromePdfEngine.evaluate`, jak lokalne wydruki). Serwer: `templateSource` i `templateConvert`
// w `src/lib/native/contracts.ts`.

/// Źródło szablonu dla silnika (`op=templateSource`): treść jak w CRM, ustawienia strony, kategorie i hosty sieci.
struct ContractTemplateSource: Decodable {
    let id: String
    let name: String
    let updatedAt: String?
    let format: String
    let flow: String
    let settings: JSONValue
    let categories: [String]
    let hosts: [String]
}

/// Wynik „Przekształć szablon” z silnika: treść i style do zapisu, strony przed i po, rozpoznane style, ostrzeżenia.
struct ContractConversionResult: Decodable {
    let flowContent: String
    let documentStyles: JSONValue
    let pagesBefore: Int
    let pagesAfter: Int
    let styles: [String]
    let warnings: [String]
}

/// Wynik „Porównaj” z silnika: scalone akapity, wariant jako cała sekcja i statystyki.
struct ContractMergeResult: Decodable {
    struct Stats: Decodable {
        let common: Int
        let onlyBase: Int
        let onlyOther: Int
        let similarity: Double
    }
    let merged: String
    let appended: String
    let stats: Stats
}

/// Funkcje silnika umów CRM (`window.mavinciContractEngine`); `eventContract` — umowa wydarzenia (`EventContractEngine.swift`).
enum ContractEngineCall: String {
    case convertTemplate, mergeTemplates, eventContract
}

enum ContractEngine {
    /// Silnik działa w przeglądarce Chromium zainstalowanej na Macu (Chrome, Edge, Brave…).
    static var available: Bool { ChromePdfEngine.browserExecutable() != nil }

    static func pages(_ count: Int) -> String {
        let few = count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)
        return "\(count) \(count == 1 ? "strona" : few ? "strony" : "stron")"
    }
}

extension Workspace {
    /// Funkcja silnika umów CRM w Chrome na Macu; dane wejściowe jako JSON, wynik dekodowany z tekstu JSON.
    func contractEngine<T: Decodable>(_ call: ContractEngineCall, input: [String: JSONValue], hosts: [String], as type: T.Type) async throws -> T {
        guard let base = connection.crm, let page = URL(string: base + "/native-engine/contracts") else { throw AppError.configuration }
        guard ContractEngine.available else { throw LocalPdfError.browserMissing }
        var allowed = Set(hosts)
        for address in [page, URL(string: connection.url)] {
            guard let address, let host = address.host else { continue }
            allowed.insert(address.port.map { "\(host):\($0)" } ?? host)
        }
        let json = String(decoding: try JSONEncoder().encode(input), as: UTF8.self)
        let name = call.rawValue
        let script = """
        (async () => {
          for (let i = 0; i < 400 && !(window.mavinciContractEngine && window.mavinciContractEngine.\(name)); i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const engine = window.mavinciContractEngine;
          if (!engine || !engine.\(name)) throw new Error('serwer CRM nie ma jeszcze silnika umów — zaktualizuj CRM i spróbuj ponownie.');
          return await engine.\(name)(\(json));
        })()
        """
        let data = try await ChromePdfEngine.shared.evaluate(page: page, hosts: Array(allowed), script: script)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: Szablon w starszym formacie — „Przekształć szablon”

struct ContractConversionPlan: Identifiable {
    let id = UUID()
    let source: ContractTemplateSource
    let result: ContractConversionResult
}

/// Treść edytora dla szablonu w starszym formacie: przekształcenie na Macu (z Chrome) albo w CRM.
@MainActor struct ContractLegacyTemplateView: View {
    @ObservedObject var store: ContractsStore
    @ObservedObject var controller: ContractEditorController
    let onConverted: () -> Void
    @EnvironmentObject private var state: Workspace
    @State private var preparing = false
    @State private var saving = false
    @State private var plan: ContractConversionPlan?

    private var canConvert: Bool { controller.payload.canEdit && store.canManage }
    private var crmPath: String { "/crm/contract-templates/\(controller.templateID)/edit-wysiwyg" }

    private var explanation: String {
        let intro = "Edytor na Macu działa na szablonach w formacie edytora jak Word."
        if !canConvert { return intro + " Przekształcić szablon może osoba z uprawnieniem do zarządzania umowami." }
        if !ContractEngine.available {
            return intro + " Przekształcenie liczy układ dokumentu w przeglądarce Chrome — zainstaluj Chrome na tym Macu albo przekształć szablon w CRM."
        }
        return intro + " Przekształć szablon: wygląd umowy zostanie zapisany jako style dokumentu, treść i warunki zostają bez zmian, a poprzednia wersja zostaje zapisana w szablonie."
    }

    var body: some View {
        ContentUnavailableView {
            Label("Szablon w starszym formacie", systemImage: "doc.badge.gearshape")
        } description: {
            Text(explanation)
        } actions: {
            if canConvert && ContractEngine.available {
                Button { Task { await prepare() } } label: { Label("Przekształć szablon", systemImage: "sparkles") }
                    .buttonStyle(.borderedProminent)
                    .disabled(preparing || saving)
            } else if canConvert {
                Button("Przekształć w CRM") { state.openCRM(crmPath) }.buttonStyle(.borderedProminent)
            }
            Button("Otwórz w CRM") { state.openCRM(crmPath) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay { if preparing { PendingOverlay(text: "Przekształcanie szablonu w Chrome…") } }
        .sheet(item: $plan) { plan in
            ContractConversionSheet(plan: plan) { Task { await save(plan) } }
        }
    }

    /// Jak `convert` w `ContractTemplateConvertBanner`: strony przed, przekształcenie, strony po — potem potwierdzenie.
    private func prepare() async {
        preparing = true
        defer { preparing = false }
        do {
            let source = try await store.templateSource(controller.templateID)
            if source.format == "word" {
                state.succeed("Szablon jest już przekształcony — otwieram nowy edytor")
                onConverted()
                return
            }
            let input: [String: JSONValue] = ["flow": .string(source.flow), "settings": source.settings]
            let result = try await state.contractEngine(.convertTemplate, input: input, hosts: source.hosts, as: ContractConversionResult.self)
            plan = ContractConversionPlan(source: source, result: result)
        } catch {
            state.error = store.failureText(error, "Nie udało się przekształcić szablonu")
        }
    }

    private func save(_ plan: ContractConversionPlan) async {
        saving = true
        defer { saving = false }
        if await store.convertTemplate(controller.templateID, html: plan.result.flowContent, documentStyles: plan.result.documentStyles,
                                       updatedAt: plan.source.updatedAt) {
            onConverted()
        }
    }
}

/// Potwierdzenie przekształcenia — treść jak okno potwierdzenia w CRM.
@MainActor struct ContractConversionSheet: View {
    let plan: ContractConversionPlan
    let onConfirm: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Przekształcić szablon do nowego edytora?", systemImage: "sparkles").font(.title3.bold())
            Text("Wygląd umowy zostanie zapisany jako style (jak w Wordzie): zmiana stylu zmienia wszystkie akapity tego rodzaju. Treść i warunki zostają bez zmian.")
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 4) {
                Text("Strony w PDF:")
                Text(ContractEngine.pages(plan.result.pagesBefore)).bold()
                Image(systemName: "arrow.right").font(.caption)
                Text(ContractEngine.pages(plan.result.pagesAfter)).bold()
            }
            if !plan.result.styles.isEmpty {
                Text("Rozpoznane style — \(plan.result.styles.joined(separator: " · "))")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !plan.result.warnings.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(plan.result.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(maxHeight: 160)
            }
            Text("Poprzednia wersja zostaje zapisana w szablonie — można do niej wrócić.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Przekształć") {
                    dismiss()
                    onConfirm()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 540)
    }
}

// MARK: „Scal z innym szablonem” (wstążka „Warunki” → „Warianty” w CRM)

@MainActor struct ContractMergeSheet: View {
    @ObservedObject var store: ContractsStore
    @ObservedObject var controller: ContractEditorController
    let fieldLabels: [String: String]
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var otherID = ""
    @State private var condition: String?
    @State private var options: [ContractOptionItem] = []
    @State private var picking: ContractConditionRequest?
    @State private var busy = false
    @State private var problem: String?
    @State private var outcome: Outcome?

    private struct Outcome {
        let merge: ContractMergeResult
        let categories: [String]
        let name: String
    }

    private var others: [ContractTemplateItem] {
        store.templates.filter { $0.id != controller.templateID }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Warunek treści tylko z bieżącego szablonu — odwrotność warunku wariantu (`negateContractCondition`).
    private var baseCondition: String? {
        guard let condition else { return nil }
        guard var parsed = ContractCondition.parse(condition) else { return condition }
        parsed.negate.toggle()
        return parsed.expression
    }

    private var recommendMerge: Bool { (outcome?.merge.stats.similarity ?? 0) >= 0.3 }

    private func describe(_ expression: String) -> String {
        ContractConditionText.describe(expression, options: options, fieldLabels: fieldLabels)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Scal z innym szablonem", systemImage: "arrow.triangle.merge").font(.title3.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            form
            HStack {
                if !ContractEngine.available {
                    Button("Otwórz w CRM") { state.openCRM("/crm/contract-templates/\(controller.templateID)/edit-wysiwyg") }
                }
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                if let outcome {
                    mergeButton("Dołącz jako całą sekcję", prominent: !recommendMerge) { apply(outcome.merge.appended) }
                    mergeButton("Scal akapity", prominent: recommendMerge) { apply(outcome.merge.merged) }
                }
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 580, idealWidth: 620, minHeight: 520, idealHeight: 600)
        .onAppear { options = controller.options }
        .sheet(item: $picking) { request in
            ContractConditionSheet(request: request, options: options, categories: controller.payload.categories ?? [],
                                   fields: controller.payload.conditionFields ?? [], fieldLabels: fieldLabels,
                                   onApply: { expression, next in
                                       condition = expression
                                       options = next
                                       outcome = nil
                                   },
                                   onRemove: nil)
        }
        .overlay { if busy { PendingOverlay(text: "Porównywanie szablonów w Chrome…") } }
    }

    private var form: some View {
        Form {
            Section("1. Szablon do scalenia (wariant)") {
                Picker("Szablon", selection: $otherID) {
                    Text("— wybierz —").tag("")
                    ForEach(others) { item in
                        Text(item.active ? item.name : "\(item.name) (nieaktywny)").tag(item.id)
                    }
                }
                .labelsHidden()
                .onChange(of: otherID) { _, _ in outcome = nil }
            }
            Section("2. Kiedy obowiązuje treść wariantu?") {
                HStack {
                    Text(condition.map { describe($0) } ?? "Nie wybrano warunku")
                        .foregroundStyle(condition == nil ? Color.secondary : ContractColorsUI.condition)
                    Spacer()
                    Button(condition == nil ? "Wybierz" : "Zmień") { picking = ContractConditionRequest(initial: condition, scope: "Wariant") }
                }
                if let base = baseCondition {
                    Text("Treść tylko z bieżącego szablonu: \(describe(base)).").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                Button("3. Porównaj") { Task { await compare() } }
                    .disabled(otherID.isEmpty || condition == nil || busy || !ContractEngine.available)
                if !ContractEngine.available {
                    Text("Porównanie liczy układ dokumentu w przeglądarce Chrome — zainstaluj Chrome na tym Macu albo scal szablony w CRM.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let problem { Text(problem).foregroundStyle(.red) }
                if let outcome { summary(outcome) }
            }
        }
        .formStyle(.grouped)
        .disabled(busy)
    }

    @ViewBuilder private func summary(_ outcome: Outcome) -> some View {
        HStack(spacing: 0) {
            counter(outcome.merge.stats.common, "wspólne")
            counter(outcome.merge.stats.onlyBase, "tylko w tym")
            counter(outcome.merge.stats.onlyOther, "tylko w „\(outcome.name)”")
        }
        Text("Podobieństwo: \(Int((outcome.merge.stats.similarity * 100).rounded()))%. "
             + (recommendMerge ? "Scalanie akapitów zostawi wspólną treść raz." : "Szablony są bardzo różne — czytelniej dołączyć wariant jako jedną sekcję."))
            .font(.caption).foregroundStyle(.secondary)
        if !outcome.categories.isEmpty {
            Text("Kategorie korzystające z „\(outcome.name)”: \(outcome.categories.joined(separator: ", ")). Po zapisie ustaw w nich ten szablon.")
                .font(.caption).foregroundStyle(.orange)
        }
    }

    private func counter(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title3.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func mergeButton(_ title: String, prominent: Bool, _ action: @escaping () -> Void) -> some View {
        if prominent {
            Button(title, action: action).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        } else {
            Button(title, action: action)
        }
    }

    /// Jak `compare` w `ContractMergeDialog`: wariant (po przekształceniu, gdy w starszym formacie), scalenie i statystyki.
    private func compare() async {
        guard let condition, !otherID.isEmpty else { return }
        let requested = otherID
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let source = try await store.templateSource(requested)
            let input: [String: JSONValue] = [
                "baseHtml": .string(controller.html()), "otherFlow": .string(source.flow), "otherSettings": source.settings,
                "condition": .string(condition),
            ]
            let merge = try await state.contractEngine(.mergeTemplates, input: input, hosts: source.hosts, as: ContractMergeResult.self)
            guard requested == otherID else { return }
            outcome = Outcome(merge: merge, categories: source.categories, name: source.name)
        } catch {
            problem = store.failureText(error, "Nie udało się wczytać szablonu")
        }
    }

    /// Jak `applyMerge` w edytorze CRM: opcje z warunku, cała treść (jedna zmiana do cofnięcia), zapis — przyciskiem „Zapisz”.
    private func apply(_ html: String) {
        controller.saveOptions(options)
        controller.replaceContent(html)
        state.succeed("Szablony scalone — sprawdź „Pokaż jako” i zapisz. Cofnięcie: ⌘Z.")
        dismiss()
    }
}
