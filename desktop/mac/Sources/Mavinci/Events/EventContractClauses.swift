import SwiftUI

// MARK: Umowa wydarzenia — „Klauzule tej umowy” (`EventContractClausesModal`) z wyborem rozbieżnych wersji wspólnych ustaleń
// (`handleApplyProductClauseSelections`) oraz „Zmień szablon umowy” (`handleTemplateChange`). Klauzule, wybory i treść po
// zmianie szablonu składa silnik dokumentów tym samym kodem co zakładka „Umowa” w CRM (`/native-engine/contracts`);
// zmianę szablonu zapisuje serwer jak `PATCH /bridge/events/contracts/template` (`template` w `src/lib/native/eventContract.ts`).
// Treść klauzuli edytuje się na Macu jako tekst: akapit w wierszu, punkt listy zaczyna się od „• ”. „Asystent AI” porównuje
// aktywne klauzule (`auditClauses` w silniku, funkcja `audit-contract`), a przyjęte sugestie trafiają na listę do zapisu.

struct EventContractClausesData: Decodable {
    struct Category: Decodable, Hashable, Identifiable {
        var value: String
        var label: String
        var id: String { value }
    }
    struct Item: Decodable, Hashable, Identifiable {
        var id: String
        var category: String
        var title: String
        var productName: String
        /// `automatic` — z produktów i oferty; `custom` — ustalenie dodane do wydarzenia.
        var source: String
        var enabled: Bool
        /// Treść zmieniona dla tego wydarzenia (inna niż w produkcie).
        var edited: Bool
        var text: String
        /// Formatowanie (pogrubienia, linki, tabele), którego tekst na Macu nie zachowa po zmianie treści.
        var formatted: Bool
        /// Oryginalna treść automatycznej klauzuli („Przywróć oryginał”).
        var original: String?
    }
    struct Candidate: Decodable, Hashable, Identifiable {
        var id: String
        var productName: String
        var preview: String
    }
    struct Conflict: Decodable, Hashable, Identifiable {
        var key: String
        var category: String
        var topic: String
        var candidates: [Candidate]
        var id: String { key }
    }
    /// `canEdit` z zakładki: umowa nieanulowana i niezablokowana; poza szkicem — administrator.
    var canEdit: Bool
    var isWorkingDraft: Bool
    /// Treść zmieniona indywidualnie — zapis klauzul ostrzega, że poprawki mogą zostać zastąpione.
    var individuallyEdited: Bool
    var categories: [Category]
    var items: [Item]
    /// Rozbieżne wersje wspólnych ustaleń bez zastosowanego wyboru.
    var conflicts: [Conflict]
    var selections: [String: String]
}

/// Klauzula w oknie (stan przed zapisem).
private struct ClauseDraft: Identifiable, Hashable {
    var id: String
    var category: String
    var title: String
    var productName: String
    var custom: Bool
    /// Nowe ustalenie dodane w oknie (jeszcze niezapisane).
    var added: Bool
    var enabled: Bool
    var text: String
    var loadedText: String
    var loadedEnabled: Bool
    var loadedEdited: Bool
    var original: String?
    var restored: Bool
    var formatted: Bool

    init(_ item: EventContractClausesData.Item) {
        id = item.id
        category = item.category
        title = item.title
        productName = item.productName
        custom = item.source == "custom"
        added = false
        enabled = item.enabled
        text = item.text
        loadedText = item.text
        loadedEnabled = item.enabled
        loadedEdited = item.edited
        original = item.original
        restored = false
        formatted = item.formatted
    }

    init(newIn category: String, title: String, text: String) {
        id = "new-" + UUID().uuidString
        self.category = category
        self.title = title
        productName = "Ustalenie dla wydarzenia"
        custom = true
        added = true
        enabled = true
        self.text = text
        loadedText = text
        loadedEnabled = true
        loadedEdited = false
        original = nil
        restored = false
        formatted = false
    }

    private static func normalized(_ value: String) -> String {
        value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// „Zmieniona”: automatyczna klauzula z treścią inną niż oryginał.
    var isEdited: Bool {
        guard !custom else { return false }
        if text == loadedText && !restored { return loadedEdited }
        guard let original else { return text != loadedText || loadedEdited }
        return Self.normalized(text) != Self.normalized(original)
    }

    /// Zmiana do zapisu (`nil` — bez zmian).
    var change: [String: JSONValue]? {
        guard !added else { return nil }
        var result: [String: JSONValue] = ["id": .string(id)]
        if !custom && enabled != loadedEnabled { result["enabled"] = .bool(enabled) }
        if restored && text == (original ?? text) {
            result["restore"] = .bool(true)
        } else if text != loadedText {
            result["text"] = .string(text)
        }
        return result.count > 1 ? result : nil
    }
}

/// Polska normalizacja do wyszukiwania klauzul.
private func clauseSearchKey(_ value: String) -> String {
    value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
}

@MainActor struct EventContractClausesSheet: View {
    let eventID: String
    let canViewAmounts: Bool
    let hosts: [String]
    let isAdmin: Bool
    /// Umowa już istnieje (zapis odbudowuje jej draft — ostrzeżenie jak w CRM).
    let hasContract: Bool
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: EventContractClausesData?
    @State private var loadError: String?
    @State private var drafts: [ClauseDraft] = []
    @State private var removedIDs: Set<String> = []
    @State private var category = "obligations"
    @State private var search = ""
    @State private var showAddForm = false
    @State private var newTitle = "Sugestia klienta"
    @State private var newContent = ""
    @State private var selections: [String: String] = [:]
    @State private var working: String?
    @State private var problem: String?
    @State private var confirmingSave = false
    @State private var confirmingApply = false
    @State private var auditing = false
    @State private var auditReview: ContractAuditReview?
    @State private var auditError: String?
    @State private var auditMessage: String?
    /// Klauzule wskazane przez asystenta AI — oznaczenie znika po zmianie klauzuli.
    @State private var flaggedIDs: Set<String> = []

    private static let outdated = "Serwer CRM nie obsługuje jeszcze klauzul umowy na Macu — zaktualizuj CRM."

    private var visible: [ClauseDraft] {
        let query = clauseSearchKey(search.trimmingCharacters(in: .whitespacesAndNewlines))
        return drafts.filter { item in
            guard item.category == category else { return false }
            return query.isEmpty || clauseSearchKey("\(item.title) \(item.productName) \(item.text)").contains(query)
        }
    }

    private var hasChanges: Bool {
        !removedIDs.isEmpty || drafts.contains { $0.added || $0.change != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Klauzule tej umowy").font(.title2.bold())
                Text("Zmiany dotyczą wyłącznie tego eventu. Nie zmienią klauzul zapisanych przy produktach ani w ofercie.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 10)
            Divider()
            if let data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !data.canEdit {
                            Label("Umowa jest wystawiona albo zablokowana — klauzule są tylko do odczytu.", systemImage: "lock")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        if data.isWorkingDraft && !data.conflicts.isEmpty { conflictsCard(data) }
                        categoryBar(data)
                        toolbar(data)
                        if let auditError {
                            Label(auditError, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.red)
                        }
                        if let auditMessage {
                            Label(auditMessage, systemImage: "sparkles").font(.callout).foregroundStyle(.green)
                        }
                        if showAddForm { addForm(data) }
                        ForEach(visible) { item in clauseCard(item, data) }
                        if visible.isEmpty {
                            Text(search.isEmpty ? "W tej kategorii nie ma jeszcze klauzul. Możesz dodać własne ustalenie." : "Brak klauzul pasujących do wyszukiwania.")
                                .font(.callout).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(28)
                                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundStyle(.quaternary))
                        }
                    }
                    .padding(20)
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać klauzul", systemImage: "text.badge.xmark")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Składanie umowy z aktualnych danych…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            footer
        }
        .frame(minWidth: 860, idealWidth: 920, minHeight: 680, idealHeight: 800)
        .task { await load() }
        .interactiveDismissDisabled(working != nil)
        .overlay { if let working { PendingOverlay(text: working) } }
        .sheet(item: $auditReview) { ContractAuditReviewSheet(review: $0) }
        .overlay { if auditing { PendingOverlay(text: "Analizowanie klauzul…") } }
        .confirmationDialog("Zapisać klauzule umowy?", isPresented: $confirmingSave, titleVisibility: .visible) {
            Button("Zapisz klauzule") { Task { await save() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Zapisanie klauzul odbuduje draft z aktualnego szablonu i oferty. Indywidualne poprawki naniesione bezpośrednio w treści umowy mogą zostać zastąpione. Kontynuować?")
        }
        .confirmationDialog("Zastosować wybór klauzul?", isPresented: $confirmingApply, titleVisibility: .visible) {
            Button("Zastosuj wybór") { Task { await applySelections() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Zastosowanie wyborów odbuduje draft z aktualnego szablonu, oferty i klauzul produktów. Indywidualne poprawki treści mogą zostać zastąpione. Kontynuować?")
        }
    }

    private var footer: some View {
        let active = drafts.filter(\.enabled).count
        let changed = drafts.filter { $0.custom || !$0.enabled || $0.isEdited }.count
        return HStack(spacing: 10) {
            if let problem {
                Text(problem).font(.callout).foregroundStyle(.orange).lineLimit(3)
            } else if data != nil {
                Text("\(active) aktywnych klauzul · \(changed) zmian dla tego eventu").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working != nil)
            Button("Zapisz klauzule umowy") {
                if hasContract && data?.individuallyEdited == true && hasChanges { confirmingSave = true } else { Task { await save() } }
            }
            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            .disabled(working != nil || data?.canEdit != true)
        }
        .padding(16).crmBar()
    }

    // MARK: Rozbieżne wersje wspólnych ustaleń

    private func conflictsCard(_ data: EventContractClausesData) -> some View {
        let chosen = data.conflicts.filter { selections[$0.key] != nil }.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Rozbieżne wersje wspólnych ustaleń", systemImage: "exclamationmark.shield").font(.headline).foregroundStyle(theme.accent)
                    Text("W źródłach umowy występują różne wersje tej samej wspólnej zasady. Wybierz treść, która ma znaleźć się w umowie. Ustalenia specyficzne dla różnych produktów nie są wzajemnie wykluczane.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Text("\(data.conflicts.count)").font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(theme.accent.opacity(0.15), in: Capsule())
            }
            ForEach(data.conflicts) { conflict in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(conflict.category.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(theme.accent)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
                        Text(conflict.topic).font(.callout.weight(.medium))
                    }
                    ForEach(conflict.candidates) { candidate in
                        let selected = selections[conflict.key] == candidate.id
                        Button { selections[conflict.key] = candidate.id } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                                    .foregroundStyle(selected ? theme.accent : Color.secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(candidate.productName).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                                    Text(candidate.preview).font(.caption).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(10)
                            .background(selected ? theme.accent.opacity(0.14) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
            }
            HStack {
                Text("Wybrano \(chosen) z \(data.conflicts.count) typów.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(working == "Aktualizowanie…" ? "Aktualizowanie…" : "Zastosuj wybory do umowy") {
                    if hasContract { confirmingApply = true } else { Task { await applySelections() } }
                }
                .buttonStyle(.borderedProminent)
                .disabled(working != nil || chosen < data.conflicts.count)
            }
            if hasChanges {
                Text("Niezapisane zmiany klauzul poniżej zostaną zachowane w oknie — zapiszesz je przyciskiem „Zapisz klauzule umowy”.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.accent.opacity(0.3)))
    }

    // MARK: Kategorie i lista klauzul

    private func categoryBar(_ data: EventContractClausesData) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(data.categories) { item in
                    let selected = item.value == category
                    let inCategory = drafts.filter { $0.category == item.value }
                    let active = inCategory.filter(\.enabled).count
                    let disabled = inCategory.count - active
                    let counts: String = "\(active) aktywnych" + (disabled > 0 ? " · \(disabled) wyłączonych" : "")
                    Button {
                        category = item.value
                        showAddForm = false
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label).font(.callout.weight(.medium))
                            Text(counts).font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(selected ? theme.accent.opacity(0.15) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(selected ? theme.accent.opacity(0.6) : Color.primary.opacity(0.1)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func toolbar(_ data: EventContractClausesData) -> some View {
        HStack(spacing: 10) {
            TextField("Szukaj", text: $search, prompt: Text("Szukaj po treści lub źródle")).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
            Spacer()
            if data.canEdit {
                Button { Task { await startAudit(data) } } label: { Label(auditing ? "Analizowanie…" : "Asystent AI", systemImage: "sparkles") }
                    .disabled(auditing || working != nil)
                    .help("Porównuje aktywne klauzule: duplikaty, sprzeczności i niejasne zapisy. Sugestie trafiają na listę do sprawdzenia przed zapisem.")
                Button { showAddForm.toggle() } label: { Label("Dodaj klauzulę w tej kategorii", systemImage: "plus") }
            }
        }
    }

    private func addForm(_ data: EventContractClausesData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Nowe ustalenie dla tego eventu", systemImage: "doc.badge.plus").font(.callout.weight(.semibold))
            TextField("Tytuł", text: $newTitle).textFieldStyle(.roundedBorder)
            ZStack(alignment: .topLeading) {
                TextEditor(text: $newContent).font(.body).frame(minHeight: 90, maxHeight: 160)
                if newContent.isEmpty {
                    Text("Wpisz ustalenie przekazane przez klienta…").foregroundStyle(.tertiary).padding(.horizontal, 5).padding(.vertical, 1).allowsHitTesting(false)
                }
            }
            .padding(4)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
            HStack {
                Spacer()
                Button("Anuluj") { showAddForm = false }
                Button("Dodaj do umowy") { addClause() }
                    .buttonStyle(.borderedProminent)
                    .disabled(newContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
        .background(Color.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }

    /// Wysokość pola treści z liczby wierszy (TextEditor w liście nie rośnie sam).
    private func editorHeight(_ text: String) -> CGFloat {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).reduce(0) { $0 + max(1, ($1.count + 99) / 100) }
        return min(320, max(64, CGFloat(lines) * 19 + 16))
    }

    private func clauseCard(_ item: ClauseDraft, _ data: EventContractClausesData) -> some View {
        let editable = data.canEdit && item.enabled
        let binding = Binding<String>(
            get: { drafts.first { $0.id == item.id }?.text ?? "" },
            set: { value in update(item.id) { $0.text = value } })
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.callout.weight(.semibold))
                    HStack(spacing: 6) {
                        Text(item.productName).font(.caption).foregroundStyle(.secondary)
                        badge(item.custom ? "Dodana do eventu" : "Automatyczna", item.custom ? .blue : theme.accent)
                        if item.isEdited { badge("Zmieniona", .orange) }
                        if !item.enabled { badge("Wyłączona", .red) }
                        if flaggedIDs.contains(item.id) { badge("AI: do sprawdzenia", .purple) }
                    }
                }
                Spacer()
                if data.canEdit {
                    if item.isEdited && item.enabled && item.original != nil {
                        Button("Przywróć oryginał") { update(item.id) { $0.text = $0.original ?? $0.text; $0.restored = true } }
                            .controlSize(.small)
                    }
                    if item.custom {
                        Button("Usuń", role: .destructive) { remove(item) }.controlSize(.small)
                    } else {
                        Button(item.enabled ? "Wyłącz w tej umowie" : "Przywróć") { update(item.id) { $0.enabled.toggle() } }
                            .controlSize(.small)
                            .tint(item.enabled ? Color.red : Color.green)
                    }
                }
            }
            if editable {
                TextEditor(text: binding)
                    .font(.body)
                    .frame(height: editorHeight(item.text))
                    .padding(4)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kliknij w treść, aby ją zmienić. Każdy wiersz to akapit, punkt listy zaczyna się od „• ”. Numeracja zostanie nadana przez szablon umowy.")
                    if item.formatted {
                        Text("Ta klauzula ma formatowanie (np. pogrubienia lub linki) — po zmianie treści na Macu zapisze się jako zwykłe akapity i punkty.")
                            .foregroundStyle(.orange)
                    }
                }
                .font(.caption2).foregroundStyle(.secondary)
            } else {
                Text(item.text.isEmpty ? "—" : item.text)
                    .font(.callout).foregroundStyle(item.enabled ? Color.primary : Color.secondary)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(Color.primary.opacity(item.enabled ? 0.03 : 0.015), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
        .opacity(item.enabled ? 1 : 0.8)
    }

    private func update(_ id: String, _ change: (inout ClauseDraft) -> Void) {
        guard let index = drafts.firstIndex(where: { $0.id == id }) else { return }
        change(&drafts[index])
        flaggedIDs.remove(id)
    }

    private func remove(_ item: ClauseDraft) {
        drafts.removeAll { $0.id == item.id }
        if !item.added { removedIDs.insert(item.id) }
        flaggedIDs.remove(item.id)
    }

    // MARK: Asystent AI

    /// `handleStartClauseAudit`: co najmniej dwie aktywne klauzule (z niezapisanymi zmianami z okna).
    private func startAudit(_ data: EventContractClausesData) async {
        let active = drafts.filter { $0.enabled && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard active.count >= 2 else {
            auditError = "Do porównania potrzebne są co najmniej dwie aktywne klauzule."
            return
        }
        auditing = true
        auditError = nil
        auditMessage = nil
        defer { auditing = false }
        let items: [JSONValue] = active.map {
            .object(["id": .string($0.id), "category": .string($0.category), "title": .string($0.title),
                     "productName": .string($0.productName), "text": .string($0.text)])
        }
        do {
            let result = try await state.eventContractClauseAudit(eventID: eventID, canViewAmounts: canViewAmounts, hosts: hosts, items: items)
            let duplicateIDs: [String] = result.audit.duplicates.flatMap { [$0.keepBlockId] + $0.removeBlockIds }
            let issueIDs: [String] = result.audit.issues.flatMap { $0.relatedBlockIds }
            flaggedIDs = Set((duplicateIDs + issueIDs).compactMap { result.blockToClauseId[$0] })
            auditReview = ContractAuditReview(result: result.audit, blocks: result.blocks) { selections in
                applyAudit(result, selections)
                return nil
            }
        } catch {
            auditError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// `handleApplyClauseAudit`: duplikaty i wybrane warianty na liście — automatyczne klauzule się wyłącza, własne usuwa,
    /// poprawki zmieniają treść. Zapis dopiero przyciskiem „Zapisz klauzule umowy”.
    private func applyAudit(_ audit: EventContractClauseAudit, _ selections: [String: String]) {
        let removeClause = { (blockID: String) in
            guard let clauseID = audit.blockToClauseId[blockID], let clause = drafts.first(where: { $0.id == clauseID }) else { return }
            if clause.custom {
                drafts.removeAll { $0.id == clauseID }
                if !clause.added { removedIDs.insert(clauseID) }
            } else if let index = drafts.firstIndex(where: { $0.id == clauseID }) {
                drafts[index].enabled = false
            }
        }
        let replaceClause = { (blockID: String, text: String) in
            let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            guard let clauseID = audit.blockToClauseId[blockID], !lines.isEmpty,
                  let index = drafts.firstIndex(where: { $0.id == clauseID }) else { return }
            drafts[index].text = lines.joined(separator: "\n")
        }
        for duplicate in audit.audit.duplicates {
            for blockID in duplicate.removeBlockIds where blockID != duplicate.keepBlockId { removeClause(blockID) }
        }
        let operations = auditOperations(audit, selections)
        for operation in operations {
            if operation.action == "remove" { removeClause(operation.blockId) } else { replaceClause(operation.blockId, operation.replacementText) }
        }
        flaggedIDs = []
        auditMessage = "Sugestie AI zostały zastosowane do listy. Sprawdź treść i zapisz klauzule umowy."
    }

    /// Operacje wybranych wariantów (z pominięciem „Pozostaw bez zmian”).
    private func auditOperations(_ audit: EventContractClauseAudit, _ selections: [String: String]) -> [ContractAuditResult.Operation] {
        audit.audit.issues.flatMap { issue -> [ContractAuditResult.Operation] in
            guard let selected = selections[issue.id], selected != "__keep_original__",
                  let option = issue.options.first(where: { $0.id == selected }) else { return [] }
            return option.operations
        }
    }

    /// `handleAddClause`: nowe ustalenie w bieżącej kategorii (tytuł domyślnie „Sugestia klienta”).
    private func addClause() {
        let content = newContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        drafts.append(ClauseDraft(newIn: category, title: title.isEmpty ? "Sugestia klienta" : title, text: content))
        newTitle = "Sugestia klienta"
        newContent = ""
        showAddForm = false
    }

    // MARK: Silnik

    /// Wczytanie klauzul; niezapisane zmiany z okna zostają (po zastosowaniu wyborów albo ponownym wczytaniu).
    private func load() async {
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .clauses, canViewAmounts: canViewAmounts, hosts: hosts,
                                                       extra: ["isAdmin": .bool(isAdmin)])
            guard let next = result.clauses else { throw NativeFailure(status: 0, message: Self.outdated, fieldErrors: [:]) }
            apply(next)
            loadError = nil
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func apply(_ next: EventContractClausesData) {
        let previous = Dictionary(uniqueKeysWithValues: drafts.map { ($0.id, $0) })
        let added = drafts.filter(\.added)
        var merged: [ClauseDraft] = []
        for item in next.items where !removedIDs.contains(item.id) {
            var draft = ClauseDraft(item)
            if let old = previous[item.id], old.change != nil {
                draft.enabled = old.enabled
                draft.text = old.text
                draft.restored = old.restored
            }
            merged.append(draft)
        }
        removedIDs = removedIDs.filter { id in next.items.contains { $0.id == id } }
        drafts = merged + added
        if data == nil {
            category = next.categories.first { item in next.items.contains { $0.category == item.value } }?.value ?? "obligations"
        }
        selections = next.selections
        data = next
    }

    private func clauseChanges() -> [String: JSONValue] {
        var items: [JSONValue] = drafts.compactMap { $0.change.map { JSONValue.object($0) } }
        items += removedIDs.sorted().map { .object(["id": .string($0), "remove": .bool(true)]) }
        let added: [JSONValue] = drafts.filter(\.added).map {
            .object(["category": .string($0.category), "title": .string($0.title), "text": .string($0.text)])
        }
        return ["items": .array(items), "added": .array(added)]
    }

    /// „Zapisz klauzule umowy” (`handleSaveEventContractClauses`).
    private func save() async {
        guard hasChanges else {
            dismiss()
            return
        }
        guard canViewAmounts else {
            problem = EventContractNative.amountsRequired
            return
        }
        working = "Zapisywanie klauzul umowy…"
        problem = nil
        defer { working = nil }
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .saveClauses, canViewAmounts: canViewAmounts, hosts: hosts,
                                                       extra: ["isAdmin": .bool(isAdmin), "clauses": .object(clauseChanges())])
            // Starszy silnik w CRM nie zna zapisu klauzul — nie zgłaszamy sukcesu.
            guard result.clauses != nil else { throw NativeFailure(status: 0, message: Self.outdated, fieldErrors: [:]) }
            await saved()
            state.succeed("Klauzule tej umowy zostały zapisane")
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// „Zastosuj wybory do umowy” (`handleApplyProductClauseSelections`).
    private func applySelections() async {
        guard canViewAmounts else {
            problem = EventContractNative.amountsRequired
            return
        }
        working = "Aktualizowanie…"
        problem = nil
        defer { working = nil }
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .applySelections, canViewAmounts: canViewAmounts, hosts: hosts,
                                                       extra: ["isAdmin": .bool(isAdmin), "selections": .object(selections.mapValues { JSONValue.string($0) })])
            guard let next = result.clauses else { throw NativeFailure(status: 0, message: Self.outdated, fieldErrors: [:]) }
            apply(next)
            await saved()
            state.succeed(result.created ? "Wybory klauzul zostały zastosowane — przygotowano szkic umowy" : "Wybory klauzul zostały zastosowane do umowy")
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: Zmiana szablonu umowy

@MainActor struct EventContractTemplateSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: ContractTabData
    let canViewAmounts: Bool
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var selection = ""
    @State private var working = false
    @State private var problem: String?

    private var templates: [ContractTabData.Template] { data.templates ?? [] }
    private var selectedName: String { templates.first { $0.id == selection }?.name ?? "" }
    /// Nowy szkic zamiast zmiany bieżącego (`contractId && (status != draft || PDF || blokada)`).
    private var createsRevision: Bool {
        guard let contract = data.contract else { return false }
        return contract.status != "draft" || contract.pdf != nil || contract.lockedAt != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Zmień szablon umowy").font(.title2.bold())
            Picker("Szablon umowy", selection: $selection) {
                ForEach(templates) { Text($0.name).tag($0.id) }
            }
            if !selection.isEmpty && selection != data.templateId {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Wybrany szablon: ") + Text(selectedName).bold()
                    Text(createsRevision
                         ? "Przygotujemy nowy szkic z wybranego szablonu. Dotychczasowa umowa i jej PDF pozostaną w historii. Nową wersję możesz sprawdzić przed wysłaniem klientowi."
                         : "Treść szkicu zostanie przygotowana z wybranego szablonu i danych eventu. Indywidualne zmiany treści i zmiennych trzeba będzie wprowadzić ponownie.")
                    Text("Zmiana szablonu nie wysyła wiadomości do klienta.")
                }
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Obecny szablon: \(data.templateName ?? "—"). Wybierz inny szablon z listy.").font(.callout).foregroundStyle(.secondary)
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(working)
                Button("Zmień szablon") { Task { await change() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(working || selection.isEmpty || selection == data.templateId)
            }
        }
        .padding(20)
        .frame(width: 520)
        .onAppear { if selection.isEmpty { selection = data.templateId ?? templates.first?.id ?? "" } }
        .interactiveDismissDisabled(working)
    }

    /// `handleTemplateChange`: zapis wyboru na serwerze, potem treść z nowego szablonu w silniku (`fetchContractData(…, true, id)`).
    private func change() async {
        guard canViewAmounts else {
            problem = EventContractNative.amountsRequired
            return
        }
        working = true
        problem = nil
        defer { working = false }
        struct Reply: Decodable { var templateId: String; var createdRevision: Bool }
        var payload: [String: JSONValue] = ["templateId": .string(selection)]
        if let contract = data.contract { payload["contractId"] = .string(contract.id) }
        let reply: Reply
        do {
            let raw = try await store.tabAction(eventID, "contract", "template", payload, reload: [], success: nil, pending: "Zmiana szablonu umowy…")
            reply = try JSONDecoder().decode(Reply.self, from: raw)
        } catch {
            problem = store.failureText(error, "Błąd podczas zmiany szablonu")
            return
        }
        do {
            _ = try await state.withPending("Składanie umowy z wybranego szablonu…") {
                try await state.eventContract(eventID: eventID, mode: .refresh, canViewAmounts: canViewAmounts, hosts: data.engineHosts ?? [],
                                              extra: ["templateId": .string(reply.templateId)])
            }
            await saved()
            state.succeed(reply.createdRevision ? "Utworzono nowy szkic umowy z wybranego szablonu" : "Zmieniono szablon umowy")
        } catch {
            await saved()
            let reason = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            state.error = "Szablon umowy został zmieniony, ale nie udało się złożyć treści (\(reason)). Użyj „Odśwież szablon i dane”."
        }
        dismiss()
    }
}
