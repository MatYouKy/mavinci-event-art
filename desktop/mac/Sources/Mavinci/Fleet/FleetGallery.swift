import SwiftUI
import UniformTypeIdentifiers

// MARK: Galeria pojazdu (`VehicleGallery`): siatka zdjęć, „Główne”, przesyłanie (też przeciąganiem), ustawianie głównego,
// zmiana tytułu, usuwanie i podgląd z przewijaniem.

@MainActor struct FleetGalleryTab: View {
    @ObservedObject var store: FleetStore
    let detail: FleetVehicleDetail
    @Environment(\.crmTheme) private var theme
    @State private var importing = false
    @State private var dropping = false
    @State private var preview: FleetImage?
    @State private var removing: FleetImage?
    @State private var renaming: FleetImage?
    @State private var title = ""

    private var canManage: Bool { detail.access.canManage }
    private var vehicleID: String { detail.vehicle.id }
    private var addAction: (String, () -> Void)? { canManage ? ("Dodaj zdjęcia", { importing = true }) : nil }

    var body: some View {
        TeamCard(title: "Galeria zdjęć", action: addAction) {
            if detail.images.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Brak zdjęć").foregroundStyle(.secondary)
                    if canManage {
                        Text("Kliknij „Dodaj zdjęcia” lub przeciągnij pliki tutaj").font(.callout).foregroundStyle(.secondary)
                        Label("Obsługuje przeciąganie i upuszczanie", systemImage: "arrow.down.doc").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
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
            Task { await store.uploadImages(files, vehicleID: vehicleID) }
            return !files.isEmpty
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await store.uploadImages(urls, vehicleID: vehicleID) } }
        }
        .sheet(item: $preview) { image in
            FleetImagePreview(images: detail.images, startID: image.id)
        }
        .confirmationDialog("Czy na pewno chcesz usunąć to zdjęcie?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                guard let image = removing else { return }
                Task { await store.run("Usuwanie zdjęcia…", "imageDelete", ["id": .string(image.id)], reload: vehicleID) }
            }
            Button("Anuluj", role: .cancel) {}
        }
        .alert("Tytuł zdjęcia", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Tytuł", text: $title)
            Button("Zapisz") {
                guard let image = renaming else { return }
                let value = title
                Task { await store.run("Zapisywanie…", "imageTitle", ["id": .string(image.id), "title": .string(value)], reload: vehicleID) }
            }
            Button("Anuluj", role: .cancel) {}
        }
    }

    private func tile(_ image: FleetImage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topLeading) {
                CachedRemoteImage(url: image.url, crop: nil)
                    .frame(height: 140).frame(maxWidth: .infinity)
                    .background(Color.primary.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                    .onTapGesture { preview = image }
                if image.primary {
                    Label("Główne", systemImage: "star.fill").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(theme.accent, in: Capsule()).foregroundStyle(.black).padding(6)
                }
            }
            HStack(spacing: 6) {
                Text(image.title.nonEmpty ?? "Bez tytułu").font(.caption).lineLimit(1).truncationMode(.middle).foregroundStyle(image.title.isEmpty ? .secondary : .primary)
                Spacer(minLength: 4)
                if canManage {
                    if !image.primary {
                        Button { Task { await store.run("Ustawianie zdjęcia głównego…", "imagePrimary", ["vehicleId": .string(vehicleID), "id": .string(image.id)], reload: vehicleID) } } label: {
                            Image(systemName: "star")
                        }
                        .buttonStyle(.borderless).help("Ustaw jako główne")
                    }
                    Button { title = image.title; renaming = image } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Zmień tytuł")
                    Button(role: .destructive) { removing = image } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
                }
            }
        }
    }
}

/// Podgląd zdjęć pojazdu z przewijaniem (strzałki i klawiatura).
@MainActor struct FleetImagePreview: View {
    let images: [FleetImage]
    let startID: String
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(images.indices.contains(index) ? (images[index].title.nonEmpty ?? "Zdjęcie") : "Zdjęcie").font(.headline)
                Spacer()
                Text("\(index + 1) / \(images.count)").foregroundStyle(.secondary).monospacedDigit()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(14)
            ZStack {
                Color.black
                if images.indices.contains(index) {
                    CachedRemoteImage(url: images[index].url, crop: AvatarCrop(x: 0, y: 0, scale: 1, fit: "contain"))
                }
                HStack {
                    Button { step(-1) } label: { Image(systemName: "chevron.left").font(.title2).padding(10).background(.black.opacity(0.5), in: Circle()) }
                        .buttonStyle(.plain).foregroundStyle(.white).keyboardShortcut(.leftArrow, modifiers: [])
                    Spacer()
                    Button { step(1) } label: { Image(systemName: "chevron.right").font(.title2).padding(10).background(.black.opacity(0.5), in: Circle()) }
                        .buttonStyle(.plain).foregroundStyle(.white).keyboardShortcut(.rightArrow, modifiers: [])
                }
                .padding(.horizontal, 12)
                .opacity(images.count > 1 ? 1 : 0)
            }
        }
        .frame(width: 900, height: 680)
        .onAppear { index = images.firstIndex { $0.id == startID } ?? 0 }
    }

    private func step(_ delta: Int) {
        guard !images.isEmpty else { return }
        index = (index + delta + images.count) % images.count
    }
}
