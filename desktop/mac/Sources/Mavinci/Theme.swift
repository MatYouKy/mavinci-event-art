import SwiftUI
import AppKit

/// Motywy jak w CRM (`employees.crm_theme`, `src/lib/CRM/theme/crmTheme.ts`): wybór pracownika obowiązuje w przeglądarce i w aplikacji.
/// Paleta — jak podgląd w CRM (`CrmThemePicker.tsx`). Do pierwszego połączenia aplikacja używa ostatnio zapisanego motywu z tego Maca.
enum CrmTheme: String, CaseIterable, Identifiable {
    case burgundy, navy, dark, light
    var id: String { rawValue }
    var label: String {
        switch self { case .burgundy: return "Burgund"; case .navy: return "Granat"; case .dark: return "Ciemny"; case .light: return "Jasny" }
    }
    var description: String {
        switch self {
        case .burgundy: return "Kolory marki Mavinci"
        case .navy: return "Klasyczny ciemnogranatowy"
        case .dark: return "Szary, jak tryb ciemny macOS"
        case .light: return "Jak tryb jasny macOS"
        }
    }
    var scheme: ColorScheme { self == .light ? .light : .dark }
    var pageRGB: Int { self == .burgundy ? 0x210811 : self == .navy ? 0x0f1119 : self == .dark ? 0x1e1e1e : 0xf2f2f4 }
    var textRGB: Int { self == .light ? 0x1d1d1f : 0xe5e4e2 }
    var accentRGB: Int { self == .light ? 0x7a5c12 : 0xd3bb73 }
    var page: Color { Self.rgb(pageRGB) }
    var sidebar: Color { Self.rgb(self == .burgundy ? 0x1a060d : self == .navy ? 0x0c0e15 : self == .dark ? 0x252526 : 0xe8e8ed) }
    var card: Color { Self.rgb(self == .burgundy ? 0x411326 : self == .navy ? 0x1c1f33 : self == .dark ? 0x2c2c2e : 0xffffff) }
    var text: Color { Self.rgb(textRGB) }
    var accent: Color { Self.rgb(accentRGB) }
    static func rgb(_ hex: Int) -> Color { Color(.sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255) }
    /// Kolor z zapisu „#rrggbb” (kategorie z CRM); `nil` dla pustego lub błędnego.
    static func hex(_ value: String?) -> Color? {
        guard var raw = value?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let number = Int(raw, radix: 16) else { return nil }
        return rgb(number)
    }
    /// Zapis „#rrggbb” koloru (do zapisu w CRM).
    static func hexString(_ color: Color) -> String {
        guard let rgb = NSColor(color).usingColorSpace(.sRGB) else { return "#d3bb73" }
        let r = Int((rgb.redComponent * 255).rounded()), g = Int((rgb.greenComponent * 255).rounded()), b = Int((rgb.blueComponent * 255).rounded())
        return String(format: "#%02x%02x%02x", max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    }

    private static let savedKey = "crmTheme"
    static var saved: CrmTheme { CrmTheme(rawValue: UserDefaults.standard.string(forKey: savedKey) ?? "") ?? .burgundy }
    func remember() { UserDefaults.standard.set(rawValue, forKey: Self.savedKey) }
}

private struct CrmThemeKey: EnvironmentKey { static let defaultValue: CrmTheme = .burgundy }
extension EnvironmentValues {
    var crmTheme: CrmTheme { get { self[CrmThemeKey.self] } set { self[CrmThemeKey.self] = newValue } }
}

/// Pasek (nagłówek, stopka) w kolorach motywu — zamiast systemowego `.bar`.
private struct CrmBar: ViewModifier {
    @Environment(\.crmTheme) private var theme
    func body(content: Content) -> some View { content.background(theme.sidebar.opacity(0.96)) }
}
extension View {
    func crmBar() -> some View { modifier(CrmBar()) }
    /// Motyw dla całego okna: schemat kolorów, akcent, tła list, tabel i formularzy pokazują tło strony.
    func crmThemed(_ theme: CrmTheme) -> some View {
        environment(\.crmTheme, theme).preferredColorScheme(theme.scheme).tint(theme.accent).scrollContentBackground(.hidden)
    }
}

struct AppearanceSettings: View {
    @EnvironmentObject private var state: Workspace
    var body: some View {
        Form {
            Section("Motyw") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(CrmTheme.allCases) { theme in
                        Button { Task { await state.setTheme(theme) } } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 4).fill(theme.sidebar).frame(width: 34)
                                    VStack(alignment: .leading, spacing: 5) {
                                        RoundedRectangle(cornerRadius: 3).fill(theme.text).frame(width: 70, height: 6)
                                        RoundedRectangle(cornerRadius: 3).fill(theme.text.opacity(0.4)).frame(height: 5)
                                        RoundedRectangle(cornerRadius: 3).fill(theme.accent).frame(width: 40, height: 9)
                                    }.padding(8).background(theme.card, in: RoundedRectangle(cornerRadius: 5))
                                }.padding(8).frame(height: 70).background(theme.page, in: RoundedRectangle(cornerRadius: 8))
                                HStack {
                                    VStack(alignment: .leading) { Text(theme.label).font(.callout.weight(.semibold)); Text(theme.description).font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                    if state.theme == theme { Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint) }
                                }
                            }.padding(8).background(state.theme == theme ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
                Text("Ustawienie dotyczy tylko Ciebie i obowiązuje także w CRM w przeglądarce.").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).padding()
    }
}
