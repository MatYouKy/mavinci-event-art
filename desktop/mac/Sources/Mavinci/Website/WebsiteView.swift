import SwiftUI
import Charts

// MARK: Strona — 1:1 z `/crm/page?tab=website`: „Struktura strony” (najczęściej odwiedzane strony, drzewo podstron
// z odwiedzinami i analityką), „Marketing i ADS” (`MarketingWorkspace`), „Analityka” (`/crm/page/analytics`) i „Schema.org”
// (`/crm/page/schema-org`). Zakładka „Marketing i ADS” — dla osób z uprawnieniami do marketingu.

@MainActor struct WebsiteView: View {
    @ObservedObject var store: WebsiteStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    private var tabs: [WebsiteTab] {
        WebsiteTab.allCases.filter { $0 != .marketing || store.access?.canViewMarketing == true }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Sekcja", selection: $store.tab) {
                    ForEach(tabs) { Label($0.label, systemImage: $0.symbol).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            Group {
                switch store.tab {
                case .structure: WebsiteStructureView(store: store)
                case .marketing: MarketingWorkspaceView(store: store)
                case .analytics: WebsiteAnalyticsView(store: store)
                case .schema: WebsiteSchemaView(store: store)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .navigationTitle("Strona")
        .navigationSubtitle(store.tab.label)
        .task(id: state.employee?.id) { await store.loadPages() }
    }
}

/// Struktura strony: wykres najczęściej odwiedzanych stron, drzewo podstron z odwiedzinami (30 dni) i legenda.
@MainActor struct WebsiteStructureView: View {
    @ObservedObject var store: WebsiteStore
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var expanded: Set<String> = ["/"]

    private var top: [WebsitePageVisits] {
        let q = search.trimmingCharacters(in: .whitespaces)
        return (store.pages?.pages ?? [])
            .filter { q.isEmpty || "\($0.title) \($0.url)".localizedCaseInsensitiveContains(q) }
            .sorted { $0.visits > $1.visits }
            .prefix(8).map { $0 }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Zarządzanie stroną").font(.title2.weight(.light))
                        Text("Struktura i statystyki podstron").foregroundStyle(.secondary)
                    }
                    Spacer()
                    if store.loadingPages { ProgressView().controlSize(.small) }
                    Button("Schema.org", systemImage: "curlybraces") { store.tab = .schema }
                    Button("Analytics", systemImage: "chart.bar") { store.showAnalytics(for: nil) }
                }
                TextField("Szukaj strony...", text: $search).textFieldStyle(.roundedBorder).frame(maxWidth: 420)
                chart
                tree
                legend
            }
            .padding(16)
        }
    }

    private var chart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Najczęściej odwiedzane strony").font(.headline)
            Text("Do 8 stron z największą liczbą zarejestrowanych wizyt · ostatnie 30 dni\(search.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " · zgodnie z wyszukiwaniem").")
                .font(.caption).foregroundStyle(.secondary)
            if store.pages == nil && store.pagesError == nil {
                Text("Ładowanie statystyk…").foregroundStyle(.secondary)
            } else if store.pagesError != nil {
                Text("Nie udało się pobrać statystyk odwiedzin. Wykres nie jest dostępny.").foregroundStyle(.orange)
            } else if top.isEmpty {
                Text(search.isEmpty ? "Brak zarejestrowanych wizyt w tym okresie." : "Brak zarejestrowanych wizyt dla stron pasujących do wyszukiwania.")
                    .foregroundStyle(.secondary)
            } else {
                Chart(top) { page in
                    BarMark(x: .value("Wizyty", page.visits), y: .value("Strona", page.title == page.url ? page.url : "\(page.title) (\(page.url))"))
                        .foregroundStyle(theme.accent)
                        .annotation(position: .trailing) { Text(WebsiteFormat.count(page.visits)).font(.caption).foregroundStyle(.secondary) }
                }
                .chartXAxis(.hidden)
                .frame(height: max(200, CGFloat(top.count) * 40))
            }
        }
        .padding(16)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private var tree: some View {
        let nodes = WebsiteNode.filter(WebsiteNode.structure, search)
        return VStack(alignment: .leading, spacing: 4) {
            if store.pages == nil && store.pagesError == nil {
                Text("Ładowanie struktury strony...").foregroundStyle(.secondary).padding(20)
            } else if nodes.isEmpty {
                Text(search.isEmpty ? "Brak danych" : "Nie znaleziono stron pasujących do zapytania").foregroundStyle(.secondary).padding(20)
            } else {
                ForEach(nodes) { node in nodeRows(node, level: 0) }
            }
        }
        .padding(12)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func nodeRows(_ node: WebsiteNode, level: Int) -> AnyView {
        let open = expanded.contains(node.url) || !search.trimmingCharacters(in: .whitespaces).isEmpty
        return AnyView(VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                if node.children.isEmpty {
                    Color.clear.frame(width: 16, height: 16)
                } else {
                    Button {
                        if expanded.contains(node.url) { expanded.remove(node.url) } else { expanded.insert(node.url) }
                    } label: { Image(systemName: open ? "chevron.down" : "chevron.right") }
                        .buttonStyle(.borderless).frame(width: 16)
                }
                Image(systemName: "doc.text").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(node.title).fontWeight(.medium)
                    Text(node.url).font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(WebsiteFormat.count(store.pages?.visits(node.url) ?? 0)) wizyt").font(.callout).foregroundStyle(.secondary)
                Button("Analityka", systemImage: "chart.bar") { store.showAnalytics(for: node.url) }.controlSize(.small)
                Button("Edytuj", systemImage: "pencil") {}.controlSize(.small).disabled(true).help("Edycja treści — wkrótce")
            }
            .padding(.vertical, 6).padding(.horizontal, 8)
            .padding(.leading, CGFloat(level) * 24)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            if open {
                ForEach(node.children) { child in nodeRows(child, level: level + 1) }
            }
        })
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Legenda").font(.headline)
            Label("Podstrona", systemImage: "doc.text")
            Label("Analityka - szczegółowe statystyki", systemImage: "chart.bar")
            Label("Edytuj - edycja treści (wkrótce)", systemImage: "pencil")
            Label("Rozwiń/zwiń podstrony", systemImage: "chevron.right")
        }
        .font(.callout).foregroundStyle(.secondary)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}
