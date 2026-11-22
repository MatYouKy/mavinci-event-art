import SwiftUI
import Charts

// MARK: Dashboard — części dotąd otwierane w CRM: dashboard magazynu i logistyki (`WarehouseDashboard`), „Moja sprzedaż”
// sprzedawcy (`SellerFinancialDashboard`: rok wydarzenia, waluty, kafelki kwot, wykres miesięczny, sprzedane wydarzenia)
// oraz „Dostosuj dashboard” (zakładka „Dashboard” w Ustawieniach CRM: zakres wykresów i widoczne sekcje).
// Serwer: `/bridge/native/v1/dashboard` (`warehouse`, `op=sales`, `op=preferences` — `src/lib/native/dashboardExtras.ts`).

enum DashboardDates {
    /// Dzień jak `toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })` („5.11.2026”); `nil` bez daty.
    static func day(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: raw)
        if date == nil { iso.formatOptions = [.withInternetDateTime]; date = iso.date(from: raw) }
        if date == nil {
            let input = DateFormatter(); input.locale = Locale(identifier: "en_US_POSIX"); input.timeZone = TimeZone(identifier: "Europe/Warsaw")
            input.dateFormat = "yyyy-MM-dd"
            date = input.date(from: String(raw.prefix(10)))
        }
        guard let date else { return nil }
        let output = DateFormatter(); output.locale = Locale(identifier: "pl_PL"); output.timeZone = TimeZone(identifier: "Europe/Warsaw")
        output.dateFormat = "d.MM.yyyy"
        return output.string(from: date)
    }
}

// MARK: Dashboard magazynu

struct WarehouseDashboardData: Decodable {
    struct Unit: Decodable, Identifiable { var id: String; var equipmentId: String; var name: String; var serial: String; var notes: String }
    struct Event: Decodable, Identifiable { var id: String; var name: String; var date: String?; var stage: String }
    struct TaskRow: Decodable, Identifiable { var id: String; var title: String; var dueDate: String? }
    /// `nil` — sekcja nie została pobrana (błąd jak „Odśwież stronę” w CRM).
    var damaged: [Unit]?
    var damagedCount: Int?
    var events: [Event]?
    var tasks: [TaskRow]?
}

@MainActor struct WarehouseDashboardView: View {
    let data: WarehouseDashboardData?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Magazyn i logistyka").font(.title.weight(.light))
                Text("Przygotowanie eventów, stan sprzętu i Twoje zadania.").font(.callout).foregroundStyle(.secondary)
            }
            MyDayTimelineView()
            HStack(spacing: 12) {
                shortcut("Sprzęt", "shippingbox") { state.openHref("/crm/equipment") }
                shortcut("Eventy", "calendar") { state.switchSection(.events) }
                shortcut("Moje zadania", "checkmark.square") { openMyTasks() }
            }
            HStack(alignment: .top, spacing: 20) {
                damagedPanel
                eventsPanel
            }
            tasksPanel
        }
    }

    private func shortcut(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbol).font(.title2).foregroundStyle(theme.accent)
                Text(title)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 16)
            .background(theme.card.opacity(theme == .light ? 1 : 0.85), in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func row<Content: View>(_ action: @escaping () -> Void, @ViewBuilder _ content: () -> Content) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) { content() }
                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var damagedPanel: some View {
        DashboardPanel(title: "Uszkodzony sprzęt" + (data?.damagedCount.map { " (\($0))" } ?? ""), symbol: "exclamationmark.triangle") {
            if let units = data?.damaged {
                if units.isEmpty {
                    Text("Brak egzemplarzy oznaczonych jako uszkodzone.").foregroundStyle(.secondary)
                } else {
                    ForEach(units) { unit in
                        row({ state.showEquipment(unit.equipmentId) }) {
                            (Text(unit.name) + Text(" · Uszkodzony").foregroundStyle(.red)).fontWeight(.medium)
                            if !unit.serial.isEmpty { Text("Numer seryjny: \(unit.serial)").font(.caption).foregroundStyle(.secondary) }
                            if !unit.notes.isEmpty { Text(unit.notes).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                        }
                    }
                    if (data?.damagedCount ?? 0) > 20 {
                        Text("Pokazano 20 ostatnio aktualizowanych egzemplarzy.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Nie udało się pobrać uszkodzonego sprzętu. Odśwież dashboard.").foregroundStyle(.red)
            }
        }
    }

    private var eventsPanel: some View {
        DashboardPanel(title: "Eventy do przygotowania", symbol: "calendar") {
            if let events = data?.events {
                if events.isEmpty {
                    Text("Brak eventów oczekujących na przygotowanie.").foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        row({ state.showEvent(event.id) }) {
                            Text(event.name)
                            Text("\(DashboardDates.day(event.date) ?? "Bez terminu") · \(event.stage)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("Nie udało się pobrać eventów. Odśwież dashboard.").foregroundStyle(.red)
            }
            Button("Przejdź do eventów →") { state.switchSection(.events) }.buttonStyle(.link)
        }
    }

    private var tasksPanel: some View {
        DashboardPanel(title: "Moje zadania do wykonania", symbol: "checkmark.square") {
            if let tasks = data?.tasks {
                if tasks.isEmpty {
                    Text("Nie masz otwartych przypisanych zadań.").foregroundStyle(.secondary)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 10)], spacing: 10) {
                        ForEach(tasks) { task in
                            row({ state.showTask(task.id) }) {
                                Text(task.title).lineLimit(2)
                                Text("Termin: \(DashboardDates.day(task.dueDate) ?? "Bez terminu")").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Text("Nie udało się pobrać Twoich zadań. Odśwież dashboard.").foregroundStyle(.red)
            }
            Button("Wszystkie moje zadania →") { openMyTasks() }.buttonStyle(.link)
        }
    }

    private func openMyTasks() {
        if state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/tasks/mine" }) { state.openHref("/crm/tasks/mine") }
        else { state.openCRM("/crm/tasks/mine") }
    }
}

// MARK: Moja sprzedaż (sprzedawca)

struct SellerSalesReport: Decodable {
    struct Totals { var currency: String; var invoicedEvents: Double; var invoicedGross: Double; var paidGross: Double; var outstandingGross: Double; var overdueGross: Double }
    struct Month: Identifiable { var key: String; var currency: String; var events: Double; var invoicedGross: Double; var paidGross: Double; var id: String { key + currency } }
    struct Event: Identifiable { var id: String; var name: String; var eventDate: String; var status: String; var currency: String; var invoicedGross: Double; var paidGross: Double; var outstandingGross: Double; var rowID: String { id + ":" + currency } }
    var dateFrom: String
    var soldEvents: Double
    var invoicedEvents: Double
    var currencyTotals: [Totals]
    var months: [Month]
    var events: [Event]

    /// Odczyt tolerancyjny (liczby z bazy jako liczba albo tekst; brakujące pola — zero), żeby raport nie blokował dashboardu.
    init(from decoder: Decoder) throws {
        let root = try decoder.singleValueContainer().decode([String: JSONValue].self)
        func number(_ value: JSONValue?) -> Double {
            switch value {
            case .number(let amount)?: return amount
            case .string(let text)?: return Double(text) ?? 0
            default: return 0
            }
        }
        let totals = root["totals"]?.object ?? [:]
        dateFrom = root["date_from"]?.text ?? ""
        soldEvents = number(totals["sold_events"])
        invoicedEvents = number(totals["invoiced_events"])
        currencyTotals = (root["currency_totals"]?.array ?? []).map(\.object).map {
            Totals(currency: $0["currency"]?.text ?? "", invoicedEvents: number($0["invoiced_events"]), invoicedGross: number($0["invoiced_gross"]),
                   paidGross: number($0["paid_gross"]), outstandingGross: number($0["outstanding_gross"]), overdueGross: number($0["overdue_gross"]))
        }
        months = (root["months"]?.array ?? []).map(\.object).map {
            Month(key: $0["key"]?.text ?? "", currency: $0["currency"]?.text ?? "", events: number($0["events"]),
                  invoicedGross: number($0["invoiced_gross"]), paidGross: number($0["paid_gross"]))
        }
        events = (root["events"]?.array ?? []).map(\.object).map {
            Event(id: $0["id"]?.text ?? "", name: $0["name"]?.text ?? "", eventDate: $0["event_date"]?.text ?? "", status: $0["status"]?.text ?? "",
                  currency: $0["currency"]?.text ?? "", invoicedGross: number($0["invoiced_gross"]), paidGross: number($0["paid_gross"]),
                  outstandingGross: number($0["outstanding_gross"]))
        }
    }

    /// `formatMoney`: dwa miejsca po przecinku i kod waluty.
    static func money(_ value: Double, _ currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return "\(formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)) \(currency)"
    }
    /// Skrót miesiąca jak `Intl.DateTimeFormat('pl-PL', { month: 'short' })` bez kropki („sty”, „lut”…).
    static func monthLabel(_ key: String) -> String {
        let input = DateFormatter(); input.locale = Locale(identifier: "en_US_POSIX"); input.dateFormat = "yyyy-MM"
        guard let date = input.date(from: key) else { return key }
        let output = DateFormatter(); output.locale = Locale(identifier: "pl_PL"); output.dateFormat = "LLL"
        return output.string(from: date).replacingOccurrences(of: ".", with: "")
    }
}

@MainActor struct SellerSalesView: View {
    let initial: SellerSalesReport?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var year = Calendar.current.component(.year, from: Date())
    @State private var report: SellerSalesReport?
    @State private var loading = false
    @State private var error: String?
    @State private var currency = "PLN"
    @State private var started = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Moja sprzedaż").font(.title2.weight(.light))
                    Text("Rok i miesiąc odnoszą się do daty eventu. Kwoty obejmują wszystkie wystawione do niego faktury, także wystawione w innym okresie. To kwoty brutto, a nie zysk firmy.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                HStack(spacing: 6) {
                    Button { year -= 1 } label: { Image(systemName: "chevron.left") }.help("Poprzedni rok")
                    Text(verbatim: String(year)).font(.headline.monospacedDigit()).frame(minWidth: 48)
                    Button { year += 1 } label: { Image(systemName: "chevron.right") }.help("Następny rok")
                    Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież moją sprzedaż").disabled(loading)
                }
            }
            if loading {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Wczytywanie Twojej sprzedaży…") }.foregroundStyle(.secondary).padding(.vertical, 20)
            } else if let report, error == nil {
                content(report)
            } else {
                Text(error ?? "Raport sprzedaży nie jest obecnie dostępny.").foregroundStyle(.red)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .task(id: year) {
            // Raport bieżącego roku przychodzi z dashboardem — bez ponownego pobierania przy pierwszym widoku.
            if !started, let initial, initial.dateFrom == "\(year)-01-01" { report = initial; started = true; return }
            started = true
            await load()
        }
    }

    @ViewBuilder private func content(_ report: SellerSalesReport) -> some View {
        let currencies = report.currencyTotals.map(\.currency)
        let selected = currencies.contains(currency) ? currency : currencies.first ?? "PLN"
        let totals = report.currencyTotals.first { $0.currency == selected }
        let rows = report.events.filter { $0.currency == selected }
        let months = report.months.filter { $0.currency == selected }
        HStack(spacing: 16) {
            Label { Text("Sprzedane eventy: ") + Text("\(Int(report.soldEvents))").bold() } icon: { Image(systemName: "calendar") }
            Label { Text("Zafakturowane: ") + Text("\(Int(report.invoicedEvents))").bold() } icon: { Image(systemName: "doc.text") }
            Spacer()
            if currencies.count > 1 {
                Picker("Waluta", selection: Binding(get: { selected }, set: { currency = $0 })) {
                    ForEach(currencies, id: \.self) { Text($0).tag($0) }
                }
                .fixedSize()
            }
        }
        .font(.callout)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            moneyCard("Zafakturowana sprzedaż", totals?.invoicedGross, selected, "Zaliczki i końcowe rozliczenie bez podwójnego liczenia.")
            moneyCard("Potwierdzone płatności", totals?.paidGross, selected, "Płatności przypisane do faktur tych eventów.")
            moneyCard("Pozostało do zapłaty", totals?.outstandingGross, selected, "Nierozliczona część faktur Twojej sprzedaży.")
            moneyCard("Po terminie płatności", totals?.overdueGross, selected, "Zaległości dotyczące wyłącznie tych faktur.")
        }
        DashboardPanel(title: "Sprzedaż według miesiąca eventu", subtitle: "Każda waluta jest pokazywana osobno. Wspólne faktury uwzględniają tylko udział przypisany do Twoich eventów.") {
            if months.allSatisfy({ $0.invoicedGross == 0 && $0.paidGross == 0 }) {
                Text("Brak zafakturowanej sprzedaży w wybranym okresie.").foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 160)
            } else {
                Chart {
                    ForEach(months) { month in
                        BarMark(x: .value("Miesiąc", SellerSalesReport.monthLabel(month.key)), y: .value("Kwota", month.invoicedGross))
                            .foregroundStyle(by: .value("Seria", "Zafakturowano")).position(by: .value("Seria", "Zafakturowano"))
                        BarMark(x: .value("Miesiąc", SellerSalesReport.monthLabel(month.key)), y: .value("Kwota", month.paidGross))
                            .foregroundStyle(by: .value("Seria", "Opłacono")).position(by: .value("Seria", "Opłacono"))
                    }
                }
                .chartForegroundStyleScale(domain: ["Zafakturowano", "Opłacono"], range: [CrmTheme.rgb(0xd3bb73), CrmTheme.rgb(0x6ee7b7)])
                .chartYAxis { AxisMarks { value in AxisGridLine(); AxisValueLabel { if let v = value.as(Double.self) { Text(verbatim: SellerSalesReport.money(v, selected)) } } } }
                .chartLegend(position: .top, alignment: .leading)
                .frame(height: 260)
            }
        }
        DashboardPanel(title: "Moje sprzedane eventy") {
            HStack {
                Spacer()
                Button("Moje faktury") { openInvoices() }.buttonStyle(.link)
            }
            if rows.isEmpty {
                Text("Brak sprzedanych eventów w tym okresie i walucie.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                    GridRow {
                        Text("Event").font(.caption).foregroundStyle(.secondary)
                        Text("Data / status").font(.caption).foregroundStyle(.secondary)
                        Text("Zafakturowano").font(.caption).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                        Text("Opłacono").font(.caption).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                        Text("Do zapłaty").font(.caption).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                    }
                    Divider()
                    ForEach(rows, id: \.rowID) { event in
                        GridRow {
                            Button(event.name) { state.showEvent(event.id) }.buttonStyle(.link).lineLimit(2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(DashboardDates.day(event.eventDate) ?? "—").font(.callout)
                                Text(EventLabels.status(event.status)).font(.caption2).foregroundStyle(.secondary)
                            }
                            Text(verbatim: SellerSalesReport.money(event.invoicedGross, event.currency)).monospacedDigit()
                            Text(verbatim: SellerSalesReport.money(event.paidGross, event.currency)).monospacedDigit()
                            Text(verbatim: SellerSalesReport.money(event.outstandingGross, event.currency)).monospacedDigit()
                        }
                    }
                }
            }
        }
    }

    private func moneyCard(_ label: String, _ value: Double?, _ currency: String, _ helper: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(verbatim: SellerSalesReport.money(value ?? 0, currency)).font(.title3.weight(.medium)).monospacedDigit()
            Text(helper).font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.85), in: RoundedRectangle(cornerRadius: 12))
    }

    /// „Moje faktury” (`/crm/invoices?tab=local`) — Finanse na Macu, bez nich strona CRM.
    private func openInvoices() {
        if state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/invoices" }) { state.showFinance(.invoices) }
        else { state.openCRM("/crm/invoices?tab=local") }
    }

    private func load() async {
        guard let api = state.nativeAPI() else { error = AppError.configuration.localizedDescription; return }
        loading = true
        error = nil
        report = nil
        defer { loading = false }
        struct Reply: Decodable { var report: SellerSalesReport }
        let requested = year
        do {
            let next = try JSONDecoder().decode(Reply.self, from: try await api.get("/dashboard", query: ["op": "sales", "year": String(requested)])).report
            if requested == year { report = next }
        } catch {
            if requested == year { self.error = "Nie udało się pobrać Twojego raportu sprzedaży. Dane całej firmy nie są udostępniane w tym widoku." }
        }
    }
}

// MARK: Dostosuj dashboard

struct DashboardPreferencesData: Decodable {
    struct Widget: Decodable, Identifiable { var id: String; var label: String; var description: String; var enabled: Bool }
    var range: String
    var widgets: [Widget]
}

@MainActor struct DashboardPreferencesSheet: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: DashboardPreferencesData?
    @State private var loadError: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Widok dashboardu").font(.title3.bold())
                Text("Wybierz informacje, które mają być widoczne na Twoim dashboardzie. Ustawienia są przypisane do Twojego konta i działają na wszystkich urządzeniach.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(20)
            Divider()
            if let data {
                ScrollView { form(data).padding(20) }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać ustawień", systemImage: "slider.horizontal.3")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            HStack {
                Button { reset() } label: { Label("Ustaw domyślny widok", systemImage: "arrow.counterclockwise") }.disabled(saving || data == nil)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button { Task { await save() } } label: { Label(saving ? "Zapisywanie..." : "Zapisz dashboard", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || data == nil)
            }
            .padding(16)
        }
        .frame(minWidth: 560, idealWidth: 640, minHeight: 560, idealHeight: 700)
        .background(theme.page)
        .task { await load() }
    }

    private func form(_ data: DashboardPreferencesData) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Domyślny zakres wykresów")
                    Text("Zakres można później rozszerzyć o własne daty i porównania okresów.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Picker("", selection: Binding(get: { data.range }, set: { self.data?.range = $0 })) {
                    Text("6 miesięcy").tag("6m")
                    Text("12 miesięcy").tag("12m")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            .padding(14).background(theme.card.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(data.widgets.indices, id: \.self) { index in
                    let widget = data.widgets[index]
                    Toggle(isOn: Binding(get: { self.data?.widgets[index].enabled ?? true }, set: { self.data?.widgets[index].enabled = $0 })) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(widget.label).fontWeight(.medium)
                            Text(widget.description).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .toggleStyle(.switch)
                    .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(widget.enabled ? theme.accent.opacity(0.1) : theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(widget.enabled ? 0.3 : 0.1)))
                }
            }
        }
    }

    /// „Ustaw domyślny widok” — jak w CRM: wszystko widoczne, zakres 6 miesięcy; zapis dopiero „Zapisz dashboard”.
    private func reset() {
        data?.range = "6m"
        for index in (data?.widgets.indices ?? 0..<0) { data?.widgets[index].enabled = true }
    }

    private func load() async {
        guard let api = state.nativeAPI() else { loadError = AppError.configuration.localizedDescription; return }
        do {
            data = try JSONDecoder().decode(DashboardPreferencesData.self, from: try await api.get("/dashboard", query: ["op": "preferences"]))
            loadError = nil
        } catch {
            loadError = (error as? NativeFailure)?.message ?? "Błąd podczas wczytywania preferencji"
        }
    }

    private func save() async {
        guard let data else { return }
        guard state.canWrite, let api = state.nativeAPI() else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        let widgets = Dictionary(uniqueKeysWithValues: data.widgets.map { ($0.id, JSONValue.bool($0.enabled)) })
        do {
            let raw = try await api.post("/dashboard", ["op": .string("preferences"), "range": .string(data.range), "widgets": .object(widgets)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: raw)) ?? [:]
            state.succeed(reply["message"]?.text.nonEmpty ?? "Ustawienia zostały zapisane")
            dismiss()
            await state.loadDashboard(force: true)
        } catch {
            state.error = (error as? NativeFailure)?.message ?? "Błąd podczas zapisywania ustawień"
        }
    }
}
