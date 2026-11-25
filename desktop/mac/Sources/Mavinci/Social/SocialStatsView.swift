import SwiftUI

// MARK: Social media → „Statystyki” — 1:1 z CRM (`SocialStats.tsx`): wyniki postów opublikowanych w okresie (7 / 28 / 90 dni)
// wobec poprzedniego okresu, przyrost dzienny, kanały, najlepsze posty, najlepsze pory publikacji z własnych wyników
// i raport tygodniowy „Trendy i rekomendacje”, na górze „Zainteresowanie marką” (`SocialBrandInterestView.swift`).
// Kopia ostatnich statystyk na dysku (widok od razu, także bez internetu).

@MainActor struct SocialStatsView: View {
    @ObservedObject var store: SocialStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var chartInteractions = false

    var body: some View {
        Group {
            if let stats = store.stats {
                content(stats)
            } else if let error = store.statsError {
                ContentUnavailableView {
                    Label("Statystyki", systemImage: "chart.bar")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadStats() } }
                }
            } else {
                ProgressView("Wczytuję statystyki…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(store.home?.company.id ?? "")|\(store.statsDays)|\(store.statsReportID ?? "")") { await store.loadStats() }
    }

    private func content(_ stats: SocialStats) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                toolbar(stats)
                warnings(stats)
                if let brand = stats.brand {
                    SocialBrandInterestCard(
                        brand: brand,
                        days: stats.range.days,
                        onRefresh: { Task { await store.refreshBrand() } },
                        onSaveTerms: { await store.saveBrandTerms($0) }
                    )
                }
                kpis(stats)
                HStack(alignment: .top, spacing: 14) {
                    timelineCard(stats).frame(maxWidth: .infinity)
                    bestTimesCard(stats).frame(width: 420)
                }
                topPostsCard(stats)
                reportCard(stats)
            }
            .padding(.bottom, 12)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    // MARK: Pasek: zakres, odświeżenie, raport
    private func toolbar(_ stats: SocialStats) -> some View {
        HStack(spacing: 12) {
            Picker("Zakres", selection: $store.statsDays) {
                ForEach(SocialNumbers.ranges, id: \.self) { days in Text("\(days) dni").tag(days) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 240)
            if store.statsLoading { ProgressView().controlSize(.small) }
            Text(rangeNote(stats)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 8)
            if stats.canRefresh {
                Button { Task { await store.refreshStats() } } label: { Label("Odśwież z Meta", systemImage: "arrow.clockwise") }
            }
            if stats.canGenerate {
                Button { Task { await store.generateReport() } } label: { Label("Raport za poprzedni tydzień", systemImage: "doc.text") }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private func rangeNote(_ stats: SocialStats) -> String {
        var text = "Wyniki postów opublikowanych w ostatnich \(stats.range.days) dniach (stan na dziś) wobec \(stats.range.days) dni wcześniej."
        if let synced = stats.sync.lastSyncedAt { text += " Ostatnie pobranie z Meta: \(SocialDates.dateTime(synced))." }
        return text
    }

    @ViewBuilder private func warnings(_ stats: SocialStats) -> some View {
        let insights = stats.insights
        if !insights.connected || !insights.missingScopes.isEmpty || !stats.sync.problems.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 3) {
                    if !insights.connected {
                        Text("Meta nie jest połączona z marką — statystyki pojawią się po połączeniu konta w ustawieniach marketingu marki.")
                    } else if !insights.missingScopes.isEmpty {
                        Text("Brakuje uprawnień Meta do statystyk: \(insights.missingScopes.joined(separator: ", ")). Bez nich: Facebook — tylko reakcje, komentarze i udostępnienia; Instagram — tylko polubienia i komentarze. Dodaj je w konfiguracji logowania aplikacji Meta i kliknij „Odśwież dostęp” przy Meta.")
                    }
                    ForEach(stats.sync.problems, id: \.self) { problem in Text(problem) }
                }
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button { state.openCRM("/crm/settings/my-companies/\(stats.company.id)/marketing") } label: {
                    Label("Ustawienia Meta", systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.link).font(.caption)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.4)))
        }
    }

    // MARK: Kafelki
    private func changeLabel(_ current: Double?, _ previous: Double?) -> some View {
        let label = SocialNumbers.change(current, previous)
        let color: Color = label == nil || label == "0%" ? .secondary : (label?.hasPrefix("−") == true ? .red : .green)
        let symbol = label?.hasPrefix("−") == true ? "arrow.down.right" : "arrow.up.right"
        return Group {
            if let label {
                Label(label, systemImage: symbol).font(.caption).foregroundStyle(color).help("Wobec poprzedniego okresu")
            } else {
                Text(" ").font(.caption)
            }
        }
    }

    private func tile(_ title: String, _ value: String, current: Double?, previous: Double?, hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.light)).monospacedDigit()
            changeLabel(current, previous)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
        .help(hint ?? "")
    }

    private func kpis(_ stats: SocialStats) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], spacing: 10) {
            tile("Opublikowane posty", SocialNumbers.number(stats.totals.posts), current: Double(stats.totals.posts), previous: Double(stats.previous.posts))
            ForEach(SocialMetric.kpis) { metric in
                tile(metric.label, SocialNumbers.number(stats.totals.metrics[metric]), current: stats.totals.metrics[metric],
                     previous: stats.previous.metrics[metric], hint: metric.hint)
            }
        }
    }

    // MARK: Przyrost dzienny i kanały
    private func timelineCard(_ stats: SocialStats) -> some View {
        card {
            HStack(spacing: 8) {
                Label("Przyrost dzienny", systemImage: "chart.bar").font(.headline)
                Spacer()
                Picker("Metryka", selection: $chartInteractions) {
                    Text(SocialMetric.views.label).tag(false)
                    Text(SocialMetric.interactions.label).tag(true)
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 230)
                Text("Zaangażowanie: \(SocialNumbers.percent(stats.totals.rate))").font(.caption).foregroundStyle(.secondary)
                changeLabel(stats.totals.rate, stats.previous.rate)
            }
            barChart(stats.timeline)
            if !stats.channels.isEmpty { channelsTable(stats.channels) }
        }
    }

    private func dayLabel(_ date: String) -> String {
        let parts = date.split(separator: "-")
        return parts.count == 3 ? "\(parts[2]).\(parts[1])" : date
    }

    private func barChart(_ points: [SocialTimelinePoint]) -> some View {
        let values = points.map { chartInteractions ? $0.interactions : $0.views }
        let top = max(values.max() ?? 0, 1)
        let empty = values.allSatisfy { $0 == 0 }
        return VStack(alignment: .leading, spacing: 4) {
            ZStack {
                GeometryReader { proxy in
                    HStack(alignment: .bottom, spacing: points.count > 40 ? 1 : 3) {
                        ForEach(points.indices, id: \.self) { index in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(theme.accent.opacity(values[index] > 0 ? 0.85 : 0.15))
                                .frame(height: max(2, proxy.size.height * CGFloat(values[index] / top)))
                                .frame(maxWidth: .infinity)
                                .help("\(dayLabel(points[index].date)): \(SocialNumbers.number(values[index]))")
                        }
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)
                }
                if empty { Text("Brak wyników w tym okresie.").font(.caption).foregroundStyle(.secondary) }
            }
            .frame(height: 180)
            HStack {
                Text(points.first.map { dayLabel($0.date) } ?? "")
                Spacer()
                Text("najwięcej: \(SocialNumbers.number(values.max() ?? 0))")
                Spacer()
                Text(points.last.map { dayLabel($0.date) } ?? "")
            }
            .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func channelsTable(_ channels: [SocialChannelTotals]) -> some View {
        let metrics: [SocialMetric] = [.views, .reach, .interactions, .saves]
        return Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 6) {
            GridRow {
                columnTitle("Kanał").gridColumnAlignment(.leading)
                columnTitle("Posty")
                ForEach(metrics) { metric in columnTitle(metric.label) }
                columnTitle("Zaangażowanie")
            }
            Divider()
            ForEach(channels) { item in
                GridRow {
                    Text(item.channel.label).gridColumnAlignment(.leading)
                    Text("\(item.totals.publications)").monospacedDigit()
                    ForEach(metrics) { metric in Text(SocialNumbers.number(item.totals.metrics[metric])).monospacedDigit() }
                    Text(SocialNumbers.percent(item.totals.rate)).monospacedDigit()
                }
            }
        }
        .font(.callout)
        .padding(.top, 4)
    }

    private func columnTitle(_ title: String) -> some View { Text(title).font(.caption).foregroundStyle(.secondary) }

    // MARK: Najlepsze pory
    private func bestTimesCard(_ stats: SocialStats) -> some View {
        let best = stats.bestTimes
        let maxRate = best.cells.map(\.rate).max() ?? 0
        return card {
            Label("Najlepsze pory publikacji", systemImage: "clock").font(.headline)
            Text("Z własnych wyników z 6 miesięcy (posty w feedzie, bez relacji): średni wskaźnik zaangażowania posta opublikowanego w danej porze.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if best.top.isEmpty {
                Text("Za mało danych: \(best.sample) z \(best.minSample) postów z wynikami (i co najmniej 2 posty w jednej porze).")
                    .font(.caption).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            } else {
                ForEach(Array(best.top.enumerated()), id: \.element.id) { entry in
                    HStack(spacing: 8) {
                        Text("\(entry.offset + 1).").foregroundStyle(theme.accent)
                        Text(entry.element.label.prefix(1).uppercased() + String(entry.element.label.dropFirst()))
                        Spacer()
                        Text(SocialNumbers.percent(entry.element.rate)).monospacedDigit()
                        Text("\(entry.element.posts) \(SocialNumbers.plural(entry.element.posts, "post", "posty", "postów"))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                }
            }
            Grid(horizontalSpacing: 3, verticalSpacing: 3) {
                GridRow {
                    Text("")
                    ForEach(SocialNumbers.timeBands.indices, id: \.self) { band in
                        Text(SocialNumbers.timeBands[band]).font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                }
                ForEach(0..<7, id: \.self) { weekday in
                    GridRow {
                        Text(SocialNumbers.weekdaysShort[weekday]).font(.caption2).foregroundStyle(.secondary)
                        ForEach(0..<7, id: \.self) { band in
                            heatCell(best.cell(weekday, band), maxRate: maxRate)
                        }
                    }
                }
            }
        }
    }

    private func heatCell(_ cell: SocialBestTime?, maxRate: Double) -> some View {
        var strength = 0.0
        var help = "Brak postów"
        if let cell {
            strength = maxRate > 0 ? 0.15 + 0.85 * (cell.rate / maxRate) : 0.15
            let posts = SocialNumbers.plural(cell.posts, "post", "posty", "postów")
            help = "\(cell.label): \(SocialNumbers.percent(cell.rate)), \(cell.posts) \(posts), śr. zasięg \(SocialNumbers.number(cell.avgReach))"
        }
        return RoundedRectangle(cornerRadius: 3)
            .fill(cell == nil ? Color.primary.opacity(0.05) : theme.accent.opacity(strength))
            .frame(height: 22)
            .frame(maxWidth: .infinity)
            .overlay(Text(cell.map { "\($0.posts)" } ?? "").font(.system(size: 9)).foregroundStyle(strength > 0.6 ? Color.black.opacity(0.8) : Color.primary))
            .help(help)
    }

    // MARK: Najlepsze posty
    private func metricsLine(_ metrics: SocialMetricValues) -> String {
        let shown: [SocialMetric] = [.views, .reach, .interactions, .saves]
        let parts: [String] = shown.compactMap { metric -> String? in
            guard let value = metrics[metric] else { return nil }
            return "\(metric.label): \(SocialNumbers.number(value))"
        }
        return parts.isEmpty ? "Brak wyników z Meta" : parts.joined(separator: " · ")
    }

    private func channelsLine(_ channels: [SocialChannel]) -> String { channels.map(\.label).joined(separator: " · ") }

    private func topPostsCard(_ stats: SocialStats) -> some View {
        card {
            Label("Najlepsze posty okresu", systemImage: "chart.line.uptrend.xyaxis").font(.headline)
            if stats.topPosts.isEmpty {
                Text("W tym okresie nie opublikowano postów.").font(.callout).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 10)], alignment: .leading, spacing: 10) {
                    ForEach(stats.topPosts) { post in
                        Button { store.openPost(post.postId) } label: {
                            HStack(alignment: .top, spacing: 10) {
                                SocialImageView(url: post.thumbnailUrl).frame(width: 64, height: 80).clipShape(RoundedRectangle(cornerRadius: 6))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(post.title).lineLimit(1)
                                    Text(channelsLine(post.channels) + (post.publishedAt.map { " · " + SocialDates.dateTime($0) } ?? ""))
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    Text(metricsLine(post.metrics)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: Raport tygodniowy
    private func reportCard(_ stats: SocialStats) -> some View {
        card {
            HStack(spacing: 8) {
                Label("Trendy i rekomendacje — raport tygodniowy", systemImage: "lightbulb").font(.headline)
                if stats.report?.aiUsed == true {
                    Label("Analiza AI", systemImage: "sparkles").font(.caption2).foregroundStyle(theme.accent)
                        .padding(.horizontal, 6).padding(.vertical, 2).overlay(Capsule().stroke(theme.accent.opacity(0.4)))
                }
                Spacer()
                if !stats.reports.isEmpty {
                    Picker("Tydzień", selection: Binding(get: { stats.report?.id ?? "" }, set: { value in store.statsReportID = value.isEmpty ? nil : value })) {
                        ForEach(stats.reports) { item in Text(SocialNumbers.period(item.periodStart, item.periodEnd)).tag(item.id) }
                    }
                    .frame(width: 220)
                }
            }
            if let report = stats.report {
                reportBody(report)
            } else {
                Text(emptyReportText(stats)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func emptyReportText(_ stats: SocialStats) -> String {
        var text = "Raport przygotowuje się automatycznie w poniedziałek rano za poprzedni tydzień (gdy marka publikowała w ostatnich 5 tygodniach)."
        if stats.canGenerate { text += " Możesz też przygotować go teraz przyciskiem „Raport za poprzedni tydzień”." }
        if !stats.settings.aiReportsEnabled { text += " Analizę AI włącza akceptujący w „Szablony i AI”." }
        return text
    }

    @ViewBuilder private func reportBody(_ report: SocialReport) -> some View {
        Text("Tydzień \(SocialNumbers.period(report.periodStart, report.periodEnd)) · przygotowano \(SocialDates.dateTime(report.updatedAt ?? report.createdAt))")
            .font(.caption).foregroundStyle(.secondary)
        Text(report.summary).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        if let note = report.aiNote { Text(note).font(.caption).foregroundStyle(.secondary) }
        if let totals = report.totals {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                miniTile("Posty", SocialNumbers.number(totals.posts), current: Double(totals.posts), previous: report.previous.map { Double($0.posts) })
                ForEach(SocialMetric.kpis) { metric in
                    miniTile(metric.label, SocialNumbers.number(totals.metrics[metric]), current: totals.metrics[metric], previous: report.previous?.metrics[metric])
                }
            }
        }
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 12) {
                bulletSection("Trendy", report.trends, color: .primary)
                bulletSection("Ryzyka", report.risks, color: .red)
                bulletSection("Szanse", report.opportunities, color: .green)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !report.recommendations.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("REKOMENDACJE").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(report.recommendations, id: \.self) { item in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(item.priorityLabel).font(.caption2).foregroundStyle(item.priorityColor)
                                    .padding(.horizontal, 6).padding(.vertical, 1).overlay(Capsule().stroke(item.priorityColor.opacity(0.5)))
                                Text(item.title).font(.callout.weight(.medium))
                                if !item.channel.isEmpty { Text(item.channel).font(.caption2).foregroundStyle(.secondary) }
                            }
                            if !item.rationale.isEmpty {
                                Text(item.rationale).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        if !report.topPosts.isEmpty {
            Text("NAJLEPSZE POSTY TYGODNIA").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(report.topPosts) { post in
                    HStack(alignment: .top, spacing: 8) {
                        SocialImageView(url: post.thumbnailUrl).frame(width: 48, height: 60).clipShape(RoundedRectangle(cornerRadius: 5))
                        VStack(alignment: .leading, spacing: 2) {
                            Button(post.title) { store.openPost(post.postId) }.buttonStyle(.link).lineLimit(1)
                            Text(channelsLine(post.channels)).font(.caption2).foregroundStyle(.secondary)
                            Text(metricsLine(post.metrics)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            if let link = post.permalink, let url = URL(string: link) {
                                Link(destination: url) { Label("Otwórz w Meta", systemImage: "arrow.up.right.square") }.font(.caption2)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                }
            }
        }
        HStack(spacing: 18) {
            if !report.bestTimes.isEmpty {
                Text("Najlepsze pory: " + report.bestTimes.map { "\($0.label) (\(SocialNumbers.percent($0.rate)))" }.joined(separator: ", "))
            }
            if let comments = report.comments {
                Text("Komentarze w tygodniu: \(comments.received) · bez odpowiedzi teraz: \(comments.unanswered)")
            }
            if let next = report.scheduledNext { Text("Zaplanowane na kolejne 7 dni (w chwili raportu): \(next)") }
        }
        .font(.caption).foregroundStyle(.secondary)
    }

    private func miniTile(_ title: String, _ value: String, current: Double?, previous: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.headline.weight(.light)).monospacedDigit()
            changeLabel(current, previous)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }

    @ViewBuilder private func bulletSection(_ title: String, _ items: [String], color: Color) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(items, id: \.self) { item in
                    HStack(alignment: .top, spacing: 6) {
                        Text("•").foregroundStyle(color)
                        Text(item).font(.callout).foregroundStyle(color == .primary ? Color.primary : color.opacity(0.9))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}
