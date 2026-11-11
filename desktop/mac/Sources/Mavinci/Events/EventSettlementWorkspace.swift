import SwiftUI

// MARK: Rozliczenie wydarzenia — jedna zakładka zamiast „Finanse” i „Podsumowanie”: pasek wyników (plan i wykonanie),
// a pod nim sekcje w kolejności przepływu pieniędzy (przychody → koszty → marża i wynik → prowizje → zamknięcie).
// Treść sekcji pochodzi z dotychczasowych widoków (`EventFinancesTab`, `EventSettlementTab`) z tymi samymi czynnościami,
// bez powtórzeń: pozycje podsumowania trafiają do swoich sekcji, rejestr prowizji i ich wyliczenie są razem.

enum RozliczeniePart: String, CaseIterable, Identifiable {
    case revenue, costs, result, commissions, closing
    var id: String { rawValue }
    var label: String {
        switch self {
        case .revenue: return "Przychody"
        case .costs: return "Koszty"
        case .result: return "Marża i wynik"
        case .commissions: return "Prowizje"
        case .closing: return "Zamknięcie"
        }
    }
    var detail: String {
        switch self {
        case .revenue: return "Płatności, faktury, wpływy"
        case .costs: return "Podwykonawcy, ekipa, koszty"
        case .result: return "Plan i wykonanie"
        case .commissions: return "Wyliczenie i wypłaty"
        case .closing: return "Obieg, zatwierdzenie, historia"
        }
    }
    var symbol: String {
        switch self {
        case .revenue: return "arrow.down.circle"
        case .costs: return "arrow.up.circle"
        case .result: return "chart.bar.xaxis"
        case .commissions: return "person.2"
        case .closing: return "checkmark.seal"
        }
    }
}

@MainActor struct EventSettlementWorkspace: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    /// Zakładki dostępne dla użytkownika („finances”, „summary”).
    let members: Set<String>
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventSettlement.part") private var partRaw = RozliczeniePart.result.rawValue

    private var part: RozliczeniePart { RozliczeniePart(rawValue: partRaw) ?? .result }
    private var finances: FinancesTabData? { members.contains("finances") ? store.tab(eventID, "finances", as: FinancesTabData.self) : nil }
    private var settlement: Settlement? {
        guard members.contains("summary"), let data = store.tab(eventID, "summary", as: SettlementTabData.self), data.state == "ready" else { return nil }
        return data.settlement
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Rozliczenie").font(.title2.weight(.semibold))
                Text("przychody → koszty → marża → prowizje → zamknięcie").foregroundStyle(.secondary).lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 12)
            results.padding(.horizontal, 18)
            HStack(spacing: 0) {
                List(selection: Binding(get: { Optional(part) }, set: { if let value = $0 { partRaw = value.rawValue } })) {
                    ForEach(RozliczeniePart.allCases) { item in
                        Label {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.label)
                                Text(item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        } icon: { Image(systemName: item.symbol) }
                        .padding(.vertical, 2)
                        .tag(item)
                    }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
                .frame(width: 230)
                .background(Color.primary.opacity(0.03))
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if members.contains("finances") {
                            EventFinancesTab(store: store, eventID: eventID, navigate: { target in
                                if target == "summary" { partRaw = RozliczeniePart.commissions.rawValue }
                            }, part: part)
                        }
                        if members.contains("summary") {
                            EventSettlementTab(store: store, eventID: eventID, part: part)
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    // MARK: Pasek wyników — wykonanie z podsumowania (gdy dostępne), plan z finansów (zaakceptowana oferta / kalkulacja)

    private struct Figure {
        var title: String
        var value: String
        var detail: String
        var color: Color
        var part: RozliczeniePart
    }

    private var figures: [Figure] {
        let f = finances
        let s = settlement
        let money: (Double?) -> String = { value in value.map { SettlementText.pln($0) } ?? "—" }
        let percent: (Double) -> String = { String(format: "%.1f", $0).replacingOccurrences(of: ".", with: ",") + "%" }
        let green = CrmTheme.rgb(0x4ade80)
        let red = CrmTheme.rgb(0xf87171)
        let revenue: Double? = s.map { $0.totals.value("revenue_net") } ?? f?.result.actualRevenue
        let costs: Double? = s.map { t in ["subcontractor_net", "direct_cost_net", "team_net", "external_commission_lines"].reduce(0.0) { $0 + t.totals.value($1) } }
            ?? f?.result.actualTotal
        let profit: Double? = s.map { $0.totals.value("profit_net") } ?? f?.result.actualProfit
        let margin: Double? = {
            guard let revenue, let profit, revenue != 0 else { return f?.result.actualMargin }
            return profit / revenue * 100
        }()
        let commissions: Double? = s.map { $0.totals.value("internal_commissions_cost") + $0.totals.value("external_commission_auto") }
        let after: Double? = s.map { $0.totals.value("profit_after_commissions") }
        let planRevenue: String = f.map { "plan " + money($0.result.expectedRevenue) } ?? (s == nil ? "" : "wg podsumowania")
        let planCosts: String = f.map { "plan " + money($0.result.plannedTotal) } ?? ""
        let planMargin: String = f.map { "plan " + money($0.result.plannedProfit) + " · " + percent($0.result.plannedMargin) } ?? ""
        return [
            Figure(title: "Przychód netto", value: money(revenue), detail: planRevenue, color: Color.primary, part: .revenue),
            Figure(title: "Koszty", value: money(costs), detail: planCosts, color: Color.primary, part: .costs),
            Figure(title: "Marża", value: money(profit), detail: (margin.map(percent) ?? "—") + (planMargin.isEmpty ? "" : " · " + planMargin),
                   color: (profit ?? 0) >= 0 ? green : red, part: .result),
            Figure(title: "Prowizje", value: money(commissions), detail: s == nil ? "po zatwierdzeniu podsumowania" : "pracownicy i sprzedawcy zewnętrzni",
                   color: Color.primary, part: .commissions),
            Figure(title: "Zysk po prowizjach", value: money(after), detail: s == nil ? "wymaga dostępu do podsumowania" : "wynik wydarzenia",
                   color: (after ?? 0) >= 0 ? green : red, part: .closing),
        ]
    }

    private var results: some View {
        HStack(spacing: 10) {
            ForEach(figures, id: \.title) { figure in
                Button { partRaw = figure.part.rawValue } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(figure.title).font(.caption).foregroundStyle(.secondary)
                        Text(figure.value).font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(figure.color).lineLimit(1).minimumScaleFactor(0.7)
                        Text(figure.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(part == figure.part ? theme.accent.opacity(0.14) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Przejdź do sekcji „\(figure.part.label)”")
            }
        }
    }
}
