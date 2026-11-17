import SwiftUI
import Charts

// MARK: Marketing i ADS — 1:1 z `MarketingWorkspace`: marka (zapamiętywana), „Synchronizuj”, „Integracje” (ustawienia marki
// w CRM — połączenie kont wymaga logowania w przeglądarce), zakładki Przegląd (test ruchu, wyniki 30 dni, kliknięcia
// i widoczność według źródła — 14 dni, stan integracji, efektywność, wyniki według kanału), Kampanie (wstrzymanie i
// uruchomienie u dostawcy), Wiadomości (oznaczanie jako przeczytane) i Analiza AI.

private struct MarketingChartRow: Identifiable {
    let date: String
    let source: String
    let value: Double
    var id: String { date + source }
}

private let marketingSeries: [(key: String, label: String, color: Color)] = [
    ("meta", "Meta Ads", CrmTheme.rgb(0xd94c75)), ("google", "Google Ads", CrmTheme.rgb(0x6ea8fe)), ("organic", "Search Console", CrmTheme.rgb(0xd3bb73)),
]

private struct MarketingSeriesTotal {
    let label: String
    let color: Color
    let total: Double
}

/// Sumy kanałów z ostatnich 30 dni (jak `channelTotals` w CRM).
struct MarketingChannelTotals {
    var metaImpressions = 0.0, metaClicks = 0.0, metaSpend = 0.0, metaConversions = 0.0
    var googleImpressions = 0.0, googleClicks = 0.0, googleSpend = 0.0, googleConversions = 0.0
    var organicImpressions = 0.0, organicClicks = 0.0
    var pageImpressions = 0.0, pageEngagement = 0.0, pageMessages = 0.0
    var paidImpressions: Double { metaImpressions + googleImpressions }
    var paidClicks: Double { metaClicks + googleClicks }
    var paidSpend: Double { metaSpend + googleSpend }
    var paidConversions: Double { metaConversions + googleConversions }
}

/// Test ruchu zapisany w ustawieniach integracji Google (`traffic_test`).
struct MarketingTrafficTest {
    let name: String
    let start: String
    let end: String
    let budget: Double
    let baselineStart: String
    let baselineEnd: String
    let values: [(String, Double)]

    init?(_ overview: MarketingOverview) {
        let test = overview.integrations.first { $0.provider == "google" }?.settings?["traffic_test"]?.object ?? [:]
        let baseline = test["baseline"]?.object ?? [:]
        guard let name = test["name"]?.text.nonEmpty, !baseline.isEmpty, case .number(let budget) = test["budgetTotalPLN"] ?? .null else { return nil }
        let date = { (value: String) -> String in DayDates.parse(value).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? "—" }
        self.name = name
        self.budget = budget
        start = date(test["startDate"]?.text ?? "")
        end = date(test["endDate"]?.text ?? "")
        baselineStart = date(baseline["startDate"]?.text ?? "")
        baselineEnd = date(baseline["endDate"]?.text ?? "")
        values = [("Kliknięcia — cała witryna", baseline["siteClicks"]?.number ?? 0), ("Wyświetlenia — cała witryna", baseline["siteImpressions"]?.number ?? 0),
                  ("Kliknięcia — strona główna", baseline["homeClicks"]?.number ?? 0), ("Wyświetlenia — strona główna", baseline["homeImpressions"]?.number ?? 0)]
    }
}

@MainActor struct MarketingWorkspaceView: View {
    @ObservedObject var store: WebsiteStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab = "overview"
    @State private var syncing = false
    @State private var analysing = false
    @State private var updating: String?
    @State private var starting: MarketingCampaign?

    private var overview: MarketingOverview? { store.marketing }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let overview {
                    if overview.companies.isEmpty {
                        ContentUnavailableView {
                            Label("Brak dostępnej marki", systemImage: "building.2")
                        } description: {
                            Text("Dodaj aktywną markę lub nadaj pracownikowi dostęp do firmy.")
                        } actions: {
                            Button("Przejdź do firm") { state.openCRM("/crm/settings/my-companies") }
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        header(overview)
                        Picker("Widok", selection: $tab) {
                            Text("Przegląd").tag("overview")
                            Text("Kampanie").tag("campaigns")
                            Text("Wiadomości (\(overview.unreadMessages))").tag("messages")
                            Text("Analiza AI").tag("ai")
                        }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                        switch tab {
                        case "campaigns": campaigns(overview)
                        case "messages": messages(overview)
                        case "ai": analysis(overview)
                        default: overviewTab(overview)
                        }
                    }
                } else if let error = store.marketingError {
                    ContentUnavailableView {
                        Label("Marketing i ADS", systemImage: "gauge.with.needle")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadMarketing(companyID: nil) } }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    ProgressView("Ładowanie centrum marketingowego…").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .task(id: state.employee?.id) { if store.marketing == nil { await store.loadMarketing(companyID: nil) } }
        .confirmationDialog("Uruchomić kampanię?", isPresented: Binding(get: { starting != nil }, set: { if !$0 { starting = nil } }), titleVisibility: .visible) {
            if let campaign = starting {
                Button("Uruchom kampanię") { Task { await toggle(campaign) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Uruchomienie kampanii „\(starting?.name ?? "")” włącza emisję i wydatki u dostawcy.") }
    }

    private var companyID: String? { overview?.selectedCompanyId }

    // MARK: Nagłówek

    private func header(_ overview: MarketingOverview) -> some View {
        let company = overview.companies.first { $0.id == overview.selectedCompanyId }
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Label("MARKETING I ADS", systemImage: "gauge.with.needle").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                Text(company?.name ?? "Wybrana marka").font(.title2.weight(.light))
                Text("Facebook, kampanie reklamowe, SEO i rekomendacje w jednym miejscu.").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if store.loadingMarketing { ProgressView().controlSize(.small) }
            Picker("Marka", selection: Binding(get: { overview.selectedCompanyId ?? "" }, set: { selectCompany($0) })) {
                ForEach(overview.companies) { Text($0.name + ($0.isDefault ? " · domyślna" : "")).tag($0.id) }
            }
            .labelsHidden().frame(maxWidth: 260)
            if overview.canManage {
                Button(syncing ? "Synchronizuję" : "Synchronizuj", systemImage: "arrow.clockwise") { Task { await sync() } }
                    .disabled(syncing || !overview.integrations.contains { $0.status != "not_connected" })
            }
            if let id = overview.selectedCompanyId {
                Button("Integracje", systemImage: "gearshape") { state.openCRM("/crm/settings/my-companies/\(id)/marketing") }
                    .help("Połączenia kont i ustawienia analizy (otwiera się w CRM)")
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Przegląd

    private func totals(_ overview: MarketingOverview) -> MarketingChannelTotals {
        var result = MarketingChannelTotals()
        for metric in overview.metrics {
            switch metric.source {
            case "meta_ads":
                result.metaImpressions += metric.impressions; result.metaClicks += metric.clicks
                result.metaSpend += metric.spend; result.metaConversions += metric.conversions
            case "google_ads":
                result.googleImpressions += metric.impressions; result.googleClicks += metric.clicks
                result.googleSpend += metric.spend; result.googleConversions += metric.conversions
            case "google_search_console":
                result.organicImpressions += metric.organicImpressions; result.organicClicks += metric.organicClicks
            case "meta_page":
                result.pageImpressions += metric.impressions; result.pageEngagement += metric.engagement; result.pageMessages += metric.messages
            default: break
            }
        }
        return result
    }

    /// Wiersze wykresu z ostatnich 14 dni: `clicks` — kliknięcia (organiczne z Search Console), inaczej wyświetlenia.
    private func chartRows(_ overview: MarketingOverview, clicks: Bool) -> [MarketingChartRow] {
        var byDate: [String: [String: Double]] = [:]
        for metric in overview.metrics {
            var row = byDate[metric.date] ?? ["meta": 0, "google": 0, "organic": 0]
            switch metric.source {
            case "meta_ads": row["meta", default: 0] += clicks ? metric.clicks : metric.impressions
            case "google_ads": row["google", default: 0] += clicks ? metric.clicks : metric.impressions
            case "google_search_console": row["organic", default: 0] += clicks ? metric.organicClicks : metric.organicImpressions
            default: break
            }
            byDate[metric.date] = row
        }
        let dates = byDate.keys.sorted().suffix(14)
        return dates.flatMap { date in
            marketingSeries.map { series in MarketingChartRow(date: date, source: series.label, value: byDate[date]?[series.key] ?? 0) }
        }
    }

    private func overviewTab(_ overview: MarketingOverview) -> some View {
        let t = totals(overview)
        return VStack(alignment: .leading, spacing: 16) {
            if let test = MarketingTrafficTest(overview) { trafficTest(test) }
            resultsCard(overview, t)
            HStack(alignment: .top, spacing: 16) {
                chartCard("Kliknięcia według źródła", "Meta Ads, Google Ads i bezpłatne wyniki Google · ostatnie 14 dni", rows: chartRows(overview, clicks: true),
                          unit: "kliknięć", empty: "Źródła są zsynchronizowane, ale nie zwróciły kliknięć w ostatnich 14 dniach.")
                VStack(spacing: 12) {
                    integrationCard(overview, provider: "meta")
                    integrationCard(overview, provider: "google")
                }
                .frame(width: 300)
            }
            HStack(alignment: .top, spacing: 16) {
                chartCard("Widoczność według źródła", "Wyświetlenia reklam i wyników w wyszukiwarce · ostatnie 14 dni", rows: chartRows(overview, clicks: false),
                          unit: "wyświetleń", empty: "Źródła są zsynchronizowane, ale nie zwróciły wyświetleń w ostatnich 14 dniach.")
                efficiencyCard(t)
            }
            channelsCard(overview, t)
        }
    }

    private func resultsCard(_ overview: MarketingOverview, _ t: MarketingChannelTotals) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Najważniejsze wyniki marketingowe").font(.headline)
                Spacer()
                Text("Ostatnie 30 dni").font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 10)], spacing: 10) {
                statTile("Wyświetlenia reklam", WebsiteFormat.number(t.paidImpressions), "eye")
                statTile("Kliknięcia reklam", WebsiteFormat.number(overview.totals.clicks), "cursorarrow.click")
                statTile("Wydatki reklamowe", WebsiteFormat.currency(overview.totals.spend), "creditcard")
                statTile("Konwersje", WebsiteFormat.number(overview.totals.conversions, digits: 1), "target")
                statTile("Kliknięcia organiczne", WebsiteFormat.number(overview.totals.organicClicks), "magnifyingglass")
                statTile("Nowe wiadomości", WebsiteFormat.count(overview.unreadMessages), "tray")
            }
            Text("Dane pochodzą bezpośrednio z Meta Ads, Google Ads, Facebook Page i Google Search Console. To wyniki raportowane przez te platformy — nie sesje ani użytkownicy mierzeni na stronie. Pomiar wizyt na stronie wymaga osobnej integracji z Google Analytics 4.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func efficiencyCard(_ t: MarketingChannelTotals) -> some View {
        let ctr: String = t.paidImpressions > 0 ? WebsiteFormat.percent(t.paidClicks / t.paidImpressions * 100) : "—"
        let cpc: String = t.paidClicks > 0 ? WebsiteFormat.currency(t.paidSpend / t.paidClicks) : "—"
        let cpa: String = t.paidConversions > 0 ? WebsiteFormat.currency(t.paidSpend / t.paidConversions) : "—"
        let organic: String = t.organicImpressions > 0 ? WebsiteFormat.percent(t.organicClicks / t.organicImpressions * 100) : "—"
        return VStack(alignment: .leading, spacing: 10) {
            Text("Efektywność").font(.headline)
            Text("Wskaźniki wyliczone z danych z ostatnich 30 dni").font(.caption).foregroundStyle(.secondary)
            kpi("CTR reklam", ctr, "Kliknięcia / wyświetlenia reklam")
            kpi("Śr. koszt kliknięcia", cpc, "Wydatki / kliknięcia reklam")
            kpi("Koszt konwersji", cpa, "Wydatki / konwersje")
            kpi("CTR organiczny", organic, "Kliknięcia / wyświetlenia Search Console")
        }
        .padding(16)
        .frame(width: 300, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func channelsCard(_ overview: MarketingOverview, _ t: MarketingChannelTotals) -> some View {
        let organicCTR: String = t.organicImpressions > 0 ? WebsiteFormat.percent(t.organicClicks / t.organicImpressions * 100) : "—"
        let position: String = overview.totals.averagePosition > 0 ? WebsiteFormat.number(overview.totals.averagePosition, digits: 1) : "—"
        let meta: [(String, String)] = [("Wyświetlenia", WebsiteFormat.number(t.metaImpressions)), ("Kliknięcia", WebsiteFormat.number(t.metaClicks)),
                                        ("Wydatki", WebsiteFormat.currency(t.metaSpend)), ("Konwersje", WebsiteFormat.number(t.metaConversions, digits: 1))]
        let google: [(String, String)] = [("Wyświetlenia", WebsiteFormat.number(t.googleImpressions)), ("Kliknięcia", WebsiteFormat.number(t.googleClicks)),
                                          ("Wydatki", WebsiteFormat.currency(t.googleSpend)), ("Konwersje", WebsiteFormat.number(t.googleConversions, digits: 1))]
        let search: [(String, String)] = [("Wyświetlenia", WebsiteFormat.number(t.organicImpressions)), ("Kliknięcia", WebsiteFormat.number(t.organicClicks)),
                                          ("CTR", organicCTR), ("Śr. pozycja", position)]
        let page: [(String, String)] = [("Wyświetlenia strony", WebsiteFormat.number(t.pageImpressions)), ("Zaangażowania", WebsiteFormat.number(t.pageEngagement)),
                                        ("Nowe rozmowy", WebsiteFormat.number(t.pageMessages))]
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wyniki według kanału").font(.headline)
                    Text("Dokładne źródło każdej grupy danych").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("Ostatnie 30 dni").font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 10)], spacing: 10) {
                channel("Meta Ads", "Reklamy Facebook i Instagram", meta)
                channel("Google Ads", "Płatne kampanie Google", google)
                channel("Search Console", "Bezpłatne wyniki wyszukiwarki", search)
                channel("Facebook Page", "Organiczna aktywność strony", page)
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func statTile(_ title: String, _ value: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: symbol).foregroundStyle(theme.accent)
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold).monospacedDigit())
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func chartCard(_ title: String, _ subtitle: String, rows: [MarketingChartRow], unit: String, empty: String) -> some View {
        let sums: [MarketingSeriesTotal] = marketingSeries.map { series in
            let values: [Double] = rows.filter { $0.source == series.label }.map(\.value)
            return MarketingSeriesTotal(label: series.label, color: series.color, total: values.reduce(0, +))
        }
        let grand: Double = sums.map(\.total).reduce(0, +)
        let hasValues = grand > 0
        return VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
            if rows.isEmpty || !hasValues {
                Text(rows.isEmpty ? "Połącz źródła i uruchom pierwszą synchronizację." : empty).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 200)
            } else {
                Chart(rows) { row in
                    BarMark(x: .value("Dzień", WebsiteFormat.day(row.date)), y: .value(unit, row.value))
                        .foregroundStyle(by: .value("Źródło", row.source))
                        .position(by: .value("Źródło", row.source))
                }
                .chartForegroundStyleScale(["Meta Ads": marketingSeries[0].color, "Google Ads": marketingSeries[1].color, "Search Console": marketingSeries[2].color])
                .frame(height: 240)
                HStack(spacing: 14) {
                    ForEach(sums, id: \.label) { sum in
                        HStack(spacing: 4) {
                            Circle().fill(sum.color).frame(width: 8, height: 8)
                            Text("\(sum.label): ") + Text(WebsiteFormat.number(sum.total)).fontWeight(.semibold)
                        }
                    }
                    Text("Razem: ") + Text(WebsiteFormat.number(grand)).fontWeight(.semibold)
                }
                .font(.caption)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func integrationCard(_ overview: MarketingOverview, provider: String) -> some View {
        let integration = overview.integrations.first { $0.provider == provider }
        let connected = integration?.status == "connected"
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: provider == "meta" ? "f.circle" : "magnifyingglass").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(provider == "meta" ? "Meta / Facebook" : "Google").fontWeight(.semibold)
                    Text(provider == "meta" ? "Wiadomości, statystyki i reklamy" : "Search Console i Google Ads").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(connected ? "Połączona" : integration.map { MarketingLabels.status($0.status) } ?? "Niepołączona")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(connected ? CrmTheme.rgb(0x4ade80) : .secondary)
            }
            Text(WebsiteFormat.dateTime(integration?.lastSyncedAt)).font(.caption).foregroundStyle(.secondary)
            if integration?.status == "error", let error = integration?.lastError, !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(12)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func kpi(_ label: String, _ value: String, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold).monospacedDigit())
            Text(hint).font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func channel(_ title: String, _ subtitle: String, _ metrics: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).fontWeight(.semibold)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
            ForEach(metrics, id: \.0) { metric in
                HStack {
                    Text(metric.0).font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Text(metric.1).font(.callout.monospacedDigit())
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    /// Test ruchu (`settings.traffic_test` integracji Google) — jak `MarketingTrafficTest`.
    private func trafficTest(_ test: MarketingTrafficTest) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(test.name).font(.headline)
                    Text("Planowany okres: \(test.start)–\(test.end). Termin pierwszego wyświetlenia zależy od zatwierdzenia reklam.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("Budżet całkowity: \(WebsiteFormat.number(test.budget)) zł").foregroundStyle(theme.accent)
            }
            Text("Punkt odniesienia przed testem: \(test.baselineStart)–\(test.baselineEnd) · 28 dni · bezpłatne wyniki Google")
                .font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 24) {
                ForEach(test.values, id: \.0) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.0).font(.caption).foregroundStyle(.secondary)
                        Text(WebsiteFormat.number(item.1)).font(.title3)
                    }
                }
            }
            Text("Kliknięcia z reklam porównuj osobno od organicznych. Bieżące karty obejmują 30 dni; punkt odniesienia obejmuje 28 dni, więc nie porównuj samych sum jako procentowej zmiany. Kliknięcie nie oznacza sesji ani zapytania. Równoczesne zmiany treści i reklamy nie pozwalają przypisać całego wzrostu jednemu działaniu.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Kampanie, wiadomości, analiza AI

    private func campaigns(_ overview: MarketingOverview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Kampanie reklamowe").font(.headline)
            Text("Wyniki z ostatnich 30 dni. Konwersje pochodzą z konfiguracji Google Ads lub Meta i nie muszą oznaczać pozyskanych klientów. Uruchomienie kampanii włącza emisję i wydatki u dostawcy.")
                .font(.caption).foregroundStyle(.secondary)
            if overview.campaigns.isEmpty {
                Text("Brak zsynchronizowanych kampanii. Sprawdź stan integracji i wybrane konto reklamowe. Nowe kampanie pojawią się po synchronizacji również przed pierwszym wyświetleniem.")
                    .foregroundStyle(.secondary).padding(20)
            }
            ForEach(overview.campaigns) { campaign in campaignRow(campaign, canManage: overview.canManage) }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func campaignRow(_ campaign: MarketingCampaign, canManage: Bool) -> some View {
        let code = campaign.currency?.nonEmpty ?? "PLN"
        let money = { (value: Double) in WebsiteFormat.currency(value, code) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(campaign.name).fontWeight(.semibold)
                    Text("\(campaign.provider == "google_ads" ? "Google Ads" : "Meta Ads") · \(MarketingLabels.objectives[campaign.objective ?? ""] ?? "Kampania reklamowa") · \(MarketingLabels.status(campaign.status))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if canManage && campaign.toggleable {
                    Button {
                        if campaign.active { Task { await toggle(campaign) } } else { starting = campaign }
                    } label: {
                        if updating == campaign.id { ProgressView().controlSize(.small) }
                        else { Label(campaign.active ? "Wstrzymaj" : "Uruchom", systemImage: campaign.active ? "pause.fill" : "play.fill") }
                    }
                    .disabled(updating == campaign.id)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 8) {
                metric("Wyświetlenia", WebsiteFormat.number(campaign.impressions))
                metric("Kliknięcia", WebsiteFormat.number(campaign.clicks))
                metric("CTR", campaign.impressions > 0 ? WebsiteFormat.percent(campaign.clicks / campaign.impressions * 100) : "—")
                metric("Wydatki", money(campaign.spend))
                metric("Śr. koszt kliknięcia", campaign.clicks > 0 ? money(campaign.spend / campaign.clicks) : "—")
                metric("Konwersje", WebsiteFormat.number(campaign.conversions, digits: 1))
                metric("Koszt konwersji", campaign.conversions > 0 ? money(campaign.spend / campaign.conversions) : "—")
            }
            if let lifetime = campaign.budgetLifetime {
                Text("Budżet całkowity kampanii: \(money(lifetime))").font(.caption).foregroundStyle(.secondary)
            } else if let daily = campaign.budgetDaily {
                Text("Średni budżet dzienny: \(money(daily))").font(.caption).foregroundStyle(.secondary)
            }
            Text("Ostatnia synchronizacja: \(WebsiteFormat.dateTime(campaign.syncedAt))").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.monospacedDigit())
        }
    }

    private func messages(_ overview: MarketingOverview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nowe wiadomości Facebook").font(.headline)
                    Text("Powiadomienia są tworzone automatycznie przez webhook Meta.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "tray").foregroundStyle(theme.accent)
            }
            if overview.messages.isEmpty { Text("Brak nowych wiadomości.").foregroundStyle(.secondary).padding(20) }
            ForEach(overview.messages) { message in
                Button { Task { await markRead(message) } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            if !message.isRead { Circle().fill(theme.accent).frame(width: 7, height: 7) }
                            Text(message.senderName?.nonEmpty ?? "Kontakt z Facebooka").fontWeight(message.isRead ? .regular : .semibold)
                            Spacer()
                            Text(WebsiteFormat.dateTime(message.receivedAt)).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(message.preview).foregroundStyle(.secondary).lineLimit(3)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                .help(message.isRead ? "" : "Kliknij, aby oznaczyć jako przeczytaną")
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func analysis(_ overview: MarketingOverview) -> some View {
        let settingsAction = { if let id = overview.selectedCompanyId { state.openCRM("/crm/settings/my-companies/\(id)/marketing") } }
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Kierunek rekomendowany przez AI", systemImage: "sparkles").font(.headline)
                        Text("Analiza korzysta wyłącznie z zagregowanych wyników, bez treści wiadomości i danych klientów.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if overview.canManage && overview.settings.aiAnalysisEnabled {
                        Button(analysing ? "Analizuję…" : "Nowa analiza", systemImage: "sparkles") { Task { await analyse() } }
                            .buttonStyle(.borderedProminent).disabled(analysing)
                    }
                }
                if !overview.settings.aiAnalysisEnabled {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Analiza AI jest domyślnie wyłączona. Administrator może świadomie włączyć przekazywanie zagregowanych wyników w ustawieniach marki.")
                        Button("Ustawienia marki", action: settingsAction).buttonStyle(.link)
                    }
                    .foregroundStyle(.secondary)
                } else if let insight = overview.latestInsight {
                    Text(insight.summary).textSelection(.enabled)
                    ForEach(Array(insight.recommendations.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Circle().fill(item.priority == "high" ? CrmTheme.rgb(0xf87171) : item.priority == "medium" ? CrmTheme.rgb(0xfbbf24) : CrmTheme.rgb(0x4ade80))
                                    .frame(width: 8, height: 8)
                                Text(item.title).fontWeight(.semibold)
                            }
                            Text(item.rationale).font(.callout).foregroundStyle(.secondary)
                            if let channel = item.channel?.nonEmpty { Text(channel).font(.caption).foregroundStyle(theme.accent) }
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                    Text("Wygenerowano \(WebsiteFormat.dateTime(insight.createdAt))").font(.caption).foregroundStyle(.tertiary)
                } else {
                    Text("Uruchom pierwszą analizę po synchronizacji źródeł.").foregroundStyle(.secondary)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 12) {
                if let insight = overview.latestInsight {
                    insightList("Szanse", insight.opportunities, "checkmark.circle")
                    insightList("Ryzyka", insight.risks, "target")
                }
                Button(action: settingsAction) { Label("Ustawienia analizy i źródeł", systemImage: "arrow.up.right.square") }.buttonStyle(.link)
            }
            .frame(width: 300, alignment: .topLeading)
        }
    }

    private func insightList(_ title: String, _ values: [String], _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.headline)
            ForEach(Array(values.enumerated()), id: \.offset) { _, value in Text("• \(value)").font(.callout).foregroundStyle(.secondary) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Czynności

    private func selectCompany(_ id: String) {
        guard !id.isEmpty, id != overview?.selectedCompanyId else { return }
        // Zapamiętanie marki i wczytanie jej danych równocześnie (jak `selectCompany` w CRM).
        Task { _ = try? await store.post("marketingCompany", ["companyId": .string(id)]) }
        Task { await store.loadMarketing(companyID: id) }
    }

    private func sync() async {
        guard let companyID else { return }
        syncing = true
        _ = await store.run("Synchronizacja danych marketingowych…", "marketingSync", ["companyId": .string(companyID)])
        await store.loadMarketing(companyID: companyID)
        syncing = false
    }

    private func toggle(_ campaign: MarketingCampaign) async {
        guard let companyID else { return }
        updating = campaign.id
        if await store.run(campaign.active ? "Wstrzymywanie kampanii…" : "Uruchamianie kampanii…", "marketingCampaign",
                           ["companyId": .string(companyID), "campaignId": .string(campaign.id), "status": .string(campaign.active ? "PAUSED" : "ACTIVE")]) != nil {
            await store.loadMarketing(companyID: companyID)
        }
        updating = nil
    }

    private func markRead(_ message: MarketingMessage) async {
        guard let companyID, !message.isRead else { return }
        _ = try? await store.post("marketingMessageRead", ["companyId": .string(companyID), "messageId": .string(message.id)])
        await store.loadMarketing(companyID: companyID)
    }

    private func analyse() async {
        guard let companyID else { return }
        analysing = true
        if await store.run("Przygotowanie analizy AI…", "marketingAnalysis", ["companyId": .string(companyID)]) != nil {
            await store.loadMarketing(companyID: companyID)
        }
        analysing = false
    }
}
