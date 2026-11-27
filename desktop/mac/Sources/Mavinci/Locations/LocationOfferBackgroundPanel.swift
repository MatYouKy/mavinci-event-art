import SwiftUI
import AppKit
import ImageIO
import UniformTypeIdentifiers

// MARK: „Tło ofert” lokalizacji — 1:1 z `LocationOfferBackground` w CRM (karta lokalizacji i „Sale i przestrzenie hotelu” na karcie
// organizacji): zdjęcie miejsca na okładkę ofert wydarzeń w tej lokalizacji, także gdy klientem jest inna firma (impreza firmowa
// w hotelu — oferta dla firmy, w tle hotel). Nowe zdjęcie (`op=upload&kind=photo`, serwer dopisuje je do galerii obiektu) albo
// zdjęcie z galerii obiektu i sal; zapis `op=offerBackground`. Okładka oferty: własna grafika → tło miejsca (wybrane w ofercie,
// wydarzenia, z zapytania, organizacji klienta) → szablon. Po zmianie tła wcześniejsze PDF ofert z tego miejsca są nieaktualne.
// Zdjęcie można też przeciągnąć na sekcję (Finder, Zdjęcia, przeglądarka, zrzut ekranu) — nad sekcją pojawia się strefa
// upuszczania; obraz w innym formacie (HEIC, TIFF) jest zamieniany na JPG.

@MainActor struct LocationOfferBackgroundPanel: View {
    @ObservedObject var store: LocationsStore
    let locationID: String
    let detail: CrmLocationDetail
    let canManage: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var saving = false
    /// Plik przeciągany nad sekcją — strefa upuszczania.
    @State private var dropTargeted = false

    /// `false` — baza bez migracji „Tła ofert” (sekcja tylko informuje).
    private var ready: Bool { detail.offerBackgroundReady != false }
    private var current: CrmLocationBackground? { detail.offerBackground }
    private var uploadTitle: String { current == nil ? "Wgraj zdjęcie…" : "Zmień zdjęcie…" }
    /// Sekcja przyjmuje przeciągnięte zdjęcie (uprawnienia, baza po migracji, nic się nie zapisuje).
    private var acceptsDrop: Bool { canManage && ready && !saving }

    var body: some View {
        LocationPanel(title: "Tło ofert", symbol: "photo.on.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Zdjęcie miejsca na okładkę ofert eventów w tej lokalizacji — także gdy klientem jest inna firma (np. impreza firmowa w hotelu: oferta dla firmy, w tle zdjęcie hotelu). Wgrane zdjęcie trafia też do galerii obiektu. Po zmianie tła wcześniej wygenerowane PDF ofert z tego miejsca są oznaczone jako nieaktualne. Oferta z własną grafiką hero zachowuje swoją, oferty sprzedawców hotelowych — okładkę z profilu sprzedawcy.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if !ready {
                    Label("Tło ofert wymaga aktualizacji bazy (migracja 20261119150000_location_offer_background.sql).", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                } else if let current {
                    preview(current)
                    if canManage {
                        Text("Przeciągnij nowe zdjęcie na sekcję, aby zmienić tło.").font(.caption).foregroundStyle(.tertiary)
                    }
                } else {
                    emptyState
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } trailing: {
            if canManage && ready {
                actions
            }
        }
        .overlay {
            if dropTargeted { dropZone }
        }
        .animation(.easeOut(duration: 0.15), value: dropTargeted)
        .onDrop(of: acceptsDrop ? PortfolioDrop.types : [], isTargeted: $dropTargeted) { providers in drop(providers) }
    }

    /// Brak tła — miejsce na zdjęcie: kliknięcie wybiera plik, można też przeciągnąć zdjęcie na sekcję.
    private var emptyState: some View {
        Button { pick() } label: {
            VStack(spacing: 6) {
                Image(systemName: "photo.badge.plus").font(.system(size: 26, weight: .light)).foregroundStyle(theme.accent.opacity(0.7))
                Text("Brak tła — okładka oferty użyje grafiki szablonu.").foregroundStyle(.secondary)
                if canManage && ready {
                    Text("Przeciągnij tu zdjęcie z Findera, Zdjęć albo przeglądarki lub kliknij, aby wybrać plik · JPG, PNG, WEBP · do 20 MB")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22).padding(.horizontal, 12)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(theme.accent.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canManage || saving)
        .help(canManage ? "Wybierz zdjęcie albo przeciągnij je na sekcję" : "Tło ofert ustawia osoba z uprawnieniem do edycji lokalizacji")
    }

    /// Strefa upuszczania nad całą sekcją, gdy przeciągany jest plik.
    private var dropZone: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(theme.accent.opacity(0.10)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(theme.accent, style: StrokeStyle(lineWidth: 2, dash: [8, 5])))
            .overlay {
                VStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.down").font(.system(size: 30, weight: .light)).foregroundStyle(theme.accent)
                    Text(current == nil ? "Upuść zdjęcie — tło ofert tej lokalizacji" : "Upuść zdjęcie, aby zmienić tło ofert").font(.headline)
                    Text("JPG, PNG lub WEBP (HEIC i inne zamienimy na JPG) · do 20 MB · trafi też do galerii obiektu")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding(16)
            }
            .allowsHitTesting(false)
            .transition(.opacity)
            .accessibilityElement(children: .combine)
    }

    private func preview(_ background: CrmLocationBackground) -> some View {
        Color.primary.opacity(0.05)
            .frame(height: 220).frame(maxWidth: .infinity)
            .overlay {
                if let url = background.url.flatMap({ URL(string: $0) }) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else if phase.error != nil {
                            Text("Nie udało się wczytać podglądu zdjęcia.").foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                        }
                    }
                } else {
                    Text("Nie udało się wczytać podglądu zdjęcia.").foregroundStyle(.secondary)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button(uploadTitle, systemImage: "square.and.arrow.up") { pick() }
            let photos = detail.galleryPhotos
            if !photos.isEmpty {
                Menu {
                    ForEach(photos) { photo in
                        Button {
                            save(photo.asset.path)
                        } label: {
                            if photo.asset.path == current?.path {
                                Label("\(photo.place) · \(photo.asset.name)", systemImage: "checkmark")
                            } else {
                                Text("\(photo.place) · \(photo.asset.name)")
                            }
                        }
                    }
                } label: {
                    Label("Wybierz z galerii", systemImage: "photo.stack")
                }
                .fixedSize()
                .help("Zdjęcia dodane w informacjach technicznych obiektu i sal")
            }
            if current != nil {
                Button("Usuń tło", systemImage: "trash") { save(nil) }
                    .help("Okładka ofert wróci do grafiki szablonu; zdjęcie zostaje w galerii")
            }
        }
        .controlSize(.small)
        .disabled(saving)
    }

    /// Zdjęcie z galerii obiektu albo `nil` — usunięcie tła.
    private func save(_ path: String?) {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            if let problem = await state.prepareWrite() { state.error = problem; return }
            let value: JSONValue = path.map { JSONValue.string($0) } ?? .null
            let pending: String = path == nil ? "Usuwanie tła ofert…" : "Zapisywanie tła ofert…"
            await store.run(pending, "offerBackground", ["id": .string(locationID), "path": value], reload: locationID)
        }
    }

    /// Nowe zdjęcie z okna wyboru pliku.
    private func pick() {
        guard canManage, ready, !saving else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP]
        panel.message = "Tło ofert · JPG, PNG, WEBP · do 20 MB"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        upload(url)
    }

    /// Zdjęcie przeciągnięte na sekcję: pierwszy obraz z Findera, Zdjęć, przeglądarki albo zrzutu ekranu.
    private func drop(_ providers: [NSItemProvider]) -> Bool {
        guard acceptsDrop, PortfolioDrop.external(providers) else { return false }
        Task {
            var dropped: URL?
            for provider in providers {
                if let url = await PortfolioDrop.file(provider) { dropped = url; break }
            }
            guard let dropped else {
                state.error = "Nie udało się odczytać przeciągniętego zdjęcia. Przeciągnij plik JPG, PNG lub WEBP."
                return
            }
            let prepared = await Task.detached(priority: .userInitiated) { LocationOfferBackgroundPanel.prepared(dropped) }.value
            guard let prepared else {
                LocationOfferBackgroundPanel.cleanup([dropped])
                state.error = "Przeciągnij zdjęcie — JPG, PNG, WEBP (albo HEIC, TIFF — zamienimy je na JPG)."
                return
            }
            upload(prepared, temporary: [dropped, prepared])
        }
        return true
    }

    /// Nowe zdjęcie: przesłanie do materiałów lokalizacji (jak zdjęcia obiektu), potem zapis jako tło. `temporary` — kopie
    /// z przeciągania usuwane po wysłaniu (pliki z Findera zostają).
    private func upload(_ url: URL, temporary: [URL] = []) {
        guard ["jpg", "jpeg", "png", "webp"].contains(url.pathExtension.lowercased()) else {
            LocationOfferBackgroundPanel.cleanup(temporary)
            state.error = "Dodaj zdjęcie w formacie JPG, PNG lub WebP."
            return
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, size <= 20 * 1024 * 1024, url.lastPathComponent.count <= 255 else {
            LocationOfferBackgroundPanel.cleanup(temporary)
            state.error = "Zdjęcie musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków."
            return
        }
        // Wgrane zdjęcie trafia do galerii obiektu (najwyżej 30 materiałów) — sprawdzamy przed przesłaniem pliku.
        guard (detail.technical["assets"]?.array.count ?? 0) < 30 else {
            LocationOfferBackgroundPanel.cleanup(temporary)
            state.error = "Galeria obiektu ma już 30 materiałów — usuń któryś w „Informacjach technicznych obiektu” albo wybierz zdjęcie z galerii."
            return
        }
        guard !saving else { LocationOfferBackgroundPanel.cleanup(temporary); return }
        saving = true
        Task {
            defer {
                saving = false
                LocationOfferBackgroundPanel.cleanup(temporary)
            }
            if let problem = await state.prepareWrite() { state.error = problem; return }
            do {
                let asset = try await state.withPending("Przesyłanie zdjęcia tła…") {
                    try await store.uploadMaterial(locationID: locationID, kind: "photo", file: url)
                }
                await store.run("Zapisywanie tła ofert…", "offerBackground", ["id": .string(locationID), "path": .string(asset.path), "name": .string(asset.name)], reload: locationID)
            } catch {
                state.error = store.failureText(error, "Nie udało się przesłać zdjęcia.")
            }
        }
    }

    /// Przeciągnięty obraz → plik do wysłania. JPG, PNG, WEBP — bez zmian; inny obraz (HEIC ze Zdjęć, TIFF z przeglądarki) — JPG
    /// z zachowaniem orientacji, najwyżej 4096 px. Kopie z innych aplikacji (katalog przeciągania, nazwy losowe) dostają nazwę
    /// „Tło ofert”, plik z Findera zamieniony na JPG — swoją; tak zdjęcie nazywa się w galerii obiektu. `nil` — to nie jest obraz.
    nonisolated private static func prepared(_ url: URL) -> URL? {
        let root = PortfolioDrop.folder().standardizedFileURL.path
        let temporary = url.standardizedFileURL.path.hasPrefix(root + "/")
        let ext = url.pathExtension.lowercased()
        let own = url.deletingPathExtension().lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = temporary || own.isEmpty ? "Tło ofert" : own
        func named(_ ext: String) -> URL {
            let folder = PortfolioDrop.folder().appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            return folder.appendingPathComponent(base).appendingPathExtension(ext)
        }
        if ["jpg", "jpeg", "png", "webp"].contains(ext) {
            guard temporary else { return url }
            let target = named(ext == "jpeg" ? "jpg" : ext)
            return (try? FileManager.default.copyItem(at: url, to: target)) != nil ? target : url
        }
        guard let type = UTType(filenameExtension: ext), type.conforms(to: .image),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 4096,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        let target = named("jpg")
        return (try? (output as Data).write(to: target)) != nil ? target : nil
    }

    /// Usuwa kopie z przeciągania (i ich katalogi) — tylko w katalogu tymczasowym przeciągania; pliki z Findera zostają.
    nonisolated private static func cleanup(_ urls: [URL]) {
        let root = PortfolioDrop.folder().standardizedFileURL.path
        let manager = FileManager.default
        for url in urls {
            let file = url.standardizedFileURL
            guard file.path.hasPrefix(root + "/") else { continue }
            try? manager.removeItem(at: file)
            let parent = file.deletingLastPathComponent()
            if parent.path != root, (try? manager.contentsOfDirectory(atPath: parent.path))?.isEmpty == true {
                try? manager.removeItem(at: parent)
            }
        }
    }
}
