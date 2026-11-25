import SwiftUI

// MARK: Pole adresatów („Do:”, „DW:”, „UDW:”) z podpowiedziami jak w Thunderbirdzie — 1:1 z CRM (`RecipientInput.tsx`).
// Przy wpisywaniu imienia, nazwiska, fragmentu adresu albo nazwy firmy lista pod polem pokazuje kontakty, organizacje,
// pracowników i osoby z korespondencji (`GET /recipients` → funkcja bazy `email_recipient_suggestions`, uprawnienia
// pracownika — RLS) z powiązaniem: organizacja i liczba wiadomości. ↑ / ↓ — wybór, ↩ lub ⇥ — wstawienie adresu (z „, ” na
// następny), Esc — zamknięcie listy; kliknięcie w podpowiedź też ją wstawia. Gdy lista jest otwarta, okno wyłącza skróty ↩
// („Wyślij”) i Esc („Anuluj”) przez `openField` — ↩ nie wyśle wiadomości w trakcie wybierania adresu.

struct RecipientSuggestion: Decodable, Identifiable, Equatable {
    let email: String
    let name: String?
    let kind: String
    let organizationName: String?
    let sentCount: Int
    let receivedCount: Int
    let lastAt: String?

    var id: String { email }

    var kindLabel: String {
        switch kind {
        case "contact": return "Kontakt"
        case "organization": return "Organizacja"
        case "employee": return "Pracownik"
        default: return "Korespondencja"
        }
    }

    var symbol: String {
        switch kind {
        case "contact": return "person.crop.circle"
        case "organization": return "building.2"
        case "employee": return "person"
        default: return "clock.arrow.circlepath"
        }
    }

    /// „Omega Hotel · 3 wysłane, 1 odebrana · ostatnio 03.11.2026” — jak `recipientDetail` w CRM.
    var detail: String {
        var parts: [String] = []
        if let organizationName, !organizationName.isEmpty, kind != "organization" { parts.append(organizationName) }
        var mail: [String] = []
        if sentCount > 0 { mail.append("\(sentCount) \(Self.plural(sentCount, "wysłana", "wysłane", "wysłanych"))") }
        if receivedCount > 0 { mail.append("\(receivedCount) \(Self.plural(receivedCount, "odebrana", "odebrane", "odebranych"))") }
        if !mail.isEmpty { parts.append(mail.joined(separator: ", ")) }
        if let lastAt, let date = Self.parse(lastAt) {
            parts.append("ostatnio " + date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year()))
        }
        return parts.joined(separator: " · ")
    }

    private static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        let n = abs(count)
        if n == 1 { return one }
        return (2...4).contains(n % 10) && !(12...14).contains(n % 100) ? few : many
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

private struct RecipientReply: Decodable {
    let suggestions: [RecipientSuggestion]
}

/// Fragment adresu przy końcu pola i wstawienie wybranego adresu (te same reguły co `recipientSuggestions.ts`).
enum RecipientText {
    private static let separators = CharacterSet(charactersIn: ",;\n")

    /// Tekst po ostatnim przecinku / średniku — adres, który jest właśnie wpisywany.
    static func token(_ value: String) -> String {
        let tail = value.unicodeScalars.lastIndex { separators.contains($0) }.map { String(value.unicodeScalars[value.unicodeScalars.index(after: $0)...]) } ?? value
        return tail.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Zastępuje wpisywany fragment adresem i dodaje „, ” na następny; adres już wpisany nie jest dublowany.
    static func insert(_ value: String, email: String) -> String {
        let scalars = value.unicodeScalars
        let head: String
        if let cut = scalars.lastIndex(where: { separators.contains($0) }) {
            let before = String(scalars[..<cut]).trimmingCharacters(in: .whitespacesAndNewlines)
            head = before.isEmpty ? "" : before + ", "
        } else {
            head = ""
        }
        let address = email.lowercased()
        return emailAddresses(head).contains(address) ? head : head + address + ", "
    }

    /// Bez separatora po ostatnim adresie („a@b.pl, ” → „a@b.pl”).
    static func trimmed(_ value: String) -> String {
        var result = value
        while let last = result.unicodeScalars.last, separators.contains(last) || CharacterSet.whitespaces.contains(last) {
            result.unicodeScalars.removeLast()
        }
        return result
    }
}

/// Krótka pamięć podpowiedzi (ten sam fragment w kilku polach, cofnięta litera) — 2 minuty.
@MainActor final class RecipientSuggestionCache {
    static let shared = RecipientSuggestionCache()
    private var entries: [String: (at: Date, items: [RecipientSuggestion])] = [:]

    func items(_ query: String) -> [RecipientSuggestion]? {
        guard let entry = entries[query.lowercased()], Date().timeIntervalSince(entry.at) < 120 else { return nil }
        return entry.items
    }

    func store(_ query: String, _ items: [RecipientSuggestion]) {
        if entries.count > 200 { entries.removeAll() }
        entries[query.lowercased()] = (Date(), items)
    }
}

@MainActor struct RecipientField: View {
    let title: String
    @Binding var text: String
    let prompt: String
    /// Nazwa pola w oknie („to”, „cc”, „bcc”).
    let field: String
    /// Pole z otwartą listą podpowiedzi — okno wyłącza wtedy skróty ↩ i Esc.
    @Binding var openField: String?
    /// W `Form` (okna wysyłki oferty, umowy, kalkulacji, faktury, zapytania): etykieta po lewej jak w pozostałych polach;
    /// w siatce okna „Nowa wiadomość” etykieta jest osobną kolumną, a pole ma ramkę.
    let inForm: Bool
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.crmTheme) private var theme
    @FocusState private var focused: Bool
    @State private var suggestions: [RecipientSuggestion] = []
    @State private var selected = 0
    @State private var dismissed = false
    @State private var search: Task<Void, Never>?

    init(_ title: String, text: Binding<String>, prompt: String, field: String, openField: Binding<String?>, inForm: Bool = false) {
        self.title = title
        _text = text
        self.prompt = prompt
        self.field = field
        _openField = openField
        self.inForm = inForm
    }

    private var showing: Bool { focused && !dismissed && !suggestions.isEmpty }

    var body: some View {
        if inForm {
            LabeledContent { stack } label: { Text(title) }
        } else {
            stack
        }
    }

    @ViewBuilder private var input: some View {
        if inForm {
            TextField(title, text: $text, prompt: Text(prompt)).labelsHidden()
        } else {
            TextField(title, text: $text, prompt: Text(prompt)).textFieldStyle(.roundedBorder).labelsHidden()
        }
    }

    private var stack: some View {
        VStack(alignment: .leading, spacing: 4) {
            input
                .focused($focused)
                .onChange(of: text) { _, value in
                    dismissed = false
                    find(RecipientText.token(value))
                }
                .onChange(of: focused) { _, isFocused in
                    if !isFocused {
                        close()
                        let clean = RecipientText.trimmed(text)
                        if clean != text { text = clean }
                    }
                }
                .onChange(of: showing) { _, visible in
                    if visible { openField = field } else if openField == field { openField = nil }
                }
                .onKeyPress(.downArrow, phases: .down) { _ in move(1) }
                .onKeyPress(.upArrow, phases: .down) { _ in move(-1) }
                .onKeyPress(.return, phases: .down) { _ in accept() }
                .onKeyPress(.tab, phases: .down) { press in press.modifiers.contains(.shift) ? .ignored : accept() }
                .onKeyPress(.escape, phases: .down) { _ in
                    guard showing else { return .ignored }
                    dismissed = true
                    return .handled
                }
                .onDisappear {
                    search?.cancel()
                    if openField == field { openField = nil }
                }
            if showing { list }
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { entry in
                let suggestion = entry.element
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: suggestion.symbol).foregroundStyle(theme.accent).frame(width: 18)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(suggestion.name ?? suggestion.email).lineLimit(1)
                            if suggestion.name != nil {
                                Text("<\(suggestion.email)>").foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        let detail = suggestion.detail
                        if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    Spacer(minLength: 6)
                    Text(suggestion.kindLabel).font(.caption2).foregroundStyle(theme.accent)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .overlay(Capsule().stroke(theme.accent.opacity(0.35)))
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(entry.offset == selected ? theme.accent.opacity(0.16) : Color.clear)
                .contentShape(Rectangle())
                .onTapGesture { choose(suggestion) }
                .onHover { inside in if inside { selected = entry.offset } }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityAddTraits(entry.offset == selected ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 8).fill(theme.card))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.25)))
        .accessibilityLabel("Podpowiedzi adresatów")
    }

    private func move(_ step: Int) -> KeyPress.Result {
        guard showing else { return .ignored }
        selected = (selected + step + suggestions.count) % suggestions.count
        return .handled
    }

    private func accept() -> KeyPress.Result {
        guard showing, suggestions.indices.contains(selected) else { return .ignored }
        choose(suggestions[selected])
        return .handled
    }

    private func choose(_ suggestion: RecipientSuggestion) {
        search?.cancel()
        text = RecipientText.insert(text, email: suggestion.email)
        close()
        focused = true
    }

    private func close() {
        search?.cancel()
        suggestions = []
        selected = 0
    }

    /// Zapytanie po krótkiej przerwie w pisaniu (150 ms); wynik dla starszego fragmentu jest pomijany.
    private func find(_ query: String) {
        search?.cancel()
        guard focused, !query.isEmpty, query.count <= 100 else { suggestions = []; return }
        if let cached = RecipientSuggestionCache.shared.items(query) {
            suggestions = cached
            selected = 0
            return
        }
        guard let api = workspace.nativeAPI() else { suggestions = []; return }
        search = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            let data = try? await api.get("/recipients", query: ["q": query, "limit": "8"])
            let items = data.flatMap { try? JSONDecoder().decode(RecipientReply.self, from: $0) }?.suggestions ?? []
            guard !Task.isCancelled, RecipientText.token(text) == query else { return }
            RecipientSuggestionCache.shared.store(query, items)
            suggestions = items
            selected = 0
        }
    }
}
