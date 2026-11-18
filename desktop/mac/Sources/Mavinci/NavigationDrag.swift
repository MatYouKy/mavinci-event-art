import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Przeciąganie pozycji paska bocznego do kart
//
// Pozycję paska bocznego z ekranem natywnym (np. Wiadomości, Kontakty) można chwycić i przeciągnąć w stronę kart. Pasek kart
// macOS nie przyjmuje upuszczania z aplikacji, więc na czas przeciągania pod paskiem kart każdego okna pojawia się pasek z dwoma
// polami: „Nowa karta” (karta tego okna — jak „Otwórz w nowej karcie”) i „Nowe okno”. Upuszczenie poza polami niczego nie
// otwiera; pasek znika po puszczeniu przycisku myszy (także po upuszczeniu poza aplikacją albo przerwaniu klawiszem Esc).

extension Workspace {
    /// Początek przeciągania pozycji `href`: pokazuje pola upuszczania do puszczenia przycisku myszy.
    func beginNavDrag(_ href: String) -> NSItemProvider {
        navDrag = href
        Task { @MainActor [weak self] in
            // Przycisk myszy jest wciśnięty przez cały czas przeciągania — jego puszczenie kończy przeciąganie.
            do { try await Task.sleep(nanoseconds: 250_000_000) } catch { return }
            while NSEvent.pressedMouseButtons & 1 != 0 {
                do { try await Task.sleep(nanoseconds: 120_000_000) } catch { return }
            }
            guard let self, self.navDrag == href else { return }
            self.navDrag = nil
        }
        return NSItemProvider(object: (NavDrag.prefix + href) as NSString)
    }
}

enum NavDrag {
    /// Tekst przeciąganej pozycji (gdyby trafił poza aplikację — czytelny adres sekcji).
    static let prefix = "mavinci-nav:"
    static let types: [UTType] = [.utf8PlainText, .plainText, .text]
}

/// Źródło przeciągania pozycji paska bocznego — tylko pozycje z ekranem natywnym (`href`), pozostałe bez zmian.
@MainActor struct NavDragSource: ViewModifier {
    let workspace: Workspace
    let href: String?
    @ViewBuilder func body(content: Content) -> some View {
        if let href {
            content.onDrag { workspace.beginNavDrag(href) }
        } else {
            content
        }
    }
}

/// Pola upuszczania pod paskiem kart podczas przeciągania pozycji paska bocznego.
@MainActor struct NavDropStrip: View {
    @EnvironmentObject private var state: Workspace
    /// Okno tego widoku — nowa karta dołącza do niego.
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.openWindow) private var openWindow
    @State private var tabTargeted = false
    @State private var windowTargeted = false

    private var title: String {
        guard let href = state.navDrag else { return "" }
        return state.navigation.flatMap(\.flattened).first(where: { $0.href == href })?.name ?? "Sekcja"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Upuść „\(title)”, aby otworzyć w:").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                zone("Nowej karcie", symbol: "plus.square.on.square", targeted: $tabTargeted, asTab: true)
                zone("Nowym oknie", symbol: "macwindow.badge.plus", targeted: $windowTargeted, asTab: false)
            }
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
        .padding(.horizontal, 16).padding(.top, 8)
    }

    private func zone(_ label: String, symbol: String, targeted: Binding<Bool>, asTab: Bool) -> some View {
        let accent = state.theme.accent
        let active = targeted.wrappedValue
        return Label(label, systemImage: symbol)
            .font(.callout.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(active ? Color.white : accent)
            .background(active ? accent : accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(accent.opacity(active ? 1 : 0.6), style: StrokeStyle(lineWidth: 1.5, dash: active ? [] : [5, 4])))
            .contentShape(Rectangle())
            .onDrop(of: NavDrag.types, isTargeted: targeted) { _ in
                // Przeciągana pozycja tej aplikacji (inne teksty — np. z pola tekstowego — nie otwierają niczego).
                guard let href = state.navDrag else { return false }
                state.navDrag = nil
                state.openInWindow(.href(href), asTab: asTab, from: nav, using: openWindow)
                return true
            }
    }
}
