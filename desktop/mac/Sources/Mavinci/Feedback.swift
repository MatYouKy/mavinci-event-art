import SwiftUI

/// Komunikat po czynności (snackbar): sukces, informacja albo błąd — wyraźny kolor, ikona i treść na dole okna.
struct Snack: Equatable, Identifiable {
    enum Kind { case success, info, error }
    let id = UUID()
    let kind: Kind
    let text: String
}

extension Workspace {
    /// Potwierdzenie udanej czynności (zielony snackbar).
    func succeed(_ text: String) { snack = Snack(kind: .success, text: text) }
    /// Czynność z modalnym wskaźnikiem postępu — okno jest zablokowane, dopóki serwer nie odpowie.
    func withPending<T>(_ text: String, _ work: () async throws -> T) async rethrows -> T {
        pending = text
        defer { pending = nil }
        return try await work()
    }
}

/// Snackbar na dole okna: sukces 4 s, informacja 5 s, błąd 9 s (lub do zamknięcia).
struct SnackbarHost: View {
    @EnvironmentObject private var state: Workspace
    var body: some View {
        ZStack(alignment: .bottom) {
            if let snack = state.snack {
                SnackbarView(snack: snack) { dismiss(snack) }
                    .id(snack.id)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: snack.id) {
                        try? await Task.sleep(for: .seconds(snack.kind == .error ? 9 : snack.kind == .info ? 5 : 4))
                        if state.snack?.id == snack.id { withAnimation(.easeInOut(duration: 0.2)) { dismiss(snack) } }
                    }
            }
        }
        .padding(.bottom, 22).padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: state.snack?.id)
        .allowsHitTesting(state.snack != nil)
    }
    private func dismiss(_ snack: Snack) {
        guard state.snack?.id == snack.id else { return }
        state.snack = nil
        if snack.kind == .error { state.error = nil } else if snack.kind == .info { state.notice = nil }
    }
}

struct SnackbarView: View {
    let snack: Snack
    let close: () -> Void
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol).font(.title2).foregroundStyle(iconColor)
            Text(snack.text).font(.body.weight(.medium)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            Spacer(minLength: 8)
            Button(action: close) { Image(systemName: "xmark").font(.callout.weight(.semibold)).foregroundStyle(.white.opacity(0.85)) }
                .buttonStyle(.plain).help("Zamknij komunikat").accessibilityLabel("Zamknij komunikat")
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .frame(maxWidth: 620)
        .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(snack.text)
    }
    private var symbol: String {
        switch snack.kind { case .success: return "checkmark.circle.fill"; case .info: return "info.circle.fill"; case .error: return "exclamationmark.triangle.fill" }
    }
    private var iconColor: Color { snack.kind == .info ? theme.accent : .white }
    private var background: Color {
        switch snack.kind {
        case .success: return Color(red: 0.13, green: 0.52, blue: 0.33)
        case .error: return Color(red: 0.74, green: 0.19, blue: 0.20)
        case .info: return Color(red: 0.16, green: 0.17, blue: 0.22)
        }
    }
}

/// Modalny wskaźnik trwającej czynności: przyciemnione tło blokuje kliknięcia od razu, okienko pojawia się po chwili (bez migania przy szybkich czynnościach).
struct PendingOverlay: View {
    let text: String
    @State private var visible = false
    var body: some View {
        ZStack {
            Color.black.opacity(visible ? 0.22 : 0.001).ignoresSafeArea().contentShape(Rectangle())
            if visible {
                VStack(spacing: 14) {
                    ProgressView().controlSize(.large)
                    Text(text).font(.headline).multilineTextAlignment(.center)
                    Text("Proszę czekać — czekamy na potwierdzenie serwera.").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 32).padding(.vertical, 26)
                .frame(minWidth: 280)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.25), radius: 24, y: 10)
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(.easeOut(duration: 0.15)) { visible = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}
