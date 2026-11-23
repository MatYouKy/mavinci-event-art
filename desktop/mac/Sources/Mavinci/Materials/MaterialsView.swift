import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Materiały — ekran natywny 1:1 z `/crm/materials` (`MaterialsWorkspace.tsx`)
//
// Marka, drzewo folderów (domyślne foldery marki z ikonami), zawartość folderu jako siatka miniatur albo lista, sortowanie,
// zaznaczanie jak w Finderze (⌘ i ⇧, ⌘A), wyszukiwanie w Materiałach i w plikach wydarzeń, karta pliku z boku, kosz.
// Przeciąganie: pliki i całe foldery z Findera (na folder albo do bieżącego folderu — z postępem wysyłki), elementy między
// folderami (na folder w siatce, na liście albo w drzewie; z ⌥ — kopia), plik z aplikacji do Findera i innych aplikacji. Spacja /
// dwuklik — Quick Look, Delete — do kosza, Enter — otwórz. Schowek jak w Finderze: ⌘C kopiuj, ⌘X wytnij, ⌘V wklej (kopia albo
// przeniesienie; pliki skopiowane w Finderze — wysyłka), w menu prawym przyciskiem także „Duplikuj”, „Kopiuj do…”, „Wklej do
// folderu”; menu na pustym miejscu: nowy folder, dodawanie plików, wklejanie.
// Na ekranie Dysku (`drive`) pasek boczny pokazuje działy Dysku (Eventy, Oferty, Magazyn…), a drzewo folderów i albumów —
// pod pozycją „Materiały”; w folderze „Logotypy i księga znaku” na górze logotypy, fonty i kolory z księgi znaku.

@MainActor struct MaterialsView: View {
    @ObservedObject var store: MaterialsStore
    /// Ekran Dysku: działy w pasku bocznym i nagłówek „Dysk” (bez tego — samodzielne Materiały).
    var drive: DriveSidebarContext? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("materials.viewMode") private var viewMode = "grid"
    @State private var selection = Set<String>()
    @State private var anchor: String?
    @State private var expanded = Set<String>()
    @State private var prompt: NamePrompt?
    @State private var promptName = ""
    @State private var deleting: [MaterialRef]?
    @State private var moving: [MaterialRef]?
    /// „Kopiuj do…” — wybór folderu docelowego.
    @State private var copying: [MaterialRef]?
    /// Zawartość folderu ma fokus klawiatury (siatka: po kliknięciu elementu) — działają ⌘C, ⌘X, ⌘V, Delete, spacja.
    @FocusState private var paneFocused: Bool
    @State private var savingEvent: MaterialEventHit?
    @State private var preview: URL?
    @State private var dropTarget: String?
    @State private var replacing: MaterialFile?
    /// Nowy album (z zaznaczonymi plikami) albo edycja albumu.
    @State private var albumPrompt: AlbumPrompt?
    @State private var albumName = ""
    @State private var albumDescription = ""

    private struct AlbumPrompt: Identifiable {
        let id = UUID()
        var album: MaterialAlbum?
        var fileIDs: [String]
    }

    private struct NamePrompt: Identifiable {
        let id = UUID()
        var title: String
        var confirm: String
        var rename: MaterialRef?
        var parent: String?
    }

    // Ciało widoku w kilku krokach (cykl życia → okna pytań → arkusze): jeden długi łańcuch modyfikatorów przekraczał
    // czas sprawdzania typów kompilatora Swift.
    var body: some View {
        sheets(dialogs(lifecycle))
    }

    private var subtitle: String {
        guard drive != nil else { return store.home?.company.name ?? "Baza plików firmy" }
        guard let home = store.home else { return "Materiały" }
        return "Materiały · " + home.company.name
    }

    private var albumPromptTitle: String {
        guard let request = albumPrompt else { return "Nowy album" }
        if request.album != nil { return "Edytuj album" }
        return request.fileIDs.isEmpty ? "Nowy album" : "Nowy album z zaznaczonych (\(request.fileIDs.count))"
    }

    private var albumPromptShown: Binding<Bool> {
        Binding(get: { albumPrompt != nil }, set: { if !$0 { albumPrompt = nil } })
    }

    private var namePromptShown: Binding<Bool> {
        Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } })
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }

    private var movingShown: Binding<Bool> {
        Binding(get: { moving != nil }, set: { if !$0 { moving = nil } })
    }

    private var copyingShown: Binding<Bool> {
        Binding(get: { copying != nil }, set: { if !$0 { copying = nil } })
    }

    private var uploadsShown: Binding<Bool> {
        Binding(get: { store.uploads != nil }, set: { if !$0 { store.closeUploads() } })
    }

    private var deleteMessage: String {
        let folders = (deleting ?? []).contains { $0.kind == "folder" }
        return folders
            ? "Elementy trafią do kosza na 30 dni — folder razem z całą zawartością. Do tego czasu można je przywrócić."
            : "Elementy trafią do kosza na 30 dni. Do tego czasu można je przywrócić."
    }

    /// Tytuł, odświeżanie co minutę i po powrocie do aplikacji, wyszukiwanie i zmiana folderu albo marki.
    private var lifecycle: some View {
        content
            .navigationTitle(drive == nil ? "Materiały" : "Dysk")
            .navigationSubtitle(subtitle)
            .task(id: state.employee?.id) {
                await store.loadHome(quiet: store.home != nil)
                await store.loadList(quiet: store.listing != nil)
                await store.loadAlbums()
                // Zmiany innych osób (CRM, Finder, telefon) — odświeżanie co minutę, gdy ekran jest otwarty.
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 60_000_000_000)
                    if Task.isCancelled { break }
                    if store.uploads?.running != true { await store.refresh() }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                Task { await store.refresh() }
            }
            .onChange(of: store.query) { _, _ in store.scheduleSearch() }
            .onChange(of: store.scope) { _, _ in store.scheduleSearch() }
            .onChange(of: store.folderID) { _, _ in clearSelection() }
            .onChange(of: store.home?.company.id) { _, _ in Task { await store.loadAlbums() } }
    }

    /// Album (nowy, z zaznaczonych, edycja), Quick Look, nazwa folderu / zmiana nazwy, przeniesienie do kosza.
    private func dialogs<V: View>(_ view: V) -> some View {
        view
            .alert(albumPromptTitle, isPresented: albumPromptShown) {
                TextField("Nazwa albumu", text: $albumName)
                TextField("Opis (opcjonalnie)", text: $albumDescription)
                Button(albumPrompt?.album == nil ? "Utwórz album" : "Zapisz") { submitAlbum() }
                Button("Anuluj", role: .cancel) { albumPrompt = nil }
            } message: {
                Text("Album zbiera pliki z różnych folderów jako odnośniki — bez kopiowania.")
            }
            .quickLookPreview($preview)
            .alert(prompt?.title ?? "", isPresented: namePromptShown) {
                TextField("Nazwa", text: $promptName)
                Button(prompt?.confirm ?? "Zapisz") { submitPrompt() }
                Button("Anuluj", role: .cancel) { prompt = nil }
            }
            .confirmationDialog(deleteQuestion, isPresented: deletingShown, titleVisibility: .visible) {
                Button("Przenieś do kosza", role: .destructive) {
                    let refs = deleting ?? []
                    deleting = nil
                    Task { await store.remove(refs); clearSelection() }
                }
                Button("Anuluj", role: .cancel) { deleting = nil }
            } message: {
                Text(deleteMessage)
            }
    }

    /// Przeniesienie do folderu, zapis pliku wydarzenia w Materiałach, postęp wysyłki.
    private func sheets<V: View>(_ view: V) -> some View {
        view
            .sheet(isPresented: movingShown) {
                movePicker
            }
            .sheet(isPresented: copyingShown) {
                copyPicker
            }
            .sheet(item: $savingEvent) { hit in
                saveEventPicker(hit)
            }
            .sheet(isPresented: uploadsShown) {
                MaterialsUploadSheet(store: store).environment(\.crmTheme, theme)
            }
    }

    private var movePicker: some View {
        let refs = moving ?? []
        let title = refs.count == 1 ? "Przenieś „\(refs[0].name)”" : "Przenieś zaznaczone (\(refs.count))"
        let excluded = refs.filter { $0.kind == "folder" }.map(\.id)
        return MaterialsFolderPicker(store: store, title: title, confirm: "Przenieś tutaj", excluded: excluded, initial: store.folderID) { target in
            moving = nil
            Task { await store.move(refs, to: target); clearSelection() }
        }
        .environment(\.crmTheme, theme)
    }

    private var copyPicker: some View {
        let refs = copying ?? []
        let title = refs.count == 1 ? "Kopiuj „\(refs[0].name)”" : "Kopiuj zaznaczone (\(refs.count))"
        let excluded = refs.filter { $0.kind == "folder" }.map(\.id)
        return MaterialsFolderPicker(store: store, title: title, confirm: "Kopiuj tutaj", excluded: excluded, initial: store.folderID) { target in
            copying = nil
            Task { await copyItems(refs, to: target) }
        }
        .environment(\.crmTheme, theme)
    }

    private func saveEventPicker(_ hit: MaterialEventHit) -> some View {
        let systemKey = hit.kind == "video" ? "video" : "photos"
        let initial = store.folderID ?? store.folders.first { $0.systemKey == systemKey }?.id
        return MaterialsFolderPicker(store: store, title: "Zapisz „\(hit.name)” w Materiałach", confirm: "Zapisz tutaj", excluded: [], initial: initial) { target in
            savingEvent = nil
            Task { await store.copyFromEvent(hit, to: target) }
        }
        .environment(\.crmTheme, theme)
    }

    @ViewBuilder private var content: some View {
        if let home = store.home {
            main(home)
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Materiały", systemImage: "archivebox")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.loadHome() } }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func main(_ home: MaterialsHome) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header(home)
            HStack(alignment: .top, spacing: 12) {
                // Pasek folderów, treść i szczegóły pliku w ramkach — wyraźny podział (jak w CRM).
                sidebar(home)
                    .frame(width: 250)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .crmPanel()
                VStack(spacing: 0) {
                    toolbar(home)
                    Divider().opacity(0.3)
                    pane(home)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .crmPanel()
                if let file = selectedFile {
                    MaterialDetailsPanel(store: store, file: file, onPreview: { Task { await open(file) } }, onRename: { askRename(MaterialRef(kind: "file", id: file.id, name: file.name)) },
                                         onMove: { moving = [MaterialRef(kind: "file", id: file.id, name: file.name)] },
                                         onDelete: { deleting = [MaterialRef(kind: "file", id: file.id, name: file.name)] },
                                         onReplace: { chooseReplacement(file) })
                        .frame(width: 320)
                        .frame(maxHeight: .infinity, alignment: .top)
                        .crmPanel()
                        .id(file.id)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Nagłówek

    private func header(_ home: MaterialsHome) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(drive == nil ? "Materiały" : "Dysk").font(.title.weight(.light))
                Text(drive == nil ? "Logotypy, zdjęcia, wideo, prezentacje i dokumenty marki — w jednym miejscu, także w Finderze (Mavinci → Materiały)."
                     : "Materiały: logotypy i księga znaku, zdjęcia, wideo, prezentacje i dokumenty marki — także w Finderze (Mavinci → Materiały).")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 16)
            if store.loading || store.listLoading { ProgressView().controlSize(.small) }
            if home.companies.count > 1 {
                Picker("Marka", selection: Binding(get: { home.company.id }, set: { store.switchCompany($0) })) {
                    ForEach(home.companies) { company in Text(company.name).tag(company.id) }
                }
                .frame(width: 200)
            }
            if FinderDomain.available {
                Button { Task { await FinderDomain.reveal(materialsFolder: store.folderID, company: home.company.id) } } label: {
                    Label("Pokaż w Finderze", systemImage: "folder")
                }
                .help("Ten folder w Finderze: Mavinci → Materiały → marka (zmiany wracają do CRM).")
            }
            Button { Task { await store.refresh(quiet: false) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            if home.access.manage {
                Button { askNewFolder(parent: store.folderID) } label: { Label("Nowy folder", systemImage: "folder.badge.plus") }
                Button { chooseFiles() } label: { Label("Dodaj pliki", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderedProminent).disabled(store.uploads?.running == true)
            }
        }
    }

    // MARK: Drzewo folderów

    private func tree(_ folders: [MaterialFolder]) -> [(folder: MaterialFolder, level: Int, hasChildren: Bool)] {
        var result: [(folder: MaterialFolder, level: Int, hasChildren: Bool)] = []
        func visit(_ parent: String?, _ level: Int) {
            for folder in MaterialsStore.ordered(folders.filter { $0.parentId == parent }) {
                let children = folders.contains { $0.parentId == folder.id }
                result.append((folder: folder, level: level, hasChildren: children))
                if expanded.contains(folder.id) { visit(folder.id, level + 1) }
            }
        }
        visit(nil, 0)
        return result
    }

    private func sidebar(_ home: MaterialsHome) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(drive == nil ? "Foldery" : "Dysk").font(.callout.weight(.semibold)).padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let drive { driveRows(drive, before: true) }
                    VStack(alignment: .leading, spacing: 2) {
                        treeRow(id: nil, name: home.company.name, symbol: "building.2", level: 0, hasChildren: false)
                        ForEach(tree(home.folders), id: \.folder.id) { item in
                            treeRow(id: item.folder.id, name: item.folder.name, symbol: MaterialsText.folderSymbol(item.folder), level: item.level + 1, hasChildren: item.hasChildren)
                                .contextMenu { folderMenu(item.folder) }
                        }
                        HStack {
                            Text("Albumy").font(.callout.weight(.semibold))
                            Spacer()
                            if home.access.manage {
                                Button { askAlbum(nil, fileIDs: []) } label: { Image(systemName: "plus") }
                                    .buttonStyle(.borderless).help("Nowy album")
                            }
                        }
                        .padding(.horizontal, 4).padding(.top, 14).padding(.bottom, 2)
                        ForEach(store.albums) { album in MaterialsAlbumRow(store: store, album: album) }
                        if store.albums.isEmpty {
                            Text(home.access.manage ? "Album zbiera zdjęcia z różnych folderów bez kopiowania. Utwórz album („+”) i przeciągaj na niego pliki." : "Ta marka nie ma albumów.")
                                .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                        }
                    }
                    .padding(.leading, drive == nil ? 0 : 10)
                    if let drive { driveRows(drive, before: false) }
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
            }
            if drive != nil { DriveStorageMeter(store: state.drive) }
            if home.access.manage {
                Divider().opacity(0.3)
                Button {
                    store.trashMode = true
                    clearSelection()
                    Task { await store.loadTrash() }
                } label: {
                    HStack {
                        Label("Kosz", systemImage: "trash")
                        Spacer()
                        if home.trashCount > 0 { Text("\(home.trashCount)").font(.caption).foregroundStyle(.secondary) }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(store.trashMode ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(8)
            }
        }
        .onChange(of: store.folderID) { _, folder in
            for item in store.path(of: folder) { expanded.insert(item.id) }
        }
    }

    /// Działy Dysku przed „Materiałami” (z pozycją „Materiały”) albo po nich — kolejność jak w Finderze.
    @ViewBuilder private func driveRows(_ drive: DriveSidebarContext, before: Bool) -> some View {
        let index = drive.sections.firstIndex { $0.section == .materials } ?? drive.sections.count
        let slice = before ? Array(drive.sections.prefix(index)) : Array(drive.sections.dropFirst(min(index + 1, drive.sections.count)))
        ForEach(slice) { info in
            DriveSectionRow(info: info, active: false) { if let section = info.section { drive.select(section) } }
        }
        if before, let materials = drive.sections.first(where: { $0.section == .materials }) {
            DriveSectionRow(info: materials, active: true) {}
        }
    }

    private func treeRow(id: String?, name: String, symbol: String, level: Int, hasChildren: Bool) -> some View {
        let active = !store.trashMode && store.albumID == nil && store.folderID == id
        let key = "tree:" + (id ?? "root")
        return HStack(spacing: 6) {
            if let id, hasChildren {
                Button { if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) } } label: {
                    Image(systemName: expanded.contains(id) ? "chevron.down" : "chevron.right").font(.caption2).frame(width: 12)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            } else {
                Color.clear.frame(width: 12)
            }
            Image(systemName: symbol).foregroundStyle(theme.accent).frame(width: 18)
            Text(name).font(.callout).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(level) * 12 + 4).padding(.trailing, 6).padding(.vertical, 5)
        .background(dropTarget == key ? theme.accent.opacity(0.3) : active ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { store.openFolder(id) }
        .onDrop(of: MaterialsDropTypes.all, isTargeted: targeted(key)) { providers in drop(providers, into: id) }
    }

    @ViewBuilder private func folderMenu(_ folder: MaterialFolder) -> some View {
        let ref = MaterialRef(kind: "folder", id: folder.id, name: folder.name)
        Button("Otwórz") { store.openFolder(folder.id) }
        if FinderDomain.available {
            Button("Pokaż w Finderze") { Task { await FinderDomain.reveal(materialsFolder: folder.id, company: folder.companyId) } }
        }
        Divider()
        Button("Kopiuj") { store.setClipboard([ref], cut: false) }
        if store.canManage {
            if folder.systemKey == nil { Button("Wytnij") { store.setClipboard([ref], cut: true) } }
            Button("Duplikuj") { Task { await copyItems([ref], to: folder.parentId) } }
            Button("Kopiuj do…") { copying = [ref] }
            if let title = pasteTitle(into: folder.name) {
                Button(title) { Task { await paste(into: folder.id) } }
            }
            Divider()
            Button("Nowy podfolder…") { askNewFolder(parent: folder.id) }
            Button("Zmień nazwę…") { askRename(ref) }
            if folder.systemKey == nil {
                Button("Przenieś…") { moving = [ref] }
                Divider()
                Button("Usuń", role: .destructive) { deleting = [ref] }
            }
        }
    }

    /// Menu na pustym miejscu zawartości folderu: nowy folder, pliki, wklejenie schowka, zaznaczenie wszystkiego.
    @ViewBuilder private func paneMenu() -> some View {
        if store.canManage {
            Button("Nowy folder…") { askNewFolder(parent: store.folderID) }
            Button("Dodaj pliki…") { chooseFiles() }
            if let title = pasteTitle(into: nil) {
                Divider()
                Button(title) { Task { await paste(into: store.folderID) } }
            }
            Divider()
        }
        Button("Zaznacz wszystko") { selection = Set(orderedKeys) }.disabled(orderedKeys.isEmpty)
        if FinderDomain.available, let company = store.home?.company.id {
            Button("Pokaż w Finderze") { Task { await FinderDomain.reveal(materialsFolder: store.folderID, company: company) } }
        }
    }

    // MARK: Pasek nad zawartością

    private func toolbar(_ home: MaterialsHome) -> some View {
        HStack(spacing: 10) {
            if store.trashMode {
                Label("Kosz — elementy wracają przez \(MaterialsText.trashDays) dni", systemImage: "trash").font(.callout)
            } else {
                HStack(spacing: 4) {
                    Button(home.company.name) { store.openFolder(nil) }.buttonStyle(.plain).foregroundStyle(theme.accent)
                    ForEach(store.path(of: store.folderID)) { crumb in
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                        Button(crumb.name) { store.openFolder(crumb.id) }.buttonStyle(.plain).foregroundStyle(theme.accent).lineLimit(1)
                    }
                }
                .font(.callout)
                .layoutPriority(1)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(store.scope == .events ? "Szukaj w plikach eventów" : "Szukaj w Materiałach", text: $store.query)
                    .textFieldStyle(.plain).frame(minWidth: 140, maxWidth: 260)
                if store.searching { ProgressView().controlSize(.mini) }
                if !store.query.isEmpty {
                    Button { store.query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.06)))
            if home.eventsAccess {
                Picker("Zakres", selection: $store.scope) {
                    ForEach(MaterialsScope.allCases) { scope in Text(scope.label).tag(scope) }
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 220)
            }
            if !store.trashMode && !store.searchActive {
                Picker("Sortuj", selection: $store.sort) {
                    ForEach(MaterialsSort.allCases) { sort in Text(sort.label).tag(sort) }
                }
                .labelsHidden().frame(width: 130)
                Picker("Widok", selection: $viewMode) {
                    Image(systemName: "square.grid.2x2").tag("grid").help("Siatka miniatur")
                    Image(systemName: "list.bullet").tag("list").help("Lista")
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 90)
            }
            if store.trashMode, !store.trash.isEmpty {
                Button(role: .destructive) { Task { await store.emptyTrash() } } label: { Label("Opróżnij kosz", systemImage: "trash.slash") }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    // MARK: Zawartość

    @ViewBuilder private func pane(_ home: MaterialsHome) -> some View {
        if store.searchActive {
            MaterialsSearchResults(store: store, onOpen: { hit in reveal(hit) }, onPreview: { hit in Task { await open(hit.file) } },
                                   onPreviewEvent: { hit in Task { await openEvent(hit) } }, onSave: { hit in savingEvent = hit })
        } else if store.trashMode {
            MaterialsTrashList(store: store)
        } else if let album = store.album {
            MaterialsAlbumPane(store: store, album: album, onOpen: { file in Task { await open(file) } },
                               onReveal: { file in
                                   store.openFolder(file.folderId)
                                   // Zaznaczenie po zmianie folderu (zmiana folderu czyści zaznaczenie).
                                   Task { @MainActor in
                                       try? await Task.sleep(for: .milliseconds(120))
                                       selection = ["f:" + file.id]
                                       anchor = "f:" + file.id
                                   }
                               },
                               onEdit: { album in askAlbum(album, fileIDs: []) })
        } else {
            browser(home)
        }
    }

    private func browser(_ home: MaterialsHome) -> some View {
        let listing = store.listing
        let folders = listing.map { MaterialsStore.ordered($0.folders) } ?? MaterialsStore.ordered(home.folders.filter { $0.parentId == store.folderID })
        let files = listing?.files ?? []
        let key = "pane"
        // „Logotypy i księga znaku” — na górze logotypy, fonty i kolory z księgi znaku (Moje firmy), bez kopii.
        let brandFolder = store.folderID.flatMap { id in store.folders.first { $0.id == id } }?.systemKey == "brand"
        return ZStack {
            VStack(spacing: 0) {
                if brandFolder {
                    DriveBrandStrip(drive: state.drive, companyID: home.company.id).padding(.horizontal, 14).padding(.top, 14)
                }
                if listing == nil && store.listLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if folders.isEmpty && files.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "tray").font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text(brandFolder ? "Brak własnych plików w tym folderze — powyżej logotypy, fonty i kolory z księgi znaku." : "Ten folder jest pusty")
                            .foregroundStyle(.secondary).multilineTextAlignment(.center)
                        if home.access.manage {
                            Text("Przeciągnij pliki albo foldery z Findera albo kliknij „Dodaj pliki”").font(.callout).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewMode == "list" {
                    list(folders, files, listing: listing)
                } else {
                    grid(folders, files, listing: listing)
                }
            }
            if dropTarget == key {
                RoundedRectangle(cornerRadius: 10).fill(theme.accent.opacity(0.12))
                    .overlay { Label("Upuść tutaj — do folderu „\(store.path(of: store.folderID).last?.name ?? home.company.name)”", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
                    .padding(8).allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onDrop(of: MaterialsDropTypes.all, isTargeted: targeted(key)) { providers in drop(providers, into: store.folderID) }
        .focusable()
        .focused($paneFocused)
        .focusEffectDisabled()
        .onCommand(#selector(NSText.copy(_:))) { store.setClipboard(selectedRefsAll, cut: false) }
        .onCommand(#selector(NSText.cut(_:))) { if store.canManage { store.setClipboard(selectedRefs, cut: true) } }
        .onCommand(#selector(NSText.paste(_:))) { Task { await paste(into: store.folderID) } }
        .onKeyPress(.space) {
            guard let file = selectedFile else { return .ignored }
            Task { await open(file) }
            return .handled
        }
        .onKeyPress(.return) {
            guard selection.count == 1, let key = selection.first else { return .ignored }
            if key.hasPrefix("d:") { store.openFolder(String(key.dropFirst(2))) } else if let file = selectedFile { Task { await open(file) } }
            return .handled
        }
        .onDeleteCommand { if store.canManage { askDelete(selectedRefs) } }
        .onExitCommand { clearSelection() }
        .onCommand(#selector(NSResponder.selectAll(_:))) { selection = Set(folders.map { "d:" + $0.id } + files.map { "f:" + $0.id }) }
    }

    private func grid(_ folders: [MaterialFolder], _ files: [MaterialFile], listing: MaterialsListing?) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], alignment: .leading, spacing: 12) {
                ForEach(folders) { folder in
                    let key = "d:" + folder.id
                    tile(key: key) {
                        Image(systemName: MaterialsText.folderSymbol(folder) == "folder" ? "folder.fill" : MaterialsText.folderSymbol(folder))
                            .resizable().scaledToFit().padding(30).foregroundStyle(theme.accent).frame(width: 128, height: 128)
                    } caption: {
                        Text(folder.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                    }
                    .onTapGesture(count: 2) { store.openFolder(folder.id) }
                    .contextMenu { selectionMenu(selection.contains(key) && selection.count > 1 ? selection : [key], folders: folders, files: files) }
                    .onDrag { store.folderDragProvider(refs(for: key)) }
                    .onDrop(of: MaterialsDropTypes.all, isTargeted: targeted("tile:" + folder.id)) { providers in drop(providers, into: folder.id) }
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(dropTarget == "tile:" + folder.id ? theme.accent : Color.clear, lineWidth: 2))
                }
                ForEach(files) { file in
                    let key = "f:" + file.id
                    tile(key: key) {
                        MaterialThumb(file: file, side: 128)
                    } caption: {
                        VStack(spacing: 1) {
                            Text(file.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                            Text(MaterialsText.bytes(file.size)).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .onTapGesture(count: 2) { Task { await open(file) } }
                    .contextMenu { selectionMenu(selection.contains(key) && selection.count > 1 ? selection : [key], folders: folders, files: files) }
                    .onDrag { store.dragProvider(file, refs: refs(for: key)) }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            if let listing, listing.files.count < listing.total {
                Button("Pokaż kolejne pliki (\(listing.total - listing.files.count))") { Task { await store.loadMore() } }.padding(.bottom, 14)
            }
        }
        .background(
            Color.clear.contentShape(Rectangle())
                .onTapGesture {
                    clearSelection()
                    paneFocused = true
                }
                .contextMenu { paneMenu() }
        )
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

    private func list(_ folders: [MaterialFolder], _ files: [MaterialFile], listing: MaterialsListing?) -> some View {
        List(selection: $selection) {
            ForEach(folders) { folder in
                let key = "d:" + folder.id
                HStack(spacing: 10) {
                    Image(systemName: MaterialsText.folderSymbol(folder)).font(.title3).foregroundStyle(theme.accent).frame(width: 36, height: 36)
                    Text(folder.name).font(.callout)
                    Spacer()
                    Text(folder.systemKey != nil ? "Folder marki" : "Folder").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
                .background(dropTarget == "row:" + folder.id ? theme.accent.opacity(0.25) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                .tag(key)
                // `itemProvider` zamiast `onDrag` — na liście `onDrag` blokuje zaznaczanie wiersza kliknięciem.
                .itemProvider { draggable(key) ? store.folderDragProvider(refs(for: key)) : nil }
                .onDrop(of: MaterialsDropTypes.all, isTargeted: targeted("row:" + folder.id)) { providers in drop(providers, into: folder.id) }
            }
            ForEach(files) { file in
                let key = "f:" + file.id
                HStack(spacing: 10) {
                    MaterialThumb(file: file, side: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name).font(.callout).lineLimit(1)
                        Text([MaterialsText.kindLabel(file.kind), MaterialsText.bytes(file.size), MaterialsText.dateLabel(file.updatedAt), file.updatedBy ?? ""]
                            .filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Button { Task { await open(file) } } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd (spacja)")
                    Button { Task { await store.downloadToDownloads(id: file.id, version: file.contentVersion, name: file.name) } } label: {
                        Image(systemName: "arrow.down.circle")
                    }
                    .buttonStyle(.borderless).help("Pobierz")
                }
                .padding(.vertical, 2)
                .tag(key)
                .itemProvider { store.dragProvider(file, refs: refs(for: key)) }
            }
            if let listing, listing.files.count < listing.total {
                Button("Pokaż kolejne pliki (\(listing.total - listing.files.count))") { Task { await store.loadMore() } }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .contextMenu(forSelectionType: String.self) { ids in
            selectionMenu(ids, folders: folders, files: files)
        } primaryAction: { ids in
            guard ids.count == 1, let id = ids.first else { return }
            if id.hasPrefix("d:") { store.openFolder(String(id.dropFirst(2))) }
            else if let file = files.first(where: { "f:" + $0.id == id }) { Task { await open(file) } }
        }
    }

    @ViewBuilder private func fileMenu(_ file: MaterialFile) -> some View {
        let ref = MaterialRef(kind: "file", id: file.id, name: file.name)
        Button("Podgląd") { Task { await open(file) } }
        Button("Otwórz w domyślnej aplikacji") { Task { await openExternally(file) } }
        Button("Pobierz") { Task { await store.downloadToDownloads(id: file.id, version: file.contentVersion, name: file.name) } }
        Divider()
        Button("Kopiuj") { store.setClipboard([ref], cut: false) }
        if store.canManage {
            Button("Wytnij") { store.setClipboard([ref], cut: true) }
            Button("Duplikuj") { Task { await copyItems([ref], to: file.folderId) } }
            Button("Kopiuj do…") { copying = [ref] }
            Divider()
            Button("Zmień nazwę…") { askRename(ref) }
            Button("Przenieś…") { moving = [ref] }
            Button("Podmień treść…") { chooseReplacement(file) }
            albumMenu([file.id])
            Divider()
            Button("Usuń", role: .destructive) { deleting = [ref] }
        }
    }

    /// „Dodaj do albumu” — odnośniki do plików (bez kopiowania).
    @ViewBuilder private func albumMenu(_ fileIDs: [String]) -> some View {
        if store.canManage, !fileIDs.isEmpty {
            Menu(fileIDs.count == 1 ? "Dodaj do albumu" : "Dodaj zaznaczone do albumu (\(fileIDs.count))") {
                ForEach(store.albums) { album in
                    Button("\(album.name) (\(album.count))") { Task { await store.addToAlbum(album, fileIDs: fileIDs) } }
                }
                if !store.albums.isEmpty { Divider() }
                Button("Nowy album…") { askAlbum(nil, fileIDs: fileIDs) }
            }
        }
    }

    /// Kilka zaznaczonych: `all` — do kopiowania (także foldery domyślne marki), `managed` — do przeniesienia i usunięcia.
    @ViewBuilder private func multiMenu(all: [MaterialRef], managed: [MaterialRef]) -> some View {
        if !all.isEmpty {
            Button("Kopiuj zaznaczone (\(all.count))") { store.setClipboard(all, cut: false) }
            if store.canManage {
                if !managed.isEmpty { Button("Wytnij zaznaczone (\(managed.count))") { store.setClipboard(managed, cut: true) } }
                Button("Duplikuj zaznaczone (\(all.count))") { Task { await copyItems(all, to: store.folderID) } }
                Button("Kopiuj zaznaczone do…") { copying = all }
            }
        }
        if store.canManage, !managed.isEmpty {
            Divider()
            Button("Przenieś zaznaczone (\(managed.count))…") { moving = managed }
            albumMenu(managed.filter { $0.kind == "file" }.map(\.id))
            Divider()
            Button("Usuń zaznaczone (\(managed.count))", role: .destructive) { deleting = managed }
        }
    }

    @ViewBuilder private func selectionMenu(_ ids: Set<String>, folders: [MaterialFolder], files: [MaterialFile]) -> some View {
        let chosenFiles = files.filter { ids.contains("f:" + $0.id) }
        let chosenFolders = folders.filter { ids.contains("d:" + $0.id) }
        if ids.isEmpty {
            paneMenu()
        } else if chosenFiles.count == 1, chosenFolders.isEmpty, let file = chosenFiles.first {
            fileMenu(file)
        } else if chosenFolders.count == 1, chosenFiles.isEmpty, let folder = chosenFolders.first {
            folderMenu(folder)
        } else {
            let fileRefs = chosenFiles.map { MaterialRef(kind: "file", id: $0.id, name: $0.name) }
            multiMenu(all: chosenFolders.map { MaterialRef(kind: "folder", id: $0.id, name: $0.name) } + fileRefs,
                      managed: chosenFolders.filter { $0.systemKey == nil }.map { MaterialRef(kind: "folder", id: $0.id, name: $0.name) } + fileRefs)
        }
    }

    // MARK: Zaznaczanie

    private var orderedKeys: [String] {
        (store.listing?.folders ?? []).map { "d:" + $0.id } + (store.listing?.files ?? []).map { "f:" + $0.id }
    }

    /// Klik zaznacza jeden element, ⌘ dodaje lub odejmuje, ⇧ zaznacza zakres (jak w Finderze).
    private func select(_ key: String) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.shift), let anchor, let a = orderedKeys.firstIndex(of: anchor), let b = orderedKeys.firstIndex(of: key) {
            let range = orderedKeys[min(a, b)...max(a, b)]
            selection = flags.contains(.command) ? selection.union(range) : Set(range)
            return
        }
        if flags.contains(.command) {
            if selection.contains(key) { selection.remove(key) } else { selection.insert(key) }
        } else {
            selection = [key]
        }
        anchor = key
    }

    private func clearSelection() {
        selection = []
        anchor = nil
    }

    private var selectedFile: MaterialFile? {
        guard !store.trashMode, !store.searchActive, selection.count == 1, let key = selection.first, key.hasPrefix("f:") else { return nil }
        return store.listing?.files.first { $0.id == String(key.dropFirst(2)) }
    }

    private var selectedRefs: [MaterialRef] {
        let listing = store.listing
        return selection.compactMap { key -> MaterialRef? in
            let id = String(key.dropFirst(2))
            if key.hasPrefix("d:"), let folder = listing?.folders.first(where: { $0.id == id }), folder.systemKey == nil {
                return MaterialRef(kind: "folder", id: id, name: folder.name)
            }
            if key.hasPrefix("f:"), let file = listing?.files.first(where: { $0.id == id }) { return MaterialRef(kind: "file", id: id, name: file.name) }
            return nil
        }
    }

    /// Przeciągany element: cała zaznaczona grupa, jeśli należy do niej, inaczej sam element.
    private func refs(for key: String) -> [MaterialRef] {
        if selection.contains(key), selection.count > 1 { return selectedRefs }
        let id = String(key.dropFirst(2))
        if key.hasPrefix("d:"), let folder = store.listing?.folders.first(where: { $0.id == id }) {
            return folder.systemKey == nil ? [MaterialRef(kind: "folder", id: id, name: folder.name)] : []
        }
        if let file = store.listing?.files.first(where: { $0.id == id }) { return [MaterialRef(kind: "file", id: id, name: file.name)] }
        return []
    }

    /// Wszystkie zaznaczone (także foldery domyślne marki) — do kopiowania.
    private var selectedRefsAll: [MaterialRef] {
        let listing = store.listing
        return selection.compactMap { key -> MaterialRef? in
            let id = String(key.dropFirst(2))
            if key.hasPrefix("d:"), let folder = listing?.folders.first(where: { $0.id == id }) { return MaterialRef(kind: "folder", id: id, name: folder.name) }
            if key.hasPrefix("f:"), let file = listing?.files.first(where: { $0.id == id }) { return MaterialRef(kind: "file", id: id, name: file.name) }
            return nil
        }
    }

    /// Wiersz folderu można przeciągnąć (zarządzanie Materiałami, nie folder domyślny marki).
    private func draggable(_ key: String) -> Bool {
        store.canManage && !refs(for: key).isEmpty
    }

    // MARK: Schowek i kopie

    /// „Wklej (3)”, „Wklej „Logo.png””, po „Wytnij” — „Przenieś tutaj …”; do folderu — „Wklej do „Folder””. Pusty schowek — brak pozycji.
    private func pasteTitle(into folderName: String?) -> String? {
        guard let clip = store.pasteReady, let first = clip.refs.first else { return nil }
        let what = clip.refs.count == 1 ? "„\(first.name)”" : "(\(clip.refs.count))"
        if let folderName { return (clip.cut ? "Przenieś do „" : "Wklej do „") + folderName + "” " + what }
        return (clip.cut ? "Przenieś tutaj " : "Wklej ") + what
    }

    /// ⌘V: schowek Materiałów (kopia albo przeniesienie) albo pliki skopiowane w Finderze (wysyłka do folderu).
    private func paste(into target: String?) async {
        guard store.canManage else {
            state.notice = "Nie masz uprawnień do dodawania plików w Materiałach tej marki."
            return
        }
        if let clip = store.pasteReady {
            let created = await store.paste(clip, into: target)
            if target == store.folderID { selectCreated(created) }
            return
        }
        let urls = (NSPasteboard.general.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        if !urls.isEmpty {
            store.upload(urls, to: target)
            return
        }
        state.notice = "Schowek jest pusty — zaznacz pliki lub foldery i użyj „Kopiuj” (⌘C)."
    }

    /// Kopie w folderze (Duplikuj, „Kopiuj do…”, przeciąganie z ⌥); kopie w bieżącym folderze zostają zaznaczone.
    private func copyItems(_ refs: [MaterialRef], to target: String?) async {
        let created = await store.copy(refs, to: target)
        if target == store.folderID { selectCreated(created) }
    }

    private func selectCreated(_ refs: [MaterialRef]) {
        guard !refs.isEmpty else { return }
        selection = Set(refs.map { ($0.kind == "folder" ? "d:" : "f:") + $0.id })
        anchor = refs.first.map { ($0.kind == "folder" ? "d:" : "f:") + $0.id }
    }

    // MARK: Upuszczanie

    private func targeted(_ key: String) -> Binding<Bool> {
        Binding(get: { dropTarget == key }, set: { active in
            if active { dropTarget = key } else if dropTarget == key { dropTarget = nil }
        })
    }

    /// Elementy z aplikacji — przeniesienie (z ⌥ — kopia, jak w Finderze); pliki i foldery z Findera (albo obrazy z innych
    /// aplikacji) — wysyłka.
    private func drop(_ providers: [NSItemProvider], into target: String?) -> Bool {
        dropTarget = nil
        guard !providers.isEmpty else { return false }
        let copy = NSEvent.modifierFlags.contains(.option)
        Task {
            if let refs = await MaterialsDropTypes.internalRefs(providers) {
                guard store.canManage else { return }
                let items = refs.filter { !($0.kind == "folder" && $0.id == target) }
                guard !items.isEmpty else { return }
                if copy {
                    await copyItems(items, to: target)
                } else {
                    await store.move(items, to: target)
                    clearSelection()
                }
                return
            }
            guard store.canManage else {
                state.notice = "Nie masz uprawnień do dodawania plików w Materiałach tej marki."
                return
            }
            let urls = await PortfolioDrop.files(providers)
            if !urls.isEmpty { store.upload(urls, to: target) }
        }
        return true
    }

    // MARK: Czynności

    private var deleteQuestion: String {
        guard let refs = deleting, let first = refs.first else { return "" }
        return refs.count == 1 ? "Usunąć „\(first.name)”?" : "Usunąć zaznaczone (\(refs.count))?"
    }

    private func askDelete(_ refs: [MaterialRef]) {
        guard !refs.isEmpty else { return }
        deleting = refs
    }

    private func askNewFolder(parent: String?) {
        promptName = ""
        prompt = NamePrompt(title: "Nowy folder", confirm: "Utwórz", rename: nil, parent: parent)
    }

    private func askAlbum(_ album: MaterialAlbum?, fileIDs: [String]) {
        albumName = album?.name ?? ""
        albumDescription = album?.description ?? ""
        albumPrompt = AlbumPrompt(album: album, fileIDs: fileIDs)
    }

    private func submitAlbum() {
        guard let request = albumPrompt else { return }
        albumPrompt = nil
        let name = String(albumName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
        let description = String(albumDescription.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        guard !name.isEmpty else { state.notice = "Podaj nazwę albumu."; return }
        Task {
            if let album = request.album { await store.updateAlbum(album, name: name, description: description) }
            else { await store.createAlbum(name, fileIDs: request.fileIDs) }
        }
    }

    private func askRename(_ ref: MaterialRef) {
        promptName = ref.name
        prompt = NamePrompt(title: ref.kind == "folder" ? "Zmień nazwę folderu" : "Zmień nazwę pliku", confirm: "Zapisz", rename: ref, parent: nil)
    }

    private func submitPrompt() {
        guard let current = prompt else { return }
        prompt = nil
        let name = promptName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        Task {
            if let ref = current.rename { await store.rename(ref, to: name) } else { await store.createFolder(name, parent: current.parent) }
        }
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.prompt = "Dodaj"
        panel.message = "Pliki i foldery trafią do „\(store.path(of: store.folderID).last?.name ?? store.home?.company.name ?? "Materiały")”."
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return }
        store.upload(panel.urls, to: store.folderID)
    }

    private func chooseReplacement(_ file: MaterialFile) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.prompt = "Podmień"
        panel.message = "Nowa treść pliku „\(file.name)” — poprzednia zostaje jako wersja na 30 dni."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.replace(file, with: url)
    }

    private func open(_ file: MaterialFile) async {
        do {
            preview = try await state.withPending("Otwieranie…") { try await store.localFile(file) }
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
        }
    }

    private func openExternally(_ file: MaterialFile) async {
        do {
            let local = try await state.withPending("Otwieranie…") { try await store.localFile(file) }
            NSWorkspace.shared.open(local)
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
        }
    }

    private func openEvent(_ hit: MaterialEventHit) async {
        do {
            preview = try await state.withPending("Otwieranie…") { try await store.localFile(kind: "event", id: hit.id, version: 1, name: hit.name) }
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
        }
    }

    /// Wynik wyszukiwania → folder pliku (także w innej marce) z zaznaczonym plikiem.
    private func reveal(_ hit: MaterialSearchHit) {
        let key = "f:" + hit.file.id
        if hit.file.companyId != store.companyID { store.switchCompany(hit.file.companyId) }
        store.openFolder(hit.file.folderId)
        Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            selection = [key]
            anchor = key
        }
    }
}

// MARK: Typy przeciągania

enum MaterialsDropTypes {
    /// Pliki z Findera, obrazy i adresy z innych aplikacji, elementy Materiałów z aplikacji (tekst).
    static let all: [UTType] = [.fileURL, .image, .url, .plainText]

    /// Odnośniki przeciąganych elementów Materiałów (przeciąganie w aplikacji); nil — przeciąganie z zewnątrz.
    static func internalRefs(_ providers: [NSItemProvider]) async -> [MaterialRef]? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let text: String? = await withCheckedContinuation { continuation in
                _ = provider.loadObject(ofClass: NSString.self) { object, _ in continuation.resume(returning: object as? String) }
            }
            if let text, let refs = MaterialsDrag.refs(text) { return refs }
        }
        return nil
    }
}

// MARK: Miniatura

/// Miniatura z dysku (albo z magazynu przy pierwszym wyświetleniu); bez miniatury — ikona typu z systemu.
@MainActor struct MaterialThumb: View {
    let file: MaterialFile
    let side: CGFloat
    var fit = false
    @State private var image: NSImage?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.primary.opacity(0.05)
            if let image {
                if fit { Image(nsImage: image).resizable().scaledToFit() } else { Image(nsImage: image).resizable().scaledToFill() }
            } else {
                Image(nsImage: NSWorkspace.shared.icon(for: MaterialsText.type(of: file.name))).resizable().scaledToFit().padding(side * 0.14)
            }
            if file.kind == "video", side >= 64, file.duration != nil {
                Text(MaterialsText.duration(file.duration)).font(.caption2.monospacedDigit()).padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Capsule().fill(.black.opacity(0.65))).foregroundStyle(.white).padding(5)
            }
        }
        .frame(width: side, height: fit ? nil : side)
        .frame(maxHeight: fit ? side : nil)
        .clipShape(RoundedRectangle(cornerRadius: side > 60 ? 8 : 5))
        .task(id: "\(file.id)-\(file.contentVersion)") {
            image = MaterialsThumbnails.shared.cached(file)
            if image == nil { image = await MaterialsThumbnails.shared.image(file) }
        }
    }
}
