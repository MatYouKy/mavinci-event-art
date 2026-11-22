import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Strefa sprzedawcy → „Prezentacje” — okna: wybór zdjęć (baza zdjęć — Materiały i albumy, odnośniki; produkty i realizacje
// bez kopiowania; social media — kopia WebP), wybór produktów i realizacji, dział (nazwa, opis, ikona, okładka — od razu przy
// tworzeniu, z dysku, przeciągnięciem albo z bazy — widoczność) i nowa karta (z produktu albo pusta). Te same źródła i reguły co w CRM.

/// Wybrana pozycja listy (produkt albo realizacja).
struct ShowcaseListPick: Hashable {
    let id: String
    let title: String
    let thumb: String?
}

/// Pozycja zaznaczona w oknie wyboru (zostaje przy zmianie zakładki); `ready` — zdjęcie już wgrane z dysku.
private struct ShowcasePickEntry: Hashable {
    let key: String
    let source: ShowcasePhotoSource
    let photo: ShowcasePickPhoto
    var ready: ShowcasePhotoReply?
}

/// Produkt albo realizacja na liście (miniatura zdjęcia głównego).
private struct ShowcaseOwnerTile: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    let thumb: String?
    let inCard: Bool
}

/// Przeciągnięcie kafelka bazy zdjęć na album (tekst z prefiksem, tylko w aplikacji).
private enum ShowcasePickerDrag {
    static let prefix = "mavinci-showcase-basefile:"
}

/// Wybór zdjęć do prezentacji — jak w CRM: baza zdjęć (Materiały i albumy; „Wgraj z dysku” i przeciąganie z Findera zapisują
/// w Materiałach → Zdjęcia, bez duplikatów; karta trzyma odnośnik), produkty i realizacje (lista z miniaturą, potem zdjęcia —
/// bez kopiowania), social media (kopia, gdy jest już karta albo dział). Kafelek bazy przeciągnięty na album — odnośnik w albumie.
@MainActor struct ShowcasePhotoPickerSheet: View {
    @ObservedObject var store: ShowcaseStore
    let target: ShowcaseUploadTarget
    /// Produkty karty — pierwsze na liście „Produkty”.
    let products: [(String, String)]
    let single: Bool
    let onPick: ([ShowcasePhotoReply]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var source: ShowcasePhotoSource = .material
    @State private var query = ""
    @State private var base: ShowcasePhotoBaseReply?
    @State private var album: String?
    @State private var owners: [ShowcaseOwnerTile] = []
    @State private var owner: ShowcaseListPick?
    @State private var photos: [ShowcasePickPhoto] = []
    @State private var hasMore = false
    @State private var problem: String?
    @State private var loading = false
    @State private var selected: [ShowcasePickEntry] = []
    @State private var dropping = false
    @State private var albumDrop: String?
    @State private var newAlbum: String?

    init(store: ShowcaseStore, target: ShowcaseUploadTarget, products: [(String, String)], single: Bool, onPick: @escaping ([ShowcasePhotoReply]) -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.target = target
        self.products = products
        self.single = single
        self.onPick = onPick
    }

    private var sources: [ShowcasePhotoSource] { ShowcasePhotoSource.allCases.filter { $0 != .social || target.canCopy } }
    private var albums: [ShowcaseAlbumOption] { base?.albums ?? [] }
    private var canUpload: Bool { base?.base != nil || target.canCopy }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text(single ? "Wybierz zdjęcie" : "Dodaj zdjęcia").font(.title3.weight(.semibold))
                Spacer()
                Picker("Źródło", selection: $source) {
                    ForEach(sources) { item in Label(item.label, systemImage: item.symbol).tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: CGFloat(sources.count) * 130)
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            Divider()
            HStack(spacing: 0) {
                if source == .material { sidebar.frame(width: 240); Divider() }
                VStack(alignment: .leading, spacing: 10) {
                    toolbar
                    ZStack {
                        ScrollView {
                            VStack(spacing: 8) {
                                if source.needsOwner && owner == nil { ownerGrid } else { photoGrid }
                                if hasMore && !(source.needsOwner && owner == nil) {
                                    Button("Wczytaj więcej") { Task { await loadMore() } }.disabled(loading).padding(.vertical, 10)
                                }
                            }
                        }
                        if loading { ProgressView("Wczytuję…") }
                        else if let problem, photos.isEmpty && owners.isEmpty && readyEntries.isEmpty {
                            Text(problem).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .padding(16)
            }
            Divider()
            HStack(spacing: 10) {
                Text(footerText).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                Spacer()
                if !selected.isEmpty && !single { Button("Wyczyść zaznaczenie") { selected = [] }.buttonStyle(.link) }
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(single ? "Wybierz" : "Dodaj (\(selected.count))") { confirm() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected.isEmpty)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .frame(width: 1180, height: 780)
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.45))
                    .overlay(Text(canUpload ? (base?.base.map { "Upuść, aby wgrać do bazy zdjęć (Materiały → \($0.folderName))" } ?? "Upuść, aby dodać zdjęcia")
                                  : "Wgrywanie wymaga uprawnienia „Materiały — zarządzanie”")
                        .font(.headline).foregroundStyle(.white).padding(16).background(RoundedRectangle(cornerRadius: 10).fill(theme.accent.opacity(0.85))))
                    .allowsHitTesting(false)
            }
        }
        .onDrop(of: PortfolioDrop.types, isTargeted: $dropping) { providers in
            guard PortfolioDrop.external(providers) else { return false }
            Task {
                let urls = await PortfolioDrop.files(providers)
                await upload(urls)
                PortfolioDrop.cleanup(urls)
            }
            return true
        }
        .onChange(of: source) { _, _ in
            query = ""
            owner = nil
            photos = []
            problem = nil
            hasMore = false
        }
        .task { await loadBase() }
        .task(id: "owners|\(source.rawValue)|\(query)|\(owner?.id ?? "")") { await loadOwners() }
        .task(id: "photos|\(source.rawValue)|\(owner?.id ?? "")|\(album ?? "")|\(source.needsOwner ? "" : query)") { await loadPhotos() }
    }

    private var readyEntries: [ShowcasePickEntry] { selected.filter { $0.ready != nil } }

    private var footerText: String {
        switch source {
        case .material:
            if let place = base?.base { return "Zdjęcia z dysku trafiają do bazy: Materiały → \(place.companyName) → \(place.folderName). Karta trzyma odnośnik, bez kopii." }
            return "Baza zdjęć — Materiały i albumy."
        case .social: return "Zdjęcie z biblioteki social media zapisze się w prezentacji."
        case .product, .site: return "Zdjęcia produktów i realizacji pokazujemy bez kopiowania."
        }
    }

    // MARK: Pasek boczny bazy: wszystkie zdjęcia, albumy (upuszczanie kafelków), nowy album

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                sidebarRow(id: nil, title: "Wszystkie zdjęcia", detail: nil, thumb: nil)
                HStack {
                    Text("ALBUMY").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    if base?.base != nil {
                        Button { newAlbum = newAlbum == nil ? "" : nil } label: { Image(systemName: "plus") }
                            .buttonStyle(.borderless).help("Nowy album (z zaznaczonych zdjęć)")
                    }
                }
                .padding(.top, 10).padding(.horizontal, 6)
                if let name = newAlbum {
                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Nazwa albumu", text: Binding(get: { name }, set: { newAlbum = String($0.prefix(120)) }))
                            .textFieldStyle(.roundedBorder).onSubmit { Task { await createAlbum() } }
                        Button(materialIDs.isEmpty ? "Utwórz album" : "Utwórz z zaznaczonych (\(materialIDs.count))") { Task { await createAlbum() } }
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.horizontal, 6)
                }
                ForEach(albums) { item in
                    sidebarRow(id: item.id, title: item.name,
                               detail: "\(item.count) zdj." + (albums.contains { $0.companyId != item.companyId } ? " · \(item.companyName)" : ""),
                               thumb: item.thumbnailUrl)
                        .background(RoundedRectangle(cornerRadius: 7).stroke(albumDrop == item.id ? theme.accent : Color.clear, lineWidth: 2))
                        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(get: { albumDrop == item.id }, set: { albumDrop = $0 ? item.id : (albumDrop == item.id ? nil : albumDrop) })) { providers in
                            ShowcaseDrag.read(providers) { text in
                                guard let id = ShowcaseDrag.value(text, ShowcasePickerDrag.prefix) else { return }
                                let many = selected.contains { $0.source == .material && $0.photo.id == id } ? materialIDs : [id]
                                Task {
                                    if await store.addToAlbum(item, fileIDs: many) != nil { await loadBase() }
                                }
                            }
                            return true
                        }
                }
                if base?.canView == true && albums.isEmpty {
                    Text("Brak albumów. Utwórz album („+”) i przeciągaj na niego zdjęcia — trafią tam jako odnośniki, bez kopii.")
                        .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 6)
                }
                if let base, !base.canView, let text = base.problem {
                    Text(text).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 6)
                }
            }
            .padding(10)
        }
    }

    private func sidebarRow(id: String?, title: String, detail: String?, thumb: String?) -> some View {
        Button { album = id; query = "" } label: {
            HStack(spacing: 8) {
                if id == nil {
                    Image(systemName: "photo.stack").frame(width: 30, height: 30)
                } else {
                    Color.clear.frame(width: 30, height: 30)
                        .overlay { if let thumb { SocialImageView(url: thumb) } else { Image(systemName: "rectangle.stack").foregroundStyle(theme.accent.opacity(0.6)) } }
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).lineLimit(1)
                    if let detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 7).fill(album == id ? theme.accent.opacity(0.18) : Color.clear))
            .foregroundStyle(album == id ? theme.accent : Color.primary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Pasek: powrót z produktu / realizacji, wyszukiwanie, wgrywanie

    private var toolbar: some View {
        HStack(spacing: 8) {
            if let owner {
                Button { self.owner = nil; photos = [] } label: { Label(source == .product ? "Produkty" : "Realizacje", systemImage: "chevron.left") }
                Text(owner.title).font(.headline).foregroundStyle(theme.accent).lineLimit(1)
            } else {
                TextField(placeholder, text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 420)
            }
            Spacer()
            if source == .material {
                Button { chooseFiles() } label: { Label("Wgraj z dysku", systemImage: "square.and.arrow.up") }
                    .disabled(!canUpload)
                    .help(base?.base.map { "Zdjęcia trafią do: Materiały → \($0.companyName) → \($0.folderName)" } ?? (target.canCopy ? "Bez uprawnień do Materiałów zdjęcie zostanie tylko w prezentacji" : "Potrzebne uprawnienie „Materiały — zarządzanie”"))
            }
        }
    }

    private var placeholder: String {
        switch source {
        case .product: return "Szukaj produktu w katalogu"
        case .site: return "Szukaj realizacji"
        case .material: return album.flatMap { id in albums.first { $0.id == id }.map { "Szukaj w albumie „\($0.name)”" } } ?? "Szukaj w bazie zdjęć po nazwie pliku"
        case .social: return "Szukaj po nazwie"
        }
    }

    // MARK: Listy

    private var ownerGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            ForEach(owners) { item in
                Button { owner = ShowcaseListPick(id: item.id, title: item.title, thumb: item.thumb) } label: {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                            .overlay {
                                if let thumb = item.thumb { SocialImageView(url: thumb) } else {
                                    Rectangle().fill(Color.primary.opacity(0.06))
                                        .overlay(Image(systemName: source == .product ? "shippingbox" : "rosette").font(.title2).foregroundStyle(theme.accent.opacity(0.5)))
                                }
                            }
                            .clipped()
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).lineLimit(1)
                            Text(item.inCard ? "W tej karcie" : item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .padding(8)
                    }
                    .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, 8)
    }

    private var photoGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
            if source == .material && album == nil && query.isEmpty {
                ForEach(readyEntries, id: \.key) { entry in readyTile(entry) }
            }
            ForEach(photos) { photo in tile(photo) }
        }
        .padding(.bottom, 8)
    }

    private func key(_ photo: ShowcasePickPhoto) -> String { "\(source.rawValue):\(photo.media?.key ?? photo.id)" }

    private func tile(_ photo: ShowcasePickPhoto) -> some View {
        let entryKey = key(photo)
        let active = selected.contains { $0.key == entryKey }
        return Button { toggle(photo) } label: {
            Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                .overlay { SocialImageView(url: photo.thumbnailUrl) }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? theme.accent : Color.clear, lineWidth: 3))
                .overlay(alignment: .topTrailing) {
                    if active { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(theme.accent).padding(4) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(photo.name)
        .onDrag {
            NSItemProvider(object: "\(ShowcasePickerDrag.prefix)\(photo.id)" as NSString)
        }
    }

    private func readyTile(_ entry: ShowcasePickEntry) -> some View {
        Button { selected.removeAll { $0.key == entry.key } } label: {
            Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                .overlay { SocialImageView(url: entry.photo.thumbnailUrl) }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent, lineWidth: 3))
                .overlay(alignment: .topLeading) {
                    Text("Wgrane teraz").font(.caption2).padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Capsule().fill(Color.black.opacity(0.65))).foregroundStyle(.white).padding(5)
                }
                .overlay(alignment: .topTrailing) { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(theme.accent).padding(4) }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(entry.photo.name) — wgrane teraz (kliknij, aby odznaczyć)")
    }

    private func toggle(_ photo: ShowcasePickPhoto) {
        let entryKey = key(photo)
        if selected.contains(where: { $0.key == entryKey }) { selected.removeAll { $0.key == entryKey }; return }
        let entry = ShowcasePickEntry(key: entryKey, source: source, photo: photo, ready: nil)
        if single { selected = [entry] } else { selected.append(entry) }
    }

    private var materialIDs: [String] {
        var seen = Set<String>()
        return selected.filter { $0.source == .material && $0.ready == nil }.map(\.photo.id).filter { seen.insert($0).inserted }
    }

    // MARK: Dane

    private func loadBase() async {
        do { base = try await store.photoBase() } catch {
            base = ShowcasePhotoBaseReply(base: nil, albums: [], canView: false, problem: store.failureText(error, "Nie udało się wczytać bazy zdjęć."))
        }
    }

    private func loadOwners() async {
        guard source.needsOwner, owner == nil else { owners = []; return }
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        loading = true
        defer { loading = false }
        do {
            if source == .product {
                let inCard = Set(products.map(\.0))
                let list = try await store.products(query: query).map { option -> ShowcaseOwnerTile in
                    ShowcaseOwnerTile(id: option.id, title: option.name, detail: option.category, thumb: option.thumbnailUrl, inCard: inCard.contains(option.id))
                }
                if Task.isCancelled { return }
                owners = list.filter(\.inCard) + list.filter { !$0.inCard }
            } else {
                let list = try await store.realizations(query: query).map { option -> ShowcaseOwnerTile in
                    let parts: [String] = [option.location, String((option.date ?? "").prefix(4)), "\(option.photos) zdj."].filter { !$0.isEmpty }
                    return ShowcaseOwnerTile(id: option.id, title: option.title, detail: parts.joined(separator: " · "), thumb: option.thumbnailUrl, inCard: false)
                }
                if Task.isCancelled { return }
                owners = list
            }
            problem = owners.isEmpty ? "Brak wyników." : nil
        } catch {
            if !Task.isCancelled { owners = []; problem = store.failureText(error, "Nie udało się pobrać listy.") }
        }
    }

    private func loadPhotos() async {
        if source.needsOwner && owner == nil { photos = []; hasMore = false; return }
        if !source.needsOwner && !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
        if Task.isCancelled { return }
        loading = true
        defer { loading = false }
        do {
            let reply = try await store.photos(source: source, owner: owner?.id, query: query, album: source == .material ? album : nil)
            if Task.isCancelled { return }
            photos = reply.photos
            hasMore = reply.hasMore == true
            let empty = source == .material && album == nil && query.isEmpty
                ? "Baza zdjęć jest pusta — wgraj zdjęcia z dysku albo przeciągnij je tutaj z Findera." : "Brak zdjęć (JPEG, PNG, WebP)."
            problem = reply.problem ?? (reply.photos.isEmpty ? empty : nil)
        } catch {
            if Task.isCancelled { return }
            photos = []
            problem = store.failureText(error, "Nie udało się pobrać zdjęć.")
        }
    }

    private func loadMore() async {
        loading = true
        defer { loading = false }
        do {
            let reply = try await store.photos(source: source, owner: owner?.id, query: query, album: album, offset: photos.count)
            let known = Set(photos.map(\.id))
            photos += reply.photos.filter { !known.contains($0.id) }
            hasMore = reply.hasMore == true
        } catch {
            store.workspace?.error = store.failureText(error, "Nie udało się pobrać zdjęć.")
        }
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = !single
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Wgraj do bazy zdjęć"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task { await upload(urls) }
    }

    /// Z dysku → baza zdjęć; jedno zdjęcie (zdjęcie główne, okładka) — od razu wybrane, kilka — zaznaczone do „Dodaj”.
    private func upload(_ urls: [URL]) async {
        guard !urls.isEmpty else { return }
        guard canUpload else { store.workspace?.notice = "Do wgrywania potrzebne jest uprawnienie „Materiały — zarządzanie”."; return }
        let files = single ? Array(urls.prefix(1)) : Array(urls.prefix(40))
        let replies = await store.upload(files, target: target, next: single ? "" : "zaznaczone — kliknij „Dodaj”")
        guard !replies.isEmpty else { return }
        if single {
            dismiss()
            onPick(replies)
            return
        }
        let entries = replies.map { reply -> ShowcasePickEntry in
            let pair = reply.urls[reply.photo.key]
            let photo = ShowcasePickPhoto(id: "upload:\(reply.photo.key)", name: reply.photo.caption.isEmpty ? "Zdjęcie" : reply.photo.caption,
                                          thumbnailUrl: pair?.thumb, url: pair?.url, width: reply.photo.width.map(Double.init),
                                          height: reply.photo.height.map(Double.init), media: reply.photo)
            return ShowcasePickEntry(key: "upload:\(reply.photo.key)", source: .material, photo: photo, ready: reply)
        }
        selected = selected.filter { item in !entries.contains { $0.key == item.key } } + entries
        await loadBase()
    }

    private func createAlbum() async {
        guard let name = newAlbum?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, let company = base?.base?.companyId else { return }
        if let id = await store.createAlbum(companyID: company, name: name, fileIDs: materialIDs) {
            newAlbum = nil
            await loadBase()
            album = id
        }
    }

    private func confirm() {
        let chosen = selected
        let destination = target
        let handler = onPick
        let pickerStore = store
        dismiss()
        Task {
            var replies: [ShowcasePhotoReply] = []
            var index = 0
            // Kolejność zaznaczenia; kolejne zdjęcia z tego samego źródła — jednym wywołaniem.
            while index < chosen.count {
                if let ready = chosen[index].ready { replies.append(ready); index += 1; continue }
                let kind = chosen[index].source
                var run: [ShowcasePickPhoto] = []
                while index < chosen.count, chosen[index].ready == nil, chosen[index].source == kind { run.append(chosen[index].photo); index += 1 }
                replies += await pickerStore.pick(run, source: kind, target: destination)
            }
            if !replies.isEmpty { handler(replies) }
        }
    }
}

/// Wybór produktów z katalogu albo realizacji ze strony.
@MainActor struct ShowcaseListPickerSheet: View {
    @ObservedObject var store: ShowcaseStore
    let realizations: Bool
    let exclude: [String]
    let single: Bool
    let title: String
    let confirm: String?
    let onPick: ([ShowcaseListPick]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var query = ""
    @State private var options: [ShowcaseListPick] = []
    @State private var subtitles: [String: String] = [:]
    @State private var problem: String?
    @State private var selected: [ShowcaseListPick] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.title3.weight(.semibold))
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            TextField(realizations ? "Szukaj realizacji" : "Szukaj produktu w katalogu", text: $query).textFieldStyle(.roundedBorder)
            List(options, id: \.id) { option in row(option) }
                .overlay { if options.isEmpty { Text(problem ?? "Brak wyników.").font(.callout).foregroundStyle(.secondary) } }
            HStack {
                Spacer()
                Button(confirm ?? (single ? "Wybierz" : "Dodaj (\(selected.count))")) {
                    let picked = selected
                    dismiss()
                    onPick(picked)
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 620, height: 580)
        .task(id: query) { await reload() }
    }

    private func row(_ option: ShowcaseListPick) -> some View {
        let added = exclude.contains(option.id)
        let active = selected.contains { $0.id == option.id }
        return Button {
            guard !added else { return }
            if single { selected = active ? [] : [option] }
            else if active { selected.removeAll { $0.id == option.id } }
            else { selected.append(option) }
        } label: {
            HStack(spacing: 10) {
                Color.clear.frame(width: 64, height: 44)
                    .overlay {
                        if let thumb = option.thumb { SocialImageView(url: thumb) } else {
                            Rectangle().fill(Color.primary.opacity(0.06))
                                .overlay(Image(systemName: realizations ? "rosette" : "shippingbox").foregroundStyle(theme.accent.opacity(0.5)))
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.title).lineLimit(1)
                    Text(added ? "Już w karcie" : (subtitles[option.id] ?? "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if active { Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.accent) }
            }
            .opacity(added ? 0.45 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func reload() async {
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        do {
            if realizations {
                let list = try await store.realizations(query: query)
                options = list.map { ShowcaseListPick(id: $0.id, title: $0.title, thumb: $0.thumbnailUrl) }
                subtitles = Dictionary(uniqueKeysWithValues: list.map { (option: ShowcaseRealizationOption) -> (String, String) in
                    let parts: [String] = [option.location, String((option.date ?? "").prefix(10)), "\(option.photos) zdj."].filter { !$0.isEmpty }
                    return (option.id, parts.joined(separator: " · "))
                })
            } else {
                let list = try await store.products(query: query)
                options = list.map { ShowcaseListPick(id: $0.id, title: $0.name, thumb: $0.thumbnailUrl) }
                subtitles = Dictionary(uniqueKeysWithValues: list.map { (option: ShowcaseProductOption) -> (String, String) in
                    let price: String = option.priceNet.map { ShowcaseShared.price($0) + (option.unit.isEmpty ? "" : " / \(option.unit)") } ?? ""
                    return (option.id, [option.category, price].filter { !$0.isEmpty }.joined(separator: " · "))
                })
            }
            problem = nil
        } catch {
            if Task.isCancelled { return }
            options = []
            problem = store.failureText(error, "Nie udało się pobrać listy.")
        }
    }
}

/// Dział prezentacji: nazwa, opis na kafelku, ikona, okładka, widoczność; usunięcie razem z kartami.
@MainActor struct ShowcaseSectionSheet: View {
    @ObservedObject var store: ShowcaseStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State var draft: ShowcaseSectionDraft
    @State private var coverPicker = false
    @State private var confirmDelete = false
    @State private var dropping = false
    /// Okładka z dysku dla nowego działu — wgrywa się zaraz po utworzeniu działu.
    @State private var pendingCover: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(draft.sectionID == nil ? "Nowy dział" : "Dział prezentacji").font(.title3.weight(.semibold))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            TextField("Nazwa (np. Ekrany LED)", text: Binding(get: { draft.title }, set: { draft.title = String($0.prefix(ShowcaseLimits.sectionTitle)) }))
                .textFieldStyle(.roundedBorder)
            TextField("Opis na kafelku (opcjonalnie)", text: Binding(get: { draft.subtitle }, set: { draft.subtitle = String($0.prefix(ShowcaseLimits.sectionSubtitle)) }))
                .textFieldStyle(.roundedBorder)
            Text("Ikona").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 6), count: 9), spacing: 6) {
                ForEach(ShowcaseIconInfo.all) { icon in
                    Button { draft.icon = icon.key } label: {
                        Image(systemName: icon.symbol).font(.title3)
                            .frame(width: 44, height: 38)
                            .background(RoundedRectangle(cornerRadius: 7).fill(draft.icon == icon.key ? theme.accent.opacity(0.2) : Color.primary.opacity(0.04)))
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(draft.icon == icon.key ? theme.accent : Color.clear))
                            .foregroundStyle(draft.icon == icon.key ? theme.accent : Color.primary)
                    }
                    .buttonStyle(.plain).help(icon.label)
                }
            }
            Text("Okładka (zdjęcie na kafelku działu)").font(.caption).foregroundStyle(.secondary)
            coverRow
            Toggle(draft.isActive ? "Widoczny na spotkaniach" : "Ukryty (przygotowanie)", isOn: $draft.isActive).toggleStyle(.switch)
            Spacer(minLength: 0)
            HStack {
                if draft.sectionID != nil {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń dział", systemImage: "trash") }
                }
                Spacer()
                Button(draft.sectionID == nil ? "Utwórz dział" : "Zapisz") {
                    let value = draft
                    let pending = draft.sectionID == nil ? pendingCover : nil
                    Task {
                        await store.saveSection(value, pendingCover: pending)
                        if let pending { PortfolioDrop.cleanup([pending]) }
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 560, height: 600)
        .sheet(isPresented: $coverPicker) {
            ShowcasePhotoPickerSheet(store: store, target: draft.sectionID.map { ShowcaseUploadTarget.section($0) } ?? .none, products: [], single: true) { replies in
                if let first = replies.first {
                    draft.cover = first.photo
                    if let pendingCover { PortfolioDrop.cleanup([pendingCover]) }
                    pendingCover = nil
                }
            }
            .environment(\.crmTheme, theme)
        }
        .confirmationDialog("Usunąć dział?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń dział", role: .destructive) { if let id = draft.sectionID { Task { await store.deleteSection(id) } } }
            Button("Wróć", role: .cancel) {}
        } message: {
            let count = draft.sectionID.map { store.items(in: $0).count } ?? 0
            let message: String = count > 0
                ? "Razem z działem zostaną usunięte karty (\(count)) i ich zdjęcia wgrane do prezentacji. Tej operacji nie można cofnąć."
                : "Dział jest pusty. Tej operacji nie można cofnąć."
            Text(message)
        }
    }

    private var coverRow: some View {
        HStack(spacing: 12) {
            Color.clear.frame(width: 180, height: 110)
                .overlay {
                    if let pendingCover, let image = NSImage(contentsOf: pendingCover) {
                        Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                    } else if let cover = draft.cover { SocialImageView(url: store.url(cover.key)?.thumb) } else {
                        RoundedRectangle(cornerRadius: 8).strokeBorder(theme.accent.opacity(dropping ? 0.9 : 0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                            .overlay(Text("Przeciągnij zdjęcie").font(.caption).foregroundStyle(.secondary))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(dropping ? theme.accent : Color.clear, lineWidth: 2))
                .overlay(alignment: .topTrailing) {
                    if draft.cover != nil || pendingCover != nil {
                        Button {
                            draft.cover = nil
                            if let pendingCover { PortfolioDrop.cleanup([pendingCover]) }
                            pendingCover = nil
                        } label: {
                            Image(systemName: "xmark").font(.caption.weight(.semibold)).foregroundStyle(.white)
                                .frame(width: 22, height: 22).background(Circle().fill(Color.black.opacity(0.6)))
                        }
                        .buttonStyle(.plain).padding(4)
                    }
                }
                .onDrop(of: PortfolioDrop.types, isTargeted: $dropping) { providers in
                    guard PortfolioDrop.external(providers) else { return false }
                    Task {
                        let urls = await PortfolioDrop.files(providers)
                        await setCover(urls)
                    }
                    return true
                }
            VStack(alignment: .leading, spacing: 6) {
                Button { chooseFile() } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                Button { coverPicker = true } label: { Label("Z bazy zdjęć…", systemImage: "photo.stack") }
                if pendingCover != nil {
                    Text("Okładka zapisze się w bazie zdjęć po utworzeniu działu.").font(.caption2).foregroundStyle(.secondary).frame(maxWidth: 200, alignment: .leading)
                }
            }
        }
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Ustaw okładkę"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task { await setCover(urls) }
    }

    /// Istniejący dział — od razu do bazy zdjęć i na okładkę (zapis działu — „Zapisz”); nowy — po utworzeniu działu.
    private func setCover(_ urls: [URL]) async {
        guard let first = urls.first else { return }
        guard let sectionID = draft.sectionID else {
            if let pendingCover, pendingCover != first { PortfolioDrop.cleanup([pendingCover]) }
            pendingCover = first
            draft.cover = nil
            PortfolioDrop.cleanup(Array(urls.dropFirst()))
            return
        }
        let replies = await store.upload([first], target: .section(sectionID), next: "zapisz dział")
        PortfolioDrop.cleanup(urls)
        if let reply = replies.first { draft.cover = reply.photo }
    }
}

/// Nowa karta w wybranym dziale: z produktu z katalogu (zalecane) albo pusta z tytułem.
@MainActor struct ShowcaseCreateSheet: View {
    @ObservedObject var store: ShowcaseStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var title = ""
    @State private var productPicker = false

    var body: some View {
        let section = store.selectedSection
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Nowa karta — \(section?.title ?? "")").font(.title3.weight(.semibold))
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Button { productPicker = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "shippingbox").font(.title2).foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Z produktu z katalogu (zalecane)").font(.headline)
                        Text("Zdjęcia, wstęp, korzyści, warianty z cenami, pakiety i przygotowanie — z Oferty → Produkty.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Divider()
            Text("Albo pusta karta").font(.headline)
            HStack {
                TextField("Tytuł karty", text: Binding(get: { title }, set: { title = String($0.prefix(ShowcaseLimits.title)) }))
                    .textFieldStyle(.roundedBorder).onSubmit { create(nil) }
                Button("Utwórz") { create(nil) }.buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(width: 560, height: 300)
        .sheet(isPresented: $productPicker) {
            ShowcaseListPickerSheet(store: store, realizations: false, exclude: [], single: true, title: "Karta z produktu", confirm: "Utwórz kartę") { picked in
                if let first = picked.first { create(first.id) }
            }
            .environment(\.crmTheme, theme)
        }
    }

    private func create(_ productID: String?) {
        guard let sectionID = store.selectedSection?.id else { return }
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if productID == nil && value.isEmpty { return }
        Task { await store.createItem(sectionID: sectionID, title: productID == nil ? value : nil, productID: productID) }
    }
}
