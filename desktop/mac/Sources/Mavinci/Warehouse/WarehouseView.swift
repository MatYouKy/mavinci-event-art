import SwiftUI
import AppKit

// MARK: Magazyn — „Sprzęt” 1:1 ze stroną `/crm/equipment`: sprzęt i zestawy razem, filtr typu, wyszukiwanie (nazwa, marka, model),
// widoki Kafelki / Lista / Tabela, stan dostępnych sztuk, ścieżka kategorii, duplikowanie i usuwanie. Kliknięcie otwiera kartę
// sprzętu (`EquipmentCardView`), zestaw — ekran Zestawy (`KitsView`). Wszystko z kopii na dysku, synchronizacja przyrostowa.

struct WarehouseActions {
    let open: (WarehouseEntry) -> Void
    let duplicate: (WarehouseEntry) -> Void
    let remove: (WarehouseEntry) -> Void
}

@MainActor struct WarehouseView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("warehouse.mode") private var mode: WarehouseViewMode = .grid
    @State private var type: WarehouseTypeFilter = .all
    @State private var search = ""
    @State private var selectedID: String?
    @State private var removing: WarehouseEntry?
    @State private var duplicating: WarehouseEntry?
    @State private var adding = false

    private var visible: [WarehouseEntry] {
        store.entries.filter { entry in
            switch type {
            case .equipment: if entry.isKit { return false }
            case .kits: if !entry.isKit { return false }
            case .all: break
            }
            return entry.matches(search)
        }
    }

    var body: some View {
        Group {
            if let id = store.openedID {
                EquipmentCardView(store: store, equipmentID: id).id(id)
            } else {
                list
            }
        }
        .sheet(isPresented: $adding) {
            NewEquipmentSheet(store: store)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Czy na pewno chcesz usunąć?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let entry = removing {
                Button("Usuń", role: .destructive) { Task { _ = await store.delete(entry) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("„\(removing?.name ?? "")” zostanie usunięty z magazynu.") }
        .confirmationDialog("Czy na pewno chcesz zduplikować ten przedmiot?", isPresented: Binding(get: { duplicating != nil }, set: { if !$0 { duplicating = nil } }), titleVisibility: .visible) {
            if let entry = duplicating {
                Button("Duplikuj") { Task { await store.run("Duplikowanie…", "duplicate", ["id": .string(entry.id)], success: "Przedmiot zduplikowany pomyślnie") } }
                Button("Anuluj", role: .cancel) {}
            }
        }
        .task(id: state.employee?.id) {
            if store.entries.isEmpty { await store.backgroundSync() }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var actions: WarehouseActions {
        WarehouseActions(
            open: { entry in
                if entry.isKit { state.showKit(entry.id) }
                else { store.openedID = entry.id }
            },
            duplicate: { duplicating = $0 },
            remove: { removing = $0 }
        )
    }

    private var list: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Magazyn")
        .navigationSubtitle("Wyświetlasz: \(visible.count) / \(store.entries.count)")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj...")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { state.openHref("/crm/equipment/categories") } label: { Label("Kategorie", systemImage: "folder") }.help("Kategorie")
                Button { state.openHref("/crm/equipment/kits") } label: { Label("Zestawy", systemImage: "square.stack.3d.up") }.help("Zestawy")
                Button { state.openCRM("/crm/equipment/locations") } label: { Label("Lokalizacje", systemImage: "mappin.and.ellipse") }.help("Lokalizacje (CRM)")
                Button { state.openHref("/crm/equipment/cables") } label: { Label("Przewody", systemImage: "cable.connector") }.help("Przewody")
                if store.access?.canCreate == true {
                    Button { adding = true } label: { Label("Dodaj", systemImage: "plus") }.help("Dodaj sprzęt")
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Picker("Typ", selection: $type) { ForEach(WarehouseTypeFilter.allCases) { Text($0.label).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            Spacer(minLength: 8)
            if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja magazynu") }
            Picker("Widok", selection: $mode) { ForEach(WarehouseViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    @ViewBuilder private var content: some View {
        if store.entries.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Magazyn", systemImage: "shippingbox")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView("Brak sprzętu", systemImage: "shippingbox")
        } else {
            switch mode {
            case .grid:
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 12)], spacing: 12) {
                        ForEach(visible) { entry in WarehouseCard(entry: entry, path: store.categoryPath(entry.categoryId), canManage: store.canManage, actions: actions) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .list:
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(visible) { entry in WarehouseRow(entry: entry, path: store.categoryPath(entry.categoryId), canManage: store.canManage, actions: actions) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                }
            case .table:
                WarehouseTable(entries: visible, store: store, selectedID: $selectedID, actions: actions)
            }
        }
    }
}

/// Miniatura sprzętu (zdjęcie albo ikona) z pamięcią podręczną zdjęć.
@MainActor struct WarehouseThumb: View {
    let url: String?
    let size: CGFloat
    var symbol = "shippingbox"
    @Environment(\.crmTheme) private var theme
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size > 60 ? 10 : 6).fill(Color.primary.opacity(0.05))
            if let url, !url.isEmpty {
                CachedRemoteImage(url: url, crop: nil)
            } else {
                Image(systemName: symbol).font(.system(size: size * 0.38)).foregroundStyle(theme.accent.opacity(0.7))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size > 60 ? 10 : 6))
    }
}

@MainActor struct WarehouseMenu: View {
    let entry: WarehouseEntry
    let canManage: Bool
    let actions: WarehouseActions
    var body: some View {
        Button(entry.isKit ? "Otwórz zestaw" : "Otwórz", systemImage: "eye") { actions.open(entry) }
        if canManage {
            if !entry.isKit { Button("Duplikuj", systemImage: "doc.on.doc") { actions.duplicate(entry) } }
            Divider()
            Button("Usuń", systemImage: "trash", role: .destructive) { actions.remove(entry) }
        }
    }
}

private struct KitBadge: View {
    var body: some View {
        Text("ZESTAW").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
            .background(CrmTheme.rgb(0xc084fc).opacity(0.2), in: Capsule()).foregroundStyle(CrmTheme.rgb(0xc084fc))
    }
}
private struct InactiveBadge: View {
    var body: some View {
        Text("NIEAKTYWNY").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.secondary.opacity(0.2), in: Capsule()).foregroundStyle(.secondary)
    }
}

@MainActor struct WarehouseCard: View {
    let entry: WarehouseEntry
    let path: String
    let canManage: Bool
    let actions: WarehouseActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WarehouseThumb(url: entry.thumbnailUrl, size: 120, symbol: entry.isKit ? "square.stack.3d.up" : "shippingbox")
                .frame(maxWidth: .infinity)
            HStack(spacing: 5) {
                Text(entry.name).font(.callout.weight(.semibold)).lineLimit(2)
                if entry.isKit { KitBadge() }
                if !entry.active { InactiveBadge() }
            }
            if !path.isEmpty { Label(path, systemImage: "chevron.right").font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            HStack {
                Text(entry.stockLabel).font(.callout.weight(.medium).monospacedDigit()).foregroundStyle(entry.isKit ? CrmTheme.rgb(0xc084fc) : entry.stockColor)
                Spacer()
                if !entry.brand.isEmpty { Text(entry.brand).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            if canManage {
                Menu { WarehouseMenu(entry: entry, canManage: canManage, actions: actions) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(8)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { actions.open(entry) }
        .onHover { hover = $0 }
        .contextMenu { WarehouseMenu(entry: entry, canManage: canManage, actions: actions) }
    }
}

@MainActor struct WarehouseRow: View {
    let entry: WarehouseEntry
    let path: String
    let canManage: Bool
    let actions: WarehouseActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false
    var body: some View {
        HStack(spacing: 12) {
            WarehouseThumb(url: entry.thumbnailUrl, size: 44, symbol: entry.isKit ? "square.stack.3d.up" : "shippingbox")
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(entry.name).fontWeight(.medium).lineLimit(1)
                    if entry.isKit { KitBadge() }
                    if !entry.active { InactiveBadge() }
                }
                HStack(spacing: 5) {
                    if !entry.brand.isEmpty { Text(entry.brand) }
                    if !entry.brand.isEmpty && !path.isEmpty { Text("•") }
                    if !path.isEmpty { Text(path).lineLimit(1) }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(entry.stockLabel).font(.callout.weight(.medium).monospacedDigit()).foregroundStyle(entry.isKit ? CrmTheme.rgb(0xc084fc) : entry.stockColor)
            if canManage {
                Menu { WarehouseMenu(entry: entry, canManage: canManage, actions: actions) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { actions.open(entry) }
        .onHover { hover = $0 }
        .contextMenu { WarehouseMenu(entry: entry, canManage: canManage, actions: actions) }
    }
}

@MainActor struct WarehouseTable: View {
    let entries: [WarehouseEntry]
    @ObservedObject var store: WarehouseStore
    @Binding var selectedID: String?
    let actions: WarehouseActions
    var body: some View {
        Table(entries, selection: $selectedID) {
            TableColumn("Nazwa") { (e: WarehouseEntry) in
                HStack(spacing: 8) {
                    WarehouseThumb(url: e.thumbnailUrl, size: 30, symbol: e.isKit ? "square.stack.3d.up" : "shippingbox")
                    Text(e.name).fontWeight(.medium).lineLimit(1)
                    if !e.active { InactiveBadge() }
                }
            }.width(min: 200, ideal: 300)
            TableColumn("Typ") { (e: WarehouseEntry) in Text(e.isKit ? "Zestaw" : "Sprzęt").foregroundStyle(e.isKit ? CrmTheme.rgb(0xc084fc) : Color.primary) }.width(min: 60, ideal: 80)
            TableColumn("Kategoria") { (e: WarehouseEntry) in Text(store.categoryPath(e.categoryId)).foregroundStyle(.secondary).lineLimit(1) }.width(min: 120, ideal: 220)
            TableColumn("Marka / Model") { (e: WarehouseEntry) in Text([e.brand, e.model].filter { !$0.isEmpty }.joined(separator: " ")).lineLimit(1) }.width(min: 100, ideal: 180)
            TableColumn("Stan") { (e: WarehouseEntry) in
                Text(e.stockLabel).monospacedDigit().foregroundStyle(e.isKit ? CrmTheme.rgb(0xc084fc) : e.stockColor)
            }.width(min: 60, ideal: 80)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let entry = entries.first(where: { $0.id == id }) { WarehouseMenu(entry: entry, canManage: store.canManage, actions: actions) }
        } primaryAction: { ids in
            if let id = ids.first, let entry = entries.first(where: { $0.id == id }) { actions.open(entry) }
        }
    }
}
