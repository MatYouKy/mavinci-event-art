import SwiftUI
import AppKit
import QuickLookThumbnailing
import UniformTypeIdentifiers

// MARK: Pliki wydarzenia (1:1 z `EventFilesExplorer`): drzewo folderów, okruszki, lista / siatka / miniatury, sortowanie,
// zaznaczanie (⌘ i ⇧ jak w Finderze), kopiuj / wytnij / wklej, zmiana nazwy, usuwanie, nowy folder (z blokadą nazw
// dokumentacji handlowej), wysyłanie plików przyciskiem i przeciąganiem, podgląd Quick Look i pobieranie do „Pobrane”.

struct FilesTabData: Decodable {
    struct Folder: Decodable, Identifiable, Hashable { var id: String; var name: String; var parentId: String?; var createdAt: String? }
    struct File: Decodable, Identifiable, Hashable {
        var id: String; var name: String; var originalName: String; var path: String; var size: Double; var mime: String; var folderId: String?; var createdAt: String?
        var ext: String { (originalName as NSString).pathExtension.lowercased() }
        var isImage: Bool { mime.hasPrefix("image/") }
        var isPdf: Bool { mime == "application/pdf" || ext == "pdf" || name.lowercased().hasSuffix(".pdf") }
        var sizeLabel: String { ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file) }
    }
    var canViewCommercialDocs: Bool
    var folders: [Folder]
    var files: [File]
}

private struct FilesLinks: Decodable { var urls: [String: String] }
private struct UploadSlots: Decodable { struct Slot: Decodable { var name: String; var path: String; var url: String }; var slots: [Slot] }
private struct UploadReply: Decodable { var added: Int; var failed: [String] }

/// Podpisane adresy, pobrane kopie (w katalogu tymczasowym, tylko dla tego użytkownika) i miniatury Quick Look.
@MainActor final class EventFilesCache {
    static let shared = EventFilesCache()
    private var links: [String: (url: URL, at: Date)] = [:]
    private let images = NSCache<NSString, NSImage>()
    private var loading: [String: Task<NSImage?, Never>] = [:]

    private func fresh(_ id: String) -> URL? {
        guard let link = links[id], Date().timeIntervalSince(link.at) < 3000 else { return nil }
        return link.url
    }

    func prefetch(_ store: EventCardStore, _ eventID: String, _ ids: [String]) async {
        let missing = ids.filter { fresh($0) == nil }
        guard !missing.isEmpty else { return }
        for start in stride(from: 0, to: missing.count, by: 100) {
            let chunk = Array(missing[start..<min(start + 100, missing.count)])
            guard let reply = try? await store.tabQuery(eventID, "files", "urls", ["ids": chunk.joined(separator: ",")], as: FilesLinks.self) else { continue }
            for (id, text) in reply.urls { if let url = URL(string: text) { links[id] = (url, Date()) } }
        }
    }

    func link(_ store: EventCardStore, _ eventID: String, _ file: FilesTabData.File) async throws -> URL {
        if let url = fresh(file.id) { return url }
        await prefetch(store, eventID, [file.id])
        guard let url = fresh(file.id) else { throw AppError.invalidResponse }
        return url
    }

    func localFile(_ store: EventCardStore, _ eventID: String, _ file: FilesTabData.File) async throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-pliki/\(file.id)", isDirectory: true)
        let target = folder.appendingPathComponent(file.originalName.replacingOccurrences(of: "/", with: "-"))
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let url = try await link(store, eventID, file)
        let (temporary, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: target.path) { try? FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: temporary, to: target)
        return target
    }

    func cachedThumbnail(_ file: FilesTabData.File) -> NSImage? { images.object(forKey: file.id as NSString) }

    func thumbnail(_ store: EventCardStore, _ eventID: String, _ file: FilesTabData.File) async -> NSImage? {
        if let image = images.object(forKey: file.id as NSString) { return image }
        guard file.isImage || file.isPdf, file.size <= 40_000_000 else { return nil }
        if let task = loading[file.id] { return await task.value }
        let task = Task<NSImage?, Never> {
            guard let local = try? await self.localFile(store, eventID, file) else { return nil }
            let request = QLThumbnailGenerator.Request(fileAt: local, size: CGSize(width: 256, height: 256), scale: 2, representationTypes: .thumbnail)
            return try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).nsImage
        }
        loading[file.id] = task
        let image = await task.value
        loading[file.id] = nil
        if let image { images.setObject(image, forKey: file.id as NSString) }
        return image
    }
}

/// Miniatura pliku: podgląd obrazu lub pierwszej strony PDF (Quick Look), dla pozostałych — systemowa ikona typu.
@MainActor private struct EventFileThumb: View {
    let store: EventCardStore
    let eventID: String
    let file: FilesTabData.File
    let side: CGFloat
    @State private var image: NSImage?

    var body: some View {
        ZStack {
            Color.primary.opacity(0.05)
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Image(nsImage: NSWorkspace.shared.icon(for: UTType(filenameExtension: file.ext) ?? .data)).resizable().scaledToFit().padding(side * 0.12)
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: file.id) {
            image = EventFilesCache.shared.cachedThumbnail(file)
            if image == nil { image = await EventFilesCache.shared.thumbnail(store, eventID, file) }
        }
    }
}

@MainActor struct EventFilesTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventFiles.viewMode") private var viewMode = "list"
    @AppStorage("eventFiles.sortBy") private var sortBy = "name"
    @State private var currentFolder: String?
    @State private var selection = Set<String>()
    @State private var collapsed = Set<String>()
    @State private var clipboard: (cut: Bool, ids: [String])?
    @State private var folderPrompt: FolderPrompt?
    @State private var promptName = ""
    @State private var deleting: DeleteRequest?
    @State private var preview: URL?
    @State private var uploading: String?
    @State private var dropTargeted = false

    private struct FolderPrompt: Identifiable { let id = UUID(); var renameID: String?; var kind: String; var parentID: String? }
    private struct DeleteRequest: Identifiable { let id = UUID(); var ids: [String]; var kind: String; var name: String; var count: Int }

    private var data: FilesTabData? { store.tab(eventID, "files", as: FilesTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|files"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać plików", systemImage: "folder")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "files") } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "files") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "files") } }
        .quickLookPreview($preview)
        .alert(folderPrompt?.renameID == nil ? "Nowy folder" : "Zmień nazwę", isPresented: Binding(get: { folderPrompt != nil }, set: { if !$0 { folderPrompt = nil } })) {
            TextField(folderPrompt?.kind == "file" ? "Nazwa pliku" : "Nazwa folderu", text: $promptName)
            Button(folderPrompt?.renameID == nil ? "Utwórz" : "Zapisz") { Task { await submitPrompt() } }
            Button("Anuluj", role: .cancel) { folderPrompt = nil }
        }
        .confirmationDialog(deleting.map(deleteQuestion) ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let request = deleting { Task { await performDelete(request) } } }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text(deleting?.kind == "folder" ? "Folder razem z podfolderami i plikami trafi do kosza — przez 30 dni można go przywrócić (Kosz w Finderze)."
                 : "Pliki trafią do kosza — przez 30 dni można je przywrócić (Kosz w Finderze).")
        }
    }

    private func deleteQuestion(_ request: DeleteRequest) -> String {
        if request.kind == "folder" { return "Czy na pewno chcesz usunąć folder „\(request.name)”?" }
        if request.count == 1 { return "Czy na pewno chcesz usunąć plik „\(request.name)”?" }
        return "Usunąć \(request.count) elementów?"
    }

    // MARK: Układ

    private func content(_ data: FilesTabData) -> some View {
        let taskKey = (currentFolder ?? "root") + "|" + String(data.files.count)
        return HStack(spacing: 0) {
            sidebar(data)
                .frame(width: 240)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9))
            VStack(spacing: 0) {
                toolbar(data)
                Divider().opacity(0.3)
                pane(data)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: currentFolder) { _, _ in selection = [] }
        .task(id: taskKey) {
            let ids = data.files.filter { $0.folderId == currentFolder && ($0.isImage || $0.isPdf) }.map(\.id)
            await EventFilesCache.shared.prefetch(store, eventID, ids)
        }
    }

    /// Kolejność drzewa: folder, jego podfoldery (z wcięciem), następny folder — zwinięte gałęzie pomijane.
    private func tree(_ data: FilesTabData) -> [(folder: FilesTabData.Folder, level: Int, hasChildren: Bool)] {
        var result: [(folder: FilesTabData.Folder, level: Int, hasChildren: Bool)] = []
        func visit(_ parent: String?, _ level: Int) {
            for folder in data.folders.filter({ $0.parentId == parent }).sorted(by: { $0.name.localizedCompare($1.name) == .orderedAscending }) {
                let children = data.folders.contains { $0.parentId == folder.id }
                result.append((folder: folder, level: level, hasChildren: children))
                if !collapsed.contains(folder.id) { visit(folder.id, level + 1) }
            }
        }
        visit(nil, 0)
        return result
    }

    private func sidebar(_ data: FilesTabData) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Foldery").font(.callout.weight(.semibold))
                Spacer()
                Button { newFolder(parent: currentFolder) } label: { Image(systemName: "folder.badge.plus") }
                    .buttonStyle(.borderless).help("Nowy folder")
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    folderRow(id: nil, name: "Główny folder", level: 0, hasChildren: false)
                    ForEach(tree(data), id: \.folder.id) { item in
                        folderRow(id: item.folder.id, name: item.folder.name, level: item.level, hasChildren: item.hasChildren)
                            .contextMenu { folderMenu(item.folder) }
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 12)
            }
            if FinderDomain.available {
                Button { Task { await FinderDomain.reveal(event: eventID) } } label: { Label("Pokaż w Finderze", systemImage: "folder") }
                    .buttonStyle(.borderless).font(.caption).foregroundStyle(.secondary)
                    .help("Pliki tego wydarzenia w Finderze: Mavinci → Eventy → rok → wydarzenie (zmiany wracają do CRM).")
                    .padding(12)
            }
        }
    }

    private func folderRow(id: String?, name: String, level: Int, hasChildren: Bool) -> some View {
        let active = currentFolder == id
        return HStack(spacing: 6) {
            if let id, hasChildren {
                Button { if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) } } label: {
                    Image(systemName: collapsed.contains(id) ? "chevron.right" : "chevron.down").font(.caption2).frame(width: 12)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            } else {
                Color.clear.frame(width: 12)
            }
            Image(systemName: active ? "folder.fill" : "folder").foregroundStyle(theme.accent)
            Text(name).font(.callout).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(level) * 14 + 6).padding(.trailing, 6).padding(.vertical, 5)
        .background(active ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { currentFolder = id }
    }

    @ViewBuilder private func folderMenu(_ folder: FilesTabData.Folder) -> some View {
        Button("Otwórz") { currentFolder = folder.id }
        Button("Nowy podfolder…") { newFolder(parent: folder.id) }
        Button("Zmień nazwę…") { promptName = folder.name; folderPrompt = FolderPrompt(renameID: folder.id, kind: "folder", parentID: nil) }
        Divider()
        Button("Usuń", role: .destructive) { deleting = DeleteRequest(ids: [folder.id], kind: "folder", name: folder.name, count: 1) }
    }

    private func breadcrumbs(_ data: FilesTabData) -> [FilesTabData.Folder] {
        var crumbs: [FilesTabData.Folder] = []
        var cursor = currentFolder
        while let id = cursor, let folder = data.folders.first(where: { $0.id == id }) {
            crumbs.insert(folder, at: 0)
            cursor = folder.parentId
        }
        return crumbs
    }

    private func toolbar(_ data: FilesTabData) -> some View {
        let selectedFiles = selection.filter { !$0.hasPrefix("d:") }
        return HStack(spacing: 10) {
            HStack(spacing: 4) {
                Button("Główny") { currentFolder = nil }.buttonStyle(.plain).foregroundStyle(theme.accent)
                ForEach(breadcrumbs(data)) { crumb in
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                    Button(crumb.name) { currentFolder = crumb.id }.buttonStyle(.plain).foregroundStyle(theme.accent).lineLimit(1)
                }
            }
            .font(.callout)
            Spacer()
            if let uploading {
                ProgressView().controlSize(.small)
                Text(uploading).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if !selectedFiles.isEmpty {
                Menu {
                    Button("Kopiuj") { clipboard = (cut: false, ids: Array(selectedFiles)); state.succeed("Pliki zostały skopiowane") }
                    Button("Wytnij") { clipboard = (cut: true, ids: Array(selectedFiles)); state.succeed("Pliki zostały wycięte") }
                    Divider()
                    Button("Usuń", role: .destructive) { askDelete(Array(selectedFiles), data) }
                } label: { Label("Zaznaczone: \(selectedFiles.count)", systemImage: "checklist") }
                .fixedSize()
            }
            if let clipboard {
                Button { Task { await paste() } } label: { Label("Wklej (\(clipboard.ids.count))", systemImage: "doc.on.clipboard") }
                    .help(clipboard.cut ? "Przenieś wycięte pliki do bieżącego folderu" : "Skopiuj pliki do bieżącego folderu")
            }
            Picker("Sortuj", selection: $sortBy) {
                Text("Nazwa").tag("name")
                Text("Data").tag("date")
                Text("Rozmiar").tag("size")
                Text("Typ").tag("type")
            }
            .labelsHidden().frame(width: 110)
            Picker("Widok", selection: $viewMode) {
                Image(systemName: "list.bullet").tag("list").help("Lista")
                Image(systemName: "square.grid.3x3").tag("grid").help("Siatka")
                Image(systemName: "photo.on.rectangle").tag("thumbnails").help("Miniatury")
            }
            .labelsHidden().pickerStyle(.segmented).frame(width: 120)
            Button { chooseFiles() } label: { Label("Dodaj pliki", systemImage: "square.and.arrow.up") }
                .buttonStyle(.borderedProminent).disabled(uploading != nil)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func sorted(_ files: [FilesTabData.File]) -> [FilesTabData.File] {
        files.sorted { a, b in
            switch sortBy {
            case "date": return (a.createdAt ?? "") > (b.createdAt ?? "")
            case "size": return a.size > b.size
            case "type": return a.mime.localizedCompare(b.mime) == .orderedAscending
            default: return a.name.localizedCompare(b.name) == .orderedAscending
            }
        }
    }

    // MARK: Zawartość folderu

    private func pane(_ data: FilesTabData) -> some View {
        let subfolders = data.folders.filter { $0.parentId == currentFolder }.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        let files = sorted(data.files.filter { $0.folderId == currentFolder })
        return ZStack {
            if subfolders.isEmpty && files.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "doc").font(.system(size: 40)).foregroundStyle(.tertiary)
                    Text("Brak plików w tym folderze").foregroundStyle(.secondary)
                    Text("Przeciągnij i upuść pliki lub kliknij „Dodaj pliki”").font(.callout).foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewMode == "list" {
                list(data, subfolders, files)
            } else {
                grid(data, subfolders, files, side: viewMode == "grid" ? 96 : 150)
            }
            if dropTargeted {
                RoundedRectangle(cornerRadius: 10).fill(theme.accent.opacity(0.12))
                    .overlay { Label("Upuść pliki tutaj", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
                    .padding(8).allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter { $0.isFileURL && !$0.hasDirectoryPath }
            guard !files.isEmpty else { return false }
            Task { await upload(files) }
            return true
        } isTargeted: { dropTargeted = $0 }
    }

    private func list(_ data: FilesTabData, _ subfolders: [FilesTabData.Folder], _ files: [FilesTabData.File]) -> some View {
        List(selection: $selection) {
            ForEach(subfolders) { folder in
                HStack(spacing: 10) {
                    Image(systemName: "folder.fill").font(.title2).foregroundStyle(theme.accent).frame(width: 40, height: 40)
                    Text(folder.name).font(.callout)
                    Spacer()
                    Text(Self.filesLabel(data.files.filter { $0.folderId == folder.id }.count)).font(.caption).foregroundStyle(.secondary)
                }
                .tag("d:" + folder.id)
            }
            ForEach(files) { file in
                HStack(spacing: 10) {
                    EventFileThumb(store: store, eventID: eventID, file: file, side: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name).font(.callout).lineLimit(1)
                        Text(file.sizeLabel + " • " + dateLabel(file.createdAt)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await open(file) } } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd")
                    Button { Task { await download(file) } } label: { Image(systemName: "arrow.down.circle") }.buttonStyle(.borderless).help("Pobierz")
                }
                .tag(file.id)
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .contextMenu(forSelectionType: String.self) { ids in
            selectionMenu(ids, data)
        } primaryAction: { ids in
            guard ids.count == 1, let id = ids.first else { return }
            if id.hasPrefix("d:") { currentFolder = String(id.dropFirst(2)) }
            else if let file = data.files.first(where: { $0.id == id }) { Task { await open(file) } }
        }
        .onDeleteCommand { askDelete(Array(selection), data) }
    }

    private func grid(_ data: FilesTabData, _ subfolders: [FilesTabData.Folder], _ files: [FilesTabData.File], side: CGFloat) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: side + 24), spacing: 12)], alignment: .leading, spacing: 12) {
                ForEach(subfolders) { folder in
                    tile(id: "d:" + folder.id, side: side) {
                        Image(systemName: "folder.fill").resizable().scaledToFit().padding(side * 0.18).foregroundStyle(theme.accent).frame(width: side, height: side)
                    } caption: {
                        Text(folder.name).font(.caption).lineLimit(1)
                    }
                    .contextMenu { folderMenu(folder) }
                    .onTapGesture(count: 2) { currentFolder = folder.id }
                }
                ForEach(files) { file in
                    tile(id: file.id, side: side) {
                        EventFileThumb(store: store, eventID: eventID, file: file, side: side)
                    } caption: {
                        VStack(spacing: 1) {
                            Text(file.name).font(.caption).lineLimit(1)
                            if viewMode == "grid" { Text(file.sizeLabel).font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                    .contextMenu { selectionMenu(selection.contains(file.id) ? selection : Set([file.id]), data) }
                    .onTapGesture(count: 2) { Task { await open(file) } }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Color.clear.contentShape(Rectangle()).onTapGesture { selection = [] })
        }
        .onDeleteCommand { askDelete(Array(selection), data) }
    }

    private func tile<Thumb: View, Caption: View>(id: String, side: CGFloat, @ViewBuilder thumb: () -> Thumb, @ViewBuilder caption: () -> Caption) -> some View {
        let selected = selection.contains(id)
        return VStack(spacing: 6) {
            thumb()
            caption().frame(width: side + 8)
        }
        .padding(8)
        .background(selected ? theme.accent.opacity(0.2) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded { select(id) })
    }

    /// Klik zaznacza jeden element, ⌘ dodaje lub odejmuje, ⇧ dokłada (jak w Finderze).
    private func select(_ id: String) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.command) || flags.contains(.shift) {
            if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
        } else {
            selection = [id]
        }
    }

    @ViewBuilder private func selectionMenu(_ ids: Set<String>, _ data: FilesTabData) -> some View {
        let files = data.files.filter { ids.contains($0.id) }
        let folders = data.folders.filter { ids.contains("d:" + $0.id) }
        if files.count == 1, let file = files.first, folders.isEmpty {
            Button("Podgląd") { Task { await open(file) } }
            Button("Otwórz w domyślnej aplikacji") { Task { await openExternally(file) } }
            Button("Pobierz") { Task { await download(file) } }
            Button("Zmień nazwę…") { promptName = file.name; folderPrompt = FolderPrompt(renameID: file.id, kind: "file", parentID: nil) }
            Divider()
        } else if folders.count == 1, files.isEmpty, let folder = folders.first {
            folderMenu(folder)
        }
        if !files.isEmpty {
            Button("Kopiuj") { clipboard = (cut: false, ids: files.map(\.id)); state.succeed("Pliki zostały skopiowane") }
            Button("Wytnij") { clipboard = (cut: true, ids: files.map(\.id)); state.succeed("Pliki zostały wycięte") }
        }
        if let clipboard { Button("Wklej (\(clipboard.ids.count))") { Task { await paste() } } }
        if !files.isEmpty {
            Divider()
            Button("Usuń", role: .destructive) { askDelete(files.map(\.id), data) }
        }
    }

    /// „1 plik”, „2 pliki”, „5 plików”.
    private static func filesLabel(_ count: Int) -> String {
        let tens = count % 100
        let ones = count % 10
        if count == 1 { return "1 plik" }
        if (2...4).contains(ones) && !(12...14).contains(tens) { return "\(count) pliki" }
        return "\(count) plików"
    }

    private func dateLabel(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "" }
        return MeetingDates.format(date, "dd.MM.yyyy")
    }

    // MARK: Czynności

    private func newFolder(parent: String?) {
        promptName = ""
        folderPrompt = FolderPrompt(renameID: nil, kind: "folder", parentID: parent)
    }

    private func submitPrompt() async {
        guard let prompt = folderPrompt else { return }
        folderPrompt = nil
        let name = promptName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            if let id = prompt.renameID {
                try await store.tabAction(eventID, "files", "rename", ["id": .string(id), "kind": .string(prompt.kind), "name": .string(name)], reload: ["files"],
                                          success: prompt.kind == "folder" ? "Nazwa folderu została zmieniona" : "Nazwa pliku została zmieniona")
            } else {
                try await store.tabAction(eventID, "files", "createFolder", ["name": .string(name), "parentId": prompt.parentID.map { JSONValue.string($0) } ?? JSONValue.null], reload: ["files"],
                                          success: "Folder został utworzony", pending: "Tworzenie folderu…")
            }
            FinderDomain.signal()
        } catch {
            state.error = store.failureText(error, prompt.renameID == nil ? "Błąd podczas tworzenia folderu" : "Nie udało się zmienić nazwy")
        }
    }

    private func askDelete(_ ids: [String], _ data: FilesTabData) {
        let files = ids.filter { !$0.hasPrefix("d:") }
        let folders = ids.filter { $0.hasPrefix("d:") }.map { String($0.dropFirst(2)) }
        if files.isEmpty, folders.count == 1, let folder = data.folders.first(where: { $0.id == folders[0] }) {
            deleting = DeleteRequest(ids: [folder.id], kind: "folder", name: folder.name, count: 1)
        } else if !files.isEmpty {
            let name = data.files.first { $0.id == files[0] }?.name ?? ""
            deleting = DeleteRequest(ids: files, kind: "file", name: name, count: files.count)
        }
    }

    private func performDelete(_ request: DeleteRequest) async {
        deleting = nil
        do {
            if request.kind == "folder" {
                try await store.tabAction(eventID, "files", "remove", ["id": .string(request.ids[0]), "kind": .string("folder")], reload: ["files"],
                                          success: "Folder przeniesiono do kosza", pending: "Usuwanie…")
                if currentFolder == request.ids[0] { currentFolder = nil }
            } else if request.count == 1 {
                try await store.tabAction(eventID, "files", "remove", ["id": .string(request.ids[0]), "kind": .string("file")], reload: ["files"],
                                          success: "Plik przeniesiono do kosza", pending: "Usuwanie…")
            } else {
                try await store.tabAction(eventID, "files", "removeFiles", ["ids": .array(request.ids.map { JSONValue.string($0) })], reload: ["files"],
                                          success: "Pliki przeniesiono do kosza", pending: "Usuwanie…")
            }
            selection = []
            FinderDomain.signal()
        } catch {
            state.error = store.failureText(error, request.kind == "folder" ? "Błąd podczas usuwania folderu" : "Błąd podczas usuwania pliku")
        }
    }

    private func paste() async {
        guard let clipboard else { return }
        do {
            try await store.tabAction(eventID, "files", "paste", ["mode": .string(clipboard.cut ? "cut" : "copy"), "ids": .array(clipboard.ids.map { JSONValue.string($0) }),
                                                               "folderId": currentFolder.map { JSONValue.string($0) } ?? JSONValue.null],
                                      reload: ["files"], success: "Pliki zostały wklejone", pending: clipboard.cut ? "Przenoszenie…" : "Kopiowanie…")
            if clipboard.cut { self.clipboard = nil }
            selection = []
            FinderDomain.signal()
        } catch {
            state.error = store.failureText(error, "Nie udało się wkleić plików")
        }
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.prompt = "Dodaj"
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return }
        let urls = panel.urls
        Task { await upload(urls) }
    }

    /// Wysyłanie: podpisane adresy z serwera → plik prosto do magazynu → wpisy w `event_files` (jak „Upload” w CRM).
    private func upload(_ urls: [URL]) async {
        guard uploading == nil, !urls.isEmpty else { return }
        let folder = currentFolder
        uploading = "Przygotowanie…"
        defer { uploading = nil }
        do {
            let reply = try await store.tabAction(eventID, "files", "prepareUpload", ["names": .array(urls.map { JSONValue.string($0.lastPathComponent) })], reload: [],
                                                  success: nil, pending: "Przygotowanie wysyłania…")
            let slots = try JSONDecoder().decode(UploadSlots.self, from: reply).slots
            var sent: [JSONValue] = []
            for (index, pair) in zip(urls, slots).enumerated() {
                let (fileURL, slot) = pair
                uploading = "Wysyłanie \(index + 1)/\(slots.count): \(fileURL.lastPathComponent)"
                let mime = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                let size = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard let target = URL(string: slot.url) else { continue }
                var request = URLRequest(url: target)
                request.httpMethod = "PUT"
                request.setValue(mime, forHTTPHeaderField: "Content-Type")
                request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
                request.setValue("false", forHTTPHeaderField: "x-upsert")
                do {
                    let (_, response) = try await URLSession.shared.upload(for: request, fromFile: fileURL)
                    guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
                    sent.append(.object(["path": .string(slot.path), "name": .string(fileURL.lastPathComponent), "size": .number(Double(size)), "mime": .string(mime)]))
                } catch {
                    state.error = "Błąd uploadu: \(fileURL.lastPathComponent)"
                }
            }
            guard !sent.isEmpty else { return }
            uploading = "Zapisywanie…"
            let data = try await store.tabAction(eventID, "files", "registerUploads", ["folderId": folder.map { JSONValue.string($0) } ?? JSONValue.null, "files": .array(sent)],
                                                 reload: ["files"], success: nil, pending: "Zapisywanie plików…")
            let result = try JSONDecoder().decode(UploadReply.self, from: data)
            if result.added > 0 {
                state.succeed(result.added == 1 ? "Plik został dodany" : "Dodano \(result.added) plików")
                FinderDomain.signal()
            }
            if let failed = result.failed.first { state.error = "Błąd zapisu: \(failed)" }
        } catch {
            state.error = store.failureText(error, "Błąd podczas dodawania plików")
        }
    }

    private func open(_ file: FilesTabData.File) async {
        do {
            preview = try await state.withPending("Otwieranie…") { try await EventFilesCache.shared.localFile(store, eventID, file) }
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku")
        }
    }

    private func openExternally(_ file: FilesTabData.File) async {
        do {
            let local = try await state.withPending("Otwieranie…") { try await EventFilesCache.shared.localFile(store, eventID, file) }
            NSWorkspace.shared.open(local)
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku")
        }
    }

    private func download(_ file: FilesTabData.File) async {
        do {
            let local = try await state.withPending("Pobieranie…") { try await EventFilesCache.shared.localFile(store, eventID, file) }
            let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            let name = local.lastPathComponent
            let base = (name as NSString).deletingPathExtension
            let ext = (name as NSString).pathExtension
            var target = folder.appendingPathComponent(name)
            var copy = 1
            while FileManager.default.fileExists(atPath: target.path) {
                target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                copy += 1
            }
            try FileManager.default.copyItem(at: local, to: target)
            NSWorkspace.shared.activateFileViewerSelecting([target])
            state.succeed("Plik został pobrany")
        } catch {
            state.error = store.failureText(error, "Błąd podczas pobierania pliku")
        }
    }
}
