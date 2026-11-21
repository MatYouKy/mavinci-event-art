import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Strefa sprzedawcy → „Prezentacje” — okna: wybór zdjęć (produkty z katalogu i realizacje bez kopiowania, Materiały, pliki
// wydarzenia i social media — kopia WebP), wybór produktów i realizacji, dział (nazwa, opis, ikona, okładka, widoczność) i nowa
// karta (z produktu albo pusta). Te same źródła i reguły co w CRM.

/// Wybrana pozycja listy (produkt albo realizacja).
struct ShowcaseListPick: Hashable {
    let id: String
    let title: String
    let thumb: String?
}

@MainActor struct ShowcasePhotoPickerSheet: View {
    @ObservedObject var store: ShowcaseStore
    let target: ShowcaseUploadTarget
    /// Produkty karty — pierwsze w źródle „Produkty”.
    let products: [(String, String)]
    let single: Bool
    let onPick: ([ShowcasePhotoReply]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var source: ShowcasePhotoSource = .product
    @State private var query = ""
    @State private var owners: [ShowcaseListPick] = []
    @State private var owner: ShowcaseListPick?
    @State private var photos: [ShowcasePickPhoto] = []
    @State private var problem: String?
    @State private var loading = false
    @State private var selected: [String] = []

    init(store: ShowcaseStore, target: ShowcaseUploadTarget, products: [(String, String)], single: Bool, onPick: @escaping ([ShowcasePhotoReply]) -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.target = target
        self.products = products
        self.single = single
        self.onPick = onPick
        _source = State(initialValue: products.isEmpty ? .site : .product)
        _owner = State(initialValue: products.first.map { ShowcaseListPick(id: $0.0, title: $0.1, thumb: nil) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(single ? "Wybierz zdjęcie" : "Dodaj zdjęcia").font(.title3.weight(.semibold))
                Spacer()
                Picker("Źródło", selection: $source) {
                    ForEach(ShowcasePhotoSource.allCases) { item in Label(item.label, systemImage: item.symbol).tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 560)
            }
            TextField(placeholder, text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
            if source.needsOwner { ownersList }
            ZStack {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                        ForEach(photos) { photo in tile(photo) }
                    }
                }
                if loading { ProgressView("Ładowanie zdjęć...") }
                else if let problem { Text(problem).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                Text("Zdjęcia produktów i realizacji są pokazywane bez kopiowania; pozostałe zapiszą się w Prezentacjach (WebP).")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(single ? "Wybierz" : "Dodaj zaznaczone (\(selected.count))") { confirm() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 980, height: 700)
        .onChange(of: source) { _, value in
            selected = []
            query = ""
            photos = []
            owner = value == .product ? products.first.map { ShowcaseListPick(id: $0.0, title: $0.1, thumb: nil) } : nil
        }
        .task(id: "owners|\(source.rawValue)|\(query)") { await loadOwners() }
        .task(id: "photos|\(source.rawValue)|\(owner?.id ?? "")|\(source.needsOwner ? "" : query)") { await loadPhotos() }
    }

    private var placeholder: String {
        switch source {
        case .product: return "Szukaj produktu w katalogu"
        case .site: return "Szukaj realizacji"
        case .event: return "Szukaj wydarzenia"
        case .material, .social: return "Szukaj po nazwie"
        }
    }

    private var ownersList: some View {
        ScrollView {
            WrapLayout(spacing: 6) {
                ForEach(owners, id: \.id) { item in
                    Button { owner = item; selected = [] } label: {
                        Text(item.title).font(.caption).lineLimit(1)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(Capsule().fill(owner?.id == item.id ? theme.accent.opacity(0.2) : Color.primary.opacity(0.05)))
                            .overlay(Capsule().stroke(owner?.id == item.id ? theme.accent : Color.clear))
                            .foregroundStyle(owner?.id == item.id ? theme.accent : Color.primary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxHeight: 96)
        .overlay {
            if owners.isEmpty {
                Text(source == .product && query.isEmpty ? "Karta nie ma jeszcze produktów — wyszukaj produkt w katalogu." : "Brak wyników.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func tile(_ photo: ShowcasePickPhoto) -> some View {
        let active = selected.contains(photo.id)
        return Button {
            if single { selected = active ? [] : [photo.id] }
            else if active { selected.removeAll { $0 == photo.id } }
            else { selected.append(photo.id) }
        } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { SocialImageView(url: photo.thumbnailUrl) }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? theme.accent : Color.clear, lineWidth: 3))
                .overlay(alignment: .topTrailing) {
                    if active { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(theme.accent).padding(4) }
                }
                .overlay(alignment: .bottom) {
                    Text(photo.name).font(.caption2).lineLimit(1).padding(.horizontal, 4).padding(.vertical, 2)
                        .frame(maxWidth: .infinity).background(Color.black.opacity(0.55)).foregroundStyle(.white)
                        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 8, bottomTrailingRadius: 8))
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(photo.name)
    }

    private func loadOwners() async {
        guard source.needsOwner else { owners = []; return }
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        do {
            switch source {
            case .product:
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    owners = products.map { ShowcaseListPick(id: $0.0, title: $0.1, thumb: nil) }
                } else {
                    owners = try await store.products(query: query).map { ShowcaseListPick(id: $0.id, title: $0.name, thumb: $0.thumbnailUrl) }
                }
            case .site:
                owners = try await store.realizations(query: query).map { (option: ShowcaseRealizationOption) -> ShowcaseListPick in
                    let parts: [String] = [option.title, option.location, String((option.date ?? "").prefix(4))].filter { !$0.isEmpty }
                    return ShowcaseListPick(id: option.id, title: parts.joined(separator: " · "), thumb: option.thumbnailUrl)
                }
            case .event:
                owners = try await store.events(query: query).map { (option: ShowcaseEventOption) -> ShowcaseListPick in
                    let parts: [String] = [option.name, String((option.date ?? "").prefix(10))].filter { !$0.isEmpty }
                    return ShowcaseListPick(id: option.id, title: parts.joined(separator: " · "), thumb: nil)
                }
            case .material, .social:
                owners = []
            }
        } catch {
            if !Task.isCancelled { owners = []; problem = store.failureText(error, "Nie udało się pobrać listy.") }
        }
    }

    private func loadPhotos() async {
        if source.needsOwner && owner == nil {
            photos = []; loading = false
            problem = source == .product ? "Wybierz produkt." : (source == .site ? "Wybierz realizację." : "Wybierz wydarzenie.")
            return
        }
        if !source.needsOwner && !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
        if Task.isCancelled { return }
        loading = true
        defer { loading = false }
        do {
            let reply = try await store.photos(source: source, owner: owner?.id, query: query)
            if Task.isCancelled { return }
            photos = reply.photos
            problem = reply.problem ?? (reply.photos.isEmpty ? "Brak zdjęć w tym źródle (JPEG, PNG, WebP)." : nil)
        } catch {
            if Task.isCancelled { return }
            photos = []
            problem = store.failureText(error, "Nie udało się pobrać zdjęć.")
        }
    }

    private func confirm() {
        let chosen = selected.compactMap { id in photos.first { $0.id == id } }
        let current = source
        let destination = target
        let handler = onPick
        let pickerStore = store
        dismiss()
        Task {
            let replies = await pickerStore.pick(chosen, source: current, target: destination)
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
            if let sectionID = draft.sectionID {
                coverRow(sectionID)
            } else {
                Text("Okładkę dodasz po utworzeniu działu.").font(.caption).foregroundStyle(.tertiary)
            }
            Toggle(draft.isActive ? "Widoczny na spotkaniach" : "Ukryty (przygotowanie)", isOn: $draft.isActive).toggleStyle(.switch)
            Spacer(minLength: 0)
            HStack {
                if draft.sectionID != nil {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń dział", systemImage: "trash") }
                }
                Spacer()
                Button(draft.sectionID == nil ? "Utwórz dział" : "Zapisz") {
                    let value = draft
                    Task { await store.saveSection(value) }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 560, height: 600)
        .sheet(isPresented: $coverPicker) {
            if let sectionID = draft.sectionID {
                ShowcasePhotoPickerSheet(store: store, target: .section(sectionID), products: [], single: true) { replies in
                    if let first = replies.first { draft.cover = first.photo }
                }
                .environment(\.crmTheme, theme)
            }
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

    private func coverRow(_ sectionID: String) -> some View {
        HStack(spacing: 12) {
            Color.clear.frame(width: 180, height: 110)
                .overlay {
                    if let cover = draft.cover { SocialImageView(url: store.url(cover.key)?.thumb) } else {
                        RoundedRectangle(cornerRadius: 8).strokeBorder(theme.accent.opacity(dropping ? 0.9 : 0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                            .overlay(Text("Przeciągnij zdjęcie").font(.caption).foregroundStyle(.secondary))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .topTrailing) {
                    if draft.cover != nil {
                        Button { draft.cover = nil } label: {
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
                        await upload(urls, sectionID: sectionID)
                        PortfolioDrop.cleanup(urls)
                    }
                    return true
                }
            VStack(alignment: .leading, spacing: 6) {
                Button { chooseFile(sectionID) } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                Button { coverPicker = true } label: { Label("Wybierz…", systemImage: "photo.on.rectangle") }
            }
        }
    }

    private func chooseFile(_ sectionID: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Ustaw okładkę"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task { await upload(urls, sectionID: sectionID) }
    }

    private func upload(_ urls: [URL], sectionID: String) async {
        guard let first = urls.first else { return }
        let replies = await store.upload([first], target: .section(sectionID))
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
