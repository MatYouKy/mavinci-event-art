import SwiftUI
import Charts

// MARK: Dashboard 1:1 ze stroną `/crm` (`CRMDashboard.tsx`): „Mój plan”, trend sprzedażowy, lejek, przepływy, „Wymaga działania”,
// ostatnia aktywność, szybkie akcje i „Pozostałe wskaźniki”. Dane i reguły widoczności liczy serwer (`/bridge/native/v1/dashboard`).

struct DashboardMonth: Decodable, Identifiable {
    let key: String; let label: String; let inquiries: Double; let offers: Double; let events: Double; let revenue: Double; let costs: Double; let margin: Double
    var id: String { key }
    func value(_ name: String) -> Double {
        switch name { case "inquiries": return inquiries; case "offers": return offers; case "events": return events; case "revenue": return revenue; case "costs": return costs; default: return margin }
    }
}
struct DashboardFunnel: Decodable { let inquiries: Double; let offers: Double; let acceptedOffers: Double; let events: Double }
struct DashboardAttention: Decodable {
    let overdueTasks: Double; let overdueInquiries: Double; let overdueInvoices: Double; let eventsNext30Days: Double
    let unownedCustomers: Double; let neglectedOpportunities: Double; let workflowRisks: Double
}
struct DashboardCard: Decodable, Identifiable {
    let name: String; let value: Double; let total: Double?; let displayValue: String?; let helper: String?; let icon: String; let color: String; let href: String; let trendKey: String?
    var id: String { name }
}
struct DashboardActivity: Decodable, Identifiable {
    let id: String; let type: String; let title: String; let time: String; let href: String; let createdAt: String?
    /// „przed chwilą”, „5 minut temu”, „wczoraj”… — jak `getTimeAgo` w CRMDashboard.
    var ago: String {
        let parse = ISO8601DateFormatter(); parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let raw = createdAt, let date = parse.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return time }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return "przed chwilą" }
        if seconds < 3600 { return "\(seconds / 60) minut temu" }
        if seconds < 86_400 { return "\(seconds / 3600) godzin temu" }
        if seconds < 172_800 { return "wczoraj" }
        if seconds < 604_800 { return "\(seconds / 86_400) dni temu" }
        return Labels.date(raw)
    }
}
struct DashboardLink: Decodable, Identifiable { let href: String; let label: String; var id: String { href + label } }
struct DashboardSummary: Decodable, Identifiable { let label: String; let value: Double; var id: String { label } }
struct DashboardData: Decodable {
    let variant: String
    let scope: String?
    let accessError: String?
    let subtitle: String?
    let months: [DashboardMonth]?
    let funnel: DashboardFunnel?
    let attention: DashboardAttention?
    let widgets: [String: Bool]?
    let showFinancialTrends: Bool?
    let showCalendar: Bool?
    let cards: [DashboardCard]?
    let activity: [DashboardActivity]?
    let quickActions: [DashboardLink]?
    let summary: [DashboardSummary]?
    let noPermissions: Bool?
    func enabled(_ widget: String) -> Bool { widgets?[widget] != false }
}

enum DashboardColors {
    static func named(_ name: String) -> Color {
        switch name {
        case "amber": return Color(red: 0.99, green: 0.83, blue: 0.30)
        case "green": return Color(red: 0.20, green: 0.83, blue: 0.60)
        case "blue": return Color(red: 0.38, green: 0.65, blue: 0.98)
        case "red": return Color(red: 0.97, green: 0.44, blue: 0.44)
        case "purple": return Color(red: 0.75, green: 0.52, blue: 0.99)
        case "orange": return Color(red: 0.98, green: 0.57, blue: 0.24)
        case "cyan": return Color(red: 0.13, green: 0.83, blue: 0.93)
        default: return CrmTheme.rgb(0xd3bb73)
        }
    }
    static let money: NumberFormatter = { let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .currency; f.currencyCode = "PLN"; f.maximumFractionDigits = 0; return f }()
    static func pln(_ v: Double) -> String { money.string(from: NSNumber(value: v)) ?? "\(Int(v)) zł" }
}

/// Karta sekcji dashboardu: tło w kolorze motywu, bez obramowań.
struct DashboardPanel<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var symbol: String? = nil
    @ViewBuilder let content: Content
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent).font(.title3) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.title3.weight(.light))
                    if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                }
            }
            content
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.85), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct DashboardView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var showIndicators = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let data = state.dashboard {
                    if let problem = data.accessError { MessageBar(text: "\(problem) Dane firmy nie zostały pobrane.", warning: true) {} }
                    content(data)
                } else if state.dashboardLoading || state.dashboardError == nil {
                    MyDayTimelineView()
                    ProgressView("Wczytywanie dashboardu…").frame(maxWidth: .infinity).padding(40)
                } else {
                    MyDayTimelineView()
                    ContentUnavailableView("Dashboard niedostępny", systemImage: "rectangle.3.group", description: Text(state.dashboardError ?? ""))
                }
            }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Dashboard")
        .task { await state.loadDashboard() }
    }

    @ViewBuilder private func content(_ data: DashboardData) -> some View {
        if let error = state.dashboardError { Text(error).font(.caption).foregroundStyle(.orange) }
        if data.variant == "warehouse" {
            MyDayTimelineView()
            Text("Dashboard magazynu jest na razie w CRM w przeglądarce.").foregroundStyle(.secondary)
            Button("Otwórz w przeglądarce") { state.openCRM("/crm") }
        } else if data.scope == "sales" {
            // Sprzedawca zaczyna dzień od listy działań; wyniki finansowe są poniżej.
            MyDayTimelineView()
            SalesDayView().frame(minHeight: 420)
            Button("Moje prowizje i wyniki sprzedaży — otwórz w CRM") { state.openCRM("/crm") }.buttonStyle(.link)
        } else if data.noPermissions == true {
            ContentUnavailableView("Brak uprawnień", systemImage: "lock", description: Text("Nie masz przypisanych żadnych uprawnień do systemu CRM. Skontaktuj się z administratorem w celu nadania dostępu."))
        } else {
            header(data)
            MyDayTimelineView()
            charts(data)
            lower(data)
            indicators(data)
        }
    }

    private func header(_ data: DashboardData) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Witaj w systemie CRM").font(.title.weight(.light))
                Text(data.subtitle ?? "").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            Button { state.openCRM("/crm/settings?tab=dashboard") } label: { Label("Dostosuj dashboard", systemImage: "slider.horizontal.3") }
            if data.showCalendar == true { Button("Otwórz kalendarz") { state.switchSection(.calendar) }.buttonStyle(.borderedProminent) }
        }
    }

    @ViewBuilder private func charts(_ data: DashboardData) -> some View {
        let months = data.months ?? []
        let trends = data.enabled("sales-trends"), funnel = data.enabled("sales-funnel")
        if trends || funnel {
            HStack(alignment: .top, spacing: 20) {
                if trends {
                    TrendChartView(title: "Trend sprzedażowy", description: "Nowe rekordy · zakres \(months.count >= 12 ? "12 miesięcy" : "6 miesięcy")", months: months,
                                   series: [ChartSeries(key: "inquiries", label: "Zapytania", color: Color(red: 0.96, green: 0.62, blue: 0.04)), ChartSeries(key: "offers", label: "Oferty", color: Color(red: 0.38, green: 0.65, blue: 0.98)), ChartSeries(key: "events", label: "Wydarzenia", color: CrmTheme.rgb(0xd3bb73))], money: false)
                        .frame(minWidth: 360, maxWidth: .infinity)
                }
                if funnel, let f = data.funnel {
                    if trends { SalesFunnelView(funnel: f).frame(width: 380) } else { SalesFunnelView(funnel: f).frame(maxWidth: .infinity) }
                }
            }.frame(height: 480)
        }
        if data.showFinancialTrends == true && data.enabled("financial-trends") {
            TrendChartView(title: "Wpływy, wydatki i wynik kasowy", description: "Rzeczywiste przepływy według daty płatności · zakres \(months.count >= 12 ? "12 miesięcy" : "6 miesięcy")", months: months,
                           series: [ChartSeries(key: "revenue", label: "Wpływy", color: Color(red: 0.20, green: 0.83, blue: 0.60)), ChartSeries(key: "costs", label: "Wydatki", color: Color(red: 0.97, green: 0.44, blue: 0.44)), ChartSeries(key: "margin", label: "Wynik kasowy", color: CrmTheme.rgb(0xd3bb73))], money: true)
                .frame(height: 400)
        }
    }

    @ViewBuilder private func lower(_ data: DashboardData) -> some View {
        let activity = data.enabled("recent-activity"), attention = data.enabled("operational-attention"), quick = data.enabled("quick-actions")
        if activity || attention || quick {
            HStack(alignment: .top, spacing: 20) {
                if activity {
                    DashboardPanel(title: "Ostatnia aktywność") {
                        let items = data.activity ?? []
                        if items.isEmpty { Text("Brak aktywności").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 24) }
                        ForEach(items) { item in
                            Button { openActivity(item) } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: item.type == "event" ? "calendar" : item.type == "client" ? "person.2" : item.type == "offer" ? "doc.text" : "clock").foregroundStyle(theme.accent)
                                    VStack(alignment: .leading, spacing: 3) { Text(item.title).lineLimit(2); Text(item.ago).font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                }.padding(12).background(theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }.frame(minWidth: 360, maxWidth: .infinity)
                }
                VStack(spacing: 20) {
                    if attention, let a = data.attention { AttentionView(attention: a) }
                    if quick {
                        DashboardPanel(title: "Szybkie akcje") {
                            let actions = data.quickActions ?? []
                            if actions.isEmpty { Text("Brak dostępnych akcji").font(.callout).foregroundStyle(.secondary) }
                            ForEach(actions) { action in
                                Button { state.openCRM(action.href) } label: { Text(action.label).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8)) }.buttonStyle(.plain)
                            }
                            if let summary = data.summary, !summary.isEmpty {
                                Divider()
                                Label("Podsumowanie", systemImage: "checkmark.circle").font(.callout)
                                ForEach(summary) { item in HStack { Text(item.label).foregroundStyle(.secondary); Spacer(); Text("\(Int(item.value))").monospacedDigit() }.font(.callout) }
                            }
                        }
                    }
                }
                .frame(width: activity ? 380 : nil)
                .frame(maxWidth: activity ? nil : CGFloat.infinity)
            }
        }
    }

    @ViewBuilder private func indicators(_ data: DashboardData) -> some View {
        let cards = data.cards ?? []
        if data.enabled("kpi-overview") && !cards.isEmpty {
            DisclosureGroup(isExpanded: $showIndicators) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                    ForEach(cards) { card in
                        Button { openHref(card.href) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Image(systemName: card.icon).foregroundStyle(DashboardColors.named(card.color)).padding(5).background(DashboardColors.named(card.color).opacity(0.12), in: RoundedRectangle(cornerRadius: 5))
                                    Text(card.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer()
                                    if let key = card.trendKey, let trend = trend(data.months ?? [], key) { Text("\(trend > 0 ? "+" : "")\(trend)%").font(.caption2).foregroundStyle(trend >= 0 ? .green : .red) }
                                }
                                HStack(alignment: .firstTextBaseline, spacing: 4) {
                                    Text(card.displayValue ?? "\(Int(card.value))").font(.title3.weight(.medium)).monospacedDigit()
                                    if let total = card.total, total > 0 { Text("/ \(Int(total))").font(.caption).foregroundStyle(.secondary) }
                                }
                                if let helper = card.helper { Text(helper).font(.caption2).foregroundStyle(.tertiary).lineLimit(2) }
                            }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(theme.card.opacity(0.7), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }.padding(.top, 10)
            } label: {
                HStack { Text("Pozostałe wskaźniki"); Text("liczniki pomocnicze i dane referencyjne").font(.caption).foregroundStyle(.secondary) }
            }
            .padding(16).background(theme.card.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func trend(_ months: [DashboardMonth], _ key: String) -> Int? {
        guard months.count >= 1 else { return nil }
        let current = months.last?.value(key) ?? 0
        let previous = months.count >= 2 ? months[months.count - 2].value(key) : 0
        if previous == 0 { return current == 0 ? 0 : 100 }
        return Int(((current - previous) / previous * 100).rounded())
    }

    private func openHref(_ href: String) {
        let path = String(href.split(separator: "?").first ?? "")
        let map: [String: Module] = ["/crm/inquiries": .inquiries, "/crm/offers": .offers, "/crm/events": .events, "/crm/contacts": .contacts, "/crm/clients": .contacts, "/crm/tasks": .tasks, "/crm/calendar": .calendar, "/crm/tenders": .tenders]
        if let module = map[path], state.employee?.canView(module) == true { state.switchSection(module) } else { state.openCRM(href) }
    }

    private func openActivity(_ item: DashboardActivity) {
        switch item.type {
        case "event": state.showEvent(item.id)
        case "offer": state.open(.offers, id: item.id)
        case "task": state.open(.tasks, id: item.id)
        case "client": state.open(.contacts, id: item.id)
        default: state.openCRM(item.href)
        }
    }
}

struct ChartSeries: Identifiable { let key: String; let label: String; let color: Color; var id: String { key } }

struct TrendChartView: View {
    let title: String
    let description: String
    let months: [DashboardMonth]
    let series: [ChartSeries]
    let money: Bool
    var body: some View {
        DashboardPanel(title: title, subtitle: description) {
            if months.isEmpty { Text("Brak danych miesięcznych dla wybranego zakresu.").foregroundStyle(.secondary).frame(height: 240) }
            else {
                Chart {
                    ForEach(series) { s in
                        ForEach(months) { m in
                            LineMark(x: .value("Miesiąc", m.label), y: .value(s.label, m.value(s.key)))
                                .foregroundStyle(by: .value("Seria", s.label)).interpolationMethod(.monotone).symbol(.circle)
                        }
                    }
                }
                .chartForegroundStyleScale(domain: series.map(\.label), range: series.map(\.color))
                .chartYAxis { AxisMarks { value in AxisGridLine(); AxisValueLabel { if let v = value.as(Double.self) { Text(money ? DashboardColors.pln(v) : "\(Int(v))") } } } }
                .chartLegend(position: .top, alignment: .leading)
                .frame(minHeight: 220, maxHeight: .infinity)
            }
        }
    }
}

struct SalesFunnelView: View {
    let funnel: DashboardFunnel
    struct Step: Identifiable { let label: String; let value: Double; let color: Color; var id: String { label } }
    private var steps: [Step] {
        [Step(label: "Zapytania", value: funnel.inquiries, color: Color(red: 0.96, green: 0.62, blue: 0.04)), Step(label: "Zapytania z ofertą", value: funnel.offers, color: Color(red: 0.38, green: 0.65, blue: 0.98)),
         Step(label: "Wygrane zapytania", value: funnel.acceptedOffers, color: Color(red: 0.20, green: 0.83, blue: 0.60)), Step(label: "Powiązane wydarzenia", value: funnel.events, color: CrmTheme.rgb(0xd3bb73))]
    }
    var body: some View {
        DashboardPanel(title: "Lejek sprzedaży", subtitle: "Zapytania utworzone w ostatnich 12 miesiącach: od etapu oferty do wygranej i powiązanego wydarzenia. Liczby dotyczą zapytań, nie liczby dokumentów ofertowych.") {
            Chart {
                ForEach(steps) { step in
                    BarMark(x: .value("Liczba zapytań", step.value), y: .value("Etap", step.label))
                        .foregroundStyle(step.color).cornerRadius(4)
                        .annotation(position: .trailing) { Text("\(Int(step.value))").font(.caption).foregroundStyle(.secondary) }
                }
            }.chartXAxis(.hidden).frame(height: 180)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack { Text(step.label).font(.caption).foregroundStyle(.secondary); Spacer(); Text("\(Int(step.value))").font(.caption.weight(.semibold)) }
                        if index > 0, steps[index - 1].value > 0, step.value <= steps[index - 1].value {
                            Text("\(Int((step.value / steps[index - 1].value * 100).rounded()))% poprzedniego etapu").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }.padding(10).background(Color.black.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

struct AttentionView: View {
    let attention: DashboardAttention
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    var body: some View {
        DashboardPanel(title: "Wymaga działania", subtitle: "Najważniejsze sprawy operacyjne", symbol: "checkmark.circle") {
            ForEach(items) { item in
                Button { open(item.href) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.symbol).foregroundStyle(item.color).frame(width: 22)
                        Text(item.label).font(.callout).foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(item.value))").font(.title3.weight(.light)).monospacedDigit()
                    }.padding(10).background(theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }
    struct Item: Identifiable { let label: String; let value: Double; let href: String; let symbol: String; let color: Color; var id: String { label } }
    private var items: [Item] {
        [Item(label: "Procesy wydarzeń po terminie", value: attention.workflowRisks, href: "/crm/events", symbol: "flowchart", color: .red),
         Item(label: "Klienci bez opiekuna", value: attention.unownedCustomers, href: "/crm/contacts", symbol: "person.crop.circle.badge.xmark", color: .pink),
         Item(label: "Zaniedbane szanse sprzedażowe", value: attention.neglectedOpportunities, href: "/crm/inquiries", symbol: "waveform.path.ecg", color: .purple),
         Item(label: "Zaległe kontakty z zapytań", value: attention.overdueInquiries, href: "/crm/inquiries", symbol: "tray", color: .orange),
         Item(label: "Zadania po terminie", value: attention.overdueTasks, href: "/crm/tasks", symbol: "exclamationmark.triangle", color: .red),
         Item(label: "Faktury po terminie", value: attention.overdueInvoices, href: "/crm/invoices", symbol: "doc.text", color: .orange),
         Item(label: "Wydarzenia w ciągu 30 dni", value: attention.eventsNext30Days, href: "/crm/events", symbol: "calendar.badge.clock", color: CrmTheme.rgb(0xd3bb73))]
    }
    private func open(_ href: String) {
        let map: [String: Module] = ["/crm/events": .events, "/crm/contacts": .contacts, "/crm/inquiries": .inquiries, "/crm/tasks": .tasks]
        if let module = map[href], state.employee?.canView(module) == true { state.switchSection(module) } else { state.openCRM(href) }
    }
}
