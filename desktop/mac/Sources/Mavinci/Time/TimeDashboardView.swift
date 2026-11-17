import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Czas pracy — raport zespołu dla administratora (`AdminDashboard`): okres (tydzień / miesiąc / rok z przesuwaniem albo
// własny zakres), filtr pracownika, eksport CSV, kafelki sumy, pracownicy z aktywnym licznikiem (kliknięcie — strona
// pracownika) i aktywność dzienna. Przy wybranym pracowniku — jego rozliczenie czasu pracy.

/// Wybór okresu raportu (wspólny dla raportu zespołu i strony pracownika).
@MainActor struct WorkTimePeriodBar<Trailing: View>: View {
    @Binding var period: WorkTimePeriod
    let trailing: Trailing
    @State private var customFrom: Date
    @State private var customTo: Date

    init(period: Binding<WorkTimePeriod>, @ViewBuilder trailing: () -> Trailing) {
        _period = period
        self.trailing = trailing()
        _customFrom = State(initialValue: DayDates.parse(period.wrappedValue.from) ?? DayDates.today)
        _customTo = State(initialValue: DayDates.parse(period.wrappedValue.to) ?? DayDates.today)
    }

    private var applied: Bool { DayDates.string(customFrom) == period.from && DayDates.string(customTo) == period.to }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Picker("Okres:", selection: Binding(get: { period.kind }, set: { period.select($0) })) {
                    ForEach(WorkTimePeriodKind.allCases) { Text($0.label).tag($0) }
                }
                .fixedSize()
                if period.kind != .custom {
                    Button { period.move(-1) } label: { Image(systemName: "chevron.left") }.help("Poprzedni")
                    Text(period.label).font(.callout.weight(.semibold)).frame(minWidth: 170)
                    Button { period.move(1) } label: { Image(systemName: "chevron.right") }.help("Następny")
                }
                Spacer()
                trailing
            }
            if period.kind == .custom {
                HStack(spacing: 10) {
                    DatePicker("Od", selection: $customFrom, displayedComponents: .date).fixedSize()
                    DatePicker("Do", selection: $customTo, displayedComponents: .date).fixedSize()
                    Button {
                        period.from = DayDates.string(customFrom)
                        period.to = DayDates.string(customTo)
                    } label: { Label("Zastosuj", systemImage: "checkmark") }
                        .buttonStyle(.borderedProminent).disabled(customTo < customFrom)
                    Text(applied
                         ? "Aktywny: \(DayDates.display(period.from)) - \(DayDates.display(period.to))"
                         : "Kliknij „Zastosuj”, aby załadować dane")
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
        }
    }
}

@MainActor struct WorkTimeDashboardView: View {
    @ObservedObject var store: TimeTrackingStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var period = WorkTimePeriod(kind: WorkTimePeriodKind.saved)
    @State private var employee = "all"

    private var data: WorkTimeDashboard? { store.dashboard }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Raport czasu pracy").font(.title3.weight(.light))
                Spacer()
                if store.loadingDashboard { ProgressView().controlSize(.small) }
                Button { export() } label: { Label("Eksportuj CSV", systemImage: "square.and.arrow.down") }.disabled(data == nil)
            }
            WorkTimePeriodBar(period: $period) {
                Picker("Pracownik:", selection: $employee) {
                    Text("Wszyscy pracownicy").tag("all")
                    ForEach(data?.employees ?? []) { Text($0.name).tag($0.id) }
                }
                .frame(maxWidth: 320)
            }
            .padding(14)
            .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
            if employee != "all" {
                WorkTimeSettlementCard(store: store, employeeID: employee, dateTo: period.to).id("settlement-\(employee)")
            }
            if let data {
                tiles(data)
                people(data)
                daily(data)
            } else if let error = store.dashboardError {
                ContentUnavailableView {
                    Label("Raport czasu pracy", systemImage: "chart.bar")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await reload() } }
                }
                .frame(maxWidth: .infinity)
            } else {
                ProgressView("Ładowanie danych...").frame(maxWidth: .infinity).padding(40)
            }
        }
        .task(id: "\(period.from)|\(period.to)|\(employee)|\(state.employee?.id ?? "")") { await reload() }
    }

    private func reload() async {
        await store.loadDashboard(from: period.from, to: period.to, employee: employee == "all" ? nil : employee)
    }

    private func tiles(_ data: WorkTimeDashboard) -> some View {
        HStack(spacing: 12) {
            WorkTimeTile(title: "Łączny czas", value: WorkTimeFormat.minutes(data.totals.minutes), symbol: "clock")
            WorkTimeTile(title: "Rozliczalny", value: WorkTimeFormat.minutes(data.totals.billableMinutes), symbol: "chart.line.uptrend.xyaxis")
            WorkTimeTile(title: "Wpisy bez umowy — wartość orientacyjna", value: WorkTimeFormat.money(data.totals.revenue), symbol: "dollarsign.circle")
            WorkTimeTile(title: "Aktywnych", value: "\(data.totals.employees ?? data.people.count)", symbol: "person.2")
        }
    }

    private func people(_ data: WorkTimeDashboard) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Pracownicy").font(.headline)
            if data.people.isEmpty {
                Text("Brak danych dla wybranego okresu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24)
            }
            ForEach(data.people) { person in
                WorkTimePersonRow(person: person, share: data.totals.minutes > 0 ? person.minutes / data.totals.minutes : 0,
                                  open: { store.openedEmployeeID = person.id }, openTask: { state.showTask($0) })
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func daily(_ data: WorkTimeDashboard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Aktywność dzienna").font(.headline)
            if data.daily.isEmpty {
                Text("Brak danych dla wybranego okresu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24)
            }
            ForEach(data.daily) { day in
                HStack(spacing: 16) {
                    Text(DayDates.parse(day.date).map { MeetingDates.format($0, "EEE, dd MMM") } ?? day.date).frame(width: 130, alignment: .leading)
                    Text(WorkTimeFormat.minutes(day.minutes)).fontWeight(.semibold).foregroundStyle(theme.accent).frame(width: 90, alignment: .leading)
                    Text("\(day.entries) wpisów").foregroundStyle(.secondary)
                    Text("\(day.employees) pracowników").foregroundStyle(.secondary)
                    Spacer()
                }
                .font(.callout)
                .padding(.vertical, 6).padding(.horizontal, 10)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    /// CSV jak „Eksportuj CSV” w CRM (pola w cudzysłowach — kwoty zawierają przecinki).
    private func export() {
        guard let data else { return }
        let quote = { (value: String) in "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        var rows = [["Pracownik", "Łączny czas", "Czas rozliczalny", "Wpisy bez umowy — wartość orientacyjna", "Liczba wpisów", "Aktywne dni"]]
        for person in data.people {
            rows.append([person.name, WorkTimeFormat.minutes(person.minutes), WorkTimeFormat.minutes(person.billableMinutes),
                         WorkTimeFormat.money(person.revenue), "\(person.entries)", "\(person.days)"])
        }
        let csv = rows.map { $0.map(quote).joined(separator: ",") }.joined(separator: "\n")
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "raport-czasu-pracy-\(data.range.from)-\(data.range.to).csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            // Znacznik BOM — Excel poprawnie odczyta polskie znaki.
            try Data(("\u{FEFF}" + csv).utf8).write(to: target, options: .atomic)
            state.succeed("Zapisano raport: \(target.lastPathComponent)")
        } catch {
            state.error = "Nie udało się zapisać raportu."
        }
    }
}

/// Pracownik w raporcie: zdjęcie, „Aktywny”, wpisy i dni, bieżące zadanie, czas, czas rozliczalny, wartość, pasek udziału.
@MainActor struct WorkTimePersonRow: View {
    let person: WorkTimePerson
    let share: Double
    let open: () -> Void
    let openTask: (String) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 48)
                    .overlay(alignment: .bottomTrailing) {
                        if person.active != nil { Circle().fill(workTimeGreen).frame(width: 12, height: 12).overlay(Circle().stroke(theme.card, lineWidth: 2)) }
                    }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(person.name).font(.headline)
                        if person.active != nil { WorkTimePill(text: "Aktywny", color: workTimeGreen) }
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 6) {
                        Text("\(person.entries) wpisów • \(person.days) dni")
                        if let active = person.active {
                            Text("•")
                            if let task = active.taskId, !active.taskTitle.isEmpty {
                                Text(active.taskTitle).foregroundStyle(workTimeGreen)
                                Button { openTask(task) } label: { Image(systemName: "arrow.up.right.square") }
                                    .buttonStyle(.borderless).help("Otwórz zadanie")
                            } else {
                                Text(active.title.nonEmpty ?? "W trakcie pracy").foregroundStyle(workTimeGreen)
                            }
                        }
                    }
                    .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(WorkTimeFormat.minutes(person.minutes)).font(.title3.weight(.semibold)).monospacedDigit()
                    Text("\(WorkTimeFormat.minutes(person.billableMinutes)) rozliczalnych").font(.caption).foregroundStyle(.secondary)
                    if person.revenue > 0 { Text(WorkTimeFormat.money(person.revenue)).font(.caption).foregroundStyle(theme.accent) }
                }
            }
            WorkTimeBar(fraction: share)
        }
        .padding(12)
        .background(hover ? theme.accent.opacity(0.08) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onHover { hover = $0 }
        .onTapGesture(perform: open)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Czas pracy: \(person.name)")
        .accessibilityAction(named: "Otwórz") { open() }
    }
}
