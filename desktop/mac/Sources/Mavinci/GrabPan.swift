import SwiftUI
import AppKit

// MARK: „Chwyć i przesuń” na osiach czasu (Spotkania, plan pracownika, oś zespołu, Flota, fazy eventu) — kursor otwartej dłoni
// nad tłem osi, przeciągnięcie przesuwa czas (zaciśnięta dłoń). Pozycje osi (spotkania, fazy, wydarzenia) zachowują własne
// przeciąganie i kliknięcia — chwyt działa na wolnym tle. `grabScroll` przewija najbliższy `NSScrollView` (osie z przewijaniem);
// oś zespołu (bez przewijania) przesuwa zakres czasu sama (`TeamTimelineView`) i używa tylko kursora (`GrabCursor`).

/// Kursor dłoni: otwarta nad obszarem, zaciśnięta w trakcie przeciągania (wywołujący ustawia `grabbing`). Zdejmuje swoje kursory
/// przy zniknięciu widoku, żeby nie zostawić dłoni w innych miejscach okna.
struct GrabCursor: ViewModifier {
    let grabbing: Bool
    @State private var hovering = false
    @State private var pushed = 0

    func body(content: Content) -> some View {
        content
            .onHover { inside in hovering = inside; refresh() }
            .onChange(of: grabbing) { _, _ in refresh() }
            .onDisappear { clear() }
    }

    private func clear() {
        while pushed > 0 { NSCursor.pop(); pushed -= 1 }
    }

    private func refresh() {
        clear()
        if grabbing { NSCursor.closedHand.push(); pushed += 1 }
        else if hovering { NSCursor.openHand.push(); pushed += 1 }
    }
}

/// Najbliższy `NSScrollView` widoku SwiftUI (przewijanie chwytem).
final class GrabScrollBox {
    weak var scrollView: NSScrollView?
}

private struct GrabScrollLocator: NSViewRepresentable {
    let box: GrabScrollBox

    func makeNSView(context: Context) -> LocatorView {
        let view = LocatorView()
        view.box = box
        return view
    }

    func updateNSView(_ view: LocatorView, context: Context) {
        view.box = box
        view.capture()
    }

    final class LocatorView: NSView {
        weak var box: GrabScrollBox?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            capture()
        }
        func capture() {
            if let scroll = enclosingScrollView { box?.scrollView = scroll }
        }
        /// Niewidoczny — nie przejmuje kliknięć.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

/// Przeciągnięcie tła przewija najbliższy `NSScrollView` w podanych osiach (treść „idzie za ręką”).
struct GrabScroll: ViewModifier {
    let axes: Axis.Set
    @State private var box = GrabScrollBox()
    @State private var origin: NSPoint?

    func body(content: Content) -> some View {
        content
            .background(GrabScrollLocator(box: box))
            .modifier(GrabCursor(grabbing: origin != nil))
            .gesture(
                DragGesture(minimumDistance: 3, coordinateSpace: .global)
                    .onChanged { value in
                        guard let scroll = box.scrollView else { return }
                        let clip = scroll.contentView
                        let start = origin ?? clip.bounds.origin
                        if origin == nil { origin = start }
                        var point = start
                        if axes.contains(.horizontal) { point.x = start.x - value.translation.width }
                        if axes.contains(.vertical) { point.y = clip.isFlipped ? start.y - value.translation.height : start.y + value.translation.height }
                        let document = scroll.documentView?.frame ?? .zero
                        let maxX = max(document.minX, document.maxX - clip.bounds.width)
                        let maxY = max(document.minY, document.maxY - clip.bounds.height)
                        point.x = min(max(document.minX, point.x), maxX)
                        point.y = min(max(document.minY, point.y), maxY)
                        clip.scroll(to: point)
                        scroll.reflectScrolledClipView(clip)
                    }
                    .onEnded { _ in origin = nil }
            )
    }
}

extension View {
    /// „Chwyć i przesuń” w przewijanej osi czasu.
    func grabScroll(_ axes: Axis.Set) -> some View { modifier(GrabScroll(axes: axes)) }
    /// Kursor dłoni (oś przesuwana bez przewijania).
    func grabCursor(grabbing: Bool) -> some View { modifier(GrabCursor(grabbing: grabbing)) }
}
