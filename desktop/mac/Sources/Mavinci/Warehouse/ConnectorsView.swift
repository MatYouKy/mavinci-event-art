import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Wtyki — 1:1 z `/crm/equipment/connectors` (`ConnectorsView`): Siatka / Lista / Kompaktowy, wyszukiwanie (nazwa, opis,
// zastosowania), dodawanie, edycja ze zdjęciem (`connector-thumbnails`) i usuwanie. Słownik z kopii magazynu na dysku.

enum ConnectorViewMode: String, CaseIterable, Identifiable {
    case grid, list, compact
    var id: String { rawValue }
    var label: String { self == .grid ? "Siatka" : self == .list ? "Lista" : "Kompaktowy" }
    var symbol: String { self == .grid ? "square.grid.2x2" : self == .list ? "list.bullet" : "list.dash" }
}

struct ConnectorEditorRequest: Identifiable {
    let id = UUID()
    let connector: ConnectorOption?
}

@MainActor struct ConnectorsView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("warehouse.connectors.mode") private var mode: ConnectorViewMode = .grid
    @State private var search = ""
    @State private var editor: ConnectorEditorRequest?
    @State private var removing: ConnectorOption?

    private var visible: [ConnectorOption] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.connectors.filter { c in
            q.isEmpty || c.name.lowercased().contains(q) || (c.description ?? "").lowercased().contains(q) || (c.commonUses ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(visible.count) wtyków").font(.callout).foregroundStyle(.secondary)
                Spacer()
                if store.syncing { ProgressView().controlSize(.small) }
                Picker("Widok", selection: $mode) { ForEach(ConnectorViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 9)
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Wtyki / Connectors")
        .navigationSubtitle("Magazyn")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj wtyków...")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.openHref("/crm/equipment") } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do magazynu")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage { Button { editor = ConnectorEditorRequest(connector: nil) } label: { Label("Dodaj wtyk", systemImage: "plus") } }
            }
        }
        .sheet(item: $editor) { request in ConnectorSheet(store: store, connector: request.connector).warehouseSheetStyle(state) }
        .confirmationDialog("Usuń wtyk", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let connector = removing { Task { await store.run("Usuwanie…", "connectorDelete", ["id": .string(connector.id)], success: "Wtyk usunięty") } }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć ten wtyk?") }
        .task(id: state.employee?.id) { await store.backgroundSync() }
    }

    @ViewBuilder private var content: some View {
        if store.connectors.isEmpty && !store.loaded {
            ProgressView("Ładowanie wtyków...").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visible.isEmpty {
            ContentUnavailableView(search.isEmpty ? "Brak wtyków w bazie" : "Nie znaleziono wtyków", systemImage: "powerplug")
        } else {
            ScrollView {
                switch mode {
                case .grid:
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220, maximum: 320), spacing: 12)], spacing: 12) {
                        ForEach(visible) { card($0) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 6)
                case .list:
                    LazyVStack(spacing: 6) { ForEach(visible) { row($0, compact: false) } }.padding(.horizontal, 14).padding(.vertical, 6)
                case .compact:
                    LazyVStack(spacing: 2) { ForEach(visible) { row($0, compact: true) } }.padding(.horizontal, 14).padding(.vertical, 6)
                }
            }
        }
    }

    @ViewBuilder private func menu(_ c: ConnectorOption) -> some View {
        if store.canManage {
            Button("Edytuj", systemImage: "pencil") { editor = ConnectorEditorRequest(connector: c) }
            Button("Usuń", systemImage: "trash", role: .destructive) { removing = c }
        }
    }

    private func card(_ c: ConnectorOption) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WarehouseThumb(url: c.thumbnailUrl, size: 130, symbol: "powerplug").frame(maxWidth: .infinity)
            Text(c.name).font(.headline.weight(.medium))
            if let description = c.description?.nonEmpty { Text(description).font(.callout).foregroundStyle(.secondary).lineLimit(3) }
            if let uses = c.commonUses?.nonEmpty { Text("Zastosowanie: \(uses)").font(.caption).foregroundStyle(.secondary).lineLimit(3) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            if store.canManage {
                Menu { menu(c) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(8)
            }
        }
        .contextMenu { menu(c) }
        .onTapGesture(count: 2) { if store.canManage { editor = ConnectorEditorRequest(connector: c) } }
    }

    private func row(_ c: ConnectorOption, compact: Bool) -> some View {
        HStack(spacing: 12) {
            WarehouseThumb(url: c.thumbnailUrl, size: compact ? 28 : 48, symbol: "powerplug")
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).fontWeight(.medium)
                if let description = c.description?.nonEmpty { Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                if !compact, let uses = c.commonUses?.nonEmpty { Text("Zastosowanie: \(uses)").font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            if store.canManage {
                Button { editor = ConnectorEditorRequest(connector: c) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                Button(role: .destructive) { removing = c } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, compact ? 5 : 8)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: compact ? 6 : 10))
        .contextMenu { menu(c) }
    }
}

@MainActor struct ConnectorSheet: View {
    @ObservedObject var store: WarehouseStore
    let connector: ConnectorOption?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var commonUses = ""
    @State private var thumbnailUrl = ""
    @State private var importing = false
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(connector == nil ? "Dodaj nowy wtyk" : "Edytuj wtyk").font(.title2.weight(.light))
            Form {
                TextField("Nazwa", text: $name, prompt: Text("np. XLR Male"))
                TextField("Opis", text: $description, prompt: Text("np. Wtyk XLR męski, 3-pinowy"), axis: .vertical).lineLimit(2...4)
                TextField("Typowe zastosowania", text: $commonUses, prompt: Text("np. Mikrofony, sygnały audio balanced, DMX"), axis: .vertical).lineLimit(2...4)
                LabeledContent("Zdjęcie wtyka") {
                    HStack {
                        WarehouseThumb(url: thumbnailUrl.nonEmpty, size: 56, symbol: "powerplug")
                        Button("Wybierz…", systemImage: "photo") { importing = true }
                        if !thumbnailUrl.isEmpty { Button("Usuń", role: .destructive) { thumbnailUrl = "" } }
                    }
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : connector == nil ? "Dodaj wtyk" : "Zapisz zmiany") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 540)
        .onAppear {
            if let connector {
                name = connector.name; description = connector.description ?? ""; commonUses = connector.commonUses ?? ""; thumbnailUrl = connector.thumbnailUrl ?? ""
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await upload(url) } }
        }
    }

    private func upload(_ url: URL) async {
        guard let jpeg = ImageJPEG.from(url, maxSide: 800) else { state.error = "Plik musi być obrazem"; return }
        await state.withPending("Przesyłanie zdjęcia...") {
            do {
                let reply = try await store.upload(["op": "connectorThumb"], data: jpeg, filename: "wtyk.jpg", mime: "image/jpeg")
                thumbnailUrl = reply["url"]?.text ?? thumbnailUrl
            } catch { state.error = store.failureText(error, "Błąd podczas przesyłania zdjęcia") }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let reply = await store.run("Zapisywanie…", "connectorSave", [
            "id": .string(connector?.id ?? ""),
            "data": .object(["name": .string(name), "description": .string(description), "commonUses": .string(commonUses), "thumbnailUrl": .string(thumbnailUrl)]),
        ], success: connector == nil ? "Wtyk dodany" : "Wtyk zaktualizowany")
        if reply != nil { dismiss() }
    }
}
