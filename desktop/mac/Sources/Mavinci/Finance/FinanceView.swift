import SwiftUI

// MARK: Finanse (`/crm/invoices`) — natywnie: Centrum finansów, Terminy i monity, Zamknięcie miesięcy (jak sekcje CRM
// „Centrum finansów”, „Dokumenty i rozliczenia → Terminy i monity”, „Dla księgowej → Zamknięcie miesięcy”). Wystawianie
// i karty faktur, KSeF, wyciągi i uzgadnianie, deklaracje, przekazanie księgowej — w CRM (przyciski z lewej kolumny).

@MainActor struct FinanceView: View {
    @ObservedObject var store: FinanceStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var helpFor: FinancePart?

    private struct WebLink: Identifiable {
        let title: String
        let symbol: String
        let href: String
        var id: String { href }
    }
    /// Części CRM bez ekranu natywnego (otwierane w przeglądarce).
    private let webLinks: [WebLink] = [
        WebLink(title: "Faktury lokalne", symbol: "doc.text", href: "/crm/invoices?tab=local"),
        WebLink(title: "KSeF", symbol: "doc.badge.arrow.up", href: "/crm/invoices?tab=ksef"),
        WebLink(title: "Wyciągi bankowe", symbol: "building.columns", href: "/crm/invoices?tab=external&section=statements"),
        WebLink(title: "Uzgadnianie wyciągów", symbol: "arrow.left.arrow.right", href: "/crm/invoices?tab=external&section=reconciliation"),
        WebLink(title: "ZUS i podatki — deklaracje", symbol: "doc.plaintext", href: "/crm/invoices?tab=external&section=declarations"),
        WebLink(title: "Przekazanie księgowej", symbol: "paperplane", href: "/crm/invoices?tab=external&section=accountant"),
        WebLink(title: "Koszty i wypłaty", symbol: "creditcard", href: "/crm/invoices?tab=expenses"),
    ]

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
            } else if store.state == nil, let error = store.loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać finansów", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.state == nil {
                ProgressView("Ładowanie finansów…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    sidebar
                    Divider()
                    content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
                Picker("Działalność", selection: Binding(get: { store.company?.id ?? "" }, set: { store.select($0) })) {
                    ForEach(store.companies) { company in Text(company.name).tag(company.id) }
                }
                .labelsHidden()
                .frame(maxWidth: 260)
                .help("Działalność")
            } else if let company = store.company {
                Text(company.name).foregroundStyle(.secondary)
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
        guard let state = store.state else { return "Gotówka, należności, zobowiązania, podatki i terminy" }
        let today = state.center?.today ?? state.deadlines?.today
        let stamp = FinFormat.dateTime(state.loadedAt)
        return (today.map { "Stan na \(FinFormat.day($0))" } ?? "Finanse działalności") + (stamp.isEmpty ? "" : " · pobrano \(stamp)")
    }

    private var sidebar: some View {
        List(selection: Binding(get: { Optional(store.part) }, set: { if let value = $0 { store.part = value } })) {
            Section {
                ForEach(FinancePart.allCases) { item in
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
            Section("W CRM (przeglądarka)") {
                ForEach(webLinks) { link in
                    Button { state.openCRM(link.href) } label: {
                        HStack {
                            Label(link.title, systemImage: link.symbol)
                            Spacer()
                            Image(systemName: "arrow.up.forward.square").font(.caption).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Otwiera się w przeglądarce")
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
        guard let state = store.state else { return nil }
        switch part {
        case .center:
            return state.center?.quality.filter { $0.level == "error" }.count
        case .deadlines:
            guard let deadlines = state.deadlines else { return nil }
            let obligations = deadlines.obligations.filter(\.overdue).count
            let receivables = deadlines.receivables.filter { $0.daysOverdue > 0 }.count
            let payables = deadlines.payables.filter { ($0.dueDate ?? "9999") < deadlines.today }.count
            return obligations + receivables + payables
        case .periods:
            return nil
        }
    }

    @ViewBuilder private var content: some View {
        if let state = store.state {
            switch store.part {
            case .center:
                FinanceCenterView(store: store, data: state)
            case .deadlines:
                FinanceDeadlinesView(store: store, data: state)
            case .periods:
                FinancePeriodsView(store: store, data: state)
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
                Text(title).font(.headline)
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
