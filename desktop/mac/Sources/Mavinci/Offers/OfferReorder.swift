import SwiftUI

// MARK: Przeciąganie kolejności (jak uchwyt `GripVertical` z `@hello-pangea/dnd` w CRM) — pozycje oferty i propozycje
// dodatkowe. Uchwyt przenosi identyfikator wiersza; upuszczenie na innym wierszu ustawia przeciągany wiersz w jego miejscu.

/// Uchwyt do przeciągania wiersza.
struct OfferDragHandle: View {
    let id: String
    let label: String

    var body: some View {
        Image(systemName: "line.3.horizontal")
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(width: 22, height: 28)
            .contentShape(Rectangle())
            .draggable(id) {
                Label(label, systemImage: "line.3.horizontal")
                    .font(.callout)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            }
            .help("Przeciągnij, aby zmienić kolejność")
    }
}

enum OfferReorder {
    /// Nowa kolejność po upuszczeniu `dragged` na wierszu `target` (w dół — za nim, w górę — przed nim); `nil` — bez zmian.
    static func order(_ ids: [String], moving dragged: String, onto target: String) -> [String]? {
        guard let from = ids.firstIndex(of: dragged), let to = ids.firstIndex(of: target), from != to else { return nil }
        var next = ids
        next.remove(at: from)
        next.insert(dragged, at: to)
        return next
    }
}

extension View {
    /// Wiersz jako miejsce upuszczenia z podświetleniem; `onDrop` zwraca, czy przeciągnięty wiersz należy do tej listy.
    func offerDropTarget(id: String, enabled: Bool, targeted: Binding<String?>, onDrop: @escaping (String) -> Bool) -> some View {
        self
            .overlay {
                if targeted.wrappedValue == id {
                    RoundedRectangle(cornerRadius: 9).stroke(Color.accentColor, lineWidth: 2)
                }
            }
            .dropDestination(for: String.self) { ids, _ in
                guard enabled, let dragged = ids.first, dragged != id else { return false }
                return onDrop(dragged)
            } isTargeted: { inside in
                if inside { targeted.wrappedValue = id } else if targeted.wrappedValue == id { targeted.wrappedValue = nil }
            }
    }
}
