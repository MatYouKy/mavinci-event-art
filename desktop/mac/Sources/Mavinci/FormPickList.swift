import SwiftUI

// MARK: Lekkie elementy formularzy w arkuszach (nowy event, spotkanie, zadanie, klient eventu)
//
// Gdy treść dużego arkusza czyta wpisywany tekst (filtr listy wyboru, podpowiedź w pustym polu, `.task(id:)` wyszukiwania,
// warunek przycisku zapisu), SwiftUI po każdej literze przelicza cały arkusz — wszystkie pola, listy, wybory dat i menu —
// i litery pojawiają się z opóźnieniem. Elementy poniżej czytają tekst same (przez `Binding`), więc po literze przeliczają
// się tylko one. Listy wyboru nie przewijają się wewnątrz przewijanego formularza: zagnieżdżona przewijana lista przejmowała
// przewijanie, gdy kursor znalazł się nad nią (formularz „stawał”) — pokazują pierwsze wyniki i „Pokaż więcej”.

/// Wiersze listy wyboru (wyniki już przefiltrowane): pierwsze `pageSize` i „Pokaż więcej”, bez własnego przewijania.
struct FormPickRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    let empty: String
    let pageSize: Int
    /// Zmiana (np. zapytania) wraca do pierwszych wyników.
    let resetKey: String
    /// Tło i odstęp wokół listy (lista w polu formularza); bez — wiersze wprost w formularzu.
    let framed: Bool
    let row: (Item) -> Row
    @State private var extra = 0

    init(items: [Item], empty: String, pageSize: Int = 8, resetKey: String = "", framed: Bool = true,
         @ViewBuilder row: @escaping (Item) -> Row) {
        self.items = items
        self.empty = empty
        self.pageSize = pageSize
        self.resetKey = resetKey
        self.framed = framed
        self.row = row
    }

    var body: some View {
        let shown = min(items.count, pageSize + extra)
        VStack(alignment: .leading, spacing: 2) {
            if items.isEmpty {
                Text(empty).font(.callout).foregroundStyle(.secondary).padding(8)
            } else {
                ForEach(items.prefix(shown)) { item in
                    row(item)
                }
                if items.count > shown {
                    Button("Pokaż więcej (\(items.count - shown))", systemImage: "chevron.down") { extra += 20 }
                        .buttonStyle(.link).font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                }
            }
        }
        .padding(framed ? 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(framed ? Color.primary.opacity(0.03) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        .onChange(of: resetKey) { _, _ in extra = 0 }
    }
}

/// Lista wyboru pod polem wyszukiwania: zapytanie przychodzi jako `Binding` (pole zostaje w formularzu) — arkusz go nie czyta,
/// więc po każdej literze filtruje się i przelicza tylko ta lista. Dopasowanie bez rozróżniania wielkości liter i znaków
/// diakrytycznych (`localizedStandardContains`, jak wyszukiwanie w Finderze).
struct FormPickList<Item: Identifiable, Row: View>: View {
    @Binding var query: String
    let items: [Item]
    let searchText: (Item) -> String
    let empty: String
    let pageSize: Int
    let framed: Bool
    let row: (Item) -> Row

    init(query: Binding<String>, items: [Item], searchText: @escaping (Item) -> String, empty: String, pageSize: Int = 8,
         framed: Bool = true, @ViewBuilder row: @escaping (Item) -> Row) {
        _query = query
        self.items = items
        self.searchText = searchText
        self.empty = empty
        self.pageSize = pageSize
        self.framed = framed
        self.row = row
    }

    var body: some View {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = needle.isEmpty ? items : items.filter { searchText($0).localizedStandardContains(needle) }
        FormPickRows(items: matches, empty: empty, pageSize: pageSize, resetKey: needle, framed: framed, row: row)
    }
}

/// Pole opisu z podpowiedzią w pustym polu — pustość sprawdza samo, więc pisanie nie przelicza całego arkusza.
struct PlaceholderTextEditor: View {
    @Binding var text: String
    let placeholder: String
    var minHeight: CGFloat = 90

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text).font(.body).frame(minHeight: minHeight)
            if text.isEmpty {
                Text(placeholder).foregroundStyle(.tertiary).padding(.horizontal, 5).padding(.vertical, 1).allowsHitTesting(false)
            }
        }
        .padding(4).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
    }
}
