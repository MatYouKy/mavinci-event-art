import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Nowy sprzęt — ta sama karta co edycja (`EquipmentCardView` bez identyfikatora). Zdjęcia i pliki wybrane przed utworzeniem
// czekają tutaj i są wysyłane zaraz po zapisie sprzętu tymi samymi operacjami co na karcie (galeria `equipment_images`, pliki
// `equipment_files`).

/// Karta do otwarcia po utworzeniu sprzętu: zakładka i tryb edycji (np. „Utwórz sprzęt i dodaj skład”).
struct EquipmentCardIntent: Equatable {
    var tab: EquipmentCardTab
    var edit: Bool
}

/// Podgląd zdjęcia z dysku Maca (plik wybrany w oknie albo przeciągnięty).
@MainActor struct PendingImageThumb: View {
    let url: URL
    @State private var image: NSImage?
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05))
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").font(.title2).foregroundStyle(.tertiary)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .task(id: url) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            image = NSImage(contentsOf: url)
        }
    }
}

/// Galeria nowego sprzętu — zdjęcia czekają na utworzenie sprzętu; pierwsze zostaje zdjęciem głównym.
@MainActor struct PendingGalleryCard: View {
    @Binding var urls: [URL]
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var dropping = false

    var body: some View {
        TeamCard(title: "Galeria zdjęć", action: ("Dodaj zdjęcia", { importing = true })) {
            if urls.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Brak zdjęć").foregroundStyle(.secondary)
                    Label("Obsługuje przeciąganie i upuszczanie", systemImage: "arrow.down.doc").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                Text("Zdjęcia zostaną przesłane zaraz po utworzeniu sprzętu — pierwsze będzie zdjęciem głównym.")
                    .font(.caption).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                        VStack(alignment: .leading, spacing: 6) {
                            PendingImageThumb(url: url).frame(height: 130)
                                .overlay(alignment: .topLeading) {
                                    if index == 0 {
                                        Text("Główne").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(theme.accent, in: Capsule()).foregroundStyle(.black).padding(6)
                                    }
                                }
                            HStack {
                                Text(url.lastPathComponent).font(.caption).lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: 4)
                                if index > 0 {
                                    Button { move(index) } label: { Image(systemName: "star") }.buttonStyle(.borderless).help("Ustaw jako główne")
                                }
                                Button(role: .destructive) { urls.remove(at: index) } label: { Image(systemName: "trash") }
                                    .buttonStyle(.borderless).help("Usuń z listy")
                            }
                        }
                    }
                }
            }
        }
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).fill(theme.accent.opacity(0.14))
                    .overlay { Label("Upuść zdjęcia tutaj", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
            }
        }
        .dropDestination(for: URL.self) { dropped, _ in
            let images = dropped.filter { $0.isFileURL && (UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) ?? false) }
            urls.append(contentsOf: images.filter { !urls.contains($0) })
            return !images.isEmpty
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let picked) = result { urls.append(contentsOf: picked.filter { !urls.contains($0) }) }
        }
    }

    private func move(_ index: Int) {
        let url = urls.remove(at: index)
        urls.insert(url, at: 0)
    }
}

/// Pliki nowego sprzętu (instrukcje, karty katalogowe) — przesyłane po utworzeniu sprzętu.
@MainActor struct PendingFilesCard: View {
    @Binding var urls: [URL]
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var dropping = false

    var body: some View {
        TeamCard(title: "Pliki sprzętu", action: ("Dodaj pliki", { importing = true })) {
            if urls.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "doc.text").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Brak plików").foregroundStyle(.secondary)
                    Text("Kliknij „Dodaj pliki” lub przeciągnij pliki tutaj").font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                Text("Pliki zostaną przesłane zaraz po utworzeniu sprzętu (do 50 MB każdy).").font(.caption).foregroundStyle(.secondary)
                VStack(spacing: 6) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                        HStack(spacing: 10) {
                            Image(systemName: "doc").foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(url.lastPathComponent).lineLimit(1).truncationMode(.middle)
                                Text(size(url)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(role: .destructive) { urls.remove(at: index) } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless).help("Usuń z listy")
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).fill(theme.accent.opacity(0.14))
                    .overlay { Label("Upuść pliki tutaj", systemImage: "square.and.arrow.down").font(.title3).foregroundStyle(theme.accent) }
            }
        }
        .dropDestination(for: URL.self) { dropped, _ in
            let files = dropped.filter(\.isFileURL)
            urls.append(contentsOf: files.filter { !urls.contains($0) })
            return !files.isEmpty
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let picked) = result { urls.append(contentsOf: picked.filter { !urls.contains($0) }) }
        }
    }

    private func size(_ url: URL) -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
