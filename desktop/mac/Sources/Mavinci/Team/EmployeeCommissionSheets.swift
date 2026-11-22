import SwiftUI

// MARK: Okna zakładki „Prowizje”: zapis wypłaty (jak formularz w `CommissionSettlementsPanel`), potrącenie nadpłaty,
// rozliczenie przy wypłacie wynagrodzenia (wiele prowizji naraz) i warunki „Prowizja od sprzedaży” (administrator).
// Zapisy z identyfikatorem operacji: po niepewnej odpowiedzi „Ponów” wysyła dokładnie to samo — baza nie zapisze drugi raz.

private func amountText(_ value: Double) -> String {
    String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
}

private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

private struct UncertainBanner: View {
    let text: String
    var body: some View {
        Label { Text(verbatim: text).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
            .font(.callout).foregroundStyle(.orange)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 20)
    }
}

// MARK: Zapis wykonanej wypłaty

@MainActor struct CommissionPayoutSheet<Store: CommissionAccountHost>: View {
    @ObservedObject var store: Store
    let employeeID: String
    let row: EmployeeCommission
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var amount = ""
    @State private var date = DayDates.today
    @State private var reference = ""
    @State private var note = ""
    @State private var confirmed = false
    @State private var busy = false
    @State private var problem: String?
    @State private var uncertain = false
    @State private var pending: [String: JSONValue]?
    @State private var prepared = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Zapis wykonanej wypłaty").font(.title2.bold())
                Text(verbatim: "\(row.eventName) · \(row.beneficiaryName)").foregroundStyle(theme.accent)
                Text(verbatim: "Naliczone: \(CommissionText.money(row.amount)) · Wypłacone: \(CommissionText.money(row.paidAmount)) · Pozostało: \(CommissionText.money(row.remainingAmount))")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section {
                    TextField(text: $amount) { Text(verbatim: "Kwota wypłacona (PLN)") }
                    DatePicker("Data faktycznej wypłaty", selection: $date, in: ...Date(), displayedComponents: .date)
                    TextField("Numer przelewu / dokumentu", text: $reference, prompt: Text("Opcjonalnie, np. numer referencyjny przelewu"))
                    TextField("Opis rozliczenia", text: $note, prompt: Text("Opcjonalnie — notatka wewnętrzna CRM"), axis: .vertical).lineLimit(2...4)
                } footer: {
                    Text("Kwota może być mniejsza od pozostałego salda. Ten rejestr nie wykonuje przelewów bankowych.").font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Toggle(isOn: $confirmed) {
                        Text("Potwierdzam, że wskazana wypłata została wykonana. Zapisuję jej historię, nie zlecam przelewu.")
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .toggleStyle(.checkbox)
                }
            }
            .formStyle(.grouped)
            .disabled(busy || uncertain)
            if uncertain {
                UncertainBanner(text: "Odpowiedź na zapis jest niepewna. Nie wpisuj tej wypłaty ponownie jako nowej i nie zamykaj okna. Ponowienie użyje tego samego identyfikatora i nie doda duplikatu.")
            }
            if let problem {
                Text(verbatim: problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 8)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy || uncertain)
                Button(busy ? "Zapisywanie…" : uncertain ? "Ponów bezpiecznie zapis" : "Zapisz wykonaną wypłatę") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy || (!confirmed && !uncertain))
            }
            .padding(16)
        }
        .frame(width: 540)
        .frame(minHeight: 460)
        .background(theme.page)
        .interactiveDismissDisabled(busy || uncertain)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            amount = amountText(row.remainingAmount)
        }
    }

    private func save() async {
        guard !busy else { return }
        problem = nil
        if pending == nil {
            guard row.canManage, row.status == "approved", !row.waiting, !row.isDeduction else {
                problem = "Ta prowizja nie jest gotowa do rozliczenia. Odśwież dane."; return
            }
            guard let cents = CommissionText.parseCents(amount), cents <= row.remainingCents else {
                problem = "Podaj dodatnią kwotę nie większą niż pozostałe saldo, z maksymalnie dwoma miejscami po przecinku."; return
            }
            let day = DayDates.string(date)
            guard day <= DayDates.string(Date()) else { problem = "Wpisz prawidłową datę wykonanej wypłaty, nie późniejszą niż dzisiaj."; return }
            guard confirmed else { problem = "Potwierdź, że ta wypłata została już wykonana."; return }
            let ref = trimmed(reference), text = trimmed(note)
            guard ref.count <= 200, text.count <= 2000 else { problem = "Numer lub opis jest zbyt długi (maksymalnie 200 / 2000 znaków)."; return }
            pending = [
                "commissionId": .string(row.id), "amount": .number(Double(cents) / 100), "paymentDate": .string(day),
                "reference": .string(ref), "note": .string(text), "idempotencyKey": .string(UUID().uuidString.lowercased()),
            ]
        }
        guard let payload = pending else { return }
        busy = true
        defer { busy = false }
        do {
            let reply = try await store.commissionPost("commissionPayout", employeeID, payload, as: CommissionWriteReply.self)
            pending = nil
            uncertain = false
            state.succeed(reply.duplicate == true ? "Ta wypłata była już zapisana — nie dodano duplikatu." : "Wypłata zapisana. Saldo zostało pomniejszone, historia pozostaje dostępna.")
            dismiss()
        } catch {
            if TeamStore.uncertain(error) {
                uncertain = true
                problem = store.failureText(error, "Nie udało się potwierdzić zapisu wypłaty.")
            } else {
                pending = nil
                uncertain = false
                problem = store.failureText(error, "Nie udało się zapisać wypłaty.")
            }
        }
    }
}

// MARK: Potrącenie nadpłaty z innej prowizji

@MainActor struct CommissionDeductionSheet<Store: CommissionAccountHost>: View {
    @ObservedObject var store: Store
    let employeeID: String
    let deduction: EmployeeCommission
    let targets: [EmployeeCommission]
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var target = ""
    @State private var key = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var uncertain = false
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Potrącenie z prowizji").font(.title2.bold())
                Text(verbatim: "\(deduction.eventName) · \(deduction.beneficiaryName)").foregroundStyle(theme.accent)
                Text(verbatim: "Do potrącenia: \(CommissionText.money(deduction.toOffset)). Wybierz zatwierdzoną prowizję tej samej osoby i marki (ten sam sposób wypłaty albo ten sam event). Baza potrąci mniejszą z kwot — pozostałe potrącenie albo kwotę do wypłaty z wybranej prowizji. Zapis trafi do historii obu wpisów, bez przelewu.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            if targets.isEmpty {
                Text("Brak zatwierdzonej prowizji tej osoby (ta sama marka i sposób wypłaty) z kwotą do wypłaty. Potrącenie poczeka na kolejną prowizję.")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(targets) { row in
                            Button { target = row.id; problem = nil } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: target == row.id ? "largecircle.fill.circle" : "circle").foregroundStyle(theme.accent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(verbatim: row.eventName.isEmpty ? "Event" : row.eventName).fontWeight(.medium)
                                        Text(verbatim: [row.beneficiaryName, row.day, CommissionText.method(row.paymentMethod)].filter { !$0.isEmpty }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    Text(verbatim: "zostało " + CommissionText.money(row.remainingAmount)).foregroundStyle(theme.accent).monospacedDigit()
                                }
                                .padding(10)
                                .background(target == row.id ? theme.accent.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .frame(maxHeight: 300)
                .disabled(busy || uncertain)
            }
            if uncertain {
                UncertainBanner(text: "Odpowiedź na zapis potrącenia jest niepewna. Ponowienie użyje tego samego identyfikatora — baza nie zapisze potrącenia drugi raz.")
                    .padding(.top, 8)
            }
            if let problem {
                Text(verbatim: problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 8)
            }
            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy || uncertain)
                Button(busy ? "Zapisywanie…" : uncertain ? "Ponów bezpiecznie" : "Potrąć z wybranej prowizji") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy || target.isEmpty)
            }
            .padding(16)
        }
        .frame(width: 560)
        .frame(minHeight: 420)
        .background(theme.page)
        .interactiveDismissDisabled(busy || uncertain)
    }

    private func save() async {
        guard !busy else { return }
        guard !target.isEmpty else { problem = "Wybierz prowizję, z której potrącisz kwotę."; return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let reply = try await store.commissionPost("commissionDeduct", employeeID, [
                "deductionId": .string(deduction.id), "targetId": .string(target), "idempotencyKey": .string(key),
            ], as: CommissionWriteReply.self)
            uncertain = false
            state.succeed(reply.duplicate == true ? "To potrącenie było już zapisane — nie dodano duplikatu."
                          : "Potrącono \(CommissionText.money(reply.amount ?? 0)) — zapis w rejestrze obu prowizji, bez przelewu.")
            dismiss()
        } catch {
            if TeamStore.uncertain(error) {
                uncertain = true
            } else {
                // Baza odrzuciła zapis (nic nie zapisano) — kolejna próba dostanie nowy identyfikator.
                uncertain = false
                key = UUID().uuidString.lowercased()
            }
            problem = store.failureText(error, "Nie udało się zapisać potrącenia.")
        }
    }
}

// MARK: Rozliczenie przy wypłacie wynagrodzenia

@MainActor struct CommissionPayrollSheet<Store: CommissionAccountHost>: View {
    @ObservedObject var store: Store
    let employeeID: String
    let employeeName: String
    let account: EmployeeCommissionAccount
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var method = "payroll"
    @State private var selected: Set<String> = []
    @State private var applyDeductions = true
    @State private var date = DayDates.today
    @State private var reference = ""
    @State private var note = ""
    @State private var confirmed = false
    @State private var busy = false
    @State private var problem: String?
    @State private var uncertain = false
    @State private var batchKey = UUID().uuidString.lowercased()
    @State private var pending: [String: JSONValue]?
    @State private var reply: CommissionPayrollReply?
    @State private var prepared = false
    private let green = CrmTheme.rgb(0x6ee7b7)
    private let red = CrmTheme.rgb(0xfda4af)

    private var candidates: [EmployeeCommission] { CommissionPayrollPlan.ordered(account.commissions.filter(\.payable)) }
    private var shown: [EmployeeCommission] { method == "all" ? candidates : candidates.filter { $0.paymentMethod == method } }
    private var chosen: [EmployeeCommission] { shown.filter { selected.contains($0.id) } }
    private var steps: [CommissionOffsetStep] {
        applyDeductions ? CommissionPayrollPlan.offsets(account.commissions, selected: Set(chosen.map(\.id))) : []
    }
    private var openDeductionCents: Int {
        account.commissions.filter { $0.canManage && $0.isDeduction && $0.status == "approved" }.reduce(0) { $0 + $1.toOffsetCents }
    }
    private var methodOptions: [InquiryOption] {
        CommissionText.methods.filter { option in candidates.contains { $0.paymentMethod == option.value } }
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Rozlicz prowizje przy wypłacie").font(.title2.bold())
                Text(verbatim: employeeName).foregroundStyle(theme.accent)
                Text("Zapisuje wypłatę zaznaczonych prowizji z jedną datą i numerem listy płac. Najpierw odejmuje otwarte nadpłaty (potrącenia) tej samej osoby i marki. Nie zleca przelewu — zapisuje historię rozliczeń w CRM; prowizja po wypłacie ma status „Wypłacona”.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            Divider()
            if let reply { resultView(reply) } else { form }
            if uncertain {
                UncertainBanner(text: "Odpowiedź serwera jest niepewna — część wypłat mogła się zapisać. Nie rozliczaj ich ponownie jako nowych: „Ponów bezpiecznie” sprawdzi stan i nie zapisze niczego drugi raz.")
                    .padding(.top, 8)
            }
            if let problem {
                Text(verbatim: problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 8)
            }
            footer
        }
        .frame(width: 700)
        .frame(minHeight: 620, idealHeight: 720)
        .background(theme.page)
        .interactiveDismissDisabled(busy || uncertain)
        .onAppear(perform: prepare)
        .onChange(of: method) { _, value in
            guard reply == nil && pending == nil else { return }
            selected = Set(shown.map(\.id))
            // Domyślny opis zmienia się ze sposobem wypłaty, dopóki użytkownik nie wpisał własnego.
            if reference == defaultReference("payroll") || reference == defaultReference("all") { reference = defaultReference(value) }
        }
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        let payroll = candidates.filter { $0.paymentMethod == "payroll" }
        let initial = payroll.isEmpty ? "all" : "payroll"
        method = initial
        selected = Set((payroll.isEmpty ? candidates : payroll).map(\.id))
        reference = defaultReference(initial)
    }

    /// „Lista płac 11/2026” przy wynagrodzeniu pracowniczym, inaczej „Wypłata prowizji 11/2026”.
    private func defaultReference(_ value: String) -> String {
        (value == "payroll" ? "Lista płac " : "Wypłata prowizji ") + MeetingDates.format(Date(), "MM/yyyy")
    }

    private var form: some View {
        let grossCents = chosen.reduce(0) { $0 + $1.remainingCents }
        let offsetCents = steps.reduce(0) { $0 + $1.amountCents }
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if candidates.isEmpty {
                    Text("Brak zatwierdzonych prowizji z kwotą do wypłaty. Prowizje z podsumowania eventu stają się do wypłaty po zatwierdzeniu podsumowania.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    HStack {
                        Picker("Sposób wypłaty", selection: $method) {
                            ForEach(methodOptions) { option in
                                Text(verbatim: "\(option.label) (\(candidates.filter { $0.paymentMethod == option.value }.count))").tag(option.value)
                            }
                            Text(verbatim: "Wszystkie sposoby (\(candidates.count))").tag("all")
                        }
                        .frame(maxWidth: 380)
                        Spacer()
                        Button(chosen.count == shown.count ? "Odznacz wszystkie" : "Zaznacz wszystkie") {
                            selected = chosen.count == shown.count ? [] : Set(shown.map(\.id))
                        }
                        .buttonStyle(.link)
                    }
                    VStack(spacing: 6) {
                        ForEach(shown) { row in candidateRow(row) }
                    }
                    if openDeductionCents > 0 { deductionsBox }
                    HStack(alignment: .bottom, spacing: 28) {
                        figure("Prowizje", cents: grossCents, color: .primary)
                        if offsetCents > 0 { figure("Potrącenia nadpłat", cents: -offsetCents, color: red) }
                        figure("Do wypłaty", cents: grossCents - offsetCents, color: theme.accent, large: true)
                        Spacer()
                    }
                    .padding(12)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                        GridRow {
                            Text("Data wypłaty").foregroundStyle(.secondary)
                            DatePicker("Data wypłaty", selection: $date, in: ...Date(), displayedComponents: .date).labelsHidden().fixedSize()
                        }
                        GridRow {
                            Text("Numer listy płac / przelewu").foregroundStyle(.secondary)
                            TextField("Numer listy płac / przelewu", text: $reference, prompt: Text("np. Lista płac 11/2026")).labelsHidden().textFieldStyle(.roundedBorder)
                        }
                        GridRow {
                            Text("Opis (opcjonalnie)").foregroundStyle(.secondary)
                            TextField("Opis", text: $note, prompt: Text("Notatka wewnętrzna CRM"), axis: .vertical).labelsHidden().lineLimit(1...3).textFieldStyle(.roundedBorder)
                        }
                    }
                    Toggle(isOn: $confirmed) {
                        Text("Potwierdzam, że wypłata (np. razem z listą płac) została wykonana. Zapisuję jej historię w CRM, nie zlecam przelewu.")
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .toggleStyle(.checkbox)
                }
            }
            .padding(20)
        }
        .disabled(busy || uncertain)
    }

    private func candidateRow(_ row: EmployeeCommission) -> some View {
        let on = selected.contains(row.id)
        return Toggle(isOn: Binding(get: { selected.contains(row.id) }, set: { value in
            if value { selected.insert(row.id) } else { selected.remove(row.id) }
        })) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.eventName.isEmpty ? "Event" : row.eventName).fontWeight(.medium)
                    Text(verbatim: [row.day, row.companyName ?? "", CommissionText.method(row.paymentMethod)].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    if let kind = CommissionText.kind(row.entryKind) { Text(verbatim: kind).font(.caption2).foregroundStyle(green) }
                }
                Spacer(minLength: 8)
                Text(verbatim: CommissionText.money(row.remainingAmount)).monospacedDigit().foregroundStyle(on ? Color.primary : Color.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .toggleStyle(.checkbox)
        .padding(10)
        .background(on ? theme.accent.opacity(0.08) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    private var deductionsBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: $applyDeductions) {
                Text(verbatim: "Najpierw potrąć otwarte nadpłaty (do potrącenia razem: \(CommissionText.money(cents: openDeductionCents)))")
            }
            .toggleStyle(.checkbox)
            if applyDeductions {
                if steps.isEmpty {
                    Text("Otwarte potrącenia nie dotyczą zaznaczonych prowizji (inna osoba, marka lub sposób wypłaty) — zostaną do kolejnych prowizji.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(steps) { step in
                    HStack {
                        Text(verbatim: "\(step.deduction.eventName) → \(step.target.eventName)").lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Text(verbatim: "−" + CommissionText.money(cents: step.amountCents)).monospacedDigit().foregroundStyle(red)
                    }
                    .font(.caption)
                }
            } else {
                Text("Potrącenia zostaną na później — zapiszesz pełne kwoty zaznaczonych prowizji. Wypłatę wpisu ręcznego z otwartym potrąceniem z tego samego eventu baza odrzuci.")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(red.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
    }

    private func figure(_ label: String, cents: Int, color: Color, large: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(verbatim: CommissionText.money(cents: cents)).font(large ? .title2.weight(.semibold) : .title3).monospacedDigit().foregroundStyle(color)
        }
    }

    private func resultView(_ reply: CommissionPayrollReply) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .bottom, spacing: 28) {
                    figure("Wypłacono", cents: CommissionText.cents(reply.paid), color: green, large: true)
                    figure("Potrącono nadpłat", cents: CommissionText.cents(reply.offset), color: .primary)
                    Spacer()
                }
                if let message = reply.message, !message.isEmpty {
                    Label { Text(verbatim: message).fixedSize(horizontal: false, vertical: true) } icon: {
                        Image(systemName: reply.done ? "checkmark.circle" : "exclamationmark.triangle")
                    }
                    .foregroundStyle(reply.done ? green : Color.orange)
                } else if reply.done {
                    Label("Rozliczenie zapisane.", systemImage: "checkmark.circle").foregroundStyle(green)
                }
                ForEach(Array(reply.lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(line.kind)).foregroundStyle(color(line.kind))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: line.eventName).fontWeight(.medium)
                            Text(verbatim: line.message).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        if line.amount > 0 {
                            Text(verbatim: (line.kind == "offset" ? "−" : "") + CommissionText.money(line.amount)).monospacedDigit()
                                .foregroundStyle(line.kind == "error" ? Color.secondary : Color.primary)
                        }
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(20)
        }
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "paid": return "checkmark.circle.fill"
        case "offset": return "scissors"
        case "error": return "xmark.octagon.fill"
        default: return "minus.circle"
        }
    }
    private func color(_ kind: String) -> Color {
        switch kind {
        case "paid": return green
        case "offset": return red
        case "error": return Color.orange
        default: return Color.secondary
        }
    }

    private var footer: some View {
        HStack {
            if let reply {
                Spacer()
                if !reply.done {
                    Button(busy ? "Sprawdzanie…" : "Ponów bezpiecznie") { Task { await submit() } }.disabled(busy || pending == nil)
                }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy)
            } else {
                Text(verbatim: "Zaznaczono \(chosen.count) z \(shown.count)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy || uncertain)
                Button(busy ? "Zapisywanie…" : uncertain ? "Ponów bezpiecznie" : "Zapisz rozliczenie") { Task { await submit() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .disabled(busy || (!uncertain && (chosen.isEmpty || !confirmed)))
            }
        }
        .padding(16)
    }

    private func submit() async {
        guard !busy else { return }
        problem = nil
        if pending == nil {
            let ids = chosen.map(\.id)
            guard !ids.isEmpty else { problem = "Zaznacz prowizje do rozliczenia."; return }
            guard ids.count <= 100 else { problem = "Jednym rozliczeniem zapiszesz najwyżej 100 prowizji."; return }
            let day = DayDates.string(date)
            guard day <= DayDates.string(Date()) else { problem = "Wpisz prawidłową datę wykonanej wypłaty, nie późniejszą niż dzisiaj."; return }
            guard confirmed else { problem = "Potwierdź, że wypłata została wykonana."; return }
            let ref = trimmed(reference), text = trimmed(note)
            guard ref.count <= 200, text.count <= 2000 else { problem = "Numer lub opis jest zbyt długi (maksymalnie 200 / 2000 znaków)."; return }
            pending = [
                "batchKey": .string(batchKey), "commissionIds": .array(ids.map { .string($0) }), "paymentDate": .string(day),
                "reference": .string(ref), "note": .string(text), "applyDeductions": .bool(applyDeductions),
            ]
        }
        guard let payload = pending else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await store.commissionPost("commissionPayroll", employeeID, payload, as: CommissionPayrollReply.self)
            reply = result
            uncertain = false
            if result.done {
                pending = nil
                state.succeed("Rozliczono przy wypłacie: wypłacono \(CommissionText.money(result.paid))" + (result.offset > 0 ? ", potrącono \(CommissionText.money(result.offset))." : "."))
            }
        } catch {
            if TeamStore.uncertain(error) {
                uncertain = true
                problem = store.failureText(error, "Nie udało się potwierdzić rozliczenia.")
            } else {
                // Serwer odrzucił rozliczenie przed zapisami (np. dane się zmieniły) — popraw i zapisz ponownie.
                pending = nil
                uncertain = false
                problem = store.failureText(error, "Nie udało się zapisać rozliczenia.")
            }
        }
    }
}

// MARK: Warunki „Prowizja od sprzedaży” (administrator, `set_employee_sales_commission_terms`)

@MainActor struct CommissionTermsSheet<Store: CommissionAccountHost>: View {
    @ObservedObject var store: Store
    let employeeID: String
    let employeeName: String
    let terms: EmployeeCommissionTerms
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var enabled = false
    @State private var standard = ""
    @State private var ownClient = ""
    @State private var method = "payroll"
    @State private var busy = false
    @State private var problem: String?
    @State private var prepared = false

    private var defaults: String {
        "Puste pole stawki = stawka globalna (" + CommissionText.percent(terms.defaultStandardRate ?? 5) + " / "
            + CommissionText.percent(terms.defaultOwnClientRate ?? 10) + "). Po zapisie prognozy otwartych eventów się przeliczą; zatwierdzone rozliczenia zachowują swoje stawki."
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Prowizja od sprzedaży").font(.title2.bold())
                Text(verbatim: employeeName).foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section {
                    Toggle("Prowizja od sprzedaży włączona", isOn: $enabled)
                    TextField(text: $standard, prompt: Text(verbatim: "globalna: " + CommissionText.percent(terms.defaultStandardRate ?? 5))) {
                        Text(verbatim: "Stawka podstawowa (% zysku netto)")
                    }
                    TextField(text: $ownClient, prompt: Text(verbatim: "globalna: " + CommissionText.percent(terms.defaultOwnClientRate ?? 10))) {
                        Text(verbatim: "Klient własny (% zysku netto)")
                    }
                    Picker("Sposób wypłaty", selection: $method) {
                        ForEach(CommissionText.methods) { Text($0.label).tag($0.value) }
                    }
                } footer: {
                    Text(verbatim: defaults).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .formStyle(.grouped)
            .disabled(busy)
            if let problem {
                Text(verbatim: problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy)
                Button(busy ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy)
            }
            .padding(16)
        }
        .frame(width: 500)
        .frame(minHeight: 380)
        .background(theme.page)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            enabled = terms.enabled
            standard = CommissionText.rateText(terms.customStandardRate)
            ownClient = CommissionText.rateText(terms.customOwnClientRate)
            method = terms.paymentMethod
        }
    }

    private func save() async {
        guard !busy else { return }
        guard let standardRate = CommissionText.parseRate(standard), let ownClientRate = CommissionText.parseRate(ownClient) else {
            problem = "Stawki muszą mieścić się w zakresie 0–100%."; return
        }
        problem = nil
        busy = true
        defer { busy = false }
        let data: [String: JSONValue] = [
            "enabled": .bool(enabled),
            "standardRate": standardRate.map { JSONValue.number($0) } ?? JSONValue.null,
            "ownClientRate": ownClientRate.map { JSONValue.number($0) } ?? JSONValue.null,
            "paymentMethod": .string(method),
        ]
        do {
            _ = try await store.commissionPost("commissionTerms", employeeID, ["data": .object(data)], as: CommissionWriteReply.self)
            state.succeed("Warunki prowizji zapisane — prognozy otwartych eventów przeliczone.")
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać warunków prowizji.")
        }
    }
}
