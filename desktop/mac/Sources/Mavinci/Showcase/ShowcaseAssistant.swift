import SwiftUI

// MARK: Strefa sprzedawcy → „Prezentacje” → Asystent AI w edytorze karty — natywnie, 1:1 z CRM (`ShowcaseAssistant.tsx`)
//
// Z danych produktów karty (Oferty → Produkty) i opisu od sprzedawcy asystent proponuje hasło, wstęp, korzyści, kroki
// przygotowania, specyfikację i pytania klientów. Treść pisze serwer Next (`op=assist`, klucz OpenAI tylko na serwerze).
// Propozycje nie zapisują się same — sprzedawca zaznacza, co wstawić (do kopii roboczej karty), i zapisuje kartę.

enum ShowcaseAiField: String, CaseIterable, Identifiable, Hashable {
    case tagline, lead, benefits, steps, specs, faq
    var id: String { rawValue }

    /// Etykiety jak `SHOWCASE_AI_LABELS` w CRM.
    var label: String {
        switch self {
        case .tagline: return "Hasło"
        case .lead: return "Wstęp"
        case .benefits: return "Korzyści"
        case .steps: return "Jak przygotowujemy"
        case .specs: return "Specyfikacja"
        case .faq: return "Pytania klientów"
        }
    }
}

/// Propozycje asystenta (tylko wybrane pola).
struct ShowcaseAiSuggestion: Decodable, Equatable {
    var tagline: String?
    var lead: String?
    var benefits: [ShowcasePoint]?
    var steps: [ShowcasePoint]?
    var specs: [ShowcasePoint]?
    var faq: [ShowcasePoint]?
    var model: String?

    func text(_ field: ShowcaseAiField) -> String? {
        switch field {
        case .tagline: return tagline
        case .lead: return lead
        default: return nil
        }
    }

    func points(_ field: ShowcaseAiField) -> [ShowcasePoint] {
        switch field {
        case .benefits: return benefits ?? []
        case .steps: return steps ?? []
        case .specs: return specs ?? []
        case .faq: return faq ?? []
        default: return []
        }
    }

    func isEmpty(_ field: ShowcaseAiField) -> Bool {
        switch field {
        case .tagline, .lead: return (text(field) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return points(field).isEmpty
        }
    }
}

extension ShowcaseDraft {
    /// Wstawienie propozycji (jak `applyShowcaseAiSuggestion` w CRM): hasło i wstęp zastępują obecne, wiersze trafiają do
    /// pierwszego bloku danego rodzaju (pusty — wypełniony, z treścią — zastąpiony), brakujący blok powstaje na końcu karty.
    mutating func apply(_ suggestion: ShowcaseAiSuggestion, fields: [ShowcaseAiField]) {
        let clean: (String, Int) -> String = { value, limit in String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit)) }
        if fields.contains(.tagline), let value = suggestion.tagline, !clean(value, ShowcaseLimits.tagline).isEmpty {
            tagline = clean(value, ShowcaseLimits.tagline)
        }
        if fields.contains(.lead), let value = suggestion.lead, !clean(value, ShowcaseLimits.lead).isEmpty {
            content.lead = clean(value, ShowcaseLimits.lead)
        }
        func place(_ kind: ShowcaseBlockKind, _ style: String, _ field: ShowcaseAiField) {
            guard fields.contains(field) else { return }
            let rows = suggestion.points(field)
                .map { ShowcaseRow(title: clean($0.title, ShowcaseLimits.rowTitle), text: clean($0.text, ShowcaseLimits.rowText)) }
                .filter { !$0.title.isEmpty || !$0.text.isEmpty }
                .prefix(ShowcaseLimits.rows)
            guard !rows.isEmpty else { return }
            if let index = content.blocks.firstIndex(where: { $0.kind == kind && (kind != .points || $0.style == style) }) {
                content.blocks[index].rows = Array(rows)
            } else if content.blocks.count < ShowcaseLimits.blocks {
                var block = ShowcaseBlock(kind: kind, style: style.isEmpty ? nil : style)
                block.rows = Array(rows)
                content.blocks.append(block)
            }
        }
        place(.points, "benefits", .benefits)
        place(.points, "steps", .steps)
        place(.specs, "", .specs)
        place(.faq, "", .faq)
    }
}

@MainActor struct ShowcaseAssistantSheet: View {
    @ObservedObject var store: ShowcaseStore
    let draft: ShowcaseDraft
    let onApply: (ShowcaseAiSuggestion, [ShowcaseAiField]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var fields: [ShowcaseAiField]
    @State private var brief = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var suggestion: ShowcaseAiSuggestion?
    @State private var chosen: [ShowcaseAiField] = []

    init(store: ShowcaseStore, draft: ShowcaseDraft, onApply: @escaping (ShowcaseAiSuggestion, [ShowcaseAiField]) -> Void) {
        self.store = store
        self.draft = draft
        self.onApply = onApply
        // Domyślnie: hasło tylko gdy puste, wstęp gdy krótszy niż 25 znaków, reszta zawsze (jak w CRM).
        _fields = State(initialValue: ShowcaseAiField.allCases.filter { field in
            switch field {
            case .tagline: return draft.tagline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case .lead: return draft.content.lead.trimmingCharacters(in: .whitespacesAndNewlines).count < 25
            default: return true
            }
        })
    }

    private var hasProducts: Bool { !draft.productIDs.isEmpty || draft.content.blocks.contains { $0.productId != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Asystent AI", systemImage: "wand.and.stars").font(.title3.weight(.semibold))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let suggestion { results(suggestion) } else { request }
        }
        .padding(20)
        .frame(width: 640, height: 600)
    }

    private var request: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Asystent pisze z danych produktów karty (Oferty → Produkty) i Twojego opisu. Nie wymyśla cen ani wymiarów — propozycje sprawdzasz i wstawiasz sam.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !hasProducts {
                Label("Karta nie ma produktów z katalogu — dodaj produkt albo opisz poniżej, co pokazujesz.", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.orange)
            }
            HStack(spacing: 8) {
                ForEach(ShowcaseAiField.allCases) { field in
                    let on = fields.contains(field)
                    Button { toggle(&fields, field) } label: {
                        Text(field.label).padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Capsule().fill(on ? theme.accent.opacity(0.18) : Color.clear))
                            .overlay(Capsule().stroke(on ? theme.accent : Color.secondary.opacity(0.35)))
                            .foregroundStyle(on ? theme.accent : Color.primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("Co podkreślić? (opcjonalnie)").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: Binding(get: { brief }, set: { brief = String($0.prefix(2000)) }))
                .font(.body).frame(minHeight: 90, maxHeight: 140)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            Text("np. klienci to pary młode, ważne: bezpieczeństwo w sali i zdjęcia z pierwszego tańca").font(.caption).foregroundStyle(.tertiary)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            Spacer(minLength: 0)
            Divider()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }
                Button { Task { await ask() } } label: {
                    if busy { ProgressView().controlSize(.small) } else { Image(systemName: "wand.and.stars") }
                    Text(busy ? "Asystent pisze…" : "Zaproponuj treść")
                }
                .buttonStyle(.borderedProminent).disabled(busy || fields.isEmpty)
            }
        }
    }

    private func results(_ suggestion: ShowcaseAiSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Zaznacz, co wstawić. Hasło i wstęp zastąpią obecne, wiersze trafią do bloków karty (brakujący blok powstanie na końcu).")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(fields) { field in
                        let empty = suggestion.isEmpty(field)
                        HStack(alignment: .top, spacing: 10) {
                            Toggle("", isOn: Binding(get: { chosen.contains(field) }, set: { _ in toggle(&chosen, field) }))
                                .toggleStyle(.checkbox).labelsHidden().disabled(empty)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(field.label).font(.callout.weight(.semibold)).foregroundStyle(theme.accent)
                                if empty {
                                    Text("Brak danych — asystent niczego nie zaproponował.").font(.callout).foregroundStyle(.secondary)
                                } else if let text = suggestion.text(field) {
                                    Text(verbatim: text).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                } else {
                                    ForEach(Array(suggestion.points(field).enumerated()), id: \.offset) { _, point in
                                        Text(verbatim: point.text.isEmpty ? "• \(point.title)" : "• \(point.title) — \(point.text)")
                                            .font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                        .opacity(empty ? 0.55 : 1)
                    }
                }
            }
            Divider()
            HStack {
                Spacer()
                Button("Popraw prośbę") { self.suggestion = nil }
                Button("Wstaw zaznaczone (\(chosen.count))") { onApply(suggestion, chosen) }
                    .buttonStyle(.borderedProminent).disabled(chosen.isEmpty)
            }
        }
    }

    private func toggle(_ list: inout [ShowcaseAiField], _ field: ShowcaseAiField) {
        if let index = list.firstIndex(of: field) { list.remove(at: index) } else { list.append(field) }
    }

    private func ask() async {
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let result = try await store.assist(draft: draft, brief: brief, fields: fields)
            suggestion = result
            chosen = fields.filter { !result.isEmpty($0) }
        } catch {
            problem = store.failureText(error, "Asystent AI nie odpowiedział.")
        }
    }
}
