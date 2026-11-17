import SwiftUI
import Charts

// MARK: Analiza ruchu — 1:1 z `/crm/page/analytics`: okres (Dzisiaj, 7, 30, 90 dni, zakres dat), „Online teraz”
// (odświeżane co 10 s), wizyty, unikalni, średni czas, formularze, wizyty w czasie, źródła ruchu, urządzenia,
// najpopularniejsze miasta, top 10 podstron, „Resetuj statystyki” (z potwierdzeniem hasłem).

@MainActor struct WebsiteAnalyticsView: View {
    @ObservedObject var store: WebsiteStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var range = 30
    @State private var custom = false
    @State private var customFrom = DayDates.today
    @State private var customTo = DayDates.today
    @State private var applied: (String, String)?
    @State private var resetting = false

    private var stats: WebsiteAnalytics? { store.analytics }
    private var rangeLabel: String {
        if custom, let applied { return "\(DayDates.display(applied.0)) – \(DayDates.display(applied.1))" }
        return range == 1 ? "Dzisiaj" : "Ostatnie \(range) dni"
    }
    private var loadKey: String { "\(range)|\(applied?.0 ?? "")|\(applied?.1 ?? "")|\(store.analyticsURL ?? "")|\(custom)|\(store.refreshToken)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                controls
                if let stats {
                    tiles(stats)
                    HStack(alignment: .top, spacing: 16) {
                        dailyChart(stats)
                        sourcesChart(stats)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        devicesChart(stats)
                        if !stats.topCities.isEmpty { cities(stats) }
                    }
                    topPages(stats)
                } else if let error = store.analyticsError {
                    ContentUnavailableView("Błąd ładowania danych", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Ładowanie danych...").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .task(id: loadKey) {
            guard !custom || applied != nil else { return }
            await store.loadAnalytics(range: range, from: custom ? applied?.0 : nil, to: custom ? applied?.1 : nil)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                if Task.isCancelled { break }
                await store.refreshOnline()
            }
        }
        .sheet(isPresented: $resetting) {
            WebsiteResetSheet(store: store) {
                Task { await store.loadAnalytics(range: range, from: custom ? applied?.0 : nil, to: custom ? applied?.1 : nil); await store.loadPages() }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Analiza ruchu").font(.title2.weight(.light))
                Text(store.analyticsURL.map { "Statystyki strony: \($0)" } ?? "Statystyki wszystkich stron publicznych").foregroundStyle(.secondary)
                if store.analyticsURL != nil {
                    Button("Pokaż wszystkie strony") { store.analyticsURL = nil }.buttonStyle(.link)
                }
            }
            Spacer()
            if store.loadingAnalytics { ProgressView().controlSize(.small) }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach([(1, "Dzisiaj"), (7, "7 dni"), (30, "30 dni"), (90, "90 dni")], id: \.0) { item in
                    Button(item.1) { custom = false; range = item.0 }
                        .buttonStyle(.bordered).tint(!custom && range == item.0 ? theme.accent : nil)
                }
                Button("Zakres dat") { custom.toggle() }.buttonStyle(.bordered).tint(custom ? theme.accent : nil)
                Spacer()
                if store.access?.canReset == true {
                    Button("Resetuj statystyki", systemImage: "trash", role: .destructive) { resetting = true }
                }
            }
            if custom {
                HStack(spacing: 10) {
                    DatePicker("Data od", selection: $customFrom, displayedComponents: .date).fixedSize()
                    DatePicker("Data do", selection: $customTo, displayedComponents: .date).fixedSize()
                    Button("Zastosuj") { applied = (DayDates.string(customFrom), DayDates.string(customTo)) }
                        .buttonStyle(.borderedProminent).disabled(customTo < customFrom)
                }
            }
        }
    }

    private func tile(_ title: String, _ value: String, _ detail: String, _ symbol: String, color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: symbol).foregroundStyle(color ?? theme.accent)
                Text(title).font(.callout).foregroundStyle(.secondary)
            }
            Text(value).font(.title.weight(.semibold).monospacedDigit()).foregroundStyle(color ?? Color.primary)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func tiles(_ stats: WebsiteAnalytics) -> some View {
        HStack(spacing: 12) {
            tile("Online teraz", "\(store.online ?? stats.online)", "Odświeżane co 10 s", "dot.radiowaves.left.and.right", color: CrmTheme.rgb(0x4ade80))
            tile("Wizyty", WebsiteFormat.count(stats.totalVisits), rangeLabel, "chart.bar")
            tile("Unikalni", WebsiteFormat.count(stats.uniqueVisitors), "Unikalnych sesji", "person.2")
            tile("Śr. czas", WebsiteFormat.duration(stats.avgTimeOnPage), "Na stronie", "clock")
            tile("Formularze", WebsiteFormat.count(stats.contactForms), "Wysłanych zapytań", "envelope")
        }
    }

    private func card<Content: View>(_ title: String, _ symbol: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol).font(.headline)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func dailyChart(_ stats: WebsiteAnalytics) -> some View {
        let days = Array(stats.dailyVisits.suffix(14))
        return card("Wizyty w czasie", "chart.line.uptrend.xyaxis") {
            if days.isEmpty {
                Text("Brak zarejestrowanych wizyt w wybranym zakresie.").foregroundStyle(.secondary).frame(height: 260)
            } else {
                Chart(days) { day in
                    BarMark(x: .value("Dzień", WebsiteFormat.day(day.date)), y: .value("Wizyty", day.visits)).foregroundStyle(theme.accent)
                }
                .frame(height: 260)
            }
        }
    }

    private func sourcesChart(_ stats: WebsiteAnalytics) -> some View {
        card("Źródła ruchu", "globe") {
            if stats.trafficSources.isEmpty {
                Text("Brak danych o źródłach ruchu.").foregroundStyle(.secondary).frame(height: 260)
            } else {
                Chart(stats.trafficSources) { source in
                    BarMark(x: .value("Wizyty", source.visits), y: .value("Źródło", source.source))
                        .foregroundStyle(CrmTheme.rgb(0x60a5fa))
                        .annotation(position: .trailing) { Text(WebsiteFormat.count(source.visits)).font(.caption).foregroundStyle(.secondary) }
                }
                .chartXAxis(.hidden)
                .frame(height: max(220, min(560, CGFloat(stats.trafficSources.count) * 42)))
            }
        }
    }

    private func devicesChart(_ stats: WebsiteAnalytics) -> some View {
        card("Urządzenia", "laptopcomputer.and.iphone") {
            if stats.devices.isEmpty {
                Text("Brak danych o urządzeniach.").foregroundStyle(.secondary).frame(height: 200)
            } else {
                Chart(stats.devices) { device in
                    BarMark(x: .value("Udział", device.percentage), y: .value("Urządzenie", device.device))
                        .foregroundStyle(CrmTheme.rgb(0xa78bfa))
                        .annotation(position: .trailing) { Text("\(device.percentage)%").font(.caption).foregroundStyle(.secondary) }
                }
                .chartXScale(domain: 0...100)
                .chartXAxis(.hidden)
                .frame(height: max(160, CGFloat(stats.devices.count) * 44))
            }
        }
    }

    private func cities(_ stats: WebsiteAnalytics) -> some View {
        card("Najpopularniejsze miasta", "mappin.and.ellipse") {
            ForEach(stats.topCities) { city in
                HStack {
                    Text(city.city)
                    Spacer()
                    Text("\(city.submissions) zapytań").foregroundStyle(theme.accent)
                }
                .padding(8)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func topPages(_ stats: WebsiteAnalytics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(store.analyticsURL == nil ? "Top 10 podstron" : "Wybrana strona").font(.headline)
                Spacer()
                Button { store.tab = .structure } label: { Label("Struktura strony", systemImage: "arrow.up.right.square") }.buttonStyle(.link)
            }
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                GridRow {
                    Text("Strona")
                    Text("Wizyty")
                    Text("Unikalni")
                    Text("Śr. czas")
                }
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Divider()
                ForEach(stats.topPages) { page in
                    GridRow {
                        Text(page.url).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                        Text(WebsiteFormat.count(page.visits)).monospacedDigit()
                        Text(WebsiteFormat.count(page.uniqueVisitors)).monospacedDigit()
                        Text(WebsiteFormat.duration(page.avgTime)).monospacedDigit()
                    }
                }
            }
            if stats.topPages.isEmpty { Text("Brak wizyt w wybranym zakresie.").foregroundStyle(.secondary) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// „Resetuj statystyki”: lista usuwanych danych, potem hasło zalogowanego konta (sprawdzane na serwerze, od razu czyszczone).
@MainActor struct WebsiteResetSheet: View {
    @ObservedObject var store: WebsiteStore
    let done: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var step = 0
    @State private var password = ""
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(step == 0 ? "Resetuj statystyki" : "Potwierdź hasłem", systemImage: "exclamationmark.triangle")
                .font(.title2.bold()).foregroundStyle(CrmTheme.rgb(0xf87171))
            if step == 0 {
                Text("Ta operacja usunie **wszystkie dane analityczne**:")
                VStack(alignment: .leading, spacing: 6) {
                    Label("Historię wizyt (page_analytics)", systemImage: "trash")
                    Label("Interakcje użytkowników (user_interactions)", systemImage: "trash")
                    Label("Aktywne sesje (active_sessions)", systemImage: "trash")
                }
                .foregroundStyle(.secondary)
                Text("⚠️ Tej operacji NIE MOŻNA cofnąć!").fontWeight(.semibold).foregroundStyle(CrmTheme.rgb(0xf87171))
                HStack {
                    Spacer()
                    Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                    Button("Kontynuuj") { step = 1 }.buttonStyle(.borderedProminent).tint(.red)
                }
            } else {
                Text("Aby potwierdzić reset statystyk, wpisz swoje hasło administratora:")
                SecureField("Wpisz hasło", text: $password)
                    .textContentType(.password).disabled(busy)
                    .onSubmit { submit() }
                if let problem { Text(problem).foregroundStyle(.red).font(.callout) }
                Text("💡 Wskazówka: Używamy Twojego hasła aby upewnić się, że to naprawdę Ty podejmujesz tę decyzję.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Spacer()
                    Button("Wróć") { step = 0; password = ""; problem = nil }.disabled(busy)
                    Button(busy ? "Resetowanie..." : "Resetuj statystyki", role: .destructive) { submit() }
                        .buttonStyle(.borderedProminent).tint(.red).disabled(busy || password.isEmpty)
                }
            }
        }
        .padding(22)
        .frame(width: 520)
        .interactiveDismissDisabled(busy)
        .onDisappear { password = "" }
    }

    private func submit() {
        guard !password.isEmpty, !busy else { problem = password.isEmpty ? "Wpisz hasło aby kontynuować" : nil; return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        let secret = password
        password = ""
        busy = true
        problem = nil
        Task {
            do {
                _ = try await state.withPending("Resetowanie…") { try await store.post("resetAnalytics", ["password": .string(secret)]) }
                state.succeed("Statystyki zostały zresetowane pomyślnie")
                busy = false
                dismiss()
                done()
            } catch {
                problem = store.failureText(error, "Błąd podczas resetowania statystyk")
                busy = false
            }
        }
    }
}
