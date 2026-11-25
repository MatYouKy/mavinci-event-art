import SwiftUI
import AppKit

/// Ikona „Kopiuj” przy wartości (numer faktury, numer KSeF, NIP, rachunek, kwota): kopiuje wartość do schowka i na 1,5 s
/// pokazuje „✓” (podpowiedź „Skopiowano”). Jak `CopyValueButton` w CRM. Pusta wartość — przycisk wyłączony.
@MainActor struct CopyValueButton: View {
    /// Nazwa wartości do podpowiedzi i VoiceOver („Kopiuj: Numer KSeF”).
    let label: String
    let value: String
    @State private var copied = false
    @State private var token = UUID()

    var body: some View {
        Button {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(value, forType: .string)
            let current = UUID()
            token = current
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                if token == current { copied = false }
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.caption)
                .foregroundStyle(copied ? Color.green : Color.secondary)
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(value.isEmpty)
        .help(copied ? "Skopiowano" : "Kopiuj: \(label)")
        .accessibilityLabel(copied ? "Skopiowano: \(label)" : "Kopiuj: \(label)")
    }
}
