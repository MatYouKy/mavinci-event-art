import SwiftUI

// MARK: Zamknięcie miesięcy — 1:1 z `FinancePeriodClosePanel.tsx`: rok, kafle miesięcy (zamknięty / przekazany i otwarty /
// otwarty / przyszły), przekazanie księgowej, notatka zamknięcia, historia ponownych otwarć; „Zamknij miesiąc” z notatką
// i „Otwórz ponownie” z uzasadnieniem (`lock_finance_period` / `unlock_finance_period` — blokadę pilnuje baza).

@MainActor struct FinancePeriodsView: View {
    @ObservedObject var store: FinanceStore
    let scope: FinScope
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var locking: FinPeriodTarget?
    @State private var unlocking: FinPeriodTarget?

    private static let green = CrmTheme.rgb(0x4ade80)
    private static let amber = CrmTheme.rgb(0xfbbf24)

    private var today: String { scope.today }
    private var currentYear: Int { Int(today.prefix(4)) ?? Calendar.current.component(.year, from: Date()) }
    private var currentMonth: Int { Int(today.dropFirst(5).prefix(2)) ?? 1 }
    /// Rok pokazanych zamknięć (wspólny dla wybranych działalności).
    private var year: Int { scope.entries.first?.state.periodsYear ?? currentYear }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Text("Po przekazaniu księgowej zamknij miesiąc — wyciągi, dopasowania i faktury z tego miesiąca nie zmienią się bez śladu.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Picker("Rok", selection: Binding(get: { year }, set: { value in Task { await store.loadPeriods(year: value) } })) {
                        ForEach([currentYear, currentYear - 1, currentYear - 2], id: \.self) { item in Text(String(item)).tag(item) }
                    }
                    .labelsHidden().fixedSize()
                    if store.periodsLoading { ProgressView().controlSize(.small) }
                    Button("Przekazanie księgowej") { store.part = .accountant }
                        .fixedSize().help("Paczka miesiąca dla księgowej — Saldeo, wyciągi i opisy płatności zbiorczych")
                }
                ForEach(scope.entries) { entry in companyCard(entry) }
                Text("Zamyka i otwiera osoba z „Zarządzaniem finansami” działalności. Blokadę sprawdza baza — obowiązuje w CRM, na Macu i w telefonie. Miesiąc wyciągu decyduje o operacjach bankowych, data wystawienia — o fakturach.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $locking) { target in
            FinPeriodSheet(store: store, company: target.company, year: target.year, period: target.period, unlock: false)
        }
        .sheet(item: $unlocking) { target in
            FinPeriodSheet(store: store, company: target.company, year: target.year, period: target.period, unlock: true)
        }
    }

    private func companyCard(_ entry: FinCompanyState) -> some View {
        FinCard(scope.multi ? "Zamknięcie miesięcy — \(entry.company.name)" : "Zamknięcie miesięcy", symbol: "lock") {
            VStack(alignment: .leading, spacing: 10) {
                if let error = entry.state.periodsError {
                    FinBanner(text: error, tone: .bad)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10, alignment: .top)], spacing: 10) {
                    ForEach(entry.state.periods) { period in monthCard(period, entry: entry) }
                }
            }
            .padding(14)
        }
    }

    private func monthCard(_ period: FinPeriod, entry: FinCompanyState) -> some View {
        let year = entry.state.periodsYear
        let future = year > currentYear || (year == currentYear && period.month > currentMonth)
        let handedOverOpen = !period.locked && period.handedOverAt != nil
        let name = (1...12).contains(period.month) ? FinFormat.monthsTitle[period.month - 1] : "\(period.month)"
        let border: Color = period.locked ? Self.green.opacity(0.35) : handedOverOpen ? Self.amber.opacity(0.4) : Color.primary.opacity(0.08)
        let fill: Color = period.locked ? Self.green.opacity(0.06) : handedOverOpen ? Self.amber.opacity(0.06) : Color.primary.opacity(0.03)
        let target = FinPeriodTarget(company: entry.company, year: year, period: period)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(.headline).lineLimit(1)
                Spacer(minLength: 6)
                if period.locked {
                    Label("Zamknięty", systemImage: "lock.fill").font(.caption).foregroundStyle(Self.green).lineLimit(1)
                } else if handedOverOpen {
                    Text("Przekazany · otwarty").font(.caption).foregroundStyle(Self.amber).lineLimit(1)
                } else {
                    Text(future ? "Przyszły" : "Otwarty").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let handed = period.handedOverAt {
                Label("Przekazany księgowej \(FinFormat.dateTime(handed))", systemImage: "paperplane").font(.caption).foregroundStyle(.secondary)
            }
            if period.locked {
                Label("Zamknięty \(FinFormat.dateTime(period.lockedAt))" + (period.lockedByName.map { " · \($0)" } ?? ""), systemImage: "checkmark.circle")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let note = period.lockNote {
                Text("„\(note)”").font(.caption).fixedSize(horizontal: false, vertical: true)
            }
            if !period.reopenings.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(period.reopenings, id: \.unlockedAt) { item in
                            Text("\(FinFormat.dateTime(item.unlockedAt))" + (item.byName.map { " · \($0)" } ?? "") + " — \(item.reason ?? "")")
                                .font(.caption).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } label: {
                    Label("Otwierany ponownie: \(period.reopenings.count)×", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary)
                }
            }
            if entry.company.canManage && !future {
                if period.locked {
                    Button { unlocking = target } label: { Label("Otwórz ponownie", systemImage: "lock.open") }
                        .controlSize(.small).disabled(!state.canWrite)
                } else {
                    Button { locking = target } label: { Label("Zamknij miesiąc", systemImage: "lock") }
                        .controlSize(.small).disabled(!state.canWrite)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(fill, in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(border))
        .opacity(future ? 0.55 : 1)
    }
}

/// Miesiąc działalności do zamknięcia albo ponownego otwarcia.
struct FinPeriodTarget: Identifiable {
    let company: FinCompany
    let year: Int
    let period: FinPeriod
    var id: String { "\(company.id)|\(year)|\(period.month)" }
}

/// Okno „Zamknięcie: <miesiąc>” (notatka opcjonalna) albo „Ponowne otwarcie: <miesiąc>” (uzasadnienie co najmniej 10 znaków).
@MainActor struct FinPeriodSheet: View {
    @ObservedObject var store: FinanceStore
    let company: FinCompany
    let year: Int
    let period: FinPeriod
    let unlock: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var problem: String?

    private var label: String {
        let name = (1...12).contains(period.month) ? FinFormat.months[period.month - 1] : "\(period.month)"
        return "\(name) \(year)" + (store.companies.count > 1 ? " — \(company.name)" : "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(unlock ? "Ponowne otwarcie: \(label)" : "Zamknięcie: \(label)", systemImage: unlock ? "lock.open" : "lock").font(.title3.bold())
            if unlock {
                Text("Uzasadnienie zostaje w historii miesiąca (kto, kiedy, dlaczego). Po zmianach przekaż miesiąc księgowej ponownie i zamknij go.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Po zamknięciu w tym miesiącu nie da się:").font(.callout)
                VStack(alignment: .leading, spacing: 4) {
                    Text("• wczytać ani usunąć wyciągu, wyjaśniać operacji, przypinać i odpinać dokumentów, przypisywać przelewów do ZUS i podatków,")
                    Text("• wystawić, usunąć ani anulować faktury z datą w tym miesiącu, zmienić jej numeru, dat, kwot, nabywcy i pozycji,")
                    Text("• usunąć ani zmienić kwot i dat dokumentów spoza KSeF.")
                }
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("Zapłaty faktur, wysyłka do KSeF i e-maile działają dalej. Szkice i pro formy nie są blokowane." + (period.handedOverAt == nil ? " Ten miesiąc nie był jeszcze przekazany księgowej z CRM." : ""))
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Text(unlock ? "Uzasadnienie" : "Notatka (opcjonalnie)").font(.callout.weight(.medium))
            TextEditor(text: Binding(get: { text }, set: { text = String($0.prefix(500)) }))
                .font(.body).frame(height: unlock ? 90 : 60)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(unlock ? "Otwórz miesiąc" : "Zamknij miesiąc") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 540)
        .alert(unlock ? "Nie otwarto miesiąca" : "Nie zamknięto miesiąca", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
    }

    private func save() async {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if unlock && value.count < 10 { problem = "Podaj uzasadnienie ponownego otwarcia (co najmniej 10 znaków)."; return }
        var body: [String: JSONValue] = ["companyId": .string(company.id), "year": .number(Double(year)), "month": .number(Double(period.month))]
        body[unlock ? "reason" : "note"] = .string(value)
        if await store.run(unlock ? "Otwieranie miesiąca…" : "Zamykanie miesiąca…", unlock ? "unlock" : "lock", body) { dismiss() }
    }
}
