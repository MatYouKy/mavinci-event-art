import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Dysk — ekran natywny 1:1 z `/crm/materials` (`DriveWorkspace.tsx`)
//
// Jedno drzewo jak w Finderze (Mavinci → …): Finanse (firma → Księgowość → rok → miesiąc → Sprzedaż, Koszty, Bank, Podatki
// i ZUS, XML z KSeF — osoby z dostępem do finansów firmy), Eventy (rok → event → pliki z zakładki Pliki), Materiały
// (dotychczasowy ekran, jego drzewo folderów i albumów pod pozycją „Materiały”), Oferty, Kalkulacje i Umowy (rok → miesiąc →
// PDF z CRM) oraz Magazyn (kategoria → sprzęt → zdjęcia, pliki, instrukcja; dodawanie plików przyciskiem i przeciąganiem
// z Findera z prawem „Zarządzanie magazynem”). Tylko działy, do których pracownik ma dostęp. Spacja / dwuklik — Quick Look,
// Enter — otwórz.

/// Działy Dysku w pasku bocznym Materiałów (ekran Dysku): pozostałe działy jako pozycje, „Materiały” — drzewo folderów.
struct DriveSidebarContext {
    let sections: [DriveSectionInfo]
    let select: (DriveSection) -> Void
}

/// Pozycja działu Dysku w pasku bocznym.
@MainActor struct DriveSectionRow: View {
    let info: DriveSectionInfo
    let active: Bool
    let action: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: info.section?.symbol ?? "folder").foregroundStyle(theme.accent).frame(width: 18)
                Text(info.label).font(.callout.weight(active ? .semibold : .regular)).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: active ? "chevron.down" : "chevron.right").font(.caption2).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8).padding(.vertical, 7)
            .background(active ? theme.accent.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(info.description)
    }
}

@MainActor struct DriveView: View {
    @ObservedObject var store: DriveStore
    @ObservedObject var materials: MaterialsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        content
            .task(id: state.employee?.id) {
                await store.loadRoot(quiet: store.root != nil)
                if let section = store.section { store.select(section) }
                // Zmiany innych osób (CRM, Finder, telefon) — odświeżanie co 2 minuty, gdy ekran jest otwarty.
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 120_000_000_000)
                    if Task.isCancelled { break }
                    if !store.uploading { await store.refresh() }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                Task { await store.refresh() }
            }
    }

    @ViewBuilder private var content: some View {
        if let root = store.root {
            let available = root.available
            if available.isEmpty {
                ContentUnavailableView {
                    Label("Dysk", systemImage: "externaldrive")
                } description: {
                    Text("Nie masz dostępu do żadnego działu Dysku. Uprawnienia nadaje administrator w Poziomach dostępu.")
                }
                .navigationTitle("Dysk")
            } else if let section = store.section {
                if section == .materials {
                    MaterialsView(store: materials, drive: DriveSidebarContext(sections: available, select: { store.select($0) }))
                } else {
                    main(available, section: section)
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if let error = store.rootError {
            ContentUnavailableView {
                Label("Dysk", systemImage: "externaldrive")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.loadRoot() } }
            }
            .navigationTitle("Dysk")
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity).navigationTitle("Dysk")
        }
    }

    private func main(_ available: [DriveSectionInfo], section: DriveSection) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header(section)
            HStack(alignment: .top, spacing: 12) {
                // Pasek folderów i treść w ramkach — wyraźny podział (jak w CRM).
                sidebar(available)
                    .frame(width: 250)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .crmPanel()
                Group {
                    if section == .events { eventsPane } else { DriveBrowserPane(store: store, section: section) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .crmPanel()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .navigationTitle("Dysk")
        .navigationSubtitle(store.info(section)?.label ?? "")
    }

    // MARK: Nagłówek

    private func header(_ section: DriveSection) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Dysk").font(.title.weight(.light))
                Text("Wszystkie pliki firmy w jednym miejscu — ten sam układ co w Finderze (Mavinci) i w CRM. Każdy widzi tylko działy, do których ma dostęp.")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 16)
            if store.loading || (store.currentNode.map { store.listLoading.contains($0) } ?? false) { ProgressView().controlSize(.small) }
            if FinderDomain.available {
                Button { Task { await revealInFinder(section) } } label: { Label("Pokaż w Finderze", systemImage: "folder") }
                    .help(section == .events ? "Event w Finderze: Mavinci → Eventy." : "Ten folder w Finderze: Mavinci → \(store.info(section)?.label ?? "Dysk").")
            }
            Button { Task { await store.refresh(quiet: false) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            if store.currentListing?.canUpload == true, let node = store.currentNode {
                Button { chooseFiles(to: node) } label: { Label("Dodaj pliki", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderedProminent).disabled(store.uploading)
            }
        }
    }

    private func revealInFinder(_ section: DriveSection) async {
        if section == .events {
            await FinderDomain.reveal(event: store.eventID)
        } else if let node = store.currentNode {
            await FinderDomain.reveal(driveNode: node)
        }
    }

    private func chooseFiles(to node: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.prompt = "Dodaj"
        panel.message = DriveText.uploadHint(node, name: store.currentListing?.node.name ?? "")
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return }
        let urls = panel.urls
        Task { await store.upload(urls, to: node) }
    }

    // MARK: Drzewo działów

    private func sidebar(_ available: [DriveSectionInfo]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Dysk").font(.callout.weight(.semibold)).padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(available) { info in
                        if let section = info.section {
                            DriveSectionRow(info: info, active: store.section == section) { store.select(section) }
                            if store.section == section {
                                subtree(section).padding(.leading, 10)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
            }
            DriveStorageMeter(store: store)
        }
    }

    @ViewBuilder private func subtree(_ section: DriveSection) -> some View {
        if section == .events {
            if store.events == nil {
                ProgressView().controlSize(.small).padding(8)
            } else {
                ForEach(store.eventYears, id: \.self) { year in
                    yearRow(year)
                    if openYear == year {
                        ForEach(store.events(in: year)) { event in eventRow(event, year: year) }
                    }
                }
            }
        } else if store.listings[section.rawValue] == nil {
            ProgressView().controlSize(.small).padding(8)
        } else {
            ForEach(treeRows(section.rawValue), id: \.folder.id) { item in treeRow(item.folder, level: item.level) }
        }
    }

    /// Kolejność drzewa: folder, jego podfoldery (z wcięciem), następny folder — zwinięte gałęzie i sprzęt pomijane.
    private func treeRows(_ root: String) -> [(folder: DriveFolder, level: Int)] {
        var result: [(folder: DriveFolder, level: Int)] = []
        func visit(_ parent: String, _ level: Int) {
            guard level < 8, let folders = store.listings[parent]?.folders else { return }
            for folder in folders where folder.kind != "equipment" {
                result.append((folder: folder, level: level))
                if store.expanded.contains(folder.id) { visit(folder.id, level + 1) }
            }
        }
        visit(root, 0)
        return result
    }

    private func treeRow(_ folder: DriveFolder, level: Int) -> some View {
        let leaf = folder.isLeaf
        let active = store.currentNode == folder.id
        return HStack(spacing: 6) {
            if leaf {
                Color.clear.frame(width: 12)
            } else {
                Button { store.toggle(folder.id) } label: {
                    Image(systemName: store.expanded.contains(folder.id) ? "chevron.down" : "chevron.right").font(.caption2).frame(width: 12)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            }
            Image(systemName: folder.symbol).foregroundStyle(theme.accent).frame(width: 18)
            Text(folder.name).font(.callout).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(level) * 12 + 4).padding(.trailing, 6).padding(.vertical, 5)
        .background(active ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture {
            store.openNode(folder.id)
            if !leaf && !store.expanded.contains(folder.id) { store.toggle(folder.id) }
        }
        .help(folder.name)
    }

    // MARK: Eventy

    /// Rozwinięty rok: rok otwartego wydarzenia albo wybrany rok.
    private var openYear: String? {
        if let id = store.eventID, let event = store.events?.first(where: { $0.id == id }) { return DriveText.year(event) }
        return store.eventYear
    }

    private func yearRow(_ year: String) -> some View {
        let open = openYear == year
        return HStack(spacing: 6) {
            Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption2).foregroundStyle(.secondary).frame(width: 12)
            Image(systemName: "calendar").foregroundStyle(theme.accent).frame(width: 18)
            Text(year).font(.callout)
            Spacer(minLength: 0)
        }
        .padding(.leading, 4).padding(.trailing, 6).padding(.vertical, 5)
        .background(open && store.eventID == nil ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture {
            store.eventYear = year
            store.eventID = nil
        }
    }

    private func eventRow(_ event: DriveEvent, year: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "folder").foregroundStyle(theme.accent).frame(width: 18)
            Text(DriveText.eventFolder(event)).font(.callout).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, 22).padding(.trailing, 6).padding(.vertical, 4)
        .background(store.eventID == event.id ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture {
            store.eventYear = year
            store.eventID = event.id
        }
        .help(DriveText.eventFolder(event))
    }

    private static func eventsCount(_ count: Int) -> String {
        let tens = count % 100, ones = count % 10
        if count == 1 { return "1 event" }
        if (2...4).contains(ones) && !(12...14).contains(tens) { return "\(count) eventy" }
        return "\(count) eventów"
    }

    @ViewBuilder private var eventsPane: some View {
        if let id = store.eventID, let event = store.events?.first(where: { $0.id == id }) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Button { store.eventID = nil } label: { Label(DriveText.year(event), systemImage: "chevron.left") }
                        .buttonStyle(.plain).foregroundStyle(theme.accent)
                    Text(DriveText.eventFolder(event)).font(.headline).lineLimit(1)
                    Spacer(minLength: 8)
                    Button { state.showEvent(event.id) } label: { Label("Otwórz event", systemImage: "arrow.up.forward.square") }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                Divider().opacity(0.3)
                EventFilesTab(store: state.eventCards, eventID: event.id).id(event.id)
            }
        } else if store.events != nil {
            if let year = openYear ?? store.eventYears.first {
                let list = store.events(in: year)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(year).font(.headline)
                        Text(Self.eventsCount(list.count)).font(.callout).foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    Divider().opacity(0.3)
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], alignment: .leading, spacing: 12) {
                            ForEach(list) { event in
                                Button {
                                    store.eventYear = year
                                    store.eventID = event.id
                                } label: {
                                    VStack(spacing: 6) {
                                        Image(systemName: "folder.fill").resizable().scaledToFit().frame(width: 64, height: 52).foregroundStyle(theme.accent)
                                        Text(DriveText.eventFolder(event)).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                                    }
                                    .frame(width: 154).padding(10)
                                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .help(DriveText.eventFolder(event))
                            }
                        }
                        .padding(14)
                    }
                }
            } else {
                ContentUnavailableView("Brak eventów", systemImage: "calendar", description: Text("Nie masz dostępu do plików żadnego eventu."))
            }
        } else if let error = store.eventsError {
            ContentUnavailableView {
                Label("Eventy", systemImage: "calendar")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.loadEvents() } }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: Oferty, Kalkulacje, Umowy, Magazyn — zawartość folderu

@MainActor struct DriveBrowserPane: View {
    @ObservedObject var store: DriveStore
    let section: DriveSection
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("drive.viewMode") private var viewMode = "list"
    @State private var selection = Set<String>()
    @State private var filter = ""
    @State private var preview: URL?
    @State private var dropTargeted = false
    /// Plik do usunięcia (dokument spółki, plik umowy stałej) — czeka na potwierdzenie.
    @State private var removing: DriveFile?
    /// Zawartość folderu ma fokus klawiatury (siatka: po kliknięciu elementu) — działają spacja i Enter.
    @FocusState private var paneFocused: Bool

    private var node: String { store.currentNode ?? section.rawValue }
    private var listing: DriveListing? { store.listings[node] }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().opacity(0.3)
            pane
        }
        .quickLookPreview($preview)
        .onChange(of: node) { _, _ in
            selection = []
            filter = ""
        }
        .confirmationDialog("Usuń plik", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let file = removing {
                Button("Usuń", role: .destructive) { Task { await store.deleteFile(file, from: node) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Usunąć „\(removing?.name ?? "")”? Plik zniknie z Dysku, Findera i CRM — tej operacji nie można cofnąć.")
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                let path = listing?.path ?? []
                if path.isEmpty {
                    Text(store.info(section)?.label ?? "").foregroundStyle(theme.accent)
                } else {
                    ForEach(Array(path.enumerated()), id: \.element.id) { index, crumb in
                        if index > 0 { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary) }
                        Button(crumb.name) { store.openNode(crumb.id) }.buttonStyle(.plain).foregroundStyle(theme.accent).lineLimit(1)
                    }
                }
            }
            .font(.callout)
            .layoutPriority(1)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease").foregroundStyle(.secondary)
                TextField("Filtruj w tym folderze", text: $filter).textFieldStyle(.plain).frame(minWidth: 120, maxWidth: 220)
                if !filter.isEmpty {
                    Button { filter = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.06)))
            if section == .finance {
                Button { state.showFinance(.center) } label: { Label("Centrum finansów", systemImage: "building.columns") }
                    .help("Otwórz Centrum finansów")
            }
            Picker("Widok", selection: $viewMode) {
                Image(systemName: "square.grid.2x2").tag("grid").help("Siatka miniatur")
                Image(systemName: "list.bullet").tag("list").help("Lista")
            }
            .labelsHidden().pickerStyle(.segmented).frame(width: 90)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func matches(_ text: String) -> Bool {
        let query = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty || text.localizedCaseInsensitiveContains(query)
    }

    @ViewBuilder private var pane: some View {
        let canUpload = listing?.canUpload == true
        ZStack {
            if let listing {
                let folders = listing.folders.filter { matches($0.name) }
                let files = listing.files.filter { matches($0.name) || matches($0.detail) }
                if folders.isEmpty && files.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: emptySymbol).font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text(filter.isEmpty ? DriveText.empty(section, node: listing.node, canUpload: canUpload) : "Brak plików pasujących do „\(filter)”.")
                            .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewMode == "grid" {
                    grid(folders, files)
                } else {
                    list(folders, files)
                }
            } else if let error = store.listErrors[node] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać folderu", systemImage: "folder")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadListing(node) } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if canUpload && dropTargeted {
                RoundedRectangle(cornerRadius: 10).fill(theme.accent.opacity(0.12))
                    .overlay {
                        Label(DriveText.dropLabel(node, name: listing?.node.name ?? ""),
                              systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent)
                    }
                    .padding(8).allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onDrop(of: PortfolioDrop.types, isTargeted: $dropTargeted) { providers in drop(providers) }
        .focusable()
        .focused($paneFocused)
        .focusEffectDisabled()
        .onKeyPress(.space) {
            guard let file = selectedFile else { return .ignored }
            Task { await open(file) }
            return .handled
        }
        .onKeyPress(.return) {
            guard selection.count == 1, let key = selection.first else { return .ignored }
            if key.hasPrefix("d:") { store.openNode(String(key.dropFirst(2))) } else if let file = selectedFile { Task { await open(file) } }
            return .handled
        }
        .onExitCommand { selection = [] }
    }

    private var selectedFile: DriveFile? {
        guard selection.count == 1, let key = selection.first, key.hasPrefix("f:") else { return nil }
        return listing?.files.first { "f:" + $0.id == key }
    }

    private func drop(_ providers: [NSItemProvider]) -> Bool {
        guard listing?.canUpload == true, !providers.isEmpty else { return false }
        let target = node
        Task {
            let urls = await PortfolioDrop.files(providers)
            if !urls.isEmpty { await store.upload(urls, to: target) }
        }
        return true
    }

    /// Podgląd (Quick Look); instalator z Programów — od razu do „Pobrane”.
    private func open(_ file: DriveFile) async {
        if file.isInstaller {
            await store.downloadToDownloads(file)
            return
        }
        if let local = await store.previewFile(file) { preview = local }
    }

    private var emptySymbol: String {
        switch section {
        case .warehouse: return "shippingbox"
        case .employees: return "person.2"
        case .finance: return "building.columns"
        case .programs: return "laptopcomputer.and.arrow.down"
        default: return "doc.text"
        }
    }

    /// „3 pliki” (rok, miesiąc), „5 pozycji” (kategoria), „4 dokumenty” (Finanse).
    private func countLabel(_ folder: DriveFolder) -> String {
        guard let count = folder.count else { return "" }
        let tens = count % 100, ones = count % 10
        let few = (2...4).contains(ones) && !(12...14).contains(tens)
        if folder.id.hasPrefix("finance:") { return count == 1 ? "1 dokument" : "\(count) \(few ? "dokumenty" : "dokumentów")" }
        if folder.kind == "year" || folder.kind == "month" { return MaterialsText.files(count) }
        if count == 1 { return "1 pozycja" }
        return "\(count) \(few ? "pozycje" : "pozycji")"
    }

    private func folderIcon(_ folder: DriveFolder) -> String {
        switch folder.kind {
        case "equipment": return "shippingbox.fill"
        case "employee": return "person.crop.circle.fill"
        case "year", "month": return "calendar"
        case "company": return "building.2.fill"
        case "books": return "books.vertical.fill"
        case "ledger": return DriveText.ledgerSymbol(folder.financeGroup)
        case "corporate": return "briefcase.fill"
        case "agreements": return "signature"
        case "agreement": return "doc.text.fill"
        case "assets": return "shippingbox.fill"
        case "clarify": return "exclamationmark.triangle.fill"
        default: return "folder.fill"
        }
    }

    @ViewBuilder private func fileMenu(_ file: DriveFile) -> some View {
        if !file.isInstaller { Button("Podgląd") { Task { await open(file) } } }
        Button("Otwórz w domyślnej aplikacji") { Task { await store.openExternally(file) } }
        Button("Pobierz") { Task { await store.downloadToDownloads(file) } }
        if let record = file.record {
            Divider()
            Button(DriveText.recordLabel(record)) { store.openRecord(record) }
        }
        if FinderDomain.available {
            Button("Pokaż w Finderze") { Task { await FinderDomain.reveal(driveFile: file.id) } }
        }
        if file.deletable {
            Divider()
            Button("Usuń…", role: .destructive) { removing = file }
        }
    }

    private func select(_ key: String) {
        if NSEvent.modifierFlags.contains(.command) {
            if selection.contains(key) { selection.remove(key) } else { selection.insert(key) }
        } else {
            selection = [key]
        }
    }

    private func tile<Thumb: View, Caption: View>(key: String, @ViewBuilder thumb: () -> Thumb, @ViewBuilder caption: () -> Caption) -> some View {
        let selected = selection.contains(key)
        return VStack(spacing: 6) {
            thumb()
            caption().frame(width: 136)
        }
        .padding(8)
        .background(selected ? theme.accent.opacity(0.22) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded {
            select(key)
            paneFocused = true
        })
    }

    private func grid(_ folders: [DriveFolder], _ files: [DriveFile]) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], alignment: .leading, spacing: 12) {
                ForEach(folders) { folder in
                    tile(key: "d:" + folder.id) {
                        Image(systemName: folderIcon(folder)).resizable().scaledToFit().padding(32).foregroundStyle(theme.accent).frame(width: 128, height: 128)
                    } caption: {
                        VStack(spacing: 1) {
                            Text(folder.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                            if folder.count != nil { Text(countLabel(folder)).font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                    .onTapGesture(count: 2) { store.openNode(folder.id) }
                    .help(folder.name)
                }
                ForEach(files) { file in
                    tile(key: "f:" + file.id) {
                        DriveFileThumb(file: file, side: 128)
                    } caption: {
                        VStack(spacing: 1) {
                            Text(file.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                            Text(file.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .onTapGesture(count: 2) { Task { await open(file) } }
                    .contextMenu { fileMenu(file) }
                    .onDrag { store.dragProvider(file) }
                    .help(DriveText.caption(file))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Color.clear.contentShape(Rectangle()).onTapGesture { selection = [] })
    }

    private func list(_ folders: [DriveFolder], _ files: [DriveFile]) -> some View {
        List(selection: $selection) {
            ForEach(folders) { folder in
                HStack(spacing: 10) {
                    Image(systemName: folderIcon(folder)).font(.title3).foregroundStyle(theme.accent).frame(width: 36, height: 36)
                    Text(folder.name).font(.callout).lineLimit(1)
                    Spacer()
                    if folder.count != nil { Text(countLabel(folder)).font(.caption).foregroundStyle(.secondary) }
                }
                .padding(.vertical, 2)
                .tag("d:" + folder.id)
            }
            ForEach(files) { file in
                HStack(spacing: 10) {
                    DriveFileThumb(file: file, side: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name).font(.callout).lineLimit(1)
                        Text(DriveText.caption(file)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    if let record = file.record {
                        Button { store.openRecord(record) } label: { Image(systemName: "arrow.up.forward.square") }
                            .buttonStyle(.borderless).help(DriveText.recordLabel(record))
                    }
                    if !file.isInstaller {
                        Button { Task { await open(file) } } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd (spacja)")
                    }
                    Button { Task { await store.downloadToDownloads(file) } } label: { Image(systemName: "arrow.down.circle") }
                        .buttonStyle(.borderless).help("Pobierz")
                }
                .padding(.vertical, 2)
                .tag("f:" + file.id)
                // `itemProvider` zamiast `onDrag` — na liście `onDrag` blokuje zaznaczanie wiersza kliknięciem.
                .itemProvider { store.dragProvider(file) }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first {
                if id.hasPrefix("d:") {
                    Button("Otwórz") { store.openNode(String(id.dropFirst(2))) }
                } else if let file = files.first(where: { "f:" + $0.id == id }) {
                    fileMenu(file)
                }
            }
        } primaryAction: { ids in
            guard ids.count == 1, let id = ids.first else { return }
            if id.hasPrefix("d:") { store.openNode(String(id.dropFirst(2))) }
            else if let file = files.first(where: { "f:" + $0.id == id }) { Task { await open(file) } }
        }
    }
}
