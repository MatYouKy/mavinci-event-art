import SwiftUI

// MARK: Finanse (`/crm/invoices`) — natywnie: Centrum finansów, Wyciągi, Uzgodnienie wyciągów, Terminy i monity,
// Deklaracje ZUS i podatki, Umowy stałe (ze skanerem umów), Zamknięcie miesięcy, Koszty i wypłaty (jak sekcje CRM „Centrum finansów”, „Dokumenty
// i rozliczenia” i „Koszty i wypłaty”), rejestr faktur z kartą faktury, faktury KSeF (wpłaty, synchronizacja) i przekazanie
// księgowej (Saldeo). W CRM zostają wystawianie i edycja faktur oraz konfiguracja KSeF.

@MainActor struct FinanceView: View {
    @ObservedObject var store: FinanceStore
    @ObservedObject var bank: FinanceBankStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var helpFor: FinancePart?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if store.loaded && store.companies.isEmpty {
                ContentUnavailableView {
                    Label("Brak działalności z dostępem do finansów", systemImage: "banknote")
                } description: {
                    Text("Centrum finansów, terminy i zamknięcia miesięcy widzą osoby z „Podglądem finansów” działalności. Twoje faktury są w CRM.")
                } actions: {
                    Button("Otwórz Finanse w przeglądarce") { state.openCRM("/crm/invoices") }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.scope.entries.isEmpty, let error = store.loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać finansów", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.scope.entries.isEmpty {
                ProgressView("Ładowanie finansów…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    sidebar
                    Divider()
                    // `minHeight: 0` — część nie wymusza minimalnej wysokości okna. Przy liczeniu minimum SwiftUI podaje szerokość 0,
                    // a tekst zawijany bez skracania (`fixedSize` w pionie: przypisy, ostrzeżenia) ma wtedy tysiące punktów wysokości;
                    // bez tego „Terminy i monity” (treść poza przewijaniem) rozpychały całe okno i ekran wyglądał na pusty.
                    content.frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
                }
            }
        }
        .navigationTitle("Finanse")
        .task { await store.sync() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "banknote").font(.title2).foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Finanse").font(.title2.weight(.semibold))
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if store.companies.count > 1 {
                Menu {
                    Button("Wszystkie działalności") { store.selectAll() }.disabled(store.allSelected)
                    Divider()
                    ForEach(store.companies) { company in
                        Toggle(company.name, isOn: Binding(get: { store.isSelected(company.id) }, set: { _ in store.toggle(company.id) }))
                    }
                    Divider()
                    ForEach(store.companies) { company in
                        Button("Tylko \(company.name)") { store.selectOnly(company.id) }
                    }
                } label: {
                    Label(store.scopeTitle, systemImage: "building.2")
                }
                .fixedSize()
                .help("Działalności do rozliczenia — jedna albo kilka razem (sumy, prognoza i listy łączą wybrane)")
            } else if let company = store.companies.first {
                Text(company.name).foregroundStyle(.secondary).lineLimit(1)
            }
            Button { Task { await store.sync(force: true) } } label: {
                if store.syncing { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .disabled(store.syncing)
            .help("Pobierz aktualne dane z serwera")
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    private var subtitle: String {
        let scope = store.scope
        guard !scope.entries.isEmpty else { return "Gotówka, należności, zobowiązania, podatki i terminy" }
        let stamp = FinFormat.dateTime(store.loadedAt)
        return "Stan na \(FinFormat.day(scope.today))" + (stamp.isEmpty ? "" : " · pobrano \(stamp)")
    }

    private var groups: [(String, [FinancePart])] {
        var result: [(String, [FinancePart])] = []
        for part in FinancePart.allCases {
            if let index = result.firstIndex(where: { $0.0 == part.group }) { result[index].1.append(part) } else { result.append((part.group, [part])) }
        }
        return result
    }

    private var sidebar: some View {
        List(selection: Binding(get: { Optional(store.part) }, set: { if let value = $0 { store.part = value } })) {
            ForEach(groups, id: \.0) { group in
            Section(group.0) {
                ForEach(group.1) { item in
                    HStack(spacing: 4) {
                        Label {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.label)
                                Text(item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        } icon: { Image(systemName: item.symbol) }
                        Spacer(minLength: 2)
                        if let count = badge(item), count > 0 {
                            Text("\(count)").font(.caption.weight(.semibold)).monospacedDigit()
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Color.red.opacity(0.18), in: Capsule()).foregroundStyle(CrmTheme.rgb(0xf87171))
                                .help("Pozycje wymagające uwagi")
                        }
                        Button { helpFor = item } label: { Image(systemName: "questionmark.circle") }
                            .buttonStyle(.borderless).foregroundStyle(.secondary).help("Co jest w tej części i po co")
                            .popover(isPresented: Binding(get: { helpFor == item }, set: { if !$0 { helpFor = nil } }), arrowEdge: .trailing) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(item.label).font(.headline)
                                    Text(item.help).font(.callout).fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(14).frame(width: 340, alignment: .leading)
                            }
                    }
                    .padding(.vertical, 2)
                    .tag(item)
                }
            }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .frame(width: 250)
        .background(Color.primary.opacity(0.03))
    }

    /// Liczba pozycji wymagających uwagi (błędy kompletności danych, sprawy po terminie, otwarty poprzedni miesiąc).
    private func badge(_ part: FinancePart) -> Int? {
        let scope = store.scope
        guard !scope.entries.isEmpty else { return nil }
        switch part {
        case .center:
            return scope.entries.reduce(0) { total, entry in total + (entry.state.center?.quality.filter { $0.level == "error" }.count ?? 0) }
        case .deadlines:
            var count = 0
            for entry in scope.entries {
                guard let deadlines = entry.state.deadlines else { continue }
                count += deadlines.obligations.filter(\.overdue).count
                count += deadlines.receivables.filter { $0.daysOverdue > 0 }.count
                count += deadlines.payables.filter { ($0.dueDate ?? "9999") < deadlines.today }.count
            }
            return count
        case .periods, .accountant:
            return nil
        case .statements:
            return nil
        case .reconciliation:
            // Operacje do zrobienia w otwartym miesiącu uzgodnienia (gdy wczytany).
            guard let month = bank.month, month.companyId == bank.company?.id else { return nil }
            return month.transactions.filter(\.isOpen).count
        case .entries, .invoices, .documents:
            return nil
        case .ksef:
            // Faktury KSeF z uwagą do płatności we wczytanych działalnościach z filtra.
            let ids = Set(store.scopeCompanies.map(\.id))
            var count = 0
            for (company, list) in bank.ksefLists where ids.contains(company) {
                count += list.invoices.filter(\.needsReview).count
            }
            return count
        case .declarations:
            guard let list = bank.declarationList else { return nil }
            return list.declarations.filter { DeclarationStatus.attention.contains($0.status) }.count
        case .contracts:
            // Okresy umów stałych po terminie (gdy rejestr wczytany).
            guard let list = bank.contractList else { return nil }
            return list.contracts.reduce(0) { $0 + $1.overdue }
        }
    }

    @ViewBuilder private var content: some View {
        let scope = store.scope
        if !scope.entries.isEmpty {
            switch store.part {
            case .center:
                FinanceCenterView(store: store, scope: scope)
            case .deadlines:
                FinanceDeadlinesView(store: store, scope: scope)
            case .periods:
                FinancePeriodsView(store: store, scope: scope)
            case .statements:
                FinanceStatementsView(store: bank, finance: store)
            case .reconciliation:
                FinanceReconciliationView(store: bank, finance: store)
            case .declarations:
                FinanceDeclarationsView(store: bank, finance: store)
            case .contracts:
                FinanceContractsView(store: bank, finance: store)
            case .accountant:
                FinanceAccountantView(store: store.saldeo, finance: store)
            case .entries:
                FinanceEntriesView(store: bank, finance: store)
            case .documents:
                FinanceDocumentsView(store: bank, finance: store)
            case .invoices:
                FinanceInvoicesView(store: bank, finance: store)
            case .ksef:
                FinanceKsefView(store: bank, finance: store)
            }
        }
    }
}

// MARK: Wspólne elementy ekranów Finansów

/// Karta sekcji: nagłówek z ikoną i dodatkami po prawej, treść, opcjonalny opis na dole (jak karty w CRM).
struct FinCard<Content: View, Accessory: View>: View {
    let title: String
    let symbol: String
    let note: String?
    let content: () -> Content
    let accessory: () -> Accessory
    @Environment(\.crmTheme) private var theme

    init(_ title: String, symbol: String, note: String? = nil, @ViewBuilder content: @escaping () -> Content, @ViewBuilder accessory: @escaping () -> Accessory) {
        self.title = title
        self.symbol = symbol
        self.note = note
        self.content = content
        self.accessory = accessory
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                Text(title).font(.headline).lineLimit(1).layoutPriority(1)
                Spacer(minLength: 8)
                accessory()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            Divider()
            content()
            if let note, !note.isEmpty {
                Divider()
                Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.12)))
    }
}

extension FinCard where Accessory == EmptyView {
    init(_ title: String, symbol: String, note: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title, symbol: symbol, note: note, content: content, accessory: { EmptyView() })
    }
}

/// Kafel z liczbą (jak `Tile` / `Summary` w CRM).
struct FinTile: View {
    let symbol: String
    let label: String
    let value: String
    var hint: String? = nil
    var warn = false
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: symbol).foregroundStyle(warn ? CrmTheme.rgb(0xfbbf24) : theme.accent.opacity(0.8))
                Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if let hint {
                Text(hint).font(.caption2).foregroundStyle(warn ? CrmTheme.rgb(0xfcd34d) : Color.secondary).lineLimit(2)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.10)))
    }
}

/// Pasek proporcji (wiekowanie, przepływy tygodnia).
struct FinBar: View {
    let fraction: Double
    let color: Color
    var height: CGFloat = 8
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.06))
                Capsule().fill(color).frame(width: max(0, min(1, fraction)) * geometry.size.width)
            }
        }
        .frame(height: height)
    }
}

/// Komunikat ostrzeżenia na całą szerokość (np. brak wyciągów).
struct FinBanner: View {
    let text: String
    var tone: FinChip.Tone = .warn
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.callout)
        .foregroundStyle(FinChip(text: "", tone: tone).color)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(FinChip(text: "", tone: tone).color.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FinChip(text: "", tone: tone).color.opacity(0.25)))
    }
}

// MARK: Stan filtrów list (okno „Dopasuj dokument do płatności”, „Wszystkie dokumenty”; w CRM — `FilterSummaryBar`)

/// Włączony filtr: etykieta i wyłączenie samego tego filtra (× przy etykiecie).
struct FinFilterChip: Identifiable {
    let label: String
    let remove: () -> Void
    var id: String { label }
}

/// Wiersz pod filtrami: filtry działają od razu po zmianie, a ten wiersz pokazuje, że są włączone — ile pozycji widać z ilu,
/// które filtry działają (× wyłącza jeden) i „Wyczyść filtry”. Bez filtrów — liczba wszystkich pozycji.
struct FinFilterSummary: View {
    let shown: Int
    let total: Int
    /// Odmiana rzeczownika: 1, 2–4, 5+ (np. „dokument”, „dokumenty”, „dokumentów”).
    let forms: (String, String, String)
    let chips: [FinFilterChip]
    let clear: () -> Void
    @Environment(\.crmTheme) private var theme

    static func count(_ value: Int, _ forms: (String, String, String)) -> String {
        if value == 1 { return forms.0 }
        let tens = value % 100, ones = value % 10
        return (2...4).contains(ones) && !(12...14).contains(tens) ? forms.1 : forms.2
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: chips.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                .foregroundStyle(chips.isEmpty ? Color.secondary : theme.accent)
            if chips.isEmpty {
                Text("Bez filtrów · \(total) \(Self.count(total, forms))").foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                Text("Pokazano \(shown) z \(total)").fontWeight(.semibold).monospacedDigit().fixedSize()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(chips) { chip in
                            Button(action: chip.remove) {
                                HStack(spacing: 3) {
                                    Text(chip.label).lineLimit(1)
                                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                                }
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .foregroundStyle(theme.accent)
                                .background(theme.accent.opacity(0.14), in: Capsule())
                                .overlay(Capsule().stroke(theme.accent.opacity(0.4)))
                            }
                            .buttonStyle(.plain).help("Wyłącz ten filtr")
                        }
                    }
                }
                Button("Wyczyść filtry", action: clear).buttonStyle(.link).fixedSize()
            }
        }
        .font(.caption)
        .frame(minHeight: 20)
        .accessibilityElement(children: .contain)
    }
}

/// Filtr zmieniony względem domyślnego — tło i obwódka w kolorze akcentu (stały odstęp: bez przeskoku układu).
struct FinFilterActive: ViewModifier {
    let active: Bool
    @Environment(\.crmTheme) private var theme
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 3).padding(.vertical, 1)
            .background(active ? theme.accent.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? theme.accent.opacity(0.75) : Color.clear, lineWidth: 1))
    }
}

extension View {
    func finFilterActive(_ active: Bool) -> some View { modifier(FinFilterActive(active: active)) }
}
