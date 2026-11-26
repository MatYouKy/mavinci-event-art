import SwiftUI

// MARK: Rental → Wypożyczenia klientom — 1:1 z `/crm/rental`: zakładki W toku / Szkice / Do rozliczenia / Archiwum / Wszystkie,
// wyszukiwanie (numer, nazwa, klient), „Tylko moje” (sprzedaż), „Nowe wypożyczenie”, wiersze z terminem, statusem, sprzętem
// u klienta, rozbieżnościami i kwotą brutto (tylko sprzedaż). Kliknięcie otwiera kartę (`ClientRentalDetailView`).

enum ClientRentalTab: String, CaseIterable, Identifiable {
    case active, draft, returned, archive, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .active: return "W toku"
        case .draft: return "Szkice"
        case .returned: return "Do rozliczenia"
        case .archive: return "Archiwum"
        case .all: return "Wszystkie"
        }
    }
    var statuses: [ClientRentalStatus]? {
        switch self {
        case .active: return [.reserved, .issued]
        case .draft: return [.draft]
        case .returned: return [.returned]
        case .archive: return [.settled, .cancelled]
        case .all: return nil
        }
    }
}

@MainActor struct ClientRentalsView: View {
    @ObservedObject var store: ClientRentalsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("clientRentals.tab") private var tab: ClientRentalTab = .active
    @State private var search = ""
    @State private var creating = false

    private func rows(_ tab: ClientRentalTab) -> [ClientRentalListRow] {
        store.rentals.filter { row in (tab.statuses.map { $0.contains(row.status) } ?? true) }
    }
    private var visible: [ClientRentalListRow] { rows(tab).filter { $0.matches(search) } }

    var body: some View {
        Group {
            if let id = store.openedID {
                ClientRentalDetailView(store: store, rentalID: id).id(id)
            } else {
                list
            }
        }
        .sheet(isPresented: $creating) {
            ClientRentalFormSheet(store: store, rental: nil) { id in creating = false; store.openItemsFor = id; store.openedID = id }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .task(id: state.employee?.id) {
            await store.load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if store.openedID == nil && !Task.isCancelled { await store.load() }
            }
        }
        .onChange(of: store.mine) { _, _ in Task { await store.load() } }
    }

    private var list: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("Zakładka", selection: $tab) {
                    ForEach(ClientRentalTab.allCases) { item in Text("\(item.label) \(rows(item).count)").tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                if store.access.salesView { Toggle("Tylko moje", isOn: $store.mine).toggleStyle(.checkbox) }
                Spacer()
                if store.loading { ProgressView().controlSize(.small) }
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 9)
            Group {
                if let error = store.loadError, store.rentals.isEmpty {
                    ContentUnavailableView {
                        Label("Wypożyczenia klientom", systemImage: "shippingbox.and.arrow.backward")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.load() } }
                    }
                } else if !store.loaded {
                    ProgressView("Wczytywanie wypożyczeń…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if visible.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "Brak wypożyczeń w tej zakładce" : "Nie znaleziono wypożyczeń", systemImage: "shippingbox.and.arrow.backward")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(visible) { row in
                                Button { store.openedID = row.id } label: { rowView(row) }.buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Wypożyczenia klientom")
        .navigationSubtitle("Rental")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po numerze, nazwie lub kliencie…")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(store.loading)
                if store.access.create {
                    Button { creating = true } label: { Label("Nowe wypożyczenie", systemImage: "plus") }.help("Nowe wypożyczenie (⌘N)").keyboardShortcut("n")
                }
            }
        }
    }

    private func rowView(_ row: ClientRentalListRow) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.number).font(.headline.weight(.medium))
                if !row.title.isEmpty { Text(row.title).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(width: 190, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.clientName).lineLimit(1)
                if let seller = row.sellerName, !seller.isEmpty { Text("Opiekun: \(seller)").font(.caption).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if row.handover == "delivery" { Image(systemName: "truck.box").foregroundStyle(theme.accent).help("Dostawa") }
                    Text(ClientRentalFormat.dateTime(row.startsAt))
                }
                Text("do \(ClientRentalFormat.dateTime(row.endsAt))").foregroundStyle(row.overdue ? CrmTheme.rgb(0xfca5a5) : .secondary)
            }
            .font(.caption).frame(width: 160, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                ClientRentalStatusBadge(status: row.status)
                HStack(spacing: 4) {
                    if row.overdue { Label("Po terminie", systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
                    if row.openIssues > 0 { Label("\(row.openIssues)", systemImage: "wrench.and.screwdriver").font(.caption2).foregroundStyle(.orange).help("Rozbieżności do rozstrzygnięcia") }
                }
            }
            .frame(width: 130, alignment: .leading)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(row.itemsCount) poz. · \(row.quantity) szt.").font(.caption)
                if row.outQty > 0 { Text("u klienta \(row.outQty)").font(.caption).foregroundStyle(theme.accent) }
            }
            .frame(width: 120, alignment: .trailing)
            if store.access.salesView {
                Text(row.sales.map { ClientRentalFormat.money($0.totals.gross) } ?? "—").monospacedDigit().frame(width: 110, alignment: .trailing)
            }
        }
        .padding(12)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
    }
}
