import AppKit
import SwiftUI

// MARK: Formularze w osobnych oknach (wiadomość e-mail, faktura)
//
// Zamiast arkusza przyklejonego do okna — zwykłe okno macOS: skalowanie, przesuwanie, kilka naraz i praca obok głównego okna
// (np. przewijanie skrzynki przy pisaniu odpowiedzi). Widok, który otwierał arkusz (`.sheet(item:)`), otwiera okno tym samym
// zapisem: `.formWindow(item:kind:)`. Treść czeka w `FormWindows` pod identyfikatorem, który dostaje scena `WindowGroup`
// (`MavinciApp`: motyw), razem z obszarem roboczym okna, z którego otwarto formularz (`WindowWorkspaces.swift` — zapis
// odświeża sekcję tego okna); okno zabiera ją przy otwarciu. `dismiss()` w formularzu zamyka okno. Nowa wiadomość
// otwiera się zawsze w rozmiarze okna modalnego na środku okna CRM (`FormWindowKind.openSize`), a nie w ostatnim rozmiarze
// (np. na cały ekran po powiększeniu poprzedniego okna).

/// Rodzaje okien formularzy — identyfikatory scen w `MavinciApp` (każdy rodzaj pamięta własny rozmiar i położenie okna).
enum FormWindowKind: String {
    /// Nowa wiadomość, odpowiedź i przekazanie (`ComposeSheet`).
    case compose = "form-compose"
    /// Faktura VAT, proforma, zaliczka, korekta i faktura końcowa (`InvoiceFormSheet`, `FinalInvoiceSheet`).
    case invoice = "form-invoice"

    /// Rozmiar treści okna przy każdym otwarciu (jak okno modalne, w granicach ekranu); `nil` — macOS pamięta ostatni rozmiar.
    var openSize: CGSize? { self == .compose ? CGSize(width: 920, height: 780) : nil }
}

/// Treść okien formularzy czekająca na otwarcie okna (zabierana raz, przy otwarciu).
@MainActor final class FormWindows {
    static let shared = FormWindows()
    private var pending: [UUID: (view: AnyView, size: CGSize?, owner: Workspace?)] = [:]

    /// `owner` — obszar okna na pierwszym planie (to z niego otwiera się formularz).
    func register(_ content: AnyView, size: CGSize? = nil) -> UUID {
        let id = UUID()
        pending[id] = (content, size, WorkspaceHub.current?.keyWorkspace)
        return id
    }

    func take(_ id: UUID) -> (view: AnyView, size: CGSize?, owner: Workspace?)? { pending.removeValue(forKey: id) }
}

private struct InFormWindowKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Widok jest w oknie formularza (`FormWindowHost`), a nie w arkuszu — np. bez dużego tytułu (jest na pasku okna).
    var inFormWindow: Bool {
        get { self[InFormWindowKey.self] }
        set { self[InFormWindowKey.self] = newValue }
    }
}

/// Okno formularza: treść z `FormWindows`. Okno przywrócone po ponownym uruchomieniu aplikacji nie ma już treści — informacja
/// i „Zamknij okno” (formularz otwiera się jeszcze raz z sekcji).
@MainActor struct FormWindowHost: View {
    let id: UUID?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var content: AnyView?
    @State private var size: CGSize?
    @State private var owner: Workspace?
    @State private var checked = false

    var body: some View {
        Group {
            if let content {
                Group {
                    if let owner { content.environmentObject(owner).environmentObject(owner.native) } else { content }
                }
                .environment(\.inFormWindow, true)
                .background { if let size { FormWindowSizer(size: size) } }
            } else if checked {
                ContentUnavailableView {
                    Label("Formularz nie jest już otwarty", systemImage: "doc.questionmark")
                } description: {
                    Text("To okno wróciło po ponownym uruchomieniu aplikacji. Otwórz formularz jeszcze raz z sekcji.")
                } actions: {
                    Button("Zamknij okno") { dismiss() }
                }
                .frame(minWidth: 420, maxWidth: .infinity, minHeight: 260, maxHeight: .infinity)
                .background(theme.page)
            } else {
                theme.page.frame(minWidth: 420, maxWidth: .infinity, minHeight: 260, maxHeight: .infinity)
            }
        }
        .onAppear {
            guard !checked else { return }
            checked = true
            if let id, let entry = FormWindows.shared.take(id) {
                content = entry.view
                size = entry.size
                owner = entry.owner
            }
        }
    }
}

extension View {
    /// Jak `.sheet(item:)`, tylko formularz otwiera się w osobnym oknie (`FormWindowHost`): ustawienie `item` otwiera okno
    /// i zeruje `item` (kolejne ustawienie — kolejne okno). Obszar roboczy — okna, z którego otwarto formularz; motyw — ze sceny.
    func formWindow<Item: Identifiable, Panel: View>(item: Binding<Item?>, kind: FormWindowKind,
                                                      @ViewBuilder content: @escaping (Item) -> Panel) -> some View {
        modifier(FormWindowPresenter(item: item, kind: kind, panel: content))
    }
}

private struct FormWindowPresenter<Item: Identifiable, Panel: View>: ViewModifier {
    @Binding var item: Item?
    let kind: FormWindowKind
    let panel: (Item) -> Panel
    @Environment(\.openWindow) private var openWindow

    func body(content: Content) -> some View {
        content.onChange(of: item != nil, initial: true) { _, present in
            guard present, let current = item else { return }
            item = nil
            let id = FormWindows.shared.register(AnyView(panel(current)), size: kind.openSize)
            openWindow(id: kind.rawValue, value: id)
        }
    }
}

/// Rozmiar okna formularza ustawiany raz, przy otwarciu: treść `size` (w granicach ekranu), na środku okna, z którego otwarto
/// formularz (albo ekranu). Okno w trybie pełnoekranowym zostaje bez zmian.
private struct FormWindowSizer: NSViewRepresentable {
    let size: CGSize

    func makeNSView(context: Context) -> SizerView { SizerView(size: size) }
    func updateNSView(_ view: SizerView, context: Context) {}

    final class SizerView: NSView {
        private let size: CGSize
        private var applied = false

        init(size: CGSize) {
            self.size = size
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard !applied, let window else { return }
            applied = true
            let anchor = NSApp.orderedWindows.first { $0 !== window && $0.isVisible && !$0.isMiniaturized && $0.level == .normal && !($0 is NSPanel) }
            let size = size
            Task { @MainActor [weak window, weak anchor] in
                guard let window, !window.styleMask.contains(.fullScreen) else { return }
                guard let screen = (anchor?.screen ?? window.screen ?? NSScreen.main)?.visibleFrame, screen.width > 0 else { return }
                let content = NSSize(width: min(size.width, screen.width - 40), height: min(size.height, screen.height - 60))
                var frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: content))
                let center = anchor.map { NSPoint(x: $0.frame.midX, y: $0.frame.midY) } ?? NSPoint(x: screen.midX, y: screen.midY)
                frame.origin.x = min(max(center.x - frame.width / 2, screen.minX), screen.maxX - frame.width)
                frame.origin.y = min(max(center.y - frame.height / 2, screen.minY), screen.maxY - frame.height)
                window.setFrame(frame, display: true, animate: false)
            }
        }
    }
}
