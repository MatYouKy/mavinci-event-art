import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Materiały → Albumy (główna baza zdjęć) — natywnie, 1:1 z CRM
//
// Album to uporządkowany zbiór odnośników do plików marki — bez kopiowania. Plik przeciągnięty na album w pasku bocznym
// (albo „Dodaj do albumu” w menu pliku) trafia do albumu; usunięcie z albumu nie usuwa pliku. Kolejność albumów i plików
// w albumie — przeciąganiem. Te same albumy są w CRM, w telefonie i w oknie wyboru zdjęć Prezentacji.

enum MaterialsAlbumDrag {
    static let album = "mavinci-materials-album:"
    static let file = "mavinci-album-file:"

    /// Tekst przeciąganego elementu albumu (tylko w aplikacji).
    static func text(_ providers: [NSItemProvider]) async -> String? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let value: String? = await withCheckedContinuation { continuation in
                _ = provider.loadObject(ofClass: NSString.self) { object, _ in continuation.resume(returning: object as? String) }
            }
            if let value { return value }
        }
        return nil
    }
}

/// Wiersz albumu w pasku bocznym: otwarcie, upuszczanie plików (odnośniki), przeciąganie albumu (kolejność).
@MainActor struct MaterialsAlbumRow: View {
    @ObservedObject var store: MaterialsStore
    let album: MaterialAlbum
    @Environment(\.crmTheme) private var theme
    @State private var targeted = false

    var body: some View {
        let active = !store.trashMode && store.albumID == album.id
        HStack(spacing: 8) {
            Color.clear.frame(width: 22, height: 22)
                .overlay {
                    if let cover = album.coverUrl { SocialImageView(url: cover) } else { Image(systemName: "rectangle.stack").foregroundStyle(theme.accent) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
            Text(album.name).font(.callout).lineLimit(1)
            Spacer(minLength: 0)
            Text("\(album.count)").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(targeted ? theme.accent.opacity(0.3) : active ? theme.accent.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { store.openAlbum(album.id) }
        .help(store.canManage ? "\(album.name) — przeciągnij tu pliki (odnośniki, bez kopii)" : album.name)
        .onDrag { NSItemProvider(object: (MaterialsAlbumDrag.album + album.id) as NSString) }
        .onDrop(of: [.plainText], isTargeted: $targeted) { providers in
            guard store.canManage else { return false }
            Task {
                if let refs = await MaterialsDropTypes.internalRefs(providers) {
                    await store.addToAlbum(album, fileIDs: refs.filter { $0.kind == "file" }.map(\.id))
                } else if let text = await MaterialsAlbumDrag.text(providers), text.hasPrefix(MaterialsAlbumDrag.album) {
                    let dragged = String(text.dropFirst(MaterialsAlbumDrag.album.count))
                    var ids = store.albums.map(\.id)
                    guard dragged != album.id, let from = ids.firstIndex(of: dragged), let to = ids.firstIndex(of: album.id) else { return }
                    ids.insert(ids.remove(at: from), at: to)
                    await store.reorderAlbums(ids)
                } else if let text = await MaterialsAlbumDrag.text(providers), text.hasPrefix(MaterialsAlbumDrag.file) {
                    await store.addToAlbum(album, fileIDs: [String(text.dropFirst(MaterialsAlbumDrag.file.count))])
                }
            }
            return true
        }
        .contextMenu {
            if store.canManage {
                Button("Usuń album (pliki zostaną)", role: .destructive) { Task { await store.deleteAlbum(album) } }
            }
        }
    }
}

/// Zawartość albumu: siatka plików w kolejności albumu (przeciąganie), podgląd, okładka, „Pokaż w folderze”, usunięcie z albumu.
@MainActor struct MaterialsAlbumPane: View {
    @ObservedObject var store: MaterialsStore
    let album: MaterialAlbum
    let onOpen: (MaterialFile) -> Void
    let onReveal: (MaterialFile) -> Void
    let onEdit: (MaterialAlbum) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var selection = Set<String>()
    @State private var dropTarget: String?
    @State private var confirmDelete = false

    var body: some View {
        let files = store.albumFiles[album.id]
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Button { store.openAlbum(nil) } label: { Label("Pliki", systemImage: "chevron.left") }
                VStack(alignment: .leading, spacing: 2) {
                    Label(album.name, systemImage: "rectangle.stack").font(.title3.weight(.semibold)).foregroundStyle(theme.accent)
                    Text("\(album.count) " + (album.count == 1 ? "plik" : "plików") + " · odnośniki do Materiałów, bez kopii" + (album.description.isEmpty ? "" : " · \(album.description)"))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if store.canManage {
                    if !selection.isEmpty {
                        Button { remove(Array(selection)) } label: { Label("Usuń z albumu (\(selection.count))", systemImage: "minus.circle") }
                    }
                    Button { onEdit(album) } label: { Label("Edytuj", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń album", systemImage: "trash") }
                }
            }
            if let files {
                if files.isEmpty {
                    ContentUnavailableView("Album jest pusty", systemImage: "rectangle.stack",
                                           description: Text(store.canManage ? "Przeciągnij pliki z folderów na nazwę albumu w pasku bocznym albo użyj „Dodaj do albumu” w menu pliku." : "Ten album nie ma jeszcze plików."))
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            ForEach(files) { file in tile(file, files: files) }
                        }
                        .padding(.vertical, 4)
                    }
                }
            } else {
                ProgressView("Wczytuję album…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: album.id) { _, _ in selection = [] }
        .confirmationDialog("Usunąć album „\(album.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń album", role: .destructive) { Task { await store.deleteAlbum(album) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Pliki zostaną w Materiałach — usuwamy tylko album i odnośniki.")
        }
    }

    private func tile(_ file: MaterialFile, files: [MaterialFile]) -> some View {
        let selected = selection.contains(file.id)
        return VStack(alignment: .leading, spacing: 4) {
            MaterialThumb(file: file, side: 150)
                .overlay(alignment: .topLeading) {
                    if album.coverFileId == file.id {
                        Text("Okładka").font(.caption2).padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Capsule().fill(Color.black.opacity(0.65))).foregroundStyle(.white).padding(5)
                    }
                }
            Text(file.name).font(.caption).lineLimit(1)
            Text(MaterialsText.bytes(file.size)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 10).fill(selected ? theme.accent.opacity(0.18) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(dropTarget == file.id ? theme.accent : (selected ? theme.accent.opacity(0.6) : Color.clear), lineWidth: 2))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { onOpen(file) }
        .onTapGesture {
            if NSEvent.modifierFlags.contains(.command) {
                if selected { selection.remove(file.id) } else { selection.insert(file.id) }
            } else {
                selection = [file.id]
            }
        }
        .onDrag { NSItemProvider(object: (MaterialsAlbumDrag.file + file.id) as NSString) }
        .onDrop(of: [.plainText], isTargeted: Binding(get: { dropTarget == file.id }, set: { dropTarget = $0 ? file.id : (dropTarget == file.id ? nil : dropTarget) })) { providers in
            guard store.canManage else { return false }
            Task {
                guard let text = await MaterialsAlbumDrag.text(providers), text.hasPrefix(MaterialsAlbumDrag.file) else { return }
                let dragged = String(text.dropFirst(MaterialsAlbumDrag.file.count))
                var ids = files.map(\.id)
                guard dragged != file.id, let from = ids.firstIndex(of: dragged), let to = ids.firstIndex(of: file.id) else { return }
                ids.insert(ids.remove(at: from), at: to)
                await store.reorderAlbum(album, ids: ids)
            }
            return true
        }
        .contextMenu {
            Button("Podgląd") { onOpen(file) }
            Button("Pokaż w folderze") { onReveal(file) }
            Button("Pobierz") { Task { await store.downloadToDownloads(id: file.id, version: file.contentVersion, name: file.name) } }
            if store.canManage {
                Divider()
                if file.kind == "image" { Button("Ustaw jako okładkę albumu") { Task { await store.setAlbumCover(album, file: file) } } }
                Button("Usuń z albumu (plik zostanie)") { remove(selection.contains(file.id) ? Array(selection) : [file.id]) }
            }
        }
    }

    private func remove(_ ids: [String]) {
        selection.subtract(ids)
        Task { await store.removeFromAlbum(album, fileIDs: ids) }
    }
}
