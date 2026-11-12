import AppKit
import SwiftUI

// MARK: Kursor „łapka” nad linkami
//
// Konwencja macOS: zwykłe przyciski i paski narzędzi mają strzałkę, a łapka (pointing hand) pojawia się tylko nad elementami
// działającymi jak link — tekst prowadzący gdzie indziej („Edytuj”, nazwa klienta, „Otwórz w CRM”). `.buttonStyle(.link).linkCursor()`
// w aplikacji dostaje ją przez `.linkCursor()`.

struct LinkCursorModifier: ViewModifier {
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                if inside && enabled && !hovering {
                    NSCursor.pointingHand.push()
                    hovering = true
                } else if !inside && hovering {
                    NSCursor.pop()
                    hovering = false
                }
            }
            // Element znika pod kursorem (np. zamknięte okno) — przywrócenie strzałki.
            .onDisappear {
                if hovering {
                    NSCursor.pop()
                    hovering = false
                }
            }
    }
}

extension View {
    /// Łapka nad elementem działającym jak link.
    func linkCursor() -> some View { modifier(LinkCursorModifier()) }
}
