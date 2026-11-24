import SwiftUI

// MARK: Wybór zdjęcia z Dysku (Materiały) — jak `MaterialPhotoPicker.tsx` w CRM
//
// Np. zdjęcie produktu do oferty: marka, foldery jak w Dysku (start — „Zdjęcia”), wyszukiwanie po nazwie, opisie i tagach,
// miniatury; tylko zdjęcia JPG, PNG i WebP. Klik zaznacza, dwuklik albo „Użyj zdjęcia” — wybiera. Zwraca plik i jego miejsce
// („Marka / folder / …”). Dane z `/materials` (op=home, list, search) — uprawnienia jak w Dysku (RLS).

struct PickedMaterialPhoto: Hashable {
    let file: MaterialFile
    /// „Mavinci / Zdjęcia / ER - Sylwester”.
    let place: String
}

@MainActor struct MaterialPhotoPicker: View {
    let title: String
    let onPick: (PickedMaterialPhoto) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var home: MaterialsHome?
    @State private var folderID: String?
    @State private var listing: MaterialsListing?
    @State private var query = ""
    @State private var hits: [MaterialSearchHit]?
    @State private var selected: PickedMaterialPhoto?
    @State private var loading = false
    @State private var problem: String?

    private static let page = 120
    private static let photoMime: Set<String> = ["image/jpeg", "image/png", "image/webp"]
    private static func isPhoto(_ file: MaterialFile) -> Bool { file.kind == "image" && photoMime.contains(file.mime.lowercased()) }

    private var listKey: String { "\(home?.company.id ?? "")|\(folderID ?? "")" }

    private var photos: [PickedMaterialPhoto] {
        if let hits {
            return hits.map { PickedMaterialPhoto(file: $0.file, place: ([$0.companyName] + $0.path.map(\.name)).joined(separator: " / ")) }
        }
        let place = ([home?.company.name ?? "Marka"] + (listing?.path ?? []).map(\.name)).joined(separator: " / ")
        return (listing?.files ?? []).filter(Self.isPhoto).map { PickedMaterialPhoto(file: $0, place: place) }
    }

    private var folders: [MaterialFolder] { hits == nil ? listing?.folders ?? [] : [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if hits == nil, home != nil { breadcrumbs.padding(.horizontal, 16).padding(.top, 10) }
            content
            Divider()
            footer
        }
        .frame(width: 820, height: 640)
        .background(theme.page)
        .task { await openCompany(nil) }
        .task(id: listKey) { await loadList() }
        .task(id: query) { await search() }
    }

    // MARK: Nagłówek, ścieżka, stopka

    private var header: some View {
        HStack(spacing: 10) {
            Text(title).font(.title3.weight(.semibold))
            Spacer()
            if loading { ProgressView().controlSize(.small) }
            if let home, home.companies.count > 1 {
                Picker("Marka", selection: Binding(get: { home.company.id }, set: { id in Task { await openCompany(id) } })) {
                    ForEach(home.companies) { company in Text(company.name).tag(company.id) }
                }
                .labelsHidden()
                .frame(width: 170)
            }
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("", text: $query, prompt: Text("Szukaj zdjęcia w Dysku")).textFieldStyle(.plain)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.06)))
            .frame(width: 240)
        }
        .padding(16)
    }

    private var breadcrumbs: some View {
        HStack(spacing: 4) {
            Button(home?.company.name ?? "Marka") { folderID = nil }.buttonStyle(.plain).foregroundStyle(theme.accent)
            ForEach(listing?.path ?? []) { folder in
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                Button(folder.name) { folderID = folder.id }.buttonStyle(.plain).foregroundStyle(theme.accent).lineLimit(1)
            }
        }
        .font(.callout)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Text(selected.map { "\($0.place) / \($0.file.name)" } ?? "Wybierz zdjęcie — oryginał zostaje w Dysku, produkt dostaje lekką wersję WebP.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Użyj zdjęcia") { if let selected { pick(selected) } }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(selected == nil)
        }
        .padding(16)
    }

    // MARK: Foldery i zdjęcia

    @ViewBuilder private var content: some View {
        if let problem {
            ContentUnavailableView("Dysk niedostępny", systemImage: "externaldrive.badge.exclamationmark", description: Text(problem))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !loading && folders.isEmpty && photos.isEmpty {
            ContentUnavailableView(hits == nil ? "Brak zdjęć w tym folderze" : "Nie znaleziono zdjęć", systemImage: "photo.on.rectangle",
                                   description: Text("Zdjęcia JPG, PNG i WebP z Dysku (Materiały)."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 12)], alignment: .leading, spacing: 12) {
                    ForEach(folders) { folder in folderTile(folder) }
                    ForEach(photos, id: \.file.id) { photo in photoTile(photo) }
                }
                .padding(16)
                if hits == nil, let listing, listing.files.count < listing.total {
                    Button("Pokaż kolejne pliki (\(listing.total - listing.files.count))") { Task { await loadMore() } }
                        .disabled(loading)
                        .padding(.bottom, 16)
                }
            }
        }
    }

    private func folderTile(_ folder: MaterialFolder) -> some View {
        Button { folderID = folder.id } label: {
            VStack(spacing: 6) {
                Image(systemName: MaterialsText.folderSymbol(folder) == "folder" ? "folder.fill" : MaterialsText.folderSymbol(folder))
                    .resizable().scaledToFit().padding(28).foregroundStyle(theme.accent).frame(width: 116, height: 116)
                Text(folder.name).font(.caption).lineLimit(2).multilineTextAlignment(.center).frame(width: 120)
            }
            .padding(6)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func photoTile(_ photo: PickedMaterialPhoto) -> some View {
        let active = selected?.file.id == photo.file.id
        return VStack(spacing: 6) {
            MaterialThumb(file: photo.file, side: 116)
            Text(photo.file.name).font(.caption).lineLimit(2).multilineTextAlignment(.center).frame(width: 120)
        }
        .padding(6)
        .background(active ? theme.accent.opacity(0.22) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(active ? theme.accent : Color.clear, lineWidth: 2))
        .contentShape(Rectangle())
        .help("\(photo.place) / \(photo.file.name)")
        .onTapGesture(count: 2) { pick(photo) }
        .simultaneousGesture(TapGesture().onEnded { selected = photo })
    }

    private func pick(_ photo: PickedMaterialPhoto) {
        onPick(photo)
        dismiss()
    }

    // MARK: Dane

    private func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return fallback
    }

    /// Marka (domyślnie pierwsza z dostępem) i start w folderze „Zdjęcia”, gdy jest.
    private func openCompany(_ id: String?) async {
        guard let api = state.nativeAPI() else { problem = "Brak połączenia z serwerem CRM."; return }
        loading = true
        defer { loading = false }
        var params = ["op": "home"]
        if let id { params["company"] = id }
        do {
            let next = try JSONDecoder().decode(MaterialsHome.self, from: try await api.get("/materials", query: params))
            home = next
            listing = nil
            selected = nil
            folderID = next.folders.first { $0.systemKey == "photos" && $0.parentId == nil }?.id
            problem = nil
        } catch {
            problem = message(error, "Nie udało się otworzyć Dysku.")
        }
    }

    private func listQuery(offset: Int) -> [String: String]? {
        guard let home else { return nil }
        var params = ["op": "list", "company": home.company.id, "sort": "date", "limit": String(Self.page), "offset": String(offset)]
        if let folderID { params["folder"] = folderID }
        return params
    }

    private func loadList() async {
        guard let params = listQuery(offset: 0), let api = state.nativeAPI() else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try JSONDecoder().decode(MaterialsListing.self, from: try await api.get("/materials", query: params))
            guard !Task.isCancelled else { return }
            listing = next
            problem = nil
        } catch {
            if !Task.isCancelled { problem = message(error, "Nie udało się pobrać folderu.") }
        }
    }

    private func loadMore() async {
        guard let current = listing, let params = listQuery(offset: current.files.count), let api = state.nativeAPI() else { return }
        loading = true
        defer { loading = false }
        do {
            var next = try JSONDecoder().decode(MaterialsListing.self, from: try await api.get("/materials", query: params))
            let known = Set(current.files.map(\.id))
            next.files = current.files + next.files.filter { !known.contains($0.id) }
            listing = next
        } catch {
            state.error = message(error, "Nie udało się pobrać kolejnych plików.")
        }
    }

    /// Wyszukiwanie w marce (od 2 znaków, po chwili przerwy w pisaniu).
    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2, let home, let api = state.nativeAPI() else { hits = nil; return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        loading = true
        defer { loading = false }
        do {
            let reply = try JSONDecoder().decode(MaterialsSearchReply.self,
                                                 from: try await api.get("/materials", query: ["op": "search", "q": text, "company": home.company.id]))
            guard !Task.isCancelled else { return }
            hits = reply.materials.filter { Self.isPhoto($0.file) }
            problem = nil
        } catch {
            if !Task.isCancelled { problem = message(error, "Nie udało się przeszukać Dysku.") }
        }
    }
}
