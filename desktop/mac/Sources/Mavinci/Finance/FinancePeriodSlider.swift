import SwiftUI
import AppKit

// MARK: Okres listy — paski roku i miesięcy
//
// „Wszystkie dokumenty” (`FinanceDocumentsView`): okres wybiera się na dwóch paskach — rok i miesiąc. Zaznaczenie (złota
// obwódka) przesuwa się z animacją do klikniętej pozycji, a przy kilku miesiącach (Shift+klik) rozciąga się na cały zakres;
// „Cały rok” — od stycznia do grudnia. Miesiące, które jeszcze nie nadeszły, są wyszarzone. Konkretne daty (dowolny zakres
// dni) — ikona filtra obok pasków (`FinanceBankStore.setDocumentsCustomDates`).

/// Paski roku i miesięcy; `select` dostaje rok i zakres miesięcy (1…12 — cały rok).
struct FinPeriodSlider: View {
    let year: Int
    let months: ClosedRange<Int>
    let select: (Int, ClosedRange<Int>) -> Void
    @Environment(\.crmTheme) private var theme

    static let shortMonths = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"]

    private var today: (year: Int, month: Int) {
        let calendar = Calendar.current
        let now = Date()
        return (calendar.component(.year, from: now), calendar.component(.month, from: now))
    }
    /// Cztery ostatnie lata (i rok okresu spoza nich — np. po powrocie z konkretnych dat).
    private var years: [Int] {
        let current = today.year
        let recent = Array((current - 3)...current)
        if year < current - 3 { return [year] + recent }
        if year > current { return recent + [year] }
        return recent
    }
    private var wholeYear: Bool { months == 1...12 }

    var body: some View {
        HStack(spacing: 8) {
            strip(selected: ["y\(year)"]) {
                ForEach(years, id: \.self) { value in
                    cell("y\(value)", String(value), selected: value == year) { pickYear(value) }
                        .help("Rok \(String(value))")
                }
            }
            strip(selected: wholeYear ? ["all"] : months.map { "m\($0)" }) {
                cell("all", "Cały rok", selected: wholeYear) { select(year, 1...12) }
                    .help("Cały rok \(String(year))")
                ForEach(1...12, id: \.self) { month in
                    cell("m\(month)", Self.shortMonths[month - 1], selected: !wholeYear && months.contains(month), disabled: future(month)) {
                        pickMonth(month)
                    }
                    .help("\(FinFormat.monthsTitle[month - 1]) \(String(year)) — Shift+klik zaznacza kilka miesięcy")
                }
            }
        }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Okres: rok i miesiące")
    }

    /// Pasek pozycji z jednym zaznaczeniem pod spodem — ramką obejmującą zaznaczone pozycje, przesuwaną z animacją.
    private func strip<Content: View>(selected: [String], @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 0) { content() }
            .padding(2)
            .backgroundPreferenceValue(FinPeriodCellKey.self) { anchors in
                GeometryReader { proxy in
                    let frames = selected.compactMap { id in anchors[id].map { proxy[$0] } }
                    if let first = frames.first {
                        let rect = frames.dropFirst().reduce(first) { $0.union($1) }
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(theme.accent.opacity(0.18))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(theme.accent.opacity(0.8), lineWidth: 1))
                            .frame(width: rect.width, height: rect.height)
                            .offset(x: rect.minX, y: rect.minY)
                            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: rect)
                    }
                }
            }
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func cell(_ id: String, _ label: String, selected: Bool, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(selected ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(selected ? theme.accent : disabled ? Color.secondary.opacity(0.5) : Color.primary.opacity(0.85))
                .padding(.horizontal, 8).padding(.vertical, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .anchorPreference(key: FinPeriodCellKey.self, value: .bounds) { [id: $0] }
    }

    private func future(_ month: Int) -> Bool {
        let now = today
        return year > now.year || (year == now.year && month > now.month)
    }

    /// Inny rok — te same miesiące (w bieżącym roku najwyżej do bieżącego miesiąca; cały rok zostaje całym rokiem).
    private func pickYear(_ value: Int) {
        let now = today
        var range = months
        if value == now.year, range != 1...12, range.upperBound > now.month {
            range = min(range.lowerBound, now.month)...now.month
        }
        select(value, range)
    }

    /// Klik — jeden miesiąc; Shift+klik — zakres od zaznaczonych miesięcy do klikniętego.
    private func pickMonth(_ month: Int) {
        guard NSEvent.modifierFlags.contains(.shift), !wholeYear else {
            select(year, month...month)
            return
        }
        if month < months.lowerBound {
            select(year, month...months.upperBound)
        } else {
            select(year, months.lowerBound...month)
        }
    }
}

/// Ramki pozycji pasków (rok `y2026`, miesiąc `m11`, „Cały rok” — `all`) dla zaznaczenia pod spodem.
private struct FinPeriodCellKey: PreferenceKey {
    static var defaultValue: [String: Anchor<CGRect>] { [:] }
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        value.merge(nextValue()) { $1 }
    }
}
