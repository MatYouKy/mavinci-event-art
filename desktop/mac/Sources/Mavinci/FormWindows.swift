import SwiftUI

// MARK: Formularze w osobnych oknach (wiadomość e-mail, faktura)
//
// Zamiast arkusza przyklejonego do okna — zwykłe okno macOS: skalowanie, przesuwanie, kilka naraz i praca obok głównego okna
// (np. przewijanie skrzynki przy pisaniu odpowiedzi). Widok, który otwierał arkusz (`.sheet(item:)`), otwiera okno tym samym
// zapisem: `.formWindow(item:kind:)`. Treść czeka w `FormWindows` pod identyfikatorem, który dostaje scena `WindowGroup`
// (`MavinciApp`: obszar roboczy, motyw); okno zabiera ją przy otwarciu. `dismiss()` w formularzu zamyka okno.

/// Rodzaje okien formularzy — identyfikatory scen w `MavinciApp` (każdy rodzaj pamięta własny rozmiar i położenie okna).
enum FormWindowKind: String {
    /// Nowa wiadomość, odpowiedź i przekazanie (`ComposeSheet`).
    case compose = "form-compose"
    /// Faktura VAT, proforma, zaliczka, korekta i faktura końcowa (`InvoiceFormSheet`, `FinalInvoiceSheet`).
    case invoice = "form-invoice"
}

/// Treść okien formularzy czekająca na otwarcie okna (zabierana raz, przy otwarciu).
@MainActor final class FormWindows {
    static let shared = FormWindows()
    private var pending: [UUID: AnyView] = [:]

    func register(_ content: AnyView) -> UUID {
        let id = UUID()
        pending[id] = content
        return id
    }

    func take(_ id: UUID) -> AnyView? { pending.removeValue(forKey: id) }
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
    @State private var checked = false

    var body: some View {
        Group {
            if let content {
                content.environment(\.inFormWindow, true)
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
            if let id { content = FormWindows.shared.take(id) }
        }
    }
}

extension View {
    /// Jak `.sheet(item:)`, tylko formularz otwiera się w osobnym oknie (`FormWindowHost`): ustawienie `item` otwiera okno
    /// i zeruje `item` (kolejne ustawienie — kolejne okno). Obszar roboczy i motyw okno dostaje ze sceny.
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
            let id = FormWindows.shared.register(AnyView(panel(current)))
            openWindow(id: kind.rawValue, value: id)
        }
    }
}
