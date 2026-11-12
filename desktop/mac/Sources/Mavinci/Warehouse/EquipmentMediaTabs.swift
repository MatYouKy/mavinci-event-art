import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Karta sprzętu — Galeria (`EquipmentGallery`) i Pliki (`FilesTab`): podgląd z kopii na dysku, przesyłanie (także przeciąganiem),
// zdjęcie główne, zmiana nazwy, pobieranie i usuwanie.

@MainActor struct EquipmentGalleryTab: View {
    @ObservedObject var store: WarehouseStore
    let detail: EquipmentDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var preview: EquipmentImage?
    @State private var removing: EquipmentImage?
    @State private var dropping = false
    @State private var hovered: String?

    private var canManage: Bool { store.canManage }
    private var addAction: (String, () -> Void)? { canManage ? ("Dodaj zdjęcia", { importing = true }) : nil }

    var body: some View {
        TeamCard(title: "Galeria zdjęć", action: addAction) {
            if detail.images.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Brak zdjęć").foregroundStyle(.secondary)
                    if canManage { Label("Obsługuje przeciąganie i upuszczanie", systemImage: "arrow.down.doc").font(.caption).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
                    ForEach(detail.images) { tile($0) }
                }
            }
        }
        .overlay {
            if dropping && canManage {
                RoundedRectangle(cornerRadius: 12).fill(theme.accent.opacity(0.14))
                    .overlay { Label("Upuść zdjęcia tutaj", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard canManage else { return false }
            let files = urls.filter(\.isFileURL)
            Task { await store.uploadEquipmentFiles(files, equipmentID: detail.id, gallery: true) }
            return !files.isEmpty
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await store.uploadEquipmentFiles(urls, equipmentID: detail.id, gallery: true) } }
        }
        .sheet(item: $preview) { image in
            GalleryPreviewSheet(store: store, equipmentID: detail.id, startID: image.id).warehouseSheetStyle(state)
        }
        .confirmationDialog("Usuń zdjęcie", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let image = removing else { return }
                Task { await store.run("Usuwanie zdjęcia…", "imageDelete", ["id": .string(image.id)], success: "Zdjęcie zostało usunięte", reload: detail.id) }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć to zdjęcie?") }
    }

    private func tile(_ image: EquipmentImage) -> some View {
        ZStack(alignment: .topLeading) {
            CachedRemoteImage(url: image.url, crop: nil)
                .frame(maxWidth: .infinity).frame(height: 170)
                .background(Color.primary.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            if image.primary {
                Label("Główne", systemImage: "star.fill").font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .background(theme.accent, in: RoundedRectangle(cornerRadius: 5)).foregroundStyle(.black)
                    .padding(6)
            }
            if canManage && hovered == image.id {
                HStack(spacing: 4) {
                    Spacer()
                    if !image.primary {
                        Button { setPrimary(image) } label: { Image(systemName: "star") }.help("Ustaw jako główne")
                    }
                    Button(role: .destructive) { removing = image } label: { Image(systemName: "trash") }.help("Usuń")
                }
                .buttonStyle(.borderedProminent).controlSize(.small).padding(6)
            }
        }
        .contentShape(Rectangle())
        .onHover { inside in hovered = inside ? image.id : (hovered == image.id ? nil : hovered) }
        .onTapGesture { preview = image }
        .contextMenu {
            Button("Podgląd", systemImage: "eye") { preview = image }
            if canManage && !image.primary { Button("Ustaw jako główne", systemImage: "star") { setPrimary(image) } }
            Button("Otwórz w przeglądarce", systemImage: "safari") { if let url = URL(string: image.url) { NSWorkspace.shared.open(url) } }
            if canManage {
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = image }
            }
        }
        .help(image.title)
    }

    private func setPrimary(_ image: EquipmentImage) {
        Task {
            await store.run("Ustawianie zdjęcia głównego…", "imagePrimary", ["equipmentId": .string(detail.id), "id": .string(image.id)],
                            success: "Zdjęcie główne zostało ustawione", reload: detail.id)
        }
    }
}

/// Podgląd zdjęcia z przechodzeniem (strzałki), ustawieniem jako główne i usuwaniem — jak okno podglądu w CRM.
@MainActor struct GalleryPreviewSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    let startID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var currentID = ""
    @State private var removing = false

    private var images: [EquipmentImage] { store.details[equipmentID]?.images ?? [] }
    private var index: Int? { images.firstIndex(where: { $0.id == currentID }) }
    private var current: EquipmentImage? { index.map { images[$0] } }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text(current?.title ?? "").font(.headline).lineLimit(1)
                if let index { Text("\(index + 1) / \(images.count)").foregroundStyle(.secondary).monospacedDigit() }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ZStack {
                if let current {
                    CachedRemoteImage(url: current.url, crop: AvatarCrop(x: 0, y: 0, scale: 1, fit: "contain")).id(current.id)
                } else {
                    Text("Brak zdjęć").foregroundStyle(.secondary)
                }
                HStack {
                    Button { step(-1) } label: { Image(systemName: "chevron.left").font(.title2) }.keyboardShortcut(.leftArrow, modifiers: []).help("Poprzednie")
                    Spacer()
                    Button { step(1) } label: { Image(systemName: "chevron.right").font(.title2) }.keyboardShortcut(.rightArrow, modifiers: []).help("Następne")
                }
                .buttonStyle(.borderless).padding(.horizontal, 6).disabled(images.count < 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
            HStack {
                if let current {
                    if current.primary {
                        Label("Zdjęcie główne", systemImage: "star.fill").foregroundStyle(theme.accent)
                    } else if store.canManage {
                        Button("Ustaw jako główne", systemImage: "star") {
                            Task { await store.run("Ustawianie zdjęcia głównego…", "imagePrimary", ["equipmentId": .string(equipmentID), "id": .string(current.id)],
                                                   success: "Zdjęcie główne zostało ustawione", reload: equipmentID) }
                        }
                    }
                    Button("Otwórz w przeglądarce", systemImage: "safari") { if let url = URL(string: current.url) { NSWorkspace.shared.open(url) } }
                }
                Spacer()
                if store.canManage && current != nil { Button("Usuń", systemImage: "trash", role: .destructive) { removing = true } }
            }
        }
        .padding(16)
        .frame(minWidth: 760, minHeight: 600)
        .onAppear { currentID = startID }
        .confirmationDialog("Usuń zdjęcie", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let current, let position = index else { return }
                let next = images.count > 1 ? images[position == images.count - 1 ? position - 1 : position + 1].id : nil
                Task {
                    let reply = await store.run("Usuwanie zdjęcia…", "imageDelete", ["id": .string(current.id)], success: "Zdjęcie zostało usunięte", reload: equipmentID)
                    if reply != nil { if let next { currentID = next } else { dismiss() } }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć to zdjęcie?") }
    }

    private func step(_ delta: Int) {
        guard let index, !images.isEmpty else { return }
        currentID = images[(index + delta + images.count) % images.count].id
    }
}

// MARK: Pliki

struct FileRenameRequest: Identifiable {
    let file: EquipmentFile
    var id: String { file.id }
}

@MainActor struct EquipmentFilesTab: View {
    @ObservedObject var store: WarehouseStore
    let detail: EquipmentDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var dropping = false
    @State private var renaming: FileRenameRequest?
    @State private var removing: EquipmentFile?

    private var canManage: Bool { store.canManage }
    private var addAction: (String, () -> Void)? { canManage ? ("Dodaj pliki", { importing = true }) : nil }

    var body: some View {
        TeamCard(title: "Pliki sprzętu", action: addAction) {
            if detail.files.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "doc.text").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Brak plików").foregroundStyle(.secondary)
                    if canManage {
                        Text("Kliknij „Dodaj pliki” lub przeciągnij pliki tutaj").font(.callout).foregroundStyle(.secondary)
                        Label("Obsługuje przeciąganie i upuszczanie", systemImage: "arrow.down.doc").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                VStack(spacing: 6) { ForEach(detail.files) { row($0) } }
            }
        }
        .overlay {
            if dropping && canManage {
                RoundedRectangle(cornerRadius: 12).fill(theme.accent.opacity(0.14))
                    .overlay { Label("Upuść pliki tutaj", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard canManage else { return false }
            let files = urls.filter(\.isFileURL)
            Task { await store.uploadEquipmentFiles(files, equipmentID: detail.id, gallery: false) }
            return !files.isEmpty
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await store.uploadEquipmentFiles(urls, equipmentID: detail.id, gallery: false) } }
        }
        .sheet(item: $renaming) { request in
            FileRenameSheet(store: store, equipmentID: detail.id, file: request.file).warehouseSheetStyle(state)
        }
        .confirmationDialog("Usuń plik", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń plik", role: .destructive) {
                guard let file = removing else { return }
                Task { await store.run("Usuwanie pliku…", "fileDelete", ["id": .string(file.id)], success: "Plik usunięty", reload: detail.id) }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć plik \"\(removing?.name ?? "")\"?") }
    }

    private func symbol(_ mime: String) -> String {
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "music.note" }
        if mime.contains("pdf") { return "doc.richtext" }
        if mime.contains("sheet") || mime.contains("excel") || mime.contains("csv") { return "tablecells" }
        if mime.contains("zip") || mime.contains("compressed") || mime.contains("archive") { return "doc.zipper" }
        return "doc.text"
    }

    private func row(_ file: EquipmentFile) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol(file.mime)).font(.title3).foregroundStyle(theme.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Button { open(file) } label: { Text(file.name).lineLimit(1).truncationMode(.middle) }.buttonStyle(.link).linkCursor().help(file.name)
                let date = file.createdAt.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? ""
                Text([WarehouseLabels.fileSize(file.size), date].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await download(file) } } label: { Label("Pobierz", systemImage: "arrow.down.circle") }.buttonStyle(.borderless)
            if canManage {
                Button { renaming = FileRenameRequest(file: file) } label: { Label("Zmień nazwę", systemImage: "pencil") }.buttonStyle(.borderless)
                Button(role: .destructive) { removing = file } label: { Label("Usuń", systemImage: "trash") }.buttonStyle(.borderless)
            }
        }
        .labelStyle(.iconOnly)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .contextMenu {
            Button("Otwórz", systemImage: "arrow.up.forward.app") { open(file) }
            Button("Pobierz", systemImage: "arrow.down.circle") { Task { await download(file) } }
            if canManage {
                Button("Zmień nazwę", systemImage: "pencil") { renaming = FileRenameRequest(file: file) }
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { removing = file }
            }
        }
    }

    private func open(_ file: EquipmentFile) {
        if let url = URL(string: file.url) { NSWorkspace.shared.open(url) }
    }

    /// Pobranie do „Pobrane” (bez nadpisywania istniejących plików) i pokazanie w Finderze.
    private func download(_ file: EquipmentFile) async {
        guard let remote = URL(string: file.url) else { return }
        await state.withPending("Pobieranie…") {
            do {
                let (temporary, response) = try await URLSession.shared.download(from: remote)
                guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
                let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                let base = (file.name as NSString).deletingPathExtension, ext = (file.name as NSString).pathExtension
                var target = folder.appendingPathComponent(file.name)
                var copy = 1
                while FileManager.default.fileExists(atPath: target.path) {
                    target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                    copy += 1
                }
                try FileManager.default.moveItem(at: temporary, to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = "Nie udało się pobrać pliku."
            }
        }
    }
}

@MainActor struct FileRenameSheet: View {
    @ObservedObject var store: WarehouseStore
    let equipmentID: String
    let file: EquipmentFile
    @Environment(\.dismiss) private var dismiss
    @State private var base = ""
    @State private var saving = false

    private var ext: String {
        let value = (file.name as NSString).pathExtension
        return value.isEmpty ? "" : ".\(value)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Zmień nazwę pliku").font(.title2.weight(.light))
            HStack(spacing: 4) {
                TextField("Nazwa pliku", text: $base).textFieldStyle(.roundedBorder).onSubmit { Task { await save() } }
                if !ext.isEmpty { Text(ext).foregroundStyle(.secondary) }
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || base.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onAppear { base = ext.isEmpty ? file.name : String(file.name.dropLast(ext.count)) }
    }

    private func save() async {
        let name = base.trimmingCharacters(in: .whitespaces) + ext
        guard !base.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if name == file.name { dismiss(); return }
        saving = true
        defer { saving = false }
        let reply = await store.run("Zapisywanie…", "fileRename", ["id": .string(file.id), "name": .string(name)], success: "Nazwa pliku została zmieniona", reload: equipmentID)
        if reply != nil { dismiss() }
    }
}
