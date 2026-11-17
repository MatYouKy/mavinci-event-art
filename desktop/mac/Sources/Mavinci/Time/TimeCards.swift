import SwiftUI
import AppKit

// MARK: Czas pracy — karty „Rozliczenie czasu pracy” (`EmployeeTimeSettlements`: podgląd raportu od poprzedniego
// rozliczenia, „Rozlicz pracownika”, „Zastosuj rozliczenie”, historia i cofnięcie ostatniego) oraz „Wynagrodzenie z umów”
// (`PersonnelEarnings`: naliczenia miesiąca, salda wypłat, wpisy bez umowy z przypisaniem umowy).

/// Rozliczenie czasu pracy pracownika do wskazanej chwili (netto, godziny × stawka).
@MainActor struct WorkTimeSettlementCard: View {
    @ObservedObject var store: TimeTrackingStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var until: Date
    @State private var preview: WorkTimeSettlementPreview?
    @State private var expanded = false
    @State private var hours = ""
    @State private var rate = ""
    @State private var notes = ""
    @State private var accepted = false
    @State private var loading = true
    @State private var busy = false
    @State private var problem = ""
    @State private var hoursEdited = false
    @State private var retryKey = ""
    @State private var retryID = ""
    @State private var voiding = false
    @State private var voidReason = ""
    @State private var sequence = 0

    /// `dateTo` — koniec okresu raportu: gdy już minął, rozliczenie domyślnie do 23:59:59 tego dnia (jak w CRM).
    init(store: TimeTrackingStore, employeeID: String, dateTo: String?) {
        self.store = store
        self.employeeID = employeeID
        let now = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970))
        var start = now
        if let dateTo, dateTo < DayDates.string(now), let day = DayDates.parse(dateTo),
           let end = MeetingDates.calendar.date(bySettingHour: 23, minute: 59, second: 59, of: day) {
            start = end
        }
        _until = State(initialValue: start)
    }

    private var count: Double? { WorkTimeFormat.decimalInput(hours) }
    private var hourly: Double? { WorkTimeFormat.decimalInput(rate) }
    private var amount: Double {
        guard let count, let hourly else { return 0 }
        return (count * hourly * 100).rounded() / 100
    }
    private var differs: Bool {
        guard let preview else { return false }
        guard let count else { return true }
        return count != (preview.minutes / 60 * 100).rounded() / 100
    }
    private var needsAcceptance: Bool { differs || preview?.latestChanged == true }
    private var valid: Bool {
        guard let count, let hourly, until <= Date(), count > 0, count <= 1_000_000, hourly > 0, hourly <= 1_000_000 else { return false }
        if let latest = preview?.latest?.untilDate { return until > latest }
        return true
    }
    private var canApply: Bool {
        guard let preview else { return false }
        return !busy && !loading && problem.isEmpty && valid && preview.crossingCount == 0 && !(needsAcceptance && !accepted)
    }

    var body: some View {
        TeamCard(title: "Rozliczenie czasu pracy", symbol: "calendar.badge.checkmark") {
            HStack(alignment: .center, spacing: 10) {
                HStack(spacing: 5) {
                    if let latest = preview?.latest, preview?.latestChanged == false {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(workTimeGreen)
                        Text("Rozliczony do \(WorkTimeFormat.dateTime(latest.until))")
                    } else if let latest = preview?.latest {
                        Text("Do sprawdzenia — ostatnie rozliczenie do \(WorkTimeFormat.dateTime(latest.until))").foregroundStyle(workTimeOrange)
                    } else {
                        Text(loading ? "Ładowanie rozliczeń…" : !problem.isEmpty ? "Rozliczenia niedostępne" : "Brak zapisanego rozliczenia").foregroundStyle(.secondary)
                    }
                }
                .font(.callout)
                Spacer()
                if loading { ProgressView().controlSize(.small) }
                if preview?.canManage == true {
                    Button(expanded ? "Zamknij formularz" : "Rozlicz pracownika") { expanded.toggle() }.disabled(busy)
                }
            }
            if preview?.latestChanged == true {
                Text("Raport za wcześniej rozliczony okres został zmieniony. Sprawdź dodane lub poprawione godziny przed kolejnym rozliczeniem.")
                    .font(.callout).foregroundStyle(workTimeOrange)
            }
            if let latest = preview?.latest {
                (Text("Ostatnio: \(WorkTimeFormat.number(latest.hours)) godz. × \(WorkTimeFormat.money(latest.rate)) netto = ")
                    + Text("\(WorkTimeFormat.money(latest.amount)) netto").fontWeight(.semibold))
                    .font(.callout)
            }
            if expanded, let preview, preview.canManage { form(preview) }
            if !problem.isEmpty {
                HStack(spacing: 8) {
                    Text(problem).foregroundStyle(.orange)
                    Button("Odśwież podgląd") { Task { await load() } }.buttonStyle(.link).disabled(busy)
                }
                .font(.callout)
            }
            if let preview, !preview.history.isEmpty { history(preview) }
            if preview?.canManage == true, preview?.latest != nil {
                Button("Cofnij ostatnie rozliczenie", role: .destructive) { voidReason = ""; voiding = true }
                    .buttonStyle(.link).disabled(busy || loading)
            }
        }
        .task(id: "\(employeeID)|\(Int(until.timeIntervalSince1970))|\(store.revision)") { await load() }
        .alert("Cofnij ostatnie rozliczenie", isPresented: $voiding) {
            TextField("Powód", text: $voidReason)
            Button("Cofnij rozliczenie", role: .destructive) { undo() }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Podaj powód cofnięcia ostatniego rozliczenia. Zapis pozostanie w historii.") }
    }

    private func form(_ preview: WorkTimeSettlementPreview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text((preview.latest.map { "Kolejne rozliczenie obejmie okres po \(WorkTimeFormat.dateTime($0.until))." }
                  ?? "Pierwsze rozliczenie obejmie dotychczasowy raport do wskazanego momentu.")
                 + " Kwota dotyczy wypłaty netto. Zapis zachowuje uzgodnienie w raporcie czasu pracy; przelew wykonujesz osobno.")
                .font(.callout).foregroundStyle(.secondary)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    Text("Rozliczony do")
                    WorkTimeSecondsPicker(date: Binding(get: { until }, set: { value in
                        hoursEdited = false
                        until = Date(timeIntervalSince1970: floor(value.timeIntervalSince1970))
                    }), maximum: Date())
                    .fixedSize()
                }
                GridRow {
                    Text("Liczba rozliczanych godzin")
                    TextField("Godziny", text: Binding(get: { hours }, set: { value in
                        guard value != hours else { return }
                        hoursEdited = true; accepted = false; hours = value
                    })).frame(maxWidth: 160).labelsHidden()
                }
                GridRow {
                    Text("Stawka netto za godzinę (zł)")
                    TextField("Stawka", text: $rate).frame(maxWidth: 160).labelsHidden()
                }
            }
            Text((loading ? "Przeliczam raport…"
                  : "Raport od poprzedniego rozliczenia: \(WorkTimeFormat.hours(preview.minutes)) godz. (\(preview.entryCount) zakończonych wpisów).")
                 + " Liczbę godzin możesz uzgodnić ręcznie.")
                .font(.callout).foregroundStyle(.secondary)
            if preview.crossingCount > 0 {
                Text("Wpis czasu trwa przez wybrany moment. Zakończ go lub wybierz moment pomiędzy wpisami.").font(.callout).foregroundStyle(workTimeOrange)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Notatka (opcjonalnie)").font(.callout)
                TextField("Notatka", text: Binding(get: { notes }, set: { notes = String($0.prefix(2000)) }), axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder).labelsHidden()
            }
            if needsAcceptance {
                Toggle("Potwierdzam, że wpisana liczba godzin uwzględnia uzgodnione korekty i zamyka rozliczenie pracy do wskazanego momentu.", isOn: $accepted)
                    .toggleStyle(.checkbox).font(.callout)
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Do wypłaty netto").font(.caption).foregroundStyle(.secondary)
                    Text(WorkTimeFormat.money(amount)).font(.title2.weight(.semibold)).foregroundStyle(theme.accent)
                }
                Spacer()
                Button {
                    save(preview)
                } label: {
                    HStack(spacing: 6) {
                        if busy { ProgressView().controlSize(.small) }
                        Text("Zastosuj rozliczenie")
                    }
                }
                .buttonStyle(.borderedProminent).disabled(!canApply)
            }
            if !valid && !loading {
                Text("Wpisz dodatnią liczbę godzin i stawkę (do dwóch miejsc po przecinku), a także moment późniejszy od poprzedniego rozliczenia i nie późniejszy niż teraz.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .disabled(busy)
    }

    private func history(_ preview: WorkTimeSettlementPreview) -> some View {
        DisclosureGroup("Historia rozliczeń (ostatnie \(preview.history.count))") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(preview.history) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text("Do \(WorkTimeFormat.dateTime(item.until))")
                            Spacer()
                            Text("\(WorkTimeFormat.number(item.hours)) godz. × \(WorkTimeFormat.money(item.rate)) = \(WorkTimeFormat.money(item.amount)) netto")
                                .fontWeight(.semibold)
                        }
                        Text("Zapisano \(WorkTimeFormat.dateTime(item.createdAt))" + (item.voidedAt != nil ? " · Cofnięto: \(item.voidReason)" : ""))
                            .font(.caption).foregroundStyle(item.voidedAt != nil ? workTimeOrange : .secondary)
                        if !item.notes.isEmpty { Text(item.notes).font(.caption).foregroundStyle(.secondary) }
                    }
                    .padding(10)
                    .opacity(item.voidedAt != nil ? 0.7 : 1)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.top, 6)
        }
        .font(.callout)
    }

    private func load() async {
        sequence += 1
        let mine = sequence
        loading = true; problem = ""; accepted = false
        do {
            let next = try await store.settlement(employee: employeeID, until: until)
            guard mine == sequence else { return }
            preview = next
            if !hoursEdited { hours = WorkTimeFormat.hours(next.minutes) }
            if rate.isEmpty, let latest = next.latest { rate = WorkTimeFormat.number(latest.rate) }
        } catch {
            guard mine == sequence else { return }
            problem = store.failureText(error, "Nie udało się pobrać rozliczeń.")
        }
        if mine == sequence { loading = false }
    }

    private func save(_ preview: WorkTimeSettlementPreview) {
        guard canApply, let count, let hourly else { return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        let untilISO = MeetingDates.iso(until)
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        // Ponowienie tego samego zapisu (np. po zerwanym połączeniu) używa tego samego identyfikatora — bez podwójnego rozliczenia.
        let key = [employeeID, untilISO, "\(count)", "\(hourly)", preview.latest?.id ?? "", preview.signature, note, "\(accepted)"].joined(separator: "|")
        if retryKey != key { retryKey = key; retryID = UUID().uuidString.lowercased() }
        let body: [String: JSONValue] = [
            "requestId": .string(retryID), "employeeId": .string(employeeID), "until": .string(untilISO), "hours": .number(count),
            "rate": .number(hourly), "previous": preview.latest.map { .string($0.id) } ?? .null, "signature": .string(preview.signature),
            "notes": .string(note), "accept": .bool(accepted),
        ]
        let total = amount
        busy = true; problem = ""
        Task {
            do {
                _ = try await state.withPending("Zapisywanie rozliczenia…") { try await store.post("settlementSave", body) }
                retryKey = ""; retryID = ""; hoursEdited = false; expanded = false; notes = ""
                state.succeed("Zapisano rozliczenie do \(WorkTimeFormat.dateTime(untilISO)): \(WorkTimeFormat.money(total)) netto.")
                busy = false
                await load()
            } catch {
                problem = store.failureText(error, "Nie udało się zapisać rozliczenia.")
                busy = false
            }
        }
    }

    private func undo() {
        let reason = voidReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let latest = preview?.latest, !busy, !reason.isEmpty else { return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        busy = true; problem = ""
        Task {
            do {
                _ = try await state.withPending("Cofanie rozliczenia…") {
                    try await store.post("settlementVoid", ["id": .string(latest.id), "reason": .string(reason)])
                }
                hoursEdited = false
                busy = false
                await load()
                state.succeed("Cofnięto oznaczenie ostatniego rozliczenia.")
            } catch {
                problem = store.failureText(error, "Nie udało się cofnąć rozliczenia.")
                busy = false
            }
        }
    }
}

/// Wynagrodzenie z umów w wybranym miesiącu.
@MainActor struct WorkTimeEarningsCard: View {
    @ObservedObject var store: TimeTrackingStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var month = MeetingDates.calendar.date(from: MeetingDates.calendar.dateComponents([.year, .month], from: Date())) ?? Date()
    @State private var data: WorkTimeEarnings?
    @State private var loading = true
    @State private var problem = ""
    @State private var selected: [String: String] = [:]
    @State private var busy = ""

    private var monthKey: String { MeetingDates.format(month, "yyyy-MM") }

    var body: some View {
        TeamCard(title: "Wynagrodzenie z umów", symbol: "banknote") {
            HStack(spacing: 10) {
                Text("Naliczenia za wykonaną pracę oraz zatwierdzone wypłaty.").font(.callout).foregroundStyle(.secondary)
                Spacer()
                if loading && data != nil { ProgressView().controlSize(.small) }
                Button { shift(-1) } label: { Image(systemName: "chevron.left") }.buttonStyle(.borderless).help("Poprzedni miesiąc")
                Text(MeetingDates.format(month, "LLLL yyyy")).font(.callout.weight(.semibold)).frame(minWidth: 120)
                Button { shift(1) } label: { Image(systemName: "chevron.right") }.buttonStyle(.borderless).help("Następny miesiąc")
            }
            if !problem.isEmpty { Text(problem).font(.callout).foregroundStyle(.orange) }
            if let data {
                content(data)
            } else if loading {
                Text("Ładowanie…").font(.callout).foregroundStyle(.secondary)
            }
        }
        .task(id: "\(employeeID)|\(monthKey)|\(store.revision)") { await load() }
    }

    @ViewBuilder private func content(_ data: WorkTimeEarnings) -> some View {
        if data.totals.isEmpty {
            Text("Brak naliczeń z godzin i akordu w tym miesiącu. Stałe wynagrodzenie pojawi się po zatwierdzeniu rozliczenia.")
                .font(.callout).foregroundStyle(.secondary)
        } else {
            HStack(spacing: 24) {
                ForEach(data.totals) { total in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Naliczone z godzin i akordu (\(total.basis))").font(.caption).foregroundStyle(.secondary)
                        Text(WorkTimeFormat.money(total.amount, total.currency)).font(.title2).foregroundStyle(theme.accent)
                    }
                }
            }
        }
        ForEach(data.settlements) { balance in
            HStack(spacing: 16) {
                Text(balance.contract).fontWeight(.semibold)
                Spacer()
                Text("Netto: \(WorkTimeFormat.money(balance.net, balance.currency))")
                Text("Wypłacono: \(WorkTimeFormat.money(balance.paid, balance.currency))")
                Text("Pozostało: \(WorkTimeFormat.money(balance.remaining, balance.currency))")
            }
            .font(.callout)
            .padding(10)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
        if !data.unlinked.isEmpty { unlinked(data) }
        Button("Profil pracownika i umowy →") { state.showEmployee(employeeID) }.buttonStyle(.link).font(.callout)
    }

    private func unlinked(_ data: WorkTimeEarnings) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Text("Poniższe godziny nie są ujęte w naliczeniu z umów. Przypisanie dobierze stawkę z dnia pracy.")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(data.unlinked) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(DayDates.display(MeetingDates.parse(entry.start).map { DayDates.string($0) } ?? entry.start)) · \(entry.title.nonEmpty ?? "Wpis czasu") · \(WorkTimeFormat.hours(entry.minutes)) godz.")
                            .font(.callout)
                        HStack(spacing: 8) {
                            Picker("Przypisz umowę", selection: Binding(get: { selected[entry.id] ?? "" }, set: { selected[entry.id] = $0 })) {
                                Text("Wybierz umowę").tag("")
                                ForEach(data.contracts) { Text($0.number).tag($0.id) }
                            }
                            .labelsHidden()
                            Button("Przypisz") { assign(entry.id) }
                                .disabled(!busy.isEmpty || (selected[entry.id] ?? "").isEmpty)
                        }
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.top, 6)
        } label: {
            Text("Wpisy bez przypisanej umowy (\(data.unlinked.count)\(data.unlinked.count == 100 ? "+" : ""))").foregroundStyle(workTimeOrange)
        }
        .font(.callout)
    }

    private func shift(_ step: Int) {
        if let next = MeetingDates.calendar.date(byAdding: .month, value: step, to: month) { month = next }
    }

    private func load() async {
        let key = monthKey
        loading = true; problem = ""
        do {
            let next = try await store.earnings(employee: employeeID, month: key)
            guard key == monthKey else { return }
            data = next
            selected = selected.filter { id, _ in next.unlinked.contains { $0.id == id } }
        } catch {
            guard key == monthKey else { return }
            problem = store.failureText(error, "Nie udało się pobrać wynagrodzenia.")
        }
        loading = false
    }

    private func assign(_ entryID: String) {
        guard busy.isEmpty, let contract = selected[entryID], !contract.isEmpty else { return }
        guard state.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        busy = entryID; problem = ""
        Task {
            do {
                _ = try await store.post("assignContract", ["entryId": .string(entryID), "contractId": .string(contract)])
                busy = ""
                await load()
            } catch {
                problem = store.failureText(error, "Nie udało się przypisać umowy.")
                busy = ""
            }
        }
    }
}

/// Dzień z godziną co do sekundy — jak „Rozliczony do dnia” + „Do godziny” (`step=1`) w CRM. `DatePicker` SwiftUI na macOS
/// nie pokazuje sekund, więc pole AppKit (`NSDatePicker`) z tymi samymi elementami.
struct WorkTimeSecondsPicker: NSViewRepresentable {
    @Binding var date: Date
    var maximum: Date?

    final class Coordinator: NSObject {
        var parent: WorkTimeSecondsPicker
        init(_ parent: WorkTimeSecondsPicker) { self.parent = parent }

        @objc func changed(_ sender: NSDatePicker) {
            if parent.date != sender.dateValue { parent.date = sender.dateValue }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSDatePicker {
        let picker = NSDatePicker()
        picker.datePickerStyle = .textFieldAndStepper
        picker.datePickerMode = .single
        picker.datePickerElements = [.yearMonthDay, .hourMinuteSecond]
        picker.isBezeled = true
        picker.drawsBackground = true
        picker.maxDate = maximum
        picker.dateValue = date
        picker.target = context.coordinator
        picker.action = #selector(Coordinator.changed(_:))
        return picker
    }

    func updateNSView(_ picker: NSDatePicker, context: Context) {
        context.coordinator.parent = self
        picker.maxDate = maximum
        if picker.dateValue != date { picker.dateValue = date }
    }
}
