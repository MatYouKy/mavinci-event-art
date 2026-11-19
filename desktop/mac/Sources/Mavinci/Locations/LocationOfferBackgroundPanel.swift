import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: „Tło ofert” lokalizacji — 1:1 z `LocationOfferBackground` w CRM (karta lokalizacji i „Sale i przestrzenie hotelu” na karcie
// organizacji): zdjęcie miejsca na okładkę ofert wydarzeń w tej lokalizacji, także gdy klientem jest inna firma (impreza firmowa
// w hotelu — oferta dla firmy, w tle hotel). Nowe zdjęcie (`op=upload&kind=photo`, serwer dopisuje je do galerii obiektu) albo
// zdjęcie z galerii obiektu i sal; zapis `op=offerBackground`. Okładka oferty: własna grafika → tło miejsca (wybrane w ofercie,
// wydarzenia, z zapytania, organizacji klienta) → szablon. Po zmianie tła wcześniejsze PDF ofert z tego miejsca są nieaktualne.

@MainActor struct LocationOfferBackgroundPanel: View {
    @ObservedObject var store: LocationsStore
    let locationID: String
    let detail: CrmLocationDetail
    let canManage: Bool
    @EnvironmentObject private var state: Workspace
    @State private var saving = false

    /// `false` — baza bez migracji „Tła ofert” (sekcja tylko informuje).
    private var ready: Bool { detail.offerBackgroundReady != false }
    private var current: CrmLocationBackground? { detail.offerBackground }
    private var uploadTitle: String { current == nil ? "Wgraj zdjęcie…" : "Zmień zdjęcie…" }

    var body: some View {
        LocationPanel(title: "Tło ofert", symbol: "photo.on.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Zdjęcie miejsca na okładkę ofert wydarzeń w tej lokalizacji — także gdy klientem jest inna firma (np. impreza firmowa w hotelu: oferta dla firmy, w tle zdjęcie hotelu). Wgrane zdjęcie trafia też do galerii obiektu. Po zmianie tła wcześniej wygenerowane PDF ofert z tego miejsca są oznaczone jako nieaktualne. Oferta z własną grafiką hero zachowuje swoją, oferty sprzedawców hotelowych — okładkę z profilu sprzedawcy.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if !ready {
                    Label("Tło ofert wymaga aktualizacji bazy (migracja 20261119150000_location_offer_background.sql).", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                } else if let current {
                    preview(current)
                } else {
                    Text("Brak tła — okładka oferty użyje grafiki szablonu.").foregroundStyle(.secondary).padding(.vertical, 8)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } trailing: {
            if canManage && ready {
                actions
            }
        }
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

    /// Nowe zdjęcie: przesłanie do materiałów lokalizacji (jak zdjęcia obiektu), potem zapis jako tło.
    private func pick() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP]
        panel.message = "Tło ofert · JPG, PNG, WEBP · do 20 MB"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard ["jpg", "jpeg", "png", "webp"].contains(url.pathExtension.lowercased()) else {
            state.error = "Dodaj zdjęcie w formacie JPG, PNG lub WebP."
            return
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, size <= 20 * 1024 * 1024, url.lastPathComponent.count <= 255 else {
            state.error = "Zdjęcie musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków."
            return
        }
        // Wgrane zdjęcie trafia do galerii obiektu (najwyżej 30 materiałów) — sprawdzamy przed przesłaniem pliku.
        guard (detail.technical["assets"]?.array.count ?? 0) < 30 else {
            state.error = "Galeria obiektu ma już 30 materiałów — usuń któryś w „Informacjach technicznych obiektu” albo wybierz zdjęcie z galerii."
            return
        }
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
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
}
