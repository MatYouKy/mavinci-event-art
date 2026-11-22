import SwiftUI

// MARK: Paski narzędzi dopasowane do szerokości okna (edytory Prezentacji i Realizacji)
//
// Pasek ma kilka wariantów w `ViewThatFits` — pełne etykiety, same ikony (opis w podpowiedzi), dwa wiersze — i pokazuje pierwszy,
// który mieści się w oknie. Etykiety nigdy się nie łamią. Skrót ⌘S jest poza wariantami (`AdaptiveSaveShortcut`), bo
// `ViewThatFits` trzyma w hierarchii wszystkie warianty i skrót w każdym z nich zadziałałby kilka razy.

/// Etykieta przycisku: ikona i tytuł albo sama ikona (wąskie okno); tytuł nie łamie się na kilka wierszy.
struct AdaptiveLabelStyle: LabelStyle {
    let compact: Bool

    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        if compact {
            configuration.icon
        } else {
            HStack(spacing: 5) {
                configuration.icon
                configuration.title.lineLimit(1)
            }
            .fixedSize()
        }
    }
}

/// Niewidoczny przycisk ze skrótem klawiszowym — jeden dla całego paska, niezależnie od wybranego wariantu.
struct AdaptiveSaveShortcut: View {
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button("Zapisz", action: action)
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!enabled)
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
    }
}

/// Stan zapisu w wąskim pasku: kropka „niezapisane zmiany” albo znacznik „zapisano” (pełny opis w podpowiedzi).
struct AdaptiveSavedBadge: View {
    let dirty: Bool
    let text: String

    var body: some View {
        Image(systemName: dirty ? "circle.fill" : "checkmark.circle")
            .font(dirty ? .system(size: 8) : .callout)
            .foregroundStyle(dirty ? Color.orange : Color.secondary)
            .frame(width: 16)
            .help(text)
            .accessibilityLabel(text)
    }
}
