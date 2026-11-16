import SwiftUI

// MARK: Umowa wydarzenia — edycja treści (jak edytor umowy wydarzenia w CRM `edit-wysiwyg?contractId=…`), audyt AI
// z przeglądem decyzji (`ContractAuditReviewModal`, wspólny dla umowy i klauzul) oraz „Anuluj umowę” z hasłem administratora
// (`CancelContractModal`). Treść i audyt składa i zapisuje silnik dokumentów tym samym kodem co CRM
// (`/native-engine/contracts`: `content`, `saveContent`, `audit`, `applyAudit`, `auditClauses`); anulowanie — serwer
// (`cancel` w `src/lib/native/eventContract.ts`, jak `/bridge/events/contracts/cancel`).

// MARK: Edycja treści

@MainActor struct EventContractContentSheet: View {
    let eventID: String
    let canViewAmounts: Bool
    let hosts: [String]
    let isAdmin: Bool
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var data: EventContractContentData?
    @State private var editor: ContractHTMLEditorController?
    @State private var loadError: String?
    @State private var saving = false
    @State private var problem: String?
    @State private var confirmingDiscard = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Treść umowy").font(.title2.bold())
                    Text("Edytujesz jeden ciągły dokument, dzięki czemu możesz swobodnie zaznaczać treść. Dokładny podział na strony, nagłówki, stopki i numerację stron zobaczysz w podglądzie oraz PDF.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
            .padding([.horizontal, .top], 18).padding(.bottom, 10)
            if let editor {
                ContractHTMLEditorToolbar(controller: editor)
                    .padding(.horizontal, 18).padding(.bottom, 10)
                Divider()
                ContractHTMLEditorView(controller: editor)
            } else if let loadError {
                Divider()
                ContentUnavailableView {
                    Label("Nie można edytować umowy", systemImage: "doc.text")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Divider()
                ProgressView("Składanie umowy z aktualnych danych…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let editor {
                ContentEditorFooter(editor: editor, saving: saving, problem: problem,
                                    cancel: { if editor.dirty { confirmingDiscard = true } else { dismiss() } },
                                    save: { Task { await save() } })
            } else {
                HStack {
                    Spacer()
                    Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
                }
                .padding(14).crmBar()
            }
        }
        .frame(minWidth: 980, idealWidth: 1040, minHeight: 760, idealHeight: 900)
        .task { await load() }
        .interactiveDismissDisabled(saving || editor != nil)
        .overlay { if saving { PendingOverlay(text: "Zapisywanie treści umowy…") } }
        .confirmationDialog("Odrzucić zmiany w treści umowy?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Odrzuć zmiany", role: .destructive) { dismiss() }
            Button("Wróć do edycji", role: .cancel) {}
        } message: { Text("Niezapisane zmiany treści zostaną utracone.") }
    }

    private func load() async {
        loadError = nil
        do {
            let result = try await state.eventContract(eventID: eventID, mode: .content, canViewAmounts: canViewAmounts, hosts: hosts,
                                                       extra: ["isAdmin": .bool(isAdmin)])
            guard let content = result.content else {
                throw NativeFailure(status: 0, message: "Serwer CRM nie obsługuje jeszcze edycji treści na Macu — zaktualizuj CRM.", fieldErrors: [:])
            }
            data = content
            editor = ContractHTMLEditorController(mode: .document, html: content.flowContent, css: content.cssText,
                                                  font: content.font, lineHeight: content.lineHeight)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// „Zapisz” jak w edytorze CRM: struktura list i paragrafów, podział na strony, treść indywidualna umowy.
    private func save() async {
        guard let editor, let data else { return }
        guard editor.dirty else {
            dismiss()
            return
        }
        saving = true
        problem = nil
        defer { saving = false }
        do {
            let html = try await editor.currentHTML()
            let result = try await state.eventContract(eventID: eventID, mode: .saveContent, canViewAmounts: canViewAmounts, hosts: hosts,
                                                       extra: ["isAdmin": .bool(isAdmin),
                                                               "content": .object(["flowContent": .string(html), "stamp": .string(data.stamp)])])
            // Starszy silnik w CRM nie zna zapisu treści — bez potwierdzenia nie zgłaszamy sukcesu.
            guard result.saved == true else {
                throw NativeFailure(status: 0, message: "Serwer CRM nie obsługuje jeszcze edycji treści na Macu — zaktualizuj CRM.", fieldErrors: [:])
            }
            await saved()
            state.succeed("Indywidualna treść umowy została zapisana")
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

/// Stopka edytora treści — obserwuje gotowość i zmiany w edytorze.
private struct ContentEditorFooter: View {
    @ObservedObject var editor: ContractHTMLEditorController
    let saving: Bool
    let problem: String?
    let cancel: () -> Void
    let save: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let problem {
                Text(problem).font(.callout).foregroundStyle(.orange).lineLimit(3)
            } else {
                Text("Po zapisie treść staje się indywidualna dla tej umowy — „Odśwież szablon i dane” zastąpi ją treścią z szablonu. Wklejony tekst trafia bez formatowania.")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            Button("Anuluj", action: cancel).keyboardShortcut(.cancelAction).disabled(saving)
            Button(saving ? "Zapisywanie…" : (editor.dirty ? "Zapisz treść umowy" : "Zamknij"), action: save)
                .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command)
                .disabled(saving || !editor.ready)
        }
        .padding(14).crmBar()
    }
}

// MARK: Przegląd audytu AI (umowa i klauzule)

/// Dane okna przeglądu: wynik audytu, fragmenty do cytatów i zapis decyzji.
struct ContractAuditReview: Identifiable {
    let id = UUID()
    let result: ContractAuditResult
    let blocks: [ContractAuditBlock]
    /// Zastosowanie decyzji (`issue.id → option.id`); `nil` — gotowe (okno się zamyka), inaczej komunikat błędu w oknie.
    let apply: @MainActor ([String: String]) async -> String?
}

@MainActor struct ContractAuditReviewSheet: View {
    let review: ContractAuditReview
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var selections: [String: String] = [:]
    @State private var applying = false
    @State private var problem: String?

    private static let keepOriginal = ContractAuditResult.Option(
        id: "__keep_original__", label: "Pozostaw bez zmian", explanation: "Zachowaj obecną treść i rozstrzygnij temat później.")

    private var decisionIssues: [ContractAuditResult.Issue] { review.result.issues.filter { !$0.options.isEmpty } }
    private var allDecisionsMade: Bool { decisionIssues.allSatisfy { selections[$0.id] != nil } }
    private var hasChanges: Bool { !review.result.duplicates.isEmpty || !decisionIssues.isEmpty }

    private func excerpt(_ id: String) -> String {
        let text = review.blocks.first { $0.id == id }?.text ?? ""
        return text.count > 260 ? String(text.prefix(257)) + "…" : text
    }

    private func severityColor(_ severity: String) -> Color {
        switch severity {
        case "error": return .red
        case "warning": return .orange
        default: return .blue
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkles").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Przegląd audytu AI").font(.title2.bold())
                    if !review.result.summary.isEmpty {
                        Text(review.result.summary).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
            }
            .padding(18)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.shield").foregroundStyle(.green)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Bezpieczny zakres zmian").font(.callout.weight(.semibold))
                            Text("Dane stron, reprezentantów, kontakty, identyfikatory i podpisy zostały wyłączone z analizy. Asystent nie zmienia samodzielnie kwot, terminów, zakresu ani odpowiedzialności. Audyt wspiera redakcję draftu i nie zastępuje weryfikacji prawnej.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(12)
                    .background(Color.green.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    duplicatesSection
                    issuesSection
                }
                .padding(18)
            }
            HStack {
                if let problem {
                    Text(problem).font(.callout).foregroundStyle(.orange).lineLimit(3)
                } else {
                    Text(decisionIssues.isEmpty ? "Audyt nie wymaga dodatkowych decyzji." : "Wybrano \(selections.count) z \(decisionIssues.count) decyzji.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(applying)
                Button(hasChanges ? (applying ? "Zapisywanie…" : "Zastosuj audyt") : "Zamknij") {
                    if hasChanges { Task { await apply() } } else { dismiss() }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(applying || (hasChanges && !allDecisionsMade))
            }
            .padding(14).crmBar()
        }
        .frame(minWidth: 820, idealWidth: 900, minHeight: 640, idealHeight: 780)
        .interactiveDismissDisabled(applying)
    }

    private func countBadge(_ count: Int, _ color: Color) -> some View {
        Text("\(count)").font(.caption.weight(.semibold)).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
    }

    private var duplicatesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Duplikaty do usunięcia").font(.headline)
                    Text("Te powtórzenia zostaną usunięte automatycznie po zatwierdzeniu audytu.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                countBadge(review.result.duplicates.count, .green)
            }
            if review.result.duplicates.isEmpty {
                Text("Nie znaleziono pewnych duplikatów.").font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
            }
            ForEach(review.result.duplicates) { duplicate in
                VStack(alignment: .leading, spacing: 8) {
                    Label(duplicate.reason, systemImage: "checkmark.circle").font(.callout.weight(.medium)).foregroundStyle(.green)
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Pozostaje").font(.caption.weight(.semibold)).foregroundStyle(.green)
                            Text(excerpt(duplicate.keepBlockId)).font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading).padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Usuwane").font(.caption.weight(.semibold)).foregroundStyle(.red)
                            Text(duplicate.removeBlockIds.map(excerpt).filter { !$0.isEmpty }.joined(separator: " / "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading).padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(12)
                .background(Color.green.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var issuesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kwestie do decyzji").font(.headline)
                    Text("Wybierz wariant w każdym spornym punkcie. Zawsze możesz pozostawić oryginał.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                countBadge(review.result.issues.count, .orange)
            }
            if review.result.issues.isEmpty {
                Text("Nie znaleziono kwestii wymagających decyzji.").font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
            }
            ForEach(review.result.issues) { issue in issueCard(issue) }
        }
    }

    private func issueCard(_ issue: ContractAuditResult.Issue) -> some View {
        let color = severityColor(issue.severity)
        let options: [ContractAuditResult.Option] = issue.options.isEmpty ? [] : issue.options + [Self.keepOriginal]
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(issue.title).font(.callout.weight(.semibold))
                    Text(issue.description).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if !issue.relatedBlockIds.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(issue.relatedBlockIds, id: \.self) { id in
                        Text("„\(excerpt(id))”").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            ForEach(options) { option in
                let selected = selections[issue.id] == option.id
                Button { selections[issue.id] = option.id } label: {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle").foregroundStyle(selected ? theme.accent : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(option.label).font(.callout.weight(.medium))
                                if issue.recommendedOptionId == option.id {
                                    Text("REKOMENDOWANE").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent)
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                                }
                            }
                            if !option.explanation.isEmpty {
                                Text(option.explanation).font(.caption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .background(selected ? theme.accent.opacity(0.12) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(color.opacity(0.3)))
    }

    private func apply() async {
        applying = true
        problem = nil
        let failure = await review.apply(selections)
        applying = false
        if let failure { problem = failure } else { dismiss() }
    }
}

// MARK: Anulowanie umowy

@MainActor struct EventContractCancelSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let contractID: String
    let status: String
    let templateName: String?
    let cancelled: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var submitting = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Anuluj umowę").font(.title2.bold())
            VStack(alignment: .leading, spacing: 8) {
                if let templateName, !templateName.isEmpty { Text("Szablon: ") + Text(templateName).bold() }
                Text("Umowa otrzyma status „Anulowana”. Treść, zapisane pliki PDF i historia pozostaną w systemie. Anulowanej umowy nie będzie można wysłać jako aktualnej.")
                Text("Potwierdź operację hasłem do swojego aktualnie zalogowanego konta administratora. Ta czynność zmienia status w CRM — nie wysyła powiadomienia do klienta.")
            }
            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Hasło administratora").font(.callout)
                SecureField("Hasło administratora", text: $password)
                    .textContentType(.password)
                    .labelsHidden()
                    .disabled(submitting)
                    .onSubmit { Task { await submit() } }
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Zachowaj umowę") { password = ""; dismiss() }.keyboardShortcut(.cancelAction).disabled(submitting)
                Button(submitting ? "Weryfikowanie…" : "Potwierdź anulowanie", role: .destructive) { Task { await submit() } }
                    .buttonStyle(.borderedProminent).tint(.red)
                    .disabled(password.isEmpty || submitting)
            }
        }
        .padding(20)
        .frame(width: 520)
        .interactiveDismissDisabled(submitting)
        .onDisappear { password = "" }
    }

    /// `POST /bridge/events/contracts/cancel` na Macu: hasło trafia tylko do weryfikacji na serwerze i jest od razu czyszczone.
    private func submit() async {
        guard !password.isEmpty, !submitting else { return }
        let secret = password
        password = ""
        submitting = true
        problem = nil
        defer { submitting = false }
        do {
            try await store.tabAction(eventID, "contract", "cancel",
                                      ["contractId": .string(contractID), "expectedStatus": .string(status), "password": .string(secret)],
                                      reload: [], success: nil, pending: "Weryfikowanie…")
            await cancelled()
            state.succeed("Umowa została anulowana. Treść, PDF i historia zostały zachowane.")
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się anulować umowy. Spróbuj ponownie.")
        }
    }
}
