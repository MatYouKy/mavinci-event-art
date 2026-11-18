import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Przeciąganie pozycji paska bocznego — jak w Finderze, upuszczanie na pasku pod kartami
//
// Pozycję paska bocznego z ekranem natywnym (np. Wiadomości, Kontakty) można chwycić i przeciągnąć. Jak w Finderze: za kursorem
// idzie wyraźna „etykieta” pozycji (ikona i nazwa w kolorze motywu), a sama pozycja na pasku przygasa. W każdym oknie tuż pod
// kartami (akcesorium paska tytułu macOS — `NSTitlebarAccessoryViewController`) wysuwa się pasek z polami „W tej karcie”,
// „W nowej karcie” (karta dołącza do tego okna) i „W nowym oknie”. Pole pod kursorem podświetla się, a kursor dostaje zielony „+”
// (jak kopiowanie w Finderze). Systemowy pasek kart nie przyjmuje upuszczania z aplikacji (brak publicznego API), stąd pasek
// tuż pod nim. Upuszczenie poza polami niczego nie otwiera (etykieta wraca na miejsce); treść okna przechwytuje wtedy upuszczenie,
// więc tekst pozycji nie trafi do pola tekstowego. Pasek chowa się po puszczeniu przycisku myszy (także poza aplikacją albo Esc).

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

    /// Przeciągana pozycja paska bocznego (nazwa i ikona na pasku upuszczania).
    var navDragItem: NavItem? {
        guard let href = navDrag else { return nil }
        let items = navigation.flatMap(\.flattened)
        return items.first(where: { $0.href == href && ($0.children ?? []).isEmpty }) ?? items.first(where: { $0.href == href })
    }
}

enum NavDrag {
    /// Tekst przeciąganej pozycji (gdyby trafił poza aplikację — czytelny adres sekcji).
    static let prefix = "mavinci-nav:"
    static let types: [UTType] = [.utf8PlainText, .plainText, .text]
}

extension CrmTheme {
    /// Tekst na tle w kolorze akcentu (jasny motyw — ciemne złoto z białym tekstem, ciemne motywy — jasne złoto z ciemnym).
    var onAccent: Color { self == .light ? .white : Self.rgb(0x1d1d1f) }
}

/// Źródło przeciągania pozycji paska bocznego — tylko pozycje z ekranem natywnym (`href`), pozostałe bez zmian.
@MainActor struct NavDragSource: ViewModifier {
    let workspace: Workspace
    let href: String?
    var name = ""
    var symbol = "doc"
    /// Ta pozycja jest właśnie przeciągana — przygasa jak ikona w Finderze.
    var dragging = false
    @ViewBuilder func body(content: Content) -> some View {
        if let href {
            content
                .opacity(dragging ? 0.4 : 1)
                .onDrag { workspace.beginNavDrag(href) } preview: {
                    NavDragPreview(name: name, symbol: symbol, theme: workspace.theme)
                }
        } else {
            content
        }
    }
}

/// Etykieta za kursorem podczas przeciągania — ikona i nazwa sekcji na tle w kolorze motywu (jak zaznaczona nazwa w Finderze).
struct NavDragPreview: View {
    let name: String
    let symbol: String
    let theme: CrmTheme
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold))
            Text(name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(theme.onAccent)
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
        .fixedSize()
        .padding(4)
    }
}

/// Gdzie otworzyć upuszczoną sekcję.
enum NavDropTarget: String, CaseIterable, Identifiable {
    case here, tab, window
    var id: String { rawValue }
    var label: String {
        switch self { case .here: return "W tej karcie"; case .tab: return "W nowej karcie"; case .window: return "W nowym oknie" }
    }
    var symbol: String {
        switch self { case .here: return "macwindow"; case .tab: return "plus.square.on.square"; case .window: return "macwindow.badge.plus" }
    }
}

/// Pole upuszczania: podświetlenie pod kursorem, zielony „+” przy kursorze (kopiowanie), otwarcie po upuszczeniu.
struct NavDropDelegate: DropDelegate {
    let target: NavDropTarget
    @Binding var hovered: NavDropTarget?
    let accepts: () -> Bool
    let open: (NavDropTarget) -> Bool

    func validateDrop(info: DropInfo) -> Bool { accepts() }
    func dropEntered(info: DropInfo) { hovered = target }
    func dropExited(info: DropInfo) { if hovered == target { hovered = nil } }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .copy) }
    func performDrop(info: DropInfo) -> Bool {
        hovered = nil
        return open(target)
    }
}

/// Upuszczenie poza polami: przechwycone i odrzucone (nic się nie otwiera, tekst pozycji nie trafia do treści pod spodem).
struct NavDropBlocker: DropDelegate {
    func validateDrop(info: DropInfo) -> Bool { true }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .forbidden) }
    func performDrop(info: DropInfo) -> Bool { false }
}

/// Treść okna podczas przeciągania: lekkie przyciemnienie i przechwycenie upuszczenia poza paskiem pod kartami.
struct NavDropContentShield: View {
    var body: some View {
        Color.black.opacity(0.06)
            .contentShape(Rectangle())
            .onDrop(of: NavDrag.types, delegate: NavDropBlocker())
    }
}

/// Pasek upuszczania pod kartami: przeciągana pozycja i trzy pola.
@MainActor struct NavDropBar: View {
    static let height: CGFloat = 50
    /// Akcja sceny SwiftUI (pasek jest w osobnym widoku AppKit w pasku tytułu — bez środowiska sceny).
    let openWindow: OpenWindowAction
    @EnvironmentObject private var state: Workspace
    /// Okno paska — „W tej karcie” i nowa karta dotyczą jego.
    @EnvironmentObject private var nav: WindowNavigation
    @State private var hovered: NavDropTarget?

    var body: some View {
        let item = state.navDragItem
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: item?.symbol ?? "doc").foregroundStyle(state.theme.accent)
                Text("Upuść „\(item?.name ?? "Sekcja")”:").foregroundStyle(.secondary)
            }
            .font(.callout.weight(.medium)).lineLimit(1).fixedSize()
            ForEach(NavDropTarget.allCases) { target in zone(target) }
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func zone(_ target: NavDropTarget) -> some View {
        let theme = state.theme
        let active = hovered == target
        return HStack(spacing: 7) {
            Image(systemName: target.symbol).font(.system(size: 14, weight: .medium))
            Text(target.label).font(.callout.weight(.semibold)).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(active ? theme.onAccent : theme.accent)
        .background(active ? theme.accent : theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
            .strokeBorder(theme.accent.opacity(active ? 1 : 0.55), style: StrokeStyle(lineWidth: 1.2, dash: active ? [] : [5, 4])))
        .scaleEffect(active ? 1.03 : 1)
        .animation(.easeOut(duration: 0.12), value: active)
        .contentShape(Rectangle())
        .onDrop(of: NavDrag.types, delegate: NavDropDelegate(target: target, hovered: $hovered, accepts: { state.navDrag != nil }, open: { open($0) }))
    }

    /// Otwarcie przeciąganej sekcji — tylko pozycja paska bocznego tej aplikacji (inne teksty niczego nie otwierają).
    private func open(_ target: NavDropTarget) -> Bool {
        guard let href = state.navDrag else { return false }
        state.navDrag = nil
        switch target {
        case .here:
            state.inWindow(nav) { state.openHref(href) }
            nav.window?.makeKeyAndOrderFront(nil)
        case .tab:
            state.openInWindow(.href(href), asTab: true, from: nav, using: openWindow)
        case .window:
            state.openInWindow(.href(href), asTab: false, from: nav, using: openWindow)
        }
        return true
    }
}

/// Instaluje pasek upuszczania w oknie jako akcesorium paska tytułu (pod paskiem narzędzi i kartami) i pokazuje go podczas
/// przeciągania. Pełny ekran: pasek widoczny także przy schowanym pasku narzędzi.
struct NavDropAccessory: NSViewRepresentable {
    let workspace: Workspace
    let nav: WindowNavigation
    let openWindow: OpenWindowAction
    let visible: Bool

    private var bar: AnyView {
        AnyView(NavDropBar(openWindow: openWindow).environmentObject(workspace).environmentObject(nav)
            .environment(\.crmTheme, workspace.theme).tint(workspace.theme.accent))
    }
    func makeNSView(context: Context) -> InstallerView {
        let view = InstallerView()
        view.configure(bar: bar, visible: visible)
        return view
    }
    func updateNSView(_ view: InstallerView, context: Context) { view.configure(bar: bar, visible: visible) }
    static func dismantleNSView(_ view: InstallerView, coordinator: ()) { view.uninstall() }

    final class InstallerView: NSView {
        private var accessory: NSTitlebarAccessoryViewController?
        private var hosting: NSHostingView<AnyView>?
        private var visible = false
        /// Tylko instalacja w oknie — kliknięcia trafiają do treści.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        func configure(bar: AnyView, visible: Bool) {
            if let hosting {
                hosting.rootView = bar
            } else {
                let view = NSHostingView(rootView: bar)
                view.sizingOptions = []
                view.frame = NSRect(x: 0, y: 0, width: 640, height: NavDropBar.height)
                hosting = view
            }
            self.visible = visible
            install()
            apply()
        }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            install()
            apply()
        }
        private func install() {
            guard accessory == nil, let window, let hosting, window.styleMask.contains(.titled) else { return }
            let controller = NSTitlebarAccessoryViewController()
            controller.layoutAttribute = .bottom
            controller.view = hosting
            controller.fullScreenMinHeight = NavDropBar.height
            controller.isHidden = true
            window.addTitlebarAccessoryViewController(controller)
            accessory = controller
        }
        private func apply() {
            guard let accessory, accessory.isHidden == visible else { return }
            let hidden = !visible
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                accessory.animator().isHidden = hidden
            }
        }
        func uninstall() {
            accessory?.removeFromParent()
            accessory = nil
        }
    }
}
